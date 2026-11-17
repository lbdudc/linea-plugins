import mongoose from 'mongoose';

/**
 * A single message inside a version's chat. Messages are the persistent
 * counterpart of the in-memory ChangeSetProposalSession — reload the page and
 * the full conversation is still there.
 *
 * `role`:
 *   - 'user'      — operator typed the message.
 *   - 'assistant' — LLM produced this reply (may include a `proposalSnapshot`
 *                   holding the concrete FM/platform edits proposed).
 *   - 'system'    — internal notice (fork event, harvest import, error).
 *
 * `proposalSnapshot` is a deep copy of the proposal at the moment the message
 * was generated. Kept per-message so scrolling back through history shows what
 * the LLM was actually suggesting at each turn (useful when the user backtracks).
 */
const versionChatMessageSchema = new mongoose.Schema(
  {
    versionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChangesetVersion', required: true, index: true },

    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    text: { type: String, default: '' },

    // Full snapshot at this turn — matches ChangeSetProposalSession's proposal shape.
    // `default: undefined` is required here: Mongoose auto-materializes single
    // nested subdocuments to `{}` for every document that never sets them
    // (user/system messages), and `{}` is truthy — the client's proposal check
    // would otherwise light up for every message, not just ones with a real
    // AI-authored snapshot.
    proposalSnapshot: {
      type: {
        intent:      { type: String },
        newModelUvl: { type: String },
        reasoning:   { type: String },
        fileEdits: [{
          path:       { type: String },
          action:     { type: String, enum: ['create', 'update', 'delete'] },
          newContent: { type: String },
          oldContent: { type: String },
          rationale:  { type: String },
        }],
      },
      default: undefined,
    },

    // Optional the git host commit produced by this message (when the LLM's proposal
    // was committed to the version's branch). Empty until the user promotes the
    // proposal from the chat.
    commitSha: { type: String, default: null },
  },
  { timestamps: true }
);

const VersionChatMessage = mongoose.model('VersionChatMessage', versionChatMessageSchema);

export default VersionChatMessage;
