// Workshop › About: what this console is and how its parts fit, for a visitor. It was the Overview
// tab, which opened the console; the household's pages come first now, and this is where the
// "how it works" lives. The diagram is the services this page talks to; the cards are the places
// worth trying, each a link; the ports are for developers, behind a disclosure.
import { Icon } from '../components/icons';
import { hrefFor } from '../routes';

const TRY: { href: string; title: string; body: string }[] = [
  { href: hrefFor({ name: 'plan' }), title: 'Plan a week',
    body: 'Pick meals, see what each costs at stores near you, place them on days, and come away with a shopping plan and calendar events.' },
  { href: hrefFor({ name: 'ask' }), title: 'Ask the assistant',
    body: 'Give it a recipe link or a question. It plans with the same tools as these pages and shows every step it takes as it goes.' },
  { href: hrefFor({ name: 'workshop', tab: 'catalog' }), title: 'Look things up',
    body: 'Run the planner’s own product lookup (try “pene”) and open a product: every store’s price, where it comes from, and the evidence for that.' },
  { href: hrefFor({ name: 'workshop', tab: 'provenance' }), title: 'Check where food comes from',
    body: 'Submit what a package label says, approve it in the review queue, and watch the catalog’s origin coverage and ranking change.' },
  { href: hrefFor({ name: 'workshop', tab: 'mcp' }), title: 'Explore the MCP server',
    body: 'Every tool, resource and prompt the planner offers other programs, called directly or through the gateway.' },
  { href: hrefFor({ name: 'workshop', tab: 'simulations' }), title: 'Test the assistant',
    body: 'A simulated shopper talks to the assistant; a judge, a fixed checklist and observers grade the conversation.' },
  { href: hrefFor({ name: 'workshop', tab: 'metrics' }), title: 'See the numbers',
    body: 'How long each answer took, what it would cost and how its checks went, from the browser down to the planner.' },
  { href: hrefFor({ name: 'workshop', tab: 'system' }), title: 'Check the wiring',
    body: 'Each service’s health, and the planner’s switch between an AI model and demo mode.' },
  { href: hrefFor({ name: 'workshop', tab: 'planner' }), title: 'Try the Planner lab',
    body: 'Plan a single recipe and see the query plan behind each line, the split across stores, and what could not be bought.' },
];

const external = (label: string, href: string) => (
  <a href={href} target="_blank" rel="noreferrer">
    {label}<Icon name="external" className="ico-inline ico-end" /><span className="sr-only"> (opens in a new tab)</span>
  </a>
);

export default function AboutView() {
  return (
    <div className="view about">
      <section className="panel">
        <h2>How this works</h2>
        <p className="about-intro">
          Pantry Planner plans meals for a household in Vancouver and works out what to buy, where,
          and for how much. Underneath, the planner is a service other programs can use too: an AI
          assistant calls it over the <strong>Model Context Protocol</strong> (MCP), a{' '}
          <strong>gateway</strong> sits in between, and <strong>simulated shoppers</strong> test the
          assistant. Every page here talks to those real services; nothing is mocked.
        </p>
        {/* On a phone the diagram keeps a size its words can be read at, and scrolls sideways
            (the browser lets the keyboard scroll it when it overflows) */}
        <div className="arch-wrap">
        <svg className="arch" viewBox="0 0 860 250" role="img"
             aria-label="How the parts connect: this page talks to the assistant and to the simulated shoppers, both of which reach the pantry planner and a recipe reader through the ContextForge gateway; this page also calls the planner's own API directly.">
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="arch-arrow" />
            </marker>
          </defs>
          <g className="arch-box"><rect x="10" y="95" width="150" height="60" rx="10" /><text x="85" y="120">This page</text><text x="85" y="140" className="arch-sub">served by the demo hub</text></g>
          <g className="arch-box"><rect x="230" y="15" width="170" height="60" rx="10" /><text x="315" y="40">Assistant</text><text x="315" y="60" className="arch-sub">Gemini or a local model</text></g>
          <g className="arch-box"><rect x="230" y="175" width="170" height="60" rx="10" /><text x="315" y="200">Simulated shoppers</text><text x="315" y="220" className="arch-sub">mcp-sim: simulate, judge</text></g>
          <g className="arch-box"><rect x="470" y="95" width="170" height="60" rx="10" /><text x="555" y="120">Gateway</text><text x="555" y="140" className="arch-sub">ContextForge</text></g>
          <g className="arch-box arch-core"><rect x="700" y="15" width="150" height="60" rx="10" /><text x="775" y="40">Pantry planner</text><text x="775" y="60" className="arch-sub">API and MCP server</text></g>
          <g className="arch-box"><rect x="700" y="175" width="150" height="60" rx="10" /><text x="775" y="200">Recipe reader</text><text x="775" y="220" className="arch-sub">fetches recipe pages</text></g>
          <path d="M160 115 L230 50" markerEnd="url(#arr)" />
          <path d="M160 135 L230 200" markerEnd="url(#arr)" />
          <path d="M160 110 C 400 -10, 600 -10, 700 40" markerEnd="url(#arr)" className="arch-dash" />
          <path d="M400 50 L470 110" markerEnd="url(#arr)" />
          <path d="M400 200 L470 140" markerEnd="url(#arr)" />
          <path d="M640 115 L700 55" markerEnd="url(#arr)" />
          <path d="M640 135 L700 195" markerEnd="url(#arr)" />
        </svg>
        </div>
        <p className="muted">
          Solid arrows are MCP over HTTP; the dashed one is the planner’s own web API, which the meal
          plan, the catalog and the Planner lab call directly.
        </p>
        <p className="about-source">
          The code is open: {external('pantry-platform', 'https://github.com/pjvjay/pantry-platform')} (this
          console, the demo hub and the planner) and {external('pantry-gitops', 'https://github.com/pjvjay/pantry-gitops')} (how
          it is deployed).
        </p>
        <details className="about-dev">
          <summary>For developers: where each part listens</summary>
          <ul>
            <li>The demo hub, which serves this page: <code>:8090</code></li>
            <li>The pantry API and MCP server: <code>:8000</code></li>
            <li>The ContextForge gateway: <code>:4444</code></li>
          </ul>
        </details>
      </section>
      <section className="tour" aria-label="Things to try">
        {TRY.map((t, i) => (
          <a key={t.href} className="tour-card" href={t.href}>
            <span className="tour-n">{i + 1}</span>
            <strong>{t.title}</strong>
            <span>{t.body}</span>
          </a>
        ))}
      </section>
    </div>
  );
}
