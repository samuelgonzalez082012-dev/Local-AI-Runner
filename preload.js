'use strict';

const { contextBridge, ipcRenderer } = require('electron');
let nextRequestId = 0;

function subscribeStream(id, onPacket) {
  const channel = `local-ai:stream-result:${id}`;
  const listener = (_event, packet) => {
    try { onPacket(packet); }
    finally {
      if (packet && ['done','error','http-error','aborted'].includes(packet.type)) ipcRenderer.removeListener(channel, listener);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('A callback is required.');
  const listener = (_event, payload) => { try { callback(payload); } catch (error) { console.error(error); } };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('localAI', Object.freeze({
  request(options) { return ipcRenderer.invoke('local-ai:request', options); },
  approveServer(baseUrl) { return ipcRenderer.invoke('local-ai:approve-server', baseUrl); },
  stream(options, onPacket) {
    if (typeof onPacket !== 'function') throw new TypeError('A stream callback is required.');
    const id = `${Date.now()}_${++nextRequestId}_${Math.random().toString(36).slice(2,8)}`;
    const unsubscribe = subscribeStream(id, onPacket);
    ipcRenderer.send('local-ai:stream-start', { id, options });
    return id;
  },
  abortStream(id) { ipcRenderer.send('local-ai:stream-abort', String(id || '')); },
  extractDocument(payload) { return ipcRenderer.invoke('documents:extract', payload); },
  system: Object.freeze({ metrics() { return ipcRenderer.invoke('system:metrics'); } }),
  credentials: Object.freeze({
    getApiKey() { return ipcRenderer.invoke('credentials:get-api-key'); },
    setApiKey(value) { return ipcRenderer.invoke('credentials:set-api-key', value); }
  }),
  editor: Object.freeze({
    askAI(prompt) { ipcRenderer.send('editor:ai-request', String(prompt || '')); return true; },
    onAIRequest(callback) { return subscribe('editor:ai-request', callback); },
    openWindow() { return ipcRenderer.invoke('editor:open-window'); },
    getSync() { return ipcRenderer.invoke('editor:sync:get'); },
    setSync(value) { ipcRenderer.send('editor:sync:set', value); },
    onSync(callback) { return subscribe('editor:sync:update', callback); },
    getPreferences() { return ipcRenderer.invoke('editor:preferences:get'); },
    setPreferences(value) { return ipcRenderer.invoke('editor:preferences:set', value); },
    onPreferences(callback) { return subscribe('editor:preferences:update', callback); }
  }),
  openRouter: Object.freeze({
    status() { return ipcRenderer.invoke('openrouter:status'); },
    setKey(value) { return ipcRenderer.invoke('openrouter:key:set', String(value || '')); },
    models() { return ipcRenderer.invoke('openrouter:models'); },
    chat(payload) { return ipcRenderer.invoke('openrouter:chat', payload || {}); }
  }),
  work: Object.freeze({
    state() { return ipcRenderer.invoke('work:state'); },
    setFileWritesEnabled(value) { return ipcRenderer.invoke('work:file-writes:set-enabled', value === true); },
    saveTeam(payload) { return ipcRenderer.invoke('work:team:save', payload); },
    saveTemplate(name) { return ipcRenderer.invoke('work:team:save-template', String(name || '')); },
    loadTemplate(id) { return ipcRenderer.invoke('work:team:load-template', String(id || '')); },
    addMemory(payload) { return ipcRenderer.invoke('work:memory:add', payload); },
    proposeMemory(payload, agentId) { return ipcRenderer.invoke('work:memory:propose', payload, String(agentId || '')); },
    approveMemory(id) { return ipcRenderer.invoke('work:memory:approve', String(id || '')); },
    updateMemory(id, patch) { return ipcRenderer.invoke('work:memory:update', String(id || ''), patch || {}); },
    removeMemory(id) { return ipcRenderer.invoke('work:memory:remove', String(id || '')); },
    setLayout(payload) { return ipcRenderer.invoke('work:layout:set', payload); },
    createTask(payload) { return ipcRenderer.invoke('work:task:create', payload); },
    updateTask(id, patch) { return ipcRenderer.invoke('work:task:update', String(id || ''), patch || {}); },
    sendMessage(payload) { return ipcRenderer.invoke('work:message:send', payload); },
    messages(agentId, taskId) { return ipcRenderer.invoke('work:message:list', String(agentId || ''), String(taskId || '')); },
    acquireLock(payload) { return ipcRenderer.invoke('work:lock:acquire', payload); },
    releaseLock(id) { return ipcRenderer.invoke('work:lock:release', String(id || '')); },
    cancelLockRequest(id) { return ipcRenderer.invoke('work:lock:cancel-request', String(id || '')); },
    renewLock(id) { return ipcRenderer.invoke('work:lock:renew', String(id || '')); },
    writeFile(payload) { return ipcRenderer.invoke('work:workspace:write', payload || {}); }
  }),
  tools: Object.freeze({
    register(definitions) { return ipcRenderer.invoke('tools:register', definitions); },
    validate(name, args) { return ipcRenderer.invoke('tools:validate', { name: String(name || ''), args }); },
    catalog() { return ipcRenderer.invoke('tools:catalog'); },
    audit(limit) { return ipcRenderer.invoke('tools:audit', limit); },
    record(entry) { return ipcRenderer.invoke('tools:record', entry); }
  }),
  workspace: Object.freeze({
    choose(title) { return ipcRenderer.invoke('workspace:choose', title); },
    setFolder(folderPath) { return ipcRenderer.invoke('workspace:set-folder', String(folderPath || '')); },
    importFiles() { return ipcRenderer.invoke('workspace:import'); },
    info() { return ipcRenderer.invoke('workspace:info'); },
    list(relativePath) { return ipcRenderer.invoke('workspace:list', relativePath); },
    read(relativePath) { return ipcRenderer.invoke('workspace:read', relativePath); },
    search(query, relativePath) { return ipcRenderer.invoke('workspace:search', { query, relativePath }); },
    create(relativePath, content) { return ipcRenderer.invoke('workspace:create', { relativePath, content }); },
    write(relativePath, content) { return ipcRenderer.invoke('workspace:write', { relativePath, content }); },
    backups() { return ipcRenderer.invoke('workspace:backups'); },
    restoreBackup(id) { return ipcRenderer.invoke('workspace:restore', String(id || '')); }
  }),
  connectors: Object.freeze({
    add(payload) { return ipcRenderer.invoke('connectors:add', payload); },
    list() { return ipcRenderer.invoke('connectors:list'); },
    remove(id) { return ipcRenderer.invoke('connectors:remove', id); },
    call(payload) { return ipcRenderer.invoke('connectors:call', payload); }
  }),
  browser: Object.freeze({
    setBounds(rect) { return ipcRenderer.invoke('browser:set-bounds', rect); },
    setVisible(value) { return ipcRenderer.invoke('browser:set-visible', !!value); },
    setAskNewSites(value) { return ipcRenderer.invoke('browser:set-ask-new-sites', !!value); },
    setAutoApprove(value, ask) { return ipcRenderer.invoke('browser:set-auto-approve', !!value, ask === true); },
    interrupt() { return ipcRenderer.invoke('browser:interrupt'); },
    setAgentActive(value) { return ipcRenderer.invoke('browser:set-agent-active', !!value); },
    state() { return ipcRenderer.invoke('browser:state'); },
    navigate(url) { return ipcRenderer.invoke('browser:navigate', String(url == null ? '' : url)); },
    action(name) { return ipcRenderer.invoke('browser:action', String(name || '')); },
    tab(op, payload) { return ipcRenderer.invoke('browser:tab', String(op || ''), payload); },
    clearData() { return ipcRenderer.invoke('browser:clear-data'); },
    tool(name, args) { return ipcRenderer.invoke('browser:tool', { name: String(name || ''), args: args || {} }); },
    onState(callback) { return subscribe('browser:state', callback); },
    onActivity(callback) { return subscribe('browser:activity', callback); },
    onReveal(callback) { return subscribe('browser:reveal', callback); }
  })
}));
