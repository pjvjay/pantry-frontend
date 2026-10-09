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
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
  chipReasons, coversText, footText, movedText, needText, priceLine, reasonOf, rowsOf, storeText,
  unitPriceText,
} from '../alternatives';
import { agentAlternatives } from '../hub';
import type { AlternativeRanking, CartLine, RankedAlternative } from '../types';
import { Sheet } from './Sheet';

// The line the dialog is open for: the card's plan (ref) and the cart line.
export interface OptionsTarget {
  ref: number;
  line: CartLine;
  pinned: boolean;
}

// How many rows the hub asks pantry for (pantry allows 1..25).
const LIMIT = 12;

function Row({ item, action }: { item: RankedAlternative; action: ReactNode }) {
  const price = priceLine(item);
  const trip = reasonOf(item, 'trip');
  const chips = chipReasons(item);
  const brandSize = [item.brand, item.size].filter(Boolean).join(' · ');
  return (
    <li className={`alt-row${item.current ? ' alt-row-current' : ''}`}>
      <div className="alt-main">
        <div className="alt-name">
          <span className="alt-rank">#{item.rank}</span> <strong>{item.product}</strong>
          {brandSize && <span className="muted"> {brandSize}</span>}
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
        {chips.length > 0 && (
          <ul className="alt-chips" aria-label="Reasons">
            {chips.map((r) => <li key={r.code} className={`alt-chip alt-tone-${r.tone}`}>{r.text}</li>)}
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

export function AlternativesDialog({ conversationId, target, blocked, returnFocus, onChoose,
  onClose }: {
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
    if (!conversationId) {
      setError('This conversation is gone (the hub restarted or forgot it): ask again to re-plan.');
      return;
    }
    agentAlternatives(conversationId, { ref, line_no: lineNo, limit: LIMIT })
      .then((r) => { if (asked.current === n) setRanking(r); })
      .catch((e: Error) => { if (asked.current === n) setError(e.message); });
  }, [conversationId, ref, lineNo]);

  const ingredient = ranking?.ingredient || target?.line.ingredient || '';
  const why = blocked || (choosing !== null ? 'Updating your cart…' : '');

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

  const rows = ranking ? rowsOf(ranking) : null;
  const current = rows?.current ?? null;
  const covers = ranking ? coversText(ranking) : '';
  const others = rows ? rows.same.length + rows.other.length : 0;

  const useThis = (item: RankedAlternative) => (
    <button type="button" className="alt-use" {...actionProps}
            aria-label={`Use this: ${item.product}`} onClick={() => void choose(item.product_id)}>
      {choosing === item.product_id ? 'Updating your cart…' : 'Use this'}
    </button>
  );

  const list = (heading: string, items: RankedAlternative[], tone: string) => items.length > 0 && (
    <section className={`alt-section alt-section-${tone}`} aria-label={heading}>
      <h3>{heading}</h3>
      <ul className="alt-list">
        {items.map((it) => <Row key={it.product_id} item={it} action={useThis(it)} />)}
      </ul>
    </section>
  );

  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      className="alt-sheet"
      returnFocus={returnFocus}
      title={`Options for ${ingredient}`}
      description={ranking ? [needText(ranking), covers].filter(Boolean).join(' ') : undefined}
      footer={ranking?.data_note ? <p className="alt-data-note">{ranking.data_note}</p> : undefined}
    >
      {blocked && <p id={blockedId} className="alt-blocked">{blocked}</p>}
      {swapError && <div className="banner banner-error alt-error" role="alert">{swapError}</div>}
      {error && <div className="banner banner-error alt-error" role="alert">{error}</div>}

      {!ranking && !error && (
        <>
          <p className="muted" role="status">Loading the options for {ingredient}…</p>
          <ul className="alt-list" aria-hidden="true">
            {[0, 1, 2].map((i) => <li key={i} className="alt-row alt-skeleton" />)}
          </ul>
        </>
      )}

      {ranking && rows && (
        <>
          {current && (
            <section className="alt-section" aria-label="In your cart">
              <h3>In your cart ({target?.pinned ? 'chosen by you' : 'chosen by the planner'})</h3>
              <ul className="alt-list">
                <Row item={current} action={target?.pinned ? (
                  <button type="button" className="secondary alt-use" {...actionProps}
                          onClick={() => void choose(null)}>
                    {choosing === 'back' ? 'Updating your cart…' : 'Back to the planner’s pick'}
                  </button>
                ) : null} />
              </ul>
            </section>
          )}
          {list('Same ingredient', rows.same, 'same')}
          {list('Not the same ingredient', rows.other, 'other')}
          {others === 0 && (
            <p className="muted">No other product sold in range fills this line.</p>
          )}

          {ranking.held_back.length > 0 && (
            <details className="alt-held">
              <summary>
                {ranking.held_back.length} held back by your origin rule (cannot be chosen here)
              </summary>
              <ul>
                {ranking.held_back.map((h) => (
                  <li key={h.product_id}>
                    {h.product}: {h.country}
                    {h.field === 'conflicting_evidence' ? ' (sources disagree)' : ''}
                    {h.verbatim && <> — <span className="verbatim">“{h.verbatim}”</span></>}
                    {h.demo && ' (demo label photo)'}
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
