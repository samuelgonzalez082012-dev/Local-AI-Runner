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
  workspace: Object.freeze({
    choose() { return ipcRenderer.invoke('workspace:choose'); },
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
  })
}));
