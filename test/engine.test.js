import test from 'node:test';
import assert from 'node:assert/strict';
import { replay } from '../src/core/engine.js';
import { fromUnits, toUnits } from '../src/core/amount.js';
import { buildHand, fold, check, call, bet, raise, allIn } from './helpers.js';

const bbOf = (units) => Number(fromUnits(units).toFixed(2));

/**
 * The hand in the GG share sheet used as the reference format: an 8-max
 * tournament table with seven seats filled, 0.15 BB ante from everyone.
 * Every pot figure below is the one GG printed.
 */
function ggReferenceHand(actions, board = '') {
  return buildHand({
    tableSize: 8, scheme: 'gg', unit: 'bb', sb: 0.5, bb: 1, ante: 0.15, anteMode: 'each',
    seats: {
      SB: { stack: 27.61, cards: 'AcKc' },
      BB: 78.74,
      UTG: 12.62,
      'UTG+1': 36.23,
      MP: { stack: 30.2, cards: 'AdQd' },
      CO: 10.07,
      BTN: 32.59,
    },
    hero: 'SB',
    board,
    actions,
  });
}

test('blinds and antes build the preflop pot', () => {
  const state = replay(ggReferenceHand([]));
  // 7 antes of 0.15 = 1.05 dead money, plus the 0.5 and 1 still in front of the blinds.
  assert.equal(bbOf(state.collected), 1.05);
  assert.equal(bbOf(state.pot), 2.55);
  assert.equal(state.toAct, 'UTG');
  assert.equal(bbOf(state.legal.toCall), 1);
});

test('preflop order skips seats that are not in the hand', () => {
  const state = replay(ggReferenceHand([fold('UTG'), fold('UTG+1'), raise('MP', 3)]));
  assert.equal(state.toAct, 'CO');
  assert.equal(bbOf(state.legal.toCall), 3);
  assert.equal(bbOf(state.legal.minTo), 5); // 3-bet to at least 3 + the 2 raise increment
});

test('pot after each street matches the reference hand', () => {
  const preflop = [
    fold('UTG'), fold('UTG+1'), raise('MP', 3), fold('CO'), fold('BTN'),
    raise('SB', 9), fold('BB'), call('MP', 9),
  ];
  const flop = [bet('SB', 5.01), call('MP', 5.01)];

  const afterPreflop = replay(ggReferenceHand(preflop, 'Ah2h7c'));
  assert.equal(bbOf(afterPreflop.streets[0].potEnd), 20.05);
  assert.equal(afterPreflop.street, 'flop');
  assert.equal(afterPreflop.toAct, 'SB', 'hero is out of position, so acts first postflop');

  const afterFlop = replay(ggReferenceHand([...preflop, ...flop], 'Ah2h7cTs'));
  assert.equal(bbOf(afterFlop.streets[1].potEnd), 30.07);
  assert.equal(afterFlop.toAct, 'SB');
});

test('an all-in is capped at the stack, never at the number typed', () => {
  const actions = [
    fold('UTG'), fold('UTG+1'), raise('MP', 3), fold('CO'), fold('BTN'),
    raise('SB', 9), fold('BB'), call('MP', 9),
    bet('SB', 5.01), call('MP', 5.01),
    allIn('SB'), call('MP', 99),
  ];
  const state = replay(ggReferenceHand(actions, 'Ah2h7cTs9h'));
  const hero = state.players.find((p) => p.position === 'SB');
  assert.equal(hero.stack, 0);
  assert.equal(hero.allIn, true);
  // Every chip in front of the hero reaches the pot: 0.15 ante + 9 + 5.01 + a 13.45 shove.
  assert.equal(bbOf(hero.contributed), 27.61);
  const villainShove = state.streets[2].actions.at(-1);
  assert.equal(bbOf(villainShove.to), 13.45, 'the call is trimmed to what the shove actually was');
});

test('the reference hand plays to showdown and hero wins on the kicker', () => {
  const actions = [
    fold('UTG'), fold('UTG+1'), raise('MP', 3), fold('CO'), fold('BTN'),
    raise('SB', 9), fold('BB'), call('MP', 9),
    bet('SB', 5.01), call('MP', 5.01),
    allIn('SB'), call('MP', 99),
  ];
  const state = replay(ggReferenceHand(actions, 'Ah2h7cTs9h'));
  assert.equal(state.status, 'showdown');
  assert.equal(state.settled, true);
  assert.equal(state.winners.length, 1);
  assert.equal(state.winners[0].position, 'SB');
  assert.equal(bbOf(state.winners[0].amount), 56.97); // GG printed 56.96, rounding its own BB conversion
  const heroShow = state.showdown.find((s) => s.position === 'SB');
  assert.equal(heroShow.hand.name, 'One Pair, Aces');
});

