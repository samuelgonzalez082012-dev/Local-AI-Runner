'use strict';

const net = require('node:net');
const crypto = require('node:crypto');

// Integrated browser: a sandboxed Chromium view (Electron WebContentsView) that the
// user can see and drive, and that the AI agent can drive through a small, bounded tool set.
//
// Safety model
//  - The browser uses its own session partition and has no preload script, so pages can never
//    reach this app's IPC bridge, its storage or its credentials.
//  - Every permission request (camera, location, notifications...) and every download is denied.
//  - Only http(s) pages can be opened. Private-network addresses always need approval.
//  - While the agent is active, visiting a new site needs approval (default on).
//  - Submitting forms, risky buttons and JavaScript execution need native approval.
//  - Password / payment fields are never filled by the agent.
//  - All page-derived text returned to the model is wrapped as untrusted data by the renderer.

const PARTITION = 'persist:agent-browser';
const MAX_URL_LENGTH = 2048;
const MAX_TABS = 8;
const MAX_MARKS = 120;
const MAX_TEXT = 12000;
const MAX_TYPE_CHARS = 5000;
const MAX_JS_CHARS = 4000;
const NAV_TIMEOUT_MS = 25_000;
const SETTLE_MS = 350;
const AGENT_ACTIVE_LIMIT_MS = 30 * 60 * 1000;
const SCREENSHOT_MAX_WIDTH = 1280;
const SCREENSHOT_MAX_BYTES = 2_500_000;

/* ------------------------------------------------------------------ pure helpers */

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true;
  const kind = net.isIP(host);
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (kind === 6) {
    if (host === '::1' || host === '::') return true;
    if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateHost(mapped[1]);
  }
  return false;
}

