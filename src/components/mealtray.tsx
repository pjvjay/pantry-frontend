// The meal plan's tray and Quick add: what to cook and how many times. Quick add reads a sentence ("3
// Pepperoni Pizza + 2 Chicken Fried Rice + 3 chicken briyani + 7 mango milkshakes in 2 weeks")
// into chips; only an exact or plural match goes in without asking, and anything matched by an
// alias or by spelling is a one-tap question. Each recipe in the plan has a count (a count is
// one meal: every plan is for one person for now), a slot, and its meals still waiting in
// the tray. A recipe that does not say how many it serves asks the shopper, and the answer is
// labelled as theirs. The wizard shows Quick add in Meals, beside the recipe cards, and the tray
// on Schedule, as the sidebar beside the board.
import { useEffect, useId, useRef, useState } from 'react';

import { getRecipes } from '../api';
import { trayRows } from '../mealplan/board';
import type { TrayRow } from '../mealplan/board';
import { canDrop, TRAY_KEY } from '../mealplan/dnd';
import { SLOTS, SLOT_LABELS, USABLE_RESOLVE, docRef, libraryRef, starterRef } from '../mealplan/model';
import type { Slot } from '../mealplan/model';
import { addStop } from '../mealplan/room';
import { accepted, chipText, countLine, decide, waiting } from '../mealplan/selectionPreview';
import type { Preview, PreviewItem } from '../mealplan/selectionPreview';
import { useMealPlan } from '../mealplan/store';
import type { Recipe } from '../types';
import { Icon } from './icons';
import { MealChip } from './mealcal';
import type { BoardCtl } from './mealcal';
import { RecipePicture } from './pictures';
import { Sheet } from './Sheet';

// The sentence the plan was written around; the first-run sheet offers it as an example.
export const EXAMPLE_SENTENCE =
  '3 Pepperoni Pizza + 2 Chicken Fried Rice + 3 chicken briyani + 7 mango milkshakes in 2 weeks';

// ─── Quick add ───────────────────────────────────────────────

function QuickChip({ item, index, household, onDecide }: {
  item: PreviewItem;
  index: number;
  household: number;
  onDecide: (i: number, d: Parameters<typeof decide>[2]) => void;
}) {
  const decided = item.decision !== null;
  const using = decided && item.decision !== 'reject';
  return (
    <li className={`mp-qchip mp-qchip-${item.state}${item.decision === 'reject' ? ' mp-qchip-off' : ''}`}>
      <div>
        {using && <Icon name="check" className="ico-inline" />}
        {chipText(item, household)}
        {using && <span className="muted"> · {countLine(item.count, household)}</span>}
        {!item.countStated && item.state !== 'unmatched' && <span className="muted"> · no count given, so 1</span>}
      </div>
      {item.state === 'confirm' && !decided && item.match && (
        <div className="mp-qchip-actions">
          <button type="button" className="mini" onClick={() => onDecide(index, { use: item.match?.recipe_key ?? '' })}>
            Use {item.match.title}
          </button>
          <button type="button" className="secondary mini" onClick={() => onDecide(index, 'reject')}>Not this</button>
        </div>
      )}
      {item.state === 'choose' && !decided && (
        <div className="mp-qchip-actions">
          {item.candidates.map((c) => (
            <button key={c.recipe_key} type="button" className="secondary mini"
                    onClick={() => onDecide(index, { use: c.recipe_key })}>
              {c.title} <span className="muted">({c.label})</span>
            </button>
          ))}
          <button type="button" className="secondary mini" onClick={() => onDecide(index, 'reject')}>None of these</button>
        </div>
      )}
      {decided && item.state !== 'unmatched' && (
        <button type="button" className="linkish" onClick={() => onDecide(index, item.state === 'ready' && item.decision === 'reject'
          ? { use: item.match?.recipe_key ?? '' } : item.state === 'ready' ? 'reject' : null)}>
          {item.state === 'ready' ? (item.decision === 'reject' ? 'add it back' : 'leave it out') : 'change'}
        </button>
      )}
    </li>
  );
}

