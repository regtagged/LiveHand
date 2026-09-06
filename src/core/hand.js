/**
 * The hand a user is building, and the rules for making a valid one.
 *
 * This is the only shape any exporter, the replayer or the UI needs to know
 * about, and it is plain JSON — so a hand can be saved to localStorage,
 * pasted between devices, or embedded in a generated replayer file as-is.
 */

import { parseCards } from './cards.js';
import { seatRing } from './positions.js';
import { toUnits } from './amount.js';

/** Blinds always post, so those two seats can never be dropped from a hand. */
export const REQUIRED_POSITIONS = ['SB', 'BB'];

export function newHandId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const salt = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0').toUpperCase();
  return `LH${stamp}${salt}`;
}

/**
 * @returns a blank hand at the given table size with every seat included.
 */
/**
 * What the ante actually costs a player.
 *
 * A big blind ante is one big blind by definition, so it tracks the blind
 * rather than being typed separately — there is nothing to get wrong and
 * nothing to keep in sync when the level goes up.
 */
export function anteAmount(hand) {
  if (hand.anteMode === 'bb') return hand.bb;
  if (hand.anteMode === 'each') return hand.ante;
  return 0;
}

export function createHand(overrides = {}) {
  const tableSize = overrides.tableSize || 8;
  const scheme = overrides.scheme || 'standard';
  const unit = overrides.unit || 'bb';
  const ring = seatRing(tableSize, scheme);
  const hand = {
    id: newHandId(),
    createdAt: new Date().toISOString(),
    tournament: '',
    level: '',
    game: "No Limit Hold'em",
    unit,
    sb: unit === 'bb' ? toUnits(0.5) : 0,
    bb: unit === 'bb' ? toUnits(1) : 0,
    ante: 0,
    anteMode: 'bb',
    tableSize,
    scheme,
    // Only the blinds to begin with. Most shared hands name three or four
    // seats, so starting from an empty table and switching seats on is less
    // work than clearing out six you never meant to list.
    players: ring.filter((position) => REQUIRED_POSITIONS.includes(position)).map(blankPlayer),
    straddles: [],
    board: [],
    actions: [],
    winners: [],
    note: '',
  };
  return { ...hand, ...overrides, players: overrides.players || hand.players };
}

function blankPlayer(position) {
  return { position, name: position, stack: 0, isHero: false, cards: [] };
}

/**
 * Reshape a hand for a new table size, keeping the seats already chosen that
 * still exist at the new size. Seats that were never switched on stay off.
 */
export function resizeTable(hand, tableSize, scheme = hand.scheme) {
  const ring = seatRing(tableSize, scheme);
  const previous = new Map(hand.players.map((p) => [p.position, p]));
  const players = ring
    .filter((position) => previous.has(position) || REQUIRED_POSITIONS.includes(position))
    .map((position) => previous.get(position) || blankPlayer(position));
  return { ...hand, tableSize, scheme, players, actions: [], winners: [] };
}

/** Include or drop a seat. Blinds can't be dropped; dropping resets the action. */
export function togglePlayer(hand, position, included) {
  if (REQUIRED_POSITIONS.includes(position) && !included) return hand;
  const ring = seatRing(hand.tableSize, hand.scheme);
  const current = new Map(hand.players.map((p) => [p.position, p]));
  if (included) current.set(position, current.get(position) || blankPlayer(position));
  else current.delete(position);
  // No seat is ever made the hero automatically — guessing puts "you" on a
  // random seat, and validateSetup asks for it explicitly instead.
  const players = ring.filter((p) => current.has(p)).map((p) => current.get(p));
  return { ...hand, players, actions: [], winners: [] };
}

export function setHero(hand, position) {
  return {
    ...hand,
    players: hand.players.map((p) => ({ ...p, isHero: p.position === position })),
  };
}

export function updatePlayer(hand, position, patch) {
  return {
    ...hand,
    players: hand.players.map((p) => (p.position === position ? { ...p, ...patch } : p)),
  };
}

export function heroOf(hand) {
  return hand.players.find((p) => p.isHero) || null;
}

/**
 * Everything that would stop this hand from being exportable, as plain
 * sentences — the setup screen shows them inline rather than blocking a
 * "next" button with no explanation.
 */
export function validateSetup(hand) {
  const problems = [];
  if (!hand.bb || hand.bb <= 0) problems.push('Enter a big blind.');
  if (hand.sb < 0) problems.push('Small blind cannot be negative.');
  if (hand.sb > hand.bb) problems.push('Small blind is larger than the big blind.');
  if (hand.anteMode === 'each' && !hand.ante) problems.push('Enter an ante, or set the ante to none.');
  if (hand.players.length < 2) problems.push('A hand needs at least two players.');
  for (const required of REQUIRED_POSITIONS) {
    if (!hand.players.some((p) => p.position === required)) problems.push(`${required} must be in the hand.`);
  }
  // Only your own stack is required. A blind that folds out of the way is still
  // in the hand — it has to post — but making someone look up a stack they
  // never saw, for a seat that did nothing, is busywork; those are left unknown
  // and treated as covering whatever they face.
  const hero = hand.players.find((p) => p.isHero);
  if (!hero) problems.push('Pick which seat is you.');
  else if (!hero.stack || hero.stack <= 0) problems.push('Enter your own stack.');
  const short = hand.players.filter((p) => p.stack > 0 && p.stack < hand.bb).map((p) => p.position);
  if (short.length) problems.push(`${short.join(', ')} ${short.length > 1 ? 'have' : 'has'} less than one big blind — check the units.`);
  return problems;
}

/**
 * The next hand at the same table.
 *
 * Same seats, same people, same stakes; only the cards and the action start
 * over. Stacks carry across because the table really is where the last hand
 * left it, which is a far better starting guess than zero.
 *
 * Note this keeps `players` as it stands rather than rebuilding from the seat
 * ring — seats deliberately left out of the last hand must stay out, or every
 * new hand silently re-adds them with an empty stack.
 */
export function nextHand(hand) {
  return {
    ...hand,
    id: newHandId(),
    createdAt: new Date().toISOString(),
    players: hand.players.map((player) => ({ ...player, cards: [] })),
    board: [],
    actions: [],
    winners: [],
    note: '',
  };
}

/** Cards known so far, for duplicate detection and the card picker's greying. */
export function usedCards(hand) {
  const used = [...(hand.board || [])];
  for (const p of hand.players) for (const c of p.cards || []) used.push(c);
  return used;
}

export function setBoard(hand, cards) {
  const parsed = typeof cards === 'string' ? parseCards(cards) : cards;
  return { ...hand, board: parsed.slice(0, 5) };
}

/** Round-trip safety: a hand read back from storage should still be a hand. */
export function reviveHand(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = createHand({ tableSize: raw.tableSize || 6, scheme: raw.scheme || 'standard' });
  return {
    ...base,
    ...raw,
    players: (raw.players || base.players).map((p) => ({ ...p, cards: p.cards || [] })),
    board: raw.board || [],
    actions: raw.actions || [],
    winners: raw.winners || [],
    straddles: raw.straddles || [],
  };
}
