<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

import agentApi from '../api/agentApi.js';
import { scope } from '../stores/scope.js';
import EsqueletoLista from '../components/common/EsqueletoLista.vue';
import { agentRunStore } from '../stores/agentRunStore.js';
import { connect as conectarSocket } from '../boot/ws.js';

import { deriveFlow } from '../components/flow/flowModel.js';
import { agentTitle } from '../components/activity/agentTitles.js';
import { relativeAge } from '../components/activity/format.js';
import { runBucket, runStatusLabel, runStatusStyle } from '../components/activity/runStatus.js';

const router = useRouter();
const { t } = useI18n();

const versions = ref([]);
const dispositions = ref([]);
const cargando = ref(false);
const error = ref('');

const runs = computed(() => agentRunStore.runs);

const flujo = computed(() =>
  deriveFlow({
    runs: runs.value,
    versions: versions.value,
    dispositions: dispositions.value,
    lineId: scope.lineId,
  }),
);

const etapas = computed(() => {
  const { divergence: d, intoSpl: s, propagation: p } = flujo.value;
  return [
    {
      id: 'divergencia',
      n: '1',
      titulo: t('labels.flow_stage_divergence'),
      cifra: d.candidates,
      pie: d.candidates === 1 ? t('labels.flow_open_candidate_one') : t('labels.flow_open_candidate_other'),
      activo: d.minerScanning,
      detalle: [
        { etiqueta: t('labels.flow_detail_corroborated'), valor: d.corroborated },
        { etiqueta: t('labels.flow_detail_products_drifted'), valor: d.productsDrifted },
      ],
    },
    {
      id: 'consolidacion',
      n: '2',
      titulo: t('labels.flow_stage_into_spl'),
      cifra: s.harvestAwaiting,
      pie: s.harvestAwaiting === 1 ? t('labels.flow_awaiting_approval_one') : t('labels.flow_awaiting_approval_other'),
      activo: s.harvestOpen > 0,
      detalle: [
        { etiqueta: t('labels.flow_detail_harvests_open'), valor: s.harvestOpen },
        { etiqueta: t('labels.flow_detail_versions_open'), valor: s.versionsOpen },
      ],
    },
    {
      id: 'propagacion',
      n: '3',
      titulo: t('labels.flow_stage_propagation'),
      cifra: p.stats.migrate + p.stats.regen,
      pie: t('labels.flow_products_pending'),
      activo: Boolean(p.activeRun),
      detalle: [
        { etiqueta: t('labels.flow_detail_migrate'), valor: p.stats.migrate },
        { etiqueta: t('labels.flow_detail_regen'), valor: p.stats.regen },
        { etiqueta: t('labels.flow_detail_likely_conflict'), valor: p.stats.likelyConflict },
      ],
    },
  ];
});

const enVivo = computed(() => runs.value.filter((r) => runBucket(r) === 'run').slice(0, 6));
const esperando = computed(() => runs.value.filter((r) => r.status === 'awaiting_approval').slice(0, 6));

function irAActividad(runId) {
  router.push({ name: 'actividad', query: { run: runId } });
}

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    const [lista, vs, ds] = await Promise.all([
      agentApi.listRuns({ lineId: scope.lineId, productId: scope.productId }),
      scope.lineId ? agentApi.listVersions(scope.lineId).catch(() => []) : Promise.resolve([]),
      scope.lineId ? agentApi.listDispositions({ lineId: scope.lineId }).catch(() => []) : Promise.resolve([]),
    ]);
    agentRunStore.setAll(lista);
    versions.value = vs ?? [];
    dispositions.value = ds ?? [];
  } catch (e) {
    error.value = e?.response?.data?.message ?? t('labels.flow_load_error');
  } finally {
    cargando.value = false;
  }
}

function alPaso({ runId, status, step }) {
  agentRunStore.mergeStep(runId, status, step);
}
function alRun({ run }) {
  agentRunStore.upsert(run);
}
function alPropuesta({ runId, proposal }) {
  agentRunStore.mergeProposal(runId, proposal);
}

onMounted(() => {
  cargar();
  conectarSocket().on('agent-step', alPaso);
  conectarSocket().on('agent-run', alRun);
  conectarSocket().on('agent-proposal', alPropuesta);
});

onBeforeUnmount(() => {
  conectarSocket().off('agent-step', alPaso);
  conectarSocket().off('agent-run', alRun);
  conectarSocket().off('agent-proposal', alPropuesta);
});

watch(() => [scope.lineId, scope.productId], cargar);
</script>

