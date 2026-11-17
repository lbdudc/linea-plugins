<script setup>
import Checkbox from 'primevue/checkbox';

const props = defineProps({
  node: { type: Object, required: true },
  ticked: { type: Array, required: true },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['toggle']);

const isChecked = (name) => props.ticked.includes(name);
</script>

<template>
  <li class="fm-node">
    <div class="fm-node__row">
      <Checkbox
        :model-value="isChecked(node.id)"
        :binary="true"
        :disabled="disabled || node.mandatory"
        @update:model-value="emit('toggle', node.id)"
      />
      <span class="fm-node__label" :class="{ 'fm-node__label--mandatory': node.mandatory }">{{ node.label }}</span>
      <span v-if="node.fmType !== 'AND' && node.fmType !== 'FEATURE'" class="fm-node__badge">{{ node.fmType }}</span>
      <i v-if="node.mandatory" class="pi pi-lock fm-node__lock" :title="$t('labels.mandatory_feature_tooltip')" aria-hidden="true"></i>
    </div>
    <ul v-if="node.children.length" class="fm-node__children">
      <FmTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :ticked="ticked"
        :disabled="disabled"
        @toggle="(name) => emit('toggle', name)"
      />
    </ul>
  </li>
</template>

<style scoped>
.fm-node {
  list-style: none;
}

.fm-node__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}

.fm-node__label {
  font-size: 12.5px;
  color: var(--p-text-color);
}

.fm-node__label--mandatory {
  font-weight: 600;
  text-decoration: underline;
  text-decoration-style: dotted;
}

.fm-node__badge {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--p-content-border-color);
  color: var(--p-text-muted-color);
}

.fm-node__lock {
  font-size: 10.5px;
  color: var(--p-text-dim-color);
}

.fm-node__children {
  margin: 0;
  padding-left: 20px;
  border-left: 1px dashed var(--p-content-border-color);
}
</style>
