import { Container } from 'typedi';
import ChangesetVersionRepository from '../models/ChangesetVersionRepository.js';
import ChangesetVersion from '../models/ChangesetVersion.js';
import { lineAccess } from '../tools/git.js';
import { createBranch as createBranchRest, isBranchAlreadyExistsError } from '../../linea/repo.js';
import AgentRunner from '../core/AgentRunner.js';
import { emitVersion } from '../core/events.js';

/**
 * Domain service for the version tree of a Consolidation line.
 *
 * A version owns a git branch (`plan/vX.Y-<slug>`) and a persistent chat
 * with the LLM. Creating a version can happen four ways:
 *
 *   1. `createRootVersion({ lineId, intent })`           — brand new epoch
 *   2. `createForkFrom({ lineId, parentVersionId, intent })` — fork of another
 *   3. `createFromHarvest({ lineId, harvestBranch, harvestRunId })` — auto
 *   4. root-inferred: implicit when nothing exists yet on the line
 *
 * The branching semantics are "git-native": each version's branch is created
 * from a specific parent ref at the moment the version is created. Later
 * commits on the parent branch do NOT propagate to the child (and vice versa).
 */
export default class ChangesetVersionService {
  static get() {
    if (!Container.has(ChangesetVersionService)) {
      Container.set(ChangesetVersionService, new ChangesetVersionService());
    }
    return Container.get(ChangesetVersionService);
  }

  get repo() {
    return Container.get(ChangesetVersionRepository);
  }

