import { useCallback, useEffect, useState } from 'react';
import { ErrorBanner, JsonView, StatusDot } from '../components/common';
import { getRuntime, getStatus, setRuntime } from '../hub';
import type { HubStatus, RuntimeSettings } from '../types';

const MODEL_ROLES: [string, string][] = [
  ['nl2sql', 'recipe parser'],
  ['selector_default', 'product selector'],
  ['selector_escalation', 'selector escalation'],
  ['classifier', 'classifier (three-phase routing)'],
];

function LlmPanel({ onChanged }: { onChanged: () => void }) {
  const [runtime, setRt] = useState<RuntimeSettings | null>(null);
  const [models, setModels] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getRuntime().then((r) => { setRt(r); setModels(r.models); })
      .catch((e: Error) => setError(`Runtime settings unavailable: ${e.message}`));
  }, []);
  useEffect(load, [load]);

  const apply = async (patch: Partial<Pick<RuntimeSettings, 'demo_mode' | 'models'>>) => {
    setBusy(true);
    setError('');
    try {
      const r = await setRuntime(patch);
      setRt(r);
      setModels(r.models);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>The planner's LLM</h2>
      <p className="card-sub">
        pantry-api calls an LLM to parse a pasted recipe and to choose a product for each
        ingredient. In <strong>demo mode</strong> deterministic stand-ins replace both calls: free,
        instant and repeatable, but cruder matches. The SQL query plan, gates and trip optimizer
        run for real either way. Model specs are <code>gemini:&lt;model&gt;</code> or an Anthropic model.
      </p>
      <ErrorBanner error={error} />
      {runtime && (
        <>
          <div className="mode-toggle">
            <button className={!runtime.demo_mode ? 'mode-on' : 'secondary'} disabled={busy || runtime.editable === false}
                    onClick={() => void apply({ demo_mode: false })}>LLM planning</button>
            <button className={runtime.demo_mode ? 'mode-on' : 'secondary'} disabled={busy || runtime.editable === false}
                    onClick={() => void apply({ demo_mode: true })}>Demo mode (no LLM)</button>
            <span className="chip chip-muted">Gemini key {runtime.gemini_key_configured ? 'configured' : 'missing'}</span>
            <span className="chip chip-muted">Anthropic key {runtime.anthropic_key_configured ? 'configured' : 'missing'}</span>
          </div>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void apply({ models }); }}>
            {MODEL_ROLES.map(([key, label]) => (
              <label key={key}>{label}
                <input value={models[key] ?? ''} onChange={(e) => setModels({ ...models, [key]: e.target.value })} />
              </label>
            ))}
            <button disabled={busy || runtime.editable === false}>Apply models</button>
          </form>
          {runtime.editable === false && <p className="muted">Read-only: start pantry-api with RUNTIME_SETTINGS_ENABLED=1 to change these here.</p>}
        </>
      )}
    </section>
  );
}

export default function SystemView() {
  const [status, setStatus] = useState<HubStatus | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    getStatus().then(setStatus).catch((e: Error) => setError(`The demo hub is not reachable: ${e.message}`));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="view">
      <ErrorBanner error={error} />
      <section className="panel">
        <div className="plan-header">
          <h2>Services</h2>
          <button className="secondary" onClick={load}>Refresh</button>
        </div>
        <div className="service-grid">
          {status?.services.map((s) => (
            <div key={s.id} className={`service ${s.ok ? '' : 'service-down'}`}>
              <div className="service-head"><StatusDot ok={s.ok} /> <strong>{s.label}</strong></div>
              <div className="muted"><code>{s.url}</code> · {s.ok ? `HTTP ${s.status}` : 'not reachable'}</div>
              {s.servers && s.servers.length > 0 && (
                <div className="muted">virtual servers: {s.servers.map((v) => `${v.name} (${v.tools} tools)`).join(', ')}</div>
              )}
              {s.models && s.models.length > 0 && <div className="muted">models: {s.models.join(', ')}</div>}
              {s.skill && <div className="muted">skill: <code>{s.skill}</code></div>}
              {s.runtime && <div className="muted">planner LLM: {s.runtime.demo_mode ? 'demo mode' : s.runtime.models.selector_default}</div>}
              <div className="service-links">
                {Object.entries(s.links ?? {}).map(([label, href]) => (
                  <a key={label} href={href} target="_blank" rel="noreferrer">{label} ↗</a>
                ))}
              </div>
            </div>
          ))}
        </div>
        {status && (
          <div className="plan-meta">
            {Object.entries(status.keys).map(([k, v]) => (
              <span key={k} className={`chip ${v ? 'chip-ok' : 'chip-warn'}`}>{k.replace('_', ' ')}: {v ? 'held by the hub' : 'missing'}</span>
            ))}
            <span className="chip chip-muted">Assistant default: {status.agent.default_model}</span>
          </div>
        )}
      </section>
      <LlmPanel onChanged={load} />
      {status && <JsonView value={status} label="raw /hub/status" />}
    </div>
  );
}
