<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { AGENT_GROUPS_DISEÑO, agentCopy } from './agentCatalogCopy.js';

const props = defineProps({
  entries: { type: Array, default: () => [] },
  modelValue: { type: String, default: null },
  modeByType: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:modelValue']);
const { t } = useI18n();

const MODE_LABEL_KEY = {
  manual: 'labels.autonomy_mode_manual',
  semi: 'labels.autonomy_mode_semi',
  automatic: 'labels.autonomy_mode_automatic',
};

const entriesPorTipo = computed(() => Object.fromEntries(props.entries.map((e) => [e.type, e])));

const grupos = computed(() =>
  AGENT_GROUPS_DISEÑO
    .map((g) => ({ label: t(g.labelKey), types: g.types.filter((ty) => entriesPorTipo.value[ty]) }))
    .filter((g) => g.types.length)
);

const nombre = (type) => agentCopy(type)?.name ?? entriesPorTipo.value[type]?.title ?? type;
const activo = (type) => !!entriesPorTipo.value[type]?.config?.enabled;
const etiquetaModo = (type) => {
  if (!activo(type)) return t('labels.mode_disabled_label');
  const key = MODE_LABEL_KEY[props.modeByType[type]];
  return key ? t(key) : t('labels.mode_unknown_label');
};
</script>

<template>
  <nav class="agent-groups" :aria-label="t('labels.agent_groups_aria')">
    <template v-for="grupo in grupos" :key="grupo.label">
      <p class="agent-groups__rotulo rotulo">{{ grupo.label }}</p>
      <button
        v-for="type in grupo.types"
        :key="type"
        type="button"
        class="agent-groups__item"
        :class="{ 'agent-groups__item--activo': modelValue === type }"
        @click="emit('update:modelValue', type)"
      >
        <span
          class="agent-groups__punto"
          :class="{ 'agent-groups__punto--apagado': !activo(type) }"
          aria-hidden="true"
        ></span>
        <span class="agent-groups__nombre">{{ nombre(type) }}</span>
        <span
          class="agent-groups__modo"
          :class="{ 'agent-groups__modo--apagado': !activo(type) }"
        >{{ etiquetaModo(type) }}</span>
      </button>
    </template>
  </nav>
</template>

<style scoped>
.agent-groups {
  flex-grow: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 0 12px 16px;
}

.agent-groups__rotulo {
  padding: 14px 10px 7px;
  margin: 0;
}

.agent-groups__item {
  display: flex;
  align-items: center;
  gap: 11px;
  height: 36px;
  padding: 0 10px;
  border-radius: 5px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  color: var(--p-text-secondary-color);
}

.agent-groups__item:hover {
  background: var(--hover-veil);
}

.agent-groups__item--activo {
  background: var(--p-agent-highlight);
}

.agent-groups__item--activo:hover {
  background: var(--p-agent-highlight);
}

.agent-groups__punto {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--status-ok-strong);
}

.agent-groups__punto--apagado {
  background: var(--p-text-faint-color);
}

.agent-groups__nombre {
  font-size: 13px;
  flex-grow: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
}

.agent-groups__item--activo .agent-groups__nombre {
  color: var(--p-text-color);
  font-weight: 500;
}

.agent-groups__modo {
  font-size: 11px;
  flex-shrink: 0;
  color: var(--p-text-muted-color);
}

.agent-groups__modo--apagado {
  color: var(--p-text-faint-color);
}
</style>
