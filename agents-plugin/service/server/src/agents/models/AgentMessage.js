import mongoose from 'mongoose';

/**
 * One message in an AgentThread. `content` is kept Mixed so it can hold either a
 * plain string or the structured Anthropic content blocks (text / tool_use /
 * tool_result) used by the tool-calling agents.
 */
const agentMessageSchema = new mongoose.Schema(
  {
    threadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AgentThread',
      required: true,
    },
    // user | assistant | tool
    role: { type: String, required: true },
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now },
  }
);

const AgentMessage = mongoose.model('AgentMessage', agentMessageSchema);

export default AgentMessage;
