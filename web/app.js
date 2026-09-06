/**
 * The UI.
 *
 * Deliberately framework-free and re-rendered wholesale: the hand is small,
 * `replay()` is cheap, and every screen is a pure function of one plain object.
 * That means there is no separate UI state to drift out of step with the hand —
 * the action bar offers exactly what the engine says is legal, and nothing else.
 */

import { parseAmount, fmtAmount, toUnits, fromUnits, toBb } from './src/core/amount.js';
import { RANKS, SUITS, SUIT_GLYPH, SUIT_NAME, cardStr, sameCard } from './src/core/cards.js';
import { replay, sizeToTotal, withAction, withoutLastAction, STREET_LABEL, BOARD_LENGTH } from './src/core/engine.js';
import {
  createHand, resizeTable, togglePlayer, setHero, updatePlayer, validateSetup,
  usedCards, reviveHand, nextHand, anteAmount,
} from './src/core/hand.js';
import { money, stakesLabel } from './src/core/narrate.js';
import { seatRing } from './src/core/positions.js';
import { buildGgSheet } from './src/render/ggSheet.js';
import { buildTableSheet } from './src/render/tableSheet.js';
import { sceneToSvg } from './src/render/svg.js';
import { toTextHH } from './src/export/textHH.js';
import { toReplayerHtml } from './src/export/replayer.js';
import { sceneToCanvas, canvasToBlob } from './canvas.js';
import * as store from './store.js';

const view = document.getElementById('view');
const sheet = document.getElementById('sheet');

const app = {
  hand: reviveHand(store.loadDraft()) || createHand(),
  step: 0,
  ui: { sizeMode: 'pct', sizeValue: '', exportTab: 'text', showNames: false, picker: null },
};

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const unitLabel = () => (app.hand.unit === 'bb' ? 'BB' : 'chips');
/** Most seats are just called by their position; only say it twice if it isn't. */
const who = (player) => (player.name === player.position ? player.position : `${player.name} · ${player.position}`);
const showAmount = (units) => money(units, app.hand, 'native');

/** The engine's view of the hand right now — recomputed on every render. */
function currentState() {
  return replay(app.hand);
}

function setHand(next, { keepDraft = true } = {}) {
  app.hand = next;
  if (keepDraft) store.saveDraft(next);
  render();
}

function toast(message) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 1900);
}

/* ------------------------------------------------------------------ cards */

function cardHtml(card, small = false) {
  if (!card) return `<span class="cardface ${small ? 'small ' : ''}empty"></span>`;
  return `<span class="cardface ${small ? 'small ' : ''}suit-${card.suit}">`
    + `<span class="r">${card.rank}</span><span class="s">${SUIT_GLYPH[card.suit]}</span></span>`;
}

function cardSlots(cards, count, action, extra = '') {
  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push(`<button data-act="${action}" data-index="${i}" ${extra}>${cardHtml(cards[i])}</button>`);
  }
  return `<div class="cardslots">${slots.join('')}</div>`;
}

/**
 * The card picker: the whole deck, four rows of thirteen, coloured the way a
 * four-colour deck is. Picking a suit first was a mode to be in and a tap to
 * spend; every card is now one tap, which matters when the flop needs three.
 *
 * `onPick` receives all the cards at once, so the sheet stays open until
 * `count` of them have been chosen.
 */
function openPicker({ title, count, taken, onPick }) {
  app.ui.picker = { title, count, taken, onPick, chosen: [] };
  renderPicker();
}

function renderPicker() {
  const picker = app.ui.picker;
  if (!picker) { sheet.hidden = true; return; }
  const blocked = [...picker.taken, ...picker.chosen];
  document.getElementById('sheet-title').textContent =
    picker.count > 1 ? `${picker.title} (${picker.chosen.length}/${picker.count})` : picker.title;

  const ranks = RANKS.slice().reverse();
  document.getElementById('sheet-body').innerHTML = `
    <div class="deck">
      ${SUITS.map((suit) => ranks.map((rank) => {
        const used = blocked.some((c) => sameCard(c, { rank, suit }));
        return `<button class="deck-card suit-bg-${suit}" data-act="pick-card"
          data-rank="${rank}" data-suit="${suit}" ${used ? 'disabled' : ''}
          aria-label="${rank} of ${SUIT_NAME[suit]}"><b>${rank}</b><i>${SUIT_GLYPH[suit]}</i></button>`;
      }).join('')).join('')}
    </div>
    ${picker.chosen.length
      ? `<p class="hint">Picked ${picker.chosen.map(cardStr).join(' ')}</p>`
      : ''}`;
  sheet.hidden = false;
}

