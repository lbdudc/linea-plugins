/**
 * Socket.IO emit helpers for the agent subsystem.
 *
 * Runs execute detached from any HTTP request, so the runner can't reach `io`
 * through `req.app.get('io')` the way the existing controllers do. Instead
 * `initAgents({ io })` (called once from server/index.js) hands us the instance
 * here, and we emit to the per-user room the client already joins on `auth`
 * (see server/src/ws/socketManager.js — `socket.join(user.userId)`).
 *
 * Agents has no socket server any more: `io` is `linea/relay.js`, which passes each event on to LINEA, and LINEA puts it on the socket
 * of that person.
 */

let io = null;

export const setIo = (ioInstance) => {
  io = ioInstance;
};

const roomFor = (run) => (run?.createdBy ? String(run.createdBy) : null);

const serializeRun = (run) => {
  const obj = typeof run.toObject === 'function' ? run.toObject() : run;
  return {
    _id: String(obj._id),
    agentType: obj.agentType,
    scope: obj.scope,
    status: obj.status,
    trigger: obj.trigger,
    input: obj.input,
    steps: obj.steps,
    proposals: obj.proposals,
    result: obj.result,
    error: obj.error,
    parentRunId: obj.parentRunId ? String(obj.parentRunId) : null,
    supersededByRunId: obj.supersededByRunId ? String(obj.supersededByRunId) : null,
    createdBy: obj.createdBy ? String(obj.createdBy) : null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
};

const emit = (run, event, payload) => {
  const room = roomFor(run);
  if (!io || !room) return;
  io.to(room).emit(event, { ...payload, at: new Date() });
};

// Full run state changed (status transition, created, finished).
export const emitRun = (run) => emit(run, 'agent-run', { run: serializeRun(run) });

// A single step was appended or updated — the timeline tick.
export const emitStep = (run, step) => {
  const s = typeof step.toObject === 'function' ? step.toObject() : step;
  emit(run, 'agent-step', { runId: String(run._id), status: run.status, step: s });
};

// A new proposal needs a human decision.
export const emitProposal = (run, proposal) =>
  emit(run, 'agent-proposal', {
    runId: String(run._id),
    proposal: typeof proposal.toObject === 'function' ? proposal.toObject() : proposal,
  });

// Emit directly to a user room (used by playground jobs which run outside an agent run).
export const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return;
  io.to(String(userId)).emit(event, { ...payload, at: new Date() });
};

/**
 * Version tree change (created / updated / archived / merged). We push to the
 * creator so their sidebar refreshes without a poll. All-user broadcast could
 * come later if we introduce shared workspaces.
 */
export const emitVersion = (version, event = 'version-updated') => {
  if (!io || !version?.createdBy) return;
  const room = String(version.createdBy);
  const payload = {
    versionId: String(version._id),
    lineId:    String(version.lineId),
    version:   typeof version.toObject === 'function' ? version.toObject() : version,
    at:        new Date(),
  };
  io.to(room).emit(event, payload);
};
