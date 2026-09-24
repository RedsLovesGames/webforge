# WebForge Deep Source Adapters Design

## Goal

Upgrade WebForge from a reference-directory MVP into a token-light retrieval and installation layer that can deeply integrate high-value UI/design sources while preserving the current Git + JSONL + SQLite + MCP architecture.

The first deep integrations are:

1. shadcn-compatible registries as the common component protocol.
2. 21st as an optional remote search/install provider.
3. Magic UI as a shadcn namespace/provider.
4. Watermelon UI as a shadcn-compatible provider.
5. Motion Primitives as a CLI-backed component provider.
6. Refero Styles / DESIGN.md as a design-reference provider.
7. Deck.gallery as a public catalog API provider.
8. VibeIndex as a discovery provider that proposes new WebForge sources.
9. Lucide/Iconify as icon capability sources.
10. Fontsource as a font capability source.

The phase also adds Base UI, Radix UI, React Aria Components, daisyUI, Flowbite, Preline, HyperUI, React Three Fiber/Drei, chart libraries, and TanStack Table to the catalog as reference/capability sources without requiring deep adapters in this phase.

## Constraints

- Preserve the v0.1 CLI and MCP surface unless an extension is additive.
- Keep the core runnable on Node.js 22.5+ without mandatory third-party runtime dependencies.
- Keep large catalogs outside normal model context.
- Never assume public availability means permission to mirror source code.
- Keep unknown-license content reference-only.
- Do not require credentials for WebForge startup, search of local data, or other unrelated providers.
- A failed remote provider must not delete or invalidate its last successful local records.
- Provider-specific logic must not accumulate in `src/core.mjs`.

## Architecture

### Adapter boundary

Create `src/adapters/` and make provider-specific behavior implement one small contract.

Each adapter exposes the operations it supports:

```js
{
  id,
  probe(source, context),
  sync(source, context),
  search?(source, query, options, context),
  get?(source, itemId, context),
  install?(source, itemId, projectRoot, options, context)
}
```

`probe` determines whether the adapter can service a source and reports capabilities without mutating state. `sync` produces normalized WebForge records for local indexing. Remote-only providers may additionally implement `search`, `get`, or `install` so WebForge can query them on demand without mirroring their entire catalog.

### Adapter registry

Create `src/adapters/index.mjs` as the single resolver. `core.mjs` asks the registry for an adapter by configured adapter ID. `auto` uses probes in deterministic priority order and falls back to `reference`.

Initial built-in adapters:

- `reference`
- `shadcn`
- `catalog-json`
- `deck-gallery`
- `command-provider`
- `remote-provider`
- `refero`
- `vibeindex`

Provider configuration stays in `sources.json`; the application does not special-case source IDs in `core.mjs`.

## Normalized record v2

Keep all v0.1 fields and add optional metadata so old registry files remain readable.

```js
{
  id,
  name,
  title,
  description,
  type,
  source,
  tags,
  dependencies,
  devDependencies,
  registryDependencies,
  files,
  license,

  categories: [],
  docs: null,
  envVars: null,
  cssVars: null,
  css: null,
  font: null,

  install: {
    mode: 'cached-files' | 'shadcn' | 'command' | 'remote' | 'none',
    command: null,
    address: null,
    requiresAuth: false
  },

  design: {
    theme: null,
    tokens: null,
    designMd: null,
    referenceUrl: null
  },

  performance: {
    clientRequired: null,
    runtime: [],
    estimatedCost: null
  },

  retrieval: {
    local: true,
    remoteGet: false,
    remoteInstall: false,
    syncedAt: null
  }
}
```

Unknown values remain `null`; WebForge must not manufacture metadata.

## shadcn adapter

The shadcn adapter becomes the common implementation for compatible component registries.

It must support:

- root `registry.json` payloads;
- `registry-item.json` payloads;
- nested `include` files with cycle prevention and duplicate-name detection;
- `dependencies`, `devDependencies`, and `registryDependencies`;
- item categories, docs, env vars, CSS, CSS variables, and font metadata;
- registry item target placeholders such as `@ui/`, `@components/`, `@lib/`, and `@hooks/`;
- namespaced install addresses such as `@magicui/dock`;
- optional item URLs when the provider should be installed through the official shadcn CLI rather than mirrored.

