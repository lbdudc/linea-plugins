import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { splalm, handleApiError, toStructured } from '../client.js';
import type { SplalmProductDetail, GenerateResult } from '../types.js';

// ---------------------------------------------------------------------------
// Shared spec schema (mirrors SPLALM's productValidators.js)
// ---------------------------------------------------------------------------

const BasicDataSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_\-.]+$/, 'Only alphanumeric, _, -, . characters allowed')
    .describe('Product name (alphanumeric, _, -, . only)'),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Must follow x.y.z semver format')
    .describe('Semantic version (x.y.z)'),
  languages: z.array(z.string()).optional().describe('Locale codes, e.g. ["en","es","gl"]'),
  SRID: z.string().optional().describe('Spatial Reference ID, e.g. "4326"'),
  database: z.record(z.unknown()).optional().describe('Free-form database config'),
  extra: z.record(z.unknown()).optional().describe('Free-form extra config'),
  createdAt: z.string().optional(),
  testEnvironment: z.object({
    image: z.string(),
    command: z.string(),
  }).optional().describe('Docker image and command for running tests (e.g. mvn test)'),
}).strict();

const SpecSchema = z.object({
  basicData: BasicDataSchema,
  dataModel: z.record(z.unknown()).optional().describe(
    'Data model definition (e.g. { "cells": [...] })',
  ),
  features: z.array(z.string()).optional().describe(
    'Feature names selected from the SPL feature model',
  ),
  statics: z.array(z.unknown()).optional().describe('Static content definitions'),
}).strict();

