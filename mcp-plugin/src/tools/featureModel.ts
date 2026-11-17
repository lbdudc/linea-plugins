import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { splalm, handleApiError, toStructured } from '../client.js';

interface GitLabFile {
  content: string;
  encoding: string;
}

function decodeModelResponse(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  const file = raw as GitLabFile;
  if (file?.encoding === 'base64' && typeof file.content === 'string') {
    return Buffer.from(file.content, 'base64').toString('utf-8');
  }
  return JSON.stringify(raw);
}

export function registerFeatureModelTools(
  server: McpServer,
  lineId: string,
  readOnly: boolean,
): void {
  // ── get_feature_model ─────────────────────────────────────────────────────
  server.registerTool(
    'splalm_get_feature_model',
    {
      title: 'Get Feature Model',
      description: `Fetch the UVL (Universal Variability Language) feature model file
from the SPL's GitLab repository (src/platform/model.uvl on main branch).

Args:
  - format ('uvl' | 'raw', optional): Output format (default: 'uvl').
      'uvl' returns the decoded plain-text UVL content.
      'raw' returns the raw GitLab file object with base64-encoded content.

Returns: { "format": "uvl", "content": "<uvl file text>" }

The UVL content can be passed directly to splalm_analyze_feature_model
or splalm_update_feature_model.

Examples:
  - "Show me the feature model" → use this tool
  - "What features are available in this SPL?" → use this tool then read the features section`,
      inputSchema: z.object({
        format: z.enum(['uvl', 'raw']).default('uvl').describe(
          "'uvl' (default) returns the decoded UVL text. 'raw' returns the GitLab file object as-is (base64 encoded).",
        ),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ format = 'uvl' }) => {
      try {
        const raw = await splalm.get(`/api/lines/${lineId}/model`);
        const result = format === 'raw'
          ? { format: 'raw', content: raw }
          : { format: 'uvl', content: decodeModelResponse(raw) };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── analyze_feature_model ─────────────────────────────────────────────────
  server.registerTool(
    'splalm_analyze_feature_model',
    {
      title: 'Analyze Feature Model',
      description: `Run Flamapy analyses over a UVL feature model string.
Defaults to the current SPL model when no uvl is supplied.

Args:
  - uvl (string, optional): UVL content to analyze. Omit to analyze the current SPL model.
  - mode ('BDD' | 'SAT', optional): Solver backend (default: 'BDD').
      BDD supports all metrics. SAT is faster for very large models.

Returns a JSON object with all available metrics:
  - satisfiable (boolean): Whether the model has at least one valid configuration
  - coreFeatures (string[]): Features present in every configuration
  - deadFeatures (string[]): Features that appear in no configuration
  - falseOptionalFeatures (string[]): Optional features that are always included
  - leafFeatures (string[]): Terminal features with no children
  - leafNumber (number): Count of leaf features
  - atomicSets (string[][]): Groups of features that always co-occur
  - configurations (string[][]): All valid configurations (can be very large)
  - configsNumber (number): Exact count of valid configurations
  - estimatedConfigurations (number): Fast approximation of configuration count
  - averageBranchingFactor (number): Mean branching in the feature tree
  - maxDepth (number): Maximum depth of the feature tree
  - uniqueFeatures (string[]): Features with unique inclusion probabilities
  - configDistribution (object[]): Distribution of configurations by depth
  - featureInclusionProb (object): Per-feature probability of inclusion
  - homogeneity (number 0–1): How similar configurations are to each other
  - variability (number 0–1): Ratio of reachable to total feature combinations
  - variantFeatures (string[]): Features that are neither core nor dead

Examples:
  - "Is this feature model satisfiable?" → { satisfiable: true }
  - "What features are mandatory?" → check coreFeatures
  - "Are there any dead features?" → check deadFeatures
  - "How many products can this SPL generate?" → check configsNumber`,
      inputSchema: z.object({
        uvl: z.string().optional().describe(
          'UVL content to analyze. Omit to use the current SPL model.',
        ),
        mode: z.enum(['BDD', 'SAT']).optional().describe(
          "Solver backend: 'BDD' (default, all metrics) or 'SAT' (faster for large models).",
        ),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ uvl, mode = 'BDD' }) => {
      try {
        let content = uvl;
        if (!content) {
          const raw = await splalm.get(`/api/lines/${lineId}/model`);
          content = decodeModelResponse(raw);
        }
        const result = await splalm.post('/api/lines/analyze', { uvl: content, mode });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── analyze_feature_model_metric ─────────────────────────────────────────
  server.registerTool(
    'splalm_analyze_feature_model_metric',
    {
      title: 'Analyze Feature Model (single metric)',
      description: `Run a single Flamapy metric over a UVL feature model — much faster than
the full splalm_analyze_feature_model when you only need one result.

Useful for quick checks on large models where running all 18 metrics is slow.
Defaults to the current SPL model when no uvl is supplied.

Args:
  - metric ('satisfiable' | 'deadFeatures'): Which metric to compute
  - mode ('BDD' | 'SAT'): Solver backend (required)
  - uvl (string, optional): UVL content to analyze. Omit to use the current SPL model.

Returns: { "<metric>": <value> }
  - satisfiable → boolean
  - deadFeatures → string[]

Examples:
  - "Is this model satisfiable?" → { metric: "satisfiable", mode: "SAT" }
  - "Any dead features?" → { metric: "deadFeatures", mode: "BDD" }`,
      inputSchema: z.object({
        metric: z.enum(['satisfiable', 'deadFeatures']).describe(
          'The metric to compute: "satisfiable" (boolean) or "deadFeatures" (string[])',
        ),
        mode: z.enum(['BDD', 'SAT']).describe(
          "Solver backend: 'BDD' or 'SAT'",
        ),
        uvl: z.string().optional().describe(
          'UVL content to analyze. Omit to use the current SPL model.',
        ),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ metric, mode, uvl }) => {
      try {
        let content = uvl;
        if (!content) {
          const raw = await splalm.get(`/api/lines/${lineId}/model`);
          content = decodeModelResponse(raw);
        }
        const result = await splalm.post('/api/lines/analyze/metric', { uvl: content, metric, mode });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── update_feature_model (write) ──────────────────────────────────────────
  if (!readOnly) {
    server.registerTool(
      'splalm_update_feature_model',
      {
        title: 'Update Feature Model',
        description: `Replace the SPL's UVL feature model file in GitLab.

SPLALM auto-bumps the SPL's **major version** when the content changes
(e.g. 1.3.2 → 2.0.0). After updating the feature model you should call
splalm_analyze_feature_model to confirm the new model is satisfiable,
then splalm_synchronize_product for any products whose feature selections
may have become invalid.

Args:
  - content (string): The full new UVL file content (must be non-empty)

Returns: { "ok": true } on success.

Error Handling:
  - Returns validation error if content is empty
  - Returns HTTP 403 if your token lacks Maintainer (40) access on the SPL
  - Returns HTTP 422 if SPLALM rejects the UVL content

Examples:
  - "Add a new optional feature Foo" → edit the uvl, call this tool, then analyze`,
        inputSchema: z.object({
          content: z.string().min(1, 'UVL content must not be empty').describe(
            'The full new UVL file content',
          ),
        }).strict(),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ content }) => {
        try {
          await splalm.put(`/api/lines/${lineId}/model`, { content });
          return {
            content: [{ type: 'text', text: '✓ Feature model updated.' }],
            structuredContent: toStructured({ ok: true }),
          };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
        }
      },
    );
  }
}
