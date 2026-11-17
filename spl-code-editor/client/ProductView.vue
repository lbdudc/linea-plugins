<script setup>
// The product as it came out, whole, one line at a time. Rest the mouse on a line and a card says where it comes from (the line of the
// annotated template) and why it is there (the conditions around it and the value they had); click it to keep the card. From the other
// side, the line of the template the cursor is on says which lines of the product it wrote, or what kept it out. Next to the product,
// an optional panel (the slot) holds what changes it: features and values, changed on the fly.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { outputRows, explainRow, explainSource } from './provenance.js'

const props = defineProps({
  output: { type: Object, required: true }, // { content, provenance }
  templateText: { type: String, default: '' },
  sourceLine: { type: Number, default: 0 }, // the line of the template the cursor is on
  colors: { type: Function, default: () => ({}) },
  featureStats: { type: Object, default: () => ({ on: 0, total: 0 }) },
  valueStats: { type: Object, default: () => ({ count: 0, changed: 0 }) },
})
const emit = defineEmits(['jump', 'highlight', 'toggle-feature'])

// features and values open as drop-downs over the product: they take no room from it
const menu = ref('') // '' | 'features' | 'values'
const toggleMenu = (name) => { menu.value = menu.value === name ? '' : name }
const menuOut = (event) => { if (!event.currentTarget.contains(event.relatedTarget)) menu.value = '' }

const provenance = computed(() => props.output?.provenance ?? null)
const active = computed(() => new Set(provenance.value?.features ?? []))
const rows = computed(() => (provenance.value ? outputRows(props.output.content, provenance.value) : []))
const sourceLines = computed(() => props.templateText.split('\n'))
const snippet = (n) => (sourceLines.value[n - 1] ?? '').trim().slice(0, 120)

// what is looked at: the line the mouse is resting on, a line that was clicked (kept), or the line of the template the cursor is on
const hover = ref(0)
const pinned = ref(0)
const atTop = ref(false)
let enterTimer = null
let leaveTimer = null
const main = ref(null)
const shown = computed(() => pinned.value || hover.value)
const lines = (row) => [...new Set(row.sources.map((s) => s.line))]
const enter = (row, event) => {
  clearTimeout(leaveTimer); clearTimeout(enterTimer)
  const box = event.currentTarget.getBoundingClientRect()
  const area = main.value?.getBoundingClientRect()
  enterTimer = setTimeout(() => {
    hover.value = row.n
    // the card goes to the other half so it never covers the line it explains
    atTop.value = area ? box.top + box.height / 2 > area.top + area.height / 2 : false
    if (!pinned.value) emit('highlight', lines(row))
  }, 90)
}
const leave = () => {
  clearTimeout(enterTimer)
  leaveTimer = setTimeout(() => { hover.value = 0; if (!pinned.value) emit('highlight', []) }, 220)
}
const keep = () => clearTimeout(leaveTimer)
const click = (row) => {
  pinned.value = pinned.value === row.n ? 0 : row.n
  if (pinned.value) { emit('highlight', lines(row)); if (row.sources[0]) emit('jump', row.sources[0].line) } else emit('highlight', [])
}
const unpin = () => { pinned.value = 0; hover.value = 0; emit('highlight', []) }
watch(() => props.output, () => { pinned.value = 0; hover.value = 0 })
// when the layout moves under a resting mouse nothing says it left: a resize lets go of what was being looked at
const letGo = () => { if (!pinned.value) { hover.value = 0; emit('highlight', []) } }
onMounted(() => window.addEventListener('resize', letGo))
onBeforeUnmount(() => { clearTimeout(enterTimer); clearTimeout(leaveTimer); window.removeEventListener('resize', letGo) })

