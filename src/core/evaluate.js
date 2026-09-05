/**
 * Five-to-seven card hand evaluation.
 *
 * Returns a single comparable integer plus the description the exports print
 * ("One Pair, Aces"), phrased the way GG phrases it so a shared hand reads
 * like the ones players are used to.
 *
 * The score packs the category and up to five tiebreak ranks into base-15
 * digits, so a straight comparison of two scores orders the hands correctly.
 */

import { RANK_VALUE, RANK_NAME, RANK_PLURAL } from './cards.js';

export const CATEGORY = {
  HIGH_CARD: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4,
  FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
};

function score(cat, tiebreaks) {
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 15 + (tiebreaks[i] || 0);
  return s;
}

/** Highest card of the best 5-in-a-row, or 0. Aces play low for the wheel. */
function straightHigh(values) {
  const present = new Set(values);
  if (present.has(14)) present.add(1);
  for (let high = 14; high >= 5; high--) {
    let ok = true;
    for (let k = 0; k < 5; k++) if (!present.has(high - k)) { ok = false; break; }
    if (ok) return high;
  }
  return 0;
}

/**
 * @param {{rank:string,suit:string}[]} cards 5, 6 or 7 cards
 * @returns {{score:number, category:number, name:string}}
 */
export function evaluate(cards) {
  const values = cards.map((c) => RANK_VALUE[c.rank]);
  const bySuit = { s: [], h: [], d: [], c: [] };
  for (const card of cards) bySuit[card.suit].push(RANK_VALUE[card.rank]);

  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  // Most repeated first, then highest rank — the order kickers are read in.
  const grouped = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const desc = [...values].sort((a, b) => b - a);

  const flushSuit = Object.keys(bySuit).find((s) => bySuit[s].length >= 5);
  if (flushSuit) {
    const flushValues = bySuit[flushSuit].slice().sort((a, b) => b - a);
    const sfHigh = straightHigh(flushValues);
    if (sfHigh) {
      const name = sfHigh === 14 ? 'Royal Flush' : `Straight Flush, ${RANK_NAME[sfHigh]} High`;
      return { score: score(CATEGORY.STRAIGHT_FLUSH, [sfHigh]), category: CATEGORY.STRAIGHT_FLUSH, name };
    }
  }

  const [topValue, topCount] = grouped[0];
  if (topCount === 4) {
    const kicker = desc.find((v) => v !== topValue) || 0;
    return {
      score: score(CATEGORY.QUADS, [topValue, kicker]),
      category: CATEGORY.QUADS,
      name: `Four of a Kind, ${RANK_PLURAL[topValue]}`,
    };
  }

  const trips = grouped.filter((g) => g[1] === 3).map((g) => g[0]);
  const pairs = grouped.filter((g) => g[1] === 2).map((g) => g[0]);
  if (trips.length && (pairs.length || trips.length > 1)) {
    const three = trips[0];
    const pair = trips.length > 1 ? Math.max(trips[1], pairs[0] || 0) : pairs[0];
    return {
      score: score(CATEGORY.FULL_HOUSE, [three, pair]),
      category: CATEGORY.FULL_HOUSE,
      name: `Full House, ${RANK_PLURAL[three]} full of ${RANK_PLURAL[pair]}`,
    };
  }

  if (flushSuit) {
    const top5 = bySuit[flushSuit].slice().sort((a, b) => b - a).slice(0, 5);
    return {
      score: score(CATEGORY.FLUSH, top5),
      category: CATEGORY.FLUSH,
      name: `Flush, ${RANK_NAME[top5[0]]} High`,
    };
  }

  const stHigh = straightHigh(values);
  if (stHigh) {
    return {
      score: score(CATEGORY.STRAIGHT, [stHigh]),
      category: CATEGORY.STRAIGHT,
      name: `Straight, ${RANK_NAME[stHigh]} High`,
    };
  }

  if (trips.length) {
    const kickers = desc.filter((v) => v !== trips[0]).slice(0, 2);
    return {
      score: score(CATEGORY.TRIPS, [trips[0], ...kickers]),
      category: CATEGORY.TRIPS,
      name: `Three of a Kind, ${RANK_PLURAL[trips[0]]}`,
    };
  }

  if (pairs.length >= 2) {
    const [high, low] = pairs;
    const kicker = desc.find((v) => v !== high && v !== low) || 0;
    return {
      score: score(CATEGORY.TWO_PAIR, [high, low, kicker]),
      category: CATEGORY.TWO_PAIR,
      name: `Two Pair, ${RANK_PLURAL[high]} and ${RANK_PLURAL[low]}`,
    };
  }

  if (pairs.length === 1) {
    const kickers = desc.filter((v) => v !== pairs[0]).slice(0, 3);
    return {
      score: score(CATEGORY.PAIR, [pairs[0], ...kickers]),
      category: CATEGORY.PAIR,
      name: `One Pair, ${RANK_PLURAL[pairs[0]]}`,
    };
  }

  const top5 = desc.slice(0, 5);
  return {
    score: score(CATEGORY.HIGH_CARD, top5),
    category: CATEGORY.HIGH_CARD,
    name: `High Card, ${RANK_NAME[top5[0]]}`,
  };
}
