/**
 * Money handling.
 *
 * Every amount in the app is an integer number of *hundredths* of whatever
 * unit the hand was entered in (chips or big blinds). Poker maths is full of
 * places where a float would drift — pot-percentage sizings, splitting side
 * pots, "is this bet exactly the player's stack?" — and a drift of 0.000001
 * there turns into a bet that silently exceeds a stack. Integers make those
 * comparisons exact.
 *
 * Two decimals is enough for both modes: chip amounts are whole numbers
 * anyway, and BB amounts are conventionally shown to 2dp (27.61 BB).
 */

export const SCALE = 100;

/** @param {number} n a human-facing value, e.g. 27.61 */
export function toUnits(n) {
  return Math.round(n * SCALE);
}

/** @param {number} u internal units */
export function fromUnits(u) {
  return u / SCALE;
}

/**
 * Parse whatever the user typed into units, or null if it isn't a number.
 * Tolerates thousands separators and k/m suffixes, because typing "110k" on a
 * phone beats typing "109825" and getting a digit wrong.
 */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? toUnits(input) : null;
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase().replace(/[\s,_]/g, '');
  if (!s) return null;
  let mult = 1;
  if (s.endsWith('k')) { mult = 1000; s = s.slice(0, -1); }
  else if (s.endsWith('m')) { mult = 1000000; s = s.slice(0, -1); }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s) * mult;
  return Number.isFinite(n) ? toUnits(n) : null;
}

/**
 * Round a computed amount (e.g. 62.5% of the pot) to something a player could
 * actually put over the line: whole chips in chip mode, 0.01 BB in BB mode.
 */
export function roundForUnit(units, unit) {
  const step = unit === 'chips' ? SCALE : 1;
  return Math.round(units / step) * step;
}

const bbFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const chipFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Display an amount without its unit label — "30.2", "109,825". */
export function fmtAmount(units, unit) {
  const n = fromUnits(units);
  return unit === 'chips' ? chipFormatter.format(n) : bbFormatter.format(n);
}

/** Display an amount with its unit label — "30.2 BB", "109,825". */
export function fmtWithUnit(units, unit) {
  return unit === 'chips' ? fmtAmount(units, unit) : `${fmtAmount(units, unit)} BB`;
}

/**
 * Convert an amount into big blinds for display, whatever it was entered in.
 * The GG-style export always talks in BB even when the hand was typed in chips.
 */
export function toBb(units, bbUnits) {
  if (!bbUnits) return 0;
  return Math.round((units / bbUnits) * SCALE);
}
