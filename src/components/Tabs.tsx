// A row of tabs over the panel each one shows, as a screen reader and the keyboard expect: a
// tablist of tabs, the chosen one aria-selected and alone in the Tab order, each naming the panel
// it controls (aria-controls). Left and Right move along the tabs and go round, Home and End go to
// either end (workshop.ts tabAfterKey decides, where a test reads it). Choosing follows focus: the
// panels here are drawn at once, so moving along the tabs shows each in turn.
//
// The MCP explorer's tools, resources and prompts use it with a panel for each tab; a scenario's
// transcripts in Simulations use it with one panel that shows whichever is chosen.
import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { tabAfterKey } from '../workshop';

export const tabId = (base: string, key: string) => `${base}-tab-${key}`;
export const panelId = (base: string, key: string) => `${base}-panel-${key}`;

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
}

export function TabList<K extends string>({ tabs, current, onChange, label, idBase, controls, className }: {
  tabs: TabItem<K>[];
  current: K;
  onChange: (key: K) => void;
  // what the tabs choose between, for a screen reader ("What the server offers")
  label: string;
  idBase: string;
  // the panel a tab controls; by default the one TabPanel draws for it
  controls?: (key: K) => string;
  className?: string;
}) {
  const buttons = useRef(new Map<K, HTMLButtonElement>());
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, at: number) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const next = tabAfterKey(e.key, at, tabs.length);
    if (next == null) return;
    e.preventDefault();
    const key = tabs[next].key;
    onChange(key);
    buttons.current.get(key)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={`tabs${className ? ` ${className}` : ''}`}>
      {tabs.map((t, i) => (
        <button key={t.key} type="button" role="tab" id={tabId(idBase, t.key)}
                ref={(el) => { if (el) buttons.current.set(t.key, el); else buttons.current.delete(t.key); }}
                aria-selected={t.key === current} aria-controls={controls ? controls(t.key) : panelId(idBase, t.key)}
                tabIndex={t.key === current ? 0 : -1} className="tab"
                onClick={() => onChange(t.key)} onKeyDown={(e) => onKeyDown(e, i)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// One tab's panel, hidden while another tab is chosen. `reachable`: the panel itself takes a Tab
// stop, for a panel with nothing in it the keyboard could otherwise land on.
export function TabPanel({ idBase, tabKey, current, reachable = false, className, children }: {
  idBase: string;
  tabKey: string;
  current: string;
  reachable?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="tabpanel" id={panelId(idBase, tabKey)} aria-labelledby={tabId(idBase, tabKey)}
         hidden={tabKey !== current} tabIndex={reachable ? 0 : undefined} className={className}>
      {children}
    </div>
  );
}
