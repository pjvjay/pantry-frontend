// Nutrition on the meal plan: a chip per meal and per day, the period band above the board, a
// recipe's receipt line by line, and the shopper's daily targets. Every number and every
// "unknown" is worded by src/nutritionFormat.ts, so they read the same everywhere.
//
// What is true of every figure on the board is said once, in the band over it: that the recipes'
// amounts are demo house amounts, and that a day with an empty slot counts only what is planned.
// So a meal's chip is its energy, and a day's footer its energy with a sign when the day is
// complete; the whole line (protein too, and why a day is incomplete) is there for a screen reader
// and in the footer's title. A recipe's own receipt (the Move sheet) still marks demo amounts,
// since recipes differ in that.
import { useEffect, useState } from 'react';

import {
  DEMO_TITLE, NUTRIENTS, amountText, amountsBasisText, dayLine, nutritionChip, parseBound,
  periodBand, targetPhrase, targetVerdicts, targetsProblem,
} from '../nutritionFormat';
import type { NutritionChip } from '../nutritionFormat';
import type {
  DayNutrition, MealNutrition, NutrientKey, NutritionTargets, PeriodNutrition, PlanCoverage,
  ScheduleSource,
} from '../types';
import { Sheet } from './Sheet';
import { Icon } from './icons';
import { Notice, ScrollRegion } from './ui';

// A quiet mark, not a coloured chip: the words say it, the title says more.
export function DemoBadge() {
  return <span className="nut-demo" title={DEMO_TITLE}><Icon name="info" size={12} />demo amounts</span>;
}

// How a figure is drawn by how sure it is: unknown quieter, a lower bound as it is.
const PART_CLASS: Partial<Record<string, string>> = { unknown: 'nut-unknown', at_least: 'nut-floor' };
const VERDICT_CLASS: Partial<Record<string, string>> = { warn: 'nut-target-warn' };

// A chip: each nutrient carries its own title (what it misses), so "≥" always explains itself.
// badge: say "demo amounts" here too (a recipe's own receipt); the board says it once instead.
export function NutritionChipView({ chip, label, badge = true }: { chip: NutritionChip; label?: string; badge?: boolean }) {
  return (
    <span className="nut-chip">
      {label && <span className="sr-only">{label}: </span>}
      {chip.parts.map((p, i) => (
        <span key={p.key} title={p.title} className={PART_CLASS[p.status]}>
          {i > 0 && ' · '}{p.text}
        </span>
      ))}
      {badge && chip.badge && <> <DemoBadge /></>}
    </span>
  );
}

// The energy per serving of one meal, small enough for a calendar chip. A recipe that does
// not say how many it serves has only a whole-recipe figure, so a serving's is unknown.
export function MealEnergy({ n }: { n: MealNutrition | undefined }) {
  if (!n) return null;
  if (n.basis === 'per_recipe') {
    return (
      <span className="nut-unknown"
            title={`Whole recipe: ${amountText(n.totals.energy_kcal)}. How many it serves is not known yet.`}>
        kcal per serving unknown
      </span>
    );
  }
  const chip = nutritionChip(n.totals, n.demo_amounts, ['energy_kcal']);
  return <NutritionChipView chip={chip} label="per serving" badge={false} />;
}

// A day's footer, one short line for a narrow day column: one person's day (one serving of each
// meal) as its energy, with a tick once the day is complete. Everything else (protein, why a day
// is incomplete, the day's note) is in its title and, whole, for a screen reader. The targets'
// verdicts follow, when the shopper has set targets.
export function DayNutritionLine({ day, coverage, targets }: {
  day: DayNutrition | null | undefined;
  coverage: PlanCoverage['nutrition'] | undefined;
  targets: NutritionTargets | undefined;
}) {
  const line = dayLine(day, coverage);
  const verdicts = targetVerdicts(targets, day?.targets);
  const energy = line.chip?.parts.find((p) => p.key === 'energy_kcal') ?? null;
  const said = line.chip ? `One person's day: ${line.chip.parts.map((p) => p.text).join(', ')}; ${line.status}`
    : line.status;
  return (
    <div className="mp-day-nut" title={[said, day?.note].filter(Boolean).join('. ')}>
      <span className="sr-only">{said}.</span>
      <span className="mp-day-nut-line" aria-hidden="true">
        {energy ? <span className={PART_CLASS[energy.status]}>{energy.text}</span>
          : <span className="muted">{day && !day.meals.length ? 'no meals' : '—'}</span>}
        {day?.complete && <Icon name="check" size={13} strokeWidth={2.4} className="mp-day-complete" />}
      </span>
      {verdicts.map((v) => (
        <div key={v.key} className={VERDICT_CLASS[v.level] ?? 'muted'}>
          {v.level === 'warn' && <><Icon name="alert" className="ico-inline" /><span className="sr-only">Warning: </span></>}{v.text}
        </div>
      ))}
    </div>
  );
}

