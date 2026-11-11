import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent, RefObject } from 'react';

import { cartLineKey, purchaseLineNo, swapAnnouncement, swapBlocked, swapNotice } from '../alternatives';
import { AlternativesDialog } from '../components/alternatives';
import type { OptionsTarget } from '../components/alternatives';
import { SettingsButton, SettingsPanel } from '../components/assistant/AskSettings';
import { Composer } from '../components/assistant/Composer';
import { TurnView } from '../components/assistant/TurnView';
import { useFollow } from '../components/assistant/useFollow';
import { AskContext, CartActions } from '../components/cart';
import { Icon } from '../components/icons';
import { ImportActions, ImportSheet } from '../components/ImportSheet';
import type { ImportStart } from '../components/ImportSheet';
import { HubErrorBanner, OfflinePanel } from '../components/ui';
import { useKeepClear } from '../components/useKeepClear';
import { agentChat, agentOptions, agentSwap, agentWarm } from '../hub';
import { useHubStatus } from '../hubStatus';
import { contextOf } from '../mealplan/chatDraft';
import { useMealPlan } from '../mealplan/store';
import { chatMessageFor } from '../recipes';
import { ChatMeter } from '../telemetry';
import {
  ASK_PREFILL_KEY, STARTERS, appendEvent, cardIn, foldRun, followUps, runsOnText, swapInTurns,
} from '../transcript';
import type { Turn, TurnEvent } from '../transcript';
import type { AgentOptions, CartLine, RecipeDoc, SwapResult } from '../types';

const NO_ROUTES: readonly string[] = [];

// Home's Ask box leaves its text here for the Ask page: read once, then gone, so a reload or a
// later visit does not bring it back. Storage a browser refuses is no text.
function takePrefill(): string {
  try {
    const text = window.sessionStorage.getItem(ASK_PREFILL_KEY);
    if (text !== null) window.sessionStorage.removeItem(ASK_PREFILL_KEY);
    return text?.trim() ?? '';
  } catch {
    return '';
  }
}

// After a starter or a follow-up is pressed it is gone, so focus goes to the message box, ready for
// what comes next; not on a touch screen pressed by a finger, where it would bring up the keyboard
// over the answer arriving.
function focusBoxAfter(e: MouseEvent, box: RefObject<HTMLTextAreaElement>) {
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  if (e.detail === 0 || !touch) box.current?.focus({ preventScroll: true });
}

