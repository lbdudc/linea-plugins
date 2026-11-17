<script setup>
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

import Checkbox from 'primevue/checkbox';
import Button from 'primevue/button';

import agentApi from '../api/agentApi.js';
import { scope } from '../stores/scope.js';
import Esqueleto from '../components/common/Esqueleto.vue';
import EsqueletoLista from '../components/common/EsqueletoLista.vue';
import { agentRunStore } from '../stores/agentRunStore.js';
import { connect as conectarSocket } from '../boot/ws.js';

import RunStepsTimeline from '../components/activity/RunStepsTimeline.vue';
import ProposalCard from '../components/activity/ProposalCard.vue';
import DiffPanel from '../components/activity/DiffPanel.vue';
import ErrorPanel from '../components/activity/ErrorPanel.vue';
import RelevantMemories from '../components/activity/RelevantMemories.vue';
import { agentTitle } from '../components/activity/agentTitles.js';
import { relativeAge } from '../components/activity/format.js';
import { FILTRO_BUCKET, runBucket, runStatusLabel, runStatusStyle } from '../components/activity/runStatus.js';
import { isPendingRun, pendingRuns as pendientesDe, staleIds } from '../components/activity/bulkApproval.js';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const FILTROS = computed(() => [
  { id: 'todos', label: t('labels.activity_filter_all') },
  { id: 'activos', label: t('labels.activity_filter_active') },
  { id: 'atencion', label: t('labels.activity_filter_attention') },
  { id: 'fallidos', label: t('labels.activity_filter_failed') },
  { id: 'hechos', label: t('labels.activity_filter_done') },
]);

const filtro = ref('todos');
const seleccionadoId = ref(null);
const detalleCargado = ref(null);
const cargandoLista = ref(false);
const cargandoDetalle = ref(false);
const decidiendo = ref(false);
const reintentando = ref(false);
const error = ref('');

const runs = computed(() => agentRunStore.runs);

const detalle = computed(() => {
  const id = seleccionadoId.value;
  if (!id) return null;
  const enStore = runs.value.find((r) => String(r._id) === String(id));
  if (!enStore) return detalleCargado.value;
  return { ...(detalleCargado.value ?? {}), ...enStore };
});

const runsFiltradas = computed(() => {
  const lista = runs.value;
  if (filtro.value === 'todos') return lista;
  const bucket = FILTRO_BUCKET[filtro.value];
  return lista.filter((r) => runBucket(r) === bucket);
});

const recuento = computed(() => {
  const c = { todos: runs.value.length, activos: 0, atencion: 0, fallidos: 0, hechos: 0 };
  for (const r of runs.value) {
    const b = runBucket(r);
    if (b === 'run') c.activos += 1;
    else if (b === 'wait') c.atencion += 1;
    else if (b === 'fail') c.fallidos += 1;
    else c.hechos += 1;
  }
  return c;
});

const propuestaAbierta = computed(() => {
  const lista = detalle.value?.proposals ?? [];
  return lista.find((p) => !p.decision) ?? lista[0] ?? null;
});

const ficherosDiff = computed(() => {
  const cuerpo = propuestaAbierta.value?.body ?? {};
  if (Array.isArray(cuerpo.files)) return cuerpo.files;
  if (cuerpo.oldContent !== undefined || cuerpo.newContent !== undefined) {
    return [{ path: cuerpo.path ?? 'modelo', oldContent: cuerpo.oldContent, newContent: cuerpo.newContent }];
  }
  return [];
});

const avisoRun = computed(() => {
  const r = detalle.value;
  if (!r) return null;
  if (r.status === 'failed') {
    return { tono: 'fallo', mensaje: r.error ?? t('labels.activity_run_failed_fallback') };
  }
  if (r.status === 'cancelled') {
    return { tono: 'cancelado', mensaje: r.error ?? t('labels.activity_run_cancelled_fallback') };
  }
  return null;
});

const pasoFallido = computed(() => {
  const pasos = detalle.value?.steps ?? [];
  for (let i = pasos.length - 1; i >= 0; i -= 1) {
    if (pasos[i]?.status === 'failed' || pasos[i]?.error) return pasos[i]?.name ?? null;
  }
  return null;
});