const rowExplain = computed(() => {
  const row = rows.value[shown.value - 1]
  return row && provenance.value ? { row, ...explainRow(row, provenance.value, active.value) } : null
})
// a line that wrote nothing and was kept out by nothing has nothing to say
const sourceExplain = computed(() => {
  if (shown.value || !provenance.value || !props.sourceLine) return null
  const explained = { line: props.sourceLine, ...explainSource(props.sourceLine, rows.value, provenance.value, active.value) }
  return explained.produced.length || explained.blockedBy ? explained : null
})
const litRows = computed(() => new Set(sourceExplain.value?.produced ?? []))
const hasCard = computed(() => Boolean(rowExplain.value || sourceExplain.value))

// the lines the cursor's line wrote come into view
const listBox = ref(null)
watch(litRows, (set) => { if (set.size) listBox.value?.querySelector('.pv__row--lit')?.scrollIntoView({ block: 'nearest' }) })

const LIMIT = 2500
const showAll = ref(false)
const visible = computed(() => (showAll.value ? rows.value : rows.value.slice(0, LIMIT)))
const innermost = (row) => { const id = [...row.whyIds].sort((a, b) => (provenance.value.whys[b]?.length ?? 0) - (provenance.value.whys[a]?.length ?? 0))[0]; const chain = provenance.value.whys[id] ?? []; return chain[chain.length - 1] ?? null }
const valueWord = (v) => (v === 'true' ? 'true' : v === 'false' ? 'false' : '')
</script>

