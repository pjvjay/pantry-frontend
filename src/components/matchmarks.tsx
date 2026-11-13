// How sure a row is, in words beside a glyph, never colour alone: how well its product matches the
// recipe's line (MatchTag: "Same item", "Works instead", "Looser match", "Closest match", "Your
// choice"), and how a claim is known where a row says one (EvidenceMark, after it as a citation
// follows a claim: "demo label photo", "check the label"). Check ingredients' rows and the Options
// sheet's both wear them; the words come from mealplan/basket.ts and alternatives.ts. Styles:
// styles/check.css. Where a product comes from, measured against the plan's country rules
// (OriginTag: "Canada · preferred", "Made in Canada · ingredients may be imported", "Origin
// unknown: check the label"), on every row that shows a product: Check ingredients, Options, Shop's
// list and in-store mode; its words are mealplan/origin.ts's, its styles styles/ui.css's. And how a
// trip stands (TripTag), wherever a trip is a card or a heading: kept here, in a file that draws no
// board, so Home can show it without loading the plan.
import type { TripLook } from '../mealplan/board';
import type { OriginKind, OriginWords } from '../mealplan/origin';
import { Icon } from './icons';
import type { IconName } from './icons';
import { Tag } from './ui';
import type { TagKind } from './ui';

// Every grade either side gives: the basket's (same, form, closest, yours) and the ranking's
// (same, instead, looser, outside).
export type MatchKind = 'same' | 'form' | 'closest' | 'yours' | 'instead' | 'looser' | 'outside';

const MATCH_ICON: Record<MatchKind, IconName> = {
  same: 'check', form: 'check', closest: 'approx', yours: 'pushpin', instead: 'swap', looser: 'approx', outside: 'ban',
};

export function MatchTag({ kind, label }: { kind: MatchKind; label: string }) {
  return (
    <span className={`mtag mtag-${kind}`}>
      <Icon name={MATCH_ICON[kind]} size={13} strokeWidth={2.2} />{label}
    </span>
  );
}

export type EvidenceKind = 'checked' | 'disputed' | 'none';

const EVIDENCE_ICON: Record<EvidenceKind, IconName> = { checked: 'circle-check', disputed: 'alert', none: 'help' };

// Nothing when there is nothing to say (a ranking row whose origin was never checked says so in
// its own words already).
export function EvidenceMark({ kind, word }: { kind: EvidenceKind; word: string }) {
  if (!word) return null;
  return (
    <span className={`evid evid-${kind}`}>
      <Icon name={EVIDENCE_ICON[kind]} size={13} strokeWidth={2} />{word}
    </span>
  );
}

// A product's origin as a small pill: its country (with "preferred" for the plan's first country),
// where it was made, or that its origin is unclear or unknown and the label is worth a look. Words
// say it all, a glyph and a tint repeat it: no flags (they are pictures of countries, not words, and
// many systems draw them as two letters). A screen reader hears "From" before a country. A
// processing claim's caveat ("ingredients may be imported") follows the pill as quiet words, so the
// pill stays one short line; compact (in the store) leaves the caveat to the title and to a screen
// reader.
const ORIGIN_ICON: Record<OriginKind, IconName> = {
  preferred: 'star', country: 'globe', made: 'globe', excluded: 'ban', unclear: 'alert', unknown: 'help',
};

export function OriginTag({ words, compact = false }: { words: OriginWords; compact?: boolean }) {
  const caveat = words.kind === 'made' ? words.note : '';
  const pill = (
    <span className={`otag otag-${words.kind}${words.check ? ' otag-check' : ''}`} title={words.label}>
      <Icon name={ORIGIN_ICON[words.kind]} size={13} strokeWidth={2.2} />
      <span>
        {words.lead && <span className="sr-only">{words.lead}</span>}
        {caveat ? words.text : words.words}
        {caveat && compact && <span className="sr-only">, {caveat}</span>}
      </span>
    </span>
  );
  if (!caveat || compact) return pill;
  return (
    <span className="otag-with">
      {pill}
      <span className="otag-caveat"><span className="sr-only">, </span>{caveat}</span>
    </span>
  );
}

// A trip's state as a Tag (Home's next trip, Shop's trips and Your list, the trip sheet): approved,
// under either way to shop, is done; changed since approved needs the shopper's look; a suggestion
// is still being decided, its dashed sign the dashed edge it has on the board.
const TRIP_TAG: Record<TripLook['kind'], TagKind> = {
  approved: 'done', elsewhere: 'done', review: 'attention', suggested: 'progress',
};

export function TripTag({ look }: { look: TripLook }) {
  return <Tag kind={TRIP_TAG[look.kind]}>{look.word}</Tag>;
}
