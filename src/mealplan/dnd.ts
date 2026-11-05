// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The decisions behind moving meals and trips, without the browser: the drag gesture as a state
// machine fed pointer events, hit-testing against drop targets, edge auto-scroll, the drop's
// reducer edit, and the keyboard route (Enter to pick up, arrows or Tab to a slot, Enter to
// place, Escape to cancel). The view only forwards events and draws what this decides, so the
// drag layer can be swapped (for @dnd-kit, if the device check fails) without touching it.
//
// Drop targets are named by the key their element carries in data-drop:
//   'slot|2026-10-15|dinner'   a meal slot (model.cellKey)
//   'tray'                     back to the tray
//   'shop|2026-10-15'          a day's Shop row, for a trip
import { addDays, dayLabel, isCivilDate } from './dates.ts';
import { CAPACITY, SLOT_LABELS, inWindow, parseCellKey } from './model.ts';
import type { PlanEdit, PlanWindow, Slot } from './model.ts';

export type DragPayload =
  | { kind: 'meal'; mealId: string }
  | { kind: 'trip'; tripId: string; date: string };

export type DropTarget =
  | { kind: 'slot'; date: string; slot: Slot }
  | { kind: 'tray' }
  | { kind: 'shop'; date: string };

export const TRAY_KEY = 'tray';
export const shopKey = (date: string): string => `shop|${date}`;

export function parseTarget(key: string | null | undefined): DropTarget | null {
  if (!key) return null;
  if (key === TRAY_KEY) return { kind: 'tray' };
  const cell = parseCellKey(key);
  if (cell) return { kind: 'slot', ...cell };
  const [kind, date, ...rest] = key.split('|');
  if (kind === 'shop' && rest.length === 0 && isCivilDate(date ?? '')) return { kind: 'shop', date };
  return null;
}

// Meals go to slots or back to the tray; trips go to another day's Shop row.
export function canDrop(payload: DragPayload, key: string | null): boolean {
  const t = parseTarget(key);
  if (!t) return false;
  if (payload.kind === 'meal') return t.kind === 'slot' || t.kind === 'tray';
  return t.kind === 'shop' && t.date !== payload.date;
}

// The edit a drop makes; null when the target does not take this payload.
export function dropEdit(payload: DragPayload, key: string): PlanEdit | null {
  const t = parseTarget(key);
  if (!t || !canDrop(payload, key)) return null;
  if (payload.kind === 'meal') {
    return t.kind === 'slot'
      ? { type: 'place', mealId: payload.mealId, date: t.date, slot: t.slot }
      : { type: 'unplace', mealId: payload.mealId };
  }
  return t.kind === 'shop' ? { type: 'moveTrip', from: payload.date, to: t.date } : null;
}

// ─── Hit-testing ─────────────────────────────────────────────

export interface TargetRect {
  key: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// The drop target under a point: the smallest rectangle that holds it, so a slot wins over the
// day card around it. Edges: left and top are inside, right and bottom are not, so a point on a
// shared border belongs to exactly one target.
export function hitTest(targets: TargetRect[], x: number, y: number): string | null {
  let best: TargetRect | null = null;
  for (const r of targets) {
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) continue;
    const area = (r.right - r.left) * (r.bottom - r.top);
    if (!best || area < (best.right - best.left) * (best.bottom - best.top)) best = r;
  }
  return best?.key ?? null;
}

// How far to scroll the page this frame while dragging near the top or bottom edge: faster the
// closer the pointer is, 0 away from the edges.
export function autoScrollDelta(y: number, viewportHeight: number, edge = 48, maxStep = 16): number {
  if (y < edge) return -Math.ceil(maxStep * Math.min(1, (edge - y) / edge));
  if (y > viewportHeight - edge) {
    return Math.ceil(maxStep * Math.min(1, (y - (viewportHeight - edge)) / edge));
  }
  return 0;
}

// ─── The drag gesture ────────────────────────────────────────

// Below this distance a press and release is a tap (pick up, then tap a slot), not a drag.
export const DRAG_THRESHOLD_PX = 6;

export type DragState =
  | { phase: 'idle' }
  | { phase: 'pressed'; pointerId: number; payload: DragPayload; x0: number; y0: number }
  | { phase: 'dragging'; pointerId: number; payload: DragPayload; x: number; y: number;
    over: string | null };

// cancel: pointercancel, lostpointercapture, Escape or the window losing focus.
export type DragInput =
  | { type: 'down'; pointerId: number; button: number; x: number; y: number; payload: DragPayload }
  | { type: 'move'; pointerId: number; x: number; y: number }
  | { type: 'up'; pointerId: number; x: number; y: number }
  | { type: 'cancel' };

// What the view does: show the ghost (start), outline a new target (over: re-render only when
// it changed), toggle pick-and-place (tap), apply the drop's edit (drop), or put things back.
export type DragEffect =
  | { kind: 'start'; payload: DragPayload; over: string | null }
  | { kind: 'over'; over: string | null }
  | { kind: 'tap'; payload: DragPayload }
  | { kind: 'drop'; payload: DragPayload; target: string }
  | { kind: 'cancel'; payload: DragPayload }
  | null;

