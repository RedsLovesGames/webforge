# WebForge Agent Rules

WebForge is the retrieval layer for reusable web UI, motion, design references, and related capabilities.

1. Search local WebForge before generating an equivalent component or pattern.
2. Retrieve only a few candidates first. Fetch full item data only after selecting one.
3. Prefer provider-supported installation (`shadcn`, provider command, or remote install) over copying third-party source into WebForge.
4. Read license and policy metadata. Unknown licensing stays reference-only unless separately verified.
5. Use local search by default. Remote search is opt-in when the local index is insufficient.
6. Use `design search` for compact style candidates; use `design get` only for the selected full DESIGN.md/style record.
7. VibeIndex/discovery results are candidates only. They require explicit approval and never auto-enable code ingestion.
8. Normalize installed UI to the target project's existing design tokens and dependencies.
9. Avoid unnecessary animation runtimes, WebGL, font families, and duplicate libraries.
10. For normal ChatGPT using the GitHub connector, treat `CHATGPT.md` as the retrieval protocol and `chatgpt/INDEX.min.json` as the entry point. Never put source-code bodies or full DESIGN.md bodies into generated ChatGPT shards.
11. If `sources.json` or `registry/sources/` changes, rebuild the GitHub-facing projection with `npm run chatgpt:index`.
12. After WebForge code/registry changes run `npm test`, `node webforge.mjs audit`, and `node webforge.mjs doctor`.

Common commands:
- `node webforge.mjs search "query" --limit 5`
- `node webforge.mjs get source/item`
- `node webforge.mjs install source/item --project /path/to/project`
- `node webforge.mjs search "query" --remote --limit 5`
- `node webforge.mjs design search "query"`
- `node webforge.mjs provider status`
- `node webforge.mjs discover list`
- `npm run chatgpt:index`
