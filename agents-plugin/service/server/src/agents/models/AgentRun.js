import mongoose from 'mongoose';

/**
 * A single step in a run's timeline. This is what the UI renders as the agent
 * "acts" — one entry per deterministic call, LLM turn, git action or approval.
 */
const stepSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // deterministic | llm | git | approval
    kind: { type: String, required: true },
    // pending | running | done | failed | skipped
    status: { type: String, default: 'pending' },
    inputSummary: { type: String },
    outputSummary: { type: mongoose.Schema.Types.Mixed },
    // Durable tool-loop checkpoint for multi-turn llm steps:
    //   { convo, turn, turns:[{ index, toolCalls:[{name,input,status,durationMs}], text }] }
    // `convo` is the resumable Anthropic message array; `turns` is the UI-facing
    // transcript streamed to the timeline. Absent on non-loop steps.
    loop: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },
    startedAt: { type: Date },
    endedAt: { type: Date },
    durationMs: { type: Number },
  },
  { _id: true }
);

/**
 * A proposed write the agent wants to perform. Held here while the run is paused
 * at an approval gate; the decide endpoint flips `decision` and resumes the run.
 */
const proposalSchema = new mongoose.Schema(
  {
    // git_comment | merge_resolution | spec_patch | fm_patch | platform_patch
    kind: { type: String, required: true },
    // Name of the run step that produced this proposal (stepDef.name) — lets
    // rerunStep find and drop exactly the proposals a rewound step re-creates.
    stepName: { type: String },
    target: { type: mongoose.Schema.Types.Mixed },
    body: { type: mongoose.Schema.Types.Mixed },
    // product | line — caps autonomy (line writes are never auto-applied)
    blastRadius: { type: String, default: 'product' },
    // Why the approval gate paused for a human: blast_radius | critical | ambiguous | mode.
    // Null/absent when the proposal auto-applied. Surfaced as the Inbox "why" chip.
    pauseReason: { type: String },
    // approved | rejected | auto
    decision: { type: String },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
  },
  { _id: true }
);

const agentRunSchema = new mongoose.Schema(
  {
    agentType: { type: String, required: true },
    scope: {
      lineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Line' },
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    },
    trigger: {
      // manual | git_push | scheduled | parent_run
      kind: { type: String, default: 'manual' },
      payload: { type: mongoose.Schema.Types.Mixed },
    },
    // queued | running | awaiting_approval | awaiting_child | awaiting_external | done | failed | cancelled
    // awaiting_external: paused waiting for an external async process (e.g. a CI pipeline);
    // the step returns { awaitExternal: true } and a poller re-enqueues the run when the process finishes.
    status: { type: String, default: 'queued' },
    input: { type: mongoose.Schema.Types.Mixed, default: {} },
    steps: { type: [stepSchema], default: [] },
    proposals: { type: [proposalSchema], default: [] },
    result: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },
    // cursor into the agent definition's step list, for resume after a pause
    cursor: { type: Number, default: 0 },
    // Explicit autonomy override for this run: manual | semi | automatic.
    // When set (stamped from plan_approval decisionMeta or passed from spawnChild),
    // the ApprovalGate uses this instead of the saved AgentPolicy mode.
    autonomyMode: { type: String, default: null },
    threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentThread' },
    parentRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun' },
    // Set on a source run when it is folded into a merged harvest run (status →
    // 'superseded'). Cleared on split, when the source is restored to review.
    supersededByRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const AgentRun = mongoose.model('AgentRun', agentRunSchema);

export default AgentRun;
