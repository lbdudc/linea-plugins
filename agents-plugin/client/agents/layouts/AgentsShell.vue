<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

import Button from 'primevue/button';
import Select from 'primevue/select';

import { connect, disconnect, wsConnected } from '../boot/ws.js';
import { scope } from '../stores/scope.js';
import agentApi from '../api/agentApi.js';
import { agentRunStore } from '../stores/agentRunStore.js';

import QuickLaunchDialog from '../components/common/QuickLaunchDialog.vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const esFlujo = computed(() => route.name === 'flujo');
const esDivergencia = computed(() => route.name === 'divergencia');
const esConsolidacion = computed(() => route.name === 'consolidacion');
const esActividad = computed(() => route.name === 'actividad');
const esOperaciones = computed(() => route.name === 'operaciones');
const esPropagacion = computed(() => route.name === 'propagacion');
const esSalud = computed(() => route.name === 'salud');
const esMemoria = computed(() => route.name === 'memoria');
const esPruebas = computed(() => route.name === 'pruebas');
const esGuia = computed(() => route.name === 'guia');
const esCatalogo = computed(() => route.name === 'catalogo');

const lineas = ref([]);
const lineasCargadas = ref(false);
async function cargarLineas() {
  try {
    lineas.value = await agentApi.listLines();
  } catch {
    lineas.value = [];
  } finally {
    lineasCargadas.value = true;
  }
}

const opcionesAmbito = computed(() => {
  const opciones = [{ label: t('labels.scope_all_lines'), value: null }];
  for (const l of lineas.value) {
    opciones.push({ label: l.name, value: l.id });
  }
  // Si el ambito apunta a una linea que el listado no trae (permisos, o se
  // borro), se anade igualmente para no perder la seleccion en silencio. Solo
  // una vez respondido el listado: antes, el selector ensenaria el id crudo.
  if (lineasCargadas.value && scope.lineId && !opciones.some((o) => o.value === scope.lineId)) {
    opciones.push({ label: scope.lineId, value: scope.lineId });
  }
  return opciones;
});
const lineIdSeleccionado = computed({
  get: () => scope.lineId,
  set: (value) => scope.setScope({ lineId: value, productId: null }),
});

const agentesParaLanzar = ref([]);
async function cargarAgentesParaLanzar() {
  try {
    agentesParaLanzar.value = await agentApi.listAgents();
  } catch {
    agentesParaLanzar.value = [];
  }
}

const quickLaunchAbierto = ref(false);
const lanzandoAgente = ref(false);

function onLanzarAgente() {
  quickLaunchAbierto.value = true;
}

async function crearRun(payload) {
  lanzandoAgente.value = true;
  try {
    const run = await agentApi.createRun(payload);
    agentRunStore.upsert(run);
    return run;
  } catch {
    return null;
  } finally {
    lanzandoAgente.value = false;
  }
}

function onAgenteLanzado(run) {
  router.push({ name: 'actividad', query: { runId: String(run._id) } });
}

const CLAVE_COLAPSADO = 'linea-agents:lateral-colapsado';

function leerColapsadoGuardado() {
  try {
    return window.localStorage.getItem(CLAVE_COLAPSADO) === '1';
  } catch {
    return false;
  }
}

const colapsado = ref(leerColapsadoGuardado());

watch(colapsado, (valor) => {
  try {
    window.localStorage.setItem(CLAVE_COLAPSADO, valor ? '1' : '0');
  } catch {
  }
});

onMounted(() => {
  connect();
  cargarAgentesParaLanzar();
  cargarLineas();
});
onBeforeUnmount(() => disconnect());
</script>

