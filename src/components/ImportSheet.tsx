// "Import a recipe": a recipe page, a YouTube video or a paste, read into ingredient lines the
// shopper reviews before anything is planned. The local demo hub reads links (pantry-api never
// fetches a URL); a paste goes to pantry's parse-lines, which every deployment has, so where
// there is no hub only Paste is offered. Every line shows its verbatim text, the amount read
// from it ("amount not stated" when there is none) and where that amount came from; a line
// Gemini transcribed from a video links to the second it was said and must be ticked before
// the recipe can be planned, saved or added. What the shopper reviews is exactly what gets
// planned: "Plan this now" sends the reviewed doc itself (into the chat when the hub is there,
// otherwise to /plan/spec), never text to be read again.
//
// Also here: ImportCard, the chat's card for the hub's recipe_import event, which opens this
// sheet on the doc it shows.
import { createContext, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { PlanAbortError, parseLines, planSpec } from '../api';
import type { SpecOptions } from '../api';
import { HubError, getStatus, importRecipe, importVideo } from '../hub';
import {
  addToMealPlan, amountText, basisBadge, confirmAll, dailyText, docFromParsed, durationText,
  estimateSeconds, evidenceHref, finished, fitsDaily, hasTranscribed, importError,
  importSupport, pasteLines, pastedFromVideo, readyProblem, removeLine, retitle, saveRecipe,
  setConfirmed, sourceText, unconfirmedLines, usageText, withServings,
} from '../recipes';
import type { ImportSupport, StorageLike } from '../recipes';
import type {
  ImportResult, ImportVideo, PlanExecution, RecipeDoc, RecipeImportEvent, ShoppingPlan,
} from '../types';
import { AbortAlert, PlanView } from './plan';
import { Sheet } from './Sheet';

export type ImportTab = 'link' | 'youtube' | 'paste';

// How the sheet opens: on a tab, with a link typed in, or on an import the chat already read.
export interface ImportStart {
  tab?: ImportTab;
  url?: string;
  result?: ImportResult;
}

// The chat's way to open the sheet from a card (ChatItem is memoised and takes only its item).
export const ImportActions = createContext<((start: ImportStart) => void) | null>(null);

const TAB_LABEL: Record<ImportTab, string> = { link: 'Link', youtube: 'YouTube', paste: 'Paste' };

function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// A saved recipe's id. randomUUID exists only on secure pages (https, localhost); the hub can be
// opened over plain http on a LAN address, where the random bytes are taken directly.
function newId(): string {
  if (typeof crypto.randomUUID === 'function' && window.isSecureContext) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),
    (b) => b.toString(16).padStart(2, '0')).join('');
}