function closeSheet() {
  app.ui.picker = null;
  sheet.hidden = true;
}

/* ------------------------------------------------------------- step 1: session */

function renderSession() {
  const hand = app.hand;
  const sessions = store.recentSessions();
  return `
  <div class="card">
    <h2>Session</h2>
    <div class="field">
      <label for="tournament">Tournament or game <span class="opt">optional</span></label>
      <input id="tournament" type="text" data-field="tournament" list="recent-sessions"
             value="${esc(hand.tournament)}" placeholder="e.g. Bounty Hunters HR" autocomplete="off">
      <datalist id="recent-sessions">
        ${sessions.map((s) => `<option value="${esc(s.tournament)}"></option>`).join('')}
      </datalist>
    </div>
    ${sessions.length ? `<div class="presets">
      ${sessions.slice(0, 4).map((s, i) => `<button data-act="load-session" data-index="${i}">
        <b>${esc(s.tournament)}</b><i>${esc(sessionBlurb(s))}</i></button>`).join('')}
    </div><p class="hint">Tap a recent session to reuse its blinds and table size.</p>` : ''}
    <div class="field" style="margin-top:12px">
      <label for="level">Level or notes (optional)</label>
      <input id="level" type="text" data-field="level" value="${esc(hand.level)}" placeholder="e.g. XI">
    </div>
  </div>

  <div class="card">
    <h2>Stakes</h2>
    <div class="field">
      <label>Enter every amount in</label>
      <div class="segment">
        <button data-act="unit" data-value="bb" aria-pressed="${hand.unit === 'bb'}">Big blinds</button>
        <button data-act="unit" data-value="chips" aria-pressed="${hand.unit === 'chips'}">Chips</button>
      </div>
      <p class="hint">${hand.unit === 'bb'
        ? 'Stacks and bets are typed as big blinds — 27.6, 12.5, and so on.'
        : 'Typing chips means the blinds and ante below are needed to work out stack depths.'}</p>
    </div>
    <div class="row">
      <div class="field"><label for="sb">Small blind</label>
        <input id="sb" type="text" inputmode="decimal" data-field="sb" value="${amountValue(hand.sb)}"></div>
      <div class="field"><label for="bb">Big blind</label>
        <input id="bb" type="text" inputmode="decimal" data-field="bb" value="${amountValue(hand.bb)}"></div>
    </div>
    <div class="field">
      <label>Ante</label>
      <div class="segment">
        <button data-act="ante-mode" data-value="none" aria-pressed="${hand.anteMode === 'none'}">None</button>
        <button data-act="ante-mode" data-value="each" aria-pressed="${hand.anteMode === 'each'}">Every player</button>
        <button data-act="ante-mode" data-value="bb" aria-pressed="${hand.anteMode === 'bb'}">Big blind ante</button>
      </div>
    </div>
    ${hand.anteMode === 'each' ? `<div class="field">
      <label for="ante">Ante size (${unitLabel()})</label>
      <input id="ante" type="text" inputmode="decimal" data-field="ante" value="${amountValue(hand.ante)}">
    </div>` : ''}
    ${hand.anteMode === 'bb' ? `<p class="hint">A big blind ante is one big blind
      — ${esc(showAmount(anteAmount(hand)))} — posted by the big blind, so there is nothing to enter.</p>` : ''}
  </div>

  <button class="primary" data-act="goto" data-step="1">Next: the table</button>`;
}

function sessionBlurb(session) {
  const unit = session.unit === 'bb' ? '' : ' chips';
  return `${fmtAmount(session.sb, session.unit)}/${fmtAmount(session.bb, session.unit)}${unit} · ${session.tableSize}-max`;
}

const amountValue = (units) => (units ? String(fromUnits(units)) : '');

/* --------------------------------------------------------------- step 2: table */

