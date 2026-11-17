import mongoose from 'mongoose';

/**
 * A ChangesetVersion is a named snapshot in the family-evolution tree of a
 * line. Each version owns a git branch (`plan/vX.Y-<slug>`) where its
 * proposed edits live, plus a persistent chat session so the operator can
 * iterate on the FM / platform code with the LLM across page reloads.
 *
 * Version numbering — X.Y:
 *   - X = epoch. Bumped when a version is merged to main. Starts at 0.
 *   - Y = minor. Bumped when a new version is created inside an epoch.
 *
 * Fork semantics (parentVersionId set):
 *   The new branch is created off the parent's branch head at fork time. Later
 *   commits on the parent do NOT leak into the fork — the git host preserves them
 *   independently. Same for the reverse direction.
 *
 * Origin ('llm' | 'harvest' | 'fork' | 'root'):
 *   - 'llm'     — user opened Propose-with-AI on the tree root or fresh main.
 *   - 'fork'    — user clicked "Fork here" on an existing version.
 *   - 'harvest' — auto-created by webhookRouter after a harvest was accepted.
 *   - 'root'    — the implicit root of an epoch (rare; may stay virtual).
 *
 * Status transitions:
 *   draft   → sandbox (user is iterating in the sandbox)
 *   sandbox → testing (plan approved, cascade running)
 *   testing → merged  (deploy succeeded)
 *   *       → archived (soft delete; branch is preserved on the git host)
 */
const changesetVersionSchema = new mongoose.Schema(
  {
    lineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Line', required: true, index: true },

    // Semver-like tree coordinates. Unique per line.
    epoch: { type: Number, required: true, min: 0 },
    minor: { type: Number, required: true, min: 1 },
    label: { type: String, required: true },  // "0.1", "1.3", … pre-computed for convenience.

    // Position in the tree. null → root of its epoch.
    parentVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChangesetVersion', default: null },

    // The git branch this version owns. Never reused across versions.
    branch: { type: String, required: true },

    // The changeset run that executed (or is executing) this version's plan.
    // Null while the user is still iterating in the chat/sandbox.
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun', default: null },

    origin: {
      type: String,
      enum: ['llm', 'harvest', 'fork', 'root'],
      required: true,
    },
    originMeta: {
      forkedFromVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChangesetVersion' },
      harvestRunId:        { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun' },
      intent:              { type: String },  // free-text description of the user's ask
    },

    status: {
      type: String,
      enum: ['draft', 'sandbox', 'testing', 'merged', 'archived'],
      default: 'draft',
      index: true,
    },

    // Compact title shown in the tree. Auto-generated from intent or updated by
    // the user; short enough to render in a sidebar node.
    title: { type: String, default: '' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Unique version label per line — no two "1.3" on the same line.
changesetVersionSchema.index({ lineId: 1, epoch: 1, minor: 1 }, { unique: true });
// Fast tree walk for a line.
changesetVersionSchema.index({ lineId: 1, parentVersionId: 1 });

const ChangesetVersion = mongoose.model('ChangesetVersion', changesetVersionSchema);

export default ChangesetVersion;
