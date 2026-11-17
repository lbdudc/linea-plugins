import mongoose from 'mongoose';

/**
 * The outcome of running a product's own test suite (via PlaygroundService).
 * Persisted so the Sync Console can show each product's last test result and
 * history — the in-memory playground job registry is ephemeral and lost on
 * restart. One document per finished standalone product-test run.
 */
const testResultSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    lineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Line' },
    version: { type: String },
    features: { type: [String], default: [] },
    passed: { type: Boolean, required: true },
    // null when the run errored before/without producing an exit code.
    exitCode: { type: Number },
    durationMs: { type: Number },
    // 'passed' | 'failed' | 'error' (no test command, crash, cancelled)
    status: { type: String },
    // Tail of the test log for quick triage on the board (full log is not stored).
    logTail: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

testResultSchema.index({ lineId: 1, createdAt: -1 });
testResultSchema.index({ productId: 1, createdAt: -1 });

const TestResult = mongoose.model('TestResult', testResultSchema);

export default TestResult;
