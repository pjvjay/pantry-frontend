// The wizard's Calendar stage: the meal plan in a calendar, with no account and no sign-in. It
// leads with what there is to add and the two ways to add it, each named for what it does:
// "Download calendar file" (an .ics for any calendar app) and, with the local demo hub, Google
// Calendar sync ("Connect Google Calendar", then "Sync with Google Calendar", which shows every
// change before writing it; components/CalendarSyncPanel.tsx). Without the hub a line says the
// sync needs it, rather than nothing. Then the times and reminders, folded into one Timing card
// whose heading says what they are now; then a preview of every event by day, each with its
// recipe's or product's picture (a quiet placeholder where the hub has none) and one Google
// add-event link; then pantry-api's notes on importing. What every event of a kind carries
// ("demo amounts" on every cook day, "demo store" on every trip) is said once over the list, kind
// by kind, and an event marks only what sets it apart.
//
// Once the events have gone to a calendar (the file downloaded, or a sync written with nothing
// failed) the stage says so and its last step is done, here, in the progress indicator and on
// Home, until the events change (mealplan/exported.ts keeps that beside the plan, not in it).
//
// Everything shown comes from /calendar/preview, the same builder that writes the file, so the
// preview is exactly what gets imported. The console only chooses which kinds of event to send
// and the timing (src/calendar.ts turns the choices into minutes); the times and reminders are
// kept in this browser, so a later sync writes the same ones again.
import { useEffect, useId, useMemo, useState } from 'react';

import { ApiError, downloadCalendar, previewCalendar } from '../api';
import {
  INCLUDE_ALL, INCLUDE_LABELS, KIND_LABELS, LENGTHS, MAX_REMINDERS, TIMING_KEY, cookProblem, eventSubject, eventWhen,
  eventsByDay, eventsHead, exportErrorText, exportProblem, exportRequest, googleLabel, googleLink, includeCounts,
  includeProblem, kindProblem, lengthText, readTimingForm, reminderChoices, reminderLabel, remindersText, timingFrom,
  timingSummary,
} from '../calendar';
import type { CookTiming, KindTiming, ReminderChoice, TimingForm } from '../calendar';
import { eventsSignature, exportState } from '../mealplan/exported';
import type { ExportMark } from '../mealplan/exported';
import type { PictureSource } from '../mealplan/images';
import { SLOTS, SLOT_LABELS } from '../mealplan/model';
import type {
  ApprovedSchedule, CalendarEvent, CalendarInclude, CalendarPreview, CalendarTiming, MealSlot,
} from '../types';
import { GoogleSyncButton, GoogleSyncNote, GoogleSyncPanel, useGoogleSync } from './CalendarSyncPanel';
import { FormCard, Switch, ToggleChip } from './fields';
import { Icon } from './icons';
import type { IconName } from './icons';
import { ProductPicture, RecipePicture } from './pictures';
import { Tag } from './ui';

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

export interface TimingState {
  form: TimingForm;
  setForm: (f: TimingForm) => void;
  timing: CalendarTiming;
  zone: string;
}

// slots: the meal slots the plan has, the ones cooking gets a time for.
export function useTiming(slots: readonly MealSlot[]): TimingState {
  const [form, setFormState] = useState(readSaved);
  const [zone] = useState(browserZone);
  const slotKey = slots.join('|');
  const timing = useMemo(() => timingFrom(form, zone, slotKey.split('|') as MealSlot[]), [form, zone, slotKey]);
  const setForm = (f: TimingForm) => {
    setFormState(f);
    save(f);
  };
  return { form, setForm, timing, zone };
}

function Reminders({ labelledBy, choices, remind, onChange }: {
  labelledBy: string;
  choices: readonly ReminderChoice[];
  remind: ReminderChoice[];
  onChange: (r: ReminderChoice[]) => void;
}) {
  const full = remind.filter((c) => choices.includes(c)).length >= MAX_REMINDERS;
  return (
    <>
      <p id={labelledBy} className="label fc-sub">Remind me</p>
      <div className="chips" role="group" aria-labelledby={labelledBy}>
        {choices.map((c) => {
          const on = remind.includes(c);
          return (
            <ToggleChip key={String(c)} checked={on} disabled={!on && full}
                        onChange={() => onChange(on ? remind.filter((x) => x !== c) : [...remind, c])}>
              {reminderLabel(c)}
            </ToggleChip>
          );
        })}
      </div>
      {full && <p className="muted fc-note">At most {MAX_REMINDERS}: take one off to choose another.</p>}
    </>
  );
}

function LengthField({ minutes, onChange }: { minutes: number; onChange: (n: number) => void }) {
  return (
    <label className="fc-field">
      <span className="fc-label">For</span>
      <select value={minutes} onChange={(e) => onChange(Number(e.target.value))}>
        {LENGTHS.map((n) => <option key={n} value={n}>{lengthText(n)}</option>)}
      </select>
    </label>
  );
}

