# WebForge Deep Source Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade WebForge v0.1 into a deep, token-light provider system that can search, retrieve, and install assets from high-value component/design sources without mirroring every catalog or bloating agent context.

**Architecture:** Preserve the existing Git + JSONL + SQLite FTS5 + CLI/MCP design. Move provider-specific behavior behind `src/adapters/`, keep local SQLite search primary, add opt-in remote fan-out for providers such as 21st, and add explicit install strategies (`cached-files`, `shadcn`, `command`, `remote`, `none`). Durable source records remain JSONL; caches and provider state stay under `.webforge/`.

**Tech Stack:** Node.js 22.5+, ES modules, built-in `node:sqlite`, built-in test runner, `fetch`, child-process spawning, JSONL registries, stdio MCP.

**Spec:** `docs/superpowers/specs/2026-09-23-webforge-deep-adapters-design.md`

## Global Constraints

- Preserve the v0.1 CLI and MCP surface unless an extension is additive.
- Keep the core runnable on Node.js 22.5+ without mandatory third-party runtime dependencies.
- Keep large catalogs outside normal model context.
- Never assume public availability means permission to mirror source code.
- Keep unknown-license content reference-only.
- Do not require credentials for WebForge startup, local search, or unrelated providers.
- A failed remote provider must not delete or invalidate its last successful local records.
- Provider-specific logic must not accumulate in `src/core.mjs`.
- Full code ingestion remains opt-in through source policy.
- Remote fan-out remains opt-in.
- Deterministic tests must not require third-party uptime or real credentials.

## File Structure

### Existing files modified

- `src/core.mjs` — shared registry/index orchestration only; delegates provider work.
- `src/catalog.mjs` — seed-source declarations and new ecosystem entries.
- `src/cli.mjs` — additive provider/design/discovery/remote-search commands.
- `src/mcp.mjs` — additive compact provider/design/discovery tools.
- `webforge.mjs` — export newly public orchestration functions.
- `sources.json` — configured deep providers and new capability/reference sources.
- `test/webforge.test.mjs` — regression coverage for old behavior and public API.
- `README.md` — operator documentation.
- `AGENTS.md` — compact retrieval guidance only if required by new remote/design flows.

### New files

- `src/adapters/index.mjs` — adapter registry and deterministic resolver.
- `src/adapters/reference.mjs` — generic HTML metadata reference adapter.
- `src/adapters/shadcn.mjs` — shadcn registry/root/item/include parser and metadata installer address generation.
- `src/adapters/deck-gallery.mjs` — Deck public catalog adapter.
- `src/adapters/design.mjs` — Refero/DESIGN.md-style design record adapter.
- `src/adapters/vibeindex.mjs` — discovery-candidate adapter.
- `src/adapters/remote-provider.mjs` — optional 21st-style remote provider delegation.
- `src/adapters/command-provider.mjs` — safe executable/argument-array provider operations.
- `src/provider-context.mjs` — injected fetch/spawn/cache helpers used by adapters.
- `src/install.mjs` — install strategy dispatcher.
- `src/search.mjs` — local + optional remote search orchestration and deduplication.
- `src/discovery.mjs` — discovery queue persistence and approval workflow.
- `test/adapters.test.mjs` — deterministic adapter tests.
- `test/providers.test.mjs` — provider/install/remote tests.
- `test/fixtures/shadcn/*.json` — root/item/include fixtures.
- `test/fixtures/deck/*.json` — deck/product catalog fixtures.
- `test/fixtures/design/*.json` — style/DESIGN.md fixtures.
- `test/fixtures/discovery/*.json` — VibeIndex-like discovery fixtures.

## Review Focus

1. **Provider outage with an existing snapshot:** sync must report the provider failure and keep the previous JSONL unchanged.
2. **Malicious command/item text:** no install path may concatenate user input into a shell command; spawn executable and argument arrays only.
3. **Missing optional auth:** 21st/remote search must return `auth_required` while local search still succeeds.
4. **Large remote/design payloads:** compact search/MCP results must exclude file bodies and DESIGN.md bodies until explicit `get`.
5. **Legacy v0.1 rows and projects:** existing JSONL rows, local search, cached-file install safety, and old CLI/MCP commands must remain functional.

---

### Task 1: Extract the adapter boundary without changing behavior

**Files:**
- Create: `src/adapters/index.mjs`
- Create: `src/adapters/reference.mjs`
- Create: `src/provider-context.mjs`
- Modify: `src/core.mjs`
- Test: `test/adapters.test.mjs`

