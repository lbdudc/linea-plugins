import { Container } from 'typedi';
import MongooseRepository from '../../model/repositories/MongooseRepository.js';
import ChangesetVersion from './ChangesetVersion.js';
import VersionChatMessage from './VersionChatMessage.js';

export default class ChangesetVersionRepository extends MongooseRepository {
  constructor() {
    super(ChangesetVersion);
  }

  async findByLineId(lineId) {
    return await this.model.find({ lineId }).sort({ epoch: 1, minor: 1 }).lean();
  }

  async findByBranch(lineId, branch) {
    return await this.model.findOne({ lineId, branch }).lean();
  }

  /**
   * Compute the next `X.Y` label for a new version on this line.
   *  - When forking from a parent that hasn't merged: keep the parent's epoch, next minor.
   *  - When forking from an already-merged parent: that epoch is closed (merging it is
   *    what closed it), so this fork can't land there either — open a new epoch instead,
   *    same as a fresh root. Keeps the promote/lock rule consistent: it's always epoch
   *    membership, never parentage, that decides whether a version can still be promoted.
   *  - When creating a fresh version with no parent: use the highest active
   *    epoch (or bump epoch if the highest already had a merged version).
   */
  async allocateLabel({ lineId, parentVersionId }) {
    if (parentVersionId) {
      const parent = await this.model.findById(parentVersionId).lean();
      if (!parent) throw new Error(`parent version ${parentVersionId} not found`);
      if (parent.status !== 'merged') {
        const highestInEpoch = await this.model
          .find({ lineId, epoch: parent.epoch })
          .sort({ minor: -1 })
          .limit(1)
          .lean();
        const nextMinor = (highestInEpoch[0]?.minor ?? 0) + 1;
        return { epoch: parent.epoch, minor: nextMinor };
      }
    }

    return this.#allocateNewEpoch(lineId);
  }

  // No parent (or forking off a merged version, which needs a fresh epoch just like
  // a root does) — figuring out the epoch:
  //   * If any version on this line has been merged, we're in a new epoch above the highest merged.
  //   * Otherwise we stay in epoch 0.
  async #allocateNewEpoch(lineId) {
    const latestMerged = await this.model
      .find({ lineId, status: 'merged' })
      .sort({ epoch: -1 })
      .limit(1)
      .lean();
    const epoch = latestMerged.length > 0 ? latestMerged[0].epoch + 1 : 0;
    const highestInEpoch = await this.model
      .find({ lineId, epoch })
      .sort({ minor: -1 })
      .limit(1)
      .lean();
    const minor = (highestInEpoch[0]?.minor ?? 0) + 1;
    return { epoch, minor };
  }

  async chatMessages(versionId) {
    return await VersionChatMessage.find({ versionId }).sort({ createdAt: 1 }).lean();
  }

  async appendChatMessage(versionId, message) {
    const doc = await VersionChatMessage.create({ versionId, ...message });
    return doc.toObject();
  }

  /**
   * Copy every message of `parentVersionId` onto `childVersionId`. Order is
   * preserved (creation order — `find().sort({createdAt: 1})` upstream).
   * We keep the original text and proposalSnapshot; commitSha is dropped since
   * the parent's commits sit on a different branch.
   */
  async cloneChatMessagesFrom(parentVersionId, childVersionId) {
    const parentMessages = await VersionChatMessage.find({ versionId: parentVersionId })
      .sort({ createdAt: 1 })
      .lean();
    if (parentMessages.length === 0) return [];
    const seed = parentMessages.map((m) => ({
      versionId: childVersionId,
      role: m.role,
      text: m.text,
      proposalSnapshot: m.proposalSnapshot,
      commitSha: null,
    }));
    return await VersionChatMessage.insertMany(seed);
  }

  /**
   * True iff any other version in the same epoch (on the same line) has already
   * been merged. Merging one version closes the whole epoch — every other
   * version at that epoch is locked from promotion, regardless of parent. New
   * epochs (X+1) created after the merge are unaffected.
   */
  async hasMergedInEpoch(version) {
    if (!version) return false;
    const query = {
      lineId: version.lineId,
      epoch: version.epoch,
      status: 'merged',
      _id: { $ne: version._id },
    };
    const count = await this.model.countDocuments(query);
    return count > 0;
  }

  async markStatus(versionId, status) {
    return await this.model.findByIdAndUpdate(
      versionId,
      { $set: { status } },
      { new: true }
    ).lean();
  }

  /**
   * All versions descending from `versionId` (excluding the version itself),
   * walked breadth-first so callers can delete leaves before their parents.
   */
  async descendantsOf(versionId) {
    const collected = [];
    const queue = [String(versionId)];
    const guard = new Set([String(versionId)]);
    while (queue.length) {
      const parentId = queue.shift();
      const children = await this.model
        .find({ parentVersionId: parentId })
        .sort({ minor: 1 })
        .lean();
      for (const c of children) {
        const cid = String(c._id);
        if (guard.has(cid)) continue;
        guard.add(cid);
        collected.push(c);
        queue.push(cid);
      }
    }
    return collected;
  }

  async deleteChat(versionId) {
    await VersionChatMessage.deleteMany({ versionId });
  }

  /** Hard-delete the version doc AND its chat log. git branch is the caller's problem. */
  async deleteById(versionId) {
    await this.deleteChat(versionId);
    await this.model.deleteOne({ _id: versionId });
  }
}

Container.set(ChangesetVersionRepository, new ChangesetVersionRepository());
