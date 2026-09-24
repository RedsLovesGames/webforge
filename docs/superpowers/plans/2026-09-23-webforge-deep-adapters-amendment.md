# WebForge Deep Adapters Plan Amendment

This file is a required companion to `2026-09-23-webforge-deep-adapters.md`. It closes two coverage gaps found during plan self-review. Execute these tasks at the indicated points.

## Task 1A: Add generic catalog-json adapter and provider probe/status API

**Run after Task 1 and before Task 2.**

**Files:**
- Create: `src/adapters/catalog-json.mjs`
- Create: `src/providers.mjs`
- Modify: `src/adapters/index.mjs`
- Modify: `webforge.mjs`
- Test: `test/adapters.test.mjs`
- Test: `test/providers.test.mjs`

**Interfaces:**
- Produces: `catalogJsonAdapter` with `{ id:'catalog-json', probe, sync }`.
- Produces: `probeSource(root, sourceId, context?) -> { source, adapter, ok, capabilities, status }`.
- Produces: `providerStatus(root, sourceId?, context?) -> Array<{ source, adapter, enabled, capabilities, status }>`.
- `capabilities` is a compact object containing only supported booleans such as `sync`, `search`, `get`, `install`, `design`, and `discovery`.
- Provider status must never include environment-secret values.

- [ ] **Step 1: Write failing catalog-json tests**

Use a fixture payload such as:

```js
{
  items: [
    { id:'hero-1', title:'Hero 1', description:'Demo hero', url:'https://example.test/hero-1', tags:['hero'] }
  ]
}
```

Assert the adapter produces one normalized reference/capability item without treating arbitrary JSON fields as executable code or installable files.

- [ ] **Step 2: Write failing provider probe/status tests**

Assert:

```js
const probe = await probeSource(root, 'demo', fakeContext);
assert.equal(probe.adapter, 'catalog-json');
assert.equal(probe.ok, true);
assert.equal(probe.capabilities.sync, true);

const statuses = await providerStatus(root, null, fakeContext);
assert.ok(statuses.every(x => !JSON.stringify(x).includes('SECRET_TEST_VALUE')));
```

Also assert a missing optional executable/provider returns a structured `unavailable` status rather than throwing through the whole status call.

- [ ] **Step 3: Run tests and verify RED**

```bash
node --test test/adapters.test.mjs test/providers.test.mjs --test-name-pattern="catalog-json|provider status|probe"
```

Expected: FAIL because these interfaces do not exist.

- [ ] **Step 4: Implement `catalog-json` conservatively**

Accept only arrays or `{items:[...]}`. Normalize item ID/title/description/tags/canonical URL and explicit metadata. Default `install.mode` to `none`. Ignore executable/file-like fields unless another adapter with explicit policy handles them.

- [ ] **Step 5: Implement `probeSource` and `providerStatus`**

Resolve adapters through `src/adapters/index.mjs`. `probeSource` may call adapter `probe`; `providerStatus` must aggregate failures into structured status objects so one broken provider does not block the rest.

- [ ] **Step 6: Run targeted and full tests**

```bash
node --test test/adapters.test.mjs test/providers.test.mjs
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/adapters/catalog-json.mjs src/adapters/index.mjs src/providers.mjs webforge.mjs test/adapters.test.mjs test/providers.test.mjs
git commit -m "feat: add catalog JSON adapter and provider status API"
```

## Task 11A: Wire the explicit provider APIs into CLI/MCP

**Run as part of Task 11.**

- `webforge provider status [source-id]` calls `providerStatus` from `src/providers.mjs`.
- `webforge source probe <source-id>` calls `probeSource` from `src/providers.mjs`.
- `webforge_provider_status` returns the same compact status records.
- No status/probe response may include secrets, cached response bodies, source-code bodies, or DESIGN.md bodies.

Add deterministic process/MCP tests for all three paths before implementing the wiring.
