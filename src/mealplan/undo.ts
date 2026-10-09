// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Undo and redo as whole snapshots, up to 50 of them, kept in memory only. A plan is small
// (at most 56 meals), so a snapshot per edit costs little and is simpler to get right than an
// inverse for every edit. What counts as one step is the caller's choice: record() makes one,
// replace() changes the present without one (answers from the server are not the shopper's
// edits, so undo never takes them back on its own).

export const UNDO_LIMIT = 50;

export interface History<T> {
  past: T[];                       // oldest first
  present: T;
  future: T[];                     // the next redo first
}

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

// A new step. An edit that changed nothing (the same object back) is not a step.
export function record<T>(h: History<T>, next: T, limit = UNDO_LIMIT): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] };
}

export function replace<T>(h: History<T>, next: T): History<T> {
  return next === h.present ? h : { ...h, present: next };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

// `restore(target, current)` adapts the snapshot being brought back to what is true now; the
// meal plan uses it to keep its revision counting up and to keep server answers it still
// holds.
export function undo<T>(h: History<T>, restore: (target: T, current: T) => T = (t) => t)
  : History<T> {
  if (!h.past.length) return h;
  const target = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: restore(target, h.present),
    future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>, restore: (target: T, current: T) => T = (t) => t)
  : History<T> {
  if (!h.future.length) return h;
  const [target, ...rest] = h.future;
  return { past: [...h.past, h.present], present: restore(target, h.present), future: rest };
}
