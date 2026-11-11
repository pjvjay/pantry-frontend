// How the assistant got to its answer, as one line between the question and the answer: while it
// works, what it is doing now and for how long ("Planning the shopping · 12 s"), beside a calm
// turning ring that stands still under reduced motion; once it has finished, the whole run in a
// few words ("Planned in 6 steps · 19 s"). Pressed, the line opens into the run's steps
// (StepRow.tsx), then the model and server it ran on, the checks the hub made of the answer, and
// the way to everything recorded about it (Workshop › Metrics).
//
// The line is a disclosure button: focus stays on it when it opens, and the steps follow it in
// the reading order. Its words change every second while the run works, so it is not a live
// region; the page says once, politely, when the run has ended (AssistantView).
import { useEffect, useId, useState } from 'react';

import { hrefFor } from '../../routes';
import { clockText, metaLine } from '../../transcript';
import type { Run, RunStatus } from '../../transcript';
import { EvalCard } from '../flow';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { NoteRow, StepRow } from './StepRow';

const MARK: Record<RunStatus, IconName> = {
  running: 'circle-dashed', answered: 'circle-check', stopped: 'stop', failed: 'circle-x',
};

// A clock counting up from when the question went, on its own one-second tick, so the transcript
// around it is not redrawn every second.
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <>{clockText(now - since)}</>;
}

export function RunTimeline({ run, sentAt, modelLabel }: {
  run: Run;
  sentAt: number;
  // a model's name as the settings list it ("Gemini 3 Flash (preview)")
  modelLabel?: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const running = run.status === 'running';
  const checks = run.failedChecks.length;
  const trace = run.traceId
    ? hrefFor({ name: 'workshop', tab: 'metrics', query: `trace=${encodeURIComponent(run.traceId)}` }) : null;

  return (
    <div className={`rt rt-${run.status}`}>
      <button type="button" className="rt-head" aria-expanded={open} aria-controls={open ? panelId : undefined}
              onClick={() => setOpen((o) => !o)}>
        <span className="rt-mark" aria-hidden="true">
          <Icon name={MARK[run.status]} size={18} className={running ? 'rt-turning' : undefined} />
        </span>
        <span className="rt-line">
          {running ? <>{run.live} · <Elapsed since={sentAt} /></> : run.headline}
          {checks > 0 && (
            <span className="rt-flag">
              <Icon name="alert" size={14} />{checks} {checks === 1 ? 'check' : 'checks'} failed
            </span>
          )}
        </span>
        <Icon name="chevron-down" size={16} className="rt-chev" />
      </button>
      {open && (
        <div id={panelId} className="rt-panel">
          {run.rows.length > 0
            ? (
              <ol className="rt-steps" aria-label="Steps">
                {run.rows.map((r) => (r.kind === 'note' ? <NoteRow key={r.id} note={r} /> : <StepRow key={r.id} step={r} />))}
              </ol>
            )
            : <p className="rt-empty">{running ? 'Waiting for the hub to start.' : 'No steps were taken.'}</p>}
          <div className="rt-foot">
            {run.meta && <p className="rt-meta">{metaLine(run.meta, modelLabel)}</p>}
            {run.evals
              ? <EvalCard evals={run.evals} traceId={run.traceId ?? undefined} />
              : trace && (
                <p className="rt-meta">
                  <a href={trace}>Run details<Icon name="arrow-right" className="ico-inline ico-end" /></a>
                </p>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
