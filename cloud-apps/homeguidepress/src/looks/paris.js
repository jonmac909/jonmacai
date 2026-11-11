// The French Wardrobe After 60 (Claudine Marchand) in the look of the source channel's own book page, styleneverages.com:
// the same sections in the same order (big book and Buy, the film, a note from the author, the book on a tablet and a phone,
// a page slider, a handwritten note, what you get, the parts and Buy again on a pink band, a second note, questions,
// black footer, buy bar). Server-rendered, no JavaScript: the slider runs on radio buttons, the buy bar on a scroll timeline.
// Every fact comes from the book PDF or products.js; quotes are the book's own words, page numbers are the book's.
import { BRAND, LINK_DAYS, REFUND_DAYS, SUPPORT_EMAIL, priceText } from '../products.js';
import { esc, faqItems } from '../pages.js';

const A = '/looks/paris/';

// Real pages of the PDF, by printed page number.
const SLIDES = [
  [9, 'See it like a stranger', 'A photograph and a tip: step back from a long mirror and look for three seconds.'],
  [4, 'Contents', 'Twelve chapters in four parts, from the closet you have to the day you have.'],
  [16, 'The fit check', 'Ten checks in one long mirror, from the shoulder seam to the trouser hem.'],
  [34, 'The capsule', 'A sample week of seven outfits, all from the same thirteen pieces.'],
  [40, 'Your colors', 'The color right under your chin, tested in daylight before you trust it.'],
  [60, 'Step by step', 'Scarf ties in numbered steps. Try each one once, then keep the two you like.'],
  [64, 'Real days', 'Outfit formulas for the market, lunch with friends and a family celebration.'],
  [73, 'Before I buy', 'The checklist to take shopping, and a last word from Claudine.'],
];

const FACTS = [
  [4, 'parts, from the closet you have to the day you have'],
  [10, 'habits that quietly add years, each with an easy swap'],
  [1, 'long mirror is all the fit check needs'],
  [30, 'outfits from one capsule of twelve to fifteen pieces'],
  [8, 'outfit formulas for real days'],
  [12, 'checklists and worksheets to print and fill in'],
];

const EXTRA_FAQ = [
  ['Is this a printed book?', 'No. It is a PDF e-book you download right after you pay, and nothing is shipped. You can print the checklists and worksheets at home for your own use.'],
  ['What can I read it on?', 'Any phone, tablet or computer. It is one PDF: full pages on a tablet or computer, and the same pages on a phone, where you can zoom in.'],
];

const ICON = {
  tablet: '<svg class="ed-ic" viewBox="0 0 30 35" aria-hidden="true"><rect x="2" y="2" width="26" height="31" rx="3"/><path d="M12 28.5h6"/></svg>',
  phone: '<svg class="ed-ic" viewBox="0 0 30 35" aria-hidden="true"><rect x="7" y="2" width="16" height="31" rx="3"/><path d="M13 6h4"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
};

// One rule set per page of the slider: move the rail, show that page's arrows, fill its dot, show its count.
const sliderCss = SLIDES.map((_, i) => `#pg${i}:checked~.slide-stage .slide-rail{transform:translateX(-${i * 100}%)}`
  + `@media(min-width:700px){#pg${i}:checked~.slide-stage .a${i}{display:inline-flex}}`
  + `#pg${i}:checked~.slide-nav .t${i}::after{background:var(--ink)}#pg${i}:checked~.slide-nav .c${i}{display:inline}`).join('\n');

