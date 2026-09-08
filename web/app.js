/**
 * The UI.
 *
 * Deliberately framework-free and re-rendered wholesale: the hand is small,
 * `replay()` is cheap, and every screen is a pure function of one plain object.
 * That means there is no separate UI state to drift out of step with the hand —
 * the action bar offers exactly what the engine says is legal, and nothing else.
 */

import { parseAmount, fmtAmount, toUnits, fromUnits, toBb, roundForUnit } from './src/core/amount.js';
import { RANKS, SUITS, SUIT_GLYPH, SUIT_NAME, cardStr, sameCard } from './src/core/cards.js';
import { replay, sizeToTotal, withAction, withoutLastAction, STREET_LABEL, BOARD_LENGTH } from './src/core/engine.js';
import {
  createHand, resizeTable, togglePlayer, setHero, updatePlayer, validateSetup,
  usedCards, reviveHand, nextHand, anteAmount, heroOf, setAllStacks,
} from './src/core/hand.js';
import { money, stakesLabel, isUnfinished, openQuestion } from './src/core/narrate.js';
import { seatRing } from './src/core/positions.js';
import { buildGgSheet } from './src/render/ggSheet.js';
import { buildTableSheet } from './src/render/tableSheet.js';
import { sceneToSvg } from './src/render/svg.js';
import { toReplayerHtml } from './src/export/replayer.js';
import { sceneToCanvas, canvasToBlob } from './canvas.js';
import * as store from './store.js';

const view = document.getElementById('view');
const sheet = document.getElementById('sheet');

const app = {
  hand: reviveHand(store.loadDraft()) || createHand(),
  // The table is where a hand actually starts. Stakes have working defaults and
  // are one tap away, so opening on them charged every hand a screen it rarely
  // needed — which is most of the cost of a preflop-only spot.
  step: 1,
  // sizeMode null means "whatever suits this street" — see sizeMode().
  ui: { sizeMode: null, sizeValue: '', exportTab: 'table', showNames: false, picker: null,
        confirmDelete: null, allDepth: '' },
};

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const unitLabel = () => (app.hand.unit === 'bb' ? 'BB' : 'chips');

/**
 * How a typed size is read. Preflop people say "I opened to 2.5" and mean big
 * blinds; postflop they say "half pot". Defaulting per street means the common
 * case needs no mode tap at all, and an explicit choice still sticks.
 */
const sizeMode = (state) => app.ui.sizeMode || (state.street === 'preflop' ? 'bb' : 'pct');
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

