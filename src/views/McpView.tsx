import { useEffect, useMemo, useState } from 'react';
import { ErrorBanner, JsonView } from '../components/common';
import { mcpCall, mcpCatalog, mcpPrompt, mcpRead, mcpTargets } from '../hub';
import type { JsonSchema, McpCatalog, McpTarget, McpTool, ToolResult } from '../types';

// The JSON type a schema property takes, looking through `anyOf: [{type: X}, {type: null}]`.
function baseType(s: JsonSchema): string {
  if (Array.isArray(s.type)) return s.type.find((t) => t !== 'null') ?? 'string';
  if (s.type) return s.type;
  const inner = s.anyOf?.find((a) => a.type && a.type !== 'null');
  return inner ? baseType(inner) : 'string';
}

function enumOf(s: JsonSchema): unknown[] | undefined {
  return s.enum ?? s.anyOf?.find((a) => a.enum)?.enum;
}

// Turn the form's strings into the arguments the schema expects; empty optional fields are left out.
function buildArgs(schema: JsonSchema | undefined, values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(schema?.properties ?? {})) {
    const raw = values[name];
    if (raw === undefined || raw === '') continue;
    const t = baseType(prop);
    if (t === 'integer') out[name] = parseInt(raw, 10);
    else if (t === 'number') out[name] = Number(raw);
    else if (t === 'boolean') out[name] = raw === 'true';
    else if (t === 'array') {
      const itemType = prop.items ? baseType(prop.items) : 'string';
      const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
      out[name] = itemType === 'integer' || itemType === 'number' ? parts.map(Number) : parts;
    } else if (t === 'object') {
      try { out[name] = JSON.parse(raw); } catch { out[name] = raw; }
    } else out[name] = raw;
  }
  return out;
}

function ToolForm({ target, tool }: { target: string; tool: McpTool }) {
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const [values, setValues] = useState<Record<string, string>>({});
  const [raw, setRaw] = useState('');
  const [useRaw, setUseRaw] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setValues({}); setResult(null); setError(''); setUseRaw(false); }, [tool.name, target]);
  const args = useMemo(() => buildArgs(tool.inputSchema, values), [tool.inputSchema, values]);

  const call = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await mcpCall(target, tool.name, useRaw ? JSON.parse(raw || '{}') : args));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const annotations = tool.annotations ?? {};
  return (
    <div>
      <h3 className="tool-title"><code>{tool.name}</code>
        {annotations.readOnlyHint === true && <span className="chip chip-ok">read-only</span>}
        {annotations.destructiveHint === true && <span className="chip pill-bad">destructive</span>}
        {annotations.readOnlyHint === false && <span className="chip chip-warn">writes</span>}
        {annotations.openWorldHint === true && <span className="chip">open world</span>}
      </h3>
      {tool.description && <p className="tool-desc">{tool.description}</p>}
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void call(); }}>
        {!useRaw && Object.entries(props).map(([name, prop]) => {
          const t = baseType(prop);
          const choices = enumOf(prop);
          const hint = `${t}${required.has(name) ? ', required' : ''}${prop.default !== undefined && prop.default !== null ? `, default ${JSON.stringify(prop.default)}` : ''}`;
          return (
            <label key={name} className={t === 'string' && !choices ? 'wide' : ''} title={prop.description}>
              {name} <span className="muted">({hint})</span>
              {choices ? (
                <select value={values[name] ?? ''} onChange={(e) => setValues({ ...values, [name]: e.target.value })}>
                  <option value="">—</option>
                  {choices.map((c) => <option key={String(c)}>{String(c)}</option>)}
                </select>
              ) : t === 'boolean' ? (
                <select value={values[name] ?? ''} onChange={(e) => setValues({ ...values, [name]: e.target.value })}>
                  <option value="">—</option><option>true</option><option>false</option>
                </select>
              ) : (
                <input value={values[name] ?? ''}
                       placeholder={t === 'array' ? 'comma separated' : t === 'object' ? 'JSON' : ''}
                       onChange={(e) => setValues({ ...values, [name]: e.target.value })} />
              )}
            </label>
          );
        })}
        {useRaw && (
          <label className="wide">arguments (JSON)
            <textarea rows={6} value={raw} onChange={(e) => setRaw(e.target.value)} />
          </label>
        )}
        <div className="form-row">
          <button disabled={busy}>{busy ? 'Calling…' : 'Call tool'}</button>
          <button type="button" className="secondary" onClick={() => {
            setRaw(JSON.stringify(args, null, 2)); setUseRaw(!useRaw);
          }}>{useRaw ? 'Form' : 'Edit as JSON'}</button>
        </div>
      </form>
      {!useRaw && <JsonView value={{ name: tool.name, arguments: args }} label="request" />}
      <ErrorBanner error={error} />
      {result && (
        <div className={`result ${result.is_error ? 'result-error' : 'result-ok'}`}>
          <div className="plan-meta">
            <span className={`chip ${result.is_error ? 'pill-bad' : 'chip-ok'}`}>{result.is_error ? 'isError' : 'ok'}</span>
            <span className="chip chip-muted">{result.ms} ms</span>
            {result.truncated && <span className="chip chip-warn">text truncated</span>}
          </div>
          {result.structured != null && <JsonView value={result.structured} label="structuredContent" open />}
          <JsonView value={result.text} label="content (text)" open={result.structured == null} />
        </div>
      )}
      <JsonView value={tool.inputSchema ?? {}} label="input schema" />
    </div>
  );
}