test('everyone folding to the big blind ends the hand there', () => {
  const state = replay(buildHand({
    tableSize: 6, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: { SB: 100, BB: 100, LJ: 100, HJ: 100, CO: 100, BTN: 100 },
    hero: 'BTN',
    actions: [fold('LJ'), fold('HJ'), fold('CO'), fold('BTN'), fold('SB')],
  }));
  assert.equal(state.status, 'complete');
  assert.equal(state.uncontested, true);
  assert.equal(state.winners[0].position, 'BB');
  // The big blind's own unmatched half-blind is handed back, not won: the pot
  // is the 0.5 the small blind actually put up, plus the 0.5 that matched it.
  assert.deepEqual(state.returns.map((r) => [r.position, bbOf(r.amount)]), [['BB', 0.5]]);
  assert.equal(bbOf(state.pot), 1);
  assert.equal(bbOf(state.winners[0].amount), 1);
});

test('the big blind gets an option when the pot is only limped', () => {
  const state = replay(buildHand({
    tableSize: 6, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: { SB: 100, BB: 100, LJ: 100, HJ: 100, CO: 100, BTN: 100 },
    hero: 'BTN',
    actions: [fold('LJ'), fold('HJ'), fold('CO'), call('BTN', 1), fold('SB')],
  }));
  assert.equal(state.toAct, 'BB');
  assert.equal(state.legal.canCheck, true);
  assert.equal(bbOf(state.legal.minTo), 2);
});

test('heads up: small blind acts first preflop, big blind first after', () => {
  const preflop = replay(buildHand({
    tableSize: 2, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: { SB: 50, BB: 50 }, hero: 'SB', actions: [],
  }));
  assert.equal(preflop.toAct, 'SB');

  const postflop = replay(buildHand({
    tableSize: 2, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: { SB: 50, BB: 50 }, hero: 'SB', board: '2c7dKh',
    actions: [call('SB', 1), check('BB')],
  }));
  assert.equal(postflop.street, 'flop');
  assert.equal(postflop.toAct, 'BB');
});

test('a street cannot start before its cards are known', () => {
  const state = replay(buildHand({
    tableSize: 6, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: { SB: 100, BB: 100, LJ: 100, HJ: 100, CO: 100, BTN: 100 },
    hero: 'BTN',
    actions: [fold('LJ'), fold('HJ'), fold('CO'), call('BTN', 1), fold('SB'), check('BB')],
  }));
  assert.equal(state.status, 'awaiting-board');
  assert.equal(state.needsBoardFor, 'flop');
  assert.equal(state.toAct, null);
});

test('side pots: a short all-in can only win what it covered', () => {
  const state = replay(buildHand({
    tableSize: 6, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: {
      SB: { stack: 100, cards: 'AcAd' },
      BB: { stack: 10, cards: 'KcKd' },
      LJ: 100, HJ: 100, CO: 100,
      BTN: { stack: 60, cards: 'QcQd' },
    },
    hero: 'SB',
    board: '2c7d9hTs3s',
    actions: [
      fold('LJ'), fold('HJ'), fold('CO'), raise('BTN', 60), raise('SB', 100), call('BB', 10),
    ],
  }));
  assert.equal(state.status, 'showdown');
  // The 40 the SB shoved beyond what the button could call was never contested,
  // so it comes straight back and never becomes a pot at all.
  assert.deepEqual(state.returns.map((r) => [r.position, bbOf(r.amount)]), [['SB', 40]]);
  assert.equal(state.pots.length, 2, 'a main pot and one side pot');
  assert.equal(bbOf(state.pots[0].amount), 30);  // 10 x 3, everyone can win this
  assert.equal(bbOf(state.pots[1].amount), 100); // 50 x 2, only SB and BTN covered it
  assert.deepEqual(state.winners.map((w) => w.position), ['SB']);
  assert.equal(bbOf(state.winners[0].amount), 130);
});

