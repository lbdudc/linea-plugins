import { registerAgent } from '../core/AgentRegistry.js';
import { complete } from '../core/llm.js';
import { loadFeatureModel, scanProducts } from '../tools/splContext.js';
import { extractFeaturesFromModel } from '../tools/fmAnalysis.js';
import { lineAccess } from '../tools/git.js';
import { listPlatformFiles, readRepoFile } from '../tools/harvest.js';
import {
  tryCompleteFeatureSelection,
  computeCorrelations,
  insertFeatureAnnotation,
} from '../tools/featureLocation.js';
import { createBranch as createBranchRest, commit as commitFiles, createMergeRequest as openMergeRequest, isBranchAlreadyExistsError } from '../../linea/repo.js';

/**
 * Feature Location Agent — given a feature name, finds which platform functions
 * implement it, using a novel two-signal approach:
 *
 *   1. DIFFERENTIAL (deterministic): run completeFeatureSelection with/without the
 *      feature to surface FM-required dependencies; compare across the real product
 *      portfolio for co-selection correlations.
 *
 *   2. SEMANTIC (LLM tool loop): Claude reads extra.js / transformation.js and any
 *      other platform files via list/read tools, searching for functions whose names,
 *      comments, or conditionals reference the feature.
 *
 * Both signals are merged into a ranked feature map. If `input.annotate === true`,
 * the agent also proposes adding `/** @feature <name> *\/` JSDoc above each identified
 * function, committed as a line-repo MR so future runs can read the map directly.
 *
 * References:
 *   [Eisenbarth03] Eisenbarth et al., "Locating Features in Source Code", IEEE TSE 2003.
 *   [Marcus04]     Marcus & Rajlich, "IR Methods for Feature Identification", ICPC 2004.
 *   [Dit13]        Dit et al., "Feature Location in Source Code: A Taxonomy", JSEP 2013.
 *   [Linsbauer13]  Linsbauer et al., "Recovering Feature-to-Code Mappings", ICSM 2013.
 */

const LOCATE_SYSTEM = `You are an expert on a Software Product Line platform, performing FEATURE LOCATION.
Given a feature name from the feature model, find which functions in the platform source implement it.

You have two evidence signals:
- DIFFERENTIAL: the FM automatically selects these features when the target is chosen (requires/constraints).
- PORTFOLIO: these features co-appear most often with the target across real products.

Steps:
1. list_platform_files — see available files.
2. read_platform_file for relevant files (start with extra.js and transformation.js; include any Handlebars or EJS templates).
3. Look for: function names matching the feature; conditionals referencing feature flags; template blocks gated on the feature.
4. Always call report_feature_location at the end with your ranked findings (empty matches is valid).

Be specific — report only concrete symbols (function names, variable names, template block identifiers).
Mark confidence HIGH only when the name/comment is an obvious match; MEDIUM for plausible structural matches.`;

const RECONCILE_SYSTEM = `You are an SPL feature location analyst.
Given differential FM analysis and semantic scan results, write a concise markdown feature map.

Structure (use exactly these headers):
## Feature: <name>
## Implementation Footprint
For each matched file: list symbol, signal type (semantic/differential/both), confidence.
## FM Impact
What the differential analysis and portfolio correlations imply about runtime code paths.
## Recommendation
What to review first when changing this feature; which products to re-test.

Be specific — name exact function identifiers. If nothing was found, say so and suggest where to look manually.`;

const LIST_TOOL = {
  name: 'list_platform_files',
  description: 'List platform source files (blobs under src/platform) in the line repo.',
  input_schema: { type: 'object', properties: {} },
};

const READ_TOOL = {
  name: 'read_platform_file',
  description: 'Read the content of a file under src/ in the line repo.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repo path, e.g. src/platform/extra.js' },
    },
    required: ['path'],
  },
};

const REPORT_TOOL = {
  name: 'report_feature_location',
  description: 'Report findings once you have finished scanning. Always call this.',
  input_schema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        description: 'Ranked list of code locations implementing the feature.',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            symbol: { type: 'string', description: 'Exact function or variable name' },
            confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
            signalType: { type: 'string', enum: ['semantic', 'differential', 'both'] },
            rationale: { type: 'string' },
          },
          required: ['file', 'symbol', 'confidence', 'signalType'],
        },
      },
      summary: { type: 'string', description: 'One-paragraph summary of findings.' },
    },
    required: ['matches'],
  },
};

