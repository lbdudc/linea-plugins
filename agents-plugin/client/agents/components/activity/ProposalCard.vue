<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Tag from 'primevue/tag';
import ApprovalActions from './ApprovalActions.vue';
import { pauseReasonMeta } from './proposalSummary.js';

const props = defineProps({
  proposal: { type: Object, required: true },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['approve', 'reject']);
const { t } = useI18n();

const body = computed(() => props.proposal.body ?? {});
const pause = computed(() => pauseReasonMeta(props.proposal.pauseReason));

const radiusLabel = computed(() => (props.proposal.blastRadius === 'line' ? t('labels.proposal_radius_line') : t('labels.proposal_radius_product')));
const radiusSerious = computed(() => props.proposal.blastRadius === 'line');

const cascadeReason = (c) => {
  if (c.action === 'skip') return t('labels.cascade_reason_skip');
  const base = c.action === 'migrate' ? t('labels.cascade_reason_migrate') : c.action === 'regen' ? t('labels.cascade_reason_regen') : t('labels.cascade_reason_pending');
  const flags = [];
  if (c.isCritical) flags.push(t('labels.cascade_flag_critical'));
  if (c.likely_conflict) flags.push(t('labels.cascade_flag_conflict'));
  return flags.length ? `${base} · ${flags.join(', ')}` : base;
};

const products = computed(() => {
  if (Array.isArray(body.value.products) && body.value.products.length) {
    return body.value.products.map((p) => ({
      name: p.name,
      version: p.version ?? null,
      reason: p.reason || t('labels.proposal_reason_review'),
      attention: true,
    }));
  }
  const cascade = body.value.plan?.cascade ?? [];
  return cascade.map((c) => ({
    name: c.name ?? c.productId,
    version: null,
    reason: cascadeReason(c),
    attention: Boolean(c.likely_conflict || c.isCritical),
  }));
});

const planLines = computed(() => {
  if (typeof body.value.markdown === 'string' && body.value.markdown.trim()) {
    return body.value.markdown.split('\n').map((l) => l.trim()).filter(Boolean);
  }
  const stats = body.value.plan?.stats;
  if (stats) {
    const lines = [];
    if (stats.migrate) lines.push(t('labels.plan_migrate_line', { n: stats.migrate }));
    if (stats.regen) lines.push(t('labels.plan_regen_line', { n: stats.regen }));
    if (stats.likelyConflict) lines.push(t('labels.plan_likely_conflict_line', { n: stats.likelyConflict }));
    if (stats.skip) lines.push(t('labels.plan_skip_line'));
    return lines.length ? lines : [t('labels.plan_no_changes')];
  }
  return [];
});

const title = computed(() => body.value.title || t('labels.proposal_pending_title'));
</script>

<template>
  <div class="propuesta">
    <div class="propuesta__cabecera">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="propuesta__icono" aria-hidden="true">
        <path d="M4 6h16"></path>
        <path d="M4 12h10"></path>
        <path d="M4 18h7"></path>
        <path d="m16 16 2 2 4-4"></path>
      </svg>
      <span class="propuesta__titulo">{{ title }}</span>
      <Tag :value="radiusLabel" class="propuesta__radio" :class="{ 'propuesta__radio--linea': radiusSerious }" />
    </div>

    <p v-if="pause" class="propuesta__pausa" :style="{ color: pause.color }">
      <i :class="pause.icon" aria-hidden="true"></i> {{ pause.label }} — {{ pause.hint }}
    </p>

    <div v-if="products.length" class="propuesta__bloque">
      <span class="rotulo">{{ t('labels.affected_products') }}</span>
      <div class="propuesta__productos">
        <div v-for="(p, i) in products" :key="i" class="propuesta__producto">
          <div class="propuesta__producto-linea">
            <span class="propuesta__producto-nombre">{{ p.name }}</span>
            <span v-if="p.version" class="propuesta__producto-version ident">v{{ p.version }}</span>
          </div>
          <span class="propuesta__producto-motivo" :class="{ 'propuesta__producto-motivo--atencion': p.attention }">{{ p.reason }}</span>
        </div>
      </div>
    </div>

    <div v-if="planLines.length" class="propuesta__bloque">
      <span class="rotulo">{{ t('labels.plan_label') }}</span>
      <div class="propuesta__plan">
        <div v-for="(line, i) in planLines" :key="i" class="propuesta__plan-linea">
          <span class="propuesta__plan-num ident">{{ i + 1 }}.</span>
          <span class="propuesta__plan-texto">{{ line }}</span>
        </div>
      </div>
    </div>

    <a v-if="body.mrUrl" :href="body.mrUrl" target="_blank" rel="noopener noreferrer" class="propuesta__mr">
      <i class="pi pi-external-link" aria-hidden="true"></i> {{ t('labels.view_merge_request') }}
    </a>

    <ApprovalActions
      :decision="proposal.decision"
      :busy="busy"
      @approve="emit('approve')"
      @reject="emit('reject')"
    />
  </div>
</template>

<style scoped>
.propuesta {
  border: 1px solid var(--p-content-border-color);
  border-left: 3px solid var(--status-warn-solid);
  border-radius: 8px;
  background: var(--p-content-background);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.propuesta > * {
  padding: 14px 17px;
  border-bottom: 1px solid var(--p-content-hover-background);
}

.propuesta > *:last-child {
  border-bottom: none;
}

.propuesta__cabecera {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.propuesta__icono {
  color: var(--status-warn-solid);
  flex-shrink: 0;
  margin-top: 1px;
}

.propuesta__titulo {
  font-size: 14px;
  font-weight: 500;
  flex-grow: 1;
  min-width: 0;
}

.propuesta__radio {
  flex-shrink: 0;
  background: transparent;
  border: 1px solid var(--p-text-faint-color);
  color: var(--p-text-muted-color);
  font-size: 10.5px;
  font-weight: 400;
  padding: 2px 8px;
}

.propuesta__radio--linea {
  border-color: var(--status-serious-border);
  color: var(--status-serious);
}

.propuesta__pausa {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.propuesta__bloque {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.propuesta__productos {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.propuesta__producto {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.propuesta__producto-linea {
  display: flex;
  align-items: baseline;
  gap: 9px;
}

.propuesta__producto-nombre {
  font-size: 13px;
  color: var(--p-text-color);
}

.propuesta__producto-version {
  font-size: 11.5px;
  color: var(--p-text-dim-color);
}

.propuesta__producto-motivo {
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.propuesta__producto-motivo--atencion {
  color: var(--status-bad-strong);
}

.propuesta__plan {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.propuesta__plan-linea {
  display: flex;
  gap: 10px;
}

.propuesta__plan-num {
  font-size: 12px;
  color: var(--p-text-dim-color);
  flex-shrink: 0;
}

.propuesta__plan-texto {
  font-size: 12.5px;
  color: var(--p-text-secondary-color);
  line-height: 1.5;
}

.propuesta__mr {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--p-agent-color);
}

.propuesta__mr:hover {
  color: var(--p-agent-hover-color);
}
</style>
