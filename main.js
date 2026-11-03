'use strict';

const { app, BrowserWindow, WebContentsView, desktopCapturer, dialog, ipcMain, session, shell, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { extractDocument } = require('./services/document-service');
const { createWorkspaceService } = require('./services/workspace-service');
const { createMcpService } = require('./services/mcp-service');
const { createBrowserService } = require('./services/browser-service');
const { atomicWriteFile } = require('./services/atomic-file');
const { createToolRegistry } = require('./services/tool-registry');

// Preserve the user-data directory created by the original repository package.
// This keeps existing IndexedDB chats, credentials, workspace selection and MCP settings.
const LEGACY_USER_DATA_DIRECTORY = 'miniature-quartz-consult-jo9xi';
try {
  app.setPath('userData', path.join(app.getPath('appData'), LEGACY_USER_DATA_DIRECTORY));
} catch (error) {
  console.warn('Could not preserve the legacy user-data directory:', error);
}

let mainWindow = null;
let workspace = null;
let connectors = null;
let browser = null;
let toolRegistry = null;
const activeStreams = new Map();
const approvedModelOrigins = new Set();
const editorWindows = new Set();
let editorSharedState = { tabs: [], active: '', origin: '' };
const EDITOR_PREFERENCE_DEFAULTS = Object.freeze({
  theme: 'midnight', fontFamily: 'cascadia', fontSize: 13, lineHeight: 1.6,
  tabSize: 2, lineNumbers: true, background: '#0e131c', panel: '#151b26',
  text: '#d5dbea', accent: '#91a8ef', keyword: '#c792ea', string: '#a5d6a7',
  number: '#f2c879', comment: '#78869d'
});
let editorPreferences = { ...EDITOR_PREFERENCE_DEFAULTS };
const editorPreferencesPath = path.join(app.getPath('userData'), 'editor-preferences.json');
function normalizeEditorPreferences(input = {}) {
  const next = { ...editorPreferences };
  const themes = ['midnight','graphite','light','ocean','forest','custom'];
  const fonts = ['cascadia','consolas','system','fira','jetbrains'];
  if (themes.includes(input.theme)) next.theme = input.theme;
  if (fonts.includes(input.fontFamily)) next.fontFamily = input.fontFamily;
  if ([2,4,8].includes(Number(input.tabSize))) next.tabSize = Number(input.tabSize);
  if (typeof input.lineNumbers === 'boolean') next.lineNumbers = input.lineNumbers;
  if (Number.isFinite(Number(input.fontSize))) next.fontSize = Math.max(11, Math.min(22, Number(input.fontSize)));
  if (Number.isFinite(Number(input.lineHeight))) next.lineHeight = Math.max(1.2, Math.min(2.2, Number(input.lineHeight)));
  for (const key of ['background','panel','text','accent','keyword','string','number','comment']) {
    if (typeof input[key] === 'string' && /^#[0-9a-f]{6}$/i.test(input[key])) next[key] = input[key];
  }
  return next;
}
function trustedEditorTargets(exceptId = null) {
  const targets = [];
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id !== exceptId) targets.push(mainWindow.webContents);
  for (const win of BrowserWindow.getAllWindows()) {
    if (editorWindows.has(win.webContents.id) && !win.isDestroyed() && win.webContents.id !== exceptId) targets.push(win.webContents);
  }
  return targets;
}
function configureEditorBridge() {
  ipcMain.handle('editor:sync:get', event => {
    assertTrustedRenderer(event);
    return { ...editorSharedState, preferences: { ...editorPreferences } };
  });
  ipcMain.on('editor:sync:set', (event, payload) => {
    try {
      assertTrustedRenderer(event);
      if (!payload || !Array.isArray(payload.tabs) || payload.tabs.length > 40) throw new Error('Invalid editor synchronization state.');
      let totalBytes = 0;
      const tabs = payload.tabs.map(tab => {
        if (!tab || typeof tab.path !== 'string' || tab.path.length > 500 || tab.path.startsWith('/') || tab.path.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('Invalid editor tab path.');
        if (typeof tab.content !== 'string' || Buffer.byteLength(tab.content, 'utf8') > 1_500_000) throw new Error('An editor tab exceeds the supported file size.');
        totalBytes += Buffer.byteLength(tab.content, 'utf8');
        if (totalBytes > 6_000_000) throw new Error('The combined editor tabs exceed the synchronization limit.');
        return { path: tab.path, content: tab.content, dirty: !!tab.dirty };
      });
      const active = typeof payload.active === 'string' && tabs.some(tab => tab.path === payload.active) ? payload.active : '';
      const origin = typeof payload.origin === 'string' ? payload.origin.slice(0, 80) : '';
      editorSharedState = { tabs, active, origin };
      for (const target of trustedEditorTargets(event.sender.id)) target.send('editor:sync:update', { ...editorSharedState, preferences: { ...editorPreferences } });
    } catch (error) {
      console.warn('Rejected editor synchronization update:', error.message);
    }
  });
  ipcMain.handle('editor:preferences:get', event => {
    assertTrustedRenderer(event);
    return { ...editorPreferences };
  });
  ipcMain.handle('editor:preferences:set', async (event, value) => {
    assertTrustedRenderer(event);
    editorPreferences = normalizeEditorPreferences(value || {});
    await fs.mkdir(path.dirname(editorPreferencesPath), { recursive: true });
    await atomicWriteFile(editorPreferencesPath, JSON.stringify(editorPreferences, null, 2), { mode: 0o600 });
    for (const target of trustedEditorTargets()) target.send('editor:preferences:update', { ...editorPreferences });
    return { ...editorPreferences };
  });
  try {
    const saved = JSON.parse(await fs.readFile(editorPreferencesPath, 'utf8'));
    editorPreferences = normalizeEditorPreferences(saved);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not load editor preferences:', error.message);
  }
}

function isLocalHost(hostname) {
  return ['localhost','127.0.0.1','::1'].includes(String(hostname).replace(/^\[|\]$/g,''));
}
function assertTrustedRenderer(event) {
  const sender = event.sender;
  const isMain = !!mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents;
  const isEditor = editorWindows.has(sender.id) && !sender.isDestroyed();
  const frame = event.senderFrame;
  const frameUrl = frame?.url || '';
  const expectedPage = isMain ? '/index.html' : '/editor.html';
  if ((!isMain && !isEditor) || !frame || frame !== sender.mainFrame || !frameUrl.startsWith('file://') || !frameUrl.endsWith(expectedPage)) throw new Error('Request rejected: untrusted renderer.');
}
function normalizeModelRequest(options) {
  if (!options || typeof options !== 'object') throw new Error('Invalid model request.');
  const url = new URL(String(options.url || ''));
  if (url.username || url.password) throw new Error('Do not place credentials in the server URL.');
  if (!['http:','https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS model servers are supported.');
  if (url.search || url.hash) throw new Error('Model server endpoints cannot contain query strings or fragments.');
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) throw new Error('Remote model servers must use HTTPS. HTTP is only allowed for localhost.');
  const allowedPath = /^\/(api\/(tags|show|chat|ps)|v1\/(models|chat\/completions))\/?$/;
  if (!allowedPath.test(url.pathname)) throw new Error('This endpoint is not part of the supported model-server API.');
  const origin = url.origin;
  if (!isLocalHost(url.hostname) && !approvedModelOrigins.has(origin)) throw new Error('This remote model server has not been approved in this session.');
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET','POST'].includes(method)) throw new Error('Unsupported request method.');
  if (options.headers !== undefined && (!options.headers || typeof options.headers !== 'object' || Array.isArray(options.headers))) throw new Error('Invalid model request headers.');
  const headers = {};
  for (const [name,value] of Object.entries(options.headers || {})) {
    const key = name.toLowerCase();
    if (['content-type','authorization','accept'].includes(key) && typeof value === 'string') headers[key] = value.slice(0,4096);
  }
  const body = options.body == null ? undefined : String(options.body);
  if (method === 'GET' && body) throw new Error('GET model requests cannot include a body.');
  if (body && Buffer.byteLength(body,'utf8') > 50 * 1024 * 1024) throw new Error('Model request exceeds the 50 MB safety limit.');
  return { url:url.href, origin, method, headers, body };
}
async function readBoundedResponseText(response, maxBytes, label = 'Response') {
  const announced = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(announced) && announced > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`${label} exceeded the ${Math.round(maxBytes / 1024 / 1024)} MB safety limit.`);
  }
  if (!response.body) {
    if (typeof response.text !== 'function') return '';
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Response exceeded its configured size limit.');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`${label} exceeded the ${Math.round(maxBytes / 1024 / 1024)} MB safety limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

async function approveModelServer(event, baseUrl) {
  assertTrustedRenderer(event);
  const url = new URL(String(baseUrl || ''));
  if (url.username || url.password) throw new Error('Remove credentials from the server URL.');
  if (isLocalHost(url.hostname)) return { approved:true, local:true };
  if (url.protocol !== 'https:') throw new Error('Remote model servers must use HTTPS.');
  const response = await dialog.showMessageBox(mainWindow, {
    type:'warning', buttons:['Allow this server','Cancel'], cancelId:1, defaultId:1,
    title:'Approve remote model server?', message:`Allow Local AI Runner to send prompts to ${url.origin}?`,
    detail:'Your prompts, attached document text, images and API key may be sent to this server. Only approve a server you trust.'
  });
  if (response.response !== 0) return { approved:false };
  approvedModelOrigins.add(url.origin);
  return { approved:true, local:false };
}
async function handleModelRequest(event, options) {
  assertTrustedRenderer(event);
  const request = normalizeModelRequest(options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(request.url, { method:request.method, headers:request.headers, body:request.body, signal:controller.signal, redirect:'error' });
    const body = await readBoundedResponseText(response, 12 * 1024 * 1024, 'Model server response');
    return { ok:response.ok, status:response.status, statusText:response.statusText, body };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Model server request timed out.');
    throw new Error(`Could not contact the model server: ${error.message}`);
  } finally { clearTimeout(timeout); }
}

function configureModelBridge() {
  ipcMain.handle('local-ai:approve-server', approveModelServer);
  ipcMain.handle('local-ai:request', handleModelRequest);
  ipcMain.on('local-ai:stream-start', (event,payload) => {
    try { assertTrustedRenderer(event); } catch (error) {
      if (payload?.id) event.sender.send(`local-ai:stream-result:${payload.id}`, {type:'error',message:error.message});
      return;
    }
    const id = String(payload?.id || '');
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) return;
    let request;
    try { request = normalizeModelRequest(payload.options); }
    catch (error) { event.sender.send(`local-ai:stream-result:${id}`, {type:'error',message:error.message}); return; }
    const key = `${event.sender.id}:${id}`;
    if (activeStreams.has(key)) return;
    const controller = new AbortController(); activeStreams.set(key,controller);
    const sender = event.sender; const channel = `local-ai:stream-result:${id}`;
    (async () => {
      try {
        const response = await fetch(request.url,{method:request.method,headers:request.headers,body:request.body,signal:controller.signal,redirect:'error'});
        if (!response.ok) { const body=await readBoundedResponseText(response, 16 * 1024, 'Model server error response'); sender.send(channel,{type:'http-error',status:response.status,body:body.slice(0,350)}); return; }
        if (!response.body) throw new Error('Model server did not return a stream.');
        const announcedBytes=Number(response.headers?.get?.('content-length'));
        const MAX_STREAM_BYTES=100*1024*1024;
        if(Number.isFinite(announcedBytes)&&announcedBytes>MAX_STREAM_BYTES){await response.body.cancel().catch(()=>{});throw new Error('Model response exceeded the 100 MB streaming safety limit.');}
        const reader=response.body.getReader();let streamedBytes=0;
        try {
          while (true) {
            const {value,done}=await reader.read(); if(done) break;
            if(controller.signal.aborted || sender.isDestroyed()) break;
            streamedBytes+=value.byteLength;
            if(streamedBytes>MAX_STREAM_BYTES){await reader.cancel().catch(()=>{});throw new Error('Model response exceeded the 100 MB streaming safety limit.');}
            sender.send(channel,{type:'chunk',bytes:Array.from(value)});
          }
        } finally { reader.releaseLock?.(); }
        if(!sender.isDestroyed()) sender.send(channel,{type:controller.signal.aborted?'aborted':'done'});
      } catch(error) {
        if(!sender.isDestroyed()) sender.send(channel,{type:controller.signal.aborted?'aborted':'error',message:controller.signal.aborted?'Request cancelled.':error.message});
      } finally { activeStreams.delete(key); }
    })();
  });
  ipcMain.on('local-ai:stream-abort',(event,id)=>{
    try { assertTrustedRenderer(event); } catch (_) { return; }
    activeStreams.get(`${event.sender.id}:${String(id||'')}`)?.abort();
  });
}


function configureCredentials() {
  const filePath = path.join(app.getPath('userData'), 'credentials.json');

  async function storageIsSafeForPersistence() {
    if (typeof safeStorage.isAsyncEncryptionAvailable !== 'function') return false;
    if (!await safeStorage.isAsyncEncryptionAvailable()) return false;
    // On Linux, avoid persisting secrets when Electron reports its weak basic
    // fallback backend. The renderer can still keep a key for this session.
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      if (safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
    }
    return true;
  }

  async function writeEncryptedKey(apiKey) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const encrypted = await safeStorage.encryptStringAsync(apiKey);
    await atomicWriteFile(filePath, JSON.stringify({ apiKey: encrypted.toString('base64') }), { mode: 0o600 });
  }

  ipcMain.handle('credentials:get-api-key', async event => {
    assertTrustedRenderer(event);
    try {
      if (!await storageIsSafeForPersistence()) return '';
      const stat = await fs.lstat(filePath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 64 * 1024) return '';
      const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (typeof stored.apiKey !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(stored.apiKey)) return '';
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(stored.apiKey, 'base64'));
      if (decrypted.shouldReEncrypt && decrypted.result) await writeEncryptedKey(decrypted.result);
      return typeof decrypted.result === 'string' ? decrypted.result : '';
    } catch (_) {
      return '';
    }
  });

  ipcMain.handle('credentials:set-api-key', async (event, value) => {
    assertTrustedRenderer(event);
    if (value !== undefined && value !== null && typeof value !== 'string') throw new Error('API key must be text.');
    if (typeof value === 'string' && value.length > 4096) throw new Error('API key exceeds the 4096 character limit.');
    const apiKey = String(value || '');
    if (!apiKey) {
      await fs.unlink(filePath).catch(() => {});
      return { stored: true, cleared: true };
    }
    if (!await storageIsSafeForPersistence()) {
      return { stored: false, reason: 'OS-backed encryption is unavailable; the key will remain only in memory.' };
    }
    await writeEncryptedKey(apiKey);
    return { stored: true };
  });
}

