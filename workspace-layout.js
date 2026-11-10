/* Persistent tab/split workspace layout. Layouts are project-scoped in localStorage. */
(() => {
  'use strict';
  const KEY = 'lair.workspace-layout.v1';
  const DEFAULT = { type: 'tabs', active: 'ai-team', groups: [{ id: 'main', tabs: ['ai-team','editor','browser','terminal','files','activity'], active: 'ai-team' }] };
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || structuredClone(DEFAULT); } catch { return structuredClone(DEFAULT); } };
  let layout = read();
  const save = () => localStorage.setItem(KEY, JSON.stringify(layout));
  function ensureRoot() {
    let root = document.getElementById('workspace-redesign-root');
    if (root) return root;
    root = document.createElement('section'); root.id = 'workspace-redesign-root'; root.className = 'wr-root';
    root.innerHTML = '<nav class="wr-tabs" aria-label="Workspace tabs"></nav><div class="wr-stage"></div>';
    const main = document.querySelector('main') || document.body;
    main.prepend(root); return root;
  }
  function render() {
    const root = ensureRoot(), tabs = root.querySelector('.wr-tabs'), stage = root.querySelector('.wr-stage');
    tabs.replaceChildren(); stage.replaceChildren();
    const names = { 'ai-team':'AI Team', editor:'Code Editor', browser:'Browser', terminal:'Terminal', files:'Files', activity:'Activity' };
    const all = [...new Set(layout.groups.flatMap(g => g.tabs))];
    for (const id of all) {
      const b = document.createElement('button'); b.className = 'wr-tab' + (layout.active === id ? ' active' : '');
      b.textContent = names[id] || id; b.draggable = true; b.dataset.tab = id;
      b.addEventListener('click', () => { layout.active = id; save(); render(); });
      b.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', id));
      tabs.append(b);
    }
    const group = layout.groups.find(g => g.tabs.includes(layout.active)) || layout.groups[0];
    const panel = document.createElement('div'); panel.className = 'wr-panel'; panel.dataset.panel = layout.active;
    panel.innerHTML = '<div class="wr-panel-head"><strong>' + (names[layout.active] || layout.active) + '</strong><span>Drag another tab here to create a split</span></div><div class="wr-panel-content"></div>';
    panel.addEventListener('dragover', e => e.preventDefault());
    panel.addEventListener('drop', e => { e.preventDefault(); const id=e.dataTransfer.getData('text/plain'); if(!id || id===layout.active)return; layout.groups=[{id:'left',tabs:[layout.active],active:layout.active},{id:'right',tabs:[id],active:id}]; layout.active=layout.active; save(); render(); });
    stage.append(panel);
    const slot = panel.querySelector('.wr-panel-content');
    const existing = document.querySelector('[data-workspace-view="' + layout.active + '"]');
    if (existing) slot.append(existing);
    else if (layout.active === 'ai-team') renderTeam(slot);
    else slot.innerHTML = '<div class="wr-placeholder"><h2>' + (names[layout.active] || layout.active) + '</h2><p>Workspace surface is ready to connect to the existing ' + layout.active + ' tool.</p></div>';
    if (layout.groups.length > 1) {
      stage.classList.add('split'); stage.style.gridTemplateColumns = '1fr 1fr';
      for (const g of layout.groups) {
        if (g.tabs[0] === layout.active) continue;
        const other = document.createElement('div'); other.className='wr-panel'; other.innerHTML='<div class="wr-panel-head"><strong>'+(names[g.tabs[0]]||g.tabs[0])+'</strong><button type="button" data-unsplit>Close split</button></div><div class="wr-panel-content"></div>';
        other.querySelector('[data-unsplit]').onclick=()=>{layout.groups=[{id:'main',tabs:layout.groups.flatMap(x=>x.tabs),active:layout.active}];save();render();};
        stage.append(other);
      }
    } else { stage.classList.remove('split'); stage.style.gridTemplateColumns='1fr'; }
  }
  function renderTeam(slot) {
    slot.innerHTML = '<section class="wr-team"><header><div><h2>Agent Control Center</h2><p>Planner-controlled team coordination</p></div><span class="wr-status">Ready</span></header><div class="wr-graph"><button data-agent="planner">Planner</button><i>↓</i><div><button data-agent="developer-1">Developer 1</button><button data-agent="developer-2">Developer 2</button></div><i>↓</i><button data-agent="reviewer">Reviewer</button></div><section class="wr-inspector"><h3>Agent inspector</h3><p class="wr-summary">Select an agent to inspect its current role and activity.</p><div class="wr-events" aria-live="polite"></div></section><section class="wr-chat"><h3>Team conversation</h3><label>Recipient<select id="wr-recipient"><option value="team">Whole team (Planner assigns)</option><option value="planner">Planner</option><option value="developer-1">Developer 1</option><option value="developer-2">Developer 2</option><option value="reviewer">Reviewer</option></select></label><textarea id="wr-message" rows="3" placeholder="Give the team or an agent an instruction..."></textarea><button id="wr-send">Send instruction</button><p class="wr-note">Only Planner can create or reassign team tasks. Direct agent messages are treated as requests or questions for Planner to route.</p></section></section>';
    const descriptions={planner:'Coordinates priorities and is the only agent allowed to assign work.', 'developer-1':'Implements assigned code changes and reports progress to Planner.', 'developer-2':'Handles assigned implementation and testing tasks.', reviewer:'Reviews completed work and reports findings to Planner.'};
    slot.querySelectorAll('[data-agent]').forEach(b=>b.onclick=()=>{slot.querySelector('.wr-summary').textContent=descriptions[b.dataset.agent];slot.querySelector('.wr-inspector h3').textContent=b.textContent+' — Inspector';});
    const send=slot.querySelector('#wr-send');
    send.onclick=()=>{const message=slot.querySelector('#wr-message').value.trim();if(!message)return;const to=slot.querySelector('#wr-recipient').value;const events=slot.querySelector('.wr-events');const row=document.createElement('article');row.className='wr-event';row.textContent=new Date().toLocaleTimeString()+' · You → '+to+': '+message;events.prepend(row);slot.querySelector('#wr-message').value='';window.dispatchEvent(new CustomEvent('lair:team-instruction',{detail:{to,message,plannerOnly:true}}));};
  }
  window.LocalAIWorkspaceLayout = { get:()=>structuredClone(layout), set(value){layout=value;save();render();}, reset(){layout=structuredClone(DEFAULT);save();render();}, render };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
})();