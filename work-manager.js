(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let state = null;
  let selectedAgent = 'planner';
  let selectedTask = '';
  let activeWorkView = 'overview';
  let activityFilter = 'all';
  const agentDefaults = [
    { id:'planner', name:'Planner', role:'planner', provider:'inherit', model:'', instructions:'Coordinate the team, break work into tasks, and review decisions.', tools:['read','plan','message'], enabled:true },
    { id:'developer-1', name:'Developer 1', role:'developer', provider:'inherit', model:'', instructions:'Implement assigned development tasks within the agreed scope.', tools:['read','write-proposal','message'], enabled:true },
    { id:'developer-2', name:'Developer 2', role:'developer', provider:'inherit', model:'', instructions:'Work on independent assigned tasks and coordinate file ownership.', tools:['read','write-proposal','message'], enabled:true },
    { id:'reviewer', name:'Reviewer', role:'reviewer', provider:'inherit', model:'', instructions:'Review plans and proposed changes; identify risks and missing tests.', tools:['read','review','message'], enabled:true }
  ];
  function toast(message) { const node=byId('toast'); if(node){node.textContent=message;node.classList.add('visible');setTimeout(()=>node.classList.remove('visible'),2800);} }
  function time(value) { try { return new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); } catch (_) { return ''; } }
  async function refresh() {
    if (!window.localAI?.work) return;
    try { state = await window.localAI.work.state(); render(); }
    catch (error) { toast(`Work Manager could not load: ${error.message}`); }
  }
  function renderAgents() {
    const list=byId('workAgentList'); if(!list||!state)return;
    list.innerHTML=state.team.agents.map(agent=>`<button class="work-agent-card ${selectedAgent===agent.id?'selected':''}" data-agent-select="${escapeHtml(agent.id)}"><span class="agent-avatar ${escapeHtml(agent.role)}">${escapeHtml(agent.name.slice(0,1).toUpperCase())}</span><span class="agent-copy"><strong>${escapeHtml(agent.name)}</strong><small>${escapeHtml(agent.role)} · ${escapeHtml(agent.provider==='inherit'?'Default model':agent.model||agent.provider)}</small></span><span class="agent-status">${agent.enabled?'Ready':'Paused'}</span></button>`).join('');
    renderInspector();
    const select=byId('workTaskAgent'); if(select)select.innerHTML=state.team.agents.map(agent=>`<option value="${escapeHtml(agent.id)}">${escapeHtml(agent.name)}</option>`).join('');
    const templates=byId('loadWorkTemplate');if(templates){const selected=templates.value;templates.innerHTML='<option value="">Saved teams…</option>'+state.templates.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · v${Number(item.version)||1}</option>`).join('');templates.value=state.templates.some(item=>item.id===selected)?selected:'';}
    byId('workAutonomy').value=state.team.autonomy||'hybrid'; byId('workConcurrency').value=state.team.maxConcurrent||3;
  }
  function renderInspector(){const host=byId('workAgentInspector');if(!host||!state)return;const agent=state.team.agents.find(item=>item.id===selectedAgent);if(!agent){host.innerHTML='<p class="muted-text">Select an agent.</p>';return;}host.innerHTML=`<label class="field">Agent name<input id="inspectAgentName" maxlength="80" value="${escapeHtml(agent.name)}"></label><label class="field">Role<input id="inspectAgentRole" maxlength="40" value="${escapeHtml(agent.role)}"></label><label class="field">Model override<input id="inspectAgentModel" maxlength="160" value="${escapeHtml(agent.model||'')}" placeholder="Use top-bar model"></label><label class="field">Instructions<textarea id="inspectAgentInstructions" rows="5" maxlength="8000">${escapeHtml(agent.instructions||'')}</textarea></label><div class="work-permission-list">${['read','write-proposal','review','message','memory-propose'].map(tool=>`<label><input type="checkbox" name="agentTool" value="${tool}" ${agent.tools.includes(tool)?'checked':''}> ${tool.replace('-',' ')}</label>`).join('')}</div><label class="work-inspector-enabled"><input id="inspectAgentEnabled" type="checkbox" ${agent.enabled?'checked':''}> Agent enabled</label><button class="btn primary full" id="saveAgentConfig">Save agent configuration</button>`;byId('saveAgentConfig')?.addEventListener('click',async()=>{agent.name=byId('inspectAgentName').value.trim();agent.role=byId('inspectAgentRole').value.trim()||'custom';agent.model=byId('inspectAgentModel').value.trim();agent.instructions=byId('inspectAgentInstructions').value;agent.tools=[...document.querySelectorAll('#workAgentInspector input[name=agentTool]:checked')].map(input=>input.value);agent.enabled=byId('inspectAgentEnabled').checked;try{await saveTeam();toast('Agent configuration saved.');}catch(error){toast(error.message);}});}
  function renderGraph() {
    const messages=byId('workMessageList');if(!messages||!state)return;
    messages.innerHTML=state.messages.length?state.messages.slice(-8).reverse().map(message=>`<button class="work-message" data-message-id="${escapeHtml(message.id)}"><strong>${escapeHtml(agentName(message.from))} → ${escapeHtml(message.to==='team'?'Team':agentName(message.to))}</strong><span>${escapeHtml(message.body)}</span><small>${time(message.createdAt)}</small></button>`).join(''):'<span class="muted-text">No agent messages yet. Task updates and agent coordination will appear here.</span>';
    const graph=byId('workGraph');if(!graph)return;
    const agents=state.team?.agents||[],planner=agents.find(agent=>agent.role==='planner')||agents[0],others=agents.filter(agent=>agent!==planner);
    const node=agent=>`<button type="button" class="work-graph-node ${selectedAgent===agent.id?'selected':''}" data-agent-node="${escapeHtml(agent.id)}"><span class="agent-avatar ${escapeHtml(agent.role)}">${escapeHtml(agent.name.slice(0,1).toUpperCase())}</span><b>${escapeHtml(agent.name)}</b><small>${escapeHtml(agent.role)} · ${agent.enabled?'Ready':'Paused'}</small></button>`;
    graph.innerHTML=`<div class="work-graph-canvas"><div class="work-graph-level"><span class="work-graph-level-label">COORDINATION</span>${planner?node(planner):'<span class="muted-text">No coordinator configured.</span>'}</div><div class="work-graph-branches"><span class="work-graph-level-label">TEAM MEMBERS</span><div class="work-graph-agent-grid">${others.map(node).join('')||'<span class="muted-text">Add team members to build your orchestration graph.</span>'}</div></div></div>`;
  }
  function showMessage(id){const message=state?.messages.find(item=>item.id===id);if(!message)return;byId('workMessageMeta').textContent=`${agentName(message.from)} → ${message.to==='team'?'Team':agentName(message.to)} · ${time(message.createdAt)}`;byId('workMessageBody').textContent=message.body;byId('workMessageDialog').showModal();}
  function agentName(id){return state?.team.agents.find(agent=>agent.id===id)?.name||id||'Unknown';}
  function renderTasks() {
    const list=byId('workTaskList');if(!list||!state)return;
    const tasks=state.tasks||[];byId('workTaskCount').textContent=`${tasks.length} task${tasks.length===1?'':'s'}`;
    const groups=[{title:'Backlog',statuses:['queued']},{title:'Planning',statuses:['planning']},{title:'In progress',statuses:['in-progress']},{title:'Review & attention',statuses:['review','blocked','failed']},{title:'Completed',statuses:['completed','cancelled']}];
    const card=task=>`<article class="work-task-card ${selectedTask===task.id?'selected':''}" data-task-card="${escapeHtml(task.id)}"><div class="work-task-top"><strong>${escapeHtml(task.title)}</strong><span class="task-status ${escapeHtml(task.status)}">${escapeHtml(task.status)}</span></div><p>${escapeHtml(task.description)}</p><small>${escapeHtml(agentName(task.assignedTo))} · ${escapeHtml(task.priority)} priority</small><div class="work-task-actions"><select data-task-status="${escapeHtml(task.id)}" aria-label="Task status"><option value="queued" ${task.status==='queued'?'selected':''}>Queued</option><option value="planning" ${task.status==='planning'?'selected':''}>Planning</option><option value="in-progress" ${task.status==='in-progress'?'selected':''}>In progress</option><option value="blocked" ${task.status==='blocked'?'selected':''}>Blocked</option><option value="review" ${task.status==='review'?'selected':''}>Review</option><option value="completed" ${task.status==='completed'?'selected':''}>Completed</option><option value="cancelled" ${task.status==='cancelled'?'selected':''}>Cancelled</option></select><button class="btn small" data-task-message="${escapeHtml(task.id)}">Message team</button><button class="btn small primary" data-task-run="${escapeHtml(task.id)}" ${['planning','in-progress','review'].includes(task.status)?'disabled':''}>Run team</button></div></article>`;
    list.innerHTML=`<div class="work-task-board">${groups.map(group=>{const items=tasks.filter(task=>group.statuses.includes(task.status)).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));return `<section class="work-task-column"><header><strong>${group.title}</strong><span>${items.length}</span></header><div class="work-task-column-body">${items.map(card).join('')||'<p class="muted-text work-task-empty">No tasks here.</p>'}</div></section>`;}).join('')}</div>`;
  }
  function renderActivity() {
    const list=byId('workActivityList'); if(!list||!state)return;
    const filtered=(state.activity||[]).filter(item=>{
      if(activityFilter==='all')return true;
      const type=String(item.type||'').toLowerCase();
      if(activityFilter==='agent')return /agent|message|run|review/.test(type);
      if(activityFilter==='task')return /task/.test(type);
      if(activityFilter==='file')return /file|write|read|lock/.test(type);
      if(activityFilter==='memory')return /memory/.test(type);
      return true;
    });
    list.innerHTML=filtered.length?filtered.slice(0,60).map(item=>`<div class="work-activity-item"><i></i><span><strong>${escapeHtml(String(item.type||'activity').replace(/-/g,' '))}</strong><small>${escapeHtml(item.title||item.file||item.name||item.agentId||item.project||'Work Manager')} · ${time(item.at)}</small></span></div>`).join(''):'<p class="muted-text">No matching activity yet.</p>';
  }
  function renderMemory() {
    const list=byId('workMemoryList'); if(!list||!state)return;
    list.innerHTML=state.memory.length?state.memory.map(item=>`<article class="work-memory-item ${item.status==='pending'?'pending':''}"><div><strong>${escapeHtml(item.title)}</strong><span class="memory-category">${escapeHtml(item.category)}${item.pinned?' · Pinned':''} · ${escapeHtml(item.status||'approved')}</span></div><p>${escapeHtml(item.content)}</p>${item.proposedBy?`<small>Proposed by ${escapeHtml(agentName(item.proposedBy))}</small>`:''}<div class="work-memory-actions">${item.status==='pending'?`<button class="btn small primary" data-memory-approve="${escapeHtml(item.id)}">Approve</button>`:''}<button class="btn small" data-memory-remove="${escapeHtml(item.id)}">${item.status==='pending'?'Reject':'Remove'}</button></div></article>`).join(''):'<p class="muted-text">No shared project memory yet. Add architecture notes, rules, decisions and restrictions for the whole team.</p>';
  }
  function renderFileActivity(){const host=byId('workFileActivity');if(!host||!state)return;const active=state.locks||[];const queued=state.waiting||[];host.innerHTML=active.length||queued.length?[...active.map(lock=>`<span class="file-lock ${lock.mode}"><b>${escapeHtml(lock.mode==='write'?'Writing':'Reading')}</b> ${escapeHtml(lock.file)} · ${escapeHtml(agentName(lock.agentId))}</span>`),...queued.map(ticket=>`<span class="file-lock waiting"><b>Waiting to ${escapeHtml(ticket.mode)}</b> ${escapeHtml(ticket.file)} · ${escapeHtml(agentName(ticket.agentId))}</span>`)].join(''):'No active agent file operations.';}
  function render() { if(!state)return; renderAgents();renderGraph();renderTasks();renderActivity();renderMemory();renderFileActivity();applyLayout();updateOverview();applyWorkView(); }
  function updateOverview(){
    const tasks=state.tasks||[], agents=state.team?.agents||[], memory=state.memory||[];
    const open=tasks.filter(task=>!['completed','cancelled'].includes(task.status)).length;
    const attention=tasks.filter(task=>['blocked','failed','review'].includes(task.status)).length;
    const approved=memory.filter(item=>(item.status||'approved')==='approved').length;
    const set=(id,value)=>{const node=byId(id);if(node)node.textContent=String(value);};
    set('workMetricAgents',agents.filter(agent=>agent.enabled).length);
    set('workMetricOpen',open);set('workMetricAttention',attention);set('workMetricMemory',approved);
    set('workOverviewUpdated',`Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`);
  }
  function applyWorkView(){
    const root=byId('workView');if(!root)return;
    root.dataset.activeView=activeWorkView;
    document.querySelectorAll('[data-work-view]').forEach(tab=>{const active=tab.dataset.workView===activeWorkView;tab.classList.toggle('active',active);if(active)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');});
    byId('workOverview')?.classList.toggle('work-view-hidden',activeWorkView!=='overview');
    document.querySelectorAll('[data-work-panel]').forEach(panel=>{const views=(panel.dataset.workViews||'').split(/\s+/);panel.classList.toggle('work-view-hidden',!views.includes(activeWorkView));});
    if(activeWorkView==='workspace')applyWorkspaceLayout();
  }
  function setWorkView(view){if(!['overview','team','tasks','activity','workspace','knowledge'].includes(view))return;activeWorkView=view;applyWorkView();}
  function applyLayout(){const hidden=new Set(state?.layout?.hidden||[]);const order=state?.layout?.panels||[];document.querySelectorAll('[data-work-panel]').forEach(panel=>{panel.hidden=hidden.has(panel.dataset.workPanel);panel.style.order=String(Math.max(0,order.indexOf(panel.dataset.workPanel)));const width=Number(state?.layout?.widths?.[panel.dataset.workPanel]);panel.style.width=width>=220?`${width}px`:'';});}
  const WORKSPACE_LAYOUT_KEY='local-ai-runner.work-manager.workspace-layout.v1';
  const defaultWorkspaceLayout={editor:68,browser:32,editorHidden:false,browserHidden:false};
  function readWorkspaceLayout(){try{return {...defaultWorkspaceLayout,...JSON.parse(localStorage.getItem(WORKSPACE_LAYOUT_KEY)||'{}')};}catch(_){return {...defaultWorkspaceLayout};}}
  function writeWorkspaceLayout(layout){try{localStorage.setItem(WORKSPACE_LAYOUT_KEY,JSON.stringify(layout));}catch(_){}}
  function applyWorkspaceLayout(){
    const layout=readWorkspaceLayout(),root=byId('workLayout'),editor=root?.querySelector('[data-work-panel="editor"]'),browser=root?.querySelector('[data-work-panel="browser"]'),splitter=byId('workspacePanelSplitter');
    if(!root||!editor||!browser)return;
    root.style.setProperty('--workspace-editor-share',`${layout.editor}fr`);root.style.setProperty('--workspace-browser-share',`${layout.browser}fr`);
    editor.classList.toggle('workspace-panel-collapsed',!!layout.editorHidden);browser.classList.toggle('workspace-panel-collapsed',!!layout.browserHidden);
    if(layout.editorHidden)root.style.gridTemplateColumns='0px 0px minmax(0,1fr)';
    else if(layout.browserHidden)root.style.gridTemplateColumns='minmax(0,1fr) 0px 0px';
    else root.style.gridTemplateColumns='';

    if(splitter)splitter.hidden=!!layout.editorHidden||!!layout.browserHidden;
  }
  function initWorkspaceLayout(){
    const root=byId('workLayout'),editor=root?.querySelector('[data-work-panel="editor"]'),browser=root?.querySelector('[data-work-panel="browser"]');if(!root||!editor||!browser)return;
    if(!byId('workspacePanelSplitter')){const s=document.createElement('div');s.id='workspacePanelSplitter';s.className='workspace-panel-splitter';s.setAttribute('role','separator');s.setAttribute('aria-orientation','vertical');s.setAttribute('aria-label','Resize editor and browser panels');s.tabIndex=0;browser.before(s);}
    const preset=byId('workspaceLayoutPreset');if(preset&&!preset.dataset.bound){preset.dataset.bound='1';preset.addEventListener('change',()=>{const l=readWorkspaceLayout();switch(preset.value){case'balanced':l.editor=50;l.browser=50;break;case'code':l.editor=78;l.browser=22;break;case'preview':l.editor=32;l.browser=68;break;case'editor-only':l.editorHidden=false;l.browserHidden=true;break;case'browser-only':l.editorHidden=true;l.browserHidden=false;break;}writeWorkspaceLayout(l);applyWorkspaceLayout();});}
    const reset=byId('resetWorkspaceLayout');if(reset&&!reset.dataset.bound){reset.dataset.bound='1';reset.addEventListener('click',()=>{writeWorkspaceLayout({...defaultWorkspaceLayout});if(preset)preset.value='custom';applyWorkspaceLayout();});}
    root.querySelectorAll('[data-workspace-collapse]').forEach(button=>{if(button.dataset.bound)return;button.dataset.bound='1';button.addEventListener('click',()=>{const l=readWorkspaceLayout(),key=button.closest('[data-work-panel]').dataset.workPanel==='editor'?'editorHidden':'browserHidden';l[key]=!l[key];if(l.editorHidden&&l.browserHidden)l[key]=false;writeWorkspaceLayout(l);applyWorkspaceLayout();});});
    const s=byId('workspacePanelSplitter');if(s&&!s.dataset.bound){s.dataset.bound='1';let drag=false;const resize=event=>{const rect=root.getBoundingClientRect(),vertical=window.innerWidth<=850,ratio=Math.max(.2,Math.min(.8,vertical?(event.clientY-rect.top)/Math.max(1,rect.height-10):(event.clientX-rect.left)/Math.max(1,rect.width-10))),l=readWorkspaceLayout();l.editor=Math.round(ratio*100);l.browser=100-l.editor;l.editorHidden=false;l.browserHidden=false;writeWorkspaceLayout(l);applyWorkspaceLayout();};s.addEventListener('pointerdown',e=>{drag=true;s.setPointerCapture(e.pointerId);document.body.classList.add('workspace-resizing');});s.addEventListener('pointermove',e=>{if(drag)resize(e);});const stop=()=>{drag=false;document.body.classList.remove('workspace-resizing');};s.addEventListener('pointerup',stop);s.addEventListener('pointercancel',stop);s.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const l=readWorkspaceLayout();l.editor=Math.max(20,Math.min(80,l.editor+(e.key==='ArrowRight'?3:-3)));l.browser=100-l.editor;writeWorkspaceLayout(l);applyWorkspaceLayout();});}
    applyWorkspaceLayout();
  }
  async function saveTeam() {
    if(!state)return;
    try { state.team.autonomy=byId('workAutonomy').value;state.team.maxConcurrent=Number(byId('workConcurrency').value)||3;await window.localAI.work.saveTeam(state.team);await refresh();toast('Team configuration saved.'); }
    catch(error){toast(`Could not save team: ${error.message}`);}
  }
  function openTaskDialog(){byId('workTaskForm')?.reset();byId('workTaskAgent').value=selectedAgent;byId('workTaskDialog')?.showModal();}
  async function addAgent(){
    const name=prompt('Agent name');if(!name?.trim())return;
    const role=prompt('Agent role (for example: tester, architect, researcher)','custom')||'custom';
    const id=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||`agent-${Date.now()}`;
    if(state.team.agents.some(agent=>agent.id===id)){toast('An agent with that ID already exists.');return;}
    state.team.agents.push({id,name:name.trim().slice(0,80),role,provider:'inherit',model:'',instructions:`You are the ${role} agent. Follow project instructions and coordinate with the team.`,tools:['read','message'],enabled:true});await saveTeam();
  }
  async function addMemory(){
    const title=prompt('Memory title');if(!title?.trim())return;
    const content=prompt('Shared project information');if(!content?.trim())return;
    const category=prompt('Category: architecture, rules, design, decisions, restrictions, notes','notes')||'notes';
    try{await window.localAI.work.addMemory({title,content,category,pinned:false});await refresh();toast('Shared project memory saved.');}catch(error){toast(error.message);}
  }
  async function runTeamTask(taskId){
    const task=state.tasks.find(item=>item.id===taskId);if(!task)return;
    if(!window.localAIWorkRunner?.runAgent){toast('The model runner is not available.');return;}
    const agents=state.team.agents.filter(agent=>agent.enabled);
    const planner=agents.find(agent=>agent.role==='planner')||agents[0];
    const reviewer=agents.find(agent=>agent.role==='reviewer');
    const developers=agents.filter(agent=>agent.id!==planner.id&&agent.id!==reviewer?.id&&((agent.tools||[]).includes('read')||(agent.tools||[]).includes('write-proposal')));
    if(!planner){toast('Add an enabled agent to the team first.');return;}
    if(!developers.length){toast('Enable at least one additional agent with read permission to participate in a team task; write-proposal permission allows approved file changes.');return;}
    const controller=new AbortController();
    const projectMemory=state.memory.map(item=>`[${item.category}${item.pinned?' · pinned':''}] ${item.title}: ${item.content}`).join('\n\n');
    const memoryContext=projectMemory?`\n\nSHARED PROJECT MEMORY (follow pinned entries as project instructions):\n${projectMemory}`:'';
    const runButton=document.querySelector(`[data-task-run="${CSS.escape(taskId)}"]`);if(runButton){runButton.disabled=true;runButton.textContent='Running…';}
    const activity=async event=>{
      const label=event.type==='agent-message'?`Messaged ${event.to}`:event.type==='tool-start'?`Started ${event.tool}`:event.type==='file-read'?`Read ${event.path}`:event.type==='file-written'?`Wrote ${event.path}`:event.type==='file-lock-waiting'?`Waiting for ${event.mode} lock on ${event.path}`:event.type==='file-lock-acquired'?`Locked ${event.path} for ${event.mode}`:event.type==='file-lock-released'?`Released ${event.path}`:event.type==='memory-proposed'?`Proposed project memory: ${event.title}`:`Finished ${event.tool}`;
      await window.localAI.work.sendMessage({from:event.agentId,to:'team',taskId,body:`${label}${event.args?.path?`: ${event.args.path}`:''}${event.path&&!event.args?.path?`: ${event.path}`:''}${event.result?` — ${event.result}`:''}`}).catch(()=>{});
      await refresh();
    };
    try{
      await window.localAI.work.updateTask(taskId,{status:'planning',note:'Planner is preparing an implementation plan.'});await refresh();
      const plannerOutput=await window.localAIWorkRunner.runAgent({agent:planner,prompt:`Create an implementation plan and divide it into independent workstreams for these team members: ${developers.map(agent=>`${agent.id} (${agent.name})`).join(', ')}. Inspect the workspace first if needed. Do not edit files during planning. Return ONLY valid JSON with this shape: {\"summary\":\"...\",\"workstreams\":[{\"agentId\":\"developer-1\",\"objective\":\"...\",\"files\":[\"relative/path\"]}],\"risks\":[\"...\"],\"verification\":[\"...\"]}. Give each developer a distinct objective and avoid assigning the same file to multiple developers.\n\nTASK: ${task.title}\nINSTRUCTIONS: ${task.description}${memoryContext}`,signal:controller.signal,onActivity:activity,taskId});
      let planData=null;try{const match=plannerOutput.match(/\\{[\\s\\S]*\\}/);if(match)planData=JSON.parse(match[0]);}catch(_){}
      const plan=planData?JSON.stringify(planData,null,2):plannerOutput;
      await window.localAI.work.sendMessage({from:planner.id,to:'team',taskId,body:`Implementation plan:\n${plan.slice(0,7000)}`});
      await window.localAI.work.updateTask(taskId,{status:'in-progress',note:'Developers are implementing the approved task plan. Every file change requires your confirmation.'});await refresh();
      const concurrency=Math.max(1,Math.min(8,Number(state.team.maxConcurrent)||3));
      const queue=developers.slice();const results=[];
      async function worker(){while(queue.length){const agent=queue.shift();if(!agent)break;
        const workstream=planData?.workstreams?.find(item=>item.agentId===agent.id);const fallbackObjective=developers.indexOf(agent)===0?'Own the primary implementation. Make the requested code changes and update the relevant source files.':'Own independent verification work: inspect the primary implementation, add or update focused tests and documentation, and do not duplicate the primary implementation changes.';const objective=String(workstream?.objective||fallbackObjective);const assignedFiles=Array.isArray(workstream?.files)?workstream.files.join(', '):'';
        const result=await window.localAIWorkRunner.runAgent({agent,prompt:`You are implementing your distinct workstream assigned by the Planner. This is an implementation task, not a proposal-only task. Inspect the actual project files, make the required changes using workspace tools, and run or describe relevant checks. Do not modify files outside your workstream. The write tool will request an exclusive file lock and ask the user to approve each change. If approval is declined or a lock is unavailable, explain that accurately and continue only with safe work.\n\nYOUR WORKSTREAM: ${objective}\nASSIGNED FILES: ${assignedFiles||'Use the Planner plan to choose files appropriate to your workstream.'}\n\nTASK: ${task.title}\nINSTRUCTIONS: ${task.description}\n\nPLANNER PLAN:\n${plan}${memoryContext}\n\nUse send_agent_message to coordinate dependencies or ask another agent a question. When finished, report exactly which files were changed, which changes were approved, and what remains.`,signal:controller.signal,onActivity:activity,taskId});
        results.push({agent,result});
        await window.localAI.work.sendMessage({from:agent.id,to:reviewer?.id||'team',taskId,body:result.slice(0,7000)});
      }}
      await Promise.all(Array.from({length:Math.min(concurrency,developers.length)},()=>worker()));
      let review='';
      if(reviewer){review=await window.localAIWorkRunner.runAgent({agent:reviewer,prompt:`Review the actual workspace after the developer implementation. Read the changed files and assess correctness, consistency with the plan, likely regressions, missing tests and acceptance criteria. Do not edit files. Clearly distinguish verified changes from claims in developer reports.\n\nTASK: ${task.title}\nPLAN:\n${plan}\n\nDEVELOPER REPORTS:\n${results.map(item=>`${item.agent.name}:\n${item.result}`).join('\n\n')}${memoryContext}`,signal:controller.signal,onActivity:activity,taskId});await window.localAI.work.sendMessage({from:reviewer.id,to:'team',taskId,body:`Review:\n${review.slice(0,7000)}`});}
      const summary=`Implementation pass completed. ${results.length} developer workstream(s) ran. ${reviewer?'Reviewer completed a read-only review.':'No Reviewer is enabled; review remains outstanding.'} Inspect the approved file changes and reviewer notes before marking this task complete.`;
      await window.localAI.work.updateTask(taskId,{status:'review',note:summary});
      toast('Implementation pass completed. Review the approved file changes and reviewer report.');
    }catch(error){await window.localAI.work.updateTask(taskId,{status:'failed',note:error.message.slice(0,1000)}).catch(()=>{});toast(`Team run failed: ${error.message}`);}
    await refresh();
  }
  async function messageTask(taskId){
    const task=state.tasks.find(item=>item.id===taskId);if(!task)return;
    const body=prompt(`Message for ${agentName(task.assignedTo)} about “${task.title}”`);if(!body?.trim())return;
    try{await window.localAI.work.sendMessage({from:'planner',to:task.assignedTo,taskId,body});await refresh();}catch(error){toast(error.message);}
  }
  function bind(){
    initWorkspaceLayout();
    document.querySelectorAll('[data-work-view]').forEach(tab=>tab.addEventListener('click',()=>setWorkView(tab.dataset.workView)));
    byId('workActivityFilter')?.addEventListener('change',event=>{activityFilter=event.target.value;renderActivity();});
    byId('saveWorkTeam')?.addEventListener('click',saveTeam);
    byId('customizeWorkLayout')?.addEventListener('click',()=>{const hidden=new Set(state?.layout?.hidden||[]);document.querySelectorAll('#workLayoutForm input[name=panel]').forEach(input=>input.checked=!hidden.has(input.value));byId('workLayoutDialog').showModal();});
    byId('workLayoutForm')?.addEventListener('submit',async event=>{event.preventDefault();const hidden=[...document.querySelectorAll('#workLayoutForm input[name=panel]:not(:checked)')].map(input=>input.value);try{await window.localAI.work.setLayout({panels:['team','inspector','graph','tasks','timeline','memory','editor','browser'],hidden});byId('workLayoutDialog').close();await refresh();}catch(error){toast(error.message);}});
    document.querySelectorAll('[data-layout-close]').forEach(button=>button.addEventListener('click',()=>byId('workLayoutDialog').close()));byId('saveWorkTemplate')?.addEventListener('click',async()=>{await saveTeam();const name=prompt('Name this saved team',state.team.name);if(!name?.trim())return;await window.localAI.work.saveTemplate(name);await refresh();toast('Team template saved.');});byId('loadWorkTemplate')?.addEventListener('change',async event=>{if(!event.target.value)return;try{await window.localAI.work.loadTemplate(event.target.value);await refresh();toast('Saved team loaded.');}catch(error){toast(error.message);}});byId('addWorkAgent')?.addEventListener('click',addAgent);byId('newWorkTask')?.addEventListener('click',openTaskDialog);byId('addWorkMemory')?.addEventListener('click',addMemory);
    byId('workTaskForm')?.addEventListener('submit',async event=>{event.preventDefault();try{await window.localAI.work.createTask({title:byId('workTaskTitle').value,description:byId('workTaskDescription').value,assignedTo:byId('workTaskAgent').value,priority:byId('workTaskPriority').value});byId('workTaskDialog').close();await refresh();}catch(error){toast(error.message);}});
    document.querySelectorAll('[data-work-close]').forEach(button=>button.addEventListener('click',()=>byId('workTaskDialog').close()));
    byId('workAgentList')?.addEventListener('click',event=>{const card=event.target.closest('[data-agent-select]');if(card){selectedAgent=card.dataset.agentSelect;renderAgents();renderGraph();}});
    byId('workGraph')?.addEventListener('click',event=>{const messageEdge=event.target.closest('[data-message-id]');if(messageEdge){showMessage(messageEdge.dataset.messageId);return;}const node=event.target.closest('[data-agent-node]');if(node){selectedAgent=node.dataset.agentNode;renderAgents();renderGraph();}});
    byId('workMessageList')?.addEventListener('click',event=>{const message=event.target.closest('[data-message-id]');if(message)showMessage(message.dataset.messageId);});
    document.querySelectorAll('[data-message-close]').forEach(button=>button.addEventListener('click',()=>byId('workMessageDialog').close()));
    byId('workTaskList')?.addEventListener('change',async event=>{const select=event.target.closest('[data-task-status]');if(select){try{await window.localAI.work.updateTask(select.dataset.taskStatus,{status:select.value});await refresh();}catch(error){toast(error.message);}}});
    byId('workTaskList')?.addEventListener('click',event=>{const run=event.target.closest('[data-task-run]');if(run){runTeamTask(run.dataset.taskRun);return;}const button=event.target.closest('[data-task-message]');if(button)messageTask(button.dataset.taskMessage);});
    byId('workMemoryList')?.addEventListener('click',async event=>{const approve=event.target.closest('[data-memory-approve]');if(approve){try{await window.localAI.work.approveMemory(approve.dataset.memoryApprove);await refresh();toast('Project memory proposal approved.');}catch(error){toast(error.message);}return;}const button=event.target.closest('[data-memory-remove]');if(button&&confirm('Remove or reject this project memory entry?')){await window.localAI.work.removeMemory(button.dataset.memoryRemove);await refresh();}});
    byId('workAutonomy')?.addEventListener('change',saveTeam);byId('workConcurrency')?.addEventListener('change',saveTeam);
    const layout=byId('workLayout');let draggedPanel=null;document.querySelectorAll('[data-work-panel] > header').forEach(header=>{const panel=header.closest('[data-work-panel]');header.draggable=true;header.title='Drag this header to rearrange panels';header.addEventListener('dragstart',event=>{draggedPanel=panel;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',panel.dataset.workPanel);});header.addEventListener('dragover',event=>{if(draggedPanel&&draggedPanel!==panel)event.preventDefault();});header.addEventListener('drop',async event=>{event.preventDefault();if(!draggedPanel||draggedPanel===panel)return;const panels=[...layout.querySelectorAll('[data-work-panel]')].map(item=>item.dataset.workPanel);const from=panels.indexOf(draggedPanel.dataset.workPanel),to=panels.indexOf(panel.dataset.workPanel);panels.splice(from,1);panels.splice(to,0,draggedPanel.dataset.workPanel);draggedPanel=null;try{await window.localAI.work.setLayout({panels,hidden:state.layout.hidden,widths:state.layout.widths});await refresh();}catch(error){toast(error.message);}});header.addEventListener('dragend',()=>{draggedPanel=null;});});
    document.querySelectorAll('[data-work-panel]').forEach(panel=>panel.addEventListener('pointerup',async()=>{const width=Math.round(panel.getBoundingClientRect().width);if(width<220||Math.abs(width-(state?.layout?.widths?.[panel.dataset.workPanel]||0))<12)return;const widths={...(state?.layout?.widths||{}),[panel.dataset.workPanel]:width};try{state.layout=await window.localAI.work.setLayout({panels:state.layout.panels,hidden:state.layout.hidden,widths});}catch(error){toast(`Could not save panel size: ${error.message}`);}}));
    window.addEventListener('work-manager:show',refresh);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
