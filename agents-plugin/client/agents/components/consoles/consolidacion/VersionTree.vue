<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';

import Menu from 'primevue/menu';

import {
  BULLET_X,
  INDENT_STEP,
  ROW_HEIGHT,
  buildConnectors,
  buildPositions,
  buildRows,
  hasChildrenOf,
  lockedVersionIds,
} from './versionTree.js';

const props = defineProps({
  versions: { type: Array, default: () => [] },
  selectedVersionId: { type: String, default: null },
  cascadeFailureVersionIds: { type: Set, default: () => new Set() },
});

const emit = defineEmits(['select', 'fork', 'archive', 'reset', 'delete']);

const { t } = useI18n();

const collapsed = ref(new Set());
const toggleCollapsed = (id) => {
  const key = String(id);
  const next = new Set(collapsed.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsed.value = next;
};

const lockedIds = computed(() => lockedVersionIds(props.versions));
const rows = computed(() => buildRows(props.versions, collapsed.value));
const positions = computed(() => buildPositions(rows.value));
const connectors = computed(() => buildConnectors(rows.value, positions.value));

const containerRef = ref(null);
const width = ref(280);
const updateWidth = () => { if (containerRef.value) width.value = containerRef.value.clientWidth; };
watchEffect(async () => { await nextTick(); updateWidth(); });
onMounted(() => { window.addEventListener('resize', updateWidth); updateWidth(); });
onBeforeUnmount(() => window.removeEventListener('resize', updateWidth));

const canvasHeight = computed(() => rows.value.length * ROW_HEIGHT + 8);

const STATUS_ICON = { draft: 'pi pi-pencil', sandbox: 'pi pi-desktop', testing: 'pi pi-play', merged: 'pi pi-check-circle', archived: 'pi pi-inbox' };
const STATUS_COLOR = {
  draft: 'var(--p-text-muted-color)',
  sandbox: 'var(--p-agent-color)',
  testing: 'var(--status-warn-solid)',
  merged: 'var(--status-ok-solid)',
  archived: 'var(--p-text-faint-color)',
};
const statusIcon = (status) => STATUS_ICON[status] ?? 'pi pi-circle';
const statusColor = (status) => STATUS_COLOR[status] ?? 'var(--p-text-muted-color)';

const ORIGIN_ICON = { llm: 'pi pi-android', fork: 'pi pi-directions-alt', harvest: 'pi pi-download', root: 'pi pi-sitemap' };
const originIcon = (origin) => ORIGIN_ICON[origin] ?? 'pi pi-circle';

const nodeMenus = ref({});
const setNodeMenuRef = (id) => (el) => { if (el) nodeMenus.value[id] = el; };
const toggleNodeMenu = (event, id) => nodeMenus.value[id]?.toggle(event);
const nodeMenuItems = (node) => {
  const items = [
    { label: t('labels.version_action_fork'), icon: 'pi pi-directions-alt', command: () => emit('fork', node) },
  ];
  if (node.status !== 'merged' && !node.runId) {
    items.push({ label: t('labels.version_action_reset'), icon: 'pi pi-refresh', command: () => emit('reset', { version: node, cascade: false }) });
    if (hasChildrenOf(props.versions, node._id)) {
      items.push({ label: t('labels.version_action_reset_cascade'), icon: 'pi pi-replay', command: () => emit('reset', { version: node, cascade: true }) });
    }
  }
  items.push({ separator: true });
  if (node.status !== 'archived') {
    items.push({ label: t('labels.version_action_archive'), icon: 'pi pi-inbox', command: () => emit('archive', node) });
  }
  if (node.status !== 'merged' && !node.runId) {
    items.push({ label: t('labels.version_action_delete'), icon: 'pi pi-trash', command: () => emit('delete', { version: node, cascade: false }) });
    if (hasChildrenOf(props.versions, node._id)) {
      items.push({ label: t('labels.version_action_delete_cascade'), icon: 'pi pi-trash', command: () => emit('delete', { version: node, cascade: true }) });
    }
  }
  return items;
};
</script>

<template>
  <div ref="containerRef" class="version-tree" :style="{ minHeight: canvasHeight + 'px' }">
    <p v-if="!versions.length" class="version-tree__empty">{{ t('labels.version_tree_empty') }}</p>

    <svg v-if="versions.length" class="version-tree__connectors" :width="width" :height="canvasHeight" :viewBox="`0 0 ${width} ${canvasHeight}`">
      <path v-for="c in connectors" :key="c.key" :d="c.d" fill="none" stroke="var(--p-content-border-color)" stroke-width="1.5" />
    </svg>

    <div class="version-tree__rows">
      <template v-for="r in rows" :key="r.kind === 'header' ? `epoch-${r.epoch}` : `node-${String(r.version._id)}`">
        <div v-if="r.kind === 'header'" class="version-tree__epoch-header" :style="{ height: ROW_HEIGHT + 'px' }">
          <i class="pi pi-bars" aria-hidden="true"></i> {{ t('labels.version_tree_epoch', { n: r.epoch }) }}
        </div>

        <div
          v-else
          class="version-tree__node"
          :class="{ 'version-tree__node--selected': String(r.version._id) === String(selectedVersionId), 'version-tree__node--locked': lockedIds.has(String(r.version._id)) }"
          :style="{ height: ROW_HEIGHT + 'px', paddingLeft: `${BULLET_X + r.depth * INDENT_STEP - 8}px` }"
          @click="emit('select', r.version)"
        >
          <span v-if="r.hasChildren" class="version-tree__chevron" :title="t(r.collapsed ? 'labels.version_expand' : 'labels.version_collapse')" @click.stop="toggleCollapsed(r.version._id)">
            <i :class="r.collapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" aria-hidden="true"></i>
          </span>
          <span v-else class="version-tree__chevron-placeholder"></span>

          <span class="version-tree__bullet" :title="t(`labels.version_status_${r.version.status}`)">
            <i :class="statusIcon(r.version.status)" :style="{ color: statusColor(r.version.status) }" aria-hidden="true"></i>
          </span>

          <div class="version-tree__label">
            <div class="version-tree__label-row">
              <span class="version-tree__version">v{{ r.version.label }}</span>
              <i :class="originIcon(r.version.origin)" class="version-tree__flag" :title="t(`labels.version_origin_${r.version.origin}`)" aria-hidden="true"></i>
              <i v-if="lockedIds.has(String(r.version._id))" class="pi pi-lock version-tree__flag" :title="t('labels.version_locked_tooltip')" aria-hidden="true"></i>
              <i v-if="cascadeFailureVersionIds.has(String(r.version._id))" class="pi pi-exclamation-triangle version-tree__flag version-tree__flag--warn" :title="t('labels.version_merged_with_failures_tooltip')" aria-hidden="true"></i>
            </div>
            <div class="version-tree__title">{{ r.version.title || t('labels.version_untitled') }}</div>
          </div>

          <button type="button" class="version-tree__menu" @click.stop="toggleNodeMenu($event, r.version._id)">
            <i class="pi pi-ellipsis-v" aria-hidden="true"></i>
          </button>
          <Menu :ref="setNodeMenuRef(r.version._id)" :model="nodeMenuItems(r.version)" popup />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.version-tree {
  position: relative;
  overflow-y: auto;
}

.version-tree__empty {
  text-align: center;
  padding: 24px 12px;
  margin: 0;
  font-size: 12px;
  color: var(--p-text-dim-color);
}

.version-tree__connectors {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}

.version-tree__rows {
  position: relative;
  isolation: isolate;
  z-index: 1;
}

.version-tree__epoch-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--p-text-dim-color);
  padding: 0 12px;
  background: var(--p-content-hover-background);
  border-bottom: 1px solid var(--p-content-border-color);
}

