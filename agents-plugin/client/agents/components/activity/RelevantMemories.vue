<script setup>
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Accordion from 'primevue/accordion';
import AccordionPanel from 'primevue/accordionpanel';
import AccordionHeader from 'primevue/accordionheader';
import AccordionContent from 'primevue/accordioncontent';
import agentApi from '../../api/agentApi.js';

const props = defineProps({
  lineId: { type: String, default: null },
  productId: { type: String, default: null },
  query: { type: String, default: '' },
  k: { type: Number, default: 5 },
});

const { t } = useI18n();

const results = ref([]);
const loading = ref(false);

const KIND_LABEL_KEY = {
  decision: 'labels.memory_kind_decision',
  fact: 'labels.memory_kind_outcome',
  lesson: 'labels.memory_kind_lesson',
};
const KIND_COLOR = {
  decision: 'var(--p-agent-color)',
  fact: 'var(--status-ok-strong)',
  lesson: 'var(--status-serious)',
};
const kindLabel = (k) => (KIND_LABEL_KEY[k] ? t(KIND_LABEL_KEY[k]) : k);
const kindColor = (k) => KIND_COLOR[k] ?? 'var(--p-text-muted-color)';
const scorePct = (s) => (s == null ? null : `${Math.round(s * 100)}%`);
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const origin = (m) =>
  m.scope?.productId
    ? t('labels.memory_origin_product', { id: m.scope.productId })
    : t('labels.memory_origin_line', { id: m.scope?.lineId ?? '—' });

async function load() {
  if (!props.lineId || !props.query?.trim()) {
    results.value = [];
    return;
  }
  loading.value = true;
  try {
    const found = await agentApi.searchMemory({
      lineId: props.lineId,
      productId: props.productId,
      q: props.query.trim(),
      k: props.k,
    });
    results.value = (found ?? []).filter((m) => m.scope?.lineId);
  } catch {
    results.value = [];
  } finally {
    loading.value = false;
  }
}

watch(() => [props.lineId, props.productId, props.query], load, { immediate: true });
</script>

<template>
  <div v-if="results.length || loading" class="memorias">
    <Accordion>
      <AccordionPanel value="0">
        <AccordionHeader>
          <span class="memorias__cabecera">{{ t('labels.relevant_memories_title', { n: results.length }) }}</span>
        </AccordionHeader>
        <AccordionContent>
          <div v-if="loading && !results.length" class="memorias__cargando">{{ t('labels.searching_memory') }}</div>
          <div v-for="m in results" :key="m._id" class="memorias__item">
            <div class="memorias__meta">
              <span class="memorias__tipo" :style="{ color: kindColor(m.kind) }">{{ kindLabel(m.kind) }}</span>
              <span class="memorias__origen ident">{{ m.agentType }} · {{ fmtDate(m.createdAt) }}</span>
              <span v-if="scorePct(m.score)" class="memorias__puntuacion ident">{{ scorePct(m.score) }}</span>
            </div>
            <p class="memorias__contenido">{{ m.content }}</p>
            <span class="memorias__fuente ident">{{ origin(m) }}</span>
          </div>
        </AccordionContent>
      </AccordionPanel>
    </Accordion>
  </div>
</template>

<style scoped>
.memorias {
  margin-top: 4px;
}

.memorias :deep(.p-accordionheader) {
  padding: 8px 10px;
  font-size: 12.5px;
  background: transparent;
  border: 1px solid var(--p-content-hover-background);
  border-radius: 6px;
}

.memorias :deep(.p-accordioncontent-content) {
  padding: 4px 2px 6px;
}

.memorias__cabecera {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--p-text-dim-color);
}

.memorias__cargando {
  font-size: 12px;
  color: var(--p-text-muted-color);
  padding: 6px 2px;
}

.memorias__item {
  border: 1px solid var(--p-content-hover-background);
  border-radius: 6px;
  padding: 11px 13px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.memorias__item + .memorias__item {
  margin-top: 8px;
}

.memorias__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.memorias__tipo {
  font-size: 11px;
  font-weight: 500;
}

.memorias__origen {
  font-size: 11px;
  color: var(--p-text-dim-color);
}

.memorias__puntuacion {
  margin-left: auto;
  font-size: 11px;
  color: var(--p-agent-color);
}

.memorias__contenido {
  margin: 0;
  font-size: 12.5px;
  color: var(--p-text-secondary-color);
  line-height: 1.5;
}

.memorias__fuente {
  font-size: 11px;
  color: var(--p-text-dim-color);
}
</style>
