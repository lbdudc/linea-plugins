/**
 * Importing this module registers every agent with the AgentRegistry (each
 * definition calls `registerAgent` on import). `initAgents` imports it once at
 * boot so the registry is populated before any run is enqueued.
 */
import './lineHealthAgent.js';
import './syncAgent.js';
import './regenAgent.js';
import './lineSyncAgent.js';
import './harvestAgent.js';
import './evolutionAgent.js';
import './featureLocationAgent.js';
import './fmConstraintAdvisorAgent.js';
import './variantMinerAgent.js';
import './changesetAgent.js';
