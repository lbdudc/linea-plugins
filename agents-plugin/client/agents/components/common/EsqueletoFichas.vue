<script setup>
import { useI18n } from 'vue-i18n';

import Esqueleto from './Esqueleto.vue';

// Tarjetas sueltas para rellenar una columna de tablero mientras carga.
defineProps({
  fichas: { type: Number, default: 2 },
});

const { t } = useI18n();
</script>

<template>
  <div class="esq-fichas" role="status" aria-busy="true" :aria-label="t('labels.loading')">
    <article v-for="n in fichas" :key="n" class="esq-fichas__ficha">
      <Esqueleto ancho="68%" alto="11px" />
      <Esqueleto ancho="44%" alto="8px" />
    </article>
  </div>
</template>

<style scoped>
.esq-fichas {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.esq-fichas__ficha {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 13px;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
}
</style>
