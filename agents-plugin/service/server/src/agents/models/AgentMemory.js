import mongoose from 'mongoose';

const agentMemorySchema = new mongoose.Schema(
  {
    scope: {
      lineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Line', required: true },
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    },
    agentType: { type: String, required: true },
    kind: { type: String, enum: ['decision', 'fact', 'lesson'], required: true },
    content: { type: String, required: true },
    sourceRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun' },
    // Semantic-recall vector for `content` (HuggingFace TEI). Absent when no embeddings
    // provider is configured; similarity is computed in Node (community Mongo has
    // no $vectorSearch), so no special index is needed here.
    embedding: { type: [Number], default: undefined, select: false },
    embeddingModel: { type: String },
  },
  { timestamps: true }
);

agentMemorySchema.index({ 'scope.lineId': 1, 'scope.productId': 1, createdAt: -1 });

const AgentMemory = mongoose.model('AgentMemory', agentMemorySchema);

export default AgentMemory;
