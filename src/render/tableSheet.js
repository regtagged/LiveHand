/**
 * Export 2b of 3: the client-style sheet.
 *
 * The layout poker clients use in their own "share hand" screens — the felt
 * with everyone's seat and the board across the top, then one column per
 * street with the action as chat bubbles underneath. Taller than the GG sheet
 * and slower to read, but it shows the shape of the table, which is what you
 * want when the point of the hand is who was where.
 */

import { cardsStr } from '../core/cards.js';
import { STREET_LABEL } from '../core/engine.js';
import { bubbleText, money, titleLine, isUnfinished, openQuestion } from '../core/narrate.js';
import { seatRing } from '../core/positions.js';
import { Scene, measureText, cardRow, hiddenCardRow } from './scene.js';

const FELT = '#1f5c3d';
const FELT_EDGE = '#123c28';
const RAIL = '#2b2b30';
const INK = '#f4f4f5';
const MUTED = '#a1a1aa';
const PAGE = '#17171b';
const PANEL = '#212127';

const BUBBLE = {
  fold: { fill: '#3f3f46', text: '#a1a1aa' },
  check: { fill: '#334155', text: '#e2e8f0' },
  call: { fill: '#1e4b6e', text: '#dbeafe' },
  bet: { fill: '#7c5410', text: '#fde68a' },
  raise: { fill: '#7c5410', text: '#fde68a' },
  allin: { fill: '#7f1d2b', text: '#fecdd3' },
};

export function buildTableSheet(hand, state, { width = 840 } = {}) {
  const scene = new Scene({ width, background: PAGE, padding: 24 });
  const pad = scene.padding;
  let y = pad + 20;

  scene.text(width / 2, y, titleLine(hand), { size: 17, weight: 700, fill: INK, anchor: 'middle' });
  y += 26;

  y = drawTable(scene, hand, state, { y, width, pad });
  y += 18;
  y = drawStreetColumns(scene, hand, state, { y, width, pad });

  const summary = summaryLine(hand, state);
  if (summary) {
    scene.text(width / 2, y + 18, summary, {
      size: 15, weight: 700, fill: isUnfinished(state) ? '#fcd34d' : '#86efac', anchor: 'middle',
    });
    y += 30;
  }

  return scene.finish(y);
}

/**
 * Every seat at the table, not just the ones the hand names.
 *
 * A hand shared as "CO opens, I call in the BB" is still played at an eight
 * handed table, and drawing it as a three handed one misreads the spot. Seats
 * nobody entered a stack for are drawn empty, so the picture shows the table
 * that was actually there.
 */
function seatList(hand, state) {
  const seated = new Map(state.players.map((player) => [player.position, player]));
  return seatRing(hand.tableSize, hand.scheme).map(
    (position) => seated.get(position) || { position, name: position, cards: [], empty: true },
  );
}

function drawTable(scene, hand, state, { y, width, pad }) {
  const players = orderedFromHero(seatList(hand, state));
  const boxW = players.length > 7 ? 112 : 128;
  const boxH = 50;
  const height = players.length > 6 ? 344 : 300;
  const cx = width / 2;
  const cy = y + height / 2;

  // Seat centres ride a ring sized so the boxes stay inside the panel. The felt
  // fills almost that whole ring, so seats sit on the rail the way they do in a
  // real client; what keeps them off the cards is sizing the board to the gap
  // between the middle and the nearest seat's inner edge, below.
  const ringX = (width - pad * 2) / 2 - boxW / 2 - 4;
  const ringY = height / 2 - boxH / 2 - 4;
  const feltRx = ringX * 0.94;
  const feltRy = ringY * 0.92;
  const clearHalfWidth = ringX - boxW / 2 - 14;

  scene.rect(pad, y, width - pad * 2, height, { rx: 18, fill: PANEL });
  scene.ellipse(cx, cy, feltRx + 12, feltRy + 12, { fill: RAIL });
  scene.ellipse(cx, cy, feltRx, feltRy, { fill: FELT, stroke: FELT_EDGE, strokeWidth: 3 });

  const board = state.board || [];
  if (board.length) {
    const gap = 6;
    const cardW = Math.max(22, Math.min(42,
      Math.floor((clearHalfWidth * 2 - (board.length - 1) * gap) / board.length)));
    const totalW = board.length * cardW + (board.length - 1) * gap;
    cardRow(scene, board, { x: cx - totalW / 2, y: cy - cardW * 0.95, size: cardW, gap, variant: 'face' });
  }
  scene.text(cx, cy + feltRy * 0.55, `Pot ${money(state.pot, hand, 'bb')}`, {
    size: 16, weight: 700, fill: '#fde68a', anchor: 'middle',
  });

  players.forEach((player, i) => {
    // Hero sits at the bottom of the oval; everyone else follows round from there.
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / players.length;
    const px = cx + Math.cos(angle) * ringX;
    const py = cy + Math.sin(angle) * ringY;
    drawSeat(scene, hand, state, player, { x: px - boxW / 2, y: py - boxH / 2, w: boxW, h: boxH });
  });

  return y + height;
}

