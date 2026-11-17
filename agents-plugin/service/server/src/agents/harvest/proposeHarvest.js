import { runToolLoop } from '../core/llm.js';
import { listPlatformFiles, readRepoFile, HARVEST_CHANGE_TYPES } from '../tools/harvest.js';

/**
 * Shared Harvest proposal machinery, used by both the Harvest agent's
 * `propose-plan` step and the `/refine` endpoint (chat-to-revise). The tool loop
 * lets Claude read the real platform files and return concrete file edits.
 */

const MAX_FILES = 20;
const MAX_DIFF_CHARS = 3000;

const SYSTEM_PROMPT = `You are an expert Software Product Line (SPL) platform engineer.
A product has direct changes on its 'main' branch that are NOT part of the generated code — someone customized the product directly, outside the generation flow.

FIRST, classify the change set into exactly one changeType:
- new-optional-feature: a genuinely new capability not represented in the feature model. Add a NEW optional feature (default off) and gate the platform edits behind it. Return the FULL updated UVL model (keep all existing features) and set featureName to the new feature.
- extend-existing-feature: the change belongs to a feature that ALREADY exists in the feature model (you can see it gated/implemented in the platform). Extend that feature's existing implementation. Do NOT add a feature: leave newModelUvl empty and set featureName to the existing feature being extended.
- bugfix-to-generated: a fix to generator-owned code that EVERY product should receive. No feature gate: leave featureName and newModelUvl empty and provide the corrected platform fileEdits.
- product-local: a customization point (README, .env, config, docker-compose, CI) or a one-off local hack that should NOT be folded into the platform. Set harvestable=false.
- ambiguous: you cannot decide confidently. Set harvestable=false and explain in reasoning what a human must clarify.

Deterministic signals (file ownership, a suggested type) are provided below; use them, but you may override with justification in reasoning.

For harvestable changes (new-optional-feature, extend-existing-feature, bugfix-to-generated), make REAL platform changes — not just a description:
1. Use list_platform_files to see the templates/helpers under src/platform.
2. Use read_platform_file to read every file you intend to change.
3. In propose_harvest, return fileEdits: for each platform file, its COMPLETE new content (action 'update' for files you read, 'create' for new). Gate any new behaviour with the same feature/conditional mechanism the existing templates use; keep edits minimal and consistent with the existing style.

Always call propose_harvest with a changeType. If the feature model is XML (not UVL), leave newModelUvl empty.

If an "## Operator direction" block is present, it is authoritative: follow the operator's pinned intent, changeType, target feature, and directive over your own default classification. If a direction is technically impossible (e.g. they pinned extend-existing-feature but no such feature exists, or asked to aggregate a change that is clearly product-local), proceed with the best valid classification anyway and EXPLAIN the deviation in reasoning. Never emit an invalid proposal just to satisfy a direction — the deterministic feature-model safety check is the backstop, but you should not knowingly produce a broken model.

If a "## Merge task" block with "## Source proposal" sections is present, you are MERGING several already-proposed harvest changes into ONE unified platform change. Produce a single coherent proposal: one changeType, one feature (or none, for a bugfix), one merged set of fileEdits, and at most one newModelUvl that folds in every source's model change. The "## Operator merge directive" is authoritative on how to combine the sources — especially how to resolve files that more than one source edits: reconcile them into a single final newContent per path (do not emit two edits for the same path). Read any platform file you need before producing its merged content.`;

const LIST_TOOL = {
  name: 'list_platform_files',
  description: 'List the platform template/helper files (blobs under src/platform) in the line repo.',
  input_schema: { type: 'object', properties: {} },
};

const READ_TOOL = {
  name: 'read_platform_file',
  description: 'Read the current content of a file under src/ in the line repo so you can produce its updated content.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Repo path, e.g. src/platform/...' } },
    required: ['path'],
  },
};

