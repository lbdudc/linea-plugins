<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import agentApi from '../api/agentApi.js';
import { scope } from '../stores/scope.js';

import AgentConfigForm from '../components/catalog/AgentConfigForm.vue';
import AgentDetailPane from '../components/catalog/AgentDetailPane.vue';
import AgentGroupList from '../components/catalog/AgentGroupList.vue';
import { AGENTES_CON_AUTONOMIA, agentCopy } from '../components/catalog/agentCatalogCopy.js';
import ProductAutonomyToggle from '../components/consoles/pruebas/ProductAutonomyToggle.vue';
import EsqueletoLista from '../components/common/EsqueletoLista.vue';

const { t } = useI18n();

const lineId = computed(() => scope.lineId);
const productId = computed(() => scope.productId);
const atProduct = computed(() => !!productId.value);

const entries = ref([]);
const cargandoEntries = ref(false);
const errorEntries = ref(null);
const selectedType = ref(null);

const policy = ref(null);
const memorias = ref([]);

const savingEnabled = ref(false);
const savingMode = ref(false);
const savingReset = ref(false);

const errMsg = (err) => err?.response?.data?.error ?? err?.message ?? t('labels.catalog_request_error');

async function cargarEntries() {
  if (!lineId.value) {
    entries.value = [];
    return;
  }
  cargandoEntries.value = true;
  errorEntries.value = null;
  try {
    const data = await agentApi.getConfig({ lineId: lineId.value, productId: productId.value });
    entries.value = data;
    if (!entries.value.some((e) => e.type === selectedType.value)) {
      selectedType.value = entries.value[0]?.type ?? null;
    }
  } catch (err) {
    errorEntries.value = errMsg(err);
    entries.value = [];
  } finally {
    cargandoEntries.value = false;
  }
}

async function cargarPolicy() {
  if (!lineId.value) {
    policy.value = null;
    return;
  }
  try {
    policy.value = await agentApi.getPolicy({ lineId: lineId.value, productId: productId.value });
  } catch {
    policy.value = null;
  }
}

const LIMITE_MEMORIA = 200;

async function cargarMemorias() {
  if (!lineId.value) {
    memorias.value = [];
    return;
  }
  try {
    memorias.value = await agentApi.listMemory({ lineId: lineId.value, productId: productId.value, limit: LIMITE_MEMORIA });
  } catch {
    memorias.value = [];
  }
}

watch([lineId, productId], () => {
  cargarEntries();
  cargarPolicy();
  cargarMemorias();
});
onMounted(() => {
  cargarEntries();
  cargarPolicy();
  cargarMemorias();
});

const selectedEntry = computed(() => entries.value.find((e) => e.type === selectedType.value) ?? null);
const selectedCopy = computed(() => (selectedType.value ? agentCopy(selectedType.value) : null));

const modeByType = computed(() => {
  const modos = policy.value?.modes ?? {};
  const salida = {};
  for (const type of AGENTES_CON_AUTONOMIA) salida[type] = modos[type] ?? null;
  return salida;
});

const modoDisponible = computed(() => AGENTES_CON_AUTONOMIA.includes(selectedType.value));
const modoActual = computed(() => (modoDisponible.value ? modeByType.value[selectedType.value] : null));

const memoryLabel = computed(() => {
  if (!selectedType.value) return '—';
  const total = memorias.value.filter((m) => m.agentType === selectedType.value).length;
  if (!total) return t('labels.detail_no_memory_notes');
  if (total >= LIMITE_MEMORIA) return t('labels.detail_memory_count_limit', { limit: LIMITE_MEMORIA });
  return t(total === 1 ? 'labels.detail_memory_count' : 'labels.detail_memory_count_plural', { n: total });
});

async function onToggleEnabled(valor) {
  const entry = selectedEntry.value;
  if (!entry || !lineId.value) return;
  savingEnabled.value = true;
  try {
    await agentApi.setConfig({
      lineId: lineId.value,
      productId: productId.value,
      agentType: entry.type,
      enabled: valor,
    });
    await cargarEntries();
  } catch (err) {
    errorEntries.value = errMsg(err);
  } finally {
    savingEnabled.value = false;
  }
}

const savingConfig = ref(false);

