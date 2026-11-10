'use strict';
const BASE = 'https://openrouter.ai/api/v1';
function createOpenRouterService({ safeStorage, fs, path, userData }) {
  const keyPath = path.join(userData, 'openrouter-key.bin');
  async function getKey() {
    try { const encrypted = await fs.readFile(keyPath); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(encrypted) : ''; }
    catch { return ''; }
  }
  async function setKey(value) {
    const key = String(value || '').trim();
    if (key && !key.startsWith('sk-or-')) throw new Error('That does not look like an OpenRouter API key.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this device.');
    if (key) await fs.writeFile(keyPath, safeStorage.encryptString(key), { mode: 0o600 });
    else await fs.rm(keyPath, { force: true });
    return { connected: !!key };
  }
  async function request(endpoint, options = {}) {
    const key = await getKey();
    if (!key) throw new Error('Add an OpenRouter API key in Settings first.');
    const response = await fetch(BASE + endpoint, { ...options, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://local-ai-runner.app', 'X-Title': 'Local AI Runner', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || 'OpenRouter request failed (' + response.status + ').');
    return body;
  }
  return {
    setKey,
    status: async () => ({ connected: !!(await getKey()) }),
    models: async () => (await request('/models')).data || [],
    chat: async payload => {
      if (!payload || !Array.isArray(payload.messages) || payload.messages.length > 100) throw new Error('Invalid chat request.');
      const model = String(payload.model || '').slice(0, 200);
      if (!model) throw new Error('Choose an OpenRouter model.');
      return request('/chat/completions', { method: 'POST', body: JSON.stringify({ model, messages: payload.messages, temperature: Math.max(0, Math.min(2, Number(payload.temperature ?? 0.2))), max_tokens: Math.max(1, Math.min(16000, Number(payload.max_tokens ?? 4000))) }) });
    }
  };
}
module.exports = { createOpenRouterService };
