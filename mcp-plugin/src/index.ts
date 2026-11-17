#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { splalm, startAutoRefresh } from './client.js';
import { createMcpServer } from './server.js';
import type { SplalmLine } from './types.js';

const log = (...args: unknown[]): void => {
  process.stderr.write(`[linea-mcp] ${args.join(' ')}\n`);
};

async function main(): Promise<void> {
  // Validate the SPL exists and the JWT works before registering any tools
  let splName: string;
  try {
    const spl = (await splalm.get(`/api/lines/${config.SPL_LINE_ID}`)) as SplalmLine;
    splName = spl.name;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Startup check failed: ${msg}`);
    log(`  • SPLALM running at: ${config.SPLALM_BASE_URL}`);
    log(`  • SPL_LINE_ID:       ${config.SPL_LINE_ID}`);
    log(`  • Make sure SPLALM is running and SPLALM_JWT (or SPLALM_GIT_TOKEN) is valid.`);
    process.exit(1);
  }

  // Schedule proactive JWT refresh before expiry
  startAutoRefresh();

  const server = createMcpServer({ lineId: config.SPL_LINE_ID, readOnly: config.MCP_READ_ONLY });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const mode = config.MCP_READ_ONLY ? 'read-only' : 'read-write';
  log(`Connected — SPL "${splName}" (${config.SPL_LINE_ID}), ${mode} mode`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[linea-mcp] Fatal: ${msg}\n`);
  process.exit(1);
});
