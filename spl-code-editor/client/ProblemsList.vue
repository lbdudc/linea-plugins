<script setup>
// The choices a scenario still has to make for the feature model to accept it: each group of alternatives with its options as buttons.
import Button from 'primevue/button'
import { chosenOf } from './diagnose.js'

defineProps({ problems: { type: Array, required: true }, current: { type: Object, required: true }, colors: { type: Function, default: () => ({}) } })
const emit = defineEmits(['pick', 'fix-all'])
</script>

<template>
  <div class="prob" data-test="problems">
    <div v-for="p in problems" :key="p.group + p.text" class="prob__row" data-test="problem">
      <p class="prob__rule">
        <strong>{{ p.group }}</strong>
        <span>{{ $t(`splCodeEditor.rule_${p.rule}`) }}</span>
        <span v-if="p.selected !== null" class="prob__count" :class="{ 'prob__count--bad': p.selected !== 1 && p.rule === 'one' }">{{ $t('splCodeEditor.rule_selected', { n: chosenOf(p, current).length }) }}</span>
      </p>
      <div class="prob__options">
        <button v-for="o in p.options" :key="o" type="button" class="prob__option" :class="{ 'prob__option--on': current.has(o) }" :aria-pressed="current.has(o)" data-test="problem-option" @click="emit('pick', p, o)">
          <i class="sce__dot" :style="colors(o)" />{{ o }}
        </button>
      </div>
    </div>
    <Button v-if="problems.length > 1" :label="$t('splCodeEditor.fix_all', { n: problems.length })" icon="pi pi-wand" size="small" data-test="fix-all" @click="emit('fix-all')" />
  </div>
</template>

<style scoped>
.prob { display: flex; flex-direction: column; gap: 10px; }
.prob__row { display: flex; flex-direction: column; gap: 5px; }
.prob__rule { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 12.5px; }
.prob__rule strong { font-family: var(--font-mono, monospace); font-size: 12px; }
.prob__count { margin-left: auto; font-size: 11px; color: var(--p-text-muted-color); }
.prob__count--bad { color: var(--p-red-500, #dc2626); font-weight: 600; }
.prob__options { display: flex; flex-wrap: wrap; gap: 6px; }
.prob__option { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--p-content-border-color); border-radius: 999px; background: var(--p-content-background); color: var(--p-text-color); padding: 4px 12px; font-size: 12.5px; cursor: pointer; }
.prob__option:hover { border-color: var(--p-primary-color); }
.prob__option--on { border-color: var(--p-primary-color); background: var(--p-highlight-background, var(--p-content-hover-background)); font-weight: 600; }
</style>
