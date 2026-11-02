// A failure the person should hear about, shown as a short toast by the one
// <Toaster/> in the app shell. Plain module state (like appDialogStore) so the
// data layer — the QueryClient's MutationCache, a helper outside React — can
// report without a hook.
export type Toast = { id: number; message: string; detail: string | null };

const LIFETIME_MS = 6000;
const MAX_TOASTS = 3;
let nextId = 0;
let toasts: readonly Toast[] = [];
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const getToasts = () => toasts;
const NO_TOASTS: readonly Toast[] = [];
export const getServerToasts = () => NO_TOASTS;

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

export function clearToasts() {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
  toasts = [];
  emit();
}

/** The readable part of anything thrown — an Error, a Supabase error object, a string. */
export function errorMessage(error: unknown): string | null {
  if (typeof error === 'string') return error.trim() || null;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return null;
}

/** An abort is the app changing its mind, not a failure to report. */
function isAbort(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError';
}

/**
 * Tell the person something failed. `message` is the already-translated
 * headline; the thrown error's own text goes underneath it. Returns the toast
 * id, or null when nothing was shown (an abort, or the same toast already up).
 */
export function notifyError(error: unknown, message: string): number | null {
  if (isAbort(error)) return null;
  const detail = errorMessage(error);
  const shown = { message, detail: detail === message ? null : detail };
  if (toasts.some((toast) => toast.message === shown.message && toast.detail === shown.detail)) return null;
  const toast: Toast = { id: ++nextId, ...shown };
  const overflow = toasts.slice(0, Math.max(0, toasts.length - MAX_TOASTS + 1));
  overflow.forEach((old) => { const t = timers.get(old.id); if (t) clearTimeout(t); timers.delete(old.id); });
  toasts = [...toasts.slice(overflow.length), toast];
  timers.set(toast.id, setTimeout(() => dismissToast(toast.id), LIFETIME_MS));
  emit();
  return toast.id;
}
