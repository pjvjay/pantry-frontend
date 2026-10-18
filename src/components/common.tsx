import { useState } from 'react';

export function parseList(text: string): string[] {
  return text.split(',').map((c) => c.trim()).filter(Boolean);
}

export function ErrorBanner({ error, hint }: { error: string; hint?: string }) {
  if (!error) return null;
  return (
    <div className="banner banner-error">
      {error}
      {hint && <div className="banner-hint">{hint}</div>}
    </div>
  );
}

// A collapsible, pretty-printed JSON block for tool results and raw payloads.
export function JsonView({ value, open = false, label = 'JSON' }: {
  value: unknown; open?: boolean; label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <details className="json" open={open}>
      <summary>
        {label} <span className="muted">· {text.length.toLocaleString()} chars</span>
        <button
          type="button"
          className="linkish json-copy"
          onClick={(e) => {
            e.preventDefault();
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </summary>
      <pre><code>{text}</code></pre>
    </details>
  );
}

export function StatusDot({ ok }: { ok: boolean | null }) {
  return <span className={`dot ${ok === null ? 'dot-muted' : ok ? 'dot-ok' : 'dot-bad'}`} />;
}