**Interfaces:**
- Produces: `resolveAdapter(source, context) -> adapter`
- Produces: `createProviderContext(root, overrides?) -> { fetchText, fetchJson, writeSnapshot, cache, spawnCommand }`
- Adapter minimum contract: `{ id, probe(source, context), sync(source, context) }`
- `core.syncSource()` consumes only the adapter contract and no provider-specific source IDs.

- [ ] **Step 1: Write failing adapter-resolution tests**

Add tests that assert:

```js
const adapter = await resolveAdapter({ id:'x', adapter:'reference', url:'https://example.test' }, context);
assert.equal(adapter.id, 'reference');

const auto = await resolveAdapter({ id:'x', adapter:'auto', url:'https://example.test' }, fakeContext);
assert.equal(auto.id, 'reference');
```

Also assert an unknown explicit adapter rejects with `/unknown adapter/i`.

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
node --test test/adapters.test.mjs
```

Expected: FAIL because `src/adapters/index.mjs` and resolver exports do not exist.

- [ ] **Step 3: Implement the minimal adapter registry and reference adapter**

Implement `reference` by moving current HTML-title/description normalization out of `core.mjs`. Implement deterministic resolver priority and explicit-adapter lookup. Keep existing reference record shape compatible.

- [ ] **Step 4: Delegate `syncSource()` through the resolver**

`core.mjs` may own source lookup, index rebuild, and JSONL reads; it must call the resolved adapter for source-specific synchronization.

- [ ] **Step 5: Run targeted and full tests**

```bash
node --test test/adapters.test.mjs
npm test
```

Expected: all existing v0.1 tests plus adapter tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/adapters src/provider-context.mjs src/core.mjs test/adapters.test.mjs
git commit -m "refactor: add WebForge adapter boundary"
```

---

### Task 2: Add atomic provider snapshots and HTTP cache primitives

**Files:**
- Modify: `src/provider-context.mjs`
- Modify: `src/core.mjs`
- Test: `test/providers.test.mjs`

**Interfaces:**
- Produces: `context.writeSnapshot(sourceId, items) -> { path, count }`
- Produces: `context.fetchText(url, options?)`
- Produces: `context.fetchJson(url, options?)`
- Cache root: `.webforge/cache/providers/<source-id>/`

- [ ] **Step 1: Write a failing snapshot-preservation test**

Create a prior `registry/sources/demo.jsonl`, inject a provider that throws `unavailable`, run sync, then assert the previous file bytes are unchanged.

- [ ] **Step 2: Verify RED**

```bash
node --test test/providers.test.mjs --test-name-pattern="preserves prior snapshot"
```

Expected: FAIL because adapter failures currently do not use an atomic snapshot helper.

- [ ] **Step 3: Implement temp-write plus rename**

Write normalized output to a sibling temporary file, flush/close it, then atomically rename over the source JSONL only after successful normalization.

- [ ] **Step 4: Add HTTP cache metadata**

Persist provider cache metadata containing `etag`, `lastModified`, and `fetchedAt`. Send conditional headers on subsequent fetches when present. Treat `304` as reuse of cached response body.

- [ ] **Step 5: Add structured provider error normalization**

Use codes: `auth_required`, `rate_limited`, `unavailable`, `invalid_payload`, `unsupported`. Preserve `Retry-After` information on rate-limited responses.

- [ ] **Step 6: Run tests**

```bash
node --test test/providers.test.mjs
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/provider-context.mjs src/core.mjs test/providers.test.mjs
git commit -m "feat: add atomic provider snapshots and cache"
```

---

### Task 3: Implement the rich shadcn adapter

**Files:**
- Create: `src/adapters/shadcn.mjs`
- Create: `test/fixtures/shadcn/root.json`
- Create: `test/fixtures/shadcn/item.json`
- Create: `test/fixtures/shadcn/include-a.json`
- Create: `test/fixtures/shadcn/include-b.json`
- Modify: `src/adapters/index.mjs`
- Modify: `src/core.mjs`
- Test: `test/adapters.test.mjs`

**Interfaces:**
- Produces: `normalizeShadcnPayload(payload, source, options) -> WebForgeItem[]`
- Produces install metadata: `{ mode:'shadcn', address:'@namespace/item', requiresAuth:false }` when configured for CLI installation.
- Preserves `dependencies`, `devDependencies`, `registryDependencies`, categories, docs, env vars, CSS, CSS variables, font metadata, and safe file descriptors.

