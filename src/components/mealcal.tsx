// The meal plan's calendar: weeks of day cards, each with a Shop row and the meal slots, and
// the ways a meal or a trip moves. One DOM at every width: day cards in date order, laid out
// by CSS as seven columns per week on a wide screen and as an agenda on a phone, so the Tab
// order and what a screen reader hears are the same everywhere.
//
// A meal moves four ways, and all end in one reducer edit:
//   - drag its grip (mouse, pen or finger; usePointerDrag);
//   - tap it, then tap a slot (WCAG 2.5.7's single-pointer path);
//   - its ⋯ menu, the MoveSheet, which shows what each move means for freshness;
//   - the keyboard: Enter or Space picks it up, Tab or the arrow keys reach a slot, Enter
//     places, Escape cancels, Delete sends it back to the tray.
// The decisions are in mealplan/dnd.ts and consequences.ts; this file draws them.
import { useMemo } from 'react';
import type { KeyboardEvent, MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { dayLabel } from '../mealplan/dates';
import { mealsByCell, shownSlots, tripChipText, tripLook, tripsByDate } from '../mealplan/board';
import { moveChoices } from '../mealplan/consequences';
import type { MoveChoice } from '../mealplan/consequences';
import { canDrop, keyIntent, keyMove, shopKey, slotLabel } from '../mealplan/dnd';
import type { DragPayload } from '../mealplan/dnd';
import {
  MAX_SERVINGS, SLOT_LABELS, cellKey, parseCellKey, recipeTitle, weeksOf, windowOf,
} from '../mealplan/model';
import type { MealPlanState, PlanEdit, Slot } from '../mealplan/model';
import type { Meal, MealSchedule, Trip, TripStrategy } from '../types';
import { DayNutritionLine, MealEnergy, RecipeNutrition } from './nutrition';
import { Sheet } from './Sheet';
import type { DragView } from './usePointerDrag';

// Everything the board needs from the view that owns the plan and the gesture.
export interface BoardCtl {
  state: MealPlanState;
  schedule: MealSchedule | null;
  strategy: TripStrategy;
  held: DragPayload | null;        // picked up by a tap or the keyboard
  drag: DragView | null;           // being dragged
  grip: (payload: DragPayload) => { onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void };
  dispatch: (e: PlanEdit) => void;
  pick: (payload: DragPayload) => void;        // toggles holding it
  dropOn: (key: string) => void;               // put what is held there
  openMeal: (mealId: string) => void;
  openTrip: (trip: Trip) => void;
  atRisk: Set<string>;             // meals a must-fix warning names, under this strategy
  hideEmpty: boolean;
}

const title = (ctl: BoardCtl, m: Meal) => recipeTitle(ctl.state, m.recipe_key);

// The payload in play, held or dragged.
const moving = (ctl: BoardCtl): DragPayload | null => ctl.drag?.payload ?? ctl.held;

function heldTitle(ctl: BoardCtl): string | null {
  const p = moving(ctl);
  if (p?.kind !== 'meal') return null;
  const m = ctl.state.draft.meals.find((x) => x.id === p.mealId);
  return m ? title(ctl, m) : null;
}

// ─── The board ───────────────────────────────────────────────

export function PlanBoard({ ctl }: { ctl: BoardCtl }) {
  const d = ctl.state.draft;
  const weeks = weeksOf(windowOf(d));
  const cells = useMemo(() => mealsByCell(ctl.state), [ctl.state]);
  const trips = useMemo(() => tripsByDate(ctl.schedule?.strategies.find((s) => s.name === ctl.strategy)),
    [ctl.schedule, ctl.strategy]);
  const days = useMemo(() => new Map((ctl.schedule?.days ?? []).map((x) => [x.date, x])), [ctl.schedule]);
  const slots = shownSlots(ctl.state, ctl.hideEmpty);

  // Arrow keys move between the slot buttons shown while a meal is held: an enhancement over
  // Tab, which screen readers in browse mode leave alone.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const key = target.getAttribute('data-cell');
    if (!key || keyIntent(e, { holding: true, inText: false }) !== 'move') return;
    const cell = parseCellKey(key);
    if (!cell) return;
    const next = keyMove(cell, e.key, windowOf(d), slots);
    e.preventDefault();
    if (!next) return;
    const el = e.currentTarget.querySelector<HTMLElement>(`[data-cell="${cellKey(next.date, next.slot)}"]`);
    el?.focus();
  };

  return (
    <div className="mp-board" onKeyDown={onKeyDown}>
      {weeks.map((week, i) => (
        <section key={week[0]} className="mp-week" aria-label={`Week ${i + 1}, from ${dayLabel(week[0])}`}>
          {week.map((date) => (
            <DayCard key={date} ctl={ctl} date={date} slots={slots} cells={cells} trip={trips.get(date) ?? null}
                     footer={<DayNutritionLine day={days.get(date)?.nutrition}
                                               coverage={ctl.schedule?.coverage.nutrition}
                                               targets={d.nutrition_targets} />} />
          ))}
        </section>
      ))}
    </div>
  );
}