function renderTable() {
  const hand = app.hand;
  const ring = seatRing(hand.tableSize, hand.scheme);
  const included = new Set(hand.players.map((p) => p.position));
  const hero = hand.players.find((p) => p.isHero);
  const problems = validateSetup(hand);

  return `
  <div class="card">
    <h2>Table</h2>
    <div class="field"><label for="seats">Seats at the table</label>
      <select id="seats" data-field="tableSize">
        ${Array.from({ length: 9 }, (_, i) => i + 2).map((n) => `<option value="${n}"
          ${n === hand.tableSize ? 'selected' : ''}>${n}-max</option>`).join('')}
      </select></div>
  </div>

  <div class="card">
    <h2>Seats and stacks <button class="ghost" data-act="toggle-names" style="float:right;margin-top:-4px">
      ${app.ui.showNames ? 'Hide names' : 'Names'}</button></h2>
    <p class="hint" style="margin:0 0 10px">Switch on the seats that were in the hand and enter their
      stacks in ${unitLabel()}, as they were when it started. The blinds are always in.</p>
    <div class="seatgrid">
      ${ring.map((position) => {
        const player = hand.players.find((p) => p.position === position);
        const on = included.has(position);
        const locked = position === 'SB' || position === 'BB';
        return `<div class="seat-row ${on ? '' : 'off'} ${player && player.isHero ? 'hero' : ''}">
          <button class="toggle" data-act="toggle-seat" data-pos="${position}" aria-pressed="${on}"
            ${locked ? 'disabled title="Blinds always post"' : ''}>${on ? '&#10003;' : '&#43;'}</button>
          <span class="pos">${position}</span>
          <input type="text" inputmode="decimal" data-stack="${position}" ${on ? '' : 'disabled'}
            value="${player ? amountValue(player.stack) : ''}" placeholder="stack">
          <button class="herobtn" data-act="set-hero" data-pos="${position}"
            aria-pressed="${!!(player && player.isHero)}" ${on ? '' : 'disabled'}>YOU</button>
        </div>
        ${app.ui.showNames && on ? `<div class="seat-row">
          <span class="pos">${position}</span>
          <input type="text" data-name="${position}" value="${esc(player.name)}" placeholder="name">
        </div>` : ''}`;
      }).join('')}
    </div>
  </div>

  <div class="card">
    <h2>Your cards</h2>
    <p class="hint" style="margin:0 0 10px">${hero
      ? `Dealt to ${esc(hero.name === hero.position ? hero.position : `${hero.name} (${hero.position})`)}`
      : 'Pick your seat first'}</p>
    ${hero ? cardSlots(hero.cards, 2, 'pick-hero') : ''}
  </div>

  ${problems.length ? `<div class="problems"><strong>Before you start:</strong>
    <ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}

  <button class="primary" data-act="goto" data-step="2" ${problems.length ? 'disabled' : ''}>
    Start the hand</button>`;
}

/* -------------------------------------------------------------- step 3: action */

function renderAction() {
  const hand = app.hand;
  const state = currentState();
  const visibleBoard = (hand.board || []).slice(0, BOARD_LENGTH[state.street] || 0);

  return `
  <div class="felt">
    <div class="streetname">${STREET_LABEL[state.street] || 'Preflop'}</div>
    <div class="board">
      ${visibleBoard.length
        ? visibleBoard.map((card, i) => `<button data-act="edit-board" data-index="${i}"
            style="background:none;border:0;padding:0;cursor:pointer">${cardHtml(card)}</button>`).join('')
        : '<span class="hint">no board yet</span>'}
    </div>
    <div class="pot">Pot ${showAmount(state.pot)} ${unitLabel() === 'BB' ? 'BB' : ''}</div>
  </div>

  <div class="strip">
    ${state.players.map((player) => playerCard(player, state)).join('')}
  </div>

  ${renderLog(state)}
  ${renderActionBar(state)}`;
}

function playerCard(player, state) {
  const acting = state.toAct === player.position;
  const last = lastActionFor(state, player.position);
  const depth = app.hand.unit === 'chips' && app.hand.bb
    ? `${fmtAmount(toBb(player.stack, app.hand.bb), 'bb')} BB` : '';
  return `<div class="pcard ${player.folded ? 'folded' : ''} ${player.isHero ? 'hero' : ''} ${acting ? 'acting' : ''}">
    <div class="pos">${player.position}${player.isHero ? ' · you' : ''}</div>
    <div class="nm">${esc(player.name === player.position ? (depth || ' ') : player.name)}</div>
    <div class="stack">${showAmount(player.stack)}${player.allIn ? ' · AI' : ''}</div>
    <div class="bet">${player.streetCommit ? showAmount(player.streetCommit) : ' '}</div>
    <div class="did">${last ? esc(last) : ' '}</div>
    ${player.cards && player.cards.length
      ? `<div class="hole">${player.cards.map((c) => cardHtml(c, true)).join('')}</div>` : ''}
  </div>`;
}

function lastActionFor(state, position) {
  for (let s = state.streets.length - 1; s >= 0; s--) {
    const street = state.streets[s];
    for (let i = street.actions.length - 1; i >= 0; i--) {
      if (street.actions[i].position === position) {
        const action = street.actions[i];
        if (action.kind === 'fold') return 'folded';
        if (action.kind === 'check') return 'checked';
        return `${action.kind} ${showAmount(action.to)}`;
      }
    }
  }
  return '';
}

function renderLog(state) {
  const rows = [];
  for (const street of state.streets) {
    if (!street.actions.length && street.id === 'preflop') continue;
    if (street.id !== 'preflop') {
      rows.push(`<li class="streetmark">${STREET_LABEL[street.id]} · pot ${showAmount(street.potStart)}</li>`);
    }
    for (const action of street.actions) {
      rows.push(`<li class="${action.isHero ? 'hero' : ''}"><b>${esc(action.name)}</b> ${describe(action)}</li>`);
    }
  }
  const canUndo = (app.hand.actions || []).length > 0 || (app.hand.board || []).length > 0;
  return `<div class="log">
    <h3>Action ${canUndo ? '<button class="ghost" data-act="undo" style="float:right;margin-top:-4px">Undo</button>' : ''}</h3>
    <ol>${rows.length ? rows.join('') : '<li>Nothing yet — the blinds are posted.</li>'}</ol>
  </div>`;
}

function describe(action) {
  if (action.kind === 'fold') return 'folds';
  if (action.kind === 'check') return 'checks';
  if (action.kind === 'call') return `calls ${showAmount(action.added)}${action.allIn ? ' (all-in)' : ''}`;
  if (action.kind === 'bet') return `bets ${showAmount(action.to)}${action.allIn ? ' (all-in)' : ''}`;
  return `raises to ${showAmount(action.to)}${action.allIn ? ' (all-in)' : ''}`;
}

function renderActionBar(state) {
  if (state.status === 'awaiting-board') {
    const street = state.needsBoardFor;
    const need = BOARD_LENGTH[street] - (app.hand.board || []).length;
    return `<div class="actionbar">
      <div class="who"><b>${STREET_LABEL[street]}</b><span>pot ${showAmount(state.pot)}</span></div>
      <button class="primary" data-act="deal" data-street="${street}">
        Deal the ${street} (${need} card${need > 1 ? 's' : ''})</button>
    </div>`;
  }

  if (state.status === 'showdown' || state.status === 'complete') {
    return renderFinishBar(state);
  }

  const legal = state.legal;
  const player = state.players.find((p) => p.position === state.toAct);
  const callLabel = legal.canCheck ? 'Check' : `Call ${showAmount(legal.toCall)}${legal.callIsAllIn ? ' (all-in)' : ''}`;
  const aggroWord = legal.isRaise ? 'Raise to' : 'Bet';

  return `<div class="actionbar">
    <div class="who">
      <b>${esc(who(player))}${player.isHero ? ' · you' : ''}</b>
      <span>${showAmount(player.stack)} behind${legal.toCall ? ` · ${showAmount(legal.toCall)} to call` : ''}</span>
    </div>
    <div class="verbs">
      <button class="fold" data-act="act" data-kind="fold">Fold</button>
      <button class="${legal.canCheck ? 'check' : ''}" data-act="act"
        data-kind="${legal.canCheck ? 'check' : 'call'}">${callLabel}</button>
    </div>
    <div class="sizer">
      <div class="presets">
        ${presetButtons(legal).join('')}
      </div>
      <div class="sizerow">
        <input type="text" inputmode="decimal" id="sizeinput" data-field="size"
               value="${esc(app.ui.sizeValue)}" placeholder="${aggroWord.toLowerCase()}…">
        <div class="segment">
          <button data-act="size-mode" data-value="pct" aria-pressed="${app.ui.sizeMode === 'pct'}">%</button>
          <button data-act="size-mode" data-value="bb" aria-pressed="${app.ui.sizeMode === 'bb'}">BB</button>
          <button data-act="size-mode" data-value="amount"
            aria-pressed="${app.ui.sizeMode === 'amount'}">${unitLabel() === 'BB' ? 'Total' : 'Chips'}</button>
        </div>
      </div>
      ${sizeMeta(legal)}
    </div>
  </div>`;
}

/**
 * Preset sizings, each labelled with the amount it actually works out to.
 * A percentage is of the pot *after* calling, which is how every solver and
 * every player means it.
 */
function presetButtons(legal) {
  const hand = app.hand;
  const buttons = [];
  const minLabel = legal.isRaise ? 'Min' : 'Min';
  buttons.push(`<button data-act="size-apply" data-mode="amount" data-value="${fromUnits(legal.minTo)}">
    <b>${minLabel}</b><i>${showAmount(legal.minTo)}</i></button>`);

  for (const pct of [33, 50, 75, 100]) {
    const total = sizeToTotal(legal, 'pct', pct, hand);
    if (total <= legal.minTo || total >= legal.maxTo) continue;
    buttons.push(`<button data-act="size-apply" data-mode="amount" data-value="${fromUnits(total)}">
      <b>${pct}%</b><i>${showAmount(total)}</i></button>`);
  }

  buttons.push(`<button class="allin" data-act="size-apply" data-mode="amount" data-value="${fromUnits(legal.maxTo)}">
    <b>All-in</b><i>${showAmount(legal.maxTo)}</i></button>`);
  return buttons;
}

function sizeMeta(legal) {
  const raw = parseFloat(app.ui.sizeValue);
  if (!Number.isFinite(raw)) {
    return `<div class="sizemeta"><span>Min ${showAmount(legal.minTo)}</span>
      <span>Max ${showAmount(legal.maxTo)}</span></div>`;
  }
  const total = sizeToTotal(legal, app.ui.sizeMode, raw, app.hand);
  const wanted = app.ui.sizeMode === 'pct'
    ? total
    : Math.round(app.ui.sizeMode === 'bb' ? raw * app.hand.bb : toUnits(raw));
  // The engine would cap this anyway; saying so up front is less surprising.
  const capped = wanted > legal.maxTo;
  return `<div class="sizemeta">
    <span class="${capped ? 'over' : ''}">${capped
      ? `Only ${showAmount(legal.maxTo)} behind — capped`
      : `${legal.isRaise ? 'Raise to' : 'Bet'} ${showAmount(total)}`}</span>
    <button class="ghost" data-act="size-confirm">Confirm</button>
  </div>`;
}

function renderFinishBar(state) {
  const live = state.players.filter((p) => !p.folded);
  const missing = live.filter((p) => !p.cards || p.cards.length !== 2);

  if (state.needsWinner) {
    return `<div class="actionbar">
      <div class="who"><b>Showdown</b><span>pot ${showAmount(state.pot)}</span></div>
      <p class="hint" style="margin:0 0 8px">Add the cards that were shown, or just tap who won.</p>
      <div class="presets">
        ${live.map((p) => `<button data-act="set-cards" data-pos="${p.position}">
          <b>${esc(p.name)}</b><i>${p.cards && p.cards.length ? p.cards.map(cardStr).join(' ') : 'add cards'}</i>
        </button>`).join('')}
      </div>
      <div class="presets">
        ${live.map((p) => `<button data-act="set-winner" data-pos="${p.position}">
          <b>${esc(p.name)} won</b><i>${p.position}</i></button>`).join('')}
      </div>
    </div>`;
  }

  const summary = (state.winners || [])
    .map((w) => `${state.players.find((p) => p.position === w.position).name} wins ${showAmount(w.amount)}`)
    .join(' · ');

  return `<div class="actionbar">
    <div class="who"><b>Hand complete</b><span>${esc(summary)}</span></div>
    ${missing.length && state.status === 'showdown' ? `<div class="presets">
      ${missing.map((p) => `<button data-act="set-cards" data-pos="${p.position}">
        <b>${esc(p.name)}</b><i>add shown cards</i></button>`).join('')}
    </div>` : ''}
    <button class="primary" data-act="goto" data-step="3">Export this hand</button>
  </div>`;
}

/* -------------------------------------------------------------- step 4: export */

const EXPORT_TABS = [
  ['text', 'Text'],
  ['gg', 'HH View'],
  ['table', 'Table View'],
  ['replayer', 'Replayer'],
];

function renderExport() {
  const hand = app.hand;
  const state = currentState();
  const tab = app.ui.exportTab;
  let body = '';

  if (tab === 'text') {
    body = `<pre>${esc(toTextHH(hand, state))}</pre>`;
  } else if (tab === 'gg' || tab === 'table') {
    body = sceneToSvg(buildScene(tab, hand, state));
  } else {
    const html = toReplayerHtml(hand, state);
    body = `<iframe title="Replayer preview" srcdoc="${esc(html)}"></iframe>`;
  }

  return `
  <div class="tabs">
    ${EXPORT_TABS.map(([id, label]) => `<button data-act="export-tab" data-value="${id}"
      aria-pressed="${tab === id}">${label}</button>`).join('')}
  </div>
  <div class="preview">${body}</div>
  <div class="exportbtns">
    ${tab === 'text'
      ? '<button class="secondary" data-act="copy-text">Copy text</button>'
      : '<button class="secondary" data-act="download">Download</button>'}
    <button class="secondary" data-act="share">Share</button>
  </div>
  <div class="card" style="margin-top:14px">
    <h2>Notes</h2>
    <textarea data-field="note" placeholder="What was the question?">${esc(hand.note || '')}</textarea>
    <div class="exportbtns">
      <button class="secondary" data-act="save-hand">Save to this device</button>
      <button class="secondary" data-act="restart">New hand</button>
    </div>
  </div>`;
}

function buildScene(kind, hand, state) {
  const width = Math.min(880, Math.max(560, Math.floor(window.innerWidth * 1.4)));
  return kind === 'gg' ? buildGgSheet(hand, state, { width }) : buildTableSheet(hand, state, { width });
}

async function currentExport() {
  const hand = app.hand;
  const state = currentState();
  const slug = (hand.tournament || 'hand').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const stem = `livehand-${slug || 'hand'}-${hand.id}`;

  if (app.ui.exportTab === 'text') {
    return { blob: new Blob([toTextHH(hand, state)], { type: 'text/plain' }), name: `${stem}.txt` };
  }
  if (app.ui.exportTab === 'replayer') {
    return { blob: new Blob([toReplayerHtml(hand, state)], { type: 'text/html' }), name: `${stem}-replayer.html` };
  }
  const scene = buildScene(app.ui.exportTab, hand, state);
  const blob = await canvasToBlob(sceneToCanvas(scene, 2));
  return { blob, name: `${stem}-${app.ui.exportTab}.png` };
}

async function downloadCurrent() {
  const { blob, name } = await currentExport();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Saved ${name}`);
}

