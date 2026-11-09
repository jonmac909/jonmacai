// The Christmas Home Plan (Eleanor Whitfield) in the look of the source channel's own sales page,
// publy.store/t/nAgYA0E (Decor With Dorothy): same sections in the same order, same type, colours and spacing.
// Ours differs only in the author, book, cover, price, brand and copy. The source's buyer counts and star-style
// scores have no honest equivalent here, so those slots carry facts instead (the refund promise, what's covered).
// Every claim comes from the book PDF (120 pages, 18 chapters in 6 parts) or products.js.
// Server-rendered, no JavaScript: the buy bar and the brand pill move with CSS scroll timelines.
import { BRAND, LINK_DAYS, REFUND_DAYS, SUPPORT_EMAIL, priceText } from '../products.js';
import { esc, faqItems } from '../pages.js';

const A = '/looks/eleanor/';

// The source's icon set (24px stroke icons and 20px marks).
const ico = d => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  list: ico('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 5.8l1.2 1.3L7.4 4.6M4 11.8l1.2 1.3 2.2-2.5M4 17.8l1.2 1.3 2.2-2.5"/>'),
  download: ico('<path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/>'),
  phone: ico('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
  lock: ico('<rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>'),
  shield: ico('<path d="M12 3 5 5.8v5.4c0 4.2 2.9 7.6 7 9.3 4.1-1.7 7-5.1 7-9.3V5.8Z"/><path d="m9 12 2.2 2.2L15.5 10"/>'),
  layers: ico('<path d="m12 3.5 8.5 4.3L12 12 3.5 7.8Z"/><path d="m3.5 12 8.5 4.2 8.5-4.2M3.5 16.2 12 20.5l8.5-4.3"/>'),
  compass: ico('<circle cx="12" cy="12" r="8.5"/><path d="m15 9-1.8 4.2L9 15l1.8-4.2Z"/>'),
  person: ico('<circle cx="12" cy="4.6" r="2.1"/><path d="M5 9.5h14M12 9v5.5M8.5 21l3.5-6.5 3.5 6.5"/>'),
  clock: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  target: ico('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>'),
  spark: ico('<path d="M12 3.5 13.9 9l5.6 2-5.6 2-1.9 5.5L10.1 13 4.5 11l5.6-2Z"/>'),
  book: ico('<path d="M4 4.5h6.5A2.5 2.5 0 0 1 13 7v13a2 2 0 0 0-2-2H4Z"/><path d="M20 4.5h-6.5A2.5 2.5 0 0 0 11 7v13a2 2 0 0 1 2-2h7Z"/>'),
};
const tick = (w = 15) => `<svg viewBox="0 0 20 20" width="${w}" height="${w}" aria-hidden="true"><path fill="currentColor" d="M8.2 13.3 4.9 10l-1.1 1.1 4.4 4.4 9-9L16.1 5.4z"/></svg>`;
const cross = `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6 5 5 6l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4z"/></svg>`;
const arrow = `<span class="cta-arrow"><svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M11.3 4.3 10.2 5.4 13.9 9H3v1.5h10.9l-3.7 3.6 1.1 1.1L17 9.75z"/></svg></span>`;

// The source sets every heading in title case.
const titleCase = s => s.replace(/\.$/, '').split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

const SPECS = [[I.list, '18 chapters', 'Cover to cover'], [I.download, 'Instant access', 'Right after checkout'], [I.phone, 'Any device', 'Phone, tablet, desktop'], [I.lock, 'One payment', 'Yours forever']];

// Chapter 1 and chapter 7.
const PAINS = [
  'The boxes come down, the lids come off and everything goes out at once.',
  'A few days later the house feels busy rather than festive, and there is a pull to go out and buy something new to fix it.',
  'The tree has plenty of lights and still looks flat in the evening, because the strands sit on the outside.',
];

// Chapters 1, 2 and 7.
const MYTHS = [
  ['Buy something new to fix it', 'New things often add to the clutter. The answer is usually fewer pieces, placed with more care.'],
  ['Decorate every surface', 'Choose one star spot per room. Everything else in the room supports it.'],
  ['More lights on the outside', 'Light the tree from the trunk out, and it glows from deep inside.'],
  ['Use every color you own', 'Two or three colors, one metal and one ribbon make every room feel like one home.'],
];

