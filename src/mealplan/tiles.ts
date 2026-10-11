// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Web Mercator tile math for the stores map (components/storemap.tsx), with no map library:
// where a latitude and longitude fall on the world at a zoom (OpenStreetMap's 256-pixel tiles,
// numbered z/x/y from the top left), which tiles cover a view and where each one sits, where a
// point sits in a view, how many pixels a distance is there, and the closest zoom at which a set
// of points fits with a margin.

export const TILE = 256;
// OpenStreetMap draws to 19; 18 is streets and doors, plenty for a few stores.
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 18;
// Web Mercator stops short of the poles, where the projection runs to infinity.
const MAX_LAT = 85.05112878;
const EARTH_M = 6378137;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Pixel {
  x: number;
  y: number;
}

// What the map shows: its centre, zoom and size in CSS pixels.
export interface View {
  center: LatLon;
  zoom: number;
  width: number;
  height: number;
}

export interface TilePlace {
  z: number;
  x: number;                       // the tile's own number, wrapped round the world
  y: number;
  left: number;                    // where its top left sits in the view
  top: number;
  key: string;                     // unique in the view even when x wraps
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rad = (deg: number) => (deg * Math.PI) / 180;

// The world in pixels at zoom z is 256 × 2^z on a side: x from 180° west, y from the top.
export function worldPixel(p: LatLon, z: number): Pixel {
  const size = TILE * 2 ** z;
  const sin = Math.sin(rad(clamp(p.lat, -MAX_LAT, MAX_LAT)));
  return {
    x: ((p.lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export function latLonAt(px: Pixel, z: number): LatLon {
  const size = TILE * 2 ** z;
  const n = Math.PI - (2 * Math.PI * px.y) / size;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon: (px.x / size) * 360 - 180 };
}

// The tile a point is on.
export function tileOf(p: LatLon, z: number): { z: number; x: number; y: number } {
  const w = worldPixel(p, z);
  const n = 2 ** z;
  return { z, x: clamp(Math.floor(w.x / TILE), 0, n - 1), y: clamp(Math.floor(w.y / TILE), 0, n - 1) };
}

// Metres one pixel covers at a latitude: 156 543 m at the equator at zoom 0, less toward the poles.
export function metresPerPixel(lat: number, z: number): number {
  return (2 * Math.PI * EARTH_M * Math.cos(rad(clamp(lat, -MAX_LAT, MAX_LAT)))) / (TILE * 2 ** z);
}

// A distance on the ground as pixels on the map, at a point's latitude.
export const kmToPixels = (km: number, lat: number, z: number): number => (km * 1000) / metresPerPixel(lat, z);

// Where a point sits in a view, in pixels from its top left.
export function toView(p: LatLon, v: View): Pixel {
  const c = worldPixel(v.center, v.zoom);
  const q = worldPixel(p, v.zoom);
  return { x: q.x - c.x + v.width / 2, y: q.y - c.y + v.height / 2 };
}

// The tiles that cover a view, each placed at whole pixels: x wraps round the world, and above
// the top or below the bottom of the world there are none.
export function tilesFor(v: View): TilePlace[] {
  const c = worldPixel(v.center, v.zoom);
  const x0 = c.x - v.width / 2;
  const y0 = c.y - v.height / 2;
  const n = 2 ** v.zoom;
  const out: TilePlace[] = [];
  for (let ty = Math.floor(y0 / TILE); ty * TILE < y0 + v.height; ty += 1) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(x0 / TILE); tx * TILE < x0 + v.width; tx += 1) {
      out.push({ z: v.zoom, x: ((tx % n) + n) % n, y: ty, left: Math.round(tx * TILE - x0),
        top: Math.round(ty * TILE - y0), key: `${v.zoom}/${tx}/${ty}` });
    }
  }
  return out;
}

// The points at the edge of a circle round a centre, north, south, east and west, so a fit
// that takes them in shows the whole circle.
export function circleEdge(center: LatLon, km: number): LatLon[] {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.max(0.01, Math.cos(rad(center.lat))));
  return [
    { lat: center.lat + dLat, lon: center.lon }, { lat: center.lat - dLat, lon: center.lon },
    { lat: center.lat, lon: center.lon + dLon }, { lat: center.lat, lon: center.lon - dLon },
  ];
}

// The view that shows every point with `pad` pixels to spare on each side: centred on the
// middle of them, at the closest zoom up to `maxZoom` (one point alone shows its streets).
// null with nothing to show or no room to show it in.
export function fitView(points: readonly LatLon[], width: number, height: number, pad = 28,
  maxZoom = 16): View | null {
  if (!points.length || width <= 0 || height <= 0) return null;
  const px = points.map((p) => worldPixel(p, 0));
  const xs = px.map((p) => p.x);
  const ys = px.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const center = latLonAt({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, 0);
  const roomX = Math.max(1, width - 2 * pad);
  const roomY = Math.max(1, height - 2 * pad);
  let zoom = MIN_ZOOM;
  for (let z = Math.min(maxZoom, MAX_ZOOM); z >= MIN_ZOOM; z -= 1) {
    if ((maxX - minX) * 2 ** z <= roomX && (maxY - minY) * 2 ** z <= roomY) {
      zoom = z;
      break;
    }
  }
  return { center, zoom, width, height };
}

// The stores map's view: the shopper and the stores in range, and the distance circle round the
// shopper drawn at least partly: zoomed out until its radius is no more than half the view's
// longer side, so its edge crosses the view. With no store in range, the whole circle.
export function fitStores(origin: LatLon, stores: readonly LatLon[], km: number | null, width: number,
  height: number): View | null {
  const points = stores.length || km === null ? [origin, ...stores] : [origin, ...circleEdge(origin, km)];
  const v = fitView(points, width, height);
  if (!v || km === null) return v;
  let zoom = v.zoom;
  while (zoom > MIN_ZOOM && kmToPixels(km, origin.lat, zoom) > Math.max(width, height) / 2) zoom -= 1;
  return { ...v, zoom };
}

// One zoom step in or out, kept between MIN_ZOOM and MAX_ZOOM.
export const zoomBy = (v: View, step: number): View => ({ ...v, zoom: clamp(v.zoom + step, MIN_ZOOM, MAX_ZOOM) });
