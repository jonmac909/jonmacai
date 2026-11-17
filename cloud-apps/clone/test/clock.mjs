// Shared by the browser and live-sandbox scripts, which cannot shift the Worker's clock.
import { salesClosed } from '../src/reminder-plan.js';
export const PRE_CLOSE = new Date('2026-11-11T17:00:00Z');
// True while the Worker is not selling: NEXT_SESSION null (no live date yet) or past the sales close.
export const realClosed = salesClosed();
// Pre-close flows (checkout, lead, buyer pages) run with the page clock set before the cutoff.
export const preCloseClock = target => target.clock.install({ time: PRE_CLOSE });