function drawSeat(scene, hand, state, player, { x, y, w, h }) {
  if (player.empty) {
    scene.rect(x, y, w, h, { rx: 9, fill: '#191920', stroke: '#33333c', strokeWidth: 1 });
    scene.text(x + 9, y + 19, player.position, { size: 13, weight: 700, fill: '#57575f' });
    scene.text(x + 9, y + 37, 'no stack', { size: 12, fill: '#3f3f47' });
    return;
  }

  const won = (state.winners || []).some((entry) => entry.position === player.position);
  const border = won ? '#facc15' : player.isHero ? '#4ade80' : '#52525b';
  scene.rect(x, y, w, h, {
    rx: 9,
    fill: player.folded ? '#1c1c21' : '#2c2c33',
    stroke: border,
    strokeWidth: won || player.isHero ? 2 : 1,
  });

  const nameColor = player.folded ? '#71717a' : INK;
  // Seats are usually just called by their position; only print it twice when
  // the player actually has a name.
  const named = player.name !== player.position;
  scene.text(x + 9, y + 19, truncate(player.name, w - (named ? 52 : 18), 13), {
    size: 13, weight: 700, fill: nameColor,
  });
  if (named) {
    scene.text(x + w - 9, y + 19, player.position, { size: 11, weight: 700, fill: MUTED, anchor: 'end' });
  }
  scene.text(x + 9, y + 37, player.unknownStack ? '—' : money(player.stack, hand, 'bb'), {
    size: 13, fill: player.unknownStack ? '#57575f' : player.folded ? '#52525b' : '#7dd3fc',
  });

  const size = 18;
  const cardsX = x + w - size * 2 - 15;
  if (player.isHero && hand.hideHeroCards) {
    hiddenCardRow(scene, 2, { x: cardsX, y: y + 26, size, gap: 3, variant: 'face' });
  } else if (player.cards && player.cards.length === 2) {
    cardRow(scene, player.cards, { x: cardsX, y: y + 26, size, gap: 3, variant: 'face' });
  }
}

function drawStreetColumns(scene, hand, state, { y, width, pad }) {
  const streets = state.streets.filter((s) => s.actions.length);
  if (!streets.length) return y;

  const gap = 10;
  const columnW = (width - pad * 2 - gap * (streets.length - 1)) / streets.length;
  const headerH = 34;
  const bubbleH = 42;
  const bubbleGap = 6;
  const rows = Math.max(...streets.map((s) => s.actions.length));
  const bodyH = rows * (bubbleH + bubbleGap) + 8;

  streets.forEach((street, index) => {
    const x = pad + index * (columnW + gap);
    scene.rect(x, y, columnW, headerH, { rx: 8, fill: '#2a2a31' });
    scene.text(x + columnW / 2, y + 22, STREET_LABEL[street.id], {
      size: 13, weight: 700, fill: '#fde68a', anchor: 'middle',
    });
    scene.rect(x, y + headerH + 4, columnW, bodyH, { rx: 8, fill: PANEL });

    if (street.id !== 'preflop' && street.board.length) {
      scene.text(x + columnW / 2, y + headerH + 22, cardsStr(street.board.slice(-1)), {
        size: 12, fill: MUTED, anchor: 'middle',
      });
    }

    street.actions.forEach((action, row) => {
      const by = y + headerH + 12 + row * (bubbleH + bubbleGap);
      const style = action.allIn ? BUBBLE.allin : BUBBLE[action.kind] || BUBBLE.check;
      scene.rect(x + 8, by, columnW - 16, bubbleH, { rx: 7, fill: style.fill });
      const label = action.name === action.position ? action.position : `${action.name} · ${action.position}`;
      scene.text(x + 16, by + 17, truncate(label, columnW - 32, 11), {
        size: 11, weight: 700, fill: action.isHero ? '#86efac' : MUTED,
      });
      scene.text(x + 16, by + 33, truncate(bubbleText(action, hand), columnW - 32, 13), {
        size: 13, weight: 700, fill: style.text,
      });
    });
  });

  return y + headerH + 4 + bodyH;
}

function summaryLine(hand, state) {
  if (isUnfinished(state)) return openQuestion(state, hand);
  if (!state.winners || !state.winners.length) return '';
  return state.winners
    .map((winner) => {
      const player = state.players.find((p) => p.position === winner.position);
      return `${player.name} wins ${money(winner.amount, hand, 'bb')}`;
    })
    .join('   ·   ');
}

/** Hero first, then round the table in seat order. */
function orderedFromHero(players) {
  const heroIndex = players.findIndex((p) => p.isHero);
  if (heroIndex < 0) return players;
  if (heroIndex <= 0) return players;
  return [...players.slice(heroIndex), ...players.slice(0, heroIndex)];
}

function truncate(text, maxWidth, size) {
  let out = String(text);
  if (measureText(out, size, 700) <= maxWidth) return out;
  while (out.length > 1 && measureText(`${out}…`, size, 700) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}
