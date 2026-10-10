// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The meal plan's pictures: a recipe's, and an ingredient's product. pantry-api names a
// recipe's (/mealplan/catalog and /mealplan/basket: a Wikipedia article's lead image, or an
// image on a recipe page), and the shopper's own recipes keep the picture their page or video
// had when imported (doc.source.image_url). The hub fetches every one through its guarded
// proxy and cache, so the browser asks no other site; components/pictures.tsx turns a source
// into its hub address. Nothing here draws: no source, or one that fails to load, is the
// meal's placeholder.
import type { MealPlanDraft, RecipeDoc, RecipeImage, RecipeSource } from '../types.ts';

// Where a picture comes from, and the credit its hover shows: Wikipedia, or the recipe's site.
export type PictureSource =
  | { via: 'wiki'; title: string; credit: string }
  | { via: 'remote'; url: string; credit: string };

// Only a web address the hub's proxy takes: http(s), no spaces, not absurdly long.
const isWeb = (u: string | null | undefined): u is string =>
  typeof u === 'string' && u.length <= 2048 && /^https?:\/\/[^\s/]+\S*$/i.test(u);

// "seriouseats.com" for https://www.seriouseats.com/…; YouTube's own hosts (a thumbnail on
// i.ytimg.com, a watch link) say YouTube. '' when it is not an address.
export function siteOf(url: string | null | undefined): string {
  if (!url) return '';
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
  if (/(^|\.)(ytimg\.com|youtube\.com|youtu\.be)$/.test(host)) return 'YouTube';
  return host.replace(/^www\./, '');
}

// The site an imported recipe came from: its page or video, else the site it names, else the
// picture's own host.
const sourceSite = (source: RecipeSource, image: string) =>
  siteOf(source.url) || (source.site ?? '').replace(/^www\./, '') || siteOf(image);

// A recipe's picture: the shopper's own doc's image first (it is that recipe's own), then the
// one pantry-api names, else none.
export function recipePicture(image: RecipeImage | null | undefined, doc?: RecipeDoc | null): PictureSource | null {
  const own = doc?.source?.image_url;
  if (doc && isWeb(own)) return { via: 'remote', url: own, credit: sourceSite(doc.source, own) };
  if (image?.kind === 'wiki' && image.title.trim()) return { via: 'wiki', title: image.title.trim(), credit: 'Wikipedia' };
  if (image?.kind === 'url' && isWeb(image.url)) {
    return { via: 'remote', url: image.url, credit: doc ? sourceSite(doc.source, image.url) : siteOf(image.url) };
  }
  return null;
}

// Each plan recipe's picture, from the answers last heard (the basket's or the catalog's
// recipes, the first one naming a recipe wins) and the plan's own docs.
export function planPictures(d: MealPlanDraft,
  named: readonly { key: string; image?: RecipeImage | null }[]): Map<string, PictureSource | null> {
  const images = new Map<string, RecipeImage | null>();
  for (const r of named) if (!images.has(r.key) && r.image !== undefined) images.set(r.key, r.image);
  return new Map(Object.entries(d.recipes).map(([key, r]) => [key, recipePicture(images.get(key), r.ref.doc)]));
}

// The names an ingredient's picture is asked for, in order: the product the plan buys, then
// the ingredient itself, each once; none for blank names.
export function productPictureNames(product: string | null | undefined, ingredient: string | null | undefined): string[] {
  const out: string[] = [];
  for (const n of [product, ingredient]) {
    const name = (n ?? '').trim().slice(0, 200);
    if (name && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}