// The band above the board: complete days, the average over them only, and the period's
// lower-bound total; under it, once for the whole board, what every figure on it rests on.
export function PeriodBand({ period, coverage, onTargets, targetCount }: {
  period: PeriodNutrition | null | undefined;
  coverage: PlanCoverage['nutrition'] | undefined;
  onTargets: () => void;
  targetCount: number;
}) {
  const band = periodBand(period, coverage);
  const notes = [
    band.badge ? 'The recipes’ amounts are demo house amounts, not from a published recipe.' : '',
    period && period.days_complete < period.days_total
      ? 'A day is complete once every slot has a meal and every amount is counted; until then its figure is a floor (≥).'
      : '',
  ].filter(Boolean);
  return (
    <div className="mp-period" role="group" aria-label="Nutrition over the plan">
      <span className="mp-period-k">Nutrition</span>
      <span className="mp-period-text">
        {band.parts.map((p, i) => <span key={p}>{i > 0 && ' · '}{p}</span>)}
      </span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onTargets}>
        {targetCount ? `Daily targets (${targetCount})` : 'Daily targets'}
      </button>
      {notes.length > 0 && (
        <p className="mp-period-note"><Icon name="info" size={14} /><span>{notes.join(' ')}</span></p>
      )}
      {period?.note && <span className="sr-only">{period.note}</span>}
    </div>
  );
}

const STATUS_WORDS: Record<string, string> = {
  counted: 'counted', no_quantity: 'no amount', no_conversion: 'no weight', no_reference: 'no reference food',
  excluded: 'left out',
};

