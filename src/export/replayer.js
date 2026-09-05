/**
 * Export 3 of 3: a standalone replayer.
 *
 * The output is one HTML file with no external references, so it can be
 * emailed, dropped in a Discord, or opened from a phone's downloads folder
 * years later and still work.
 *
 * Every frame is computed here and embedded as data. The file that ships to
 * the viewer therefore contains no poker logic at all — it just paints
 * whatever frame the scrubber is on, which keeps it small and means a replayer
 * can never disagree with the hand it came from.
 */

import { cardStr } from '../core/cards.js';
import { BOARD_LENGTH, STREET_LABEL } from '../core/engine.js';
import { bubbleText, money, titleLine } from '../core/narrate.js';

/**
 * Walk the hand and snapshot the table after every action.
 * @returns {{frames: object[], meta: object}}
 */
export function buildFrames(hand, state) {
  const players = state.players.map((p) => ({
    position: p.position,
    name: p.name,
    isHero: !!p.isHero,
    cards: p.isHero ? (p.cards || []).map(cardStr) : [],
    stack: p.startingStack,
    bet: 0,
    folded: false,
    allIn: false,
    action: null,
  }));
  const find = (position) => players.find((p) => p.position === position);
  const frames = [];
  let collected = 0;

  for (const post of state.posts) {
    const player = find(post.position);
    if (!player) continue;
    player.stack -= post.amount;
    if (post.kind === 'ante') collected += post.amount;
    else player.bet += post.amount;
  }

  const snapshot = (streetId, board, caption, acting) => {
    const pot = collected + players.reduce((sum, p) => sum + p.bet, 0);
    frames.push({
      street: STREET_LABEL[streetId],
      board: board.map(cardStr),
      pot: money(pot, hand, 'bb'),
      caption,
      acting: acting || null,
      players: players.map((p) => ({
        position: p.position,
        name: p.name,
        isHero: p.isHero,
        cards: p.cards,
        stack: money(p.stack, hand, 'bb'),
        bet: p.bet ? money(p.bet, hand, 'bb') : '',
        folded: p.folded,
        allIn: p.allIn,
        action: p.action,
      })),
    });
  };

  snapshot('preflop', [], 'Blinds posted');

  for (const street of state.streets) {
    if (street.id !== 'preflop') {
      collected += players.reduce((sum, p) => sum + p.bet, 0);
      for (const player of players) { player.bet = 0; player.action = null; }
      snapshot(street.id, street.board, `${STREET_LABEL[street.id]}`);
    }
    for (const action of street.actions) {
      const player = find(action.position);
      player.stack = action.stackAfter;
      player.bet = action.to;
      player.folded = action.kind === 'fold';
      player.allIn = !!action.allIn;
      player.action = bubbleText(action, hand);
      snapshot(street.id, street.board, `${player.name} — ${player.action}`, action.position);
    }
  }

  // Final frame: turn everyone's cards over and say who took it.
  const finalBoard = (state.board || []).slice(0, BOARD_LENGTH[state.street] || 5);
  for (const entry of state.showdown || []) {
    const player = find(entry.position);
    if (player && entry.cards.length) player.cards = entry.cards.map(cardStr);
  }
  collected += players.reduce((sum, p) => sum + p.bet, 0);
  for (const player of players) { player.bet = 0; player.action = null; }
  const winners = (state.winners || []).map((w) => {
    const player = find(w.position);
    if (player) player.action = `Wins ${money(w.amount, hand, 'bb')}`;
    return `${player ? player.name : w.position} wins ${money(w.amount, hand, 'bb')}`;
  });
  snapshot(state.street, finalBoard, winners.join(' · ') || 'Hand complete');

  return {
    frames,
    meta: {
      title: titleLine(hand),
      handId: hand.id,
      showdown: (state.showdown || []).map((s) => ({
        name: s.name, cards: s.cards.map(cardStr), hand: s.hand ? s.hand.name : '',
      })),
    },
  };
}

