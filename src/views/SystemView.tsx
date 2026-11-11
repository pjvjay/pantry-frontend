// Workshop › System: every service the demo hub can see (from /hub/status, the console's one
// shared status: hubStatus.tsx), the keys it holds, the planner's LLM switch (pantry API's
// /settings/runtime, which works without the hub), and the demo data's reset. With the hub off, the
// Workshop's panel above says so, and the switch still works.
//
// Resetting the demo data reseeds pantry's whole database, so it asks first, in place
// (InlineConfirm), and says afterwards what happened. Whether each service answers, and whether
// each key is there, is a Tag: a glyph and words, never a coloured dot alone.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ErrorBanner, JsonView } from '../components/common';
import { InlineConfirm } from '../components/InlineConfirm';
import { Notice } from '../components/ui';
import { getRuntime, resetDemo, setRuntime } from '../hub';
import { useHubStatus } from '../hubStatus';
import type { RuntimeSettings } from '../types';
import { humanize, keyStatus, serviceStatus } from '../workshop';
import { StateTag } from '../components/evidence';
import { Icon } from '../components/icons';

// The keys the hub holds, by their own names; any other key by its name in words.
const KEY_NAMES: Record<string, string> = {
  gemini: 'Gemini key', pantry_token: 'pantry token', contextforge_jwt: 'ContextForge JWT', youtube: 'YouTube key',
  google_calendar_client: 'Google Calendar client', google_calendar_connected: 'Google Calendar account',
};

const MODEL_ROLES: [string, string][] = [
  ['nl2sql', 'Recipe parser'],
  ['selector_default', 'Product selector'],
  ['selector_escalation', 'Selector escalation'],
  ['classifier', 'Classifier (three-phase routing)'],
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
    <section className="card">
      <h2 className="card-title">The planner’s LLM</h2>
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
            {/* the mode in use is pressed, said to a screen reader too (aria-pressed), not by its fill alone */}
            <button type="button" className={`btn btn-sm ${!runtime.demo_mode ? 'btn-primary' : 'btn-secondary'}`}
                    aria-pressed={!runtime.demo_mode} disabled={busy || runtime.editable === false}
                    onClick={() => void apply({ demo_mode: false })}>LLM planning</button>
            <button type="button" className={`btn btn-sm ${runtime.demo_mode ? 'btn-primary' : 'btn-secondary'}`}
                    aria-pressed={runtime.demo_mode} disabled={busy || runtime.editable === false}
                    onClick={() => void apply({ demo_mode: true })}>Demo mode (no LLM)</button>
            <StateTag state={keyStatus('Gemini key', Boolean(runtime.gemini_key_configured), 'pantry-api')} />
            <StateTag state={keyStatus('Anthropic key', Boolean(runtime.anthropic_key_configured), 'pantry-api')} />
          </div>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void apply({ models }); }}>
            {MODEL_ROLES.map(([key, label]) => (
              <label key={key}>{label}
                <input value={models[key] ?? ''} onChange={(e) => setModels({ ...models, [key]: e.target.value })} />
              </label>
            ))}
            <button type="submit" className="btn btn-primary" disabled={busy || runtime.editable === false}>Apply models</button>
          </form>
          {runtime.editable === false && <p className="muted">Read-only: start pantry-api with RUNTIME_SETTINGS_ENABLED=1 to change these here.</p>}
        </>
      )}
    </section>
  );
}