type SpecInput = z.infer<typeof SpecSchema>;

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerProductsWriteTools(server: McpServer, lineId: string): void {
  // ── create_product ────────────────────────────────────────────────────────
  server.registerTool(
    'splalm_create_product',
    {
      title: 'Create Product',
      description: `Create a new product under this SPL. SPLALM provisions a nested
GitLab group and project, and creates the bigbang integration branch.

Args:
  - spec (object): Product specification:
      - basicData.name: product name (alphanumeric/_ /- /. only)
      - basicData.version: initial version (e.g. "0.0.0")
      - basicData.languages: locale codes (default ["en"])
      - basicData.SRID: spatial reference ID (default "4326")
      - spec.features: list of feature names from the SPL feature model
      - spec.dataModel: optional data model definition

Returns the created product object (same shape as splalm_get_product_info).

Error Handling:
  - "PRODUCT_EXISTS": A product with that name already exists
  - "FEATURE_SELECTION_INVALID": One or more feature names are not in the feature model
  - HTTP 403: Insufficient access level (Reporter=20 minimum on the SPL)

Examples:
  - Create "MyApp" with features Foo and Bar:
    spec: { basicData: { name: "MyApp", version: "0.0.0" }, features: ["Foo","Bar"] }`,
      inputSchema: z.object({ spec: SpecSchema }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ spec }: { spec: SpecInput }) => {
      try {
        const product = await splalm.post('/api/products', { lineId, spec }) as SplalmProductDetail;
        return {
          content: [{ type: 'text', text: `✓ Product "${spec.basicData.name}" created.\n\n${JSON.stringify(product, null, 2)}` }],
          structuredContent: toStructured(product),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── update_product_spec ───────────────────────────────────────────────────
  server.registerTool(
    'splalm_update_product_spec',
    {
      title: 'Update Product Spec',
      description: `Replace a product's spec. SPLALM auto-bumps the patch version
(e.g. 1.2.3 → 1.2.4) after each update.

To actually regenerate the product code from the new spec, call
splalm_synchronize_product after this tool.

Args:
  - product_id (string): MongoDB _id of the product
  - spec (object): New product spec (same shape as in splalm_create_product)

Returns the updated product object.

Error Handling:
  - "FEATURE_SELECTION_INVALID": A feature in spec.features is not in the feature model
  - HTTP 403: Insufficient access level (Maintainer=40 required)
  - HTTP 422: spec.basicData.name or version failed validation

Examples:
  - Add a feature to product X:
    1. splalm_get_product_spec to get current spec
    2. Add the feature to spec.features
    3. Call this tool with the modified spec`,
      inputSchema: z.object({
        product_id: z.string().min(1).describe('MongoDB _id of the product'),
        spec: SpecSchema,
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ product_id, spec }: { product_id: string; spec: SpecInput }) => {
      try {
        const product = await splalm.patch(`/api/products/${product_id}`, { spec }) as SplalmProductDetail;
        return {
          content: [{ type: 'text', text: `✓ Spec updated to v${product.spec.basicData.version}.\n\n${JSON.stringify(product, null, 2)}` }],
          structuredContent: toStructured(product),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── rename_product ────────────────────────────────────────────────────────
  server.registerTool(
    'splalm_rename_product',
    {
      title: 'Rename Product',
      description: `Rename the product and its GitLab group/project.

Args:
  - product_id (string): MongoDB _id of the product
  - name (string): New product name (alphanumeric, _, -, . only)

Returns the updated product object.

Error Handling:
  - HTTP 403: Insufficient access level (Maintainer=40 required)
  - HTTP 409: A product with that name already exists`,
      inputSchema: z.object({
        product_id: z.string().min(1).describe('MongoDB _id of the product'),
        name: z
          .string()
          .min(1)
          .regex(/^[a-zA-Z0-9_\-.]+$/, 'Only alphanumeric, _, -, . characters allowed')
          .describe('New product name'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ product_id, name }) => {
      try {
        const product = await splalm.post(`/api/products/${product_id}/rename`, { name }) as SplalmProductDetail;
        return {
          content: [{ type: 'text', text: `✓ Product renamed to "${name}".` }],
          structuredContent: toStructured(product),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── delete_product ────────────────────────────────────────────────────────
  server.registerTool(
    'splalm_delete_product',
    {
      title: 'Delete Product',
      description: `Permanently delete a product and its GitLab group. This action is
irreversible — all GitLab data (branches, MRs, issues) will be deleted.

The confirm parameter MUST be set to true to prevent accidental deletion.

Args:
  - product_id (string): MongoDB _id of the product
  - confirm (true): Must be exactly true — acts as a safety gate

Returns: { "ok": true } on success.

Error Handling:
  - HTTP 403: Insufficient access level (Owner=50 required)
  - If confirm is not true, the call is rejected before any action is taken

Examples:
  - Always call splalm_get_product_info first to confirm the correct product`,
      inputSchema: z.object({
        product_id: z.string().min(1).describe('MongoDB _id of the product'),
        confirm: z.literal(true).describe('Must be exactly true to authorize deletion'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ product_id }) => {
      try {
        await splalm.delete(`/api/products/${product_id}`);
        return {
          content: [{ type: 'text', text: '✓ Product and its GitLab group deleted.' }],
          structuredContent: toStructured({ ok: true }),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

  // ── synchronize_product ───────────────────────────────────────────────────
  server.registerTool(
    'splalm_synchronize_product',
    {
      title: 'Synchronize Product',
      description: `Regenerate the product codebase against the current SPL and open
GitLab Merge Requests to synchronize the product repository.

Full pipeline:
  1. Download SPL platform zip + product's bigbang zip
  2. Run spl-js-engine derivation engine with the product spec
  3. Run Prettier formatting
  4. Diff against previous bigbang snapshot
  5. Create branch generation/<version> off bigbang, commit the diff
  6. Open MR: generation/<version> → bigbang (auto-merge if no conflicts)
  7. Tag bigbang-<version>
  8. Open MR: bigbang → main (auto-merge if no conflicts)

⚠️ This is a long-running operation (up to several minutes). Use a generous client timeout.

Args:
  - product_id (string): MongoDB _id of the product

Returns:
  The updated product object, which may also include:
  - "conflicts": true/false — whether any MR has unresolved conflicts
  - "stage": "generating" | "update" — which MR has conflicts (when conflicts=true)
  - "mergeRequestUrl": URL of the blocking MR (when conflicts=true)

When conflicts=true: resolve the conflict in GitLab at mergeRequestUrl,
then call splalm_synchronize_product again to continue.

Use splalm_get_product_logs(product_id, version) to retrieve step-by-step logs.

Error Handling:
  - "FEATURE_SELECTION_INVALID": The product's spec.features contains invalid feature names
  - "LINE_PLATFORM_NOT_FOUND": The SPL has no platform code in GitLab
  - HTTP 403: Insufficient access level (Maintainer=40 on product, Reporter=20 on SPL)`,
      inputSchema: z.object({
        product_id: z.string().min(1).describe('MongoDB _id of the product'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ product_id }) => {
      try {
        const result = await splalm.post(`/api/products/${product_id}/generate`) as GenerateResult;
        const conflicts = result['conflicts'] as boolean | undefined;
        const summary = conflicts
          ? `⚠️ Synchronization completed with conflicts at stage "${result['stage']}".\nResolve the MR at: ${result['mergeRequestUrl']}`
          : `✅ Product synchronized successfully.`;
        return {
          content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }],
          structuredContent: toStructured(result),
        };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: handleApiError(error) }] };
      }
    },
  );

}
