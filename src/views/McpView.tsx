// Workshop › MCP explorer: everything the pantry MCP server offers, directly and through the
// ContextForge gateway, called by hand. The targets are pressed buttons (one at a time); the tools,
// resources and prompts are a real tab list (components/Tabs.tsx: the arrow keys move along it, and
// each tab names its panel). A call's result says ok or error in a tag, words and a glyph.
import { useEffect, useId, useMemo, useState } from 'react';
import { JsonView } from '../components/common';
import { StateTag } from '../components/evidence';
import { Icon } from '../components/icons';
import { TabList, TabPanel } from '../components/Tabs';
import { HubErrorBanner, Skeleton } from '../components/ui';
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
        {annotations.readOnlyHint === true && <StateTag state={{ kind: 'done', word: 'Read-only' }} />}
        {annotations.destructiveHint === true && <StateTag state={{ kind: 'attention', word: 'Destructive' }} />}
        {annotations.readOnlyHint === false && <StateTag state={{ kind: 'changed', word: 'Writes' }} />}
        {annotations.openWorldHint === true && <span className="chip">open world</span>}
      </h3>
      {tool.description && <p className="tool-desc">{tool.description}</p>}
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void call(); }}>
        {!useRaw && Object.entries(props).map(([name, prop]) => {
          const t = baseType(prop);
          const choices = enumOf(prop);
          const hint = `${t}${required.has(name) ? ', required' : ''}${prop.default !== undefined && prop.default !== null ? `, default ${JSON.stringify(prop.default)}` : ''}`;
          // free text takes the form's whole width
          const wide = t === 'string' && !choices;
          return (
            <label key={name} className={wide ? 'wide' : undefined} title={prop.description}>
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
          <label className="wide">Arguments (JSON)
            <textarea rows={6} value={raw} onChange={(e) => setRaw(e.target.value)} />
          </label>
        )}
        <div className="form-row">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Calling…' : 'Call tool'}</button>
          <button type="button" className="btn btn-secondary" onClick={() => {
            setRaw(JSON.stringify(args, null, 2)); setUseRaw(!useRaw);
          }}>{useRaw ? 'Back to the form' : 'Edit as JSON'}</button>
        </div>
      </form>
      {!useRaw && <JsonView value={{ name: tool.name, arguments: args }} label="Request" />}
      <HubErrorBanner error={error} />
      {result && (
        <div className={`result ${result.is_error ? 'result-error' : 'result-ok'}`} role="status">
          <p className="result-head">
            <StateTag state={result.is_error ? { kind: 'attention', word: 'The tool answered with an error' }
              : { kind: 'done', word: 'Answered' }} />
            <span className="muted figures">{result.ms} ms</span>
            {result.truncated && <span className="muted">The text was cut short.</span>}
          </p>
          {result.structured != null && <JsonView value={result.structured} label="structuredContent" open />}
          <JsonView value={result.text} label="Content (text)" open={result.structured == null} />
        </div>
      )}
      <JsonView value={tool.inputSchema ?? {}} label="Input schema" />
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
          <li key={r.uri}><button type="button" className="linkish" onClick={() => void read(r.uri)}>{r.uri}</button>
            <span className="muted"> — {r.description ?? r.name}</span></li>
        ))}
        {catalog.resource_templates.map((t) => (
          <li key={t.uriTemplate}><code>{t.uriTemplate}</code><span className="muted"> — {t.description ?? t.name} (template: edit the URI below)</span></li>
        ))}
      </ul>
      <form className="form-row" onSubmit={(e) => { e.preventDefault(); void read(uri); }}>
        <input className="grow" value={uri} onChange={(e) => setUri(e.target.value)} placeholder="pantry://recipes/tomato_penne"
               aria-label="Resource URI" />
        <button type="submit" className="btn btn-primary" disabled={!uri.trim()}>Read</button>
      </form>
      <HubErrorBanner error={error} />
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
        <select value={name} onChange={(e) => { setName(e.target.value); setArgs({}); setResult(null); }}
                aria-label="Prompt">
          <option value="">Choose a prompt…</option>
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
          <button type="submit" className="btn btn-primary">Render prompt</button>
        </form>
      )}
      <HubErrorBanner error={error} />
      {result && result.messages.map((m, i) => (
        <div key={i} className="bubble bubble-agent"><p className="bubble-role">{m.role}</p>
          <pre className="prompt-text">{m.content.text}</pre></div>
      ))}
    </div>
  );
}

