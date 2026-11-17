<script setup>
defineProps({
  ancho: { type: String, default: '100%' },
  alto: { type: String, default: '13px' },
  radio: { type: String, default: '4px' },
});
</script>

<template>
  <span class="esqueleto" :style="{ width: ancho, height: alto, borderRadius: radio }" aria-hidden="true"></span>
</template>

<style scoped>
.esqueleto {
  display: block;
  flex: none;
  background: var(--p-content-hover-background);
  animation: esqueleto-latido 1.5s ease-in-out infinite;
}

@keyframes esqueleto-latido {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.45;
  }
}

@media (prefers-reduced-motion: reduce) {
  .esqueleto {
    animation: none;
    opacity: 0.7;
  }
}
</style>