export function DayCard({ ctl, date, slots, cells, trip, footer }: {
  ctl: BoardCtl;
  date: string;
  slots: Slot[];
  cells: Map<string, Meal[]>;
  trip: Trip | null;
  footer: ReactNode;
}) {
  return (
    <article className="mp-day" aria-label={dayLabel(date)}>
      <h3 className="mp-day-head">{dayLabel(date)}</h3>
      <ShopRow ctl={ctl} date={date} trip={trip} />
      {slots.map((slot) => (
        <SlotCell key={slot} ctl={ctl} date={date} slot={slot} meals={cells.get(cellKey(date, slot)) ?? []} />
      ))}
      <footer className="mp-day-foot">{footer}</footer>
    </article>
  );
}

// ─── Shop row and trip chips ─────────────────────────────────

export function ShopRow({ ctl, date, trip }: { ctl: BoardCtl; date: string; trip: Trip | null }) {
  const d = ctl.state.draft;
  const key = shopKey(date);
  const p = moving(ctl);
  const target = p?.kind === 'trip' && canDrop(p, key);
  const dismissed = d.dismissed_dates.includes(date);
  return (
    <div className="mp-shop" data-drop={key} data-target={target || undefined}
         data-over={ctl.drag?.over === key || undefined}>
      <span className="mp-row-k">Shop</span>
      {trip && <TripChip ctl={ctl} trip={trip} />}
      {!trip && dismissed && <span className="muted mp-shop-none">no trip (you dismissed it)</span>}
      {target && ctl.held && (
        <button type="button" className="mp-slot-target" data-cell-shop={date} onClick={() => ctl.dropOn(key)}>
          Move the trip to {dayLabel(date)}
        </button>
      )}
    </div>
  );
}

export function TripChip({ ctl, trip }: { ctl: BoardCtl; trip: Trip }) {
  const look = tripLook(trip);
  const payload: DragPayload = { kind: 'trip', tripId: trip.id, date: trip.date };
  const held = moving(ctl)?.kind === 'trip' && (moving(ctl) as { tripId: string }).tripId === trip.id;
  // An approved trip stays where it is until the approval is taken back.
  const movable = look.kind === 'suggested';
  return (
    <div className={`mp-trip mp-trip-${look.kind}`} data-held={held || undefined}>
      {movable && <span className="mp-grip" aria-hidden="true" title="Drag to another day's Shop row" {...ctl.grip(payload)} />}
      <button type="button" className="mp-trip-main" onClick={() => ctl.openTrip(trip)}
              aria-label={`Shopping trip ${dayLabel(trip.date)}: ${tripChipText(trip)}. Open the list.`}>
        <span className="mp-trip-word">{look.mark && <span aria-hidden="true">{look.mark} </span>}{look.word}</span>
        <span className="mp-trip-cost">{trip.total_is_floor ? '≥ ' : ''}${trip.total_cost.toFixed(2)} · {trip.lines.length} items</span>
      </button>
    </div>
  );
}

// ─── Slots and meal chips ────────────────────────────────────

export function SlotCell({ ctl, date, slot, meals }: { ctl: BoardCtl; date: string; slot: Slot; meals: Meal[] }) {
  const key = cellKey(date, slot);
  const p = moving(ctl);
  const target = p?.kind === 'meal' && canDrop(p, key);
  const holding = heldTitle(ctl);
  return (
    <div className="mp-slot" data-drop={key} data-target={target || undefined}
         data-over={ctl.drag?.over === key || undefined}>
      <span className="mp-row-k">{SLOT_LABELS[slot]}</span>
      {meals.map((m) => <MealChip key={m.id} ctl={ctl} meal={m} />)}
      {ctl.held?.kind === 'meal' && holding && !meals.some((m) => m.id === (ctl.held as { mealId: string }).mealId) && (
        <button type="button" className="mp-slot-target" data-cell={key} onClick={() => ctl.dropOn(key)}
                aria-label={slotLabel({ date, slot }, holding, meals.map((m) => title(ctl, m)))}>
          {meals.length ? 'Swap here' : 'Place here'}
        </button>
      )}
    </div>
  );
}

