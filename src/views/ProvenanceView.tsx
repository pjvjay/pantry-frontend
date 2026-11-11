// Workshop › Provenance: how much of the catalog's origin is known, label readings submitted and
// reviewed, the products worth photographing, and the catalog ranked by where things come from.
//
// A product sent here (the Catalog's "Submit a label reading", or a pick in "Worth photographing")
// lands in the Submit panel: the panel scrolls into view, its product field takes focus with the
// product chosen, and the panel glows for a moment, so the jump is seen and the keyboard is where
// the reading is typed. Readings in the review queue are cards (components/evidence.tsx), each with
// its state as a tag. Resetting the demo data reseeds the whole database, so it lives in Workshop ›
// System, behind a question; this page points there.
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { rankByOrigin } from '../api';
import { ErrorBanner, JsonView, parseList } from '../components/common';
import { EvidenceCard, StateTag } from '../components/evidence';
import { Icon } from '../components/icons';
import { HubErrorBanner, Skeleton } from '../components/ui';
import { getProducts, mcpRead, pantryTool } from '../hub';
import { hrefFor } from '../routes';
import type { OriginRanking, Product, UnrankedProduct } from '../types';
import { originStatus, queueStatus, sourceLabel, stamp } from '../workshop';

const CLAIM_TYPES = ['product-of', 'grown-in', 'farmed-in', 'caught-in', 'harvested-in',
  'made-in', 'packaged-in', 'prepared-in'];

interface Coverage {
  products: number; by_status: Record<string, number>; evidence_rows: number;
  submissions: Record<string, number>; floor?: number; [key: string]: unknown;
}
interface Submission {
  id: number; product_id: number; product_name: string; status: string; claim_type: string;
  country: string; verbatim: string; confidence: string; importer_only: boolean; note: string;
  source_ref?: string; submitted_by: string; submitted_at: string; reviewed_by: string;
  reviewed_at?: string; review_note: string; evidence_id: number | null; duplicate: boolean;
}
interface Triage { product_id: number; product_name: string; reason: string; status: string }

const REASON_LABELS: Record<UnrankedProduct['reason'], string> = {
  no_evidence: 'No source published an origin',
  conflicting: 'Sources disagree — no winner picked',
  lookup_failed: 'Lookup failed (outage or rate limit) — not a finding',
  guess_only: 'Name-based guess only — not evidence',
};

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function CoveragePanel({ coverage }: { coverage: Coverage | null }) {
  return (
    <section className="panel">
      <h2>How much of the catalog’s origin is known</h2>
      <p className="card-sub">
        From the MCP resource <code>pantry://origins/coverage</code>. Only <em>resolved</em> products
        carry usable evidence; <em>conflicting</em> means sources disagree, and <em>unknown</em> is
        not evidence of anything.
      </p>
      {!coverage && <Skeleton kind="row" count={2} label="Loading the coverage" />}
      {coverage && (
        <div className="stat-row">
          <div className="stat"><div className="stat-n">{coverage.products}</div><div className="stat-l">products</div></div>
          {Object.entries(coverage.by_status).map(([k, v]) => (
            <div key={k} className={`stat stat-${k}`}>
              <div className="stat-n">{v}</div>
              <div className="stat-l"><StateTag state={originStatus(k)} /></div>
            </div>
          ))}
          <div className="stat"><div className="stat-n">{coverage.evidence_rows}</div><div className="stat-l">evidence rows</div></div>
          {Object.entries(coverage.submissions ?? {}).map(([k, v]) => (
            <div key={k} className="stat"><div className="stat-n">{v}</div><div className="stat-l">{k} readings</div></div>
          ))}
        </div>
      )}
      <p className="muted prov-reset">
        To start again from the demo’s own readings, <a href={hrefFor({ name: 'workshop', tab: 'system' })}>reset
        the demo data in System</a>.
      </p>
    </section>
  );
}

