// Options on a meal-plan trip line: the chat cart's Options dialog (components/alternatives.tsx)
// fed by pantry-api's /mealplan/alternatives over REST, so it works wherever the Meal plan does,
// with no hub (the Hugging Face Space, AKS). The rows are pantry-api's ranking for every recipe
// line the purchase covers, each with what choosing it does to the plan's trips.
//
// "Use this" pins the product on each of those lines as one edit, so one Undo puts it back. The
// plan as it would be is scheduled first (no model call): a choice pantry-api refuses says why in
// the dialog and changes nothing, and otherwise that answer is shown at once. Focus then returns
// to the trip line that now buys the chosen product.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { scheduleMealPlan, tripLineOptions } from '../api';
import { strategyOf } from '../mealplan/board';
import { step } from '../mealplan/model';
import {
  choiceAnnouncement, chosenLineKey, optionsDescription, optionsEdit, stockNotice, tripLineKey,
} from '../mealplan/options';
import { useMealPlan } from '../mealplan/store';
import type { TripLineOptions } from '../types';
import { AlternativesDialog } from './alternatives';

export function TripLineOptionsDialog({ date, productId, productName, onClose }: {
  date: string;
  // null: closed
  productId: number | null;
  productName: string;
  onClose: () => void;
}) {
  const mp = useMealPlan();
  const strategy = mp.state.draft.prefs.strategy;
  const [opts, setOpts] = useState<TripLineOptions | null>(null);
  // The draft the next load sends: the latest, not the one of the render that made `load`.
  const draft = useRef(mp.state.draft);
  draft.current = mp.state.draft;

  // The trip line focus returns to: the one the dialog was opened from, or after a choice the
  // line that now buys the chosen product (a new element, found by its data-trip-line).
  const focusKey = useRef('');
  const openKey = productId === null ? '' : tripLineKey(date, productId);
  useEffect(() => {
    if (openKey) focusKey.current = openKey;
    setOpts(null);
  }, [openKey]);
  const returnFocus = useMemo<RefObject<HTMLElement | null>>(() => ({
    get current() {
      return focusKey.current
        ? document.querySelector<HTMLElement>(`[data-trip-line="${focusKey.current}"]`) : null;
    },
  }), []);

  const load = (limit: number) => tripLineOptions({ draft: draft.current, trip_date: date,
    product_id: productId as number, strategy, limit }).then((o) => {
    setOpts(o);
    return o.ranking;
  });

  const choose = async (chosen: number | null) => {
    if (!opts) return;
    const edit = optionsEdit(opts.lines, chosen, mp.state.draft.pins);
    if (!edit) {
      onClose();
      return;
    }
    // What the edit will make, the next rev, scheduled before anything changes.
    const trial = step(mp.state, edit);
    if (trial.refused) throw new Error(trial.refused);
    const answer = await scheduleMealPlan(trial.state.draft);
    const before = strategyOf(mp.schedule.answer, strategy)?.trips.find((t) => t.date === date);
    const after = strategyOf(answer, strategy)?.trips.find((t) => t.date === date);
    const pick = chosen ?? opts.lines[0]?.planner_product_id ?? null;
    // the planner's own pick may have no row (no store in range sells it): its line names it
    const name = opts.ranking.items.find((it) => it.product_id === pick)?.product
      ?? after?.lines.find((ln) => ln.product.id === pick)?.product.name ?? 'the planner’s pick';
    const out = mp.dispatch(edit);
    if (out.refused) throw new Error(out.refused);
    focusKey.current = chosenLineKey(opts, chosen);
    mp.adoptSchedule(answer);
    mp.announce(choiceAnnouncement(opts, name, before, after));
    onClose();
  };

  return (
    <AlternativesDialog
      conversationId={null}
      target={productId === null ? null : {
        ref: 0, pinned: opts?.pinned ?? false,
        line: { line_no: productId, product: productName,
          ingredient: opts?.ranking.ingredient || productName },
      }}
      blocked=""
      returnFocus={returnFocus}
      onChoose={choose}
      onClose={onClose}
      load={load}
      loadKey={`${openKey}@${mp.state.draft.rev}`}
      place="trip"
      description={opts ? optionsDescription(opts) : undefined}
      notice={opts ? stockNotice(opts) : ''}
    />
  );
}