// Only http(s) links are drawn as links: a doc's URL came from a page or the shopper.
const safeHref = (url: string | null | undefined) =>
  (url && /^https?:\/\//i.test(url) ? url : undefined);

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

function Badge({ text, tone }: { text: string; tone: 'ok' | 'warn' | 'muted' }) {
  return <span className={`chip chip-${tone} import-badge`}>{text}</span>;
}

// The review table: every line as written, the amount read from it, what will be bought, where
// the amount came from and, for a video, when it was said. `edit` adds the ticks and Remove.
export function LinesTable({ doc, edit }: {
  doc: RecipeDoc;
  edit?: { confirm: (lineNo: number, on: boolean) => void; remove: (lineNo: number) => void };
}) {
  const transcribed = hasTranscribed(doc);
  const anyEvidence = doc.lines.some((l) => l.evidence?.at || l.evidence?.quote);
  const body = useRef<HTMLTableSectionElement>(null);
  // Remove takes its own button away, so focus moves to the Remove of the line that took its
  // place (or the new last line), rather than falling back to the top of the page.
  const removeAt = (lineNo: number, index: number) => {
    edit?.remove(lineNo);
    window.requestAnimationFrame(() => {
      const left = body.current?.querySelectorAll<HTMLButtonElement>('button.import-remove');
      if (left?.length) left[Math.min(index, left.length - 1)].focus();
    });
  };
  return (
    <div className="table-wrap import-table-wrap">
      <table className="import-table">
        <caption className="sr-only">Ingredient lines of {doc.title}</caption>
        <thead>
          <tr>
            {edit && transcribed && <th scope="col">Checked</th>}
            <th scope="col" className="num">#</th>
            <th scope="col">As written</th>
            <th scope="col">Amount</th>
            <th scope="col">Buy</th>
            <th scope="col">Amount from</th>
            {anyEvidence && <th scope="col">Where</th>}
            {edit && <th scope="col"><span className="sr-only">Remove</span></th>}
          </tr>
        </thead>
        <tbody ref={body}>
          {doc.lines.map((l, index) => {
            const badge = basisBadge(l);
            const href = evidenceHref(doc.source.url, l.evidence?.at);
            const quote = l.evidence?.quote && l.evidence.quote !== l.text ? l.evidence.quote : '';
            return (
              <tr key={l.line_no} className={l.confirmed ? undefined : 'import-row-unchecked'}>
                {edit && transcribed && (
                  <td>
                    <input type="checkbox" checked={l.confirmed}
                           aria-label={`Line ${l.line_no}, ${l.name}: checked against the video`}
                           onChange={(e) => edit.confirm(l.line_no, e.target.checked)} />
                  </td>
                )}
                <td className="num">{l.line_no}</td>
                <td className="import-verbatim">{l.text}</td>
                <td className={l.quantity == null ? 'import-unstated' : 'import-amount'}>{amountText(l)}</td>
                <td>
                  {l.name}
                  {l.note && <div className="muted">{l.note}</div>}
                </td>
                <td><Badge {...badge} /></td>
                {anyEvidence && (
                  <td>
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer"
                         aria-label={`Line ${l.line_no} at ${l.evidence?.at} in the video (opens YouTube)`}>
                        {l.evidence?.at}
                      </a>
                    ) : l.evidence?.at}
                    {quote && <div className="muted import-quote">“{quote}”</div>}
                  </td>
                )}
                {edit && (
                  <td>
                    <button type="button" className="secondary mini import-remove"
                            aria-label={`Remove line ${l.line_no}, ${l.name}`}
                            onClick={() => removeAt(l.line_no, index)}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// A YouTube video the hub looked at: what it read, and, when no lines came of it, the ways on.
function VideoPanel({ video, result, hasDoc, support, busy, onReadLink, onPaste, onTranscribe }: {
  video: ImportVideo;
  result: ImportResult;
  hasDoc: boolean;
  support: ImportSupport | null;
  busy: boolean;
  onReadLink: (url: string) => void;
  onPaste: () => void;
  onTranscribe: (durationS: number | null) => void;
}) {
  const [minutes, setMinutes] = useState('');
  const reasonId = useId();
  const transcribe = support?.video.enabled ? support.video : video.transcribe;
  const daily = video.daily ?? transcribe.daily;
  const length = video.duration_s ?? estimateSeconds(minutes);
  const fits = fitsDaily(daily, length);
  const why = !transcribe.enabled ? transcribe.reason
    : length == null ? 'Say about how long the video is first.'
      : fits === false ? "This video would go past today's video allowance." : '';
  return (
    <section className="import-video" aria-label="The video">
      <p className="import-video-title">
        <a href={safeHref(video.url)} target="_blank" rel="noreferrer">{video.title || 'YouTube video'}</a>
        {video.channel && <span className="muted"> by {video.channel}</span>}
        {video.duration_s != null && <span className="muted"> · {durationText(video.duration_s)}</span>}
      </p>
      <p className="muted">
        {/* without lines, the hub's own warnings below say why the description was not read */}
        {video.description_read ? "The hub read the video's description. "
          : hasDoc ? "The video's description was not read. " : ''}
        The watch page, captions and transcript are never read.
      </p>
      {!hasDoc && result.warnings.length > 0 && (
        <ul className="import-notes">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      {result.linked_pages.length > 0 && (
        <div className="import-ways">
          <h4>{hasDoc ? 'The creator also links' : 'Read the recipe page linked by the creator'}</h4>
          <ul className="import-links">
            {result.linked_pages.map((p) => (
              <li key={p.url}>
                <button type="button" className="secondary" disabled={busy} onClick={() => onReadLink(p.url)}>
                  Read {p.site || hostOf(p.url)}
                </button>
                <span className="muted import-link-url">{p.url}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!hasDoc && (
        <>
          <div className="import-ways">
            <h4>Paste the ingredient list</h4>
            <p className="muted">From the description or the video, one ingredient per line.</p>
            <button type="button" className="secondary" onClick={onPaste}>Paste the list</button>
          </div>
          <div className="import-ways">
            <h4>Have Gemini watch the video</h4>
            <p className="muted">
              Google's Gemini watches this public video and lists the ingredients it hears or
              sees, each with the time it appears. You check every line against the video before
              anything is planned. Only when you click.
            </p>
            {transcribe.enabled && video.duration_s == null && (
              <label className="import-field">
                About how many minutes long is the video?
                <input type="number" min={1} max={720} step={1} inputMode="numeric" value={minutes}
                       onChange={(e) => setMinutes(e.target.value)} />
              </label>
            )}
            {transcribe.enabled && daily && <p className="muted">{dailyText(daily)}</p>}
            <button type="button" disabled={busy || !!why} aria-describedby={why ? reasonId : undefined}
                    onClick={() => onTranscribe(length)}>
              Transcribe with Gemini{length != null && transcribe.enabled ? ` (${durationText(length)} of video)` : ''}
            </button>
            {why && <p id={reasonId} className="hint">{why}</p>}
          </div>
        </>
      )}
      {result.usage && <p className="muted">{usageText(result.usage)}</p>}
    </section>
  );
}

// "How many does this recipe serve?" when the source does not say. The field keeps what is
// typed; the doc takes only a whole 1..100, labelled as the shopper's.
function ServingsField({ doc, onChange }: { doc: RecipeDoc; onChange: (doc: RecipeDoc) => void }) {
  const [text, setText] = useState(doc.servings != null ? String(doc.servings) : '');
  const hintId = useId();
  return (
    <label className="import-field import-servings">
      How many does this recipe serve? The source does not say.
      <input type="number" min={1} max={100} step={1} inputMode="numeric" value={text}
             aria-describedby={hintId}
             onChange={(e) => {
               setText(e.target.value);
               onChange(withServings(doc, e.target.value.trim() === '' ? null : Number(e.target.value)));
             }} />
      <span id={hintId} className="muted">
        {doc.servings != null ? `Serves ${doc.servings}: your answer, labelled as yours.`
          : text.trim() ? 'A whole number from 1 to 100.'
            : 'Until you answer, the plan says servings are not stated.'}
      </span>
    </label>
  );
}

export function ImportSheet({ open, onClose, start, planInChat, chatBlocked, onPlanned, planOptions }: {
  open: boolean;
  onClose: () => void;
  // a new start replaces what the sheet holds; without one, the last review is kept
  start?: ImportStart | null;
  // In the Assistant: "Plan this now" sends the reviewed doc into the chat (ChatBody.recipe_doc).
  planInChat?: ((doc: RecipeDoc) => void) | null;
  // why the chat cannot take a recipe now (an answer is streaming)
  chatBlocked?: string | null;
  // Without the chat: /plan/spec's plan goes to the owner, or is shown in the sheet.
  onPlanned?: (plan: ShoppingPlan) => void;
  planOptions?: SpecOptions;
}) {
  const [support, setSupport] = useState<ImportSupport | null>(null);
  const [tab, setTab] = useState<ImportTab | null>(null);
  const [url, setUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteYield, setPasteYield] = useState('');
  const [pasteText, setPasteText] = useState('');
  // a list pasted from a video keeps the video as its link back
  const [pasteVideo, setPasteVideo] = useState<ImportVideo | null>(null);
  const [busy, setBusy] = useState<'read' | 'video' | 'plan' | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [doc, setDoc] = useState<RecipeDoc | null>(null);
  // bumped whenever a different doc arrives, so fields holding their own text start again
  const [gen, setGen] = useState(0);
  const [notice, setNotice] = useState('');
  const [plan, setPlan] = useState<ShoppingPlan | null>(null);
  const [aborted, setAborted] = useState<PlanExecution | null>(null);
  // answers to a request the shopper has since replaced are dropped
  const asked = useRef(0);
  const tabIds = useId();
  const pasteBox = useRef<HTMLTextAreaElement>(null);
  const readyId = useId();

  useEffect(() => {
    if (!open) return;
    if (start && (start.result || start.url || start.tab)) {
      asked.current += 1;
      setBusy(null);
      setError('');
      setNotice('');
      setPlan(null);
      setAborted(null);
      setResult(start.result ?? null);
      setDoc(start.result?.doc ?? null);
      setGen((g) => g + 1);
      // a new import starts a new paste too
      setPasteVideo(null);
      setPasteTitle('');
      setPasteYield('');
      setPasteText('');
      const t = start.tab ?? (start.result?.video ? 'youtube' : start.url ? 'link' : null);
      setTab(t);
      if (start.url && t === 'youtube') setVideoUrl(start.url);
      else if (start.url) setUrl(start.url);
    }
    let live = true;
    getStatus().then((s) => { if (live) setSupport(importSupport(s)); })
      .catch(() => { if (live) setSupport(importSupport(null)); });
    return () => { live = false; };
  }, [open, start]);

  const tabs: ImportTab[] = support?.links ? ['link', 'youtube', 'paste'] : ['paste'];
  const shown: ImportTab = tab && tabs.includes(tab) ? tab : tabs[0];

  const fail = (e: unknown, fallback: string) => {
    if (e instanceof HubError) setError(importError(e.detail, e.message || fallback).text);
    else setError((e as Error).message || fallback);
  };

  const take = (r: ImportResult) => {
    setResult(r);
    setDoc(r.doc);
    setGen((g) => g + 1);
    setNotice('');
    setPlan(null);
    setAborted(null);
  };

  // A new read replaces what the sheet shows, so a refusal is never drawn over the last
  // recipe's lines, which could pass for the new page's.
  const clear = (keepVideo: boolean) => {
    if (!keepVideo) setResult(null);
    setDoc(null);
    setNotice('');
    setPlan(null);
    setAborted(null);
  };

  const read = async (link: string) => {
    if (!link.trim()) return;
    const n = ++asked.current;
    setBusy('read');
    setError('');
    clear(false);
    try {
      const r = await importRecipe(link.trim());
      if (n === asked.current) take(r);
    } catch (e) {
      if (n === asked.current) fail(e, 'The hub could not read the link.');
    } finally {
      if (n === asked.current) setBusy(null);
    }
  };

  const transcribe = async (durationS: number | null) => {
    const video = result?.video;
    if (!video) return;
    const n = ++asked.current;
    setBusy('video');
    setError('');
    clear(true);
    try {
      const r = await importVideo({ video_id: video.id, duration_s: durationS });
      if (n === asked.current) take(r);
    } catch (e) {
      if (n === asked.current) fail(e, 'Gemini could not transcribe the video.');
    } finally {
      if (n === asked.current) setBusy(null);
    }
  };

  const readPaste = async () => {
    const { lines, problem } = pasteLines(pasteText);
    if (problem) {
      setError(problem);
      return;
    }
    const n = ++asked.current;
    setBusy('read');
    setError('');
    clear(true);
    try {
      const parsed = await parseLines({ title: pasteTitle.trim() || null,
                                        yield_text: pasteYield.trim() || null, lines, origin: 'paste' });
      if (n !== asked.current) return;
      setDoc(docFromParsed(parsed, { title: pasteTitle, yield_text: pasteYield,
                                     source: pasteVideo ? pastedFromVideo(pasteVideo) : undefined }));
      setGen((g) => g + 1);
      setNotice('');
      setPlan(null);
      setAborted(null);
    } catch (e) {
      if (n === asked.current) fail(e, 'pantry could not read the lines.');
    } finally {
      if (n === asked.current) setBusy(null);
    }
  };

  const pasteFromVideo = () => {
    const video = result?.video;
    if (!video) return;
    setPasteVideo(video);
    setPasteTitle(video.title.slice(0, 200));
    setTab('paste');
    // after the tab's panel is drawn
    window.setTimeout(() => pasteBox.current?.focus(), 0);
  };

  const problem = doc ? readyProblem(doc) : null;

  const planNow = async () => {
    if (!doc || problem) return;
    const reviewed = finished(doc);
    if (support?.chatDocs && planInChat) {
      if (chatBlocked) return;
      planInChat(reviewed);
      onClose();
      return;
    }
    const n = ++asked.current;
    setBusy('plan');
    setError('');
    setPlan(null);
    setAborted(null);
    try {
      const p = await planSpec(reviewed, planOptions);
      if (n !== asked.current) return;
      if (onPlanned) {
        onPlanned(p);
        onClose();
      } else setPlan(p);
    } catch (e) {
      if (n !== asked.current) return;
      if (e instanceof PlanAbortError) setAborted(e.execution);
      else setError(`Planning failed: ${(e as Error).message}`);
    } finally {
      if (n === asked.current) setBusy(null);
    }
  };

  const save = () => {
    if (!doc) return;
    const r = saveRecipe(browserStorage(), doc, newId());
    if (!r.ok) {
      setNotice(r.problem);
      return;
    }
    setDoc({ ...doc, key: r.key });
    setNotice(r.replaced ? `Updated "${doc.title.trim()}" in My recipes, in this browser.`
      : `Saved "${doc.title.trim()}" to My recipes, in this browser.`);
  };

  const addToPlan = () => {
    if (!doc) return;
    const r = addToMealPlan(browserStorage(), doc, newId(), new Date().toISOString());
    if (!r.ok) {
      setNotice(r.problem);
      return;
    }
    setDoc({ ...doc, key: r.key });
    setNotice(r.already ? `"${doc.title.trim()}" is already waiting for the meal plan.`
      : `Saved to My recipes and added to the meal plan: "${doc.title.trim()}" waits for the `
        + "meal plan's tray, in this browser.");
  };

  // the tab list's arrow keys (one tab stop for the list, as the ARIA tabs pattern has it)
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = tabs.indexOf(shown);
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length]
      : e.key === 'ArrowLeft' ? tabs[(i + tabs.length - 1) % tabs.length]
        : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    document.getElementById(`${tabIds}-tab-${next}`)?.focus();
  };

  const inChat = !!(support?.chatDocs && planInChat);
  // until /hub/status answers it is not known whether the chat can take the doc
  const planBlocked = problem ?? (planInChat && support === null ? 'Checking whether the chat can '
    + 'take the recipe…' : inChat ? chatBlocked ?? null : null);

  let panel: ReactNode;
  if (shown === 'link') {
    panel = (
      <form className="import-form" onSubmit={(e) => { e.preventDefault(); void read(url); }}>
        <label className="import-field">
          Recipe page
          <input type="url" required value={url} placeholder="https://…" inputMode="url"
                 onChange={(e) => setUrl(e.target.value)} />
        </label>
        <p className="muted">
          The demo hub on this machine reads the page's schema.org recipe (JSON-LD or microdata):
          its ingredient lines and a link back, never the method.
        </p>
        <button disabled={busy !== null || !url.trim()}>{busy === 'read' ? 'Reading…' : 'Read recipe'}</button>
      </form>
    );
  } else if (shown === 'youtube') {
    panel = (
      <form className="import-form" onSubmit={(e) => { e.preventDefault(); void read(videoUrl); }}>
        <label className="import-field">
          YouTube link
          <input type="url" required value={videoUrl} placeholder="https://www.youtube.com/watch?v=…"
                 inputMode="url" onChange={(e) => setVideoUrl(e.target.value)} />
        </label>
        <p className="muted">
          {support?.youtubeDescription
            ? "The hub reads the title, the channel and the description's ingredient list."
            : 'The hub reads the title and channel. It has no YouTube key, so it cannot read the '
              + 'description; you can read a page the creator links or paste the list.'}
        </p>
        <button disabled={busy !== null || !videoUrl.trim()}>{busy === 'read' ? 'Reading…' : 'Read video'}</button>
      </form>
    );
  } else {
    panel = (
      <form className="import-form" onSubmit={(e) => { e.preventDefault(); void readPaste(); }}>
        {pasteVideo && (
          <p className="muted">
            Pasting the list for <strong>{pasteVideo.title}</strong>; the recipe links back to the video.
          </p>
        )}
        <div className="form-row">
          <label className="grow">
            Recipe name
            <input value={pasteTitle} maxLength={200} onChange={(e) => setPasteTitle(e.target.value)}
                   placeholder="Red Lentil Dal" />
          </label>
          <label>
            Serves (as written)
            <input value={pasteYield} maxLength={200} onChange={(e) => setPasteYield(e.target.value)}
                   placeholder="Serves 4" />
          </label>
        </div>
        <label className="import-field">
          Ingredient lines, one per line
          <textarea ref={pasteBox} rows={8} value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                    placeholder={'400 g red lentils\n1 tbsp cumin seeds\n2 cloves garlic, minced'} />
        </label>
        <p className="muted">Read by pantry with no AI: each line's amount, unit and what to buy.</p>
        <button disabled={busy !== null || !pasteText.trim()}>{busy === 'read' ? 'Reading…' : 'Read lines'}</button>
      </form>
    );
  }

  const checked = doc ? doc.lines.length - unconfirmedLines(doc).length : 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      className="import-sheet"
      title="Import a recipe"
      description="Its ingredient lines, for you to review before anything is planned."
      footer={doc && (
        <>
          {planBlocked && <p id={readyId} className="import-ready">{planBlocked}</p>}
          <button type="button" className="secondary" disabled={!!problem || busy !== null}
                  aria-describedby={problem ? readyId : undefined} onClick={save}>
            Save to my recipes
          </button>
          <button type="button" className="secondary" disabled={!!problem || busy !== null}
                  aria-describedby={problem ? readyId : undefined} onClick={addToPlan}>
            Add to meal plan
          </button>
          <button type="button" disabled={!!planBlocked || busy !== null}
                  aria-describedby={planBlocked ? readyId : undefined} onClick={() => void planNow()}>
            {busy === 'plan' ? 'Planning…' : 'Plan this now'}
          </button>
        </>
      )}
    >
      {support === null && <p className="muted">Checking what this console can read…</p>}
      {support?.note && <p className="import-no-hub">{support.note}</p>}
      <div role="tablist" aria-label="Import from" className="import-tabs">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" id={`${tabIds}-tab-${t}`}
                  aria-selected={t === shown} aria-controls={`${tabIds}-panel`}
                  tabIndex={t === shown ? 0 : -1}
                  className={`import-tab${t === shown ? ' import-tab-active' : ''}`}
                  onClick={() => setTab(t)} onKeyDown={onTabKey}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabIds}-panel`} aria-labelledby={`${tabIds}-tab-${shown}`}
           className="import-panel">
        {panel}
      </div>

      {error && <div className="banner banner-error import-error" role="alert">{error}</div>}
      {busy === 'video' && (
        <p className="muted" role="status">Gemini is watching the video; this can take a minute or two…</p>
      )}

      {result?.video && (
        <VideoPanel video={result.video} result={result} hasDoc={!!doc} support={support}
                    busy={busy !== null} onReadLink={(u) => void read(u)} onPaste={pasteFromVideo}
                    onTranscribe={(s) => void transcribe(s)} />
      )}

      {doc && (
        <section className="import-review" aria-label="Review the ingredient lines">
          <h3>Review the ingredient lines</h3>
          <label className="import-field">
            Recipe name
            <input value={doc.title} maxLength={200} onChange={(e) => setDoc(retitle(doc, e.target.value))} />
          </label>
          <p className="import-source">
            {sourceText(doc.source)}
            {safeHref(doc.source.url) && (
              <> <a href={safeHref(doc.source.url)} target="_blank" rel="noreferrer">
                Open the {doc.source.kind === 'youtube' || /youtu/.test(doc.source.site ?? '') ? 'video' : 'page'}
              </a></>
            )}
          </p>
          {doc.servings_stated ? (
            <p className="import-servings">
              Serves {doc.servings}, as the source states
              {doc.yield_text && <span className="muted"> (“{doc.yield_text}”)</span>}.
            </p>
          ) : (
            <ServingsField key={gen} doc={doc} onChange={setDoc} />
          )}
          {hasTranscribed(doc) && (
            <div className="import-check">
              <label className="check">
                <input type="checkbox" checked={checked === doc.lines.length}
                       onChange={(e) => setDoc(e.target.checked ? confirmAll(doc)
                         : { ...doc, lines: doc.lines.map((l) => ({ ...l, confirmed: false })) })} />
                I checked these against the video
              </label>
              <span className="muted">{checked} of {doc.lines.length} lines checked</span>
            </div>
          )}
          <LinesTable doc={doc} edit={{
            confirm: (n, on) => setDoc(setConfirmed(doc, n, on)),
            remove: (n) => setDoc(removeLine(doc, n)),
          }} />
          {doc.warnings.length > 0 && (
            <ul className="import-notes" aria-label="Notes from reading the lines">
              {doc.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <p className="muted">
            {inChat ? '"Plan this now" gives the assistant these lines exactly as they are here.'
              : '"Plan this now" plans these lines exactly as they are here.'}
            {' '}Saved recipes stay in this browser only.
          </p>
          <p className="import-notice" role="status">{notice}</p>
        </section>
      )}

      {aborted && <AbortAlert execution={aborted} />}
      {plan && <div className="import-plan"><PlanView plan={plan} /></div>}
    </Sheet>
  );
}

// The chat's card for an import: the recipe the hub read (or the shopper reviewed), with the
// lines the assistant will plan, or why nothing was read and what the shopper can do instead.
export function ImportCard({ event, onOpen }: {
  event: RecipeImportEvent;
  onOpen: ((start: ImportStart) => void) | null;
}) {
  if (event.status === 'failed') {
    const youtube = !event.fallback;
    return (
      <div className="import-card import-card-failed">
        <p className="import-card-title">
          Could not read {event.url ? hostOf(event.url) : 'the link'}: {event.error.message}
        </p>
        <p className="muted">
          {event.fallback ? 'The assistant reads the page with its fetch tool instead.'
            : 'The video is not fetched. You can paste its ingredient list instead.'}
        </p>
        {youtube && onOpen && (
          <button type="button" className="secondary mini" onClick={() => onOpen({ tab: 'paste' })}>
            Import a recipe
          </button>
        )}
      </div>
    );
  }
  const { result } = event;
  const doc = result.doc;
  if (!doc) {
    const video = result.video;
    return (
      <div className="import-card">
        <p className="import-card-title">
          {video ? <>{video.title || 'A YouTube video'}{video.channel && <span className="muted"> by {video.channel}</span>}</>
            : 'The link'}: no ingredient lines were read.
        </p>
        {result.warnings.length > 0 && <p className="muted">{result.warnings.join(' ')}</p>}
        {onOpen && (
          <button type="button" className="secondary mini" onClick={() => onOpen({ result, tab: 'youtube', url: event.url ?? undefined })}>
            Choose how to read it
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="import-card">
      <p className="import-card-title">
        {event.via === 'console' ? 'Your reviewed recipe' : 'Recipe read'}: <strong>{doc.title}</strong>
        <span className="muted">
          {' '}· {doc.servings != null ? `serves ${doc.servings}${doc.servings_stated ? '' : ' (your answer)'}`
            : 'servings not stated'} · {doc.lines.length} {doc.lines.length === 1 ? 'line' : 'lines'}
        </span>
      </p>
      <p className="muted">
        {sourceText(doc.source)}
        {event.doc_key && <> The assistant plans these lines as they are (<code>{event.doc_key}</code>).</>}
      </p>
      <details className="import-card-lines">
        <summary>The {doc.lines.length} ingredient {doc.lines.length === 1 ? 'line' : 'lines'}</summary>
        <LinesTable doc={doc} />
      </details>
      {doc.warnings.length > 0 && <p className="muted">{doc.warnings.join('; ')}</p>}
      {onOpen && (
        <button type="button" className="secondary mini" onClick={() => onOpen({ result, url: event.url ?? undefined })}>
          Review, save or add to meal plan
        </button>
      )}
    </div>
  );
}
