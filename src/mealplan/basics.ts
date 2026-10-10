// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The wizard's Basics stage, decided without the browser: where the household shops (an
// address searched through the demo hub, the device's location, or one of the demo's Vancouver
// areas), how far it goes, which demo stores that reaches, and the words for each. The point is
// what counts (lat, lon, max_km); the address only names it. With no point the server's own
// reference point, downtown Vancouver, is used, and distances here are measured from it too.
import type { PlanSettings, Store } from '../types.ts';

// pantry-api's DEFAULT_LAT and DEFAULT_LON: where a plan with no point shops from.
export const DEFAULT_POINT = { lat: 49.28, lon: -123.12 } as const;

export interface Point {
  lat: number;
  lon: number;
}

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

// How far the household goes; null is any distance.
export const DISTANCES: readonly (number | null)[] = [2, 5, 10, 25, null];

export const distanceLabel = (km: number | null): string => (km === null ? 'Any' : `${km} km`);

// The choices shown: the usual ones, and a plan's own distance among them when it is another.
export function distanceChoices(current: number | null | undefined): (number | null)[] {
  const c = current ?? null;
  if (DISTANCES.includes(c)) return [...DISTANCES];
  return [...DISTANCES.filter((x) => x !== null), c as number, null].sort((a, b) =>
    (a === null ? 1 : b === null ? -1 : a - b));
}

const RADIUS_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

// Great-circle distance in km.
export function haversineKm(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const pointOf = (st: PlanSettings): Point =>
  (st.lat != null && st.lon != null ? { lat: st.lat, lon: st.lon } : { ...DEFAULT_POINT });

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

export interface StoreNear {
  id: number;
  name: string;
  address: string;
  km: number;
}

// The demo's stores from the household's point, nearest first, and those within its distance.
export function storesNear(stores: readonly Store[], st: PlanSettings): { inRange: StoreNear[]; nearest: StoreNear | null } {
  const from = pointOf(st);
  const all = stores.map((s) => ({ id: s.id, name: s.name, address: s.address,
    km: haversineKm(from, { lat: s.lat, lon: s.lon }) })).sort((a, b) => a.km - b.km || a.id - b.id);
  const max = st.max_km ?? null;
  return { inRange: max === null ? all : all.filter((s) => s.km <= max), nearest: all[0] ?? null };
}

export const kmText = (km: number): string => `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;

// The line over the stores in range, or the warning when there are none.
export function rangeText(near: { inRange: StoreNear[]; nearest: StoreNear | null }, st: PlanSettings): {
  text: string; warn: boolean;
} {
  const n = near.inRange.length;
  const within = st.max_km == null ? 'at any distance' : `within ${distanceLabel(st.max_km)}`;
  if (n) return { text: `${n} demo ${n === 1 ? 'store' : 'stores'} ${within}`, warn: false };
  const nearest = near.nearest ? ` The nearest is ${near.nearest.name}, ${kmText(near.nearest.km)} away.` : '';
  return { warn: true, text: `No store ${within} of ${placeText(st)}. The demo's stores are all in Vancouver: `
    + `pick a Vancouver area or a longer distance.${nearest}` };
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