function ResourcePanel({ target, catalog }: { target: string; catalog: McpCatalog }) {
  const [uri, setUri] = useState('');
  const [content, setContent] = useState<unknown>(null);
  const [error, setError] = useState('');

  const read = async (u: string) => {
    setUri(u);
    setError('');
    setContent(null);
    try {
      const r = await mcpRead(target, u);
      const text = r.contents[0]?.text ?? '';
      try { setContent(JSON.parse(text)); } catch { setContent(text); }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (catalog.resources.length === 0 && catalog.resource_templates.length === 0) {
    return <p className="muted">This server publishes no resources{target.startsWith('gateway') && ' (a ContextForge virtual server carries the tools it was given; pantry\'s resources stay on the direct endpoint)'}.</p>;
  }
  return (
    <div>
      <ul className="origin-list">
        {catalog.resources.map((r) => (
          <li key={r.uri}><button className="linkish" onClick={() => void read(r.uri)}>{r.uri}</button>
            <span className="muted"> — {r.description ?? r.name}</span></li>
        ))}
        {catalog.resource_templates.map((t) => (
          <li key={t.uriTemplate}><code>{t.uriTemplate}</code><span className="muted"> — {t.description ?? t.name} (template: edit the URI below)</span></li>
        ))}
      </ul>
      <form className="form-row" onSubmit={(e) => { e.preventDefault(); void read(uri); }}>
        <input className="grow" value={uri} onChange={(e) => setUri(e.target.value)} placeholder="pantry://recipes/tomato_penne" />
        <button disabled={!uri.trim()}>Read</button>
      </form>
      <ErrorBanner error={error} />
      {content !== null && <JsonView value={content} label={uri} open />}
    </div>
  );
}

function PromptPanel({ target, catalog }: { target: string; catalog: McpCatalog }) {
  const [name, setName] = useState('');
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Awaited<ReturnType<typeof mcpPrompt>> | null>(null);
  const [error, setError] = useState('');
  const prompt = catalog.prompts.find((p) => p.name === name);

  if (catalog.prompts.length === 0) return <p className="muted">This server publishes no prompts.</p>;
  return (
    <div>
      <div className="form-row">
        <select value={name} onChange={(e) => { setName(e.target.value); setArgs({}); setResult(null); }}>
          <option value="">choose a prompt…</option>
          {catalog.prompts.map((p) => <option key={p.name}>{p.name}</option>)}
        </select>
      </div>
      {prompt && (
        <form className="form-grid" onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try { setResult(await mcpPrompt(target, prompt.name, args)); } catch (err) { setError((err as Error).message); }
        }}>
          <p className="wide tool-desc">{prompt.description}</p>
          {(prompt.arguments ?? []).map((a) => (
            <label key={a.name} className="wide">{a.name}{a.required && ' *'} <span className="muted">{a.description}</span>
              <input value={args[a.name] ?? ''} onChange={(e) => setArgs({ ...args, [a.name]: e.target.value })} />
            </label>
          ))}
          <button>Render prompt</button>
        </form>
      )}
      <ErrorBanner error={error} />
      {result && result.messages.map((m, i) => (
        <div key={i} className="bubble bubble-agent"><div className="muted">{m.role}</div>
          <pre className="prompt-text">{m.content.text}</pre></div>
      ))}
    </div>
  );
}

