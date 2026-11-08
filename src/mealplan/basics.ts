// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The wizard's Basics stage, decided without the browser: where the shopper is (an address
// searched through the demo hub, the device's location, or one of the demo's Vancouver areas)
// and the words around the search; the stores near it are chosen later, in Ingredients
// (stores.ts). The point is what counts (lat, lon); the address only names it. With no point
// the server's own reference point, downtown Vancouver, is used. Also here: the budget's quick
// picks and daily figure, and the "Your plan" summary beside the form.
import { addDays, dayLabel } from './dates.ts';
import { AVOID_LABELS, DIET_LABELS, SLOTS, SLOT_LABELS, avoidOf, budgetOf, dietOf } from './model.ts';
import { originRules } from './wizard.ts';
import type { MealPlanDraft, PlanSettings } from '../types.ts';

// The demo's areas as quick picks. Downtown is the server's default: no point, no address.
export interface Area {
  id: string;
  label: string;
  lat: number | null;
  lon: number | null;
}

export const AREAS: readonly Area[] = [
  { id: 'downtown', label: 'Downtown Vancouver', lat: null, lon: null },
  { id: 'kitsilano', label: 'Kitsilano', lat: 49.2684, lon: -123.1683 },
  { id: 'east-vancouver', label: 'East Vancouver', lat: 49.2765, lon: -123.07 },
  { id: 'richmond', label: 'Richmond', lat: 49.1666, lon: -123.1336 },
];

// The area a plan's point is, if it is one.
export function areaOf(st: PlanSettings): Area | null {
  return AREAS.find((a) => a.lat === (st.lat ?? null) && a.lon === (st.lon ?? null)) ?? null;
}

// The settings for an area: its point, and its name as the address (none for the default).
export const areaSettings = (a: Area): PlanSettings =>
  ({ lat: a.lat, lon: a.lon, address: a.lat === null ? null : a.label });

// What the household's place is called: its address, an area's name, or the point itself.
export function placeText(st: PlanSettings): string {
  if (st.address) return st.address;
  const area = areaOf(st);
  if (area) return area.label;
  return `${(st.lat as number).toFixed(4)}, ${(st.lon as number).toFixed(4)}`;
}

export const CURRENT_LOCATION = 'Your current location';

// The device's position as the plan keeps it: to four decimals (about 10 m), which finds the
// stores as well and keeps no more than that.
export function locationSettings(lat: number, lon: number): PlanSettings | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const round = (x: number) => Math.round(x * 1e4) / 1e4;
  return { lat: round(lat), lon: round(lon), address: CURRENT_LOCATION };
}

export const PRIVACY_NOTE = 'Your address is sent to OpenStreetMap only when you search, and saved only in this browser.';

// Why a search cannot be sent yet, or null.
export function searchProblem(q: string): string | null {
  const t = q.trim();
  if (t.length < 3) return 'Type at least three letters of a street, place or postcode.';
  if (t.length > 200) return 'That is longer than an address: 200 characters at most.';
  return null;
}

// The hub's refusal of a search, as the shopper reads it.
export function geocodeErrorText(status: number, code: string | null): string {
  switch (code) {
    case 'bad_query': return 'That search could not be read: try a street and a city.';
    case 'rate_limited': return 'Searches are limited to one a second: try again in a moment.';
    case 'geocoder_unavailable': return 'OpenStreetMap’s search did not answer: try again, or pick an area below.';
    case 'geocoder_off': return 'Address search is off on this hub: pick an area below.';
    default: break;
  }
  if (status === 0) return 'The demo hub is not reachable: pick an area below.';
  return `The search failed (${status}): pick an area below.`;
}

// The browser's refusal to give the device's position (GeolocationPositionError codes), kindly.
export function locationErrorText(code: number | 'unsupported'): string {
  switch (code) {
    case 1: return 'This page is not allowed your location: allow it in the browser, or search an address.';
    case 2: return 'Your device could not tell where it is: search an address or pick an area.';
    case 3: return 'Finding your location took too long: try again, or search an address.';
    default: return 'This browser cannot share your location: search an address or pick an area.';
  }
}

// The hub's refusal code from what a failed call carried: {code, message}, or the code alone.
export function refusalCode(detail: unknown): string | null {
  if (detail && typeof detail === 'object' && typeof (detail as { code?: unknown }).code === 'string') {
    return (detail as { code: string }).code;
  }
  return typeof detail === 'string' && /^[a-z_]+$/.test(detail) ? detail : null;
}

// ─── Budget ──────────────────────────────────────────────────

export const BUDGET_PICKS: readonly number[] = [50, 75, 100, 150];

const money = (v: number) => `$${v.toFixed(2)}`;

// "about $10.71 a day"
export const perDayText = (budget: number, days: number): string => `about ${money(budget / days)} a day`;

// ─── The summary ─────────────────────────────────────────────

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// "Every day", "Weekdays", "Weekends", or the days: "Mon, Wed and Sat".
export function weekdaysText(days: readonly number[]): string {
  const d = [...days].sort((a, b) => a - b);
  if (d.length === 7) return 'Every day';
  if (d.join() === '0,1,2,3,4') return 'Weekdays';
  if (d.join() === '5,6') return 'Weekends';
  const names = d.map((i) => WEEKDAY_NAMES[i]);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export interface SummaryRow {
  key: 'when' | 'budget' | 'diet' | 'avoid' | 'origin' | 'where' | 'days' | 'meals';
  label: string;
  value: string;
  note?: string;
}

// The "Your plan" card: each answer in Basics in a few words.
export function planSummary(d: MealPlanDraft): SummaryRow[] {
  const budget = budgetOf(d.prefs);
  const avoid = avoidOf(d.prefs);
  const o = originRules(d.settings);
  const st = d.settings;
  const slots = SLOTS.filter((sl) => d.prefs.slots_on.includes(sl)).map((sl) => SLOT_LABELS[sl]);
  const origin = [o.excludeUS ? 'No US products' : 'US products allowed',
    o.preferCanada ? 'Canada first' : '', o.allies.length ? `then ${o.allies.length} more` : ''].filter(Boolean);
  return [
    { key: 'when', label: 'When', value: `${dayLabel(d.start_date)} – ${dayLabel(addDays(d.start_date, d.days - 1))}`,
      note: d.days === 7 ? '1 week' : d.days === 14 ? '2 weeks' : `${d.days} days` },
    { key: 'budget', label: 'Budget', value: budget === null ? 'No budget' : money(budget),
      ...(budget === null ? {} : { note: perDayText(budget, d.days) }) },
    { key: 'diet', label: 'Diet', value: DIET_LABELS[dietOf(d.prefs)] },
    { key: 'avoid', label: 'Leave out', value: avoid.length ? avoid.map((t) => AVOID_LABELS[t]).join(', ') : 'Nothing' },
    { key: 'origin', label: 'Origin', value: origin.join(' · ') },
    { key: 'where', label: 'Where you are', value: placeText(st) },
    { key: 'days', label: 'Shop on', value: weekdaysText(d.prefs.shop_weekdays) },
    { key: 'meals', label: 'Meals', value: slots.join(', ') },
  ];
}
