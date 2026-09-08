/**
 * The betting engine.
 *
 * `replay()` rebuilds the whole hand from scratch out of the hand's action
 * list every time it's called. Hands are at most a few dozen actions, so this
 * costs nothing, and it buys two things that matter a lot for an entry app:
 * undo is just popping the last action, and there is exactly one place where
 * stacks, pots and whose-turn-it-is are computed, so the action bar, the
 * exports and the replayer can never disagree about the state of the hand.
 *
 * The one rule enforced as a hard constraint is that nobody can put in more
 * than they have. Everything else (min-raise, the incomplete-all-in-raise
 * rule) is surfaced as a suggestion rather than a block: this is a tool for
 * transcribing a hand that already happened, and a hand that happened in a
 * weird way still needs to be recordable.
 */

import { evaluate } from './evaluate.js';
import { actionOrder } from './positions.js';
import { roundForUnit, toUnits } from './amount.js';
import { anteAmount } from './hand.js';

export const STREETS = ['preflop', 'flop', 'turn', 'river'];
export const STREET_LABEL = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };

/**
 * The stack given to a seat nobody entered one for.
 *
 * Large enough that the engine never caps such a player, so an unlisted blind
 * can post and fold — or call, if that is what happened — without a stack the
 * user never knew. It is a sentinel, not a number to show anyone: every
 * display checks `unknownStack` and prints a dash instead.
 */
export const UNKNOWN_STACK = Math.floor(Number.MAX_SAFE_INTEGER / 8);

/** How many board cards are showing once the named street is dealt. */
export const BOARD_LENGTH = { preflop: 0, flop: 3, turn: 4, river: 5 };

function boardFor(hand, street) {
  return (hand.board || []).slice(0, BOARD_LENGTH[street]);
}

function initRuntime(hand) {
  const runtime = new Map();
  for (const p of hand.players) {
    const unknownStack = !p.stack || p.stack <= 0;
    runtime.set(p.position, {
      position: p.position,
      name: p.name || p.position,
      isHero: !!p.isHero,
      cards: p.cards || [],
      unknownStack,
      startingStack: unknownStack ? UNKNOWN_STACK : p.stack,
      stack: unknownStack ? UNKNOWN_STACK : p.stack,
      contributed: 0,   // everything out of the stack this hand, antes included
      wagered: 0,       // contributions other than antes — drives side pots
      streetCommit: 0,  // this street only — drives what's owed
      folded: false,
      allIn: false,
      actedThisStreet: false,
    });
  }
  return runtime;
}

/**
 * Move chips from a player's stack toward the pot, capped at what they hold.
 *
 * `dead` marks an ante. Antes belong to the pot but are not a wager by the
 * player who posted them, so they are kept out of `wagered`: a big blind who
 * antes 1 and then matches a 24 shove has wagered 24, exactly what the shover
 * wagered, and no side pot should exist between them.
 */
function commit(player, amount, dead = false) {
  const paid = Math.min(amount, player.stack);
  player.stack -= paid;
  player.contributed += paid;
  if (!dead) player.wagered += paid;
  if (player.stack === 0) player.allIn = true;
  return paid;
}

/**
 * Blinds and antes. Antes are dead money: they go into the pot without
 * counting toward what a player owes, which is why a folded big blind's
 * chips still show up in the flop pot.
 */
function postBlinds(hand, runtime) {
  const posts = [];
  const order = actionOrder(hand.players.map((p) => p.position), 'preflop', hand.tableSize, hand.scheme);
  let deadPot = 0;
  // Chips in the pot that belong to nobody in the hand: blinds and antes from
  // seats the user did not list. They are real money in the middle, but there
  // is no player to charge them to, so side pots have to be told about them.
  let deadUnattached = 0;

  const ante = anteAmount(hand);
  const seated = (position) => runtime.get(position);
  // The largest unlisted blind, which still counts as money matched on the
  // preflop street even though no listed player put it there.
  let deadFloor = 0;
  const postDead = (position, kind, amount) => {
    deadPot += amount;
    deadUnattached += amount;
    if (kind !== 'ante') deadFloor = Math.max(deadFloor, amount);
    posts.push({ position, kind, amount, dead: true });
  };

  if (hand.anteMode === 'each' && ante > 0) {
    for (const position of order) {
      const paid = commit(seated(position), ante, true);
      if (paid > 0) { deadPot += paid; posts.push({ position, kind: 'ante', amount: paid }); }
    }
    // The blinds are at the table whether or not they were listed, so they ante
    // either way — listing a seat must not change what is in the pot.
    for (const position of ['SB', 'BB']) if (!seated(position)) postDead(position, 'ante', ante);
  } else if (hand.anteMode === 'bb' && ante > 0) {
    const player = seated('BB');
    if (player) {
      const paid = commit(player, ante, true);
      if (paid > 0) { deadPot += paid; posts.push({ position: 'BB', kind: 'ante', amount: paid }); }
    } else {
      postDead('BB', 'ante', ante);
    }
  }

  for (const [position, kind, amount] of [['SB', 'sb', hand.sb], ['BB', 'bb', hand.bb]]) {
    if (amount <= 0) continue;
    const player = seated(position);
    // A blind nobody listed still posts — it is dead money the hand plays for.
    if (!player) { postDead(position, kind, amount); continue; }
    const paid = commit(player, amount);
    player.streetCommit = paid;
    posts.push({ position, kind, amount: paid });
  }

  for (const straddle of hand.straddles || []) {
    const player = runtime.get(straddle.position);
    if (!player) continue;
    const paid = commit(player, straddle.amount - player.streetCommit);
    player.streetCommit += paid;
    posts.push({ position: straddle.position, kind: 'straddle', amount: player.streetCommit });
  }

  return { posts, deadPot, deadUnattached, deadFloor };
}