export function QuickAdd({ text, setText }: { text: string; setText: (t: string) => void }) {
  const mp = useMealPlan();
  const household = mp.state.draft.prefs.household_servings;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<'idle' | 'reading' | 'error'>('idle');
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const read = () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setStatus('reading');
    setProblems([]);
    mp.quickAdd(text, c.signal).then((p) => {
      setPreview(p);
      setStatus('idle');
      const ask = waiting(p);
      mp.announce(`${p.items.length} dishes read${ask ? `; ${ask} to confirm` : ''}.`);
    }).catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    });
  };

  const add = () => {
    if (!preview) return;
    const out = mp.acceptPreview(preview);
    setProblems(out.problems);
    if (out.outcome && !out.outcome.refused) {
      setPreview(null);
      setText('');
    }
  };

  const going = preview ? accepted(preview) : [];
  const ask = preview ? waiting(preview) : 0;
  return (
    <div className="mp-quick">
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) read(); }}>
        <label className="mp-quick-label" htmlFor="mp-quick-text">Quick add</label>
        <div className="search mp-quick-row">
          <span className="search-ico"><Icon name="sparkle" size={18} /></span>
          <input id="mp-quick-text" className="search-input" value={text} onChange={(e) => setText(e.target.value)}
                 maxLength={8000} placeholder={EXAMPLE_SENTENCE} autoComplete="off" />
          <button type="submit" className="mini" disabled={!text.trim() || status === 'reading'}>
            {status === 'reading' ? 'Reading…' : 'Read'}
          </button>
        </div>
      </form>
      {status === 'error' && <p className="banner banner-error">Could not read that: {error}</p>}
      {preview && (
        <div className="mp-preview" aria-label="What Quick add read">
          <ul className="mp-qchips">
            {preview.items.map((item, i) => (
              <QuickChip key={`${item.input}-${i}`} item={item} index={i} household={household}
                         onDecide={(j, d) => setPreview((p) => (p ? decide(p, j, d) : p))} />
            ))}
          </ul>
          {preview.periodDays !== null && (
            <p className="muted">
              The plan will cover {preview.periodDays} days
              {preview.periodDays === mp.state.draft.days ? ' (as now)' : ` (now ${mp.state.draft.days})`}.
            </p>
          )}
          {preview.warnings.map((w) => <p key={w} className="cart-flag">{w}</p>)}
          {problems.map((p) => <p key={p} className="cart-flag">Not added: {p}</p>)}
          <div className="mp-trip-actions">
            <button type="button" disabled={!going.length} onClick={add}>
              {going.length ? `Add ${going.reduce((t, a) => t + a.count, 0)} meals to the plan` : 'Nothing to add yet'}
            </button>
            <button type="button" className="secondary" onClick={() => setPreview(null)}>Discard</button>
            {ask > 0 && <span className="muted">{ask} still to answer; unanswered ones are left out</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Recipes in the plan ─────────────────────────────────────

export function ServingsPrompt({ recipeKey, title }: { recipeKey: string; title: string }) {
  const mp = useMealPlan();
  const [value, setValue] = useState('');
  const n = Number(value);
  const ok = Number.isInteger(n) && n >= 1 && n <= 100;
  return (
    <form className="mp-servings" onSubmit={(e) => {
      e.preventDefault();
      if (ok) mp.dispatch({ type: 'setRecipeServings', key: recipeKey, servings: n });
    }}>
      <label htmlFor={`mp-servings-${recipeKey}`}>How many does {title} serve?</label>
      <input id={`mp-servings-${recipeKey}`} inputMode="numeric" value={value} size={4}
             onChange={(e) => setValue(e.target.value)} aria-describedby={`mp-servings-why-${recipeKey}`} />
      <button type="submit" className="mini" disabled={!ok}>Save</button>
      <div id={`mp-servings-why-${recipeKey}`} className="muted">
        The recipe does not say. Until you answer, its amounts, packs and nutrition stay unknown.
      </div>
    </form>
  );
}

// A recipe in the sidebar: its picture and name, how many of its meals are placed, its count
// and meal, what is wrong with it, and the meals still to place as cards to drag onto the board.
function RecipeRow({ row, ctl }: { row: TrayRow; ctl: BoardCtl }) {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const r = d.recipes[row.key];
  const resolved = d.resolved[row.key];
  const pending = mp.resolve.pending.includes(row.key);
  const label = resolved?.label ?? (row.key.startsWith('my:') ? 'my recipe' : row.key.startsWith('starter:')
    ? 'demo recipe' : null);
  const answered = r.servings ?? null;
  const needsServings = resolved?.status === 'needs_servings' && answered === null;
  const full = addStop(d, r.slot, r.wanted);
  const done = row.wanted > 0 && row.placed >= row.wanted;
  return (
    <li className={`mp-recipe${done ? ' mp-recipe-done' : ''}`}>
      <div className="mp-recipe-head">
        <RecipePicture pic={ctl.pictures?.get(row.key) ?? null} slot={row.slot} size="head" />
        <div className="mp-recipe-what">
          <strong className="mp-recipe-title">{row.title}</strong>
          <span className="mp-recipe-meta">
            <span className="mp-recipe-placed">
              {done && <Icon name="check" size={14} />}{row.placed} of {row.wanted} placed
            </span>
            {label && <span className={`chip ${label.startsWith('demo') ? 'chip-warn' : 'chip-muted'}`}>{label}</span>}
          </span>
          <span className="mp-recipe-meter" aria-hidden="true">
            <span style={{ width: `${row.wanted ? Math.min(100, Math.round((row.placed / row.wanted) * 100)) : 0}%` }} />
          </span>
        </div>
        <button type="button" className="mp-recipe-remove" aria-label={`Remove ${row.title} from the plan`}
                title="Remove from the plan" onClick={() => mp.dispatch({ type: 'removeRecipe', key: row.key })}><Icon name="x" size={16} /></button>
      </div>
      <div className="mp-recipe-ctl">
        <span className="mp-stepper">
          <button type="button" className="secondary mini btn-ico" aria-label={`One ${row.title} meal fewer`}
                  disabled={row.wanted <= 0}
                  onClick={() => mp.dispatch({ type: 'setWanted', key: row.key, wanted: row.wanted - 1 })}><Icon name="minus" size={14} /></button>
          <output aria-label={`${row.title} meals`}>{row.wanted}</output>
          <button type="button" className="secondary mini btn-ico" aria-label={`One ${row.title} meal more`}
                  aria-disabled={full ? true : undefined} aria-describedby={full ? `mp-full-${row.key}` : undefined}
                  onClick={() => { if (!full) mp.dispatch({ type: 'setWanted', key: row.key, wanted: row.wanted + 1 }); }}><Icon name="plus" size={14} /></button>
        </span>
        <label className="mp-inline">
          as
          <select value={row.slot} onChange={(e) => mp.dispatch({ type: 'setRecipeSlot', key: row.key, slot: e.target.value as Slot })}>
            {SLOTS.map((sl) => <option key={sl} value={sl}>{SLOT_LABELS[sl]}</option>)}
          </select>
        </label>
      </div>
      {full && <div id={`mp-full-${row.key}`} className="mp-card-full">{full}.</div>}
      {pending && mp.resolve.status !== 'error' && <div className="muted">Checking products…</div>}
      {pending && mp.resolve.status === 'error' && (
        <div className="cart-flag">
          Products not checked: {mp.resolve.error}{' '}
          <button type="button" className="linkish" onClick={() => mp.retryResolve()}>Try again</button>
        </div>
      )}
      {resolved && !USABLE_RESOLVE.includes(resolved.status) && (
        <div className="cart-flag">
          {resolved.message || resolved.status.replace(/_/g, ' ')}{' '}
          <button type="button" className="linkish" onClick={() => mp.retryResolve(row.key)}
                  aria-label={`Check products for ${row.title} again`}>Try again</button>
        </div>
      )}
      {needsServings && <ServingsPrompt recipeKey={row.key} title={row.title} />}
      {answered !== null && resolved?.status === 'needs_servings' && (
        <div className="muted">
          Serves {answered} (your answer){' '}
          <button type="button" className="linkish"
                  onClick={() => mp.dispatch({ type: 'setRecipeServings', key: row.key, servings: null })}>change</button>
        </div>
      )}
      {resolved && (resolved.not_stocked.length + resolved.out_of_range.length + resolved.skipped.length) > 0 && (
        <div className="muted mp-recipe-note">
          Not bought: {[...resolved.not_stocked, ...resolved.out_of_range, ...resolved.skipped]
            .map((x) => x.ingredient).join(', ')}
        </div>
      )}
      {row.waiting.length > 0 && (
        <ul className="mp-tray-chips" aria-label={`${row.title}: ${row.waiting.length} to place`}>
          {row.waiting.map((m) => <li key={m.id}><MealChip ctl={ctl} meal={m} inTray /></li>)}
        </ul>
      )}
    </li>
  );
}

// ─── Adding recipes ──────────────────────────────────────────

// The starters, the library and My recipes as plain lists: the wizard's Meals stage falls back
// to these when the catalog cannot be had.
export function AddRecipes() {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const [library, setLibrary] = useState<Recipe[]>([]);
  const [libError, setLibError] = useState('');
  useEffect(() => {
    getRecipes().then(setLibrary).catch((e: Error) => setLibError(e.message));
  }, []);
  const inPlan = (key: string) => Boolean(d.recipes[key]);
  const addButton = (key: string, onAdd: () => void, name: string) => (
    <button type="button" className="secondary mini btn-ico" disabled={inPlan(key)} onClick={onAdd}
            aria-label={inPlan(key) ? `${name} is in the plan` : `Add ${name}`}>
      {inPlan(key) ? 'in the plan' : <><Icon name="plus" size={14} />Add</>}
    </button>
  );
  return (
    <details className="mp-add">
      <summary>Add a recipe</summary>
      <h4>Demo starters <span className="muted">(demo recipes)</span></h4>
      <ul className="mp-add-list">
        {mp.starters.map((st) => (
          <li key={st.key}>
            <span>{st.title} <span className="muted">· serves {st.servings} · {SLOT_LABELS[st.slot]}</span></span>
            {addButton(st.doc_key, () => mp.dispatch({ type: 'addRecipe', ref: starterRef(st.key), title: st.title,
              slot: st.slot, wanted: 1 }), st.title)}
          </li>
        ))}
        {!mp.starters.length && <li className="muted">Starters are loading, or this API has none.</li>}
      </ul>
      <h4>Library <span className="muted">(demo house amounts)</span></h4>
      {libError && <p className="cart-flag">Could not load the library: {libError}</p>}
      <ul className="mp-add-list">
        {library.map((r) => (
          <li key={r.slug}>
            <span>{r.name} <span className="muted">· serves {r.servings}</span></span>
            {addButton(`lib:${r.slug}`, () => mp.dispatch({ type: 'addRecipe', ref: libraryRef(r.slug), title: r.name,
              slot: 'dinner', wanted: 1 }), r.name)}
          </li>
        ))}
      </ul>
      <h4>My recipes</h4>
      {mp.myRecipesProblem && <p className="cart-flag">{mp.myRecipesProblem}</p>}
      <ul className="mp-add-list">
        {mp.myRecipes.map((doc) => (
          <li key={doc.key}>
            <span>{doc.title} <span className="muted">· {doc.servings ? `serves ${doc.servings}` : 'servings not stated'}</span></span>
            {addButton(doc.key, () => mp.dispatch({ type: 'addRecipe', ref: docRef(doc), title: doc.title,
              slot: 'dinner', wanted: 1 }), doc.title)}
          </li>
        ))}
        {!mp.myRecipes.length && (
          <li className="muted">None yet. Recipes you import or paste are saved in this browser and appear here.</li>
        )}
      </ul>
    </details>
  );
}

// ─── The tray ────────────────────────────────────────────────

// The Schedule stage's sidebar, a sprint board's backlog: the plan's recipes, each with its
// picture, how many of its meals are placed, and the ones still to place as cards to drag onto
// the board, tap or pick up from the keyboard. The whole sidebar is the tray's drop target, so a
// meal dragged back anywhere on it goes back. Beside the board on a wide screen, where it stays
// in view as the board scrolls; above it on a phone, where it folds away.
export function RecipeTray({ ctl, emptyText }: { ctl: BoardCtl; emptyText: string }) {
  const head = useId();
  const body = useId();
  const [open, setOpen] = useState(true);
  const rows = trayRows(ctl.state);
  const p = ctl.drag?.payload ?? ctl.held;
  const meal = p?.kind === 'meal' ? ctl.state.draft.meals.find((m) => m.id === p.mealId) : undefined;
  const target = p?.kind === 'meal' && canDrop(p, TRAY_KEY) && meal?.date !== null;
  const toPlace = rows.reduce((t, r) => t + r.waiting.length, 0);
  return (
    <aside className={`mp-tray mp-side${open ? '' : ' mp-side-shut'}`} aria-labelledby={head} data-drop={TRAY_KEY}
           data-target={target || undefined} data-over={ctl.drag?.over === TRAY_KEY || undefined}>
      <div className="mp-side-head">
        <h3 id={head} className="mp-side-title">
          <Icon name="list" size={18} />Recipes
          {rows.length > 0 && <span className="mp-side-count">{toPlace ? `${toPlace} to place` : 'all placed'}</span>}
        </h3>
        <button type="button" className="secondary mini mp-side-fold" aria-expanded={open} aria-controls={body}
                onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {target && ctl.held && (
        <button type="button" className="mp-slot-target" onClick={() => ctl.dropOn(TRAY_KEY)}>
          Put it back in the tray
        </button>
      )}
      <div id={body} className="mp-side-body">
        {rows.length === 0 ? <p className="mp-empty">{emptyText}</p>
          : <ul className="mp-recipes">{rows.map((row) => <RecipeRow key={row.key} row={row} ctl={ctl} />)}</ul>}
      </div>
    </aside>
  );
}

// ─── First run ───────────────────────────────────────────────

export function FirstRunSheet({ open, onClose, onExample }: {
  open: boolean;
  onClose: () => void;
  onExample: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Plan meals for a week or two"
           footer={<>
             <button type="button" className="secondary" onClick={onClose}>Start with an empty plan</button>
             <button type="button" onClick={() => { onExample(); onClose(); }}>Try the example</button>
           </>}>
      <ol className="mp-firstrun">
        <li><strong>Basics</strong>: one or two weeks, a budget, your diet and where your food comes from.</li>
        <li><strong>Meals</strong>: add breakfasts, lunches and dinners; the budget bar says what is left. A count is one meal.</li>
        <li><strong>Ingredients</strong>: what each recipe buys, where, for how much and from which country; choose another product or skip one nobody nearby sells.</li>
        <li><strong>Schedule</strong> meals on days: drag a meal's grip, tap a meal and then a slot, use its More menu, or the keyboard (Enter to pick up, Tab to a slot, Enter to place).</li>
        <li><strong>Shopping plan</strong>: code suggests the fewest trips that keep each item within its cited storage time. You approve, move or dismiss each one; an approved trip is never rewritten.</li>
        <li><strong>Calendar</strong>: the trips and cook days, with times and reminders, as a file or in Google Calendar.</li>
      </ol>
      <p>The example reads: <q>{EXAMPLE_SENTENCE}</q></p>
      <p className="muted">
        Stores, prices, stock, the demo starter recipes and the library's amounts are demo data. The plan is
        saved in this browser only.
      </p>
    </Sheet>
  );
}
