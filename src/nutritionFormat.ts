// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Nutrition as the shopper reads it: every number the server computed, worded so it is never
// more certain than the data. A complete total is a number ("642 kcal"), a total that misses
// some lines is a lower bound ("≥ 610 kcal", the missing lines in its title), and a total
// with nothing counted is "unknown". Nothing here turns a null into 0, and every text that
// shows a number built from demo house amounts carries the "demo amounts" badge.
//
// It also checks the shopper's daily targets before they reach the server, which refuses a
// target it cannot read with a 422.
import type {
  DayNutrition, MealNutrition, NutrientKey, NutrientTotal, NutritionTarget, NutritionTargets,
  PeriodNutrition, PlanCoverage, TargetCheck,
} from './types.ts';

export const NUTRIENTS: readonly { key: NutrientKey; label: string; unit: string }[] = [
  { key: 'energy_kcal', label: 'energy', unit: 'kcal' },
  { key: 'protein_g', label: 'protein', unit: 'g' },
  { key: 'fat_g', label: 'fat', unit: 'g' },
  { key: 'satfat_g', label: 'saturated fat', unit: 'g' },
  { key: 'carbohydrate_g', label: 'carbohydrate', unit: 'g' },
  { key: 'fibre_g', label: 'fibre', unit: 'g' },
  { key: 'sugars_g', label: 'sugars', unit: 'g' },
  { key: 'sodium_mg', label: 'sodium', unit: 'mg' },
];

export const NUTRIENT_KEYS: readonly NutrientKey[] = NUTRIENTS.map((n) => n.key);

// The pair a chip shows; the rest are in the day's and the recipe's tables.
export const HEADLINE: readonly NutrientKey[] = ['energy_kcal', 'protein_g'];

const META = new Map(NUTRIENTS.map((n) => [n.key, n]));

export const DEMO_BADGE = 'demo amounts';
export const DEMO_TITLE = 'Recipe amounts are demo house amounts, not from a published recipe';

