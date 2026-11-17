<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import ToggleSwitch from 'primevue/toggleswitch';

import AgentInputFields from '../consoles/pruebas/AgentInputFields.vue';

const { t } = useI18n();

const props = defineProps({
  entry: { type: Object, required: true },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['save']);

const vacio = () => ({
  instructions: '',
  defaultInput: {},
  memoryRead: 'product_line',
  memoryWrite: 'auto',
  triggers: { webhook: false, schedule: '' },
});

const form = reactive(vacio());
const tocado = ref(false);

const opcionesLectura = computed(() => [
  { value: 'product_line', label: t('labels.config_memory_read_product_line') },
  { value: 'product', label: t('labels.config_memory_read_product') },
  { value: 'none', label: t('labels.config_memory_read_none') },
]);

const opcionesEscritura = computed(() => [
  { value: 'run', label: t('labels.config_memory_write_run') },
  { value: 'product', label: t('labels.config_memory_write_product') },
  { value: 'line', label: t('labels.config_memory_write_line') },
  { value: 'auto', label: t('labels.config_memory_write_auto') },
  { value: 'off', label: t('labels.config_memory_write_off') },
]);

watch(
  () => props.entry,
  (entrada) => {
    const c = entrada?.config ?? {};
    Object.assign(form, vacio(), {
      instructions: c.instructions ?? '',
      defaultInput: { ...(c.defaultInput ?? {}) },
      memoryRead: c.memoryRead ?? 'product_line',
      memoryWrite: c.memoryWrite ?? 'auto',
      triggers: {
        webhook: Boolean(c.triggers?.webhook),
        schedule: c.triggers?.schedule ?? '',
      },
    });
    tocado.value = false;
  },
  { immediate: true, deep: true },
);

const tocar = () => {
  tocado.value = true;
};

function guardar() {
  emit('save', {
    type: props.entry.type,
    config: {
      ...form,
      defaultInput: { ...form.defaultInput },
      triggers: { ...form.triggers },
    },
  });
  tocado.value = false;
}

function onDefaultInputChange(valor) {
  form.defaultInput = valor;
  tocar();
}
</script>

<template>
  <section class="cfg">
    <div class="cfg__campo">
      <label class="cfg__etiqueta" for="cfg-instrucciones">{{ t('labels.config_instructions') }}</label>
      <p class="cfg__pista">{{ t('labels.config_instructions_hint') }}</p>
      <Textarea
        id="cfg-instrucciones"
        v-model="form.instructions"
        rows="3"
        auto-resize
        class="cfg__textarea"
        @update:model-value="tocar"
      />
    </div>

    <div class="cfg__campo">
      <p class="cfg__etiqueta">{{ t('labels.config_default_inputs') }}</p>
      <AgentInputFields :agent-type="entry.type" :model-value="form.defaultInput" @update:model-value="onDefaultInputChange" />
    </div>

    <div class="cfg__campo">
      <p class="cfg__etiqueta">{{ t('labels.config_memory') }}</p>
      <p class="cfg__pista">{{ t('labels.config_memory_hint') }}</p>
      <div class="cfg__dos">
        <div>
          <label class="cfg__sub" for="cfg-mem-lee">{{ t('labels.config_memory_read') }}</label>
          <Select
            id="cfg-mem-lee"
            v-model="form.memoryRead"
            :options="opcionesLectura"
            option-label="label"
            option-value="value"
            class="cfg__select"
            @update:model-value="tocar"
          />
        </div>
        <div>
          <label class="cfg__sub" for="cfg-mem-escribe">{{ t('labels.config_memory_write') }}</label>
          <Select
            id="cfg-mem-escribe"
            v-model="form.memoryWrite"
            :options="opcionesEscritura"
            option-label="label"
            option-value="value"
            class="cfg__select"
            @update:model-value="tocar"
          />
        </div>
      </div>
    </div>

    <div class="cfg__campo">
      <p class="cfg__etiqueta">{{ t('labels.config_triggers') }}</p>
      <div class="cfg__disparadores">
        <div class="cfg__webhook">
          <ToggleSwitch v-model="form.triggers.webhook" input-id="cfg-webhook" @update:model-value="tocar" />
          <label for="cfg-webhook">{{ t('labels.config_trigger_webhook') }}</label>
        </div>
        <div class="cfg__horario">
          <label class="cfg__sub" for="cfg-schedule">{{ t('labels.config_trigger_schedule') }}</label>
          <InputText
            id="cfg-schedule"
            v-model="form.triggers.schedule"
            class="cfg__valor"
            @update:model-value="tocar"
          />
          <p class="cfg__pista">{{ t('labels.config_trigger_schedule_hint') }}</p>
        </div>
      </div>
    </div>

    <div class="cfg__acciones">
      <Button
        :label="t('labels.save')"
        size="small"
        :disabled="!tocado || busy"
        :loading="busy"
        @click="guardar"
      />
      <span v-if="tocado" class="cfg__sin-guardar">{{ t('labels.unsaved_changes') }}</span>
    </div>
  </section>
</template>

<style scoped>
.cfg {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--p-content-border-color);
}

.cfg__etiqueta {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--p-text-color);
  margin: 0 0 3px;
}

.cfg__sub {
  display: block;
  font-size: 11px;
  color: var(--p-text-muted-color);
  margin-bottom: 4px;
}

.cfg__pista {
  font-size: 11px;
  color: var(--p-text-dim-color);
  margin: 0 0 7px;
}

.cfg__textarea,
.cfg__valor,
.cfg__select {
  width: 100%;
}

.cfg__dos {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.cfg__disparadores {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cfg__webhook {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
}

.cfg__acciones {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cfg__sin-guardar {
  font-size: 11px;
  color: var(--status-warn);
}
</style>
