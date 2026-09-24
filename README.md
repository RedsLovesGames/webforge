# WebForge

WebForge is a token-light local registry and retrieval layer for AI-assisted web design. It keeps large component/reference catalogs out of agent context, indexes them in SQLite FTS5, and exposes only the few relevant results through a CLI or MCP server.

## What v0.1 does

- Seeds a catalog of the UI, motion, reference, prompt, media, and developer-tool sources collected for this project.
- Adds new sources without changing program code.
- Syncs normal websites as metadata/reference records.
- Ingests shadcn-style or JSON registries when you explicitly configure their JSON endpoint.
- Keeps source code out of the registry unless code ingestion is explicitly enabled.
- Compiles JSONL registry records into a local SQLite FTS5 search index.
- Searches by text, type, and source without loading the full registry into an AI context window.
- Retrieves a full selected asset only when needed.
- Safely installs cached component files into another project with path-traversal protection.
- Optionally installs declared npm dependencies.
- Audits duplicate IDs, missing license metadata, malformed JSONL, and unsafe file paths.
- Runs as a lightweight stdio MCP server with search/get/install/sync/audit tools.

## Requirements

- Node.js 22.5 or newer. WebForge v0.1 intentionally uses Node's built-in SQLite support so the core has no npm runtime dependencies.

## Start

```bash
npm test
node webforge.mjs init
node webforge.mjs doctor
```

The repository already includes `sources.json`, so `init` mostly creates the local `.webforge/` state directory and SQLite index.

## Search

```bash
node webforge.mjs search "dark animated hero" --limit 5
node webforge.mjs search "dashboard" --type block --source my-registry
node webforge.mjs get my-registry/analytics-card
```

A normal source such as Godly, Refero, or a gallery is stored as a compact reference record. It is useful for retrieval without copying the site's code or assets.

## Add a source

Metadata/reference source:

```bash
node webforge.mjs source add https://example.com/ui --id example-ui --adapter reference
node webforge.mjs source sync example-ui
```

Auto-detected JSON/reference source:

```bash
node webforge.mjs source add https://example.com/catalog.json --id example --adapter auto
node webforge.mjs source sync example
```

Explicit shadcn/registry JSON with source-code caching:

```bash
node webforge.mjs source add https://example.com/registry.json \
  --id example-registry \
  --adapter shadcn \
  --code \
  --license MIT
node webforge.mjs source sync example-registry
```

Use `--code` only when the source license/terms permit the intended use. Public availability is not treated as permission to mirror source code.

## Sync everything

```bash
node webforge.mjs source sync --concurrency 4
```

or initialize and sync in one command:

```bash
node webforge.mjs bootstrap --concurrency 4
```

A failed site does not erase its last successful registry file. The sync report identifies failures, then the index is rebuilt from the usable local records.

## Install an asset

```bash
node webforge.mjs install example-registry/hero-glow --project ../my-site
```

By default WebForge writes cached files and, when a `package.json` exists, installs declared npm dependencies. Disable dependency installation with `--no-deps`. Existing files are protected unless `--force` is supplied.

## MCP

Start the stdio server:

```bash
node /absolute/path/to/webforge/webforge.mjs mcp --root /absolute/path/to/webforge
```

The server exposes:

- `webforge_search`
- `webforge_get`
- `webforge_install`
- `webforge_sources`
- `webforge_sync`
- `webforge_audit`

The search-first workflow is intentional. An agent can query tens of thousands of indexed assets while receiving only a handful of compact records, then retrieve the selected item.

### Example MCP request sequence

```text
webforge_search({ query: "minimal pricing section", limit: 5 })
webforge_get({ id: "source/chosen-item" })
webforge_install({ id: "source/chosen-item", projectRoot: "/project" })
```

## Registry model

On disk, source records live in `registry/sources/*.jsonl`. SQLite is a derived cache and is ignored by Git.

A normalized record is intentionally compact:

```json
{
  "id": "source/hero-glow",
  "title": "Hero Glow",
  "type": "block",
  "source": { "id": "source", "url": "https://example.com" },
  "tags": ["hero", "motion"],
  "dependencies": ["motion"],
  "registryDependencies": [],
  "files": [{ "path": "components/hero-glow.tsx", "content": "..." }],
  "license": { "id": "MIT" }
}
```

## Why the seeded sources are reference-only

The seed catalog mixes open-source libraries, inspiration galleries, generators, commercial/freemium products, and tools. WebForge therefore begins conservatively: it indexes their metadata, not their source code. Sources with verified reusable registries can be reconfigured with an explicit registry endpoint and `--code`.

This separation is what lets the catalog scale without turning the repo into a licensing, duplication, and token-cost problem.

## Tests and checks

```bash
npm test
node webforge.mjs audit
node webforge.mjs doctor
```

`node:sqlite` may emit an ExperimentalWarning on some Node 22 releases. That warning does not indicate a failed test or query.

## Next upgrades

The intended next layer is source-specific adapters for high-value registries, design-token normalization through project `DESIGN.md`, canonical component promotion, visual-reference embeddings, and optional Agent Memory integration. The v0.1 core is deliberately smaller so those features can reuse one stable search/install interface instead of creating separate workflows per website.