function consumirRunIdDeLaQuery(lista) {
  const deseado = typeof route.query.runId === 'string' ? route.query.runId : null;
  if (!deseado) return false;
  if (!lista.some((r) => String(r._id) === deseado)) return false;
  seleccionar(deseado);
  const resto = { ...route.query };
  delete resto.runId;
  router.replace({ query: resto });
  return true;
}

async function cargarLista() {
  cargandoLista.value = true;
  error.value = '';
  try {
    const lista = await agentApi.listRuns({ lineId: scope.lineId, productId: scope.productId });
    agentRunStore.setAll(lista);
    if (!seleccionadoId.value && lista.length && !consumirRunIdDeLaQuery(lista)) seleccionar(lista[0]._id);
  } catch (e) {
    error.value = e?.response?.data?.message ?? t('labels.activity_load_list_error');
  } finally {
    cargandoLista.value = false;
  }
}

let peticionDetalle = 0;

async function seleccionar(id) {
  seleccionadoId.value = id;
  const mia = ++peticionDetalle;
  cargandoDetalle.value = true;
  try {
    const r = await agentApi.getRun(id);
    if (mia !== peticionDetalle) return;
    detalleCargado.value = r;
    error.value = '';
  } catch (e) {
    if (mia !== peticionDetalle) return;
    error.value = e?.response?.data?.message ?? t('labels.activity_load_run_error');
    detalleCargado.value = null;
  } finally {
    if (mia === peticionDetalle) cargandoDetalle.value = false;
  }
}

async function reintentarPaso() {
  const paso = pasoFallido.value;
  if (!paso || reintentando.value) return;
  reintentando.value = true;
  try {
    await agentApi.rerunStep(seleccionadoId.value, paso);
    await seleccionar(seleccionadoId.value);
  } catch (e) {
    error.value = e?.response?.data?.message ?? t('labels.activity_retry_step_error');
  } finally {
    reintentando.value = false;
  }
}

async function decidir(decision) {
  const propuesta = propuestaAbierta.value;
  if (!propuesta || decidiendo.value) return;
  decidiendo.value = true;
  try {
    await agentApi.decide(seleccionadoId.value, { proposalId: propuesta._id, decision });
    await seleccionar(seleccionadoId.value);
  } catch (e) {
    error.value = e?.response?.data?.message ?? t('labels.activity_decision_error');
  } finally {
    decidiendo.value = false;
  }
}

const seleccionLote = reactive(new Set());
const loteEnVuelo = reactive(new Set());
const loteBusy = computed(() => loteEnVuelo.size > 0);
const pendientes = computed(() => pendientesDe(runs.value));
const seleccionPendiente = computed(() => pendientes.value.filter((r) => seleccionLote.has(r._id)));

function alternarSeleccionLote(run) {
  if (seleccionLote.has(run._id)) seleccionLote.delete(run._id);
  else seleccionLote.add(run._id);
}
function limpiarSeleccionLote() {
  seleccionLote.clear();
}

watch(pendientes, (lista) => {
  for (const id of staleIds(seleccionLote, lista)) seleccionLote.delete(id);
  for (const id of staleIds(loteEnVuelo, lista)) loteEnVuelo.delete(id);
});

async function decidirLote(decision) {
  const objetivo = [...seleccionPendiente.value];
  limpiarSeleccionLote();
  await Promise.all(objetivo.map(async (run) => {
    loteEnVuelo.add(run._id);
    try {
      const actualizado = await agentApi.decide(run._id, { decision });
      agentRunStore.upsert(actualizado);
    } catch (e) {
      error.value = e?.response?.data?.message ?? t('labels.activity_decision_error');
    } finally {
      loteEnVuelo.delete(run._id);
    }
  }));
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
  cargarLista();
  conectarSocket().on('agent-step', alPaso);
  conectarSocket().on('agent-run', alRun);
  conectarSocket().on('agent-proposal', alPropuesta);
});

onBeforeUnmount(() => {
  conectarSocket().off('agent-step', alPaso);
  conectarSocket().off('agent-run', alRun);
  conectarSocket().off('agent-proposal', alPropuesta);
});