<template>
  <div v-if="!provenance" class="pv__empty" data-test="pv-empty">{{ $t('splCodeEditor.pv_none') }}</div>
  <div v-else class="pv" data-test="product-view">
    <div class="pv__bar">
      <span class="pv__muted">{{ $t('splCodeEditor.pv_count', { n: rows.length }) }}</span>
      <span class="pv__barextra"><slot name="bar" /></span>
      <span v-if="$slots.config && (featureStats.total || valueStats.count)" class="pv__menu" @focusout="menuOut" @keydown.esc="menu = ''">
        <button type="button" class="pv__tweakbtn" :class="{ 'pv__tweakbtn--on': menu === 'config', 'pv__tweakbtn--changed': valueStats.changed }" :aria-expanded="menu === 'config'" data-test="pv-config-toggle" @click="toggleMenu('config')"><i class="pi pi-sliders-h" aria-hidden="true" /> {{ $t('splCodeEditor.config_tab') }}<i v-if="valueStats.changed" class="pv__dot" aria-hidden="true" /> <i class="pi pi-angle-down" aria-hidden="true" /></button>
        <div v-if="menu === 'config'" class="pv__pop pv__pop--config" data-test="pv-config" tabindex="-1"><slot name="config" /></div>
      </span>
    </div>
    <div class="pv__body">
      <div ref="main" class="pv__main">
        <!-- the product, whole -->
        <div ref="listBox" class="pv__rows" role="listbox" :aria-label="$t('splCodeEditor.pv_title')" data-test="pv-rows">
          <button v-for="r in visible" :key="r.n" type="button" role="option" :aria-selected="pinned === r.n" class="pv__row" :class="{ 'pv__row--on': shown === r.n, 'pv__row--pinned': pinned === r.n, 'pv__row--lit': litRows.has(r.n), 'pv__row--empty': !r.text.trim() }" data-test="pv-row" @mouseenter="enter(r, $event)" @mouseleave="leave" @focus="enter(r, $event)" @blur="leave" @click="click(r)">
            <span class="pv__n">{{ r.n }}</span>
            <span class="pv__src" :title="r.sources.map((s) => s.line).join(', ')"><i class="pi pi-arrow-left" aria-hidden="true" />{{ r.sources.length ? lines(r).slice(0, 2).join(',') : '·' }}</span>
            <span class="pv__text">{{ r.text || ' ' }}</span>
            <span v-if="r.values.length" class="pv__tag pv__tag--value" :title="r.values.join(' · ')">=</span>
            <span v-if="innermost(r)" class="pv__cond" :class="innermost(r).kind === 'else' || innermost(r).value === 'true' ? 'pv__cond--on' : ''">{{ innermost(r).kind === 'else' ? 'else' : innermost(r).kind === 'block' ? '↻' : (innermost(r).condition ?? '').slice(0, 22) }}</span>
          </button>
          <button v-if="!showAll && rows.length > LIMIT" type="button" class="pv__more" @click="showAll = true">{{ $t('splCodeEditor.debug_more') }}</button>
        </div>

        <!-- why: floats over the other half of the list, so it never takes room from it -->
        <section v-if="hasCard" class="pv__card" :class="{ 'pv__card--top': atTop, 'pv__card--pinned': pinned }" data-test="pv-card" aria-live="polite" @mouseenter="keep" @mouseleave="leave">
          <div class="pv__cardtools">
            <span v-if="pinned" class="pv__pin"><i class="pi pi-thumbtack" aria-hidden="true" /> {{ $t('splCodeEditor.pv_pinned') }}</span>
            <button v-if="pinned" type="button" class="pv__x" :title="$t('splCodeEditor.pv_unpin')" :aria-label="$t('splCodeEditor.pv_unpin')" data-test="pv-close" @click="unpin"><i class="pi pi-times" /></button>
          </div>
          <template v-if="rowExplain">
            <p class="pv__title"><i class="pi pi-search" aria-hidden="true" /> {{ $t('splCodeEditor.pv_line', { n: rowExplain.row.n }) }}<code>{{ rowExplain.row.text.trim().slice(0, 80) }}</code></p>
            <p class="pv__h">{{ $t('splCodeEditor.pv_comes_from') }}</p>
            <ul class="pv__list">
              <li v-for="(s, i) in rowExplain.sources" :key="i">
                <button type="button" class="pv__line" data-test="pv-source" @click="emit('jump', s.line)">{{ $t('splCodeEditor.pv_template_line', { n: s.line }) }}</button>
                <template v-if="s.kind === 'value'"><span class="pv__tag pv__tag--value">=</span><code>{{ s.expr }}</code> → <code class="pv__val">{{ s.value }}</code></template>
                <template v-else><span class="pv__tag">{{ $t('splCodeEditor.pv_text') }}</span><code>{{ snippet(s.line) }}</code></template>
              </li>
            </ul>
            <p class="pv__h">{{ $t('splCodeEditor.pv_because') }}</p>
            <p v-if="!rowExplain.decisions.length" class="pv__muted" data-test="pv-always">{{ $t('splCodeEditor.pv_always') }}</p>
            <ol v-else class="pv__chain" data-test="pv-chain">
              <li v-for="(d, i) in rowExplain.decisions" :key="i" :style="{ marginLeft: `${i * 12}px` }">
                <button type="button" class="pv__line" @click="emit('jump', d.line)">{{ $t('splCodeEditor.pv_template_line', { n: d.line }) }}</button>
                <template v-if="d.kind === 'if' || d.kind === 'elseif'">
                  <span class="pv__tag" :class="d.value === 'true' ? 'pv__tag--on' : 'pv__tag--off'">{{ d.kind === 'if' ? 'if' : 'else if' }} {{ valueWord(d.value) }}</span>
                  <code>{{ d.condition }}</code>
                </template>
                <template v-else-if="d.kind === 'else'"><span class="pv__tag pv__tag--on">else</span><span class="pv__muted">{{ $t('splCodeEditor.pv_else_because') }}</span></template>
                <template v-else><span class="pv__tag">{{ $t('splCodeEditor.pv_loop') }}</span></template>
                <span v-if="d.features?.length" class="pv__feats">
                  <button v-for="f in d.features" :key="f.name" type="button" class="pv__feat" :class="f.on ? 'pv__feat--on' : 'pv__feat--off'" :title="f.on ? $t('splCodeEditor.pv_turn_off', { name: f.name }) : $t('splCodeEditor.pv_turn_on', { name: f.name })" data-test="pv-feature" @click="emit('toggle-feature', f.name)"><i class="sce__dot" :style="colors(f.name)" />{{ f.name }} {{ f.on ? '✓' : '✗' }}</button>
                </span>
                <div v-if="d.after?.length" class="pv__after">
                  <span class="pv__muted">{{ $t('splCodeEditor.pv_before') }}</span>
                  <span v-for="a in d.after" :key="a.marker" class="pv__afteritem">
                    <button type="button" class="pv__line" @click="emit('jump', a.line)">{{ $t('splCodeEditor.pv_template_line', { n: a.line }) }}</button>
                    <code>{{ a.condition }}</code> <span class="pv__tag pv__tag--off">false</span>
                    <button v-for="f in a.features" :key="f.name" type="button" class="pv__feat" :class="f.on ? 'pv__feat--on' : 'pv__feat--off'" @click="emit('toggle-feature', f.name)"><i class="sce__dot" :style="colors(f.name)" />{{ f.name }} {{ f.on ? '✓' : '✗' }}</button>
                  </span>
                </div>
              </li>
            </ol>
          </template>
          <template v-else-if="sourceExplain">
            <p class="pv__title"><i class="pi pi-code" aria-hidden="true" /> {{ $t('splCodeEditor.pv_template_line', { n: sourceExplain.line }) }}<code>{{ snippet(sourceExplain.line) }}</code></p>
            <template v-if="sourceExplain.produced.length">
              <p class="pv__h">{{ $t('splCodeEditor.pv_wrote') }}</p>
              <p class="pv__wrote"><button v-for="n in sourceExplain.produced.slice(0, 40)" :key="n" type="button" class="pv__line" data-test="pv-wrote" @click="click(rows[n - 1])">{{ n }}</button><span v-if="sourceExplain.produced.length > 40" class="pv__muted">…</span></p>
            </template>
            <template v-else-if="sourceExplain.blockedBy">
              <p class="pv__h pv__h--bad">{{ $t('splCodeEditor.pv_not_written') }}</p>
              <p class="pv__because" data-test="pv-blocked">
                <button type="button" class="pv__line" @click="emit('jump', sourceExplain.blockedBy.startLine)">{{ $t('splCodeEditor.pv_template_line', { n: sourceExplain.blockedBy.startLine }) }}</button>
                <template v-if="sourceExplain.blockedBy.kind === 'if' || sourceExplain.blockedBy.kind === 'elseif'"><span class="pv__tag pv__tag--off">{{ sourceExplain.blockedBy.kind === 'if' ? 'if' : 'else if' }} false</span><code>{{ sourceExplain.blockedBy.condition }}</code></template>
                <template v-else-if="sourceExplain.blockedBy.kind === 'else'"><span class="pv__tag pv__tag--off">else</span><span class="pv__muted">{{ $t('splCodeEditor.pv_else_skipped', { n: sourceExplain.blockedBy.previous?.startLine }) }}</span></template>
                <template v-else><span class="pv__tag pv__tag--off">{{ $t('splCodeEditor.pv_loop') }}</span><span class="pv__muted">{{ $t('splCodeEditor.pv_loop_empty') }}</span></template>
                <span v-if="sourceExplain.blockedBy.features?.length" class="pv__feats">
                  <button v-for="f in sourceExplain.blockedBy.features" :key="f.name" type="button" class="pv__feat" :class="f.on ? 'pv__feat--on' : 'pv__feat--off'" :title="f.on ? $t('splCodeEditor.pv_turn_off', { name: f.name }) : $t('splCodeEditor.pv_turn_on', { name: f.name })" @click="emit('toggle-feature', f.name)"><i class="sce__dot" :style="colors(f.name)" />{{ f.name }} {{ f.on ? '✓' : '✗' }}</button>
                </span>
              </p>
            </template>
            <p v-else class="pv__muted">{{ sourceExplain.isMarker ? $t('splCodeEditor.pv_marker') : $t('splCodeEditor.pv_nothing') }}</p>
          </template>
        </section>
      </div>

    </div>
  </div>
