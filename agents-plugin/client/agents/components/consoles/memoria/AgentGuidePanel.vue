<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { AGENT_GROUPS_DISEÑO, agentCopy } from '../../catalog/agentCatalogCopy.js';

const props = defineProps({
  agents: { type: Array, default: () => [] },
});

const { t } = useI18n();

const agentByType = computed(() => Object.fromEntries(props.agents.map((a) => [a.type, a])));

const groups = computed(() =>
  AGENT_GROUPS_DISEÑO
    .map((g) => ({ label: t(g.labelKey), agents: g.types.map((ty) => agentByType.value[ty]).filter(Boolean) }))
    .filter((g) => g.agents.length),
);

const agentName = (type) => agentCopy(type)?.name ?? agentByType.value[type]?.title ?? type;
const agentDesc = (type) => agentCopy(type)?.desc ?? agentByType.value[type]?.description ?? '';
const scopeLabel = (agentScope) => (agentScope === 'product' ? t('labels.scope_product') : t('labels.scope_line'));
const launchHint = (agentScope) => (agentScope === 'product' ? t('labels.launch_hint_product') : '');
</script>

<template>
  <div class="guia">
    <header class="guia__header">
      <i class="pi pi-book" aria-hidden="true"></i>
      <h1 class="guia__titulo cifra">{{ t('labels.catalog_title') }}</h1>
    </header>

    <div class="guia__secciones">
      <section v-for="group in groups" :key="group.label" class="guia__seccion">
        <p class="guia__seccion-titulo rotulo">{{ group.label }}</p>
        <div class="guia__grid">
          <div v-for="agent in group.agents" :key="agent.type" class="guia__card">
            <span class="guia__card-punto" :class="`guia__card-punto--${agent.scope}`" aria-hidden="true"></span>
            <div class="guia__card-body">
              <div class="guia__card-titulo">
                {{ agentName(agent.type) }}
                <span class="guia__card-badge">{{ scopeLabel(agent.scope) }}</span>
              </div>
              <p class="guia__card-desc">{{ agentDesc(agent.type) }}</p>
              <p v-if="launchHint(agent.scope)" class="guia__card-hint">
                <i class="pi pi-info-circle" aria-hidden="true"></i> {{ launchHint(agent.scope) }}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.guia {
  padding: 22px 32px 32px;
}

.guia__header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}

.guia__header i {
  color: var(--p-agent-color);
  font-size: 19px;
}

.guia__titulo {
  font-size: 26px;
  margin: 0;
  color: var(--p-text-color);
}

.guia__secciones {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 0 28px;
  align-items: start;
}

.guia__seccion {
  padding: 14px 0;
  border-top: 1px solid var(--p-content-border-color);
}

.guia__seccion-titulo {
  margin: 0 0 10px;
}

.guia__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
}

.guia__card {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 12px;
  border-radius: 7px;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
}

.guia__card-punto {
  flex-shrink: 0;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-top: 5px;
  background: var(--p-agent-color);
}

.guia__card-punto--product {
  background: var(--status-warn-solid);
}

.guia__card-body {
  flex: 1;
  min-width: 0;
}

.guia__card-titulo {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--p-text-color);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 5px;
}

.guia__card-badge {
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 20px;
  background: var(--p-content-hover-background);
  color: var(--p-text-muted-color);
}

.guia__card-desc {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--p-text-muted-color);
  line-height: 1.55;
}

.guia__card-hint {
  margin: 0;
  font-size: 11px;
  color: var(--p-text-dim-color);
  display: flex;
  align-items: center;
  gap: 5px;
}
</style>