function validateNavigationUrl(input) {
  let text = String(input == null ? '' : input).trim();
  if (!text) throw new Error('A web address is required.');
  if (text.length > MAX_URL_LENGTH) throw new Error('That web address is too long.');
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error('The web address contains invalid characters.');
  if (text === 'about:blank') return { url: 'about:blank', origin: 'about:blank', hostname: '', isPrivate: false, blank: true };
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) {
    if (/\s/.test(text) || !/^[^\s/]+\.[^\s/]+|^localhost(?::\d+)?(?:[/?#]|$)|^\[?[0-9a-f:.]+\]?(?::\d+)?(?:[/?#]|$)/i.test(text)) {
      throw new Error('Enter a full web address such as https://example.com.');
    }
    text = `https://${text}`;
  }
  let url;
  try { url = new URL(text); } catch (_) { throw new Error('That is not a valid web address.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https pages can be opened in the browser.');
  if (url.username || url.password) throw new Error('Web addresses containing a username or password are not allowed.');
  if (!url.hostname) throw new Error('The web address has no host name.');
  return { url: url.href, origin: url.origin, hostname: url.hostname, isPrivate: isPrivateHost(url.hostname), blank: false };
}

const RISKY_LABEL = /\b(buy|purchase|pay|place\s+order|checkout|check\s+out|order\s+now|donate|subscribe|confirm|delete|remove|erase|send|post|publish|submit|sign\s?in|log\s?in|sign\s?up|register|apply|transfer|withdraw|unsubscribe|deactivate|close\s+account|cancel\s+(my\s+)?(subscription|account|order))\b/i;

function classifyClickRisk(desc) {
  const d = desc || {};
  const tag = String(d.tag || '').toLowerCase();
  const type = String(d.type || '').toLowerCase();
  const label = String(d.label || '');
  if (tag === 'input' && ['submit', 'image'].includes(type)) return { risky: true, reason: 'submits a form' };
  if (tag === 'button' && d.inForm && !['button', 'reset'].includes(type)) return { risky: true, reason: 'submits a form' };
  if ((tag === 'button' || d.role === 'button' || tag === 'input') && RISKY_LABEL.test(label)) return { risky: true, reason: `looks like a “${(label.match(RISKY_LABEL) || [''])[0].toLowerCase()}” action` };
  return { risky: false, reason: '' };
}

const SENSITIVE_FIELD = /(pass(word|wd|code)?\b|card.?(number|no)|cc.?(num|number)|cvv|cvc|security.?code|\bssn\b|social.?security|routing.?number|\biban\b|\bpin\b|one.?time.?code|otp)/i;

function isSensitiveField(desc) {
  const d = desc || {};
  if (String(d.type || '').toLowerCase() === 'password') return true;
  if (/^(cc-|current-password|new-password|one-time-code)/i.test(String(d.autocomplete || ''))) return true;
  return SENSITIVE_FIELD.test([d.name, d.id, d.label].filter(Boolean).join(' '));
}

function truncate(text, max) {
  const value = String(text == null ? '' : text);
  return value.length > max ? `${value.slice(0, max)}… [truncated ${value.length - max} characters]` : value;
}

function normalizeBounds(rect, limit) {
  const r = rect && typeof rect === 'object' ? rect : {};
  const num = value => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);
  let x = num(r.x); let y = num(r.y); let width = num(r.width); let height = num(r.height);
  const maxW = limit && Number.isFinite(limit.width) ? limit.width : 16384;
  const maxH = limit && Number.isFinite(limit.height) ? limit.height : 16384;
  x = Math.min(Math.max(x, 0), maxW); y = Math.min(Math.max(y, 0), maxH);
  width = Math.min(Math.max(width, 0), Math.max(0, maxW - x));
  height = Math.min(Math.max(height, 0), Math.max(0, maxH - y));
  return { x, y, width, height };
}

function formatMarksList(marks) {
  return (marks || []).map(m => {
    const bits = [`[${m.i}] ${m.role || m.tag}${m.type && m.tag === 'input' ? `:${m.type}` : ''}`];
    if (m.label) bits.push(`"${m.label}"`);
    if (m.href) bits.push(`→ ${m.href}`);
    if (m.value && m.tag !== 'a' && m.tag !== 'button' && !['checkbox', 'radio', 'submit', 'button', 'reset'].includes(m.type)) bits.push(`value="${m.value}"`);
    if (m.checked === true) bits.push('(checked)');
    if (m.disabled) bits.push('(disabled)');
    return bits.join(' ');
  }).join('\n');
}

function formatDomReport(report) {
  const r = report || {};
  const lines = [];
  lines.push(`URL: ${r.url || ''}`);
  lines.push(`Title: ${r.title || ''}`);
  if (r.viewport) lines.push(`Viewport: ${r.viewport.w}x${r.viewport.h}, scrolled ${Math.round(r.viewport.scrollY)} of ${Math.round(Math.max(0, r.viewport.docH - r.viewport.h))} px`);
  lines.push('');
  lines.push(r.marks && r.marks.length ? 'Interactive elements currently visible (the same numbers are drawn on the page):' : 'No interactive elements are visible in the current viewport.');
  if (r.marks && r.marks.length) lines.push(formatMarksList(r.marks));
  if (r.headings && r.headings.length) { lines.push('', 'Headings:'); r.headings.forEach(h => lines.push(`- ${h}`)); }
  if (r.text) { lines.push('', 'Visible text (excerpt):', r.text); }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ in-page library
   Serialized with Function.prototype.toString and evaluated in the page. It must be
   self-contained: it cannot reference anything outside its own body. */

function pageLibrary() {
  if (window.__larAgent) return;
  const OVERLAY_ID = '__lar_agent_overlay__';
  const COLORS = ['#ff4d6d', '#2ec4b6', '#ff9f1c', '#7b6cff', '#3a86ff', '#e63946'];
  const state = { marks: [], boxes: [], active: false, rafPending: false };
  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = '<style>' +
    '.mark{position:fixed;box-sizing:border-box;border:2px solid;border-radius:4px;pointer-events:none}' +
    '.tag{position:absolute;left:-2px;top:-17px;min-width:17px;padding:0 4px;height:17px;line-height:17px;font:700 11px/17px system-ui,sans-serif;color:#fff;border-radius:4px 4px 4px 0;text-align:center}' +
    '.glow{position:fixed;inset:0;box-shadow:inset 0 0 0 3px rgba(104,123,233,.85),inset 0 0 28px rgba(104,123,233,.35);pointer-events:none;opacity:0;transition:opacity .25s}' +
    '.glow.on{opacity:1}' +
    '.pill{position:fixed;top:8px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:999px;background:rgba(18,24,38,.92);color:#e8ecff;font:600 11px/1.4 system-ui,sans-serif;letter-spacing:.02em;box-shadow:0 2px 12px rgba(0,0,0,.4);opacity:0;transition:opacity .25s}' +
    '.pill.on{opacity:1}' +
    '.cursor{position:fixed;left:0;top:0;width:22px;height:22px;transform:translate(60vw,60vh);transition:transform .5s cubic-bezier(.22,.8,.3,1);opacity:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}' +
    '.cursor.on{opacity:1}' +
    '.ripple{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #8a9dff;animation:rip .55s ease-out forwards;pointer-events:none}' +
    '@keyframes rip{from{transform:scale(.4);opacity:1}to{transform:scale(3.2);opacity:0}}' +
    '</style><div class="glow"></div><div class="pill">AI is working in this tab</div><div class="layer"></div>' +
    '<svg class="cursor" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.6L9.5 19z" fill="#fff" stroke="#1b2133" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const layer = root.querySelector('.layer');
  const glow = root.querySelector('.glow');
  const pill = root.querySelector('.pill');
  const cursor = root.querySelector('.cursor');
  (document.documentElement || document.body).appendChild(host);

  function clean(text, max) { return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, max); }

  function describe(el, i) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    let label = el.getAttribute('aria-label') || '';
    if (!label && el.labels && el.labels[0]) label = el.labels[0].innerText;
    if (!label) label = el.getAttribute('placeholder') || el.getAttribute('alt') || el.getAttribute('title') || '';
    if (!label) label = (tag === 'input' && ['submit', 'button', 'reset'].includes(type) ? el.value : el.innerText) || '';
    let value = '';
    if (type !== 'password') {
      if (tag === 'select') value = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex].text : '';
      else if (tag === 'input' || tag === 'textarea') value = el.value || '';
    }
    const editable = (tag === 'textarea') || el.isContentEditable ||
      (tag === 'input' && !['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'range', 'color', 'hidden'].includes(type));
    return {
      i, tag, type, role: el.getAttribute('role') || '',
      label: clean(label, 80), name: el.getAttribute('name') || '', id: el.id || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      href: tag === 'a' ? clean(el.getAttribute('href') || '', 120) : '',
      value: clean(value, 60), editable: !!editable,
      checked: (type === 'checkbox' || type === 'radio') ? !!el.checked : undefined,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      inForm: !!el.closest('form')
    };
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0 || cs.pointerEvents === 'none') return false;
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    return !top || el.contains(top) || top.contains(el);
  }

  const SELECTOR = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option],[contenteditable=""],[contenteditable="true"],[onclick],[tabindex]:not([tabindex="-1"])';
  const NATIVE = 'a[href],button,input:not([type=hidden]),select,textarea';

  function gather(root0, out, depth) {
    if (depth > 4) return;
    root0.querySelectorAll(SELECTOR).forEach(el => out.push(el));
    root0.querySelectorAll('*').forEach(el => { if (el.shadowRoot) gather(el.shadowRoot, out, depth + 1); });
  }

  function clearBoxes() { layer.textContent = ''; state.boxes = []; }

  function place() {
    state.rafPending = false;
    state.boxes.forEach((b, n) => {
      const el = state.marks[n];
      if (!el || !el.isConnected) { b.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      const off = r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth;
      b.style.display = off ? 'none' : 'block';
      b.style.left = r.left + 'px'; b.style.top = r.top + 'px';
      b.style.width = r.width + 'px'; b.style.height = r.height + 'px';
    });
  }
  function schedule() { if (!state.rafPending) { state.rafPending = true; requestAnimationFrame(place); } }
  addEventListener('scroll', schedule, true);
  addEventListener('resize', schedule);

  const api = {
    collect(max) {
      clearBoxes();
      const raw = [];
      gather(document, raw, 0);
      const seen = new Set();
      const picked = [];
      for (const el of raw) {
        if (seen.has(el) || el === host) continue;
        seen.add(el);
        const generic = !el.matches(NATIVE);
        if (generic && el.querySelector(NATIVE)) continue;
        if (!visible(el)) continue;
        picked.push(el);
        if (picked.length >= max) break;
      }
      state.marks = picked;
      const descriptors = picked.map((el, n) => {
        const box = document.createElement('div');
        box.className = 'mark';
        box.style.borderColor = COLORS[n % COLORS.length];
        box.style.background = COLORS[n % COLORS.length] + '1f';
        const tagEl = document.createElement('span');
        tagEl.className = 'tag'; tagEl.textContent = String(n + 1);
        tagEl.style.background = COLORS[n % COLORS.length];
        box.appendChild(tagEl); layer.appendChild(box); state.boxes.push(box);
        return describe(el, n + 1);
      });
      place();
      const doc = document.documentElement;
      return { marks: descriptors, viewport: { w: innerWidth, h: innerHeight, scrollX: scrollX, scrollY: scrollY, docH: Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0) } };
    },
    outline() {
      const headings = Array.from(document.querySelectorAll('h1,h2,h3')).filter(h => h.offsetParent !== null).slice(0, 12).map(h => h.tagName.toLowerCase() + ': ' + clean(h.innerText, 100));
      const text = clean(document.body ? document.body.innerText : '', 3000);
      return { url: location.href, title: document.title, headings, text };
    },
    pick(index) {
      const el = state.marks[index - 1];
      if (!el || !el.isConnected) return { error: 'stale' };
      return { el };
    },
    prepare(index) {
      const el = state.marks[index - 1];
      if (!el || !el.isConnected) return { error: 'That element number is no longer valid. Call browser_get_dom to refresh the numbered elements.' };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      schedule();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, desc: describe(el, index) };
    },
    describeActive() {
      const el = document.activeElement;
      if (!el || el === document.body) return { none: true };
      return { desc: describe(el, 0), inForm: !!(el.form || el.closest('form')) };
    },
    selectOption(index, wanted) {
      const el = state.marks[index - 1];
      if (!el || !el.isConnected) return { error: 'That element number is no longer valid. Call browser_get_dom to refresh the numbered elements.' };
      if (el.tagName.toLowerCase() !== 'select') return { error: 'That element is not a drop-down list.' };
      const w = String(wanted).trim().toLowerCase();
      let found = -1;
      for (let n = 0; n < el.options.length; n++) {
        const o = el.options[n];
        if (o.value.toLowerCase() === w || o.text.trim().toLowerCase() === w) { found = n; break; }
      }
      if (found < 0) for (let n = 0; n < el.options.length; n++) if (el.options[n].text.toLowerCase().includes(w)) { found = n; break; }
      if (found < 0) return { error: 'No option matched. Options: ' + Array.from(el.options).slice(0, 25).map(o => clean(o.text, 40)).join(' | ') };
      el.selectedIndex = found;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { chosen: clean(el.options[found].text, 60) };
    },
    readText(selector, index) {
      let el = null;
      if (index) { const p = state.marks[index - 1]; el = p && p.isConnected ? p : null; }
      else if (selector) { try { el = document.querySelector(selector); } catch (e) { return { error: 'Invalid CSS selector.' }; } }
      else el = document.body;
      if (!el) return { error: 'No element matched.' };
      return { text: (el.innerText || el.textContent || '').trim() };
    },
    scroll(direction, amount) {
      const doc = document.documentElement;
      const max = Math.max(0, Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0) - innerHeight);
      if (direction === 'top') scrollTo({ top: 0 });
      else if (direction === 'bottom') scrollTo({ top: max });
      else scrollBy({ top: (direction === 'up' ? -1 : 1) * amount });
      schedule();
      return { y: Math.round(scrollY), max: Math.round(max) };
    },
    cursorTo(x, y) { cursor.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; cursor.classList.add('on'); },
    ripple(x, y) {
      const r = document.createElement('div');
      r.className = 'ripple'; r.style.left = x + 'px'; r.style.top = y + 'px';
      root.appendChild(r); setTimeout(() => r.remove(), 700);
    },
    setActive(on, label) {
      state.active = !!on;
      glow.classList.toggle('on', !!on); pill.classList.toggle('on', !!on);
      if (label) pill.textContent = label;
      if (!on) cursor.classList.remove('on');
    },
    chrome(show) { glow.style.visibility = show ? 'visible' : 'hidden'; pill.style.visibility = show ? 'visible' : 'hidden'; },
    clearMarks() { clearBoxes(); state.marks = []; },
    redraw() { place(); },
    hasMarks() { return state.marks.length > 0; }
  };
  Object.defineProperty(window, '__larAgent', { value: api, configurable: true });
}

