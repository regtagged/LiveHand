import { createHand, togglePlayer, updatePlayer, setHero } from '../src/core/hand.js';
import { toUnits } from '../src/core/amount.js';
import { parseCards } from '../src/core/cards.js';

/** Build a hand from a compact literal, so tests read like the hand they describe. */
export function buildHand({ tableSize = 8, scheme = 'gg', unit = 'bb', sb = 0.5, bb = 1, ante = 0, anteMode = 'none', seats, hero, board = '', actions = [] }) {
  let hand = createHand({ tableSize, scheme, unit });
  hand = { ...hand, sb: toUnits(sb), bb: toUnits(bb), ante: toUnits(ante), anteMode };
  const wanted = Object.keys(seats);
  for (const p of hand.players.map((x) => x.position)) {
    if (!wanted.includes(p)) hand = togglePlayer(hand, p, false);
  }
  for (const [position, spec] of Object.entries(seats)) {
    const stack = typeof spec === 'number' ? spec : spec.stack;
    const cards = typeof spec === 'number' ? [] : parseCards(spec.cards || '');
    hand = updatePlayer(hand, position, { stack: toUnits(stack), cards });
  }
  hand = setHero(hand, hero);
  return { ...hand, board: parseCards(board), actions };
}

export const fold = (position) => ({ position, kind: 'fold' });
export const check = (position) => ({ position, kind: 'check' });
export const call = (position, to) => ({ position, kind: 'call', to: toUnits(to) });
export const bet = (position, to) => ({ position, kind: 'bet', to: toUnits(to) });
export const raise = (position, to) => ({ position, kind: 'raise', to: toUnits(to) });
export const allIn = (position) => ({ position, kind: 'raise', to: Number.MAX_SAFE_INTEGER });
