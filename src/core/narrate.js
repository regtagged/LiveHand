/**
 * One place that turns an action into words.
 *
 * The text history, both image layouts and the replayer all describe the same
 * actions, just in different registers — so they share this module rather than
 * each growing their own slightly-different phrasing.
 */

import { fmtAmount, toBb } from './amount.js';

/**
 * Render an amount the way a given export wants it. `bb` forces big blinds
 * even when the hand was entered in chips, which is what the GG-style sheet
 * and the replayer do so that stack depths stay comparable.
 */
export function money(units, hand, style = 'native') {
  if (style === 'bb') {
    const inBb = hand.unit === 'bb' ? units : toBb(units, hand.bb);
    return `${fmtAmount(inBb, 'bb')} BB`;
  }
  return fmtAmount(units, hand.unit);
}

/** PokerStars-family phrasing: "Hero: raises 6 to 9". */
export function pokerStarsLine(action, hand) {
  const name = action.name;
  const allIn = action.allIn ? ' and is all-in' : '';
  switch (action.kind) {
    case 'fold': return `${name}: folds`;
    case 'check': return `${name}: checks`;
    case 'call': return `${name}: calls ${money(action.added, hand)}${allIn}`;
    case 'bet': return `${name}: bets ${money(action.to, hand)}${allIn}`;
    case 'raise': return `${name}: raises ${money(action.raiseBy, hand)} to ${money(action.to, hand)}${allIn}`;
    default: return `${name}: ${action.kind}`;
  }
}

/** GG share-sheet phrasing: "Hero raises to 9 BB", and a bare "fold" for folds. */
export function ggPhrase(action, hand) {
  const name = action.name;
  const allIn = action.allIn ? ' and is all-in' : '';
  switch (action.kind) {
    case 'fold': return 'fold';
    case 'check': return `${name} checks`;
    case 'call': return `${name} calls ${money(action.added, hand, 'bb')}${allIn}`;
    case 'bet': return `${name} bets ${money(action.to, hand, 'bb')}${allIn}`;
    case 'raise': return `${name} raises to ${money(action.to, hand, 'bb')}${allIn}`;
    default: return `${name} ${action.kind}`;
  }
}

/** Short label for an action bubble in the replayer or the table image. */
export function bubbleText(action, hand) {
  switch (action.kind) {
    case 'fold': return 'Fold';
    case 'check': return 'Check';
    case 'call': return action.allIn ? 'Call all-in' : `Call ${money(action.added, hand, 'bb')}`;
    case 'bet': return action.allIn ? `All-in ${money(action.to, hand, 'bb')}` : `Bet ${money(action.to, hand, 'bb')}`;
    case 'raise': return action.allIn ? `All-in ${money(action.to, hand, 'bb')}` : `Raise ${money(action.to, hand, 'bb')}`;
    default: return action.kind;
  }
}

/** "2000/4000 Ante 600" — the stakes line shared by every export's title. */
export function stakesLabel(hand) {
  const parts = [`${fmtAmount(hand.sb, hand.unit)}/${fmtAmount(hand.bb, hand.unit)}`];
  if (hand.anteMode !== 'none' && hand.ante > 0) {
    parts.push(`Ante ${fmtAmount(hand.ante, hand.unit)}${hand.anteMode === 'bb' ? ' (BB ante)' : ''}`);
  }
  return parts.join(' ');
}

export function titleLine(hand) {
  const bits = [];
  if (hand.tournament) bits.push(hand.tournament);
  bits.push(`${stakesLabel(hand)} NL (${hand.tableSize} max)`);
  bits.push("Hold'em");
  return bits.join(' - ');
}

/** "7 players post ante of 0.15 BB, Hero posts SB 0.5 BB, BB posts BB 1 BB" */
export function postsSummary(state, hand) {
  const hand_ = hand;
  const antes = state.posts.filter((p) => p.kind === 'ante');
  const parts = [];
  if (antes.length === 1 && hand_.anteMode === 'bb') {
    parts.push({ text: `${nameOf(state, 'BB')} posts big blind ante ${money(antes[0].amount, hand_, 'bb')}`, position: 'BB' });
  } else if (antes.length) {
    parts.push({ text: `${antes.length} players post ante of ${money(antes[0].amount, hand_, 'bb')}`, position: null });
  }
  for (const post of state.posts) {
    if (post.kind === 'sb') parts.push({ text: `${nameOf(state, 'SB')} posts SB ${money(post.amount, hand_, 'bb')}`, position: 'SB' });
    if (post.kind === 'bb') parts.push({ text: `${nameOf(state, 'BB')} posts BB ${money(post.amount, hand_, 'bb')}`, position: 'BB' });
    if (post.kind === 'straddle') parts.push({ text: `${nameOf(state, post.position)} straddles ${money(post.amount, hand_, 'bb')}`, position: post.position });
  }
  return parts;
}

export function nameOf(state, position) {
  const player = state.players.find((p) => p.position === position);
  return player ? player.name : position;
}