<template>
  <div class="agents-shell">
    <header class="agents-shell__barra" :aria-label="t('labels.layout_topbar_aria')">
      <div class="marca">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="stroke: var(--p-agent-color)" aria-hidden="true">
          <circle cx="12" cy="13" r="7"></circle>
          <path d="M12 6V3"></path>
          <path d="M9 13h.01"></path>
          <path d="M15 13h.01"></path>
        </svg>
        <span class="marca__nombre ident">AGENTES</span>
      </div>

      <div class="separador" aria-hidden="true"></div>

      <div class="ambito">
        <span class="ambito__rotulo rotulo">{{ t('labels.ops_col_scope') }}</span>
        <Select
          v-model="lineIdSeleccionado"
          :options="opcionesAmbito"
          option-label="label"
          option-value="value"
          class="ambito__select"
          :aria-label="t('labels.scope_select_aria')"
        />
      </div>

      <div class="agents-shell__fin">
        <Button :label="t('labels.quick_launch')" icon="pi pi-play" class="boton-lanzar" @click="onLanzarAgente" />

        <div class="estado-conexion" :class="{ 'estado-conexion--activo': wsConnected }" role="status">
          <span class="estado-conexion__punto" aria-hidden="true"></span>
          <span>{{ wsConnected ? t('labels.ws_connected') : t('labels.ws_disconnected') }}</span>
        </div>
      </div>
    </header>

    <div class="agents-shell__cuerpo">
      <nav class="lateral" :class="{ 'lateral--colapsado': colapsado }" :aria-label="t('labels.layout_sections_aria')">
        <div class="lateral__colapsar">
          <button
            type="button"
            class="lateral__boton-colapsar"
            :aria-label="colapsado ? t('labels.expand_sidebar') : t('labels.collapse_sidebar')"
            :aria-expanded="!colapsado"
            @click="colapsado = !colapsado"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              :style="{ stroke: 'var(--p-text-faint-color)', transform: colapsado ? 'rotate(180deg)' : 'none' }"
              aria-hidden="true"
            >
              <path d="m15 6-6 6 6 6"></path>
            </svg>
          </button>
        </div>

        <p v-if="!colapsado" class="lateral__rotulo rotulo">{{ t('labels.section_pipelines') }}</p>
        <div class="lateral__grupo">
          <RouterLink :to="{ name: 'flujo' }" class="lateral__item" :class="{ 'lateral__item--activo': esFlujo }" :title="colapsado ? t('labels.tab_flow') : null">
            <svg class="lateral__icono" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :style="{ stroke: esFlujo ? 'var(--p-agent-color)' : 'var(--p-text-dim-color)' }" aria-hidden="true">
              <path d="M4 8h13l-3-3"></path>
              <path d="M20 16H7l3 3"></path>
            </svg>
            <span v-if="!colapsado" class="lateral__texto">{{ t('labels.tab_flow') }}</span>
          </RouterLink>

          <RouterLink :to="{ name: 'divergencia' }" class="lateral__item" :class="{ 'lateral__item--activo': esDivergencia }" :title="colapsado ? `1 · ${t('labels.flow_stage_divergence')}` : null">
            <svg class="lateral__icono" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :style="{ stroke: esDivergencia ? 'var(--p-agent-color)' : 'var(--p-text-dim-color)' }" aria-hidden="true">
              <circle cx="11" cy="11" r="7"></circle>
              <path d="m20 20-3.5-3.5"></path>
            </svg>
            <span v-if="!colapsado" class="lateral__texto">1 · {{ t('labels.flow_stage_divergence') }}</span>
          </RouterLink>
          <RouterLink :to="{ name: 'consolidacion' }" class="lateral__item" :class="{ 'lateral__item--activo': esConsolidacion }" :title="colapsado ? `2 · ${t('labels.flow_stage_into_spl')}` : null">
            <svg class="lateral__icono" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :style="{ stroke: esConsolidacion ? 'var(--p-agent-color)' : 'var(--p-text-dim-color)' }" aria-hidden="true">
              <path d="M12 3v5"></path>
              <path d="M6 21v-4"></path>
              <path d="M18 21v-4"></path>
              <path d="M6 17h12"></path>
              <path d="M12 8v9"></path>
            </svg>
            <span v-if="!colapsado" class="lateral__texto">2 · {{ t('labels.flow_stage_into_spl') }}</span>
          </RouterLink>
          <RouterLink :to="{ name: 'propagacion' }" class="lateral__item" :class="{ 'lateral__item--activo': esPropagacion }" :title="colapsado ? `3 · ${t('labels.flow_stage_propagation')}` : null">
            <svg class="lateral__icono" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :style="{ stroke: esPropagacion ? 'var(--p-agent-color)' : 'var(--p-text-dim-color)' }" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-3.2-6.9"></path>
              <path d="M21 4v5h-5"></path>
            </svg>
            <span v-if="!colapsado" class="lateral__texto">3 · {{ t('labels.flow_stage_propagation') }}</span>
          </RouterLink>
        </div>

        <p v-if="!colapsado" class="lateral__rotulo rotulo">{{ t('labels.section_workspace') }}</p>
        <div class="lateral__grupo">
          <RouterLink :to="{ name: 'actividad' }" class="lateral__item" :class="{ 'lateral__item--activo': esActividad }" :title="colapsado ? t('labels.tab_runs') : null">
            <svg class="lateral__icono" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :style="{ stroke: esActividad ? 'var(--p-agent-color)' : 'var(--p-text-dim-color)' }" aria-hidden="true">
              <path d="M13 3 4 14h7l-1 7 9-11h-7z"></path>
            </svg>
            <span v-if="!colapsado" class="lateral__texto">{{ t('labels.tab_runs') }}</span>
          </RouterLink>
          <RouterLink :to="{ name: 'operaciones' }" class="lateral__item" :class="{ 'lateral__item--activo': esOperaciones }" :title="colapsado ? t('labels.ops_title') : null">
            <svg class="lateral__icono" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :style="{ stroke: esOperaciones ? 'var(--p-agent-color)' : 'var(--p-text-dim-color)' }" aria-hidden="true">
              <path d="M4 19V5"></path>
              <path d="M4 19h16"></path>
              <path d="M8 16v-5"></path>
              <path d="M13 16V8"></path>
              <path d="M18 16v-3"></path>
            </svg>
            <span v-if="!colapsado" class="lateral__texto">{{ t('labels.operations') }}</span>
          </RouterLink>

          <RouterLink :to="{ name: 'salud' }" class="lateral__item" :class="{ 'lateral__item--activo': esSalud }" :title="colapsado ? t('labels.line_health') : null">
            <svg class="lateral__icono" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :style="{ stroke: esSalud ? 'var(--p-agent-color)' : 'var(--p-text-dim-color)' }" aria-hidden="true">
              <path d="M3 12h4l2 6 4-14 2 8h6"></path>
            </svg>
            <span v-if="!colapsado" class="lateral__texto">{{ t('labels.line_health') }}</span>
          </RouterLink>
          <RouterLink :to="{ name: 'memoria' }" class="lateral__item" :class="{ 'lateral__item--activo': esMemoria }" :title="colapsado ? t('labels.tab_memory') : null">
            <svg class="lateral__icono" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :style="{ stroke: esMemoria ? 'var(--p-agent-color)' : 'var(--p-text-dim-color)' }" aria-hidden="true">
              <path d="M12 5a4 4 0 0 0-4 4c-2 1-2 4 0 5v3a2 2 0 0 0 4 0z"></path>
              <path d="M12 5a4 4 0 0 1 4 4c2 1 2 4 0 5v3a2 2 0 0 1-4 0z"></path>
            </svg>
            <span v-if="!colapsado" class="lateral__texto">{{ t('labels.tab_memory') }}</span>
          </RouterLink>
          <RouterLink :to="{ name: 'pruebas' }" class="lateral__item" :class="{ 'lateral__item--activo': esPruebas }" :title="colapsado ? t('labels.pruebas_nav_label') : null">
            <svg class="lateral__icono" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :style="{ stroke: esPruebas ? 'var(--p-agent-color)' : 'var(--p-text-dim-color)' }" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="2"></rect>
              <path d="m9 15 2 2 4-4"></path>
            </svg>
            <span v-if="!colapsado" class="lateral__texto">{{ t('labels.pruebas_nav_label') }}</span>
          </RouterLink>
        </div>

        <div class="lateral__relleno"></div>

        <div class="lateral__pie">
          <RouterLink :to="{ name: 'catalogo' }" class="lateral__item" :class="{ 'lateral__item--activo': esCatalogo }" :title="colapsado ? t('labels.tab_customization') : null">
            <svg class="lateral__icono" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :style="{ stroke: esCatalogo ? 'var(--p-agent-color)' : 'var(--p-text-dim-color)' }" aria-hidden="true">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M12 3v2"></path>
              <path d="M12 19v2"></path>
              <path d="M5 12H3"></path>
              <path d="M21 12h-2"></path>
            </svg>
            <span v-if="!colapsado" class="lateral__texto">{{ t('labels.tab_customization') }}</span>
          </RouterLink>

          <RouterLink :to="{ name: 'guia' }" class="lateral__item" :class="{ 'lateral__item--activo': esGuia }" :title="colapsado ? t('labels.catalog_nav_label') : null">
            <svg class="lateral__icono" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" :style="{ stroke: esGuia ? 'var(--p-agent-color)' : 'var(--p-text-dim-color)' }" aria-hidden="true">
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M9.5 9.5a2.6 2.6 0 0 1 5 1c0 1.7-2.5 2-2.5 3.5"></path>
              <path d="M12 17.5v.01"></path>
            </svg>
            <span v-if="!colapsado" class="lateral__texto">{{ t('labels.catalog_nav_label') }}</span>
          </RouterLink>
        </div>
      </nav>

      <main class="contenido">
        <router-view />
      </main>
    </div>

    <QuickLaunchDialog
      v-model="quickLaunchAbierto"
      :agents="agentesParaLanzar"
      :starting="lanzandoAgente"
      :create-run="crearRun"
      @launched="onAgenteLanzado"
    />
  </div>
