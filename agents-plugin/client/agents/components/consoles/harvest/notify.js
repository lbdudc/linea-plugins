import { reactive } from 'vue';

const state = reactive({ items: [] });

let seq = 0;

export function notify({ type = 'info', message = '' } = {}) {
  const id = ++seq;
  state.items.push({ id, type, message });
  setTimeout(() => {
    const idx = state.items.findIndex((i) => i.id === id);
    if (idx >= 0) state.items.splice(idx, 1);
  }, 4500);
}

export const notifyState = state;

export function dismissNotify(id) {
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx >= 0) state.items.splice(idx, 1);
}
