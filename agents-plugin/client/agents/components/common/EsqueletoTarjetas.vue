<script setup>
import { useI18n } from 'vue-i18n';

import Esqueleto from './Esqueleto.vue';

defineProps({
  tarjetas: { type: Number, default: 3 },
  minimo: { type: String, default: '220px' },
  barra: { type: Boolean, default: false },
});

const { t } = useI18n();
</script>

<template>
  <div
    class="esq-tarjetas"
    :style="{ gridTemplateColumns: `repeat(auto-fit, minmax(${minimo}, 1fr))` }"
    role="status"
    aria-busy="true"
    :aria-label="t('labels.loading')"
  >
    <article v-for="n in tarjetas" :key="n" class="esq-tarjetas__tarjeta">
      <Esqueleto ancho="96px" alto="9px" />
      <Esqueleto ancho="64px" alto="26px" radio="5px" />
      <Esqueleto v-if="barra" alto="7px" radio="4px" />
      <Esqueleto ancho="78%" alto="9px" />
    </article>
  </div>
</template>

<style scoped>
.esq-tarjetas {
  display: grid;
  gap: 14px;
}

.esq-tarjetas__tarjeta {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 16px 18px;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
}
</style>
