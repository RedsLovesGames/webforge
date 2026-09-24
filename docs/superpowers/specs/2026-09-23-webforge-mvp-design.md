# WebForge v0.1 Design

## Goal

Create a runnable, low-dependency local program that turns a large collection of web-design sources into a searchable asset/reference registry without placing the entire catalog in an AI model's context.

## Architecture

The Git repository is the source of truth for source definitions and normalized JSONL records. A derived local SQLite FTS5 database provides fast retrieval. The CLI and MCP server expose the same operations: search compact records, retrieve one chosen asset, install cached files, sync sources, and audit registry integrity.

Seeded websites are metadata/reference-only because the source list mixes open-source, commercial, inspiration, and generator sites. Full code ingestion is opt-in at the source level and should be configured only after verifying licensing/terms.

## Interfaces

- `sources.json`: source configuration independent from program code.
- `registry/sources/*.jsonl`: normalized durable registry records.
- `.webforge/index.sqlite`: derived local search cache, never committed.
- `webforge.mjs`: CLI entrypoint.
- `src/core.mjs`: registry, search, sync, install, and audit operations.
- `src/mcp.mjs`: token-light MCP interface.
- `src/cli.mjs`: command-line interface.
- `AGENTS.md`: compact search-first instructions for coding agents.

## Core workflow

1. Add or use a configured source.
2. Sync it. Reference adapters store metadata; registry adapters normalize items and optionally cache code.
3. Rebuild SQLite FTS5.
4. Search returns at most a small candidate set.
5. Retrieve the selected asset in full.
6. Install only if file content is present/allowed.
7. Audit registry integrity after changes.

## Security and integrity

Install paths are resolved under the target project and path traversal is rejected. Existing files are not overwritten unless explicitly forced. Code caching is disabled unless `allowCodeIngest` is enabled. License metadata remains visible and unknown licenses are audit findings rather than silently assumed permissive.

## Compatibility

Node.js 22.5+ is required for the built-in SQLite API. The stdio MCP server supports the legacy initialize-era protocol plus a lightweight modern `server/discover` path so search/get/install remain usable without adding an npm dependency to the core.

## Success criteria

- deterministic tests cover registry normalization, search, installation safety, source extensibility, audit behavior, search sanitization, and MCP discovery;
- a fresh clone can initialize and search without `npm install`;
- large catalogs stay outside normal model context;
- adding a source does not require changing application code.
