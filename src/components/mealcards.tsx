// The wizard's Pick meals stage. It opens with the setup restated (SummaryStrip.tsx: each answer
// with a Change back to Set up, which is optional) and three ways in: "Build a week for me" (the
// week planner's dinners for the plan's days, as one edit with an Undo: useBuildWeek.ts), "From a
// link" (recipe import) and "Paste a recipe" (Quick add, below). Then recipes to add, as cards
// in Breakfast, Lunch and Dinner sections (Snack collapsed), from /mealplan/catalog for the
// household's diet, avoid-tags and area. A card says the recipe's diet, what one more meal of it
// adds to the plan's cost, and what cannot be bought nearby (and whether only the origin rule
// stops it); Add and the count stepper put meals in the plan. A budget bar stays at the top while
// the page scrolls: the budget, the estimated spend, what is left, and the meals so far ("6
// dinners, for 6 of 7 days": the shopper's terms; Place on days counts slots). An Add
// that would pass the budget cannot be pressed and says by how much; recipes that do not fit the
// diet are counted under "n hidden by your diet". Quick add, Import a recipe and the shopper's
// own recipes stay below, as other ways to add. While the recipes load, cards in their shape hold
// their place at once, so the stage never stands empty and nothing below it rides up under the
// Back and Next bar.
//
// The spend is the selection in whole packs, as trips buy it, so it is close to what Ingredients
// and the Shopping plan show. The arithmetic is in mealplan/catalog.ts.
import { useEffect, useId, useMemo, useState } from 'react';

import {
  addCheck, addCost, addCostText, budgetBar, budgetBarText, budgetSaid, byKey, catalogSections, cleanRef,
  costPerMealText, dietBadge, estimateText, estimatedSpend, hiddenText, isMine, money, notInCatalog, ownRecipes,
  picksOf, unavailableText,
} from '../mealplan/catalog';
import type { Pick, Spend } from '../mealplan/catalog';
import { recipePicture } from '../mealplan/images';
import type { SetupItem } from '../mealplan/basics';
import { budgetOf, docRef, mealsOf, recipeTitle } from '../mealplan/model';
import type { PlanEdit } from '../mealplan/model';
import { addStop } from '../mealplan/room';
import { useCatalog, useMealPlan } from '../mealplan/store';
import { clockText } from '../mealplan/wizard';
import type { CatalogRecipe } from '../types';
import { ImportSheet } from './ImportSheet';
import { AddRecipes, QuickAdd } from './mealtray';
import { RecipePicture } from './pictures';
import { Icon } from './icons';
import { SetupStrip } from './SummaryStrip';
import { Notice, Spinner, StatRow, StatTile } from './ui';
import type { NoticeAction } from './ui';
import { useBuildWeek } from './useBuildWeek';
import { useKeepClear } from './useKeepClear';

// ─── The budget bar ──────────────────────────────────────────

// pending: the recipes' prices have not arrived yet, so the figures would be "$0.00". The
// figures are StatTiles in a plain row, since the bar is the box (components/ui.tsx); over the
// budget, what is left says so in words with the warning's sign and colour.
function BudgetBar({ spend, pending }: { spend: Spend; pending: boolean }) {
  const mp = useMealPlan();
  const bar = budgetBar(mp.state, spend);
  const t = pending ? { ...budgetBarText(bar), spent: 'estimating…', remaining: '…' } : budgetBarText(bar);
  const over = bar.remaining !== null && bar.remaining < 0;
  const used = bar.budget ? Math.min(100, Math.round((bar.spent / bar.budget) * 100)) : 0;
  // stuck at the top while the cards scroll under it: a card's button the keyboard reaches comes
  // to rest below it, not under it
  const keepClear = useKeepClear('top');
  return (
    <div ref={keepClear} className={`mp-budget${over ? ' mp-budget-over' : ''}`} role="group" aria-label="Budget and meals">
      <StatRow plain>
        <StatTile label="Budget" value={t.budget} />
        <StatTile label="Estimated" value={t.spent} />
        <StatTile label="Remaining" value={t.remaining} tone={over && !pending ? 'warn' : 'default'} />
        <StatTile label="Meals" value={t.meals} note={t.mealsNote || undefined} />
      </StatRow>
      {bar.budget !== null && (
        <div className="mp-budget-meter" aria-hidden="true"><span style={{ width: `${used}%` }} /></div>
      )}
    </div>
  );
}

// ─── A recipe card ───────────────────────────────────────────