async function shareCurrent() {
  const { blob, name } = await currentExport();
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'LiveHand' });
      return;
    } catch {
      return; // the user dismissed the share sheet
    }
  }
  if (app.ui.exportTab === 'text') {
    await copyText();
    return;
  }
  await downloadCurrent();
}

async function copyText() {
  const text = toTextHH(app.hand, currentState());
  try {
    await navigator.clipboard.writeText(text);
    toast('Hand history copied');
  } catch {
    toast('Copy blocked — long-press the text to select it');
  }
}

/* ------------------------------------------------------------------- shell */

const STEP_TITLES = ['New hand', 'The table', 'Play the hand', 'Export'];

function render() {
  const hand = app.hand;
  document.getElementById('crumb-title').textContent = STEP_TITLES[app.step];
  document.getElementById('crumb-sub').textContent = hand.tournament
    ? `${hand.tournament} · ${stakesLabel(hand)}` : stakesLabel(hand);
  document.querySelector('.back').hidden = app.step === 0;

  const problems = validateSetup(hand);
  for (const button of document.querySelectorAll('.steps button')) {
    const step = Number(button.dataset.step);
    button.setAttribute('aria-current', String(step === app.step));
    button.disabled = step >= 2 && problems.length > 0;
  }

  view.innerHTML = [renderSession, renderTable, renderAction, renderExport][app.step]();
  window.scrollTo({ top: 0 });
  // Keep whoever is to act on screen — with ten seats the strip is wider than
  // the phone, and the player you need is often the one scrolled off it.
  const acting = view.querySelector('.pcard.acting') || view.querySelector('.pcard.hero');
  if (acting) acting.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function goto(step) {
  const problems = validateSetup(app.hand);
  if (step >= 2 && problems.length) { toast(problems[0]); return; }
  if (step >= 1 && app.hand.tournament) store.rememberSession(app.hand);
  app.step = step;
  render();
}

/* ------------------------------------------------------------------ events */

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-act], [data-step]');
  if (!target) return;
  const act = target.dataset.act;

  if (target.matches('.steps button')) { goto(Number(target.dataset.step)); return; }

  switch (act) {
    case 'goto': goto(Number(target.dataset.step)); break;
    case 'back': goto(Math.max(0, app.step - 1)); break;
    case 'restart': restart(); break;
    case 'close-sheet': closeSheet(); break;

    case 'unit': changeUnit(target.dataset.value); break;
    case 'ante-mode': setHand({ ...app.hand, anteMode: target.dataset.value }); break;
    case 'load-session': loadSession(Number(target.dataset.index)); break;

    case 'toggle-names': app.ui.showNames = !app.ui.showNames; render(); break;
    case 'toggle-seat': {
      const position = target.dataset.pos;
      const on = app.hand.players.some((p) => p.position === position);
      setHand(togglePlayer(app.hand, position, !on));
      break;
    }
    case 'set-hero': setHand(setHero(app.hand, target.dataset.pos)); break;
    case 'pick-hero': pickHoleCards(app.hand.players.find((p) => p.isHero).position, Number(target.dataset.index)); break;
    case 'set-cards': pickHoleCards(target.dataset.pos, 0); break;

    case 'pick-card': choosePickerCard(target.dataset.rank, target.dataset.suit); break;

    case 'deal': dealBoard(target.dataset.street); break;
    case 'edit-board': editBoardCard(Number(target.dataset.index)); break;
    case 'undo': undo(); break;
    case 'act': applyAction(target.dataset.kind); break;
    case 'size-apply': applySize(target.dataset.mode, Number(target.dataset.value)); break;
    case 'size-mode': app.ui.sizeMode = target.dataset.value; render(); focusSize(); break;
    case 'size-confirm': confirmSize(); break;
    case 'set-winner': setHand({ ...app.hand, winners: [target.dataset.pos] }); break;

    case 'export-tab': app.ui.exportTab = target.dataset.value; render(); break;
    case 'copy-text': copyText(); break;
    case 'download': downloadCurrent(); break;
    case 'share': shareCurrent(); break;
    case 'save-hand': store.saveHand(app.hand); toast('Hand saved on this device'); break;
    default: break;
  }
});

