import type { LucideIcon } from 'lucide-react';
import {
  Apple,
  Coffee,
  Croissant,
  Droplets,
  Drumstick,
  Fish,
  Leaf,
  Milk,
  Newspaper,
  Package,
  Salad,
  Snowflake,
  Wine,
} from 'lucide-react';

export interface CategoryVisual {
  Icon: LucideIcon;
  color: string;
  bg: string;
}

/** Colored category glyphs — Italian grocery names + English fallbacks (Lucide, same family as Neural Dashboard). */
export const GROCERY_CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  Surgelati: { Icon: Snowflake, color: '#67e8f9', bg: 'rgba(34, 211, 238, 0.22)' },
  Frutta: { Icon: Apple, color: '#fb923c', bg: 'rgba(249, 115, 22, 0.22)' },
  Verdura: { Icon: Salad, color: '#4ade80', bg: 'rgba(34, 197, 94, 0.22)' },
  Carne: { Icon: Drumstick, color: '#f87171', bg: 'rgba(239, 68, 68, 0.22)' },
  Pesce: { Icon: Fish, color: '#38bdf8', bg: 'rgba(14, 165, 233, 0.22)' },
  Latticini: { Icon: Milk, color: '#fde047', bg: 'rgba(234, 179, 8, 0.22)' },
  Pane: { Icon: Croissant, color: '#fbbf24', bg: 'rgba(217, 119, 6, 0.22)' },
  Salumi: { Icon: Drumstick, color: '#fb7185', bg: 'rgba(244, 63, 94, 0.22)' },
  'Frutta e Verdura': { Icon: Salad, color: '#4ade80', bg: 'rgba(34, 197, 94, 0.22)' },
  Acqua: { Icon: Droplets, color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.22)' },
  Bar: { Icon: Coffee, color: '#c084fc', bg: 'rgba(168, 85, 247, 0.22)' },
  Giornali: { Icon: Newspaper, color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.18)' },
  'Fresh Produce': { Icon: Salad, color: '#4ade80', bg: 'rgba(34, 197, 94, 0.22)' },
  'Dairy & Eggs': { Icon: Milk, color: '#fde047', bg: 'rgba(234, 179, 8, 0.22)' },
  'Frozen & Ready Meals': { Icon: Snowflake, color: '#67e8f9', bg: 'rgba(34, 211, 238, 0.22)' },
  Beverages: { Icon: Wine, color: '#a78bfa', bg: 'rgba(139, 92, 246, 0.22)' },
  Pantry: { Icon: Package, color: '#d4d4d8', bg: 'rgba(161, 161, 170, 0.18)' },
  Uncategorized: { Icon: Package, color: '#71717a', bg: 'rgba(113, 113, 122, 0.15)' },
};

const FALLBACK: CategoryVisual = { Icon: Leaf, color: '#a1a1aa', bg: 'rgba(161, 161, 170, 0.15)' };

export function getCategoryVisual(category: string): CategoryVisual {
  if (GROCERY_CATEGORY_VISUALS[category]) return GROCERY_CATEGORY_VISUALS[category];
  const match = Object.keys(GROCERY_CATEGORY_VISUALS).find(
    k => k.toLowerCase() === category.toLowerCase(),
  );
  if (match) return GROCERY_CATEGORY_VISUALS[match];
  return FALLBACK;
}

/** Show category badges when the visible window is zoomed enough for readable bar tops. */
export const CATEGORY_BADGE_MAX_BARS = 18;
