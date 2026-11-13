// Where the plan's food comes from: the country rules in a few words, a product's origin tag
// measured against them, the products found counted by country, what the rule did and cannot do,
// what it left out for a line, why a line cannot be bought at all, and, for a list, the labels it
// asks the shopper to read and any product on it against the rule. The basket is pantry-api's live answer for tomato penne, spaghetti bolognese
// and the beef rice bowl under the default rules (fixtures/mealplan-basket-origin.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  againstRule, blockKey, countryRules, coveredText, excludedText, firstText, hasRules, heldFrom, leftOutText, listOr,
  listOriginText, originListWords, originTag, originTally, originWords, preferenceText, ruleDid, ruleDidText, ruleText,
  tallyText, theCountry,
} from '../src/mealplan/origin.ts';
import { DEFAULT_ORIGIN } from '../src/mealplan/model.ts';
import type { BasketOrigin, HeldBackProduct, MealBasket } from '../src/types.ts';

const BASKET: MealBasket = JSON.parse(readFileSync(new URL('./fixtures/mealplan-basket-origin.json', import.meta.url), 'utf8'));
const DEFAULT = countryRules({ ...DEFAULT_ORIGIN });
const NONE = countryRules({});
const PREFER_ONLY = countryRules({ exclude_origin: [], preference: ['Canada', 'Italy'] });

const from = (country: string, claim = `From ${country}`): BasketOrigin =>
  ({ country, claim, status: 'evidenced', preferred_rank: null });
const UNKNOWN: BasketOrigin = { country: null, claim: 'Origin unknown', status: 'unknown', preferred_rank: null };
const UNCLEAR: BasketOrigin = { country: null, claim: 'Origin unclear: sources disagree', status: 'conflicting', preferred_rank: null };

const held = (product_id: number, product: string, claim: string, country = 'United States'): HeldBackProduct =>
  ({ product_id, product, country, claim, field: 'ingredient_origin', store: 'ValueFoods East Van', price: 1 });

test('the rules in a few words: what is left out, and which country comes first', () => {
  assert.deepEqual(DEFAULT.excluded, ['United States']);
  assert.equal(DEFAULT.first, 'Canada');
  assert.equal(ruleText(DEFAULT), 'No US products', 'the default rule, in the words shoppers use');
  assert.equal(ruleText(countryRules({ exclude_origin: ['China'] })), 'No products from China');
  assert.equal(ruleText(countryRules({ exclude_origin: ['United States', 'China'] })),
    'No products from the United States or China');
  assert.equal(ruleText(countryRules({ exclude_origin: ['Netherlands', 'Italy', 'United Kingdom'] })),
    'No products from the Netherlands, Italy or the United Kingdom');
  assert.equal(ruleText(NONE), 'Any country');
  assert.equal(firstText(DEFAULT), 'Canada first');
  assert.equal(firstText(NONE), 'no preference');
  assert.equal(preferenceText(DEFAULT), 'Canada first, then 15 more');
  assert.equal(preferenceText(countryRules({ preference: ['France'] })), 'France first');
  // names are trimmed and said once; nothing at all is no rule
  assert.deepEqual(countryRules({ exclude_origin: [' China ', 'China', ''] }).excluded, ['China']);
  assert.equal(hasRules(NONE), false);
  assert.equal(hasRules(PREFER_ONLY), true);
  assert.equal(theCountry('United States'), 'the United States');
  assert.equal(theCountry('Solomon Islands'), 'the Solomon Islands');
  assert.equal(theCountry('Canada'), 'Canada');
  assert.equal(listOr(['A', 'B', 'C']), 'A, B or C');
});

