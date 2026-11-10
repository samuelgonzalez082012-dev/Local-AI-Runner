(() => {
  'use strict';
  let listening = false;
  const setup = async () => {
    const root = document.getElementById('workspace-redesign-root');
    if (!root || root.dataset.providerReady) return;
    root.dataset.providerReady = '1';
    if (!listening) { listening = true; window.addEventListener('lair:team-instruction', async event => { const model = root.querySelector('#wr-global-model')?.value; const feed = root.querySelector('.wr-events'); const statusNode = root.querySelector('#wr-global-status'); if (!model) { if(statusNode) statusNode.textContent='Connect OpenRouter and choose a Planner model before sending team instructions.'; return; } try { const d=event.detail||{}; const result=await window.localAI.openRouter.chat({model,messages:[{role:'system',content:'You are the Planner. You alone may assign or reassign work. Developers can ask questions and report progress but cannot delegate. Explain a concise plan and list assignments. Do not claim to execute tools or edit files.'},{role:'user',content:'Recipient: '+d.to+'. User instruction: '+d.message}],temperature:0.2,max_tokens:1200}); const answer=result.choices?.[0]?.message?.content||'Planner returned no response.'; if(feed){const row=document.createElement('article');row.className='wr-event';row.textContent='Planner · '+answer;feed.prepend(row);} await window.localAI.agentEvents.append({type:'planner-response',agentId:'planner',summary:'Planner coordination response',detail:answer}); } catch(error) { if(statusNode) statusNode.textContent=error.message; } }); }
    const panel = document.createElement('details');
    panel.className = 'wr-provider-drawer';
    panel.innerHTML = '<summary>Provider settings · OpenRouter</summary><div class="wr-provider-body"><input id="wr-global-key" type="password" autocomplete="off" placeholder="OpenRouter API key"><button id="wr-global-save">Save key securely</button><select id="wr-global-model"><option>Connect to load models</option></select><button id="wr-global-test">Test connection</button><p id="wr-global-status" role="status">Key storage is handled by Electron secure storage.</p></div>';
    root.append(panel);
    const status = panel.querySelector('#wr-global-status');
    const models = panel.querySelector('#wr-global-model');
    const load = async () => {
      try {
        const state = await window.localAI.openRouter.status();
        if (!state.connected) { status.textContent = 'Not connected.'; return; }
        const items = await window.localAI.openRouter.models();
        models.replaceChildren();
        for (const item of items) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name + ' — ' + item.id; models.append(option); }
        status.textContent = 'Connected · ' + items.length + ' models available.';
      } catch (error) { status.textContent = error.message; }
    };
    panel.querySelector('#wr-global-save').onclick = async () => {
      try { await window.localAI.openRouter.setKey(panel.querySelector('#wr-global-key').value); panel.querySelector('#wr-global-key').value = ''; await load(); }
      catch (error) { status.textContent = error.message; }
    };
    panel.querySelector('#wr-global-test').onclick = load;
    await load();
  };
  const observer = new MutationObserver(setup);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { setup(); observer.observe(document.body, { childList: true, subtree: true }); });
  else { setup(); observer.observe(document.body, { childList: true, subtree: true }); }
})();