// spend and picks: the plan's selection as it is, which what one more meal adds depends on.
function RecipeCard({ r, spend, picks, onAdd }: { r: CatalogRecipe; spend: Spend; picks: Pick[];
  onAdd: (r: CatalogRecipe) => void }) {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const overId = useId();
  const inPlan = d.recipes[r.key];
  const meals = inPlan ? mealsOf(d, r.key).length : 0;
  const adds = addCost(picks, r);
  const check = addCheck(budgetOf(d.prefs), spend, adds?.cost ?? null);
  const cannot = unavailableText(r, d.settings.exclude_origin ?? []);
  const badge = dietBadge(r.diets);
  // the shopper's own recipe as saved here, with the picture its import kept
  const ownDoc = isMine(r) ? mp.myRecipes.find((x) => x.key === r.key) ?? inPlan?.ref.doc ?? r.ref.doc : null;
  // the meal's places first, then the budget: both are said when both stop it
  const full = addStop(d, inPlan?.slot ?? r.slot, inPlan?.wanted ?? 0);
  const over = check.ok ? null : money(check.over);
  const blocked = over && `would go ${over} over the budget`;
  const addProps = {
    'aria-disabled': blocked || full ? true : undefined,
    'aria-describedby': blocked || full ? overId : undefined,
    onClick: () => { if (!blocked && !full) onAdd(r); },
  } as const;
  return (
    <li className={`card mp-card${inPlan ? ' mp-card-in' : ''}`}>
      <div className="card-pic"><RecipePicture pic={recipePicture(r.image, ownDoc)} slot={r.slot} size="card" /></div>
      <div className="mp-card-head">
        <strong className="mp-card-title">{r.title}</strong>
        {badge && <span className="chip">{badge}</span>}
        {isMine(r) && <span className="chip">my recipe</span>}
      </div>
      <div className="mp-card-cost">
        {addCostText(adds)}
        {r.est_cost_per_meal !== null && <span className="muted"> · {costPerMealText(r)}</span>}
      </div>
      {r.contains.length > 0 && <div className="muted mp-card-note">contains {r.contains.join(', ')}</div>}
      {!r.fits && <p className="mp-card-note mp-card-warn"><Icon name="alert" size={14} />Not for your diet: {r.why_not ?? 'it does not fit'}.</p>}
      {cannot.map((t) => <p key={t} className="mp-card-note mp-card-warn"><Icon name="alert" size={14} />{t}</p>)}
      <div className="mp-card-ctl">
        {inPlan ? (
          <span className="mp-stepper">
            <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label={`One ${r.title} meal fewer`}
                    disabled={inPlan.wanted <= 0}
                    onClick={() => mp.dispatch({ type: 'setWanted', key: r.key, wanted: inPlan.wanted - 1 })}><Icon name="minus" size={16} /></button>
            <output aria-label={`${r.title} meals`}>{meals}</output>
            <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label={`One ${r.title} meal more`}
                    data-more={r.key} {...addProps}><Icon name="plus" size={16} /></button>
          </span>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" aria-label={`Add ${r.title}`} {...addProps}><Icon name="plus" size={16} />Add</button>
        )}
        {(full || blocked) && (
          <span id={overId} className="mp-card-over">
            {full && <span className="mp-card-full">{full}.</span>}
            {full && blocked && ' '}
            {blocked && (
              <span className="mp-card-warn">
                <Icon name="alert" size={14} />{full ? `It would also go ${over} over the budget.` : blocked}
              </span>
            )}
          </span>
        )}
      </div>
    </li>
  );
}

function Hidden({ list }: { list: CatalogRecipe[] }) {
  if (!list.length) return null;
  return (
    <details className="mp-hidden">
      <summary>{hiddenText(list.length)}</summary>
      <ul>{list.map((r) => <li key={r.key}>{r.title}: <span className="muted">{r.why_not ?? 'does not fit'}</span></li>)}</ul>
    </details>
  );
}

// ─── The ways in ─────────────────────────────────────────────

