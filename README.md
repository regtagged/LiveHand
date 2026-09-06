# LiveHand

Type a poker hand on your phone while it's still fresh, and get it out in the
three formats people actually share:

1. **Text hand history** — PokerStars-family plain text, the format trackers,
   solvers and forums already read.
2. **Image** — either **HH View** (the share-sheet layout: stacks, then one line
   of action per street) or **Table View** (felt on top, action columns below).
   You pick at export time.
3. **Replayer** — one self-contained HTML file that steps through the hand.

It is a static web app. Everything — the betting engine, both image renderers,
the replayer generator — runs in the browser, so it works at a table with no
signal, and nothing you type leaves the device unless you export it.

## Running it

```bash
npm start
```

Then open <http://localhost:4180>. There is nothing to install: no
dependencies, no build step, no database, no accounts. `npm start` is a ~70
line static file server, and if you'd rather host it somewhere, any static host
will do — copy `web/` and `src/` up and point the root at `web/index.html`.

On a phone, use "Add to Home Screen". The service worker caches the app shell,
so after the first visit it opens offline.

```bash
npm test    # 35 tests, Node's built-in runner
```

## The flow

**1 · Session.** A hand opens on the **table**, not here — the defaults are
0.5/1 with a big blind ante, they are shown at the top of the table screen, and
**Change** comes back to this page when they are wrong. Otherwise: a
tournament name if you want one (optional, with a dropdown of recent ones since
the blinds and table size usually repeat), whether you're typing *chips* or
*big blinds*, the blinds, and the ante. A big blind ante needs no size — it is
one big blind by definition, so it follows the blind rather than being typed and
going stale at the next level.

**2 · Table.** Eight seats by default, all switched off except the blinds.
Switch on the ones that were in the hand — most shared hands name three or four
players — and tap **YOU** on your seat, which seats you if you weren't already
and opens the deck for your two cards. Nothing is ever made hero for you.

Any seat that still needs a stack offers one-tap depths (20/30/40/60/100 bb),
or you can type an exact number. They appear for your own seat and for anyone
you deliberately switched on — never for a blind you left alone, since those
are in the hand only because they post. A villain needs a stack for **All-in**
to mean anything, so give the aggressor a depth if the hand ends in a jam.

**Only your own stack is required.** A blind that posts and folds is in the hand
whether you looked its stack up or not, so leaving it blank is fine: the engine
treats an unentered stack as unknown and assumes it covers whatever it faces,
and every export prints it as unknown rather than inventing a number. Seats you
never switched on still appear on the Table View felt, empty, so the picture
shows the table that was really there.

Cards are picked from the whole deck at once: four rows of thirteen in
four-colour, so any card is a single tap and a flop is three.

**3 · Action.** A strip of seats across the top showing everyone's stack, their
wager and what they last did, with whoever is to act highlighted. Underneath,
the action bar offers only what is legal right now: **Fold**, **Check/Call**,
and a third verb that reads what it will do — `Raise to 8.75` — and does it in
one tap. There is no separate confirm.

Sizings are offered in the units the street is actually spoken in. **Preflop
they are multiples of a blind** — `2.5x 3x 3.5x` to open, `3x 3.5x 4x` of the
open to three-bet, coming down to `2x 2.2x 2.5x` for a four-bet — because a
percentage of a 2.5bb pot is a number nobody has ever opened to. **Postflop
they are percentages of the pot** after calling, which is what solvers and
players both mean there. Every button shows the shorthand and what it comes to
(`75%` / `14,650`), and you can always type a size instead; the typed box
defaults to big blinds preflop and pot percentage after.

When a street's betting closes, the card picker opens on its own — the hand
cannot go anywhere without those cards, so it does not make you ask.

While someone else is to act there is a **Folds to me** button, which passes
every seat between there and yours. "CO opens, folds to me in the big blind" is
the spot people ask about most and the one where those taps carry no
information. Every fold still lands in the action log, and undo peels them back
one at a time.

At the end it works out who won; if you never saw a villain's cards, tap who
took it instead.

**A hand does not have to finish.** Most hands worth posting stop on a
decision — you are facing a four-bet jam and want to know what the table would
do. **Stop here and ask** takes you to the exports from wherever you are, and
every export says the hand is unfinished and whose action it is rather than
implying a result: no showdown, no winner, "Pot so far" instead of a total, and
players marked still to act rather than mucked.

**4 · Export.** Alongside the three formats there is **Keep them secret**,
which exports your own two cards as `??` — a mystery hand, so people answer the
spot before they know what you held. It redacts them everywhere at once,
including the data embedded in the replayer file, so nothing leaks through the
one export people can open in a text editor.

For scale, with nothing typed at all:

| | LiveHand | Written out |
|---|---|---|
| Preflop spot — open, folds to me, my decision | **8 taps** | ~35 characters |
| Four streets — open, 3-bet, call, c-bet, call, jam, call, showdown | **23 taps** | ~135 characters |

