import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CATEGORIES = ['components','motion','design','icons','fonts','3d','data','tools','other'];
const uniq = values => [...new Set((Array.isArray(values) ? values : []).map(String).map(x => x.trim()).filter(Boolean))];
const cleanText = (value, max = 180) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const posix = value => value.split(path.sep).join('/');

function routeCategory(item = {}) {
  const hay = new Set([
    String(item.type || '').toLowerCase(),
    ...uniq(item.tags).map(x => x.toLowerCase()),
    ...uniq(item.categories).map(x => x.toLowerCase()),
  ]);
  const has = (...terms) => terms.some(term => hay.has(term));
  if (has('motion','animation','transitions','microinteractions','scrollytelling')) return 'motion';
  if (has('icon','icons','svg')) return 'icons';
  if (has('font','fonts','typography')) return 'fonts';
  if (has('3d','webgl')) return '3d';
  if (has('chart','charts','visualization','table','data-grid','maps')) return 'data';
  if (has('design','reference','styles','designmd','presentations','website','websites','minimal')) return 'design';
  if (has('developer-tool','developer-tools','tool','coding-agent','cli','email','voice','audio','generator','memory')) return 'tools';
  if (has('component','components','block','blocks','react','tailwind','shadcn','ui','primitives','headless','application-ui')) return 'components';
  return 'other';
}

async function walkJsonl(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkJsonl(file));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(file);
  }
  return files.sort();
}

async function readRegistryRows(root) {
  const base = path.join(root, 'registry', 'sources');
  const rows = [];
  for (const file of await walkJsonl(base)) {
    const text = await readFile(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item?.id) rows.push({ item, detail: posix(path.relative(root, file)) });
      } catch {
        // The normal WebForge audit owns parse diagnostics. The ChatGPT index skips malformed rows.
      }
    }
  }
  return rows;
}

function compactSource(source = {}) {
  return {
    i: String(source.id || ''),
    n: String(source.name || source.id || ''),
    a: String(source.adapter || 'reference'),
    t: uniq(source.tags).slice(0, 8),
    k: String(source.kind || 'source'),
    u: String(source.url || ''),
    r: Boolean(source.remote),
    c: Boolean(source.allowCodeIngest),
  };
}

function compactAsset(item = {}, detail = '') {
  const perf = item.performance?.runtime_cost || item.performance?.cost || item.performance?.runtimeCost || null;
  return {
    i: String(item.id || ''),
    n: cleanText(item.title || item.name || item.id, 100),
    s: String(item.source?.id || String(item.id || '').split('/')[0] || 'unknown'),
    y: String(item.type || 'component'),
    t: uniq(item.tags).slice(0, 10),
    c: uniq(item.categories).slice(0, 8),
    f: uniq(item.frameworks).slice(0, 6),
    l: item.license?.id || null,
    m: item.install?.mode || ((item.files || []).length ? 'cached-files' : 'none'),
    p: perf,
    x: cleanText(item.description, 180),
    d: detail,
  };
}

export async function buildChatGPTIndex(root = process.cwd()) {
  root = path.resolve(root);
  const sourcesPath = path.join(root, 'sources.json');
  const sources = JSON.parse(await readFile(sourcesPath, 'utf8'));
  if (!Array.isArray(sources)) throw new Error('sources.json must contain a JSON array');

  const outDir = path.join(root, 'chatgpt');
  const shardDir = path.join(outDir, 'shards');
  await rm(shardDir, { recursive: true, force: true });
  await mkdir(shardDir, { recursive: true });

  const rows = await readRegistryRows(root);
  const shards = Object.fromEntries(CATEGORIES.map(name => [name, []]));
  for (const row of rows) {
    const compact = compactAsset(row.item, row.detail);
    shards[routeCategory(row.item)].push(compact);
  }
  for (const items of Object.values(shards)) items.sort((a, b) => a.i.localeCompare(b.i));

  const shardMeta = {};
  for (const name of CATEGORIES) {
    const items = shards[name];
    const shardPath = path.join(shardDir, `${name}.jsonl`);
    const body = items.map(x => JSON.stringify(x)).join('\n') + (items.length ? '\n' : '');
    await writeFile(shardPath, body, 'utf8');
    shardMeta[name] = { p: `chatgpt/shards/${name}.jsonl`, n: items.length };
  }

  const index = {
    v: 1,
    purpose: 'token-light GitHub retrieval entrypoint for ChatGPT',
    instructions: 'CHATGPT.md',
    counts: { sources: sources.length, assets: rows.length },
    fields: {
      source: { i: 'id', n: 'name', a: 'adapter', t: 'tags', k: 'kind', u: 'url', r: 'remote', c: 'code-ingest-allowed' },
      asset: { i: 'id', n: 'name', s: 'source', y: 'type', t: 'tags', c: 'categories', f: 'frameworks', l: 'license', m: 'install-mode', p: 'performance-cost', x: 'short-description', d: 'detail-file' },
    },
    shards: shardMeta,
    sources: sources.map(compactSource).sort((a, b) => a.i.localeCompare(b.i)),
  };

  await writeFile(path.join(outDir, 'INDEX.min.json'), JSON.stringify(index) + '\n', 'utf8');
  return { sources: sources.length, assets: rows.length, shards: Object.fromEntries(CATEGORIES.map(name => [name, shards[name].length])) };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  buildChatGPTIndex(process.argv[2] || process.cwd())
    .then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(error => {
      process.stderr.write(`ChatGPT index error: ${error.message}\n`);
      process.exitCode = 1;
    });
}