sheet.addEventListener('click', (event) => { if (event.target === sheet) closeSheet(); });

document.addEventListener('input', (event) => {
  const field = event.target.dataset.field;
  const stackFor = event.target.dataset.stack;
  const nameFor = event.target.dataset.name;

  if (stackFor) {
    setHandQuietly(updatePlayer(app.hand, stackFor, { stack: parseAmount(event.target.value) || 0 }));
    return;
  }
  if (nameFor) {
    setHandQuietly(updatePlayer(app.hand, nameFor, { name: event.target.value || nameFor }));
    return;
  }
  if (!field) return;

  if (field === 'size') { app.ui.sizeValue = event.target.value; refreshSizeMeta(); return; }
  if (field === 'tableSize') { setHand(resizeTable(app.hand, Number(event.target.value))); return; }
  if (['sb', 'bb', 'ante'].includes(field)) {
    setHandQuietly({ ...app.hand, [field]: parseAmount(event.target.value) || 0 });
    return;
  }
  setHandQuietly({ ...app.hand, [field]: event.target.value });
});

/** Update the model without re-rendering, so typing doesn't lose the caret. */
function setHandQuietly(next) {
  app.hand = next;
  store.saveDraft(next);
  document.getElementById('crumb-sub').textContent = next.tournament
    ? `${next.tournament} · ${stakesLabel(next)}` : stakesLabel(next);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.dataset.field === 'size') {
    event.preventDefault();
    confirmSize();
  }
  if (event.key === 'Escape' && !sheet.hidden) closeSheet();
});

