(() => {
  'use strict';
  const setup = async () => {
    const root = document.getElementById('workspace-redesign-root');
    if (!root || root.dataset.providerReady) return;
    root.dataset.providerReady = '1';
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