export default function McpView() {
  const [targets, setTargets] = useState<McpTarget[]>([]);
  const [target, setTarget] = useState('pantry');
  const [catalog, setCatalog] = useState<McpCatalog | null>(null);
  const [tab, setTab] = useState<'tools' | 'resources' | 'prompts'>('tools');
  const [tool, setTool] = useState<string>('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { mcpTargets().then(setTargets).catch((e: Error) => setError(e.message)); }, []);
  useEffect(() => {
    setLoading(true);
    setCatalog(null);
    setError('');
    mcpCatalog(target)
      .then((c) => { setCatalog(c); setTool(c.tools[0]?.name ?? ''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [target]);

  const current = targets.find((t) => t.id === target);
  const selected = catalog?.tools.find((t) => t.name === tool);
  return (
    <div className="view">
      <section className="panel">
        <h2>MCP explorer</h2>
        <p className="card-sub">
          Everything the pantry MCP server offers, directly and through the ContextForge gateway.
          The hub holds the credentials; switch to <strong>no token</strong> to watch the endpoint
          refuse an anonymous client.
        </p>
        <div className="target-row">
          {targets.map((t) => (
            <button key={t.id} className={`target ${t.id === target ? 'target-active' : ''}`} onClick={() => setTarget(t.id)}>
              <strong>{t.label}</strong>
              <span>{t.auth}</span>
            </button>
          ))}
        </div>
        {current && <p className="muted">{current.description}{catalog?.target.url && <> · <code>{catalog.target.url}</code></>}</p>}
      </section>

      {loading && <p className="muted">Connecting…</p>}
      <ErrorBanner error={error && `The server refused or could not be reached: ${error}`}
                   hint={target === 'pantry-anon' ? 'This is the expected result: pantry requires a bearer token on /mcp when MCP_AUTH_TOKENS is set.' : undefined} />

      {catalog && (
        <section className="panel">
          <div className="subtabs">
            {(['tools', 'resources', 'prompts'] as const).map((t) => (
              <button key={t} className={`subtab ${tab === t ? 'subtab-active' : ''}`} onClick={() => setTab(t)}>
                {t} ({t === 'tools' ? catalog.tools.length : t === 'resources'
                  ? catalog.resources.length + catalog.resource_templates.length : catalog.prompts.length})
              </button>
            ))}
          </div>
          {tab === 'tools' && (
            <div className="split">
              <ul className="tool-list split-side-left">
                {catalog.tools.map((t) => (
                  <li key={t.name}>
                    <button className={`tool-item ${t.name === tool ? 'tool-item-active' : ''}`} onClick={() => setTool(t.name)}>
                      <code>{t.name}</code>
                      {t.annotations?.readOnlyHint === false && <span className="dot dot-warn" title="writes" />}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="split-main">{selected && <ToolForm target={target} tool={selected} />}</div>
            </div>
          )}
          {tab === 'resources' && <ResourcePanel target={target} catalog={catalog} />}
          {tab === 'prompts' && <PromptPanel target={target} catalog={catalog} />}
          {catalog.notes.length > 0 && <p className="muted">{catalog.notes.join(' · ')}</p>}
        </section>
      )}
    </div>
  );
}
