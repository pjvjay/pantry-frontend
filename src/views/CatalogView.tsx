// Workshop › Catalog: the planner's own lookup (find_product), the whole catalog as a table, and a
// product's offers, origin and evidence (get_product). The table comes from the pantry API and
// works without the demo hub; the lookup and the details are MCP calls through the hub, so while
// the hub is off they say so quietly here and the Workshop's one panel says why.
//
// Both tables are grids of rows the keyboard walks (components/useRowNav.ts): one Tab stop, the
// arrow keys along the rows, Enter shows the product. On a wide screen it shows in the panel beside
// the table. On a narrower one that panel would land below a long table, out of sight, so the
// product opens in a sheet over the table instead, and closing it puts the keyboard back on its row.
// Prices and the price per 100 g sit right-aligned in figures of one width, so they compare down
// the column; the table's head stays in view while its rows scroll.
import { useEffect, useId, useMemo, useState } from 'react';

import { JsonView } from '../components/common';
import { EvidenceCard, StateTag } from '../components/evidence';
import { Icon } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { ErrorBanner, HubErrorBanner, Skeleton, Tag } from '../components/ui';
import { useMedia } from '../components/useMedia';
import { useRowNav } from '../components/useRowNav';
import { getProducts, pantryTool } from '../hub';
import { useHubStatus } from '../hubStatus';
import type { Product } from '../types';
import { claimLabel, originStatus, stamp, unitPrice, unitPriceText } from '../workshop';

// The catalog's list also carries each product's size, which prices it per 100 g.
type CatalogProduct = Product & { unit_qty?: number | null; unit_uom?: string | null };

interface Offer { store: string; price: number; distance_km: number }
interface Evidence {
  source: string; source_ref?: string; claim_type: string; verbatim: string; ingredient_origin: string;
  manufactured_in: string; confidence: string; importer_only?: boolean; observed_at?: string;
}
interface ProductDetail {
  id: number; name: string; brand: string; description: string; category: string;
  subcategory: string; dietary_tags: string; unit_size: string; list_price: number;
  offers: Offer[];
  origin: { status: string; country: string; claim_type: string; verbatim: string;
            confidence: string; source: string; evidence_count: number; seen_countries?: string[] };
  evidence: Evidence[];
  pending_submissions: number | null;
  review_count: number;
  avg_rating: number | null;
}
interface FindResult {
  query: string; match: string; total: number; note?: string;
  items: { id: number; name: string; brand: string; price: number; store: string;
           distance_km: number; origin_status: string }[];
}

const money = (n: number) => `$${n.toFixed(2)}`;