test('a product\'s origin tag: the country, marked when it is the first preference', () => {
  const canada = originTag(from('Canada'), DEFAULT);
  assert.deepEqual([canada.kind, canada.lead, canada.words, canada.check], ['preferred', 'From ', 'Canada · preferred', false]);
  assert.equal(canada.label, 'From Canada, your first preference');
  // preferred_rank's base is never read: the first preference is the plan's own first country
  assert.equal(originTag({ ...from('Italy'), preferred_rank: 1 }, DEFAULT).words, 'Italy');
  assert.equal(originTag(from('Italy'), countryRules({ preference: ['Italy'] })).words, 'Italy · preferred');
  assert.equal(originTag(from('Canada'), NONE).words, 'Canada', 'no preference, no mark');
  // a processing claim: made there, its ingredients perhaps not; never marked as preferred
  const pasta = originTag(from('Canada', 'Made in Canada, ingredients may be imported'), DEFAULT);
  assert.deepEqual([pasta.kind, pasta.text, pasta.note, pasta.words],
    ['made', 'Made in Canada', 'ingredients may be imported', 'Made in Canada · ingredients may be imported']);
  assert.equal(pasta.label, 'Made in Canada; its ingredients may be imported');
  // a claim worded another way still names its country
  assert.equal(originTag(from('Japan', 'From Japan, as the source states'), DEFAULT).words, 'Japan');
});

test('an origin nobody knows asks for the label only while the plan leaves a country out', () => {
  assert.deepEqual([originTag(UNKNOWN, DEFAULT).words, originTag(UNKNOWN, DEFAULT).check],
    ['Origin unknown: check the label', true]);
  assert.deepEqual([originTag(UNKNOWN, PREFER_ONLY).words, originTag(UNKNOWN, PREFER_ONLY).check], ['Origin unknown', false]);
  // sources that disagree always do
  assert.deepEqual([originTag(UNCLEAR, NONE).kind, originTag(UNCLEAR, NONE).words, originTag(UNCLEAR, NONE).check],
    ['unclear', 'Origin unclear: check the label', true]);
  // evidenced with no country is not a country
  assert.equal(originTag({ ...from('Canada'), country: null }, DEFAULT).kind, 'unknown');
  // a product from a country the plan leaves out (planned or approved before that evidence came) is
  // still bought where it shows, so it is against the rule rather than left out
  const us = originTag(from('United States', 'Made in United States, ingredients may be imported'), DEFAULT);
  assert.deepEqual([us.kind, us.words], ['excluded', 'Made in the United States · against your rule']);
  assert.equal(us.label, 'Made in the United States, against your rule');
  assert.equal(originTag(from('United States'), DEFAULT).words, 'United States · against your rule');
  // nothing said of it at all (an older API's trip line): no tag
  assert.equal(originWords(undefined, DEFAULT), null);
  assert.equal(originWords(null, DEFAULT), null);
});

test('the products found, each once, counted by country: most first, ties in the plan\'s order', () => {
  const bought = BASKET.recipes.flatMap((r) => r.lines).filter((l) => l.available && l.product)
    .map((l) => ({ id: l.product!.id, origin: l.origin }));
  const t = originTally(bought, DEFAULT);
  assert.equal(t.products, 11, 'ground beef, oils and tomatoes are bought for two recipes but counted once');
  // made in Canada (the spaghetti; the olive oil, from Italian, Spanish and Greek oils) is counted
  // apart from from Canada, as the rows' tags tell them apart
  assert.deepEqual(t.countries, [{ country: 'Canada', made: false, n: 5 }, { country: 'Canada', made: true, n: 2 },
    { country: 'Italy', made: false, n: 1 }, { country: 'Mexico', made: false, n: 1 }, { country: 'India', made: false, n: 1 }]);
  assert.deepEqual([t.unknown, t.unclear], [0, 1], 'the garlic, whose sources disagree, is unclear, not unknown');
  assert.equal(tallyText(t, DEFAULT), 'Your 11 products: Canada\u00a05 · made\u00a0in\u00a0Canada\u00a02 · Italy\u00a01 · '
    + 'Mexico\u00a01 · India\u00a01 · 1\u00a0unclear:\u00a0check\u00a0the\u00a0label', 'each count kept to its words');
  // sources that disagree ask for the label whatever the rule; no source at all only while a country is left out
  assert.equal(tallyText(t, PREFER_ONLY).replace(/\u00a0/g, ' '),
    'Your 11 products: Canada 5 · made in Canada 2 · Italy 1 · Mexico 1 · India 1 · 1 unclear: check the label');
  const some = originTally([{ id: 1, origin: from('Canada') }, { id: 2, origin: UNKNOWN }, { id: 3, origin: UNKNOWN },
    { id: 4, origin: UNCLEAR }], DEFAULT);
  assert.equal(tallyText(some, DEFAULT).replace(/\u00a0/g, ' '),
    'Your 4 products: Canada 1 · 2 unknown · 1 unclear: check the label');
  assert.equal(tallyText(originTally([{ id: 1, origin: from('Canada') }, { id: 2, origin: UNKNOWN }], PREFER_ONLY),
    PREFER_ONLY).replace(/\u00a0/g, ' '), 'Your 2 products: Canada 1 · 1 unknown', 'nothing to look for');
  // pantry-api said nothing of any of them: nothing is counted, and nothing is said
  const silent = originTally([{ id: 1 }, { id: 2, origin: null }], DEFAULT);
  assert.deepEqual([silent.told, silent.products], [false, 0]);
  assert.equal(tallyText(silent, DEFAULT), '');
});