export function MealChip({ ctl, meal, inTray = false }: { ctl: BoardCtl; meal: Meal; inTray?: boolean }) {
  const t = title(ctl, meal);
  const p = moving(ctl);
  const held = p?.kind === 'meal' && p.mealId === meal.id;
  const risk = ctl.atRisk.has(meal.id);
  const n = ctl.schedule?.recipe_nutrition?.[meal.recipe_key];
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const intent = keyIntent(e, { holding: held, inText: false });
    if (intent === 'tray' && !inTray) {
      e.preventDefault();
      ctl.dispatch({ type: 'unplace', mealId: meal.id });
    }
  };
  const servings = meal.servings ? ` · serves ${meal.servings}` : '';
  return (
    <div className="mp-chip" data-meal={meal.id} data-held={held || undefined} data-risk={risk || undefined}>
      <span className="mp-grip" aria-hidden="true" title="Drag to move" {...ctl.grip({ kind: 'meal', mealId: meal.id })} />
      <button type="button" className="mp-chip-main" aria-pressed={held} onKeyDown={onKeyDown}
              onClick={() => ctl.pick({ kind: 'meal', mealId: meal.id })}
              aria-label={`${t}${meal.date && meal.slot ? `, ${SLOT_LABELS[meal.slot]} ${dayLabel(meal.date)}` : ', in the tray'}`
                + `${risk ? ', has a freshness problem' : ''}${meal.pinned && meal.date ? ', pinned' : ''}`
                + `. ${held ? 'Picked up: choose a slot, or Escape' : 'Pick up to move'}`}>
        <span className="mp-chip-title">{t}</span>
        <span className="mp-chip-meta">
          {risk && <span className="mp-mark-warn" aria-hidden="true" title="A freshness problem: see Must fix">⚠</span>}
          {meal.pinned && meal.date && <span aria-hidden="true" title="Pinned: Suggest cook days leaves it">📌</span>}
          {servings && <span>{servings.slice(3)}</span>}
        </span>
      </button>
      <span className="mp-chip-nut"><MealEnergy n={n} /></span>
      <button type="button" className="mp-chip-more" onClick={() => ctl.openMeal(meal.id)}
              aria-label={`More for ${t}: move, servings, nutrition`}>⋯</button>
    </div>
  );
}

// ─── The bar shown while something is held ───────────────────

export function ActionBar({ ctl, onCancel, onTray }: { ctl: BoardCtl; onCancel: () => void; onTray: () => void }) {
  const p = ctl.held;
  if (!p) return null;
  const meal = p.kind === 'meal' ? ctl.state.draft.meals.find((m) => m.id === p.mealId) : undefined;
  return (
    <div className="mp-bar" role="region" aria-label="Moving">
      {p.kind === 'meal' && meal ? (
        <span>Placing <strong>{title(ctl, meal)}</strong>: tap a slot, or use Tab and Enter</span>
      ) : (
        <span>Moving the trip on <strong>{p.kind === 'trip' ? dayLabel(p.date) : ''}</strong>: tap another day's Shop row</span>
      )}
      <span className="mp-bar-actions">
        {p.kind === 'meal' && meal?.date && (
          <button type="button" className="secondary mini" onClick={onTray}>Back to tray</button>
        )}
        <button type="button" className="secondary mini" onClick={onCancel}>Cancel</button>
      </span>
    </div>
  );
}

// The ghost that follows the pointer while dragging: the name, and where it would land.
export function DragGhost({ ctl, ghostRef, preview }: {
  ctl: BoardCtl;
  ghostRef: MutableRefObject<HTMLDivElement | null>;
  preview: string | null;
}) {
  const p = ctl.drag?.payload;
  if (!p) return null;
  const meal = p.kind === 'meal' ? ctl.state.draft.meals.find((m) => m.id === p.mealId) : undefined;
  const name = meal ? title(ctl, meal) : `Trip ${p.kind === 'trip' ? dayLabel(p.date) : ''}`;
  const where = ctl.drag?.over ? preview : p.kind === 'meal'
    ? "Can't drop here: meals go in meal slots or the tray" : "Can't drop here: trips go on a Shop row";
  return (
    <div className="mp-ghost" ref={ghostRef} aria-hidden="true">
      <strong>{name}</strong>
      {where && <div className="mp-ghost-note">{where}</div>}
    </div>
  );
}