- [ ] **Step 1: Add failing rich-normalization tests**

Assert a fixture survives normalization with:

```js
assert.deepEqual(item.categories, ['marketing']);
assert.equal(item.docs, 'https://example.test/docs/card');
assert.deepEqual(item.envVars, { NEXT_PUBLIC_DEMO: 'required' });
assert.equal(item.cssVars.light.primary, '0 0% 100%');
assert.equal(item.install.mode, 'shadcn');
```

- [ ] **Step 2: Add failing include tests**

Cover nested include success, include-cycle rejection, and duplicate item-name rejection.

- [ ] **Step 3: Verify RED**

```bash
node --test test/adapters.test.mjs --test-name-pattern="shadcn"
```

- [ ] **Step 4: Implement registry root/item parsing**

Support a registry root with `items`, a single registry item, and include resolution through injected fetch. Do not retain file `content` unless source policy allows code ingestion.

- [ ] **Step 5: Implement target placeholder preservation**

Preserve item targets such as `@ui/`, `@components/`, `@lib/`, and `@hooks/` as metadata for shadcn CLI installs rather than resolving them into arbitrary local paths inside the adapter.

- [ ] **Step 6: Run targeted/full tests**

```bash
node --test test/adapters.test.mjs
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/adapters/shadcn.mjs src/adapters/index.mjs src/core.mjs test/adapters.test.mjs test/fixtures/shadcn
git commit -m "feat: add rich shadcn registry adapter"
```

---

### Task 4: Add install-strategy dispatch and command safety

**Files:**
- Create: `src/install.mjs`
- Create: `src/adapters/command-provider.mjs`
- Modify: `src/core.mjs`
- Modify: `webforge.mjs`
- Test: `test/providers.test.mjs`
- Test: `test/webforge.test.mjs`

**Interfaces:**
- Produces: `installItem(root, item, projectRoot, options, context)`
- Strategies: `cached-files`, `shadcn`, `command`, `remote`, `none`
- `spawnCommand(executable, args, options)` never receives a shell-built command string.

- [ ] **Step 1: Write failing shell-injection tests**

Use an item ID such as `button;echo hacked` and assert the injected spawn recorder receives it as one literal argument, not shell text.

- [ ] **Step 2: Verify RED**

```bash
node --test test/providers.test.mjs --test-name-pattern="command install"
```

- [ ] **Step 3: Move cached-file installation behind `cached-files` strategy**

Preserve existing path traversal and overwrite behavior exactly.

- [ ] **Step 4: Add shadcn install strategy**

Run the official CLI through argument arrays, e.g. executable `npx`, args `['shadcn@latest','add',address]`, with `cwd=projectRoot`, `shell:false` on POSIX and a controlled Windows executable resolver rather than interpolated shell text.

- [ ] **Step 5: Add generic command strategy**

Validate configured executable and argument template tokens. Only substitute whole argument values such as `{item}` and `{project}`.

- [ ] **Step 6: Run tests**

```bash
node --test test/providers.test.mjs
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/install.mjs src/adapters/command-provider.mjs src/core.mjs webforge.mjs test/providers.test.mjs test/webforge.test.mjs
git commit -m "feat: add safe provider install strategies"
```

---

### Task 5: Configure shadcn, Magic UI, Watermelon, and Motion Primitives as real providers

**Files:**
- Modify: `src/catalog.mjs`
- Modify: `sources.json`
- Modify: `README.md`
- Test: `test/providers.test.mjs`

**Interfaces:**
- Magic UI items use shadcn namespace/install addresses.
- Watermelon uses registry endpoints where configured.
- Motion Primitives uses command install metadata, e.g. `npx motion-primitives@latest add <component>`.
- shadcn/ui uses shadcn registry semantics.

- [ ] **Step 1: Write failing source-policy tests**

Assert the four sources no longer seed as generic `reference` providers and that code ingestion remains false unless explicitly permitted.

- [ ] **Step 2: Verify RED**

```bash
node --test test/providers.test.mjs --test-name-pattern="seeded deep providers"
```

- [ ] **Step 3: Update source configuration**

Record adapter IDs, namespace/manifest/install metadata, tags, known license fields where verified, and explicit `policy` objects. Do not set code/media ingestion true merely to make sync easier.

- [ ] **Step 4: Add fixture-backed provider sync/install metadata tests**

Do not call live services in deterministic tests.