const definition = {
  type: 'feature-location',
  title: 'Feature Location',
  description:
    'Finds which platform functions implement a named FM feature, using FM differential analysis and semantic platform scanning. Optionally proposes @feature JSDoc annotations as a line-repo MR.',
  scope: 'line',

  steps: [
    {
      name: 'load-context',
      kind: 'deterministic',
      run: async (ctx) => {
        const featureName = ctx.input?.featureName;
        if (!featureName) throw new Error('feature-location requires input.featureName');
        if (!ctx.lineId) throw new Error('feature-location requires scope.lineId');

        const { line, modelStr, type } = await loadFeatureModel({
          lineId: ctx.lineId,
          userId: ctx.userId,
        });
        const scan = await scanProducts({ lineId: ctx.lineId, userId: ctx.userId });
        const allFmFeatures = extractFeaturesFromModel({ modelStr, type });

        const featureFound = allFmFeatures.includes(featureName);
        const validVerdicts = scan.verdicts.filter((v) => v.status === 'valid');
        const productsWithFeature = validVerdicts.filter((v) =>
          v.features.includes(featureName)
        );
        const productsWithoutFeature = validVerdicts.filter(
          (v) => !v.features.includes(featureName)
        );

        return {
          output: {
            line: { id: String(line._id), name: line.name },
            allFmFeatures,
            featureName,
            featureFound,
            productsWithFeature: productsWithFeature.map((v) => ({
              name: v.name,
              features: v.features,
            })),
            productsWithoutFeature: productsWithoutFeature.map((v) => ({
              name: v.name,
              features: v.features,
            })),
            totalValidProducts: validVerdicts.length,
            modelStr,
            type,
          },
        };
      },
    },

    {
      name: 'differential-derivation',
      kind: 'deterministic',
      run: async (ctx) => {
        const { featureName, allFmFeatures, productsWithFeature, productsWithoutFeature } =
          ctx.getStepOutput('load-context');

        // Re-load the model object (not serialisable).
        const { model } = await loadFeatureModel({ lineId: ctx.lineId, userId: ctx.userId });

        // Probe FM: what gets resolved when the feature is selected?
        const withResult = tryCompleteFeatureSelection(model, [featureName]);
        // Probe FM: what is always selected (mandatory baseline)?
        const withoutResult = tryCompleteFeatureSelection(model, []);

        // Delta: features that appear because featureName was selected (via FM constraints).
        const withoutSet = new Set(withoutResult.selected);
        const deltaFeatures = withResult.ok
          ? withResult.selected.filter((f) => f !== featureName && !withoutSet.has(f))
          : [];

        // Portfolio correlations across all valid products.
        const allVerdicts = [...productsWithFeature, ...productsWithoutFeature];
        const correlations = computeCorrelations(featureName, allFmFeatures, allVerdicts);

        return {
          output: {
            withValid: withResult.ok,
            withError: withResult.error ?? null,
            withSelection: withResult.selected,
            withoutValid: withoutResult.ok,
            withoutSelection: withoutResult.selected,
            deltaFeatures,
            correlations: correlations.slice(0, 10),
            totalProductsWithFeature: productsWithFeature.length,
            totalProductsWithoutFeature: productsWithoutFeature.length,
          },
        };
      },
    },

    {
      name: 'locate-in-platform',
      kind: 'llm',
      toolLoop: true, // durable multi-turn investigation via ctx.runToolLoop
      run: async (ctx) => {
        const { featureName, line } = ctx.getStepOutput('load-context');
        const diff = ctx.getStepOutput('differential-derivation');

        // Try to get read access to the line repo. Degrade gracefully if unavailable.
        let lineProjectId;
        try {
          ({ lineProjectId } = await lineAccess({
            lineId: ctx.lineId,
            userId: ctx.userId,
          }));
        } catch (err) {
          return {
            output: {
              matches: [],
              summary: `Platform scan skipped — git access unavailable: ${err?.message ?? err}`,
              gitAvailable: false,
            },
          };
        }

        let scanFindings = null;

        const executeTool = async (name, input) => {
          if (name === 'report_feature_location') {
            scanFindings = input;
            return 'Findings recorded.';
          }
          if (name === 'list_platform_files') {
            try {
              return { files: await listPlatformFiles({ lineProjectId }) };
            } catch (e) {
              return `Error listing files: ${e?.message ?? e}`;
            }
          }
          if (name === 'read_platform_file') {
            const path = input?.path ?? '';
            if (!path.startsWith('src/')) return 'Only paths under src/ may be read.';
            try {
              const content = await readRepoFile({ lineProjectId, path });
              return { path, content };
            } catch (e) {
              return `Error reading ${path}: ${e?.message ?? e}`;
            }
          }
          return `Unknown tool: ${name}`;
        };

        const correlationHint =
          diff.correlations.slice(0, 5).length > 0
            ? diff.correlations
                .slice(0, 5)
                .map((c) => `${c.feature} (${Math.round(c.conditionalRate * 100)}%)`)
                .join(', ')
            : '(none)';

        const deltaHint =
          diff.deltaFeatures.length > 0
            ? diff.deltaFeatures.join(', ')
            : '(none — feature adds no FM-required dependencies)';

        await ctx.runToolLoop({
          system: LOCATE_SYSTEM,
          tools: [LIST_TOOL, READ_TOOL, REPORT_TOOL],
          executeTool,
          maxTurns: 8,
          maxTokens: 8192,
          messages: [
            {
              role: 'user',
              content:
                `Feature to locate: **${featureName}**\n` +
                `SPL: ${line.name}\n` +
                `Products selecting this feature: ${diff.totalProductsWithFeature}/${diff.totalProductsWithFeature + diff.totalProductsWithoutFeature}\n\n` +
                `DIFFERENTIAL signal — FM auto-selects when ${featureName} is chosen: ${deltaHint}\n` +
                `PORTFOLIO signal — features most often co-selected with ${featureName}: ${correlationHint}\n\n` +
                `Scan the platform files and call report_feature_location with your findings.`,
            },
          ],
        });

        return {
          output: {
            matches: scanFindings?.matches ?? [],
            summary: scanFindings?.summary ?? 'No structured findings returned.',
            gitAvailable: true,
          },
        };
      },
    },

    {
      name: 'reconcile',
      kind: 'llm',
      run: async (ctx) => {
        const { featureName, line, totalValidProducts } = ctx.getStepOutput('load-context');
        const diff = ctx.getStepOutput('differential-derivation');
        const scan = ctx.getStepOutput('locate-in-platform');

        const matchesBlock =
          scan.matches.length > 0
            ? scan.matches
                .map(
                  (m) =>
                    `- \`${m.file}\`: \`${m.symbol}\` [${m.signalType}, ${m.confidence}]` +
                    (m.rationale ? ` — ${m.rationale}` : '')
                )
                .join('\n')
            : '(no matches found)';

        const deltaBlock =
          diff.deltaFeatures.length > 0
            ? diff.deltaFeatures.join(', ')
            : '(none — feature adds no FM-required dependencies)';

        const correlationBlock =
          diff.correlations.length > 0
            ? diff.correlations
                .slice(0, 5)
                .map((c) => `${c.feature} (${Math.round(c.conditionalRate * 100)}%)`)
                .join(', ')
            : '(no correlation data)';

        const selectabilityNote = !diff.withValid
          ? `\n⚠️ ${featureName} cannot be independently selected from the FM: ${diff.withError ?? 'FeatureSelectionError'}`
          : '';

        const { text } = await complete({
          system: RECONCILE_SYSTEM,
          messages: [
            {
              role: 'user',
              content:
                `## Target feature: ${featureName}${selectabilityNote}\n` +
                `SPL: ${line.name} | valid products: ${totalValidProducts} | selecting this feature: ${diff.totalProductsWithFeature}\n\n` +
                `## Platform scan matches (semantic signal):\n${matchesBlock}\n\n` +
                `## FM differential (features auto-added when ${featureName} is selected):\n${deltaBlock}\n\n` +
                `## Portfolio correlation (most often co-selected with ${featureName}):\n${correlationBlock}\n\n` +
                `Write the feature map.`,
            },
          ],
          memories: ctx.memories, instructions: ctx.instructions,
        });

        return {
          output: { markdown: text },
          result: {
            featureName,
            lineName: line.name,
            productsWithFeature: diff.totalProductsWithFeature,
            matchesFound: scan.matches.length,
            deltaFeatures: diff.deltaFeatures.length,
            featureSelectable: diff.withValid,
            markdown: text,
          },
        };
      },
    },

    {
      name: 'propose-annotation',
      kind: 'git',
      run: async (ctx) => {
        if (!ctx.input?.annotate) {
          return {
            output: { skipped: true, reason: 'input.annotate is not set — no annotation requested' },
          };
        }

        const { featureName } = ctx.getStepOutput('load-context');
        const scan = ctx.getStepOutput('locate-in-platform');

        // Only annotate HIGH/MEDIUM confidence matches (LOW matches are too speculative).
        const matches = (scan.matches ?? []).filter((m) => m.confidence !== 'LOW');
        if (matches.length === 0) {
          return {
            output: { skipped: true, reason: 'No HIGH/MEDIUM confidence matches found to annotate.' },
            result: { featureName, annotated: false, reason: 'No matches to annotate.' },
          };
        }

        // Need developer access to later commit (LINEA refuses the commit otherwise).
        const { lineProjectId } = await lineAccess({
          lineId: ctx.lineId,
          userId: ctx.userId,
        });

        // Read each unique file and apply annotation insertions.
        const fileContents = {};
        for (const m of matches) {
          if (!fileContents[m.file]) {
            try {
              fileContents[m.file] = await readRepoFile({ lineProjectId, path: m.file });
            } catch {
              fileContents[m.file] = null;
            }
          }
        }

        const fileEdits = [];
        for (const [path, originalContent] of Object.entries(fileContents)) {
          if (!originalContent) continue;
          const fileMatches = matches.filter((m) => m.file === path);
          let newContent = originalContent;
          for (const m of fileMatches) {
            newContent = insertFeatureAnnotation(newContent, m.symbol, featureName);
          }
          if (newContent !== originalContent) {
            fileEdits.push({ path, oldContent: originalContent, newContent });
          }
        }

        if (fileEdits.length === 0) {
          return {
            output: {
              skipped: true,
              reason:
                'No function definitions found to annotate (symbols may be template conditionals).',
            },
            result: { featureName, annotated: false, reason: 'Symbols not found as JS function definitions.' },
          };
        }

        const fileSummary = fileEdits.map((e) => `- \`${e.path}\``).join('\n');

        return {
          output: { proposed: true, fileEdits, lineProjectId },
          proposal: {
            kind: 'annotation_mr',
            blastRadius: 'line',
            target: { lineProjectId },
            body: {
              title: `feat: add @feature JSDoc for ${featureName}`,
              featureName,
              fileEdits,
              markdown:
                `## Proposed \`@feature\` JSDoc annotations for \`${featureName}\`\n\n` +
                `Adds \`/** @feature ${featureName} */\` above each identified function,\n` +
                `creating a machine-readable feature map that future Harvest and Evolution runs\n` +
                `will inject into their system prompts.\n\n` +
                `Files to annotate:\n${fileSummary}`,
            },
          },
        };
      },
    },

    {
      name: 'apply-annotation-mr',
      kind: 'git',
      run: async (ctx) => {
        const proposal = ctx
          .getProposals()
          .find((p) => p.kind === 'annotation_mr' && p.decision === 'approved');

        if (!proposal) return { output: { opened: false } };

        const { lineProjectId } = await lineAccess({
          lineProjectId: proposal.target.lineProjectId,
          userId: ctx.userId,
        });

        const { featureName, fileEdits } = proposal.body;
        const safeName = (featureName ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
        const branch = `feature-location/${safeName}-${Date.now()}`;
        const title = `feat: add @feature JSDoc for ${featureName ?? 'unknown'}`;

        const actions = (fileEdits ?? [])
          .filter((e) => e?.path && e.newContent != null)
          .map((e) => ({ action: 'update', path: e.path, content: e.newContent }));

        if (actions.length === 0) {
          return { output: { opened: false, reason: 'No file edits to commit.' } };
        }

        try {
          await createBranchRest({ id: lineProjectId, branch, ref: 'main' });
        } catch (err) {
          if (!isBranchAlreadyExistsError(err)) throw err;
        }
        await commitFiles({ id: lineProjectId, branch, message: title, actions });
        const mr = await openMergeRequest({ id: lineProjectId, title, sourceBranch: branch, targetBranch: 'main' });

        return {
          output: { opened: true, mrUrl: mr.webUrl, branch, filesAnnotated: actions.length },
          result: {
            featureName,
            annotated: true,
            mrUrl: mr.webUrl,
            filesAnnotated: actions.length,
          },
        };
      },
    },
  ],
};

registerAgent(definition);

export default definition;
