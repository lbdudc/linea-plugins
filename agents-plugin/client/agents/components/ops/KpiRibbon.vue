<script setup>
import Esqueleto from '../common/Esqueleto.vue';

defineProps({
  items: { type: Array, required: true },
  cargando: { type: Boolean, default: false },
});
</script>

<template>
  <div class="kpi-ribbon">
    <div v-for="(item, i) in items" :key="item.label" class="kpi-ribbon__item" :class="{ 'kpi-ribbon__item--first': i === 0 }">
      <Esqueleto v-if="cargando" ancho="58px" alto="26px" radio="5px" class="kpi-ribbon__esqueleto" />
      <span v-else class="kpi-ribbon__value cifra" :style="item.colorVar ? { color: `var(${item.colorVar})` } : null">
        {{ item.value }}
      </span>
      <span class="kpi-ribbon__label rotulo">{{ item.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.kpi-ribbon__esqueleto {
  margin: 4px 0 7px;
}

.kpi-ribbon {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  border-top: 1px solid var(--p-content-border-color);
  border-bottom: 1px solid var(--p-content-border-color);
}

.kpi-ribbon__item {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 18px 0 18px 24px;
  border-left: 1px solid var(--p-content-hover-background);
}

.kpi-ribbon__item--first {
  padding-left: 0;
  border-left-color: transparent;
}

.kpi-ribbon__value {
  font-size: 30px;
  color: var(--p-text-color);
}

.kpi-ribbon__label {
  white-space: nowrap;
}
</style>
