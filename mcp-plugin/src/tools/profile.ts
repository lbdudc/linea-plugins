import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { splalm, handleApiError, toStructured } from '../client.js';

interface Profile {
  hosts?: string[];
  activeHost?: string | null;
}

export function registerProfileTools(server: McpServer, readOnly: boolean): void {
  server.registerTool(
    'splalm_get_profile',
    {
      title: 'Get Profile',
      description: `The git hosts the signed-in person has an account on, and the one they are working on now (their profile): LINEA shows the lines and products of one remote at a time.

Returns:
  { "hosts": string[], "activeHost": string | null }   // activeHost null: none of their hosts is on`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const { user } = (await splalm.post('/api/users/loginFromServiceToken')) as { user: Profile };
        const profile = { hosts: user.hosts ?? [], activeHost: user.activeHost ?? null };
        return { content: [{ type: 'text', text: JSON.stringify(profile, null, 2) }], structuredContent: toStructured(profile) };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  if (readOnly) return;

  server.registerTool(
    'splalm_set_profile',
    {
      title: 'Set Profile',
      description: `Choose the git host to work on (gitlab, github or local): it has to be one the person has an account on and that is on.`,
      inputSchema: { host: z.enum(['local', 'gitlab', 'github']).describe('The git host to work on') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ host }) => {
      try {
        const profile = (await splalm.put('/api/users/profile', { host })) as Profile;
        return { content: [{ type: 'text', text: JSON.stringify(profile, null, 2) }], structuredContent: toStructured(profile) };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );
}
