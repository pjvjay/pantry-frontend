import { useState } from 'react';

import { copyText } from './cart';
import { ScrollRegion } from './ui';

// A view's error is a danger Notice now (components/ui.tsx); the name stays here for the views
// that import it from this file.
export { ErrorBanner } from './ui';

export function parseList(text: string): string[] {
  return text.split(',').map((c) => c.trim()).filter(Boolean);
}

// A collapsible, pretty-printed JSON block for tool results and raw payloads. Copy sits beside the
// summary, not inside it (a button inside a summary is a control inside a control, which a screen
// reader cannot reach as itself), and says whether it worked: a browser can refuse the clipboard
// (copyText then tries the older way), and a refusal is said, never thrown at the page. A long
// block scrolls in its own box, a stop for the keyboard while it does (ScrollRegion).
export function JsonView({ value, open = false, label = 'JSON' }: {
  value: unknown; open?: boolean; label?: string;
}) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const copy = () => {
    void copyText(text).then((ok) => {
      setCopied(ok ? 'copied' : 'failed');
      setTimeout(() => setCopied('idle'), 1200);
    });
  };
  return (
    <div className="json">
      <details open={open}>
        <summary>
          {label} <span className="muted">· {text.length.toLocaleString()} chars</span>
        </summary>
        <ScrollRegion label={label} className="json-body"><pre><code>{text}</code></pre></ScrollRegion>
      </details>
      <button type="button" className="btn btn-ghost btn-sm json-copy" onClick={copy}>
        {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
        <span className="sr-only"> {label}</span>
      </button>
    </div>
  );
}
