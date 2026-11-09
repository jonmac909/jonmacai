# Dashboard 2 Pending (jonmac.ai/dashboard-2/#pending)

Jon's checklist of what he asked the team for. View only: it reads cards and open questions and changes nothing.

- Which cards: every card whose title says Jon's ask (`Jon's ask: ...` or `... (Jon's ask via Ana)`, straight or curly apostrophe). Cancelled cards are left out. There is no separate flag on a card; this is the marker the team uses (CORE.md: "marked as Jon's ask").
- Groups, in this order:
  - Done: status done, ticked, newest first.
  - In progress: not started, in production, in QC, in Review; by due day, no due time last.
  - Blocked: waiting on Jon, or an open bot question tied to the card, or a note line that starts with `Blocked`. The row says what is needed and from whom (you, or the first team name on the Blocked line, else "Not named on the card").
- Each row: card title, owner (first name), status, due (`Due Nov 13`, `Late` in red when past, `No due time set` when none) and last update (`Updated 3 hr ago`, `Done 2 hr ago`). A row opens its card.
- Data: `pending` in the `GET /dashboard/api/d2` answer, next to `d2` (`src/pending.js`; null when the cards cannot be read, and the page then says so). Not part of `d2`, so the other pages' contract is unchanged.
- Code: `src/pending.js`, `public/d2/js/pages/pending.js`, `test/pending.test.mjs`. Only a nav line (`index.html`), a route entry (`app.js`) and two `export`s in `src/d2.js` (`nameOf`, `plain`) touch shared files.
