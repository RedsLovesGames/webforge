# WebForge Agent Rules

WebForge is the local retrieval layer for reusable web design assets and references.

1. Search WebForge before generating a new UI component, pattern, motion effect, or design reference.
2. Read only the top few search results first. Retrieve full asset data only after choosing a candidate.
3. Prefer installable/canonical assets over recreating equivalent code.
4. Respect each asset's license metadata. Unknown licensing means reference-only until verified.
5. Never ingest third-party source code merely because a page is publicly reachable. Code ingestion requires an explicitly configured source with `allowCodeIngest=true`.
6. Normalize imported UI to the target project's design tokens and existing dependencies rather than introducing a second design system.
7. Avoid unnecessary animation runtimes, WebGL, fonts, and dependencies.
8. After changing the WebForge registry, run `npm test`, `node webforge.mjs audit`, and `node webforge.mjs doctor`.
9. For normal retrieval use MCP/CLI search. Do not dump `sources.json` or the whole registry into model context.

Useful commands:
- `node webforge.mjs search "query" --limit 5`
- `node webforge.mjs get source/item`
- `node webforge.mjs install source/item --project /path/to/project`
- `node webforge.mjs source sync`
- `node webforge.mjs audit`
- `node webforge.mjs mcp`
