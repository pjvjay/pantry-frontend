// The wizard's form pieces: a card for each group of questions (the console's one card,
// styles/card.css, with its icon, its title and a line of help), and controls drawn as segments,
// tiles, chips and switches over the browser's own radio buttons and checkboxes. The native
// input stays in place (transparent, over the drawn face, or hidden beside it), so the keyboard,
// a screen reader and form autofill treat them as they always do; only the look is ours. The
// styles are the "Form pieces" section of styles/plan.css.
import type { ReactNode } from 'react';

import { Icon } from './icons';
import type { IconName } from './icons';

// One group of questions: an icon, a title, one line of help, then the controls. headId names
// the card for the controls inside (aria-labelledby). id: where a link elsewhere can send the
// shopper (Pick meals' "Change" for this answer).
export function FormCard({ icon, title, help, headId, children, className, id }: {
  icon: IconName;
  title: string;
  help?: ReactNode;
  headId: string;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={className ? `card fc ${className}` : 'card fc'} aria-labelledby={headId}>
      <div className="fc-head">
        <span className="fc-icon"><Icon name={icon} /></span>
        <div>
          <h3 id={headId} className="card-title">{title}</h3>
          {help && <p className="card-sub">{help}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

// One choice of a few, as joined segments ("1 week | 2 weeks").
export function Segmented<T extends string | number | null>({ name, labelledBy, options, value, onChange }: {
  name: string;
  labelledBy: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <label key={String(o.value)} className="seg-opt">
          <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

// One choice of several, as tiles with an icon, a name and a hint.
export function Tile({ name, checked, onChange, icon, label, hint }: {
  name: string;
  checked: boolean;
  onChange: () => void;
  icon: IconName;
  label: string;
  hint: string;
}) {
  return (
    <label className="tile">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span className="tile-face">
        <Icon name={icon} size={22} />
        <span className="tile-name">{label}</span>
        <span className="tile-hint">{hint}</span>
      </span>
    </label>
  );
}

// Something on or off among others, as a chip (plain: no tick, for short labels like days).
export function ToggleChip({ checked, onChange, children, plain = false, disabled = false }: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
  plain?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={plain ? 'tchip tchip-plain' : 'tchip'}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

// A rule that is on or off, as a switch with what it does beside it.
export function Switch({ checked, onChange, children, hint }: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-text">
        <span className="switch-label">{children}</span>
        {hint && <span className="switch-hint">{hint}</span>}
      </span>
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}
