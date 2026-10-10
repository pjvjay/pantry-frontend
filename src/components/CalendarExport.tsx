// The wizard's Calendar stage: the meal plan in a calendar, with no account and no sign-in. The
// times and reminders the shopper chooses, a preview of the events pantry-api builds from the
// approved trips and placed meals, the .ics file to import, one Google add-event link per
// event, and (with the local demo hub) Google Calendar sync.
//
// Everything shown comes from /calendar/preview, the same builder that writes the file, so the
// preview is exactly what gets imported. The console only chooses which kinds of event to send
// and the timing (src/calendar.ts turns the choices into minutes); the times and reminders are
// kept in this browser, so a later sync writes the same ones again.
import { useEffect, useId, useMemo, useState } from 'react';

import { ApiError, downloadCalendar, previewCalendar } from '../api';
import {
  INCLUDE_ALL, INCLUDE_LABELS, KIND_LABELS, LENGTHS, MAX_REMINDERS, TIMING_KEY, countsText, eventWhen, eventsByDay,
  exportErrorText, exportProblem, exportRequest, googleLabel, googleLink, includeCounts, includeProblem, kindProblem,
  readTimingForm, reminderChoices, reminderLabel, remindersText, timingFrom,
} from '../calendar';
import type { KindTiming, ReminderChoice, TimingForm } from '../calendar';
import type { ApprovedSchedule, CalendarInclude, CalendarPreview, CalendarTiming } from '../types';
import { CalendarSyncPanel } from './CalendarSyncPanel';

type Preview =
  | { status: 'idle' | 'loading'; data: CalendarPreview | null; error: null }
  | { status: 'ok'; data: CalendarPreview; error: null }
  | { status: 'error'; data: null; error: string };

const errorText = (err: unknown) => (err instanceof ApiError
  ? exportErrorText(err.status, err.code, err.message)
  : err instanceof Error ? err.message : String(err));

// ─── Times and reminders ─────────────────────────────────────

function readSaved(): TimingForm {
  try {
    return readTimingForm(window.localStorage.getItem(TIMING_KEY));
  } catch {
    return readTimingForm(null);
  }
}

function save(form: TimingForm) {
  try {
    window.localStorage.setItem(TIMING_KEY, JSON.stringify(form));
  } catch {
    /* kept for this visit only */
  }
}

// The browser's time zone, as the events' times are meant.
function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function useTiming(): { form: TimingForm; setForm: (f: TimingForm) => void; timing: CalendarTiming;
  zone: string } {
  const [form, setFormState] = useState(readSaved);
  const [zone] = useState(browserZone);
  const timing = useMemo(() => timingFrom(form, zone), [form, zone]);
  const setForm = (f: TimingForm) => {
    setFormState(f);
    save(f);
  };
  return { form, setForm, timing, zone };
}

function Reminders({ name, choices, remind, onChange }: {
  name: string;
  choices: readonly ReminderChoice[];
  remind: ReminderChoice[];
  onChange: (r: ReminderChoice[]) => void;
}) {
  const full = remind.filter((c) => choices.includes(c)).length >= MAX_REMINDERS;
  return (
    <fieldset className="mp-checks mp-reminders">
      <legend>{name}: remind me</legend>
      {choices.map((c) => {
        const on = remind.includes(c);
        return (
          <label key={String(c)} className="check">
            <input type="checkbox" checked={on} disabled={!on && full}
                   onChange={() => onChange(on ? remind.filter((x) => x !== c) : [...remind, c])} />
            {reminderLabel(c)}
          </label>
        );
      })}
      {full && <span className="muted">at most {MAX_REMINDERS}</span>}
    </fieldset>
  );
}

function KindSettings({ name, k, onChange }: { name: string; k: KindTiming; onChange: (k: KindTiming) => void }) {
  const why = useId();
  const problem = kindProblem(k);
  return (
    <fieldset className="mp-basics-group mp-timing-kind">
      <legend>{name}</legend>
      <label className="check">
        <input type="checkbox" checked={k.timed} onChange={(e) => onChange({ ...k, timed: e.target.checked })} />
        at a set time (otherwise all day)
      </label>
      {k.timed && (
        <div className="mp-toolbar">
          <label className="mp-inline">
            from
            <input type="time" value={k.start} step={900} aria-invalid={problem ? true : undefined}
                   aria-describedby={problem ? why : undefined}
                   onChange={(e) => onChange({ ...k, start: e.target.value })} />
          </label>
          <label className="mp-inline">
            for
            <select value={k.minutes} onChange={(e) => onChange({ ...k, minutes: Number(e.target.value) })}>
              {LENGTHS.map((n) => <option key={n} value={n}>{n < 60 ? `${n} min` : `${n / 60} h`}</option>)}
            </select>
          </label>
          {problem && <span id={why} className="cart-flag">Sent as all day until it is {problem}.</span>}
        </div>
      )}
      <Reminders name={name} choices={reminderChoices(k.timed)} remind={k.remind}
                 onChange={(remind) => onChange({ ...k, remind })} />
    </fieldset>
  );
}