/* ----------------------------------------------------------------- actions */

function changeUnit(unit) {
  if (unit === app.hand.unit) return;
  // Amounts typed in the old unit are meaningless in the new one, so the
  // stakes reset to that unit's sensible defaults rather than silently
  // reinterpreting 27.61 big blinds as 27.61 chips.
  const defaults = unit === 'bb'
    ? { sb: toUnits(0.5), bb: toUnits(1), ante: 0 }
    : { sb: 0, bb: 0, ante: 0 };
  setHand({
    ...app.hand, unit, ...defaults,
    players: app.hand.players.map((p) => ({ ...p, stack: 0 })),
    actions: [], winners: [],
  });
}

function loadSession(index) {
  const session = store.recentSessions()[index];
  if (!session) return;
  const base = resizeTable(app.hand, session.tableSize, session.scheme);
  setHand({
    ...base,
    tournament: session.tournament,
    level: session.level,
    unit: session.unit,
    sb: session.sb,
    bb: session.bb,
    ante: session.ante,
    anteMode: session.anteMode,
  });
  toast(`Loaded ${session.tournament}`);
}

function pickHoleCards(position, startIndex) {
  const player = app.hand.players.find((p) => p.position === position);
  if (!player) return;
  const cards = player.cards.slice();
  const count = startIndex === 0 && cards.length !== 1 ? 2 : 1;
  openPicker({
    title: `${player.name}'s cards`,
    count,
    taken: usedCards(app.hand).filter((c) => !player.cards.some((own) => sameCard(own, c))),
    onPick: (picked) => {
      const next = count === 2 ? picked : Object.assign(cards.slice(), { [startIndex]: picked[0] });
      setHand(updatePlayer(app.hand, position, { cards: next.filter(Boolean).slice(0, 2) }));
    },
  });
}

