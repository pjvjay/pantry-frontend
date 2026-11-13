// "Options for garlic": the other products that could fill one line of a chat cart, in the
// planner's own order, opened from the cart line. The cart's pick sits on top; each row shows
// pantry's facts and reasons, says what is unknown, and says why it sits below the row above.
// "Use this" re-prices the cart with no model call; the assistant hears about it with the next
// message. The ranking and the re-price come from the hub, which holds the plan: the browser
// sends only the card's ref and the line.
//
// Keyboard and screen readers: the dialog is the shared Sheet (a native modal <dialog>), so Tab
// stays inside, Escape closes, and focus returns to the cart line (or, after a swap, to the same
// line of the redrawn card). A choice that cannot be made now keeps its button focusable, marked
// aria-disabled and described by the visible reason.
//
// The meal plan opens the same dialog on a trip line (components/tripoptions.tsx): it passes
// `load` (pantry-api's ranking for the line, over REST, no hub), the trip's words, and a
// description naming the recipe lines the purchase covers. The wizard's Check ingredients stage
// opens it on an ingredient across the whole plan, in the plan's words.
//
// pantry matches products by meaning: the rows are under its groups (Same item, Works instead,
// Looser match), each with its reasons on one line; what a hard rule keeps out (it adds an
// allergen, breaks the diet) is listed, closed, as "Not offered"; and a note under the heading
// says whether the line was matched by meaning or, with the meaning model off, by words. An older
// pantry's rows are under "Same ingredient" and "Not the same ingredient", as before
// (alternatives.rowGroups). Each row also wears its group as a tag, and its origin tag as Check
// ingredients' rows do (measured against the plan's country rules, `rules`; a chat cart passes
// none), with "demo label photo" after it where the evidence is one, so how sure it is reads on the
// row itself (components/matchmarks.tsx). Over the rows, the pick and the two best others side by
// side: price, unit price, size, store, origin (alternatives.compareColumns), nothing left blank.
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
  COMPARE_ROWS, altBasketOrigin, compareColumns, coversText, footText, matchingNote, movedText, needText, notOffered,
  priceLine, reasonOf, reasonsLine, rowGrade, rowGroups, sizeInName, storeText, unitPriceText,
} from '../alternatives';
import type { CompareColumn } from '../alternatives';
import { agentAlternatives } from '../hub';
import { countryRules, originTag } from '../mealplan/origin';
import type { CountryRules } from '../mealplan/origin';
import type { AlternativeRanking, CartLine, RankedAlternative } from '../types';
import { Icon } from './icons';
import { EvidenceMark, MatchTag, OriginTag } from './matchmarks';
import { ProductPicture } from './pictures';
import { Sheet } from './Sheet';
import { Notice } from './ui';

// The line the dialog is open for: the card's plan (ref) and the cart line.
export interface OptionsTarget {
  ref: number;
  line: CartLine;
  pinned: boolean;
}

// How many rows the hub asks pantry for (pantry allows 1..25).
const LIMIT = 12;

// A chat cart has no country rules of its own here: its rows' tags say the country, nothing more.
const NO_RULES = countryRules({});

// ingredient: what the row's picture falls back to when the product has none.
function Row({ item, action, buyer, ingredient, rules }: { item: RankedAlternative; action: ReactNode; buyer?: string;
  ingredient: string; rules: CountryRules }) {
  const price = priceLine(item, buyer);
  const trip = reasonOf(item, 'trip');
  const { summary, chips } = reasonsLine(item);
  const brandSize = [item.brand, sizeInName(item.product, item.size) ? '' : item.size].filter(Boolean).join(' · ');
  const grade = rowGrade(item);
  const origin = originTag(altBasketOrigin(item.origin), rules);
  return (
    <li className={`card-row alt-row${item.current ? ' alt-row-current' : ''}`}>
      <span className="card-pic"><ProductPicture product={item.product} ingredient={ingredient} /></span>
      <div>
        <div className="alt-name">
          <span className="alt-rank">#{item.rank}</span> <strong>{item.product}</strong>
          {brandSize && <span className="muted"> {brandSize}</span>}
        </div>
        <div className="alt-marks">
          <MatchTag kind={grade.kind} label={grade.label} />
          <OriginTag words={origin} />
          {item.origin.demo && <EvidenceMark kind="checked" word="demo label photo" />}
        </div>
        <div className="alt-price">
          <strong>{price.main}</strong> <span className="muted">{unitPriceText(item)}</span>
        </div>
        <div className="alt-note">{price.note}</div>
        <div className="alt-facts">
          <span>{storeText(item)}</span>
          {trip && <span className={`alt-tone-${trip.tone}`}>{trip.text}</span>}
        </div>
        {movedText(item).map((t) => <div key={t} className="alt-note">{t}</div>)}
        {summary && <p className="alt-summary">{summary}</p>}
        {chips.length > 0 && (
          <ul className="alt-chips" aria-label="Reasons">
            {chips.map((r) => <li key={r.code} className={`chip alt-tone-${r.tone}`}>{r.text}</li>)}
          </ul>
        )}
        {item.reasons.length > chips.length && (
          <details className="alt-all">
            <summary>All reasons</summary>
            <ul>{item.reasons.map((r) => <li key={r.code} className={`alt-tone-${r.tone}`}>{r.text}</li>)}</ul>
          </details>
        )}
        {item.rank_reason && <p className="alt-why">{item.rank_reason}</p>}
      </div>
      {action}
    </li>
  );
}

