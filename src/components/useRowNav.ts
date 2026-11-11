// The rows of a Workshop table that the keyboard walks, as a grid of rows: the table is one Tab stop
// (the row last reached, else the chosen one, else the first), Up and Down move along the rows, Home
// and End go to either end, Page Up and Page Down ten rows at a time, and Enter or Space opens the
// row, as a click on it does. The rows are the table's own <tr>s (role=row inside role=grid), so a
// screen reader reads each one's cells as it arrives; the table carries role="grid" and a name.
//
// Which row a key moves to is decided in workshop.ts (rowAfterKey), where a test reads it. A row
// that a filter took away gives its Tab stop back to the chosen row or the first, so the table is
// never left without a way in.
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { rowAfterKey } from '../workshop';

export interface RowProps {
  ref: (el: HTMLTableRowElement | null) => void;
  tabIndex: number;
  onFocus: () => void;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => void;
}

export function useRowNav<K extends string | number>(keys: readonly K[], { onOpen, chosen = null }: {
  onOpen: (key: K) => void;
  // the row that is open or picked, which holds the Tab stop until another row is reached
  chosen?: K | null;
}): { rowProps: (key: K) => RowProps; rowElement: (key: K) => HTMLTableRowElement | null } {
  const rows = useRef(new Map<K, HTMLTableRowElement>());
  const [reached, setReached] = useState<K | null>(null);
  const stop = reached != null && keys.includes(reached) ? reached
    : chosen != null && keys.includes(chosen) ? chosen : keys[0] ?? null;

  const rowProps = (key: K): RowProps => ({
    ref: (el) => {
      if (el) rows.current.set(key, el);
      else rows.current.delete(key);
    },
    tabIndex: key === stop ? 0 : -1,
    onFocus: () => setReached(key),
    onClick: () => onOpen(key),
    onKeyDown: (e) => {
      // a control inside a row keeps its own keys
      if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen(key);
        return;
      }
      const next = rowAfterKey(e.key, keys.indexOf(key), keys.length);
      if (next == null) return;
      e.preventDefault();
      const to = keys[next];
      setReached(to);
      rows.current.get(to)?.focus();
    },
  });

  return { rowProps, rowElement: (key) => rows.current.get(key) ?? null };
}
