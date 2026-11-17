<script setup>
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import lineaApi from '../api/lineaApi.js';
import { scope } from '../stores/scope.js';

import LineHealthDashboard from '../components/consoles/salud/LineHealthDashboard.vue';
import Esqueleto from '../components/common/Esqueleto.vue';
import EsqueletoTarjetas from '../components/common/EsqueletoTarjetas.vue';

const { t } = useI18n();

const healthSummary = ref(null);
const modelStats = ref(null);
const products = ref([]);
const cargando = ref(false);
const error = ref('');

const PALABRAS = new Set([
  'features', 'constraints', 'mandatory', 'optional', 'alternative', 'or', 'imports', 'namespace',
]);

function contarCaracteristicas(contenido) {
  if (!contenido) return 0;
  let enRestricciones = false;
  return contenido.split('\n').filter((linea) => {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('//')) return false;
    const palabra = limpia.split(/[\s{(!]/)[0].toLowerCase();
    if (palabra === 'constraints') { enRestricciones = true; return false; }
    if (palabra === 'features') { enRestricciones = false; return false; }
    if (enRestricciones) return false;
    return !PALABRAS.has(palabra) && /^[A-Za-z_]/.test(limpia);
  }).length;
}

let peticion = 0;

function mensajeDeError(e) {
  const clave = e?.response?.data?.error;
  if (typeof clave === 'string' && clave) {
    const texto = t(clave);
    if (texto !== clave) return texto;
  }
  return t('labels.request_failed');
}

async function cargar() {
  const lineId = scope.lineId;
  const mia = ++peticion;
  healthSummary.value = null;
  modelStats.value = null;
  products.value = [];
  if (!lineId) return;

  cargando.value = true;
  error.value = '';
  try {
    try {
      const modelo = await lineaApi.getFeatureModel(lineId);
      if (mia !== peticion) return;
      modelStats.value = {
        featureCount: modelo.featureModelType === 'XML' ? null : contarCaracteristicas(atob(modelo.content || '')),
        format: modelo.featureModelType || 'UVL',
      };
    } catch {
      modelStats.value = null;
    }

    const linea = await lineaApi.getLine(lineId);
    if (mia !== peticion) return;
    const productos = linea?.products ?? [];
    products.value = productos;
    if (!productos.length) {
      healthSummary.value = { valid: 0, invalid: 0, total: 0 };
    } else {
      const resultados = await Promise.all(
        productos.map(async (p) => {
          const [salud, conflictos] = await Promise.all([
            lineaApi.getProductHealth(p._id),
            lineaApi.getProductConflicts(p._id).catch(() => ({ conflictingMRs: 0 })),
          ]);
          return salud.valid === true && !(conflictos.conflictingMRs > 0);
        }),
      );
      if (mia !== peticion) return;
      const validos = resultados.filter(Boolean).length;
      healthSummary.value = { valid: validos, invalid: resultados.length - validos, total: resultados.length };
    }
  } catch (e) {
    if (mia !== peticion) return;
    error.value = mensajeDeError(e);
  } finally {
    if (mia === peticion) cargando.value = false;
  }
}

onMounted(cargar);
watch(() => scope.lineId, cargar);
</script>

<template>
  <section class="salud">
    <header class="salud__cab">
      <p class="rotulo">{{ t('labels.section_workspace') }}</p>
      <h1 class="cifra salud__titulo">{{ t('labels.line_health') }}</h1>
    </header>

    <p v-if="!scope.lineId" class="salud__aviso">
      <i class="pi pi-info-circle" aria-hidden="true"></i>
      {{ t('labels.ops_scope_none') }}
    </p>

    <div v-else-if="cargando && !healthSummary" class="salud__esqueleto">
      <div class="salud__esqueleto-pestanas">
        <Esqueleto ancho="92px" alto="11px" />
        <Esqueleto ancho="70px" alto="11px" />
        <Esqueleto ancho="84px" alto="11px" />
      </div>
      <EsqueletoTarjetas :tarjetas="3" barra />
    </div>

    <LineHealthDashboard
      v-else
      :line-id="scope.lineId"
      :health-summary="healthSummary"
      :model-stats="modelStats"
      :products="products"
    />

    <p v-if="error" class="salud__error" role="alert">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ error }}
    </p>
  </section>
</template>

<style scoped>
.salud {
  padding: 24px 32px 40px;
}

.salud__titulo {
  font-size: 32px;
  margin: 2px 0 20px;
}

.salud__aviso {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 9px 12px;
  font-size: 12px;
  color: var(--p-text-secondary-color);
  background: var(--p-highlight-soft);
  border: 1px solid var(--p-content-border-color);
  border-radius: 5px;
}

.salud__esqueleto {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 18px;
}

.salud__esqueleto-pestanas {
  display: flex;
  gap: 20px;
  padding-bottom: 11px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.salud__error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 18px 0 0;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--status-bad);
  background: var(--status-bad-soft);
  border: 1px solid var(--status-bad-border);
  border-radius: 5px;
}
</style>
