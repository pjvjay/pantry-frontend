// The meal plan's pictures: a recipe's (Meals, Ingredients, Schedule) and an ingredient's
// product (Ingredients and its Options). Each is decorative, beside words that name the same
// thing (alt=""), and loads lazily into a box of fixed shape, so nothing moves when it arrives.
// A picture that is missing or fails to load falls back, never to a broken image: a product's
// to the ingredient's name and then a placeholder, a recipe's to its meal's icon on a soft tint,
// which also shows while the photo loads. Which source, and its credit, is decided in
// mealplan/images.ts; every address is the hub's (hub.ts), which fetches and caches.
import { useState } from 'react';

import { ingredientImage, remoteImage, wikiImage } from '../hub';
import { productPictureNames } from '../mealplan/images';
import type { PictureSource } from '../mealplan/images';
import type { Slot } from '../mealplan/model';
import { Icon } from './icons';
import type { IconName } from './icons';

export const SLOT_ICONS: Record<Slot, IconName> = { breakfast: 'cup', lunch: 'bowl', dinner: 'utensils', snack: 'apple' };

const addressOf = (p: PictureSource) => (p.via === 'wiki' ? wikiImage(p.title) : remoteImage(p.url));

const ICON_SIZE = { card: 34, head: 22, thumb: 18 } as const;

// size: 'card', a wide picture over a Meals card, with its credit on hover or focus; 'head', a
// square beside a recipe's heading or in the tray; 'thumb', a small square on a meal's card.
export function RecipePicture({ pic, slot, size }: {
  pic: PictureSource | null;
  slot: Slot;
  size: 'card' | 'head' | 'thumb';
}) {
  const src = pic ? addressOf(pic) : null;
  // by address, so a recipe's new picture is tried afresh
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const shown = src !== null && failed !== src;
  const ready = shown && loaded === src;
  return (
    <span className={`rpic rpic-${size}${ready ? ' rpic-ready' : ''}`}>
      <span className="rpic-none"><Icon name={SLOT_ICONS[slot]} size={ICON_SIZE[size]} /></span>
      {shown && (
        <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false}
             onLoad={() => setLoaded(src)} onError={() => setFailed(src)} />
      )}
      {/* the credit of a decorative picture: shown, not read out */}
      {ready && size === 'card' && pic && <span className="rpic-credit" aria-hidden="true">Photo: {pic.credit}</span>}
    </span>
  );
}

// The product an ingredient line buys, by its name, then the ingredient's, then a placeholder.
export function ProductPicture({ product, ingredient }: { product: string | null; ingredient: string }) {
  const names = productPictureNames(product, ingredient);
  const key = names.join('|');
  const [tried, setTried] = useState<{ key: string; n: number }>({ key, n: 0 });
  const [loaded, setLoaded] = useState<string | null>(null);
  const n = tried.key === key ? tried.n : 0;
  const name = names[n];
  return (
    <span className={`ppic${name && loaded === name ? ' ppic-ready' : ''}`}>
      <span className="ppic-none"><Icon name="cart" size={18} /></span>
      {name && (
        <img key={name} src={ingredientImage(name)} alt="" loading="lazy" decoding="async" draggable={false}
             onLoad={() => setLoaded(name)} onError={() => setTried({ key, n: n + 1 })} />
      )}
    </span>
  );
}
