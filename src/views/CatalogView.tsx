// Workshop › Catalog: the planner's own lookup (find_product), the whole catalog as a table, and a
// product's offers, origin and evidence (get_product). The table comes from the pantry API and
// works without the demo hub; the lookup and the details are MCP calls through the hub, so while
// the hub is off they say so quietly here and the Workshop's one panel says why.
import { useEffect, useId, useMemo, useState } from 'react';
import { ErrorBanner, JsonView } from '../components/common';
import { HubErrorBanner, Skeleton } from '../components/ui';
import { getProducts, pantryTool } from '../hub';
import { useHubStatus } from '../hubStatus';
import type { Product } from '../types';
import { Icon } from '../components/icons';

interface Offer { store: string; price: number; distance_km: number }
interface Evidence {
  source: string; claim_type: string; verbatim: string; ingredient_origin: string;
  manufactured_in: string; confidence: string; importer_only?: boolean; observed_at?: string;
}
interface ProductDetail {
  id: number; name: string; brand: string; description: string; category: string;
  subcategory: string; dietary_tags: string; unit_size: string; list_price: number;
  offers: Offer[];
  origin: { status: string; country: string; claim_type: string; verbatim: string;
            confidence: string; source: string; evidence_count: number; seen_countries: string[] };
  evidence: Evidence[];
  pending_submissions: number;
  review_count: number;
  avg_rating: number | null;
}
interface FindResult {
  query: string; match: string; total: number; note?: string;
  items: { id: number; name: string; brand: string; price: number; store: string;
           distance_km: number; origin_status: string }[];
}