let hasPerformanceBaseline = false;
function configureSystemMetrics() {
  ipcMain.handle('system:metrics', event => {
    assertTrustedRenderer(event);
    const system = process.getSystemMemoryInfo();
    const rawMetrics = app.getAppMetrics();
    const processes = rawMetrics.map(metric => ({
      pid: metric.pid,
      type: metric.type,
      name: metric.name || metric.serviceName || metric.type,
      cpuPercent: hasPerformanceBaseline && Number.isFinite(metric.cpu?.percentCPUUsage)
        ? metric.cpu.percentCPUUsage : null,
      workingSetKB: Number.isFinite(metric.memory?.workingSetSize) ? metric.memory.workingSetSize : null,
      peakWorkingSetKB: Number.isFinite(metric.memory?.peakWorkingSetSize) ? metric.memory.peakWorkingSetSize : null,
      privateBytesKB: Number.isFinite(metric.memory?.privateBytes) ? metric.memory.privateBytes : null
    }));
    hasPerformanceBaseline = true;
    return {
      sampledAt: Date.now(),
      cpuIntervalNote: 'CPU values are averages since the previous refresh. The first sample establishes a baseline.',
      systemMemoryKB: {
        total: Number.isFinite(system.total) ? system.total : null,
        free: Number.isFinite(system.free) ? system.free : null,
        available: Number.isFinite(system.available) ? system.available : null,
        swapTotal: Number.isFinite(system.swapTotal) ? system.swapTotal : null,
        swapFree: Number.isFinite(system.swapFree) ? system.swapFree : null
      },
      processes
    };
  });
}