Default behavior stores item metadata and an install address, not third-party code. Code caching still requires `allowCodeIngest=true` and a verified license policy.

## Provider-specific behavior

### shadcn/ui

Use shadcn registry semantics as the canonical schema. WebForge stores discoverable item metadata and official install addresses. Install should prefer the official shadcn CLI when the target project has a compatible `components.json`; cached-file installation remains available for WebForge-owned/canonical assets.

### Magic UI

Represent Magic UI components as shadcn namespace items. Discovery creates records such as `magicui/dock`; installation delegates to `shadcn add @magicui/dock`. WebForge should not need to mirror Magic UI source merely to install it.

### Watermelon UI

Use its shadcn-style registry endpoints where available. Store blocks/components individually, preserve dependency metadata, and use shadcn installation addresses rather than scraping rendered documentation pages.

### Motion Primitives

Discovery records each component. Installation delegates to its documented CLI, e.g. `npx motion-primitives@latest add <component>`. Record common runtime requirements such as `motion`, `lucide-react`, and class-merging helpers only when supplied by the provider or item metadata.

### 21st

Treat 21st as an optional remote provider rather than mirroring its catalog. If the 21st CLI/MCP is installed and authenticated, WebForge can delegate search/get/install operations. Local WebForge search merges a small number of remote 21st results only when explicitly requested or when `--remote` is enabled.

Credential behavior:

- use existing 21st login state or `API_KEY_21ST`;
- never persist the key in `sources.json`, registry JSONL, logs, or SQLite;
- unavailable credentials return a structured `auth_required` provider status rather than failing the entire search.

### Refero Styles / DESIGN.md

Index style references, not page source. A style record may include its title, style description, categories/tags, canonical URL, theme, and DESIGN.md text when made available for copying by the provider.

Expose a dedicated design retrieval path so an agent can request a few style candidates and then retrieve one complete DESIGN.md. DESIGN.md content must not be mixed into every search result.

### Deck.gallery

Use the documented public catalog endpoints instead of scraping pages:

- `/api/catalog/decks.json`
- `/api/catalog/products.json`

Cache the catalog according to provider guidance. Each deck/product becomes its own reference record. Preserve canonical URLs and creator attribution. Deck imagery and purchased product files are not ingested merely because catalog metadata is public.

### VibeIndex

Treat VibeIndex as discovery input, not an executable-code provider. It can propose candidate URLs plus categories/tags into a local discovery queue.

A discovered site is never automatically granted code-ingestion permission. New candidates are stored with status:

- `candidate`
- `approved`
- `rejected`
- `duplicate`

Only approved candidates enter `sources.json`.

### Icons and fonts

Lucide, Iconify, and Fontsource are capability providers. Their records should be compact and favor package/name metadata over copied payloads. Icon payloads or font files are fetched only when explicitly selected for installation/use.

## Search architecture

### Local search remains primary

SQLite FTS5 remains the default. Search returns compact records with no file bodies and no DESIGN.md bodies.

Add filters for:

- install mode;
- installable status;
- license;
- framework;
- category;
- remote/local;
- source;
- type.

### Optional remote fan-out

`searchAssets` remains synchronous/local. Add a separate async `searchAll` orchestration function that:

1. searches local SQLite;
2. optionally queries enabled remote providers;
3. normalizes compact results;
4. deduplicates by canonical source/address when possible;
5. returns a bounded result count.

Remote fan-out is opt-in in the CLI/MCP to keep normal requests deterministic and cheap.

## CLI additions

Preserve existing commands and add:

```text
webforge search <query> [--remote] [--installable] [--license SPDX]
webforge provider status [source-id]
webforge source probe <source-id>
webforge discover [--source vibeindex]
webforge discover list
webforge discover approve <candidate-id>
webforge design search <query>
webforge design get <id>
```

`source sync` continues to perform durable local synchronization.

## MCP additions

Keep existing tools and add compact tools:

- `webforge_provider_status`
- `webforge_search_remote`
- `webforge_design_search`
- `webforge_design_get`
- `webforge_discover`

Normal `webforge_search` stays local-only and token-light.

MCP search results must remain compact. Full source code, DESIGN.md, or large metadata appears only through explicit `get` operations.

## Installation policy

Installation selects a strategy from `item.install.mode`:

1. `cached-files`: existing v0.1 safe file writer.
2. `shadcn`: spawn official shadcn CLI with the provider address.
3. `command`: spawn a configured executable with an argument array, never a shell-built command string.
4. `remote`: delegate to an authenticated provider client.
5. `none`: refuse with a clear non-installable status.

All spawned commands must use argument arrays with `shell:false` except where Windows executable resolution demonstrably requires a wrapper. User-provided item IDs must never become arbitrary shell text.

Before installation, WebForge reports the selected provider, dependency/install strategy, and target project. Existing overwrite protections remain for cached-file installs.

## Licensing and trust

Each source gains optional policy metadata:

```js
policy: {
  metadataAllowed: true,
  codeIngestAllowed: false,
  mediaIngestAllowed: false,
  attributionRequired: false,
  notes: null
}
```

`license` represents known licensing; `policy` represents what WebForge is allowed to ingest. The two must not be conflated.

Unknown licenses remain auditable. Provider adapters may still index public metadata when permitted while keeping source code/media unavailable.

## Source catalog additions

Add reference/capability records for:

- Base UI
- Radix UI
- React Aria Components
- Headless UI
- daisyUI
- Flowbite
- Preline UI
- HeroUI
- HyperUI
- Lucide
- Iconify
- Heroicons
- Tabler Icons
- Phosphor Icons
- Fontsource
- React Three Fiber
- Drei
- Recharts
- Apache ECharts
- Visx
- TanStack Table

These do not require deep adapters before the core deep-adapter phase can ship.

## Error handling

All provider operations return structured statuses where practical:

```js
{
  ok: false,
  code: 'auth_required' | 'rate_limited' | 'unavailable' | 'invalid_payload' | 'unsupported',
  source: '21st',
  message: '...'
}
```

A provider failure must not erase the previous registry snapshot. Sync writes to a temporary file and atomically replaces the source JSONL only after successful normalization.

Honor HTTP `Retry-After` where available. Do not silently retry credential failures.

## Cache behavior

Add `.webforge/cache/providers/<source-id>/` for HTTP metadata/cache state. Cache metadata records ETag, Last-Modified, fetched time, and provider-specific minimum TTL when available.

Derived caches remain ignored by Git. Durable normalized registry JSONL remains committed only when explicitly updated by the project workflow.

## Testing

All production changes follow red-green TDD.

Required deterministic tests:

- adapter resolver and auto fallback;
- shadcn registry root parsing;
- shadcn `include` resolution and cycle rejection;
- duplicate registry item detection;
- rich shadcn fields survive normalization;
- command-install strategies cannot inject shell text;
- missing provider executable reports `unavailable`;
- missing 21st auth reports `auth_required` without breaking local results;
- remote search result count is bounded;
- Deck catalog normalization and attribution fields;
- provider failure preserves prior JSONL snapshot;
- discovery candidates do not automatically become approved sources;
- compact MCP results exclude code/DESIGN.md bodies;
- explicit design get can return full DESIGN.md;
- old v0.1 normalized rows remain searchable/readable;
- existing install path traversal and overwrite protections remain green.

Network-facing adapter tests use local fixtures/fake HTTP servers or injected fetch functions. The deterministic suite must not depend on live third-party uptime or credentials.

## Verification

Before completion run:

```bash
npm test
node webforge.mjs audit
node webforge.mjs doctor
```

Also run targeted CLI smoke tests for local search, one fixture-backed shadcn sync, provider status, design search/get, and a dry/non-destructive command-provider install path.

Live-provider smoke checks may be run separately and must be reported separately from deterministic tests.

## Success criteria

The phase is complete when:

- provider-specific logic is isolated behind adapters;
- shadcn-compatible sources are represented as individual searchable/installable assets rather than one source-level reference;
- Magic UI, Watermelon, and Motion Primitives can be installed through their provider-supported mechanisms without mirrored source code being required;
- 21st can be queried/delegated when configured without becoming a mandatory dependency;
- Refero styles can produce individual searchable style records and explicit DESIGN.md retrieval;
- Deck.gallery uses its catalog API and creates individual references;
- VibeIndex can populate a reviewable discovery queue without auto-trusting new sources;
- local-only WebForge search remains fast, bounded, and usable with no credentials or network;
- the existing v0.1 CLI/MCP workflows remain compatible;
- deterministic verification is green.