// Three ways to put meals in the plan, above the recipes: the week planner picks a week of
// dinners (one press, one Undo), a recipe from a link, or Quick add for a pasted list of dishes.
// While the week is being built its button says so, with how long it has taken, and cannot be
// pressed again; if nothing could be added, a notice says why and points to the other ways.
function WaysIn({ onLink, onPaste, onChange }: {
  onLink: () => void;
  onPaste: () => void;
  onChange: (key: SetupItem['key']) => void;
}) {
  const mp = useMealPlan();
  const week = useBuildWeek();
  const about = useId();
  const days = mp.state.draft.days;
  const p = week.problem;
  // after "Paste a recipe", the way on that fits why it failed
  const second: NoticeAction | null = !p ? null
    : p.code === 'budget_infeasible' ? { label: 'Change the budget', onClick: () => onChange('budget') }
      : p.code === 'none_fit' ? { label: 'Change the diet', onClick: () => onChange('diet') }
        : p.code === 'unreachable' ? { label: 'Try again', icon: 'refresh', onClick: week.build } : null;
  return (
    <section className="mp-ways" aria-label="Ways to add meals">
      <div className="mp-ways-row">
        <button type="button" className="btn btn-primary btn-lg mp-build" aria-describedby={about}
                aria-disabled={week.running || undefined} onClick={week.build}>
          {week.running ? (
            <>
              <Spinner size={18} />Building your week…
              <span className="mp-build-clock" aria-hidden="true">{clockText(week.elapsed)}</span>
            </>
          ) : <><Icon name="sparkle" size={18} />Build a week for me</>}
        </button>
        <button type="button" className="btn btn-secondary btn-lg" aria-haspopup="dialog" onClick={onLink}>
          <Icon name="link" size={18} />From a link
        </button>
        <button type="button" className="btn btn-secondary btn-lg" onClick={onPaste}>
          <Icon name="clipboard" size={18} />Paste a recipe
        </button>
      </div>
      <p id={about} className="mp-ways-about">
        Dinners from the recipe library for your {days} days, within your budget and diet. One Undo takes them out again.
      </p>
      {week.note && <p className="mp-ways-note"><Icon name="info" size={16} />{week.note}</p>}
      {p && (
        <Notice tone="danger" title="Could not build a week" className="mp-ways-problem"
                hint="Paste a recipe or a list of dishes instead, or add meals from the recipes below."
                actions={[{ label: 'Paste a recipe', icon: 'clipboard', onClick: onPaste }, ...(second ? [second] : [])]}>
          {p.text}
        </Notice>
      )}
    </section>
  );
}

// ─── The stage ───────────────────────────────────────────────