// One product's offers, origin and evidence. `inSheet`: the sheet's own title names the product.
function ProductDetailView({ detail, onLabel, inSheet = false }: {
  detail: ProductDetail; onLabel: (productId: number) => void; inSheet?: boolean;
}) {
  const origin = detail.origin;
  const seen = origin.seen_countries ?? [];
  const pending = detail.pending_submissions ?? 0;
  const facts = [detail.brand, detail.unit_size, [detail.category, detail.subcategory].filter(Boolean).join(' / ')]
    .filter(Boolean).join(' · ');
  return (
    <div className="pd">
      {!inSheet && <h2 className="pd-name">{detail.name}</h2>}
      <p className="card-sub">{facts}{detail.dietary_tags && ` · contains ${detail.dietary_tags}`}</p>
      {detail.description && <p className="pd-desc">{detail.description}</p>}

      <h3 className="pd-sub">Store offers</h3>
      {detail.offers.length === 0 ? <p className="pd-none">No store sells it.</p> : (
        <table className="pd-offers">
          <thead><tr><th>Store</th><th className="num">Distance</th><th className="num">Price</th></tr></thead>
          <tbody>
            {detail.offers.map((o) => (
              <tr key={o.store}>
                <td>{o.store}</td>
                <td className="num">{o.distance_km} km</td>
                <td className="num">{money(o.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="pd-sub">Origin</h3>
      <p className="pd-origin">
        <StateTag state={originStatus(origin.status)} />
        {origin.country && <strong>{origin.country}</strong>}
        {origin.status === 'resolved' && origin.claim_type && <span className="muted">{claimLabel(origin.claim_type)}</span>}
      </p>
      {origin.status === 'conflicting' && seen.length > 1 && (
        <p className="pd-why">The sources name {seen.join(' and ')}, so no country is picked.</p>
      )}
      {pending > 0 && (
        <p className="pd-why"><Tag kind="progress">{pending} waiting</Tag> {pending === 1 ? 'A label reading is' : 'Label readings are'} in the review queue.</p>
      )}

      <h3 className="pd-sub">Evidence <span className="pd-count">{detail.evidence.length}</span></h3>
      {detail.evidence.length === 0 ? (
        <p className="pd-none">
          No source has published where this comes from. A photo of the label would settle it: submit
          what it says, and a reviewer decides.
        </p>
      ) : (
        <ul className="ev-list">
          {detail.evidence.map((ev, i) => (
            <li key={i}>
              <EvidenceCard
                evidence={{ claim: ev.claim_type, origin: ev.ingredient_origin, madeIn: ev.manufactured_in,
                  verbatim: ev.verbatim, source: ev.source, sourceRef: ev.source_ref, confidence: ev.confidence,
                  importerOnly: ev.importer_only }}
                lines={ev.observed_at ? [`Observed ${stamp(ev.observed_at)}`] : []} />
            </li>
          ))}
        </ul>
      )}

      <p className="pd-actions">
        <button type="button" className="btn btn-secondary" onClick={() => onLabel(detail.id)}>
          <Icon name="plus" size={16} />Submit a label reading
        </button>
      </p>
      <p className="pd-reviews">
        {detail.review_count} {detail.review_count === 1 ? 'review' : 'reviews'}
        {detail.avg_rating != null && <> · <Icon name="star" className="ico-inline" /><span className="sr-only">rated </span>{detail.avg_rating.toFixed(1)}</>}
      </p>
      <JsonView value={detail} label="raw get_product result" />
    </div>
  );
}

export default function CatalogView({ onLabel }: { onLabel: (productId: number) => void }) {
  const hub = useHubStatus();
  const hubOff = hub.state === 'refused' || hub.state === 'unreachable';
  const narrow = useMedia('(max-width: 900px)');
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [lookup, setLookup] = useState('');
  const [found, setFound] = useState<FindResult | null>(null);
  // the table's failure (the pantry API) and the lookup's or a product's (the hub), each shown
  // where it happened
  const [listError, setListError] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [detailError, setDetailError] = useState('');
  const offNote = useId();
  const gridHint = useId();

  useEffect(() => {
    getProducts().then(setProducts).catch((e: Error) => setListError(e.message)).finally(() => setLoaded(true));
  }, []);

  // A product's details; a quicker answer for a product picked since never lands on this one.
  useEffect(() => {
    if (selected == null || hubOff) return undefined;
    let alive = true;
    setDetail(null);
    setDetailError('');
    pantryTool<ProductDetail>('get_product', { product_id: selected })
      .then((d) => { if (alive) setDetail(d); })
      .catch((e: Error) => { if (alive) setDetailError(e.message); });
    return () => { alive = false; };
  }, [selected, hubOff]);

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return products.filter((p) => (!category || p.category === category)
      && (!q || `${p.name} ${p.brand ?? ''} ${p.subcategory ?? ''}`.toLowerCase().includes(q)));
  }, [products, filter, category]);
  // the catalog's own list names no store (it is priced per store only for a plan): the column is
  // drawn when there is something to put in it
  const withStores = useMemo(() => products.some((p) => p.store_name), [products]);
  const ids = useMemo(() => shown.map((p) => p.id), [shown]);
  const foundIds = useMemo(() => found?.items.map((it) => it.id) ?? [], [found]);
  const grid = useRowNav(ids, { onOpen: setSelected, chosen: selected });
  const foundGrid = useRowNav(foundIds, { onOpen: setSelected, chosen: selected });

  const runLookup = async () => {
    if (hubOff) return;
    setLookupError('');
    try {
      setFound(await pantryTool<FindResult>('find_product', { query: lookup, limit: 5 }));
    } catch (e) {
      setLookupError((e as Error).message);
    }
  };

  const pickedName = products.find((p) => p.id === selected)?.name
    ?? found?.items.find((it) => it.id === selected)?.name ?? 'Product';

  // What the panel beside the table (or the sheet) shows for the product picked, if any.
  const body = (inSheet: boolean) => {
    if (hubOff) {
      return <p className="card-sub">A product’s offers, origin and evidence come from MCP <code>get_product</code> through the demo hub, which is off here.</p>;
    }
    if (selected == null) {
      return <p className="card-sub">Pick a product to see every store’s offer, its origin and the evidence behind it (MCP <code>get_product</code>).</p>;
    }
    if (detailError) return <HubErrorBanner error={`This product could not be read: ${detailError}`} />;
    if (!detail) return <Skeleton kind="row" count={6} label="Loading the product" />;
    return <ProductDetailView detail={detail} onLabel={onLabel} inSheet={inSheet} />;
  };

  return (
    <div className="view split catalog">
      <div className="split-main">
        <section className="panel">
          <h2>The planner’s lookup</h2>
          <p className="card-sub">
            <code>find_product</code> is the same lookup the planner runs for each ingredient:
            a <em>direct</em> match has every word, a <em>generic</em> one falls back to the
            head noun, and <em>relaxed</em> means nothing matched well.
          </p>
          <form className="form-row" onSubmit={(e) => { e.preventDefault(); void runLookup(); }}>
            <input className="grow" value={lookup} onChange={(e) => setLookup(e.target.value)} aria-label="Look up a product"
                   placeholder="penne, dark soy sauce, pene…" />
            <button type="submit" className="btn btn-primary" disabled={!lookup.trim() || hubOff}
                    aria-describedby={hubOff ? offNote : undefined}>
              <Icon name="search" size={16} />Look up
            </button>
          </form>
          {hubOff && <p id={offNote} className="muted">The lookup runs through the demo hub, which is off here.</p>}
          <HubErrorBanner error={lookupError} />
          {found && (
            <div className="lookup">
              <p className="lookup-meta">
                <StateTag state={found.match === 'direct' ? { kind: 'done', word: 'Direct match' }
                  : { kind: 'attention', word: `${found.match[0]?.toUpperCase() ?? ''}${found.match.slice(1)} match` }} />
                <span className="muted">{found.total} {found.total === 1 ? 'hit' : 'hits'}{found.items.length < found.total && `, the first ${found.items.length} shown`}</span>
                {found.note && <span className="muted">{found.note}</span>}
              </p>
              {found.items.length > 0 && (
                <div className="table-wrap">
                  <table className="ws-grid" role="grid" aria-label={`Lookup results for ${found.query}`}
                         aria-describedby={gridHint}>
                    <thead>
                      <tr><th>Product</th><th>Store</th><th className="num">Price</th><th>Origin</th></tr>
                    </thead>
                    <tbody>
                      {found.items.map((it) => (
                        <tr key={it.id} {...foundGrid.rowProps(it.id)} aria-selected={selected === it.id}
                            className={selected === it.id ? 'row-active' : undefined}>
                          <td><div className="prod-name">{it.name}</div><div className="prod-desc">{it.brand}</div></td>
                          <td>{it.store}<span className="muted"> · {it.distance_km} km</span></td>
                          <td className="num">{money(it.price)}</td>
                          <td><StateTag state={originStatus(it.origin_status)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="plan-header">
            <h2>Catalog{loaded && !listError && <span className="count"> · {shown.length} of {products.length}</span>}</h2>
            <div className="form-row compact">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or brand"
                     aria-label="Filter the catalog" type="search" />
              <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {narrow && !hubOff && <p className="card-sub catalog-cue">Pick a product for its offers, origin and evidence.</p>}
          <p id={gridHint} className="sr-only">Up and Down move along the rows; Enter shows the product.</p>
          <ErrorBanner error={listError && `The catalog could not be loaded: ${listError}`}
                       hint="It comes from the pantry API: see Workshop › System." />
          {!loaded && <Skeleton kind="row" count={8} label="Loading the catalog" />}
          {loaded && !listError && shown.length === 0 && (
            <p className="pd-none">No product matches{filter.trim() && <> “{filter.trim()}”</>}{category && <> in {category}</>}.</p>
          )}
          {loaded && !listError && shown.length > 0 && (
            <div className="table-wrap tall">
              <table className="ws-grid" role="grid" aria-label="Catalog" aria-describedby={gridHint}>
                <thead>
                  <tr>
                    <th>Product</th><th className="col-cat">Category</th>{withStores && <th>Cheapest store</th>}
                    <th className="num">Price</th><th className="num">Unit price</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const price = p.store_price ?? p.price;
                    return (
                      <tr key={p.id} {...grid.rowProps(p.id)} aria-selected={selected === p.id}
                          className={selected === p.id ? 'row-active' : undefined}>
                        <td>
                          <div className="prod-name">{p.name}</div>
                          <div className="prod-desc">{p.brand}<span className="prod-cat"> · {p.category}</span></div>
                        </td>
                        <td className="col-cat">{p.category}{p.subcategory ? ` · ${p.subcategory}` : ''}</td>
                        {withStores && (
                          <td>{p.store_name || '–'}{p.distance_km != null && <span className="muted"> · {p.distance_km} km</span>}</td>
                        )}
                        <td className="num">{money(price)}</td>
                        <td className="num unit-price">{unitPriceText(unitPrice(price, p.unit_qty, p.unit_uom))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {!narrow && (
        <aside className="split-side">
          <section className="panel sticky" aria-label="Product details">
            {/* said once the product has arrived, since the keyboard stays on the table's row */}
            <p className="sr-only" role="status">{detail && selected === detail.id ? `Showing ${detail.name}.` : ''}</p>
            {body(false)}
          </section>
        </aside>
      )}
      <Sheet open={narrow && selected != null} onClose={() => setSelected(null)} title={pickedName}
             className="pd-sheet">
        {body(true)}
      </Sheet>
    </div>
  );
}
