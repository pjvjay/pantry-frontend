// Web Mercator tile math for the stores map: points to tiles and pixels and back, the tiles a
// view needs and where they sit, distances in pixels, and the zoom that fits the stores.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_ZOOM, MIN_ZOOM, TILE, circleEdge, fitStores, fitView, kmToPixels, latLonAt, metresPerPixel, tileOf, tilesFor,
  toView, worldPixel, zoomBy,
} from '../src/mealplan/tiles.ts';

const VANCOUVER = { lat: 49.28, lon: -123.12 };
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);

test('the world at zoom 0 is one tile, with 0°, 0° in its middle', () => {
  assert.deepEqual(worldPixel({ lat: 0, lon: 0 }, 0), { x: 128, y: 128 });
  assert.equal(worldPixel({ lat: 0, lon: -180 }, 3).x, 0);
  assert.equal(worldPixel({ lat: 0, lon: 180 }, 3).x, TILE * 8);
  // the poles are cut at 85.05°: the top and bottom of the world
  near(worldPixel({ lat: 90, lon: 0 }, 0).y, 0, 1e-6);
  near(worldPixel({ lat: -90, lon: 0 }, 0).y, 256, 1e-6);
});

test('a point’s tile, as OpenStreetMap numbers it', () => {
  assert.deepEqual(tileOf(VANCOUVER, 10), { z: 10, x: 161, y: 350 });
  assert.deepEqual(tileOf(VANCOUVER, 0), { z: 0, x: 0, y: 0 });
  assert.deepEqual(tileOf({ lat: 51.5074, lon: -0.1278 }, 12), { z: 12, x: 2046, y: 1362 }, 'London');
  assert.deepEqual(tileOf({ lat: -90, lon: 180 }, 2), { z: 2, x: 3, y: 3 }, 'the last tile, not one past it');
});

test('pixels back to a point', () => {
  for (const z of [0, 5, 12, 18]) {
    const back = latLonAt(worldPixel(VANCOUVER, z), z);
    near(back.lat, VANCOUVER.lat, 1e-9);
    near(back.lon, VANCOUVER.lon, 1e-9);
  }
});

test('metres a pixel covers, and a distance in pixels', () => {
  near(metresPerPixel(0, 0), 156543.03392, 1e-4);
  near(metresPerPixel(60, 1), 156543.03392 / 4, 1e-4);
  // 5 km round Vancouver at zoom 12 is about 200 pixels
  near(kmToPixels(5, 49.28, 12), 5000 / (156543.03392 * Math.cos((49.28 * Math.PI) / 180) / 4096), 1e-6);
  assert.equal(Math.round(kmToPixels(5, 49.28, 12)), 201);
});

test('a view’s centre is its middle, and a point east and south of it is to the right and below', () => {
  const v = { center: VANCOUVER, zoom: 13, width: 400, height: 300 };
  assert.deepEqual(toView(VANCOUVER, v), { x: 200, y: 150 });
  const p = toView({ lat: 49.27, lon: -123.10 }, v);
  assert.ok(p.x > 200 && p.y > 150);
  // one zoom step in doubles every distance from the centre
  const q = toView({ lat: 49.27, lon: -123.10 }, zoomBy(v, 1));
  near(q.x - 200, 2 * (p.x - 200), 1e-6);
  near(q.y - 150, 2 * (p.y - 150), 1e-6);
});

