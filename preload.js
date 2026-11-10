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
    openWindow() { return ipcRenderer.invoke('editor:open-window'); },
    getSync() { return ipcRenderer.invoke('editor:sync:get'); },
    setSync(value) { ipcRenderer.send('editor:sync:set', value); },
    onSync(callback) { return subscribe('editor:sync:update', callback); },
    getPreferences() { return ipcRenderer.invoke('editor:preferences:get'); },
    setPreferences(value) { return ipcRenderer.invoke('editor:preferences:set', value); },
    onPreferences(callback) { return subscribe('editor:preferences:update', callback); }
  }),
  openRouter: Object.freeze({
    setKey(value) { return ipcRenderer.invoke('openrouter:set-key', String(value || '')); },
    status() { return ipcRenderer.invoke('openrouter:status'); },
    models() { return ipcRenderer.invoke('openrouter:models'); },
    chat(payload) { return ipcRenderer.invoke('openrouter:chat', payload); }
  }),
  agentTeam: Object.freeze({
    getConfig() { return ipcRenderer.invoke('agent-team:config:get'); },
    saveConfig(value) { return ipcRenderer.invoke('agent-team:config:set', value); },
    models(provider, baseUrl) { return ipcRenderer.invoke('agent-team:models', provider, baseUrl); },
    templates() { return ipcRenderer.invoke('agent-team:templates:list'); },
    saveTemplate(name) { return ipcRenderer.invoke('agent-team:templates:save', String(name || '')); },
    loadTemplate(name) { return ipcRenderer.invoke('agent-team:templates:load', String(name || '')); },
    run(message, to) { return ipcRenderer.invoke('agent-team:run', { message: String(message || ''), to: String(to || 'team') }); },
    pause() { return ipcRenderer.invoke('agent-team:pause'); },
    resume() { return ipcRenderer.invoke('agent-team:resume'); },
    stop() { return ipcRenderer.invoke('agent-team:stop'); },
    status() { return ipcRenderer.invoke('agent-team:status'); }
  }),
  agentEvents: Object.freeze({
    append(payload) { return ipcRenderer.invoke('agent-events:append', payload); },
    list(options) { return ipcRenderer.invoke('agent-events:list', options || {}); },
    onUpdate(callback) { return subscribe('agent-events:update', callback); }
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
