// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Quick add's preview: the shopper's sentence ("3 Pepperoni Pizza + 2 Chicken Fried Rice + 3
// chicken briyani + 7 mango milkshakes in 2 weeks"), as /mealplan/selection/parse read it,
// turned into chips the shopper accepts before anything joins the plan.
//
// The rule that matters: only an exact or plural match is accepted without asking. An alias or
// fuzzy match ("chicken briyani" for Chicken Biryani) is a question with Use and Not this,
// whatever the server's needs_confirmation says, and a name that fits several recipes is a
// choice. Nothing joins the plan unless it was exact, plural or chosen by the shopper.
import { MAX_DAYS, docRef, libraryRef, starterRef } from './model.ts';
import type { MealPlanState, PlanEdit, Slot } from './model.ts';
import type {
  MealStarter, RecipeDoc, RecipeRef, SelectionCandidate, SelectionMatch, SelectionParseResult,
} from '../types.ts';

export type ChipState = 'ready' | 'confirm' | 'choose' | 'unmatched';

// null: not decided yet. A ready chip starts decided, as Use.
export type Decision = { use: string } | 'reject' | null;

export interface PreviewItem {
  input: string;                   // the shopper's words for this item
  name: string;
  count: number;
  countStated: boolean;
  slot: Slot | null;               // what the sentence said, else the matched recipe's slot
  state: ChipState;
  match: SelectionMatch | null;
  candidates: SelectionCandidate[];
  question: string | null;         // 'chicken briyani → Chicken Biryani (demo starter)?'
  decision: Decision;
}

export interface Preview {
  items: PreviewItem[];
  periodDays: number | null;
  warnings: string[];
  household: number;
}

const AUTO = new Set(['exact', 'plural']);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "3 meals × 2 people": what a count means, said wherever a count is shown.
export const countLine = (count: number, household: number): string =>
  `${plural(count, 'meal', 'meals')} × ${plural(household, 'person', 'people')}`;

const SLOT_PLURAL: Record<Slot, [string, string]> = {
  breakfast: ['breakfast', 'breakfasts'], lunch: ['lunch', 'lunches'],
  dinner: ['dinner', 'dinners'], snack: ['snack', 'snacks'],
};

// "3 × Pepperoni Pizza = 3 dinners for 2 people", as the server words it.
export function meaningOf(count: number, title: string, slot: Slot | null, household: number): string {
  const [one, many] = SLOT_PLURAL[slot ?? 'dinner'];
  return `${count} × ${title} = ${plural(count, one, many)} for ${plural(household, 'person', 'people')}`;
}

export function buildPreview(result: SelectionParseResult, household: number): Preview {
  const items = result.selections.map((sel): PreviewItem => {
    const m = sel.status === 'matched' ? sel.matched_as : null;
    const base = { input: sel.input, name: sel.name, count: sel.count, countStated: sel.count_stated,
      slot: sel.slot_hint ?? m?.slot ?? null, match: m, candidates: sel.candidates };
    if (m && AUTO.has(m.how) && !sel.needs_confirmation) {
      return { ...base, state: 'ready', question: null, decision: { use: m.recipe_key } };
    }
    if (m) {
      return { ...base, state: 'confirm', decision: null,
        question: `${sel.name} → ${m.title} (${m.label})?` };
    }
    // Several recipes fit, or none did but some hold every word: offered, never chosen.
    if (sel.candidates.length) {
      return { ...base, state: 'choose', decision: null,
        question: sel.status === 'ambiguous' ? `Which recipe is "${sel.name}"?`
          : `"${sel.name}" is not a recipe here; did you mean one of these?` };
    }
    return { ...base, state: 'unmatched', decision: null, question: null };
  });
  return { items, periodDays: result.period_days, warnings: result.warnings, household };
}

// The shopper's answer for one chip. Use must name the matched recipe or one of the candidates.
export function decide(p: Preview, index: number, decision: Decision): Preview {
  const item = p.items[index];
  if (!item || item.state === 'unmatched') return p;
  if (decision !== null && decision !== 'reject') {
    const allowed = [item.match?.recipe_key, ...item.candidates.map((c) => c.recipe_key)];
    if (!allowed.includes(decision.use)) return p;
  }
  const items = p.items.slice();
  items[index] = { ...item, decision };
  return { ...p, items };
}

