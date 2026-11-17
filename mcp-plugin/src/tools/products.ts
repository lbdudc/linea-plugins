import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { splalm, handleApiError, toStructured } from '../client.js';
import { CHARACTER_LIMIT, ResponseFormat } from '../constants.js';
import type {
  SplalmLine,
  SplalmProductSummary,
  SplalmProductDetail,
  SplalmLog,
  ProductHealth,
  ProductConflicts,
} from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatProductDetail(p: SplalmProductDetail, format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) return JSON.stringify(p, null, 2);
  return [
    `# Product: ${p.spec.basicData.name} (v${p.spec.basicData.version})`,
    '',
    `**ID**: ${p._id}`,
    `**SPL**: ${p.line?.name ?? p.lineId}`,
    `**GitLab**: ${p.repo.webUrl}`,
    '',
    '## Spec',
    `- Languages: ${p.spec.basicData.languages?.join(', ') ?? '—'}`,
    `- SRID: ${p.spec.basicData['SRID'] ?? '—'}`,
    `- Features selected: ${(p.spec.features ?? []).join(', ') || '(none)'}`,
    '',
    '## Members',
    ...(p.members ?? []).map(m => `- ${m.username} (role ${m.role})`),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerProductsTools(server: McpServer, lineId: string): void {
  // ── list_products ─────────────────────────────────────────────────────────
  server.registerTool(
    'splalm_list_products',
    {
      title: 'List Products',
      description: `List all products belonging to this SPL with optional name search
and pagination.

Args:
  - search (string, optional): Name substring filter (case-sensitive)
  - limit (number, optional): Max results per page, 1–100 (default: 20)
  - offset (number, optional): Number of results to skip (default: 0)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  {
    "total": number,       // Total matching products
    "count": number,       // Products in this page
    "offset": number,      // Current offset
    "has_more": boolean,   // Whether more pages exist
    "next_offset": number, // Offset for next page (when has_more=true)
    "products": [
      {
        "_id": string,     // MongoDB _id — use in other tools
        "name": string,
        "version": string,
        "createdAt": string,
        "gitlab": { "webUrl": string }
      }
    ]
  }

Examples:
  - "List all products" → no args
  - "Find products named 'web'" → { search: "web" }
  - "Get the second page of products" → { offset: 20 }`,
      inputSchema: z.object({
        search: z.string().optional().describe('Optional name substring filter'),
        limit: z.number().int().min(1).max(100).default(20).describe(
          'Max results per page (default: 20)',
        ),
        offset: z.number().int().min(0).default(0).describe(
          'Number of results to skip (default: 0)',
        ),
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
    async ({ search, limit, offset, response_format }) => {
      try {
        const [lineData, all] = await Promise.all([
          splalm.get(`/api/lines/${lineId}`) as Promise<SplalmLine>,
          splalm.get('/api/products/enrolled') as Promise<SplalmProductSummary[]>,
        ]);

        // The enrolled endpoint returns p.line as the line name string
        let products = all.filter(p => p.line === lineData.name);
        if (search) products = products.filter(p => p.name.includes(search));

        const total = products.length;
        const page = products.slice(offset, offset + limit);
        const hasMore = total > offset + page.length;

        const structured = {
          total,
          count: page.length,
          offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: offset + page.length } : {}),
          products: page,
        };

        let text: string;
        if (response_format === ResponseFormat.MARKDOWN) {
          const lines = [
            `# Products (${page.length} of ${total})`,
            '',
            ...(search ? [`*Filtered by name containing "${search}"*`, ''] : []),
            ...page.map(p => [
              `## ${p.name} (v${p.version})`,
              `- **ID**: \`${p._id}\``,
              `- **GitLab**: ${p.repo.webUrl}`,
              `- **Created**: ${p.createdAt}`,
              '',
            ].join('\n')),
            ...(hasMore ? [`*${total - offset - page.length} more — use offset: ${offset + page.length}*`] : []),
          ];
          text = lines.join('\n');
        } else {
          text = JSON.stringify(structured, null, 2);
        }

        if (text.length > CHARACTER_LIMIT) {
          const truncated = { ...structured, truncated: true, truncation_message: `Response truncated. Use offset/search to narrow results.` };
          text = JSON.stringify(truncated, null, 2);
        }

        return {
          content: [{ type: 'text', text }],
          structuredContent: toStructured(structured),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── get_product_info ──────────────────────────────────────────────────────
  server.registerTool(
    'splalm_get_product_info',
    {
      title: 'Get Product Info',
      description: `Get full information about a product: spec, GitLab URLs, members,
and the resolved feature model string.

Args:
  - product_id (string): The MongoDB _id of the product
      (obtain from splalm_list_products)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns the full product object including:
  - spec.basicData (name, version, languages, SRID, database, extra)
  - spec.dataModel (data model cells)
  - spec.features (selected feature names)
  - spec.statics (static content)
  - gitlab (projectId, namespaceId, webUrl, webIdeUrl)
  - members (username + role)
  - featureModel (serialized FeatureModel object)
  - line (id + name of parent SPL)

Examples:
  - "What features does product X have selected?" → use get_product_spec instead
  - "Show me all info about product X" → this tool`,
      inputSchema: z.object({
        product_id: z.string().min(1).describe(
          'MongoDB _id of the product (from splalm_list_products)',
        ),
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
    async ({ product_id, response_format }) => {
      try {
        const product = await splalm.get(`/api/products/${product_id}`) as SplalmProductDetail;
        const text = formatProductDetail(product, response_format);
        return {
          content: [{ type: 'text', text }],
          structuredContent: toStructured(product),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── get_product_spec ──────────────────────────────────────────────────────
  server.registerTool(
    'splalm_get_product_spec',
    {
      title: 'Get Product Spec',
      description: `Return just the spec (basicData, dataModel, features, statics) of a product.
A lighter alternative to splalm_get_product_info when you only need the spec.

Args:
  - product_id (string): MongoDB _id of the product

Returns: { "spec": { basicData, dataModel, features, statics } }

Examples:
  - "What features are selected for product X?" → check spec.features
  - "What is the current version of product X's spec?" → check spec.basicData.version
  - "Before updating, show me the current spec" → use this tool`,
      inputSchema: z.object({
        product_id: z.string().min(1).describe('MongoDB _id of the product'),
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
        const product = await splalm.get(`/api/products/${product_id}`) as SplalmProductDetail;
        const result = { spec: product.spec };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── list_product_members ──────────────────────────────────────────────────
  server.registerTool(
    'splalm_list_product_members',
    {
      title: 'List Product Members',
      description: `Return the GitLab project members of a product's repository.

Args:
  - product_id (string): MongoDB _id of the product

Returns: { "members": [{ "username": string, "role": number }] }

GitLab access levels:
  20 = Reporter (read), 30 = Developer, 40 = Maintainer, 50 = Owner

Examples:
  - "Who can modify product X?" → members with role >= 40`,
      inputSchema: z.object({
        product_id: z.string().min(1).describe('MongoDB _id of the product'),
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
        const product = await splalm.get(`/api/products/${product_id}`) as SplalmProductDetail;
        const members = product.members ?? [];
        return {
          content: [{
            type: 'text',
            text: [
              `# Members of product ${product.spec.basicData.name} (${members.length})`,
              '',
              ...members.map(m => `- **${m.username}** — role ${m.role}`),
            ].join('\n'),
          }],
          structuredContent: toStructured({ members }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── list_product_versions ─────────────────────────────────────────────────
  server.registerTool(
    'splalm_list_product_versions',
    {
      title: 'List Product Versions',
      description: `List the versions for which a product has synchronization logs
(i.e., versions that have been generated via splalm_synchronize_product).

Args:
  - product_id (string): MongoDB _id of the product

Returns: { "versions": ["1.2.0", "1.1.0", "1.0.0"] } (newest first)

Use splalm_get_product_logs to retrieve the detailed log for a specific version.

Examples:
  - "What versions has product X been synchronized to?" → this tool
  - "Has product X ever been generated?" → check if versions is non-empty`,
      inputSchema: z.object({
        product_id: z.string().min(1).describe('MongoDB _id of the product'),
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
        const versions = await splalm.get(`/api/logs/${product_id}/versions`) as string[];
        return {
          content: [{ type: 'text', text: JSON.stringify({ versions }, null, 2) }],
          structuredContent: toStructured({ versions }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── get_product_logs ──────────────────────────────────────────────────────
  server.registerTool(
    'splalm_get_product_logs',
    {
      title: 'Get Product Logs',
      description: `Retrieve the step-by-step log entries written by SPLALM during a
specific generation run (identified by product + version).

Args:
  - product_id (string): MongoDB _id of the product
  - version (string): The x.y.z version string
      (obtain from splalm_list_product_versions)

Each log entry has:
  - type: "info" | "warning" | "success" | "error"
  - message: i18n key (e.g. "log.created_branch", "log.merge_request_created")
  - params: interpolation values for the message key
  - link: optional URL (e.g. GitLab MR URL)
  - createdAt: ISO timestamp

Returns: { "logs": [...] }

Examples:
  - "Why did synchronization fail for product X v1.2.0?" → check type="error" entries
  - "What MR was created during generation?" → check entries with a link`,
      inputSchema: z.object({
        product_id: z.string().min(1).describe('MongoDB _id of the product'),
        version: z.string().regex(/^\d+\.\d+\.\d+$/).describe(
          'Version string in x.y.z format (from splalm_list_product_versions)',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ product_id, version }) => {
      try {
        const logs = await splalm.get(`/api/logs/${product_id}/${version}`) as SplalmLog[];
        const text = logs.map(l => {
          const icon = l.type === 'error' ? '❌' : l.type === 'warning' ? '⚠️' : l.type === 'success' ? '✅' : 'ℹ️';
          const msg = `${icon} [${l.type.toUpperCase()}] ${l.message}` +
            (l.params?.length ? ` (${l.params.join(', ')})` : '') +
            (l.link ? `\n   → ${l.link}` : '');
          return msg;
        }).join('\n');
        return {
          content: [{ type: 'text', text: text || 'No log entries found.' }],
          structuredContent: toStructured({ logs }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── get_product_health ────────────────────────────────────────────────────
  server.registerTool(
    'splalm_get_product_health',
    {
      title: 'Get Product Health',
      description: `Check whether a product's feature selection is valid against the
current SPL feature model (as it exists in GitLab main branch).

Args:
  - product_id (string): MongoDB _id of the product

Returns:
  {
    "valid": boolean,       // true = selection is compatible with the model
    "error": string | null, // human-readable validation error when valid=false
    "errorType": string | null, // machine-readable error category when valid=false
    "features": string[]    // list of features currently selected
  }

Common errorTypes:
  - "MISSING_FEATURE": a selected feature no longer exists in the model
  - "INVALID_SELECTION": the selection violates a model constraint

Use this to detect products that have drifted from the feature model after
the SPL was updated. Run splalm_synchronize_product to attempt a fix.

Examples:
  - "Is product X still valid?" → this tool
  - "Which features does product X have selected?" → check the features array`,
      inputSchema: z.object({
        product_id: z.string().min(1).describe('MongoDB _id of the product'),
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
        const health = await splalm.get(`/api/products/${product_id}/health`) as ProductHealth;
        const statusLine = health.valid
          ? '✅ Feature selection is valid.'
          : `❌ Feature selection is invalid: ${health.error ?? '(no detail)'}${health.errorType ? ` [${health.errorType}]` : ''}`;
        return {
          content: [{ type: 'text', text: `${statusLine}\n\n${JSON.stringify(health, null, 2)}` }],
          structuredContent: toStructured(health),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── get_product_conflicts ─────────────────────────────────────────────────
  server.registerTool(
    'splalm_get_product_conflicts',
    {
      title: 'Get Product Conflicts',
      description: `Check whether a product has open GitLab Merge Requests with
unresolved merge conflicts on the bigbang → main integration branch.

Args:
  - product_id (string): MongoDB _id of the product

Returns:
  {
    "openMRs": number,       // total open MRs targeting main
    "conflictingMRs": number // MRs blocked by merge conflicts
  }

A conflictingMRs > 0 means the last synchronization produced conflicts that
must be resolved manually in GitLab before the product can be merged to main.

Workflow when conflictingMRs > 0:
  1. Call splalm_get_product_info to get the gitlab.webUrl
  2. Direct the engineer to resolve the conflict in the GitLab MR
  3. Re-run splalm_synchronize_product after the conflict is resolved

Examples:
  - "Does product X have any merge conflicts?" → this tool
  - "Why is product X stuck?" → check conflictingMRs`,
      inputSchema: z.object({
        product_id: z.string().min(1).describe('MongoDB _id of the product'),
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
        const conflicts = await splalm.get(`/api/products/${product_id}/conflicts`) as ProductConflicts;
        const statusLine = conflicts.conflictingMRs > 0
          ? `⚠️ ${conflicts.conflictingMRs} MR(s) with unresolved conflicts (${conflicts.openMRs} open total).`
          : conflicts.openMRs > 0
            ? `✅ ${conflicts.openMRs} open MR(s), none have conflicts.`
            : '✅ No open MRs.';
        return {
          content: [{ type: 'text', text: `${statusLine}\n\n${JSON.stringify(conflicts, null, 2)}` }],
          structuredContent: toStructured(conflicts),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );
}