export function toReplayerHtml(hand, state) {
  // \u2028 and \u2029 are line terminators to a JS parser but legal inside a
  // JSON string, so they have to be escaped or the embedded literal breaks.
  const payload = JSON.stringify(buildFrames(hand, state))
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return TEMPLATE.replace('"__LIVEHAND_DATA__"', payload);
}

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LiveHand replayer</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#101014; color:#e8e8ea;
         font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:16px; }
  h1 { font-size:15px; font-weight:700; margin:0 0 12px; color:#c7c7cc; text-align:center; }
  .felt { position:relative; aspect-ratio:5/4; border-radius:22px; background:#212127;
          padding:14px; margin-bottom:12px; }
  .oval { position:absolute; inset:11% 8%; border-radius:50%;
          background:radial-gradient(ellipse at 50% 35%, #2a7350, #1a5138 70%);
          border:6px solid #2b2b30; box-shadow:inset 0 0 40px #0006; }
  .middle { position:absolute; left:50%; top:44%; transform:translate(-50%,-50%);
            display:flex; flex-direction:column; align-items:center; gap:8px; }
  .board { display:flex; gap:5px; min-height:52px; }
  .card { width:36px; height:50px; border-radius:5px; background:#fdfdfb; color:#111;
          display:flex; flex-direction:column; align-items:center; justify-content:center;
          font-weight:700; line-height:1; box-shadow:0 1px 4px #0006; }
  .card .r { font-size:18px; } .card .s { font-size:13px; }
  .card.s { color:#1d1d1f; } .card.h { color:#d0342c; }
  .card.d { color:#2668c9; } .card.c { color:#1f9d55; }
  .pot { font-size:14px; font-weight:700; color:#fde68a; background:#0007;
         padding:3px 12px; border-radius:20px; }
  /* Sized as a fraction of the felt rather than in pixels: the seat ring below
     sits at 36% of the width, which is what a 27%-wide box needs in order to
     stay on the felt however narrow the phone is. */
  .seat { position:absolute; width:27%; min-width:76px; transform:translate(-50%,-50%);
          border-radius:9px; background:#2c2c33; border:1px solid #52525b;
          padding:5px 7px; transition:opacity .15s; }
  .seat.hero { border-color:#4ade80; }
  .seat.acting { border-color:#fbbf24; box-shadow:0 0 0 3px #fbbf2433; }
  .seat.folded { opacity:.38; }
  .seat .top { display:flex; justify-content:space-between; align-items:baseline; gap:6px; }
  .seat .nm { font-size:12px; font-weight:700; white-space:nowrap; overflow:hidden;
              text-overflow:ellipsis; }
  .seat .ps { font-size:10px; font-weight:700; color:#a1a1aa; }
  .seat .st { font-size:12px; color:#7dd3fc; }
  .seat .hole { display:flex; gap:2px; margin-top:3px; }
  .seat .hole .card { width:20px; height:27px; border-radius:3px; }
  .seat .hole .card .r { font-size:11px; } .seat .hole .card .s { font-size:8px; }
  /* The wager rides in the seat rather than out on the felt. Floating chips look
     the part on a desktop client, but on a phone-width table they end up sitting
     on top of the pot or the seat below them at some seat counts. */
  .seat .bet { margin-top:3px; font-size:11px; font-weight:700; color:#fde68a; text-align:center; }
  .seat .act { margin-top:4px; padding:2px 3px; border-radius:6px; font-size:10px; font-weight:700;
         background:#3f3f46; color:#e4e4e7; text-align:center; white-space:nowrap;
         overflow:hidden; text-overflow:ellipsis; }
  .seat.won .act { background:#facc15; color:#3a2c00; }
  .bar { display:flex; align-items:center; gap:6px; margin-bottom:10px; }
  button { flex:1; padding:11px 4px; font-size:15px; font-weight:700; color:#e8e8ea;
           background:#2c2c33; border:1px solid #3f3f46; border-radius:9px; cursor:pointer; }
  button:hover { background:#3a3a42; }
  button:disabled { opacity:.35; cursor:default; }
  .caption { text-align:center; font-size:14px; font-weight:600; min-height:21px; color:#fcd34d;
             margin-bottom:8px; }
  .street { text-align:center; font-size:11px; letter-spacing:.09em; text-transform:uppercase;
            color:#a1a1aa; margin-bottom:6px; }
  input[type=range] { width:100%; accent-color:#4ade80; margin:0 0 10px; }
  .foot { font-size:11px; color:#71717a; text-align:center; margin-top:14px; }
</style>
</head>
<body>
<div class="wrap">
  <h1 id="title"></h1>
  <div class="felt" id="felt"><div class="oval"></div><div class="middle">
    <div class="board" id="board"></div><div class="pot" id="pot"></div>
  </div></div>
  <div class="street" id="street"></div>
  <div class="caption" id="caption"></div>
  <input type="range" id="scrub" min="0" value="0">
  <div class="bar">
    <button id="first" title="First">&#9198;</button>
    <button id="prev" title="Back">&#9664;</button>
    <button id="play" title="Play">&#9654;</button>
    <button id="next" title="Forward">&#9654;&#9654;</button>
    <button id="last" title="Last">&#9199;</button>
  </div>
  <div class="foot">Made with LiveHand</div>
</div>
<script>
(function () {
  var DATA = "__LIVEHAND_DATA__";
  var frames = DATA.frames, meta = DATA.meta;
  var index = 0, timer = null;

  document.getElementById('title').textContent = meta.title;
  var scrub = document.getElementById('scrub');
  scrub.max = String(frames.length - 1);

  function cardEl(code) {
    var el = document.createElement('div');
    el.className = 'card ' + code.charAt(1);
    var glyph = { s: '\\u2660', h: '\\u2665', d: '\\u2666', c: '\\u2663' }[code.charAt(1)];
    el.innerHTML = '<span class="r">' + code.charAt(0) + '</span><span class="s">' + glyph + '</span>';
    return el;
  }

  function render() {
    var frame = frames[index];
    document.getElementById('street').textContent = frame.street;
    document.getElementById('caption').textContent = frame.caption;
    document.getElementById('pot').textContent = 'Pot ' + frame.pot;
    scrub.value = String(index);

    var board = document.getElementById('board');
    board.innerHTML = '';
    frame.board.forEach(function (code) { board.appendChild(cardEl(code)); });

    var felt = document.getElementById('felt');
    Array.prototype.slice.call(felt.querySelectorAll('.seat')).forEach(function (n) {
      n.remove();
    });

    var n = frame.players.length;
    // Hero sits at the bottom; the rest run clockwise from there.
    var heroAt = 0;
    for (var h = 0; h < n; h++) if (frame.players[h].isHero) heroAt = h;

    frame.players.forEach(function (player, i) {
      var slot = (i - heroAt + n) % n;
      var angle = Math.PI / 2 + (slot * 2 * Math.PI) / n;
      var x = 50 + Math.cos(angle) * 36;
      var y = 50 + Math.sin(angle) * 40;

      var seat = document.createElement('div');
      seat.className = 'seat' + (player.isHero ? ' hero' : '') + (player.folded ? ' folded' : '')
        + (frame.acting === player.position ? ' acting' : '')
        + (player.action && player.action.indexOf('Wins') === 0 ? ' won' : '');
      seat.style.left = x + '%';
      seat.style.top = y + '%';
      var hole = '';
      if (player.cards && player.cards.length) {
        hole = '<div class="hole">' + player.cards.map(function (code) {
          var glyph = { s: '\\u2660', h: '\\u2665', d: '\\u2666', c: '\\u2663' }[code.charAt(1)];
          return '<div class="card ' + code.charAt(1) + '"><span class="r">' + code.charAt(0)
            + '</span><span class="s">' + glyph + '</span></div>';
        }).join('') + '</div>';
      }
      // Most seats are named after their position; printing both reads as a stutter.
      var badge = player.name === player.position ? ''
        : '<span class="ps">' + player.position + '</span>';
      seat.innerHTML = '<div class="top"><span class="nm">' + player.name + '</span>' + badge + '</div>'
        + '<div class="st">' + player.stack + (player.allIn ? ' · all-in' : '') + '</div>' + hole
        + (player.bet ? '<div class="bet">' + player.bet + '</div>' : '')
        + (player.action ? '<div class="act">' + player.action + '</div>' : '');
      felt.appendChild(seat);

    });

    document.getElementById('first').disabled = index === 0;
    document.getElementById('prev').disabled = index === 0;
    document.getElementById('next').disabled = index === frames.length - 1;
    document.getElementById('last').disabled = index === frames.length - 1;
  }

  function go(to) {
    index = Math.max(0, Math.min(frames.length - 1, to));
    render();
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    document.getElementById('play').innerHTML = '&#9654;';
  }

  document.getElementById('first').onclick = function () { stop(); go(0); };
  document.getElementById('prev').onclick = function () { stop(); go(index - 1); };
  document.getElementById('next').onclick = function () { stop(); go(index + 1); };
  document.getElementById('last').onclick = function () { stop(); go(frames.length - 1); };
  document.getElementById('play').onclick = function () {
    if (timer) { stop(); return; }
    if (index === frames.length - 1) go(0);
    document.getElementById('play').innerHTML = '&#10073;&#10073;';
    timer = setInterval(function () {
      if (index >= frames.length - 1) { stop(); return; }
      go(index + 1);
    }, 1100);
  };
  scrub.oninput = function () { stop(); go(Number(scrub.value)); };
  document.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowRight') { stop(); go(index + 1); }
    if (event.key === 'ArrowLeft') { stop(); go(index - 1); }
    if (event.key === ' ') { event.preventDefault(); document.getElementById('play').click(); }
  });

  render();
}());
</script>
</body>
</html>`;
