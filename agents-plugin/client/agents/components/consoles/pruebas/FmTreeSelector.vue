<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { collectMandatory, sameSelection, toDisplayTree, withMandatory } from './fmTreeSelection.js';
import FmTreeNode from './FmTreeNode.vue';

const props = defineProps({
  tree: { type: Object, default: null },
  modelValue: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue']);
const { t } = useI18n();

const displayTree = computed(() => toDisplayTree(props.tree));
const mandatoryNames = computed(() => collectMandatory(props.tree));

const ticked = ref([]);

const initTicked = () => {
  ticked.value = withMandatory(props.modelValue, mandatoryNames.value);
};

onMounted(initTicked);

watch(() => props.tree, initTicked);

watch(() => props.modelValue, (nv) => {
  const merged = withMandatory(nv, mandatoryNames.value);
  if (!sameSelection(merged, ticked.value)) ticked.value = merged;
});

watch(ticked, (nv) => {
  emit('update:modelValue', withMandatory(nv, mandatoryNames.value));
}, { deep: true });

const toggle = (name) => {
  if (props.disabled) return;
  if (mandatoryNames.value.includes(name)) return;
  const idx = ticked.value.indexOf(name);
  if (idx >= 0) ticked.value = ticked.value.filter((n) => n !== name);
  else ticked.value = [...ticked.value, name];
};
</script>

<template>
  <div class="fm-tree-selector">
    <p v-if="!tree" class="fm-tree-selector__empty">{{ t('labels.fm_not_available_for_run') }}</p>
    <ul v-else class="fm-tree-selector__root">
      <FmTreeNode
        v-for="node in displayTree"
        :key="node.id"
        :node="node"
        :ticked="ticked"
        :disabled="disabled"
        @toggle="toggle"
      />
    </ul>
  </div>
</template>

<style scoped>
.fm-tree-selector {
  font-size: 12.5px;
}

.fm-tree-selector__empty {
  margin: 0;
  padding: 8px 0;
  color: var(--p-text-dim-color);
}

.fm-tree-selector__root {
  margin: 0;
  padding: 0;
}
</style>