type Offer = 'tools' | 'resources' | 'prompts';

export default function McpView() {
  const tabsId = useId();
  const [targets, setTargets] = useState<McpTarget[]>([]);
  const [target, setTarget] = useState('pantry');
  const [catalog, setCatalog] = useState<McpCatalog | null>(null);
  const [tab, setTab] = useState<Offer>('tools');
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
    <div className="view ws-stack">
      <section className="card">
        <h2 className="card-title">MCP explorer</h2>
        <p className="card-sub">
          Everything the pantry MCP server offers, directly and through the ContextForge gateway.
          The hub holds the credentials; switch to <strong>no token</strong> to watch the endpoint
          refuse an anonymous client.
        </p>
        <div className="target-row" role="group" aria-label="Server">
          {targets.map((t) => (
            <button key={t.id} type="button" className={`target ${t.id === target ? 'target-active' : ''}`}
                    aria-pressed={t.id === target} onClick={() => setTarget(t.id)}>
              <strong>{t.label}</strong>
              <span>{t.auth}</span>
            </button>
          ))}
        </div>
        {current && <p className="muted">{current.description}{catalog?.target.url && <> · <code>{catalog.target.url}</code></>}</p>}
      </section>

      {loading && <section className="card"><Skeleton kind="row" count={6} label="Connecting to the server" /></section>}
      <HubErrorBanner error={error && `The server refused or could not be reached: ${error}`}
                   hint={target === 'pantry-anon' ? 'This is the expected result: pantry requires a bearer token on /mcp when MCP_AUTH_TOKENS is set.' : undefined} />

      {catalog && (() => {
        const counts: Record<Offer, number> = {
          tools: catalog.tools.length,
          resources: catalog.resources.length + catalog.resource_templates.length,
          prompts: catalog.prompts.length,
        };
        const words: Record<Offer, string> = { tools: 'Tools', resources: 'Resources', prompts: 'Prompts' };
        return (
          <section className="card">
            <TabList idBase={tabsId} label="What the server offers" current={tab} onChange={setTab}
                     tabs={(['tools', 'resources', 'prompts'] as const).map((t) => ({
                       key: t, label: <>{words[t]} <span className="tab-count">{counts[t]}</span></>,
                     }))} />
            <TabPanel idBase={tabsId} tabKey="tools" current={tab} reachable={counts.tools === 0}>
              {counts.tools === 0 ? <p className="muted">This server offers no tools.</p> : (
                <div className="split">
                  <ul className="tool-list split-side-left" aria-label="Tools">
                    {catalog.tools.map((t) => (
                      <li key={t.name}>
                        <button type="button" className={`tool-item ${t.name === tool ? 'tool-item-active' : ''}`}
                                aria-current={t.name === tool || undefined} onClick={() => setTool(t.name)}>
                          <code>{t.name}</code>
                          {t.annotations?.readOnlyHint === false && (
                            <span className="tool-writes"><Icon name="alert" size={14} />writes</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="split-main">{selected && <ToolForm target={target} tool={selected} />}</div>
                </div>
              )}
            </TabPanel>
            <TabPanel idBase={tabsId} tabKey="resources" current={tab} reachable={counts.resources === 0}>
              <ResourcePanel target={target} catalog={catalog} />
            </TabPanel>
            <TabPanel idBase={tabsId} tabKey="prompts" current={tab} reachable={counts.prompts === 0}>
              <PromptPanel target={target} catalog={catalog} />
            </TabPanel>
            {catalog.notes.length > 0 && <p className="muted">{catalog.notes.join(' · ')}</p>}
          </section>
        );
      })()}
    </div>
  );
}
