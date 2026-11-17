import mongoose from 'mongoose';

/**
 * A persistent conversation between a developer and an agent, keyed by
 * (agentType, scope, user). Gives the chat-style agents memory across sessions.
 * Messages live in AgentMessage, linked by threadId.
 *
 * Used from Phase 4 (Knowledge agent / re-homed configure flow). Defined now so
 * the data model is stable from the start.
 */
const agentThreadSchema = new mongoose.Schema(
  {
    agentType: { type: String, required: true },
    scope: {
      lineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Line' },
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String },
  },
  { timestamps: true }
);

const AgentThread = mongoose.model('AgentThread', agentThreadSchema);

export default AgentThread;
