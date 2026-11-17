<script setup>
import { useI18n } from 'vue-i18n';

import MemoryConsole from '../components/consoles/memoria/MemoryConsole.vue';

const { t } = useI18n();
</script>

<template>
  <section class="memoria">
    <header class="memoria__cab">
      <p class="rotulo">{{ t('labels.section_workspace') }}</p>
      <h1 class="cifra memoria__titulo">{{ t('labels.tab_memory') }}</h1>
    </header>

    <MemoryConsole />
  </section>
</template>

<style scoped>
.memoria {
  padding: 24px 32px 40px;
}

.memoria__titulo {
  font-size: 32px;
  margin: 2px 0 20px;
}
</style>
