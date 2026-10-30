// The webinar offer's price, still open with Jon ($997 or $1,997). This is the only line to change:
// pages show it wherever they say {{OFFER_PRICE}}, and the nurture emails get it as event.offer_price.
export const OFFER_PRICE_USD = 997;
export const OFFER_PRICE = '$' + OFFER_PRICE_USD.toLocaleString('en-US');
