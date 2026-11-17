<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Select from 'primevue/select';

import agentApi from '../../../api/agentApi.js';
import { notify } from '../harvest/notify.js';
import { scope } from '../../../stores/scope.js';

import AgentMemoryCard from './AgentMemoryCard.vue';
import AgentChatPanel from './AgentChatPanel.vue';
import ConfirmPromptHost from '../../common/ConfirmPromptHost.vue';

const { t } = useI18n();

const lineId = computed(() => scope.lineId);
const productId = ref(null);
const products = ref([]);
const loadingProducts = ref(false);

const productOptions = computed(() => [
  { label: t('labels.line_default_option'), value: null },
  ...products.value.map((p) => ({ label: `${p.name} (v${p.version ?? '?'})`, value: p._id })),
]);

async function loadProducts() {
  products.value = [];
  productId.value = null;
  if (!lineId.value) return;
  loadingProducts.value = true;
  try {
    const enrolled = await agentApi.listEnrolledProducts();
    products.value = (enrolled ?? []).filter((p) => String(p.lineId ?? '') === String(lineId.value));
  } catch (err) {
    products.value = [];
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.request_failed') });
  } finally {
    loadingProducts.value = false;
  }
}

watch(lineId, loadProducts, { immediate: true });
</script>

<template>
  <div class="memoria">
    <ConfirmPromptHost />

    <p v-if="!lineId" class="memoria__aviso">
      <i class="pi pi-info-circle" aria-hidden="true"></i>
      {{ t('labels.memory_pick_scope') }}
    </p>

    <template v-else>
      <div class="memoria__scope">
        <Select
          v-model="productId"
          :options="productOptions"
          option-label="label"
          option-value="value"
          :loading="loadingProducts"
          class="memoria__scope-select"
          :placeholder="t('labels.config_scope_product')"
        />
        <span class="memoria__scope-hint">{{ productId ? t('labels.config_scope_product_hint') : t('labels.config_scope_line_hint') }}</span>
      </div>

      <div class="memoria__grid">
        <AgentMemoryCard :key="`mem-${lineId}-${productId}`" :line-id="lineId" :product-id="productId" />
        <AgentChatPanel :key="`chat-${lineId}`" :line-id="lineId" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.memoria {
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.memoria__aviso {
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

.memoria__scope {
  display: flex;
  align-items: center;
  gap: 12px;
}

.memoria__scope-select {
  min-width: 260px;
}

.memoria__scope-hint {
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.memoria__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  min-height: 0;
}

@media (max-width: 960px) {
  .memoria__grid {
    grid-template-columns: 1fr;
  }
}
</style>
