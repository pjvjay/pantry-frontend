// One step of an Assistant run, in the run's open timeline (RunTimeline.tsx): a mark and a word
// for its state, what it is doing or did, one line on it, and how long it took. Pressed, it opens
// what the step was given and what came back: a tool's arguments and result as JSON, a model
// call's timing, what the observers saw. A step with nothing more to show (the error that ended a
// run) is a plain row, so the keyboard does not stop on a button that opens nothing.
//
// The state is said three ways, never by colour alone: the mark's shape (a check, a dashed ring,
// a cross, a square), a word (Running, Failed, Stopped in place of the time) and, for a screen
// reader, the word before the name.
import { useEffect, useId, useRef, useState } from 'react';

import { callProgress, callTiming, durationText, toolWords, waitingOf } from '../../transcript';
import type { ModelStep, Note, ObserveStep, Step, StepStatus, ToolStep } from '../../transcript';
import type { LlmCallTrace } from '../../types';
import { JsonView } from '../common';
import { RecipeImages, imagesIn } from '../flow';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { BurrLink, LlmCalls } from '../plan';

export const STEP_STATUS: Record<StepStatus, { icon: IconName; word: string }> = {
  running: { icon: 'circle-dashed', word: 'Running' },
  done: { icon: 'circle-check', word: 'Done' },
  error: { icon: 'circle-x', word: 'Failed' },
  stopped: { icon: 'stop', word: 'Stopped' },
};

// What a pantry plan tool reports about its own run: its LLM calls phase by phase
// (summary.llm_calls) and the Burr run that traced it (summary.burr_run).
type PlanTrace = { llm_calls?: LlmCallTrace[]; burr_run?: string };
const planTraceOf = (structured: unknown): PlanTrace =>
  (structured as { summary?: PlanTrace } | null)?.summary ?? {};

