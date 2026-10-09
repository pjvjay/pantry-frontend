// A plan as a shopping cart: what to pick up at each store, what it costs, and what could not go
// in the cart with the swaps the planner found. The tool's JSON stays in its step above.
import { createContext, useContext, useState } from 'react';
import type { CartLine, CartSummary, LeftOut } from '../types';
import { IngredientImage } from './flow';

// What a swap button does: put a request in the message box, for the shopper to send or edit.
export const AskContext = createContext<(text: string) => void>(() => {});

const money = (v: number | null | undefined) => (typeof v === 'number' ? `$${v.toFixed(2)}` : '–');
const stem = (w: string) => w.replace(/(es|s)$/, '');
const words = (s: string) => (s.toLowerCase().match(/[a-z]+/g) ?? []).map(stem);

// The ingredient is worth a line only when the product's name does not already say it
// ("Penne" for Penne Rigate 500g says nothing; "Mozzarella" for Pizza Cheese would).
const namesIngredient = (l: CartLine) => {
  const product = new Set(words(l.product));
  return words(l.ingredient).every((w) => product.has(w));
};
const storeOf = (l: CartLine) => l.trip_store || l.store || 'Store not chosen';
const priceOf = (l: CartLine) => (l.trip_store ? l.trip_price ?? l.price : l.price);

type Group = { store: string; lines: CartLine[]; subtotal: number };

// Lines by the store the trip buys them at, in the trip's order.
function byStore(lines: CartLine[], order: string[]): Group[] {
  const groups = new Map<string, CartLine[]>();
  for (const l of lines) groups.set(storeOf(l), [...(groups.get(storeOf(l)) ?? []), l]);
  const rank = (s: string) => (order.includes(s) ? order.indexOf(s) : order.length);
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([store, ls]) => ({ store, lines: ls, subtotal: ls.reduce((t, l) => t + (priceOf(l) ?? 0), 0) }));
}

const SWAP = 'still available, not a direct match: ';
const EXCLUDED = /^(.*) \((\$[\d.]+)\) — (.+?) via \S+$/;
type Swap = { name: string; price: string; origin?: string };

// pantry's suggestions for a left-out ingredient: swaps the plan still allows, and the excluded
// products the shopper could allow back.
function optionsOf(d: LeftOut): { swaps: Swap[]; back: string[] } {
  const swaps: Swap[] = [];
  const back: string[] = [];
  for (const s of d.suggestions ?? []) {
    if (s.startsWith(SWAP)) {
      const rest = s.slice(SWAP.length);
      const m = /^(.*) \((\$[\d.]+)(?:, (.+))?\)$/.exec(rest);
      swaps.push(m ? { name: m[1], price: m[2], origin: m[3] } : { name: rest, price: '' });
    } else {
      const m = EXCLUDED.exec(s);
      if (m) back.push(`${m[1]} (${m[2]}, ${m[3]})`);
    }
  }
  return { swaps, back };
}

type LeftKind = 'not_stocked' | 'out_of_range' | 'skipped';

function why(d: LeftOut, kind: LeftKind): string {
  const excluded = /coming from (.+), which this plan excludes/.exec(d.reason ?? '');
  if (excluded) return `only from ${excluded[1]} at these stores, which you left out`;
  if (kind === 'not_stocked') return 'not sold at these stores';
  return d.reason || kind.replace('_', ' ');
}

function listText(summary: CartSummary, groups: Group[], total: number | undefined): string {
  const out = [`${summary.recipe_name ?? 'Shopping list'} — ${money(total)}`];
  for (const g of groups) {
    out.push('', g.store);
    for (const l of g.lines) {
      const packs = (l.packs ?? 1) > 1 ? ` ×${l.packs}` : '';
      out.push(`- ${l.product}${packs} — ${money(priceOf(l))}`);
    }
  }
  return out.join('\n');
}