function dealBoard(street) {
  const board = (app.hand.board || []).slice();
  const need = BOARD_LENGTH[street] - board.length;
  openPicker({
    title: `${STREET_LABEL[street]} card${need > 1 ? 's' : ''}`,
    count: need,
    taken: usedCards(app.hand),
    onPick: (picked) => setHand({ ...app.hand, board: [...board, ...picked] }),
  });
}

function editBoardCard(index) {
  const board = (app.hand.board || []).slice();
  openPicker({
    title: 'Replace card',
    count: 1,
    taken: usedCards(app.hand).filter((c) => !sameCard(c, board[index])),
    onPick: (picked) => {
      board[index] = picked[0];
      setHand({ ...app.hand, board });
    },
  });
}

function choosePickerCard(rank, suit) {
  const picker = app.ui.picker;
  picker.chosen.push({ rank, suit });
  if (picker.chosen.length >= picker.count) {
    const chosen = picker.chosen;
    const onPick = picker.onPick;
    closeSheet();
    onPick(chosen);
    return;
  }
  renderPicker();
}

function applyAction(kind) {
  const state = currentState();
  if (!state.legal) return;
  const to = kind === 'call' ? state.legal.streetCommit + state.legal.toCall : state.legal.streetCommit;
  app.ui.sizeValue = '';
  setHand(withAction(app.hand, { position: state.toAct, kind, to }));
}

