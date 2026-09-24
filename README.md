# WebForge

WebForge is a token-light local retrieval layer for AI-assisted web design. It turns component registries, motion libraries, design-reference sources, discovery directories, and capability catalogs into one searchable interface without putting the whole ecosystem into an agent's context window.

## v0.2 deep-provider architecture

WebForge keeps **local search primary**. Durable normalized records live in `registry/sources/*.jsonl`; a derived SQLite FTS5 index lives under `.webforge/`. MCP and CLI search return only compact candidate records. Full component metadata, file bodies, or DESIGN.md content are retrieved only after a specific item is selected.

Deep providers are isolated under `src/adapters/` rather than hard-coded into the registry core.

### Deep integrations

- **shadcn-compatible registries**: normalized item metadata and shadcn installation addresses.
- **Magic UI**: component discovery from its component sitemap, installed through `@magicui/<name>` using the shadcn CLI.
- **Watermelon UI**: catalog discovery from its public sitemap, installed through `https://registry.watermelon.sh/r/<name>.json`.
- **Motion Primitives**: component discovery from its docs sitemap and command installation through `npx motion-primitives@latest add <name>`.
- **21st.dev**: optional remote provider. Remote search is opt-in and can delegate to the 21st CLI when configured/authenticated.
- **Deck.gallery**: catalog adapter for its public deck/product JSON catalogs; public metadata only.
- **Refero / DESIGN.md-style sources**: compact design search with explicit full design retrieval.
- **VibeIndex**: discovery source that creates a review queue. Discovered URLs never become trusted/code-ingest sources automatically.

The catalog also includes Base UI, Radix UI, React Aria, Headless UI, daisyUI, Flowbite, Preline, HeroUI, HyperUI, Lucide, Iconify, Fontsource, React Three Fiber/Drei, Recharts, ECharts, Visx, TanStack Table, and the original WebForge sources as reference/capability providers.

## Requirements

- Node.js 22.5+
- No mandatory npm runtime dependencies for WebForge core.
- Network access is only needed when syncing or using a remote provider.

## Start

```bash
npm test
node webforge.mjs init
node webforge.mjs doctor
```

## Local search

Local search is deterministic, fast, and credential-free:

```bash
node webforge.mjs search "animated hero" --limit 5
node webforge.mjs search "dashboard" --type block --source watermelon
node webforge.mjs search "chart" --installable --framework react
```

Useful filters include:

```text
--type
--source
--license
--installable
--category
--framework
--limit
```

Retrieve a selected item only after search:

```bash
node webforge.mjs get magicui/dock
```

## Source sync

Sync all enabled providers:

```bash
node webforge.mjs source sync --concurrency 4
```

Sync one provider:

```bash
node webforge.mjs source sync magicui
node webforge.mjs source sync watermelon
node webforge.mjs source sync motion-primitives
```

Provider failures are isolated. A failed sync does not replace the provider's previous successful JSONL snapshot.

HTTP metadata is cached under:

```text
.webforge/cache/providers/
```

ETag and Last-Modified values are used when available.

## Provider status and probing

```bash
node webforge.mjs provider status
node webforge.mjs provider status motion-primitives
node webforge.mjs source probe magicui
```

Optional tools can report `unavailable` without breaking WebForge local search.

## Installation

WebForge chooses an installation strategy from the selected item:

- `cached-files`: write WebForge-owned/explicitly cached files with path and overwrite protection.
- `shadcn`: delegate to `npx shadcn@latest add <address>`.
- `command`: run a provider executable with an argument array.
- `remote`: delegate to an authenticated remote provider.
- `none`: reference-only item.

Example:

```bash
node webforge.mjs install magicui/dock --project ../my-site
node webforge.mjs install watermelon/hero-12 --project ../my-site
node webforge.mjs install motion-primitives/text-effect --project ../my-site
```

Command strategies never construct shell strings from item IDs. User-controlled item names remain literal arguments.

## 21st remote search

Normal `webforge search` never fans out remotely.

To opt in:

```bash
node webforge.mjs search "pricing table" --remote --limit 5
```

The configured 21st provider uses `API_KEY_21ST` when present and delegates to the 21st CLI. Secrets are not persisted into `sources.json`, registry JSONL, or SQLite.

If auth or the optional provider CLI is unavailable, WebForge returns a provider status rather than breaking local results.

## Design retrieval

```bash
node webforge.mjs design search "minimal dark dashboard"
node webforge.mjs design get refero-styles/example-style
```

Search results deliberately exclude large DESIGN.md bodies. `design get` returns the complete selected record, including DESIGN.md text when the provider explicitly made it available.

## Source discovery

VibeIndex and future discovery providers feed a review queue:

```bash
node webforge.mjs discover --source vibeindex
node webforge.mjs discover list
node webforge.mjs discover approve <candidate-id>
```

Approval creates a conservative source with code ingestion disabled. Discovery never grants code or media ingestion permission automatically.

## Add your own source

Reference source:

```bash
node webforge.mjs source add https://example.com --id example --adapter reference
```

Generic JSON catalog:

```bash
node webforge.mjs source add https://example.com/catalog.json --id example --adapter catalog-json
```

shadcn registry:

```bash
node webforge.mjs source add https://example.com/registry.json \
  --id example-registry \
  --adapter shadcn \
  --manifest https://example.com/registry.json
```

Code ingestion remains off unless explicitly enabled and permitted by the source's licensing/policy.

## MCP

Start the stdio server:

```bash
node /absolute/path/to/webforge/webforge.mjs mcp --root /absolute/path/to/webforge
```

Tools:

```text
webforge_search
webforge_get
webforge_install
webforge_sources
webforge_sync
webforge_audit
webforge_provider_status
webforge_search_remote
webforge_design_search
webforge_design_get
webforge_discover
```

Recommended agent flow:

```text
webforge_search(query, limit=5)
        ↓
select candidate
        ↓
webforge_get(id)
        ↓
webforge_install(id, projectRoot)
```

Use `webforge_search_remote` only when the local registry does not contain sufficient candidates.

## Licensing and trust

`license` and `policy` are separate concepts:

- `license`: known license metadata.
- `policy`: what WebForge is allowed to ingest/cache.

A publicly reachable page is not treated as permission to mirror source code. Unknown-license assets stay metadata/reference-first and are reported by `audit`.

## Verification

```bash
npm test
node webforge.mjs audit
node webforge.mjs doctor
```

The deterministic test suite does not depend on third-party uptime, external credentials, or live provider APIs.
