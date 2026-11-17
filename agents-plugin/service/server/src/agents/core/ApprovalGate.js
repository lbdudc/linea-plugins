import { Container } from 'typedi';
import AgentPolicyRepository from '../models/AgentPolicyRepository.js';
import { normMode } from '../models/AgentPolicy.js';

/**
 * Decides whether a proposed write may be auto-applied or must wait for a human.
 *
 * Three autonomy modes (manual | semi | automatic) replace the old two-state policy.
 * The default is `semi` — the safest middle ground.
 *
 * Decision matrix
 * ─────────────────────────────────────────────────────────────────────────────
 * Gate                              manual   semi         automatic
 * Irreversible (plan_approval,
 *   deploy_approval, blastRadius=line) require  require      auto
 * Unambiguous reversible            require  auto         auto
 * Ambiguous reversible              require  require      auto
 * (critical product with no
 *   explicit run override)          require  require      require
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Priority: run.autonomyMode (stamped from plan_approval decisionMeta or spawnChild)
 *           → saved AgentPolicy.modes[agentType] (normalised to new vocabulary)
 *           → POLICY_DEFAULTS → 'semi'
 *
 * Critical products: when `run.autonomyMode` is null (no explicit override),
 * `criticality === 'critical'` in the policy forces mode to 'manual' regardless
 * of the saved mode — matching the plan decision "criticality seeds a manual default,
 * explicit override wins."
 *
 * Irreversible kinds: plan_approval (merges plan branch → main) and
 * deploy_approval (triggers pre-prod pipelines). Both require human unless
 * mode === 'automatic'.
 *
 * pause reasons (stable codes surfaced in the Inbox "why" chip):
 *   blast_radius — an irreversible write (plan_approval / deploy_approval / line blast)
 *   critical     — the product is critical and no explicit override set
 *   ambiguous    — semi mode, proposal not deterministically safe
 *   mode         — manual mode
 */

const IRREVERSIBLE_KINDS = new Set(['plan_approval', 'deploy_approval']);

export default class ApprovalGate {
  agentPolicyRepository = Container.get(AgentPolicyRepository);

  // Returns { outcome: 'auto' | 'require', reason }.
  decide = async ({ run, proposal }) => {
    if (!proposal) return { outcome: 'require', reason: 'ambiguous' };

    // ── Resolve effective mode ─────────────────────────────────────────────────
    // An explicit run-level stamp always wins (set from plan_approval decisionMeta
    // or passed by spawnChild when the cascade fans out autonomy to children).
    let mode = run.autonomyMode ? normMode(run.autonomyMode) : null;
    let criticalDefault = false;

    if (!mode) {
      // Fall back to saved policy.
      const { criticality, modes } = await this.agentPolicyRepository.resolveEffective({
        lineId:    run.scope?.lineId    ? String(run.scope.lineId)    : null,
        productId: run.scope?.productId ? String(run.scope.productId) : null,
      });

      // Criticality seeds 'manual' when there is no explicit override.
      if (criticality === 'critical') {
        criticalDefault = true;
        mode = 'manual';
      } else {
        mode = normMode(modes?.[run.agentType] ?? 'semi');
      }
    }

    // ── Irreversible gate ──────────────────────────────────────────────────────
    const isIrreversible =
      IRREVERSIBLE_KINDS.has(proposal.kind) || proposal.blastRadius === 'line';

    if (isIrreversible) {
      return mode === 'automatic'
        ? { outcome: 'auto',    reason: null }
        : { outcome: 'require', reason: 'blast_radius' };
    }

    // ── Reversible gates ───────────────────────────────────────────────────────
    if (criticalDefault) return { outcome: 'require', reason: 'critical' };

    if (mode === 'manual') return { outcome: 'require', reason: 'mode' };

    if (mode === 'semi') {
      return proposal.unambiguous === true
        ? { outcome: 'auto',    reason: null }
        : { outcome: 'require', reason: 'ambiguous' };
    }

    // automatic — always auto for reversible gates
    return { outcome: 'auto', reason: null };
  };
}

Container.set(ApprovalGate, new ApprovalGate());