// ─── Move sheet ──────────────────────────────────────────────

// The ⋯ menu: every cell the meal could go to, each with what it would mean for freshness
// (a preview from the last answer), plus its servings, its pin, and its nutrition receipt.
export function MoveSheet({ ctl, mealId, onClose }: {
  ctl: BoardCtl;
  mealId: string | null;
  onClose: () => void;
}) {
  const { dispatch } = ctl;
  const meal = mealId ? ctl.state.draft.meals.find((m) => m.id === mealId) : undefined;
  const choices = useMemo(() => (meal ? moveChoices(ctl.state, ctl.schedule, meal.id) : []),
    [ctl.state, ctl.schedule, meal]);
  const byDate = useMemo(() => {
    const out = new Map<string, MoveChoice[]>();
    for (const c of choices) out.set(c.date, [...(out.get(c.date) ?? []), c]);
    return [...out.entries()];
  }, [choices]);
  if (!meal) return null;
  const t = title(ctl, meal);
  const household = ctl.state.draft.prefs.household_servings;
  const servings = meal.servings ?? null;
  const go = (e: PlanEdit) => {
    dispatch(e);
    onClose();
  };
  return (
    <Sheet open={Boolean(meal)} onClose={onClose} title={`Move ${t}`}
           description={meal.date && meal.slot ? `Now: ${SLOT_LABELS[meal.slot]}, ${dayLabel(meal.date)}` : 'Now: in the tray'}
           footer={<>
             {meal.date && <button type="button" className="secondary" onClick={() => go({ type: 'unplace', mealId: meal.id })}>Back to tray</button>}
             <button type="button" className="danger" onClick={() => go({ type: 'remove', mealId: meal.id })}>Remove this meal</button>
           </>}>
      <div className="mp-move-opts">
        <label className="mp-stepper">
          <span>Serves</span>
          <button type="button" className="secondary mini" aria-label="One person fewer"
                  disabled={(servings ?? household) <= 1}
                  onClick={() => dispatch({ type: 'setMealServings', mealId: meal.id, servings: Math.max(1, (servings ?? household) - 1) })}>−</button>
          <output aria-live="polite">{servings ?? household}</output>
          <button type="button" className="secondary mini" aria-label="One person more"
                  disabled={(servings ?? household) >= MAX_SERVINGS}
                  onClick={() => dispatch({ type: 'setMealServings', mealId: meal.id, servings: Math.min(MAX_SERVINGS, (servings ?? household) + 1) })}>+</button>
          <span className="muted">{servings === null ? '(your household)' : '(this meal only)'}</span>
          {servings !== null && (
            <button type="button" className="linkish" onClick={() => dispatch({ type: 'setMealServings', mealId: meal.id, servings: null })}>
              back to the household
            </button>
          )}
        </label>
        {meal.date && (
          <label className="check">
            <input type="checkbox" checked={meal.pinned}
                   onChange={(e) => dispatch({ type: 'setPinned', mealId: meal.id, pinned: e.target.checked })} />
            Pinned: Suggest cook days leaves it where it is
          </label>
        )}
      </div>
      <RecipeNutrition n={ctl.schedule?.recipe_nutrition?.[meal.recipe_key]} title={t} />
      <h4>Move to <span className="muted">(freshness is a preview from the last check)</span></h4>
      {byDate.map(([date, list]) => (
        <div key={date} className="mp-move-day">
          <div className="mp-move-date">{dayLabel(date)}</div>
          {list.map((c) => (
            <button key={c.slot} type="button" disabled={Boolean(c.blocked)}
                    className={`mp-move-choice mp-move-${c.consequence.level}`}
                    onClick={() => go({ type: 'place', mealId: meal.id, date: c.date, slot: c.slot,
                      swapWith: c.swapWith ?? undefined })}>
              <span className="mp-move-slot">
                {c.consequence.level === 'warn' && <span aria-hidden="true">⚠ </span>}
                {SLOT_LABELS[c.slot]}{c.swapWith && !c.blocked ? ' (swap)' : ''}
              </span>
              <span className="mp-move-why" title={c.consequence.lines.join(' ')}>
                {c.blocked ?? (c.consequence.lines.length > 2
                  ? `${c.consequence.lines.slice(0, 2).join(' ')} And ${c.consequence.lines.length - 2} more.`
                  : c.consequence.lines.join(' '))}
              </span>
            </button>
          ))}
        </div>
      ))}
    </Sheet>
  );
}