/** Everyone who hasn't folded. */
function liveCount(runtime) {
  let n = 0;
  for (const p of runtime.values()) if (!p.folded) n++;
  return n;
}

/** Everyone who hasn't folded and still has chips to bet. */
function actingCount(runtime) {
  let n = 0;
  for (const p of runtime.values()) if (!p.folded && !p.allIn) n++;
  return n;
}

/**
 * Hand back the part of the largest bet on this street that nobody matched.
 *
 * A player who shoves 21 into an opponent who can only call 20 never had that
 * last chip in play, so it must come out before the street is swept into the
 * pot — otherwise it is awarded at showdown, and the loser of the hand appears
 * to "win" their own uncalled chip. Every real hand history reports this as
 * "Uncalled bet (1) returned to ..." and leaves it out of the total pot.
 *
 * Folded players count here: if a raise goes uncalled because everyone passed,
 * the raiser gets back everything above the largest bet anyone else made.
 */
function returnUncalledBet(runtime, deadFloor = 0) {
  const committed = [...runtime.values()].filter((p) => p.streetCommit > 0);
  if (!committed.length) return null;

  const sorted = committed.slice().sort((a, b) => b.streetCommit - a.streetCommit);
  const top = sorted[0];
  // `deadFloor` is what an unlisted blind has in front of it. Those chips match
  // a raise just as a listed blind's would, so an open that everyone folds to
  // is uncalled only above the blind — not all the way down to zero.
  const matched = Math.max(sorted.length > 1 ? sorted[1].streetCommit : 0, deadFloor);
  const uncalled = top.streetCommit - matched;
  if (uncalled <= 0) return null;

  top.streetCommit -= uncalled;
  top.contributed -= uncalled;
  top.wagered -= uncalled;
  top.stack += uncalled;
  // Chips coming back mean the player is no longer all-in.
  if (top.stack > 0) top.allIn = false;
  return { position: top.position, name: top.name, amount: uncalled };
}

/**
 * What the player to act may legally do, and the bounds on their sizing.
 * `potForSizing` is the pot as it would stand after they call, which is the
 * base every "% pot" button multiplies.
 */
export function legalFor(player, ctx) {
  const { betToCall, minRaiseIncrement, pot, streetTotal, unit } = ctx;
  const toCall = Math.max(0, Math.min(betToCall - player.streetCommit, player.stack));
  const maxTo = player.streetCommit + player.stack;
  const rawMinTo = betToCall > 0 ? betToCall + minRaiseIncrement : minRaiseIncrement;
  return {
    position: player.position,
    unknownStack: !!player.unknownStack,
    canFold: true,
    canCheck: betToCall <= player.streetCommit,
    toCall,
    callIsAllIn: toCall > 0 && toCall >= player.stack,
    isRaise: betToCall > 0,
    minTo: Math.min(rawMinTo, maxTo),
    maxTo,
    stack: player.stack,
    streetCommit: player.streetCommit,
    potForSizing: pot + streetTotal + toCall,
    unit,
  };
}

/**
 * Turn a sizing the user typed into a total-for-the-street amount.
 *
 * `value` is always a number as a human would say it, never internal units:
 * 'pct' is a percentage of the pot after calling, 'bb' a count of big blinds,
 * and 'amount' a total in whatever unit the hand is being entered in.
 */
export function sizeToTotal(legal, mode, value, hand) {
  if (!Number.isFinite(value)) return null;
  let total;
  if (mode === 'pct') {
    total = legal.streetCommit + legal.toCall + (legal.potForSizing * value) / 100;
  } else if (mode === 'bb') {
    total = value * hand.bb;
  } else {
    total = toUnits(value);
  }
  total = roundForUnit(Math.round(total), hand.unit);
  return Math.max(0, Math.min(total, legal.maxTo));
}

