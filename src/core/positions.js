/**
 * Position names and order of action.
 *
 * Seats are stored clockwise starting at the small blind, which is the order
 * postflop action runs in at a normal table, and the order the export's seat
 * list reads in. Preflop order is the same ring rotated to start after the big
 * blind; postflop order is the ring rotated to start after the button.
 *
 * Heads-up falls out of the same rule rather than needing a special case: at
 * two players the small blind *is* the button, so "after the BB" wraps to the
 * SB (SB acts first preflop) and "after the button" lands on the BB (BB acts
 * first postflop).
 */

/** Clockwise from the small blind, per table size. */
const STANDARD = {
  2: ['SB', 'BB'],
  3: ['SB', 'BB', 'BTN'],
  4: ['SB', 'BB', 'CO', 'BTN'],
  5: ['SB', 'BB', 'HJ', 'CO', 'BTN'],
  6: ['SB', 'BB', 'LJ', 'HJ', 'CO', 'BTN'],
  7: ['SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO', 'BTN'],
  8: ['SB', 'BB', 'UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN'],
  9: ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN'],
  10: ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'LJ', 'HJ', 'CO', 'BTN'],
};

/** GG / Natural8 naming, so a GG-style export reads exactly like the real thing. */
const GG = {
  2: ['SB', 'BB'],
  3: ['SB', 'BB', 'BTN'],
  4: ['SB', 'BB', 'CO', 'BTN'],
  5: ['SB', 'BB', 'MP', 'CO', 'BTN'],
  6: ['SB', 'BB', 'UTG', 'MP', 'CO', 'BTN'],
  7: ['SB', 'BB', 'UTG', 'MP', 'MP1', 'CO', 'BTN'],
  8: ['SB', 'BB', 'UTG', 'UTG+1', 'MP', 'MP1', 'CO', 'BTN'],
  9: ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'MP1', 'CO', 'BTN'],
  10: ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'MP1', 'MP2', 'CO', 'BTN'],
};

export const NAME_SCHEMES = { standard: STANDARD, gg: GG };

export const MIN_TABLE_SIZE = 2;
export const MAX_TABLE_SIZE = 10;

/** The full ring for a table size, clockwise from the SB. */
export function seatRing(tableSize, scheme = 'standard') {
  const set = NAME_SCHEMES[scheme] || STANDARD;
  const size = Math.min(MAX_TABLE_SIZE, Math.max(MIN_TABLE_SIZE, tableSize | 0));
  return set[size].slice();
}

/** Index of the button within the ring. Heads-up, that's the small blind. */
export function buttonIndex(ring) {
  return ring.length === 2 ? 0 : ring.length - 1;
}

function rotate(ring, start) {
  return ring.map((_, i) => ring[(start + i) % ring.length]);
}

/** Order of action before the flop: first to act is the seat after the BB. */
export function preflopRing(ring) {
  return rotate(ring, 2 % ring.length);
}

/** Order of action on every later street: first to act is the seat after the button. */
export function postflopRing(ring) {
  return rotate(ring, (buttonIndex(ring) + 1) % ring.length);
}

/**
 * The order the given positions act in, dropping any seat that isn't in the
 * hand. Players routinely share a hand without listing every seat at the
 * table, so a "6-max" hand here might only carry CO, BTN and BB.
 */
export function actionOrder(positions, street, tableSize, scheme = 'standard') {
  const ring = seatRing(tableSize, scheme);
  const order = street === 'preflop' ? preflopRing(ring) : postflopRing(ring);
  return order.filter((p) => positions.includes(p));
}

/** Where a seat sits around the oval, as a fraction of the way round from the hero's seat. */
export function seatAngles(count) {
  // Hero at the bottom (90deg in screen coords), the rest spread evenly clockwise.
  return Array.from({ length: count }, (_, i) => (Math.PI / 2) + (i * 2 * Math.PI) / count);
}
