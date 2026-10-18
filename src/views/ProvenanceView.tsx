import { useCallback, useEffect, useState } from 'react';
import { rankByOrigin } from '../api';
import { ErrorBanner, JsonView, parseList } from '../components/common';
import { getProducts, mcpRead, pantryTool, resetDemo } from '../hub';
import type { OriginRanking, Product, UnrankedProduct } from '../types';

const CLAIM_TYPES = ['product-of', 'grown-in', 'farmed-in', 'caught-in', 'harvested-in',
  'made-in', 'packaged-in', 'prepared-in'];

interface Coverage {
  products: number; by_status: Record<string, number>; evidence_rows: number;
  submissions: Record<string, number>; floor?: number; [key: string]: unknown;
}
interface Submission {
  id: number; product_id: number; product_name: string; status: string; claim_type: string;
  country: string; verbatim: string; confidence: string; importer_only: boolean; note: string;
  submitted_by: string; submitted_at: string; reviewed_by: string; review_note: string;
  evidence_id: number | null; duplicate: boolean;
}
interface Triage { product_id: number; product_name: string; reason: string; status: string }

const REASON_LABELS: Record<UnrankedProduct['reason'], string> = {
  no_evidence: 'No source published an origin',
  conflicting: 'Sources disagree — no winner picked',
  lookup_failed: 'Lookup failed (outage or rate limit) — not a finding',
  guess_only: 'Name-based guess only — not evidence',
};