</template>

<style scoped>
.pv { display: flex; flex-direction: column; gap: 6px; min-height: 0; flex: 1; container-type: inline-size; }
.pv__body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; flex: 1; min-height: 0; }
.pv__main { position: relative; display: flex; flex-direction: column; min-height: 0; min-width: 0; border: 1px solid var(--p-content-border-color); border-radius: 8px; overflow: hidden; background: var(--p-content-background); }
.pv__tweaks { flex: none; max-height: 30%; overflow: auto; padding: 8px 10px; background: var(--p-content-hover-background); border-bottom: 1px solid var(--p-content-border-color); display: flex; flex-direction: column; gap: 8px; }
.pv__tweakbtn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--p-content-border-color); border-radius: 6px; background: transparent; color: var(--p-text-muted-color); padding: 2px 10px; font-size: 12px; cursor: pointer; position: relative; }
.pv__tweakbtn:hover { color: var(--p-text-color); border-color: var(--p-primary-color); }
.pv__tweakbtn--on { color: var(--p-primary-color); border-color: var(--p-primary-color); background: var(--p-highlight-background, var(--p-content-hover-background)); }
.pv__empty { padding: 12px 4px; font-size: 12.5px; color: var(--p-text-muted-color); }
.pv__card { position: absolute; left: 6px; right: 6px; bottom: 6px; z-index: 5; max-height: 52%; overflow: auto; border: 1px solid var(--p-primary-color); border-radius: 10px; padding: 10px 12px; background: var(--p-content-background); box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.28); font-size: 12.5px; }
.pv__card--top { bottom: auto; top: 6px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28); }
.pv__card--pinned { border-width: 2px; }
.pv__pin { font-size: 11px; color: var(--p-primary-color); align-self: center; padding-right: 4px; }
.pv__cardtools { position: absolute; top: 4px; right: 6px; display: flex; gap: 2px; z-index: 1; }
.pv__x { width: 24px; height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--p-text-muted-color); cursor: pointer; }
.pv__x:hover { background: var(--p-content-hover-background); color: var(--p-text-color); }
.pv__title { padding-right: 56px; }
.pv__title { margin: 0 0 6px; display: flex; align-items: baseline; gap: 8px; font-weight: 700; flex-wrap: wrap; }
.pv__title code { font-weight: 400; color: var(--p-text-muted-color); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv__h { margin: 8px 0 4px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--p-text-muted-color); }
.pv__h--bad { color: var(--p-red-500, #dc2626); }
.pv__muted { color: var(--p-text-muted-color); font-size: 12px; margin: 0; }
.pv__list, .pv__chain { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.pv__list li, .pv__chain li, .pv__because { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.pv__because { margin: 0; }
.pv__wrote { margin: 0; display: flex; flex-wrap: wrap; gap: 4px; }
.pv__line { border: 1px solid var(--p-content-border-color); border-radius: 5px; background: var(--p-content-background); color: var(--p-primary-color); font-family: var(--font-mono, monospace); font-size: 11.5px; padding: 0 6px; cursor: pointer; }
.pv__line:hover { border-color: var(--p-primary-color); }
.pv code { font-family: var(--font-mono, monospace); font-size: 11.5px; }
.pv__val { color: #b45309; }
.pv__tag { display: inline-block; font-size: 10.5px; font-weight: 700; padding: 0 7px; border-radius: 999px; border: 1px solid var(--p-content-border-color); color: var(--p-text-muted-color); }
.pv__tag--on { color: var(--p-green-600, #16a34a); border-color: currentColor; background: rgba(22, 163, 74, 0.08); }
.pv__tag--off { color: var(--p-red-500, #dc2626); border-color: currentColor; background: rgba(220, 38, 38, 0.07); }
.pv__tag--value { color: #b45309; border-color: rgba(245, 158, 11, 0.5); background: rgba(245, 158, 11, 0.14); }
.pv__feats, .pv__afteritem { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; }
.pv__after { width: 100%; display: flex; flex-wrap: wrap; gap: 4px 10px; padding-left: 4px; }
.pv__feat { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--p-content-border-color); border-radius: 999px; background: var(--p-content-background); padding: 0 8px; font-size: 11.5px; cursor: pointer; color: var(--p-text-color); }
.pv__feat--on { border-color: var(--p-green-600, #16a34a); }
.pv__feat--off { border-color: var(--p-red-500, #dc2626); opacity: 0.9; }
.pv__feat:hover { background: var(--p-content-hover-background); }
.pv__barextra { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; font-size: 12px; }
.pv__bar { flex: none; display: flex; align-items: center; gap: 10px; justify-content: space-between; flex-wrap: wrap; }
.pv__seg { display: inline-flex; border: 1px solid var(--p-content-border-color); border-radius: 6px; overflow: hidden; }
.pv__seg button { border: 0; background: transparent; padding: 3px 10px; font-size: 12px; cursor: pointer; color: var(--p-text-muted-color); }
.pv__seg--on { background: var(--p-highlight-background, var(--p-content-hover-background)) !important; color: var(--p-text-color) !important; font-weight: 600; }
.pv__rows { display: flex; flex-direction: column; flex: 1; min-height: 120px; overflow: auto; font-family: var(--font-mono, monospace); }
.pv__row { display: grid; grid-template-columns: 38px 46px minmax(0, 1fr) auto auto; align-items: center; gap: 6px; border: 0; border-bottom: 1px solid transparent; background: transparent; padding: 1px 8px 1px 0; text-align: left; color: var(--p-text-color); cursor: pointer; font-size: 12px; }
.pv__row:hover { background: var(--p-content-hover-background); }
.pv__row--on { background: var(--p-highlight-background, var(--p-content-hover-background)); box-shadow: inset 3px 0 0 var(--p-primary-color); }
.pv__row--pinned { box-shadow: inset 4px 0 0 var(--p-primary-color); font-weight: 600; }
.pv__row--lit { background: rgba(245, 158, 11, 0.18); box-shadow: inset 3px 0 0 #f59e0b; }
.pv__n { text-align: right; color: var(--p-text-muted-color); padding-right: 4px; font-size: 11px; }
.pv__src { font-size: 10.5px; color: var(--p-primary-color); white-space: nowrap; }
.pv__src i { font-size: 8px; margin-right: 2px; }
.pv__text { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.pv__cond { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--p-red-500, #dc2626); border: 1px solid currentColor; border-radius: 999px; padding: 0 6px; opacity: 0.8; }
.pv__cond--on { color: var(--p-green-600, #16a34a); }
.pv__more { border: 0; background: transparent; color: var(--p-primary-color); padding: 6px; cursor: pointer; font-size: 12px; }
.pv__decision { display: flex; align-items: center; gap: 8px; border: 0; background: transparent; padding-top: 4px; padding-bottom: 4px; padding-right: 8px; text-align: left; color: var(--p-text-color); cursor: pointer; font-size: 12px; }
.pv__decision:hover { background: var(--p-content-hover-background); }
.pv__condtext { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv__wroteN { font-size: 11px; color: var(--p-text-muted-color); white-space: nowrap; }
.pv__wroteN--zero { color: var(--p-red-500, #dc2626); }
.pv__menu { position: relative; }
.pv__tweakbtn b { font-weight: 700; color: var(--p-text-color); }
.pv__tweakbtn--changed { border-color: var(--p-primary-color); }
.pv__dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--p-primary-color); }
.pv__pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; width: min(420px, 86vw); max-height: min(60vh, 420px); overflow: auto; padding: 10px; background: var(--p-content-background); border: 1px solid var(--p-content-border-color); border-radius: 10px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3); display: flex; flex-direction: column; gap: 6px; }
.pv__pop--config { width: min(440px, 88vw); max-height: min(58vh, 430px); padding: 0; gap: 0; }
.pv__pop .sce__valrow { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) auto; }
</style>