export const waiting = (p: Preview): number =>
  p.items.filter((i) => (i.state === 'confirm' || i.state === 'choose') && i.decision === null).length;

export interface Accepted {
  recipe_key: string;
  title: string;
  kind: SelectionCandidate['kind'];
  count: number;
  slot: Slot | null;
  meaning: string;
}

// What would join the plan now: decided Use only.
export function accepted(p: Preview): Accepted[] {
  const out: Accepted[] = [];
  for (const item of p.items) {
    if (item.decision === null || item.decision === 'reject') continue;
    const key = item.decision.use;
    const pick = item.match?.recipe_key === key ? item.match
      : item.candidates.find((c) => c.recipe_key === key);
    if (!pick) continue;
    const slot = item.slot ?? (item.match?.recipe_key === key ? item.match.slot : null);
    out.push({ recipe_key: key, title: pick.title, kind: pick.kind, count: item.count, slot,
      meaning: meaningOf(item.count, pick.title, slot, p.household) });
  }
  return out;
}

// The chip's own line: the meaning once decided, the question until then.
export function chipText(item: PreviewItem, household: number): string {
  if (item.state === 'unmatched') return `"${item.name}" is not a recipe here yet`;
  if (item.decision === 'reject') return `${item.input}: not added`;
  if (item.decision !== null) {
    const key = item.decision.use;
    const title = item.match?.recipe_key === key ? item.match.title
      : item.candidates.find((c) => c.recipe_key === key)?.title ?? key;
    return meaningOf(item.count, title, item.slot, household);
  }
  return item.question ?? item.input;
}

export interface Lookups {
  starters: MealStarter[];
  myRecipes: RecipeDoc[];
}

function refFor(key: string, look: Lookups): RecipeRef | null {
  if (key.startsWith('lib:')) return libraryRef(key.slice(4));
  if (key.startsWith('starter:')) {
    const k = key.slice('starter:'.length);
    return look.starters.some((s) => s.key === k) || !look.starters.length ? starterRef(k) : null;
  }
  const doc = look.myRecipes.find((d) => d.key === key);
  return doc ? docRef(doc) : null;
}

// The accepted chips as one batch edit (one undo step): new recipes join the tray with their
// count, recipes already there gain the count, and a period the sentence named ("in 2 weeks")
// sets the plan's length. Anything that cannot be added is listed, never dropped quietly.
export function previewEdit(p: Preview, s: MealPlanState, look: Lookups)
  : { edit: PlanEdit | null; problems: string[] } {
  const merged = new Map<string, Accepted>();
  for (const a of accepted(p)) {
    const had = merged.get(a.recipe_key);
    merged.set(a.recipe_key, had ? { ...had, count: had.count + a.count } : a);
  }
  const edits: PlanEdit[] = [];
  const problems: string[] = [];
  for (const a of merged.values()) {
    const current = s.draft.recipes[a.recipe_key];
    if (current) {
      edits.push({ type: 'setWanted', key: a.recipe_key, wanted: current.wanted + a.count });
      continue;
    }
    const ref = refFor(a.recipe_key, look);
    if (!ref) {
      problems.push(`${a.title} is no longer available`);
      continue;
    }
    const starterSlot = look.starters.find((st) => st.doc_key === a.recipe_key)?.slot;
    edits.push({ type: 'addRecipe', ref, title: a.title, wanted: a.count,
      slot: a.slot ?? starterSlot ?? 'dinner' });
  }
  if (p.periodDays !== null && p.periodDays >= 1 && p.periodDays <= MAX_DAYS
    && p.periodDays !== s.draft.days) {
    edits.push({ type: 'setWindow', start_date: s.draft.start_date, days: p.periodDays });
  }
  return { edit: edits.length ? { type: 'batch', edits } : null, problems };
}