function CoveragePanel({ coverage, onReset, resetting }: {
  coverage: Coverage | null; onReset: () => void; resetting: boolean;
}) {
  return (
    <section className="panel">
      <div className="plan-header">
        <h2>How much of the catalog's origin is known</h2>
        <button className="secondary" onClick={onReset} disabled={resetting}
                title="Reseed the database and reload the demo origin evidence">
          {resetting ? 'Resetting…' : 'Reset demo data'}
        </button>
      </div>
      <p className="card-sub">
        From the MCP resource <code>pantry://origins/coverage</code>. Only <em>resolved</em>
        products carry usable evidence; <em>conflicting</em> means sources disagree, and
        <em> unknown</em> is not evidence of anything.
      </p>
      {coverage && (
        <div className="stat-row">
          <div className="stat"><div className="stat-n">{coverage.products}</div><div className="stat-l">products</div></div>
          {Object.entries(coverage.by_status).map(([k, v]) => (
            <div key={k} className={`stat stat-${k}`}><div className="stat-n">{v}</div><div className="stat-l">{k}</div></div>
          ))}
          <div className="stat"><div className="stat-n">{coverage.evidence_rows}</div><div className="stat-l">evidence rows</div></div>
          {Object.entries(coverage.submissions ?? {}).map(([k, v]) => (
            <div key={k} className="stat"><div className="stat-n">{v}</div><div className="stat-l">{k} readings</div></div>
          ))}
        </div>
      )}
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
      <div className="origin-controls">
        <label>Prefer, in order<input value={preference} onChange={(e) => setPreference(e.target.value)} /></label>
        <label>Exclude<input value={exclude} onChange={(e) => setExclude(e.target.value)} /></label>
        <button onClick={() => void run()} disabled={busy}>{busy ? 'Ranking…' : 'Rank catalog'}</button>
      </div>
      <ErrorBanner error={error && `Ranking failed: ${error}`} />
      {result && (
        <>
          <div className="origin-counts">
            <span className="chip chip-ok">{result.counts.ranked ?? 0} ranked</span>
            <span className="chip pill-bad">{result.counts.excluded ?? 0} excluded</span>
            <span className="chip pill-warn">{result.counts.unranked ?? 0} unverified</span>
            <span className="chip chip-muted">{result.counts.total ?? 0} in catalog</span>
          </div>
          <p className="coverage-note">{result.coverage_note}</p>
          {result.ranked.length > 0 && (
            <table className="origin-table">
              <thead><tr><th>Product</th><th>Placement</th><th>On the label</th><th>Source</th></tr></thead>
              <tbody>
                {result.ranked.map((r) => (
                  <tr key={r.product_id}>
                    <td>{r.product_name}</td>
                    <td>{r.tier_label}{r.origin.claim_type && <span className="claim-chip">{r.origin.claim_type}</span>}</td>
                    <td className="verbatim">{r.origin.verbatim || '—'}</td>
                    <td className="muted">{r.origin.source} · {r.origin.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result.excluded.length > 0 && (
            <>
              <h3 className="origin-subhead">Excluded ({result.excluded.length})</h3>
              <ul className="origin-list">
                {result.excluded.map((e) => (
                  <li key={e.product_id}>
                    <strong>{e.product_name}</strong> — {e.excluded_country}, evidenced by <code>{e.matched_field}</code>
                    {e.verbatim && <div className="verbatim">“{e.verbatim}”</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 className="origin-subhead">
            Unverified ({result.unranked.length}){' '}
            <button className="linkish" onClick={() => setShowUnranked((v) => !v)}>{showUnranked ? 'hide' : 'show'}</button>
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

function SubmitPanel({ products, productId, setProductId, onSubmitted }: {
  products: Product[]; productId: number | ''; setProductId: (id: number | '') => void;
  onSubmitted: () => void;
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
    <section className="panel">
      <h2>Submit a label reading</h2>
      <p className="card-sub">
        The MCP write tool <code>submit_origin_evidence</code>: a reading of a package label,
        copied exactly. It only joins the review queue — nothing changes until a reviewer
        approves it. It needs the hub's bearer token; anonymously the tool refuses.
      </p>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label>product
          <select value={productId} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">choose…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.brand})</option>)}
          </select>
        </label>
        <label>claim
          <select value={claim} onChange={(e) => setClaim(e.target.value)}>
            {CLAIM_TYPES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>country<input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Italy" /></label>
        <label>confidence
          <select value={confidence} onChange={(e) => setConfidence(e.target.value)}>
            <option>high</option><option>medium</option><option>low</option>
          </select>
        </label>
        <label className="wide">exactly as printed<input value={verbatim} onChange={(e) => setVerbatim(e.target.value)} placeholder="Product of Italy" /></label>
        <label className="wide">note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></label>
        <label className="check"><input type="checkbox" checked={importerOnly} onChange={(e) => setImporterOnly(e.target.checked)} />
          only an importer's address (not an origin)</label>
        <button disabled={busy || !productId || !country.trim() || verbatim.trim().length < 3}>
          {busy ? 'Submitting…' : 'Submit for review'}
        </button>
      </form>
      <ErrorBanner error={error} />
      {result && (
        <div className="coverage coverage-ok">
          Submission #{result.id} for <strong>{result.product_name}</strong> is <strong>{result.status}</strong>
          {result.duplicate && ' (a duplicate of an existing reading)'} · submitted by {result.submitted_by}
        </div>
      )}
    </section>
  );
}

function QueuePanel({ refreshKey, onReviewed }: { refreshKey: number; onReviewed: () => void }) {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState<Submission[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState('');

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
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option>pending</option><option>approved</option><option>rejected</option>
          </select>
          <button className="secondary" onClick={() => void load()}>Refresh</button>
        </div>
      </div>
      <p className="card-sub">
        <code>list_origin_submissions</code> and <code>review_origin_submission</code>. Approving
        copies the reading into the evidence table as <em>agent-label</em>, and the product's
        origin and the ranking change; rejecting needs a reason.
      </p>
      <ErrorBanner error={error} />
      {items.length === 0 && <p className="muted">No {status} readings.</p>}
      {items.map((s) => (
        <div key={s.id} className="queue-item">
          <div>
            <strong>#{s.id} {s.product_name}</strong> <span className="claim-chip">{s.claim_type}</span> {s.country}
            {s.importer_only && <span className="chip chip-warn">importer only</span>}
            <div className="verbatim">“{s.verbatim}”</div>
            <div className="muted">{s.confidence} · by {s.submitted_by || '—'} · {s.submitted_at.slice(0, 19)}
              {s.reviewed_by && ` · reviewed by ${s.reviewed_by}${s.review_note ? `: ${s.review_note}` : ''}`}</div>
          </div>
          {s.status === 'pending' && (
            <div className="queue-actions">
              <input placeholder="review note (needed to reject)" value={notes[s.id] ?? ''}
                     onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })} />
              <button onClick={() => void review(s.id, 'approve')}>Approve</button>
              <button className="danger" disabled={(notes[s.id] ?? '').trim().length < 3}
                      onClick={() => void review(s.id, 'reject')}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export default function ProvenanceView({ initialProduct }: { initialProduct: number | null }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [triage, setTriage] = useState<Triage[]>([]);
  const [productId, setProductId] = useState<number | ''>(initialProduct ?? '');
  const [refreshKey, setRefreshKey] = useState(0);
  const [resetting, setResetting] = useState(false);
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
    getProducts().then(setProducts).catch((e: Error) => setError(e.message));
    void refresh();
  }, [refresh]);

  useEffect(() => { if (initialProduct) setProductId(initialProduct); }, [initialProduct]);

  const changed = () => { setRefreshKey((k) => k + 1); void refresh(); };

  const reset = async () => {
    setResetting(true);
    setError('');
    try {
      await resetDemo();
      changed();
    } catch (e) {
      setError(`Reset failed: ${(e as Error).message}`);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="view">
      <ErrorBanner error={error} />
      <CoveragePanel coverage={coverage} onReset={() => void reset()} resetting={resetting} />
      <div className="two-col">
        <SubmitPanel products={products} productId={productId} setProductId={setProductId} onSubmitted={changed} />
        <section className="panel">
          <h2>Worth photographing</h2>
          <p className="card-sub"><code>origin_triage</code>: products whose origin is unresolved
            and which matter most to a basket — hints, never evidence.</p>
          <ul className="origin-list scroll">
            {triage.slice(0, 25).map((t) => (
              <li key={t.product_id}>
                <button className="linkish" onClick={() => setProductId(t.product_id)}>{t.product_name}</button>
                <span className="muted"> · {t.status} · {t.reason}</span>
              </li>
            ))}
          </ul>
          {triage.length > 0 && <JsonView value={triage} label="raw origin_triage result" />}
        </section>
      </div>
      <QueuePanel refreshKey={refreshKey} onReviewed={changed} />
      <RankPanel refreshKey={refreshKey} />
    </div>
  );
}
