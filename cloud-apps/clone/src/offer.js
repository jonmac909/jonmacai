// The webinar offer's price, still open with Jon ($997 or $1,997). A price swap is the first line;
// change the payment plan under it only if the plan changes too. Pages show them wherever they say
// {{OFFER_PRICE}} / {{OFFER_PLAN}}; the nurture emails get event.offer_price and event.offer_plan.
export const OFFER_PRICE_USD = 997;
export const OFFER_PLAN = '3 payments of $397 — $1,191 total';
export const OFFER_PRICE = '$' + OFFER_PRICE_USD.toLocaleString('en-US');
