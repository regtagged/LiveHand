import test from 'node:test';
import assert from 'node:assert/strict';
import { replay } from '../src/core/engine.js';
import { toTextHH } from '../src/export/textHH.js';
import { buildFrames, toReplayerHtml } from '../src/export/replayer.js';
import { buildGgSheet } from '../src/render/ggSheet.js';
import { buildTableSheet } from '../src/render/tableSheet.js';
import { sceneToSvg } from '../src/render/svg.js';
import { buildHand, fold, call, bet, raise, allIn } from './helpers.js';

/**
 * Read an SVG back as plain text: one space per text element so lines stay
 * apart, nothing between the tspans inside a line so words stay joined.
 */
function svgText(svg) {
  return svg
    .replace(/<\/text>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The hand from the GG share sheet the exports are modelled on. */
function referenceHand() {
  const hand = buildHand({
    tableSize: 8, scheme: 'gg', unit: 'bb', sb: 0.5, bb: 1, ante: 0.15, anteMode: 'each',
    seats: {
      SB: { stack: 27.61, cards: 'AcKc' }, BB: 78.74, UTG: 12.62, 'UTG+1': 36.23,
      MP: { stack: 30.2, cards: 'AdQd' }, CO: 10.07, BTN: 32.59,
    },
    hero: 'SB', board: 'Ah2h7cTs9h',
    actions: [
      fold('UTG'), fold('UTG+1'), raise('MP', 3), fold('CO'), fold('BTN'),
      raise('SB', 9), fold('BB'), call('MP', 9),
      bet('SB', 5.01), call('MP', 5.01),
      allIn('SB'), call('MP', 99),
    ],
  });
  const named = { ...hand, tournament: 'Bounty Hunters HR' };
  named.players = named.players.map((p) => (p.isHero ? { ...p, name: 'Hero' } : p));
  return named;
}

test('the text history follows the PokerStars line format', () => {
  const hand = referenceHand();
  const text = toTextHH(hand, replay(hand));

  assert.match(text, /^Poker Hand #LH[A-Z0-9]+: Tournament "Bounty Hunters HR"/m);
  assert.match(text, /^Table 'Bounty Hunters HR' 8-max Seat #7 is the button$/m);
  assert.match(text, /^Seat 1: Hero \(27\.61 in chips\)$/m);
  assert.match(text, /^Dealt to Hero \[Ac Kc\]$/m);
  // A raise states the increment first, then the total.
  assert.match(text, /^MP: raises 2 to 3$/m);
  assert.match(text, /^Hero: raises 6 to 9$/m);
  assert.match(text, /^\*\*\* FLOP \*\*\* \[Ah 2h 7c\]$/m);
  assert.match(text, /^\*\*\* TURN \*\*\* \[Ah 2h 7c\] \[Ts\]$/m);
  // Leading into an unopened pot is a bet, even when the button says raise.
  assert.match(text, /^Hero: bets 13\.45 and is all-in$/m);
  assert.match(text, /^Hero: shows \[Ac Kc\] \(One Pair, Aces\)$/m);
  assert.match(text, /^Total pot 56\.97 \| Rake 0$/m);
  assert.match(text, /^Board \[Ah 2h 7c Ts 9h\]$/m);
});

test('a folded seat is reported as folded, not mucked', () => {
  const hand = referenceHand();
  const text = toTextHH(hand, replay(hand));
  assert.match(text, /^Seat 6: CO folded$/m);
  assert.match(text, /^Seat 5: MP showed \[Ad Qd\] and lost with One Pair, Aces$/m);
});

test('the GG sheet reads the streets in order and ends on the winner', () => {
  const hand = referenceHand();
  const text = svgText(sceneToSvg(buildGgSheet(hand, replay(hand))));

  assert.match(text, /Bounty Hunters HR - 0\.5\/1 Ante 0\.15 NL \(8 max\) - Hold'em/);
  assert.match(text, /Hero \(SB\): 27\.61 BB/);
  assert.match(text, /7 players post ante of 0\.15 BB/);
  assert.match(text, /Flop \(20\.05 BB, 2 players\)/);
  assert.match(text, /Turn \(30\.07 BB, 2 players\)/);
  assert.match(text, /River \(56\.97 BB, 2 players\)/);
  assert.match(text, /One Pair, Aces/);
  assert.match(text, /Hero wins 56\.97 BB/);
});

test('both image layouts produce a self-contained SVG of positive size', () => {
  const hand = referenceHand();
  const state = replay(hand);
  for (const build of [buildGgSheet, buildTableSheet]) {
    const scene = build(hand, state, { width: 800 });
    assert.ok(scene.height > 200, 'scene should have real height');
    const svg = sceneToSvg(scene);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<\/svg>$/);
    assert.ok(!svg.includes('undefined'), 'no undefined leaked into the markup');
    assert.ok(!svg.includes('NaN'), 'no NaN leaked into a coordinate');
  }
});

test('replayer frames step through every action and land on the result', () => {
  const hand = referenceHand();
  const state = replay(hand);
  const { frames, meta } = buildFrames(hand, state);

  const actionCount = state.streets.reduce((n, s) => n + s.actions.length, 0);
  // One opening frame, one per action, one per street dealt, one final result.
  assert.equal(frames.length, actionCount + 1 + 3 + 1);
  assert.equal(frames[0].caption, 'Blinds posted');
  assert.equal(frames[0].pot, '2.55 BB');
  assert.equal(frames.at(-1).caption, 'Hero wins 56.97 BB');
  assert.equal(frames.at(-1).board.length, 5);
  assert.match(meta.title, /Bounty Hunters HR/);

  // Villains' cards stay hidden until the showdown frame.
  const mpEarly = frames[3].players.find((p) => p.position === 'MP');
  const mpLate = frames.at(-1).players.find((p) => p.position === 'MP');
  assert.deepEqual(mpEarly.cards, []);
  assert.deepEqual(mpLate.cards, ['Ad', 'Qd']);
});

test('the replayer is one standalone file with the hand baked in', () => {
  const hand = referenceHand();
  const html = toReplayerHtml(hand, replay(hand));

  assert.match(html, /^<!doctype html>/);
  assert.ok(!html.includes('__LIVEHAND_DATA__'), 'the data placeholder was substituted');
  // Nothing may be fetched at open time — it has to work from a downloads folder.
  assert.ok(!/<script[^>]+src=/.test(html), 'no external script');
  assert.ok(!/<link[^>]+stylesheet/.test(html), 'no external stylesheet');
  assert.ok(!/https?:\/\//.test(html.replace(/xmlns="[^"]*"/g, '')), 'no remote references');
  assert.match(html, /"caption":"Hero wins 56\.97 BB"/);
});

test('a hand that ends before showdown still exports', () => {
  const hand = buildHand({
    tableSize: 6, scheme: 'standard', unit: 'bb', sb: 0.5, bb: 1,
    seats: { SB: 100, BB: 100, LJ: 100, HJ: 100, CO: 100, BTN: { stack: 100, cards: 'AcKc' } },
    hero: 'BTN',
    actions: [fold('LJ'), fold('HJ'), fold('CO'), raise('BTN', 3), fold('SB'), fold('BB')],
  });
  const state = replay(hand);
  assert.equal(state.status, 'complete');
  const text = toTextHH(hand, state);
  // The raise nobody called comes back before the pot is awarded.
  assert.match(text, /^Uncalled bet \(2\) returned to BTN$/m);
  assert.match(text, /^BTN collected 2\.5 from pot$/m);
  assert.match(text, /^Total pot 2\.5 \| Rake 0$/m);
  assert.ok(!text.includes('*** FLOP ***'));
  const { frames } = buildFrames(hand, state);
  assert.equal(frames.at(-1).caption, 'Uncalled 2 BB returned to BTN · BTN wins 2.5 BB');
  assert.ok(sceneToSvg(buildGgSheet(hand, state)).length > 500);
  assert.ok(sceneToSvg(buildTableSheet(hand, state)).length > 500);
});
