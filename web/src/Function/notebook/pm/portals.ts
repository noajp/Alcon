// Places inside the editor's page that React draws into. ProseMirror makes
// and removes the places (a node view, a widget); the editor renders a portal
// into each, so what is drawn there is an ordinary component with the page's
// context.

export class Portals<T> {
  private items = new Map<number, T>();
  private snapshot: [number, T][] = [];
  private listeners = new Set<() => void>();
  private next = 1;

  add(item: T): number {
    const key = this.next++;
    this.items.set(key, item);
    this.changed();
    return key;
  }

  update(key: number, patch: Partial<T>): void {
    const prev = this.items.get(key);
    if (!prev) return;
    if ((Object.keys(patch) as (keyof T)[]).every((k) => prev[k] === patch[k])) return;
    this.items.set(key, { ...prev, ...patch });
    this.changed();
  }

  remove(key: number): void {
    if (this.items.delete(key)) this.changed();
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;

  private changed() {
    this.snapshot = [...this.items];
    for (const fn of this.listeners) fn();
  }
}