function RankPanel({ refreshKey }: { refreshKey: number }) {
  const [preference, setPreference] = useState('Canada');
  const [exclude, setExclude] = useState('United States');
  const [result, setResult] = useState<OriginRanking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showUnranked, setShowUnranked] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await rankByOrigin(parseList(preference), parseList(exclude)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [preference, exclude]);

  useEffect(() => { if (result) void run(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="panel origin-panel">
      <h2>Rank the catalog by where things come from</h2>
      <p className="card-sub">
        Nothing is inferred: products are placed only on label and database evidence. Try an
        unknown spelling like “Amerca” to see the server reject it with suggestions.
      </p>
      <form className="origin-controls" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <label>Prefer, in order<input value={preference} onChange={(e) => setPreference(e.target.value)} /></label>
        <label>Leave out<input value={exclude} onChange={(e) => setExclude(e.target.value)} /></label>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Ranking…' : 'Rank the catalog'}</button>
      </form>
      <ErrorBanner error={error && `Ranking failed: ${error}`} />
      {result && (
        <>
          <p className="origin-counts">
            <StateTag state={{ kind: 'done', word: 'Ranked' }}>{result.counts.ranked ?? 0} ranked</StateTag>
            <StateTag state={{ kind: 'blocked', word: 'Left out' }}>{result.counts.excluded ?? 0} left out</StateTag>
            <StateTag state={{ kind: 'attention', word: 'Unverified' }}>{result.counts.unranked ?? 0} unverified</StateTag>
            <span className="muted">of {result.counts.total ?? 0} in the catalog</span>
          </p>
          <p className="coverage-note">{result.coverage_note}</p>
          {result.ranked.length > 0 && (
            <div className="table-wrap">
              <table className="origin-table">
                <thead><tr><th>Product</th><th>Placement</th><th>On the label</th><th>Source</th></tr></thead>
                <tbody>
                  {result.ranked.map((r) => (
                    <tr key={r.product_id}>
                      <td>{r.product_name}</td>
                      <td>{r.tier_label}{r.origin.claim_type && <span className="claim-chip">{r.origin.claim_type}</span>}</td>
                      <td className="verbatim">{r.origin.verbatim ? `“${r.origin.verbatim}”` : '—'}</td>
                      <td className="muted">{sourceLabel(r.origin.source)} · {r.origin.confidence} confidence</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.excluded.length > 0 && (
            <>
              <h3 className="origin-subhead">Left out ({result.excluded.length})</h3>
              <ul className="ev-list ev-grid">
                {result.excluded.map((e) => (
                  <li key={e.product_id}>
                    <EvidenceCard heading={e.product_name} tag={<StateTag state={{ kind: 'blocked', word: 'Left out' }} />}
                                  evidence={{ claim: 'product-of', origin: e.excluded_country, verbatim: e.verbatim }}
                                  lines={[<>Evidenced by <code>{e.matched_field}</code></>]} />
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 className="origin-subhead">
            Unverified ({result.unranked.length}){' '}
            <button type="button" className="linkish" aria-expanded={showUnranked}
                    onClick={() => setShowUnranked((v) => !v)}>{showUnranked ? 'Hide' : 'Show'}</button>
          </h3>
          {showUnranked && (
            <ul className="origin-list">
              {result.unranked.map((u) => (
                <li key={u.product_id}><strong>{u.product_name}</strong> — {REASON_LABELS[u.reason]}
                  {u.detail && <span className="muted"> ({u.detail})</span>}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function SubmitPanel({ products, productId, setProductId, onSubmitted, arrival, settled }: {
  products: Product[]; productId: number | ''; setProductId: (id: number | '') => void;
  onSubmitted: () => void;
  // changes each time a product is sent here: the panel comes into view with its field focused
  arrival: number;
  // what sits above the panel has its final size (the coverage arrived, or failed)
  settled: boolean;
}) {
  const [claim, setClaim] = useState('product-of');
  const [country, setCountry] = useState('');
  const [verbatim, setVerbatim] = useState('');
  const [confidence, setConfidence] = useState('high');
  const [importerOnly, setImporterOnly] = useState(false);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<Submission | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [glow, setGlow] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const field = useRef<HTMLSelectElement>(null);
  const ready = products.length > 0 && settled;

  // Once the products are listed (so the one sent is in the field) and the coverage above has
  // arrived (so nothing above the panel grows after the scroll and pushes it down again), bring
  // the panel into view and give the field focus. After the shell's own move to the top of a new
  // page, which runs first.
  useEffect(() => {
    if (!arrival || !ready) return undefined;
    const frame = requestAnimationFrame(() => {
      field.current?.focus({ preventScroll: true });
      panel.current?.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
      setGlow(true);
    });
    const done = window.setTimeout(() => setGlow(false), 2400);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(done); };
  }, [arrival, ready]);

  const submit = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await pantryTool<Submission>('submit_origin_evidence', {
        product_id: productId, claim_type: claim, country, verbatim, confidence,
        importer_only: importerOnly, note,
      });
      setResult(r);
      onSubmitted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section ref={panel} className={`panel prov-submit${glow ? ' prov-arrived' : ''}`}>
      <h2>Submit a label reading</h2>
      <p className="card-sub">
        The MCP write tool <code>submit_origin_evidence</code>: a reading of a package label,
        copied exactly. It only joins the review queue — nothing changes until a reviewer
        approves it. It needs the hub’s bearer token; anonymously the tool refuses.
      </p>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label>Product
          <select ref={field} value={productId} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Choose…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.brand})</option>)}
          </select>
        </label>
        <label>Claim
          <select value={claim} onChange={(e) => setClaim(e.target.value)}>
            {CLAIM_TYPES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Country<input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Italy" /></label>
        <label>Confidence
          <select value={confidence} onChange={(e) => setConfidence(e.target.value)}>
            <option>high</option><option>medium</option><option>low</option>
          </select>
        </label>
        <label className="wide">Exactly as printed<input value={verbatim} onChange={(e) => setVerbatim(e.target.value)} placeholder="Product of Italy" /></label>
        <label className="wide">Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></label>
        <label className="check"><input type="checkbox" checked={importerOnly} onChange={(e) => setImporterOnly(e.target.checked)} />
          Only an importer’s address (not an origin)</label>
        <button type="submit" className="btn btn-primary" disabled={busy || !productId || !country.trim() || verbatim.trim().length < 3}>
          {busy ? 'Submitting…' : 'Submit for review'}
        </button>
      </form>
      <HubErrorBanner error={error} />
      {result && (
        <div className="coverage coverage-ok" role="status">
          Reading #{result.id} for <strong>{result.product_name}</strong> is {queueStatus(result.status).word.toLowerCase()}
          {result.duplicate && ' (the same reading was already there)'} · submitted by {result.submitted_by}
        </div>
      )}
    </section>
  );
}

function QueuePanel({ refreshKey, onReviewed }: { refreshKey: number; onReviewed: () => void }) {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState<Submission[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const noteHint = useId();

  const load = useCallback(async () => {
    try {
      const page = await pantryTool<{ items: Submission[] }>('list_origin_submissions', { status, limit: 50 });
      setItems(page.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const review = async (id: number, decision: 'approve' | 'reject') => {
    setError('');
    try {
      await pantryTool('review_origin_submission', { submission_id: id, decision, note: notes[id] ?? '' });
      onReviewed();
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="panel">
      <div className="plan-header">
        <h2>Review queue</h2>
        <div className="form-row compact">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show readings that are">
            <option value="pending">Pending review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            <Icon name="refresh" size={16} />Refresh
          </button>
        </div>
      </div>
      <p className="card-sub">
        <code>list_origin_submissions</code> and <code>review_origin_submission</code>. Approving
        copies the reading into the evidence table as an <em>approved reading</em>, and the product’s
        origin and the ranking change; rejecting needs a reason.
      </p>
      <HubErrorBanner error={error} />
      {items === null && !error && <Skeleton kind="row" count={3} label="Loading the review queue" />}
      {items?.length === 0 && <p className="pd-none">No readings are {queueStatus(status).word.toLowerCase()}.</p>}
      {items && items.length > 0 && (
        <ul className="ev-list ev-grid">
          {items.map((s) => {
            const lines = [<>Submitted by {s.submitted_by || 'someone unnamed'}, {stamp(s.submitted_at)}</>];
            if (s.reviewed_by) {
              lines.push(<>Reviewed by {s.reviewed_by}{s.reviewed_at ? `, ${stamp(s.reviewed_at)}` : ''}{s.review_note && <>: “{s.review_note}”</>}</>);
            }
            return (
              <li key={s.id}>
                <EvidenceCard
                  heading={<>{s.product_name} <span className="muted">#{s.id}</span></>}
                  tag={<StateTag state={queueStatus(s.status)} />}
                  evidence={{ claim: s.claim_type, origin: s.country, verbatim: s.verbatim,
                    source: s.status === 'approved' ? 'agent-label' : 'submission',
                    sourceRef: s.source_ref, confidence: s.confidence, importerOnly: s.importer_only, note: s.note }}
                  lines={lines}>
                  {s.status === 'pending' && (
                    <div className="queue-actions">
                      <label className="queue-note">
                        <span className="sr-only">Reviewer’s note for reading {s.id}</span>
                        <input placeholder="Reviewer’s note (needed to reject)" value={notes[s.id] ?? ''}
                               aria-describedby={noteHint}
                               onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })} />
                      </label>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => void review(s.id, 'approve')}>Approve</button>
                      <button type="button" className="btn btn-danger btn-sm" disabled={(notes[s.id] ?? '').trim().length < 3}
                              onClick={() => void review(s.id, 'reject')}>Reject</button>
                    </div>
                  )}
                </EvidenceCard>
              </li>
            );
          })}
        </ul>
      )}
      <p id={noteHint} className="sr-only">A reading is rejected with a reason of at least three letters.</p>
    </section>
  );
}

// The products list comes from the pantry API; coverage, triage, readings and the queue go through
// the demo hub. Each kind of failure is shown on its own, so one never hides the other, and the
// hub's only while the hub answers (the Workshop's panel says when it does not).
export default function ProvenanceView({ initialProduct }: { initialProduct: number | null }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [triage, setTriage] = useState<Triage[]>([]);
  const [productId, setProductId] = useState<number | ''>(initialProduct ?? '');
  const [arrival, setArrival] = useState(initialProduct ? 1 : 0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [productsError, setProductsError] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await mcpRead('pantry', 'pantry://origins/coverage');
      setCoverage(JSON.parse(res.contents[0]?.text ?? '{}') as Coverage);
      const t = await pantryTool<{ result: Triage[] } | Triage[]>('origin_triage');
      setTriage(Array.isArray(t) ? t : t.result);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    getProducts().then(setProducts).catch((e: Error) => setProductsError(`The products could not be loaded: ${e.message}`));
    void refresh();
  }, [refresh]);

  // a product sent from the Catalog while this page is open
  const firstProduct = useRef(initialProduct);
  useEffect(() => {
    if (!initialProduct || initialProduct === firstProduct.current) return;
    firstProduct.current = initialProduct;
    setProductId(initialProduct);
    setArrival((n) => n + 1);
  }, [initialProduct]);

  const pick = (id: number) => {
    setProductId(id);
    setArrival((n) => n + 1);
  };

  const changed = () => { setRefreshKey((k) => k + 1); void refresh(); };

  return (
    <div className="view">
      <ErrorBanner error={productsError} />
      <HubErrorBanner error={error} />
      <CoveragePanel coverage={coverage} />
      <div className="two-col">
        <SubmitPanel products={products} productId={productId} setProductId={setProductId}
                     onSubmitted={changed} arrival={arrival} settled={coverage !== null || Boolean(error)} />
        <section className="panel">
          <h2>Worth photographing</h2>
          <p className="card-sub"><code>origin_triage</code>: products whose origin is unresolved
            and which matter most to a basket — hints, never evidence. Pick one to read its label.</p>
          {triage.length > 0 && (
            <ul className="triage-list">
              {triage.slice(0, 25).map((t) => (
                <li key={t.product_id} className="triage-item">
                  <button type="button" className="linkish triage-pick" onClick={() => pick(t.product_id)}
                          aria-current={productId === t.product_id || undefined}>
                    {t.product_name}
                  </button>
                  <StateTag state={originStatus(t.status)} />
                  <span className="triage-why">{t.reason}</span>
                </li>
              ))}
            </ul>
          )}
          {triage.length > 0 && <JsonView value={triage} label="raw origin_triage result" />}
        </section>
      </div>
      <QueuePanel refreshKey={refreshKey} onReviewed={changed} />
      <RankPanel refreshKey={refreshKey} />
    </div>
  );
}
