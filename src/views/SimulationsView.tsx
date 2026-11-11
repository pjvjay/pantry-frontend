// Workshop › Simulations: mcp-sim's scenarios (a simulated shopper talking to an agent that uses the
// pantry MCP tools), their last runs, the judge's verdict and the conversation, and the runner's
// jobs. The runner sits behind the demo hub (/hub/sims/*); when it is not running, which is how
// this demo is often set up, the page says so calmly (what is off, and how to start it) and offers
// nothing to run.
//
// "Run all" spends most of a day's free model quota, so it asks first, in place (InlineConfirm),
// unless the preset is the dry run, which calls no model. Each scenario is a button that shows it
// and a Run button beside it, so the keyboard can read a scenario without running it. Every state
// (passed, failed, running, queued) is a tag: a glyph and words, never a coloured dot alone.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { JsonView } from '../components/common';
import { StateTag } from '../components/evidence';
import { InlineConfirm } from '../components/InlineConfirm';
import { TabList } from '../components/Tabs';
import { HubErrorBanner, Notice, ScrollRegion, Skeleton, Tag } from '../components/ui';
import Markdown from '../components/Markdown';
import { simCancel, simJob, simPresets, simRun, simScenario, simScenarios, simStart, simTranscript } from '../hub';
import { Icon } from '../components/icons';
import { humanize, observedStatus, outcomeStatus, runnerDown, simStatus } from '../workshop';

type Rec = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' ? v : 0);

interface Check { item: string; passed: boolean; evidence: string }
interface Match { path: string; op: string; expected: unknown; actual: unknown; passed: boolean }
interface Verdict {
  passed: boolean; score: number; judge_model: string; votes: number; goal_achieved: boolean | null;
  checklist: Check[]; matches: Match[]; failure_reasons: string[]; flags: string[];
}

