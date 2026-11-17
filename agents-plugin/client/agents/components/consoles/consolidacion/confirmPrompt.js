import { reactive } from 'vue';

const state = reactive({
  open: false,
  kind: null,
  title: '',
  message: '',
  placeholder: '',
  tone: 'primary',
  value: '',
  resolve: null,
});

function open(kind, { title, message, placeholder = '', tone = 'primary' } = {}) {
  return new Promise((resolve) => {
    state.resolve?.(null);
    Object.assign(state, { open: true, kind, title, message, placeholder, tone, value: '', resolve });
  });
}

export const confirmDialog = (opts) => open('confirm', opts);

export const promptDialog = (opts) => open('prompt', opts);

export const confirmPromptState = state;

export function resolveConfirmPrompt(result) {
  const { resolve } = state;
  state.open = false;
  state.resolve = null;
  resolve?.(result);
}