export function CartCard({ summary }: { summary: CartSummary }) {
  const ask = useContext(AskContext);
  const [got, setGot] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);
  const lines = summary.lines ?? [];
  const trip = summary.trip ?? null;
  const groups = byStore(lines, trip?.stores ?? []);
  const items = groups.reduce((t, g) => t + g.subtotal, 0);
  const total = trip ? trip.total_cost : summary.total_cost;
  const left: [LeftOut, LeftKind][] = [
    ...(summary.not_stocked ?? []).map((d) => [d, 'not_stocked'] as [LeftOut, LeftKind]),
    ...(summary.out_of_range ?? []).map((d) => [d, 'out_of_range'] as [LeftOut, LeftKind]),
    ...(summary.skipped ?? []).map((d) => [d, 'skipped'] as [LeftOut, LeftKind]),
  ];
  const originAsked = !!summary.origin_status && summary.origin_status !== 'not_requested';
  const share = summary.coverage?.spend_fraction;
  const toggle = (key: string) => setGot((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(listText(summary, groups, total));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="cart" aria-label={`Shopping cart: ${summary.recipe_name ?? 'plan'}`}>
      <div className="cart-head">
        <div>
          <div className="cart-title">{summary.recipe_name ?? 'Your cart'}</div>
          <div className="muted">
            {lines.length} item{lines.length === 1 ? '' : 's'} · {groups.length} store{groups.length === 1 ? '' : 's'}
            {got.size > 0 && ` · ${got.size} in the basket`}
          </div>
        </div>
        <div className="cart-total">{money(total)}</div>
      </div>
      {originAsked && share != null && (
        <div className={`cart-origin ${summary.origin_status === 'verified' ? 'cart-origin-ok' : 'cart-origin-warn'}`}>
          {summary.origin_status === 'verified' ? '✓ ' : ''}Origin checked for {Math.round(share * 100)}% of what you spend
        </div>
      )}

      {groups.map((g) => (
        <div className="cart-store" key={g.store}>
          <div className="cart-store-head"><span>{g.store}</span><span>{money(g.subtotal)}</span></div>
          <ul className="cart-items">
            {g.lines.map((l) => {
              const key = `${l.product_id ?? l.product}`;
              const done = got.has(key);
              const unclear = originAsked && !l.origin_country;
              return (
                <li key={key} className={`cart-item${done ? ' cart-item-done' : ''}`}>
                  <input type="checkbox" checked={done} onChange={() => toggle(key)}
                         aria-label={`${l.product}: in the basket`} />
                  <IngredientImage name={l.ingredient} size={36} />
                  <div className="cart-item-body">
                    <div className="cart-item-name">
                      {l.product}{(l.packs ?? 1) > 1 && <span className="muted"> ×{l.packs}</span>}
                    </div>
                    <div className="cart-item-meta">
                      {!namesIngredient(l) && <span>for {l.ingredient}</span>}
                      {l.origin_country && <span>{l.origin_country}</span>}
                      {unclear && <span className="cart-flag" title={`origin ${l.origin_status ?? 'unknown'}`}>origin unclear</span>}
                      {l.match && l.match !== 'exact' && <span className="cart-flag">closest match</span>}
                      {l.confidence != null && l.confidence < 0.85 && (
                        <span className="cart-flag" title={`the planner is ${Math.round(l.confidence * 100)}% sure of this pick`}>
                          check this pick
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="cart-item-price">{money(priceOf(l))}</div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {left.length > 0 && (
        <div className="cart-left">
          <div className="cart-store-head"><span>Not in your cart</span></div>
          {left.map(([d, kind]) => {
            const { swaps, back } = optionsOf(d);
            return (
              <div className="cart-left-item" key={d.ingredient}>
                <div><strong>{d.ingredient}</strong> <span className="muted">— {why(d, kind)}</span></div>
                {(swaps.length > 0 || back.length > 0) && (
                  <div className="cart-swaps">
                    {swaps.map((s) => (
                      <button key={s.name} type="button" className="cart-swap"
                              title="Puts this request in the message box"
                              onClick={() => ask(`Use ${s.name} instead of ${d.ingredient} and update the plan.`)}>
                        Swap for {s.name}{s.price && ` · ${s.price}`}{s.origin && ` · ${s.origin}`}
                      </button>
                    ))}
                    {back.length > 0 && <span className="muted">or allow {back.join(', ')}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="cart-foot">
        <div className="cart-sums">
          {trip ? (
            <>
              <span>Items {money(trip.basket_cost ?? items)}</span>
              {trip.travel_cost != null && <span>Travel {money(trip.travel_cost)}</span>}
            </>
          ) : <span className="muted">each item at its cheapest store nearby; no trip chosen</span>}
          <strong>Total {money(total)}</strong>
        </div>
        <button type="button" className="secondary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy list'}
        </button>
      </div>
    </section>
  );
}

// A plan tool's result in its step: one line, since the cart is drawn under the answer.
export function PlanStrip({ summary }: { summary: CartSummary }) {
  const n = summary.lines?.length ?? 0;
  const left = (summary.not_stocked?.length ?? 0) + (summary.out_of_range?.length ?? 0)
    + (summary.skipped?.length ?? 0);
  const trip = summary.trip;
  return (
    <div className="plan-strip muted">
      planned {summary.recipe_name ?? 'a recipe'}: {n} item{n === 1 ? '' : 's'},{' '}
      {money(trip ? trip.total_cost : summary.total_cost)}
      {trip && ` at ${trip.stores.join(' and ')}`}
      {left > 0 && `, ${left} left out`}
    </div>
  );
}
