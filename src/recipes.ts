// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Recipe import's logic: the words the review table shows, the edits the shopper makes before
// planning, and the shopper's saved recipes in this browser. What the shopper reviews is exactly
// what gets planned, so nothing here changes a line's name, amount or unit: a line can be ticked
// as checked or removed, and that is all. An amount the source does not state is said to be not
// stated, never shown as zero.
//
// Storage contract. Two browser keys, both JSON, every read and write wrapped (storage can be
// off, full, or throw in a private window):
//
//   pantry.recipes.v1          {v: 1, recipes: RecipeDoc[]}
//     The shopper's own recipes, each keyed 'my:<id>'. The meal plan's tray and Quick add read
//     the same key and shape (src/myRecipes.ts on the meal-plan branch). A doc is stored exactly
//     as reviewed: every line confirmed, so the meal plan sends it as it is and the server plans
//     its lines with no parse. Saving never drops what it cannot read: other entries are written
//     back untouched, and a value that is not this shape at all is not overwritten.
//
//   pantry.mealplan.inbox.v1   {v: 1, entries: [{key: 'my:<id>', title, added_at}]}
//     "Add to meal plan": recipes waiting for the meal plan's tray. The doc itself is saved in
//     pantry.recipes.v1 first; an entry only names it. The meal planner takes the entries
//     (takeInbox, which empties the list), adds each recipe to its tray with one meal unless it
//     is there already, and says so for an entry whose recipe is no longer saved. At most one
//     entry per key; added_at is an ISO time, for the order they were added.
import type {
  AmountBasis, HubStatus, ImportVideo, ParsedLines, RecipeDoc, RecipeLine, RecipeSource,
  VideoDaily, VideoTranscribe,
} from './types.ts';

export const MAX_LINES = 60;           // RecipeDoc's bound, and /recipes/parse-lines'
export const MAX_LINE_CHARS = 300;
export const MAX_SERVINGS = 100;
export const MAX_TITLE = 200;

// ─── what the review table says ──────────────────────────────

const qty = (q: number) => (Number.isInteger(q) ? String(q) : String(Number(q.toFixed(2))));

// "400 g", "2", or "amount not stated". A count's unit "each" is the number alone.
export function amountText(line: Pick<RecipeLine, 'quantity' | 'unit'>): string {
  if (line.quantity == null || !Number.isFinite(line.quantity)) return 'amount not stated';
  const unit = line.unit && line.unit !== 'each' ? ` ${line.unit}` : '';
  return `${qty(line.quantity)}${unit}`;
}

export type Tone = 'ok' | 'warn' | 'muted';

// Where a line's amount came from, in words, next to every amount. A transcribed line says it
// needs checking until the shopper ticks it.
export function basisBadge(line: Pick<RecipeLine, 'amount_basis' | 'confirmed'>): { text: string; tone: Tone } {
  const b: AmountBasis = line.amount_basis;
  if (b === 'transcribed_confirmed_by_you') {
    return line.confirmed ? { text: 'transcribed, checked by you', tone: 'ok' }
      : { text: 'transcribed: check it', tone: 'warn' };
  }
  if (b === 'stated_by_source') return { text: 'stated by the source', tone: 'ok' };
  if (b === 'parsed_from_your_paste') return { text: 'from your paste', tone: 'muted' };
  if (b === 'demo_house_amounts') return { text: 'demo amounts', tone: 'warn' };
  return { text: 'written by the assistant', tone: 'warn' };
}

const METHOD: Record<RecipeSource['method'], string> = {
  jsonld: "the page's schema.org recipe (JSON-LD)",
  microdata: "the page's schema.org recipe (microdata)",
  youtube_description: "the video's description",
  youtube_linked_page: 'the recipe page the creator links',
  gemini_video: 'transcribed by Gemini from the video',
  paste: 'your paste',
  db: 'the recipe library',
  seed: 'a demo recipe',
  agent_written: 'written by the assistant',
};

export const methodText = (method: RecipeSource['method']) => METHOD[method] ?? method;

