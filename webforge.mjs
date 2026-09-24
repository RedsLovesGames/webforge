#!/usr/bin/env node
import { main } from './src/cli.mjs';
export * from './src/core.mjs';
export * from './src/catalog.mjs';
export * from './src/search.mjs';
export * from './src/design.mjs';
export * from './src/discovery.mjs';
export { resolveAdapter, providerStatus } from './src/adapters/index.mjs';
export { runMcp } from './src/mcp.mjs';
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href)main().catch(e=>{process.stderr.write(`WebForge error: ${e.message}\n`);process.exitCode=1;});
