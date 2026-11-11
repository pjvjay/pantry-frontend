// How sure a row is, in words beside a glyph, never colour alone: how well its product matches the
// recipe's line (MatchTag: "Same item", "Works instead", "Looser match", "Closest match", "Your
// choice"), and how its origin is known (EvidenceMark, after the origin as a citation follows a
// claim: "source on file", "check the label", "not checked"). Check ingredients' rows and the
// Options sheet's both wear them; the words come from mealplan/basket.ts and alternatives.ts.
// Styles: styles/check.css.
import { Icon } from './icons';
import type { IconName } from './icons';

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
