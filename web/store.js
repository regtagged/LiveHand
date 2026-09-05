/**
 * Local persistence.
 *
 * Everything lives in this browser: there is no account and nothing leaves the
 * device unless the user exports it. Recent sessions are kept separately from
 * saved hands because the dropdown on step 1 is really asking "what were the
 * blinds last time?", which is session data, not hand data.
 */

const KEY = 'livehand.v1';
const MAX_SESSIONS = 12;
const MAX_HANDS = 60;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Private windows and blocked site data both land here; the app still works,
    // it just forgets between visits.
    return {};
  }
}

function write(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
  } catch {
    /* storage unavailable or full — not worth interrupting the user over */
  }
}

export function loadDraft() {
  return read().draft || null;
}

export function saveDraft(hand) {
  write({ draft: hand });
}

export function clearDraft() {
  write({ draft: null });
}

/** The session settings behind step 1's dropdown, most recently used first. */
export function recentSessions() {
  return read().sessions || [];
}

export function rememberSession(hand) {
  if (!hand.tournament) return;
  const entry = {
    tournament: hand.tournament,
    level: hand.level || '',
    unit: hand.unit,
    sb: hand.sb,
    bb: hand.bb,
    ante: hand.ante,
    anteMode: hand.anteMode,
    tableSize: hand.tableSize,
    scheme: hand.scheme,
    usedAt: Date.now(),
  };
  const rest = recentSessions().filter((s) => s.tournament !== entry.tournament);
  write({ sessions: [entry, ...rest].slice(0, MAX_SESSIONS) });
}

export function savedHands() {
  return read().hands || [];
}

export function saveHand(hand) {
  const rest = savedHands().filter((h) => h.id !== hand.id);
  write({ hands: [{ ...hand, savedAt: Date.now() }, ...rest].slice(0, MAX_HANDS) });
}

export function deleteHand(id) {
  write({ hands: savedHands().filter((h) => h.id !== id) });
}