- [ ] **Step 5: Run tests**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/catalog.mjs sources.json README.md test/providers.test.mjs
git commit -m "feat: configure high-value component providers"
```

---

### Task 6: Add Deck.gallery catalog ingestion

**Files:**
- Create: `src/adapters/deck-gallery.mjs`
- Create: `test/fixtures/deck/decks.json`
- Create: `test/fixtures/deck/products.json`
- Modify: `src/adapters/index.mjs`
- Test: `test/adapters.test.mjs`

**Interfaces:**
- Fetches catalog endpoints configured on source metadata.
- Produces one reference record per deck/product.
- Preserves creator attribution and canonical URL.
- Never downloads purchased files or imagery by default.

- [ ] **Step 1: Add failing normalization tests**

Assert fixture records produce distinct IDs, creator metadata, canonical URLs, tags, and `install.mode === 'none'`.

- [ ] **Step 2: Verify RED**

```bash
node --test test/adapters.test.mjs --test-name-pattern="Deck"
```

- [ ] **Step 3: Implement the adapter**

Normalize both deck and product catalogs into reference records. Keep provider attribution in `meta`/source fields.

- [ ] **Step 4: Run tests**

```bash
node --test test/adapters.test.mjs
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/adapters/deck-gallery.mjs src/adapters/index.mjs test/adapters.test.mjs test/fixtures/deck
git commit -m "feat: ingest Deck gallery catalog metadata"
```

---

### Task 7: Add design-record retrieval for Refero and DESIGN.md

**Files:**
- Create: `src/adapters/design.mjs`
- Create: `test/fixtures/design/styles.json`
- Create: `src/design.mjs`
- Modify: `src/adapters/index.mjs`
- Modify: `src/core.mjs`
- Modify: `webforge.mjs`
- Test: `test/adapters.test.mjs`
- Test: `test/providers.test.mjs`

**Interfaces:**
- Produces design records with compact searchable metadata and optional `design.designMd` body.
- Produces: `searchDesign(root, query, options) -> compact[]`
- Produces: `getDesign(root, id) -> full design record | null`

- [ ] **Step 1: Add failing compact/full design tests**

Assert search output does not contain DESIGN.md body while explicit `getDesign` returns it.

- [ ] **Step 2: Verify RED**

```bash
node --test test/providers.test.mjs --test-name-pattern="design"
```

- [ ] **Step 3: Implement design normalization**

Index title, categories, theme descriptors, canonical URL, and short description. Store full DESIGN.md only in durable/full record when the provider explicitly exposes it for retrieval.

- [ ] **Step 4: Add design index/query helpers**

Reuse the existing SQLite asset index where practical, filtering by type/category instead of creating a second full-text database.

- [ ] **Step 5: Run tests**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/adapters/design.mjs src/adapters/index.mjs src/design.mjs src/core.mjs webforge.mjs test/adapters.test.mjs test/providers.test.mjs test/fixtures/design
git commit -m "feat: add DESIGN.md style retrieval"
```

---

### Task 8: Add VibeIndex discovery queue with explicit approval

**Files:**
- Create: `src/adapters/vibeindex.mjs`
- Create: `src/discovery.mjs`
- Create: `test/fixtures/discovery/candidates.json`
- Modify: `src/adapters/index.mjs`
- Modify: `webforge.mjs`
- Test: `test/providers.test.mjs`

**Interfaces:**
- Queue path: `.webforge/discovery.json`
- Candidate states: `candidate`, `approved`, `rejected`, `duplicate`
- Produces: `discoverSources(root, options)`
- Produces: `listDiscovery(root)`
- Produces: `approveDiscovery(root, candidateId)`

- [ ] **Step 1: Write failing trust-boundary tests**

Sync fixture candidates and assert `sources.json` is unchanged until `approveDiscovery()` is called.

- [ ] **Step 2: Verify RED**

```bash
node --test test/providers.test.mjs --test-name-pattern="discovery"
```

- [ ] **Step 3: Implement queue persistence and duplicate detection**

Normalize URL host/path, compare against existing sources and candidates, and assign `duplicate` when appropriate.

- [ ] **Step 4: Implement approval**

Approval appends a conservative reference/auto source with `allowCodeIngest:false` and unknown license/policy unless the candidate explicitly carries separately verified policy data.

