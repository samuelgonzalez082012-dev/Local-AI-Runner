'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createWorkspaceService } = require('../services/workspace-service');

test('imports source files into the selected workspace without overwriting existing files', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-import-test-'));
  const workspacePath = path.join(base, 'workspace');
  const sourcePath = path.join(base, 'source');
  const userDataPath = path.join(base, 'user-data');
  await Promise.all([fs.mkdir(workspacePath), fs.mkdir(sourcePath)]);
  const sourceFile = path.join(sourcePath, 'app.js');
  await fs.writeFile(sourceFile, 'console.log("imported");', 'utf8');
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: [sourceFile] }) };
  try {
    const workspace = createWorkspaceService({ dialog, app: { getPath: () => userDataPath } });
    await workspace.setFolder(workspacePath);
    const first = await workspace.importFiles();
    assert.equal(first.imported.length, 1);
    assert.equal(first.imported[0].path, 'app.js');
    assert.equal(await fs.readFile(path.join(workspacePath, 'app.js'), 'utf8'), 'console.log("imported");');

    await fs.writeFile(sourceFile, 'console.log("second copy");', 'utf8');
    const second = await workspace.importFiles();
    assert.equal(second.imported.length, 1);
    assert.equal(second.imported[0].path, 'app (imported 2).js');
    assert.equal(await fs.readFile(path.join(workspacePath, 'app.js'), 'utf8'), 'console.log("imported");');
    assert.equal(await fs.readFile(path.join(workspacePath, 'app (imported 2).js'), 'utf8'), 'console.log("second copy");');
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('folder-backed project roots must resolve to existing directories', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-folder-project-test-'));
  try {
    const folder = path.join(base, 'project');
    await fs.mkdir(folder);
    const workspace = createWorkspaceService({ dialog: {}, app: { getPath: () => path.join(base, 'user-data') } });
    const info = await workspace.setFolder(folder);
    assert.equal(info.name, 'project');
    assert.equal(info.path, await fs.realpath(folder));
    await assert.rejects(() => workspace.setFolder(path.join(base, 'missing')));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});


test('workspace search finds case-insensitive matches with stable line metadata', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-search-test-'));
  const workspacePath = path.join(base, 'workspace');
  try {
    await fs.mkdir(path.join(workspacePath, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspacePath, 'src', 'app.js'), 'const first = 1;\nfunction FindMe() {\n  return first;\n}\n', 'utf8');
    await fs.writeFile(path.join(workspacePath, 'README.md'), 'Nothing relevant here.\n', 'utf8');
    const workspace = createWorkspaceService({ dialog: {}, app: { getPath: () => path.join(base, 'user-data') } });
    await workspace.setFolder(workspacePath);
    const result = await workspace.search('findme');
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].path, 'src/app.js');
    assert.equal(result.results[0].line, 2);
    assert.match(result.results[0].excerpt, /FindMe/);
    await assert.rejects(() => workspace.search('x'), /at least two characters/i);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