function KindSettings({ k, onChange }: { k: KindTiming; onChange: (k: KindTiming) => void }) {
  const head = useId();
  const rem = useId();
  const why = useId();
  const problem = kindProblem(k);
  return (
    <FormCard icon="cart" title="Shopping trips" help="When you go, and when you hear about it." headId={head}>
      <Switch checked={k.timed} onChange={(timed) => onChange({ ...k, timed })} hint="Otherwise all day">
        At a set time
      </Switch>
      {k.timed && (
        <div className="fc-row">
          <label className="fc-field">
            <span className="fc-label">From</span>
            <input type="time" value={k.start} step={900} aria-invalid={problem ? true : undefined}
                   aria-describedby={problem ? why : undefined}
                   onChange={(e) => onChange({ ...k, start: e.target.value })} />
          </label>
          <LengthField minutes={k.minutes} onChange={(minutes) => onChange({ ...k, minutes })} />
        </div>
      )}
      {problem && <p id={why} className="fc-note fc-problem"><Icon name="alert" size={14} />Sent as all day until it is {problem}.</p>}
      <Reminders labelledBy={rem} choices={reminderChoices(k.timed)} remind={k.remind}
                 onChange={(remind) => onChange({ ...k, remind })} />
    </FormCard>
  );
}

// Cooking: a start for each meal slot the plan has, and one length. Its reminders are minutes
// before each start, the same for every slot.
function CookSettings({ c, slots, onChange }: { c: CookTiming; slots: readonly MealSlot[];
  onChange: (c: CookTiming) => void }) {
  const head = useId();
  const rem = useId();
  const why = useId();
  const problem = cookProblem(c, slots);
  const setSlot = (sl: MealSlot, t: string) => {
    const bySlot = { ...c.bySlot, [sl]: t };
    onChange({ ...c, bySlot, start: bySlot.dinner });
  };
  return (
    <FormCard icon="utensils" title="Cooking" help="A start for each meal; the same reminders for all." headId={head}>
      <Switch checked={c.timed} onChange={(timed) => onChange({ ...c, timed })} hint="Otherwise all day">
        At a set time for each meal
      </Switch>
      {c.timed && (
        <div className="fc-row fc-times">
          {SLOTS.filter((sl) => slots.includes(sl)).map((sl) => (
            <label key={sl} className="fc-field">
              <span className="fc-label">{SLOT_LABELS[sl]}</span>
              <input type="time" value={c.bySlot[sl]} step={900}
                     aria-invalid={problem ? true : undefined} aria-describedby={problem ? why : undefined}
                     onChange={(e) => setSlot(sl, e.target.value)} />
            </label>
          ))}
          <LengthField minutes={c.minutes} onChange={(minutes) => onChange({ ...c, minutes })} />
        </div>
      )}
      {problem && <p id={why} className="fc-note fc-problem"><Icon name="alert" size={14} />Sent as all day until it is {problem}.</p>}
      <Reminders labelledBy={rem} choices={reminderChoices(c.timed, true)} remind={c.remind}
                 onChange={(remind) => onChange({ ...c, remind })} />
    </FormCard>
  );
}

function ThawSettings({ form, onChange }: { form: TimingForm; onChange: (f: TimingForm) => void }) {
  const head = useId();
  const rem = useId();
  return (
    <FormCard icon="bell" title="Freeze and thaw" help="All-day events on the day to freeze or start thawing."
              headId={head}>
      <Reminders labelledBy={rem} choices={reminderChoices(false)} remind={form.reminders.remind}
                 onChange={(remind) => onChange({ ...form, reminders: { remind } })} />
    </FormCard>
  );
}

// The three kinds of timing as one card that stays closed until wanted: its heading says what the
// times and reminders are now.
export function TimingSettings({ form, onChange, zone, slots }: { form: TimingForm; onChange: (f: TimingForm) => void;
  zone: string; slots: readonly MealSlot[] }) {
  return (
    <details className="card cal-timing">
      <summary>
        <Icon name="clock" size={20} />
        <span className="cal-timing-what">
          <span className="cal-timing-title">Timing</span>
          <span className="cal-timing-now">{timingSummary(form, slots)}</span>
        </span>
        <Icon name="chevron-down" size={18} className="cal-timing-chev" />
      </summary>
      <div className="cal-timing-body">
        <div className="fc-grid">
          <KindSettings k={form.trips} onChange={(trips) => onChange({ ...form, trips })} />
          <CookSettings c={form.cooks} slots={slots} onChange={(cooks) => onChange({ ...form, cooks })} />
          <ThawSettings form={form} onChange={onChange} />
        </div>
        <p className="muted mp-timing-zone"><Icon name="clock" size={14} /> Times are in your time zone, {zone}.</p>
      </div>
    </details>
  );
}