const LIB_SOURCE = `(${pageLibrary.toString()})();`;

/* ------------------------------------------------------------------ service */

function createBrowserService({ app, dialog, session, WebContentsView, getMainWindow, options = {} }) {
  const tabs = new Map();
  let order = [];
  let activeId = null;
  let attachedId = null;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  let visible = false;
  let agentActive = false;
  let agentTimer = null;
  let tabCounter = 0;
  let sessionConfigured = false;
  let stateTimer = null;
  let queue = Promise.resolve();
  const approvedOrigins = new Set();
  const settings = { askNewSites: options.askNewSites !== false };

  /* ---------- plumbing ---------- */
  const window_ = () => { const w = getMainWindow(); return w && !w.isDestroyed() ? w : null; };
  const send = (channel, payload) => { const w = window_(); if (w && !w.webContents.isDestroyed()) w.webContents.send(channel, payload); };
  const activity = text => send('browser:activity', { at: Date.now(), text: String(text).slice(0, 240) });
  const enqueue = fn => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function ensureSession() {
    const ses = session.fromPartition(PARTITION);
    if (!sessionConfigured) {
      sessionConfigured = true;
      ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      ses.setPermissionCheckHandler(() => false);
      if (typeof ses.setDevicePermissionHandler === 'function') ses.setDevicePermissionHandler(() => false);
      ses.on('will-download', (event, item) => { event.preventDefault(); try { item.cancel(); } catch (_) { /* already cancelled */ } activity('A download was blocked.'); });
      try {
        ses.setUserAgent(ses.getUserAgent().replace(/\sElectron\/[\d.]+/i, '').replace(/\s(?:Local-?AI-?Runner|local-ai-runner)\/[\d.]+/i, ''));
      } catch (_) { /* keep default user agent */ }
    }
    return ses;
  }

  function snapshot() {
    const t = activeId && tabs.get(activeId);
    const wc = t && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
    const history = wc && wc.navigationHistory;
    return {
      tabs: order.map(id => {
        const tab = tabs.get(id); const w = tab.view.webContents;
        return { id, title: w.isDestroyed() ? '' : (w.getTitle() || 'New tab'), url: w.isDestroyed() ? '' : w.getURL(), loading: !w.isDestroyed() && w.isLoading(), active: id === activeId };
      }),
      activeId,
      canGoBack: !!(history && history.canGoBack()),
      canGoForward: !!(history && history.canGoForward()),
      agentActive, visible, askNewSites: settings.askNewSites
    };
  }
  function emitState() {
    if (stateTimer) return;
    stateTimer = setTimeout(() => { stateTimer = null; send('browser:state', snapshot()); }, 40);
  }

  function applyAttachment() {
    const w = window_();
    if (!w) return;
    const tab = activeId && tabs.get(activeId);
    const shouldShow = !!tab && visible && bounds.width > 8 && bounds.height > 8;
    if (attachedId && (attachedId !== activeId || !shouldShow)) {
      const old = tabs.get(attachedId);
      if (old) { try { w.contentView.removeChildView(old.view); } catch (_) { /* not attached */ } }
      attachedId = null;
    }
    if (shouldShow) {
      if (attachedId !== activeId) { w.contentView.addChildView(tab.view); attachedId = activeId; }
      tab.view.setBounds(bounds);
    }
  }

  /* ---------- tabs ---------- */
  function needsApproval(v) {
    if (v.blank || approvedOrigins.has(v.origin)) return false;
    if (v.isPrivate) return true;
    return agentActive && settings.askNewSites;
  }

  async function approveOrigin(v) {
    const w = window_();
    if (!w) return false;
    const answer = await dialog.showMessageBox(w, {
      type: v.isPrivate ? 'warning' : 'question', buttons: ['Allow for this session', 'Block'], cancelId: 1, defaultId: 1, noLink: true,
      title: 'Allow the AI to open this site?',
      message: `Allow the AI to open ${v.origin}?`,
      detail: v.isPrivate
        ? 'This address is on your own computer or local network. Pages there may expose private services. Only allow it if you expect it.'
        : 'The assistant wants to visit a site it has not visited in this session. Page content is treated as untrusted data.'
    });
    if (answer.response !== 0) return false;
    approvedOrigins.add(v.origin);
    return true;
  }

  async function approveAction({ title, message, detail }) {
    const w = window_();
    if (!w) return false;
    const answer = await dialog.showMessageBox(w, {
      type: 'question', buttons: ['Allow', 'Decline'], cancelId: 1, defaultId: 1, noLink: true,
      title, message, detail
    });
    return answer.response === 0;
  }

  function guardNavigation(tabId, event, url) {
    let v;
    try { v = validateNavigationUrl(url); } catch (_) { event.preventDefault(); activity('A navigation to an unsupported address was blocked.'); return; }
    if (!needsApproval(v)) return;
    event.preventDefault();
    approveOrigin(v).then(ok => {
      const tab = tabs.get(tabId);
      if (ok && tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.loadURL(v.url).catch(() => {});
      else if (!ok) activity(`Blocked navigation to ${v.origin}.`);
    }).catch(() => {});
  }

  function createTab() {
    if (tabs.size >= MAX_TABS) throw new Error(`The browser tab limit (${MAX_TABS}) was reached. Close a tab first.`);
    const view = new WebContentsView({ webPreferences: { session: ensureSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false } });
    try { view.setBackgroundColor('#ffffff'); } catch (_) { /* optional */ }
    const id = `t${++tabCounter}`;
    const wc = view.webContents;
    tabs.set(id, { id, view });
    order.push(id);
    wc.setWindowOpenHandler(({ url }) => {
      try {
        const v = validateNavigationUrl(url);
        if (!v.blank && !needsApproval(v)) { enqueueOpen(v); }
        else if (!v.blank) approveOrigin(v).then(ok => { if (ok) enqueueOpen(v); }).catch(() => {});
      } catch (_) { /* unsupported */ }
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => guardNavigation(id, event, url));
    wc.on('will-redirect', (event, url) => guardNavigation(id, event, url));
    for (const name of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page']) wc.on(name, emitState);
    wc.on('dom-ready', () => { if (agentActive && id === activeId) injectActive(wc, true); });
    wc.on('render-process-gone', () => { activity('A browser tab stopped unexpectedly.'); emitState(); });
    return id;
  }

  function enqueueOpen(v) {
    try { const id = createTab(); activate(id); tabs.get(id).view.webContents.loadURL(v.url).catch(() => {}); } catch (error) { activity(error.message); }
  }

  function activate(id) {
    if (!tabs.has(id)) throw new Error('That tab does not exist.');
    activeId = id;
    applyAttachment();
    emitState();
  }

  function destroyTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    const w = window_();
    if (w && attachedId === id) { try { w.contentView.removeChildView(tab.view); } catch (_) { /* detached */ } attachedId = null; }
    tabs.delete(id);
    order = order.filter(x => x !== id);
    try { if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close(); } catch (_) { /* gone */ }
    if (activeId === id) activeId = order.length ? order[order.length - 1] : null;
    applyAttachment();
    emitState();
  }

  function activeWc() {
    if (!activeId || !tabs.has(activeId)) { const id = createTab(); activate(id); }
    const wc = tabs.get(activeId).view.webContents;
    if (wc.isDestroyed()) throw new Error('The active tab is no longer available.');
    return wc;
  }

  /* ---------- page helpers ---------- */
  async function page(wc, expression) {
    return wc.executeJavaScript(`${LIB_SOURCE}\nwindow.__larAgent.${expression}`, true);
  }
  async function injectActive(wc, on) {
    try { await page(wc, `setActive(${on ? 'true' : 'false'}, ${JSON.stringify('AI is working in this tab')})`); } catch (_) { /* page may be navigating */ }
  }

  async function ensureVisible() {
    if (visible && bounds.width > 8 && bounds.height > 8) return;
    send('browser:reveal', { at: Date.now() });
    for (let waited = 0; waited < 3000; waited += 100) {
      await sleep(100);
      if (visible && bounds.width > 8 && bounds.height > 8) return;
    }
    throw new Error('The browser panel is hidden. Open the Browser view or the chat browser dock so the AI can work where you can see it.');
  }

  function waitForLoad(wc, timeout = NAV_TIMEOUT_MS) {
    return new Promise(resolve => {
      if (wc.isDestroyed()) return resolve();
      if (!wc.isLoading()) return setTimeout(resolve, SETTLE_MS);
      let done = false;
      const finish = () => {
        if (done) return; done = true; clearTimeout(timer);
        if (!wc.isDestroyed()) wc.removeListener('did-stop-loading', finish);
        setTimeout(resolve, SETTLE_MS);
      };
      const timer = setTimeout(() => { if (!wc.isDestroyed() && wc.isLoading()) { try { wc.stop(); } catch (_) { /* ignore */ } } finish(); }, timeout);
      wc.on('did-stop-loading', finish);
    });
  }

  async function afterAction(wc) {
    await sleep(250);
    // A click may have opened a popup tab; follow it so the agent sees what the user sees.
    const target = activeId && tabs.get(activeId) ? tabs.get(activeId).view.webContents : wc;
    await waitForLoad(target);
    return target;
  }

  function pageInfo(wc) { return { url: wc.getURL(), title: wc.getTitle() }; }

  async function moveCursor(wc, x, y) {
    try { await page(wc, `cursorTo(${x},${y})`); } catch (_) { /* cosmetic */ }
    await sleep(520);
  }

  function sendClick(wc, x, y) {
    const ix = Math.round(x); const iy = Math.round(y);
    wc.focus();
    wc.sendInputEvent({ type: 'mouseMove', x: ix, y: iy });
    wc.sendInputEvent({ type: 'mouseDown', x: ix, y: iy, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: ix, y: iy, button: 'left', clickCount: 1 });
    page(wc, `ripple(${ix},${iy})`).catch(() => {});
  }

  const KEY_MAP = { enter: 'Return', return: 'Return', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', space: 'Space' };
  function sendKey(wc, key) {
    const code = KEY_MAP[String(key).toLowerCase()];
    if (!code) throw new Error(`Unsupported key “${key}”. Use one of: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space.`);
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: code });
    if (code === 'Return') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    if (code === 'Space') wc.sendInputEvent({ type: 'char', keyCode: ' ' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: code });
    return code;
  }

  const intArg = (value, name) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_MARKS) throw new Error(`${name} must be an element number from browser_get_dom (1–${MAX_MARKS}).`);
    return n;
  };

  async function prepareElement(wc, index) {
    const info = await page(wc, `prepare(${index})`);
    if (info.error) throw new Error(info.error);
    return info;
  }

  /* ---------- agent tools ---------- */
  const tools = {
    async navigate(args) {
      const v = validateNavigationUrl(args.url);
      if (needsApproval(v) && !(await approveOrigin(v))) throw new Error(`The user did not allow access to ${v.origin}. Choose another source or ask the user.`);
      await ensureVisible();
      const wc = activeWc();
      activity(`Opening ${v.url}`);
      try {
        await Promise.race([wc.loadURL(v.url), sleep(NAV_TIMEOUT_MS).then(() => { try { wc.stop(); } catch (_) { /* ignore */ } })]);
      } catch (error) {
        if (!(error && (error.code === 'ERR_ABORTED' || error.errno === -3))) throw new Error(`Could not load the page: ${error.message}`);
      }
      await waitForLoad(wc);
      return { ...pageInfo(wc), loaded: !wc.isLoading() };
    },

    async click(args) {
      await ensureVisible();
      const wc = activeWc();
      const index = intArg(args.index, 'index');
      const info = await prepareElement(wc, index);
      await moveCursor(wc, info.x, info.y);
      const risk = classifyClickRisk(info.desc);
      if (risk.risky) {
        const ok = await approveAction({
          title: 'Approve this click?', message: `Click “${info.desc.label || info.desc.tag}”?`,
          detail: `This ${risk.reason}.\nPage: ${wc.getURL()}\n\nThe assistant should not act on your behalf for sensitive steps unless you approve each one.`
        });
        if (!ok) throw new Error('The user declined this click. Do not retry it; explain what you need or ask the user.');
      }
      activity(`Click [${index}] ${info.desc.label || info.desc.tag}`);
      sendClick(wc, info.x, info.y);
      const target = await afterAction(wc);
      return { clicked: info.desc.label || info.desc.tag, ...pageInfo(target), tabs: order.length };
    },

    async type(args) {
      await ensureVisible();
      const wc = activeWc();
      const index = intArg(args.index, 'index');
      const text = String(args.text == null ? '' : args.text);
      if (text.length > MAX_TYPE_CHARS) throw new Error(`Text is limited to ${MAX_TYPE_CHARS} characters per call.`);
      const info = await prepareElement(wc, index);
      if (isSensitiveField(info.desc)) throw new Error('This looks like a password, payment or one-time-code field. The assistant must not fill it. Tell the user to enter it themselves in the browser, then continue.');
      if (!info.desc.editable) throw new Error('That element is not a text field. Use browser_click for buttons, links and checkboxes, or browser_select for drop-down lists.');
      await moveCursor(wc, info.x, info.y);
      sendClick(wc, info.x, info.y);
      await sleep(120);
      if (args.clear !== false) { wc.selectAll(); if (!text) { sendKey(wc, 'Backspace'); } }
      if (text) wc.insertText(text);
      await sleep(120);
      activity(`Typed into [${index}] ${info.desc.label || info.desc.tag}`);
      if (args.submit === true) {
        if (info.desc.inForm) {
          const ok = await approveAction({ title: 'Approve form submission?', message: 'Press Enter to submit this form?', detail: `Page: ${wc.getURL()}\nField: ${info.desc.label || info.desc.name || info.desc.tag}` });
          if (!ok) throw new Error('The user declined to submit the form. The text was typed but not submitted.');
        }
        sendKey(wc, 'Enter');
        const target = await afterAction(wc);
        return { typed: text.length, submitted: true, ...pageInfo(target) };
      }
      const after = await page(wc, `describeActive()`);
      return { typed: text.length, fieldValue: after && after.desc ? truncate(after.desc.value, 60) : '', ...pageInfo(wc) };
    },

    async select(args) {
      await ensureVisible();
      const wc = activeWc();
      const index = intArg(args.index, 'index');
      const info = await prepareElement(wc, index);
      await moveCursor(wc, info.x, info.y);
      const result = await page(wc, `selectOption(${index}, ${JSON.stringify(String(args.value == null ? '' : args.value).slice(0, 200))})`);
      if (result.error) throw new Error(result.error);
      activity(`Selected “${result.chosen}” in [${index}]`);
      return { selected: result.chosen };
    },

    async press_key(args) {
      await ensureVisible();
      const wc = activeWc();
      const key = String(args.key || '');
      if (/^enter|return$/i.test(key)) {
        const active = await page(wc, 'describeActive()');
        if (active && active.desc && active.inForm) {
          const ok = await approveAction({ title: 'Approve pressing Enter?', message: 'Press Enter inside a form?', detail: `This may submit the form.\nPage: ${wc.getURL()}` });
          if (!ok) throw new Error('The user declined. Do not retry; ask the user how to continue.');
        }
      }
      sendKey(wc, key);
      activity(`Pressed ${key}`);
      const target = await afterAction(wc);
      return { pressed: key, ...pageInfo(target) };
    },

    async scroll(args) {
      await ensureVisible();
      const wc = activeWc();
      const direction = ['up', 'down', 'top', 'bottom'].includes(args.direction) ? args.direction : 'down';
      const amount = Math.min(Math.max(Number(args.amount) || 600, 50), 5000);
      const result = await page(wc, `scroll(${JSON.stringify(direction)}, ${amount})`);
      await sleep(250);
      return { scrolledTo: result.y, maxScroll: result.max, note: 'Call browser_get_dom to number the elements now in view.' };
    },

    async get_dom() {
      await ensureVisible();
      const wc = activeWc();
      const data = await page(wc, `collect(${MAX_MARKS})`);
      const outline = await page(wc, 'outline()');
      const report = { url: outline.url, title: outline.title, viewport: data.viewport, marks: data.marks, headings: outline.headings, text: outline.text };
      const sparse = data.marks.length === 0 && outline.text.length < 40;
      return { text: truncate(formatDomReport(report), MAX_TEXT), markCount: data.marks.length, suggestVision: sparse, ...pageInfo(wc) };
    },

    async get_text(args) {
      await ensureVisible();
      const wc = activeWc();
      const selector = args.selector ? String(args.selector).slice(0, 300) : '';
      const index = args.index ? intArg(args.index, 'index') : 0;
      const result = await page(wc, `readText(${JSON.stringify(selector)}, ${index})`);
      if (result.error) throw new Error(result.error);
      return { text: truncate(result.text, MAX_TEXT), ...pageInfo(wc) };
    },

    async screenshot(args) {
      await ensureVisible();
      const wc = activeWc();
      let markList = '';
      if (args.marks !== false) {
        const data = await page(wc, `collect(${MAX_MARKS})`);
        markList = formatMarksList(data.marks);
      } else { await page(wc, 'redraw()'); }
      await page(wc, 'chrome(false)');
      await sleep(80);
      let image;
      try { image = await wc.capturePage(); } finally { await page(wc, 'chrome(true)').catch(() => {}); }
      if (!image || image.isEmpty()) throw new Error('The browser did not produce an image. Make sure the browser panel is visible.');
      let size = image.getSize();
      let scaled = size.width > SCREENSHOT_MAX_WIDTH ? image.resize({ width: SCREENSHOT_MAX_WIDTH }) : image;
      let jpeg = scaled.toJPEG(72);
      if (jpeg.length > SCREENSHOT_MAX_BYTES) { scaled = image.resize({ width: 900 }); jpeg = scaled.toJPEG(60); }
      size = scaled.getSize();
      return { dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`, width: size.width, height: size.height, marks: truncate(markList, 6000), ...pageInfo(wc) };
    },

    async execute_js(args) {
      await ensureVisible();
      const wc = activeWc();
      const code = String(args.code || '');
      if (!code.trim()) throw new Error('JavaScript code is required.');
      if (code.length > MAX_JS_CHARS) throw new Error(`Code is limited to ${MAX_JS_CHARS} characters.`);
      const ok = await approveAction({ title: 'Approve JavaScript?', message: 'Run this JavaScript in the current page?', detail: `Page: ${wc.getURL()}\n\n${truncate(code, 1500)}` });
      if (!ok) throw new Error('The user declined to run this JavaScript.');
      activity('Ran JavaScript in the page');
      const result = await Promise.race([
        wc.executeJavaScript(code, true),
        sleep(10_000).then(() => { throw new Error('The script took longer than 10 seconds.'); })
      ]);
      let text;
      try { text = typeof result === 'string' ? result : JSON.stringify(result === undefined ? null : result); } catch (_) { text = String(result); }
      return { result: truncate(text, 8000) };
    },

    async new_tab(args) {
      await ensureVisible();
      const id = createTab();
      activate(id);
      if (args && args.url) return { tabIndex: order.indexOf(id) + 1, ...(await tools.navigate({ url: args.url })) };
      return { tabIndex: order.indexOf(id) + 1 };
    },

    async close_tab(args) {
      const index = Number(args.index);
      if (!Number.isInteger(index) || index < 1 || index > order.length) throw new Error(`Tab number must be between 1 and ${order.length}.`);
      destroyTab(order[index - 1]);
      return { remaining: order.length };
    },

    async switch_tab(args) {
      const index = Number(args.index);
      if (!Number.isInteger(index) || index < 1 || index > order.length) throw new Error(`Tab number must be between 1 and ${order.length}.`);
      activate(order[index - 1]);
      return pageInfo(activeWc());
    },

    async list_tabs() {
      return { tabs: snapshot().tabs.map((t, n) => ({ index: n + 1, title: t.title, url: t.url, active: t.active })) };
    },

    async wait(args) {
      const ms = Math.min(Math.max(Number(args.ms) || 1000, 100), 5000);
      await sleep(ms);
      const wc = activeWc();
      await waitForLoad(wc, 5000);
      return pageInfo(wc);
    }
  };

  /* ---------- public API ---------- */
  return {
    setBounds(rect) {
      const w = window_();
      const content = w ? w.getContentBounds() : { width: 16384, height: 16384 };
      bounds = normalizeBounds(rect, content);
      applyAttachment();
      return true;
    },
    setVisible(value) { visible = !!value; applyAttachment(); emitState(); return true; },
    setAskNewSites(value) { settings.askNewSites = !!value; emitState(); return true; },
    setAgentActive(value) {
      agentActive = !!value;
      clearTimeout(agentTimer);
      if (agentActive) agentTimer = setTimeout(() => { agentActive = false; emitState(); }, AGENT_ACTIVE_LIMIT_MS);
      const t = activeId && tabs.get(activeId);
      if (t && !t.view.webContents.isDestroyed()) injectActive(t.view.webContents, agentActive);
      emitState();
      return true;
    },
    getState() { return snapshot(); },

    async userNavigate(input) {
      const v = validateNavigationUrl(input);
      approvedOrigins.add(v.origin);
      const wc = activeWc();
      try { await wc.loadURL(v.url); } catch (error) { if (!(error && (error.code === 'ERR_ABORTED' || error.errno === -3))) throw new Error(`Could not load the page: ${error.message}`); }
      emitState();
      return pageInfo(wc);
    },
    userAction(name) {
      const wc = activeWc();
      const history = wc.navigationHistory;
      if (name === 'back' && history.canGoBack()) history.goBack();
      else if (name === 'forward' && history.canGoForward()) history.goForward();
      else if (name === 'reload') wc.reload();
      else if (name === 'stop') wc.stop();
      emitState();
      return true;
    },
    userTab(op, payload) {
      if (op === 'new') { const id = createTab(); activate(id); return { id }; }
      if (op === 'close') { if (!tabs.has(String(payload))) throw new Error('That tab does not exist.'); destroyTab(String(payload)); return true; }
      if (op === 'switch') { activate(String(payload)); return true; }
      throw new Error('Unknown tab operation.');
    },
    async clearData() {
      const ses = ensureSession();
      await ses.clearStorageData();
      await ses.clearCache();
      approvedOrigins.clear();
      return true;
    },

    runTool(name, args) {
      if (!Object.prototype.hasOwnProperty.call(tools, name)) return Promise.reject(new Error(`Unknown browser tool “${name}”.`));
      const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
      return enqueue(() => tools[name](safeArgs));
    },

    shutdown() {
      clearTimeout(agentTimer); clearTimeout(stateTimer);
      for (const id of [...order]) destroyTab(id);
      attachedId = null; activeId = null; visible = false;
    }
  };
}

module.exports = {
  createBrowserService,
  validateNavigationUrl, isPrivateHost, classifyClickRisk, isSensitiveField,
  normalizeBounds, formatMarksList, formatDomReport, truncate,
  PARTITION, LIB_SOURCE
};