- [ ] **Step 5: Run tests**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/adapters/vibeindex.mjs src/adapters/index.mjs src/discovery.mjs webforge.mjs test/providers.test.mjs test/fixtures/discovery
git commit -m "feat: add reviewed source discovery queue"
```

---

### Task 9: Add optional 21st remote provider and bounded remote fan-out

**Files:**
- Create: `src/adapters/remote-provider.mjs`
- Create: `src/search.mjs`
- Modify: `src/adapters/index.mjs`
- Modify: `src/core.mjs`
- Modify: `webforge.mjs`
- Test: `test/providers.test.mjs`

**Interfaces:**
- Produces: `searchAll(root, query, options, context) -> { local, remote, results, providerStatuses }`
- `options.remote` defaults false.
- 21st auth comes only from existing provider state/environment such as `API_KEY_21ST`; WebForge does not persist secrets.

- [ ] **Step 1: Add failing missing-auth test**

Inject no credentials and assert remote provider status is:

```js
{ ok:false, code:'auth_required', source:'21st' }
```

while local results are still returned.

- [ ] **Step 2: Add failing bounded-remote test**

Inject a fake remote provider returning 100 results and assert `searchAll(...,{limit:5,remote:true})` returns no more than five merged results.

- [ ] **Step 3: Verify RED**

```bash
node --test test/providers.test.mjs --test-name-pattern="remote"
```

- [ ] **Step 4: Implement remote provider client boundary**

Use injected provider command/API adapters. Never make 21st a startup dependency. Detect executable/auth state and return structured status instead of throwing through the whole search.

- [ ] **Step 5: Implement merge/deduplication**

Prefer stable canonical address/source pairs, preserve local records on ties, and never include file bodies in compact remote results.

- [ ] **Step 6: Run tests**

```bash
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/adapters/remote-provider.mjs src/adapters/index.mjs src/search.mjs src/core.mjs webforge.mjs test/providers.test.mjs
git commit -m "feat: add optional remote provider search"
```

---

### Task 10: Extend SQLite metadata and filters while preserving v0.1 rows

**Files:**
- Modify: `src/core.mjs`
- Modify: `src/search.mjs`
- Test: `test/webforge.test.mjs`
- Test: `test/providers.test.mjs`

**Interfaces:**
- Add compact filterable fields for install mode, license, category/framework where present.
- Old JSONL rows with none of the new fields remain valid and searchable.

- [ ] **Step 1: Add failing migration/compatibility tests**

Write one legacy v0.1 row and one v2 row, rebuild index, and assert both are searchable.

- [ ] **Step 2: Add failing filter tests**

Cover `installable`, `license`, `source`, `type`, and category/framework filters.

- [ ] **Step 3: Verify RED**

```bash
node --test test/webforge.test.mjs test/providers.test.mjs
```

- [ ] **Step 4: Extend derived SQLite schema safely**

Because `.webforge/index.sqlite` is derived, prefer idempotent table/column recreation/migration without modifying durable JSONL records.

- [ ] **Step 5: Run tests**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/core.mjs src/search.mjs test/webforge.test.mjs test/providers.test.mjs
git commit -m "feat: add WebForge v2 search filters"
```

---

### Task 11: Add CLI and MCP surfaces for providers, design retrieval, discovery, and remote search

**Files:**
- Modify: `src/cli.mjs`
- Modify: `src/mcp.mjs`
- Modify: `webforge.mjs`
- Test: `test/webforge.test.mjs`
- Test: `test/providers.test.mjs`

**Interfaces:**
- CLI additions:
  - `webforge search <query> --remote`
  - `webforge provider status [source-id]`
  - `webforge source probe <source-id>`
  - `webforge discover [--source vibeindex]`
  - `webforge discover list`
  - `webforge discover approve <candidate-id>`
  - `webforge design search <query>`
  - `webforge design get <id>`
- MCP additions:
  - `webforge_provider_status`
  - `webforge_search_remote`
  - `webforge_design_search`
  - `webforge_design_get`
  - `webforge_discover`

- [ ] **Step 1: Add failing MCP compactness tests**

Assert `tools/list` exposes new tools and `webforge_search_remote`/`webforge_design_search` responses do not contain source-code bodies or DESIGN.md bodies.

- [ ] **Step 2: Add failing CLI parsing tests or process smoke tests**

Exercise `design search`, `discover list`, and `provider status` against fixture-backed state.

- [ ] **Step 3: Verify RED**

```bash
node --test test/webforge.test.mjs test/providers.test.mjs
```

- [ ] **Step 4: Implement additive CLI commands**

Keep every existing v0.1 command and flag valid.

- [ ] **Step 5: Implement additive MCP tools**

Keep `webforge_search` local-only. Remote querying occurs only through the explicit remote tool.

