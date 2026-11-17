<script setup>
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import Select from 'primevue/select';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';

import agentApi from '../../../api/agentApi.js';
import { confirmDialog } from '../../common/confirmPrompt.js';
import EsqueletoLista from '../../common/EsqueletoLista.vue';
import { scorePercent, sortMemoriesByRecency } from './memoryFilter.js';

const props = defineProps({
  lineId: { type: String, required: true },
  productId: { type: String, default: null },
});

const { t } = useI18n();

const memories = ref([]);
const loading = shallowRef(false);
const deletingId = shallowRef(null);
const clearing = shallowRef(false);
const addDialog = shallowRef(false);
const addForm = ref({ kind: 'lesson', content: '' });
const kindOptions = computed(() => [
  { label: t('labels.memory_kind_lesson'), value: 'lesson' },
  { label: t('labels.memory_kind_decision'), value: 'decision' },
  { label: t('labels.memory_kind_outcome'), value: 'fact' },
]);
const adding = shallowRef(false);

const KIND_LABEL_KEY = { decision: 'labels.memory_kind_decision', fact: 'labels.memory_kind_outcome', lesson: 'labels.memory_kind_lesson' };
const kindLabel = (kind) => (KIND_LABEL_KEY[kind] ? t(KIND_LABEL_KEY[kind]) : kind);

const formattedDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const sortedMemories = computed(() => sortMemoriesByRecency(memories.value));

const searchQuery = ref('');
const searchResults = ref([]);
const searching = shallowRef(false);
const inSearch = computed(() => !!searchQuery.value.trim());
const displayed = computed(() => (inSearch.value ? searchResults.value : sortedMemories.value));

async function fetchMemories() {
  loading.value = true;
  try {
    memories.value = await agentApi.listMemory({ lineId: props.lineId, productId: props.productId });
  } finally {
    loading.value = false;
  }
}

async function runSearch() {
  if (!searchQuery.value.trim()) {
    searchResults.value = [];
    return;
  }
  searching.value = true;
  try {
    searchResults.value = await agentApi.searchMemory({
      lineId: props.lineId,
      productId: props.productId,
      q: searchQuery.value.trim(),
      k: 8,
    });
  } finally {
    searching.value = false;
  }
}

function clearSearch() {
  searchQuery.value = '';
  searchResults.value = [];
}

async function removeMemory(id) {
  deletingId.value = id;
  try {
    await agentApi.deleteMemory(id);
    memories.value = memories.value.filter((m) => m._id !== id);
    searchResults.value = searchResults.value.filter((m) => m._id !== id);
  } finally {
    deletingId.value = null;
  }
}

async function clearAll() {
  const ok = await confirmDialog({
    title: t('labels.memory_confirm_clear_title'),
    message: t('labels.memory_confirm_clear_message'),
    tone: 'danger',
  });
  if (!ok) return;
  clearing.value = true;
  try {
    await agentApi.clearMemory({ lineId: props.lineId, productId: props.productId });
    memories.value = [];
  } finally {
    clearing.value = false;
  }
}

function openAddDialog() {
  addForm.value = { kind: 'lesson', content: '' };
  addDialog.value = true;
}

async function submitAddMemory() {
  if (!addForm.value.content.trim()) return;
  adding.value = true;
  try {
    const mem = await agentApi.addMemory({
      lineId: props.lineId,
      productId: props.productId,
      kind: addForm.value.kind,
      content: addForm.value.content.trim(),
    });
    memories.value.push(mem);
    addDialog.value = false;
  } finally {
    adding.value = false;
  }
}

onMounted(fetchMemories);
</script>

