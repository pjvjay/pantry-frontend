// The wizard's Check ingredients stage: for every chosen recipe, each ingredient as the plan would
// buy it (/mealplan/basket): the product, how sure the match is, the store and how far it is, the
// price, where it is from and how that is known, and its labels, with the basket's total next to
// the budget. Choosing an ingredient opens its Options across the whole plan
// (components/tripoptions.tsx with no trip): the products that could take its place, ranked, and
// the recipes a choice changes; one choice pins every line that buys it, as one undo step.
//
// It reads top down, as a task: a header with how far the check has got over a real bar
// ("Checking the products for 4 recipes…", then "33 of 35 found nearby · 2 to answer"); then the
// ingredients the plan cannot buy nearby that still need an answer, pinned as a short task list,
// each with its answers: another product (its Options), skip this ingredient (the recipe goes
// without it), or other meals (back to Pick meals), and for one sold only at stores the shopper
// turned off, turning a store back on. Place on days waits until each has one. Then every recipe
// as a card of quiet rows, a skeleton of rows in its place while its products are checked. "Your
// stores" sits beside them on a wide screen, staying in view, and lights the store a row is
// bought at; on a phone it comes before the recipes. The words are in mealplan/basket.ts and
// mealplan/check.ts. Where every row would say the same about its origin ("origin unknown · not
// checked", as in the demo), the header says it once and the rows leave it out.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

import { basketAtLeast, basketCounts, basketView, originCoverage, originCoverageText } from '../mealplan/basket';
import type { LineView, RecipeView } from '../mealplan/basket';
import { againstBudget } from '../mealplan/catalog';
import { answerLabel, atRiskTasks, checkProgress, checkedText, issueText, recipeCountText, toAnswerText } from '../mealplan/check';
import type { Answer, AtRisk, CheckProgress } from '../mealplan/check';
import { USABLE_RESOLVE, budgetOf, recipeTitle } from '../mealplan/model';
import { useMealPlan, useStores } from '../mealplan/store';
import type { KeyedCall } from '../mealplan/store';
import { clockText, originRules } from '../mealplan/wizard';
import type { WizardFacts } from '../mealplan/wizard';
import type { MealBasket } from '../types';
import { Icon } from './icons';
import type { IconName } from './icons';
import { EvidenceMark, MatchTag } from './matchmarks';
import { ServingsPrompt } from './mealtray';
import { ProductPicture, RecipePicture } from './pictures';
import { STORES_HEAD, StoresPanel } from './stores';
import { TripLineOptionsDialog } from './tripoptions';
import { EmptyState, Notice, Skeleton, Tag } from './ui';
import { useElapsed } from './useElapsed';

type Open = (l: LineView) => void;
// the store a row is bought at, lit on the map while the row is pointed at or focused
type Hot = (store: string | null) => void;

// The header's heading: focus lands here once the last ingredient is answered.
const CHECK_HEAD = 'mp-check-head';

// A row of the task list, and its answer buttons, found again after a render.
const taskSelector = (key: string) => `[data-task="${CSS.escape(key)}"] button`;
const rowSelector = (key: string) => `[data-ing-line="${CSS.escape(key)}"]`;

const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const lowerFirst = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

// ─── The header ──────────────────────────────────────────────

