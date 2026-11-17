<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Dialog from 'primevue/dialog';
import Checkbox from 'primevue/checkbox';
import ToggleSwitch from 'primevue/toggleswitch';
import Button from 'primevue/button';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  products: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'launch']);

const { t } = useI18n();

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const selected = ref(new Set());
const force = ref(false);

watch(open, (isOpen) => {
  if (isOpen) {
    selected.value = new Set(props.products.map((p) => String(p._id)));
    force.value = false;
  }
});

const allSelected = computed(() => props.products.length > 0 && selected.value.size === props.products.length);
const someSelected = computed(() => selected.value.size > 0 && !allSelected.value);

const toggle = (id) => {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
};
const toggleAll = () => {
  selected.value = allSelected.value ? new Set() : new Set(props.products.map((p) => String(p._id)));
};

const launch = () => {
  emit('launch', { productIds: [...selected.value], force: force.value });
  open.value = false;
};

const fmtTime = (d) => (d ? new Date(d).toLocaleString() : t('labels.never_synced_caption'));
</script>

<template>
  <Dialog :visible="open" modal class="sld" @update:visible="(v) => (open = v)">
    <template #header>
      <div class="sld__header">
        <i class="pi pi-sync" aria-hidden="true"></i>
        <span class="sld__title">{{ t('labels.sync_line') }}</span>
        <span class="sld__count">{{ selected.size }}/{{ products.length }}</span>
      </div>
    </template>

    <p class="sld__hint">{{ t('labels.sync_line_hint') }}</p>

    <label class="sld__row sld__row--all">
      <Checkbox :model-value="allSelected" :indeterminate="someSelected" binary @update:model-value="toggleAll" />
      <span class="sld__row-label sld__row-label--strong">{{ t('labels.select_all') }}</span>
    </label>
    <div class="sld__sep" aria-hidden="true"></div>

    <div class="sld__list">
      <label v-for="p in products" :key="p._id" class="sld__row">
        <Checkbox :model-value="selected.has(String(p._id))" binary @update:model-value="toggle(String(p._id))" />
        <span class="sld__row-body">
          <span class="sld__row-label">{{ p.name }}</span>
          <span class="sld__row-caption">v{{ p.version }} · {{ t('labels.last_sync_caption') }} {{ fmtTime(p.lastSyncAt) }}</span>
        </span>
      </label>
      <p v-if="!products.length" class="sld__empty">{{ t('labels.no_products_in_line') }}</p>
    </div>

    <div class="sld__sep" aria-hidden="true"></div>
    <label class="sld__row sld__row--force">
      <ToggleSwitch v-model="force" />
      <span class="sld__row-label">{{ t('labels.force_regen_label') }}</span>
    </label>

    <template #footer>
      <Button :label="t('labels.cancel')" text @click="open = false" />
      <Button
        icon="pi pi-sync"
        :label="t('labels.sync_n_products', { n: selected.size, productUnit: selected.size === 1 ? t('labels.product_singular') : t('labels.product_plural') })"
        :disabled="selected.size === 0 || busy"
        :loading="busy"
        @click="launch"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.sld__header {
  display: flex;
  align-items: center;
  gap: 9px;
}

.sld__header i {
  color: var(--p-agent-color);
}

.sld__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--p-text-color);
}

.sld__count {
  margin-left: 6px;
  padding: 1px 9px;
  border-radius: 20px;
  background: var(--p-agent-highlight);
  color: var(--p-agent-color);
  font-size: 11px;
}

.sld__hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.sld__sep {
  border-top: 1px solid var(--p-content-border-color);
  margin: 8px 0;
}

.sld__list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sld__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 2px;
  cursor: pointer;
}

.sld__row--all {
  padding-bottom: 8px;
}

.sld__row-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.sld__row-label {
  font-size: 13px;
  color: var(--p-text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sld__row-label--strong {
  font-weight: 500;
}

.sld__row-caption {
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.sld__empty {
  margin: 0;
  padding: 8px 2px;
  font-size: 12px;
  color: var(--p-text-dim-color);
}

.sld__row--force {
  padding-top: 2px;
}
</style>

<style>
.p-dialog.sld {
  width: 520px;
  max-width: 94vw;
}
</style>