// Chapters 1, 2, 3, 7 and 17.
const BENEFITS = [
  [I.shield, 'Walk your rooms once and choose one star spot for each.'],
  [I.layers, 'Pick two or three colors, one metal and one ribbon for the whole house.'],
  [I.compass, 'Sort every box into keep, fix and let go in one afternoon.'],
  [I.person, 'Light a tree from the trunk out so it glows from deep inside.'],
  [I.clock, 'Use one phone photo to see what a room still needs before guests arrive.'],
];

const NOT_FOR = [
  'You want a shopping list of new decorations to buy.',
  'You want trend advice, brand names or a store guide.',
  'You want a printed book in the mail. It is a PDF, and you can print the checklists.',
];

// The six parts, from the contents page.
const PARTS = [[I.shield, '3 chapters'], [I.layers, '2 chapters'], [I.compass, '3 chapters'], [I.target, '6 chapters'], [I.spark, '2 chapters'], [I.book, '2 chapters']];

// What the book covers and leaves out. Pips show coverage, not a score.
const RATES = [
  ['hi', 5, 'Room by room, front door to guest room', 'Six chapters, from the porch to the quiet rooms.', 'Covered'],
  ['hi', 5, 'Evening light, the tree and its lights', 'Five chapters, from layered light to the topper.', 'Covered'],
  ['hi', 5, 'Natural and handmade pieces', 'Fresh greenery, plus five easy projects made at the kitchen table.', 'Covered'],
  ['mid', 3, 'Safety with lights, cords and candles', 'Plain rules and a checklist. Not electrical advice: ask a licensed electrician.', 'Basics'],
  ['lo', 1, 'Shopping lists, brands and trends', 'Not in it. It works from what is already in your boxes.', 'Not in it'],
];

// Real pages: the top of four chapters.
const LOOK = [[6, 'Chapter 1, Start With a Plan, Not a Shopping Trip'], [46, 'Chapter 7, Lighting the Tree So It Glows'], [65, 'Chapter 10, The Mantel and Fireplace'], [77, 'Chapter 12, The Dining Table and Centerpieces']];

// Chapters 1, 3, 7 and 18.
const WITHOUT = [
  'Everything comes out of the boxes at once, and the house feels busy within days.',
  'The lights go around the outside of the tree, and it looks flat at night.',
  'Another trip to the store for something new to fix the room.',
  'Everything goes back in the boxes by type, and next year starts with tangles.',
];
const WITH = [
  'A slow walk first, and one star spot in each room.',
  'Lights wound from the trunk out, so the tree glows from inside.',
  'What you already own, grouped, placed and lit with care.',
  'Boxes packed by room, so next year starts with open boxes, not tangles.',
];

const OFFER = [
  'The plan: one star spot per room, two or three colors and one ribbon',
  'Layered evening light, and the routine for safe lights, cords and candles',
  'The tree, from choosing and placing it to lights, ornaments and the topper',
  'Room by room, from the front door to the guest room',
  'Printable checklists and worksheets, and a pack-away that makes next year easy',
];

