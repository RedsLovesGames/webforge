# WebForge for normal ChatGPT + GitHub

This repository is optimized so a GitHub-connected ChatGPT can use WebForge without a custom MCP server.

## Entry point

Always start with `chatgpt/INDEX.min.json`. Do **not** begin by reading `sources.json`, every registry file, or the whole repository.

The index contains:
- a compact map of WebForge sources;
- counts and paths for category shards;
- short field-name definitions used by those shards.

## Retrieval protocol

When the user asks to "use WebForge", "search WebForge", or find a UI/design asset from this repository:

1. Fetch `chatgpt/INDEX.min.json` first.
2. Infer the smallest relevant shard(s):
   - `components` - UI components, blocks, primitives, React/Tailwind/shadcn
   - `motion` - animation, transitions, microinteractions, scrollytelling
   - `design` - styles, DESIGN.md references, galleries, visual references
   - `icons` - icon/SVG resources
   - `fonts` - typography/font resources
   - `3d` - 3D/WebGL resources
   - `data` - charts, tables, maps, visualization
   - `tools` - generators, developer tools, agent/tooling capabilities
   - `other` - uncategorized assets
3. Search/fetch only those `chatgpt/shards/*.jsonl` files. Do not load unrelated shards.
4. Shortlist at most **5** candidates initially.
5. Prefer candidates matching the user's framework, existing dependencies, performance needs, accessibility needs, license constraints, and requested visual character.
6. Only after choosing a candidate, use its `d` field to locate the detailed source snapshot under `registry/sources/`. Search the exact asset `i` if a large JSONL file needs narrowing.
7. Fetch full code/files only when the task actually requires implementation and licensing/policy permits it. The compact ChatGPT index intentionally excludes source-code bodies.
8. If the requested item is not in a shard, use the compact `sources` map in `INDEX.min.json` to identify the best provider(s). Do not invent components that are not present in the committed snapshot.
9. Unknown license (`l: null`) means reference-only unless licensing is separately verified.
10. For implementation work, preserve the destination project's existing design tokens and dependencies rather than blindly copying a foreign design system.

## Compact asset fields

The authoritative mapping is embedded in `chatgpt/INDEX.min.json`. The common asset fields are:

- `i` asset id
- `n` name/title
- `s` source/provider id
- `y` type
- `t` tags
- `c` categories
- `f` frameworks
- `l` license id or `null`
- `m` install mode
- `p` performance/runtime cost when known
- `x` short description
- `d` detailed registry file path

## Response behavior

For discovery questions, return a compact comparison of the best candidates and explain why each matches. Do not dump every source.

For "best" requests, treat "best" as a fit problem: match the user's explicit constraints. Prefer a few clearly differentiated options instead of a long catalog.

For implementation requests, retrieve the selected asset's detailed record only after selection. If the user wants the site changed, use the GitHub connector on the target repository after retrieving the WebForge asset.

## Example user prompts

> Use my `RedsLovesGames/webforge` GitHub repo to find the best lightweight animated hero for React + Tailwind. Prefer low dependencies and no WebGL.

> Search WebForge for a dark dashboard layout. Give me the top 5 candidates, then inspect only the one I choose.

> Use WebForge to find a subtle hover interaction that can fit an existing shadcn project without adding another animation runtime.

> Use WebForge for design references for a premium dark developer-tool landing page, then turn the selected direction into a concise DESIGN.md.

## Freshness

`registry/sources/` is the persisted provider snapshot. `chatgpt/` is a generated, token-light projection of that snapshot. Do not hand-edit generated shard files; rebuild them with:

```bash
npm run chatgpt:index
```

GitHub Actions also refreshes provider snapshots and the ChatGPT index automatically.
