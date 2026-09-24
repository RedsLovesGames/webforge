import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildChatGPTIndex } from '../scripts/build-chatgpt-index.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webforge-chatgpt-'));
  await writeFile(path.join(root, 'sources.json'), JSON.stringify([
    { id: 'magicui', name: 'Magic UI', adapter: 'shadcn', tags: ['components','animation','react'], url: 'https://magicui.design', allowCodeIngest: false },
    { id: 'refero', name: 'Refero', adapter: 'design', tags: ['design','styles'], url: 'https://example.com', allowCodeIngest: false },
  ]));
  await mkdir(path.join(root, 'registry', 'sources'), { recursive: true });
  const rows = [
    { id: 'magicui/animated-beam', title: 'Animated Beam', description: 'Animated connection beam for hero sections', type: 'component', source: { id: 'magicui' }, tags: ['components','animation','hero'], frameworks: ['react'], license: { id: 'MIT' }, install: { mode: 'shadcn' }, files: [{ path: 'beam.tsx', content: 'SECRET SOURCE CODE SHOULD NEVER ENTER CHATGPT SHARD' }] },
    { id: 'refero/linear-dark', title: 'Linear Dark', description: 'Dark precise product style', type: 'design', source: { id: 'refero' }, tags: ['design','styles'], designMd: '# huge style body must not leak' },
  ];
  await writeFile(path.join(root, 'registry', 'sources', 'sample.jsonl'), rows.map(x => JSON.stringify(x)).join('\n') + '\n');
  return root;
}

test('builds tiny routing index and category shards without source-code bodies', async () => {
  const root = await fixture();
  const result = await buildChatGPTIndex(root);
  assert.equal(result.sources, 2);
  assert.equal(result.assets, 2);
  assert.equal(result.shards.motion, 1);
  assert.equal(result.shards.design, 1);

  const indexText = await readFile(path.join(root, 'chatgpt', 'INDEX.min.json'), 'utf8');
  const index = JSON.parse(indexText);
  assert.equal(index.counts.assets, 2);
  assert.equal(index.sources[0].i, 'magicui');
  assert.ok(index.shards.motion.p.endsWith('motion.jsonl'));

  const motion = await readFile(path.join(root, 'chatgpt', 'shards', 'motion.jsonl'), 'utf8');
  assert.match(motion, /magicui\/animated-beam/);
  assert.doesNotMatch(motion, /SECRET SOURCE CODE/);
  assert.doesNotMatch(motion, /files/);
  assert.doesNotMatch(motion, /designMd/);
});

test('output is deterministic across rebuilds', async () => {
  const root = await fixture();
  await buildChatGPTIndex(root);
  const first = await readFile(path.join(root, 'chatgpt', 'INDEX.min.json'), 'utf8');
  await buildChatGPTIndex(root);
  const second = await readFile(path.join(root, 'chatgpt', 'INDEX.min.json'), 'utf8');
  assert.equal(first, second);
});

test('works before any provider snapshots exist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webforge-chatgpt-empty-'));
  await writeFile(path.join(root, 'sources.json'), JSON.stringify([{ id: 'shadcn', name: 'shadcn/ui', adapter: 'shadcn', tags: ['components'], url: 'https://ui.shadcn.com' }]));
  const result = await buildChatGPTIndex(root);
  assert.equal(result.sources, 1);
  assert.equal(result.assets, 0);
  const index = JSON.parse(await readFile(path.join(root, 'chatgpt', 'INDEX.min.json'), 'utf8'));
  assert.equal(index.shards.components.n, 0);
});
