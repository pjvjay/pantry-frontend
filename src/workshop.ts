// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The Workshop's small decisions, kept where a test can read them: which row or tab a key moves
// to, what a product costs per 100 g, the words and tag each state wears (an origin, a reading in
// the review queue, a simulation, an Assistant run), the order and the time of the recent runs,
// whether the simulation runner is there at all, and the Metrics waterfall's legend. The Catalog,
// Provenance, Simulations and Metrics read them from here, so the same state is said the same way
// on every page.

// ─── Keys ────────────────────────────────────────────────────

// The row a key moves to in a list of `count` rows from row `at`, or null when the key does not
// move along the rows (Tab, Enter, a letter: the caller lets those through). The ends are ends:
// Down on the last row stays there, as in the lists the browser draws itself.
export function rowAfterKey(key: string, at: number, count: number, page = 10): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const from = Math.min(Math.max(at, 0), last);
  switch (key) {
    case 'ArrowDown': return Math.min(from + 1, last);
    case 'ArrowUp': return Math.max(from - 1, 0);
    case 'Home': return 0;
    case 'End': return last;
    case 'PageDown': return Math.min(from + page, last);
    case 'PageUp': return Math.max(from - page, 0);
    default: return null;
  }
}

// The tab a key moves to in a row of `count` tabs from tab `at`: Left and Right go round (Right on
// the last tab is the first), Home and End go to either end. Anything else is not a tab key (null).
export function tabAfterKey(key: string, at: number, count: number): number | null {
  if (count <= 0) return null;
  const from = Math.min(Math.max(at, 0), count - 1);
  switch (key) {
    case 'ArrowRight': return (from + 1) % count;
    case 'ArrowLeft': return (from - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

// ─── A product's price per 100 g ─────────────────────────────

export interface UnitPrice {
  amount: number;
  per: '100 g' | '100 ml' | 'each';
}

// How many grams, millilitres or pieces one of each unit is.
const UNITS: Record<string, { per: UnitPrice['per']; factor: number }> = {
  mg: { per: '100 g', factor: 0.001 },
  g: { per: '100 g', factor: 1 },
  kg: { per: '100 g', factor: 1000 },
  ml: { per: '100 ml', factor: 1 },
  cl: { per: '100 ml', factor: 10 },
  dl: { per: '100 ml', factor: 100 },
  l: { per: '100 ml', factor: 1000 },
  each: { per: 'each', factor: 1 },
  ea: { per: 'each', factor: 1 },
  ct: { per: 'each', factor: 1 },
  count: { per: 'each', factor: 1 },
  pc: { per: 'each', factor: 1 },
  pcs: { per: 'each', factor: 1 },
};

// What the product costs for a fixed amount, so a 500 g box and a 2 kg bag compare: per 100 g, per
// 100 ml, or each. Null when the size is not known (no quantity, or a unit this does not convert),
// rather than a figure made up from the package price.
export function unitPrice(price: number | null | undefined, qty: number | null | undefined,
  uom: string | null | undefined): UnitPrice | null {
  if (price == null || !Number.isFinite(price) || price < 0) return null;
  if (qty == null || !Number.isFinite(qty) || qty <= 0) return null;
  const unit = UNITS[(uom ?? '').trim().toLowerCase()];
  if (!unit) return null;
  const base = qty * unit.factor;
  return { amount: unit.per === 'each' ? price / base : (price / base) * 100, per: unit.per };
}

// "$0.46 / 100 g". Under ten cents a third decimal place, so salt is not "$0.03" and "$0.04" at
// once; a dash when there is no figure.
export function unitPriceText(u: UnitPrice | null): string {
  if (!u) return '–';
  return `$${u.amount < 0.1 ? u.amount.toFixed(3) : u.amount.toFixed(2)} / ${u.per}`;
}

// ─── States, in a tag and words ──────────────────────────────

// The kinds ui.tsx's Tag draws (each with its own glyph): kept as plain words here, so this module
// stays free of React.
export type TagTone = 'done' | 'progress' | 'next' | 'blocked' | 'attention' | 'paused' | 'changed';

export interface StatusWords {
  kind: TagTone;
  word: string;
}

// "lookup_failed" → "Lookup failed": a state the console has no words for yet, said as it came.
export function humanize(s: string): string {
  const t = s.trim().replace(/[-_]+/g, ' ');
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

function lookup(table: Record<string, StatusWords>, status: string | null | undefined,
  fallback: TagTone, empty: string): StatusWords {
  const s = (status ?? '').trim().toLowerCase();
  if (!s) return { kind: fallback, word: empty };
  return table[s] ?? { kind: fallback, word: humanize(s) };
}

// A product's origin (pantry's ProductOrigin.status). Only "resolved" is evidence a plan can use;
// the rest are kinds of not knowing, and "lookup_failed" is an outage, not a finding.
const ORIGIN: Record<string, StatusWords> = {
  resolved: { kind: 'done', word: 'Resolved' },
  conflicting: { kind: 'attention', word: 'Conflicting' },
  unknown: { kind: 'blocked', word: 'Unknown' },
  lookup_failed: { kind: 'attention', word: 'Lookup failed' },
  guess: { kind: 'blocked', word: 'Guess only' },
  none: { kind: 'blocked', word: 'No origin' },
  // a plan's basket as a whole: its origin rules held on enough of the spend, or not
  verified: { kind: 'done', word: 'Verified' },
  unverified: { kind: 'attention', word: 'Unverified' },
  not_requested: { kind: 'paused', word: 'Not asked' },
};
export const originStatus = (status: string | null | undefined): StatusWords =>
  lookup(ORIGIN, status, 'blocked', 'Unknown');

// A label reading in the review queue: waiting for a reviewer, taken into the evidence, or turned
// down (with the reviewer's reason).
const QUEUE: Record<string, StatusWords> = {
  pending: { kind: 'progress', word: 'Pending review' },
  approved: { kind: 'done', word: 'Approved' },
  rejected: { kind: 'blocked', word: 'Rejected' },
};
export const queueStatus = (status: string | null | undefined): StatusWords =>
  lookup(QUEUE, status, 'paused', 'Not reviewed');

// A simulation: a scenario's last run, a job, or one scenario inside a job.
const SIM: Record<string, StatusWords> = {
  passed: { kind: 'done', word: 'Passed' },
  done: { kind: 'done', word: 'Done' },
  completed: { kind: 'done', word: 'Completed' },
  failed: { kind: 'attention', word: 'Failed' },
  error: { kind: 'attention', word: 'Error' },
  running: { kind: 'progress', word: 'Running' },
  queued: { kind: 'paused', word: 'Queued' },
  cancelled: { kind: 'blocked', word: 'Stopped' },
  canceled: { kind: 'blocked', word: 'Stopped' },
  never: { kind: 'paused', word: 'Never run' },
};
export const simStatus = (status: string | null | undefined): StatusWords =>
  lookup(SIM, status, 'paused', 'Never run');

// One Assistant run (a trace's status).
const RUN: Record<string, StatusWords> = {
  answered: { kind: 'done', word: 'Answered' },
  error: { kind: 'attention', word: 'Failed' },
  failed: { kind: 'attention', word: 'Failed' },
  stopped: { kind: 'paused', word: 'Stopped' },
  running: { kind: 'progress', word: 'Running' },
};
export const runStatus = (status: string | null | undefined): StatusWords =>
  lookup(RUN, status, 'paused', 'No status');

// A service the hub can see (Workshop › System): answering, not there, or not asked yet.
export const serviceStatus = (ok: boolean | null | undefined): StatusWords => (ok == null
  ? { kind: 'paused', word: 'Not checked' }
  : ok ? { kind: 'done', word: 'Answering' } : { kind: 'attention', word: 'Not reachable' });

// A key someone holds for the demo (the hub, pantry-api), by its name: "Gemini key: held by the
// hub", or "YouTube key: missing".
export const keyStatus = (name: string, held: boolean, holder = 'the hub'): StatusWords => (held
  ? { kind: 'done', word: `${name}: held by ${holder}` } : { kind: 'attention', word: `${name}: missing` });

// How sure an answer is, from the share of its checks that passed: done from 90%, needs attention
// under it, and not measured when it had no checks.
export function confidenceStatus(share: number | null | undefined): StatusWords {
  if (share == null || !Number.isFinite(share)) return { kind: 'paused', word: 'Confidence not measured' };
  return { kind: share >= 0.9 ? 'done' : 'attention', word: `Answer confidence ${Math.round(share * 100)}%` };
}

// How a simulated conversation ended: completed, or how it did not ("Gave up").
export function outcomeStatus(outcome: string | null | undefined): StatusWords {
  const o = (outcome ?? '').trim().toLowerCase();
  return o === 'completed' ? { kind: 'done', word: 'Completed' } : { kind: 'attention', word: humanize(o) || 'No outcome' };
}

// What an observer saw at one point of a simulated conversation: yes, no, or it could not tell.
export const observedStatus = (value: unknown): StatusWords => (value === true ? { kind: 'done', word: 'true' }
  : value === false ? { kind: 'blocked', word: 'false' } : { kind: 'attention', word: 'unknown' });

// How much of a basket's spend has its origin checked: done once the plan's floor is met, needing
// attention under it (an unchecked basket is an open question, never drawn as clean).
export const coverageStatus = (share: number, meetsFloor: boolean): StatusWords => ({
  kind: meetsFloor ? 'done' : 'attention', word: `Origin checked for ${Math.round(share * 100)}% of the spend`,
});

// The plan's own flags: the trip split the optimizer recommends, and a plan the router sent on to
// the stronger model.
export const PLAN_STATES = {
  recommended: { kind: 'done', word: 'Recommended' },
  escalated: { kind: 'changed', word: 'Escalated' },
} as const satisfies Record<string, StatusWords>;

// ─── Origin evidence ─────────────────────────────────────────

// How sure a reading is, as a band of three: the words say it, the bars only show it.
export function confidenceBand(c: string | null | undefined): { level: 0 | 1 | 2 | 3; word: string } {
  switch ((c ?? '').trim().toLowerCase()) {
    case 'high': return { level: 3, word: 'High confidence' };
    case 'medium': return { level: 2, word: 'Medium confidence' };
    case 'low': return { level: 1, word: 'Low confidence' };
    default: return { level: 0, word: 'Confidence not given' };
  }
}

// Where a piece of evidence came from (product_origin_evidence.source).
const SOURCES: Record<string, string> = {
  'label-photo': 'Label photo',
  'agent-label': 'Approved reading',
  // a reading in the review queue, not evidence yet
  submission: 'Submitted reading',
  'open-food-facts': 'Open Food Facts',
  'retailer-pdp': 'Retailer page',
  guess: 'Name-based guess',
  heuristic: 'Name-based guess',
  llm: 'Model guess',
};
export const sourceLabel = (source: string | null | undefined): string =>
  SOURCES[(source ?? '').trim().toLowerCase()] ?? (humanize(source ?? '') || 'Source not given');

// What the wording legally claims: "product-of" → "Product of". The words on the label itself are
// the verbatim, quoted apart and never rewritten.
export function claimLabel(claim: string | null | undefined): string {
  const c = (claim ?? '').trim().toLowerCase();
  if (!c || c === 'unknown' || c === 'none') return 'No claim';
  return humanize(c);
}

// "2026-11-10T14:02:11.5+00:00" → "2026-11-10 14:02": a record's time as stored (UTC), to the minute.
export function stamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(iso.trim());
  if (!m) return iso.trim();
  return m[2] ? `${m[1]} ${m[2]}` : m[1];
}

// ─── Metrics ─────────────────────────────────────────────────

// The run a Metrics address opens (#/workshop/metrics?trace=<id>), or null.
export function traceOf(hash: string): string | null {
  const cut = hash.indexOf('?');
  if (cut === -1) return null;
  const id = new URLSearchParams(hash.slice(cut + 1)).get('trace');
  return id && id.trim() ? id : null;
}

// The runs newest first, by when each began. The hub's own list can put an older run first (a
// replayed recording keeps adding the browser's spans to its run's trace), and a list that says
// "newest first" has to be. Runs that began at the same moment, or whose time cannot be read
// (those go last), keep the hub's order.
export function newestFirst<T extends { started_at: string }>(runs: readonly T[]): T[] {
  const at = (r: T) => {
    const ms = Date.parse(r.started_at);
    return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
  };
  return runs.map((r, i) => ({ r, i, at: at(r) }))
    .sort((a, b) => (a.at === b.at ? a.i - b.i : b.at - a.at))
    .map((x) => x.r);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Wed 11 Nov, 2:00 AM": a moment the way the console writes a day (mealplan/dates.ts dayLabel),
// with this browser's clock to the minute, in fixed English names, the same in every browser.
// Empty for a time that cannot be read.
export function whenText(at: string | number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

// ─── Simulations ─────────────────────────────────────────────

// The simulation runner is not running at all (the hub says it cannot reach it): that is how this
// demo is set up, not something that went wrong, so Simulations says it calmly, with how to start
// the runner, rather than as an error.
export const runnerDown = (message: string | null | undefined): boolean =>
  /runner\b.*\bnot reachable/i.test(message ?? '');

// The columns of a table that hold figures, to be set right-aligned in equal widths: every value
// in them is a number (a missing one aside), and at least one is there.
export function figureColumns(rows: Record<string, unknown>[], cols: string[]): Set<string> {
  const out = new Set<string>();
  for (const c of cols) {
    let seen = false;
    let all = true;
    for (const r of rows) {
      const v = r[c];
      if (v == null) continue;
      if (typeof v === 'number') seen = true;
      else { all = false; break; }
    }
    if (seen && all) out.add(c);
  }
  return out;
}

// The waterfall's kinds of span, in the order the legend lists them, with the name each goes by.
// The gateway's own spans and its tool calls share one colour and one name.
const KINDS: [kind: string, key: string, label: string][] = [
  ['turn', 'turn', 'the turn'],
  ['observers', 'observers', 'observers'],
  ['model', 'model', 'model step'],
  ['tool', 'tool', 'MCP tool call'],
  ['gateway', 'gateway', 'ContextForge gateway'],
  ['gateway.tool', 'gateway', 'ContextForge gateway'],
  ['pantry.step', 'pantry-step', 'pantry step'],
  ['pantry.llm', 'pantry-llm', 'pantry LLM call'],
  ['browser', 'browser', 'browser'],
];

// The class a span of this kind is drawn with: "pantry.step" → "pantry-step".
export const kindKey = (kind: string): string =>
  KINDS.find(([k]) => k === kind)?.[1] ?? kind.replace(/\./g, '-');

// One legend entry for each kind of span the trace holds (and only those), in a fixed order, so
// two runs' legends read alike.
export function legendFor(kinds: Iterable<string>): { key: string; label: string }[] {
  const present = new Set(kinds);
  const out: { key: string; label: string }[] = [];
  for (const [kind, key, label] of KINDS) {
    if (present.has(kind) && !out.some((e) => e.key === key)) out.push({ key, label });
  }
  for (const kind of present) {
    if (!KINDS.some(([k]) => k === kind)) out.push({ key: kindKey(kind), label: humanize(kind) });
  }
  return out;
}