<template>
  <section class="flujo">
    <header class="flujo__cab">
      <p class="rotulo">{{ t('labels.section_pipelines') }}</p>
      <h1 class="cifra flujo__titulo">{{ t('labels.tab_flow') }}</h1>
      <p v-if="!scope.lineId" class="flujo__aviso">
        <i class="pi pi-info-circle" aria-hidden="true"></i>
        {{ t('labels.flow_pick_line') }}
      </p>
    </header>

    <ol class="etapas">
      <template v-for="(e, i) in etapas" :key="e.id">
        <li class="etapa" :class="{ 'etapa--activa': e.activo }">
          <p class="etapa__n rotulo">{{ e.n }} · {{ e.titulo }}</p>
          <p class="etapa__cifra cifra">{{ e.cifra }}</p>
          <p class="etapa__pie">{{ e.pie }}</p>
          <dl class="etapa__detalle">
            <template v-for="d in e.detalle" :key="d.etiqueta">
              <dt>{{ d.etiqueta }}</dt>
              <dd>{{ d.valor }}</dd>
            </template>
          </dl>
          <p v-if="e.activo" class="etapa__vivo">
            <span class="etapa__pulso" aria-hidden="true"></span> {{ t('labels.flow_stage_live') }}
          </p>
        </li>
        <li v-if="i < etapas.length - 1" class="flecha" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M4 10h11m0 0-4-4m4 4-4 4"
              style="stroke: var(--p-text-faint-color)"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </li>
      </template>
    </ol>

    <div class="paneles">
      <section class="panel">
        <p class="rotulo">{{ t('labels.ops_fleet_title') }}</p>
        <EsqueletoLista v-if="cargando" :filas="3" />
        <p v-else-if="!enVivo.length" class="vacio">{{ t('labels.flow_panel_nothing_running') }}</p>
        <ul v-else class="panel__items">
          <li v-for="r in enVivo" :key="r._id">
            <button type="button" class="item" @click="irAActividad(r._id)">
              <span class="item__punto" :style="{ background: runStatusStyle(r).dot }" aria-hidden="true"></span>
              <span class="item__texto">
                <span class="item__titulo">{{ agentTitle(r.agentType) }}</span>
                <span class="item__meta ident">{{ r.scope?.productName ?? r.scope?.lineName ?? '—' }}</span>
              </span>
              <span class="item__estado" :style="{ color: runStatusStyle(r).fg }">{{ runStatusLabel(r) }}</span>
            </button>
          </li>
        </ul>
      </section>

      <section class="panel">
        <p class="rotulo">{{ t('labels.flow_panel_awaiting_approval') }}</p>
        <EsqueletoLista v-if="cargando" :filas="2" />
        <p v-else-if="!esperando.length" class="vacio">{{ t('labels.flow_panel_nothing_pending') }}</p>
        <ul v-else class="panel__items">
          <li v-for="r in esperando" :key="r._id">
            <button type="button" class="item item--espera" @click="irAActividad(r._id)">
              <i class="pi pi-clock item__icono" aria-hidden="true"></i>
              <span class="item__texto">
                <span class="item__titulo">{{ agentTitle(r.agentType) }}</span>
                <span class="item__meta ident">{{ r.scope?.productName ?? r.scope?.lineName ?? '—' }}</span>
              </span>
              <span class="item__edad">{{ relativeAge(r.createdAt) }}</span>
            </button>
          </li>
        </ul>
      </section>
    </div>

    <p v-if="error" class="error" role="alert">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ error }}
    </p>
  </section>
</template>

<style scoped>
.flujo {
  padding: 24px 32px 40px;
}

.flujo__titulo {
  font-size: 32px;
  margin: 2px 0 0;
}

.flujo__aviso {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 0;
  padding: 9px 12px;
  font-size: 12px;
  color: var(--p-text-secondary-color);
  background: var(--p-highlight-soft);
  border: 1px solid var(--p-content-border-color);
  border-radius: 5px;
}

.etapas {
  display: flex;
  align-items: stretch;
  gap: 10px;
  list-style: none;
  margin: 24px 0 0;
  padding: 0;
}

.etapa {
  flex: 1;
  min-width: 0;
  padding: 16px 18px 18px;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
}

.etapa--activa {
  border-color: var(--p-agent-color);
  background: var(--p-agent-highlight-soft);
}

.etapa__cifra {
  font-size: 30px;
  margin: 10px 0 0;
  color: var(--p-text-color);
}

.etapa__pie {
  font-size: 11px;
  color: var(--p-text-muted-color);
  margin: 2px 0 0;
}

.etapa__detalle {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 3px 10px;
  margin: 14px 0 0;
  padding: 12px 0 0;
  border-top: 1px solid var(--p-content-border-color);
  font-size: 12px;
}

.etapa__detalle dt {
  color: var(--p-text-muted-color);
}

.etapa__detalle dd {
  margin: 0;
  text-align: right;
  color: var(--p-text-color);
}

.etapa__vivo {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 0 0;
  font-size: 11px;
  color: var(--p-agent-color);
}

.etapa__pulso {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--p-agent-color);
  animation: latido 1.6s ease-in-out infinite;
}

@keyframes latido {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

@media (prefers-reduced-motion: reduce) {
  .etapa__pulso { animation: none; }
}

.flecha {
  display: flex;
  align-items: center;
  flex: none;
}

.paneles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 26px;
}

.panel {
  padding: 14px 16px 8px;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
}

.panel__items {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 6px;
  border: 0;
  border-top: 1px solid var(--p-content-border-color);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.item:hover {
  background: var(--hover-veil);
}

.item__punto {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

.item__icono {
  font-size: 12px;
  color: var(--status-warn);
  flex: none;
}

.item__texto {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.item__titulo {
  font-size: 13px;
  color: var(--p-text-color);
}

.item__meta {
  font-size: 11px;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item__estado,
.item__edad {
  font-size: 11px;
  flex: none;
}

.item__edad {
  color: var(--p-text-dim-color);
}

.vacio {
  padding: 14px 6px 18px;
  font-size: 12px;
  color: var(--p-text-dim-color);
}

.error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 20px 0 0;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--status-bad);
  background: var(--status-bad-soft);
  border: 1px solid var(--status-bad-border);
  border-radius: 5px;
}
</style>
