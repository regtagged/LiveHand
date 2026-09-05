import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, sizeToTotal } from '../src/core/engine.js';
import { fromUnits, parseAmount, roundForUnit, toUnits } from '../src/core/amount.js';
import { buildHand, fold, call, raise } from './helpers.js';

const bbOf = (units) => Number(fromUnits(units).toFixed(2));

function openPot() {
  return replay(buildHand({
    tableSize: 6, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: { SB: 100, BB: 100, LJ: 100, HJ: 100, CO: 100, BTN: 100 },
    hero: 'BTN',
    actions: [fold('LJ'), fold('HJ'), fold('CO'), raise('BTN', 3), fold('SB'), call('BB', 3), // pot 6.5
    ],
    board: '2c7dKh',
  }));
}

test('a sizing is read as the number the user typed, not as internal units', () => {
  const state = openPot();
  assert.equal(state.toAct, 'BB');
  // 6.5 in the pot, nothing to call: a 50% bet is 3.25, not 0.0325.
  assert.equal(bbOf(sizeToTotal(state.legal, 'pct', 50, state.hand)), 3.25);
  assert.equal(bbOf(sizeToTotal(state.legal, 'bb', 3, state.hand)), 3);
  assert.equal(bbOf(sizeToTotal(state.legal, 'amount', 4.5, state.hand)), 4.5);
});

test('a percentage is of the pot after calling, the way solvers mean it', () => {
  const state = replay(buildHand({
    tableSize: 6, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: { SB: 100, BB: 100, LJ: 100, HJ: 100, CO: 100, BTN: 100 },
    hero: 'BTN', board: '2c7dKh',
    actions: [fold('LJ'), fold('HJ'), fold('CO'), raise('BTN', 3), fold('SB'), call('BB', 3),
      { position: 'BB', kind: 'bet', to: toUnits(3) }],
  }));
  assert.equal(state.toAct, 'BTN');
  // Pot 6.5 + BB's 3 + the 3 BTN must call = 12.5. A pot-sized raise is 3 + 12.5.
  assert.equal(bbOf(state.legal.potForSizing), 12.5);
  assert.equal(bbOf(sizeToTotal(state.legal, 'pct', 100, state.hand)), 15.5);
  assert.equal(bbOf(sizeToTotal(state.legal, 'pct', 50, state.hand)), 9.25);
});

test('no sizing can exceed the stack, however it was expressed', () => {
  const state = replay(buildHand({
    tableSize: 6, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: { SB: 100, BB: 12, LJ: 100, HJ: 100, CO: 100, BTN: 100 },
    hero: 'BTN', board: '2c7dKh',
    actions: [fold('LJ'), fold('HJ'), fold('CO'), raise('BTN', 3), fold('SB'), call('BB', 3)],
  }));
  const { legal, hand } = state;
  assert.equal(bbOf(legal.maxTo), 9); // 12 starting, 3 already in
  for (const [mode, value] of [['pct', 900], ['bb', 500], ['amount', 999]]) {
    assert.equal(bbOf(sizeToTotal(legal, mode, value, hand)), 9, `${mode} should cap at the stack`);
  }
});

test('chip-mode sizings land on whole chips', () => {
  const state = replay(buildHand({
    tableSize: 6, scheme: 'standard', unit: 'chips', sb: 2000, bb: 4000, ante: 600, anteMode: 'each',
    seats: { SB: 109825, BB: 314345, LJ: 49866, HJ: 144334, CO: 39697, BTN: 129775 },
    hero: 'BTN',
    actions: [fold('LJ'), fold('HJ'), fold('CO')],
  }));
  const total = sizeToTotal(state.legal, 'pct', 33, state.hand);
  assert.equal(total % 100, 0, 'a chip-game size should never carry a fraction of a chip');
  assert.equal(roundForUnit(total, 'chips'), total);
});

test('amounts survive the way people actually type them', () => {
  assert.equal(parseAmount('110k'), toUnits(110000));
  assert.equal(parseAmount('1,250'), toUnits(1250));
  assert.equal(parseAmount(' 27.61 '), toUnits(27.61));
  assert.equal(parseAmount('2.5m'), toUnits(2500000));
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
});