export function eleanorLook(p, { checkoutReady, query = '' }) {
  const price = priceText(p);
  const host = p.persona.host;
  const headline = titleCase(p.headline);
  const buy = (cls = 'cta cta-lg') => checkoutReady
    ? `<a class="${cls}" href="/go/${p.key}${esc(query)}">Get My Christmas Home Plan <span class="cta-price">${price}</span> ${arrow}</a>`
    : `<span class="${cls} cta-off" aria-disabled="true">Checkout opens soon</span>`;
  const avatar = (w, alt = '') => `<img src="${A}eleanor.jpg" alt="${esc(alt)}" width="${w}" height="${w}">`;
  const head = (eyebrow, h2) => `<div class="head"><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(h2)}</h2></div>`;

  const body = `<header class="nav"><div class="wrap nav-in">
  <a class="brand" href="#top">${avatar(26)}${esc(host)}</a>
</div></header>

<div class="hero-band" id="top"><div class="wrap"><div class="hero">
  <div class="hero-copy">
    <span class="pill">${avatar(20)}${esc(host)}</span>
    <div class="kicker">${esc(p.kicker)}</div>
    <h1>${esc(headline)}</h1>
    <p class="sub">${esc(host.split(' ')[0])}'s plan for decorating with what you already own: one star spot per room, two or three colors and one ribbon, a tree that glows from inside, and a pack-away that makes next year easy.</p>
    <div class="hero-actions">
      <div class="buybox">
        <div class="buybox-price"><span class="buybox-figure">${price}</span><span class="buybox-terms"><strong>once, yours forever</strong><span>No subscription. Nothing to cancel.</span></span></div>
        ${buy()}
        <p class="microcopy">Instant PDF. 18 chapters.</p>
      </div>
    </div>
    <div class="hero-proof"><span>${tick()}<b>${REFUND_DAYS}-day</b> money-back guarantee</span></div>
  </div>
  <div class="cover-stage"><div class="cover"><img src="${esc(p.coverImage)}" alt="Cover of ${esc(p.title)}" width="680" height="880"></div></div>
</div></div></div>

<section class="tight specs-sec"><div class="wrap"><div class="specs">${SPECS.map(([i, v, l]) => `<div class="spec"><span class="spec-i">${i}</span><span class="spec-v">${esc(v)}</span><span class="spec-l">${esc(l)}</span></div>`).join('')}</div></div></section>

<section class="proofbar"><div class="wrap"><p>One payment. 18 chapters. Yours to keep.</p></div></section>

<section class="band-dark"><div class="wrap">
  ${head('The Problem', 'The House That Looks Busy Instead Of Finished')}
  <ul class="pains">${PAINS.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
  <p class="pain-close">The trouble is rarely a lack of decorations. It is a lack of a plan.</p>
</div></section>

<section><div class="wrap">
  ${head('Stop Believing', 'What You Have Been Told')}
  <ul class="myths">${MYTHS.map(([h, t]) => `<li class="myth"><span class="myth-mark">${cross}</span><div><strong>${esc(h)}</strong><span>${esc(t)}</span></div></li>`).join('')}</ul>
</div></section>

<div class="art-band" role="presentation"></div>

<section><div class="wrap shift">
  <div class="eyebrow">The Shift</div>
  <p class="lede">A finished Christmas home isn't bought. It's planned, lit and placed, with what is already in your boxes.</p>
  <p class="shift-body">The 18 chapters follow the order the work happens: plan the rooms, light them, dress the tree, finish room by room, add a few natural and handmade pieces, then pack away so next year is easy. No brands, no store guides.</p>
</div></section>

<section class="surface"><div class="wrap">
  ${head('Why It Works', 'What You Walk Away Able To Do')}
  <ul class="benefits">${BENEFITS.map(([i, t]) => `<li class="benefit"><span class="bi">${i}</span><span>${esc(t)}</span></li>`).join('')}</ul>
</div></section>

<section class="surface"><div class="wrap">
  ${head('Is This You', 'Who This Is For')}
  <div class="cols">
    <div class="col col-yes"><h3><span class="ck">${tick()}</span> This Is For You If</h3><ul>${p.forWho.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
    <div class="col col-no"><h3><span class="ck ck-no">${cross}</span> Not For You If</h3><ul>${NOT_FOR.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
  </div>
</div></section>

<section><div class="wrap">
  ${head('Inside', 'What You Get')}
  <div class="inside-cards">${p.chapters.map(([h, t], i) => `<div class="ic"><span class="bi">${PARTS[i][0]}</span><div><span class="ic-num">${String(i + 1).padStart(2, '0')}</span><strong>${esc(titleCase(h))}</strong><span>${esc(t)}</span></div><span class="ic-tag">${PARTS[i][1]}</span></div>`).join('')}</div>
  <p class="inside-note">This is a digital PDF book, not a printed book, a kit or decorations. Nothing is mailed.</p>
</div></section>

<section><div class="wrap">
  ${head('What It Covers', 'And What It Does Not')}
  <p class="rate-sub">Eighteen chapters in six parts, and what they leave out.</p>
  <ul class="rates">${RATES.map(([k, n, label, note, score]) => `<li class="rate-row rate-${k}">
    <span class="rate-label">${esc(label)}</span>
    <span class="rate-pips" role="img" aria-label="${esc(score)}">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(5 - n)}</span>
    <span class="rate-note">${esc(note)}</span>
    <span class="rate-score">${esc(score)}</span>
  </li>`).join('')}</ul>
</div></section>

<section class="surface"><div class="wrap">
  ${head('Look Inside', 'Real Pages From The Book')}
  <div class="pages">${LOOK.map(([n, what]) => `<div class="pg-frame"><img class="pg" src="${A}page-${n}.jpg" alt="Page ${n} of the book: ${esc(what)}" width="900" height="1165" loading="lazy"></div>`).join('')}</div>
</div></section>

<section><div class="wrap">
  ${head('The Difference', 'Before And After')}
  <div class="cmp">
    <div class="cmp-col cmp-without"><div class="cmp-h">Without It</div>${WITHOUT.map(t => `<div class="cmp-row"><span class="ck ck-no">${cross}</span><span>${esc(t)}</span></div>`).join('')}</div>
    <div class="cmp-col cmp-with"><div class="cmp-h">With ${esc(p.title)}</div>${WITH.map(t => `<div class="cmp-row"><span class="ck">${tick()}</span><span>${esc(t)}</span></div>`).join('')}</div>
  </div>
</div></section>

<section><div class="wrap"><div class="band-accent">
  <h2>This Year's Look Is Already In Your Boxes</h2>
  <p>Walk your rooms once, pick one star spot for each, and sort every box into keep, fix and let go before you buy a thing.</p>
  ${buy('cta cta-inv')}
</div></div></section>

<section class="surface"><div class="wrap">
  ${head('About', 'Who Wrote This')}
  <div class="about">${avatar(92, host)}<div>
    <p>I wrote this book for anyone who wants a Christmas home that looks finished, feels cozy and stays safe, without a full shopping cart. It follows the order the work really happens: plan, light, the tree, then room by room, with what is already in your boxes.</p>
    <div class="cred"><span>Room by room, 18 chapters</span><span>Printable checklists</span></div>
    <p class="cred-line">${esc(host)} is an AI-created character. The book gives general decorating ideas, not electrical or fire safety advice.</p>
  </div></div>
</div></section>

<section class="tinted"><div class="wrap">
  ${head('The Offer', 'A Finished Christmas Home, Planned Room By Room')}
  <div class="offer">
    <p class="offer-sub">${esc(p.format.replace(/^PDF guide, /, ''))}. Plan once, then decorate every room after.</p>
    <div class="offer-head">What You Get</div>
    <ul class="offer-lines">${OFFER.map(t => `<li><span class="ck">${tick()}</span><span class="ov-line">${esc(t)}</span></li>`).join('')}</ul>
    <div class="offer-price"><span class="offer-now">${price}</span></div>
    <div class="offer-cta">${buy()}</div>
    <div class="offer-trust"><span>${I.lock}Secure checkout</span><span>${I.download}Instant download</span><span>${I.phone}Any device</span></div>
  </div>
</div></section>

<section class="tight"><div class="wrap"><div class="guarantee">
  <div class="g-item"><span class="bi">${I.download}</span><div><strong>Instant Access</strong><span>The download link is emailed right after you pay.</span></div></div>
  <div class="g-item"><span class="bi">${I.book}</span><div><strong>Yours To Keep</strong><span>One payment, read on any device.</span></div></div>
  <div class="g-item"><span class="bi">${I.shield}</span><div><strong>${REFUND_DAYS}-Day Money Back</strong><span>Email us within ${REFUND_DAYS} days for a full refund.</span></div></div>
</div></div></section>

<section><div class="wrap">
  ${head('FAQ', 'The Questions Buyers Ask')}
  ${faqItems(p).map(([q, a]) => `<div class="qa"><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join('\n  ')}
