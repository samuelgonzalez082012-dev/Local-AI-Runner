(() => {
'use strict';
const roots=[...document.querySelectorAll('[data-editor-root]')];
if(!roots.length||!window.localAI?.workspace)return;
const channel=new BroadcastChannel('local-ai-runner-editor-sync');
const origin=Math.random().toString(36).slice(2);
const ignored=new Set(['node_modules','vendor','dist','build','.git','.next','coverage']);
const allowed=new Set(['.txt','.md','.markdown','.csv','.json','.xml','.html','.htm','.css','.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.java','.cs','.yaml','.yml','.log','.sql','.sh','.ps1','.toml','.ini','.cfg','.go','.rs','.c','.h','.cpp','.hpp','.rb','.php','.swift','.kt']);
const state={tabs:[],active:'',workspace:null,busy:false};
const ext=p=>{const m=String(p).toLowerCase().match(/(\.[^.\/]+)$/);return m?m[1]:'';};
const icon=p=>({'.js':'JS','.mjs':'JS','.ts':'TS','.tsx':'TS','.jsx':'JS','.html':'<>','.htm':'<>','.css':'#','.json':'{}','.py':'Py','.md':'MD','.yaml':'YML','.yml':'YML','.sql':'SQL','.rs':'Rs','.go':'Go'})[ext(p)]||'TXT';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function post(type,payload){channel.postMessage({origin,type,payload});}
function sync(){post('state',{tabs:state.tabs.map(t=>({path:t.path,dirty:t.dirty})),active:state.active});state.tabs.forEach(t=>post('content',{path:t.path,content:t.content,dirty:t.dirty}));}
channel.addEventListener('message',e=>{
 const m=e.data;if(!m||m.origin===origin)return;
 if(m.type==='request-state'){sync();return;}
 if(m.type==='state'){state.tabs=(m.payload.tabs||[]).map(t=>state.tabs.find(x=>x.path===t.path)||({...t,content:''}));state.active=m.payload.active||state.active;roots.forEach(render);}
 if(m.type==='content'){const t=state.tabs.find(x=>x.path===m.payload.path);if(t){t.content=m.payload.content;t.dirty=!!m.payload.dirty;roots.forEach(render);}}
});
function highlight(s,lang){
 let h=esc(s);
 if(['js','mjs','cjs','ts','tsx','jsx','py','java','cs','go','rs'].includes(lang)){
  h=h.replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g,'<span class="syn-string">$1</span>');
  h=h.replace(/\b(const|let|var|function|return|if|else|for|while|class|new|async|await|import|export|from|default|try|catch|throw|def|self|True|False|null|undefined|public|private|static|void|package|func|fn|struct|impl|use)\b/g,'<span class="syn-keyword">$1</span>');
  h=h.replace(/\b(\d+(?:\.\d+)?)\b/g,'<span class="syn-number">$1</span>');
  h=h.replace(/(\/\/.*|#.*)$/gm,'<span class="syn-comment">$1</span>');
 }else if(lang==='json'){
  h=h.replace(/(&quot;[^&]*?&quot;)(?=\s*:)/g,'<span class="syn-key">$1</span>').replace(/:\s*(&quot;.*?&quot;)/g,': <span class="syn-string">$1</span>').replace(/\b(true|false|null)\b/g,'<span class="syn-keyword">$1</span>');
 }else if(['html','htm','xml'].includes(lang))h=h.replace(/(&lt;\/?[\w:-]+|\/?&gt;)/g,'<span class="syn-tag">$1</span>');
 else if(lang==='css')h=h.replace(/([.#][\w-]+)(?=\s*\{)/g,'<span class="syn-keyword">$1</span>').replace(/([\w-]+)(?=\s*:)/g,'<span class="syn-key">$1</span>');
 return h||' ';
}
function renderTabs(root){
 const strip=root.querySelector('.editor-tabs');if(!strip)return;strip.replaceChildren();
 state.tabs.forEach(tab=>{
  const b=document.createElement('button');b.type='button';b.className='editor-tab'+(tab.path===state.active?' active':'')+(tab.dirty?' dirty':'');
  b.innerHTML='<span class="editor-file-icon">'+esc(icon(tab.path))+'</span><span class="editor-tab-name">'+esc(tab.path.split('/').pop())+'</span><span class="editor-dirty-dot"></span><span class="editor-tab-close">×</span>';b.title=tab.path;
  b.addEventListener('click',e=>{if(e.target.closest('.editor-tab-close'))closeTab(tab.path);else{state.active=tab.path;roots.forEach(render);sync();}});strip.append(b);
 });
}
function renderActive(root){
 const tab=state.tabs.find(t=>t.path===state.active),area=root.querySelector('.editor-work-area');if(!area)return;
 if(!tab){area.innerHTML='<div class="editor-empty"><div class="editor-empty-mark">⌘</div><strong>Open a file to start editing</strong><p>Select a source file from the explorer, or create a new file.</p></div>';root.querySelector('.editor-file-path').textContent='No file selected';return;}
 root.querySelector('.editor-file-path').textContent=tab.path;
 area.innerHTML='<div class="editor-code-wrap"><div class="editor-gutter"></div><div class="editor-code-stack"><pre class="editor-highlight" aria-hidden="true"></pre><textarea class="editor-input" spellcheck="false" aria-label="Source code editor"></textarea></div></div>';
 const input=area.querySelector('.editor-input');input.value=tab.content;
 area.querySelector('.editor-highlight').innerHTML=highlight(tab.content,ext(tab.path).slice(1))+'\n';
 area.querySelector('.editor-gutter').innerHTML=Array.from({length:Math.max(1,tab.content.split('\n').length)},(_,i)=>'<span>'+(i+1)+'</span>').join('');
 root.querySelector('.editor-language').textContent=ext(tab.path).slice(1).toUpperCase()||'TEXT';updateCursor(root);
}
function render(root){renderTabs(root);renderActive(root);}
function updateCursor(root){const a=root.querySelector('.editor-input');if(!a)return;const b=a.value.slice(0,a.selectionStart),line=b.split('\n').length,col=b.length-b.lastIndexOf('\n');root.querySelector('.editor-position').textContent='Ln '+line+', Col '+col;}
async function loadTree(root,dir=''){
 const list=root.querySelector('.editor-tree');if(!list)return;list.innerHTML='<div class="editor-tree-message">Loading workspace…</div>';
 try{
  state.workspace=await window.localAI.workspace.info();if(!state.workspace){list.innerHTML='<div class="editor-tree-message">Choose a workspace in Connections first.</div>';return;}
  const entries=await window.localAI.workspace.list(dir);list.replaceChildren();
  const filtered=entries.filter(e=>!e.name.startsWith('.')&&!ignored.has(e.name)&&(e.type==='directory'||(e.type==='file'&&allowed.has(ext(e.name)))));
  filtered.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='directory'?-1:1);
  if(dir){const up=document.createElement('button');up.className='editor-tree-item folder';up.type='button';up.textContent='↰ ..';up.addEventListener('click',()=>loadTree(root,dir.split('/').slice(0,-1).join('/')));list.append(up);}
  filtered.slice(0,500).forEach(entry=>{const b=document.createElement('button');b.type='button';b.className='editor-tree-item '+(entry.type==='directory'?'folder':'file');b.innerHTML='<span>'+(entry.type==='directory'?'▸':esc(icon(entry.path)))+'</span><span>'+esc(entry.name)+'</span>';b.title=entry.path;b.addEventListener('click',()=>entry.type==='directory'?loadTree(root,entry.path):openFile(entry.path));list.append(b);});
  if(!filtered.length)list.innerHTML='<div class="editor-tree-message">No supported source files in this folder.</div>';
  root.querySelector('.editor-workspace-name').textContent=state.workspace.name;
 }catch(error){list.innerHTML='<div class="editor-tree-message">'+esc(error.message)+'</div>';}
}
async function openFile(path){
 if(state.tabs.some(t=>t.path===path)){state.active=path;roots.forEach(render);sync();return;}
 try{const content=await window.localAI.workspace.read(path);state.tabs.push({path,content,dirty:false});state.active=path;roots.forEach(render);sync();}
 catch(error){alert('Could not open '+path+': '+error.message);}
}
function closeTab(path){const t=state.tabs.find(x=>x.path===path);if(t?.dirty&&!confirm('Discard unsaved changes to '+path+'?'))return;state.tabs=state.tabs.filter(x=>x.path!==path);if(state.active===path)state.active=state.tabs.at(-1)?.path||'';roots.forEach(render);sync();}
async function save(){
 const tab=state.tabs.find(t=>t.path===state.active);if(!tab||state.busy)return;state.busy=true;roots.forEach(r=>r.querySelectorAll('.editor-save').forEach(b=>b.disabled=true));
 try{await window.localAI.workspace.write(tab.path,tab.content);tab.dirty=false;sync();roots.forEach(render);notify('Saved '+tab.path+'. A backup is retained for the previous version.');}
 catch(error){alert('Save cancelled or failed: '+error.message);}
 finally{state.busy=false;roots.forEach(r=>r.querySelectorAll('.editor-save').forEach(b=>b.disabled=false));}
}
async function createFile(){
 const path=prompt('New file path, relative to the selected workspace:','new-file.js');if(!path)return;
 if(path.startsWith('/')||path.split(/[\\/]/).some(p=>p==='..'||p==='')){alert('Enter a safe relative path inside the selected workspace.');return;}
 try{await window.localAI.workspace.create(path,'');await openFile(path);roots.forEach(r=>loadTree(r));}
 catch(error){alert('Could not create file: '+error.message);}
}
function notify(message){const el=document.getElementById('toast');if(el){el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600);}}
function mount(root){
 root.innerHTML='<div class="editor-shell"><div class="editor-toolbar"><div class="editor-workspace-label"><span class="editor-live-dot"></span><span class="editor-workspace-name">Workspace</span></div><div class="editor-toolbar-actions"><button class="btn small" data-action="refresh">↻ Refresh</button><button class="btn small" data-action="new">＋ New file</button><button class="btn small primary editor-save" data-action="save">Save changes</button><button class="btn small" data-action="popout">↗ Pop out</button></div></div><div class="editor-layout"><aside class="editor-explorer"><div class="editor-explorer-head"><strong>EXPLORER</strong><button type="button" data-action="refresh">↻</button></div><div class="editor-tree"></div></aside><section class="editor-main"><div class="editor-tabs" role="tablist"></div><div class="editor-work-area"><div class="editor-empty"><strong>Open a file to start editing</strong></div></div><div class="editor-status"><span class="editor-file-path">No file selected</span><span class="editor-position">Ln 1, Col 1</span><span class="editor-language">TEXT</span></div></section></div></div>';
 root.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.action;if(a==='refresh')loadTree(root);if(a==='new')createFile();if(a==='save')save();if(a==='popout')window.localAI.editor.openWindow().catch(e=>alert(e.message));}));
 root.querySelector('.editor-work-area').addEventListener('input',e=>{if(!e.target.matches('.editor-input'))return;const t=state.tabs.find(x=>x.path===state.active);if(!t)return;t.content=e.target.value;t.dirty=true;const w=e.target.closest('.editor-code-wrap');w.querySelector('.editor-highlight').innerHTML=highlight(t.content,ext(t.path).slice(1))+'\n';w.querySelector('.editor-gutter').innerHTML=Array.from({length:Math.max(1,t.content.split('\n').length)},(_,i)=>'<span>'+(i+1)+'</span>').join('');renderTabs(root);updateCursor(root);post('content',{path:t.path,content:t.content,dirty:true});});
 root.querySelector('.editor-work-area').addEventListener('keyup',()=>updateCursor(root));root.querySelector('.editor-work-area').addEventListener('click',()=>updateCursor(root));
 root.querySelector('.editor-work-area').addEventListener('scroll',e=>{if(!e.target.matches('.editor-input'))return;const w=e.target.closest('.editor-code-wrap');w.querySelector('.editor-highlight').scrollTop=e.target.scrollTop;w.querySelector('.editor-highlight').scrollLeft=e.target.scrollLeft;w.querySelector('.editor-gutter').scrollTop=e.target.scrollTop;},true);
 loadTree(root);render(root);
}
roots.forEach(mount);
document.getElementById('editorDockButton')?.addEventListener('click',()=>{const d=document.getElementById('editorDock'),b=document.getElementById('editorDockButton');d.hidden=!d.hidden;b.setAttribute('aria-pressed',String(!d.hidden));if(!d.hidden)loadTree(document.getElementById('editorDockRoot'));});
document.getElementById('openProjectEditor')?.addEventListener('click',()=>{const r=document.getElementById('projectEditorRoot');r.hidden=!r.hidden;if(!r.hidden)r.scrollIntoView({behavior:'smooth',block:'start'});});
document.getElementById('editorPopoutPage')?.addEventListener('click',()=>window.localAI.editor.openWindow().catch(e=>alert(e.message)));
channel.postMessage({origin,type:'request-state'});
})();