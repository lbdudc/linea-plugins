<script setup>
// The line between two panes: drag it (mouse, touch or pen), move it with the arrow keys, double click to give the pane its usual size.
// It says how far it moved (`resize`, in pixels, positive towards the right / the bottom); the pane that owns the size decides what to do.
const props = defineProps({ horizontal: { type: Boolean, default: false }, label: { type: String, default: '' } })
const emit = defineEmits(['resize', 'reset', 'end'])

let last = 0
const point = (event) => (props.horizontal ? event.clientY : event.clientX)
const down = (event) => {
  event.preventDefault()
  last = point(event)
  event.currentTarget.setPointerCapture(event.pointerId)
  document.body.classList.add('sce-dragging')
}
const move = (event) => {
  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
  const now = point(event)
  if (now !== last) emit('resize', now - last)
  last = now
}
const up = (event) => {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  document.body.classList.remove('sce-dragging')
  emit('end')
}
const key = (event) => {
  const step = event.shiftKey ? 64 : 16
  const back = props.horizontal ? 'ArrowUp' : 'ArrowLeft'
  const forth = props.horizontal ? 'ArrowDown' : 'ArrowRight'
  if (event.key === back) { emit('resize', -step); emit('end') } else if (event.key === forth) { emit('resize', step); emit('end') } else if (event.key === 'Enter' || event.key === 'Home') emit('reset')
  else return
  event.preventDefault()
}
</script>

<template>
  <div
    class="sce-split" :class="horizontal ? 'sce-split--h' : 'sce-split--v'" role="separator" tabindex="0"
    :aria-orientation="horizontal ? 'horizontal' : 'vertical'" :aria-label="label" :title="label"
    @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @dblclick="emit('reset')" @keydown="key"
  />
</template>

<style scoped>
.sce-split { flex: none; position: relative; background: var(--p-content-border-color); touch-action: none; z-index: 2; transition: background 0.12s; }
.sce-split--v { width: 1px; cursor: col-resize; }
.sce-split--h { height: 1px; cursor: row-resize; }
/* a wider grip than the line, so it is easy to catch */
.sce-split::after { content: ''; position: absolute; }
.sce-split--v::after { inset: 0 -7px; }
.sce-split--h::after { inset: -7px 0; }
.sce-split:hover, .sce-split:focus-visible { background: var(--p-primary-color); outline: none; }
.sce-split:hover.sce-split--v, .sce-split:focus-visible.sce-split--v { box-shadow: 0 0 0 1px var(--p-primary-color); }
.sce-split:hover.sce-split--h, .sce-split:focus-visible.sce-split--h { box-shadow: 0 0 0 1px var(--p-primary-color); }
</style>
