// Date-aware tests: the funnel stops selling at SALES_CLOSE (Oct 29, 6:45 PM ET).
// Loaded with node --import. Once the real clock reaches the cutoff, shift Date so the
// suite still sees a pre-close "now" (it keeps ticking, so elapsed-time checks hold).
// Tests that need a post-close time set Date.now themselves, as reminders.test.mjs does.
import { SALES_CLOSE } from '../src/reminder-plan.js';

const RealDate = Date, PRE_CLOSE = RealDate.UTC(2026, 9, 28, 16, 0, 0);
const shift = RealDate.now() >= SALES_CLOSE - 86400000 ? RealDate.now() - PRE_CLOSE : 0;
if (shift) {
  globalThis.Date = class extends RealDate {
    constructor(...args) { args.length ? super(...args) : super(RealDate.now() - shift); }
    static now() { return RealDate.now() - shift; }
  };
  console.log('clock-setup: real time is past the Oct 29 sales close, tests run with Date shifted to ' + new Date().toISOString());
}
