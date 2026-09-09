import test from 'node:test';
import assert from 'node:assert/strict';
import { seatRing, preflopRing, postflopRing, actionOrder } from '../src/core/positions.js';
import {
  createHand, togglePlayer, resizeTable, setHero, updatePlayer, validateSetup, reviveHand,
  nextHand, anteAmount, setAllStacks,
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

test('a new hand starts with an empty table and nobody as hero', () => {
  const hand = createHand();
  assert.equal(hand.tableSize, 8);
  assert.equal(hand.anteMode, 'bb', 'a big blind ante is the modern default');
  assert.deepEqual(hand.players, [], 'not even the blinds: they post without being listed');
  assert.ok(!hand.players.some((p) => p.isHero), 'the hero is chosen, never guessed');
  assert.ok(validateSetup(hand).some((p) => /at least two/.test(p)));
});

test('any seat can be switched on and off, blinds included', () => {
  let hand = createHand({ tableSize: 6 });
  for (const position of ['SB', 'LJ']) {
    hand = togglePlayer(hand, position, true);
    assert.ok(hand.players.some((p) => p.position === position));
    hand = togglePlayer(hand, position, false);
    assert.ok(!hand.players.some((p) => p.position === position));
  }
});

test('switching a seat on never makes it the hero behind your back', () => {
  let hand = createHand({ tableSize: 6 });
  hand = togglePlayer(hand, 'CO', true);
  hand = togglePlayer(hand, 'BTN', true);
  assert.ok(!hand.players.some((p) => p.isHero));
});

test('resizing the table keeps the seats already chosen, and their stacks', () => {
  let hand = createHand({ tableSize: 6 });
  for (const position of ['SB', 'BB', 'LJ', 'HJ', 'CO', 'BTN']) hand = togglePlayer(hand, position, true);
  hand = { ...hand, players: hand.players.map((p) => ({ ...p, stack: toUnits(50) })) };

  const smaller = resizeTable(hand, 3);
  assert.deepEqual(smaller.players.map((p) => p.position), ['SB', 'BB', 'BTN']);
  assert.ok(smaller.players.every((p) => p.stack === toUnits(50)));
});

test('resizing does not switch seats back on that were left off', () => {
  let hand = createHand({ tableSize: 6 });
  hand = togglePlayer(hand, 'BB', true);
  hand = togglePlayer(hand, 'BTN', true);
  const bigger = resizeTable(hand, 9);
  assert.deepEqual(bigger.players.map((p) => p.position), ['BB', 'BTN']);
});

test('setup problems are reported as sentences, and clear when fixed', () => {
  let hand = createHand({ tableSize: 6 });
  assert.ok(validateSetup(hand).some((p) => /at least two/.test(p)));
  hand = togglePlayer(hand, 'CO', true);
  hand = togglePlayer(hand, 'BTN', true);
  assert.ok(validateSetup(hand).some((p) => /Pick which seat is you/.test(p)));
  hand = setHero(hand, 'BTN');
  assert.ok(validateSetup(hand).some((p) => /Enter your own stack/.test(p)));
  hand = updatePlayer(hand, 'BTN', { stack: toUnits(40) });
  assert.deepEqual(validateSetup(hand), [], 'the other seat needs no stack of its own');
});

test('only your own stack is required', () => {
  let hand = createHand({ tableSize: 6 });
  hand = togglePlayer(hand, 'BB', true);
  hand = togglePlayer(hand, 'CO', true);
  hand = setHero(hand, 'CO');
  hand = updatePlayer(hand, 'CO', { stack: toUnits(40) });
  // The big blind is listed because it played, but nobody looked up what it
  // had, and the hand is still perfectly exportable.
  assert.deepEqual(validateSetup(hand), []);
  assert.ok(hand.players.filter((p) => !p.isHero).every((p) => p.stack === 0));
});

test('a big blind ante is one big blind, with no size to enter', () => {
  let hand = createHand({ tableSize: 6 });
  hand = togglePlayer(hand, 'BB', true);
  hand = togglePlayer(hand, 'BTN', true);
  hand = { ...hand, players: hand.players.map((p) => ({ ...p, stack: toUnits(40) })) };
  hand = setHero(hand, 'BTN');
  hand = { ...hand, anteMode: 'bb', ante: 0 };

  assert.equal(anteAmount(hand), hand.bb);
  assert.deepEqual(validateSetup(hand), [], 'no ante size is asked for');
  // It follows the blind rather than being stored, so a level change can't
  // leave a stale ante behind.
  assert.equal(anteAmount({ ...hand, bb: toUnits(4000) }), toUnits(4000));
});

test('a stack under one big blind is flagged as a probable unit mix-up', () => {
  let hand = createHand({ tableSize: 6 });
  hand = togglePlayer(hand, 'BB', true);
  hand = togglePlayer(hand, 'CO', true);
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

test('the next hand keeps the game and forgets everything else', () => {
  let hand = createHand({ tableSize: 8, scheme: 'gg' });
  for (const position of ['SB', 'BB', 'UTG', 'MP', 'CO', 'BTN']) hand = togglePlayer(hand, position, true);
  hand = { ...hand, players: hand.players.map((p) => ({ ...p, stack: toUnits(40), cards: parseCards('AcKc') })) };
  hand = setHero(hand, 'SB');
  hand = {
    ...hand,
    tournament: 'Bounty Hunters HR',
    sb: toUnits(0.5),
    bb: toUnits(1),
    anteMode: 'bb',
    board: parseCards('2c7dKh'),
    actions: [{ position: 'UTG', kind: 'fold' }],
    winners: ['SB'],
    note: 'was this a fold?',
    hideHeroCards: true,
  };

  const next = nextHand(hand);

  // The game you are sitting in carries.
  assert.equal(next.tournament, 'Bounty Hunters HR');
  assert.equal(next.sb, toUnits(0.5));
  assert.equal(next.bb, toUnits(1));
  assert.equal(next.anteMode, 'bb');
  assert.equal(next.tableSize, 8);
  assert.equal(next.scheme, 'gg');

  // The hand does not: an entirely new one, down to an empty table.
  assert.notEqual(next.id, hand.id);
  assert.deepEqual(next.players, []);
  assert.deepEqual(next.actions, []);
  assert.deepEqual(next.board, []);
  assert.deepEqual(next.winners, []);
  assert.equal(next.note, '');
  // Left set, this quietly made every later hand a mystery hand too.
  assert.equal(next.hideHeroCards, false);
  assert.ok(validateSetup(next).some((p) => /at least two/.test(p)));
});

test('changing the table clears the board, not just the action', () => {
  let hand = createHand({ tableSize: 6 });
  hand = togglePlayer(hand, 'BB', true);
  hand = togglePlayer(hand, 'CO', true);
  hand = setHero(hand, 'CO');
  hand = updatePlayer(hand, 'CO', { stack: toUnits(40) });
  hand = { ...hand, board: parseCards('2c7d9hTs3d'), actions: [{ position: 'CO', kind: 'fold' }] };

  // Reworking the seats invalidates how the hand was played, board included —
  // otherwise a hand that folds preflop still exports a river.
  const toggled = togglePlayer(hand, 'BTN', true);
  assert.deepEqual(toggled.actions, []);
  assert.deepEqual(toggled.board, []);
  assert.ok(toggled.players.some((p) => p.position === 'BTN'));

  const resized = resizeTable(hand, 9);
  assert.deepEqual(resized.actions, []);
  assert.deepEqual(resized.board, []);
});

test('one depth can be given to the whole table', () => {
  let hand = createHand({ tableSize: 6 });
  for (const position of ['BB', 'CO', 'BTN']) hand = togglePlayer(hand, position, true);
  hand = setHero(hand, 'BTN');
  hand = updatePlayer(hand, 'CO', { stack: toUnits(12) });

  // "40bb effective" is how the hand would be described out loud, and it
  // overwrites the odd seat that was already set.
  const level = setAllStacks(hand, toUnits(40));
  assert.deepEqual(level.players.map((p) => p.stack), [toUnits(40), toUnits(40), toUnits(40)]);
  assert.deepEqual(validateSetup(level), []);

  // Seats switched off stay off, and the hero is untouched.
  assert.deepEqual(level.players.map((p) => p.position), ['BB', 'CO', 'BTN']);
  assert.equal(level.players.find((p) => p.isHero).position, 'BTN');
});
