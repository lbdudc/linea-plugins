<script setup>
import { useI18n } from 'vue-i18n';

import Esqueleto from './Esqueleto.vue';

defineProps({
  alto: { type: String, default: '150px' },
});

const { t } = useI18n();

// Alturas fijas: un perfil aleatorio cambiaria en cada render y el grafico
// parpadearia mientras carga.
const BARRAS = [38, 62, 30, 78, 52, 44, 70, 34, 58, 48, 66, 40];
</script>

<template>
  <div class="esq-grafico" :style="{ height: alto }" role="status" aria-busy="true" :aria-label="t('labels.loading')">
    <div v-for="(h, i) in BARRAS" :key="i" class="esq-grafico__hueco">
      <Esqueleto :alto="`${h}%`" radio="3px" />
    </div>
  </div>
</template>

<style scoped>
.esq-grafico {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 4px 0 0;
  border-bottom: 1px solid var(--p-content-border-color);
}

.esq-grafico__hueco {
  display: flex;
  align-items: flex-end;
  flex: 1;
  height: 100%;
  min-width: 0;
}
</style>