// One sentence on where the recipe came from, from the source's own fields.
export function sourceText(source: RecipeSource): string {
  const who = source.channel || source.site || '';
  switch (source.method) {
    case 'jsonld':
    case 'microdata':
      return `From ${source.site || 'the page'}: ${METHOD[source.method]}.`;
    case 'youtube_linked_page':
      return `From ${source.site || 'a recipe page'}, the recipe page `
        + `${source.channel || 'the creator'} links from the video.`;
    case 'youtube_description':
      return `From the description of ${who ? `${who}'s` : 'the'} video.`;
    case 'gemini_video':
      return `Transcribed by Gemini${source.model ? ` (${source.model})` : ''} from `
        + `${who ? `${who}'s` : 'the'} video: check every line against the video.`;
    case 'paste':
      return 'From your paste.';
    default:
      return `From ${METHOD[source.method] ?? source.method}${source.label ? ` (${source.label})` : ''}.`;
  }
}

// 'mm:ss' (minutes may run past 59) as seconds, or null.
export function secondsOf(at: string | null | undefined): number | null {
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(at ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be']);

// The video at the moment a line was said or shown: the source's watch URL with &t=<s>s. Null
// when the source is not a YouTube link or the time is not mm:ss.
export function evidenceHref(sourceUrl: string | null | undefined, at: string | null | undefined): string | null {
  const s = secondsOf(at);
  if (s == null || !sourceUrl) return null;
  let u: URL;
  try {
    u = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !YOUTUBE_HOSTS.has(u.hostname)) return null;
  u.searchParams.set('t', `${s}s`);
  return u.toString();
}

// "12:34" or "1:02:03".
export function durationText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ─── the shopper's edits before planning ─────────────────────

export const hasTranscribed = (doc: RecipeDoc) =>
  doc.lines.some((l) => l.amount_basis === 'transcribed_confirmed_by_you');

export const unconfirmedLines = (doc: RecipeDoc) =>
  doc.lines.filter((l) => !l.confirmed).map((l) => l.line_no);

export function setConfirmed(doc: RecipeDoc, lineNo: number, confirmed: boolean): RecipeDoc {
  return { ...doc, lines: doc.lines.map((l) => (l.line_no === lineNo ? { ...l, confirmed } : l)) };
}

// "I checked these against the video": every line ticked at once.
export function confirmAll(doc: RecipeDoc): RecipeDoc {
  return { ...doc, lines: doc.lines.map((l) => (l.confirmed ? l : { ...l, confirmed: true })) };
}

// A line the shopper does not want planned. The rest are renumbered 1..n, as RecipeDoc requires
// (a plan's line_no is the doc's).
export function removeLine(doc: RecipeDoc, lineNo: number): RecipeDoc {
  return { ...doc, lines: doc.lines.filter((l) => l.line_no !== lineNo)
    .map((l, i) => ({ ...l, line_no: i + 1 })) };
}

export const retitle = (doc: RecipeDoc, title: string): RecipeDoc => ({ ...doc, title });

// The shopper's answer to "How many does this recipe serve?", labelled as theirs. A source's
// own count is not replaced. Anything but a whole 1..100 clears the answer.
export function withServings(doc: RecipeDoc, servings: number | null): RecipeDoc {
  if (doc.servings_stated) return doc;
  const ok = servings != null && Number.isInteger(servings) && servings >= 1 && servings <= MAX_SERVINGS;
  return { ...doc, servings: ok ? servings : null, servings_basis: ok ? 'your_setting' : null };
}

// Why the doc cannot be planned, saved or added yet, or null when it can.
export function readyProblem(doc: RecipeDoc): string | null {
  if (!doc.title.trim()) return 'Give the recipe a name.';
  if (doc.title.length > MAX_TITLE) return `The name is longer than ${MAX_TITLE} characters.`;
  if (!doc.lines.length) return 'There are no ingredient lines to plan.';
  const left = unconfirmedLines(doc).length;
  if (left) {
    return `Tick the ${left === 1 ? 'line' : `${left} lines`} you checked against the video `
      + 'first, or remove what is wrong.';
  }
  return null;
}

// The doc as it leaves the sheet: the title trimmed. Lines are untouched.
export const finished = (doc: RecipeDoc): RecipeDoc => ({ ...doc, title: doc.title.trim() });

// What the shopper's chat bubble says when "Plan this now" sends the reviewed doc.
export const chatMessageFor = (doc: RecipeDoc) => `Plan the recipe I reviewed: ${doc.title.trim()}`;

// ─── a paste ─────────────────────────────────────────────────

// The pasted ingredient list as lines for /recipes/parse-lines, or what is wrong with it.
export function pasteLines(text: string): { lines: string[]; problem: string | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { lines, problem: 'Paste the ingredient lines, one per line.' };
  if (lines.length > MAX_LINES) {
    return { lines, problem: `That is ${lines.length} lines; a recipe takes at most ${MAX_LINES}. `
      + 'Paste the ingredient lines only.' };
  }
  const long = lines.findIndex((l) => l.length > MAX_LINE_CHARS);
  if (long >= 0) {
    return { lines, problem: `Line ${long + 1} is longer than ${MAX_LINE_CHARS} characters; `
      + 'paste one ingredient per line.' };
  }
  return { lines, problem: null };
}

// parse-lines' answer as a doc to review. A paste's title is the shopper's; without one the doc
// is called "Pasted recipe", which the review lets them rename.
export function docFromParsed(parsed: ParsedLines, o: { title?: string; yield_text?: string;
                              source?: RecipeSource }): RecipeDoc {
  return {
    v: 1, key: 'imp:draft',
    title: (o.title ?? '').trim().slice(0, MAX_TITLE) || 'Pasted recipe',
    servings: parsed.servings,
    servings_stated: parsed.servings_stated,
    servings_basis: parsed.servings != null ? 'source' : null,
    yield_text: (o.yield_text ?? '').trim().slice(0, 200),
    lines: parsed.lines.map((l) => ({
      line_no: l.line_no, text: l.text, name: l.name, quantity: l.quantity, unit: l.unit,
      note: l.note, evidence: null, confirmed: true, amount_basis: l.amount_basis,
    })),
    source: o.source ?? { kind: 'pasted', method: 'paste' },
    warnings: parsed.warnings.slice(0, 20),
  };
}

// The source of a list the shopper pasted from a video: still their paste, linked to the video.
export const pastedFromVideo = (video: Pick<ImportVideo, 'url' | 'title' | 'channel'>): RecipeSource => ({
  kind: 'pasted', method: 'paste', url: video.url, site: 'youtube.com',
  page_title: video.title.slice(0, 300) || null, channel: video.channel.slice(0, 200) || null,
});

// ─── what this deployment can import ─────────────────────────

export interface ImportSupport {
  hub: boolean;
  links: boolean;                  // Link and YouTube tabs
  youtubeDescription: boolean;     // the hub has a YouTube key
  video: VideoTranscribe;          // Gemini on a click
  note: string | null;             // shown where Link and YouTube would be
}

export const NO_HUB_NOTE = 'Reading links needs the local demo hub';

// From /hub/status, or null when there is no hub (the AKS console, the public demo).
export function importSupport(status: HubStatus | null): ImportSupport {
  const off = (reason: string): VideoTranscribe => ({ enabled: false, reason });
  if (!status) {
    return { hub: false, links: false, youtubeDescription: false,
             video: off('Needs the local demo hub.'), note: NO_HUB_NOTE };
  }
  const ri = status.recipe_import;
  const video = status.video_import ?? off('This demo hub has no video import.');
  if (!ri) {
    return { hub: true, links: false, youtubeDescription: false, video,
             note: 'This demo hub cannot read links: it predates recipe import.' };
  }
  if (!ri.links) {
    return { hub: true, links: false, youtubeDescription: false, video,
             note: `The demo hub cannot read links right now${ri.reason ? `: ${ri.reason}` : '.'}` };
  }
  return { hub: true, links: true, youtubeDescription: ri.youtube_description, video, note: null };
}

// ─── the hub's refusals ──────────────────────────────────────

// An import error's detail is {code, message, ...}; anything else is said as it came.
export function importError(detail: unknown, fallback: string): { code: string; text: string } {
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const d = detail as { code?: unknown; message?: unknown };
    const code = typeof d.code === 'string' ? d.code : '';
    if (typeof d.message === 'string' && d.message) return { code, text: d.message };
    if (code) return { code, text: fallback };
  }
  if (typeof detail === 'string' && detail) return { code: '', text: detail };
  return { code: '', text: fallback };
}

// ─── Gemini's daily allowance ────────────────────────────────

// "1:10:00 of 6:00:00 used today (UTC)".
export const dailyText = (d: VideoDaily) =>
  `${durationText(d.seconds)} of ${durationText(d.limit_s)} used today (UTC)`;

// Whether a video of this length still fits today's allowance; unknown when either is unknown.
export function fitsDaily(d: VideoDaily | undefined, seconds: number | null): boolean | null {
  if (!d || seconds == null) return null;
  return d.seconds + seconds <= d.limit_s;
}

// The shopper's estimate of a video's length in minutes, as the seconds the hub takes (1 s to
// 12 h), or null when it is not a usable number.
export function estimateSeconds(minutes: string): number | null {
  const m = Number(minutes.trim());
  if (!minutes.trim() || !Number.isFinite(m) || m <= 0 || m > 720) return null;
  return Math.max(1, Math.round(m * 60));
}

// ─── saved in this browser ───────────────────────────────────

export const RECIPES_KEY = 'pantry.recipes.v1';
export const RECIPES_VERSION = 1;
export const MEAL_PLAN_INBOX_KEY = 'pantry.mealplan.inbox.v1';
export const INBOX_VERSION = 1;
const MAX_INBOX = 50;

// localStorage, or a stand-in in tests.
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const MY_ID = /^[\w-]{1,64}$/;

export type Saved = { ok: true; key: `my:${string}`; replaced: boolean } | { ok: false; problem: string };

const REFUSED = 'This browser is not letting the console save recipes (storage is off or full).';

// The saved list as stored, every entry kept as it is, or why it cannot be written to.
function readRaw(storage: StorageLike | null): { entries: unknown[] } | { problem: string } {
  if (!storage) return { problem: REFUSED };
  let raw: string | null;
  try {
    raw = storage.getItem(RECIPES_KEY);
  } catch {
    return { problem: REFUSED };
  }
  if (raw === null) return { entries: [] };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  if (!isObject(value) || !Array.isArray(value.recipes) || value.v !== RECIPES_VERSION) {
    return { problem: 'Your saved recipes are in a form this console cannot read, so saving '
      + 'now would overwrite them. Nothing was saved.' };
  }
  return { entries: value.recipes };
}

// The saved recipe this doc updates: the same my: key, or the same page or video under the
// same title (saving an import twice updates it rather than adding a copy).
export function savedKeyFor(entries: unknown[], doc: RecipeDoc): `my:${string}` | null {
  const keyOf = (e: unknown) => (isObject(e) && typeof e.key === 'string' ? e.key : '');
  if (doc.key.startsWith('my:') && entries.some((e) => keyOf(e) === doc.key)) {
    return doc.key as `my:${string}`;
  }
  const url = doc.source.url;
  if (!url) return null;
  const same = entries.find((e) => isObject(e) && isObject(e.source) && e.source.url === url
    && e.title === doc.title.trim() && keyOf(e).startsWith('my:'));
  return same ? keyOf(same) as `my:${string}` : null;
}

// "Save to my recipes". `newId` names a recipe saved for the first time (a UUID from the page).
// Refuses a doc that is not ready (readyProblem), so a saved recipe can always be planned.
export function saveRecipe(storage: StorageLike | null, doc: RecipeDoc, newId: string): Saved {
  const problem = readyProblem(doc);
  if (problem) return { ok: false, problem };
  if (!MY_ID.test(newId)) return { ok: false, problem: 'The new recipe id is not usable.' };
  const read = readRaw(storage);
  if ('problem' in read) return { ok: false, problem: read.problem };
  const existing = savedKeyFor(read.entries, doc);
  const key: `my:${string}` = existing ?? `my:${newId}`;
  const saved: RecipeDoc = { ...finished(doc), key };
  const others = read.entries.filter((e) => !(isObject(e) && e.key === key));
  try {
    storage!.setItem(RECIPES_KEY, JSON.stringify({ v: RECIPES_VERSION, recipes: [...others, saved] }));
  } catch {
    return { ok: false, problem: REFUSED };
  }
  return { ok: true, key, replaced: existing !== null };
}

export interface InboxEntry {
  key: `my:${string}`;
  title: string;
  added_at: string;
}

export interface Inbox {
  entries: InboxEntry[];
  problem: string | null;
}

const isEntry = (x: unknown): x is InboxEntry => isObject(x) && typeof x.key === 'string'
  && /^my:[\w-]{1,64}$/.test(x.key) && typeof x.title === 'string' && typeof x.added_at === 'string';

export function parseInbox(raw: string | null): Inbox {
  if (raw === null) return { entries: [], problem: null };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { entries: [], problem: 'The recipes waiting for the meal plan could not be read.' };
  }
  if (!isObject(value) || value.v !== INBOX_VERSION || !Array.isArray(value.entries)) {
    return { entries: [], problem: 'The recipes waiting for the meal plan are in a form this '
      + 'console cannot read.' };
  }
  const entries = value.entries.filter(isEntry);
  const skipped = value.entries.length - entries.length;
  return { entries, problem: skipped ? `${skipped} waiting recipe(s) could not be read.` : null };
}

