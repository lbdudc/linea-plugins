<script setup>
import ToggleSwitch from 'primevue/toggleswitch';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import AutonomyModeCards from './AutonomyModeCards.vue';

const { t } = useI18n();

const props = defineProps({
  entry: { type: Object, default: null },
  copy: { type: Object, default: null },
  atProduct: { type: Boolean, default: false },
  mode: { type: String, default: null },
  modoDisponible: { type: Boolean, default: false },
  savingEnabled: { type: Boolean, default: false },
  savingMode: { type: Boolean, default: false },
  savingReset: { type: Boolean, default: false },
  memoryLabel: { type: String, default: '—' },
});
const emit = defineEmits(['toggle-enabled', 'change-mode', 'reset-to-line']);

const nombre = computed(() => props.copy?.name ?? props.entry?.title ?? props.entry?.type ?? '');
const descripcion = computed(() => props.copy?.desc ?? props.entry?.description ?? '');
const activo = computed(() => !!props.entry?.config?.enabled);
const sobrescribeLinea = computed(() => props.atProduct && !!props.entry?.productConfig);

function onToggle(valor) {
  emit('toggle-enabled', valor);
}
</script>

<template>
  <div v-if="entry" class="detail">
    <div
      v-if="atProduct"
      class="detail__herencia"
      :class="sobrescribeLinea ? 'detail__herencia--sobrescribe' : 'detail__herencia--hereda'"
    >
      <span>
        {{
          sobrescribeLinea
            ? t('labels.config_override_banner')
            : t('labels.detail_inherit_note')
        }}
      </span>
      <button
        v-if="sobrescribeLinea"
        type="button"
        class="detail__herencia-boton"
        :disabled="savingReset"
        @click="emit('reset-to-line')"
      >
        {{ t('labels.config_reset') }}
      </button>
    </div>

    <div class="detail__cabecera">
      <div class="detail__titulos">
        <h2 class="detail__titulo cifra">{{ nombre }}</h2>
        <p class="detail__desc">{{ descripcion }}</p>
      </div>
      <div class="detail__activo">
        <span class="detail__activo-etiqueta" :class="{ 'detail__activo-etiqueta--on': activo }">
          {{ activo ? t('labels.config_status_on') : t('labels.mode_disabled_label') }}
        </span>
        <ToggleSwitch
          :model-value="activo"
          :disabled="savingEnabled"
          :aria-label="t('labels.detail_active_toggle_aria')"
          @update:model-value="onToggle"
        />
      </div>
    </div>

    <AutonomyModeCards
      :model-value="mode ?? 'semi'"
      :disabled="!modoDisponible"
      :saving="savingMode"
      @update:model-value="(m) => emit('change-mode', m)"
    />

    <div v-if="copy" class="detail__cuerpo">
      <div class="detail__columna">
        <div class="detail__seccion-header">
          <span class="rotulo">{{ t('labels.detail_steps_header') }}</span>
          <div class="detail__regla" aria-hidden="true"></div>
        </div>
        <div class="detail__pasos">
          <div v-for="(paso, i) in copy.steps" :key="i" class="detail__paso">
            <span class="detail__paso-n ident">{{ i + 1 }}.</span>
            <span class="detail__paso-texto">{{ paso }}</span>
          </div>
        </div>

        <div class="detail__seccion-header detail__seccion-header--espaciada">
          <span class="rotulo">{{ t('labels.detail_touches_header') }}</span>
          <div class="detail__regla" aria-hidden="true"></div>
        </div>
        <div class="detail__chips">
          <span v-for="toque in copy.touches" :key="toque" class="detail__chip ident">{{ toque }}</span>
        </div>
      </div>

      <div class="detail__columna detail__columna--lateral">
        <div>
          <div class="detail__seccion-header">
            <span class="rotulo">{{ t('labels.detail_limits_header') }}</span>
            <div class="detail__regla" aria-hidden="true"></div>
          </div>
          <div v-for="l in copy.limits" :key="l.k" class="detail__limite">
            <span class="detail__limite-k">{{ l.k }}</span>
            <span class="detail__limite-v ident">{{ l.v }}</span>
          </div>
        </div>

        <div class="detail__memoria">
          <div class="detail__memoria-cabecera">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="stroke: var(--p-agent-color)" aria-hidden="true">
              <path d="M12 5a4 4 0 0 0-4 4c-2 1-2 4 0 5v3a2 2 0 0 0 4 0z"></path>
              <path d="M12 5a4 4 0 0 1 4 4c2 1 2 4 0 5v3a2 2 0 0 1-4 0z"></path>
            </svg>
            <span class="detail__memoria-titulo">{{ t('labels.detail_line_memory_title') }}</span>
            <span class="detail__memoria-cuenta ident">{{ memoryLabel }}</span>
          </div>
          <span class="detail__memoria-texto">
            {{ t('labels.detail_line_memory_text') }}
          </span>
        </div>
      </div>

      <slot />
    </div>
  </div>

  <div v-else class="detail detail--vacio">
    <span>{{ t('labels.detail_empty_hint') }}</span>
  </div>
