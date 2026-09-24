# WebForge v0.1 Implementation Plan

> **For agentic workers:** implement and review changes in small test-backed increments.

**Goal:** Deliver a self-contained WebForge MVP that indexes design sources and exposes token-light retrieval through CLI and MCP.

**Architecture:** Node 22 modules own source cataloging, SQLite FTS5 indexing, safe installation, auditing, the CLI, and MCP stdio interface. Durable data remains plain JSON/JSONL in Git while `.webforge/index.sqlite` is rebuildable local state.

**Tech Stack:** Node.js 22+, ESM, built-in `node:sqlite`, built-in test runner, JSONL, MCP JSON-RPC over stdio.

**Spec:** `docs/superpowers/specs/2026-09-23-webforge-mvp-design.md`

## Global Constraints

- No runtime npm dependencies in v0.1.
- Seeded third-party sites are metadata/reference-only.
- Code ingestion must be explicit.
- Registry data must remain searchable without loading the full catalog into agent context.
- Installer must prevent path traversal and accidental overwrite.

## Tasks

1. Define failing tests for normalization, FTS search/filtering, safe installation, source extension, auditing, and query sanitization.
2. Implement workspace initialization and built-in SQLite schema.
3. Implement JSONL indexing and compact search/get operations.
4. Implement extensible source catalog plus reference/JSON registry synchronization.
5. Implement safe asset installation and optional npm dependency install.
6. Implement registry audit checks.
7. Implement CLI commands and MCP stdio tools over the same core functions.
8. Seed source metadata and write agent/operator documentation.
9. Run tests, CLI smoke tests, MCP smoke tests, audit, and doctor checks before publishing.
