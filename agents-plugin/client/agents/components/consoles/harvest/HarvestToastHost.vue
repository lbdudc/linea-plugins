<script setup>
import { notifyState, dismissNotify } from './notify.js';

const ICON = { positive: 'pi pi-check-circle', negative: 'pi pi-times-circle', warning: 'pi pi-exclamation-triangle', info: 'pi pi-info-circle' };
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <div v-for="item in notifyState.items" :key="item.id" class="toast-host__item" :class="`toast-host__item--${item.type}`">
      <i :class="ICON[item.type] ?? ICON.info" aria-hidden="true"></i>
      <span class="toast-host__msg">{{ item.message }}</span>
      <button type="button" class="toast-host__close" aria-label="Cerrar aviso" @click="dismissNotify(item.id)">
        <i class="pi pi-times" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 1200;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  max-width: 360px;
}

.toast-host__item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 12.5px;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  box-shadow: 0 6px 18px var(--overlay-shadow);
  color: var(--p-text-color);
}

.toast-host__item--positive { border-left: 3px solid var(--status-ok-solid); }
.toast-host__item--positive i:first-child { color: var(--status-ok-solid); }

.toast-host__item--negative { border-left: 3px solid var(--status-bad-solid); }
.toast-host__item--negative i:first-child { color: var(--status-bad-solid); }

.toast-host__item--warning { border-left: 3px solid var(--status-warn-solid); }
.toast-host__item--warning i:first-child { color: var(--status-warn-solid); }

.toast-host__item--info { border-left: 3px solid var(--p-agent-color); }
.toast-host__item--info i:first-child { color: var(--p-agent-color); }

.toast-host__msg {
  flex: 1;
  min-width: 0;
}

.toast-host__close {
  background: none;
  border: none;
  color: var(--p-text-dim-color);
  cursor: pointer;
  padding: 2px;
  flex: none;
}
</style>