  #slugify(intent) {
    return String(intent ?? 'change')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'change';
  }

  async #createBranchFrom({ lineId, userId, newBranch, sourceBranch }) {
    const { lineProjectId } = await lineAccess({ lineId, userId});
    try {
      await createBranchRest({ id: lineProjectId, userId, branch: newBranch, ref: sourceBranch });
      return { lineProjectId, sourceBranch };
    } catch (err) {
      if (isBranchAlreadyExistsError(err)) {
        // Branch already exists — safe to continue.
        return { lineProjectId, sourceBranch };
      }
      const status = err?.response?.status ?? err?.status ?? 0;
      const looksLikeBadRef = status === 400 || status === 404;
      // The source branch probably doesn't exist anymore — a common case for
      // forks off a merged version, since a git host typically deletes the source
      // branch after an MR merge. Fall back to `main` so the fork still lands
      // on top of the code that already includes the parent's changes.
      if (looksLikeBadRef && sourceBranch !== 'main') {
        try {
          await createBranchRest({ id: lineProjectId, userId, branch: newBranch, ref: 'main' });
          return { lineProjectId, sourceBranch: 'main' };
        } catch (fallbackErr) {
          if (isBranchAlreadyExistsError(fallbackErr)) {
            return { lineProjectId, sourceBranch: 'main' };
          }
          throw fallbackErr;
        }
      }
      throw err;
    }
  }

  /**
   * Create a version at the root of a new epoch. When `existingBranch` is
   * provided (Propose-with-AI just committed its proposal to a plan/ branch,
   * for instance) the version reuses that branch instead of cutting a fresh
   * one from main.
   */
  async createRootVersion({ lineId, userId, intent, origin = 'llm', existingBranch = null }) {
    const { epoch, minor } = await this.repo.allocateLabel({ lineId, parentVersionId: null });
    const label = `${epoch}.${minor}`;
    const branch = existingBranch ?? `plan/v${label}-${this.#slugify(intent)}-${Date.now()}`;

    if (!existingBranch) {
      await this.#createBranchFrom({ lineId, userId, newBranch: branch, sourceBranch: 'main' });
    }

    const created = await this.repo.save(new ChangesetVersion({
      lineId, epoch, minor, label,
      parentVersionId: null,
      branch,
      origin,
      originMeta: { intent: intent ?? '' },
      status: 'draft',
      title: intent ?? `Version ${label}`,
      createdBy: userId,
    }));
    this.#announce(created, 'version-created');
    return created;
  }

  /**
   * Fork from an existing version. The new branch is cut off the parent's
   * current HEAD, so any later commits on the parent do NOT leak in.
   */
  async createForkFrom({ lineId, userId, parentVersionId, intent }) {
    const parent = await this.repo.findById(parentVersionId);
    if (!parent) throw new Error(`parent version ${parentVersionId} not found`);
    if (String(parent.lineId) !== String(lineId)) {
      throw new Error('parent version belongs to a different line');
    }
    const { epoch, minor } = await this.repo.allocateLabel({ lineId, parentVersionId });
    const label = `${epoch}.${minor}`;
    const branch = `plan/v${label}-${this.#slugify(intent)}-${Date.now()}`;

    await this.#createBranchFrom({ lineId, userId, newBranch: branch, sourceBranch: parent.branch });

    const created = await this.repo.save(new ChangesetVersion({
      lineId, epoch, minor, label,
      parentVersionId,
      branch,
      origin: 'fork',
      originMeta: { forkedFromVersionId: parentVersionId, intent: intent ?? '' },
      status: 'draft',
      title: intent ?? `Fork of ${parent.label}`,
      createdBy: userId,
    }));

    // Inherit the conversation from the parent so the LLM has full context on
    // the first user message here, and the operator can scroll through what
    // led to this fork. Non-blocking on failure — the fork still succeeds.
    try {
      await this.repo.cloneChatMessagesFrom(parent._id, created._id);
      await this.repo.appendChatMessage(created._id, {
        role: 'system',
        text: `Forked from v${parent.label}. The chat above was inherited; new messages iterate on this version's plan/ branch.`,
      });
    } catch (err) {
      console.warn('[version:fork] clone chat failed:', err?.message ?? err);
    }

    this.#announce(created, 'version-created');
    return created;
  }

  /**
   * A harvest has just merged its own plan/ branch. Register a version for it
   * so it appears in the tree; the operator can then keep iterating on top of
   * it from the chat.
   *
   * Called by `AgentRunner.#triggerHarvestChangeSet` after harvest completes.
   */
  async createFromHarvest({ lineId, userId, harvestBranch, harvestRunId, featureName }) {
    const { epoch, minor } = await this.repo.allocateLabel({ lineId, parentVersionId: null });
    const label = `${epoch}.${minor}`;
    const branch = harvestBranch;  // harvest already created and populated this branch

    const created = await this.repo.save(new ChangesetVersion({
      lineId, epoch, minor, label,
      parentVersionId: null,
      branch,
      origin: 'harvest',
      originMeta: { harvestRunId, intent: featureName ? `Harvested: ${featureName}` : 'Harvested change' },
      status: 'draft',
      title: featureName ? `Harvest: ${featureName}` : `Harvest version ${label}`,
      createdBy: userId,
    }));
    this.#announce(created, 'version-created');
    return created;
  }

  /**
   * List every version on this line as a flat array. The client folds it into a
   * tree using `parentVersionId`.
   */
  async listByLine(lineId) {
    return await this.repo.findByLineId(lineId);
  }

  async get(versionId) {
    return await this.repo.findById(versionId);
  }

  #announce(version, event = 'version-updated') {
    try { emitVersion(version, event); } catch { /* best-effort */ }
  }

  /**
   * Promote a version to a plan/sandbox/test/deploy pipeline. Creates the
   * changeset AgentRun pointing at this version's branch and stores runId on
   * the version so the client can hop from the tree straight into the run.
   *
   * If the version already has a run (re-promotion), the previous run is
   * cancelled and a fresh one is enqueued against the current branch state.
   * This lets the operator change their mind after "Promote" — they iterate
   * more in the chat, then hit Promote again to relaunch from the new tip.
   *
   * Refuses when the version is already merged (its epoch closed) or when
   * another version at the same epoch has been merged.
   */
  async promoteToPlan({ versionId, userId }) {
    const version = await this.repo.findById(versionId);
    if (!version) throw new Error('version not found');
    if (version.status === 'merged') throw new Error('version already merged');
    if (await this.repo.hasMergedInEpoch(version)) {
      throw new Error('another version at this epoch has already been merged; the epoch is closed');
    }

    // Re-promotion path: cancel the previous run so we don't leave a stale
    // pipeline running against an older tip of the branch. Best-effort — a
    // cancel failure shouldn't block the new promotion.
    if (version.runId) {
      try {
        await Container.get(AgentRunner).cancel(String(version.runId));
      } catch (err) {
        console.warn(`[version:promote] cancel previous run ${version.runId} failed:`, err?.message ?? err);
      }
    }

    const run = await Container.get(AgentRunner).enqueueNew({
      agentType: 'changeset',
      scope:     { lineId: String(version.lineId) },
      input: {
        origin: version.origin === 'harvest' ? 'harvest-accepted' : 'branch',
        branch: version.branch,
        versionId: String(version._id),
      },
      trigger: { kind: 'version_promote', payload: { versionId: String(version._id) } },
      userId,
    });

    await this.repo.update(versionId, { runId: run._id, status: 'sandbox' });
    const updated = await this.repo.findById(versionId);
    this.#announce(updated, 'version-updated');
    return { version: updated, run };
  }

  /**
   * Called by AgentRunner after a changeset merges its plan branch into main.
   * Marks the version as `merged`. The next version created (root) on this
   * line will start a new epoch above the current one — see
   * `ChangesetVersionRepository.allocateLabel`.
   */
  async markMerged(versionId) {
    const updated = await this.repo.markStatus(versionId, 'merged');
    this.#announce(updated, 'version-updated');
    return updated;
  }

  /**
   * The branch of a deleted version is left in the repository: LINEA gives agents no way to delete branches, and the host (or the
   * merge that closes the version) cleans them up. Never throws.
   */
  async #deleteBranch({ branch }) {
    if (!branch || branch === 'main') return;
    console.info(`[version] the branch ${branch} stays in the repository (agents does not delete branches)`);
  }

  /**
   * Delete a version. When `cascade` is true, every descendant is deleted too
   * (chat + doc + git branch, best-effort). When `cascade` is false and the
   * version has children, we refuse — the operator has to pick cascade or
   * delete the children first.
   *
   * Refuses on merged versions (they closed the epoch — deleting is history
   * rewrite) and on versions actively promoted to a run (would orphan the run).
   */
  async deleteVersion({ versionId, userId, cascade = false }) {
    const version = await this.repo.findById(versionId);
    if (!version) throw new Error('version not found');
    if (version.status === 'merged') throw new Error('cannot delete a merged version');
    if (version.runId) throw new Error('version is promoted to a run; cancel the run first');

    const descendants = await this.repo.descendantsOf(versionId);
    if (descendants.length > 0 && !cascade) {
      throw new Error('version has children; pass cascade=true to delete them too');
    }

    // A protected descendant (merged, or promoted to a run) can't be skipped —
    // deleting an ancestor out from under it would orphan it (dangling
    // parentVersionId), circumventing the very invariant checked above for the
    // top-level version. Refuse the whole cascade instead.
    const protectedDescendant = descendants.find((d) => d.status === 'merged' || d.runId);
    if (protectedDescendant) {
      throw new Error(
        `cannot delete: descendant version ${protectedDescendant._id} is ` +
        `${protectedDescendant.status === 'merged' ? 'merged' : 'promoted to a run'}`
      );
    }

    // Delete leaves first so a partial failure never orphans a subtree.
    for (const d of descendants.reverse()) {
      await this.#deleteBranch({ lineId: String(d.lineId), userId, branch: d.branch });
      await this.repo.deleteById(d._id);
      this.#announce(d, 'version-deleted');
    }
    await this.#deleteBranch({ lineId: String(version.lineId), userId, branch: version.branch });
    await this.repo.deleteById(version._id);
    this.#announce(version, 'version-deleted');

    return { deleted: 1 + descendants.length };
  }

  /**
   * Reset a version. Wipes its chat history and forces its plan/ branch back to
   * the parent's HEAD (or the line's `main` for a root version). When cascade
   * is true, every descendant is deleted too — their branches were cut off a
   * state we're now discarding, so keeping them would leave stale forks.
   *
   * Refuses on merged versions or versions with an active promotion.
   */
  async resetVersion({ versionId, userId, cascade = false }) {
    const version = await this.repo.findById(versionId);
    if (!version) throw new Error('version not found');
    if (version.status === 'merged') throw new Error('cannot reset a merged version');
    if (version.runId) throw new Error('version is promoted to a run; cancel the run first');

    if (cascade) {
      const descendants = await this.repo.descendantsOf(versionId);
      for (const d of descendants.reverse()) {
        if (d.status === 'merged' || d.runId) continue;
        await this.#deleteBranch({ lineId: String(d.lineId), userId, branch: d.branch });
        await this.repo.deleteById(d._id);
        this.#announce(d, 'version-deleted');
      }
    }

    // Determine the ref this version should reset to.
    let sourceBranch = 'main';
    if (version.parentVersionId) {
      const parent = await this.repo.findById(version.parentVersionId);
      if (parent?.branch) sourceBranch = parent.branch;
    }

    // Start again on a new branch from the source (agents cannot delete a branch, and an old one would keep its commits). Chat is
    // wiped so the next LLM turn starts from a clean slate on the parent's state.
    const freshBranch = `${version.branch.replace(/-r[0-9a-z]+$/, '')}-r${Date.now().toString(36)}`;
    await this.#deleteBranch({ lineId: String(version.lineId), userId, branch: version.branch });
    await this.#createBranchFrom({
      lineId: String(version.lineId),
      userId,
      newBranch: freshBranch,
      sourceBranch,
    });
    await this.repo.deleteChat(versionId);

    await this.repo.update(versionId, { status: 'draft', runId: null, branch: freshBranch });
    const fresh = await this.repo.findById(versionId);
    this.#announce(fresh, 'version-updated');
    return fresh;
  }
}