function configureDocuments() {
  ipcMain.handle('documents:extract', async (event,payload) => {
    assertTrustedRenderer(event);
    return extractDocument(payload || {});
  });
}
function configureWorkspace() {
  workspace = createWorkspaceService({ dialog, app });
  ipcMain.handle('workspace:choose', async event => { assertTrustedRenderer(event); return workspace.choose(mainWindow); });
  ipcMain.handle('workspace:info', event => { assertTrustedRenderer(event); return workspace.getInfo(); });
  ipcMain.handle('workspace:list', async (event,relativePath) => { assertTrustedRenderer(event); return workspace.list(relativePath); });
  ipcMain.handle('workspace:read', async (event,relativePath) => { assertTrustedRenderer(event); return workspace.read(relativePath); });
  ipcMain.handle('workspace:search', async (event,payload) => { assertTrustedRenderer(event); return workspace.search(payload?.query,payload?.relativePath); });
  ipcMain.handle('workspace:create', async (event,payload) => {
    assertTrustedRenderer(event);
    const relativePath=String(payload?.relativePath||'').slice(0,500);
    const content=String(payload?.content??'');
    const preview=await workspace.previewCreate(relativePath,content);
    const detail=[
      'A new file will be created inside your selected workspace.',
      `File size: ${preview.bytes.toLocaleString()} bytes`,
      '',
      'Content preview:',
      preview.preview || '(Empty file)'
    ].join('\n');
    const answer=await dialog.showMessageBox(mainWindow,{
      type:'question',buttons:['Create file','Cancel'],cancelId:1,defaultId:1,
      title:'Approve generated file?',message:`Create ${relativePath}?`,detail
    });
    if(answer.response!==0) throw new Error('File creation cancelled.');
    return workspace.create(relativePath,content);
  });
  ipcMain.handle('workspace:write', async (event,payload) => {
    assertTrustedRenderer(event);
    const relativePath=String(payload?.relativePath||'').slice(0,500);
    const preview=await workspace.previewWrite(relativePath,payload?.content);
    const detail=[
      preview.exists?'An existing file will be backed up before replacement.':'This will create a new file.',
      `Current size: ${preview.oldBytes.toLocaleString()} bytes · Proposed size: ${preview.newBytes.toLocaleString()} bytes`,
      '',
      'Change preview:',
      preview.diff || '(No textual differences detected.)'
    ].join('\n');
    const answer=await dialog.showMessageBox(mainWindow,{type:'warning',buttons:['Back up and write','Cancel'],cancelId:1,defaultId:1,title:'Review file changes',message:`Approve changes to ${relativePath}?`,detail});
    if(answer.response!==0) throw new Error('File modification cancelled.');
    return workspace.write(relativePath,payload?.content);
  });
  ipcMain.handle('workspace:backups',event=>{assertTrustedRenderer(event);return workspace.backups();});
  ipcMain.handle('workspace:restore',async(event,id)=>{
    assertTrustedRenderer(event);
    const backup=(await workspace.backups()).find(entry=>entry.id===String(id));
    if(!backup)throw new Error('Backup not found.');
    const answer=await dialog.showMessageBox(mainWindow,{type:'warning',buttons:['Restore backup','Cancel'],cancelId:1,defaultId:1,title:'Restore previous file version?',message:`Restore ${backup.relativePath}?`,detail:'The current version will first be backed up, so you can recover it afterward.'});
    if(answer.response!==0)throw new Error('Backup restore cancelled.');
    return workspace.restoreBackup(String(id));
  });
}
function configureToolRegistry() {
  toolRegistry = createToolRegistry({ app });
  ipcMain.handle('tools:register', (event, definitions) => {
    assertTrustedRenderer(event);
    return toolRegistry.register(definitions);
  });
  ipcMain.handle('tools:validate', (event, payload) => {
    assertTrustedRenderer(event);
    if (!payload || typeof payload.name !== 'string') throw new Error('Invalid tool validation request.');
    return toolRegistry.validate(payload.name, payload.args);
  });
  ipcMain.handle('tools:catalog', event => {
    assertTrustedRenderer(event);
    return toolRegistry.list();
  });
  ipcMain.handle('tools:audit', (event, limit) => {
    assertTrustedRenderer(event);
    return toolRegistry.getAudit(limit);
  });
  ipcMain.handle('tools:record', async (event, payload) => {
    assertTrustedRenderer(event);
    return toolRegistry.record(payload);
  });
}

