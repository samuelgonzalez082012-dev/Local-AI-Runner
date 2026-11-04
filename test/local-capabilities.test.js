'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

test('exposes local project, memory, workflow and task tools through the validated registry', () => {
  for (const name of [
    'list_local_projects', 'create_local_project',
    'list_local_memories', 'save_local_memory', 'delete_local_memory',
    'list_local_tasks', 'list_reusable_workflows', 'create_reusable_workflow',
    'create_local_task', 'run_saved_workflow'
  ]) {
    assert.match(renderer, new RegExp(`name:\\s*'${name}'`));
  }
  assert.match(renderer, /const safeArgs=await window\.localAI\.tools\.validate\(name,args\|\|\{\}\)/);
});

test('persistent local operations require confirmation and save before reporting success', () => {
  assert.match(renderer, /title: 'Save local memory\?'/);
  assert.match(renderer, /title: 'Create local project\?'/);
  assert.match(renderer, /title: 'Save reusable workflow\?'/);
  assert.match(renderer, /title: runAt \? 'Schedule local task\?' : args\.start_after_response \? 'Run local task after this response\?' : 'Save local task\?'/);
  assert.match(renderer, /await database\.set\('memories', next\);\s*memories = next;/);
  assert.match(renderer, /await database\.set\('workflows', next\);\s*workflows = next;/);
  assert.match(renderer, /await database\.set\('tasks', next\);\s*tasks = next;/);
});

test('model-started tasks are deferred until the current response has released its run slot', () => {
  assert.match(renderer, /if \(args\.start_after_response\) queuedAgentTaskRuns\.push\(task\.id\)/);
  assert.match(renderer, /if \(running\.size === 0 && queuedAgentTaskRuns\.length\)/);
  assert.match(renderer, /async function drainQueuedAgentTasks\(\)/);
  assert.match(renderer, /if\(drainingAgentTaskRuns\|\|running\.size\)return/);
});

test('web search uses the visible approved browser and treats result text as untrusted', () => {
  assert.match(renderer, /defineBrowserTool\('search_web'/);
  assert.match(renderer, /https:\/\/html\.duckduckgo\.com\/html\//);
  assert.match(renderer, /await browserCall\('navigate', \{ url: url\.href \}\)/);
  assert.match(renderer, /return untrusted\(results,/);
});
