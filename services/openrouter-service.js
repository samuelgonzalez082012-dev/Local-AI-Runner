'use strict';
const { atomicWriteFile } = require('./atomic-file');
const BASE = 'https://openrouter.ai/api/v1';
function createOpenRouterService({ safeStorage, fs, path, userData }) {
  const keyPath = path.join(userData, 'openrouter-key.bin');
  async function getKey() {
    try {
      const stat = await fs.lstat(keyPath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16384) return '';
      const encrypted = await fs.readFile(keyPath);
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(encrypted) : '';
    } catch { return ''; }
  }
  async function setKey(value) {
    const key = String(value || '').trim();
    if (key && !key.startsWith('sk-or-')) throw new Error('That does not look like an OpenRouter API key.');
    if (!key) { await fs.rm(keyPath, { force: true }); return { connected: false }; }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this device.');
    await fs.mkdir(userData, { recursive: true });
    await atomicWriteFile(keyPath, safeStorage.encryptString(key), { mode: 0o600 });
    return { connected: !!key };
  }
  async function request(endpoint, options = {}) {
    const key = await getKey();
    if (!key) throw new Error('Add an OpenRouter API key in Team settings first.');
    const timeout = AbortSignal.timeout(120000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response;
    try {
      response = await fetch(BASE + endpoint, {
        ...options, signal,
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://local-ai-runner.app',
          'X-Title': 'Local AI Runner',
          ...(options.headers || {})
        }
      });
    } catch (e) {
      if (e.name === 'AbortError' || e.name === 'TimeoutError') throw new Error(options.signal?.aborted ? 'Team run stopped.' : 'OpenRouter request timed out.');
      throw e;
    }
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
      const messages = payload.messages.map(message => {
        if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new Error('Invalid chat message.');
        if (message.content.length > 120000) throw new Error('Chat message exceeds the supported size.');
        return { role: message.role, content: message.content };
      });
      return request('/chat/completions', {
        method: 'POST',
        signal: payload.signal,
        body: JSON.stringify({
          model, messages,
          temperature: Math.max(0, Math.min(2, Number(payload.temperature ?? 0.2))),
          max_tokens: Math.max(1, Math.min(16000, Number(payload.max_tokens ?? 4000)))
        })
      });
    }
  };
}
module.exports = { createOpenRouterService };
