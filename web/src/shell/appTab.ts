import type { NavigationState } from '@/types/navigation';

/** What the shell shows: the active view and the navigation inside it. The
 *  shell keeps this in a list so a surface's internal state survives while
 *  another is shown, but the page shows one at a time. */
export interface AppTab {
  id: string;
  activeView: string;
  navigation: NavigationState;
}
