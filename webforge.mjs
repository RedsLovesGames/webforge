#!/usr/bin/env node
import { main } from './src/cli.mjs';
export * from './src/core.mjs';
export { runMcp } from './src/mcp.mjs';

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => {
    process.stderr.write(`WebForge error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
