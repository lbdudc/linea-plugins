import { ref, watch } from 'vue';

import { useTheme } from '../../composables/useTheme.js';

const NOMBRES = [
  '--status-ok-solid',
  '--status-warn-solid',
  '--status-bad-solid',
  '--status-serious',
  '--p-text-dim-color',
  '--p-text-faint-color',
  '--p-content-border-color',
  '--p-surface-ground',
  '--chart-1',
  '--chart-2',
];

function leerTokens() {
  if (typeof window === 'undefined') return {};
  const estilo = getComputedStyle(document.documentElement);
  const valores = {};
  for (const nombre of NOMBRES) valores[nombre] = estilo.getPropertyValue(nombre).trim();
  return valores;
}

export function useOpsChartColors() {
  const { tema } = useTheme();
  const colores = ref(leerTokens());
  watch(tema, () => {
    colores.value = leerTokens();
  });
  return colores;
}
