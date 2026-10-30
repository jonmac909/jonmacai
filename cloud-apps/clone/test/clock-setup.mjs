// Date-aware tests: the funnel stops selling at SALES_CLOSE (Nov 12, 5:30 PM PT / 8:30 PM ET).
// Loaded with node --import. Once the real clock reaches the cutoff, shift Date so the
// suite still sees a pre-close "now" (it keeps ticking, so elapsed-time checks hold).
// Tests that need a post-close time set Date.now themselves, as reminders.test.mjs does.
import { SALES_CLOSE } from '../src/reminder-plan.js';

const RealDate = Date, PRE_CLOSE = RealDate.UTC(2026, 10, 11, 17, 0, 0);
const shift = RealDate.now() >= SALES_CLOSE - 86400000 ? RealDate.now() - PRE_CLOSE : 0;
if (shift) {
  globalThis.Date = class extends RealDate {
    constructor(...args) { args.length ? super(...args) : super(RealDate.now() - shift); }
    static now() { return RealDate.now() - shift; }
  };
  console.log('clock-setup: real time is past the Nov 12 sales close, tests run with Date shifted to ' + new Date().toISOString());
}
