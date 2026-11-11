// What a page asks of the page it opens, when it opens it with a press: where focus goes there
// (Done shopping lands on the trip's own "Shop this trip" in the shopping plan; a Change in the
// shopping plan lands on the answer in Set up), and, from Home's "Try the example", the example
// sentence put in Quick add. The pages are different views (the plan's lives in its own chunk),
// so the request waits here, for the address it was made for, until that page takes it as it
// opens. It is the page's own business: an address typed or reloaded opens with nothing asked.
//
//   arriveAt(hash, { focus: ['[data-shop-trip="2026-11-13"]'] }); window.location.hash = hash;
//   const asked = arrivalFor(window.location.hash);   // on opening, as often as it renders
//   clearArrival();                                    // once it has been acted on
export interface Arrival {
  // where focus goes, the first of these selectors that finds something; the page's heading else
  focus?: string[];
  // Pick meals opens with the example in Quick add (and no first-run sheet: the choice was made)
  example?: boolean;
}

let waiting: { hash: string; arrival: Arrival } | null = null;

export function arriveAt(hash: string, arrival: Arrival): void {
  waiting = { hash, arrival };
}

// What was asked of the page at `hash`, without taking it: a page may read it more than once as
// it opens (React's strict mode renders twice).
export const arrivalFor = (hash: string): Arrival | null => (waiting && waiting.hash === hash ? waiting.arrival : null);

export function clearArrival(): void {
  waiting = null;
}

// A link's click handler that makes the request as the link is followed: a plain click; one that
// asks for another tab or window is the browser's, and asks nothing of the page.
export const arriving = (hash: string, arrival: Arrival = {}) =>
  (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => {
    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) arriveAt(hash, arrival);
  };
