/**
 * Cards, as a {rank, suit} pair of single characters — 'A' and 's'.
 *
 * Suit colours follow GG's four-colour deck, because the exports are meant to
 * look like the hands players already share.
 */

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS = ['s', 'h', 'd', 'c'];

export const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

export const RANK_NAME = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};
export const RANK_PLURAL = {
  2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights',
  9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces',
};

export const SUIT_COLOR = { s: '#1d1d1f', h: '#d0342c', d: '#2668c9', c: '#1f9d55' };
export const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_NAME = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };

/** "Ah" / "ah" / "AH" -> {rank:'A', suit:'h'}; anything else -> null. */
export function parseCard(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  if (s.length !== 2) return null;
  const rank = s[0].toUpperCase();
  const suit = s[1].toLowerCase();
  if (!RANK_VALUE[rank] || !SUITS.includes(suit)) return null;
  return { rank, suit };
}

export function cardStr(card) {
  return card ? `${card.rank}${card.suit}` : '';
}

export function cardsStr(cards) {
  return (cards || []).map(cardStr).join(' ');
}

/** Parse a loose string of cards — "AhKs", "Ah Ks", "[Ah Ks]" — into an array. */
export function parseCards(str) {
  if (!str) return [];
  const out = [];
  for (const m of String(str).matchAll(/([2-9TJQKAtjqka])\s*([shdcSHDC])/g)) {
    const card = parseCard(m[1] + m[2]);
    if (card) out.push(card);
  }
  return out;
}

export function fullDeck() {
  const deck = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push({ rank, suit });
  return deck;
}

export function sameCard(a, b) {
  return !!a && !!b && a.rank === b.rank && a.suit === b.suit;
}

/** Every card not already used by a hole card or the board. */
export function remainingDeck(used) {
  return fullDeck().filter((c) => !used.some((u) => sameCard(u, c)));
}

/** True if the same physical card appears twice across all the given groups. */
export function findDuplicate(groups) {
  const seen = new Set();
  for (const group of groups) {
    for (const card of group || []) {
      const key = cardStr(card);
      if (seen.has(key)) return card;
      seen.add(key);
    }
  }
  return null;
}