// The demo's own data back as it ships: the catalog, the recipes and the origin evidence, with an
// empty review queue (the hub runs pantry's seed and loads the demo's label readings).
function DemoDataPanel({ hubOff }: { hubOff: boolean }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: true; output: string } | { ok: false; message: string } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const offNote = useId();

  const reset = async () => {
    setAsking(false);
    setBusy(true);
    setOutcome(null);
    try {
      const r = await resetDemo();
      setOutcome({ ok: true, output: r.output });
    } catch (e) {
      setOutcome({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2 className="card-title">Demo data</h2>
      <p className="card-sub">
        Put the catalog, the recipes and the demo’s origin evidence back the way the demo ships them,
        after trying out label readings and reviews in Provenance.
      </p>
      <div className="demo-reset">
        {asking ? (
          <InlineConfirm
            question="Reset the demo data?"
            detail="This reseeds pantry’s database: readings submitted or approved since are gone, and the review queue is emptied. Meal plans saved in browsers are not touched."
            choices={[{ label: 'Reset demo data', onClick: () => void reset(), tone: 'danger' }]}
            onCancel={() => setAsking(false)} returnFocus={trigger} />
        ) : (
          <button ref={trigger} type="button" className="btn btn-secondary"
                  aria-disabled={hubOff || busy || undefined} aria-describedby={hubOff ? offNote : undefined}
                  onClick={() => { if (!hubOff && !busy) setAsking(true); }}>
            <Icon name="refresh" size={16} />{busy ? 'Resetting…' : 'Reset demo data'}
          </button>
        )}
        {hubOff && <p id={offNote} className="muted">Resetting goes through the demo hub, which is off here.</p>}
      </div>
      {outcome?.ok === true && (
        <Notice tone="success" title="The demo data is back as it ships.">
          The catalog, the recipes and the demo’s origin evidence are reloaded; the review queue is empty.
        </Notice>
      )}
      {outcome?.ok === true && outcome.output && <JsonView value={outcome.output} label="What the reset printed" />}
      {outcome?.ok === false && (
        <Notice tone="danger" title="The demo data was not reset."
                hint="The hub runs the reset with a script of its own (DEMO_RESET_SCRIPT); the words above are its answer.">
          {outcome.message}
        </Notice>
      )}
    </section>
  );
}

export default function SystemView() {
  const hub = useHubStatus();
  const status = hub.status;
  const load = useCallback(() => { void hub.refresh(); }, [hub.refresh]);

  return (
    <div className="view ws-stack">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Services</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={load} aria-disabled={hub.checking || undefined}>
            <Icon name="refresh" size={16} />{hub.checking ? 'Checking…' : 'Refresh'}
          </button>
        </div>
        {!status && <p className="muted">{hub.state === 'connecting' ? 'Asking the demo hub…'
          : 'The demo hub lists the services it can reach; with the hub off there is nothing to list.'}</p>}
        <div className="service-grid">
          {status?.services.map((s) => (
            <div key={s.id} className="service">
              <div className="service-head">
                <strong>{s.label}</strong>
                <StateTag state={serviceStatus(s.ok)} />
              </div>
              <div className="muted"><code>{s.url}</code> · {s.ok ? `HTTP ${s.status}` : 'not reachable'}</div>
              {s.servers && s.servers.length > 0 && (
                <div className="muted">virtual servers: {s.servers.map((v) => `${v.name} (${v.tools} tools)`).join(', ')}</div>
              )}
              {s.models && s.models.length > 0 && <div className="muted">models: {s.models.join(', ')}</div>}
              {s.skill && <div className="muted">skill: <code>{s.skill}</code></div>}
              {s.runtime && <div className="muted">planner LLM: {s.runtime.demo_mode ? 'demo mode' : s.runtime.models.selector_default}</div>}
              <div className="service-links">
                {Object.entries(s.links ?? {}).map(([label, href]) => (
                  <a key={label} href={href} target="_blank" rel="noreferrer">{label}<Icon name="external" className="ico-inline ico-end" /> <span className="sr-only">(opens in a new tab)</span></a>
                ))}
              </div>
            </div>
          ))}
        </div>
        {status && (
          <div className="service-keys">
            {Object.entries(status.keys).map(([k, v]) => (
              <StateTag key={k} state={keyStatus(KEY_NAMES[k] ?? humanize(k), v)} />
            ))}
            <span className="chip">Assistant default: {status.agent.default_model}</span>
          </div>
        )}
      </section>
      <LlmPanel onChanged={load} />
      <DemoDataPanel hubOff={hub.state === 'refused' || hub.state === 'unreachable'} />
      {status && <JsonView value={status} label="Raw /hub/status" />}
    </div>
  );
}
