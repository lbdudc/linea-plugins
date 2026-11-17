<script setup>
import { useI18n } from 'vue-i18n';

import PruebasConsole from '../components/consoles/pruebas/PruebasConsole.vue';

const { t } = useI18n();
</script>

<template>
  <section class="pruebas-page">
    <header class="pruebas-page__cab">
      <p class="rotulo">{{ t('labels.section_workspace') }}</p>
      <h1 class="cifra pruebas-page__titulo">{{ t('labels.pruebas_page_title') }}</h1>
      <p class="pruebas-page__hint">{{ t('labels.pruebas_page_hint') }}</p>
    </header>

    <PruebasConsole />
  </section>
</template>

<style scoped>
.pruebas-page {
  padding: 24px 32px 40px;
}

.pruebas-page__cab {
  margin-bottom: 20px;
}

.pruebas-page__titulo {
  font-size: 32px;
  margin: 2px 0 6px;
}

.pruebas-page__hint {
  margin: 0;
  font-size: 13px;
  color: var(--p-text-muted-color);
  max-width: 640px;
}
</style>