test('what the rule did across the basket, and what it cannot do', () => {
  assert.equal(BASKET.origin_held_back, 6);
  assert.equal(ruleDidText(DEFAULT, BASKET.origin_held_back), 'No US products · your rule left out 6 products');
  assert.equal(ruleDidText(DEFAULT, 1), 'No US products · your rule left out 1 product');
  assert.equal(ruleDidText(DEFAULT, 0), 'No US products · your rule had nothing to leave out');
  // an older API sends no count: the rule alone, never "nothing was left out"
  assert.equal(ruleDidText(DEFAULT, undefined), 'No US products');
  assert.equal(ruleDidText(PREFER_ONLY, 3), 'Any country · Canada first');
  assert.equal(ruleDidText(NONE, 0), null);
  assert.deepEqual(ruleDid(DEFAULT, 6), { rule: 'No US products', did: 'your rule left out 6 products' });
  assert.deepEqual(ruleDid(DEFAULT, undefined), { rule: 'No US products', did: '' });
  const t = { told: true, products: 11, countries: [], unknown: 4, unclear: 1 };
  assert.equal(coveredText(DEFAULT, t),
    'Only products known to be from the United States can be left out: the 5 whose origin is not known stay in your plan.',
    'sources that disagree do not make an origin known');
  assert.equal(coveredText(DEFAULT, { ...t, unknown: 0 }),
    'Only products known to be from the United States can be left out: the 1 whose origin is not known stays in your plan.');
  assert.equal(coveredText(PREFER_ONLY, t), 'Your preferences can only favour products whose origin is known: 6 of 11 here.');
  assert.equal(coveredText(DEFAULT, { ...t, unknown: 0, unclear: 0 }),
    'Every product found says where it comes from, so your rules cover them all.');
  assert.equal(coveredText(NONE, t), null);
  assert.equal(coveredText(DEFAULT, { ...t, told: false }), null);
});

test('what the rule left out for a line the plan still buys, said under it, never as a swap', () => {
  // held_back on a bought line is what the rule took out of the products the plan picks from, not
  // what the plan would have bought without it: said as what it is
  const beef = BASKET.recipes[0].lines[0];
  assert.equal(leftOutText(beef.held_back), 'Your rule left out Ground Beef Medium 900g (Product\u00a0of\u00a0USA)',
    'the claim kept on one line');
  const onions = BASKET.recipes[1].lines[2];
  assert.equal(leftOutText(onions.held_back)?.replace(/\u00a0/g, ' '),
    'Your rule left out Yellow Onion (Grown in USA) and 1 more from the United States');
  assert.equal(leftOutText([held(1, 'A', 'Product of USA'), held(2, 'B', 'Product of China', 'China')])?.replace(/\u00a0/g, ' '),
    'Your rule left out A (Product of USA) and 1 more from China');
  assert.equal(leftOutText([]), null);
  assert.equal(leftOutText(undefined), null, 'an older API');
  assert.equal(leftOutText([{ ...held(1, 'Rice', ''), claim: ' ' }])?.replace(/\u00a0/g, ' '),
    'Your rule left out Rice (From the United States)');
  // its sources disagree: said so, not as plainly from the country
  assert.equal(leftOutText([{ ...held(13, 'Fresh Garlic', 'Product of China', 'China'), field: 'conflicting_evidence' }])
    ?.replace(/\u00a0/g, ' '), 'Your rule left out Fresh Garlic (Product of China; its sources disagree)');
});

