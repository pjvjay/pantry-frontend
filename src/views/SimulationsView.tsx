import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBanner, JsonView, StatusDot } from '../components/common';
import Markdown from '../components/Markdown';
import { simCancel, simJob, simPresets, simRun, simScenario, simScenarios, simStart, simTranscript } from '../hub';

type Rec = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' ? v : 0);

interface Check { item: string; passed: boolean; evidence: string }
interface Match { path: string; op: string; expected: unknown; actual: unknown; passed: boolean }
interface Verdict {
  passed: boolean; score: number; judge_model: string; votes: number; goal_achieved: boolean | null;
  checklist: Check[]; matches: Match[]; failure_reasons: string[]; flags: string[];
}

function statusTone(status: string) {
  return status === 'passed' ? true : status === 'failed' ? false : null;
}

function TranscriptView({ events }: { events: Rec[] }) {
  return (
    <div className="sim-transcript">
      {events.map((e, i) => {
        const kind = str(e.kind);
        if (kind === 'user') return <div key={i} className="bubble bubble-user">{str(e.text)}</div>;
        if (kind === 'assistant' && str(e.text)) {
          return <div key={i} className="bubble bubble-agent"><Markdown text={str(e.text)} /></div>;
        }
        if (kind === 'tool_call') {
          return <div key={i} className="sim-event"><code>→ {str(e.name)}</code> <span className="muted">{JSON.stringify(e.arguments).slice(0, 160)}</span></div>;
        }
        if (kind === 'tool_result') {
          return (
            <div key={i} className={`sim-event ${e.is_error ? 'sim-error' : ''}`}>
              <code>← {str(e.name)}</code> <span className="muted">{e.is_error ? 'error' : 'ok'} · {num(e.ms)} ms</span>
              <JsonView value={e.structured ?? e.text} label="result" />
            </div>
          );
        }
        if (kind === 'informant_report') {
          const reports = (e.reports as Rec[] | undefined) ?? [];
          return (
            <div key={i} className="sim-event sim-informant">
              <span className="muted">observers at {str(e.trigger)}:</span>{' '}
              {reports.map((r, j) => (
                <span key={j} className={`chip ${r.value === true ? 'chip-ok' : r.value === false ? 'chip-muted' : 'chip-warn'}`}
                      title={str(r.evidence)}>
                  {str(r.observer)}.{str(r.condition)} = {r.value === null ? 'unknown' : String(r.value)}
                </span>
              ))}
            </div>
          );
        }
        if (kind === 'tools_offered') {
          const added = (e.added as string[]) ?? [];
          return added.length ? <div key={i} className="sim-event muted">tools offered +{added.join(', ')} ({str(e.reason)})</div> : null;
        }
        if (kind === 'end') return <div key={i} className="chat-meta">end: {str(e.outcome)} — {str(e.reason)}</div>;
        if (kind === 'error') return <div key={i} className="sim-event sim-error">{str(e.message)}</div>;
        return null;
      })}
    </div>
  );
}

