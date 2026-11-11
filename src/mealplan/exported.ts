// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Whether a plan's events have gone to a calendar: the Calendar stage's file downloaded, or a
// Google Calendar sync written with nothing failed. The console cannot look into the shopper's
// calendar app, so this is what it can know: the last time it handed the events over, how, and for
// which events. That finishes the plan's last step (the progress indicator ticks Calendar, Home
// says Done) until the events change.
//
// A mark is kept beside the plan, in this browser (pantry.exported.v1), never in it: marking is not
// an edit, so it gives the plan no new revision, no schedule call and no undo step. The events are
// remembered by a signature of what they are (each trip, cook and reminder by its id and day, a
// trip by what it buys), not by the plan's revision: an edit that leaves the events as they were
// keeps the mark current, and one that changes them (another trip approved, a meal moved) reads as
// changed since. Keyed by the plan's id, so a new plan starts unmarked.
import type { StorageLike } from './persist.ts';
import type { ApprovedSchedule } from '../types.ts';

export const EXPORTED_KEY = 'pantry.exported.v1';
// The plans whose marks are kept, the latest marked last.
export const EXPORTED_PLANS = 5;

export type ExportHow = 'file' | 'google';

export interface ExportMark {
  id: string;                      // the plan's id
  sig: string;                     // eventsSignature of the events handed over
  events: number;                  // how many
  how: ExportHow;
  at: string;                      // when, as an ISO instant
}

export interface ExportedState {
  v: 1;
  plans: ExportMark[];             // the latest marked last
}

export const emptyExported = (): ExportedState => ({ v: 1, plans: [] });

// FNV-1a, 32 bits: a short, steady name for a long text. It tells one set of events from another;
// it is no secret and guards nothing.
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// What the events are, whatever order the schedule lists them in: each trip by its id, day and
// fingerprint (what it buys), each cook by its item, day and slot, each reminder by its item and day.
export function eventsSignature(a: ApprovedSchedule): string {
  const items = [
    ...a.trips.map((t) => `t|${t.id}|${t.date}|${t.fingerprint ?? ''}`),
    ...(a.cooks ?? []).map((c) => `c|${c.item_id}|${c.date}|${c.slot}`),
    ...(a.reminders ?? []).map((r) => `r|${r.item_id}|${r.date}|${r.kind}`),
  ].sort();
  return fnv1a(items.join('\n'));
}

const isHow = (x: unknown): x is ExportHow => x === 'file' || x === 'google';

// The marks in a stored value, keeping only what this console wrote: a value that is not ours, or
// is damaged, reads as no marks rather than an error.
export function parseExported(raw: string | null): ExportedState {
  if (!raw) return emptyExported();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyExported();
  }
  if (typeof data !== 'object' || data === null || (data as { v?: unknown }).v !== 1) return emptyExported();
  const plans = (data as { plans?: unknown }).plans;
  if (!Array.isArray(plans)) return emptyExported();
  const out: ExportMark[] = [];
  for (const p of plans) {
    if (typeof p !== 'object' || p === null) continue;
    const { id, sig, events, how, at } = p as Record<string, unknown>;
    if (typeof id !== 'string' || !id || typeof sig !== 'string' || !/^[0-9a-f]{8}$/.test(sig)) continue;
    if (typeof events !== 'number' || !Number.isInteger(events) || events < 0 || !isHow(how)) continue;
    if (typeof at !== 'string' || out.some((x) => x.id === id)) continue;
    out.push({ id, sig, events, how, at });
  }
  return { v: 1, plans: out.slice(-EXPORTED_PLANS) };
}

// What this browser holds; no marks when storage is off, refuses or holds something else.
export function readExported(storage: StorageLike | null): ExportedState {
  if (!storage) return emptyExported();
  try {
    return parseExported(storage.getItem(EXPORTED_KEY));
  } catch {
    return emptyExported();
  }
}

// False when the browser would not keep it: the page keeps the mark for itself meanwhile.
export function writeExported(storage: StorageLike | null, s: ExportedState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(EXPORTED_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

// The state with a plan's mark replaced by this one, the plan moved to the end as the latest.
export function markExported(s: ExportedState, mark: ExportMark): ExportedState {
  return { v: 1, plans: [...s.plans.filter((p) => p.id !== mark.id), mark].slice(-EXPORTED_PLANS) };
}

export const exportedFor = (s: ExportedState, planId: string): ExportMark | null =>
  s.plans.find((p) => p.id === planId) ?? null;

// current: the events handed over are the plan's events now. changed: they were handed over, and
// the events have changed since. none: never, or there are no events to compare with yet.
export type ExportState = 'current' | 'changed' | 'none';

export function exportState(mark: ExportMark | null, a: ApprovedSchedule | null | undefined): ExportState {
  if (!mark || !a || a.v !== 1 || !Array.isArray(a.cooks)) return 'none';
  return eventsSignature(a) === mark.sig ? 'current' : 'changed';
}

// What the last step has produced, in Home's words: "23 events downloaded", "23 events in Google
// Calendar"; and, once the events have changed, how the plan has moved on since.
export function exportedText(mark: ExportMark): string {
  const n = `${mark.events} ${mark.events === 1 ? 'event' : 'events'}`;
  return mark.how === 'google' ? `${n} in Google Calendar` : `${n} downloaded`;
}

export const changedSinceText = (how: ExportHow): string =>
  `changed since you ${how === 'google' ? 'synced them' : 'downloaded them'}`;
