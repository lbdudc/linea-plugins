import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { splalm, handleApiError, toStructured } from '../client.js';
import { config } from '../config.js';
import os from 'os';
import fs from 'fs';
import path from 'path';
import type {
  AgentRun,
  AgentDefinition,
  AgentPolicy,
  KnowledgeThread,
  KnowledgeMessage,
  AgentMemory,
  FmTrees,
  PlaygroundJob,
  Branch,
  CoverageResult,
  CoveringArrayResult,
  TestConfigResult,
  WikiPageResult,
} from '../types.js';

const AGENTS = '/api/plugins/agents-plugin/api/agents';

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<string, string> = {
  pending: '⏳',
  running: '🔄',
  done: '✅',
  failed: '❌',
  cancelled: '🚫',
  awaiting_approval: '⏸️',
  awaiting_child: '🔗',
};

const STEP_ICON: Record<string, string> = {
  pending: '○',
  running: '●',
  done: '✓',
  failed: '✗',
  skipped: '–',
};

function formatRunSummary(run: AgentRun): string {
  const icon = STATUS_ICON[run.status] ?? '?';
  const scope = run.scope?.productId
    ? `product:${run.scope.productId}`
    : `line:${run.scope?.lineId ?? '—'}`;
  return `${icon} **${run.agentType}** (${run.status}) — ${scope} — id: \`${run._id}\` — ${run.createdAt}`;
}

