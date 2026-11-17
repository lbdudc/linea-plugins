import { Container } from 'typedi';
import { registerAgent } from '../core/AgentRegistry.js';
import { complete } from '../core/llm.js';
import { productAccess, branches } from '../tools/git.js';
import { postMergeRequestComment } from '../../linea/repo.js';
import { normalizeFeatureSelection } from '../tools/splContext.js';
import {
  readProductLogs,
  classifyLogs,
  fetchConflict,
  classifyFiles,
  commitResolution,
  recheckMergeability,
} from '../tools/sync.js';
import { runSyncResolution, buildResolutionMarkdown, planToToolInput } from '../sync/proposeSync.js';
import { validateProductFm } from '../sync/syncValidation.js';
import PlaygroundService from '../playground/PlaygroundService.js';

const MAX_FILES = 20;
const MAX_DIFF_CHARS = 4000;
const MAX_TEST_ATTEMPTS = 5;

// The dryRun flag skips all git writes so the full path can be exercised safely.
const isDryRun = (ctx) => Boolean(ctx.input?.dryRun);

const SYSTEM_PROMPT = `You are an expert assistant for a Software Product Line (SPL) generation system.
A product's generated code failed to merge cleanly into its target branch. Given the conflict stage, a deterministic diagnosis, and the conflicting files with their diffs, produce a concise, actionable, per-file resolution plan in GitHub-flavored markdown.

Branch model:
- "generating" stage = the generated commit could not merge into 'bigbang'. Usually 'bigbang' drifted from the last generation tag — someone committed directly to 'bigbang', or a previous sync left it dirty.
- "update" stage = 'bigbang' could not merge into 'main'. Almost always someone edited 'main' directly, bypassing the generation flow.

Per-file guidance to apply:
- A generator-owned file (its content is driven by the feature model/platform templates) → recommend taking the generated version ("theirs"); if there is a manual hunk in the current version, name the exact lines to re-apply on top.
- A known customization point (README.md, .env, docker-compose.yml, config files) → recommend keeping the current version ("ours").
- An offending direct commit to bigbang/main → explain the anti-pattern briefly and give the cherry-pick + reset recipe so future syncs stay clean.

Rules:
- Be concise. Use a short ## Summary, then a ### heading per conflicting file with a clear recommendation, then a final ## Recommended action.
- Never invent files that are not in the provided list.
- End with a one-line note that a human should review before resolving.`;

const stageLabel = (stage) =>
  stage === 'update' ? 'bigbang → main (update)' : 'generation → bigbang (generating)';

const buildUserMessage = ({ productName, features, verdict, conflict }) => {
  const fileBlocks = conflict.files
    .slice(0, MAX_FILES)
    .map((f) => {
      const tags = [f.added && 'added', f.deleted && 'deleted', f.renamed && 'renamed']
        .filter(Boolean)
        .join(', ');
      const diff = (f.diff ?? '').slice(0, MAX_DIFF_CHARS);
      return `### ${f.path}${tags ? ` (${tags})` : ''}\n\`\`\`diff\n${diff}\n\`\`\``;
    })
    .join('\n\n');

  return (
    `## Product: ${productName}\n` +
    `Feature selection: ${features.length ? features.join(', ') : '(none)'}\n\n` +
    `## Conflict stage: ${stageLabel(verdict.stage)}\n` +
    `## Diagnosis: ${verdict.diagnosis.title}\n${verdict.diagnosis.action}\n\n` +
    `## Conflicting files (${conflict.files.length})\n${fileBlocks || '_No file diffs available._'}\n\n` +
    `Produce the per-file resolution plan.`
  );
};