// One recipe per serving, with every line's receipt: the reference food in CNF's own words,
// how its grams were reached, and why a line was not counted.
export function RecipeNutrition({ n, title }: { n: MealNutrition | undefined; title: string }) {
  if (!n) return <p className="muted">Nutrition unknown for {title}.</p>;
  const chip = nutritionChip(n.totals, n.demo_amounts, NUTRIENTS.map((x) => x.key));
  return (
    <details className="mp-nutrition">
      <summary>
        Nutrition {n.basis === 'per_serving' ? 'per serving' : 'for the whole recipe'}:{' '}
        {amountText(n.totals.energy_kcal)}{n.demo_amounts && <> <DemoBadge /></>}
        {n.status !== 'complete' && <span className="muted"> · {n.status === 'below_floor' ? 'too little counted' : 'incomplete'}</span>}
      </summary>
      <p className="muted">{n.note}</p>
      <ul className="mp-nut-totals">
        {chip.parts.map((p) => <li key={p.key} title={p.title}>{p.text}</li>)}
      </ul>
      <p className="muted">{n.coverage.note}{n.amounts_basis.length > 0 && ` · ${amountsBasisText(n.amounts_basis).join(', ')}`}</p>
      <ScrollRegion label={`Nutrition of ${title}, line by line`} className="table-scroll mp-nut-lines">
        <table className="table">
          <thead><tr><th>Line</th><th>Reference food</th><th className="num">g</th><th>Counted</th></tr></thead>
          <tbody>
            {n.lines.map((l) => (
              <tr key={l.line_no}>
                <td>{l.ingredient}</td>
                <td title={l.match_note || undefined}>
                  {l.ref_description ?? '—'}
                  {l.match_kind === 'close' && <span className="mp-unknown"> <Icon name="approx" size={12} />close match</span>}
                  {l.conversion && <div className="muted">{l.conversion}</div>}
                </td>
                <td className="num">{l.grams === null ? 'unknown' : Math.round(l.grams)}</td>
                <td title={l.reason || undefined}>
                  {STATUS_WORDS[l.status] ?? l.status}
                  {l.absent.length > 0 && l.status === 'counted' && (
                    <div className="muted">no figure for {l.absent.map((k) => NUTRIENTS.find((x) => x.key === k)?.label ?? k).join(', ')}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
    </details>
  );
}

// The sources behind every cited time and nutrient, with their own credit lines.
export function SourceCredits({ sources }: { sources: ScheduleSource[] }) {
  if (!sources.length) return null;
  return (
    <ul className="mp-sources">
      {sources.map((s) => (
        <li key={s.id}>
          {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : <strong>{s.title}</strong>}
          {s.publisher && <span className="muted"> · {s.publisher}</span>}
          {s.page_date && <span className="muted"> · page dated {s.page_date}</span>}
          {s.retrieved && <span className="muted"> · retrieved {s.retrieved}</span>}
          <div className="muted">{s.credit}</div>
        </li>
      ))}
    </ul>
  );
}

type Draft = Partial<Record<NutrientKey, { min: string; max: string }>>;

const toDraft = (t: NutritionTargets | undefined): Draft => Object.fromEntries(
  NUTRIENTS.map(({ key }) => [key, { min: t?.[key]?.min?.toString() ?? '', max: t?.[key]?.max?.toString() ?? '' }]));

// The shopper's own daily targets. No preset values ship: none were cited, so every number
// here is one the shopper typed, and it is labelled as theirs.
export function TargetsEditor({ open, onClose, targets, onSave }: {
  open: boolean;
  onClose: () => void;
  targets: NutritionTargets | undefined;
  onSave: (t: NutritionTargets) => string | null;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(targets));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setDraft(toDraft(targets));
      setProblem(null);
    }
  }, [open, targets]);

  const save = () => {
    const out: NutritionTargets = {};
    for (const { key, label } of NUTRIENTS) {
      const row = draft[key] ?? { min: '', max: '' };
      const min = parseBound(row.min);
      const max = parseBound(row.max);
      if (min === 'invalid' || max === 'invalid') {
        setProblem(`The ${label} target must be a number of 0 or more.`);
        return;
      }
      if (min !== null || max !== null) out[key] = { min, max, source: 'you' };
    }
    const wrong = targetsProblem(out);
    if (wrong) {
      setProblem(`${wrong[0].toUpperCase()}${wrong.slice(1)}.`);
      return;
    }
    const refused = onSave(out);
    if (refused) setProblem(refused);
    else onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Daily targets"
           description="Targets you set for one person's day, saved in this browser. Leave a box empty for no bound."
           footer={<>
             <button type="button" className="btn btn-secondary" onClick={() => setDraft(toDraft({}))}>Clear all</button>
             <button type="button" className="btn btn-primary" onClick={save}>Save targets</button>
           </>}>
      <p className="muted">
        A day is judged only where its total proves it: a lower bound can show a minimum met or a
        maximum passed, and anything else reads "not known". No Daily Values are filled in for you.
      </p>
      <div className="mp-targets">
        {NUTRIENTS.map(({ key, label, unit }) => (
          <fieldset key={key} className="mp-target-row">
            <legend>{label} ({unit})</legend>
            <label>at least
              <input inputMode="decimal" value={draft[key]?.min ?? ''} aria-label={`${label} minimum, ${unit}`}
                     onChange={(e) => setDraft((d) => ({ ...d, [key]: { min: e.target.value, max: d[key]?.max ?? '' } }))} />
            </label>
            <label>at most
              <input inputMode="decimal" value={draft[key]?.max ?? ''} aria-label={`${label} maximum, ${unit}`}
                     onChange={(e) => setDraft((d) => ({ ...d, [key]: { min: d[key]?.min ?? '', max: e.target.value } }))} />
            </label>
            {targets?.[key] && <span className="muted">now {targetPhrase(key, targets[key] ?? {})} (you set)</span>}
          </fieldset>
        ))}
      </div>
      {problem && <Notice tone="danger">{problem}</Notice>}
    </Sheet>
  );
}