// ─── The events ──────────────────────────────────────────────

const KIND_ICON: Record<CalendarEvent['kind'], IconName> = { trip: 'store', cook: 'pan', freeze: 'snowflake', thaw: 'droplet' };

// An event's picture: its recipe's or its product's, by way of the hub, with the meal's icon or a
// placeholder where there is none; a trip's is its kind's icon on a soft tile.
function EventPicture({ e, schedule, pictures }: { e: CalendarEvent; schedule: ApprovedSchedule | null;
  pictures: ReadonlyMap<string, PictureSource | null> }) {
  const s = eventSubject(e, schedule);
  if (s?.kind === 'recipe') return <RecipePicture pic={pictures.get(s.key) ?? null} slot={s.slot} size="head" />;
  if (s?.kind === 'product') return <ProductPicture product={s.name} ingredient={s.name} />;
  return <span className={`cal-pic cal-pic-${e.kind}`}><Icon name={KIND_ICON[e.kind]} size={22} /></span>;
}

// The labels every event of a kind carries, said once over the list ("Cook: demo amounts"); an
// event shows only the labels that set it apart from its kind.
function sharedLabels(events: readonly CalendarEvent[]): Map<CalendarEvent['kind'], string[]> {
  const out = new Map<CalendarEvent['kind'], string[]>();
  for (const e of events) {
    const now = out.get(e.kind);
    out.set(e.kind, now ? now.filter((l) => e.labels.includes(l)) : [...e.labels]);
  }
  return out;
}