const PROPOSE_TOOL = {
  name: 'propose_harvest',
  description: 'Propose how to fold a product-side change back into the SPL platform, with concrete file edits.',
  input_schema: {
    type: 'object',
    properties: {
      harvestable: { type: 'boolean', description: 'true if the change should be folded into the platform (false for product-local / ambiguous).' },
      changeType: {
        type: 'string',
        enum: HARVEST_CHANGE_TYPES,
        description: 'How to fold the change in — see the taxonomy in the system prompt.',
      },
      featureName: { type: 'string', description: 'For new-optional-feature: the new feature name. For extend-existing-feature: the existing feature being extended. Empty for bugfix-to-generated.' },
      newModelUvl: { type: 'string', description: 'FULL updated UVL — ONLY for new-optional-feature. Empty for every other type (and for XML models).' },
      fileEdits: {
        type: 'array',
        description: 'Concrete platform file edits to commit. Each with the COMPLETE new content.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            action: { type: 'string', enum: ['create', 'update'] },
            newContent: { type: 'string' },
            rationale: { type: 'string' },
          },
          required: ['path', 'newContent'],
        },
      },
      platformPlan: { type: 'string', description: 'Short markdown overview of the platform changes.' },
      reasoning: { type: 'string', description: 'Markdown: the classification rationale (why this changeType), generalizable vs product-specific.' },
    },
    required: ['harvestable', 'changeType', 'reasoning'],
  },
};

const CHANGE_TYPE_HINT = {
  'new-optional-feature': 'add a NEW optional feature (default off) and gate the edits behind it',
  'extend-existing-feature': 'extend an EXISTING feature already in the model — do not add a feature',
  'bugfix-to-generated': 'a fix to generator-owned code every product should get — no feature gate',
  'product-local': 'a product-local customization — likely not harvestable',
  ambiguous: 'classification is uncertain',
};

// The operator's pre-launch steering, rendered as an authoritative direction block.
const buildSteeringBlock = (steering) => {
  if (!steering) return '';
  const lines = [];
  if (steering.intent === 'aggregate') {
    lines.push('- Intent: **aggregate into the platform** — prefer folding/generalizing this change into the platform (extend an existing feature where possible).');
  } else if (steering.intent === 'as-is') {
    lines.push('- Intent: **harvest as-is** — prefer a clean new optional feature, minimize generalization across other concerns.');
  }
  if (steering.changeType) {
    lines.push(`- Pinned change type: \`${steering.changeType}\`${CHANGE_TYPE_HINT[steering.changeType] ? ` (${CHANGE_TYPE_HINT[steering.changeType]})` : ''}.`);
  }
  if (steering.targetFeature) {
    lines.push(`- Target feature to extend: \`${steering.targetFeature}\`.`);
  }
  if (steering.directive && steering.directive.trim()) {
    lines.push(`- Directive: ${steering.directive.trim()}`);
  }
  if (!lines.length) return '';
  return `## Operator direction\n${lines.join('\n')}\n\n`;
};

const buildUserMessage = ({ productName, features, model, changes, signals, steering }) => {
  const fileBlocks = (changes.files ?? [])
    .slice(0, MAX_FILES)
    .map((f) => {
      const tags = [f.added && 'added', f.deleted && 'deleted', f.renamed && 'renamed'].filter(Boolean).join(', ');
      return `### ${f.path}${tags ? ` (${tags})` : ''}\n\`\`\`diff\n${(f.diff ?? '').slice(0, MAX_DIFF_CHARS)}\n\`\`\``;
    })
    .join('\n\n');
  const commitList = (changes.commits ?? []).map((c) => `- ${c.id} ${c.message} — ${c.author}`).join('\n');

  const signalsBlock = signals
    ? `## Deterministic signals\n` +
      `Suggested type: ${signals.suggestedType ?? 'ambiguous'}\n` +
      `Generator-owned files changed: ${signals.generatorOwnedPaths?.length ? signals.generatorOwnedPaths.join(', ') : '(none)'}\n` +
      `Customization-point files changed: ${signals.customizationPaths?.length ? signals.customizationPaths.join(', ') : '(none)'}\n` +
      `Commit messages hint a bugfix: ${signals.fixHint ? 'yes' : 'no'}\n\n`
    : '';

  return (
    `## Product: ${productName}\n` +
    `Feature selection: ${features?.length ? features.join(', ') : '(none)'}\n\n` +
    `## Current feature model (${model.type})\n\`\`\`\n${model.content}\n\`\`\`\n\n` +
    signalsBlock +
    buildSteeringBlock(steering) +
    `## Direct changes on main (not generated) — ${(changes.files ?? []).length} file(s)\n` +
    `Commits:\n${commitList || '(none)'}\n\n${fileBlocks}\n\n` +
    `Classify the change set, then (if harvestable) inspect the platform files (list/read tools) and call propose_harvest with concrete fileEdits.`
  );
};

