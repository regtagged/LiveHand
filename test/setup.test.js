import test from 'node:test';
import assert from 'node:assert/strict';
import { seatRing, preflopRing, postflopRing, actionOrder } from '../src/core/positions.js';
import {
  createHand, togglePlayer, resizeTable, setHero, validateSetup, reviveHand, nextHand,
} from '../src/core/hand.js';
import { evaluate } from '../src/core/evaluate.js';
import { equity } from '../src/core/equity.js';
import { parseCards, findDuplicate } from '../src/core/cards.js';
import { toUnits } from '../src/core/amount.js';

test('preflop starts after the big blind, postflop after the button', () => {
  const six = seatRing(6, 'standard');
  assert.deepEqual(six, ['SB', 'BB', 'LJ', 'HJ', 'CO', 'BTN']);
  assert.deepEqual(preflopRing(six), ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  assert.deepEqual(postflopRing(six), ['SB', 'BB', 'LJ', 'HJ', 'CO', 'BTN']);
});

test('heads up needs no special case: the small blind is the button', () => {
  const two = seatRing(2, 'standard');
  assert.deepEqual(preflopRing(two), ['SB', 'BB']);
  assert.deepEqual(postflopRing(two), ['BB', 'SB']);
});

test('GG naming is available for tables that use it', () => {
  assert.deepEqual(seatRing(7, 'gg'), ['SB', 'BB', 'UTG', 'MP', 'MP1', 'CO', 'BTN']);
  assert.deepEqual(seatRing(7, 'standard'), ['SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO', 'BTN']);
});

test('dropping seats keeps the survivors in the right order', () => {
  const order = actionOrder(['SB', 'BB', 'CO', 'BTN'], 'preflop', 8, 'gg');
  assert.deepEqual(order, ['CO', 'BTN', 'SB', 'BB']);
});

test('the blinds cannot be dropped from a hand', () => {
  let hand = createHand({ tableSize: 6 });
  hand = togglePlayer(hand, 'SB', false);
  assert.ok(hand.players.some((p) => p.position === 'SB'));
  hand = togglePlayer(hand, 'LJ', false);
  assert.ok(!hand.players.some((p) => p.position === 'LJ'));
});

test('resizing the table keeps the stacks that still have a seat', () => {
  let hand = createHand({ tableSize: 6 });
  hand = { ...hand, players: hand.players.map((p) => ({ ...p, stack: toUnits(50) })) };
  const smaller = resizeTable(hand, 3);
  assert.deepEqual(smaller.players.map((p) => p.position), ['SB', 'BB', 'BTN']);
  assert.ok(smaller.players.every((p) => p.stack === toUnits(50)));
  assert.ok(smaller.players.some((p) => p.isHero), 'a hero always survives a resize');
});

test('setup problems are reported as sentences, and clear when fixed', () => {
  let hand = createHand({ tableSize: 6 });
  assert.ok(validateSetup(hand).some((p) => /Enter a stack/.test(p)));
  hand = { ...hand, players: hand.players.map((p) => ({ ...p, stack: toUnits(40) })) };
  hand = setHero(hand, 'BTN');
  assert.deepEqual(validateSetup(hand), []);
});

test('a stack under one big blind is flagged as a probable unit mix-up', () => {
  let hand = createHand({ tableSize: 6 });
  hand = { ...hand, players: hand.players.map((p) => ({ ...p, stack: toUnits(40) })) };
  hand = { ...hand, players: hand.players.map((p) => (p.position === 'CO' ? { ...p, stack: toUnits(0.4) } : p)) };
  assert.ok(validateSetup(hand).some((p) => /less than one big blind/.test(p)));
});

test('a hand read back from storage is still a usable hand', () => {
  const original = createHand({ tableSize: 6 });
  const revived = reviveHand(JSON.parse(JSON.stringify(original)));
  assert.equal(revived.tableSize, 6);
  assert.deepEqual(revived.players.map((p) => p.position), original.players.map((p) => p.position));
  assert.deepEqual(revived.actions, []);
  assert.equal(reviveHand(null), null);
});

test('the same card cannot be dealt twice', () => {
  const duplicate = findDuplicate([parseCards('AcKc'), parseCards('Ah2h'), parseCards('Ac')]);
  assert.equal(duplicate && `${duplicate.rank}${duplicate.suit}`, 'Ac');
  assert.equal(findDuplicate([parseCards('AcKc'), parseCards('Ah2h')]), null);
});

test('hands are ranked against each other correctly', () => {
  const better = (a, b) => evaluate(parseCards(a)).score > evaluate(parseCards(b)).score;
  assert.ok(better('AcKc Qc Jc Tc', 'Ac Ad Ah As Kc'), 'straight flush beats quads');
  assert.ok(better('Ac Ad Ah 2s 2c', 'Ac Kc 9c 5c 3c'), 'full house beats a flush');
  assert.ok(better('Ac Kc Qd Jh Ts', 'Ac Ad Ah 2s 3c'), 'straight beats trips');
  assert.ok(better('Ac Ad Kc Ks 4h', 'Ac Ad Qc Qs Kh'), 'higher two pair wins');
  assert.ok(better('Ac Ad 9c 8s 7h', 'Ac Ad 9c 8s 6h'), 'the kicker decides a tie');
  assert.equal(evaluate(parseCards('Ac 2c 3d 4h 5s')).name, 'Straight, Five High');
});

test('equity lands on the published numbers for known match-ups', () => {
  const [aces] = equity([parseCards('AcAd'), parseCards('KcKd')], []);
  assert.ok(aces > 80 && aces < 85, `AA vs KK should be about 82%, got ${aces.toFixed(1)}`);
  const [set] = equity([parseCards('7c7d'), parseCards('AcKd')], parseCards('7h2s9c'));
  assert.ok(set > 95, `flopped set should be a big favourite, got ${set.toFixed(1)}`);
});

test('the next hand keeps the table and forgets the hand', () => {
  let hand = createHand({ tableSize: 8, scheme: 'gg' });
  hand = togglePlayer(hand, 'MP1', false);          // a seat left out on purpose
  hand = { ...hand, players: hand.players.map((p) => ({ ...p, stack: toUnits(40), cards: parseCards('AcKc') })) };
  hand = setHero(hand, 'SB');
  hand = {
    ...hand,
    board: parseCards('2c7dKh'),
    actions: [{ position: 'UTG', kind: 'fold' }],
    winners: ['SB'],
    note: 'was this a fold?',
  };

  const next = nextHand(hand);

  // The table survives intact — including the seat that was switched off, which
  // must not come back with an empty stack and block the next hand.
  assert.deepEqual(next.players.map((p) => p.position), hand.players.map((p) => p.position));
  assert.ok(!next.players.some((p) => p.position === 'MP1'));
  assert.deepEqual(next.players.map((p) => p.stack), hand.players.map((p) => p.stack));
  assert.equal(next.players.find((p) => p.isHero).position, 'SB');
  assert.equal(next.tableSize, 8);
  assert.equal(next.scheme, 'gg');

  // The hand itself does not.
  assert.notEqual(next.id, hand.id);
  assert.deepEqual(next.actions, []);
  assert.deepEqual(next.board, []);
  assert.deepEqual(next.winners, []);
  assert.equal(next.note, '');
  assert.ok(next.players.every((p) => p.cards.length === 0));

  // And it is immediately playable rather than landing on a validation error.
  assert.deepEqual(validateSetup(next), []);
});