function VerdictView({ verdict }: { verdict: Verdict }) {
  return (
    <div>
      <div className="plan-meta">
        <span className={`chip ${verdict.passed ? 'chip-ok' : 'pill-bad'}`}>{verdict.passed ? 'passed' : 'failed'}</span>
        <span className="chip">score {verdict.score.toFixed(2)}</span>
        <span className="chip chip-muted">judge {verdict.judge_model} × {verdict.votes}</span>
        {verdict.flags.map((f) => <span key={f} className="chip chip-warn">{f}</span>)}
      </div>
      <h4>Checklist (the judge)</h4>
      {verdict.checklist.length === 0 && <p className="muted">No judge ran for this transcript.</p>}
      <ul className="checklist">
        {verdict.checklist.map((c, i) => (
          <li key={i} className={c.passed ? 'ok' : 'bad'}>
            <span>{c.passed ? '✓' : '✗'}</span> {c.item}
            <div className="muted">{c.evidence}</div>
          </li>
        ))}
      </ul>
      {verdict.matches.length > 0 && (
        <>
          <h4>Deterministic matcher (cannot be overruled)</h4>
          <table className="origin-table">
            <thead><tr><th>Path</th><th>Check</th><th>Expected</th><th>Actual</th><th /></tr></thead>
            <tbody>
              {verdict.matches.map((m, i) => (
                <tr key={i}>
                  <td><code>{m.path}</code></td><td>{m.op}</td>
                  <td className="muted">{JSON.stringify(m.expected)}</td>
                  <td className="muted">{JSON.stringify(m.actual).slice(0, 80)}</td>
                  <td>{m.passed ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {verdict.failure_reasons.length > 0 && (
        <ul className="week-notes">{verdict.failure_reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      )}
    </div>
  );
}

function ScenarioDetail({ name, runnerUrl, refreshKey }: { name: string; runnerUrl: string; refreshKey: number }) {
  const [scenario, setScenario] = useState<Rec | null>(null);
  // The run detail together with the scenario it was loaded for (its own `scenario` field is the
  // scenario snapshot, not the name).
  const [run, setRun] = useState<Rec | null>(null);
  const [runFor, setRunFor] = useState('');
  const [stem, setStem] = useState('');
  const [transcript, setTranscript] = useState<Rec | null>(null);
  const [error, setError] = useState('');

  // Every load is guarded by `alive`: switching scenarios mid-request must not let the old
  // scenario's answer (or a request mixing the new name with the old run id) land on this one.
  useEffect(() => {
    let alive = true;
    setScenario(null); setRun(null); setStem(''); setTranscript(null); setError('');
    (async () => {
      try {
        const s = await simScenario(name);
        if (!alive) return;
        setScenario(s);
        const last = s.last_run as Rec | null;
        if (!last?.run_id) return;
        const r = await simRun(name, str(last.run_id));
        if (!alive) return;
        setRun(r);
        setRunFor(name);
        const ts = (r.transcripts as Rec[]) ?? [];
        const first = ts.find((t) => t.judged) ?? ts[0];
        setStem(first ? str(first.file) : '');
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => { alive = false; };
  }, [name, refreshKey]);

  useEffect(() => {
    if (!run || !stem || runFor !== name) return;
    let alive = true;
    setTranscript(null);
    simTranscript(name, str(run.run_id), stem)
      .then((t) => { if (alive) setTranscript(t); })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [name, run, runFor, stem]);

  const sc = (scenario?.scenario as Rec) ?? {};
  const last = scenario?.last_run as Rec | null;
  const verdicts = (run?.verdicts as Record<string, Verdict>) ?? {};
  const transcripts = (run?.transcripts as Rec[]) ?? [];
  const current = verdicts[stem.replace(/\.jsonl$/, '')];
  const currentRow = transcripts.find((t) => str(t.file) === stem);
  const dry = Boolean((run?.summary as Rec | undefined)?.dry_run) || current?.judge_model === 'dry-run';
  return (
    <section className="panel">
      <ErrorBanner error={error} />
      <div className="plan-header">
        <h2>{str(sc.title) || name}</h2>
        {last && <a href={`${runnerUrl}/#/${name}/${str(last.run_id)}`} target="_blank" rel="noreferrer">open in the runner ↗</a>}
      </div>
      <p className="card-sub">{str(sc.category)} · {name}</p>
      {Boolean(sc.goal) && <p><strong>Goal:</strong> {str(sc.goal)}</p>}
      {Array.isArray(sc.expected_behavior) && (
        <details className="json"><summary>Expected behaviour ({(sc.expected_behavior as string[]).length})</summary>
          <ul>{(sc.expected_behavior as string[]).map((b) => <li key={b}>{b}</li>)}</ul></details>
      )}
      {!last && <p className="muted">Never run. Pick a preset and press Run.</p>}
      {last && (
        <>
          <div className="plan-meta">
            <span className={`chip ${str(last.status) === 'passed' ? 'chip-ok' : 'pill-bad'}`}>{str(last.status)}</span>
            <span className="chip">{num(last.passed)}/{num(last.runs)} runs passed</span>
            <span className="chip chip-muted">{str(last.started_at).slice(0, 16).replace('T', ' ')} UTC · {Math.round(num(last.duration_s))}s</span>
            {Object.entries((last.models as Rec) ?? {}).filter(([k]) => k !== 'allow_same_judge').map(([k, v]) => (
              <span key={k} className="chip chip-muted">{k}: {str(v)}</span>
            ))}
          </div>
          {transcripts.length > 1 && (
            <div className="subtabs">
              {transcripts.map((t) => (
                <button key={str(t.file)} className={`subtab ${stem === str(t.file) ? 'subtab-active' : ''}`}
                        onClick={() => setStem(str(t.file))}>
                  <StatusDot ok={t.passed as boolean | null} /> {str(t.stem)}
                </button>
              ))}
            </div>
          )}
          {currentRow && (
            <div className="plan-meta">
              <span className={`chip ${str(currentRow.outcome) === 'completed' ? 'chip-muted' : 'pill-bad'}`}>
                outcome: {str(currentRow.outcome)}
              </span>
              <span className="muted">{str(currentRow.reason)}</span>
            </div>
          )}
          {dry && (
            <p className="coverage-note">
              A dry run calls no model: a scripted agent calls the planned tools in order and its
              answer is the covering tool's raw result. There is no judge, so only the matcher and
              the code observers grade it, and the per-product fields nested inside <code>items</code> are
              expected misses. It proves the wiring, not the agent: choose a model preset for a real run.
            </p>
          )}
          {current && <VerdictView verdict={current} />}
          {transcript && (
            <>
              <h4>Conversation</h4>
              <TranscriptView events={(transcript.events as Rec[]) ?? []} />
            </>
          )}
        </>
      )}
    </section>
  );
}

export default function SimulationsView() {
  const [presets, setPresets] = useState<Record<string, { label: string; models: Record<string, string> }>>({});
  const [runnerUrl, setRunnerUrl] = useState('');
  const [preset, setPreset] = useState('gemini');
  const [scenarios, setScenarios] = useState<Rec[]>([]);
  const [selected, setSelected] = useState('');
  const [job, setJob] = useState<Rec | null>(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const poll = useRef<number | null>(null);

  const load = useCallback(() => {
    simScenarios().then((d) => {
      setScenarios(d.scenarios);
      setSelected((s) => s || str(d.scenarios.find((x) => x.name === 'recipe-link-mala-chicken')?.name ?? d.scenarios[0]?.name));
    }).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    simPresets().then((p) => { setPresets(p.presets); setRunnerUrl(p.runner_url); }).catch((e: Error) => setError(e.message));
    load();
    return () => { if (poll.current) window.clearInterval(poll.current); };
  }, [load]);

  const follow = (id: string) => {
    if (poll.current) window.clearInterval(poll.current);
    poll.current = window.setInterval(async () => {
      try {
        const j = await simJob(id);
        setJob(j);
        if (!['queued', 'running'].includes(str(j.status))) {
          if (poll.current) window.clearInterval(poll.current);
          load();
          setRefreshKey((k) => k + 1);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }, 2000);
  };

  const start = async (names: string[] | 'all') => {
    setError('');
    if (names === 'all' && preset !== 'dry'
        && !window.confirm('Run every scenario? On the Gemini free tier this can use most of a day\'s quota.')) return;
    if (names !== 'all' && names.length === 1) setSelected(names[0]);   // show what is running
    try {
      const r = await simStart(names, preset);
      setJob({ job_id: r.job_id, status: 'queued', scenarios: r.scenarios.map((n) => ({ name: n, status: 'queued' })), log_tail: [] });
      follow(r.job_id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const groups = scenarios.reduce<Record<string, Rec[]>>((acc, s) => {
    (acc[str(s.category)] ??= []).push(s);
    return acc;
  }, {});
  const running = job && ['queued', 'running'].includes(str(job.status));
  return (
    <div className="view">
      <section className="panel">
        <div className="plan-header">
          <h2>Agent simulations (mcp-sim)</h2>
          <div className="form-row compact">
            <label>models
              <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                {Object.entries(presets).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
              </select>
            </label>
            <button className="secondary" onClick={() => void start('all')} disabled={Boolean(running)}>Run all</button>
            {runnerUrl && <a href={runnerUrl} target="_blank" rel="noreferrer">runner UI ↗</a>}
          </div>
        </div>
        <p className="card-sub">
          Each scenario is a simulated shopper talking to an agent that uses the pantry MCP tools,
          graded by an independent judge, a deterministic matcher on the agent's final JSON, and
          observers watching the tool traffic. The scenarios with <em>(gateway)</em> run through ContextForge.
        </p>
        {presets[preset] && (
          <div className="plan-meta">{Object.entries(presets[preset].models).map(([r, m]) => <span key={r} className="chip chip-muted">{r}: {m}</span>)}</div>
        )}
      </section>
      <ErrorBanner error={error} hint={error.includes('not reachable') ? 'Start the runner with the stack script (scripts/up.sh).' : undefined} />

      {job && (
        <section className="panel">
          <div className="plan-header">
            <h3>Job {str(job.job_id)} · {str(job.status)}</h3>
            {running && <button className="danger" onClick={() => void simCancel(str(job.job_id))}>Stop</button>}
          </div>
          <div className="plan-meta">
            {((job.scenarios as Rec[]) ?? []).map((s) => (
              <button key={str(s.name)} className="chip linkish-chip" onClick={() => setSelected(str(s.name))}>
                {str(s.name)}: {str(s.status)}
              </button>
            ))}
          </div>
          <pre className="log">{((job.log_tail as string[]) ?? []).slice(-14).join('\n')}</pre>
        </section>
      )}

      <div className="split">
        <aside className="split-side-left">
          {Object.entries(groups).map(([cat, items]) => (
            <div key={cat} className="sim-group">
              <div className="timeline-heading">{cat}</div>
              {items.map((s) => {
                const last = s.last_run as Rec | null;
                return (
                  <div key={str(s.name)} className={`sim-row ${selected === s.name ? 'sim-row-active' : ''}`}
                       onClick={() => setSelected(str(s.name))}>
                    <StatusDot ok={statusTone(str(s.status))} />
                    <div className="sim-row-text">
                      <div>{str(s.title)}</div>
                      <div className="muted">{last ? `${num(last.passed)}/${num(last.runs)} passed · ${str(last.started_at).slice(5, 16).replace('T', ' ')}` : 'never run'}</div>
                    </div>
                    <button className="mini" disabled={Boolean(running)} onClick={(e) => { e.stopPropagation(); void start([str(s.name)]); }}>Run</button>
                  </div>
                );
              })}
            </div>
          ))}
        </aside>
        <div className="split-main">
          {selected && <ScenarioDetail name={selected} runnerUrl={runnerUrl} refreshKey={refreshKey} />}
        </div>
      </div>
    </div>
  );
}
