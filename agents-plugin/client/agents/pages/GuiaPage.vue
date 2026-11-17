<script setup>
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import agentApi from '../api/agentApi.js';

import AgentGuidePanel from '../components/consoles/memoria/AgentGuidePanel.vue';
import EsqueletoTarjetas from '../components/common/EsqueletoTarjetas.vue';

const { t } = useI18n();

const agents = ref([]);
const cargando = ref(false);
const error = ref('');

onMounted(async () => {
  cargando.value = true;
  try {
    agents.value = await agentApi.listAgents();
  } catch (e) {
    error.value = e?.response?.data?.message ?? t('labels.request_failed');
  } finally {
    cargando.value = false;
  }
});
</script>

<template>
  <section class="guia">
    <header class="guia__cab">
      <p class="rotulo">{{ t('labels.section_workspace') }}</p>
      <h1 class="cifra guia__titulo">{{ t('labels.catalog_nav_label') }}</h1>
    </header>

    <EsqueletoTarjetas v-if="cargando" :tarjetas="6" minimo="260px" />
    <AgentGuidePanel v-else :agents="agents" />

    <p v-if="error" class="guia__error" role="alert">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ error }}
    </p>
  </section>
</template>

<style scoped>
.guia {
  padding: 24px 32px 40px;
}

.guia__titulo {
  font-size: 32px;
  margin: 2px 0 20px;
}

.guia__vacio {
  font-size: 12px;
  color: var(--p-text-dim-color);
}

.guia__error {
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