/**
 * Rebuild the entire hand. Never mutates `hand`.
 * @returns the full state plus a street-by-street timeline.
 */
export function replay(hand) {
  const runtime = initRuntime(hand);
  const positions = hand.players.map((p) => p.position);
  const { posts, deadPot, deadUnattached, deadFloor } = postBlinds(hand, runtime);

  const streetTotal = () => [...runtime.values()].reduce((sum, p) => sum + p.streetCommit, 0);

  let collected = deadPot;           // chips gathered from streets already finished
  const returns = [];                // uncalled bets handed back, newest last
  const queue = (hand.actions || []).slice();
  const streets = [];
  let toAct = null;
  let legal = null;
  let currentStreet = 'preflop';
  let needsBoardFor = null;
  let paused = false;

  for (const streetId of STREETS) {
    const board = boardFor(hand, streetId);

    // A later street can't start until its cards are known.
    if (BOARD_LENGTH[streetId] > 0 && board.length < BOARD_LENGTH[streetId]) {
      needsBoardFor = streetId;
      break;
    }
    currentStreet = streetId;

    for (const player of runtime.values()) {
      player.streetCommit = 0;
      player.actedThisStreet = false;
    }

    let betToCall = 0;
    let minRaiseIncrement = hand.bb;
    if (streetId === 'preflop') {
      // Blinds were posted before the loop, so restore them as this street's commitments.
      for (const post of posts) {
        if (post.kind === 'ante') continue;
        const player = runtime.get(post.position);
        // An unlisted blind sets the price even though nobody is sitting there.
        if (player) player.streetCommit = post.amount;
        betToCall = Math.max(betToCall, post.amount);
      }
    }

    const order = actionOrder(positions, streetId, hand.tableSize, hand.scheme);
    const street = { id: streetId, board, potStart: collected, playersIn: liveCount(runtime), actions: [], complete: false };
    streets.push(street);
    let cursor = 0;

    while (true) {
      if (liveCount(runtime) <= 1) break;

      let found = -1;
      for (let k = 0; k < order.length; k++) {
        const i = (cursor + k) % order.length;
        const player = runtime.get(order[i]);
        if (!player || player.folded || player.allIn) continue;
        if (!player.actedThisStreet || player.streetCommit < betToCall) { found = i; break; }
      }
      // Nobody left who can act, or one lone player already square with the bet.
      if (found === -1) break;
      const player = runtime.get(order[found]);
      if (actingCount(runtime) === 1 && player.streetCommit >= betToCall) break;

      if (!queue.length) {
        toAct = player.position;
        legal = legalFor(player, {
          betToCall, minRaiseIncrement, pot: collected, streetTotal: streetTotal(), unit: hand.unit,
        });
        paused = true;
        break;
      }

      const action = queue.shift();
      const stackBefore = player.stack;
      const betBefore = betToCall;

      if (action.kind === 'fold') {
        player.folded = true;
      } else if (action.kind === 'check') {
        // nothing changes but the turn
      } else {
        // A call is capped at what is owed; a bet or raise only at the stack.
        const ceiling = action.kind === 'call'
          ? Math.min(betToCall, player.streetCommit + player.stack)
          : player.streetCommit + player.stack;
        const target = Math.min(action.to ?? 0, ceiling);
        const paid = commit(player, Math.max(0, target - player.streetCommit));
        player.streetCommit += paid;
        if (player.streetCommit > betToCall) {
          minRaiseIncrement = Math.max(minRaiseIncrement, player.streetCommit - betToCall);
          betToCall = player.streetCommit;
        }
      }
      player.actedThisStreet = true;

      // Name the action from the state it was taken in rather than trusting the
      // caller: a shove into an unopened pot is a bet, a shove for less than the
      // outstanding bet is a call, and only clearing the bet is a raise.
      let kind = action.kind;
      if (kind !== 'fold' && kind !== 'check') {
        if (player.streetCommit > betBefore) kind = betBefore > 0 ? 'raise' : 'bet';
        else kind = 'call';
      }

      street.actions.push({
        street: streetId,
        position: player.position,
        name: player.name,
        kind,
        to: player.streetCommit,
        raiseBy: Math.max(0, player.streetCommit - betBefore),
        added: stackBefore - player.stack,
        allIn: player.allIn && action.kind !== 'fold' && action.kind !== 'check',
        stackAfter: player.stack,
        potAfter: collected + streetTotal(),
        isHero: player.isHero,
      });

      cursor = (found + 1) % order.length;
    }

    if (paused) {
      // Mid-street: leave the bets in front of the players so the UI can show them.
      street.potEnd = collected + streetTotal();
      break;
    }

    const uncalled = returnUncalledBet(runtime, streetId === 'preflop' ? deadFloor : 0);
    if (uncalled) { uncalled.street = streetId; returns.push(uncalled); }

    for (const player of runtime.values()) { collected += player.streetCommit; player.streetCommit = 0; }
    street.potEnd = collected;
    street.uncalled = uncalled || null;
    street.complete = true;
    if (liveCount(runtime) <= 1) break;
  }

  let status;
  if (paused) status = 'betting';
  else if (needsBoardFor) status = 'awaiting-board';
  else if (liveCount(runtime) <= 1) status = 'complete';
  else status = 'showdown';

  const players = [...runtime.values()];
  const result = {
    hand,
    players,
    posts,
    streets,
    returns,
    pot: collected + streetTotal(),
    collected,
    street: currentStreet,
    status,
    toAct,
    legal,
    needsBoardFor,
    // Only the cards this hand actually reached. Nothing downstream should be
    // able to print a river for a hand that ended before the flop, however the
    // extra cards got into the draft.
    board: (hand.board || []).slice(0, streets.length ? BOARD_LENGTH[streets[streets.length - 1].id] : 0),
  };

  if (status === 'complete' || status === 'showdown') {
    Object.assign(result, settle(hand, players, collected, status, deadUnattached));
  }
  return result;
}