export function parisLook(p, { checkoutReady, query = '' }) {
  const price = priceText(p);
  const host = p.persona.host;
  const first = host.split(' ')[0];
  const go = `/go/${p.key}${esc(query)}`;
  const buy = (cls, label) => checkoutReady
    ? `<a class="${cls}" href="${go}">${label}</a>`
    : `<p class="${cls} off" aria-disabled="true">Checkout opens soon</p>`;
  const bigBuy = shine => buy(`btn btn--big${shine ? ' btn--shine' : ''}`, `<span>Get the e-book <span class="btn-price">· ${price}</span></span>`);
  const priceRow = `<div class="price-row"><span class="price-now"><span class="price-big">${price}</span><span class="price-cur">USD</span></span></div><p class="price-note">PDF e-book, instant download. One payment, no subscription.</p>`;
  const note = (face, quote) => `<aside class="divider" aria-label="A note from ${esc(first)}">
  <figure class="note note--wide wrap">
    <img class="note-face" src="${A}${face}" width="320" height="320" alt="" loading="lazy">
    <blockquote>“${esc(quote)}”</blockquote>
    <figcaption>${esc(first)}</figcaption>
  </figure>
</aside>`;
  const faq = [...EXTRA_FAQ, ...faqItems(p)];
  const n = SLIDES.length;

  const body = `<a class="skip" href="#main">Skip to the main content</a>

<header class="site-header"><div class="wrap">
  <a class="brand" href="#top">${esc(p.title)}</a>
  <nav class="nav" aria-label="Page sections"><a href="#claudine">${esc(first)}</a><a href="#inside">Inside</a><a href="#faq">Questions</a></nav>
</div></header>

<main id="main">

<section class="hero" id="top" aria-labelledby="hero-title"><div class="wrap hero-grid">
  <div class="hero-book"><img src="${A}book.jpg" width="900" height="900" alt="The e-book ${esc(p.title)}, shown as a book, its cover readable" fetchpriority="high"><span class="ebook-badge">PDF e-book</span></div>
  <div class="hero-buy">
    <h1 id="hero-title">${esc(p.title)}</h1>
    <p class="hero-sub">French Style for Women Over 60</p>
    <p class="hero-motto">Less but better.</p>
    ${priceRow}
    ${bigBuy(true)}
    <ul class="ticks">
      <li>12 chapters in 4 parts</li>
      <li>12 checklists and worksheets to print</li>
      <li>${REFUND_DAYS}-day money-back guarantee</li>
    </ul>
  </div>
  <p class="hero-footnote"><b>Good to know:</b> it's an <span class="nb">e-book</span> (PDF), not a printed book. One file that opens on your phone, tablet or computer, and the checklists print at home.</p>
</div></section>

<section class="watch" id="watch" aria-labelledby="watch-title"><div class="wrap">
  <p class="eyebrow center">${esc(first)} explains</p>
  <h2 id="watch-title" class="center">One question before you buy</h2>
  <p class="center lead watch-lead">From ${esc(first)}'s channel: clothes have to work in your life, your closet and your own home. Twenty seconds.</p>
  <div class="player">
    <div class="player-box player-box--wide"><video controls playsinline preload="none" poster="${A}claudine-wide.jpg" width="1280" height="720" aria-label="${esc(first)} on choosing clothes that work at home"><source src="${A}claudine-wide.mp4" type="video/mp4"><track kind="captions" src="${A}claudine-intro.vtt" srclang="en" label="English"></video></div>
    <div class="player-box player-box--tall"><video controls playsinline preload="none" poster="${A}claudine-tall.jpg" width="540" height="960" aria-label="${esc(first)} on choosing clothes that work at home"><source src="${A}claudine-tall.mp4" type="video/mp4"><track kind="captions" src="${A}claudine-intro.vtt" srclang="en" label="English"></video></div>
  </div>
</div></section>

<section class="section section--blush" id="claudine" aria-labelledby="claudine-title"><div class="wrap author">
  <div class="author-photo"><img src="${A}claudine-portrait.jpg" width="760" height="984" alt="${esc(host)}" loading="lazy"></div>
  <div class="author-text">
    <p class="eyebrow">A note from ${esc(first)}</p>
    <h2 id="claudine-title">“The goal is not to look younger. The goal is to look like yourself.”</h2>
    <p>Bonjour, my dear friends. The habits that add years to an outfit creep in for good reasons, like comfort or convenience. The French idea is less but better: fewer things, chosen with care, worn with a little attention.</p>
    <p>Keep whatever already works for you. Swap only what you recognize.</p>
    <p class="goodbye">À bientôt, see you very soon.</p>
    <p class="signature">${esc(first)}</p>
  </div>
</div></section>

<section class="screens" aria-labelledby="screens-title"><div class="wrap screens-grid">
  <div class="screens-pic"><img src="${A}editions.jpg" width="900" height="953" alt="The same PDF on a tablet and on a phone: the capsule chapter on the tablet, a photograph page on the phone" loading="lazy"></div>
  <div class="screens-text">
    <p class="eyebrow">One PDF, every screen</p>
    <h2 id="screens-title">Easy to read on a tablet or a computer</h2>
    <ul class="ed-list">
      <li>${ICON.tablet}<span><b>For tablets and computers.</b> Full pages with the photographs at their largest, and the checklists ready to print.</span></li>
      <li>${ICON.phone}<span><b>For phones.</b> The same PDF. Zoom in on any page, or turn the phone sideways.</span></li>
    </ul>
    <p class="ed-note">The download link is emailed right after you pay. Open it on whichever screen you like.</p>
  </div>
</div></section>

<section class="section" id="inside" aria-labelledby="inside-title"><div class="wrap">
  <h2 id="inside-title" class="center">Inside the book</h2>
  <p class="center lead">Real pages of the PDF, one at a time, just as you'll see them on your screen.</p>
  <div class="slides" role="group" aria-roledescription="carousel" aria-label="Pages from the book">
    ${SLIDES.map(([pg, b], i) => `<input class="pg-r" type="radio" name="pg" id="pg${i}"${i ? '' : ' checked'} aria-label="${i + 1} of ${n}: ${esc(b)}">`).join('')}
    <div class="slide-stage">
      <div class="arrows">${SLIDES.map((_, i) => i ? `<label class="slide-arrow a${i}" for="pg${i - 1}" aria-hidden="true">${ICON.prev}</label>` : `<span class="slide-arrow off a0" aria-hidden="true">${ICON.prev}</span>`).join('')}</div>
      <div class="slide-track"><div class="slide-rail">${SLIDES.map(([pg, b, t], i) => `<figure class="slide"><img src="${A}page-${pg}.jpg" width="900" height="1165" alt="Page ${pg} of the book: ${esc(b)}" loading="lazy"><figcaption><b>${esc(b)}</b> ${esc(t)}</figcaption></figure>`).join('')}</div></div>
      <div class="arrows">${SLIDES.map((_, i) => i < n - 1 ? `<label class="slide-arrow a${i}" for="pg${i + 1}" aria-hidden="true">${ICON.next}</label>` : `<span class="slide-arrow off a${i}" aria-hidden="true">${ICON.next}</span>`).join('')}</div>
    </div>
    <div class="slide-nav" aria-hidden="true"><div class="slide-dots">${SLIDES.map((_, i) => `<label class="slide-tab t${i}" for="pg${i}"></label>`).join('')}</div><p class="slide-count">${SLIDES.map((_, i) => `<span class="c${i}">${i + 1}</span>`).join('')} of ${n}</p></div>
  </div>
</div></section>

${note('claudine-face-1.jpg', 'A plain piece that fits beats a fine piece that does not.')}

<section class="section" id="get" aria-labelledby="get-title"><div class="wrap get">
  <figure class="get-pic"><img src="${A}claudine-seated.jpg" width="720" height="1080" alt="${esc(host)}" loading="lazy"><figcaption class="hand-note">“The French idea is a smaller closet that is entirely yours.”</figcaption></figure>
  <div class="get-text">
    <h2 id="get-title">What you get</h2>
    <ul class="facts">${FACTS.map(([b, t]) => `<li><b>${b}</b><span>${esc(t)}</span></li>`).join('')}</ul>
  </div>
</div></section>

<section class="section section--pink" id="parts" aria-labelledby="parts-title"><div class="wrap parts">
  <div class="parts-book"><img src="${A}book-front.jpg" width="900" height="900" alt="The book ${esc(p.title)} standing upright, its cover facing you" loading="lazy"></div>
  <div class="parts-text">
    <h2 id="parts-title">Four parts, one calm wardrobe</h2>
    <ol class="part-list">${p.chapters.map(([h, t], i) => `<li><span class="part-n">${i + 1}</span><span><b>${esc(h)}</b>${esc(t)}</span></li>`).join('')}</ol>
    <div class="buy-again" id="buy">${priceRow}${bigBuy(false)}</div>
  </div>
</div></section>

${note('claudine-face-2.jpg', 'A closet is not a project to finish. It is a quiet conversation between you and your days.')}

<section class="section" id="faq" aria-labelledby="faq-title"><div class="wrap narrow">
  <h2 id="faq-title" class="center">Questions</h2>
  <p class="guarantee"><strong>${REFUND_DAYS}-day money-back guarantee.</strong> Read it, try the fit check, open your closet. If the book isn't for you, email us within ${REFUND_DAYS} days and we'll refund you in full. You don't need to give a reason.</p>
  <div class="faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><div class="a"><p>${esc(a)}</p></div></details>`).join('\n    ')}</div>
