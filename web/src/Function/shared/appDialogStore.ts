export type AppDialogRequest = { id: number; kind: 'confirm' | 'alert' | 'prompt'; message: string; initialValue: string };
type Pending = { request: AppDialogRequest; resolve: (value: string | boolean | null) => void };
let nextId = 0;
let active: Pending | null = null;
const queue: Pending[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function subscribeAppDialog(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const getAppDialog = () => active?.request ?? null;
export function answerAppDialog(id: number, value: string | boolean | null) {
  if (!active || active.request.id !== id) return;
  const current = active;
  active = queue.shift() ?? null;
  emit();
  current.resolve(value);
}
export function cancelAppDialogs() {
  const pending = [...(active ? [active] : []), ...queue];
  active = null; queue.length = 0; emit();
  pending.forEach(item => item.resolve(item.request.kind === 'confirm' ? false : null));
}
function request(kind: AppDialogRequest['kind'], message: string, initialValue = '') {
  // Fail closed when no host is mounted, including after app teardown.
  if (!listeners.size) return Promise.resolve(kind === 'confirm' ? false : null);
  // The same alert already showing or waiting is not stacked again (a burst
  // of failed saves says so once); the repeat settles when that one does.
  const same = kind === 'alert' ? [active, ...queue].find(item => item?.request.kind === 'alert' && item.request.message === message) : undefined;
  if (same) {
    return new Promise<string | boolean | null>(resolve => {
      const settle = same.resolve;
      same.resolve = value => { settle(value); resolve(value); };
    });
  }
  return new Promise<string | boolean | null>(resolve => {
    const pending = { request: { id: ++nextId, kind, message, initialValue }, resolve };
    if (active) queue.push(pending); else { active = pending; emit(); }
  });
}
export const appDialog = {
  confirm: async (message: string) => (await request('confirm', message)) === true,
  alert: async (message: string) => { await request('alert', message); },
  prompt: async (message: string, initialValue = '') => {
    const result = await request('prompt', message, initialValue);
    return typeof result === 'string' ? result : null;
  },
};