// Render N already-proposed harvest plans + an operator merge directive into a
// single "merge task" message. The model synthesizes one unified propose_harvest
// from them (see the merge paragraph in SYSTEM_PROMPT).
export const buildMergeMessage = ({ model, sources, directive }) => {
  const sourceBlocks = (sources ?? [])
    .map((s, i) => {
      const plan = s.plan ?? {};
      const edits = (plan.fileEdits ?? [])
        .map(
          (e) =>
            `#### ${e.path} (${e.action ?? 'update'})\n\`\`\`\n${(e.newContent ?? '').slice(0, MAX_DIFF_CHARS)}\n\`\`\``
        )
        .join('\n\n');
      return (
        `## Source proposal ${i + 1}: ${s.title ?? plan.featureName ?? '(change)'}\n` +
        `- changeType: \`${plan.changeType ?? 'ambiguous'}\`\n` +
        `- featureName: ${plan.featureName ? `\`${plan.featureName}\`` : '(none)'}\n` +
        (plan.newModelUvl ? `- proposes a feature-model change (its newModelUvl)\n` : '') +
        (plan.reasoning ? `- rationale: ${plan.reasoning}\n` : '') +
        `\n### File edits\n${edits || '_(no file edits)_'}` +
        (plan.newModelUvl ? `\n\n### Proposed UVL model\n\`\`\`\n${plan.newModelUvl}\n\`\`\`` : '')
      );
    })
    .join('\n\n');

  return (
    `## Merge task\n` +
    `Combine the ${sources?.length ?? 0} source proposals below into ONE unified harvest proposal.\n\n` +
    `## Current feature model (${model.type})\n\`\`\`\n${model.content}\n\`\`\`\n\n` +
    `## Operator merge directive\n${directive?.trim() ? directive.trim() : '(none — use your best judgement to fold them together coherently)'}\n\n` +
    `${sourceBlocks}\n\n` +
    `Inspect any platform files you need (list/read), then call propose_harvest with the single unified result.`
  );
};

export const buildProposalMarkdown = ({ plan, validation, model }) => {
  const validationLine = validation?.validated
    ? validation.valid
      ? `✅ The updated feature model still admits all ${validation.checked} existing product(s).`
      : `❌ The updated model would break ${validation.broken.length} product(s): ${validation.broken
          .map((b) => `${b.name} (${b.reason})`)
          .join('; ')}`
    : '_No feature-model change to validate._';

  const editsSection = plan.fileEdits?.length
    ? `## Platform file changes (committed in the MR)\n${plan.fileEdits
        .map((e) => `- \`${e.path}\` (${e.action ?? 'update'})${e.rationale ? ` — ${e.rationale}` : ''}`)
        .join('\n')}\n\n`
    : '';

  const CHANGE_TYPE_LABEL = {
    'new-optional-feature': 'New optional feature',
    'extend-existing-feature': 'Extend existing feature',
    'bugfix-to-generated': 'Bugfix to generated code',
    'product-local': 'Product-local (not harvested)',
    ambiguous: 'Ambiguous',
  };
  const featureLine =
    plan.changeType === 'extend-existing-feature'
      ? plan.featureName
        ? `**Extends existing feature:** \`${plan.featureName}\`\n\n`
        : ''
      : plan.featureName
      ? `**Proposed optional feature:** \`${plan.featureName}\`\n\n`
      : '';

  return (
    `**Change type:** ${CHANGE_TYPE_LABEL[plan.changeType] ?? plan.changeType ?? 'unknown'}\n\n` +
    `## Why\n${plan.reasoning ?? ''}\n\n` +
    featureLine +
    `## Feature-model safety\n${validationLine}\n\n` +
    editsSection +
    (plan.platformPlan ? `## Notes\n${plan.platformPlan}\n\n` : '')
  );
};