watch(() => [scope.lineId, scope.productId], cargarLista);
</script>

<template>
  <section class="actividad">
    <header class="actividad__cab">
      <p class="rotulo">{{ t('labels.section_workspace') }}</p>
      <h1 class="cifra actividad__titulo">{{ t('labels.tab_runs') }}</h1>
    </header>

    <div class="actividad__cuerpo">
      <aside class="lista">
        <div class="lista__filtros">
          <button
            v-for="f in FILTROS"
            :key="f.id"
            type="button"
            class="chip"
            :class="{ 'chip--on': filtro === f.id }"
            @click="filtro = f.id"
          >
            {{ f.label }}
            <span class="chip__n">{{ recuento[f.id] }}</span>
          </button>
        </div>

        <div v-if="seleccionPendiente.length" class="lote">
          <i class="pi pi-check-square" aria-hidden="true"></i>
          <span class="lote__label">{{ t('labels.bulk_selected', { n: seleccionPendiente.length }) }}</span>
          <div class="lote__relleno"></div>
          <Button
            size="small"
            :label="t('labels.bulk_approve')"
            class="lote__aprobar"
            :loading="loteBusy"
            @click="decidirLote('approved')"
          />
          <Button
            size="small"
            outlined
            :label="t('labels.bulk_reject')"
            class="lote__rechazar"
            :disabled="loteBusy"
            @click="decidirLote('rejected')"
          />
          <button type="button" class="icon-btn" :title="t('labels.bulk_clear')" @click="limpiarSeleccionLote">
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </div>

        <EsqueletoLista v-if="cargandoLista" :filas="6" />
        <p v-else-if="!runsFiltradas.length" class="vacio">{{ t('labels.no_runs_match_filters') }}</p>

        <ul v-else class="lista__items">
          <li v-for="r in runsFiltradas" :key="r._id" class="fila-envoltorio">
            <span class="fila-envoltorio__check">
              <Checkbox
                v-if="isPendingRun(r)"
                :model-value="seleccionLote.has(r._id)"
                binary
                :aria-label="t('labels.bulk_select_run')"
                @update:model-value="alternarSeleccionLote(r)"
              />
            </span>
            <button
              type="button"
              class="fila"
              :class="{ 'fila--on': String(r._id) === String(seleccionadoId) }"
              @click="seleccionar(r._id)"
            >
              <span class="fila__punto" :style="{ background: runStatusStyle(r).dot }" aria-hidden="true"></span>
              <span class="fila__texto">
                <span class="fila__titulo">{{ agentTitle(r.agentType) }}</span>
                <span class="fila__meta">
                  <span class="ident">{{ r.scope?.productName ?? r.scope?.lineName ?? '—' }}</span>
                  <span class="fila__sep">·</span>
                  {{ relativeAge(r.createdAt) }}
                </span>
              </span>
              <span class="fila__estado" :style="{ color: runStatusStyle(r).fg }">
                {{ runStatusLabel(r) }}
              </span>
            </button>
          </li>
        </ul>
      </aside>

      <main class="detalle">
        <div v-if="!detalle && cargandoDetalle" class="detalle__esqueleto">
          <Esqueleto ancho="180px" alto="18px" radio="5px" />
          <Esqueleto ancho="120px" alto="9px" />
          <EsqueletoLista :filas="4" />
        </div>
        <p v-else-if="!detalle" class="vacio">{{ t('labels.activity_pick_run') }}</p>

        <template v-else>
          <div class="detalle__cab">
            <h2 class="detalle__titulo">{{ agentTitle(detalle.agentType) }}</h2>
            <span class="detalle__estado" :style="{ color: runStatusStyle(detalle).fg }">
              {{ runStatusLabel(detalle) }}
            </span>
          </div>
          <p class="detalle__ambito ident">
            {{ detalle.scope?.productName ?? detalle.scope?.lineName ?? '—' }}
          </p>

          <RunStepsTimeline :steps="detalle.steps ?? []" />
        </template>
      </main>

      <aside class="rail">
        <ErrorPanel
          v-if="avisoRun"
          :message="avisoRun.mensaje"
          :cancelled="avisoRun.tono === 'cancelado'"
          :retryable="Boolean(pasoFallido)"
          :busy="reintentando"
          @retry="reintentarPaso"
        />

        <ProposalCard
          v-if="propuestaAbierta"
          :proposal="propuestaAbierta"
          :busy="decidiendo"
          @approve="decidir('approved')"
          @reject="decidir('rejected')"
        />

        <DiffPanel v-if="ficherosDiff.length" :files="ficherosDiff" />

        <RelevantMemories
          v-if="detalle"
          :line-id="detalle.scope?.lineId ?? null"
          :product-id="detalle.scope?.productId ?? null"
          :query="agentTitle(detalle.agentType)"
        />
      </aside>
    </div>

    <p v-if="error" class="error" role="alert">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ error }}
    </p>
  </section>
