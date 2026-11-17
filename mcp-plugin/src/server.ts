import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSplTools } from './tools/spl.js';
import { registerFeatureModelTools } from './tools/featureModel.js';
import { registerProductsTools } from './tools/products.js';
import { registerProductsWriteTools } from './tools/productsWrite.js';
import { registerAgentsTools } from './tools/agents.js';
import { registerProfileTools } from './tools/profile.js';

export const SERVER_NAME = 'linea-mcp';
export const SERVER_VERSION = '0.1.0';

/** An MCP server with the tools for one line (read-only: without the ones that change anything). Used by both transports. */
export function createMcpServer({ lineId, readOnly }: { lineId: string; readOnly: boolean }): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // Always-available tools (read)
  registerSplTools(server, lineId);
  registerFeatureModelTools(server, lineId, readOnly);
  registerProductsTools(server, lineId);

  // Write tools (suppressed in read-only mode)
  if (!readOnly) registerProductsWriteTools(server, lineId);

  // Agents: read tools always available; write tools suppressed in read-only mode
  registerAgentsTools(server, lineId, readOnly);

  // which git host the person works on (they may have accounts on more than one)
  registerProfileTools(server, readOnly);

  return server;
}
