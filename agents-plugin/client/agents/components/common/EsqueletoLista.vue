<script setup>
import { useI18n } from 'vue-i18n';

import Esqueleto from './Esqueleto.vue';

defineProps({
  filas: { type: Number, default: 5 },
  punto: { type: Boolean, default: true },
  encuadrada: { type: Boolean, default: false },
});

const { t } = useI18n();

// Anchos fijos y repetidos a proposito: un ancho aleatorio cambiaria en cada
// render y haria parpadear la lista mientras carga.
const ANCHOS = ['72%', '54%', '64%', '46%', '68%', '58%'];
const ancho = (n) => ANCHOS[(n - 1) % ANCHOS.length];
</script>

<template>
  <ul
    class="esq-lista"
    :class="{ 'esq-lista--encuadrada': encuadrada }"
    role="status"
    aria-busy="true"
    :aria-label="t('labels.loading')"
  >
    <li v-for="n in filas" :key="n" class="esq-lista__fila">
      <Esqueleto v-if="punto" ancho="8px" alto="8px" radio="50%" />
      <div class="esq-lista__texto">
        <Esqueleto :ancho="ancho(n)" alto="11px" />
        <Esqueleto ancho="34%" alto="8px" />
      </div>
    </li>
  </ul>
</template>

<style scoped>
.esq-lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.esq-lista--encuadrada {
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
}

.esq-lista__fila {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.esq-lista__fila:last-child {
  border-bottom: none;
}

.esq-lista__texto {
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex: 1;
  min-width: 0;
}
</style>
