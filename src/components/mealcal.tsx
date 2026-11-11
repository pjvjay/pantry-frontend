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
//
// The Shopping plan stage shows the trips alone as a week strip (WeekStrip): each day's Shop row
// and how many meals are cooked that day. Its trips move the same ways, and a Move button picks
// one up from the keyboard.
import { useMemo } from 'react';
import type { KeyboardEvent, MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { dayLabel } from '../mealplan/dates';
import {
  costText, mealCountText, mealsByCell, mealsByDay, shownSlots, tripChipText, tripLook, tripPriced, tripsByDate,
} from '../mealplan/board';
import { moveChoices } from '../mealplan/consequences';
import type { MoveChoice } from '../mealplan/consequences';
import { canDrop, keyIntent, keyMove, shopKey, slotLabel } from '../mealplan/dnd';
import type { DragPayload } from '../mealplan/dnd';
import type { PictureSource } from '../mealplan/images';
import {
  SLOT_LABELS, approvedElsewhere, cellKey, parseCellKey, recipeTitle, weeksOf, windowOf,
} from '../mealplan/model';
import type { MealPlanState, PlanEdit, Slot } from '../mealplan/model';
import type { Meal, MealSchedule, Trip, TripStrategy } from '../types';
import { DayNutritionLine, MealEnergy, RecipeNutrition } from './nutrition';
import { RecipePicture } from './pictures';
import { Sheet } from './Sheet';
import type { DragView } from './usePointerDrag';
import { Icon } from './icons';
import { useKeepClear } from './useKeepClear';
import type { TripLook } from '../mealplan/board';

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
  pictures?: Map<string, PictureSource | null>;   // each recipe's, for its cards (mealplan/images.ts)
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
  // Tab, which screen readers in browse mode leave alone. They start from wherever focus is in
  // a slot: its button, the held meal itself (focus stays there after Enter picks it up), or a
  // meal it would swap with.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (ctl.held?.kind !== 'meal' || keyIntent(e, { holding: true, inText: false }) !== 'move') return;
    const target = e.target as HTMLElement;
    const key = target.getAttribute('data-cell') ?? target.closest('.mp-slot')?.getAttribute('data-drop');
    const cell = key ? parseCellKey(key) : null;
    if (!cell) return;
    e.preventDefault();
    const next = keyMove(cell, e.key, windowOf(d), slots);
    if (!next) return;
    const k = cellKey(next.date, next.slot);
    // The held meal's own cell has no button, so its chip takes focus and the next arrow
    // carries on from there.
    const el = e.currentTarget.querySelector<HTMLElement>(`[data-cell="${k}"]`)
      ?? e.currentTarget.querySelector<HTMLElement>(`[data-drop="${k}"] .mp-chip[data-held] .mp-chip-main`);
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

// keyMove: the trip chip has a Move button (the week strip), for picking it up from the keyboard.
export function ShopRow({ ctl, date, trip, keyMove = false }: { ctl: BoardCtl; date: string; trip: Trip | null;
  keyMove?: boolean }) {
  const d = ctl.state.draft;
  const key = shopKey(date);
  const p = moving(ctl);
  const target = p?.kind === 'trip' && canDrop(p, key);
  const dismissed = d.dismissed_dates.includes(date);
  return (
    <div className="mp-shop" data-drop={key} data-target={target || undefined}
         data-over={ctl.drag?.over === key || undefined}>
      <span className="mp-row-k">Shop</span>
      {trip && <TripChip ctl={ctl} trip={trip} keyMove={keyMove} />}
      {!trip && dismissed && <span className="muted mp-shop-none">no trip (you dismissed it)</span>}
      {target && ctl.held && (
        <button type="button" className="mp-slot-target" data-cell-shop={date} onClick={() => ctl.dropOn(key)}>
          Move the trip to {dayLabel(date)}
        </button>
      )}
    </div>
  );
}

// The icon beside a trip's state words (tripLook in mealplan/board.ts), so the state is never said
// by colour alone: a tick when approved (here or under the other strategy), a warning when it has
// changed since; a suggested trip has none. Drawn wherever the state is (this chip, the trips list,
// the trip sheet's description); the words themselves carry no sign, and say it to a screen reader.
export function TripMark({ kind }: { kind: TripLook['kind'] }) {
  if (kind === 'suggested') return null;
  return <Icon name={kind === 'review' ? 'alert' : 'check'} className="ico-inline" />;
}

export function TripChip({ ctl, trip, keyMove = false }: { ctl: BoardCtl; trip: Trip; keyMove?: boolean }) {
  const elsewhere = approvedElsewhere(ctl.state.draft, trip.date, ctl.strategy);
  const look = tripLook(trip, elsewhere);
  const payload: DragPayload = { kind: 'trip', tripId: trip.id, date: trip.date };
  const held = moving(ctl)?.kind === 'trip' && (moving(ctl) as { tripId: string }).tripId === trip.id;
  // An approved trip stays where it is until the approval is taken back, under either strategy.
  const movable = look.kind === 'suggested';
  return (
    <div className={`mp-trip mp-trip-${look.kind}`} data-trip={trip.date} data-held={held || undefined}>
      {movable && <span className="mp-grip" aria-hidden="true" title="Drag to another day's Shop row" {...ctl.grip(payload)} />}
      <button type="button" className="mp-trip-main" onClick={() => ctl.openTrip(trip)}
              aria-label={`Shopping trip ${dayLabel(trip.date)}: ${tripChipText(trip, elsewhere)}. Open the list.`}>
        <span className="mp-trip-word"><TripMark kind={look.kind} />{look.word}</span>
        <span className="mp-trip-cost">
          {costText(trip.total_cost, trip.total_is_floor, tripPriced(trip), '≥ ')} · {trip.lines.length}
          {trip.lines.length === 1 ? ' item' : ' items'}
        </span>
      </button>
      {keyMove && movable && (
        <button type="button" className="secondary mini mp-trip-move" aria-pressed={held}
                aria-label={held ? `Put the trip on ${dayLabel(trip.date)} down` : `Move the trip on ${dayLabel(trip.date)}`}
                onClick={() => ctl.pick(payload)}>
          {held ? 'Moving…' : 'Move'}
        </button>
      )}
    </div>
  );
}

// ─── The week strip ──────────────────────────────────────────

// The plan's days in weeks, each with its Shop row (the trip, a drop target for another one) and
// how many meals are cooked that day. One column a day on a wide screen, a row a day on a phone.
export function WeekStrip({ ctl }: { ctl: BoardCtl }) {
  const d = ctl.state.draft;
  const trips = useMemo(() => tripsByDate(ctl.schedule?.strategies.find((s) => s.name === ctl.strategy)),
    [ctl.schedule, ctl.strategy]);
  const meals = useMemo(() => mealsByDay(d), [d]);
  return (
    <div className="mp-strip" role="group" aria-label="Trips by day">
      {weeksOf(windowOf(d)).map((week, i) => (
        <ol key={week[0]} className="mp-strip-week" aria-label={`Week ${i + 1}, from ${dayLabel(week[0])}`}>
          {week.map((date) => (
            <li key={date} className="mp-strip-day">
              <span className="mp-strip-date">{dayLabel(date)}</span>
              <ShopRow ctl={ctl} date={date} trip={trips.get(date) ?? null} keyMove />
              <span className="muted mp-strip-meals">{mealCountText(meals.get(date) ?? 0)}</span>
            </li>
          ))}
        </ol>
      ))}
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
  const slot = meal.slot ?? ctl.state.draft.recipes[meal.recipe_key]?.slot ?? 'dinner';
  return (
    <div className="mp-chip" data-meal={meal.id} data-held={held || undefined} data-risk={risk || undefined}>
      <span className="mp-grip" aria-hidden="true" title="Drag to move" {...ctl.grip({ kind: 'meal', mealId: meal.id })} />
      <RecipePicture pic={ctl.pictures?.get(meal.recipe_key) ?? null} slot={slot} size="thumb" />
      <button type="button" className="mp-chip-main" aria-pressed={held} onKeyDown={onKeyDown}
              onClick={() => ctl.pick({ kind: 'meal', mealId: meal.id })}
              aria-label={`${t}${meal.date && meal.slot ? `, ${SLOT_LABELS[meal.slot]} ${dayLabel(meal.date)}` : ', in the tray'}`
                + `${risk ? ', has a freshness problem' : ''}${meal.pinned && meal.date ? ', pinned' : ''}`
                + `. ${held ? 'Picked up: choose a slot, or Escape' : 'Pick up to move'}`}>
        <span className="mp-chip-title">{t}</span>
        <span className="mp-chip-meta">
          {risk && <span className="mp-mark-warn" aria-hidden="true" title="A freshness problem: see Must fix"><Icon name="alert" size={13} /></span>}
          {meal.pinned && meal.date && <span aria-hidden="true" title="Pinned: Suggest cook days leaves it"><Icon name="pushpin" size={13} /></span>}
          {servings && <span>{servings.slice(3)}</span>}
        </span>
      </button>
      <span className="mp-chip-nut"><MealEnergy n={n} /></span>
      <button type="button" className="mp-chip-more" onClick={() => ctl.openMeal(meal.id)}
              aria-label={`More for ${t}: move, servings, nutrition`}><Icon name="more" size={18} /></button>
    </div>
  );
}

// ─── The bar shown while something is held ───────────────────

// It lies over the bottom of the page while something is held, which is when the keyboard Tabs
// to the slots and days below: those come to rest above it, not under it (useKeepClear).
export function ActionBar({ ctl, onCancel, onTray }: { ctl: BoardCtl; onCancel: () => void; onTray: () => void }) {
  const keepClear = useKeepClear('bottom');
  const p = ctl.held;
  if (!p) return null;
  const meal = p.kind === 'meal' ? ctl.state.draft.meals.find((m) => m.id === p.mealId) : undefined;
  return (
    <div ref={keepClear} className="mp-bar" role="region" aria-label="Moving">
      {p.kind === 'meal' && meal ? (
        <span>Placing <strong>{title(ctl, meal)}</strong>: tap a slot, or use Tab and Enter</span>
      ) : (
        <span>Moving the trip on <strong>{p.kind === 'trip' ? dayLabel(p.date) : ''}</strong>: tap another day's Shop row</span>
      )}
      <span className="mp-bar-actions">
        {p.kind === 'meal' && meal?.date && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onTray}>Back to tray</button>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
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
//
// The sheet stays mounted while the board is shown, closed when no meal is asked for, so it
// leaves the way every sheet does: it slides out showing what it showed, and focus goes back to
// the ⋯ that opened it. After a move that ⋯ is gone with the chip's old place; the view then
// focuses the chip where it landed (or, for a meal taken out, its recipe's "one meal more").
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
  if (!meal) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const t = title(ctl, meal);
  const go = (e: PlanEdit) => {
    dispatch(e);
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={`Move ${t}`}
           description={meal.date && meal.slot ? `Now: ${SLOT_LABELS[meal.slot]}, ${dayLabel(meal.date)}` : 'Now: in the tray'}
           footer={<>
             {meal.date && <button type="button" className="btn btn-secondary" onClick={() => go({ type: 'unplace', mealId: meal.id })}>Back to tray</button>}
             <button type="button" className="btn btn-danger" onClick={() => go({ type: 'remove', mealId: meal.id })}>Remove this meal</button>
           </>}>
      <div className="mp-move-opts">
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
                {c.consequence.level === 'warn' && <Icon name="alert" className="ico-inline" />}
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