function EventRow({ e, schedule, pictures, shared }: { e: CalendarEvent; schedule: ApprovedSchedule | null;
  pictures: ReadonlyMap<string, PictureSource | null>; shared: readonly string[] }) {
  const href = googleLink(e);
  const reminders = remindersText(e);
  const own = e.labels.filter((l) => !shared.includes(l));
  return (
    <li className={`card-row cal-event cal-${e.kind}`}>
      <EventPicture e={e} schedule={schedule} pictures={pictures} />
      <div className="cal-event-main">
        <div className="cal-event-head">
          <span className="cal-kind">{KIND_LABELS[e.kind]}</span>
          <span className="cal-when">{eventWhen(e)}</span>
        </div>
        <strong className="cal-title">{e.title}</strong>
        {e.location && <div className="cal-event-line">{e.location}</div>}
        {reminders && <div className="cal-event-line">{reminders}</div>}
        {own.length > 0 && <div className="cal-event-line">{own.join(' · ')}</div>}
        <div className="cal-event-more">
          <details className="cal-details">
            <summary>What the event says</summary>
            <pre className="cal-desc">{e.description}</pre>
          </details>
          {href && (
            <a className="cal-google" href={href} target="_blank" rel="noopener noreferrer" aria-label={googleLabel(e)}>
              Add to Google Calendar<Icon name="external" size={14} />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

// ─── The stage ───────────────────────────────────────────────

export function CalendarExport({ schedule, current, timing, slots, pictures, exported, onExported }: {
  // the latest answer's approved_schedule, posted back unchanged
  schedule: ApprovedSchedule | null;
  // false while the plan is being checked again: the schedule may be about to change
  current: boolean;
  timing: TimingState;
  // the meal slots the plan has (cooking gets a time for each)
  slots: readonly MealSlot[];
  // each recipe's picture, for its cook events
  pictures: ReadonlyMap<string, PictureSource | null>;
  // when this plan's events last went to a calendar, if they have (mealplan/exported.ts)
  exported: ExportMark | null;
  onExported: (m: Omit<ExportMark, 'id' | 'at'>) => void;
}) {
  const [include, setInclude] = useState<CalendarInclude[]>([...INCLUDE_ALL]);
  const [preview, setPreview] = useState<Preview>({ status: 'idle', data: null, error: null });
  const [saved, setSaved] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const headId = useId();
  const kindsHead = useId();
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
    previewCalendar(exportRequest(schedule, include, timing.timing), ctl.signal)
      .then((data) => setPreview({ status: 'ok', data, error: null }))
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return;
        setPreview({ status: 'error', data: null, error: errorText(err) });
      });
    return () => ctl.abort();
  }, [schedule, include, problem, current, timing.timing]);

  const data = preview.data;
  const ready = preview.status === 'ok' && current && !problem;
  // what this plan's events are now, for marking them as gone to a calendar
  const mark = (how: ExportMark['how']) => {
    if (schedule && data) onExported({ sig: eventsSignature(schedule), events: data.events.length, how });
  };
  const sync = useGoogleSync({ open: true, schedule, include, timing: timing.timing, ready, onSynced: () => mark('google') });
  const googleFirst = sync.state === 'connected';
  const sent = exportState(exported, schedule);

  const toggle = (k: CalendarInclude) =>
    setInclude((now) => (now.includes(k) ? now.filter((x) => x !== k) : [...now, k]));

  const download = async () => {
    if (!schedule || !ready || downloading) return;
    setDownloading(true);
    setSaved(null);
    setDownloadError(null);
    try {
      const file = await downloadCalendar(exportRequest(schedule, include, timing.timing));
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaved(`Saved ${file.filename}. Open it with your calendar app to add the events.`);
      mark('file');
    } catch (err) {
      setDownloadError(`Not downloaded: ${errorText(err)}`);
    } finally {
      setDownloading(false);
    }
  };

  const counts = schedule ? includeCounts(schedule) : null;
  const shared = useMemo(() => sharedLabels(data?.events ?? []), [data]);
  const head = problem ?? (!current ? 'Checking the plan…'
    : preview.status === 'error' ? 'The events could not be built'
      : data ? eventsHead(data) : 'Building the events…');
  const how = exported?.how === 'google' ? 'synced them to Google Calendar' : 'downloaded them';

  return (
    <div>
      <section className="card cal-card" aria-labelledby={headId}>
        <div className="cal-card-top">
          <span className="fc-icon" aria-hidden="true"><Icon name="calendar" /></span>
          <div className="cal-card-what">
            {/* its words are a live region: the count of events, or why there are none, as it changes */}
            <h3 id={headId} className="cal-card-title"><span role="status">{head}</span></h3>
            <p className="cal-card-help">
              {data?.all_day && 'All day, as Timing has them. '}A file for any calendar app, or one link per event: no
              account needed.
            </p>
          </div>
          {sent === 'current' && <Tag kind="done">{exported?.how === 'google' ? 'In Google Calendar' : 'Downloaded'}</Tag>}
          {sent === 'changed' && <Tag kind="changed" />}
        </div>
        {preview.status === 'error' && <p className="fc-problem cal-status" role="alert"><Icon name="alert" size={14} />{preview.error}</p>}

        <p id={kindsHead} className="label fc-sub">Add to the calendar</p>
        <div className="chips" role="group" aria-labelledby={kindsHead}>
          {INCLUDE_ALL.map((k) => (
            <ToggleChip key={k} checked={include.includes(k)} onChange={() => toggle(k)}>
              {INCLUDE_LABELS[k]}{counts && <span className="tchip-n">{counts[k]}</span>}
            </ToggleChip>
          ))}
        </div>

        <div className="cal-actions">
          <button type="button" className={`btn ${googleFirst ? 'btn-secondary' : 'btn-primary'}`}
                  aria-disabled={!ready || downloading || undefined} aria-describedby={headId} onClick={() => void download()}>
            <Icon name="download" size={18} />{downloading ? 'Downloading…' : 'Download calendar file'}
          </button>
          <GoogleSyncButton sync={sync} primary={googleFirst} />
        </div>
        <p className="cal-saved" role="status">
          {downloadError ? <span className="fc-problem"><Icon name="alert" size={14} />{downloadError}</span> : saved}
        </p>
        {sent === 'current' && !saved && (
          <p className="cal-done"><Icon name="circle-check" size={16} />Done: you {how}. Do it again after the plan changes.</p>
        )}
        {sent === 'changed' && (
          <p className="cal-changed">
            <Icon name="refresh" size={16} />The events have changed since you {how}: add them again to bring your calendar up to date.
          </p>
        )}
        <GoogleSyncNote sync={sync} />
      </section>

      <GoogleSyncPanel sync={sync} />

      <TimingSettings form={timing.form} onChange={timing.setForm} zone={timing.zone} slots={slots} />

      {data && (
        <section className="cal-preview" aria-labelledby={`${headId}-events`} aria-busy={preview.status === 'loading'}>
          <h3 id={`${headId}-events`} className="cal-head">The events</h3>
          {data.events.length === 0 && <p className="muted">No events of the kinds chosen.</p>}
          {shared.size > 0 && [...shared.values()].some((l) => l.length) && (
            <p className="cal-caveats">
              <Icon name="info" size={14} />
              <span>
                {[...shared.entries()].filter(([, l]) => l.length)
                  .map(([k, l]) => `${KIND_LABELS[k]}: ${l.join(', ')}`).join(' · ')}
              </span>
            </p>
          )}
          <ol className="cal-days">
            {eventsByDay(data).map((d) => (
              <li key={d.date} className="cal-day">
                <h4 className="cal-day-head">{d.label}</h4>
                <ul className="cal-events">
                  {d.events.map((e) => <EventRow key={e.uid} e={e} schedule={schedule} pictures={pictures}
                                                 shared={shared.get(e.kind) ?? []} />)}
                </ul>
              </li>
            ))}
          </ol>
          <h3 className="cal-head">Importing</h3>
          <ul className="cal-notes">
            {data.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
