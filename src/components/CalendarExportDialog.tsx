// Add the meal plan to a calendar, with no account and no sign-in: a preview of the all-day
// events pantry-api builds from the approved trips and placed meals, the .ics file to import,
// and one Google add-event link per event. Opened from the Meal plan tab's Shop band.
//
// Everything shown comes from /calendar/preview, the same builder that writes the file, so the
// preview is exactly what gets imported. The console only chooses which kinds of event to send.
import { useEffect, useId, useState } from 'react';

import { ApiError, downloadCalendar, previewCalendar } from '../api';
import {
  INCLUDE_ALL, INCLUDE_LABELS, KIND_LABELS, countsText, eventsByDay, exportErrorText,
  exportProblem, exportRequest, googleLabel, googleLink, includeCounts, includeProblem,
} from '../calendar';
import type { ApprovedSchedule, CalendarInclude, CalendarPreview } from '../types';
import { CalendarSyncPanel } from './CalendarSyncPanel';
import { Sheet } from './Sheet';

type Preview =
  | { status: 'idle' | 'loading'; data: CalendarPreview | null; error: null }
  | { status: 'ok'; data: CalendarPreview; error: null }
  | { status: 'error'; data: null; error: string };

const errorText = (err: unknown) => (err instanceof ApiError
  ? exportErrorText(err.status, err.code, err.message)
  : err instanceof Error ? err.message : String(err));

export function CalendarExportDialog({ open, onClose, schedule, current }: {
  open: boolean;
  onClose: () => void;
  // the latest answer's approved_schedule, posted back unchanged
  schedule: ApprovedSchedule | null;
  // false while the plan is being checked again: the schedule may be about to change
  current: boolean;
}) {
  const [include, setInclude] = useState<CalendarInclude[]>([...INCLUDE_ALL]);
  const [preview, setPreview] = useState<Preview>({ status: 'idle', data: null, error: null });
  const [saved, setSaved] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const statusId = useId();
  const problem = exportProblem(schedule) ?? includeProblem(include);

  // Preview again whenever the dialog opens, the schedule changes or the kinds change; a newer
  // request cancels the one before.
  useEffect(() => {
    if (!open || !schedule || problem || !current) {
      setPreview({ status: 'idle', data: null, error: null });
      return;
    }
    const ctl = new AbortController();
    setPreview((p) => ({ status: 'loading', data: p.data, error: null }));
    previewCalendar(exportRequest(schedule, include), ctl.signal)
      .then((data) => setPreview({ status: 'ok', data, error: null }))
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return;
        setPreview({ status: 'error', data: null, error: errorText(err) });
      });
    return () => ctl.abort();
  }, [open, schedule, include, problem, current]);

  useEffect(() => {
    if (open) return;
    setSaved(null);
    setDownloadError(null);
  }, [open]);

  const toggle = (k: CalendarInclude) =>
    setInclude((now) => (now.includes(k) ? now.filter((x) => x !== k) : [...now, k]));

  const download = async () => {
    if (!schedule) return;
    setDownloading(true);
    setSaved(null);
    setDownloadError(null);
    try {
      const file = await downloadCalendar(exportRequest(schedule, include));
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaved(`Saved ${file.filename}.`);
    } catch (err) {
      setDownloadError(`Not downloaded: ${errorText(err)}`);
    } finally {
      setDownloading(false);
    }
  };

  const counts = schedule ? includeCounts(schedule) : null;
  const data = preview.data;
  const ready = preview.status === 'ok' && current && !problem;
  const status = problem ?? (!current ? 'Checking the plan…'
    : preview.status === 'loading' ? 'Building the events…'
      : preview.status === 'error' ? preview.error
        : data ? `${countsText(data)}, all-day.` : '');

  return (
    <Sheet open={open} onClose={onClose} title="Add the plan to a calendar"
           description="All-day events from your approved trips and placed meals. No account or sign-in."
           footer={<>
             <span className={downloadError ? 'cart-flag cal-saved' : 'cal-saved'} role="status">
               {downloadError ?? saved}
             </span>
             <button type="button" disabled={!ready || downloading} onClick={() => void download()}>
               {downloading ? 'Downloading…' : 'Download .ics'}
             </button>
           </>}>
      <p id={statusId} className={`cal-status ${problem || preview.status === 'error' ? 'cart-flag' : 'muted'}`}
         role={preview.status === 'error' ? 'alert' : 'status'}>
        {status}
      </p>

      <fieldset className="mp-checks cal-include" aria-describedby={statusId}>
        <legend>Include</legend>
        {INCLUDE_ALL.map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={include.includes(k)} onChange={() => toggle(k)} />
            {INCLUDE_LABELS[k]}{counts && <span className="muted"> ({counts[k]})</span>}
          </label>
        ))}
      </fieldset>

      {/* Google Calendar sync: only with the local demo hub and an OAuth client */}
      <CalendarSyncPanel open={open} schedule={schedule} include={include} ready={ready} />

      {data && (
        <>
          <h3 className="cal-head">Events</h3>
          {data.events.length === 0 && <p className="muted">No events of the kinds chosen.</p>}
          <ol className="cal-days" aria-busy={preview.status === 'loading'}>
            {eventsByDay(data).map((d) => (
              <li key={d.date} className="cal-day">
                <h4 className="cal-day-head">{d.label}</h4>
                <ul className="cal-events">
                  {d.events.map((e) => {
                    const href = googleLink(e);
                    return (
                      <li key={e.uid} className={`cal-event cal-${e.kind}`}>
                        <div className="cal-event-head">
                          <span className="chip">{KIND_LABELS[e.kind]}</span>
                          <strong className="cal-title">{e.title}</strong>
                        </div>
                        {e.location && <div className="muted">{e.location}</div>}
                        {e.labels.length > 0 && (
                          <div className="cal-labels">
                            {e.labels.map((l) => <span key={l} className="chip chip-warn">{l}</span>)}
                          </div>
                        )}
                        <details className="cal-details">
                          <summary>What the event says</summary>
                          <pre className="cal-desc">{e.description}</pre>
                        </details>
                        {href && (
                          <a className="cal-google" href={href} target="_blank" rel="noopener noreferrer"
                             aria-label={googleLabel(e)}>
                            Add to Google Calendar
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
          <h3 className="cal-head">Importing</h3>
          <ul className="cal-notes">
            {data.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </>
      )}
    </Sheet>
  );
}