function configureConnectors() {
  connectors=createMcpService({app,dialog});
  ipcMain.handle('connectors:add',async(event,payload)=>{assertTrustedRenderer(event);return connectors.add(mainWindow,payload||{});});
  ipcMain.handle('connectors:list',async event=>{assertTrustedRenderer(event);return connectors.list();});
  ipcMain.handle('connectors:remove',async(event,id)=>{assertTrustedRenderer(event);return connectors.remove(String(id||''));});
  ipcMain.handle('connectors:call',async(event,payload)=>{assertTrustedRenderer(event);return connectors.call(mainWindow,payload||{});});
}

function configureBrowser() {
  browser = createBrowserService({ app, dialog, session, WebContentsView, getMainWindow: () => mainWindow });
  const handle = (channel, handler) => ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedRenderer(event);
    return handler(...args);
  });
  handle('browser:set-bounds', rect => browser.setBounds(rect));
  handle('browser:set-visible', value => browser.setVisible(value));
  handle('browser:set-ask-new-sites', value => browser.setAskNewSites(value));
  handle('browser:set-auto-approve', async (value, ask) => {
    if (value && ask === true) {
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'warning', buttons: ['Turn on auto-approve', 'Cancel'], cancelId: 1, defaultId: 1, noLink: true,
        title: 'Turn on auto-approve?',
        message: 'Let the AI submit forms, click buttons, run page scripts and visit new sites without asking?',
        detail: 'Websites can contain text meant to trick an AI into acting against you. With auto-approve on, nothing stops such an action except the rules that always apply: passwords, payment and one-time-code fields are never filled, and addresses on your own network still ask first. Use it for trusted tasks such as games, and turn it off afterwards.'
      });
      if (answer.response !== 0) return false;
    }
    return browser.setAutoApprove(!!value) && !!value;
  });
  handle('browser:interrupt', () => browser.interrupt());
  handle('browser:set-agent-active', value => browser.setAgentActive(value));
  handle('browser:state', () => browser.getState());
  handle('browser:navigate', url => browser.userNavigate(String(url ?? '').slice(0, 2100)));
  handle('browser:action', name => browser.userAction(String(name ?? '')));
  handle('browser:tab', (op, payload) => browser.userTab(String(op ?? ''), payload));
  handle('browser:clear-data', async () => {
    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'warning', buttons: ['Clear browser data', 'Cancel'], cancelId: 1, defaultId: 1, noLink: true,
      title: 'Clear browser data?', message: 'Clear cookies, sign-ins and cached pages from the integrated browser?',
      detail: 'This only affects the integrated browser. Your chats, files and settings are not changed.'
    });
    if (answer.response !== 0) return false;
    return browser.clearData();
  });
  handle('browser:tool', payload => {
    if (!payload || typeof payload !== 'object' || typeof payload.name !== 'string' || payload.name.length > 40) throw new Error('Invalid browser tool request.');
    const args = payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args) ? payload.args : {};
    if (JSON.stringify(args).length > 20000) throw new Error('Browser tool arguments are too large.');
    return browser.runTool(payload.name, args);
  });
}