export function readInbox(storage: StorageLike | null): Inbox {
  if (!storage) return { entries: [], problem: null };
  try {
    return parseInbox(storage.getItem(MEAL_PLAN_INBOX_KEY));
  } catch {
    return { entries: [], problem: 'This browser is not letting the console read the recipes '
      + 'waiting for the meal plan.' };
  }
}

export type Added = { ok: true; key: `my:${string}`; already: boolean } | { ok: false; problem: string };

// "Add to meal plan": saved to my recipes, then named in the meal plan's inbox. `now` is an ISO
// time from the page. A recipe already waiting is not added twice.
export function addToMealPlan(storage: StorageLike | null, doc: RecipeDoc, newId: string,
                              now: string): Added {
  const saved = saveRecipe(storage, doc, newId);
  if (!saved.ok) return saved;
  const inbox = readInbox(storage);
  // an inbox that cannot be read is replaced: it only names recipes, which stay saved
  if (inbox.entries.some((e) => e.key === saved.key)) return { ok: true, key: saved.key, already: true };
  if (inbox.entries.length >= MAX_INBOX) {
    return { ok: false, problem: `${MAX_INBOX} recipes are already waiting for the meal plan; `
      + 'open the meal plan to take them first. The recipe was saved.' };
  }
  const entry: InboxEntry = { key: saved.key, title: doc.title.trim(), added_at: now };
  try {
    storage!.setItem(MEAL_PLAN_INBOX_KEY,
      JSON.stringify({ v: INBOX_VERSION, entries: [...inbox.entries, entry] }));
  } catch {
    return { ok: false, problem: `${REFUSED} The recipe was saved, but not added to the meal plan.` };
  }
  return { ok: true, key: saved.key, already: false };
}

// For the meal planner: the waiting recipes, oldest first, and the inbox emptied. If emptying
// fails the entries are still returned; adding a recipe the tray already holds changes nothing.
export function takeInbox(storage: StorageLike | null): Inbox {
  const inbox = readInbox(storage);
  if (!storage || (!inbox.entries.length && !inbox.problem)) return inbox;
  try {
    storage.setItem(MEAL_PLAN_INBOX_KEY, JSON.stringify({ v: INBOX_VERSION, entries: [] }));
  } catch {
    /* the entries are returned all the same */
  }
  return inbox;
}
