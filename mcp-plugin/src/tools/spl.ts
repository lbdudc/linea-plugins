import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { splalm, handleApiError, toStructured } from '../client.js';
import { ResponseFormat } from '../constants.js';
import type { SplalmLine } from '../types.js';

// ---------------------------------------------------------------------------
// Shared formatter
// ---------------------------------------------------------------------------

function formatLine(line: SplalmLine, format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) return JSON.stringify(line, null, 2);
  return [
    `# SPL: ${line.name} (v${line.version})`,
    '',
    line.description,
    '',
    `**GitLab**: ${line.webUrl}`,
    `**Models**: ${(line.models ?? []).join(', ') || '(none)'}`,
    `**Products**: ${(line.products ?? []).length}`,
    '',
    '## Members',
    ...(line.members ?? []).map(m => `- ${m.username} (role ${m.role})`),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerSplTools(server: McpServer, lineId: string): void {
  // ── get_spl_info ──────────────────────────────────────────────────────────
  server.registerTool(
    'splalm_get_spl_info',
    {
      title: 'Get SPL Info',
      description: `Return full metadata for this Software Product Line.

Returns: name, version, description, declared metamodel slugs (line.models),
GitLab project/namespace IDs and URLs, member list (username + access level),
and a summary list of all products.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Examples:
  - "What version is this SPL?" → no args needed
  - "Show me all the GitLab members of this SPL" → use splalm_list_spl_members
  - "How many products does this SPL have?" → check productCount in response`,
      inputSchema: z.object({
        response_format: z.nativeEnum(ResponseFormat)
          .default(ResponseFormat.MARKDOWN)
          .describe("'markdown' for human-readable or 'json' for machine-readable"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ response_format }) => {
      try {
        const line = await splalm.get(`/api/lines/${lineId}`) as SplalmLine;
        return {
          content: [{ type: 'text', text: formatLine(line, response_format) }],
          structuredContent: toStructured(line),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── list_metamodels ───────────────────────────────────────────────────────
  server.registerTool(
    'splalm_list_metamodels',
    {
      title: 'List Metamodels',
      description: `Return the metamodel slugs declared on this SPL (the line.models array).

These slugs identify the additional domain metamodels associated with the SPL
(e.g. "dataModel", "staticContent"). They are referenced by each product's spec
when the user configures features.

Returns: { "metamodels": ["dataModel", "staticContent", ...] }

Examples:
  - "What metamodels does this SPL support?" → use this tool`,
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const line = await splalm.get(`/api/lines/${lineId}`) as SplalmLine;
        const metamodels = line.models ?? [];
        return {
          content: [{ type: 'text', text: JSON.stringify({ metamodels }, null, 2) }],
          structuredContent: toStructured({ metamodels }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── list_spl_members ──────────────────────────────────────────────────────
  server.registerTool(
    'splalm_list_spl_members',
    {
      title: 'List SPL Members',
      description: `Return the GitLab project members of this SPL's repository.

Each member entry has:
  - username (string): GitLab username
  - role (number): GitLab access level — 20=Reporter, 30=Developer,
    40=Maintainer, 50=Owner

Returns: { "members": [{ "username": "alice", "role": 40 }, ...] }

Examples:
  - "Who has access to this SPL?" → use this tool
  - "Does user bob have maintainer access?" → check role >= 40`,
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const line = await splalm.get(`/api/lines/${lineId}`) as SplalmLine;
        const members = line.members ?? [];
        const text = [
          `# SPL Members (${members.length})`,
          '',
          ...members.map(m => `- **${m.username}** — role ${m.role}`),
        ].join('\n');
        return {
          content: [{ type: 'text', text }],
          structuredContent: toStructured({ members }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );
}