function applySize(mode, value) {
  const state = currentState();
  if (!state.legal) return;
  const to = sizeToTotal(state.legal, mode, value, app.hand);
  if (to === null || to <= state.legal.streetCommit) { toast('That is not a legal size'); return; }
  app.ui.sizeValue = '';
  setHand(withAction(app.hand, {
    position: state.toAct,
    kind: state.legal.isRaise ? 'raise' : 'bet',
    to,
  }));
}

function confirmSize() {
  const raw = parseFloat(app.ui.sizeValue);
  if (!Number.isFinite(raw)) { toast(`Type a size, or tap one above`); return; }
  applySize(app.ui.sizeMode, raw);
}

function refreshSizeMeta() {
  const state = currentState();
  if (!state.legal) return;
  const meta = document.querySelector('.sizemeta');
  if (!meta) return;
  meta.outerHTML = sizeMeta(state.legal);
}

function focusSize() {
  const input = document.getElementById('sizeinput');
  if (input) input.focus();
}

/**
 * Undo peels the hand back one step in the order things were entered: a named
 * winner first, then the last action, and only once a street has no action
 * left, the cards that opened it.
 */
function undo() {
  const hand = app.hand;
  if (hand.winners && hand.winners.length) { setHand({ ...hand, winners: [] }); return; }

  const boardLength = (hand.board || []).length;
  const state = currentState();
  const lastActed = [...state.streets].reverse().find((s) => s.actions.length);

  // Take the cards back only when the street they opened never got played —
  // otherwise the last action on that street is the more recent step.
  const openedStreetIsEmpty = boardLength > 0
    && (!lastActed || BOARD_LENGTH[lastActed.id] < boardLength);
  if (openedStreetIsEmpty) {
    setHand({ ...hand, board: hand.board.slice(0, boardLength === 3 ? 0 : boardLength - 1) });
    return;
  }
  if ((hand.actions || []).length) setHand(withoutLastAction(hand));
}

function restart() {
  app.step = 1;
  setHand(nextHand(app.hand));
  toast('New hand — same table and stakes');
}

/* -------------------------------------------------------------------- boot */

render();

// Registered off localhost only: a cache-first worker during development just
// serves yesterday's bundle back at you.
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