</template>

<style scoped>
.actividad {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.actividad__cab {
  padding: 24px 32px 16px;
}

.actividad__titulo {
  font-size: 32px;
  margin: 2px 0 0;
}

.actividad__cuerpo {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr) 360px;
  gap: 1px;
  flex: 1;
  min-height: 0;
  background: var(--p-content-border-color);
  border-top: 1px solid var(--p-content-border-color);
}

.lista,
.detalle,
.rail {
  background: var(--p-surface-ground);
  overflow-y: auto;
  min-height: 0;
}

.lista__filtros {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font: inherit;
  font-size: 11px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 5px;
  background: transparent;
  color: var(--p-text-muted-color);
  cursor: pointer;
}

.chip--on {
  background: var(--p-agent-highlight);
  border-color: var(--p-agent-color);
  color: var(--p-text-color);
}

.chip__n {
  font-size: 10.5px;
  color: var(--p-text-dim-color);
}

.chip--on .chip__n {
  color: var(--p-agent-color);
}

.lote {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 16px 10px;
  padding: 7px 10px;
  border-radius: 5px;
  background: var(--p-agent-highlight-soft);
  border: 1px solid var(--p-agent-highlight);
  color: var(--p-text-color);
  font-size: 11.5px;
}

.lote__label {
  font-weight: 600;
}

.lote__relleno {
  flex-grow: 1;
}

.lote__aprobar {
  background: var(--status-ok-solid);
  border-color: var(--status-ok-solid);
  color: var(--p-primary-contrast-color);
}

.lote__aprobar:hover {
  filter: brightness(1.08);
}

.lote__aprobar :deep(.p-button-label) {
  color: var(--p-primary-contrast-color);
}

.lote__rechazar {
  border-color: var(--status-bad-border);
  color: var(--status-bad-strong);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--p-text-muted-color);
  cursor: pointer;
  flex: none;
}

.icon-btn:hover {
  background: var(--hover-veil);
}

.lista__items {
  list-style: none;
  margin: 0;
  padding: 0;
}

.fila-envoltorio {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--p-content-border-color);
}

.fila-envoltorio__check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  flex: none;
}

.fila {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 11px 16px 11px 4px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fila:hover {
  background: var(--hover-veil);
}

.fila--on {
  background: var(--p-agent-highlight-soft);
  box-shadow: inset 2px 0 0 var(--p-agent-color);
}

.fila__punto {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-top: 5px;
  flex: none;
}

.fila__texto {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.fila__titulo {
  font-size: 13px;
  color: var(--p-text-color);
}

.fila__meta {
  font-size: 11px;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fila__sep {
  color: var(--p-text-faint-color);
  margin: 0 4px;
}

.fila__estado {
  font-size: 11px;
  flex: none;
  margin-top: 2px;
}

.detalle {
  padding: 20px 28px 32px;
}

.detalle__cab {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.detalle__titulo {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}

.detalle__estado {
  font-size: 12px;
}

.detalle__ambito {
  font-size: 12px;
  color: var(--p-text-muted-color);
  margin: 4px 0 20px;
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 20px 32px;
  border-left: 1px solid var(--p-content-border-color);
}

.vacio {
  padding: 28px 20px;
  font-size: 12px;
  color: var(--p-text-dim-color);
}

.error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 10px 32px;
  font-size: 12px;
  color: var(--status-bad);
  background: var(--status-bad-soft);
  border-top: 1px solid var(--status-bad-border);
}
</style>
