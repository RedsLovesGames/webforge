import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initWorkspace, addSource, installAsset, getAssetAny } from '../webforge.mjs';

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'webforge-remote-'));
  await initWorkspace(root, { seedSources: false });
  return root;
}

test('21st remote get and install delegate selected result with literal arguments', async () => {
  const root = await workspace();
  await addSource(root, {
    id: '21st', name: '21st', url: 'https://21st.dev',
    adapter: 'remote-provider', provider: '21st', remote: true,
    authEnv: 'API_KEY_21ST'
  });
  const project = path.join(root, 'project');
  await mkdir(project);
  const calls = [];
  const context = {
    authToken: 'test-key',
    commandExists: async () => true,
    spawnCapture: async (exe, args) => {
      calls.push({ kind: 'get', exe, args });
      return { status: 0, stdout: 'component details', stderr: '' };
    },
    spawnCommand: async (exe, args, opts) => {
      calls.push({ kind: 'install', exe, args, cwd: opts.cwd });
      return { status: 0 };
    }
  };

  const item = await getAssetAny(root, '21st/pricing-1', { context });
  assert.equal(item.id, '21st/pricing-1');
  assert.equal(item.meta.providerOutput, 'component details');

  const installed = await installAsset(root, '21st/pricing-1', project, { context });
  assert.equal(installed.mode, 'remote');
  const call = calls.find(entry => entry.kind === 'install');
  assert.deepEqual(call.args, ['@21st-dev/cli@latest', 'add', 'pricing-1']);
  assert.equal(call.cwd, path.resolve(project));
});