const pct = (v: number) => Math.floor(v);
const clock = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.max(0, Math.round(s))}s`);

// A model call in progress: the hub's estimate, kept up to date by the progress reports. The bar
// keeps its own one-second clock, so only it re-renders while the call runs. It never goes back:
// a revised estimate that would shrink it holds it where it was.
function CallProgress({ step }: { step: ModelStep }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const w = waitingOf(step, now);
  const { elapsed, left, over, detail } = callProgress(w, now);
  const best = useRef({ since: 0, pct: 0 });
  if (best.current.since !== w.since) best.current = { since: w.since, pct: 0 };
  const done = Math.max(best.current.pct, Math.min(99, (100 * elapsed) / (elapsed + left)));
  best.current.pct = done;
  return (
    <div className="call-progress">
      <div className="call-progress-head">
        <span>Step {w.step} · <code>{w.model.replace(/^(gemini|ollama):/, '')}</code></span>
        <strong>{pct(done)}%</strong>
      </div>
      <div className={`rs-progress${over ? ' rs-progress-over' : ''}`} role="progressbar" aria-label={`Model step ${w.step}`}
           aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct(done)}>
        <div className="rs-progress-fill" style={{ width: `${done}%` }} />
      </div>
      <p className="call-progress-detail">
        {detail} · {clock(elapsed)} elapsed · {over ? `longer than usual, ~${clock(left)} more` : `~${clock(left)} left`}
      </p>
      <p className="call-progress-basis">Estimate from {w.basis || 'defaults'}</p>
    </div>
  );
}

function ToolBody({ step }: { step: ToolStep }) {
  const r = step.result;
  const trace = r ? planTraceOf(r.structured) : {};
  const calls = Array.isArray(trace.llm_calls) ? trace.llm_calls : [];
  // a fetched recipe page: the photos it holds
  const photos = r && !r.is_error && /fetch/.test(step.tool) ? imagesIn(r.text || JSON.stringify(r.structured ?? '')) : [];
  const filled = (step.call as { filled_by_hub?: string[] }).filled_by_hub ?? [];
  return (
    <>
      {filled.length > 0 && <p className="rs-note-line">Filled in by the hub: {filled.join(', ')}</p>}
      {photos.length > 0 && <RecipeImages urls={photos} />}
      {calls.length > 0 && <LlmCalls calls={calls} heading="inside pantry:" />}
      {trace.burr_run && <p className="rs-note-line">Inside pantry: <BurrLink run={trace.burr_run} /></p>}
      <JsonView value={step.call.arguments} label="Arguments" open />
      {r && (r.structured != null
        ? <JsonView value={r.structured} label="Result" />
        : <JsonView value={r.text} label={r.is_error ? 'Error' : 'Result (text)'} open={r.is_error} />)}
      {step.offered && <p className="rs-note-line">Turned on: {step.offered.added.map(toolWords).join(', ')}</p>}
    </>
  );
}

function ModelBody({ step }: { step: ModelStep }) {
  return (
    <>
      {step.status === 'running' && <CallProgress step={step} />}
      {step.call && <p className="rs-note-line">{callTiming(step.call)}</p>}
      {step.said && <p className="rs-said">“{step.said}”</p>}
      {step.call && <JsonView value={step.call} label="Model call" />}
    </>
  );
}

function ObserveBody({ step }: { step: ObserveStep }) {
  return (
    <>
      {(step.observations.length > 0 || step.goals.length > 0) && (
        <ul className="rs-obs">
          {step.observations.map((o, i) => (
            <li key={i}>
              <strong>{o.observer}</strong> asked whether {o.when}: <strong>{o.value ? 'yes' : 'no'}</strong>
              {o.evidence && <> ({o.evidence})</>}
              {o.added.length > 0 && <>; turned on {o.added.map(toolWords).join(', ')}</>}
              {o.removed.length > 0 && <>; turned off {o.removed.map(toolWords).join(', ')}</>}
            </li>
          ))}
          {step.goals.map((g, i) => (
            <li key={`g${i}`}><strong>Goal</strong> ({g.reason.replace(/^observer:/, '')}): {g.text}</li>
          ))}
        </ul>
      )}
      {step.observers.length > 0 && (
        <p className="rs-note-line">
          Asked {step.observers.join(', ')}{step.model ? ` (judged by ${step.model.replace(/^gemini:/, '')})` : ''}.
        </p>
      )}
    </>
  );
}

function StepBody({ step }: { step: Step }) {
  switch (step.kind) {
    case 'tool':
      return <ToolBody step={step} />;
    case 'model':
      return <ModelBody step={step} />;
    case 'observe':
      return <ObserveBody step={step} />;
    case 'import':
      return <JsonView value={step.event} label="What the hub read" />;
    case 'meals':
      return (
        <>
          {step.event.note && <p className="rs-note-line">{step.event.note}</p>}
          <JsonView value={step.event} label="What was read" />
        </>
      );
    default:
      return null;
  }
}

export function StepRow({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const status = STEP_STATUS[step.status];
  const opens = step.kind !== 'error';
  // a step that has run says how long; one that has not says where it stands, in a word
  const time = step.status === 'done' ? (step.ms != null ? durationText(step.ms) : '') : status.word;
  const line = (
    <>
      <span className="rs-mark" aria-hidden="true"><Icon name={status.icon} size={18} /></span>
      <span className="rs-text">
        <span className="sr-only">{status.word}: </span>
        <span className="rs-name">{step.name}</span>
        {step.kind === 'tool' && <code className="rs-code">{step.tool}</code>}
        {step.summary && <span className="rs-summary">{step.summary}</span>}
      </span>
      <span className="rs-time" aria-hidden={step.status === 'done' ? undefined : true}>{time}</span>
      {opens && <Icon name="chevron-down" size={16} className="rs-chev" />}
    </>
  );
  return (
    <li className={`rs rs-kind-${step.kind} rs-${step.status}`}>
      {opens ? (
        <button type="button" className="rs-line" aria-expanded={open} aria-controls={open ? bodyId : undefined}
                onClick={() => setOpen((o) => !o)}>
          {line}
        </button>
      ) : <div className="rs-line">{line}</div>}
      {opens && open && <div id={bodyId} className="rs-body"><StepBody step={step} /></div>}
    </li>
  );
}

// A note along the way (a notice from the hub, a cart change told to the model): not a step of
// the work, so quieter, and nothing to open.
export function NoteRow({ note }: { note: Note }) {
  return (
    <li className="rs rs-note">
      <span className="rs-mark" aria-hidden="true"><Icon name={note.cart ? 'cart' : 'info'} size={16} /></span>
      <span className="rs-note-text">{note.text}</span>
    </li>
  );
}
