<script setup>
import { useI18n } from 'vue-i18n';

import Esqueleto from './Esqueleto.vue';

defineProps({
  columnas: { type: Number, default: 4 },
  // Cuantas tarjetas lleva cada columna. Desiguales a proposito: un tablero
  // real casi nunca esta equilibrado y un esqueleto plano parece una tabla.
  reparto: { type: Array, default: () => [2, 1, 2, 1, 1] },
});

const { t } = useI18n();
</script>

<template>
  <div class="esq-tablero" role="status" aria-busy="true" :aria-label="t('labels.loading')">
    <section v-for="c in columnas" :key="c" class="esq-tablero__col">
      <header class="esq-tablero__cab">
        <Esqueleto ancho="84px" alto="9px" />
        <Esqueleto ancho="18px" alto="9px" radio="5px" />
      </header>
      <article v-for="n in (reparto[(c - 1) % reparto.length] ?? 1)" :key="n" class="esq-tablero__tarjeta">
        <Esqueleto ancho="66%" alto="11px" />
        <Esqueleto ancho="42%" alto="8px" />
      </article>
    </section>
  </div>
</template>

<style scoped>
.esq-tablero {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  align-items: start;
}

.esq-tablero__col {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}

.esq-tablero__cab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.esq-tablero__tarjeta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 13px;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
}
</style>