Both are taps on large targets with no keyboard, which is the point: the
keyboard is where the time and the typos go on a phone.

All three formats are previewed, with copy / download / share. The share button
uses the native share sheet on phones that have one.

## What the engine guarantees

Stacks are tracked street by street and **nothing can ever put in more than a
player has** — a shove is capped at the stack, a call is capped at the amount
actually owed, and if you type a size larger than the stack the bar tells you
it's capping before you commit it. Side pots are built by wager level, so a
short all-in only wins the part of the pot it covered.

Two things a naive pot model gets wrong, both of which make the *loser* of a
hand appear to win a blind or two, and both of which are covered by tests:

- **An uncalled bet is not a win.** Shove 21 into someone who can only call 20
  and that last chip was never in play. It is handed back before the pot is
  awarded — `Uncalled bet (1) returned to …` — rather than being counted into
  the pot and paid out at showdown.
- **An ante is not a wager.** It is dead money everyone still in the hand plays
  for, so it goes to the main pot and never sets a side-pot level. Otherwise a
  big blind who antes and then calls a shove has a larger *total* outlay than
  the shover and collects a phantom pot of their own ante.

Min-raise sizes are offered but not enforced. This is a tool for transcribing a
hand that already happened, and hands sometimes happen strangely; the app
shouldn't refuse to record one.

## How it's put together

```
src/core/       the hand and the rules — no DOM, runs in Node and the browser
  hand.js        the hand object: seats, stacks, board, actions
  engine.js      replay(hand) -> whose turn, what's legal, pots, winners
  positions.js   seat names and order of action (heads-up falls out of the rule)
  evaluate.js    5-7 card hand ranking, with GG-style descriptions
  equity.js      exact enumeration from the flop, sampling preflop
  amount.js      money as integer hundredths, so comparisons are exact
  narrate.js     one place that turns an action into words
src/export/
  textHH.js      export 1: PokerStars-family text
  replayer.js    export 3: frames + a standalone HTML player
src/render/
  scene.js       a small scene graph both image layouts build into
  svg.js          scene -> SVG (preview, and testable in Node)
  ggSheet.js      export 2a: the GG share sheet
  tableSheet.js   export 2b: the client-style table
web/             the UI: index.html, styles.css, app.js, canvas.js, store.js
  canvas.js      scene -> canvas, the path a downloaded PNG takes
server.js        static file server, used for local development
```

Two decisions worth knowing about:

**`replay()` rebuilds the hand from scratch on every render.** Hands are a few
dozen actions, so it costs nothing, and it means undo is just dropping the last
action and there is exactly one place that decides what the state of the hand
is. The action bar, the exports and the replayer physically cannot disagree.

**The image exports go through a scene graph with two backends** — SVG for the
preview, canvas for the PNG — rather than rasterising the SVG. Converting an
SVG to a PNG re-runs text layout in the browser's SVG engine, where a font
substitution silently shifts every label and the download stops matching what
you previewed.

## Deploying it

`npm run build` flattens the two source trees into `dist/` — `web/*` at the
root and `src/*` under `src/` — which is the same shape `server.js` serves
locally, so a module path that resolves in development resolves identically in
production. Every import is relative, so the result works served from a domain
root or from a project subpath.

- **GitHub Pages** — `.github/workflows/pages.yml` runs the tests, builds, and
  publishes on every push to `main`.
- **Vercel** — import the repo at [vercel.com/new](https://vercel.com/new);
  `vercel.json` already sets the build command and output directory, so there
  is nothing to configure.

## Known gaps

- **Hold'em only.** The engine has no concept of draw or stud streets, and
  Omaha would need four hole cards through the evaluator and equity code.
- **No straddle UI.** `hand.straddles` is honoured by the engine and the text
  export, but nothing on the setup screen sets it yet.
- **Positions are always LJ/HJ.** The core still knows GG's MP/MP1 naming
  (`seatRing(n, 'gg')`) and the tests use it, but the app no longer offers the
  choice.
- **An unknown stack prints as `(unknown in chips)`** in the text history. That
  is honest, but it is not a number, so a strict third-party parser may reject
  the line — fill the stack in if you need that hand to import somewhere.
- **Run-it-twice and rake aren't modelled.** Every pot is awarded once, and the
  summary line prints `Rake 0`.
- **Preflop equity is sampled**, not enumerated — 25,000 run-outs off a fixed
  seed, so it's stable to about a tenth of a percent and never shimmers between
  redraws. Flop and turn are exact.
- **Saved hands have no browser yet.** "Save to this device" keeps the last 60
  hands in `localStorage`, but there is no screen that lists them back.
- Nothing here is shared with, or reads from, the HandInsights project — the
  text export is deliberately a standard format rather than a private one, so
  the two can meet through a file if you ever want them to.