// How far the check has got, in words over a bar, and the basket's total. The bar shows what the
// words say (found, skipped, still to answer; recipes checked while their products are), so it is
// decoration to a screen reader; while a check is under way a sweep runs along it, which holds
// still under reduced motion.
function CheckHeader({ progress, total, coverage, origin, elapsed }: {
  progress: CheckProgress;
  total: { text: string; over: boolean } | null;
  coverage: { text: string; flag: boolean } | null;
  // what every row would say about its origin, said here once instead
  origin: LineView | null;
  elapsed: number | null;
}) {
  const p = progress;
  const pct = (n: number) => `${p.max > 0 ? (n / p.max) * 100 : 0}%`;
  const found = p.value ?? 0;
  const done = p.state === 'done';
  return (
    <section className={`card mp-check-head mp-check-${p.state}`} aria-labelledby={CHECK_HEAD}>
      <div className="mp-check-top">
        <h3 id={CHECK_HEAD} className="mp-check-title" tabIndex={-1}>{p.head}</h3>
        {done && p.open > 0 && <Tag kind="attention">{p.note}</Tag>}
        {done && p.open === 0 && p.max > 0 && <Tag kind="done">{p.skipped ? p.note : 'All found'}</Tag>}
        {!done && p.note && <span className="mp-check-note">{p.note}</span>}
        {elapsed !== null && <span className="mp-check-clock" aria-hidden="true">{clockText(elapsed)}</span>}
      </div>
      {/* sweeping while a check is under way, over whatever it has measured so far */}
      <div className={`mp-check-bar${p.state === 'products' || p.state === 'ingredients' ? ' mp-check-bar-sweep' : ''}`}
           aria-hidden="true">
        {p.value !== null && (
          <>
            <span className="mp-check-bar-found" style={{ width: pct(found) }} />
            {p.skipped > 0 && <span className="mp-check-bar-skipped" style={{ width: pct(p.skipped) }} />}
            {p.open > 0 && <span className="mp-check-bar-open" style={{ width: pct(p.open) }} />}
          </>
        )}
      </div>
      {/* a key once the bar has more than one part to tell apart */}
      {done && (p.skipped > 0 || p.open > 0) && (
        <ul className="mp-check-key" aria-hidden="true">
          <li><span className="mp-check-key-found" />Found nearby</li>
          {p.skipped > 0 && <li><span className="mp-check-key-skipped" />Skipped</li>}
          {p.open > 0 && <li><span className="mp-check-key-open" />To answer</li>}
        </ul>
      )}
      {total && (
        <div className="mp-check-total">
          <p className={total.over ? 'mp-check-over' : undefined}>
            {total.over && <Icon name="alert" size={16} />}<strong>Basket</strong> {total.text}
          </p>
          {/* the caveat, for whoever wants it, out of the way of the task */}
          <details className="mp-check-about">
            <summary>How this is counted</summary>
            <p>
              In whole packs, each product bought once at the cheapest store near you. Your trips buy on
              different days and can cost more: Shop has their totals.
            </p>
          </details>
        </div>
      )}
      {coverage && (
        <p className="mp-check-coverage">{coverage.flag && <Icon name="alert" size={14} />}{coverage.text}</p>
      )}
      {origin && (
        <p className="mp-check-coverage mp-ing-origin">
          Every product here: {lowerFirst(origin.origin.text)}
          <EvidenceMark kind={origin.evidence.kind} word={origin.evidence.word} />
        </p>
      )}
    </section>
  );
}

// ─── The task list ───────────────────────────────────────────

const ANSWER_ICON: Record<Answer, IconName> = { stores: 'store', product: 'swap', skip: 'ban', meals: 'utensils' };