</template>

<style scoped>
.agents-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--p-surface-ground);
}

.agents-shell__cuerpo {
  flex-grow: 1;
  display: flex;
  min-height: 0;
}

.agents-shell__barra {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 52px;
  flex-shrink: 0;
  padding: 0 18px;
  background: var(--p-content-background);
  border-bottom: 1px solid var(--p-content-border-color);
}

.agents-shell__fin {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
}

.marca {
  display: flex;
  align-items: center;
  gap: 9px;
}

.marca__nombre {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--p-text-color);
}

.separador {
  width: 1px;
  height: 20px;
  background: var(--p-content-border-color);
}

.ambito {
  display: flex;
  align-items: center;
  gap: 9px;
}

.ambito__rotulo {
  white-space: nowrap;
}

.ambito__select {
  min-width: 220px;
  height: 30px;
}

.ambito__select :deep(.p-select-label) {
  font-size: 13px;
  padding-top: 5px;
  padding-bottom: 5px;
}

.ambito__select :deep(.p-select-option-selected) {
  background: var(--p-agent-highlight) !important;
  color: var(--p-text-color) !important;
}

.boton-lanzar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 14px;
  border-radius: 5px;
  background: var(--p-agent-background);
  border-color: var(--p-agent-background);
  color: var(--p-primary-contrast-color);
  font-size: 12.5px;
  font-weight: 500;
}