/**
 * Work out who gets what. Side pots are built by contribution level so that a
 * short stack can only win the part of the pot they actually covered.
 */
export function settle(hand, players, pot, status, deadUnattached = 0) {
  const live = players.filter((p) => !p.folded);
  if (live.length === 0) return { pots: [], winners: [], showdown: [], settled: false };

  if (live.length === 1) {
    const winner = live[0];
    return {
      pots: [{ amount: pot, eligible: [winner.position], winners: [winner.position] }],
      winners: [{ position: winner.position, amount: pot }],
      showdown: [],
      settled: true,
      uncontested: true,
    };
  }

  const board = hand.board || [];
  const known = live.filter((p) => p.cards && p.cards.length === 2);
  const canEvaluate = board.length === 5 && known.length === live.length;

  const showdown = live.map((p) => {
    const ready = board.length === 5 && p.cards && p.cards.length === 2;
    const hv = ready ? evaluate([...p.cards, ...board]) : null;
    return { position: p.position, name: p.name, cards: p.cards || [], hand: hv, isHero: p.isHero };
  });

  // Explicit winners take precedence: villains' cards often aren't known.
  const forced = hand.winners && hand.winners.length
    ? hand.winners.filter((w) => live.some((p) => p.position === w))
    : null;
  if (!canEvaluate && !forced) {
    return { pots: [], winners: [], showdown, settled: false, needsWinner: true };
  }

  // Side pots are built from wagers only. Antes are dead money that everyone
  // still in the hand is playing for, so they belong in the main pot.
  const levels = [...new Set(players.map((p) => p.wagered))].filter((v) => v > 0).sort((a, b) => a - b);
  const pots = [];
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.wagered, level) - Math.min(p.wagered, previous));
    const eligible = live.filter((p) => p.wagered >= level).map((p) => p.position);
    if (amount > 0 && eligible.length) {
      const last = pots[pots.length - 1];
      if (last && last.eligible.join() === eligible.join()) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    previous = level;
  }

  const dead = players.reduce((sum, p) => sum + (p.contributed - p.wagered), 0) + deadUnattached;
  if (dead > 0) {
    if (pots.length) pots[0].amount += dead;
    else pots.push({ amount: dead, eligible: live.map((p) => p.position) });
  }

  const won = new Map();
  for (const p of pots) {
    let takers;
    if (forced) {
      takers = p.eligible.filter((pos) => forced.includes(pos));
      if (!takers.length) takers = p.eligible;
    } else {
      const scored = p.eligible.map((pos) => ({ pos, score: showdown.find((s) => s.position === pos).hand.score }));
      const best = Math.max(...scored.map((s) => s.score));
      takers = scored.filter((s) => s.score === best).map((s) => s.pos);
    }
    p.winners = takers;
    // Odd chips go to the first eligible seat clockwise from the button, the
    // same rule a real table uses; here that's simply first in seat order.
    const share = Math.floor(p.amount / takers.length);
    let remainder = p.amount - share * takers.length;
    for (const pos of takers) {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      won.set(pos, (won.get(pos) || 0) + share + extra);
    }
  }

  return {
    pots,
    winners: [...won.entries()].map(([position, amount]) => ({ position, amount })),
    showdown,
    settled: true,
    uncontested: false,
  };
}

/** Append an action, returning a new hand. */
export function withAction(hand, action) {
  return { ...hand, actions: [...(hand.actions || []), action] };
}

/** Drop the last action, returning a new hand. */
export function withoutLastAction(hand) {
  return { ...hand, actions: (hand.actions || []).slice(0, -1) };
}