</template>

<style scoped>
.detail {
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 26px 32px 32px;
}

.detail--vacio {
  align-items: center;
  justify-content: center;
  color: var(--p-text-muted-color);
  font-size: 13px;
}

.detail__herencia {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 5px;
  font-size: 12px;
  margin-bottom: 16px;
}

.detail__herencia--hereda {
  background: var(--p-highlight-soft);
  color: var(--p-text-secondary-color);
}

.detail__herencia--sobrescribe {
  background: var(--status-warn-soft);
  color: var(--p-text-color);
}

.detail__herencia-boton {
  margin-left: auto;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--p-agent-color);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  padding: 0;
}

.detail__herencia-boton:hover {
  color: var(--p-agent-hover-color);
  text-decoration: underline;
}

.detail__cabecera {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 22px;
}

.detail__titulos {
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.detail__titulo {
  margin: 0;
  font-size: 28px;
  line-height: 1.15;
  color: var(--p-text-color);
}

.detail__desc {
  margin: 0;
  font-size: 14px;
  color: var(--p-text-muted-color);
  line-height: 1.6;
  max-width: 720px;
}

.detail__activo {
  display: flex;
  align-items: center;
  gap: 11px;
  flex-shrink: 0;
  padding-top: 6px;
}

.detail__activo-etiqueta {
  font-size: 12.5px;
  color: var(--p-text-dim-color);
}

.detail__activo-etiqueta--on {
  color: var(--status-ok-strong);
}

.detail__cuerpo {
  flex-grow: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 32px;
}

.detail__columna {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.detail__columna--lateral {
  gap: 20px;
}

.detail__seccion-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.detail__seccion-header--espaciada {
  margin-top: 22px;
}

.detail__regla {
  flex-grow: 1;
  height: 1px;
  background: var(--p-content-hover-background);
}

.detail__pasos {
  display: flex;
  flex-direction: column;
}

.detail__paso {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid var(--p-content-hover-background);
}

.detail__paso-n {
  font-size: 12px;
  color: var(--p-text-faint-color);
  flex-shrink: 0;
  margin-top: 2px;
}

.detail__paso-texto {
  font-size: 13.5px;
  color: var(--p-text-secondary-color);
  line-height: 1.55;
}

.detail__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.detail__chip {
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 4px;
  background: var(--p-content-hover-background);
  color: var(--p-text-secondary-color);
}

.detail__limite {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid var(--p-content-hover-background);
}

.detail__limite-k {
  font-size: 12.5px;
  color: var(--p-text-muted-color);
  flex-grow: 1;
  min-width: 0;
}

.detail__limite-v {
  font-size: 12.5px;
  color: var(--p-text-color);
}

.detail__memoria {
  border: 1px solid var(--p-content-border-color);
  border-radius: 7px;
  background: var(--p-content-background);
  padding: 15px 16px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.detail__memoria-cabecera {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail__memoria-titulo {
  font-size: 13px;
  font-weight: 500;
  flex-grow: 1;
  color: var(--p-text-color);
}

.detail__memoria-cuenta {
  font-size: 11px;
  color: var(--p-text-dim-color);
}

.detail__memoria-texto {
  font-size: 12.5px;
  color: var(--p-text-muted-color);
  line-height: 1.55;
}
</style>
