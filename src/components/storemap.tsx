// "Your stores" on a map, drawn without a map library: OpenStreetMap's tiles through the hub laid
// out as images (mealplan/tiles.ts says which and where), the shopper's point, each store as a
// marker (one turned off greyed, one beyond the distance hollow) and the distance as a circle,
// fitted to the stores in range, with + and − to zoom and a button back to the fit. The list
// beside it is the way in for the keyboard and screen readers, and the map repeats it for the
// eye, so its markers are not tab stops: hovering or focusing a store's row lights its marker,
// and clicking a marker focuses its row. Drawn only while the hub serves tiles (HubStatus.tiles).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { getStatus, tileImage } from '../hub';
import { MAX_ZOOM, MIN_ZOOM, fitStores, kmToPixels, tilesFor, toView } from '../mealplan/tiles';
import type { LatLon } from '../mealplan/tiles';
import { Icon } from './icons';

export interface MapStore {
  id: number;
  name: string;
  at: LatLon;
  off: boolean;
  inRange: boolean;
}

// Whether the hub serves map tiles; off until it says so, and off without a hub.
export function useTilesOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    getStatus().then((s) => { if (live) setOn(Boolean(s.tiles)); }).catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

export function StoreMap({ origin, stores, maxKm, hot, onHot, onPick }: {
  origin: LatLon;
  stores: MapStore[];
  maxKm: number | null;
  hot: number | null;              // the store whose row is hovered or focused
  onHot: (id: number | null) => void;
  onPick: (id: number) => void;    // a marker clicked: focus its row
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // What the fit shows: the shopper and the stores in range (with the circle's edge in view).
  const near = useMemo(() => stores.filter((s) => s.inRange).map((s) => s.at), [stores]);
  const fitKey = JSON.stringify([origin, near, maxKm]);
  // zoom steps from the fit, forgotten when what it fits changes
  const [zoomed, setZoomed] = useState({ key: fitKey, by: 0 });
  const by = zoomed.key === fitKey ? zoomed.by : 0;
  const fitted = fitStores(origin, near, maxKm, size.width, size.height);
  const view = fitted && { ...fitted, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitted.zoom + by)) };
  const [failed, setFailed] = useState<string[]>([]);

  const tiles = view ? tilesFor(view) : [];
  const you = view ? toView(origin, view) : null;
  const r = view && maxKm !== null ? kmToPixels(maxKm, origin.lat, view.zoom) : 0;
  const lost = tiles.length > 0 && tiles.every((t) => failed.includes(`${t.z}/${t.x}/${t.y}`));

  return (
    <div className="smap" role="group" aria-label="Map of the stores">
      <p className="sr-only">The stores in the list, on a map around where you are; the list says the same.</p>
      <div className="smap-view" ref={box}>
        <div className="smap-tiles" aria-hidden="true">
          {tiles.map((t) => {
            const name = `${t.z}/${t.x}/${t.y}`;
            return (
              <img key={t.key} src={tileImage(t.z, t.x, t.y)} alt="" width={256} height={256} draggable={false}
                   className={failed.includes(name) ? 'smap-tile-lost' : undefined} style={{ left: t.left, top: t.top }}
                   onError={() => setFailed((f) => (f.includes(name) ? f : [...f, name]))} />
            );
          })}
        </div>
        {lost && <p className="smap-lost">The map could not be loaded; the list has every store.</p>}
        {view && you && (
          <div className="smap-marks" aria-hidden="true">
            {r > 0 && (
              <span className="smap-circle" style={{ left: you.x - r, top: you.y - r, width: 2 * r, height: 2 * r }} />
            )}
            <span className="smap-you" style={{ left: you.x, top: you.y }} title="You" />
            {stores.map((s) => {
              const p = toView(s.at, view);
              const cls = `smap-pin${s.off ? ' smap-pin-off' : ''}${s.inRange ? '' : ' smap-pin-far'}`
                + `${hot === s.id ? ' smap-pin-hot' : ''}`;
              return (
                <button key={s.id} type="button" tabIndex={-1} className={cls} style={{ left: p.x, top: p.y }}
                        onClick={() => onPick(s.id)}
                        onMouseEnter={() => onHot(s.id)} onMouseLeave={() => onHot(null)}>
                  <Icon name="store" size={15} />
                  {hot === s.id && <span className="smap-pin-name">{s.name}</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="smap-zoom">
          <button type="button" aria-label="Zoom in" disabled={!view || view.zoom >= MAX_ZOOM}
                  onClick={() => setZoomed({ key: fitKey, by: by + 1 })}><Icon name="plus" size={16} /></button>
          <button type="button" aria-label="Zoom out" disabled={!view || view.zoom <= MIN_ZOOM}
                  onClick={() => setZoomed({ key: fitKey, by: by - 1 })}><Icon name="minus" size={16} /></button>
          <button type="button" aria-label="Show every store" title="Show every store" disabled={by === 0}
                  onClick={() => setZoomed({ key: fitKey, by: 0 })}><Icon name="locate" size={16} /></button>
        </div>
        <p className="smap-attr">
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
        </p>
      </div>
      <ul className="smap-key" aria-hidden="true">
        <li><span className="smap-key-you" />You</li>
        <li><span className="smap-key-pin" />A store</li>
        <li><span className="smap-key-pin smap-key-off" />Turned off</li>
        {maxKm !== null && <li><span className="smap-key-circle" />{maxKm} km</li>}
      </ul>
    </div>
  );
}