// onChange: a Change in the setup strip, which goes back to that answer in Set up.
export function MealsStage({ quickText, setQuickText, onChange }: {
  quickText: string;
  setQuickText: (t: string) => void;
  onChange: (key: SetupItem['key']) => void;
}) {
  const mp = useMealPlan();
  const catalog = useCatalog(true);
  const [importing, setImporting] = useState(false);
  // An Add turns the card's button into a count: focus goes to its plus ("one meal more"), not the page.
  const [focusMore, setFocusMore] = useState<{ key: string } | null>(null);
  useEffect(() => {
    if (focusMore) document.querySelector<HTMLElement>(`[data-more="${CSS.escape(focusMore.key)}"]`)?.focus();
  }, [focusMore]);
  const recipes = useMemo(() => byKey(catalog.answer), [catalog.answer]);
  const spend = estimatedSpend(mp.state, recipes);
  const picks = picksOf(mp.state, recipes);
  const c = catalog.answer;
  const sections = c ? catalogSections(c, mp.state) : [];
  const own = c ? ownRecipes(c, mp.state) : { shown: [], hidden: [] };
  const others = c ? notInCatalog(c, mp.state) : [];

  // One more meal of a recipe: the first adds it to the plan with one meal. The live region
  // hears what changed and what is left of the budget after it.
  const add = (r: CatalogRecipe) => {
    const inPlan = mp.state.draft.recipes[r.key];
    // the shopper's own recipe goes in as saved here, its picture and all
    const own = isMine(r) ? mp.myRecipes.find((x) => x.key === r.key) : undefined;
    const edit: PlanEdit = inPlan ? { type: 'setWanted', key: r.key, wanted: inPlan.wanted + 1 }
      : { type: 'addRecipe', ref: own ? docRef(own) : cleanRef(r.ref), title: r.title, slot: r.slot, wanted: 1 };
    const out = mp.dispatch(edit);
    if (out.refused) return;
    if (!inPlan) setFocusMore({ key: r.key });
    const left = budgetSaid(budgetBar(out.state, estimatedSpend(out.state, recipes)));
    if (left) mp.announce(`${out.said} ${left}`);
  };

  // "Paste a recipe": Quick add, further down, takes the text; focusing it brings it into view.
  const focusQuickAdd = () => document.getElementById('mp-quick-text')?.focus();

  // Quick add can be focused before the recipes arrive (Home's "Try the example" opens the stage
  // on it), and the recipes then push it down the page: brought back into view once they are in,
  // if the keyboard is still there.
  const loaded = c !== null;
  useEffect(() => {
    const field = document.getElementById('mp-quick-text');
    if (loaded && field && document.activeElement === field) field.scrollIntoView({ block: 'center' });
  }, [loaded]);

  return (
    <>
      <SetupStrip onChange={onChange} />
      <WaysIn onLink={() => setImporting(true)} onPaste={focusQuickAdd} onChange={onChange} />
      <BudgetBar spend={spend} pending={!c} />
      {c && spend.unknown.length > 0 && (
        <p className="muted">Not in the estimate (cost unknown): {spend.unknown.join(', ')}.</p>
      )}
      {/* the recipes' own shape while they load, at once: the stage is never empty, and what
          comes after it stays below the fold rather than under the Back and Next bar */}
      {!c && catalog.status !== 'error' && (
        <div className="mp-section">
          <p className="sr-only" role="status">Loading the recipes…</p>
          <ul className="mp-cards" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => <li key={i} className="skel skel-card mp-card-skel" />)}
          </ul>
        </div>
      )}
      {catalog.status === 'error' && (
        <Notice tone="danger" title="The recipes could not be loaded"
                hint="The lists further down still add recipes, without estimates."
                actions={[{ label: 'Try again', icon: 'refresh', onClick: catalog.retry }]}>
          {catalog.error}
        </Notice>
      )}
      {c && <p className="muted mp-est-basis">{estimateText(spend)}</p>}

      {sections.map((sec) => {
        const head = (
          <>
            {sec.label}{' '}
            <span className="muted">
              · {sec.count.filled} of {sec.count.capacity} filled
              {sec.overflow > 0 && `; ${sec.overflow} more than the days hold will wait in the tray`}
            </span>
          </>
        );
        const body = (
          <>
            {sec.shown.length > 0 ? (
              <ul className="mp-cards">
                {sec.shown.map((r) => <RecipeCard key={r.key} r={r} spend={spend} picks={picks} onAdd={add} />)}
              </ul>
            ) : <p className="muted">No {sec.label.toLowerCase()} recipes fit your diet.</p>}
            <Hidden list={sec.hidden} />
          </>
        );
        return sec.collapsed ? (
          <details key={sec.slot} className="mp-section" open={sec.count.meals > 0 || undefined}>
            <summary><h3 className="mp-section-head">{head}</h3></summary>
            {body}
          </details>
        ) : (
          <section key={sec.slot} className="mp-section" aria-label={sec.label}>
            <h3 className="mp-section-head">{head}</h3>
            {body}
          </section>
        );
      })}

      {others.length > 0 && (
        <section className="mp-section" aria-label="Also in this plan">
          <h3 className="mp-section-head">Also in this plan</h3>
          <ul className="mp-add-list">
            {others.map((k) => {
              const r = mp.state.draft.recipes[k];
              const title = recipeTitle(mp.state, k);
              const full = addStop(mp.state.draft, r.slot, r.wanted);
              return (
                <li key={k}>
                  <span>{title} <span className="muted">· cost not estimated</span></span>
                  <span className="mp-stepper">
                    <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label={`One ${title} meal fewer`}
                            disabled={r.wanted <= 0}
                            onClick={() => mp.dispatch({ type: 'setWanted', key: k, wanted: r.wanted - 1 })}><Icon name="minus" size={16} /></button>
                    <output aria-label={`${title} meals`}>{mealsOf(mp.state.draft, k).length}</output>
                    <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label={`One ${title} meal more`}
                            aria-disabled={full ? true : undefined} aria-describedby={full ? `mp-full-${k}` : undefined}
                            onClick={() => { if (!full) mp.dispatch({ type: 'setWanted', key: k, wanted: r.wanted + 1 }); }}><Icon name="plus" size={16} /></button>
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${title} from the plan`}
                            onClick={() => mp.dispatch({ type: 'removeRecipe', key: k })}>Remove</button>
                    {full && <span id={`mp-full-${k}`} className="mp-card-full">{full}.</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mp-more" aria-labelledby="mp-more-head">
        <h3 id="mp-more-head" className="mp-section-head">Other ways to add</h3>
        <QuickAdd text={quickText} setText={setQuickText} />
        <div className="mp-toolbar mp-file">
          <button type="button" className="btn btn-secondary btn-sm" aria-haspopup="dialog"
                  onClick={() => setImporting(true)}>Import a recipe…</button>
        </div>
        {c ? (
          <>
            <h4>My recipes</h4>
            {mp.myRecipesProblem && <Notice tone="warn">{mp.myRecipesProblem}</Notice>}
            {own.shown.length > 0 ? (
              <ul className="mp-cards">
                {own.shown.map((r) => <RecipeCard key={r.key} r={r} spend={spend} picks={picks} onAdd={add} />)}
              </ul>
            ) : (
              <p className="muted">None yet. Recipes you import or paste are saved in this browser and appear here.</p>
            )}
            <Hidden list={own.hidden} />
          </>
        ) : catalog.status === 'error' && <AddRecipes />}
      </section>

      {/* "Add to your plan" in the sheet leaves the recipe in the inbox; it joins the plan here */}
      <ImportSheet open={importing} onClose={() => { setImporting(false); mp.syncSaved(); }} />
    </>
  );
}