const definition = {
  type: 'sync',
  title: 'Sync Agent',
  description:
    'Diagnoses a failed product synchronization and proposes a per-file conflict resolution plan as a merge-request comment.',
  scope: 'product',

  steps: [
    {
      name: 'load-context',
      kind: 'deterministic',
      run: async (ctx) => {
        if (!ctx.productId) throw new Error('sync agent requires scope.productId');
        const { product } = await productAccess({
          productId: ctx.productId,
          userId: ctx.userId,
          });
        const version = ctx.input?.version ?? product.spec?.basicData?.version ?? '?';
        const features = normalizeFeatureSelection({ spec: product.spec });
        const logs = await readProductLogs({ productId: ctx.productId, version });
        return {
          output: {
            productName: product.spec?.basicData?.name ?? String(product._id),
            version,
            features,
            logCount: logs.length,
          },
        };
      },
    },

    {
      name: 'diagnose',
      kind: 'deterministic',
      run: async (ctx) => {
        const { version } = ctx.getStepOutput('load-context');
        const logs = await readProductLogs({ productId: ctx.productId, version });
        const verdict = classifyLogs(logs);
        return { output: verdict };
      },
    },

    {
      name: 'fetch-conflict-details',
      kind: 'git',
      run: async (ctx) => {
        const verdict = ctx.getStepOutput('diagnose');
        if (verdict.status !== 'issue' || !verdict.stage) {
          return { output: { skipped: true, reason: 'No merge conflict to inspect.' } };
        }
        const { projectId } = await productAccess({
          productId: ctx.productId,
          userId: ctx.userId,
          });

        let stage = verdict.stage;
        let conflict = await fetchConflict({ projectId, stage });

        // `diagnose` is a heuristic over log history: it finds the last logged
        // warning/error, which can point at a conflict already resolved through a
        // route that doesn't append to that same log stream (e.g. this agent's own
        // commit+merge on a previous run). If that MR is no longer open/conflicting,
        // check the other stage before giving up — a genuinely open conflict there
        // would otherwise never get diagnosed at all.
        if (!conflict.mr?.hasConflicts) {
          const otherStage = stage === 'update' ? 'generating' : 'update';
          const otherConflict = await fetchConflict({ projectId, stage: otherStage });
          if (otherConflict.mr?.hasConflicts) {
            stage = otherStage;
            conflict = otherConflict;
          }
        }

        if (!conflict.mr) {
          return { output: { skipped: true, reason: 'The logged conflict no longer exists — it may already be resolved.' } };
        }

        const resolution = classifyFiles(conflict.files);
        // Persist projectId (not secret) so the post step can act without re-deriving it.
        // `stage` may differ from diagnose's verdict.stage if the fallback above fired —
        // downstream steps prefer this corrected value.
        return {
          output: {
            projectId,
            stage,
            mr: conflict.mr,
            fileCount: conflict.files.length,
            unambiguous: resolution.unambiguous,
            resolution: resolution.files,
            files: conflict.files.slice(0, MAX_FILES).map((f) => ({
              path: f.path,
              added: f.added,
              deleted: f.deleted,
              renamed: f.renamed,
              diff: (f.diff ?? '').slice(0, MAX_DIFF_CHARS),
            })),
          },
        };
      },
    },

    {
      name: 'explain',
      kind: 'llm',
      run: async (ctx) => {
        const verdict = ctx.getStepOutput('diagnose');
        const conflict = ctx.getStepOutput('fetch-conflict-details');
        if (verdict.status !== 'issue' || !verdict.stage || !conflict?.mr) {
          return { output: { skipped: true } };
        }
        // fetch-conflict-details may have fallen back to the other stage if the
        // logged one turned out to already be resolved — prefer its corrected value.
        const effectiveVerdict = { ...verdict, stage: conflict.stage ?? verdict.stage };
        const { productName, features } = ctx.getStepOutput('load-context');
        const { text } = await complete({
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: buildUserMessage({ productName, features, verdict: effectiveVerdict, conflict }),
            },
          ],
          memories: ctx.memories, instructions: ctx.instructions,
        });
        return { output: { plan: text } };
      },
    },

    {
      // Auto-resolve only the bigbang → main ('update') stage: Claude reads the
      // conflicting files on both branches and returns reconciled content. The
      // engineer reviews the diffs + chats to refine before anything is committed.
      name: 'resolve-edits',
      kind: 'llm',
      toolLoop: true, // durable multi-turn investigation via ctx.runToolLoop
      run: async (ctx) => {
        const verdict = ctx.getStepOutput('diagnose');
        const conflict = ctx.getStepOutput('fetch-conflict-details');
        const stage = conflict?.stage ?? verdict.stage;
        if (stage !== 'update' || !conflict?.mr || !conflict.files?.length) {
          return { output: { skipped: true } };
        }
        const { productName, features } = ctx.getStepOutput('load-context');
        const { projectId } = await productAccess({
          productId: ctx.productId,
          userId: ctx.userId,
          });
        // File-aware recall: the conflicting files (known only now) are the strongest
        // signal for "how did we reconcile this before". Query memory by them + the
        // diagnosis, then merge with the run-level memories (dedup, run-level first).
        const recallQuery = [
          verdict.diagnosis?.title,
          'conflict resolution for ' + conflict.files.map((f) => f.path).slice(0, 12).join(', '),
        ].filter(Boolean).join(' — ');
        const recalled = await ctx.recall(recallQuery);
        const memories = [...new Set([...(ctx.memories ?? []), ...recalled])];

        const plan = await runSyncResolution({
          projectId,
          detect: { productName, features, diagnosis: verdict.diagnosis, files: conflict.files },
          fileResolution: conflict.resolution ?? [],
          memories, instructions: ctx.instructions,
          loopRunner: ctx.runToolLoop,
        });
        if (!plan || !(plan.resolveEdits ?? []).length) {
          return { output: { resolved: false, reason: 'No structured resolution returned.' } };
        }
        return { output: { resolved: true, summary: plan.summary, fileCount: plan.resolveEdits.length, plan } };
      },
    },

    {
      // Validates the LLM-proposed resolution by running the product's tests against
      // the reconciled files. On failure, feeds the test output back to the LLM and
      // retries up to MAX_TEST_ATTEMPTS times. Skipped if the product has no test
      // environment configured or if resolve-edits produced no plan.
      // Stays on the in-memory loop (no loopRunner): this step runs several independent
      // resolution conversations (one per test-retry, each re-seeded with different
      // `prior`), which can't share the single per-step durable `loop` checkpoint.
      name: 'test-resolution',
      kind: 'llm',
      run: async (ctx) => {
        const resolve = ctx.getStepOutput('resolve-edits');
        if (!resolve?.resolved || !resolve.plan) {
          return { output: { skipped: true } };
        }

        const conflict = ctx.getStepOutput('fetch-conflict-details');
        const { productName, features } = ctx.getStepOutput('load-context');
        const verdict = ctx.getStepOutput('diagnose');
        const branch = conflict.mr?.sourceBranch ?? branches.base;

        const { projectId } = await productAccess({
          productId: ctx.productId,
          userId: ctx.userId,
          });

        const playground = Container.get(PlaygroundService);
        let currentPlan = resolve.plan;
        // Per-attempt record so the operator can see WHY earlier auto-resolutions
        // failed, not just the final outcome (surfaced on proposal.body.testHistory).
        const history = [];

        for (let attempt = 1; attempt <= MAX_TEST_ATTEMPTS; attempt++) {
          const result = await playground.testFileEdits({
            userId: ctx.userId,
            productId: ctx.productId,
            branch,
            fileEdits: (currentPlan.resolveEdits ?? []).map((e) => ({
              path: e.path,
              action: e.action ?? 'update',
              newContent: e.newContent ?? '',
            })),
          });

          if (result.noTestCommand) {
            return { output: { skipped: true, reason: 'No test command configured for this product.' } };
          }

          history.push({
            attempt,
            passed: Boolean(result.passed),
            fileCount: (currentPlan.resolveEdits ?? []).length,
            log: (result.log ?? '').slice(0, 3000),
          });

          if (result.passed) {
            return { output: { tested: true, passed: true, attempts: attempt, plan: currentPlan, history } };
          }

          if (attempt < MAX_TEST_ATTEMPTS) {
            const refined = await runSyncResolution({
              projectId,
              detect: { productName, features, diagnosis: verdict.diagnosis, files: conflict.files },
              fileResolution: conflict.resolution ?? [],
              prior: {
                input: planToToolInput(currentPlan),
                feedback: `Test run failed (attempt ${attempt}/${MAX_TEST_ATTEMPTS}):\n${result.log.slice(0, 3000)}`,
              },
              memories: ctx.memories, instructions: ctx.instructions,
            });
            if (refined?.resolveEdits?.length) currentPlan = refined;
          }
        }

        return { output: { tested: true, passed: false, attempts: MAX_TEST_ATTEMPTS, plan: currentPlan, history } };
      },
    },

    {
      name: 'propose-resolution',
      kind: 'approval',
      run: async (ctx) => {
        const verdict = ctx.getStepOutput('diagnose');
        const conflict = ctx.getStepOutput('fetch-conflict-details');
        const explain = ctx.getStepOutput('explain');
        const resolve = ctx.getStepOutput('resolve-edits');
        const testResolution = ctx.getStepOutput('test-resolution');

        if (!conflict?.mr) {
          return { output: { skipped: true } };
        }
        // fetch-conflict-details may have fallen back to the other stage if the
        // logged one turned out to already be resolved — prefer its corrected value.
        const stage = conflict.stage ?? verdict.stage;

        // bigbang → main with concrete reconciled content → rich diff+chat review.
        // Prefer the test-refined plan from test-resolution if available.
        const activePlan = testResolution?.plan ?? resolve?.plan;
        const testResult = testResolution?.skipped
          ? null
          : testResolution
          ? { passed: testResolution.passed, attempts: testResolution.attempts }
          : null;

        if (stage === 'update' && resolve?.resolved && activePlan) {
          const plan = activePlan;
          const markdown = buildResolutionMarkdown({ plan, recheck: null, testResult });
          const fm = await validateProductFm({ productId: ctx.productId, userId: ctx.userId });
          return {
            output: { proposed: true, mode: 'resolution', fileCount: (plan.resolveEdits ?? []).length },
            proposal: {
              kind: 'merge_resolution',
              blastRadius: 'product',
              // A resolution commit on the source branch always wants human review.
              unambiguous: false,
              target: {
                projectId: conflict.projectId,
                mrIid: conflict.mr.iid,
                mrUrl: conflict.mr.webUrl,
                sourceBranch: conflict.mr.sourceBranch ?? branches.base,
              },
              body: {
                title: `Resolve ${stageLabel(stage)}`,
                markdown,
                mrUrl: conflict.mr.webUrl,
                fileEdits: (plan.resolveEdits ?? []).map((e) => ({
                  path: e.path,
                  action: e.action ?? 'update',
                  newContent: e.newContent ?? '',
                  oldContent: e.oldContent ?? '',
                  theirsContent: e.theirsContent ?? '',
                  rationale: e.rationale ?? '',
                  confidence: e.confidence ?? 'ai',
                })),
                plan: planToToolInput(plan),
                validation: { fm },
                // Structured outcome + per-attempt auto-resolution history for the review UI.
                testResult,
                testHistory: testResolution?.history ?? [],
              },
            },
          };
        }

        // Fallback (generation → bigbang, or no resolution produced): advisory comment.
        if (!explain?.plan) {
          return { output: { skipped: true } };
        }
        return {
          output: { proposed: true, mode: 'comment', unambiguous: Boolean(conflict.unambiguous) },
          proposal: {
            kind: 'git_comment',
            blastRadius: 'product',
            // Drives the ApprovalGate's ambiguity check: an all-generator-owned
            // conflict is auto-postable on an `automatic`, non-critical product.
            unambiguous: Boolean(conflict.unambiguous),
            target: { projectId: conflict.projectId, mrIid: conflict.mr.iid, mrUrl: conflict.mr.webUrl },
            body: {
              title: `Resolution plan for ${stageLabel(stage)}`,
              markdown: explain.plan,
              mrUrl: conflict.mr.webUrl,
              autoResolvable: Boolean(conflict.unambiguous),
            },
          },
        };
      },
    },

    {
      name: 'apply-resolution',
      kind: 'git',
      run: async (ctx) => {
        const verdict = ctx.getStepOutput('diagnose');
        const conflict = ctx.getStepOutput('fetch-conflict-details');
        const explain = ctx.getStepOutput('explain');
        const dry = isDryRun(ctx);

        const accepted = (p) => p.decision === 'approved' || p.decision === 'auto';
        const resolution = ctx.getProposals().find((p) => p.kind === 'merge_resolution' && accepted(p));
        const comment = ctx.getProposals().find((p) => p.kind === 'git_comment' && accepted(p));

        // fetch-conflict-details may have fallen back to the other stage if the
        // logged one turned out to already be resolved — prefer its corrected value
        // (this also feeds run.result.stage, which the UI uses to decide whether to
        // show the Sync→Harvest pointer for an 'update'-stage conflict).
        const baseResult = {
          status: verdict.status,
          key: verdict.key ?? null,
          stage: conflict?.stage ?? verdict.stage ?? null,
          diagnosis: verdict.diagnosis ?? null,
          mr: conflict?.mr ?? null,
        };

        // Commit the reconciled files onto the MR's source branch (bigbang).
        if (resolution) {
          // Re-validate the product's FM immediately before the write.
          // The proposal may have sat in awaiting_approval while the FM drifted.
          const fm = await validateProductFm({ productId: ctx.productId, userId: ctx.userId, cutOnInfra: true });
          if (!fm.valid) {
            throw new Error(
              `Pre-write validation failed: the product's feature selection is no longer valid under the current FM. ` +
              `Violations: ${fm.violations.join('; ')}. ` +
              'Reject and re-run sync after fixing the feature model.'
            );
          }

          if (dry) {
            return {
              output: { dryRun: true, filesWouldCommit: (resolution.body.fileEdits ?? []).length },
              result: { ...baseResult, dryRun: true, fileEdits: resolution.body.fileEdits ?? [], validation: fm },
            };
          }

          const branch = resolution.target.sourceBranch ?? branches.base;

          let committed;
          try {
            committed = await commitResolution({
              projectId: resolution.target.projectId,
              branch,
              edits: resolution.body.fileEdits ?? [],
              message: `Resolve conflict for merge into ${branches.default}`,
            });
          } catch (err) {
            throw new Error(`Sync: failed to commit resolution to branch "${branch}": ${err?.message ?? err}`);
          }

          let recheck = null;
          try {
            recheck = await recheckMergeability({
              projectId: resolution.target.projectId,
              mrIid: resolution.target.mrIid,
            });
          } catch {
            recheck = null;
          }
          return {
            output: { resolutionCommitted: true, filesCommitted: committed.committed, hasConflicts: recheck?.hasConflicts ?? null },
            result: {
              ...baseResult,
              resolutionCommitted: true,
              filesCommitted: committed.committed,
              branch,
              hasConflicts: recheck?.hasConflicts ?? null,
              mrUrl: resolution.target.mrUrl,
              markdown: buildResolutionMarkdown({ plan: resolution.body.plan ?? {}, recheck }),
            },
          };
        }

        // Otherwise post the advisory plan as an MR comment.
        let commentUrl = null;
        if (comment && explain?.plan) {
          if (dry) {
            return {
              output: { dryRun: true, wouldPostComment: true },
              result: { ...baseResult, dryRun: true, commentMarkdown: explain.plan },
            };
          }
          try {
            const note = await postMergeRequestComment({
              id: comment.target.projectId,
              number: comment.target.mrIid,
              body: explain.plan,
            });
            commentUrl = note ? (comment.target.mrUrl ?? '') : null;
          } catch (err) {
            throw new Error(`Sync: failed to post MR comment: ${err?.message ?? err}`);
          }
        }

        return {
          output: { commentPosted: Boolean(commentUrl) },
          result: { ...baseResult, commentPosted: Boolean(commentUrl), commentUrl },
        };
      },
    },
  ],
};

registerAgent(definition);

export default definition;