// The pick and the two best others, attribute by attribute (a table: the products are its columns,
// each attribute a row headed by its name), so the differences read across without opening each
// row. holds: what the pick is called here ("In your plan", "On this trip", "In your cart").
function CompareStrip({ cols, holds }: { cols: CompareColumn[]; holds: string }) {
  const head = useId();
  const yours = cols.some((c) => c.yours);
  return (
    <section className="alt-section alt-compare" aria-labelledby={head}>
      <h3 id={head}>{yours ? 'Compare with your pick' : 'Compare the top choices'}</h3>
      <table className="alt-compare-table">
        <thead>
          <tr>
            <td />
            {cols.map((c) => (
              <th key={c.productId} scope="col" className={c.yours ? 'alt-compare-yours' : undefined}>
                {c.yours && <span className="alt-compare-badge">{holds}</span>}
                <span className="alt-compare-name">{c.name}</span>
                <MatchTag kind={c.grade.kind} label={c.grade.label} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              {cols.map((c) => (
                <td key={c.productId} className={`${c.yours ? 'alt-compare-yours' : ''}${c[r.key] === 'unknown' ? ' alt-compare-unknown' : ''}`.trim() || undefined}>
                  {c[r.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function AlternativesDialog({ conversationId, target, blocked, returnFocus, onChoose,
  onClose, load, loadKey, place = 'cart', description, notice, title, empty, extra, rules = NO_RULES }: {
  conversationId: string | null;
  // null: closed
  target: OptionsTarget | null;
  // why "Use this" cannot be pressed now ('' when it can), shown above the rows
  blocked: string;
  returnFocus: RefObject<HTMLElement | null>;
  // Makes the swap (product_id null: back to the planner's pick). Resolves once the cart is
  // redrawn and the dialog closed; rejects with the hub's reason, shown in the dialog.
  onChoose: (productId: number | null) => Promise<void>;
  onClose: () => void;
  // The ranking from somewhere other than the hub (a meal-plan trip line), fetched again
  // whenever loadKey changes.
  load?: (limit: number) => Promise<AlternativeRanking>;
  loadKey?: string;
  // 'trip': the line is on a meal-plan trip, and the dialog says so; 'plan': an ingredient
  // across a meal plan, with no trip
  place?: 'cart' | 'trip' | 'plan';
  // in place of the need and the lines covered, under the title
  description?: string;
  // said above the rows (the line's own product can no longer be bought)
  notice?: string;
  // the heading, in place of "Options for <ingredient>" (a meal plan line with no product)
  title?: string;
  // in place of "No other product …" when no row can be chosen, and the held-back products
  // then listed open; and what follows the rows (a meal plan line's rows out of reach)
  empty?: ReactNode;
  extra?: ReactNode;
  // the plan's country rules, which each row's origin tag is read against (a meal plan's)
  rules?: CountryRules;
}) {
  const [ranking, setRanking] = useState<AlternativeRanking | null>(null);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState<number | 'back' | null>(null);
  const [swapError, setSwapError] = useState('');
  const blockedId = useId();
  // Answers to an earlier opening (another line, or this one before a swap) are dropped.
  const asked = useRef(0);

  const ref = target?.ref;
  const lineNo = target?.line.line_no;
  useEffect(() => {
    const n = ++asked.current;
    setRanking(null);
    setError('');
    setChoosing(null);
    setSwapError('');
    if (ref == null || lineNo == null) return;
    const answer = load ? load(LIMIT)
      : conversationId ? agentAlternatives(conversationId, { ref, line_no: lineNo, limit: LIMIT })
        : null;
    if (!answer) {
      setError('This conversation is gone (the hub restarted or forgot it): ask again to re-plan.');
      return;
    }
    answer
      .then((r) => { if (asked.current === n) setRanking(r); })
      .catch((e: Error) => { if (asked.current === n) setError(e.message); });
    // `load` is a new function each render; loadKey says when it asks something else.
  }, [conversationId, ref, lineNo, loadKey]);

  const ingredient = ranking?.ingredient || target?.line.ingredient || '';
  const updating = place === 'cart' ? 'Updating your cart…' : 'Updating your plan…';
  const buyer = place === 'trip' ? 'the trip' : place === 'plan' ? 'the plan' : 'the cart';
  const holds = place === 'trip' ? 'On this trip' : place === 'plan' ? 'In your plan' : 'In your cart';
  const why = blocked || (choosing !== null ? updating : '');

  const choose = async (productId: number | null) => {
    if (why) return;
    setChoosing(productId ?? 'back');
    setSwapError('');
    try {
      await onChoose(productId);
    } catch (e) {
      setSwapError((e as Error).message);
      setChoosing(null);
    }
  };

  // A button that stays in the tab order while it cannot be used, so a screen reader still
  // reaches it and hears why.
  const actionProps = {
    'aria-disabled': why ? true : undefined,
    'aria-describedby': blocked ? blockedId : undefined,
  } as const;

  const rows = ranking ? rowGroups(ranking) : null;
  const current = rows?.current ?? null;
  const covers = ranking ? coversText(ranking) : '';
  const others = rows ? rows.groups.reduce((t, g) => t + g.items.length, 0) : 0;
  const note = ranking ? matchingNote(ranking) : null;
  const kept = ranking ? notOffered(ranking) : [];
  const said = description ?? (ranking ? [needText(ranking), covers].filter(Boolean).join(' ') : undefined);

  const useThis = (item: RankedAlternative) => (
    <button type="button" className="btn btn-primary alt-use" {...actionProps}
            aria-label={`Use this: ${item.product}`} onClick={() => void choose(item.product_id)}>
      {choosing === item.product_id ? updating : 'Use this'}
    </button>
  );
  const compare = ranking ? compareColumns(ranking, rules) : [];

  const list = (heading: string, items: RankedAlternative[], tone: string) => items.length > 0 && (
    <section className={`alt-section alt-section-${tone}`} aria-label={heading}>
      <h3>{heading}</h3>
      <ul className="alt-list">
        {items.map((it) => <Row key={it.product_id} item={it} action={useThis(it)} buyer={buyer} ingredient={ingredient}
                                rules={rules} />)}
      </ul>
    </section>
  );

  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      className="alt-sheet"
      returnFocus={returnFocus}
      title={title ?? `Options for ${ingredient}`}
      description={said || note ? (
        <>
          {said}
          {note && <span className={`alt-matching alt-matching-${note.mode}`}>{note.text}</span>}
        </>
      ) : undefined}
      footer={ranking?.data_note ? <p className="alt-data-note">{ranking.data_note}</p> : undefined}
    >
      {blocked && <p id={blockedId} className="alt-blocked"><Icon name="alert" size={14} />{blocked}</p>}
      {notice && <p className="alt-blocked" role="note"><Icon name="alert" size={14} />{notice}</p>}
      {swapError && <Notice tone="danger" className="alt-error">{swapError}</Notice>}
      {error && <Notice tone="danger" className="alt-error">{error}</Notice>}

      {!ranking && !error && (
        <>
          <p className="muted" role="status">Loading the options for {ingredient}…</p>
          <ul className="alt-list" aria-hidden="true">
            {[0, 1, 2].map((i) => <li key={i} className="skel alt-skeleton" />)}
          </ul>
        </>
      )}

      {ranking && rows && (
        <>
          {compare.length > 0 && <CompareStrip cols={compare} holds={holds} />}
          {current && (
            <section className="alt-section" aria-label={holds}>
              <h3>{holds} ({target?.pinned ? 'chosen by you' : 'chosen by the planner'})</h3>
              <ul className="alt-list">
                <Row item={current} buyer={buyer} ingredient={ingredient} rules={rules} action={target?.pinned ? (
                  <button type="button" className="btn btn-secondary alt-use" {...actionProps}
                          onClick={() => void choose(null)}>
                    {choosing === 'back' ? updating : 'Back to the planner’s pick'}
                  </button>
                ) : null} />
              </ul>
            </section>
          )}
          {rows.groups.map((g) => <Fragment key={g.key}>{list(g.label, g.items, g.tone)}</Fragment>)}
          {others === 0 && !current && empty}
          {others === 0 && !(empty && !current) && (
            <p className="muted">No other product sold in range fills this line.</p>
          )}
          {extra}

          {ranking.held_back.length > 0 && (
            <details className="alt-held" open={(empty && others === 0 && !current) || undefined}>
              <summary>
                {ranking.held_back.length} held back by your origin rule (cannot be chosen here)
              </summary>
              <ul className="alt-held-list">
                {ranking.held_back.map((h) => (
                  <li key={h.product_id}>
                    <ProductPicture product={h.product} ingredient={ingredient} />
                    <span>
                      <strong>{h.product}</strong>: {h.country}
                      {h.field === 'conflicting_evidence' ? ' (sources disagree)' : ''}
                      {h.verbatim && <> — <span className="verbatim">“{h.verbatim}”</span></>}
                      {h.demo && ' (demo label photo)'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {kept.length > 0 && (
            <details className="alt-held">
              <summary>Not offered ({kept.length})</summary>
              <ul className="alt-held-list">
                {kept.map(({ item, text }) => (
                  <li key={item.product_id}>
                    <ProductPicture product={item.product} ingredient={ingredient} />
                    <span><strong>{item.product}</strong>: {text}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {footText(ranking).map((t) => <p key={t} className="alt-foot">{t}</p>)}
          <details className="alt-how">
            <summary>How this is ranked</summary>
            <p>{ranking.ranking_text}</p>
          </details>
        </>
      )}
    </Sheet>
  );
}