</div></section>

</main>

<footer class="site-footer"><div class="wrap">
  <p class="foot-brand">${esc(p.title)}</p>
  <ul class="foot-links"><li><a href="/privacy">Privacy</a></li><li><a href="/terms">Terms</a></li><li><a href="/refunds">Refund Policy</a></li><li><a href="mailto:${SUPPORT_EMAIL}">Contact</a></li></ul>
  <p>Questions? Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
  <p>A PDF e-book: nothing is shipped. The download link is emailed right after you pay and works for ${LINK_DAYS} days. Payments are processed by Commas.</p>
  <p>${esc(p.notice)}</p>
  <p>${esc(host)} is an AI-created character.</p>
  <p>© 2026 ${esc(BRAND)}. All rights reserved.</p>
</div></footer>

<div class="buybar"><div class="buybar-in">
  <div class="buybar-text"><span class="buybar-title">${esc(p.title)} · PDF e-book</span><span class="buybar-price">${price} USD <small>One payment</small></span><span class="buybar-kind">PDF e-book · instant download</span></div>
  ${buy('btn', 'Get the e-book')}
</div></div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(p.title)} | ${esc(BRAND)}</title>
<meta name="description" content="${esc(p.lede)}">
<link rel="stylesheet" href="/looks/paris.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${sliderCss}</style>
</head>
<body class="paris-look">
${body}
</body>
</html>`;
}