<template>
  <div class="amc">
    <div class="amc__header">
      <div class="amc__title"><i class="pi pi-sparkles" aria-hidden="true"></i> {{ t('labels.memory_title') }}</div>
      <div class="amc__actions">
        <Button text rounded icon="pi pi-comment-plus" :title="t('labels.memory_add_note')" @click="openAddDialog" />
        <Button v-if="memories.length" text rounded icon="pi pi-trash" :loading="clearing" :title="t('labels.memory_clear_all_tooltip')" @click="clearAll" />
        <Button text rounded icon="pi pi-refresh" :loading="loading" :title="t('labels.refresh')" @click="fetchMemories" />
      </div>
    </div>

    <Dialog v-model:visible="addDialog" modal :header="t('labels.memory_add_dialog_title')" class="amc__add-dialog">
      <Select
        v-model="addForm.kind"
        :options="kindOptions"
        option-label="label"
        option-value="value"
        class="amc__field"
      />
      <Textarea v-model="addForm.content" auto-resize rows="4" class="amc__field" :placeholder="t('labels.memory_content')" />
      <p v-if="!addForm.content.trim()" class="amc__field-hint">{{ t('labels.memory_content_required') }}</p>
      <template #footer>
        <Button :label="t('labels.cancel')" text @click="addDialog = false" />
        <Button :label="t('labels.save')" :loading="adding" :disabled="!addForm.content.trim()" @click="submitAddMemory" />
      </template>
    </Dialog>

    <div class="amc__search">
      <span class="amc__search-field">
        <i class="pi pi-compass amc__search-icon" aria-hidden="true"></i>
        <InputText
          v-model="searchQuery"
          class="amc__search-input"
          :placeholder="t('labels.recall_placeholder')"
          @keyup.enter="runSearch"
        />
        <button v-if="searchQuery" type="button" class="amc__search-clear" :title="t('labels.cancel')" @click="clearSearch">
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </span>
      <Button text rounded icon="pi pi-search" :disabled="!searchQuery" :loading="searching" @click="runSearch" />
    </div>
    <p v-if="inSearch" class="amc__search-hint">{{ t('labels.recall_hint') }}</p>

    <EsqueletoLista v-if="loading && !memories.length" :filas="3" />
    <div v-else-if="inSearch && !displayed.length" class="amc__state">
      <i class="pi pi-search-minus" aria-hidden="true"></i> {{ t('labels.recall_empty') }}
    </div>
    <div v-else-if="!displayed.length" class="amc__state">
      <i class="pi pi-book" aria-hidden="true"></i> {{ t('labels.memory_empty') }}
    </div>

    <ul v-else class="amc__list">
      <li v-for="mem in displayed" :key="mem._id" class="amc__item">
        <div class="amc__item-body">
          <div class="amc__item-header">
            <span class="amc__badge">{{ kindLabel(mem.kind) }}</span>
            <span class="amc__item-meta">{{ mem.agentType }} · {{ formattedDate(mem.createdAt) }}</span>
          </div>
          <div class="amc__item-content">{{ mem.content }}</div>
        </div>
        <div class="amc__item-side">
          <span v-if="inSearch && scorePercent(mem.score) !== null" class="amc__score">{{ scorePercent(mem.score) }}%</span>
          <Button text rounded size="small" icon="pi pi-trash" :loading="deletingId === mem._id" :title="t('labels.memory_forget')" @click="removeMemory(mem._id)" />
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.amc {
  border: 1px solid var(--p-content-border-color);
  border-radius: 7px;
  background: var(--p-content-background);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.amc__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.amc__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--p-text-color);
}

.amc__title i {
  color: var(--p-agent-color);
}

.amc__actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.amc__field {
  width: 100%;
  margin-bottom: 10px;
}

.amc__field-hint {
  margin: -6px 0 8px;
  font-size: 11px;
  color: var(--status-bad);
}

.amc__search {
  display: flex;
  align-items: center;
  gap: 6px;
}

.amc__search-field {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
}

.amc__search-icon {
  position: absolute;
  left: 10px;
  color: var(--p-text-dim-color);
  font-size: 13px;
  pointer-events: none;
}

.amc__search-input {
  width: 100%;
  padding-left: 30px;
  padding-right: 26px;
}

.amc__search-clear {
  position: absolute;
  right: 8px;
  border: none;
  background: transparent;
  color: var(--p-text-dim-color);
  cursor: pointer;
  display: flex;
  align-items: center;
}

.amc__search-hint {
  margin: -4px 0 0;
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.amc__state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 4px;
  color: var(--p-text-muted-color);
  font-size: 12.5px;
}

.amc__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.amc__item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--p-content-hover-background);
}

.amc__item:last-child {
  border-bottom: none;
}

.amc__item-body {
  flex: 1;
  min-width: 0;
}

.amc__item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.amc__badge {
  padding: 1px 8px;
  border-radius: 20px;
  background: var(--p-agent-highlight);
  color: var(--p-agent-color);
  font-size: 10.5px;
}

.amc__item-meta {
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.amc__item-content {
  font-size: 12.5px;
  color: var(--p-text-secondary-color);
  line-height: 1.5;
}

.amc__item-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex: none;
}

.amc__score {
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 20px;
  background: var(--p-agent-highlight);
  color: var(--p-agent-color);
}
</style>