async function onSaveConfig({ type, config }) {
  if (!lineId.value) return;
  savingConfig.value = true;
  try {
    await agentApi.setConfig({
      lineId: lineId.value,
      productId: productId.value,
      agentType: type,
      ...config,
    });
    await cargarEntries();
  } catch (err) {
    errorEntries.value = errMsg(err);
  } finally {
    savingConfig.value = false;
  }
}

async function onChangeMode(modo) {
  if (!modoDisponible.value || !lineId.value) return;
  savingMode.value = true;
  try {
    policy.value = await agentApi.setPolicy({
      lineId: lineId.value,
      productId: productId.value,
      modes: { [selectedType.value]: modo },
    });
  } catch (err) {
    errorEntries.value = errMsg(err);
  } finally {
    savingMode.value = false;
  }
}

async function onResetToLine() {
  const entry = selectedEntry.value;
  if (!entry || !lineId.value || !productId.value) return;
  savingReset.value = true;
  try {
    await agentApi.resetConfig({ lineId: lineId.value, productId: productId.value, agentType: entry.type });
    await cargarEntries();
  } catch (err) {
    errorEntries.value = errMsg(err);
  } finally {
    savingReset.value = false;
  }
}
</script>

<template>
  <section class="catalog">
    <div v-if="!lineId" class="catalog__vacio">
      <p class="catalog__vacio-titulo cifra">{{ t('labels.catalog_empty_title') }}</p>
      <p class="catalog__vacio-texto">
        {{ t('labels.catalog_empty_hint') }}
      </p>
    </div>

    <template v-else>
      <ProductAutonomyToggle
        v-if="atProduct"
        :key="`${lineId}-${productId}`"
        :line-id="lineId"
        :product-id="productId"
        class="catalog__autonomy"
      />

      <div class="catalog__cuerpo">
        <aside class="catalog__lateral">
          <div class="catalog__lateral-cabecera">
            <h1 class="catalog__titulo cifra">{{ t('labels.tab_customization') }}</h1>
            <p class="catalog__subtitulo">{{ t('labels.catalog_subtitle') }}</p>
          </div>

          <p v-if="errorEntries" class="catalog__error" role="alert">{{ errorEntries }}</p>
          <EsqueletoLista v-else-if="cargandoEntries" :filas="6" />

          <AgentGroupList
            v-else
            v-model="selectedType"
            :entries="entries"
            :mode-by-type="modeByType"
          />
        </aside>

        <AgentDetailPane
          :entry="selectedEntry"
          :copy="selectedCopy"
          :at-product="atProduct"
          :mode="modoActual"
          :modo-disponible="modoDisponible"
          :saving-enabled="savingEnabled"
          :saving-mode="savingMode"
          :saving-reset="savingReset"
          :memory-label="memoryLabel"
          @toggle-enabled="onToggleEnabled"
          @change-mode="onChangeMode"
          @reset-to-line="onResetToLine"
        >
          <AgentConfigForm
            v-if="selectedEntry"
            :entry="selectedEntry"
            :busy="savingConfig"
            @save="onSaveConfig"
          />
        </AgentDetailPane>
      </div>
    </template>
  </section>
</template>

<style scoped>
.catalog {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.catalog__autonomy {
  flex-shrink: 0;
  margin: 18px 22px 0;
}

.catalog__cuerpo {
  flex-grow: 1;
  min-height: 0;
  display: flex;
}

.catalog__vacio {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  padding: 28px 32px;
  max-width: 560px;
}

.catalog__vacio-titulo {
  margin: 0;
  font-size: 32px;
  color: var(--p-text-color);
}

.catalog__vacio-texto {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--p-text-muted-color);
}

.catalog__lateral {
  width: 400px;
  flex-shrink: 0;
  border-right: 1px solid var(--p-content-border-color);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.catalog__lateral-cabecera {
  flex-shrink: 0;
  padding: 22px 22px 16px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.catalog__titulo {
  margin: 0;
  font-size: 26px;
  line-height: 1.1;
  color: var(--p-text-color);
}

.catalog__subtitulo {
  margin: 0;
  font-size: 13px;
  color: var(--p-text-muted-color);
}

.catalog__estado,
.catalog__error {
  margin: 0 22px 8px;
  font-size: 12.5px;
}

.catalog__error {
  color: var(--status-bad);
}

.catalog__estado {
  color: var(--p-text-muted-color);
}
</style>
