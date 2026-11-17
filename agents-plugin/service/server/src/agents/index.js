import { Container } from 'typedi';
import { setIo } from './core/events.js';
import AgentRunner from './core/AgentRunner.js';
import { wireDomainSubscribers } from './triggers/domainSubscriber.js';
import { startScheduler } from './triggers/scheduler.js';
import { runReconcileSweep, startReconcileSweep } from './triggers/reconcileSync.js';
import './definitions/index.js'; // side-effect: registers all agents

export { default as agentRouter } from './rest/agentRouter.js';

/**
 * The single wiring seam between the LINEA server and the agent subsystem.
 * Called once from server/index.js after the DB connects: hands Socket.IO to the
 * event layer, subscribes to model-layer domain events, and runs the boot
 * recovery sweep (re-enqueue runs left mid-flight).
 */
export const initAgents = async ({ io }) => {
  setIo(io);
  wireDomainSubscribers();
  startScheduler();
  await Container.get(AgentRunner).recover();
  // Backstop: catch conflicts whose sync enqueue was lost across the restart we just
  // recovered from, then keep sweeping on the configured interval.
  await runReconcileSweep();
  startReconcileSweep();
  console.log('[agents] initialized');
};
