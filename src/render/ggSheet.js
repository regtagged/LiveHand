/**
 * Export 2a of 3: the GG-style share sheet.
 *
 * This is the layout players already recognise from GG's "share hand" button —
 * stacks, then the posts, then one line of action per street with the board
 * above it, then the showdown. Folds are greyed and italic so the eye skips
 * them; the hero is green so you can find yourself instantly.
 */

import { equityByStreet } from '../core/equity.js';
import { STREET_LABEL } from '../core/engine.js';
import { ggPhrase, money, titleLine, postsSummary } from '../core/narrate.js';
import { actionOrder } from '../core/positions.js';
import { Scene, flowRuns, cardRow } from './scene.js';

const INK = '#1d1d1f';
const HERO = '#0a8f28';
const FOLD = '#71717a';
const INFO = '#1a1acc';

const SIZE = 16;
const LINE = SIZE * 1.55;
const CARD = 32;

export function buildGgSheet(hand, state, { width = 760 } = {}) {
  const scene = new Scene({ width, background: '#ffffff', padding: 30 });
  const x = scene.padding;
  const maxWidth = width - scene.padding * 2;
  let y = scene.padding + 20;

  scene.text(x, y, titleLine(hand), { size: 19, weight: 700, fill: INK });
  y += LINE * 1.7;

  // Stacks, in the order the seats act preflop — the order a reader thinks in.
  const order = actionOrder(hand.players.map((p) => p.position), 'preflop', hand.tableSize, hand.scheme);
  for (const position of order) {
    const player = state.players.find((p) => p.position === position);
    if (!player) continue;
    const who = player.name === position ? position : `${player.name} (${position})`;
    const stack = player.unknownStack ? 'unknown stack' : money(player.startingStack, hand, 'bb');
    const text = `${who}: ${stack}`;
    scene.text(x, y, text, {
      size: SIZE, weight: player.isHero ? 700 : 400, fill: player.isHero ? HERO : INK,
    });
    y += LINE;
  }
  y += LINE * 0.6;

  const posts = postsSummary(state, hand);
  const heroPosition = (state.players.find((p) => p.isHero) || {}).position;
  const postRuns = [];
  posts.forEach((part, i) => {
    if (i) postRuns.push({ text: ', ', fill: INK });
    const isHero = part.position && part.position === heroPosition;
    postRuns.push({ text: part.text, fill: isHero ? HERO : INK, weight: isHero ? 700 : 400 });
  });
  if (postRuns.length) y = flowRuns(scene, postRuns, { x, y, maxWidth, size: SIZE }) + LINE * 0.4;

  const hero = state.players.find((p) => p.isHero);
  if (hero && hero.cards.length) {
    scene.text(x, y, `Dealt to ${hero.name}:`, { size: SIZE, weight: 700, fill: HERO });
    y += LINE * 0.5;
    cardRow(scene, hero.cards, { x, y, size: CARD });
    y += CARD * 1.08 + LINE * 1.1;
  }

  for (const street of state.streets) {
    if (street.id !== 'preflop') {
      const label = `${STREET_LABEL[street.id]} (${money(street.potStart, hand, 'bb')}, ${street.playersIn} players):`;
      scene.text(x, y, label, { size: SIZE, weight: 400, fill: INK });
      y += LINE * 0.5;
      // Only the card that just came out, the way the original sheet reads.
      const fresh = street.id === 'flop' ? street.board : street.board.slice(-1);
      cardRow(scene, fresh, { x, y, size: CARD });
      y += CARD * 1.08 + LINE * 0.75;
    }
    if (!street.actions.length) { y += LINE * 0.2; continue; }
    const runs = [];
    street.actions.forEach((action, i) => {
      if (i) runs.push({ text: ', ', fill: INK });
      if (action.kind === 'fold') runs.push({ text: 'fold', fill: FOLD, italic: true });
      else runs.push({
        text: ggPhrase(action, hand),
        fill: action.isHero ? HERO : INK,
        weight: action.isHero ? 700 : 400,
      });
    });
    y = flowRuns(scene, runs, { x, y, maxWidth, size: SIZE }) + LINE * 0.45;
  }

  y = drawShowdown(scene, hand, state, { x, y, maxWidth });

  for (const entry of state.returns || []) {
    scene.text(x, y, `Uncalled bet (${money(entry.amount, hand, 'bb')}) returned to ${entry.name}`, {
      size: SIZE, fill: FOLD,
    });
    y += LINE;
  }

  for (const winner of state.winners || []) {
    const player = state.players.find((p) => p.position === winner.position);
    scene.text(x, y, `${player.name} wins ${money(winner.amount, hand, 'bb')}`, {
      size: SIZE, weight: 700, fill: player.isHero ? HERO : INK,
    });
    y += LINE;
  }

  return scene.finish(y);
}

function drawShowdown(scene, hand, state, { x, y }) {
  const shown = (state.showdown || []).filter((s) => s.cards && s.cards.length === 2);
  if (state.status !== 'showdown' || !shown.length) return y;

  // Equity is only meaningful when every hand at showdown is known.
  const complete = shown.length === (state.showdown || []).length && shown.length >= 2;
  const points = complete ? equityByStreet(shown.map((s) => s.cards), state.board) : [];

  shown.forEach((entry) => {
    scene.text(x, y, `${entry.name} shows:`, {
      size: SIZE, weight: 700, fill: entry.isHero ? HERO : INK,
    });
    y += LINE * 0.5;
    cardRow(scene, entry.cards, { x, y, size: CARD });
    y += CARD * 1.08 + LINE * 0.7;
    if (entry.hand) {
      scene.text(x, y, `(${entry.hand.name})`, { size: SIZE, fill: INFO });
      y += LINE;
    }
    if (points.length) {
      const index = shown.indexOf(entry);
      const text = points.map((p) => `${p.label} ${Math.round(p.values[index])}%`).join(', ');
      scene.text(x, y, `(${text})`, { size: SIZE, fill: INFO });
      y += LINE;
    }
    y += LINE * 0.45;
  });

  return y;
}
