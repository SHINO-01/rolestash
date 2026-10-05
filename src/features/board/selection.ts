import { createContext, useContext } from 'react';

/**
 * Selecting several cards for bulk actions (Pro). Provided by the board;
 * cards read it to toggle themselves on Ctrl/⌘-click or in select mode.
 */
export interface Selection {
  /** Select mode: a plain click selects instead of opening. */
  active: boolean;
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
}

export const SelectionContext = createContext<Selection | null>(null);

export function useSelection(): Selection | null {
  return useContext(SelectionContext);
}
