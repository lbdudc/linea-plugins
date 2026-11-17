<script setup>
import { ref } from 'vue'
import { iconUrl } from './fileIcons.js'

defineOptions({ name: 'SplFileTree' })
const props = defineProps({
  nodes: { type: Array, required: true },
  current: { type: String, default: null },
  changes: { type: Object, default: () => ({}) },
  depth: { type: Number, default: 0 },
})
const emit = defineEmits(['open', 'rename', 'remove'])
const collapsed = ref(new Set())
const toggle = (path) => {
  const next = new Set(collapsed.value)
  if (next.has(path)) next.delete(path); else next.add(path)
  collapsed.value = next
}
const mark = (path) => props.changes[path]?.action
</script>

<template>
  <ul class="tree" role="tree">
    <li v-for="node in nodes" :key="node.path" role="treeitem">
      <div
        class="tree__row"
        :class="{ 'tree__row--current': node.path === current, 'tree__row--deleted': mark(node.path) === 'delete' }"
        :style="{ paddingLeft: `${8 + depth * 14}px` }"
        @click="node.folder ? toggle(node.path) : emit('open', node.path)"
      >
        <img v-if="iconUrl({ folder: node.folder, name: node.name, open: !collapsed.has(node.path) })" class="tree__icon" :src="iconUrl({ folder: node.folder, name: node.name, open: !collapsed.has(node.path) })" alt="" aria-hidden="true" draggable="false">
        <i v-else class="pi tree__icon tree__icon--pi" :class="node.folder ? (collapsed.has(node.path) ? 'pi-folder' : 'pi-folder-open') : 'pi-file'" aria-hidden="true" />
        <span class="tree__name">{{ node.name }}</span>
        <span v-if="mark(node.path)" class="tree__mark" :class="`tree__mark--${mark(node.path)}`">{{ { create: 'A', update: 'M', delete: 'D' }[mark(node.path)] }}</span>
        <span v-if="!node.folder && mark(node.path) !== 'delete'" class="tree__actions">
          <button type="button" class="tree__btn" :title="$t('splCodeEditor.rename')" :aria-label="$t('splCodeEditor.rename')" @click.stop="emit('rename', node.path)"><i class="pi pi-pencil" /></button>
          <button type="button" class="tree__btn" :title="$t('splCodeEditor.delete')" :aria-label="$t('splCodeEditor.delete')" @click.stop="emit('remove', node.path)"><i class="pi pi-trash" /></button>
        </span>
      </div>
      <SplFileTree
        v-if="node.folder && !collapsed.has(node.path)"
        :nodes="node.children" :current="current" :changes="changes" :depth="depth + 1"
        @open="emit('open', $event)" @rename="emit('rename', $event)" @remove="emit('remove', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.tree { list-style: none; margin: 0; padding: 0; font-size: 13px; }
.tree__row { display: flex; align-items: center; gap: 6px; padding-top: 3px; padding-bottom: 3px; padding-right: 6px; cursor: pointer; color: var(--p-text-color); }
.tree__row:hover { background: var(--p-content-hover-background); }
.tree__row--current { background: var(--p-highlight-background, var(--p-content-hover-background)); font-weight: 500; }
.tree__row--deleted .tree__name { text-decoration: line-through; opacity: 0.55; }
.tree__icon { flex: none; width: 16px; height: 16px; object-fit: contain; }
.tree__icon--pi { font-size: 12px; width: auto; color: var(--p-text-muted-color); }
.tree__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree__mark { font-size: 10px; font-weight: 600; padding: 0 4px; border-radius: 3px; }
.tree__mark--create { color: var(--status-good, #2e7d32); }
.tree__mark--update { color: var(--status-warn, #b26a00); }
.tree__mark--delete { color: var(--status-bad, #c62828); }
.tree__actions { display: none; gap: 2px; }
.tree__row:hover .tree__actions { display: inline-flex; }
.tree__btn { border: 0; background: transparent; color: var(--p-text-muted-color); cursor: pointer; padding: 2px 4px; font-size: 11px; }
.tree__btn:hover { color: var(--p-text-color); }
</style>
