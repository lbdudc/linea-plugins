<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { lineDiff } from '../../activity/diffUtils.js';

const { t } = useI18n();

const props = defineProps({
  oldText: { type: String, default: '' },
  newText: { type: String, default: '' },
  // When set, switches to the three-way layout.
  theirsText: { type: String, default: null },
  threeWay: { type: Boolean, default: false },
});

const oursRows = computed(() => lineDiff(props.oldText, props.newText));
const theirsRows = computed(() => lineDiff(props.theirsText ?? '', props.newText));
const isThreeWay = computed(() => props.threeWay && props.theirsText != null);
const prefix = (type) => (type === 'add' ? '+ ' : type === 'del' ? '- ' : '  ');
</script>

<template>
  <div v-if="isThreeWay" class="diff3">
    <div class="diff3__col">
      <div class="diff3__head">{{ t('labels.diff_ours_proposed') }}</div>
      <div class="diff">
        <div v-for="(r, i) in oursRows" :key="i" class="diff-line" :class="`diff-${r.type}`">{{ prefix(r.type) }}{{ r.text }}</div>
      </div>
    </div>
    <div class="diff3__col">
      <div class="diff3__head">{{ t('labels.diff_theirs_proposed') }}</div>
      <div class="diff">
        <div v-for="(r, i) in theirsRows" :key="i" class="diff-line" :class="`diff-${r.type}`">{{ prefix(r.type) }}{{ r.text }}</div>
      </div>
    </div>
  </div>
  <div v-else class="diff">
    <div v-for="(r, i) in oursRows" :key="i" class="diff-line" :class="`diff-${r.type}`">{{ prefix(r.type) }}{{ r.text }}</div>
  </div>
</template>

<style scoped>
.diff {
  font-family: 'Fira Code', 'Courier New', monospace;
  font-size: 0.78rem;
  line-height: 1.45;
  overflow-x: auto;
}

.diff-line {
  white-space: pre;
  padding: 0 8px;
}

.diff-add {
  background: var(--status-ok-soft);
  color: var(--diff-add-text);
}

.diff-del {
  background: var(--status-bad-soft);
  color: var(--diff-del-text);
}

.diff-ctx {
  color: var(--p-text-muted-color);
}

.diff3 {
  display: flex;
  flex-wrap: nowrap;
  min-width: 0;
  width: 100%;
}

.diff3__col {
  flex: 1 1 0;
  min-width: 0;
  border-right: 1px solid var(--p-content-border-color);
}

.diff3__col:last-child {
  border-right: none;
}

.diff3__head {
  padding: 4px 8px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
  background: var(--p-content-hover-background);
  position: sticky;
  top: 0;
}
</style>