test('why a line cannot be bought: the shopper\'s own pick, or every product nearby', () => {
  const medium = held(35, 'Ground Beef Medium 900g', 'Product of USA');
  assert.equal(excludedText({ pinned: true, productId: 35, product: 'Ground Beef Medium 900g',
    origin: from('United States'), held: [medium, held(36, 'Ground Beef Extra Lean', 'Grown in USA')] }, DEFAULT),
  'Your chosen product, Ground Beef Medium 900g, is from the United States (Product of USA), which your rule leaves out');
  // an older API: the line's own origin names the country
  assert.equal(excludedText({ pinned: true, productId: 35, product: 'Ground Beef Medium 900g', origin: from('United States') },
    DEFAULT), 'Your chosen product, Ground Beef Medium 900g, is from the United States, which your rule leaves out');
  assert.equal(excludedText({ pinned: true, productId: 35, product: 'Ground Beef Medium 900g', origin: UNKNOWN }, DEFAULT),
    'Your chosen product, Ground Beef Medium 900g, is from a country your rule leaves out');
  // the planner's pick, chosen before its evidence came in: named as such, never "every product
  // nearby" (a Canadian one may well be sold nearby)
  assert.equal(excludedText({ pinned: false, productId: 35, product: 'Ground Beef Medium 900g', origin: from('United States'),
    held: [medium] }, DEFAULT),
  'The planned product, Ground Beef Medium 900g, is from the United States (Product of USA), which your rule leaves out');
  assert.equal(excludedText({ pinned: false, productId: 35, product: 'Ground Beef Medium 900g', origin: from('United States') },
    DEFAULT), 'The planned product, Ground Beef Medium 900g, is from the United States, which your rule leaves out');
  // held back on only some of its evidence (sources disagree): said as a may-be
  const garlic = { ...held(13, 'Fresh Garlic', 'Product of China', 'China'), field: 'conflicting_evidence' };
  const TWO = countryRules({ exclude_origin: ['United States', 'China'] });
  assert.equal(excludedText({ pinned: false, productId: 13, product: 'Fresh Garlic ~50g', origin: UNCLEAR, held: [garlic] }, TWO),
    'The planned product, Fresh Garlic ~50g, may be from China (its sources disagree: Product of China), which your rule '
    + 'leaves out');
  assert.equal(heldFrom(medium), 'is from the United States (Product of USA), which your rule leaves out');
  // no product left: every product nearby is from a country the rule leaves out
  assert.equal(excludedText({ pinned: false, productId: null, product: null, origin: UNKNOWN,
    held: [held(15, 'Canned Diced Tomatoes', 'Product of U.S.A.')] }, DEFAULT),
  'Every product nearby is from the United States, which your rule leaves out');
  assert.equal(excludedText({ pinned: false, productId: null, product: null, origin: UNKNOWN, held: [garlic] }, TWO),
    'Every product nearby may be from China (sources disagree), which your rule leaves out');
  assert.equal(excludedText({ pinned: false, productId: null, product: null, origin: null },
    countryRules({ exclude_origin: ['United States', 'China'] })),
  'Every product nearby is from the United States or China, which your rule leaves out', 'no held_back: the rule');
  assert.equal(excludedText({ pinned: false, productId: null, product: null, origin: null }, NONE),
    'Every product nearby is from a country your rule leaves out');
});

test('two lines the rule blocks on the same product are the same problem', () => {
  const medium = [held(35, 'Ground Beef Medium 900g', 'Product of USA')];
  const line = { kind: 'origin_excluded', pinned: true, productId: 35, ingredient: 'Ground Beef', held: medium };
  assert.equal(blockKey(line), 'pin:35');
  assert.equal(blockKey({ ...line, pinned: false }), 'planned:35', 'the planner\'s pick is another problem than a pin');
  assert.equal(blockKey({ ...line, pinned: false, productId: null }), 'held:35');
  assert.equal(blockKey({ ...line, pinned: false, productId: null, held: [], ingredient: ' Shaoxing Wine' }),
    'ingredient:shaoxing wine');
  assert.equal(blockKey({ ...line, kind: 'not_stocked' }), null, 'only the origin rule');
  assert.equal(blockKey({ ...line, kind: null }), null);
});

