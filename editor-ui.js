(() => {
'use strict';
const roots=[...document.querySelectorAll('[data-editor-root]')];
if(!roots.length||!window.localAI?.workspace||!window.localAI?.editor)return;
const origin='editor-'+Math.random().toString(36).slice(2);
const ignored=new Set(['node_modules','vendor','dist','build','.git','.next','coverage']);
const allowed=new Set(['.txt','.md','.markdown','.csv','.json','.xml','.html','.htm','.css','.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.java','.cs','.yaml','.yml','.log','.sql','.sh','.ps1','.toml','.ini','.cfg','.go','.rs','.c','.h','.cpp','.hpp','.rb','.php','.swift','.kt']);
const defaults={theme:'vscode',fontFamily:'cascadia',fontSize:13,lineHeight:1.6,tabSize:2,lineNumbers:true,background:'#1e1e1e',panel:'#252526',text:'#cccccc',accent:'#007acc',keyword:'#c586c0',string:'#ce9178',number:'#b5cea8',comment:'#6a9955'};
const palettes={
 vscode:{background:'#1e1e1e',panel:'#252526',text:'#cccccc',accent:'#007acc',keyword:'#c586c0',string:'#ce9178',number:'#b5cea8',comment:'#6a9955'},
 midnight:{background:'#0e131c',panel:'#151b26',text:'#d5dbea',accent:'#91a8ef',keyword:'#c792ea',string:'#a5d6a7',number:'#f2c879',comment:'#78869d'},
 graphite:{background:'#17191d',panel:'#22252b',text:'#e2e4e8',accent:'#c4c9d4',keyword:'#d4a6e8',string:'#a7c99e',number:'#e2bc7a',comment:'#858b96'},
 light:{background:'#f7f8fb',panel:'#e9edf4',text:'#202634',accent:'#4267c7',keyword:'#873bb2',string:'#287a43',number:'#996500',comment:'#778092'},
 ocean:{background:'#081a27',panel:'#102a3b',text:'#d7eaf4',accent:'#5bc0d9',keyword:'#d29de7',string:'#9bd69e',number:'#efc779',comment:'#7394a7'},
 forest:{background:'#101b17',panel:'#1a2922',text:'#d8e9df',accent:'#80c79b',keyword:'#d1a0db',string:'#9dce8f',number:'#e2c37c',comment:'#7c9987'}
};
const state={tabs:[],active:'',workspace:null,busy:false,preferences:{...defaults}};
const ext=p=>{const m=String(p).toLowerCase().match(/(\.[^.\/]+)$/);return m?m[1]:'';};
const iconInfo=p=>({
 '.html':['<>','html'],'.htm':['<>','html'],'.xhtml':['<>','html'],'.xml':['<>','xml'],'.svg':['◇','svg'],
 '.js':['JS','javascript'],'.mjs':['JS','javascript'],'.cjs':['JS','javascript'],'.jsx':['JS','javascript'],
 '.ts':['TS','typescript'],'.tsx':['TS','typescript'],'.css':['#','css'],'.scss':['#','css'],'.less':['#','css'],
 '.json':['{}','json'],'.jsonc':['{}','json'],'.py':['Py','python'],'.java':['☕','java'],'.cs':['C#','csharp'],
 '.md':['M','markdown'],'.markdown':['M','markdown'],'.yml':['Y','yaml'],'.yaml':['Y','yaml'],'.sql':['DB','sql'],
 '.rs':['⚙','rust'],'.go':['Go','go'],'.c':['C','c'],'.h':['H','c'],'.cpp':['C++','cpp'],'.hpp':['C++','cpp'],
 '.php':['php','php'],'.rb':['◆','ruby'],'.sh':['$_','shell'],'.ps1':['>_','shell'],'.toml':['⚙','config'],'.ini':['⚙','config'],'.env':['⚙','config'],
 '.txt':['≡','text'],'.log':['≡','text'],'.csv':['▦','csv'],'.lock':['▣','config']
})[ext(p)]||['·','text'];
const icon=p=>iconInfo(p)[0];
const iconMarkup=(p,extra='')=>{const [glyph,kind]=iconInfo(p);return '<span class="editor-file-icon file-icon-'+kind+(extra?' '+extra:'')+'" aria-hidden="true">'+esc(glyph)+'</span>';};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(message){const el=document.getElementById('toast');if(el){el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600);}else console.info(message);}
function sync(){window.localAI.editor.setSync({origin,tabs:state.tabs.map(t=>({path:t.path,content:t.content,dirty:t.dirty})),active:state.active});}
function receiveSync(value){
 if(!value||value.origin===origin)return;
 if(Array.isArray(value.tabs)){
  state.tabs=value.tabs.map(remote=>{const current=state.tabs.find(t=>t.path===remote.path);return current?{...current,content:remote.content,dirty:!!remote.dirty}:{path:remote.path,content:remote.content,dirty:!!remote.dirty};});
  state.active=value.active||'';
  roots.forEach(render);
 }
 if(value.preferences)applyPreferences(value.preferences,false);
}
window.localAI.editor.onSync(receiveSync);
window.localAI.editor.onPreferences(prefs=>applyPreferences(prefs,false));
function paletteFor(prefs){
 if(prefs.theme==='custom')return prefs;
 return {...(palettes[prefs.theme]||palettes.midnight),...{fontFamily:prefs.fontFamily,fontSize:prefs.fontSize,lineHeight:prefs.lineHeight,tabSize:prefs.tabSize,lineNumbers:prefs.lineNumbers}};
}
function fontStack(font){return ({cascadia:'"Cascadia Code",Consolas,monospace',consolas:'Consolas,"Courier New",monospace',system:'ui-monospace,SFMono-Regular,Consolas,monospace',fira:'"Fira Code",Consolas,monospace',jetbrains:'"JetBrains Mono",Consolas,monospace'})[font]||'Consolas,monospace';}
function applyPreferences(prefs,save=true){
 state.preferences={...state.preferences,...prefs};
 const p=paletteFor(state.preferences);
 roots.forEach(root=>{
  const shell=root.querySelector('.editor-shell');if(!shell)return;
  const vars={'--ed-bg':p.background,'--ed-panel':p.panel,'--ed-text':p.text,'--ed-accent':p.accent,'--ed-keyword':p.keyword,'--ed-string':p.string,'--ed-number':p.number,'--ed-comment':p.comment,'--ed-font':fontStack(state.preferences.fontFamily),'--ed-font-size':state.preferences.fontSize+'px','--ed-line-height':state.preferences.lineHeight,'--ed-tab-size':state.preferences.tabSize};
  vars['--ed-indent-width']=(state.preferences.fontSize*state.preferences.tabSize*0.6)+'px';
  Object.entries(vars).forEach(([key,value])=>shell.style.setProperty(key,String(value)));
  shell.classList.toggle('hide-line-numbers',!state.preferences.lineNumbers);
  const panel=shell.querySelector('.editor-custom-panel');if(panel)syncPreferenceControls(panel);
 });
 if(save)window.localAI.editor.setPreferences(state.preferences).catch(error=>notify('Could not save editor appearance: '+error.message));
}
function syncPreferenceControls(panel){
 panel.querySelectorAll('[data-pref]').forEach(control=>{
  const value=state.preferences[control.dataset.pref];
  if(control.type==='checkbox')control.checked=!!value;
  else if(value!==undefined)control.value=String(value);
 });
}
function highlight(source,lang){
 return window.LocalEditorHighlighter.highlightCode(source,lang);
}
function renderTabs(root){
 const strip=root.querySelector('.editor-tabs');if(!strip)return;strip.replaceChildren();
 const shell=root.querySelector('.editor-shell');
 state.tabs.forEach(tab=>{
  const item=document.createElement('div');item.className='editor-tab'+(tab.path===state.active?' active':'')+(tab.dirty?' dirty':'');
  item.title=tab.path;item.setAttribute('role','presentation');
  const open=document.createElement('button');open.type='button';open.className='editor-tab-open';open.setAttribute('role','tab');open.setAttribute('aria-selected',String(tab.path===state.active));open.title=tab.path;
  open.innerHTML=iconMarkup(tab.path)+'<span class="editor-tab-name">'+esc(tab.path.split('/').pop())+'</span><span class="editor-dirty-dot" aria-hidden="true"></span>';
  open.addEventListener('click',()=>{state.active=tab.path;roots.forEach(render);sync();});
  open.addEventListener('auxclick',event=>{if(event.button===1){event.preventDefault();closeTab(tab.path);}});
  const close=document.createElement('button');close.type='button';close.className='editor-tab-close';close.textContent='×';close.title='Close '+tab.path;close.setAttribute('aria-label','Close '+tab.path);
  close.addEventListener('click',()=>closeTab(tab.path));
  item.append(open,close);strip.append(item);
 });
 const tools=document.createElement('div');tools.className='editor-tabs-tools';
 const count=document.createElement('span');count.className='editor-tab-count';count.textContent=state.tabs.length?state.tabs.length+' open':'';tools.append(count);
 const collapsed=!!shell?.classList.contains('tabs-collapsed');
 const toggle=document.createElement('button');toggle.type='button';toggle.className='editor-tabs-toggle';toggle.dataset.action='tabs-toggle';toggle.title=collapsed?'Expand editor tabs':'Collapse editor tabs';toggle.setAttribute('aria-label',toggle.title);toggle.setAttribute('aria-expanded',String(!collapsed));toggle.textContent=collapsed?'▾':'▴';tools.append(toggle);strip.append(tools);
}
function lineGutter(source){return Array.from({length:Math.max(1,source.split('\n').length)},(_,i)=>'<span>'+String(i+1)+'</span>').join('');}
function renderActive(root){
 const tab=state.tabs.find(t=>t.path===state.active),area=root.querySelector('.editor-work-area');if(!area)return;
 if(!tab){area.innerHTML='<div class="editor-empty"><div class="editor-empty-mark">⌘</div><strong>Open a file to start editing</strong><p>Select a source file from the explorer, or create a new file.</p></div>';root.querySelector('.editor-file-path').textContent='No file selected';root.querySelector('.editor-language').textContent='TEXT';root.querySelector('.editor-ai-file').textContent='No file selected';const save=root.querySelector('.editor-save');if(save)save.disabled=true;return;}
 root.querySelector('.editor-file-path').textContent=tab.path;
 area.innerHTML='<div class="editor-code-wrap"><div class="editor-gutter"></div><div class="editor-code-stack"><pre class="editor-highlight" aria-hidden="true"></pre><textarea class="editor-input" spellcheck="false" aria-label="Source code editor" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off"></textarea></div></div>';
 root.querySelector('.editor-ai-file').textContent=tab.path;
 const input=area.querySelector('.editor-input');input.value=tab.content;input.style.tabSize=String(state.preferences.tabSize);
 area.querySelector('.editor-highlight').innerHTML=highlight(tab.content,ext(tab.path).slice(1))+'\n';
 area.querySelector('.editor-gutter').innerHTML=lineGutter(tab.content);
 root.querySelector('.editor-language').textContent=ext(tab.path).slice(1).toUpperCase()||'TEXT';
 const save=root.querySelector('.editor-save');if(save)save.disabled=!tab.dirty;
 updateCursor(root);
}
function render(root){renderTabs(root);renderActive(root);applyPreferences(state.preferences,false);}
function updateCursor(root){const a=root.querySelector('.editor-input');if(!a)return;const b=a.value.slice(0,a.selectionStart),line=b.split('\n').length,col=b.length-b.lastIndexOf('\n');root.querySelector('.editor-position').textContent='Ln '+line+', Col '+col;}
async function loadTree(root,dir=''){
 const list=root.querySelector('.editor-tree');if(!list)return;list.innerHTML='<div class="editor-tree-message">Loading workspace…</div>';
 try{
  state.workspace=await window.localAI.workspace.info();
  if(!state.workspace){list.innerHTML='<div class="editor-tree-message">Choose a workspace in Connections first.</div>';return;}
  root._editorExpandedDirs=root._editorExpandedDirs||new Set();
  const renderDirectory=async(directory,target,depth=0)=>{
   const entries=await window.localAI.workspace.list(directory);
   const filtered=entries.filter(e=>!e.name.startsWith('.')&&!ignored.has(e.name)&&(e.type==='directory'||(e.type==='file'&&allowed.has(ext(e.name)))));
   filtered.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='directory'?-1:1);
   for(const entry of filtered.slice(0,500)){
    if(entry.type==='directory'){
     const row=document.createElement('button');row.type='button';row.className='editor-tree-item folder';row.style.paddingLeft=(7+depth*13)+'px';row.setAttribute('aria-expanded',String(root._editorExpandedDirs.has(entry.path)));
     row.innerHTML='<span class="editor-folder-chevron">'+(root._editorExpandedDirs.has(entry.path)?'▾':'▸')+'</span><span class="editor-folder-icon">'+(root._editorExpandedDirs.has(entry.path)?'▾':'▰')+'</span><span class="editor-tree-name">'+esc(entry.name)+'</span>';row.title=entry.path;
     row.addEventListener('click',async()=>{
      const existing=[...target.children].find(node=>node.classList?.contains('editor-tree-children')&&node.dataset.folderChildren===entry.path);
      if(existing){existing.remove();root._editorExpandedDirs.delete(entry.path);row.setAttribute('aria-expanded','false');row.querySelector('.editor-folder-chevron').textContent='▸';row.querySelector('.editor-folder-icon').textContent='▰';return;}
      root._editorExpandedDirs.add(entry.path);row.setAttribute('aria-expanded','true');row.querySelector('.editor-folder-chevron').textContent='▾';row.querySelector('.editor-folder-icon').textContent='▾';
      const children=document.createElement('div');children.className='editor-tree-children';children.dataset.folderChildren=entry.path;target.insertBefore(children,row.nextSibling);
      try{await renderDirectory(entry.path,children,depth+1);}catch(error){children.textContent=error.message;}
     });target.append(row);
    }else{
     const row=document.createElement('button');row.type='button';row.className='editor-tree-item file';row.style.paddingLeft=(7+depth*13)+'px';
     row.innerHTML=iconMarkup(entry.path)+'<span class="editor-tree-name">'+esc(entry.name)+'</span>';row.title=entry.path;row.addEventListener('click',()=>openFile(entry.path));target.append(row);
    }
   }
   if(!filtered.length&&depth===0)target.innerHTML='<div class="editor-tree-message">No supported source files in this workspace.</div>';
  };
  await renderDirectory(dir,list,0);
  root.querySelector('.editor-workspace-name').textContent=state.workspace.name;
 }catch(error){list.innerHTML='<div class="editor-tree-message">'+esc(error.message)+'</div>';}
}
async function openFile(path){
 if(state.tabs.some(t=>t.path===path)){state.active=path;roots.forEach(render);sync();return;}
 try{const content=await window.localAI.workspace.read(path);state.tabs.push({path,content,dirty:false});state.active=path;roots.forEach(render);sync();}
 catch(error){notify('Could not open '+path+': '+error.message);}
}
function closeTab(path){
 const tab=state.tabs.find(t=>t.path===path);if(tab?.dirty&&!confirm('Discard unsaved changes to '+path+'?'))return;
 state.tabs=state.tabs.filter(t=>t.path!==path);if(state.active===path)state.active=state.tabs.at(-1)?.path||'';
 roots.forEach(render);sync();
}
async function save(){
 const tab=state.tabs.find(t=>t.path===state.active);if(!tab||state.busy)return;
 state.busy=true;roots.forEach(r=>r.querySelectorAll('.editor-save').forEach(b=>b.disabled=true));
 try{await window.localAI.workspace.write(tab.path,tab.content);tab.dirty=false;sync();roots.forEach(render);roots.forEach(root=>{const label=root.querySelector('.editor-save-label');if(label)label.textContent='Saved';const output=root.querySelector('.editor-output');if(output)output.textContent='Saved '+tab.path+' to the selected workspace. A previous version was backed up.';});notify('Saved '+tab.path+'. The previous version was backed up.');}
 catch(error){notify('Save cancelled or failed: '+error.message);}
 finally{state.busy=false;roots.forEach(r=>r.querySelectorAll('.editor-save').forEach(b=>b.disabled=!state.tabs.find(t=>t.path===state.active)?.dirty));}
}
function currentCodeContext(root){
 const tab=state.tabs.find(t=>t.path===state.active);if(!tab)return null;
 const focused=document.activeElement;const input=focused?.matches?.('.editor-input')&&root.contains(focused)?focused:root.querySelector('.editor-input');
 const selected=input&&input.selectionEnd>input.selectionStart?input.value.slice(input.selectionStart,input.selectionEnd):'';
 return {tab,selected};
}
function askEditorAI(action,root){
 const context=currentCodeContext(root);if(!context){notify('Open a source file before using the editor assistant.');return;}
 const {tab,selected}=context;
 const task={
  explain:'Explain this code clearly. Describe its purpose, important logic, dependencies, and subtle behavior. Do not modify files.',
  debug:'Review this code for likely bugs, edge cases, incorrect assumptions, and runtime errors. Rank findings by severity and explain how to verify each one. Do not modify files.',
  refactor:'Propose a careful refactor that improves readability and maintainability without changing behavior. Show a complete revised version only if reasonably short; otherwise provide a focused patch. Do not modify files.',
  tests:'Design useful automated tests for this code. Identify the test framework if evident, cover normal cases and edge cases, and provide runnable test examples. Do not modify files.',
  review:'Perform a professional code review. Focus on correctness, security, performance, accessibility where relevant, and maintainability. Report actionable findings and distinguish confirmed issues from hypotheses. Do not modify files.'
 }[action]||'Help me understand this code.';
 const scope=selected?'Selected code':'Full file';
 const code=selected||tab.content;
 const prompt=`You are the coding assistant inside Local AI Runner. The user explicitly requested this analysis. Do not claim to have run code or tests. Do not edit files or assume access beyond the supplied context.\n\nTask: ${task}\n\nFile: ${tab.path}\nContext scope: ${scope}\n\n\`\`\`${ext(tab.path).slice(1)||'text'}\n${code.slice(0,22000)}\n\`\`\``;
 window.localAI.editor.askAI(prompt);
 notify('Sent '+(selected?'the selected code':'the current file')+' to the AI conversation.');
}
async function searchWorkspace(root, query){
 const output=root.querySelector('.editor-search-results');if(!output)return;
 const term=String(query||'').trim().slice(0,200);const sequence=(root._editorSearchSequence||0)+1;root._editorSearchSequence=sequence;
 if(term.length<2){output.innerHTML='<div class="editor-tree-message">Type at least two characters to search the workspace.</div>';return;}
 output.innerHTML='<div class="editor-tree-message">Searching workspace…</div>';
 try{
  const response=await window.localAI.workspace.search(term);
  if(sequence!==root._editorSearchSequence)return;
  const results=response.results||[];output.replaceChildren();
  if(!results.length){output.innerHTML='<div class="editor-tree-message">No matches found.</div>';return;}
  results.forEach(result=>{
   const button=document.createElement('button');button.type='button';button.className='editor-search-result';
   const path=document.createElement('strong');path.textContent=result.path+' · '+result.line;
   const excerpt=document.createElement('span');excerpt.textContent=result.excerpt;button.append(path,excerpt);
   button.addEventListener('click',async()=>{await openFile(result.path);const input=root.querySelector('.editor-input');if(input){const lines=input.value.split(/\r?\n/);let offset=0;for(let i=0;i<Math.max(0,result.line-1);i++)offset+=(lines[i]||'').length+1;input.focus();input.setSelectionRange(offset,offset+(lines[result.line-1]||'').length);}});output.append(button);
  });
  if(response.capped){const note=document.createElement('div');note.className='editor-tree-message';note.textContent='Search limit reached; narrow your query for more results.';output.append(note);}
 }catch(error){if(sequence===root._editorSearchSequence)output.innerHTML='<div class="editor-tree-message">'+esc(error.message)+'</div>';}
}
async function importFiles(root){
 try{
  const result=await window.localAI.workspace.importFiles();
  if(result.cancelled)return;
  if(result.imported?.length){
   await loadTree(root);
   await openFile(result.imported[0].path);
   notify('Imported '+result.imported.length+' file(s): '+result.imported.map(item=>item.name).join(', '));
  }
  if(result.skipped?.length)notify((result.imported?.length||0)+' imported; '+result.skipped.length+' skipped. '+result.skipped.map(item=>item.name+': '+item.reason).join(' · '));
  if(!result.imported?.length&&!result.skipped?.length)notify('No supported files were imported.');
 }catch(error){notify('Could not import files: '+error.message);}
}
async function quickOpen(){
 const value=window.prompt('Open file (workspace-relative path):','');
 if(!value||!value.trim())return;
 const path=value.trim().replace(/\\/g,'/');
 if(path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..')){notify('Enter a safe relative file path.');return;}
 await openFile(path);
}
function findInCurrentFile(root){
 const input=root.querySelector('.editor-input');if(!input)return;
 const query=window.prompt('Find in current file:','');if(!query)return;
 const value=input.value;let index=value.indexOf(query,Math.max(input.selectionEnd,0));
 if(index<0)index=value.indexOf(query);
 if(index<0){notify('No match found in the current file.');return;}
 input.focus();input.setSelectionRange(index,index+query.length);
 const line=value.slice(0,index).split('\n').length;
 const lineHeight=Number.parseFloat(getComputedStyle(input).lineHeight)||18;
 input.scrollTop=Math.max(0,(line-2)*lineHeight);
 updateCursor(root);
}
function indentSelection(input,outdent){
 const value=input.value,start=input.selectionStart,end=input.selectionEnd,unit=' '.repeat(state.preferences.tabSize);
 const lineStart=value.lastIndexOf('\n',Math.max(0,start-1))+1;
 const lineEndRaw=value.indexOf('\n',end);const lineEnd=lineEndRaw<0?value.length:lineEndRaw;
 const block=value.slice(lineStart,lineEnd);
 if(!block.includes('\n')&&start===end){
  if(outdent){const remove=block.startsWith(unit)?unit.length:block.startsWith('\t')?1:0;if(remove){input.setRangeText('',lineStart,lineStart+remove,'end');input.setSelectionRange(Math.max(lineStart,start-remove),Math.max(lineStart,start-remove));}}
  else{input.setRangeText(unit,start,end,'end');}
  return;
 }
 const lines=block.split('\n');
 const changed=lines.map(line=>outdent?(line.startsWith(unit)?line.slice(unit.length):line.startsWith('\t')?line.slice(1):line):unit+line).join('\n');
 input.setRangeText(changed,lineStart,lineEnd,'select');
 input.setSelectionRange(lineStart,Math.max(lineStart,lineStart+changed.length));
}
async function createFile(){
 const path=prompt('New file path, relative to the selected workspace:','new-file.js');if(!path)return;
 if(path.startsWith('/')||path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..')){notify('Enter a safe relative path inside the selected workspace.');return;}
 try{await window.localAI.workspace.create(path,'');await openFile(path);roots.forEach(root=>loadTree(root));}
 catch(error){notify('Could not create file: '+error.message);}
}
function toggleDock(force){
 const dock=document.getElementById('editorDock');if(!dock)return;
 const open=typeof force==='boolean'?force:dock.hidden;dock.hidden=!open;
 document.getElementById('editorDockButton')?.setAttribute('aria-pressed',String(open));
 updateDockLayout();
 if(open)loadTree(document.getElementById('editorDockRoot'));
}
window.addEventListener('editor:dock-layout',()=>updateDockLayout());
function updateDockLayout(){
 const chat=document.getElementById('chatView');if(!chat)return;
 const editorOpen=!document.getElementById('editorDock')?.hidden;
 const browserOpen=!document.getElementById('browserDock')?.hidden;
 chat.classList.toggle('has-editor-dock',editorOpen);
 chat.classList.toggle('has-browser-dock',browserOpen);
 chat.classList.toggle('has-both-docks',editorOpen&&browserOpen);
 document.getElementById('editorDockButton')?.setAttribute('aria-pressed',String(editorOpen));
 document.getElementById('browserDockButton')?.setAttribute('aria-pressed',String(browserOpen));
}
function preferencePanel(){
 return '<div class="editor-custom-panel" hidden><div class="editor-custom-head"><div><strong>Editor appearance</strong><small>Changes apply to the editor in every window.</small></div><button type="button" class="editor-custom-close" data-action="customize">×</button></div><label>Theme<select data-pref="theme"><option value="vscode">Visual Studio Code Dark</option><option value="midnight">Midnight</option><option value="graphite">Graphite</option><option value="light">Light</option><option value="ocean">Ocean</option><option value="forest">Forest</option><option value="custom">Custom colors</option></select></label><label>Code font<select data-pref="fontFamily"><option value="cascadia">Cascadia Code</option><option value="consolas">Consolas</option><option value="system">System monospace</option><option value="fira">Fira Code</option><option value="jetbrains">JetBrains Mono</option></select></label><div class="editor-custom-grid"><label>Font size <output data-output="fontSize"></output><input type="range" min="11" max="22" step="1" data-pref="fontSize"></label><label>Line height <output data-output="lineHeight"></output><input type="range" min="1.2" max="2.2" step="0.1" data-pref="lineHeight"></label><label>Tab size<select data-pref="tabSize"><option value="2">2 spaces</option><option value="4">4 spaces</option><option value="8">8 spaces</option></select></label><label class="editor-check"><input type="checkbox" data-pref="lineNumbers"> Show line numbers</label></div><div class="editor-colors"><label>Background<input type="color" data-pref="background"></label><label>Panel<input type="color" data-pref="panel"></label><label>Text<input type="color" data-pref="text"></label><label>Accent<input type="color" data-pref="accent"></label><label>Keywords<input type="color" data-pref="keyword"></label><label>Strings<input type="color" data-pref="string"></label><label>Numbers<input type="color" data-pref="number"></label><label>Comments<input type="color" data-pref="comment"></label></div><div class="editor-custom-actions"><button type="button" class="btn small" data-action="reset-preferences">Reset</button><button type="button" class="btn small primary" data-action="close-customize">Done</button></div></div>';
}
function mount(root){
 root.innerHTML='<div class="editor-shell"><div class="editor-titlebar"><div class="editor-title-left"><div class="editor-workspace-label"><span class="editor-live-dot"></span><span class="editor-workspace-name">Workspace</span></div><div class="editor-title-caption">LOCAL AI RUNNER</div></div><div class="editor-title-actions"><button type="button" class="btn small" data-action="refresh">Refresh</button><button type="button" class="btn small" data-action="import">Import</button><button type="button" class="btn small" data-action="new">New file</button><button type="button" class="btn small primary editor-save" data-action="save" disabled>Save</button><button type="button" class="btn small" data-action="customize">Appearance</button><button type="button" class="btn small" data-action="popout">Pop out</button></div></div>'+preferencePanel()+'<div class="editor-layout"><nav class="editor-activity" aria-label="Editor views"><button type="button" class="active" title="Explorer" data-action="show-explorer">▤</button><button type="button" title="Search workspace" data-action="focus-search">⌕</button><button type="button" title="AI assistant" data-action="focus-ai">✦</button></nav><aside class="editor-explorer"><div class="editor-explorer-head"><strong>EXPLORER</strong><button type="button" data-action="refresh" title="Refresh files">↻</button></div><input class="editor-search-input" type="search" placeholder="Search in workspace…" aria-label="Search workspace" maxlength="200"><div class="editor-search-results"><div class="editor-tree-message">Search across project files.</div></div><div class="editor-tree-heading">FILES</div><div class="editor-tree"></div></aside><section class="editor-main"><div class="editor-tabs" role="tablist" aria-label="Open editors"></div><div class="editor-breadcrumb"><span class="editor-file-path">No file selected</span></div><div class="editor-work-area"><div class="editor-empty"><div class="editor-empty-mark">⌘</div><strong>Open a file to start editing</strong><p>Select a source file from the Explorer or create a new file.</p></div></div><div class="editor-bottom-panel"><div class="editor-bottom-head"><strong>OUTPUT</strong><span>Workspace activity</span></div><div class="editor-output">Editor ready. Changes are saved to the selected workspace with automatic backups.</div></div><div class="editor-status"><span class="editor-position">Ln 1, Col 1</span><span class="editor-language">TEXT</span><span class="editor-save-label">Ready</span></div></section><aside class="editor-ai-panel"><div class="editor-ai-head"><div><strong>AI ASSISTANT</strong><small>Uses your configured model</small></div><span class="editor-ai-spark">✦</span></div><div class="editor-ai-context">Current file: <span class="editor-ai-file">No file selected</span></div><p class="editor-ai-hint">Select code for focused help, or ask about the entire file.</p><div class="editor-ai-actions"><button type="button" data-ai-action="explain">Explain code</button><button type="button" data-ai-action="debug">Find bugs</button><button type="button" data-ai-action="refactor">Refactor</button><button type="button" data-ai-action="tests">Generate tests</button><button type="button" data-ai-action="review">Review file</button></div><div class="editor-ai-foot">AI suggestions appear in chat. Review them before changing files.</div></aside></div></div>';
 root.addEventListener('click',event=>{
  const aiAction=event.target.closest('[data-ai-action]');if(aiAction&&root.contains(aiAction)){askEditorAI(aiAction.dataset.aiAction,root);return;}
  const button=event.target.closest('[data-action]');if(!button||!root.contains(button))return;
  const action=button.dataset.action;
  if(action==='refresh'){loadTree(root);return;}
  if(action==='tabs-toggle'){root.querySelector('.editor-shell')?.classList.toggle('tabs-collapsed');renderTabs(root);return;}
  if(action==='focus-search'){root.querySelector('.editor-search-input')?.focus();return;}
  if(action==='focus-ai'){
   if(root.id==='editorDockRoot'){
    const shell=root.querySelector('.editor-shell'),open=!shell?.classList.contains('show-ai-panel');
    shell?.classList.toggle('show-ai-panel',open);button.setAttribute('aria-pressed',String(open));return;
   }
   root.querySelector('.editor-ai-panel')?.scrollIntoView({block:'nearest'});root.querySelector('.editor-ai-panel')?.classList.add('editor-ai-pulse');setTimeout(()=>root.querySelector('.editor-ai-panel')?.classList.remove('editor-ai-pulse'),650);return;
  }
  if(action==='show-explorer'){root.querySelector('.editor-tree')?.scrollIntoView({block:'nearest'});return;}
  if(action==='new'){createFile();return;}
  if(action==='import'){importFiles(root);return;}
  if(action==='save'){save();return;}
  if(action==='popout'){window.localAI.editor.openWindow().catch(error=>notify(error.message));return;}
  if(action==='customize'){const panel=root.querySelector('.editor-custom-panel');panel.hidden=!panel.hidden;syncPreferenceControls(panel);return;}
  if(action==='close-customize'){root.querySelector('.editor-custom-panel').hidden=true;return;}
  if(action==='reset-preferences'){applyPreferences({...defaults},true);syncPreferenceControls(root.querySelector('.editor-custom-panel'));return;}
 });
 let searchTimer=null;
 root.querySelector('.editor-search-input')?.addEventListener('input',event=>{clearTimeout(searchTimer);const value=event.target.value;searchTimer=setTimeout(()=>searchWorkspace(root,value),180);});
 root.addEventListener('input',event=>{
  const control=event.target.closest('[data-pref]');if(control&&root.contains(control)){
   const key=control.dataset.pref;let value=control.type==='checkbox'?control.checked:control.type==='range'?Number(control.value):control.value;
   if(key==='tabSize')value=Number(value);
   if(['background','panel','text','accent','keyword','string','number','comment'].includes(key))state.preferences.theme='custom';
   applyPreferences({[key]:value},true);
   const output=root.querySelector('[data-output="'+key+'"]');if(output)output.textContent=String(value)+(key==='fontSize'?' px':key==='lineHeight'?'×':'');
   return;
  }
  if(!event.target.matches('.editor-input'))return;
  const tab=state.tabs.find(t=>t.path===state.active);if(!tab)return;
  tab.content=event.target.value;tab.dirty=true;
  const wrap=event.target.closest('.editor-code-wrap');
  wrap.querySelector('.editor-highlight').innerHTML=highlight(tab.content,ext(tab.path).slice(1))+'\n';
  wrap.querySelector('.editor-gutter').innerHTML=lineGutter(tab.content);
  renderTabs(root);updateCursor(root);root.querySelector('.editor-save').disabled=false;const label=root.querySelector('.editor-save-label');if(label)label.textContent='Modified';
  syncDebounced();
 });
 root.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save();return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='p'){event.preventDefault();quickOpen();return;}
  if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();root.querySelector('.editor-search-input')?.focus();return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'&&event.target.matches('.editor-input')){event.preventDefault();findInCurrentFile(root);return;}
  if(event.target.matches('.editor-input')){
   if(event.key==='Tab'){event.preventDefault();indentSelection(event.target,event.shiftKey);event.target.dispatchEvent(new Event('input',{bubbles:true}));}
   if(event.key==='Escape'&&event.target.closest('.editor-code-wrap'))event.target.blur();
  }
 });
 root.addEventListener('keyup',()=>updateCursor(root));
 root.addEventListener('click',event=>{if(event.target.matches('.editor-input'))updateCursor(root);});
 root.addEventListener('scroll',event=>{if(!event.target.matches('.editor-input'))return;const w=event.target.closest('.editor-code-wrap');w.querySelector('.editor-highlight').scrollTop=event.target.scrollTop;w.querySelector('.editor-highlight').scrollLeft=event.target.scrollLeft;w.querySelector('.editor-gutter').scrollTop=event.target.scrollTop;},true);
 loadTree(root);
}
let syncTimer=null;
function syncDebounced(){clearTimeout(syncTimer);syncTimer=setTimeout(sync,180);}
roots.forEach(mount);
document.getElementById('editorDockButton')?.addEventListener('click',()=>toggleDock());
document.getElementById('openProjectEditor')?.addEventListener('click',()=>{
 const root=document.getElementById('projectEditorRoot');if(!root)return;
 const show=root.hidden;root.hidden=!show;if(show){root.scrollIntoView({behavior:'smooth',block:'start'});loadTree(root);}
});
document.getElementById('editorPopoutPage')?.addEventListener('click',()=>window.localAI.editor.openWindow().catch(error=>notify(error.message)));
document.getElementById('browserDockButton')?.addEventListener('click',updateDockLayout);
async function initialize(){
 try{
  const [shared,prefs]=await Promise.all([window.localAI.editor.getSync(),window.localAI.editor.getPreferences()]);
  if(shared?.tabs?.length){state.tabs=shared.tabs;state.active=shared.active||'';}
  applyPreferences(prefs||defaults,false);
  roots.forEach(root=>{render(root);syncPreferenceControls(root.querySelector('.editor-custom-panel'));});
  sync();
 }catch(error){notify('Editor initialization failed: '+error.message);}
 updateDockLayout();
}
initialize();
})();
