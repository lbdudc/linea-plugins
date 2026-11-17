import { createI18n } from 'vue-i18n';
import PrimeVue from 'primevue/config';

import messages from 'src/i18n/index.js';

let instancia = null;

export function createTestI18n() {
  if (!instancia) {
    instancia = createI18n({
      legacy: false,
      locale: 'es',
      fallbackLocale: 'en',
      messages,
    });
  }
  return instancia;
}

export function mountGlobalPlugins() {
  return [createTestI18n(), PrimeVue];
}