// Raw propose_harvest input (without the diff helper fields), for re-seeding refine.
export const planToToolInput = (plan) => ({
  harvestable: true,
  changeType: plan.changeType,
  featureName: plan.featureName,
  newModelUvl: plan.newModelUvl,
  platformPlan: plan.platformPlan,
  reasoning: plan.reasoning,
  fileEdits: (plan.fileEdits ?? []).map((e) => ({
    path: e.path,
    action: e.action,
    newContent: e.newContent,
    rationale: e.rationale,
  })),
});

/**
 * Run the proposal tool loop. `prior` (optional) re-seeds the conversation with
 * the previous proposal + the user's feedback, so the model revises it in place.
 * Returns the raw plan (propose_harvest input) with `oldContent` attached per file.
 */
export const runHarvestProposal = async ({ lineProjectId, detect, signals = null, steering = null, prior = null, merge = null, memories = [], instructions = '', loopRunner = runToolLoop }) => {
  let proposal = null;
  const readCache = {};

  const executeTool = async (name, input) => {
    if (name === 'propose_harvest') {
      proposal = input;
      return 'Proposal received.';
    }
    if (name === 'list_platform_files') {
      try {
        return { files: await listPlatformFiles({ lineProjectId }) };
      } catch (e) {
        return `Could not list platform files: ${e?.message ?? e}`;
      }
    }
    if (name === 'read_platform_file') {
      const p = input?.path ?? '';
      if (!p.startsWith('src/')) return 'Only paths under src/ may be read.';
      try {
        const content = await readRepoFile({ lineProjectId, path: p });
        readCache[p] = content;
        return { path: p, content };
      } catch (e) {
        return `Could not read ${p}: ${e?.message ?? e}`;
      }
    }
    return `Unknown tool: ${name}`;
  };

  const messages = [
    {
      role: 'user',
      content: merge
        ? buildMergeMessage({ model: detect.model, sources: merge.sources, directive: merge.directive })
        : buildUserMessage({
            productName: detect.productName,
            features: detect.features,
            model: detect.model,
            changes: { files: detect.files, commits: detect.commits },
            signals,
            steering,
          }),
    },
  ];

  if (prior && !merge) {
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'prior_proposal', name: 'propose_harvest', input: prior.input }] });
    messages.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'prior_proposal', content: 'Recorded. The user reviewed it and has feedback.' },
        { type: 'text', text: `Revise the proposal based on this feedback. Re-read any files you need first.\n\nFeedback: ${prior.feedback}` },
      ],
    });
  }

  // `loopRunner` defaults to the in-memory runToolLoop (used by the human-gated refine
  // path); the harvest agent step passes ctx.runToolLoop for durable, checkpointed turns.
  await loopRunner({ system: SYSTEM_PROMPT, tools: [LIST_TOOL, READ_TOOL, PROPOSE_TOOL], executeTool, maxTurns: 12, maxTokens: 8192, messages, memories, instructions });

  if (!proposal) return null;

  for (const e of proposal.fileEdits ?? []) {
    if (e.action === 'create') {
      e.oldContent = '';
      continue;
    }
    e.oldContent = readCache[e.path] ?? null;
    if (e.oldContent == null) {
      try {
        e.oldContent = await readRepoFile({ lineProjectId, path: e.path });
      } catch {
        e.oldContent = '';
      }
    }
  }

  // The model occasionally echoes back a file it read unchanged as an "update" —
  // drop those no-op edits rather than presenting them to the operator as a real diff.
  const noOpPaths = (proposal.fileEdits ?? [])
    .filter((e) => e.action === 'update' && e.newContent === e.oldContent)
    .map((e) => e.path);
  if (noOpPaths.length) {
    proposal.fileEdits = proposal.fileEdits.filter((e) => !(e.action === 'update' && e.newContent === e.oldContent));
  }

  // If every edit turned out to be a no-op and there's no feature-model change either,
  // the proposal has nothing real left to review — don't let an empty one through.
  if (proposal.harvestable && !proposal.newModelUvl && !proposal.fileEdits?.length) {
    proposal.harvestable = false;
    proposal.reason = `No line-level changes remained after dropping no-op file edit(s) (${noOpPaths.join(', ')}), and no feature-model change was proposed.`;
  }

  return proposal;
};