function cardSlots(cards, count, action, { extra = '', facedown = false } = {}) {
  const slots = [];
  for (let i = 0; i < count; i++) {
    const face = facedown
      ? '<span class="cardface back">?</span>'
      : cardHtml(cards[i]);
    slots.push(`<button data-act="${action}" data-index="${i}" ${extra}>${face}</button>`);
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
function openPicker({ title, count, taken, onPick, mystery = false }) {
  app.ui.picker = { title, count, taken, onPick, mystery, chosen: [] };
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
      : ''}
    ${picker.mystery ? `<button class="secondary mysterybtn" data-act="mystery-hand">
      Mystery hand — don't record my cards</button>` : ''}`;
  sheet.hidden = false;
}

/**
 * Open a picker straight after the render that decided it was needed.
 *
 * Deferred rather than called inline because the caller is building markup
 * that has not been put in the document yet, and skipped if a sheet is already
 * up so a re-render can't reopen one the user just dismissed.
 */
function autoOpen(open) {
  if (autoOpen.pending || !sheet.hidden) return;
  autoOpen.pending = true;
  setTimeout(() => {
    autoOpen.pending = false;
    if (sheet.hidden) open();
  }, 0);
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
  <div class="card skipbar">
    <div>
      <strong>${esc(stakesLabel(hand))}</strong>
      <span class="hint">Nothing here is required — change what you need, or go straight in.</span>
    </div>
    <button class="ghost" data-act="goto" data-step="1">Skip</button>
  </div>

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

  ${renderLibrary()}

  <div hidden>
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
    <div class="stakesline">
      <span><strong>${esc(stakesLabel(hand))}</strong>${hand.tournament ? ` · ${esc(hand.tournament)}` : ''}</span>
      <button class="ghost" data-act="goto" data-step="0">Change</button>
    </div>
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
      stacks in ${unitLabel()}. The blinds post either way, so there is no need to list them unless
      they did something; a stack is only needed where it matters.</p>
    ${hand.players.length ? `<div class="field alldepths">
      <label for="alldepth">Everyone the same depth</label>
      <div class="presets">
        ${DEPTHS.map((depth) => `<button data-act="depth-all" data-value="${depth}"
          aria-pressed="${allAtDepth(hand, depth)}"><b>${depth}</b><i>BB</i></button>`).join('')}
      </div>
      <div class="sizerow" style="margin-top:8px">
        <input id="alldepth" type="text" inputmode="decimal" data-field="all-depth"
               value="${esc(app.ui.allDepth)}" placeholder="or type a depth in BB">
        <button class="ghost" data-act="depth-all-typed">Set all</button>
      </div>
    </div>` : ''}

    <div class="seatgrid">
      ${ring.map((position) => {
        const player = hand.players.find((p) => p.position === position);
        const on = included.has(position);
        return `<div class="seat-cell">
          <div class="seat-row ${on ? '' : 'off'} ${player && player.isHero ? 'hero' : ''}">
            <button class="toggle" data-act="toggle-seat" data-pos="${position}"
              aria-pressed="${on}">${on ? '&#10003;' : '&#43;'}</button>
            <span class="pos">${position}</span>
            <input type="text" inputmode="decimal" data-stack="${position}" ${on ? '' : 'disabled'}
              value="${player ? amountValue(player.stack) : ''}" placeholder="stack">
            <button class="herobtn" data-act="set-hero" data-pos="${position}"
              aria-pressed="${!!(player && player.isHero)}">YOU</button>
          </div>
          ${app.ui.showNames && on ? `<div class="seat-row">
            <span class="pos">${position}</span>
            <input type="text" data-name="${position}" value="${esc(player.name)}" placeholder="name">
          </div>` : ''}
          ${offerDepths(player) ? depthRow(position, hand) : ''}
        </div>`;
      }).join('')}
    </div>
  </div>

  <div class="card">
    <h2>Your cards</h2>
    <p class="hint" style="margin:0 0 10px">${hero
      ? `Dealt to ${esc(hero.name === hero.position ? hero.position : `${hero.name} (${hero.position})`)}`
      : 'Pick your seat first'}</p>
    ${hero ? cardSlots(hero.cards, 2, 'pick-hero', { facedown: hand.hideHeroCards }) : ''}
    ${hero ? `<div class="segment" style="margin-top:10px">
      <button data-act="hide-cards" data-value="show" aria-pressed="${!hand.hideHeroCards}">My hand</button>
      <button data-act="hide-cards" data-value="hide" aria-pressed="${hand.hideHeroCards}">Mystery hand</button>
    </div>
    <p class="hint">${hand.hideHeroCards
      ? 'Exports as ?? — ask what people would do before telling them what you had.'
      : 'Or post it as a mystery hand and keep your cards to yourself.'}</p>` : ''}
  </div>

  <div id="setup-problems">${problemsHtml(problems)}</div>

  <button class="primary" data-act="goto" data-step="2" ${problems.length ? 'disabled' : ''}>
    Start the hand</button>`;
}

/**
 * Hands kept on this device.
 *
 * Everything is in localStorage — no account, nothing leaves the phone — so
 * this list is the whole library. Deleting asks twice, because there is no
 * undo and no copy of the hand anywhere else.
 */
function renderLibrary() {
  const hands = store.savedHands();
  if (!hands.length) {
    return `<div class="card">
      <h2>Saved hands</h2>
      <p class="hint">None yet. Save a hand from the Export step and it is kept here,
        on this device only.</p>
    </div>`;
  }
  return `<div class="card">
    <h2>Saved hands <span class="count">${hands.length}</span></h2>
    <ul class="library">
      ${hands.map((saved) => {
        const doomed = app.ui.confirmDelete === saved.id;
        return `<li>
          <button class="libopen" data-act="open-hand" data-id="${esc(saved.id)}">
            <b>${esc(libraryTitle(saved))}</b><i>${esc(librarySubtitle(saved))}</i>
          </button>
          <button class="ghost ${doomed ? 'danger' : ''}" data-act="delete-hand" data-id="${esc(saved.id)}">
            ${doomed ? 'Sure?' : 'Delete'}</button>
        </li>`;
      }).join('')}
    </ul>
  </div>`;
}

function libraryTitle(saved) {
  const hero = (saved.players || []).find((p) => p.isHero);
  const cards = hero && hero.cards && hero.cards.length === 2
    ? (saved.hideHeroCards ? '??' : hero.cards.map(cardStr).join(' '))
    : '';
  const seat = hero ? hero.position : '';
  const who = [cards, seat].filter(Boolean).join(' ');
  return [saved.tournament || 'Live hand', who].filter(Boolean).join(' · ');
}

function librarySubtitle(saved) {
  const when = saved.savedAt ? new Date(saved.savedAt).toLocaleDateString() : '';
  return [stakesLabel(saved), when].filter(Boolean).join(' · ');
}

/**
 * Whether to offer one-tap depths under a seat. Every listed seat was listed on
 * purpose, so any of them without a stack yet gets the shortcut.
 */
function offerDepths(player) {
  return !!player && !(player.stack > 0);
}

/** The depths offered anywhere a stack can be set in one tap. */
const DEPTHS = [20, 30, 40, 60, 100];

function depthRow(position, hand) {
  return `<div class="presets seat-depths">
    ${DEPTHS.map((depth) => `<button data-act="depth" data-pos="${position}"
      data-value="${depth}"><b>${depth}</b><i>BB</i></button>`).join('')}
  </div>`;
}

/**
 * Apply a depth the user typed rather than one of the presets.
 *
 * Always read as big blinds, matching the presets beside it, so the row means
 * one thing whichever unit the hand is being entered in.
 */
function applyTypedDepth() {
  const depth = parseFloat(app.ui.allDepth);
  if (!Number.isFinite(depth) || depth <= 0) { toast('Type a depth in big blinds'); return; }
  app.ui.allDepth = '';
  setHand(setAllStacks(app.hand, roundForUnit(Math.round(depth * app.hand.bb), app.hand.unit)));
  toast(`Everyone ${fmtAmount(toUnits(depth), 'bb')} BB deep`);
}

/** True when every listed seat is already sitting on exactly this depth. */
function allAtDepth(hand, depth) {
  return hand.players.length > 0 && hand.players.every((p) => p.stack === depth * hand.bb);
}

function problemsHtml(problems) {
  if (!problems.length) return '';
  return `<div class="problems"><strong>Before you start:</strong>
    <ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`;
}

/**
 * Re-check the setup without redrawing the screen.
 *
 * Typing deliberately skips a re-render so the caret survives, which used to
 * mean the last thing you typed — usually your own stack — left "Start the
 * hand" greyed out until you touched something else.
 */
function refreshValidation() {
  const problems = validateSetup(app.hand);
  const box = document.getElementById('setup-problems');
  if (box) box.innerHTML = problemsHtml(problems);
  const start = document.querySelector('[data-act="goto"][data-step="2"].primary');
  if (start) start.disabled = problems.length > 0;
  for (const button of document.querySelectorAll('.steps button')) {
    if (Number(button.dataset.step) >= 2) button.disabled = problems.length > 0;
  }
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
  const depth = !player.unknownStack && app.hand.unit === 'chips' && app.hand.bb
    ? `${fmtAmount(toBb(player.stack, app.hand.bb), 'bb')} BB` : '';
  const stackText = player.unknownStack ? '—' : showAmount(player.stack);
  return `<div class="pcard ${player.folded ? 'folded' : ''} ${player.isHero ? 'hero' : ''} ${acting ? 'acting' : ''}">
    <div class="pos">${player.position}${player.isHero ? ' · you' : ''}</div>
    <div class="nm">${esc(player.name === player.position ? (depth || ' ') : player.name)}</div>
    <div class="stack">${stackText}${player.allIn ? ' · AI' : ''}</div>
    <div class="bet">${player.streetCommit ? showAmount(player.streetCommit) : ' '}</div>
    <div class="did">${last ? esc(last) : ' '}</div>
    ${player.isHero && app.hand.hideHeroCards
      ? '<div class="hole"><span class="cardface small back">?</span><span class="cardface small back">?</span></div>'
      : player.cards && player.cards.length
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
    // The hand cannot go anywhere without these cards and there is nothing else
    // to do here, so asking for a tap to open the deck is a tap wasted.
    autoOpen(() => dealBoard(street));
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
  const modes = app.hand.unit === 'bb'
    ? [['bb', 'BB'], ['pct', '%']]
    : [['bb', 'BB'], ['pct', '%'], ['amount', 'Chips']];

  return `<div class="actionbar">
    <div class="who">
      <b>${esc(who(player))}${player.isHero ? ' · you' : ''}</b>
      <span>${legal.unknownStack ? 'stack not entered' : `${showAmount(player.stack)} behind`}${
        legal.toCall ? ` · ${showAmount(legal.toCall)} to call` : ''}</span>
    </div>
    ${foldToMeLabel(state) ? `<button class="secondary foldtome" data-act="fold-to-me">
      ${esc(foldToMeLabel(state))}</button>` : ''}
    ${(app.hand.actions || []).length ? `<button class="secondary endhere" data-act="goto" data-step="3">
      Stop here and ask</button>` : ''}
    <div class="verbs">
      <button class="fold" data-act="act" data-kind="fold">Fold</button>
      <button class="${legal.canCheck ? 'check' : ''}" data-act="act"
        data-kind="${legal.canCheck ? 'check' : 'call'}">${callLabel}</button>
      <button class="aggro" data-act="size-confirm">${aggroLabel(legal, state)}</button>
    </div>
    <div class="sizer">
      <div class="presets">
        ${presetButtons(legal, state).join('')}
      </div>
      <div class="sizerow">
        <input type="text" inputmode="decimal" id="sizeinput" data-field="size"
               value="${esc(app.ui.sizeValue)}" placeholder="${aggroWord.toLowerCase()}…">
        <div class="segment">
          ${modes.map(([value, label]) => `<button data-act="size-mode" data-value="${value}"
            aria-pressed="${sizeMode(state) === value}">${label}</button>`).join('')}
        </div>
      </div>
      ${sizeMeta(legal, state)}
    </div>
  </div>`;
}

/**
 * Preset sizings, each labelled with the amount it actually works out to.
 *
 * Preflop sizes are multiples of a blind, because that is the only way anyone
 * says them — a percentage of a 2.5bb pot is a number nobody has ever opened
 * to. Postflop they are percentages of the pot after calling, which is what
 * every solver and every player means there.
 */
function presetButtons(legal, state) {
  const hand = app.hand;
  const buttons = [`<button data-act="size-apply" data-value="${fromUnits(legal.minTo)}">
    <b>Min</b><i>${showAmount(legal.minTo)}</i></button>`];

  for (const [label, total] of presetSizes(legal, state, hand)) {
    if (total <= legal.minTo || total >= legal.maxTo) continue;
    buttons.push(`<button data-act="size-apply" data-value="${fromUnits(total)}">
      <b>${label}</b><i>${showAmount(total)}</i></button>`);
  }

  if (!legal.unknownStack) {
    buttons.push(`<button class="allin" data-act="size-apply" data-value="${fromUnits(legal.maxTo)}">
      <b>All-in</b><i>${showAmount(legal.maxTo)}</i></button>`);
  }
  return buttons;
}

/** @returns {[string, number][]} label and total-for-the-street, in units. */
function presetSizes(legal, state, hand) {
  if (state.street !== 'preflop') {
    return [33, 50, 75, 100].map((pct) => [`${pct}%`, sizeToTotal(legal, 'pct', pct, hand)]);
  }

  const preflop = state.streets.find((street) => street.id === 'preflop');
  const raises = preflop ? preflop.actions.filter((a) => a.kind === 'raise').length : 0;
  // The bet being faced: a blind if nobody has raised, otherwise the last raise.
  const facing = legal.streetCommit + legal.toCall;
  const size = (multiple, of) => roundForUnit(Math.round(multiple * of), hand.unit);

  // Opening. Sized off the big blind.
  if (raises === 0) return [2, 2.5, 3, 3.5].map((m) => [`${m}x`, size(m, hand.bb)]);
  // Three-betting. Sized off the open.
  if (raises === 1) return [3, 3.5, 4].map((m) => [`${m}x`, size(m, facing)]);
  // Four-bet and beyond, where the multiples come right down.
  return [2, 2.2, 2.5].map((m) => [`${m}x`, size(m, facing)]);
}

/**
 * "Folds to me": every seat between here and yours passes.
 *
 * Offered whenever someone else is to act, including after a raise — "CO
 * opens, folds to me in the big blind" is the single most common spot anyone
 * asks about, and it is the one where these taps carry no information at all.
 * Each fold is still written into the action log, and undo peels them back one
 * at a time.
 */
function foldToMeLabel(state) {
  const hero = state.players.find((p) => p.isHero);
  if (!hero || !state.toAct || state.toAct === hero.position || hero.folded) return '';
  return `Folds to me (${hero.position})`;
}

function foldToHero() {
  const hero = heroOf(app.hand);
  if (!hero) return;
  let hand = app.hand;
  // Bounded rather than while(true): a stuck engine should not hang the tab.
  for (let i = 0; i < 24; i++) {
    const state = replay(hand);
    if (state.status !== 'betting' || state.toAct === hero.position) break;
    hand = withAction(hand, { position: state.toAct, kind: 'fold', to: state.legal.streetCommit });
  }
  setHand(hand);
}

/**
 * What the aggressive verb would do right now: whatever is typed in the sizing
 * box, or the minimum if it is empty. Tapping the verb is the confirmation, so
 * there is no separate one.
 */
function pendingTotal(legal, state) {
  const raw = parseFloat(app.ui.sizeValue);
  if (!Number.isFinite(raw)) return legal.minTo;
  const total = sizeToTotal(legal, sizeMode(state), raw, app.hand);
  return total === null ? legal.minTo : total;
}

function aggroLabel(legal, state) {
  return `${legal.isRaise ? 'Raise to' : 'Bet'} ${showAmount(pendingTotal(legal, state))}`;
}

function sizeMeta(legal, state) {
  const max = legal.unknownStack ? 'no stack entered' : `Max ${showAmount(legal.maxTo)}`;
  const raw = parseFloat(app.ui.sizeValue);
  const mode = sizeMode(state);
  if (!Number.isFinite(raw)) {
    return `<div class="sizemeta"><span>Min ${showAmount(legal.minTo)}</span><span>${max}</span></div>`;
  }
  const wanted = mode === 'pct'
    ? sizeToTotal(legal, mode, raw, app.hand)
    : Math.round(mode === 'bb' ? raw * app.hand.bb : toUnits(raw));
  // The engine would cap this anyway; saying so up front is less surprising.
  const capped = !legal.unknownStack && wanted > legal.maxTo;
  return `<div class="sizemeta">
    <span class="${capped ? 'over' : ''}">${capped
      ? `Only ${showAmount(legal.maxTo)} behind — capped`
      : `Min ${showAmount(legal.minTo)}`}</span>
    <span>${max}</span>
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

/**
 * Left to right, the order you would actually look at a hand in: the table it
 * happened at, then the hand written out, then play it through.
 *
 * The plain-text history is deliberately not here. It is still generated by
 * src/export/textHH.js and still tested — it is the only machine-readable
 * output, and the only one a tracker or solver could import — but as something
 * to hand another player it was the least readable of the four.
 */
const EXPORT_TABS = [
  ['table', 'Table View'],
  ['gg', 'PT4 View'],
  ['replayer', 'Replayer'],
];

function renderExport() {
  const hand = app.hand;
  const state = currentState();
  const tab = app.ui.exportTab;
  let body = '';

  if (tab === 'gg' || tab === 'table') {
    body = sceneToSvg(buildScene(tab, hand, state));
  } else {
    const html = toReplayerHtml(hand, state);
    body = `<iframe title="Replayer preview" srcdoc="${esc(html)}"></iframe>`;
  }

  const unfinished = isUnfinished(state);
  const question = unfinished ? openQuestion(state, hand) : '';

  return `
  ${unfinished ? `<div class="card openended">
    <strong>Posted unfinished</strong>
    <p class="hint">${esc(question ? `${question}.` : 'The hand stops where you left it.')}
      Every export says so rather than implying a result — go back to Action to carry on.</p>
  </div>` : ''}

  <div class="tabs">
    ${EXPORT_TABS.map(([id, label]) => `<button data-act="export-tab" data-value="${id}"
      aria-pressed="${tab === id}">${label}</button>`).join('')}
  </div>
  <div class="preview">${body}</div>
  <div class="exportbtns">
    <button class="secondary" data-act="download">Download</button>
    <button class="secondary" data-act="share">Share</button>
  </div>
  <div class="card" style="margin-top:14px">
    <h2>Your cards</h2>
    <div class="segment">
      <button data-act="hide-cards" data-value="show" aria-pressed="${!hand.hideHeroCards}">Show them</button>
      <button data-act="hide-cards" data-value="hide" aria-pressed="${hand.hideHeroCards}">Keep them secret</button>
    </div>
    <p class="hint">${hand.hideHeroCards
      ? 'Your hand exports as ?? — ask what people would do before you tell them what you had.'
      : 'Your two cards are shown in every export.'}</p>
  </div>

  <div class="card" style="margin-top:14px">
    <h2>Notes</h2>
    <textarea data-field="note" placeholder="What was the question?">${esc(hand.note || '')}</textarea>
    <div class="exportbtns">
      <button class="secondary" data-act="save-hand">Save hand</button>
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
  await downloadCurrent();
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
  // Without this a thrown handler is a button that silently does nothing, which
  // is the hardest kind of bug to notice — one dead control on a screen full of
  // working ones. Say so instead.
  try {
    handleClick(target);
  } catch (error) {
    console.error(error);
    toast('Something went wrong with that button');
  }
});

function handleClick(target) {
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

    case 'depth': setHand(updatePlayer(app.hand, target.dataset.pos, {
      stack: Number(target.dataset.value) * app.hand.bb,
    })); break;
    case 'depth-all':
      app.ui.allDepth = '';
      setHand(setAllStacks(app.hand, Number(target.dataset.value) * app.hand.bb));
      break;
    case 'depth-all-typed': applyTypedDepth(); break;
    case 'fold-to-me': foldToHero(); break;
    case 'toggle-names': app.ui.showNames = !app.ui.showNames; render(); break;
    case 'toggle-seat': {
      const position = target.dataset.pos;
      const on = app.hand.players.some((p) => p.position === position);
      setHand(togglePlayer(app.hand, position, !on));
      break;
    }
    case 'set-hero': {
      const position = target.dataset.pos;
      // Claiming a seat implies sitting in it, so an unlisted one switches on.
      const seated = app.hand.players.some((p) => p.position === position)
        ? app.hand
        : togglePlayer(app.hand, position, true);
      setHand(setHero(seated, position));
      const hero = app.hand.players.find((p) => p.position === position);
      // Naming your seat and dealing yourself in is one thought, not two.
      if (hero && !hero.cards.length) autoOpen(() => pickHoleCards(position, 0));
      break;
    }
    case 'pick-hero': pickHoleCards(app.hand.players.find((p) => p.isHero).position, Number(target.dataset.index)); break;
    case 'set-cards': pickHoleCards(target.dataset.pos, 0); break;

    case 'pick-card': choosePickerCard(target.dataset.rank, target.dataset.suit); break;

    case 'deal': dealBoard(target.dataset.street); break;
    case 'edit-board': editBoardCard(Number(target.dataset.index)); break;
    case 'undo': undo(); break;
    case 'act': applyAction(target.dataset.kind); break;
    case 'size-apply': applySize('amount', Number(target.dataset.value)); break;
    case 'size-mode': app.ui.sizeMode = target.dataset.value; render(); focusSize(); break;
    case 'size-confirm': confirmSize(); break;
    case 'set-winner': setHand({ ...app.hand, winners: [target.dataset.pos] }); break;

    case 'export-tab': app.ui.exportTab = target.dataset.value; render(); break;
    case 'hide-cards': setHand({ ...app.hand, hideHeroCards: target.dataset.value === 'hide' }); break;
    case 'mystery-hand': {
      // Entering a mystery hand means never recording the cards, not recording
      // them and hiding them afterwards.
      const hero = heroOf(app.hand);
      closeSheet();
      setHand({
        ...(hero ? updatePlayer(app.hand, hero.position, { cards: [] }) : app.hand),
        hideHeroCards: true,
      });
      toast('Mystery hand — your cards stay yours');
      break;
    }
    case 'download': downloadCurrent(); break;
    case 'share': shareCurrent(); break;
    case 'save-hand': {
      store.saveHand(app.hand);
      const count = store.savedHands().length;
      render();
      toast(`Saved on this device — ${count} hand${count === 1 ? '' : 's'}`);
      break;
    }
    case 'open-hand': {
      const saved = store.savedHands().find((h) => h.id === target.dataset.id);
      if (!saved) { toast('That hand is no longer saved'); break; }
      app.ui.confirmDelete = null;
      app.step = 3;
      setHand(reviveHand(saved));
      break;
    }
    case 'delete-hand': {
      const id = target.dataset.id;
      // Two taps: there is no undo, and no copy of this hand anywhere else.
      if (app.ui.confirmDelete !== id) { app.ui.confirmDelete = id; render(); break; }
      store.deleteHand(id);
      app.ui.confirmDelete = null;
      render();
      toast('Deleted');
      break;
    }
    default: break;
  }
}

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
  // Held in UI state, not on the hand: it is a shortcut for filling the seats,
  // not a property of the hand itself.
  if (field === 'all-depth') { app.ui.allDepth = event.target.value; return; }
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
  if (app.step === 1) refreshValidation();
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.dataset.field === 'size') {
    event.preventDefault();
    confirmSize();
  }
  if (event.key === 'Enter' && event.target.dataset.field === 'all-depth') {
    event.preventDefault();
    applyTypedDepth();
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
    // Offered only for your own hand: a villain's cards are unknown by default
    // anyway, so there is nothing there to keep secret.
    mystery: !!player.isHero,
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

/** The aggressive verb: whatever is typed, or the minimum if nothing is. */
function confirmSize() {
  const state = currentState();
  if (!state.legal) return;
  const raw = parseFloat(app.ui.sizeValue);
  if (!Number.isFinite(raw)) { applySize('amount', fromUnits(state.legal.minTo)); return; }
  applySize(sizeMode(state), raw);
}

/** Update the parts that depend on the typed size, without losing the caret. */
function refreshSizeMeta() {
  const state = currentState();
  if (!state.legal) return;
  const meta = document.querySelector('.sizemeta');
  if (meta) meta.outerHTML = sizeMeta(state.legal, state);
  const aggro = document.querySelector('.verbs .aggro');
  if (aggro) aggro.textContent = aggroLabel(state.legal, state);
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
  // Landing on a table that looks exactly as you left it reads as "nothing
  // happened", so go straight to the one thing that is genuinely new.
  const hero = heroOf(app.hand);
  if (hero) autoOpen(() => pickHoleCards(hero.position, 0));
  toast('New hand — same table, fresh cards');
}

/* -------------------------------------------------------------------- boot */

render();

// Registered off localhost only: a cache-first worker during development just
// serves yesterday's bundle back at you.
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
