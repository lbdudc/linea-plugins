import { reactive } from 'vue';

const SHOW_DELAY_MS = 200;

const _state = reactive({ pending: 0, visible: false });
let showTimer = null;

const isActive = () => _state.pending > 0;

const scheduleShow = () => {
  if (showTimer || _state.visible) return;
  showTimer = setTimeout(() => {
    showTimer = null;
    if (isActive()) _state.visible = true;
  }, SHOW_DELAY_MS);
};

const maybeHide = () => {
  if (isActive()) return;
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  _state.visible = false;
};

export const loadingStore = {
  get visible() {
    return _state.visible;
  },
  get pending() {
    return _state.pending;
  },

  start() {
    _state.pending++;
    scheduleShow();
  },
  stop() {
    _state.pending = Math.max(0, _state.pending - 1);
    maybeHide();
  },
};