function configureScreenCapture() {
  session.defaultSession.setPermissionRequestHandler((webContents,permission,callback)=>{
    callback(permission==='display-capture' && mainWindow && !mainWindow.isDestroyed() && webContents===mainWindow.webContents);
  });
  session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{
    if(!mainWindow||mainWindow.isDestroyed()||!request.userGesture||request.frame!==mainWindow.webContents.mainFrame||!request.videoRequested){callback(null);return;}
    try {
      const sources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0},fetchWindowIcons:false});
      if(!sources.length||mainWindow.isDestroyed()){callback(null);return;}
      const choices=sources.slice(0,18); const buttons=[...choices.map(source=>source.name.slice(0,80)),'Cancel'];
      const selected=await dialog.showMessageBox(mainWindow,{type:'question',title:'Choose what Local AI Runner can view',message:'Select one screen or application window for a one-time snapshot.',detail:'The app captures one image after you choose. It does not start continuous screen recording or capture system audio.',buttons,cancelId:buttons.length-1,defaultId:buttons.length-1,noLink:true});
      if(mainWindow.isDestroyed()||selected.response<0||selected.response>=choices.length){callback(null);return;}
      callback({video:choices[selected.response]});
    } catch(error){console.error('Screen source picker failed:',error);callback(null);}
  });
}