// Thousands separated by commas, the same in every browser (toLocaleString is not).
function grouped(n: number): string {
  const [whole, frac] = Math.abs(n).toString().split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${withCommas}${frac ? `.${frac}` : ''}`;
}

// Energy and sodium as whole numbers; grams to one decimal below 10, where the decimal still
// means something ("2.5 g fibre"), and whole above.
export function formatAmount(amount: number, unit: string): string {
  if (unit === 'g' && Math.abs(amount) < 10) {
    const r = Math.round(amount * 10) / 10;
    return grouped(r);
  }
  return grouped(Math.round(amount));
}

const hasNumber = (t: NutrientTotal | undefined | null): t is NutrientTotal & { amount: number } =>
  !!t && t.status !== 'unknown' && typeof t.amount === 'number' && Number.isFinite(t.amount);

// "642 kcal", "≥ 610 kcal" or "unknown". Missing from the answer is unknown too.
export function amountText(t: NutrientTotal | undefined | null, unit?: string): string {
  if (!hasNumber(t)) return 'unknown';
  const u = unit ?? t.unit;
  const n = `${formatAmount(t.amount, u)} ${u}`;
  return t.status === 'complete' && t.complete ? n : `≥ ${n}`;
}

// One nutrient with its name: "642 kcal", "≥ 25 g protein", "kcal unknown", "protein unknown".
export function nutrientText(key: NutrientKey, t: NutrientTotal | undefined | null): string {
  const meta = META.get(key);
  const unit = meta?.unit ?? t?.unit ?? '';
  const label = meta?.label ?? key;
  if (key === 'energy_kcal') return hasNumber(t) ? amountText(t, unit) : 'kcal unknown';
  return hasNumber(t) ? `${amountText(t, unit)} ${label}` : `${label} unknown`;
}

// Why a total is a lower bound or unknown, for its title.
export function totalTitle(key: NutrientKey, t: NutrientTotal | undefined | null): string {
  const label = META.get(key)?.label ?? key;
  if (!t) return `No ${label} figure was computed.`;
  if (t.status === 'unknown' || t.amount === null) {
    return t.gaps.length ? `${label} unknown: nothing counted (${t.gaps.join('; ')})`
      : `${label} unknown: nothing counted`;
  }
  if (t.status === 'at_least' || !t.complete) {
    return t.gaps.length ? `At least this much ${label}; not counted: ${t.gaps.join('; ')}`
      : `At least this much ${label}: not every meal of the day is counted`;
  }
  return `${label}: ${t.lines_counted} of ${t.lines_total} ingredients counted`;
}

export interface ChipPart {
  key: NutrientKey;
  text: string;
  title: string;
  status: NutrientTotal['status'];
}

export interface NutritionChip {
  parts: ChipPart[];
  badge: { text: string; title: string } | null;
  text: string;                    // the whole chip as one line, badge included
}

// A chip's text from a set of totals. The badge follows demo_amounts and nothing else.
export function nutritionChip(totals: Partial<Record<NutrientKey, NutrientTotal>> | null | undefined,
  demoAmounts: boolean, keys: readonly NutrientKey[] = HEADLINE): NutritionChip {
  const parts = keys.map((key): ChipPart => {
    const t = totals?.[key] ?? null;
    return { key, text: nutrientText(key, t), title: totalTitle(key, t),
      status: hasNumber(t) ? t.status : 'unknown' };
  });
  const badge = demoAmounts ? { text: DEMO_BADGE, title: DEMO_TITLE } : null;
  const text = [...parts.map((p) => p.text), ...(badge ? [badge.text] : [])].join(' · ');
  return { parts, badge, text };
}

export const mealChip = (n: MealNutrition | null | undefined): NutritionChip | null =>
  (n ? nutritionChip(n.totals, n.demo_amounts) : null);

// Where a recipe's amounts came from, in words.
const BASIS_WORDS: Record<string, string> = {
  demo_house_amounts: 'demo amounts',
  parsed_from_your_paste: 'amounts from your paste',
  stated_by_source: 'amounts from the recipe’s source',
  transcribed_confirmed_by_you: 'transcribed from the video, confirmed by you',
  written_by_assistant: 'amounts written by the Assistant',
};

export const amountsBasisText = (basis: string[]): string[] =>
  basis.map((b) => BASIS_WORDS[b] ?? b.replace(/_/g, ' '));

// Why there is no figure at all: nothing has been checked yet (no answer), the API has no
// nutrition ('unknown', from an API before it), or its tables are not deployed.
export function nutritionMissing(coverage: PlanCoverage['nutrition'] | undefined): string {
  if (coverage === undefined) return 'nutrition not checked yet';
  if (coverage === 'not_deployed') return 'nutrition unknown: the nutrition tables are not deployed';
  if (coverage === 'computed') return 'nutrition unknown';
  return 'nutrition unknown: this API does not compute nutrition';
}

export interface DayLine {
  chip: NutritionChip | null;      // null: no figure at all
  status: string;                  // 'complete day', 'incomplete: …', or why there is none
}

// A day's footer: one person's day, as the server summed it.
export function dayLine(day: DayNutrition | null | undefined,
  coverage: PlanCoverage['nutrition'] | undefined): DayLine {
  if (!day) return { chip: null, status: nutritionMissing(coverage) };
  if (!day.meals.length) return { chip: null, status: 'no meals planned' };
  const chip = nutritionChip(day.totals, day.demo_amounts);
  if (day.complete) return { chip, status: 'complete day' };
  const why = !day.all_meals_planned ? 'not every slot has a meal' : 'some amounts are not counted';
  return { chip, status: `incomplete: ${why}` };
}

const periodName = (days: number) =>
  (days === 14 ? 'fortnight' : days === 7 ? 'week' : `${days}-day`);

// The band above the board, for example "9 of 14 days complete · average 1,840 kcal, 96 g
// protein per day over complete days (demo amounts) · fortnight total ≥ 23,100 kcal". With no
// complete day there is no average, and it says so rather than dividing what is known.
export function periodBand(p: PeriodNutrition | null | undefined,
  coverage: PlanCoverage['nutrition'] | undefined): { parts: string[]; badge: boolean } {
  if (!p) return { parts: [nutritionMissing(coverage)], badge: false };
  const demo = p.demo_amounts ? ` (${DEMO_BADGE})` : '';
  const parts = [`${p.days_complete} of ${p.days_total} days complete`];
  const avg = p.per_day_average_over_complete_days;
  if (avg && p.days_complete > 0) {
    const bits = HEADLINE.map((k) => {
      const v = avg[k];
      const unit = META.get(k)?.unit ?? '';
      if (typeof v !== 'number') return `${META.get(k)?.label ?? k} unknown`;
      return k === 'energy_kcal' ? `${formatAmount(v, unit)} kcal`
        : `${formatAmount(v, unit)} ${unit} ${META.get(k)?.label}`;
    });
    parts.push(`average ${bits.join(', ')} per day over complete days${demo}`);
  } else {
    parts.push('no complete day, so no daily average');
  }
  const totals = HEADLINE.map((k) => {
    const t = p.lower_bound_total[k];
    const unit = META.get(k)?.unit ?? '';
    if (!t || typeof t.amount !== 'number') return `${META.get(k)?.label ?? k} unknown`;
    const n = `${t.complete ? '' : '≥ '}${formatAmount(t.amount, unit)}`;
    return k === 'energy_kcal' ? `${n} kcal` : `${n} ${unit} ${META.get(k)?.label}`;
  });
  parts.push(`${periodName(p.days_total)} total ${totals.join(', ')}${avg && p.days_complete > 0 ? '' : demo}`);
  return { parts, badge: p.demo_amounts };
}

// ─── Targets ─────────────────────────────────────────────────

// What is wrong with a set of targets, or null. Mirrors pantry-api's NutritionTarget: a min,
// a max or both, never negative, min not above max, and no Health Canada label on energy or
// protein (Health Canada sets no Daily Value for them).
export function targetsProblem(x: unknown): string | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return 'the targets are not readable';
  for (const [key, raw] of Object.entries(x)) {
    if (!NUTRIENT_KEYS.includes(key as NutrientKey)) return `"${key}" is not a nutrient`;
    if (typeof raw !== 'object' || raw === null) return `the ${key} target is not readable`;
    const t = raw as Record<string, unknown>;
    const ok = (v: unknown) => v === null || v === undefined
      || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
    const label = META.get(key as NutrientKey)?.label ?? key;
    if (!ok(t.min) || !ok(t.max)) return `a ${label} target is a number of 0 or more`;
    if (t.min == null && t.max == null) return `a ${label} target needs a minimum, a maximum or both`;
    if (typeof t.min === 'number' && typeof t.max === 'number' && t.min > t.max) {
      return `the ${label} minimum is above its maximum`;
    }
    if (t.source !== undefined && t.source !== 'you' && t.source !== 'health_canada_dv') {
      return `the ${label} target has an unknown source`;
    }
    if (t.source === 'health_canada_dv' && (key === 'energy_kcal' || key === 'protein_g')) {
      return `Health Canada sets no Daily Value for ${label}`;
    }
  }
  return null;
}

// A typed bound: '' clears it, anything else must be a number of 0 or more.
export function parseBound(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

// The target as a phrase: "at least 50 g", "at most 2,000 kcal", "50 to 90 g".
export function targetPhrase(key: NutrientKey, t: NutritionTarget): string {
  const unit = META.get(key)?.unit ?? '';
  const f = (n: number) => `${formatAmount(n, unit)} ${unit}`;
  if (t.min != null && t.max != null) return `${formatAmount(t.min, unit)} to ${f(t.max)}`;
  if (t.min != null) return `at least ${f(t.min)}`;
  if (t.max != null) return `at most ${f(t.max)}`;
  return 'no target';
}

const VERDICT_WORDS: Record<string, string> = {
  met: 'met', short: 'short', over: 'over', within: 'within', unknown: 'not known',
};

// One day's verdicts against the targets, only where the server gave one. 'not known' when the
// day's total is a lower bound the bound cannot be judged against.
export function targetVerdicts(targets: NutritionTargets | undefined,
  checks: Partial<Record<NutrientKey, TargetCheck>> | null | undefined)
  : { key: NutrientKey; text: string; level: 'ok' | 'warn' | 'unknown' }[] {
  if (!targets || !checks) return [];
  const out: { key: NutrientKey; text: string; level: 'ok' | 'warn' | 'unknown' }[] = [];
  for (const key of NUTRIENT_KEYS) {
    const t = targets[key];
    const c = checks[key];
    if (!t || !c) continue;
    const verdicts = [c.min, c.max].filter((v): v is NonNullable<typeof v> => v !== null);
    const level = verdicts.some((v) => v === 'short' || v === 'over') ? 'warn'
      : verdicts.some((v) => v === 'unknown') ? 'unknown' : 'ok';
    const label = META.get(key)?.label ?? key;
    out.push({ key, level,
      text: `${label} ${targetPhrase(key, t)}: ${verdicts.map((v) => VERDICT_WORDS[v]).join(', ')}` });
  }
  return out;
}