.version-tree__node {
  position: relative;
  display: flex;
  align-items: center;
  padding-right: 8px;
  cursor: pointer;
  font-size: 12.5px;
  color: var(--p-text-color);
}

.version-tree__node:hover {
  background: var(--hover-veil);
}

.version-tree__node--selected {
  background: var(--p-agent-highlight);
}

.version-tree__node--selected .version-tree__version {
  font-weight: 600;
}

.version-tree__node--locked {
  opacity: 0.65;
}

.version-tree__node--locked .version-tree__version {
  text-decoration: line-through;
}

.version-tree__chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 2px;
  border-radius: 3px;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 10px;
  color: var(--p-text-muted-color);
}

.version-tree__chevron:hover {
  background: var(--hover-veil);
}

.version-tree__chevron-placeholder {
  display: inline-block;
  width: 16px;
  margin-right: 2px;
  flex-shrink: 0;
}

.version-tree__bullet {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--p-content-background);
  margin-right: 8px;
  flex-shrink: 0;
  font-size: 11px;
}

.version-tree__label {
  flex: 1;
  min-width: 0;
}

.version-tree__label-row {
  display: flex;
  align-items: center;
  gap: 5px;
  line-height: 1.2;
}

.version-tree__version {
  font-family: 'Fira Code', 'Courier New', monospace;
  font-size: 12px;
}

.version-tree__flag {
  font-size: 10px;
  color: var(--p-text-muted-color);
}

.version-tree__flag--warn {
  color: var(--status-warn-solid);
}

.version-tree__title {
  line-height: 1.2;
  font-size: 11px;
  color: var(--p-text-muted-color);
  max-width: 100%;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-tree__menu {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--p-text-faint-color);
  opacity: 0.7;
  cursor: pointer;
  flex-shrink: 0;
}

.version-tree__menu:hover {
  opacity: 1;
  background: var(--hover-veil);
}
</style>
