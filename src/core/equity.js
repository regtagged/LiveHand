/**
 * All-in equity, for the "(Pre 75%, Flop 87%, Turn 93%)" line the GG-style
 * sheet prints under a showdown.
 *
 * Once the flop is out there are at most C(45,2) = 990 run-outs, so those
 * streets are enumerated exactly. Preflop is 1.7M run-outs for two players,
 * which is too slow to do while someone waits, so it falls back to sampling —
 * with a fixed seed, so the same hand always reports the same number rather
 * than shimmering by a tenth of a percent every time the sheet is redrawn.
 */

import { remainingDeck } from './cards.js';
import { evaluate } from './evaluate.js';

const EXACT_LIMIT = 30000;
const SAMPLES = 25000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return Math.round(result);
}

function scoreRunout(holes, cards, wins) {
  let best = -1;
  let bestCount = 0;
  let bestIndex = -1;
  const scores = new Array(holes.length);
  for (let i = 0; i < holes.length; i++) {
    const score = evaluate([...holes[i], ...cards]).score;
    scores[i] = score;
    if (score > best) { best = score; bestCount = 1; bestIndex = i; }
    else if (score === best) bestCount++;
  }
  if (bestCount === 1) { wins[bestIndex] += 1; return; }
  const share = 1 / bestCount;
  for (let i = 0; i < holes.length; i++) if (scores[i] === best) wins[i] += share;
}

/**
 * @param {Card[][]} holes one two-card hand per player
 * @param {Card[]} board 0, 3 or 4 cards
 * @returns {number[]|null} equity per player as a percentage, or null if it can't be computed
 */
export function equity(holes, board) {
  if (!holes || holes.length < 2 || holes.some((h) => !h || h.length !== 2)) return null;
  const used = [...holes.flat(), ...board];
  const deck = remainingDeck(used);
  const need = 5 - board.length;
  if (need < 0) return null;
  const wins = new Array(holes.length).fill(0);

  if (need === 0) {
    scoreRunout(holes, board, wins);
    return wins.map((w) => w * 100);
  }

  if (choose(deck.length, need) <= EXACT_LIMIT) {
    let total = 0;
    const runout = new Array(need);
    const walk = (start, depth) => {
      if (depth === need) {
        total++;
        scoreRunout(holes, [...board, ...runout], wins);
        return;
      }
      for (let i = start; i <= deck.length - (need - depth); i++) {
        runout[depth] = deck[i];
        walk(i + 1, depth + 1);
      }
    };
    walk(0, 0);
    return wins.map((w) => (w / total) * 100);
  }

  const random = mulberry32(0x11e4a5d); // fixed seed: same hand, same number, every redraw
  const pool = deck.slice();
  for (let s = 0; s < SAMPLES; s++) {
    // Partial Fisher-Yates: only the cards we need have to be shuffled.
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(random() * (pool.length - i));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    scoreRunout(holes, [...board, ...pool.slice(0, need)], wins);
  }
  return wins.map((w) => (w / SAMPLES) * 100);
}

/**
 * Equity at each street the hand actually reached, the way the GG sheet reads
 * it: one figure per street *before* the cards that followed were known.
 */
export function equityByStreet(holes, board) {
  const points = [];
  const stages = [['Pre', 0], ['Flop', 3], ['Turn', 4]];
  for (const [label, cardCount] of stages) {
    if (board.length < cardCount) break;
    // The river is the result, not an equity, so it is never listed.
    if (cardCount === 5) break;
    const values = equity(holes, board.slice(0, cardCount));
    if (!values) return [];
    points.push({ label, values });
  }
  return points;
}