export function TimingSettings({ form, onChange, zone }: { form: TimingForm; onChange: (f: TimingForm) => void;
  zone: string }) {
  return (
    <div className="mp-basics mp-timing">
      <KindSettings name="Shopping trips" k={form.trips} onChange={(trips) => onChange({ ...form, trips })} />
      <KindSettings name="Cooking" k={form.cooks} onChange={(cooks) => onChange({ ...form, cooks })} />
      <fieldset className="mp-basics-group mp-timing-kind">
        <legend>Freeze and thaw reminders</legend>
        <p className="muted">All-day events on the day to freeze or start thawing.</p>
        <Reminders name="Freeze and thaw" choices={reminderChoices(false)} remind={form.reminders.remind}
                   onChange={(remind) => onChange({ ...form, reminders: { remind } })} />
      </fieldset>
      <p className="muted mp-timing-zone">Times are in your time zone, {zone}.</p>
    </div>
  );
}

// ─── The export ──────────────────────────────────────────────

export function CalendarExport({ schedule, current, timing }: {
  // the latest answer's approved_schedule, posted back unchanged
  schedule: ApprovedSchedule | null;
  // false while the plan is being checked again: the schedule may be about to change
  current: boolean;
  timing: CalendarTiming;
}) {
  const [include, setInclude] = useState<CalendarInclude[]>([...INCLUDE_ALL]);
  const [preview, setPreview] = useState<Preview>({ status: 'idle', data: null, error: null });
  const [saved, setSaved] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const statusId = useId();
  const problem = exportProblem(schedule) ?? includeProblem(include);

  // Preview again whenever the schedule, the kinds or the timing change; a newer request cancels
  // the one before.
  useEffect(() => {
    if (!schedule || problem || !current) {
      setPreview({ status: 'idle', data: null, error: null });
      return;
    }
    const ctl = new AbortController();
    setPreview((p) => ({ status: 'loading', data: p.data, error: null }));
    previewCalendar(exportRequest(schedule, include, timing), ctl.signal)
      .then((data) => setPreview({ status: 'ok', data, error: null }))
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return;
        setPreview({ status: 'error', data: null, error: errorText(err) });
      });
    return () => ctl.abort();
  }, [schedule, include, problem, current, timing]);

  const toggle = (k: CalendarInclude) =>
    setInclude((now) => (now.includes(k) ? now.filter((x) => x !== k) : [...now, k]));

  const download = async () => {
    if (!schedule) return;
    setDownloading(true);
    setSaved(null);
    setDownloadError(null);
    try {
      const file = await downloadCalendar(exportRequest(schedule, include, timing));
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
        : data ? `${countsText(data)}${data.all_day ? ', all-day' : ''}.` : '');

  return (
    <div className="cal-export">
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

      <div className="cal-actions">
        <button type="button" disabled={!ready || downloading} onClick={() => void download()}>
          {downloading ? 'Downloading…' : 'Download .ics'}
        </button>
        <span className={downloadError ? 'cart-flag cal-saved' : 'cal-saved'} role="status">
          {downloadError ?? saved}
        </span>
      </div>

      {/* Google Calendar sync: only with the local demo hub and an OAuth client */}
      <CalendarSyncPanel open schedule={schedule} include={include} timing={timing} ready={ready} />

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
                    const reminders = remindersText(e);
                    return (
                      <li key={e.uid} className={`cal-event cal-${e.kind}`}>
                        <div className="cal-event-head">
                          <span className="chip">{KIND_LABELS[e.kind]}</span>
                          <span className="cal-when">{eventWhen(e)}</span>
                          <strong className="cal-title">{e.title}</strong>
                        </div>
                        {e.location && <div className="muted">{e.location}</div>}
                        {reminders && <div className="muted">{reminders}</div>}
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
    </div>
  );
}