function formatRunDetail(run: AgentRun): string {
  const icon = STATUS_ICON[run.status] ?? '?';
  const lines: string[] = [
    `# Agent Run: ${run.agentType} ${icon}`,
    '',
    `- **ID**: \`${run._id}\``,
    `- **Status**: ${run.status}`,
    `- **Scope**: ${run.scope?.productId ? `product \`${run.scope.productId}\`` : `line \`${run.scope?.lineId}\``}`,
    `- **Created**: ${run.createdAt}`,
    `- **Updated**: ${run.updatedAt}`,
    ...(run.parentRunId ? [`- **Parent run**: \`${run.parentRunId}\``] : []),
    '',
    '## Steps',
    ...(run.steps?.length
      ? run.steps.map(s => {
          const si = STEP_ICON[s.status] ?? '?';
          const out = s.output !== undefined
            ? ` — ${JSON.stringify(s.output).slice(0, 120)}`
            : '';
          return `- ${si} **${s.name}** (${s.status})${out}`;
        })
      : ['*(no steps yet)*']),
  ];

  if (run.proposals?.length) {
    lines.push('', '## Proposals');
    for (const p of run.proposals) {
      const decided = p.decision
        ? ` → ${p.decision === 'approved' ? '✅ approved' : '❌ rejected'}`
        : ' — **awaiting decision**';
      lines.push(`- **${p.kind}**: ${p.title}${decided}`);
      if (!p.decision) {
        lines.push(`  *Use \`splalm_decide_proposal\` with run_id="${run._id}" to approve or reject.*`);
      }
    }
  }

  if (run.result !== undefined) {
    lines.push('', '## Result', '```json', JSON.stringify(run.result, null, 2), '```');
  }

  if (run.error) {
    lines.push('', '## Error', `> ${run.error}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerAgentsTools(
  server: McpServer,
  lineId: string,
  readOnly: boolean,
): void {
  // ── list_agent_types ──────────────────────────────────────────────────────
  server.registerTool(
    'splalm_list_agent_types',
    {
      title: 'List Agent Types',
      description: `Return the catalog of agent types registered in SPLALM.

Each entry describes an agent that can be launched via splalm_launch_agent.

Returns:
  [
    {
      "type": string,         // agent identifier (use in splalm_launch_agent)
      "description": string,  // what the agent does
      "scope": "line" | "product"  // whether it operates on a product or the whole line
    }
  ]

Built-in agents:
  - sync (product):              Diagnose a sync conflict; propose + commit a resolution
  - harvest (product):           Detect product customizations; propose uplifting them to SPL FM
  - evolution (line):            Scan all products against FM; propose spec patches (migration) or preview impact
  - platform-doctor (line):      Diagnose platform function issues (closest-match search)
  - spl-health-snapshot (line):  Read-only health scan of all products (no LLM, fast)
  - steward (line):              Digest of open MRs and product anti-patterns
  - batch (line):                Orchestrate sync or harvest across all products in sequence
  - coverage-analysis (line):    1-wise/2-wise feature coverage gaps, stranded/zombie/coupling smells
  - fm-health (line):            FM health score: void check, non-selectable features, portfolio analysis
  - feature-location (line):     Locate a feature's platform footprint; propose @feature annotations
  - fm-constraint-advisor (line): Analyse coupling smells; propose validated UVL constraints

Examples:
  - "What agents can I launch?" → this tool`,
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
        const agents = (await splalm.get(AGENTS)) as AgentDefinition[];
        const text = [
          `# Agent Types (${agents.length})`,
          '',
          ...agents.map(a => `- **${a.type}** *(${a.scope})*: ${a.description}`),
        ].join('\n');
        return {
          content: [{ type: 'text', text }],
          structuredContent: toStructured({ agents }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── list_agent_runs ───────────────────────────────────────────────────────
  server.registerTool(
    'splalm_list_agent_runs',
    {
      title: 'List Agent Runs',
      description: `List agent runs scoped to this SPL, optionally filtered to a
specific product and/or status.

Args:
  - product_id (string, optional): Filter to runs for a specific product.
      If omitted, all runs for the whole line are returned.
  - status_filter (string, optional): Filter by status:
      "pending" | "running" | "done" | "failed" | "cancelled" |
      "awaiting_approval" | "awaiting_child"

Returns a list of run summaries (id, agentType, status, scope, createdAt).
Use splalm_get_agent_run to fetch full detail (steps + proposals) for a single run.

Status meanings:
  - pending:           queued, not yet started
  - running:           actively executing steps
  - awaiting_approval: paused at a proposal that needs a human decision
  - awaiting_child:    batch run waiting for a child run to reach a terminal state
  - done:              completed successfully
  - failed:            terminal failure
  - cancelled:         manually cancelled

Examples:
  - "Are there proposals waiting for my approval?" → { status_filter: "awaiting_approval" }
  - "What agents ran for product X?"              → { product_id: "<id>" }
  - "Show all active runs"                        → { status_filter: "running" }`,
      inputSchema: z.object({
        product_id: z.string().optional().describe(
          'MongoDB _id of a product to filter runs by',
        ),
        status_filter: z
          .enum([
            'pending',
            'running',
            'done',
            'failed',
            'cancelled',
            'awaiting_approval',
            'awaiting_child',
          ])
          .optional()
          .describe('Only return runs with this status'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ product_id, status_filter }) => {
      try {
        const params = new URLSearchParams({ lineId });
        if (product_id) params.set('productId', product_id);
        const runs = (await splalm.get(`${AGENTS}/runs?${params}`)) as AgentRun[];
        const filtered = status_filter ? runs.filter(r => r.status === status_filter) : runs;

        if (filtered.length === 0) {
          return {
            content: [{ type: 'text', text: 'No agent runs found matching the criteria.' }],
            structuredContent: toStructured({ runs: [] }),
          };
        }

        const text = [
          `# Agent Runs (${filtered.length}${runs.length !== filtered.length ? ` of ${runs.length} total` : ''})`,
          '',
          ...filtered.map(formatRunSummary),
        ].join('\n');

        return {
          content: [{ type: 'text', text }],
          structuredContent: toStructured({ runs: filtered }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── get_agent_run ─────────────────────────────────────────────────────────
  server.registerTool(
    'splalm_get_agent_run',
    {
      title: 'Get Agent Run',
      description: `Get the full status of a single agent run: steps, proposals, result, error.

Args:
  - run_id (string): MongoDB _id of the run (from splalm_list_agent_runs)

Returns the full run including:
  - status and scope
  - each step with name, status, and output snippet (first 120 chars)
  - any proposals: kind, title, decision state (decided or awaiting)
  - final result object (when status=done)
  - error message (when status=failed)

If status is "awaiting_approval", check the proposals section to see what
needs a decision, then call splalm_decide_proposal.

If a sync or harvest run has a pending "merge_resolution" or "fm_patch" proposal
you want to adjust, call splalm_refine_proposal with feedback before deciding.

Examples:
  - "What is run X doing right now?" → this tool
  - "Show me the proposals in run X" → this tool, inspect the proposals section`,
      inputSchema: z.object({
        run_id: z.string().min(1).describe('MongoDB _id of the agent run'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ run_id }) => {
      try {
        const run = (await splalm.get(`${AGENTS}/runs/${run_id}`)) as AgentRun;
        return {
          content: [{ type: 'text', text: formatRunDetail(run) }],
          structuredContent: toStructured(run),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── get_agent_policy ──────────────────────────────────────────────────────
  server.registerTool(
    'splalm_get_agent_policy',
    {
      title: 'Get Agent Policy',
      description: `Get the effective autonomy policy for a product or the whole line.

The policy resolves product-level > line-level > system defaults, so the
result always reflects what will actually be used when an agent runs.

Args:
  - product_id (string, optional): Resolve the effective policy for this product
      (merges its override into the line default). Omit to get the line-level policy.

Returns:
  {
    "scope":       { "lineId": string, "productId": string | null },
    "criticality": "critical" | "normal",
    "modes": {
      "sync":      "propose_and_wait" | "automatic",
      "harvest":   "propose_and_wait" | "automatic",
      "evolution": "propose_and_wait" | "automatic"
    }
  }

Policy meanings:
  - criticality "critical":  ALL agents require human approval (modes ignored)
  - propose_and_wait:        agent pauses and waits for your splalm_decide_proposal call
  - automatic (sync only):   agent acts without waiting when the change is
                              deterministically unambiguous (all conflicting files are
                              generator-owned; any product customization → always pauses)
  - Note: line-scoped agents (harvest, evolution) always enforce propose_and_wait
          at the blast-radius level regardless of this setting

Use splalm_set_agent_policy to change the policy.

Examples:
  - "Is product X in automatic sync mode?" → { product_id: "<id>" }, check modes.sync
  - "What's the default for new products?"  → no product_id`,
      inputSchema: z.object({
        product_id: z.string().optional().describe(
          'MongoDB _id of a product to resolve its effective policy. Omit for the line-level default.',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ product_id }) => {
      try {
        const params = new URLSearchParams({ lineId });
        if (product_id) params.set('productId', product_id);
        const policy = (await splalm.get(`${AGENTS}/policy?${params}`)) as AgentPolicy;
        const lines = [
          '# Effective Agent Policy',
          '',
          `- **Criticality**: ${policy.criticality}`,
          `- **Scope**: ${product_id ? `product \`${product_id}\`` : `line \`${lineId}\``}`,
          '',
          '## Modes',
          `- sync:      ${policy.modes?.sync ?? 'propose_and_wait'}`,
          `- harvest:   ${policy.modes?.harvest ?? 'propose_and_wait'}`,
          `- evolution: ${policy.modes?.evolution ?? 'propose_and_wait'}`,
        ];
        if (policy.criticality === 'critical') {
          lines.push(
            '',
            '*⚠️ Criticality is "critical" — all agents will require approval regardless of mode.*',
          );
        }
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: toStructured(policy),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── list_knowledge_threads ────────────────────────────────────────────────
  server.registerTool(
    'splalm_list_knowledge_threads',
    {
      title: 'List Knowledge Threads',
      description: `List existing Knowledge chat threads for this SPL.

The Knowledge agent answers questions about this SPL's products, feature model,
and configuration using an LLM backed by live SPL data.
Each thread is a persistent conversation that you can continue.

Returns: [{ "_id": string, "createdAt": string, "updatedAt": string }]

Use splalm_get_knowledge_messages to read a thread's history, or
splalm_ask_knowledge with thread_id to continue an existing conversation.

Examples:
  - "Show my previous SPL conversations" → this tool`,
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
        const threads = (await splalm.get(
          `${AGENTS}/knowledge/threads?lineId=${lineId}`,
        )) as KnowledgeThread[];

        if (threads.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No knowledge threads found. Use splalm_ask_knowledge to start a conversation.',
            }],
            structuredContent: toStructured({ threads: [] }),
          };
        }

        const text = [
          `# Knowledge Threads (${threads.length})`,
          '',
          ...threads.map(t => `- \`${t._id}\` — created ${t.createdAt}, updated ${t.updatedAt}`),
        ].join('\n');

        return {
          content: [{ type: 'text', text }],
          structuredContent: toStructured({ threads }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── get_knowledge_messages ────────────────────────────────────────────────
  server.registerTool(
    'splalm_get_knowledge_messages',
    {
      title: 'Get Knowledge Messages',
      description: `Retrieve all messages in a Knowledge chat thread.

Args:
  - thread_id (string): MongoDB _id of the thread (from splalm_list_knowledge_threads)

Returns: [{ "role": "user" | "assistant", "content": string, "createdAt": string }]

Examples:
  - "What did I ask the knowledge agent last session?" → this tool`,
      inputSchema: z.object({
        thread_id: z.string().min(1).describe(
          'MongoDB _id of the knowledge thread (from splalm_list_knowledge_threads)',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ thread_id }) => {
      try {
        const messages = (await splalm.get(
          `${AGENTS}/knowledge/threads/${thread_id}/messages`,
        )) as KnowledgeMessage[];

        const text = messages
          .map(m => {
            const role = m.role === 'user' ? '👤 You' : '🤖 Knowledge';
            const content =
              typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            return `**${role}** *(${m.createdAt})*\n${content}`;
          })
          .join('\n\n---\n\n');

        return {
          content: [{ type: 'text', text: text || 'No messages in this thread.' }],
          structuredContent: toStructured({ messages }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── ask_knowledge ─────────────────────────────────────────────────────────
  server.registerTool(
    'splalm_ask_knowledge',
    {
      title: 'Ask Knowledge',
      description: `Ask a question about this SPL. The Knowledge agent answers using an
LLM backed by live tools: it can list products, read the feature model, and
check product health — then compose a natural-language answer.

Available in read-only mode. The agent reads SPL data but does not modify anything.

Args:
  - content (string): Your question or message
  - thread_id (string, optional): Existing thread _id to continue a conversation.
      If omitted, a new thread is created automatically.

Returns:
  {
    "threadId": string,     // save this to continue the conversation
    "message": { "role": "assistant", "content": string }
  }

Pass the returned threadId back as thread_id in future calls to maintain context.

Examples:
  - "How many products are currently invalid?"          → ask a question
  - "Which products have feature X selected?"           → ask a question
  - "Explain the constraints in the feature model"      → ask about the FM
  - Continue a previous chat: { content: "...", thread_id: "<id>" }`,
      inputSchema: z.object({
        content: z.string().min(1).describe('The question or message to send to the Knowledge agent'),
        thread_id: z.string().optional().describe(
          'Existing thread _id to continue a conversation (omit to start a new thread)',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ content, thread_id }) => {
      try {
        const body: Record<string, unknown> = { lineId, content };
        if (thread_id) body['threadId'] = thread_id;
        const result = (await splalm.post(
          '${AGENTS}/knowledge/message',
          body,
        )) as Record<string, unknown>;

        const msg = result['message'] as { role: string; content: unknown } | undefined;
        const reply =
          typeof msg?.content === 'string'
            ? msg.content
            : JSON.stringify(msg?.content ?? result);
        const tid = result['threadId'] as string | undefined;

        const text = [
          reply,
          '',
          tid
            ? `*Thread ID: \`${tid}\` — pass as thread_id to continue this conversation.*`
            : '',
        ]
          .join('\n')
          .trimEnd();

        return {
          content: [{ type: 'text', text }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── get_playground_fm ─────────────────────────────────────────────────────
  server.registerTool(
    'splalm_get_playground_fm',
    {
      title: 'Get Playground FM',
      description: `Get the current and proposed feature model trees for the playground
FM selector on a paused run. Useful for comparing what the proposal changes in
the feature model before deciding.

Args:
  - run_id (string): MongoDB _id of the run (must be "awaiting_approval")

Returns { current, proposed } FM tree objects.`,
      inputSchema: z.object({
        run_id: z.string().min(1).describe('MongoDB _id of the paused run'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ run_id }) => {
      try {
        const trees = (await splalm.get(
          `${AGENTS}/runs/${run_id}/playground/fm`,
        )) as FmTrees;
        const hasProposed = trees.proposed !== null;
        return {
          content: [{
            type: 'text',
            text: [
              `# Playground FM Trees (run \`${run_id}\`)`,
              '',
              hasProposed
                ? '**Proposed FM:** present — see structuredContent.proposed'
                : '**Proposed FM:** none (no FM change in this proposal)',
              '',
              '```json',
              JSON.stringify(trees, null, 2).slice(0, 2000),
              '```',
            ].join('\n'),
          }],
          structuredContent: toStructured(trees),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── list_product_branches ─────────────────────────────────────────────────
  server.registerTool(
    'splalm_list_product_branches',
    {
      title: 'List Product Branches',
      description: `List GitLab branches for a product's repository. Useful for
selecting a branch in splalm_playground_test or splalm_playground_download.

Args:
  - run_id (string): MongoDB _id of a paused run (used to resolve GitLab access)
  - product_id (string): MongoDB _id of the product whose branches to list
  - search (string, optional): Filter branches by name prefix

Returns [{ name, default }].`,
      inputSchema: z.object({
        run_id: z.string().min(1).describe('MongoDB _id of the paused run'),
        product_id: z.string().min(1).describe('MongoDB _id of the product'),
        search: z.string().optional().describe('Optional branch name filter'),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ run_id, product_id, search }) => {
      try {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        const qs = params.toString() ? `?${params}` : '';
        const branches = (await splalm.get(
          `${AGENTS}/runs/${run_id}/playground/branches/${product_id}${qs}`,
        )) as Branch[];
        const text = [
          `# Branches for product \`${product_id}\` (${branches.length})`,
          '',
          ...branches.map(b => `- ${b.name}${b.default ? ' *(default)*' : ''}`),
        ].join('\n');
        return {
          content: [{ type: 'text', text }],
          structuredContent: toStructured({ branches }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── list_memory ───────────────────────────────────────────────────────────
  server.registerTool(
    'splalm_list_memory',
    {
      title: 'List Agent Memory',
      description: `List durable agent memories for this SPL. Memories are captured
automatically from agent decisions and run outcomes — they are injected into
future agent system prompts to improve proposals over time.

Args:
  - product_id (string, optional): Filter to memories for a specific product.
      Omit to get line-level memories only.
  - limit (number, optional): Maximum entries to return (default: 50)

Returns: [{ _id, agentType, kind, content, sourceRunId, createdAt }]

Memory kinds:
  - decision: a proposal the user approved or rejected
  - fact:     a factual observation captured from a run result
  - lesson:   a higher-level lesson learned across runs

Use splalm_delete_memory or splalm_clear_memory to remove stale entries.`,
      inputSchema: z.object({
        product_id: z.string().optional().describe(
          'MongoDB _id of a product. Omit to get line-level memories.',
        ),
        limit: z.number().int().min(1).max(200).optional().describe(
          'Maximum number of memories to return (default: 50)',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ product_id, limit }) => {
      try {
        const params = new URLSearchParams({ lineId });
        if (product_id) params.set('productId', product_id);
        if (limit !== undefined) params.set('limit', String(limit));
        const memories = (await splalm.get(
          `${AGENTS}/memory?${params}`,
        )) as AgentMemory[];
        if (memories.length === 0) {
          return {
            content: [{ type: 'text', text: 'No agent memories found for this scope.' }],
            structuredContent: toStructured({ memories: [] }),
          };
        }
        const text = [
          `# Agent Memories (${memories.length})`,
          '',
          ...memories.map(m =>
            `- **[${m.kind}]** ${m.agentType} — ${m.content.slice(0, 120)} *(id: \`${m._id}\`)*`
          ),
        ].join('\n');
        return {
          content: [{ type: 'text', text }],
          structuredContent: toStructured({ memories }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── splalm_get_coverage ───────────────────────────────────────────────────
  server.registerTool(
    'splalm_get_coverage',
    {
      title: 'Get SPL Coverage',
      description: `Return live 1-wise and 2-wise feature coverage statistics for this SPL.

Runs the deterministic coverage computation synchronously (no LLM, no GitLab write).
Use this to understand which feature pairs are untested before running the
Variant Test Pilot (Agent C).

Returns:
  {
    "coverage1Wise":      number,   // % of FM features selected by at least one product
    "coverage2Wise":      number,   // % of all FM feature pairs co-selected by some product
    "covered1Wise":       number,   // raw count of covered features
    "total1Wise":         number,   // total FM feature count
    "coveredPairsCount":  number,
    "totalPairsCount":    number,
    "riskyUncoveredPairs": [[f1, f2], ...]  // top-15, sorted by combined frequency (risk)
  }

Examples:
  - "What's our current test coverage?" → this tool
  - "Which feature pairs have never been tested together?" → check riskyUncoveredPairs`,
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
        const coverage = (await splalm.get(
          `${AGENTS}/coverage?lineId=${lineId}`,
        )) as CoverageResult;
        const text = [
          '# SPL Coverage',
          '',
          `- **1-wise**: ${coverage.coverage1Wise}% (${coverage.covered1Wise}/${coverage.total1Wise} features)`,
          `- **2-wise**: ${coverage.coverage2Wise}% (${coverage.coveredPairsCount}/${coverage.totalPairsCount} pairs)`,
          '',
          `## Top Risky Uncovered Pairs (${coverage.riskyUncoveredPairs.length})`,
          ...coverage.riskyUncoveredPairs.map(([a, b]) => `- (${a}, ${b})`),
        ].join('\n');
        return {
          content: [{ type: 'text', text }],
          structuredContent: toStructured(coverage),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── splalm_generate_covering_array ────────────────────────────────────────
  server.registerTool(
    'splalm_generate_covering_array',
    {
      title: 'Generate Covering Array',
      description: `Generate a minimal set of valid feature configurations that cover
all currently-uncovered pairwise (2-wise) combinations of used features.

Each configuration is completed with model.completeFeatureSelection so every
returned config is structurally valid and derivable. Infeasible pairs (FM
constraints prevent co-selection) are returned in remainingUncovered rather
than generating invalid configs.

This is the deterministic core of the Variant Test Pilot (Agent C). Run
splalm_get_coverage first to understand the current gap, then this tool to
get the configs to test.

Args:
  - t (number, optional): interaction degree (only t=2 is supported, default 2)
  - max_configs (number, optional): safety cap on generated configs (default 50, max 200)

Returns:
  {
    "configsCount":            number,
    "remainingUncoveredCount": number,
    "configs": [
      {
        "features":          string[],          // complete valid feature selection
        "newlyCoveredPairs": [[f1, f2], ...]    // pairs newly covered by this config
      }
    ],
    "remainingUncovered": [[f1, f2], ...]  // infeasible or capped pairs
  }

Examples:
  - "Generate configs to close coverage gaps" → this tool
  - "What configs should I test to reach full pairwise coverage?" → this tool`,
      inputSchema: z.object({
        t: z.number().int().min(2).max(2).optional().describe(
          'Interaction degree — only t=2 (pairwise) is supported (default: 2)',
        ),
        max_configs: z.number().int().min(1).max(200).optional().describe(
          'Maximum number of configurations to generate (default: 50)',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ t, max_configs }) => {
      try {
        const params = new URLSearchParams({ lineId });
        if (t !== undefined) params.set('t', String(t));
        if (max_configs !== undefined) params.set('maxConfigs', String(max_configs));
        const result = (await splalm.get(
          `${AGENTS}/covering-array?${params}`,
        )) as CoveringArrayResult;
        const text = [
          `# Covering Array (${result.configsCount} configs)`,
          '',
          `- Configs to test: **${result.configsCount}**`,
          `- Infeasible / capped pairs: **${result.remainingUncoveredCount}**`,
          '',
          ...result.configs.map((c, i) => [
            `## Config ${i + 1} (${c.features.length} features, covers ${c.newlyCoveredPairs.length} new pairs)`,
            `Features: ${c.features.join(', ')}`,
            `New pairs: ${c.newlyCoveredPairs.map(([a, b]) => `(${a}, ${b})`).join('; ')}`,
          ].join('\n')),
        ].join('\n');
        return {
          content: [{ type: 'text', text }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── Write tools — disabled in read-only mode ──────────────────────────────
  if (readOnly) return;

  // ── launch_agent ──────────────────────────────────────────────────────────
  server.registerTool(
    'splalm_launch_agent',
    {
      title: 'Launch Agent',
      description: `Start an agent run for this SPL. The run is queued immediately and
executed asynchronously. Track progress with splalm_get_agent_run.

Args:
  - agent_type (string): Agent to launch (see splalm_list_agent_types)
  - product_id (string, optional): MongoDB _id of the product.
      Required for product-scoped agents (sync, harvest).
  - input (object, optional): Agent-specific parameters (see below)

Agent types, scopes, and input fields:

  sync (product-scoped) — diagnose sync conflict; propose + commit resolution
    product_id: required
    input: {}  ← lineId/productId auto-injected

  harvest (product-scoped) — detect product customizations; propose SPL uplift
    product_id: required
    input: {}  ← lineId/productId auto-injected

  evolution (line-scoped) — scan products against FM; propose spec patches
    product_id: not needed
    input: { mode: "migration" }
        OR { mode: "impact", proposedModelUvl: "<full UVL string>" }

  platform-doctor (line-scoped) — closest-match diagnosis for a platform function
    product_id: not needed
    input: { functionName: "generateMyFunction" }

  spl-health-snapshot (line-scoped) — read-only health scan (no LLM, fast)
    product_id: not needed
    input: {}

  steward (line-scoped) — digest of open MRs and product anti-patterns
    product_id: not needed
    input: {}

  batch (line-scoped) — run sync or harvest across ALL products in sequence
    product_id: not needed
    input: { childAgent: "sync" | "harvest" }

  coverage-analysis (line-scoped) — 1-wise/2-wise coverage gaps, coupling smells
    product_id: not needed
    input: {}

  fm-health (line-scoped) — FM health score: void, non-selectable, stranded/zombie
    product_id: not needed
    input: {}

  feature-location (line-scoped) — locate a feature's platform footprint
    product_id: not needed
    input: { featureName: "MyFeature" }
        OR { featureName: "MyFeature", annotate: true }  ← also propose @feature MR

  fm-constraint-advisor (line-scoped) — analyse coupling smells; propose validated UVL constraints
    product_id: not needed
    input: {}
        OR { dryRun: true }  ← validate and build the MR payload without writing to GitLab

Dry-run mode (any write agent):
  Pass dry_run: true (or input: { dryRun: true }) to exercise the full agent path —
  all reads, LLM proposals, and deterministic validation — without making any GitLab or
  DB writes. The run result contains the would-be commit/MR payload for inspection.

Returns the created AgentRun with initial status "pending".

The effective autonomy policy (splalm_get_agent_policy) controls whether runs
pause for approval or act automatically. All line-scoped writes always pause.

Examples:
  - "Scan the whole SPL health":              { agent_type: "spl-health-snapshot" }
  - "Diagnose sync for product X":            { agent_type: "sync", product_id: "<id>" }
  - "Run sync across all products":           { agent_type: "batch", input: { childAgent: "sync" } }
  - "Check what feature X would break":       { agent_type: "evolution", input: { mode: "impact", proposedModelUvl: "..." } }
  - "Dry-run harvest for product X":          { agent_type: "harvest", product_id: "<id>", dry_run: true }
  - "Propose FM constraints (dry-run)":       { agent_type: "fm-constraint-advisor", dry_run: true }`,
      inputSchema: z.object({
        agent_type: z
          .enum([
            'sync',
            'harvest',
            'evolution',
            'platform-doctor',
            'spl-health-snapshot',
            'steward',
            'batch',
            'coverage-analysis',
            'fm-health',
            'feature-location',
            'fm-constraint-advisor',
          ])
          .describe('The agent type to launch'),
        product_id: z.string().optional().describe(
          'MongoDB _id of the product (required for sync and harvest)',
        ),
        feature_name: z.string().optional().describe(
          'Feature identifier for feature-location (e.g. "Analytics"). Shorthand for input.featureName.',
        ),
        annotate: z.boolean().optional().describe(
          'For feature-location: also propose @feature JSDoc annotations in platform files (default false).',
        ),
        dry_run: z.boolean().optional().describe(
          'Perform all reads, validation, and payload construction without making any GitLab or DB writes. ' +
          'The run result contains the would-be payload. Safe for first-time testing of any write agent.',
        ),
        input: z
          .record(z.unknown())
          .optional()
          .describe('Agent-specific input parameters (see tool description for each type)'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ agent_type, product_id, feature_name, annotate, dry_run, input }) => {
      try {
        const scope: Record<string, string> = { lineId };
        if (product_id) scope['productId'] = product_id;

        const mergedInput: Record<string, unknown> = { ...(input ?? {}) };
        if (product_id) mergedInput['productId'] = product_id;
        if (agent_type === 'sync' || agent_type === 'harvest') mergedInput['lineId'] = lineId;
        if (feature_name) mergedInput['featureName'] = feature_name;
        if (annotate !== undefined) mergedInput['annotate'] = annotate;
        if (dry_run) mergedInput['dryRun'] = true;

        const run = (await splalm.post('${AGENTS}/runs', {
          agentType: agent_type,
          scope,
          input: mergedInput,
        })) as AgentRun;

        return {
          content: [{
            type: 'text',
            text: [
              `✓ Agent **${agent_type}** launched — run ID: \`${run._id}\``,
              `Status: ${run.status}`,
              '',
              `Track progress: splalm_get_agent_run with run_id="${run._id}"`,
            ].join('\n'),
          }],
          structuredContent: toStructured(run),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── decide_proposal ───────────────────────────────────────────────────────
  server.registerTool(
    'splalm_decide_proposal',
    {
      title: 'Decide Proposal',
      description: `Approve or reject a pending proposal on a run that is paused at
"awaiting_approval".

⚠️  Approving certain proposal kinds triggers IRREVERSIBLE actions:
  - merge_resolution: commits reconciled files onto the product's source branch in GitLab
  - spec_patch:       updates product specs in the SPLALM database
  - fm_patch:         opens a Merge Request on the LINE repository with FM+platform changes
  - gitlab_comment:   posts a comment to a GitLab Merge Request

Always call splalm_get_agent_run first to review the proposal before deciding.
For sync/harvest runs you can also call splalm_refine_proposal to adjust the
proposal via chat before approving.

Args:
  - run_id (string): MongoDB _id of the run
  - decision ("approved" | "rejected"): Your decision
  - proposal_id (string, optional): _id of a specific proposal to decide.
      If omitted, the first undecided proposal on the run is used.

Returns the updated AgentRun.

Examples:
  - Approve a sync resolution: { run_id: "<id>", decision: "approved" }
  - Reject a harvest proposal: { run_id: "<id>", decision: "rejected" }`,
      inputSchema: z.object({
        run_id: z.string().min(1).describe('MongoDB _id of the agent run'),
        decision: z
          .enum(['approved', 'rejected'])
          .describe('Your decision on the proposal'),
        proposal_id: z.string().optional().describe(
          '_id of the specific proposal to decide. Omit to decide the first undecided proposal.',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ run_id, decision, proposal_id }) => {
      try {
        const body: Record<string, unknown> = { decision };
        if (proposal_id) body['proposalId'] = proposal_id;
        const run = (await splalm.post(
          `${AGENTS}/runs/${run_id}/decide`,
          body,
        )) as AgentRun;
        const icon = decision === 'approved' ? '✅' : '❌';
        return {
          content: [{
            type: 'text',
            text: `${icon} Proposal ${decision}. Run status: **${run.status}**`,
          }],
          structuredContent: toStructured(run),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── cancel_agent_run ──────────────────────────────────────────────────────
  server.registerTool(
    'splalm_cancel_agent_run',
    {
      title: 'Cancel Agent Run',
      description: `Cancel a pending or running agent run. Already-completed steps
are NOT rolled back — only future execution is halted.

Args:
  - run_id (string): MongoDB _id of the run

Returns the updated run with status "cancelled".

Examples:
  - Stop a batch run before it processes more products: { run_id: "<id>" }
  - Dismiss a run that is stuck in pending:             { run_id: "<id>" }`,
      inputSchema: z.object({
        run_id: z.string().min(1).describe('MongoDB _id of the agent run to cancel'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ run_id }) => {
      try {
        const run = (await splalm.post(
          `${AGENTS}/runs/${run_id}/cancel`,
        )) as AgentRun;
        return {
          content: [{ type: 'text', text: `🚫 Run cancelled. Status: **${run.status}**` }],
          structuredContent: toStructured(run),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── refine_proposal ───────────────────────────────────────────────────────
  server.registerTool(
    'splalm_refine_proposal',
    {
      title: 'Refine Proposal',
      description: `Send feedback to re-run the LLM proposal loop on a paused run.
The current proposal is replaced in place with a new one that incorporates
your feedback. The run stays "awaiting_approval" until you decide.

Use this to steer the resolution before committing — for example: "Keep our
custom README", "Use feature Y instead of adding a new one", "Don't touch
docker-compose.yml".

Works for:
  - sync runs with a pending "merge_resolution" proposal
  - harvest runs with a pending "fm_patch" proposal

Args:
  - run_id (string): MongoDB _id of the run (must be "awaiting_approval")
  - message (string): Feedback or instructions for the LLM

The refined proposal is returned directly and the run stays awaiting_approval.
Call splalm_decide_proposal after reviewing the result.

Examples:
  - "Preserve README.md":  { run_id: "<id>", message: "Keep our README.md exactly as-is" }
  - "No new features":     { run_id: "<id>", message: "Don't add new features; use Optional feature Y instead" }`,
      inputSchema: z.object({
        run_id: z.string().min(1).describe(
          'MongoDB _id of the run (must be awaiting_approval with a sync or harvest proposal)',
        ),
        message: z.string().min(1).describe(
          'Feedback or instructions to guide the LLM in refining the proposal',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ run_id, message }) => {
      try {
        const result = (await splalm.post(
          `${AGENTS}/runs/${run_id}/refine`,
          { message },
        )) as Record<string, unknown>;
        return {
          content: [{
            type: 'text',
            text: [
              '✓ Refinement submitted. The updated proposal has replaced the previous one.',
              '',
              `Call splalm_get_agent_run with run_id="${run_id}" to review the new proposal,`,
              'then call splalm_decide_proposal to approve or reject it.',
            ].join('\n'),
          }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── set_agent_policy ──────────────────────────────────────────────────────
  server.registerTool(
    'splalm_set_agent_policy',
    {
      title: 'Set Agent Policy',
      description: `Update the autonomy policy for a product or the whole line.

A product policy overrides the line policy for that specific product.
The line policy is the default for all products with no explicit override.

Args:
  - product_id (string, optional): MongoDB _id of the product to configure.
      If omitted, updates the line-level default policy.
  - criticality ("critical" | "normal", optional):
      "critical" forces approval on ALL agents regardless of mode.
      "normal" respects the per-agent mode setting.
  - modes (object, optional): Per-agent mode overrides:
      - sync:      "propose_and_wait" | "automatic"
      - harvest:   "propose_and_wait" | "automatic"
      - evolution: "propose_and_wait" | "automatic"

Behaviour notes:
  - "automatic" for sync only activates when the proposed change is
    deterministically unambiguous — all conflicting files are generator-owned
    and none are product customizations. Any customization conflict still pauses.
  - Line-scoped agents (harvest, evolution) enforce propose_and_wait at the
    blast-radius level regardless of this setting.
  - Omitted fields are left unchanged (partial update supported).

Returns the stored policy document.

Examples:
  - Enable automatic sync for product X:  { product_id: "<id>", modes: { sync: "automatic" } }
  - Mark the whole line as critical:       { criticality: "critical" }
  - Reset product X to line defaults:      { product_id: "<id>", criticality: "normal", modes: { sync: "propose_and_wait" } }`,
      inputSchema: z.object({
        product_id: z.string().optional().describe(
          'MongoDB _id of the product. Omit to update the line-level default.',
        ),
        criticality: z
          .enum(['critical', 'normal'])
          .optional()
          .describe(
            '"critical" forces approval on all agents; "normal" respects the mode setting',
          ),
        modes: z
          .object({
            sync: z.enum(['propose_and_wait', 'automatic']).optional(),
            harvest: z.enum(['propose_and_wait', 'automatic']).optional(),
            evolution: z.enum(['propose_and_wait', 'automatic']).optional(),
          })
          .optional()
          .describe('Per-agent mode overrides (omit fields to leave them unchanged)'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ product_id, criticality, modes }) => {
      try {
        const body: Record<string, unknown> = { lineId };
        if (product_id) body['productId'] = product_id;
        if (criticality !== undefined) body['criticality'] = criticality;
        if (modes !== undefined) body['modes'] = modes;
        const policy = (await splalm.put('${AGENTS}/policy', body)) as AgentPolicy;
        return {
          content: [{
            type: 'text',
            text: `✓ Policy updated.\n\n${JSON.stringify(policy, null, 2)}`,
          }],
          structuredContent: toStructured(policy),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── validate_proposal ─────────────────────────────────────────────────────
  server.registerTool(
    'splalm_validate_proposal',
    {
      title: 'Validate Proposal',
      description: `Re-run the deterministic FM validation on the pending proposal of a
paused sync or harvest run. Use this after editing the feature model to check
whether the proposal still holds before deciding.

Works for:
  - sync runs with a pending "merge_resolution" proposal
  - harvest runs with a pending "fm_patch" proposal

Args:
  - run_id (string): MongoDB _id of the run (must be "awaiting_approval")

Returns the updated validation result. The run stays awaiting_approval.

Examples:
  - Check that a harvest proposal still admits all products: { run_id: "<id>" }`,
      inputSchema: z.object({
        run_id: z.string().min(1).describe('MongoDB _id of the paused run to re-validate'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ run_id }) => {
      try {
        const result = (await splalm.post(
          `${AGENTS}/runs/${run_id}/validate`,
        )) as Record<string, unknown>;
        const fm = result['validation'] as { fm?: unknown } | undefined;
        return {
          content: [{
            type: 'text',
            text: [
              '✓ Validation complete.',
              '',
              '```json',
              JSON.stringify(fm ?? result, null, 2),
              '```',
            ].join('\n'),
          }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── restore_proposal_version ──────────────────────────────────────────────
  server.registerTool(
    'splalm_restore_proposal_version',
    {
      title: 'Restore Proposal Version',
      description: `Revert a paused sync or harvest proposal to an earlier version
from its history. The current state is saved as a new version first, so the
restore is itself reversible.

Each call to splalm_refine_proposal records the prior version, so you can use
this to compare and undo refinements before deciding.

Args:
  - run_id (string): MongoDB _id of the run (must be "awaiting_approval")
  - version_index (number): Zero-based index into the proposal's versions array
  - proposal_id (string, optional): _id of the specific proposal; defaults to
      the first undecided versioned proposal on the run

Returns the updated proposal.

Examples:
  - Undo the last refinement: { run_id: "<id>", version_index: 0 }`,
      inputSchema: z.object({
        run_id: z.string().min(1).describe('MongoDB _id of the paused run'),
        version_index: z.number().int().min(0).describe(
          'Zero-based index of the version to restore',
        ),
        proposal_id: z.string().optional().describe(
          '_id of a specific proposal. Omit to use the first undecided versioned proposal.',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ run_id, version_index, proposal_id }) => {
      try {
        const body: Record<string, unknown> = { versionIndex: version_index };
        if (proposal_id) body['proposalId'] = proposal_id;
        const result = (await splalm.post(
          `${AGENTS}/runs/${run_id}/restore-version`,
          body,
        )) as Record<string, unknown>;
        return {
          content: [{
            type: 'text',
            text: `✓ Proposal restored to version ${version_index}. Call splalm_get_agent_run to review.`,
          }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── test_proposal ─────────────────────────────────────────────────────────
  server.registerTool(
    'splalm_test_proposal',
    {
      title: 'Test Proposal',
      description: `Launch an automated test of the pending merge_resolution proposal's
file edits against the product's test suite. The job runs asynchronously and
streams progress via WebSocket.

⚠️  MCP limitation: stdio MCP cannot subscribe to the server's Socket.IO
events. The job ID is returned immediately — monitor progress and results in
the SPLALM web UI (/agents page, run timeline).

Args:
  - run_id (string): MongoDB _id of the run (must be "awaiting_approval"
      with a pending merge_resolution proposal)

Returns { jobId } immediately. The test result is visible in the run timeline.

Examples:
  - Test the resolved files before committing: { run_id: "<id>" }`,
      inputSchema: z.object({
        run_id: z.string().min(1).describe(
          'MongoDB _id of the run with a pending merge_resolution proposal',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ run_id }) => {
      try {
        const result = (await splalm.post(
          `${AGENTS}/runs/${run_id}/test-proposal`,
        )) as PlaygroundJob;
        return {
          content: [{
            type: 'text',
            text: [
              `✓ Test job launched — jobId: \`${result.jobId}\``,
              '',
              'Progress streams via Socket.IO. Monitor results in the SPLALM Agents UI.',
            ].join('\n'),
          }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── playground_test ───────────────────────────────────────────────────────
  server.registerTool(
    'splalm_playground_test',
    {
      title: 'Playground Test',
      description: `Start a sandbox test job for one product against a specific feature
selection and branch, optionally overlaying the pending line changes. Useful
for testing a configuration before it exists as a real product.

⚠️  MCP limitation: results stream via Socket.IO — monitor progress in the
SPLALM Agents UI.

Args:
  - run_id (string): MongoDB _id of the run (must be "awaiting_approval")
  - product_id (string): MongoDB _id of the product to derive and test
  - branch (string, optional): branch to base the test on (default: "main")
  - feature_selection (string[], optional): features to select (default: [])
  - override_with_line_changes (boolean, optional): apply pending line changes (default: true)
  - test_command (string, optional): shell command to run (default: "")
  - test_image (string, optional): Docker image for the test runner (default: "")

Returns { jobId } immediately.`,
      inputSchema: z.object({
        run_id: z.string().min(1).describe('MongoDB _id of the paused run'),
        product_id: z.string().min(1).describe('MongoDB _id of the product to test'),
        branch: z.string().optional().describe('Branch to base the sandbox on (default: main)'),
        feature_selection: z.array(z.string()).optional().describe(
          'Feature identifiers to select for the derived product',
        ),
        override_with_line_changes: z.boolean().optional().describe(
          'Overlay the pending line changes from the proposal (default: true)',
        ),
        test_command: z.string().optional().describe('Shell command to run inside the container'),
        test_image: z.string().optional().describe('Docker image to use for the test runner'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ run_id, product_id, branch, feature_selection, override_with_line_changes, test_command, test_image }) => {
      try {
        const body: Record<string, unknown> = { productId: product_id };
        if (branch !== undefined) body['branch'] = branch;
        if (feature_selection !== undefined) body['featureSelection'] = feature_selection;
        if (override_with_line_changes !== undefined) body['overrideWithLineChanges'] = override_with_line_changes;
        if (test_command !== undefined) body['testCommand'] = test_command;
        if (test_image !== undefined) body['testImage'] = test_image;
        const result = (await splalm.post(
          `${AGENTS}/runs/${run_id}/playground/test`,
          body,
        )) as PlaygroundJob;
        return {
          content: [{
            type: 'text',
            text: `✓ Playground test launched — jobId: \`${result.jobId}\`\n\nMonitor results in the SPLALM Agents UI.`,
          }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── playground_download ───────────────────────────────────────────────────
  server.registerTool(
    'splalm_playground_download',
    {
      title: 'Playground Download',
      description: `Derive a product with a given feature selection (optionally overlaying
the pending proposal changes) and download the result as a zip file to a local
directory. Useful for inspecting the generated output before committing.

The zip is saved to MCP_DOWNLOAD_DIR (env var, defaults to the OS temp dir).

Args:
  - run_id (string): MongoDB _id of the run (must be "awaiting_approval")
  - product_id (string): MongoDB _id of the product to derive
  - branch (string, optional): branch to base on (default: "main")
  - feature_selection (string[], optional): features to select (default: [])
  - override_with_line_changes (boolean, optional): apply pending changes (default: true)

Returns { filePath, filename } of the saved zip.`,
      inputSchema: z.object({
        run_id: z.string().min(1).describe('MongoDB _id of the paused run'),
        product_id: z.string().min(1).describe('MongoDB _id of the product to derive'),
        branch: z.string().optional().describe('Branch to base on (default: main)'),
        feature_selection: z.array(z.string()).optional().describe(
          'Feature identifiers to select',
        ),
        override_with_line_changes: z.boolean().optional().describe(
          'Overlay pending proposal changes (default: true)',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ run_id, product_id, branch, feature_selection, override_with_line_changes }) => {
      try {
        const body: Record<string, unknown> = { productId: product_id };
        if (branch !== undefined) body['branch'] = branch;
        if (feature_selection !== undefined) body['featureSelection'] = feature_selection;
        if (override_with_line_changes !== undefined) body['overrideWithLineChanges'] = override_with_line_changes;

        const { buffer, filename } = await splalm.getBinary(
          `${AGENTS}/runs/${run_id}/playground/download`,
          body,
        );

        const dir = config.MCP_DOWNLOAD_DIR || os.tmpdir();
        const filePath = path.join(dir, filename);
        fs.writeFileSync(filePath, buffer);

        return {
          content: [{
            type: 'text',
            text: `✓ Downloaded **${filename}** (${(buffer.length / 1024).toFixed(1)} KB)\n\nSaved to: \`${filePath}\``,
          }],
          structuredContent: toStructured({ filePath, filename, sizeBytes: buffer.length }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── delete_memory ─────────────────────────────────────────────────────────
  server.registerTool(
    'splalm_delete_memory',
    {
      title: 'Delete Memory Entry',
      description: `Delete a single agent memory entry by ID. Use this to remove
an incorrect or outdated fact or decision record.

Args:
  - memory_id (string): MongoDB _id of the memory entry (from splalm_list_memory)

Examples:
  - Remove a wrong decision capture: { memory_id: "<id>" }`,
      inputSchema: z.object({
        memory_id: z.string().min(1).describe(
          'MongoDB _id of the memory entry to delete (from splalm_list_memory)',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ memory_id }) => {
      try {
        await splalm.delete(`${AGENTS}/memory/${memory_id}`);
        return {
          content: [{ type: 'text', text: `✓ Memory entry \`${memory_id}\` deleted.` }],
          structuredContent: toStructured({ deleted: memory_id }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── clear_memory ──────────────────────────────────────────────────────────
  server.registerTool(
    'splalm_clear_memory',
    {
      title: 'Clear Agent Memory',
      description: `Delete ALL agent memories for this line (or for a specific product).
⚠️ This is irreversible — use splalm_delete_memory for targeted removal.

Args:
  - product_id (string, optional): Scope the clear to a specific product.
      Omit to clear ALL line-level memories.

Examples:
  - Clear everything for the line:       {} (no args)
  - Clear memories for product X:        { product_id: "<id>" }`,
      inputSchema: z.object({
        product_id: z.string().optional().describe(
          'MongoDB _id of the product to clear memories for. Omit to clear line-level memories.',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ product_id }) => {
      try {
        const params = new URLSearchParams({ lineId });
        if (product_id) params.set('productId', product_id);
        await splalm.delete(`${AGENTS}/memory?${params}`);
        const scope = product_id ? `product \`${product_id}\`` : `line \`${lineId}\``;
        return {
          content: [{ type: 'text', text: `✓ All agent memories cleared for ${scope}.` }],
          structuredContent: toStructured({ cleared: true, scope }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── splalm_test_configuration ─────────────────────────────────────────────
  server.registerTool(
    'splalm_test_configuration',
    {
      title: 'Test Feature Configuration',
      description: `Derive a product with a specific feature selection and run its
test suite silently. Annotation-gated tests in the line platform appear based
on the feature selection, so this effectively executes a covering-array
configuration end-to-end.

This is the execution core of the Variant Test Pilot (Agent C). It:
  1. Downloads the base product scaffold from its default branch
  2. Derives the line platform with the given feature selection
     (line-platform annotations produce feature-conditional tests here)
  3. Merges the generated code into the product scaffold
  4. Runs the product's configured test command (or auto-detects npm/mvn/gradle/go/cargo)
  5. Returns pass/fail + the full test log

Blocks until tests complete (up to the configured testTimeoutMs, default 5 min).

Args:
  - product_id (string): MongoDB _id of the base product to use as scaffold
  - feature_selection (string[]): Features to activate for the derived config

Returns:
  {
    "passed":        boolean,  // true = tests passed
    "exitCode":      number,   // raw process exit code
    "log":           string,   // full test output
    "noTestCommand": boolean   // true = no test command found; passed is false
  }

Examples:
  - Test a covering-array config from splalm_generate_covering_array:
      { product_id: "<id>", feature_selection: ["Core", "Auth", "PdfExport"] }
  - Fault minimisation (drop a feature, re-test to isolate the culprit):
      { product_id: "<id>", feature_selection: ["Core", "Auth"] }`,
      inputSchema: z.object({
        product_id: z.string().min(1).describe(
          'MongoDB _id of the product to use as the base scaffold for derivation',
        ),
        feature_selection: z.array(z.string()).describe(
          'Feature identifiers to activate in the derived configuration',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ product_id, feature_selection }) => {
      try {
        const result = (await splalm.post('${AGENTS}/test-configuration', {
          productId: product_id,
          featureSelection: feature_selection,
        })) as TestConfigResult;

        const icon = result.noTestCommand ? '⚠️' : result.passed ? '✅' : '❌';
        const status = result.noTestCommand
          ? 'No test command configured'
          : result.passed ? 'PASSED' : `FAILED (exit ${result.exitCode})`;

        const text = [
          `# Test Configuration ${icon}`,
          '',
          `**Status**: ${status}`,
          `**Features**: ${feature_selection.join(', ')}`,
          '',
          result.log ? ['## Test Log', '```', result.log.slice(-3000), '```'].join('\n') : '',
        ].join('\n').trimEnd();

        return {
          content: [{ type: 'text', text }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── splalm_publish_wiki ───────────────────────────────────────────────────
  server.registerTool(
    'splalm_publish_wiki',
    {
      title: 'Publish Wiki Page',
      description: `Create or update a GitLab wiki page on this SPL's line repository.
Idempotent — if the page already exists it is updated in-place; otherwise it is
created. Re-running always produces the latest version.

Used by the Handbook Curator (Agent D) to publish the continuously-maintained
\`SPL-Handbook\` wiki page after assembling all grounded sections.

⚠️  Requires developer access (level 30) on the line repository.

Args:
  - slug (string): URL slug of the wiki page (e.g. "SPL-Handbook")
  - title (string): Page title displayed in the wiki (e.g. "SPL Handbook")
  - content (string): Full Markdown content of the page

Returns the GitLab wiki page object (slug, title, web_url).

Examples:
  - Publish the handbook: { slug: "SPL-Handbook", title: "SPL Handbook", content: "..." }
  - Update coverage section: { slug: "SPL-Handbook", title: "SPL Handbook", content: "..." }`,
      inputSchema: z.object({
        slug: z.string().min(1).describe('URL slug for the wiki page (e.g. "SPL-Handbook")'),
        title: z.string().min(1).describe('Human-readable page title'),
        content: z.string().min(1).describe('Full Markdown content of the page'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ slug, title, content }) => {
      try {
        const page = (await splalm.put('${AGENTS}/wiki', {
          lineId,
          slug,
          title,
          content,
        })) as WikiPageResult;
        return {
          content: [{
            type: 'text',
            text: [
              `✓ Wiki page published: **${page.title ?? title}**`,
              page.web_url ? `\nURL: ${page.web_url}` : '',
            ].join(''),
          }],
          structuredContent: toStructured(page),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── splalm_add_memory ─────────────────────────────────────────────────────
  server.registerTool(
    'splalm_add_memory',
    {
      title: 'Add Agent Memory',
      description: `Persist a structured fact or observation as a durable agent memory
for this SPL. Memories are injected into future agent system prompts, so facts
written here accumulate over time.

Used by external agents (Variant Test Pilot, Handbook Curator) to persist
run findings — e.g. "interaction fault found between Auth and PdfExport".

Args:
  - kind ("fact" | "lesson"): Memory type
      "fact"   — a specific, bounded observation from a run
      "lesson" — a higher-level insight that should influence future agents
  - content (string): The memory text (concise, factual)
  - product_id (string, optional): Scope to a specific product. Omit for line-level.

Returns the created memory entry.

Examples:
  - Record an interaction fault:
      { kind: "fact", content: "Interaction fault: features Auth+PdfExport fail together on productX" }
  - Record coverage milestone:
      { kind: "fact", content: "2-wise coverage reached 85% after CIT run on 2026-06-08" }`,
      inputSchema: z.object({
        kind: z.enum(['fact', 'lesson']).describe('Type of memory entry'),
        content: z.string().min(1).describe('Memory text to persist'),
        product_id: z.string().optional().describe(
          'MongoDB _id of a product to scope this memory. Omit for line-level.',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ kind, content, product_id }) => {
      try {
        const body: Record<string, unknown> = { lineId, kind, content };
        if (product_id) body['productId'] = product_id;
        const memory = (await splalm.post('${AGENTS}/memory', body)) as AgentMemory;
        return {
          content: [{
            type: 'text',
            text: `✓ Memory saved — id: \`${memory._id}\`\n[${kind}] ${content.slice(0, 120)}`,
          }],
          structuredContent: toStructured(memory),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );
}
