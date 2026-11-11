// Home, for now: a welcome, the three ways in (Plan, Shop, Ask), each saying where the plan stands,
// and how the console works. Phase 3 of the Kitchen Table plan builds the full Home here (this
// week's tasks, the next trip, an Ask box); until then this only points the way. Where the demo
// hub is refusing or not there, one panel says Ask is off and planning still works.
import { Icon } from '../components/icons';
import { EmptyState, OfflinePanel } from '../components/ui';
import { useHubStatus } from '../hubStatus';
import { useMealPlan } from '../mealplan/store';
import { hrefFor } from '../routes';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function HomeView() {
  const mp = useMealPlan();
  const hub = useHubStatus();
  const d = mp.state.draft;
  const meals = d.meals.length;
  const trips = d.trips.length;
  const hubOff = hub.state === 'refused' || hub.state === 'unreachable';

  return (
    <div className="view home">
      <section className="home-hero" aria-labelledby="home-title">
        <h2 id="home-title" className="home-title">Plan the week’s meals, then the shopping</h2>
        <p className="home-lede">
          Pick meals for a week or two, see what they cost at stores near you, and come away with
          one shopping plan and the days to cook. Your plan is kept in this browser.
        </p>
      </section>

      <OfflinePanel off="Ask needs the demo hub, so it is off here."
                    works="planning meals, the shopping plan and the calendar file." />

      <ul className="home-ways">
        <li>
          <EmptyState icon="plan" heading="Plan"
                      status={meals ? `Your plan has ${count(meals, 'meal', 'meals')}.` : 'No meals planned yet.'}
                      cue="Pick meals, check what they need, and place them on days."
                      action={{ label: meals ? 'Continue planning' : 'Start planning', href: hrefFor({ name: 'plan' }) }} />
        </li>
        <li>
          <EmptyState icon="bag" heading="Shop"
                      status={trips ? `${count(trips, 'trip', 'trips')} approved.` : 'No shopping trips approved yet.'}
                      cue={trips ? 'Your trips, and what to buy on each.'
                        : 'Approve a trip in your plan and it shows up here.'}
                      action={{ label: 'See the shopping plan', href: hrefFor({ name: 'shop' }), variant: 'secondary' }} />
        </li>
        <li>
          <EmptyState icon="chat" heading="Ask"
                      status={hubOff ? 'Ask is off on this page.' : 'Ask about a recipe link, a product or a week of dinners.'}
                      cue="The assistant plans with the same tools as these pages, and shows every step."
                      action={{ label: 'Ask a question', href: hrefFor({ name: 'ask' }), variant: 'secondary' }} />
        </li>
      </ul>

      <p className="home-how">
        <Icon name="info" size={18} />
        <a href={hrefFor({ name: 'workshop', tab: 'about' })}>How this works</a>
      </p>
    </div>
  );
}