- [ ] **Step 6: Run tests**

```bash
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/cli.mjs src/mcp.mjs webforge.mjs test/webforge.test.mjs test/providers.test.mjs
git commit -m "feat: expose deep providers through CLI and MCP"
```

---

### Task 12: Add icon/font/capability sources and broader ecosystem coverage

**Files:**
- Modify: `src/catalog.mjs`
- Modify: `sources.json`
- Test: `test/providers.test.mjs`

**Interfaces:**
- Add reference/capability records for Base UI, Radix UI, React Aria Components, Headless UI, daisyUI, Flowbite, Preline UI, HeroUI, HyperUI, Lucide, Iconify, Heroicons, Tabler Icons, Phosphor Icons, Fontsource, React Three Fiber, Drei, Recharts, Apache ECharts, Visx, and TanStack Table.
- Lucide/Iconify/Fontsource entries may expose capability metadata but must not mirror entire payload catalogs into Git.

- [ ] **Step 1: Add failing catalog-coverage test**

Assert all expected IDs are present once and code ingestion defaults false.

- [ ] **Step 2: Verify RED**

```bash
node --test test/providers.test.mjs --test-name-pattern="catalog coverage"
```

- [ ] **Step 3: Add source records and policy metadata**

Keep capability sources compact and retrieval-first.

- [ ] **Step 4: Run tests**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/catalog.mjs sources.json test/providers.test.mjs
git commit -m "feat: expand WebForge ecosystem catalog"
```

---

### Task 13: Documentation, agent guidance, and final deterministic verification

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `.github/workflows/test.yml` if needed to exercise all deterministic checks.
- Test: all test files.

**Interfaces:**
- Documentation must distinguish local deterministic search from optional remote provider use.
- Documentation must state that unknown-license/publicly-viewable code is not automatically ingestible.
- Agent guidance must remain compact and retrieval-first.

- [ ] **Step 1: Update operator documentation**

Document provider statuses, source probing, deep shadcn installation, remote search, design search/get, discovery approval, cache locations, and credential behavior.

- [ ] **Step 2: Update compact agent rules**

Add only the minimal rules needed: local search first, remote search only when useful, explicit design get for full DESIGN.md, discovery candidates require approval.

- [ ] **Step 3: Run the complete deterministic test suite**

```bash
npm test
```

Expected: zero failed tests.

- [ ] **Step 4: Run registry audit**

```bash
node webforge.mjs audit
```

Expected: no parse errors, no unsafe file paths, and any remaining unknown-license records explicitly reported rather than silently accepted.

- [ ] **Step 5: Run doctor**

```bash
node webforge.mjs doctor
```

Expected: workspace/index/provider state is readable and required local capabilities are available.

- [ ] **Step 6: Run non-destructive CLI smoke tests**

```bash
node webforge.mjs search "animated hero" --limit 5
node webforge.mjs provider status
node webforge.mjs design search "minimal dashboard"
node webforge.mjs discover list
```

Use fixture/local data where live provider data is not configured. Do not count live-provider uptime as deterministic verification.

- [ ] **Step 7: Re-run the original v0.1 security regressions explicitly**

```bash
node --test test/webforge.test.mjs --test-name-pattern="safe installer|search tokenization|MCP stdio"
```

Expected: traversal protection, search sanitization, and old MCP discovery remain green.

- [ ] **Step 8: Commit**

```bash
git add README.md AGENTS.md .github/workflows/test.yml
git commit -m "docs: document WebForge deep provider workflow"
```

## Final Acceptance Checklist

- [ ] Provider-specific code is isolated in `src/adapters/`.
- [ ] Local-only search works with no network and no credentials.
- [ ] shadcn-compatible providers produce item-level searchable records.
- [ ] Magic UI, Watermelon, and Motion Primitives expose provider-supported installation strategies.
- [ ] 21st remote provider is optional and secret-free in persisted state.
- [ ] Refero/DESIGN.md search is compact and explicit `get` retrieves full style content.
- [ ] Deck.gallery creates item-level attributed reference records from catalog APIs.
- [ ] VibeIndex discovery cannot auto-approve or auto-enable code ingestion.
- [ ] Command installation uses executable + argument arrays, never user-built shell strings.
- [ ] Provider failure preserves prior registry snapshots.
- [ ] Legacy v0.1 rows and commands remain compatible.
- [ ] `npm test` passes with zero failures.
- [ ] `audit` and `doctor` run successfully and any license unknowns are reported honestly.
