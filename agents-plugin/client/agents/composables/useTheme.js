import { computed } from 'vue';
import { useTheme as useLineaTheme } from 'src/composables/useTheme';

/** The theme is LINEA's (its top bar switches it); these pages only read it, in the words they have always used. */
export function useTheme() {
  const { isDark, toggleTheme } = useLineaTheme();
  return { tema: computed(() => (isDark.value ? 'oscuro' : 'claro')), alternar: toggleTheme };
}