test('the loser of a hand never "wins" their own uncalled chips', () => {
  // The big blind shoves 21 into a button who can only call 20. The button
  // wins the hand; the odd big blind was never in play and must come back
  // rather than being awarded as a one-blind win to the player who lost.
  const state = replay(buildHand({
    tableSize: 6, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: {
      SB: 50, BB: { stack: 21, cards: '7c2d' }, LJ: 50, HJ: 50, CO: 50,
      BTN: { stack: 20, cards: 'AcAd' },
    },
    hero: 'BTN', board: 'Ah2h7cTs9s',
    actions: [fold('LJ'), fold('HJ'), fold('CO'), raise('BTN', 3), fold('SB'), raise('BB', 21), call('BTN', 99)],
  }));

  assert.deepEqual(state.returns.map((r) => [r.position, bbOf(r.amount)]), [['BB', 1]]);
  assert.deepEqual(state.winners.map((w) => [w.position, bbOf(w.amount)]), [['BTN', 40.5]]);
  assert.ok(!state.winners.some((w) => w.position === 'BB'), 'the loser is not listed as a winner');
  assert.equal(bbOf(state.pot), 40.5, 'the uncalled blind is not part of the pot');
  const bb = state.players.find((p) => p.position === 'BB');
  assert.equal(bbOf(bb.stack), 1, 'the chip is back in the loser\'s stack');
  assert.equal(bb.allIn, false, 'and they are no longer all-in');
});

test('a big blind ante does not invent a side pot for the player who posted it', () => {
  // The BB antes 1 and then calls a shove with everything left. Their ante
  // makes their *total* outlay larger than the shover's, but not their wager —
  // treating it as one would hand them a phantom top pot they alone qualify
  // for, so the loser of the hand appears to win a big blind.
  const state = replay(buildHand({
    tableSize: 8, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1, ante: 1, anteMode: 'bb',
    seats: { SB: 20, BB: { stack: 25, cards: 'KcKd' }, CO: 40, BTN: { stack: 32, cards: 'AcAd' } },
    hero: 'BTN', board: '2c7d9hTs3s',
    actions: [fold('CO'), raise('BTN', 32), fold('SB'), call('BB', 99)],
  }));

  assert.equal(state.status, 'showdown');
  assert.deepEqual(state.returns.map((r) => [r.position, bbOf(r.amount)]), [['BTN', 8]]);
  assert.equal(state.pots.length, 1, 'one pot: nobody out-wagered anybody');
  assert.deepEqual(state.winners.map((w) => [w.position, bbOf(w.amount)]), [['BTN', 49.5]]);
  assert.ok(!state.winners.some((w) => w.position === 'BB'));
  // The ante is still in the pot, just not as a wager that splits it.
  assert.equal(bbOf(state.pot), 49.5);
});

test('a winner can be named when villain cards were never seen', () => {
  const state = replay(buildHand({
    tableSize: 6, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: { SB: 100, BB: 100, LJ: 100, HJ: 100, CO: 100, BTN: 100 },
    hero: 'BTN',
    board: '2c7d9hTs3s',
    actions: [
      fold('LJ'), fold('HJ'), fold('CO'), raise('BTN', 3), fold('SB'), call('BB', 3),
      check('BB'), check('BTN'), check('BB'), check('BTN'), check('BB'), check('BTN'),
    ],
  }));
  assert.equal(state.status, 'showdown');
  assert.equal(state.needsWinner, true);
  const named = replay({ ...state.hand, winners: ['BB'] });
  assert.equal(named.settled, true);
  assert.equal(bbOf(named.winners[0].amount), 6.5);
});

test('a blind with no stack entered can still post, fold, and be called', () => {
  // Only the hero's stack is known. The blinds are in the hand because they
  // post, but nobody looked up what they had — they must not be treated as
  // sitting there with zero chips.
  const state = replay(buildHand({
    tableSize: 6, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: { SB: 0, BB: 0, CO: 0, BTN: 40 },
    hero: 'BTN',
    actions: [fold('CO'), raise('BTN', 3), fold('SB')],
  }));

  const sb = state.players.find((p) => p.position === 'SB');
  assert.equal(sb.unknownStack, true);
  assert.equal(sb.folded, true);
  assert.equal(sb.allIn, false, 'posting a blind does not put an unknown stack all-in');
  assert.equal(bbOf(sb.contributed), 0.5);

  // The big blind is still to act, and is not capped at zero.
  assert.equal(state.toAct, 'BB');
  assert.equal(state.legal.unknownStack, true);
  assert.equal(bbOf(state.legal.toCall), 2, 'they can call the raise in full');
});

test('an unknown stack can win a pot without a stack ever being invented', () => {
  const state = replay(buildHand({
    tableSize: 6, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: { SB: 0, BB: 0, CO: 0, BTN: 40 },
    hero: 'BTN',
    actions: [fold('CO'), raise('BTN', 3), fold('SB'), raise('BB', 9), fold('BTN')],
  }));
  assert.equal(state.status, 'complete');
  assert.equal(state.winners[0].position, 'BB');
  // BTN's 3 plus the SB's 0.5 plus the 3 of the BB's raise that BTN matched.
  assert.equal(bbOf(state.winners[0].amount), 6.5);
  assert.deepEqual(state.returns.map((r) => [r.position, bbOf(r.amount)]), [['BB', 6]]);
});