function createEditorWindow() {
  const editorWindow = new BrowserWindow({width:1320,height:900,minWidth:760,minHeight:520,backgroundColor:'#0d1118',show:false,title:'Local AI Runner — Code Editor',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  editorWindows.add(editorWindow.webContents.id);
  editorWindow.once('ready-to-show',()=>editorWindow.show());
  editorWindow.on('closed',()=>editorWindows.delete(editorWindow.webContents.id));
  editorWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  editorWindow.loadFile(path.join(__dirname,'editor.html'));
  return {opened:true};
}

function createWindow() {
  mainWindow=new BrowserWindow({width:1580,height:980,minWidth:760,minHeight:620,backgroundColor:'#0d1118',show:false,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const ownerId=mainWindow.webContents.id;
  mainWindow.once('ready-to-show',()=>mainWindow.show());
  mainWindow.on('closed',()=>{for(const [key,controller] of activeStreams) if(key.startsWith(`${ownerId}:`)) controller.abort();browser?.shutdown();mainWindow=null;});
  mainWindow.webContents.setWindowOpenHandler(({url})=>{
    try {
      const parsed = new URL(url);
      if (['https:','http:'].includes(parsed.protocol)) shell.openExternal(parsed.href).catch(error=>console.warn('Could not open external link:',error));
    } catch (_) { /* reject malformed or non-web URLs */ }
    return {action:'deny'};
  });
  mainWindow.loadFile(path.join(__dirname,'index.html'));
}

app.whenReady().then(async()=>{
  configureModelBridge();
  configureDocuments();
  configureCredentials();
  configureSystemMetrics();
  configureWorkspace();
  configureToolRegistry();
  await toolRegistry.load();
  configureEditorBridge();
  ipcMain.handle('editor:open-window',event=>{assertTrustedRenderer(event);return createEditorWindow();});
  configureConnectors();
  configureBrowser();
  configureScreenCapture();
  await Promise.all([workspace.load(), connectors.load()]);
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
}).catch(error=>{console.error('Application startup failed:',error);app.quit();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