test('a list\'s one line: the rule, and how many products\' labels to read in the store', () => {
  const listed = (origins: (BasketOrigin | null | undefined)[]) =>
    origins.map((origin, i) => ({ productId: i + 1, name: `Product ${i + 1}`, origin }));
  const rows = listed([from('Canada'), from('Italy'), UNKNOWN, UNCLEAR, UNKNOWN]);
  assert.equal(listOriginText(DEFAULT, rows), 'No US products · 3 products to check on the label');
  // a product on two trips is one label to read, as Check ingredients counts it
  assert.equal(listOriginText(DEFAULT, [...rows, { ...rows[2] }]), 'No US products · 3 products to check on the label');
  assert.equal(listOriginText(DEFAULT, listed([from('Canada'), UNKNOWN])), 'No US products · 1 product to check on the label');
  assert.equal(listOriginText(DEFAULT, listed([from('Canada'), from('Mexico')])),
    'No US products · every product says where it comes from');
  // a product against the rule is said apart (againstRule), not in this quiet line
  assert.equal(listOriginText(DEFAULT, listed([from('Canada'), from('United States')])),
    'No US products · every product says where it comes from');
  // with nothing left out, an unknown origin is no reason to look; sources that disagree still are
  assert.equal(listOriginText(PREFER_ONLY, rows), 'Any country · Canada first · 1 product to check on the label');
  assert.equal(listOriginText(PREFER_ONLY, listed([from('Canada'), UNKNOWN])), 'Any country · Canada first');
  // pantry-api said nothing of any row: the rule alone, no count
  assert.equal(listOriginText(DEFAULT, listed([undefined, null])), 'No US products');
  assert.equal(listOriginText(NONE, rows), null);
});

test('a product a list still buys against the rule is named, each once, with its own country', () => {
  const chicken = { productId: 10, name: 'Boneless Skinless Chicken Breast 500g', origin: from('United States') };
  const ginger = { productId: 25, name: 'Fresh Ginger', origin: from('China', 'Product of China') };
  const canada = { productId: 1, name: 'Canola Oil 1L', origin: from('Canada') };
  assert.equal(againstRule(DEFAULT, [canada, chicken, { ...chicken }]),
    '1 product here is from the United States, against your rule: Boneless Skinless Chicken Breast 500g',
    'bought on two trips, named once');
  const TWO = countryRules({ exclude_origin: ['United States', 'China'] });
  // the countries are the products' own, not every country the rule names
  assert.equal(againstRule(TWO, [ginger, canada]), '1 product here is from China, against your rule: Fresh Ginger');
  assert.equal(againstRule(TWO, [ginger, chicken]),
    '2 products here are from China or the United States, against your rule: Fresh Ginger, Boneless Skinless Chicken '
    + 'Breast 500g');
  const many = [1, 2, 3, 4, 5].map((i) => ({ productId: 100 + i, name: `P${i}`, origin: from('United States') }));
  assert.equal(againstRule(DEFAULT, many), '5 products here are from the United States, against your rule: P1, P2, P3 and 2 more');
  assert.equal(againstRule(DEFAULT, [canada, { productId: 2, name: 'Rice', origin: undefined }]), null);
  assert.equal(againstRule(PREFER_ONLY, [chicken]), null, 'no country left out, nothing against the rule');
});

test('a row\'s origin in the copied list, in a few plain words', () => {
  assert.equal(originListWords(from('Canada'), DEFAULT), 'from Canada');
  assert.equal(originListWords(from('Canada', 'Made in Canada, ingredients may be imported'), DEFAULT),
    'made in Canada, ingredients may be imported', 'the caveat is why that label is worth reading');
  assert.equal(originListWords(UNKNOWN, DEFAULT), 'origin unknown: check the label');
  assert.equal(originListWords(UNCLEAR, DEFAULT), 'origin unclear: check the label');
  assert.equal(originListWords(UNKNOWN, PREFER_ONLY), '', 'not knowing is no reason to look');
  assert.equal(originListWords(from('United States'), DEFAULT), 'from the United States: against your rule');
  assert.equal(originListWords(undefined, DEFAULT), '');
});
