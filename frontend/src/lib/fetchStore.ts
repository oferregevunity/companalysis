type FetchState = {
  active: boolean;
  current: number;
  total: number;
  label: string;
  errors: string[];
  doneMessage: string | null;
};

type Listener = () => void;

let state: FetchState = {
  active: false,
  current: 0,
  total: 0,
  label: '',
  errors: [],
  doneMessage: null,
};

const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((fn) => fn());
}

export const fetchStore = {
  getState(): FetchState {
    return state;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  start(total: number) {
    state = { active: true, current: 0, total, label: '', errors: [], doneMessage: null };
    notify();
  },

  progress(current: number, label: string) {
    state = { ...state, current, label };
    notify();
  },

  addError(error: string) {
    state = { ...state, errors: [...state.errors, error] };
    notify();
  },

  finish(message: string) {
    state = { ...state, active: false, doneMessage: message };
    notify();
  },

  clear() {
    state = { active: false, current: 0, total: 0, label: '', errors: [], doneMessage: null };
    notify();
  },
};
