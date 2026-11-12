// What a thinking model reasoned before it answered (a local model with thinking on sends it with
// each step's end). Open while the reasoning comes in, so the shopper can read along; closed once
// the answer starts, as "Thought for 4.2 s", since the answer is what they came for. Once the
// shopper opens or closes it themselves, it stays as they left it.
import { useId, useState } from 'react';

import { thoughtLabel } from '../../transcript';
import type { Run } from '../../transcript';
import { Icon } from '../icons';
import { ScrollRegion } from '../ui';

export function Thought({ run }: { run: Run }) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const bodyId = useId();
  if (run.reasoning.length === 0) return null;
  const open = chosen ?? run.thinking;
  const several = run.reasoning.length > 1;
  return (
    <div className={`thought${run.thinking ? ' thought-live' : ''}`}>
      <button type="button" className="thought-head" aria-expanded={open} aria-controls={open ? bodyId : undefined}
              onClick={() => setChosen(!open)}>
        <Icon name="sparkle" size={16} />
        {thoughtLabel(run)}
        <Icon name="chevron-down" size={16} className="thought-chev" />
      </button>
      {open && (
        <ScrollRegion id={bodyId} label="Reasoning" className="thought-body">
          {run.reasoning.map((r) => (
            <p key={r.step}>
              {several && <span className="thought-step">Step {r.step}</span>}
              {r.text}
            </p>
          ))}
        </ScrollRegion>
      )}
    </div>
  );
}