// The Ask page: the household's assistant, on the demo hub.
//
// `routes`: the first path segments of the console's addresses (routes.ts ROUTE_IDS, today's and
// the old ones the shell rewrites), so a card's link is drawn only when it leads somewhere here.
// `active`: the page is the one showing. The Assistant stays mounted once opened (App.tsx), so its
// conversation survives a trip to another page; hidden, it scrolls nothing, and coming back to it
// is when Home's Ask box text is picked up.
//
// Each question is a turn (src/transcript.ts folds a turn's events into its run of steps). While
// the hub is refusing or not there, one panel says so at the top (what is off, what still works,
// Retry) instead of a red banner; the starters and Send wait. The hub's options are asked for
// once it answers, and again if it comes back.
export default function AssistantView({ routes = NO_ROUTES, active = true }: {
  routes?: readonly string[];
  active?: boolean;
}) {
  const mealPlan = useMealPlan();
  const hub = useHubStatus();
  const outage = hub.state === 'refused' || hub.state === 'unreachable';
  const [options, setOptions] = useState<AgentOptions | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [model, setModel] = useState('');
  const [target, setTarget] = useState('');
  const [disclosure, setDisclosure] = useState('progressive');
  const [conversation, setConversation] = useState<string | null>(null);
  // the conversation's MCP server and model, from its 'start' event: what its answers came from
  // (Settings says so), and the sim gateway cannot re-price
  const [convTarget, setConvTarget] = useState('');
  const [convModel, setConvModel] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // what a screen reader hears when a run ends, and after a swap
  const [ended, setEnded] = useState('');
  const [announce, setAnnounce] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsId = useId();
  const settingsButton = useRef<HTMLButtonElement>(null);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const latest = useRef<HTMLLIElement>(null);
  const nextId = useRef(1);
  const turnsNow = useRef(turns);
  turnsNow.current = turns;

  // The message box sticks above the bottom bar: the starters and replies the keyboard reaches
  // come to rest above it, not under it (useKeepClear), and the transcript follows the newest line
  // only while the reader is at it (useFollow).
  const keepClear = useKeepClear('bottom');
  const composer = useRef<HTMLFormElement | null>(null);
  const composerRef = useCallback((el: HTMLFormElement | null) => {
    keepClear(el);
    composer.current = el;
  }, [keepClear]);
  const follow = useFollow({ active, end, composer, content: turns });

  // a cart's swap button: the request goes in the message box, for the shopper to send or edit
  const ask = useCallback((text: string) => { setInput(text); box.current?.focus(); }, []);

  // The cart line whose Options are open, a swap in flight, and the line focus returns to when
  // the dialog closes: the one it was opened from, or the same line of the card a swap drew in its
  // place (a new element, found by its data-cart-line).
  const [optionsFor, setOptionsFor] = useState<OptionsTarget | null>(null);
  const [swapping, setSwapping] = useState(false);
  const focusLine = useRef('');
  const returnFocus = useMemo<RefObject<HTMLElement | null>>(() => ({
    get current() {
      return focusLine.current
        ? document.querySelector<HTMLElement>(`[data-cart-line="${focusLine.current}"]`) : null;
    },
  }), []);

  const openOptions = useCallback((ref: number, line: CartLine, pinned: boolean) => {
    if (line.line_no == null) return;
    focusLine.current = cartLineKey(ref, line.line_no);
    setOptionsFor({ ref, line, pinned });
  }, []);
  const cartActions = useMemo(() => ({ open: openOptions, busy: swapping }), [openOptions, swapping]);

  // The import sheet: from the message box, or from a chat import's card with what it read.
  const [importOpen, setImportOpen] = useState(false);
  const [importStart, setImportStart] = useState<ImportStart | null>(null);
  const openImport = useCallback((start: ImportStart) => {
    setImportStart(start);
    setImportOpen(true);
  }, []);

  // "Use this" (or back to the planner's pick): the hub re-prices with no model call, and the
  // card it returns replaces the one the choice was made in. A refusal is thrown back to the
  // dialog, which shows it. The redrawn card is the shopper's own doing: the page does not scroll.
  const choose = async (productId: number | null) => {
    const t = optionsFor;
    if (!t || !conversation || t.line.line_no == null) return;
    const lineNo = t.line.line_no;
    setSwapping(true);
    let result: SwapResult;
    try {
      result = await agentSwap(conversation, { ref: t.ref, line_no: lineNo, product_id: productId });
    } catch (e) {
      setSwapping(false);
      throw e;
    }
    const { card, note } = result;
    const before = cardIn(turnsNow.current, t.ref);
    focusLine.current = cartLineKey(card.ref ?? t.ref, purchaseLineNo(card.summary, lineNo));
    follow.hold();
    setTurns((prev) => swapInTurns(prev, t.ref, card, swapNotice(note)));
    if (before) setAnnounce(swapAnnouncement(before.summary, card.summary, lineNo));
    setOptionsFor(null);
    setSwapping(false);
  };

  useEffect(() => {
    if (!hub.ok || options) return undefined;
    let live = true;
    setOptionsError('');
    agentOptions().then((o) => {
      if (!live) return;
      setOptions(o);
      setModel(o.default_model);
      setTarget(o.default_target);
      if (o.default_disclosure) setDisclosure(o.default_disclosure);
    }).catch((e: Error) => { if (live) setOptionsError(`The Assistant could not start: ${e.message}`); });
    return () => { live = false; };
  }, [hub.ok, options]);

  // Home's Ask box: its text, in the message box, not sent; the shopper reads it over and sends.
  useEffect(() => {
    if (!active) return;
    const text = takePrefill();
    if (!text) return;
    setInput(text);
    box.current?.focus({ preventScroll: true });
  }, [active]);

  // A local model starts reading its instructions as soon as it is chosen: by the time the
  // question is typed, the first step has only the question left to read.
  const [warm, setWarm] = useState('');
  useEffect(() => {
    if (!model.startsWith('ollama:') || !target) { setWarm(''); return; }
    let live = true;
    const started = Date.now();
    setWarm('Reading its instructions and tools ahead of your question…');
    agentWarm({ model, target, disclosure })
      .then((r) => {
        if (!live) return;
        const secs = Math.round((Date.now() - started) / 1000);
        setWarm(r.prompt_tokens && r.prompt_tokens > 50
          ? `Ready: read its instructions and tools (${r.prompt_tokens.toLocaleString()} tokens) in ${secs} s`
          : 'Ready: its instructions and tools were already read');
      })
      .catch(() => { if (live) setWarm(''); });
    return () => { live = false; };
  }, [model, target, disclosure]);

  // `recipeDoc`: the recipe the shopper reviewed in the import sheet, which the hub keeps as the
  // conversation's next imp:N; the model plans exactly its lines. `fromBox`: the message box's own
  // words, which it gives up; a starter or a follow-up leaves whatever is being typed there.
  const send = async (message: string, opts: { recipeDoc?: RecipeDoc; fromBox?: boolean } = {}) => {
    if (!message.trim() || busy || swapping) return;
    setBusy(true);
    setEnded('');
    if (opts.fromBox) setInput('');
    const id = nextId.current;
    nextId.current += 1;
    // a swap's "the assistant sees this with your next message" is answered by this message
    setTurns((prev) => [...prev.map((t) => (t.notice ? { ...t, notice: undefined } : t)),
      { id, question: message, sentAt: Date.now(), events: [], ...(opts.recipeDoc ? { recipeDoc: opts.recipeDoc } : {}) }]);
    follow.stick();
    const patch = (f: (t: Turn) => Turn) => setTurns((prev) => prev.map((t) => (t.id === id ? f(t) : t)));
    const controller = new AbortController();
    abort.current = controller;
    let finished = false;
    let outcome: Pick<Turn, 'end' | 'failure'> = { end: 'done' };
    // what this browser measures about the turn's stream, joined to its trace in the hub
    const meter = new ChatMeter(model);
    try {
      // the Meal plan as it is now, which a meal-plan draft is made against
      const { context } = contextOf(mealPlan.state);
      await agentChat({ message, conversation_id: conversation, model, target, disclosure,
                        meal_plan: context,
                        ...(opts.recipeDoc ? { recipe_doc: opts.recipeDoc } : {}) }, (e) => {
        meter.event(e as { at?: number; trace_id?: string });
        if (e.type === 'start') {
          setConversation(e.conversation_id);
          setConvTarget(e.target);
          setConvModel(e.model);
        }
        if (e.type === 'done') finished = true;
        const got: TurnEvent = { ...e, rx: Date.now() };
        patch((t) => ({ ...t, events: appendEvent(t.events, got) }));
      }, controller.signal, () => meter.opened());
      if (!finished) {
        outcome = { end: 'failed',
          failure: 'The hub closed the answer stream before the agent finished (was the hub restarted?).' };
      }
    } catch (e) {
      outcome = (e as Error).name === 'AbortError' ? { end: 'stopped' } : { end: 'failed', failure: (e as Error).message };
    } finally {
      meter.finish(finished ? 'done' : 'interrupted');
      patch((t) => ({ ...t, ...outcome, endedAt: Date.now() }));
      setBusy(false);
      if (abort.current === controller) abort.current = null;
    }
  };

  const sendRef = useRef(send);
  sendRef.current = send;
  // Try again: the same question (and the same reviewed recipe), as a new turn.
  const retry = useCallback((t: Turn) => {
    void sendRef.current(t.question, t.recipeDoc ? { recipeDoc: t.recipeDoc } : {});
  }, []);

  const reset = () => {
    abort.current?.abort();
    setOptionsFor(null);
    setConversation(null);
    setConvTarget('');
    setConvModel('');
    setTurns([]);
    setEnded('');
    box.current?.focus({ preventScroll: true });
  };

  // When a run ends, a screen reader hears it once: answered, or stopped. (A run that could not
  // finish says so itself, as an alert.)
  const last = turns[turns.length - 1];
  const lastRun = useMemo(() => (last ? foldRun(last) : null), [last]);
  useEffect(() => {
    if (!lastRun || lastRun.status === 'running') return;
    if (lastRun.status === 'answered') setEnded(`Answered. ${lastRun.headline}.`);
    else if (lastRun.status === 'stopped') setEnded('Stopped.');
    // the turn and how it ended are what this answers to, not each redraw of it
  }, [last?.id, lastRun?.status]);

  const modelLabel = useCallback((id: string) => options?.models.find((m) => m.id === id)?.label
    ?? id.replace(/^(gemini|ollama):/, ''), [options]);

  const canAsk = !!options && !busy && !swapping && !outage;
  const asked = useMemo(() => turns.map((t) => t.question), [turns]);
  const next = lastRun && !busy ? followUps(lastRun, asked) : [];
  const pick = (q: string, e: MouseEvent) => {
    void send(q);
    focusBoxAfter(e, box);
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    settingsButton.current?.focus();
  };

  return (
    <div className="view ask">
      <OfflinePanel off="The Assistant runs on the demo hub, so it is off here."
                    works="planning meals, the shopping plan and the calendar file, which need only the pantry API." />

      <header className="ask-head">
        <h2 className="ask-title"><Icon name="chat" size={24} />Ask</h2>
        <div className="ask-head-actions">
          {(turns.length > 0 || busy) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
              <Icon name="plus" size={16} />New<span className="ask-narrow-hide"> conversation</span>
            </button>
          )}
          <SettingsButton open={settingsOpen} onToggle={() => setSettingsOpen((o) => !o)}
                          runsOn={runsOnText(options, { model, target },
                            convTarget ? { model: convModel || model, target: convTarget } : null)}
                          controls={settingsId} buttonRef={settingsButton} />
        </div>
        {settingsOpen && (
          <SettingsPanel id={settingsId} options={options} model={model} setModel={setModel} target={target}
                         setTarget={setTarget} disclosure={disclosure} setDisclosure={setDisclosure}
                         busy={busy} warm={warm} onClose={closeSettings} />
        )}
      </header>

      <HubErrorBanner error={optionsError} />

      {turns.length === 0 && (
        <section className="ask-start" aria-labelledby={`${settingsId}-start`}>
          <p className="ask-lede">
            I can plan meals, build shopping lists and swap ingredients, using the same pantry tools as
            the Plan and Shop pages. Every step I take shows under your question.
          </p>
          <h3 id={`${settingsId}-start`} className="label ask-start-label">Try one of these</h3>
          <ul className="ask-starters">
            {STARTERS.map((s) => (
              <li key={s.prompt}>
                <button type="button" className="card card-interactive ask-starter" disabled={!canAsk}
                        onClick={(e) => pick(s.prompt, e)}>
                  <span className="ask-starter-title">{s.title}</span>
                  <span className="ask-starter-text">{s.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* a press in here is the reader's own change (opening a step): the page measures again
          where the reader is, and does not follow it */}
      <div className="ask-transcript" onClick={follow.recheck}>
        <AskContext.Provider value={ask}>
          <CartActions.Provider value={cartActions}>
            <ImportActions.Provider value={openImport}>
              {turns.length > 0 && (
                <ol className="ask-turns">
                  {turns.map((t, i) => (
                    <TurnView key={t.id} turn={t} routes={routes} modelLabel={modelLabel} onRetry={retry}
                              outage={outage} latestRef={i === turns.length - 1 ? latest : undefined} />
                  ))}
                </ol>
              )}
            </ImportActions.Provider>
          </CartActions.Provider>
        </AskContext.Provider>
        {next.length > 0 && (
          <div className="ask-next" role="group" aria-labelledby={`${settingsId}-next`}>
            <span id={`${settingsId}-next`} className="label">Ask next</span>
            {next.map((q) => (
              <button key={q} type="button" className="ask-chip" disabled={!canAsk} onClick={(e) => pick(q, e)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <div ref={end} className="ask-end" />
      </div>

      <p className="sr-only" role="status">{ended}</p>
      <p className="sr-only" role="status">{announce}</p>

      {follow.pill && (
        <button type="button" className="btn btn-secondary btn-sm ask-pill"
                onClick={() => { follow.jump(); latest.current?.focus({ preventScroll: true }); }}>
          <Icon name="arrow-down" size={16} />New reply
        </button>
      )}

      <AlternativesDialog
        conversationId={conversation}
        target={optionsFor}
        blocked={swapBlocked(busy, convTarget)}
        returnFocus={returnFocus}
        onChoose={choose}
        onClose={() => setOptionsFor(null)}
      />

      <ImportSheet
        open={importOpen}
        onClose={() => setImportOpen(false)}
        start={importStart}
        planInChat={options ? (doc) => void send(chatMessageFor(doc), { recipeDoc: doc }) : null}
        chatBlocked={busy ? 'The assistant is answering; wait for it, or press Stop, first.'
          : swapping ? 'A cart change is being priced; try again in a moment.' : null}
      />

      <Composer value={input} onChange={setInput} onSend={() => void send(input, { fromBox: true })}
                onStop={() => abort.current?.abort()} onImport={() => openImport({})} busy={busy}
                canSend={canAsk && !!input.trim()} offline={outage} boxRef={box} formRef={composerRef} />
    </div>
  );
}