test('the tiles a view needs, each placed where it sits', () => {
  // the whole world at zoom 1 in a 512 × 512 view centred on 0°, 0°: four tiles, edge to edge
  const world = tilesFor({ center: { lat: 0, lon: 0 }, zoom: 1, width: 512, height: 512 });
  assert.deepEqual(world.map((t) => [t.x, t.y, t.left, t.top]), [[0, 0, 0, 0], [1, 0, 256, 0], [0, 1, 0, 256], [1, 1, 256, 256]]);
  // a view across the antimeridian wraps x, and its keys stay distinct
  const wrap = tilesFor({ center: { lat: 0, lon: 180 }, zoom: 1, width: 512, height: 256 });
  assert.deepEqual(wrap.filter((t) => t.y === 0).map((t) => t.x), [1, 0]);
  assert.equal(new Set(wrap.map((t) => t.key)).size, wrap.length);
  // nothing above the top of the world
  const top = tilesFor({ center: { lat: 85, lon: 0 }, zoom: 2, width: 256, height: 512 });
  assert.ok(top.every((t) => t.y >= 0 && t.y < 4));
  // every pixel of a view is covered
  const v = { center: VANCOUVER, zoom: 13, width: 437, height: 263 };
  const tiles = tilesFor(v);
  assert.ok(Math.min(...tiles.map((t) => t.left)) <= 0 && Math.min(...tiles.map((t) => t.top)) <= 0);
  assert.ok(Math.max(...tiles.map((t) => t.left + TILE)) >= v.width);
  assert.ok(Math.max(...tiles.map((t) => t.top + TILE)) >= v.height);
  assert.equal(tiles.length, 6, 'three across, two down');
});

test('the fitted view shows every store with room to spare, at the closest zoom that does', () => {
  const stores = [VANCOUVER, { lat: 49.2680, lon: -123.1550 }, { lat: 49.2620, lon: -123.0700 }];
  const v = fitView(stores, 480, 260, 28);
  assert.ok(v);
  for (const s of stores) {
    const p = toView(s, v);
    assert.ok(p.x >= 28 && p.x <= 480 - 28 && p.y >= 28 && p.y <= 260 - 28, JSON.stringify(p));
  }
  // one zoom closer and one of them would be out of the margin
  const closer = zoomBy(v, 1);
  assert.ok(stores.some((s) => {
    const p = toView(s, closer);
    return p.x < 28 || p.x > 480 - 28 || p.y < 28 || p.y > 260 - 28;
  }));
  assert.equal(v.zoom, 12);
});

test('a single point shows its streets; nothing, or no room, is no view', () => {
  assert.equal(fitView([VANCOUVER], 300, 200)?.zoom, 16);
  assert.equal(fitView([VANCOUVER], 300, 200, 28, 14)?.zoom, 14);
  assert.equal(fitView([], 300, 200), null);
  assert.equal(fitView([VANCOUVER], 0, 200), null);
});

test('a distance circle’s edge, so the fit takes it all in', () => {
  const edge = circleEdge(VANCOUVER, 5);
  const v = fitView([VANCOUVER, ...edge], 400, 400, 20);
  assert.ok(v);
  const r = kmToPixels(5, VANCOUVER.lat, v.zoom);
  assert.ok(r * 2 <= 400 - 40, 'the circle fits');
  assert.ok(r * 4 > 400 - 40, 'and one zoom closer it would not');
  near(edge[0].lat - VANCOUVER.lat, 5 / 111.32, 1e-9);
});

test('zoom steps stop at the ends', () => {
  const v = { center: VANCOUVER, zoom: MAX_ZOOM, width: 10, height: 10 };
  assert.equal(zoomBy(v, 1).zoom, MAX_ZOOM);
  assert.equal(zoomBy({ ...v, zoom: MIN_ZOOM }, -1).zoom, MIN_ZOOM);
});

test('the stores map: the stores in range, with the distance circle’s edge in view', () => {
  const stores = [{ lat: 49.2820, lon: -123.1180 }, { lat: 49.2680, lon: -123.1550 }, { lat: 49.2620, lon: -123.0700 }];
  const v = fitStores(VANCOUVER, stores, 5, 574, 300);
  assert.ok(v);
  assert.ok(kmToPixels(5, VANCOUVER.lat, v.zoom) <= 287, 'the circle crosses the view');
  assert.ok(kmToPixels(5, VANCOUVER.lat, v.zoom + 1) > 287, 'and no further out than that');
  for (const s of stores) {
    const p = toView(s, v);
    assert.ok(p.x >= 0 && p.x <= 574 && p.y >= 0 && p.y <= 300);
  }
  // any distance: no circle, just the stores
  assert.deepEqual(fitStores(VANCOUVER, stores, null, 574, 300), fitView([VANCOUVER, ...stores], 574, 300));
  // none in range: the whole circle
  const none = fitStores(VANCOUVER, [], 2, 400, 300);
  assert.ok(none && 2 * kmToPixels(2, VANCOUVER.lat, none.zoom) <= 300);
});