export const IDLE: DragState = { phase: 'idle' };

export function dragStep(state: DragState, input: DragInput, hit: (x: number, y: number) => string | null)
  : { state: DragState; effect: DragEffect } {
  const target = (payload: DragPayload, x: number, y: number) => {
    const key = hit(x, y);
    return canDrop(payload, key) ? key : null;
  };
  switch (input.type) {
    case 'down':
      // The primary button only, and one gesture at a time.
      if (state.phase !== 'idle' || input.button !== 0) return { state, effect: null };
      return { state: { phase: 'pressed', pointerId: input.pointerId, payload: input.payload,
        x0: input.x, y0: input.y }, effect: null };
    case 'move': {
      if (state.phase === 'idle' || input.pointerId !== state.pointerId) return { state, effect: null };
      if (state.phase === 'pressed') {
        if (Math.hypot(input.x - state.x0, input.y - state.y0) < DRAG_THRESHOLD_PX) {
          return { state, effect: null };
        }
        const over = target(state.payload, input.x, input.y);
        return { state: { phase: 'dragging', pointerId: state.pointerId, payload: state.payload,
          x: input.x, y: input.y, over }, effect: { kind: 'start', payload: state.payload, over } };
      }
      const over = target(state.payload, input.x, input.y);
      const next: DragState = { ...state, x: input.x, y: input.y, over };
      return { state: next, effect: over === state.over ? null : { kind: 'over', over } };
    }
    case 'up': {
      if (state.phase === 'idle' || input.pointerId !== state.pointerId) return { state, effect: null };
      if (state.phase === 'pressed') return { state: IDLE, effect: { kind: 'tap', payload: state.payload } };
      const over = target(state.payload, input.x, input.y);
      return { state: IDLE, effect: over
        ? { kind: 'drop', payload: state.payload, target: over }
        : { kind: 'cancel', payload: state.payload } };
    }
    case 'cancel':
      if (state.phase === 'dragging') return { state: IDLE, effect: { kind: 'cancel', payload: state.payload } };
      return { state: IDLE, effect: null };
  }
}

// ─── Keyboard ────────────────────────────────────────────────

export interface Cell {
  date: string;
  slot: Slot;
}

// Arrow keys move the cursor between slot cells: left and right a day, up and down a slot
// (among the slots switched on), Page Up and Page Down a week, Home and End to the first and
// last day. null at the plan's edge, so the cursor stays put.
export function keyMove(cell: Cell, key: string, w: PlanWindow, slotsOn: readonly Slot[]): Cell | null {
  const day = (n: number) => {
    const date = addDays(cell.date, n);
    return inWindow(w, date) ? { ...cell, date } : null;
  };
  const i = slotsOn.indexOf(cell.slot);
  switch (key) {
    case 'ArrowLeft': return day(-1);
    case 'ArrowRight': return day(1);
    case 'PageUp': return day(-7);
    case 'PageDown': return day(7);
    case 'ArrowUp': return i > 0 ? { ...cell, slot: slotsOn[i - 1] } : null;
    case 'ArrowDown': return i >= 0 && i < slotsOn.length - 1 ? { ...cell, slot: slotsOn[i + 1] } : null;
    case 'Home': return cell.date === w.start_date ? null : { ...cell, date: w.start_date };
    case 'End': {
      const last = addDays(w.start_date, w.days - 1);
      return cell.date === last ? null : { ...cell, date: last };
    }
    default: return null;
  }
}

export interface KeyPress {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type KeyIntent = 'pick' | 'place' | 'cancel' | 'tray' | 'move' | 'undo' | 'redo' | null;

// What a key means on the board. Nothing inside a text field, so typing a servings number or a
// Quick add sentence never moves a meal or undoes an edit.
export function keyIntent(e: KeyPress, ctx: { holding: boolean; inText: boolean }): KeyIntent {
  if (ctx.inText || e.altKey) return null;
  const mod = Boolean(e.ctrlKey || e.metaKey);
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod && k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (mod && k === 'y') return 'redo';
  if (mod) return null;
  if (k === 'Enter' || k === ' ') return ctx.holding ? 'place' : 'pick';
  if (k === 'Escape') return ctx.holding ? 'cancel' : null;
  if (k === 'Delete' || k === 'Backspace') return 'tray';
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(k)) {
    return 'move';
  }
  return null;
}

// A slot button's accessible name: what pressing it does now. A full cell swaps with its first
// meal, as the reducer does.
export function slotLabel(cell: Cell, holding: string | null, occupants: string[]): string {
  const at = `${SLOT_LABELS[cell.slot]}, ${dayLabel(cell.date)}`;
  if (holding) {
    return occupants.length >= CAPACITY[cell.slot]
      ? `Place ${holding} in ${at}, swapping with ${occupants[0]}` : `Place ${holding} in ${at}`;
  }
  return occupants.length ? `${at}: ${occupants.join(' and ')}` : `${at}: empty`;
}