export default function CatalogView({ onLabel }: { onLabel: (productId: number) => void }) {
  const hub = useHubStatus();
  const hubOff = hub.state === 'refused' || hub.state === 'unreachable';
  const [products, setProducts] = useState<Product[]>([]);
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

  useEffect(() => {
    getProducts().then(setProducts).catch((e: Error) => setListError(e.message)).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (selected == null || hubOff) return;
    setDetail(null);
    setDetailError('');
    pantryTool<ProductDetail>('get_product', { product_id: selected })
      .then(setDetail).catch((e: Error) => setDetailError(e.message));
  }, [selected, hubOff]);

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort(), [products]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return products.filter((p) => (!category || p.category === category)
      && (!q || `${p.name} ${p.brand ?? ''} ${p.subcategory ?? ''}`.toLowerCase().includes(q)));
  }, [products, filter, category]);

  const runLookup = async () => {
    if (hubOff) return;
    setLookupError('');
    try {
      setFound(await pantryTool<FindResult>('find_product', { query: lookup, limit: 5 }));
    } catch (e) {
      setLookupError((e as Error).message);
    }
  };

  return (
    <div className="view split">
      <div className="split-main">
        <section className="panel">
          <h2>The planner's lookup</h2>
          <p className="card-sub">
            <code>find_product</code> is the same lookup the planner runs for each ingredient:
            a <em>direct</em> match has every word, a <em>generic</em> one falls back to the
            head noun, and <em>relaxed</em> means nothing matched well.
          </p>
          <form className="form-row" onSubmit={(e) => { e.preventDefault(); void runLookup(); }}>
            <input value={lookup} onChange={(e) => setLookup(e.target.value)} aria-label="Look up a product"
                   placeholder="penne, dark soy sauce, pene…" />
            <button disabled={!lookup.trim() || hubOff} aria-describedby={hubOff ? offNote : undefined}>Look up</button>
          </form>
          {hubOff && <p id={offNote} className="muted">The lookup runs through the demo hub, which is off here.</p>}
          <HubErrorBanner error={lookupError} />
          {found && (
            <div className="lookup">
              <div className="plan-meta">
                <span className={`chip ${found.match === 'direct' ? 'chip-ok' : 'chip-warn'}`}>
                  match: {found.match}
                </span>
                <span className="chip chip-muted">{found.total} hit(s)</span>
                {found.note && <span className="muted">{found.note}</span>}
              </div>
              <table>
                <tbody>
                  {found.items.map((it) => (
                    <tr key={it.id} className="clickable" onClick={() => setSelected(it.id)}>
                      <td className="prod-name">{it.name}</td>
                      <td>{it.brand}</td>
                      <td>{it.store} · {it.distance_km} km</td>
                      <td className="num">${it.price.toFixed(2)}</td>
                      <td><span className="chip chip-muted">{it.origin_status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="plan-header">
            <h2>Catalog{loaded && !listError && <> · {shown.length} of {products.length}</>}</h2>
            <div className="form-row compact">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter" />
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">all categories</option>
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <ErrorBanner error={listError && `The catalog could not be loaded: ${listError}`}
                       hint="It comes from the pantry API: see Workshop › System." />
          {!loaded && <Skeleton kind="row" count={8} label="Loading the catalog" />}
          {loaded && !listError && <div className="table-wrap tall">
            <table>
              <thead>
                <tr><th>Product</th><th>Category</th><th>Cheapest store</th><th className="num">Price</th></tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className={`clickable ${selected === p.id ? 'row-active' : ''}`}
                      onClick={() => setSelected(p.id)}>
                    <td><div className="prod-name">{p.name}</div><div className="prod-desc">{p.brand}</div></td>
                    <td>{p.category}{p.subcategory ? ` · ${p.subcategory}` : ''}</td>
                    <td>{p.store_name ?? '—'}{p.distance_km != null && <span className="muted"> · {p.distance_km} km</span>}</td>
                    <td className="num">${(p.store_price ?? p.price).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </section>
      </div>

      <aside className="split-side">
        <section className="panel sticky">
          {hubOff ? (
            <p className="card-sub">A product's offers, origin and evidence come from MCP <code>get_product</code> through the demo hub, which is off here.</p>
          ) : !selected && <p className="card-sub">Pick a product to see every store's offer, its origin and the evidence behind it (MCP <code>get_product</code>).</p>}
          {!hubOff && selected && !detail && !detailError && <p className="card-sub">Loading…</p>}
          <HubErrorBanner error={detailError} />
          {!hubOff && detail && (
            <>
              <h2>{detail.name}</h2>
              <p className="card-sub">{detail.brand} · {detail.unit_size} · {detail.category}/{detail.subcategory}
                {detail.dietary_tags && ` · contains ${detail.dietary_tags}`}</p>
              <p>{detail.description}</p>
              <h3 className="origin-subhead">Store offers</h3>
              <table>
                <tbody>
                  {detail.offers.map((o) => (
                    <tr key={o.store}><td>{o.store}</td><td className="muted">{o.distance_km} km</td>
                      <td className="num">${o.price.toFixed(2)}</td></tr>
                  ))}
                </tbody>
              </table>
              <h3 className="origin-subhead">Origin</h3>
              <div className="plan-meta">
                <span className={`chip ${detail.origin.status === 'resolved' ? 'chip-ok' : detail.origin.status === 'conflicting' ? 'pill-bad' : 'pill-warn'}`}>
                  {detail.origin.status}
                </span>
                {detail.origin.country && <span className="chip">{detail.origin.country}</span>}
                {detail.origin.claim_type && detail.origin.claim_type !== 'unknown' && (
                  <span className="claim-chip">{detail.origin.claim_type}</span>)}
                <span className="chip chip-muted">{detail.origin.evidence_count} evidence row(s)</span>
                {detail.pending_submissions > 0 && (
                  <span className="chip chip-warn">{detail.pending_submissions} pending reading(s)</span>)}
              </div>
              {detail.origin.verbatim && <p className="verbatim">“{detail.origin.verbatim}”</p>}
              {detail.evidence.length > 0 && (
                <ul className="origin-list">
                  {detail.evidence.map((ev, i) => (
                    <li key={i}>
                      <strong>{ev.claim_type}</strong> {ev.ingredient_origin || ev.manufactured_in}
                      <span className="muted"> · {ev.source} · {ev.confidence}{ev.importer_only ? ' · importer only' : ''}</span>
                      {ev.verbatim && <div className="verbatim">“{ev.verbatim}”</div>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted">
                {detail.review_count} reviews
                {detail.avg_rating != null && <> · <Icon name="star" className="ico-inline" /><span className="sr-only">rated </span>{detail.avg_rating.toFixed(1)}</>}
              </p>
              <button onClick={() => onLabel(detail.id)}>Submit a label reading…</button>
              <JsonView value={detail} label="raw get_product result" />
            </>
          )}
        </section>
      </aside>
    </div>
  );
}
