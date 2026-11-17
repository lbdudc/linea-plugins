#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { splalm, startAutoRefresh } from './client.js';
import { registerSplTools } from './tools/spl.js';
import { registerFeatureModelTools } from './tools/featureModel.js';
import { registerProductsTools } from './tools/products.js';
import { registerProductsWriteTools } from './tools/productsWrite.js';
import { registerAgentsTools } from './tools/agents.js';
import { registerProfileTools } from './tools/profile.js';
import type { SplalmLine } from './types.js';

const log = (...args: unknown[]): void => {
  process.stderr.write(`[splalm-mcp-server] ${args.join(' ')}\n`);
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

  const server = new McpServer({
    name: 'linea-mcp',
    version: '0.1.0',
  });

  // Always-available tools (read)
  registerSplTools(server, config.SPL_LINE_ID);
  registerFeatureModelTools(server, config.SPL_LINE_ID, config.MCP_READ_ONLY);
  registerProductsTools(server, config.SPL_LINE_ID);

  // Write tools (suppressed in read-only mode)
  if (!config.MCP_READ_ONLY) {
    registerProductsWriteTools(server, config.SPL_LINE_ID);
  }

  // Agents: read tools always available; write tools suppressed in read-only mode
  registerAgentsTools(server, config.SPL_LINE_ID, config.MCP_READ_ONLY);

  // which git host the person works on (they may have accounts on more than one)
  registerProfileTools(server, config.MCP_READ_ONLY);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const mode = config.MCP_READ_ONLY ? 'read-only' : 'read-write';
  log(`Connected — SPL "${splName}" (${config.SPL_LINE_ID}), ${mode} mode`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[splalm-mcp-server] Fatal: ${msg}\n`);
  process.exit(1);
});
