'use strict';
const DEFAULT_TEAM = {
  planner: { name: 'Planner', provider: 'openrouter', model: '' },
  'developer-1': { name: 'Developer 1', provider: 'openrouter', model: '' },
  'developer-2': { name: 'Developer 2', provider: 'ollama', model: 'qwen2.5-coder:7b' },
  reviewer: { name: 'Reviewer', provider: 'openrouter', model: '' }
};
const MAX_CONTEXT = 120000;
function safeText(value, limit = 4000) { return String(value ?? '').slice(0, limit); }
function parseJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Agent response did not contain the required JSON result.');
  return JSON.parse(raw.slice(start, end + 1));
}
function createAgentOrchestrator({ fs, path, userData, openRouter, workspace, emit }) {
  const configPath = path.join(userData, 'agent-team-config.json');
  let config = structuredClone(DEFAULT_TEAM), active = null;
  async function load() {
    try {
      const saved = JSON.parse(await fs.readFile(configPath, 'utf8'));
      for (const id of Object.keys(DEFAULT_TEAM)) if (saved[id]) {
        const v = saved[id];
        config[id] = { name: safeText(v.name || DEFAULT_TEAM[id].name, 50), provider: v.provider === 'ollama' ? 'ollama' : 'openrouter', model: safeText(v.model, 200), baseUrl: safeText(v.baseUrl || 'http://127.0.0.1:11434', 300) };
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  async function save(next) {
    const out = {};
    for (const id of Object.keys(DEFAULT_TEAM)) {
      const v = next?.[id] || config[id], provider = v.provider === 'ollama' ? 'ollama' : 'openrouter';
      let baseUrl = safeText(v.baseUrl || 'http://127.0.0.1:11434', 300).replace(/\/$/, '');
      if (provider === 'ollama') {
        const url = new URL(baseUrl);
        if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('Ollama must use a localhost HTTP endpoint.');
        baseUrl = url.origin;
      }
      out[id] = { name: safeText(v.name || DEFAULT_TEAM[id].name, 50), provider, model: safeText(v.model, 200), baseUrl };
    }
    config = out;
    await fs.mkdir(userData, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    return structuredClone(config);
  }
  async function callAgent(id, messages, options = {}) {
    const agent = config[id] || config.planner;
    if (!agent.model) throw new Error('Choose a model for ' + agent.name + ' in Team settings.');
    const signal = active?.controller?.signal;
    if (agent.provider === 'openrouter') {
      const result = await openRouter.chat({ model: agent.model, messages, temperature: 0.2, max_tokens: options.maxTokens || 4000, signal });
      return result.choices?.[0]?.message?.content || '';
    }
    const url = new URL(agent.baseUrl || 'http://127.0.0.1:11434');
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('Ollama endpoint must remain on localhost.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(url.origin + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: agent.model, messages, stream: false, options: { temperature: 0.2 } }), signal: controller.signal, redirect: 'error' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Ollama request failed (' + response.status + ').');
      return data.message?.content || '';
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(signal?.aborted ? 'Team run stopped.' : 'Ollama request timed out.');
      throw e;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async function listModels(provider = 'openrouter', baseUrl = 'http://127.0.0.1:11434') {
    if (provider !== 'ollama') return (await openRouter.models()).map(m => ({ id: m.id, name: m.name || m.id }));
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('Ollama model discovery is restricted to localhost.');
    const response = await fetch(url.origin + '/api/tags', { redirect: 'error' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load Ollama models.');
    return (data.models || []).map(m => ({ id: m.name, name: m.name }));
  }
  async function record(type, agentId, summary, detail = '', taskId = '') {
    return emit({ type, agentId, taskId, summary: safeText(summary, 500), detail: safeText(detail, 2000) });
  }
  async function run(instruction) {
    if (active) throw new Error('A team run is already active. Stop it before starting another.');
    const prompt = safeText(instruction?.message, 8000).trim();
    if (!prompt) throw new Error('Enter an instruction for the team.');
    active = { id: Date.now().toString(36), cancelled: false, controller: new AbortController() };
    const runId = active.id, proposals = [];
    try {
      await record('run-started', 'planner', 'Planner started a team run', prompt, runId);
      const workspaceInfo = await workspace.getInfo();
      const files = workspaceInfo ? await workspace.list('') : [];
      const plannerPrompt = [
        'You are the Planner for a software agent team. You are the ONLY role that may create or assign tasks. Developers may only execute their assigned task, report progress, or request clarification. Never claim a tool was used.',
        'Return ONLY valid JSON: {"plan":"short decision summary","assignments":[{"agentId":"developer-1|developer-2","task":"specific task"}],"needsUserInput":""}. Maximum 4 assignments. Assign only developers. The Reviewer is invoked separately after developers propose changes. Do not include chain-of-thought.',
        'User instruction: ' + prompt,
        'Workspace: ' + JSON.stringify(workspaceInfo),
        'Workspace files: ' + JSON.stringify(files.slice(0, 100))
      ].join('\n\n');
      const planText = await callAgent('planner', [{ role: 'system', content: 'Return concise task plans as JSON only.' }, { role: 'user', content: plannerPrompt }], { maxTokens: 1800 });
      let plan;
      try { plan = parseJson(planText); } catch { plan = { plan: planText.slice(0, 1200), assignments: [{ agentId: 'developer-1', task: prompt }] }; }
      let assignments = Array.isArray(plan.assignments) ? plan.assignments.slice(0, 4).filter(x => ['developer-1', 'developer-2'].includes(x.agentId) && safeText(x.task, 3000).trim()) : [];
      if (!assignments.length && !plan.needsUserInput) assignments = [{ agentId: 'developer-1', task: prompt }];
      await record('plan-created', 'planner', safeText(plan.plan || 'Plan created', 500), JSON.stringify(assignments), runId);
      const contextFiles = [];
      if (workspaceInfo) for (const f of files.filter(x => x.type === 'file').slice(0, 12)) {
        if (active?.cancelled) throw new Error('Team run stopped.');
        try { contextFiles.push({ path: f.path, content: safeText(await workspace.read(f.path), 7000) }); } catch {}
      }
      for (const task of assignments) {
        if (active?.cancelled) throw new Error('Team run stopped.');
        await record('task-started', task.agentId, safeText(task.task, 500), '', runId);
        const answer = await callAgent(task.agentId, [
          { role: 'system', content: 'You are ' + config[task.agentId].name + '. Complete only the Planner-assigned task. You may not delegate or change task ownership. Return ONLY JSON: {"summary":"...","findings":["..."],"files":[{"path":"relative/path","mode":"create|update","content":"complete file contents"}],"questions":[]}. Do not include private chain-of-thought. Do not make up file contents; if unable to complete, return no files and explain why. Never propose absolute paths, traversal, secrets, binaries, or files over 1 MB.' },
          { role: 'user', content: 'Assigned task: ' + task.task + '\nUser objective: ' + prompt + '\nAvailable project context: ' + JSON.stringify(contextFiles).slice(0, MAX_CONTEXT) }
        ], { maxTokens: 6000 });
        let result;
        try { result = parseJson(answer); } catch { result = { summary: answer.slice(0, 1800), findings: [], files: [], questions: [] }; }
        for (const f of (Array.isArray(result.files) ? result.files.slice(0, 8) : [])) {
          const rel = safeText(f.path, 300).replace(/\\/g, '/');
          if (!rel || rel.startsWith('/') || /^[a-z]:/i.test(rel) || rel.split('/').some(p => p === '..' || p === '')) continue;
          const content = safeText(f.content, 1000000);
          if (Buffer.byteLength(content, 'utf8') > 1000000) continue;
          proposals.push({ path: rel, mode: f.mode === 'create' ? 'create' : 'update', content, agentId: task.agentId, summary: safeText(result.summary, 500) });
        }
        await record('task-completed', task.agentId, safeText(result.summary || 'Task completed', 500), JSON.stringify({ findings: result.findings || [], questions: result.questions || [], proposedFiles: (result.files || []).length }), runId);
      }
      if (active?.cancelled) throw new Error('Team run stopped.');
      if (proposals.length) {
        const reviewText = await callAgent('reviewer', [
          { role: 'system', content: 'You are the Reviewer. Review proposed changes only. Do not edit files or delegate. Return JSON {"summary":"...","issues":["..."],"approvedPaths":["..."]}. Assess correctness, safety, consistency, and test coverage. No chain-of-thought.' },
          { role: 'user', content: JSON.stringify({ objective: prompt, proposals: proposals.map(p => ({ path: p.path, mode: p.mode, content: p.content.slice(0, 30000) })) }).slice(0, MAX_CONTEXT) }
        ], { maxTokens: 2200 });
        let review;
        try { review = parseJson(reviewText); } catch { review = { summary: reviewText.slice(0, 1500), issues: [], approvedPaths: [] }; }
        await record('review-completed', 'reviewer', safeText(review.summary || 'Review completed', 500), JSON.stringify(review), runId);
        for (const p of proposals) p.review = { summary: safeText(review.summary, 500), issues: Array.isArray(review.issues) ? review.issues.slice(0, 20).map(x => safeText(x, 300)) : [], approved: Array.isArray(review.approvedPaths) && review.approvedPaths.includes(p.path) };
      }
      await record('run-completed', 'planner', 'Team run completed; proposed files require user approval', JSON.stringify({ proposalCount: proposals.length }), runId);
      return { runId, plan: safeText(plan.plan, 1500), needsUserInput: safeText(plan.needsUserInput, 1000), assignments, proposals };
    } catch (error) {
      await record('run-error', 'planner', 'Team run stopped or failed', error.message, runId);
      throw error;
    } finally { active = null; }
  }
  return {
    load, getConfig: () => structuredClone(config), saveConfig: save, listModels, run,
    stop: () => { if (active) { active.cancelled = true; active.controller.abort(); } return !!active; },
    isRunning: () => !!active
  };
}
module.exports = { createAgentOrchestrator, DEFAULT_TEAM };