// A scenario's state from its last run: passed or failed, and never run when it has none.
const scenarioState = (s: Rec) => simStatus((s.last_run as Rec | null) ? str(s.status) : 'never');

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
          return <div key={i} className="sim-event"><code><Icon name="arrow-right" className="ico-inline" /><span className="sr-only">call </span>{str(e.name)}</code> <span className="muted">{JSON.stringify(e.arguments).slice(0, 160)}</span></div>;
        }
        if (kind === 'tool_result') {
          return (
            <div key={i} className={`sim-event ${e.is_error ? 'sim-error' : ''}`}>
              <code><Icon name="arrow-left" className="ico-inline" /><span className="sr-only">result of </span>{str(e.name)}</code>{' '}
              <span className="muted">{e.is_error ? 'error' : 'ok'} · <span className="figures">{num(e.ms)} ms</span></span>
              <JsonView value={e.structured ?? e.text} label="Result" />
            </div>
          );
        }
        if (kind === 'informant_report') {
          const reports = (e.reports as Rec[] | undefined) ?? [];
          return (
            <div key={i} className="sim-event sim-informant">
              <span className="muted">observers at {str(e.trigger)}:</span>{' '}
              {reports.map((r, j) => (
                <span key={j} title={str(r.evidence)}>
                  <Tag kind={observedStatus(r.value).kind}>{str(r.observer)}.{str(r.condition)} = {observedStatus(r.value).word}</Tag>
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
      <p className="sim-verdict">
        <StateTag state={simStatus(verdict.passed ? 'passed' : 'failed')} />
        <span className="chip">score {verdict.score.toFixed(2)}</span>
        <span className="chip">judge {verdict.judge_model} × {verdict.votes}</span>
        {verdict.flags.map((f) => <Tag key={f} kind="attention">{humanize(f)}</Tag>)}
      </p>
      <h4>Checklist (the judge)</h4>
      {verdict.checklist.length === 0 && <p className="muted">No judge ran for this transcript.</p>}
      <ul className="checklist">
        {verdict.checklist.map((c, i) => (
          <li key={i} className={c.passed ? 'ok' : 'bad'}>
            <span><Icon name={c.passed ? 'check' : 'x'} className="ico-inline" /><span className="sr-only">{c.passed ? 'passed:' : 'failed:'}</span></span> {c.item}
            <div className="muted">{c.evidence}</div>
          </li>
        ))}
      </ul>
      {verdict.matches.length > 0 && (
        <>
          <h4>Deterministic matcher (cannot be overruled)</h4>
          <ScrollRegion label="The matcher's checks" className="table-scroll">
            <table className="table">
              <thead><tr><th>Path</th><th>Check</th><th>Expected</th><th>Actual</th><th><span className="sr-only">Result</span></th></tr></thead>
              <tbody>
                {verdict.matches.map((m, i) => (
                  <tr key={i}>
                    <td><code>{m.path}</code></td><td>{m.op}</td>
                    <td className="muted">{JSON.stringify(m.expected)}</td>
                    <td className="muted">{JSON.stringify(m.actual).slice(0, 80)}</td>
                    <td><Icon name={m.passed ? 'check' : 'x'} size={16} /><span className="sr-only">{m.passed ? 'passed' : 'failed'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </>
      )}
      {verdict.failure_reasons.length > 0 && (
        <Notice tone="warn" title="Why it failed">
          <ul className="sim-reasons">{verdict.failure_reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </Notice>
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
  const tabsId = useId();

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
  const shownId = `${tabsId}-shown`;
  return (
    <section className="card" aria-labelledby={`${tabsId}-title`}>
      <HubErrorBanner error={error} />
      <div className="card-head">
        <h2 id={`${tabsId}-title`} className="card-title">{str(sc.title) || name}</h2>
        {last && <a href={`${runnerUrl}/#/${name}/${str(last.run_id)}`} target="_blank" rel="noreferrer">Open in the runner<Icon name="external" className="ico-inline ico-end" /> <span className="sr-only">(opens in a new tab)</span></a>}
      </div>
      <p className="card-sub">{str(sc.category)} · {name}</p>
      {!scenario && !error && <Skeleton kind="row" count={4} label="Loading the scenario" />}
      {Boolean(sc.goal) && <p><strong>Goal:</strong> {str(sc.goal)}</p>}
      {Array.isArray(sc.expected_behavior) && (
        <details className="json"><summary>Expected behaviour ({(sc.expected_behavior as string[]).length})</summary>
          <ul>{(sc.expected_behavior as string[]).map((b) => <li key={b}>{b}</li>)}</ul></details>
      )}
      {scenario && !last && <p className="muted">Never run. Choose the models above and press Run beside it.</p>}
      {last && (
        <>
          <p className="sim-verdict">
            <StateTag state={simStatus(str(last.status))} />
            <span className="chip">{num(last.passed)} of {num(last.runs)} runs passed</span>
            <span className="chip">{str(last.started_at).slice(0, 16).replace('T', ' ')} UTC · {Math.round(num(last.duration_s))} s</span>
            {Object.entries((last.models as Rec) ?? {}).filter(([k]) => k !== 'allow_same_judge').map(([k, v]) => (
              <span key={k} className="chip">{k}: {str(v)}</span>
            ))}
          </p>
          {transcripts.length > 1 && (
            <TabList idBase={tabsId} label="Runs of this scenario" current={stem} onChange={setStem}
                     controls={() => shownId} className="sim-runs"
                     tabs={transcripts.map((t) => {
                       const state = simStatus(t.passed === true ? 'passed' : t.passed === false ? 'failed' : 'never');
                       return { key: str(t.file), label: <>{str(t.stem)} <StateTag state={state} /></> };
                     })} />
          )}
          <div id={shownId} role={transcripts.length > 1 ? 'tabpanel' : undefined}
               aria-labelledby={transcripts.length > 1 && stem ? `${tabsId}-tab-${stem}` : undefined}>
            {currentRow && (
              <p className="sim-verdict">
                <StateTag state={outcomeStatus(str(currentRow.outcome))} />
                <span className="muted">{str(currentRow.reason)}</span>
              </p>
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
          </div>
        </>
      )}
    </section>
  );
}

export default function SimulationsView() {
  const [presets, setPresets] = useState<Record<string, { label: string; models: Record<string, string> }>>({});
  const [runnerUrl, setRunnerUrl] = useState('');
  const [preset, setPreset] = useState('gemini');
  const [scenarios, setScenarios] = useState<Rec[] | null>(null);
  const [selected, setSelected] = useState('');
  const [job, setJob] = useState<Rec | null>(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [asking, setAsking] = useState(false);
  const poll = useRef<number | null>(null);
  const runAll = useRef<HTMLButtonElement>(null);
  const modelsId = useId();

  const load = useCallback(() => {
    simScenarios().then((d) => {
      setScenarios(d.scenarios);
      setSelected((s) => s || str(d.scenarios.find((x) => x.name === 'recipe-link-mala-chicken')?.name ?? d.scenarios[0]?.name));
    }).catch((e: Error) => { setScenarios([]); setError(e.message); });
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
    setAsking(false);
    if (names !== 'all' && names.length === 1) setSelected(names[0]);   // show what is running
    try {
      const r = await simStart(names, preset);
      setJob({ job_id: r.job_id, status: 'queued', scenarios: r.scenarios.map((n) => ({ name: n, status: 'queued' })), log_tail: [] });
      follow(r.job_id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const list = scenarios ?? [];
  const groups = list.reduce<Record<string, Rec[]>>((acc, s) => {
    (acc[str(s.category)] ??= []).push(s);
    return acc;
  }, {});
  const running = Boolean(job && ['queued', 'running'].includes(str(job.status)));
  const presetLabel = presets[preset]?.label ?? preset;
  // a dry run calls no model, so it costs nothing and asks nothing
  const askFirst = preset !== 'dry';
  const down = runnerDown(error);
  return (
    <div className="view ws-stack">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Agent simulations (mcp-sim)</h2>
          <div className="form-row compact sim-controls">
            <label htmlFor={modelsId}>Models</label>
            <select id={modelsId} value={preset} onChange={(e) => setPreset(e.target.value)}>
              {Object.entries(presets).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
            {!asking && (
              <button ref={runAll} type="button" className="btn btn-secondary"
                      disabled={running || list.length === 0}
                      onClick={() => (askFirst ? setAsking(true) : void start('all'))}>
                <Icon name="play" size={16} />Run all
              </button>
            )}
            {runnerUrl && <a href={runnerUrl} target="_blank" rel="noreferrer">Runner UI<Icon name="external" className="ico-inline ico-end" /> <span className="sr-only">(opens in a new tab)</span></a>}
          </div>
        </div>
        {asking && (
          <InlineConfirm
            className="sim-confirm"
            question={`Run all ${list.length} scenarios with ${presetLabel}?`}
            detail="Each one calls the models several times. On the Gemini free tier, all of them can use most of a day’s quota, which the deployed demo shares."
            choices={[{ label: `Run all ${list.length}`, onClick: () => void start('all') }]}
            onCancel={() => setAsking(false)} returnFocus={runAll} />
        )}
        <p className="card-sub">
          Each scenario is a simulated shopper talking to an agent that uses the pantry MCP tools,
          graded by an independent judge, a deterministic matcher on the agent's final JSON, and
          observers watching the tool traffic. The scenarios with <em>(gateway)</em> run through ContextForge.
        </p>
        {presets[preset] && (
          <p className="sim-models">{Object.entries(presets[preset].models).map(([r, m]) => <span key={r} className="chip">{r}: {m}</span>)}</p>
        )}
      </section>
      {down ? (
        <Notice tone="info" title="The simulation runner is not running"
                hint="Start it with the stack script (scripts/up.sh): it runs mcp-sim beside the demo hub."
                actions={[{ label: 'Check again', icon: 'refresh', onClick: () => { setError(''); setScenarios(null); load(); } }]}>
          Simulations are run and kept by mcp-sim, so there are no scenarios to show or run until it is started.
        </Notice>
      ) : <HubErrorBanner error={error} />}

      {job && (
        <section className="card" aria-labelledby="sim-job-title">
          <div className="card-head">
            <h3 id="sim-job-title" className="card-title sim-job-title">Job <code>{str(job.job_id)}</code> <StateTag state={simStatus(str(job.status))} /></h3>
            {running && (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => void simCancel(str(job.job_id))}>
                <Icon name="stop" size={16} />Stop
              </button>
            )}
          </div>
          <ul className="sim-job-list">
            {((job.scenarios as Rec[]) ?? []).map((s) => (
              <li key={str(s.name)}>
                <button type="button" className="linkish" onClick={() => setSelected(str(s.name))}>{str(s.name)}</button>
                <StateTag state={simStatus(str(s.status))} />
              </li>
            ))}
          </ul>
          <ScrollRegion label="The runner’s log, last lines" className="log">
            <pre>{((job.log_tail as string[]) ?? []).slice(-14).join('\n')}</pre>
          </ScrollRegion>
        </section>
      )}

      <div className="split">
        <section className="split-side-left" aria-label="Scenarios">
          {scenarios === null && <Skeleton kind="row" count={6} label="Loading the scenarios" />}
          {Object.entries(groups).map(([cat, items]) => (
            <div key={cat} className="sim-group">
              <h3 className="sim-cat">{cat}</h3>
              <ul className="sim-list">
                {items.map((s) => {
                  const last = s.last_run as Rec | null;
                  const name = str(s.name);
                  return (
                    <li key={name} className={`sim-row ${selected === name ? 'sim-row-active' : ''}`}>
                      <button type="button" className="sim-pick" aria-current={selected === name || undefined}
                              onClick={() => setSelected(name)}>
                        <span className="sim-row-title">{str(s.title)}</span>
                        <span className="sim-row-meta">
                          <StateTag state={scenarioState(s)} />
                          {last && <span className="muted figures">{num(last.passed)}/{num(last.runs)} · {str(last.started_at).slice(5, 16).replace('T', ' ')}</span>}
                        </span>
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={running}
                              aria-label={`Run ${str(s.title)}`} onClick={() => void start([name])}>
                        Run
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
        <div className="split-main">
          {selected && <ScenarioDetail name={selected} runnerUrl={runnerUrl} refreshKey={refreshKey} />}
        </div>
      </div>
    </div>
  );
}
