import mongoose from 'mongoose';

const webhookDeliverySchema = new mongoose.Schema(
  {
    event: { type: String, required: true },
    projectId: { type: Number },
    branch: { type: String },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    lineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Line', default: null },
    status: {
      type: String,
      enum: ['enqueued', 'skipped', 'error', 'no_user', 'already_active', 'ignored', 'disabled'],
      required: true,
    },
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun', default: null },
    detail: { type: String },
    username: { type: String },
  },
  { timestamps: true }
);

webhookDeliverySchema.index({ createdAt: -1 });
webhookDeliverySchema.index({ productId: 1, createdAt: -1 });

const WebhookDelivery = mongoose.model('WebhookDelivery', webhookDeliverySchema);

export default WebhookDelivery;
