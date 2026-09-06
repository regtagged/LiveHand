/**
 * Export 1 of 3: a plain-text hand history.
 *
 * The layout is the PokerStars family format that GG, ACR, CoinPoker and most
 * trackers all speak, so a hand typed here can be pasted into a forum post, a
 * solver's import box, or a tracking database without anyone having to
 * hand-edit it first.
 */

import { fmtAmount } from '../core/amount.js';
import { cardStr, cardsStr } from '../core/cards.js';
import { seatRing } from '../core/positions.js';
import { STREETS } from '../core/engine.js';
import { pokerStarsLine, stakesLabel } from '../core/narrate.js';

const STREET_HEADER = { flop: 'FLOP', turn: 'TURN', river: 'RIVER' };

function timestamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Seat numbers run clockwise from the small blind, matching the ring order. */
function seatNumbers(hand) {
  const ring = seatRing(hand.tableSize, hand.scheme);
  const seats = new Map();
  let n = 1;
  for (const position of ring) {
    if (hand.players.some((p) => p.position === position)) seats.set(position, n++);
  }
  return seats;
}

function boardSoFar(board, street) {
  if (street === 'flop') return `[${cardsStr(board.slice(0, 3))}]`;
  if (street === 'turn') return `[${cardsStr(board.slice(0, 3))}] [${cardStr(board[3])}]`;
  if (street === 'river') return `[${cardsStr(board.slice(0, 4))}] [${cardStr(board[4])}]`;
  return '';
}

/**
 * @param {object} hand
 * @param {object} state the result of replay(hand)
 */
export function toTextHH(hand, state) {
  const out = [];
  const seats = seatNumbers(hand);
  const unitNote = hand.unit === 'bb' ? ' [amounts in big blinds]' : '';
  const money = (units) => fmtAmount(units, hand.unit);

  const tournament = hand.tournament || 'Live hand';
  const level = hand.level ? ` - Level ${hand.level}` : '';
  out.push(`Poker Hand #${hand.id}: Tournament "${tournament}", ${hand.game || "Hold'em No Limit"}${level} (${stakesLabel(hand)}) - ${timestamp(hand.createdAt)}${unitNote}`);

  const buttonPosition = hand.players.some((p) => p.position === 'BTN') ? 'BTN' : 'SB';
  out.push(`Table '${tournament}' ${hand.tableSize}-max Seat #${seats.get(buttonPosition)} is the button`);

  for (const player of state.players) {
    // A seat whose stack was never entered says so rather than inventing one.
    const chips = player.unknownStack ? 'unknown' : money(player.startingStack);
    out.push(`Seat ${seats.get(player.position)}: ${player.name} (${chips} in chips)`);
  }

  for (const post of state.posts) {
    const name = state.players.find((p) => p.position === post.position).name;
    if (post.kind === 'ante') out.push(`${name}: posts the ante ${money(post.amount)}`);
    if (post.kind === 'sb') out.push(`${name}: posts small blind ${money(post.amount)}`);
    if (post.kind === 'bb') out.push(`${name}: posts big blind ${money(post.amount)}`);
    if (post.kind === 'straddle') out.push(`${name}: straddles ${money(post.amount)}`);
  }

  out.push('*** HOLE CARDS ***');
  for (const player of state.players) {
    if (player.cards && player.cards.length === 2 && player.isHero) {
      out.push(`Dealt to ${player.name} [${cardsStr(player.cards)}]`);
    }
  }

  for (const streetId of STREETS) {
    const street = state.streets.find((s) => s.id === streetId);
    if (!street) break;
    if (streetId !== 'preflop') {
      out.push(`*** ${STREET_HEADER[streetId]} *** ${boardSoFar(state.board, streetId)}`);
    }
    for (const action of street.actions) out.push(pokerStarsLine(action, hand));
    if (street.uncalled) {
      out.push(`Uncalled bet (${money(street.uncalled.amount)}) returned to ${street.uncalled.name}`);
    }
  }

  const shown = (state.showdown || []).filter((s) => s.cards && s.cards.length === 2);
  if (state.status === 'showdown' && shown.length) {
    out.push('*** SHOW DOWN ***');
    for (const s of shown) {
      out.push(`${s.name}: shows [${cardsStr(s.cards)}]${s.hand ? ` (${s.hand.name})` : ''}`);
    }
  }

  for (const winner of state.winners || []) {
    const name = state.players.find((p) => p.position === winner.position).name;
    out.push(`${name} collected ${money(winner.amount)} from pot`);
  }

  out.push('*** SUMMARY ***');
  out.push(`Total pot ${money(state.pot)} | Rake 0`);
  if (state.board.length) out.push(`Board [${cardsStr(state.board)}]`);

  for (const player of state.players) {
    const seat = `Seat ${seats.get(player.position)}: ${player.name}`;
    const label = blindLabel(hand, player.position);
    const winner = (state.winners || []).find((w) => w.position === player.position);
    const show = (state.showdown || []).find((s) => s.position === player.position);
    let tail;
    if (winner && show && show.cards.length === 2) {
      tail = `showed [${cardsStr(show.cards)}] and won (${money(winner.amount)})${show.hand ? ` with ${show.hand.name}` : ''}`;
    } else if (winner) {
      tail = `collected (${money(winner.amount)})`;
    } else if (show && show.cards.length === 2) {
      tail = `showed [${cardsStr(show.cards)}] and lost${show.hand ? ` with ${show.hand.name}` : ''}`;
    } else if (player.folded) {
      tail = 'folded';
    } else {
      tail = 'mucked';
    }
    out.push(`${seat}${label} ${tail}`);
  }

  return out.join('\n');
}

function blindLabel(hand, position) {
  if (position === 'SB') return ' (small blind)';
  if (position === 'BB') return ' (big blind)';
  if (position === 'BTN') return ' (button)';
  return '';
}
