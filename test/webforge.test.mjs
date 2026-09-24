import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  initWorkspace,
  normalizeRegistryPayload,
  rebuildIndex,
  searchAssets,
  getAsset,
  installAsset,
  addSource,
  listSources,
  auditRegistry,
  tokenizeSearch,
} from '../webforge.mjs';

async function tempWorkspace() {
  const dir = await mkdtemp(path.join(tmpdir(), 'webforge-test-'));
  await initWorkspace(dir, { seedSources: false });
  return dir;
}

test('normalizes a shadcn-style registry into compact WebForge assets', async () => {
  const items = normalizeRegistryPayload({
    name: 'demo',
    homepage: 'https://example.com',
    items: [{
      name: 'hero-glow',
      title: 'Hero Glow',
      description: 'Animated marketing hero',
      type: 'registry:block',
      dependencies: ['motion'],
      registryDependencies: ['button'],
      files: [{ path: 'components/hero-glow.tsx', type: 'registry:component', content: 'export const Hero = () => null;' }]
    }]
  }, { id: 'demo', url: 'https://example.com/registry.json', adapter: 'shadcn', allowCodeIngest: true });

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'demo/hero-glow');
  assert.equal(items[0].type, 'block');
  assert.deepEqual(items[0].dependencies, ['motion']);
  assert.equal(items[0].files[0].path, 'components/hero-glow.tsx');
});

test('indexes and searches registry items with filters', async () => {
  const root = await tempWorkspace();
  const registryDir = path.join(root, 'registry', 'sources');
  await mkdir(registryDir, { recursive: true });
  const rows = [
    { id: 'demo/hero', name: 'hero', title: 'Dark Dashboard Hero', description: 'Compact animated analytics header', type: 'block', source: { id: 'demo', url: 'https://example.com' }, tags: ['dark','dashboard','hero'], dependencies: [], registryDependencies: [], files: [], license: { id: 'MIT' } },
    { id: 'other/footer', name: 'footer', title: 'Simple Footer', description: 'Minimal footer', type: 'block', source: { id: 'other', url: 'https://other.test' }, tags: ['footer'], dependencies: [], registryDependencies: [], files: [], license: { id: 'MIT' } }
  ];
  await writeFile(path.join(registryDir, 'demo.jsonl'), rows.map(x => JSON.stringify(x)).join('\n') + '\n');
  await rebuildIndex(root);

  const hits = searchAssets(root, 'dark dashboard', { type: 'block', source: 'demo', limit: 5 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'demo/hero');
  assert.equal(getAsset(root, 'demo/hero').title, 'Dark Dashboard Hero');
});

test('safe installer writes component files but refuses traversal', async () => {
  const root = await tempWorkspace();
  const registryDir = path.join(root, 'registry', 'sources');
  await mkdir(registryDir, { recursive: true });
  const good = { id: 'demo/card', name: 'card', title: 'Card', description: '', type: 'component', source: { id: 'demo', url: 'https://example.com' }, tags: [], dependencies: [], registryDependencies: [], files: [{ path: 'components/card.tsx', content: 'export const Card = 1;' }], license: { id: 'MIT' } };
  await writeFile(path.join(registryDir, 'demo.jsonl'), JSON.stringify(good) + '\n');
  await rebuildIndex(root);
  const project = path.join(root, 'project');
  await mkdir(project);

  const result = await installAsset(root, 'demo/card', project, { installDependencies: false });
  assert.equal(result.filesWritten.length, 1);
  assert.equal(await readFile(path.join(project, 'components/card.tsx'), 'utf8'), 'export const Card = 1;');

  const bad = { ...good, id: 'demo/bad', files: [{ path: '../escape.txt', content: 'bad' }] };
  await writeFile(path.join(registryDir, 'bad.jsonl'), JSON.stringify(bad) + '\n');
  await rebuildIndex(root);
  await assert.rejects(() => installAsset(root, 'demo/bad', project, { installDependencies: false }), /unsafe/i);
});

test('source catalog can be extended without modifying program code', async () => {
  const root = await tempWorkspace();
  await addSource(root, { url: 'https://example.com/ui', adapter: 'reference', id: 'example-ui' });
  const sources = await listSources(root);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].id, 'example-ui');
});

test('audit reports duplicate IDs and unknown licensing', async () => {
  const root = await tempWorkspace();
  const registryDir = path.join(root, 'registry', 'sources');
  await mkdir(registryDir, { recursive: true });
  const a = { id: 'demo/x', name: 'x', title: 'X', type: 'component', source: { id: 'demo', url: 'https://example.com' }, tags: [], dependencies: [], registryDependencies: [], files: [] };
  await writeFile(path.join(registryDir, 'a.jsonl'), JSON.stringify(a) + '\n' + JSON.stringify(a) + '\n');
  const report = await auditRegistry(root);
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.missingLicense.length, 1);
});

test('search tokenization strips FTS operators and punctuation', () => {
  assert.equal(tokenizeSearch('dark OR dashboard: hero*'), 'dark dashboard hero');
});

test('MCP stdio exposes search tools after initialize', async () => {
  const root = await tempWorkspace();
  const child = spawn(process.execPath, [path.resolve('webforge.mjs'), 'mcp', '--root', root], {
    cwd: path.resolve('.'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines = [];
  child.stdout.setEncoding('utf8');
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop();
    lines.push(...parts.filter(Boolean));
  });

  const waitFor = async (predicate, timeout = 3000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      for (const line of lines) {
        const msg = JSON.parse(line);
        if (predicate(msg)) return msg;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for MCP response`);
  };

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n');
  const init = await waitFor(msg => msg.id === 1);
  assert.equal(init.result.serverInfo.name, 'webforge');

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  const listed = await waitFor(msg => msg.id === 2);
  assert.ok(listed.result.tools.some(tool => tool.name === 'webforge_search'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'webforge_install'));

  child.stdin.end();
  await new Promise(resolve => child.once('close', resolve));
});
