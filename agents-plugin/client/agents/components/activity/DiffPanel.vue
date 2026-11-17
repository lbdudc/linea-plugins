<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { lineDiff } from './diffUtils.js';

const props = defineProps({
  files: { type: Array, default: () => [] },
});

const { t } = useI18n();

const sign = (type) => (type === 'add' ? '+' : type === 'del' ? '-' : '');

const panels = computed(() =>
  (props.files ?? []).map((f) => {
    const rows = lineDiff(f.oldContent ?? '', f.newContent ?? '').map((r) => ({ ...r, sign: sign(r.type) }));
    return {
      path: f.path ?? t('labels.diff_no_path'),
      added: rows.filter((r) => r.type === 'add').length,
      removed: rows.filter((r) => r.type === 'del').length,
      rows,
    };
  }),
);
</script>

<template>
  <div v-for="panel in panels" :key="panel.path" class="diff">
    <div class="diff__cabecera">
      <span class="diff__ruta ident">{{ panel.path }}</span>
      <span class="diff__contador diff__contador--add ident">+{{ panel.added }}</span>
      <span class="diff__contador diff__contador--del ident">-{{ panel.removed }}</span>
    </div>
    <div class="diff__cuerpo">
      <div
        v-for="(row, i) in panel.rows"
        :key="i"
        class="diff__fila"
        :class="`diff__fila--${row.type}`"
      >
        <span class="diff__signo ident" aria-hidden="true">{{ row.sign }}</span>
        <span class="diff__texto ident">{{ row.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff {
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--code-bg);
  overflow: hidden;
}

.diff + .diff {
  margin-top: 10px;
}

.diff__cabecera {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 15px;
  border-bottom: 1px solid var(--p-content-hover-background);
}

.diff__ruta {
  font-size: 12px;
  color: var(--p-text-secondary-color);
}

.diff__contador {
  margin-left: auto;
  font-size: 11px;
}

.diff__contador--add {
  margin-left: auto;
  color: var(--status-ok-strong);
}

.diff__contador--del {
  color: var(--status-bad-strong);
}

.diff__cuerpo {
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
}

.diff__fila {
  display: flex;
  gap: 12px;
  padding: 0 15px;
  white-space: pre;
}

.diff__fila--add {
  background: var(--status-ok-soft);
}

.diff__fila--del {
  background: var(--status-bad-soft);
}

.diff__signo {
  flex-shrink: 0;
  width: 14px;
  color: var(--p-text-faint-color);
}

.diff__fila--add .diff__texto {
  color: var(--diff-add-text);
}

.diff__fila--del .diff__texto {
  color: var(--diff-del-text);
}

.diff__fila--ctx .diff__texto {
  color: var(--p-text-muted-color);
}
</style>
