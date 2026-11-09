import type { NavigationState } from '@/types/navigation';
import type { ScreenSnapshot } from '@/Frame/historyState';

/** What the shell shows: the active view and the navigation inside it. The
 *  shell keeps this in a list so a surface's internal state survives while
 *  another is shown, but the page shows one at a time. */
export interface AppTab {
  id: string;
  activeView: string;
  navigation: NavigationState;
  /** Screens this tab left, most recent last — the shell's Back stack.
   *  In-memory only (historyState.ts); a reload starts it empty. */
  back: ScreenSnapshot[];
  /** Screens this tab stepped back from, most recent last — where
   *  Forward returns to. Any fresh navigation in the tab clears it. */
  forward: ScreenSnapshot[];
}
