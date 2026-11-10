'use strict';
function createAgentEventStore({ fs, path, userData }) {
  const file = path.join(userData, 'agent-events.json');
  let events = [];
  let queue = Promise.resolve();
  async function load() { try { const value = JSON.parse(await fs.readFile(file, 'utf8')); events = Array.isArray(value) ? value.slice(-5000) : []; } catch { events = []; } }
  async function append(event) {
    const safe = { id: String(event.id || (Date.now() + '-' + Math.random().toString(36).slice(2))), at: new Date().toISOString(), type: String(event.type || 'activity').slice(0, 50), agentId: String(event.agentId || 'planner').slice(0, 80), taskId: String(event.taskId || '').slice(0, 100), summary: String(event.summary || '').slice(0, 500), detail: String(event.detail || '').slice(0, 2000), file: String(event.file || '').slice(0, 500) };
    events.push(safe); events = events.slice(-5000);
    queue = queue.then(() => fs.writeFile(file, JSON.stringify(events, null, 2), { mode: 0o600 }));
    await queue; return safe;
  }
  return { load, append, list: ({ limit = 200, agentId, type } = {}) => events.filter(e => (!agentId || e.agentId === agentId) && (!type || e.type === type)).slice(-Math.max(1, Math.min(1000, Number(limit) || 200))) };
}
module.exports = { createAgentEventStore };
