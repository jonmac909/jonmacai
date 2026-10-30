// Shared by the browser and live-sandbox scripts, which cannot shift the Worker's clock.
import { SALES_CLOSE } from '../src/reminder-plan.js';
export const PRE_CLOSE = new Date('2026-11-11T17:00:00Z');
export const realClosed = Date.now() >= SALES_CLOSE;
// Pre-close flows (checkout, lead, buyer pages) run with the page clock set before the cutoff.
export const preCloseClock = target => target.clock.install({ time: PRE_CLOSE });
