import type { Tab } from '../App';

const TOUR: { tab: Tab; title: string; body: string }[] = [
  { tab: 'planner', title: 'Plan a recipe', body: 'Paste a recipe (or use the sample) and plan it within 5 km. See the parsed lines, the SQL query plan per step, the store split that minimises basket + travel, and what could not be bought. Try Richmond as the shopping point.' },
  { tab: 'assistant', title: 'Ask the agent', body: 'Give it a recipe link. It reads the page through the gateway’s fetch tool, plans the basket with pantry’s plan_from_text, and answers with every tool call visible as it happens.' },
  { tab: 'catalog', title: 'Look things up', body: 'Run the planner’s own lookup (try “pene”) and open a product: every store’s offer, its origin and the evidence behind it, all from MCP get_product.' },
  { tab: 'provenance', title: 'Verify an origin', body: 'Submit a label reading (an MCP write), approve it in the review queue, and watch the coverage and the origin ranking change. Reset the demo data when you are done.' },
  { tab: 'mcp', title: 'Explore the MCP server', body: '15 tools, 5 resources and 3 prompts, called directly or through ContextForge. Switch to “no token” to see the endpoint refuse an anonymous client.' },
  { tab: 'simulations', title: 'Grade an agent', body: 'mcp-sim runs a simulated shopper against an agent, then a judge, a deterministic matcher and observers grade it. Run one scenario and read the verdict and the conversation.' },
  { tab: 'system', title: 'Check the wiring', body: 'Every service’s health and links, and the planner’s LLM switch: real planning on Gemini, or demo mode with deterministic stand-ins.' },
];

export default function OverviewView({ go }: { go: (tab: Tab) => void }) {
  return (
    <div className="view">
      <section className="panel">
        <h2>What this demo shows</h2>
        <p>
          A grocery planner for Vancouver shoppers, exposed as an <strong>MCP server</strong>, used by
          an <strong>AI agent</strong>, federated through a <strong>gateway</strong>, and graded by
          <strong> agent simulations</strong>. Every tab talks to the real services below; nothing on
          these pages is mocked.
        </p>
        <svg className="arch" viewBox="0 0 860 250" role="img" aria-label="Architecture">
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="arch-arrow" />
            </marker>
          </defs>
          <g className="arch-box"><rect x="10" y="95" width="150" height="60" rx="10" /><text x="85" y="120">This page</text><text x="85" y="140" className="arch-sub">demo hub :8090</text></g>
          <g className="arch-box"><rect x="230" y="15" width="170" height="60" rx="10" /><text x="315" y="40">Assistant agent</text><text x="315" y="60" className="arch-sub">Gemini / Ollama</text></g>
          <g className="arch-box"><rect x="230" y="175" width="170" height="60" rx="10" /><text x="315" y="200">mcp-sim runner</text><text x="315" y="220" className="arch-sub">simulate · judge · observe</text></g>
          <g className="arch-box"><rect x="470" y="95" width="170" height="60" rx="10" /><text x="555" y="120">ContextForge</text><text x="555" y="140" className="arch-sub">gateway :4444</text></g>
          <g className="arch-box arch-core"><rect x="700" y="15" width="150" height="60" rx="10" /><text x="775" y="40">pantry API + MCP</text><text x="775" y="60" className="arch-sub">:8000 · SQL planner</text></g>
          <g className="arch-box"><rect x="700" y="175" width="150" height="60" rx="10" /><text x="775" y="200">fetch server</text><text x="775" y="220" className="arch-sub">reads recipe pages</text></g>
          <path d="M160 115 L230 50" markerEnd="url(#arr)" />
          <path d="M160 135 L230 200" markerEnd="url(#arr)" />
          <path d="M160 110 C 400 -10, 600 -10, 700 40" markerEnd="url(#arr)" className="arch-dash" />
          <path d="M400 50 L470 110" markerEnd="url(#arr)" />
          <path d="M400 200 L470 140" markerEnd="url(#arr)" />
          <path d="M640 115 L700 55" markerEnd="url(#arr)" />
          <path d="M640 135 L700 195" markerEnd="url(#arr)" />
        </svg>
        <p className="muted">Solid arrows are MCP over streamable HTTP; the dashed one is the planner's REST API (the Planner, Catalog and ranking views).</p>
      </section>
      <section className="tour">
        {TOUR.map((t, i) => (
          <button key={t.tab} className="tour-card" onClick={() => go(t.tab)}>
            <span className="tour-n">{i + 1}</span>
            <strong>{t.title}</strong>
            <span>{t.body}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
