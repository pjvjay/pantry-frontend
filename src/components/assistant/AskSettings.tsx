// The Assistant's settings, out of the way until wanted: a Settings button in the page's header
// that says what the assistant runs on ("Gemini 3 Flash (preview) · pantry": what the
// conversation's answers came from, or what the first question will use; transcript.ts
// runsOnText), and opens, in place under the header, the model, the MCP server, the toolset and
// how it all works. It is a
// disclosure: the choices follow the button in the reading order, and Escape on the button or
// inside the choices closes them, with focus on the button. While an answer is coming the choices
// wait (they apply to the next question).
import { useId } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

import type { AgentOptions } from '../../types';
import { Icon } from '../icons';

// `runsOn`: the model and server in a few words, empty until the hub's options are known.
export function SettingsButton({ open, onToggle, runsOn, controls, buttonRef }: {
  open: boolean;
  onToggle: () => void;
  runsOn: string;
  controls: string;
  buttonRef: RefObject<HTMLButtonElement>;
}) {
  return (
    <button ref={buttonRef} type="button" className="btn btn-secondary btn-sm ask-settings-btn"
            aria-expanded={open} aria-controls={open ? controls : undefined} onClick={onToggle}
            onKeyDown={(e) => { if (e.key === 'Escape' && open) onToggle(); }}>
      <Icon name="settings" size={16} />
      Settings
      {runsOn && (
        <span className="ask-settings-now">
          <span className="sr-only">: </span>{runsOn}
        </span>
      )}
      <Icon name="chevron-down" size={16} className="ask-settings-chev" />
    </button>
  );
}

export function SettingsPanel({
  id, options, model, setModel, target, setTarget, disclosure, setDisclosure, busy, warm, onClose,
}: {
  id: string;
  options: AgentOptions | null;
  model: string;
  setModel: (v: string) => void;
  target: string;
  setTarget: (v: string) => void;
  disclosure: string;
  setDisclosure: (v: string) => void;
  busy: boolean;
  // a local model reading its instructions ahead of the question, and when it is ready
  warm: string;
  onClose: () => void;
}) {
  const modelId = useId();
  const targetId = useId();
  const toolsetId = useId();
  const targetHelp = useId();
  const chosen = options?.targets.find((t) => t.id === target);
  const off = busy || !options;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose();
  };

  return (
    <div id={id} className="card ask-settings" role="group" aria-label="Assistant settings" onKeyDown={onKeyDown}>
      <div className="ask-settings-grid">
        <div className="ask-field">
          <label htmlFor={modelId} className="label">Model</label>
          <select id={modelId} value={model} onChange={(e) => setModel(e.target.value)} disabled={off}>
            {options?.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          {/* on the page from the start (empty), so a screen reader hears when a local model is ready */}
          <p className="ask-field-help ask-warm" role="status">{warm}</p>
        </div>
        <div className="ask-field">
          <label htmlFor={targetId} className="label">MCP server</label>
          <select id={targetId} value={target} onChange={(e) => setTarget(e.target.value)} disabled={off}
                  aria-describedby={chosen?.description ? targetHelp : undefined}>
            {options?.targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {chosen?.description && <p id={targetHelp} className="ask-field-help">{chosen.description}</p>}
        </div>
        <div className="ask-field">
          <label htmlFor={toolsetId} className="label">Toolset</label>
          <select id={toolsetId} value={disclosure} onChange={(e) => setDisclosure(e.target.value)} disabled={off}>
            <option value="progressive">Few tools, more as needed</option>
            <option value="all">All tools from the start</option>
          </select>
        </div>
      </div>
      {busy && <p className="ask-field-help">These apply from your next question.</p>}
      <p className="ask-about">
        A grocery agent that plans by calling the pantry’s MCP tools; every call and its result is in
        the steps under your question. Its instructions are pantry-api’s recipe-shopper skill
        {options && !options.skill_loaded && ' (not found: it runs with the short preamble only)'}. A
        recipe link in your message is read by the demo hub before the model starts, and the
        assistant plans exactly the lines it read; <strong>Import a recipe</strong> lets you review
        them first, or paste a list. A page the hub cannot read goes to the gateway’s fetch tool
        (<strong>pantry-recipes</strong>); the direct <strong>pantry</strong> server has no fetch.
      </p>
      <button type="button" className="btn btn-ghost btn-sm ask-settings-done" onClick={onClose}>
        <Icon name="check" size={16} />Done
      </button>
    </div>
  );
}
