import mongoose from 'mongoose';

/**
 * An operator's triage decision on a harvest candidate. Candidates are recomputed
 * fresh on every Variant Divergence Miner run and never persisted, so a disposition
 * is keyed by a stable candidate `signature` (hash of the generator-owned file set —
 * see `candidateSignature` in tools/variantMiner.js) within a line. This lets a
 * dismiss / manual-harvest / snooze survive a fresh re-scan.
 *
 * A display snapshot (representative product, suggested type, file list) is stored
 * alongside so the UI can render resolved/dismissed items even when no live
 * candidate currently matches the signature.
 */
const harvestDispositionSchema = new mongoose.Schema(
  {
    lineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Line', required: true },
    signature: { type: String, required: true },
    // dismissed | manually-harvested | snoozed
    state: { type: String, required: true },
    reason: { type: String },
    note: { type: String },
    mrUrl: { type: String },
    snoozeUntil: { type: Date },
    // Display snapshot of the candidate at decision time.
    representativeProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    suggestedType: { type: String },
    files: { type: [String], default: [] },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    // The line-scoped `lesson` memory written for a dismiss / manual-harvest, so a
    // restore (deleteDisposition) can remove it too. Null for snoozed / un-captured.
    memoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentMemory' },
  },
  { timestamps: true }
);

harvestDispositionSchema.index({ lineId: 1, signature: 1 }, { unique: true });

const HarvestDisposition = mongoose.model('HarvestDisposition', harvestDispositionSchema);

export default HarvestDisposition;