// The ingredients still to answer, at the top. Each answer is a button; "Another product" opens the
// ingredient's Options, and focus comes back to it (data-ing-line) unless the choice answered it.
function AtRiskList({ tasks, onAnswer }: { tasks: AtRisk[]; onAnswer: (t: AtRisk, a: Answer) => void }) {
  const head = useId();
  return (
    <section className="card mp-tasks" aria-labelledby={head}>
      <h3 id={head} className="mp-tasks-title">
        <Icon name="alert" size={20} />{toAnswerText(tasks.length)}
      </h3>
      <p className="mp-tasks-lede">
        The plan cannot buy {tasks.length === 1 ? 'this' : 'these'} near you. Choose what to do
        for each: Place on days waits for every answer.
      </p>
      <ol className="mp-tasks-list">
        {tasks.map((t) => {
          const l = t.line;
          const issue = issueText(l);
          return (
            <li key={l.key} className="mp-task" data-task={l.key}>
              <ProductPicture product={l.productName} ingredient={l.ingredient} />
              <div className="mp-task-main">
                <p className="mp-task-what">
                  <strong className="mp-task-name">{cap(l.ingredient)}</strong>
                  <span className="mp-task-for">for {t.recipe}</span>
                </p>
                <p className="mp-task-issue"><strong>{issue.head}</strong>
                  {issue.why && <span className="mp-task-why"> · {issue.why}</span>}</p>
                {l.product && <p className="mp-task-had">Planned: {l.product}</p>}
                <div className="mp-task-answers" role="group" aria-label={`${cap(l.ingredient)}: what to do`}>
                  {t.answers.map((a) => (
                    <button key={a} type="button" className="btn btn-secondary btn-sm"
                            aria-haspopup={a === 'product' ? 'dialog' : undefined}
                            data-ing-line={a === 'product' ? l.key : undefined} onClick={() => onAnswer(t, a)}>
                      <Icon name={ANSWER_ICON[a]} size={16} />{answerLabel(a, l)}
                    </button>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ─── A recipe's rows ─────────────────────────────────────────

// One ingredient as a row: its product's picture, its name and the product, the price, then the
// need, store and cost, how sure the match is, its origin and how that is known, its labels. The
// row is one button that opens the ingredient's Options (its words name the product and price; the
// rest describes it), so a click anywhere on it, Enter or Space open them. A row the plan cannot
// buy that is answered (skipped, or its recipe has no meals now) stays quiet and says so; one
// still to answer is in the task list above instead.
// origin: the row says its own origin (false when the header says the one every row shares).
function Line({ l, title, onOptions, onHot, origin }: { l: LineView; title: string; onOptions: Open; onHot: Hot;
  origin: boolean }) {
  const mp = useMealPlan();
  const facts = useId();
  // Needed after all: the row goes back up to the task list, and the keyboard with it, a moment
  // later, once it is drawn there.
  const need = () => {
    const out = mp.dispatch({ type: 'skipLine', recipeKey: l.recipeKey, lineNo: l.lineNo, ingredient: l.ingredient,
      skip: false });
    if (!out.refused) window.setTimeout(() => document.querySelector<HTMLElement>(taskSelector(l.key))?.focus(), 0);
  };
  const meta = [l.need, l.available ? l.store : '', l.available ? l.cost : ''].filter(Boolean).join(' · ');
  const lit = { onMouseEnter: () => onHot(l.storeName), onMouseLeave: () => onHot(null),
    onFocus: () => onHot(l.storeName), onBlur: () => onHot(null) };
  const cls = `mp-ing${l.issue ? ' mp-ing-missing' : ''}${l.skipped ? ' mp-ing-skipped' : ''}`;
  return (
    <li className={cls}>
      <button type="button" className="mp-ing-open" aria-haspopup="dialog" aria-label={l.optionsLabel}
              aria-describedby={facts} data-ing-line={l.key} onClick={() => onOptions(l)} {...lit}>
        <ProductPicture product={l.productName} ingredient={l.ingredient} />
        <span className="mp-ing-main">
          <span className="mp-ing-title">
            <span className="mp-ing-name">{l.ingredient}</span>
            <span className="mp-ing-product">{l.product ?? 'nothing chosen yet'}</span>
          </span>
          <span id={facts} className="mp-ing-about">
            {l.issue && (
              <span className="mp-ing-issue">
                <Icon name="alert" size={16} />
                <strong>{l.skipped ? `Skipped: ${l.issue.label.charAt(0).toLowerCase()}${l.issue.label.slice(1)}` : l.issue.label}</strong>
              </span>
            )}
            {meta && <span className="mp-ing-meta">{meta}</span>}
            <span className="mp-ing-facts">
              {l.grade && <MatchTag kind={l.grade.kind} label={l.grade.label} />}
              {origin && (
                <span className="mp-ing-origin">
                  <span className="muted">{l.origin.text}</span>
                  <EvidenceMark kind={l.evidence.kind} word={l.evidence.word} />
                </span>
              )}
              {l.labels.map((x) => <span key={x} className="chip">{x}</span>)}
              {l.shared && <span className="muted">{l.shared}</span>}
            </span>
          </span>
        </span>
        <span className="mp-ing-side">
          {l.available && <span className="mp-ing-price">{l.price}</span>}
          <span className="mp-ing-go" aria-hidden="true">Options<Icon name="chevron-right" size={14} /></span>
        </span>
      </button>
      {l.skipped && (
        <div className="mp-ing-answer">
          <span className="muted">{title} goes without it.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={need}>Need it after all</button>
        </div>
      )}
    </li>
  );
}

// A recipe's card: its picture and name, its counts, and its rows; those still to answer wait in
// the task list above, and the count says so.
function RecipeIngredients({ r, onOptions, onHot, servings, origin }: { r: RecipeView; onOptions: Open; onHot: Hot;
  servings: boolean; origin: boolean }) {
  const head = useId();
  const quiet = r.lines.filter((l) => l.answered);
  return (
    <section className="card mp-ing-recipe" aria-labelledby={head}>
      <div className="mp-ing-recipe-head">
        <RecipePicture pic={r.picture} slot={r.slot} size="head" />
        <div>
          <h3 id={head} className="mp-ing-recipe-title">{r.title}</h3>
          <p className="mp-ing-recipe-sub">{recipeCountText(r)}</p>
        </div>
      </div>
      {servings && <ServingsPrompt recipeKey={r.key} title={r.title} />}
      {r.meals === 0 && <p className="muted">No meals of it in the plan: nothing is bought for it.</p>}
      {r.lines.length === 0 && <p className="muted">No ingredients to show yet.</p>}
      {quiet.length > 0 && (
        <ul className="mp-ing-lines">
          {quiet.map((l) => <Line key={l.key} l={l} title={r.title} onOptions={onOptions} onHot={onHot} origin={origin} />)}
        </ul>
      )}
    </section>
  );
}

// A recipe the basket has nothing for yet: while its products are checked, rows in the shape of
// what is coming; when its check answered with a problem, why and what can be done, in its place.
// (A call that failed for every recipe is said once, over the task list, with Try again.)
function RecipeShell({ title, slot, sub, children }: { title: string; slot: RecipeView['slot']; sub: string;
  children?: ReactNode }) {
  const head = useId();
  return (
    <section className="card mp-ing-recipe mp-ing-shell" aria-labelledby={head}>
      <div className="mp-ing-recipe-head">
        <RecipePicture pic={null} slot={slot} size="head" />
        <div>
          <h3 id={head} className="mp-ing-recipe-title">{title}</h3>
          <p className="mp-ing-recipe-sub">{sub}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

// ─── The stage ───────────────────────────────────────────────

export function IngredientsStage({ basket, facts, onMeals }: { basket: KeyedCall<MealBasket>; facts: WizardFacts;
  onMeals: () => void }) {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const stores = useStores(true);
  // the ingredient whose Options are open, by its line, so the sheet follows the row's answers
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  // the store the row under the pointer (or focus) is bought at, lit on the map beside
  const [hotStore, setHotStore] = useState<string | null>(null);
  // The ingredient Options was opened from: focus goes back to it, in the task list while it still
  // needs an answer, else to its row in its recipe (the one element that carries its line).
  const openedFrom = useRef('');
  const returnTo = useMemo<RefObject<HTMLElement | null>>(() => ({
    get current() {
      return openedFrom.current ? document.querySelector<HTMLElement>(rowSelector(openedFrom.current)) : null;
    },
  }), []);

  const b = basket.answer;
  const view = useMemo(() => (b ? basketView(b, mp.state) : null), [b, mp.state]);
  const tasks = useMemo(() => (view ? atRiskTasks(view.recipes) : []), [view]);
  const keys = Object.keys(d.recipes);
  // A recipe's rows once its products are checked: before that the basket lists it with none, and
  // its card shows rows in their shape instead.
  const checked = (k: string) => Boolean(d.resolved[k]) && USABLE_RESOLVE.includes(d.resolved[k].status);
  const ready = view?.recipes.filter((r) => checked(r.key)) ?? [];
  const shown = new Set(ready.map((r) => r.key));
  // the origin every row shown would say, when they all say the same: said once, in the header
  const rows = ready.flatMap((r) => r.lines.filter((l) => l.answered));
  const sameOrigin = rows.length > 1 && rows.every((l) => l.origin.text === rows[0].origin.text
    && l.evidence.kind === rows[0].evidence.kind && l.evidence.word === rows[0].evidence.word) ? rows[0] : null;
  // Origin coverage, said only when the plan has origin rules: they act on known origins only.
  const rules = originRules(d.settings);
  const hasRules = rules.excludeUS || rules.preferCanada || rules.allies.length > 0;
  const covered = b && hasRules ? originCoverage(b) : null;
  const coverageText = covered ? originCoverageText(covered) : null;
  const coverage = coverageText && covered ? { text: coverageText, flag: covered.known === 0 } : null;
  const open = optionsFor ? view?.recipes.flatMap((r) => r.lines).find((l) => l.key === optionsFor) ?? null : null;

  const progress = checkProgress({ recipes: keys.length, checking: facts.checking, failed: facts.failed,
    basket: facts.basket, counts: b ? basketCounts(b, mp.state) : null });
  const pending = progress.state === 'products' || progress.state === 'ingredients';
  const elapsed = useElapsed(pending);
  // the basket's total once every recipe's products are in it (while it is checked again after an
  // edit, the last one, which the header says is being checked)
  const total = b && (progress.state === 'done' || progress.state === 'ingredients')
    ? againstBudget(b.est_total, basketAtLeast(b), budgetOf(d.prefs)) : null;

  // Once a check that was under way is in, a screen reader hears what it found, once.
  const was = useRef(progress.state);
  useEffect(() => {
    const before = was.current;
    was.current = progress.state;
    if ((before === 'products' || before === 'ingredients') && progress.state === 'done') mp.announce(checkedText(progress));
    // the words are read when the state turns; mp is the same throughout
  }, [progress.state]);

  // "Turn a store back on": the stores panel, its heading focused
  const toStores = () => {
    const h = document.getElementById(STORES_HEAD);
    h?.scrollIntoView({ block: 'start' });
    if (h) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    }
  };

  // Focus that was in the task list when its task went (answered there, or by the basket's next
  // answer after a product was chosen): to the ingredient's row in its recipe when it is now
  // bought, else to the next task still to answer, else to the header, never to the page.
  const taskFocus = useRef<{ key: string; index: number } | null>(null);
  const taskKeys = tasks.map((t) => t.line.key).join('|');
  useLayoutEffect(() => {
    const at = taskFocus.current;
    if (!at || tasks.some((t) => t.line.key === at.key)) return;
    taskFocus.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const line = view?.recipes.flatMap((r) => r.lines).find((l) => l.key === at.key);
    const next = tasks[Math.min(at.index, tasks.length - 1)];
    const target = (line?.available && document.querySelector<HTMLElement>(rowSelector(at.key)))
      || (next && document.querySelector<HTMLElement>(taskSelector(next.line.key)))
      || document.getElementById(CHECK_HEAD);
    target?.focus();
  }, [taskKeys]);

  const answer = (t: AtRisk, a: Answer) => {
    const l = t.line;
    taskFocus.current = { key: l.key, index: tasks.findIndex((x) => x.line.key === l.key) };
    if (a === 'stores') toStores();
    else if (a === 'meals') onMeals();
    else if (a === 'product') {
      openedFrom.current = l.key;
      setOptionsFor(l.key);
    } else {
      // skipped: said in a toast whose Undo puts it back on the list (not in the live region too),
      // and the keyboard back on it, a moment later, once it is drawn again
      const out = mp.dispatch({ type: 'skipLine', recipeKey: l.recipeKey, lineNo: l.lineNo, ingredient: l.ingredient,
        skip: true }, { quiet: true });
      if (out.refused) return;
      mp.toastUndo(out.said, () => {
        window.setTimeout(() => document.querySelector<HTMLElement>(taskSelector(l.key))?.focus(), 0);
      });
    }
  };

  if (!keys.length) {
    return (
      <div className="mp-check mp-check-empty">
        <EmptyState icon="utensils" className="mp-check-none" status="No recipes yet."
                    cue="Pick some meals: their ingredients are checked here against the stores near you."
                    action={{ label: 'Pick meals', onClick: onMeals }} />
        <div className="mp-check-side"><StoresPanel stores={stores} /></div>
      </div>
    );
  }

  // recipes the basket has, in its order, then those it has nothing for yet, in the plan's
  const rest = keys.filter((k) => !shown.has(k));
  // the products call itself failed, for every recipe still waiting on it
  const callFailed = mp.resolve.status === 'error' && rest.some((k) => !d.resolved[k]);
  const servingsAsked = (k: string) => d.resolved[k]?.status === 'needs_servings' && d.recipes[k].servings == null;

  return (
    <div className="mp-check">
      <div className="mp-check-lead">
        <CheckHeader progress={progress} total={total} coverage={coverage} origin={sameOrigin}
                     elapsed={pending ? elapsed : null} />
        {/* A call that failed is said once, here, with its reason and Try again (the header says
            what could not be checked); a recipe its check answered with a problem says so in its
            own card below. */}
        {callFailed && (
          <Notice tone="danger" hint="Place on days waits until they are checked or taken out of the plan."
                  actions={[{ label: 'Try again', icon: 'refresh', onClick: () => mp.retryResolve() }]}>
            {mp.resolve.error}
          </Notice>
        )}
        {basket.status === 'error' && (
          <Notice tone="danger" actions={[{ label: 'Try again', icon: 'refresh', onClick: basket.retry }]}>
            {basket.error}
          </Notice>
        )}
      </div>

      {tasks.length > 0 && (
        <div className="mp-check-tasks"
             onFocus={(e) => {
               const key = (e.target as HTMLElement).closest('[data-task]')?.getAttribute('data-task');
               if (key) taskFocus.current = { key, index: tasks.findIndex((x) => x.line.key === key) };
             }}
             onBlur={(e) => {
               // focus moved on to something else on purpose (not lost with its task)
               if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) taskFocus.current = null;
             }}>
          <AtRiskList tasks={tasks} onAnswer={answer} />
        </div>
      )}

      <div className="mp-check-side">
        <StoresPanel stores={stores} lit={hotStore} basket={b} />
      </div>

      <div className="mp-check-recipes">
        {ready.map((r) => (
          <RecipeIngredients key={r.key} r={r} onHot={setHotStore} servings={servingsAsked(r.key)} origin={!sameOrigin}
                             onOptions={(l) => {
                               openedFrom.current = l.key;
                               setOptionsFor(l.key);
                             }} />
        ))}
        {rest.map((k) => {
          const r = d.resolved[k];
          const title = recipeTitle(mp.state, k);
          const slot = d.recipes[k].slot;
          const failedCall = !r && mp.resolve.status === 'error';
          if (r && USABLE_RESOLVE.includes(r.status)) {
            // its products are checked; its ingredients come with the basket (or failed with it, above)
            return basket.status === 'error'
              ? <RecipeShell key={k} title={title} slot={slot} sub="Its ingredients could not be checked: try again above" />
              : (
                <RecipeShell key={k} title={title} slot={slot} sub="Checking its ingredients at the stores…">
                  <Skeleton kind="row" count={4} label={`Checking the ingredients of ${title}`} />
                </RecipeShell>
              );
          }
          const takeOut = () => mp.dispatch({ type: 'removeRecipe', key: k });
          if (!r && !failedCall) {
            return (
              <RecipeShell key={k} title={title} slot={slot} sub="Checking its products…">
                <Skeleton kind="row" count={4} label={`Checking the products for ${title}`} />
              </RecipeShell>
            );
          }
          if (!r) {
            // the call for every recipe failed: said once above, with Try again
            return (
              <RecipeShell key={k} title={title} slot={slot} sub="Not checked yet: try again above">
                <button type="button" className="btn btn-ghost btn-sm mp-ing-out" onClick={takeOut}>Take it out</button>
              </RecipeShell>
            );
          }
          return (
            <RecipeShell key={k} title={title} slot={slot} sub="Its products could not be checked">
              <Notice tone="danger" title={`The products for ${title} could not be checked`}
                      hint="Place on days waits until it is checked or taken out of the plan."
                      actions={[
                        { label: 'Try again', icon: 'refresh', onClick: () => mp.retryResolve(k) },
                        { label: 'Take it out', onClick: takeOut },
                      ]}>
                {r.message || r.status.replace(/_/g, ' ')}
              </Notice>
            </RecipeShell>
          );
        })}
      </div>

      <TripLineOptionsDialog date={null} productId={open?.productId ?? null} productName={open ? open.product ?? open.ingredient : ''}
                             line={open && open.productId === null ? {
                               recipeKey: open.recipeKey, lineNo: open.lineNo, ingredient: open.ingredient,
                               skipped: open.skipped, onMeals, onStores: toStores, stores: stores.answer,
                             } : null}
                             onClose={() => setOptionsFor(null)} returnTo={returnTo} />
    </div>
  );
}
