// Origin evidence as cards, for the Workshop's Catalog (a product's evidence) and Provenance (the
// readings in the review queue, the products a ranking left out). Each card says what the wording
// legally claims and where ("Product of Italy"), the words on the label exactly as printed, in
// quotes and never rewritten, how sure the reading is (a band of three, and the word for it),
// where it came from, and who saw or reviewed it, when. An importer's address is flagged on the
// card, since it says who brought a product in and never where it is from.
//
// The states are workshop.ts's (originStatus, queueStatus, ...) drawn as ui.tsx's Tag: a glyph and
// words, never colour alone.
import type { ReactNode } from 'react';

import { claimLabel, confidenceBand, sourceLabel } from '../workshop';
import type { StatusWords } from '../workshop';
import { Tag } from './ui';

// A state in a Tag: its glyph and its words, or better words the caller has ("3 pending").
export function StateTag({ state, children }: { state: StatusWords; children?: ReactNode }) {
  return <Tag kind={state.kind}>{children ?? state.word}</Tag>;
}

// How sure a reading is: three bars, as many filled as the band, beside the words that say it.
export function ConfidenceBand({ confidence }: { confidence: string | null | undefined }) {
  const { level, word } = confidenceBand(confidence);
  return (
    <span className="conf-band">
      <span className="conf-band-bars" aria-hidden="true">
        {[1, 2, 3].map((n) => <i key={n} className={n <= level ? 'conf-band-on' : undefined} />)}
      </span>
      {word}
    </span>
  );
}

export interface Evidence {
  // the claim the wording makes (product-of, made-in, packaged-in, grown-in, ...)
  claim: string;
  // where the ingredients come from, and where it was made or packed, when the source says each
  origin?: string;
  madeIn?: string;
  verbatim?: string;
  source?: string;
  // the photo, barcode or page it was read from
  sourceRef?: string;
  confidence?: string;
  importerOnly?: boolean;
  note?: string;
}

// The claims about where a product was made rather than where its ingredients grew: their place is
// the factory's.
const MAKING = new Set(['made-in', 'packaged-in', 'prepared-in']);

export function EvidenceCard({ evidence: e, heading, tag, lines = [], children }: {
  evidence: Evidence;
  // what the card is about, where the list holds more than one product
  heading?: ReactNode;
  // its state (a reading's place in the review queue)
  tag?: ReactNode;
  // who saw it and when: observed, submitted, reviewed
  lines?: ReactNode[];
  // what can be done with it (a reviewer's note, Approve, Reject)
  children?: ReactNode;
}) {
  const origin = e.origin?.trim() ?? '';
  const madeIn = e.madeIn?.trim() ?? '';
  const place = MAKING.has(e.claim) ? madeIn || origin : origin || madeIn;
  const both = origin && madeIn && origin !== madeIn;
  return (
    <div className="ev-card">
      {(heading || tag) && (
        <div className="ev-top">
          {heading && <p className="ev-heading">{heading}</p>}
          {tag}
        </div>
      )}
      <p className="ev-claim">
        <span className="ev-claim-type">{claimLabel(e.claim)}</span>
        {place && <strong className="ev-place">{place}</strong>}
      </p>
      {both && <p className="ev-facts">Ingredients from {origin} · made or packed in {madeIn}</p>}
      {e.verbatim
        ? <blockquote className="ev-quote"><p>“{e.verbatim}”</p></blockquote>
        : <p className="ev-quote-none">The wording on the label was not copied.</p>}
      <p className="ev-meta">
        <ConfidenceBand confidence={e.confidence} />
        <span className="ev-source">
          {sourceLabel(e.source)}
          {e.sourceRef && <> · <code>{e.sourceRef}</code></>}
        </span>
      </p>
      {e.importerOnly && (
        <p className="ev-flag">
          <Tag kind="attention">Importer only</Tag>
          <span>An importer’s address says who brought it in, not where it is from: it never counts as an origin.</span>
        </p>
      )}
      {e.note && <p className="ev-note"><span className="ev-note-k">Note:</span> {e.note}</p>}
      {lines.length > 0 && (
        <ul className="ev-lines">
          {lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
      {children}
    </div>
  );
}
