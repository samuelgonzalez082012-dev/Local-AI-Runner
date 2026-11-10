'use strict';
const path=require('node:path');
const {app,BrowserWindow}=require('electron');
(async()=>{
 const checks=[];
 const check=(name,ok,detail='')=>{checks.push({name,ok:!!ok,detail});console.log((ok?'PASS ':'FAIL ')+name+(detail?' — '+detail:''));};
 await app.whenReady();
 const win=new BrowserWindow({width:1400,height:950,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 try{
  await win.loadFile(path.join(__dirname,'workspace-smoke.html'));
  const ready=await win.webContents.executeJavaScript("new Promise(resolve=>{const start=Date.now();const tick=()=>{if(document.querySelector('#workspace-redesign-root'))resolve(true);else if(Date.now()-start>7000)resolve(false);else setTimeout(tick,50);};tick();})");
  check('workspace shell mounts in Electron',ready);
  const initial=await win.webContents.executeJavaScript("({tabs:[...document.querySelectorAll('.wr-global-tabs .wr-tab')].map(x=>x.dataset.tab),active:document.querySelector('.wr-panel-content')?.dataset.surface,nodes:document.querySelectorAll('.wr-agent-node').length,provider:!!document.querySelector('.wr-provider-drawer')})");
  check('all app surfaces are exposed as tabs',initial.tabs.includes('chat')&&initial.tabs.includes('agent-team')&&initial.tabs.includes('editor')&&initial.tabs.includes('browser')&&initial.tabs.includes('files')&&initial.tabs.includes('activity'),JSON.stringify(initial.tabs));
  check('Agent Control Center and OpenRouter settings mount',initial.active==='agent-team'&&initial.nodes===4&&initial.provider,JSON.stringify(initial));
  await win.webContents.executeJavaScript("document.querySelector('[data-agent=developer-1]').click()");
  const inspector=await win.webContents.executeJavaScript("document.querySelector('.wr-inspector-role')?.textContent||''");
  check('agent selection updates inspector',inspector.includes('Developer 1'),inspector);
  await win.webContents.executeJavaScript("(()=>{const dt=new DataTransfer();dt.setData('text/plain','editor');const panel=document.querySelector('.wr-panel');panel.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));panel.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));})()");
  const split=await win.webContents.executeJavaScript("({panels:document.querySelectorAll('.wr-stage .wr-panel').length,groups:document.querySelectorAll('.wr-panel .wr-group-tabs').length,layout:window.LocalAIWorkspaceLayout.get()})");
  check('dragging a tab creates a second split group',split.panels===2&&split.groups===2&&split.layout.groups.length===2,JSON.stringify({panels:split.panels,groups:split.groups}));
  await win.webContents.executeJavaScript("document.querySelector('[data-action=orientation]').click()");
  const orientation=await win.webContents.executeJavaScript("document.querySelector('.wr-stage')?.classList.contains('vertical')");
  check('split orientation changes',orientation===true);
  await win.webContents.executeJavaScript("document.querySelector('[data-tab=agent-team]').click();document.querySelector('#wr-team-settings').click()");
  const settings=await win.webContents.executeJavaScript("({roles:document.querySelectorAll('[data-config-agent]').length,models:document.querySelectorAll('select[data-model]').length})");
  check('per-agent role and model settings render',settings.roles===4&&settings.models===4,JSON.stringify(settings));
  await win.webContents.executeJavaScript("document.querySelector('.wr-settings').hidden=true;document.querySelector('#wr-message').value='Run a smoke task';document.querySelector('#wr-recipient').value='developer-2';document.querySelector('#wr-send').click()");
  const run=await win.webContents.executeJavaScript("new Promise(resolve=>{const start=Date.now();const tick=()=>{const text=document.querySelector('#wr-run-result')?.textContent||'';if(text.includes('Smoke plan completed'))resolve({text,calls:window.__smokeCalls});else if(Date.now()-start>5000)resolve({text,calls:window.__smokeCalls});else setTimeout(tick,50);};tick();})");
  check('team composer routes individual request via Planner',run.text.includes('Smoke plan completed')&&run.calls[0]?.to==='developer-2',JSON.stringify(run.calls));
  await win.webContents.executeJavaScript("document.querySelector('[data-tab=activity]').click()");
  const timeline=await win.webContents.executeJavaScript("({mounted:!!document.querySelector('.wr-timeline'),items:document.querySelectorAll('.wr-timeline-item').length})");
  check('structured activity timeline renders persisted events',timeline.mounted&&timeline.items>0,JSON.stringify(timeline));
  await win.webContents.executeJavaScript("window.__workspacePath='/workspace/other';document.querySelector('[data-tab=chat]').click()");
  const projectLayout=await win.webContents.executeJavaScript("({key:Object.keys(localStorage).find(k=>k.endsWith('/workspace/other')),active:window.LocalAIWorkspaceLayout.get().groups.some(g=>g.tabs.includes('chat'))})");
  check('layout state switches to the selected project',!!projectLayout.key&&projectLayout.active,JSON.stringify(projectLayout));
 }catch(error){console.error(error);check('Electron workspace smoke run',false,error.message);}
 finally{await win.destroy();const failed=checks.filter(x=>!x.ok);console.log('WORKSPACE SMOKE: '+(checks.length-failed.length)+'/'+checks.length+' passed');app.exit(failed.length?1:0);}
})().catch(error=>{console.error(error);app.exit(2);});
setTimeout(()=>{console.error('Workspace smoke test timed out');app.exit(3);},30000);