.boton-lanzar:hover {
  background: var(--p-agent-hover-color);
  border-color: var(--p-agent-hover-color);
}

.boton-lanzar :deep(.p-button-icon),
.boton-lanzar :deep(.p-button-label) {
  color: var(--p-primary-contrast-color);
}

.estado-conexion {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--p-text-muted-color);
  white-space: nowrap;
}

.estado-conexion__punto {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--status-bad-solid);
}

.estado-conexion--activo .estado-conexion__punto {
  background: var(--status-ok-solid);
}

.lateral {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--p-content-background);
  border-right: 1px solid var(--p-content-border-color);
  overflow-y: auto;
}

.lateral--colapsado {
  width: 64px;
}

.lateral__colapsar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 10px 12px 4px;
}

.lateral--colapsado .lateral__colapsar {
  justify-content: center;
}

.lateral__boton-colapsar {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  background: none;
  border: none;
  cursor: pointer;
}

.lateral__rotulo {
  padding: 20px 12px 8px 22px;
}

.lateral__rotulo:first-of-type {
  padding-top: 4px;
}

.lateral__grupo {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 8px;
}

.lateral__item {
  display: flex;
  align-items: center;
  gap: 11px;
  height: 34px;
  padding: 0 12px;
  border-radius: 5px;
  font-size: 13px;
  color: var(--p-text-secondary-color);
  text-decoration: none;
  cursor: pointer;
}

.lateral--colapsado .lateral__item {
  justify-content: center;
  padding: 0;
}

.lateral__item:hover {
  background: var(--hover-veil);
}

.lateral__item--activo {
  background: var(--p-agent-highlight);
  color: var(--p-text-color);
  font-weight: 500;
}

.lateral__item--activo:hover {
  background: var(--p-agent-highlight);
}

.lateral__item--pendiente {
  cursor: default;
  opacity: 0.75;
}

.lateral__item--pendiente:hover {
  background: none;
}

.lateral__icono {
  flex-shrink: 0;
}

.lateral__texto {
  flex-grow: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lateral__relleno {
  flex-grow: 1;
}

.lateral__pie {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px;
  border-top: 1px solid var(--p-content-hover-background);
}

.contenido {
  flex-grow: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
</style>