</div></section>

<section><div class="wrap"><div class="band-accent">
  <h2>Plan The Rooms Before You Open Another Box</h2>
  <p>Eighteen chapters with printable checklists and worksheets. ${price} once, yours to keep.</p>
  ${buy('cta cta-inv')}
</div></div></section>

<a class="madepill" href="/" aria-label="Published by ${esc(BRAND)}"><span class="madepill-lead">Published by</span><span class="madepill-mark">${esc(BRAND)}</span></a>

<footer><div class="wrap">
  <a class="powered-by" href="/"><span class="powered">Published by</span><span class="publisher">${esc(BRAND)}</span></a>
  <p>Questions before you buy, or lost your link? Write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. Download links work for ${LINK_DAYS} days, and we'll send a fresh one any time.</p>
  <p>${esc(p.title)} is a digital book (PDF). Nothing is shipped. One payment, no subscription. ${REFUND_DAYS}-day money-back guarantee.</p>
  <p class="notice">${esc(p.notice)}</p>
  <p>${esc(host)} is an AI-created character.</p>
  <div class="legal"><a href="/refunds">Refunds</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:${SUPPORT_EMAIL}">Contact</a></div>
  <p>© 2026 ${esc(BRAND)}. Payments are processed by Commas.</p>
</div></footer>

<div class="buybar"><div class="wrap buybar-in">
  <span class="buybar-title">${esc(headline)}</span>
  ${buy('cta')}
</div></div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(p.title)} | ${esc(BRAND)}</title>
<meta name="description" content="${esc(p.lede)}">
<link rel="preload" href="${A}fonts/fraunces-latin-var.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${A}fonts/general-sans-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/looks/eleanor.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body class="eleanor-look">
${body}
</body>
</html>`;
}
