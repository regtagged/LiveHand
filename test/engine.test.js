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
  assert.equal(bbOf(state.winners[0].amount), 1.5);
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
  assert.equal(state.pots.length, 3, 'main pot, BTN side pot, and the SB overbet coming back');
  assert.equal(bbOf(state.pots[0].amount), 30);  // 10 x 3
  assert.equal(bbOf(state.pots[1].amount), 100); // 50 x 2 between SB and BTN
  assert.equal(bbOf(state.pots[2].amount), 40);  // uncalled remainder returns to SB
  assert.deepEqual(state.winners.map((w) => w.position), ['SB']);
  assert.equal(bbOf(state.winners[0].amount), 170);
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
