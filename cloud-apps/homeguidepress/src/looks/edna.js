// Three Ingredients and a Pan (Edna Haynes) in the look of the source channel's own sales page,
// bakingwithcarol.gumroad.com/l/easy-baking-for-seniors (a Gumroad product page): fixed top bar, photo carousel,
// two-column card with the buy box on the right and the long description on the left, plain footer.
// Ours differs only in the author, book, cover, price and copy. The source's star ratings, rating bars and
// reviews have no honest equivalent, so that slot carries the refund promise. No JavaScript: the carousel is radio
// buttons, "Read more" is a checkbox, and the mobile buy bar moves with a CSS scroll timeline.
import { BRAND, LINK_DAYS, REFUND_DAYS, STATEMENT_NAME, SUPPORT_EMAIL, priceText } from '../products.js';
import { esc, faqItems } from '../pages.js';

const A = '/looks/three-ingredients/';
const SLIDES = [['cover.jpg', 'Cover of Three Ingredients and a Pan, Easy Baking for Every Day, by Edna Haynes'],
  ['slide-2.jpg', 'What makes it different: short ingredient lists, one pan with easy cleanup, and no mixer needed'],
  ['slide-3.jpg', 'Who it is for: a short list, easy on your hands, new or returning bakers']];

const shield = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 5.8v5.4c0 4.2 2.9 7.6 7 9.3 4.1-1.7 7-5.1 7-9.3V5.8Z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>`;
const share = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/></svg>`;
const chev = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

// The topics, from the page's own list.
const INSIDE = [
  ['Three ingredients.', 'Bakes built around three ingredients, so shopping is quick and the cupboard does most of the work.'],
  ['Bake in one pan.', 'One pan in the oven means fewer dishes once the sweet part is over.'],
  ['Stir by hand.', 'No heavy machine to lift, plug in or wash. Just a spoon and a little stirring.'],
  ['Simple sweets.', 'Homemade treats easy enough for a regular weekday, not only for holidays.'],
  ['New or coming back.', 'For beginners, and for anyone returning to the oven after years away.'],
  ['Easy to follow.', 'Plain language and short steps, so you know what comes next.'],
];
const NOT_FOR = [
  'You want fancy decorating, tall showpiece cakes or bakery pastry.',
  'You need a sugar-free, diabetic or allergy cookbook. This guide is about easy baking, not dieting.',
  'You love long weekend baking projects and own every gadget already.',
];

export function ednaLook(p, { checkoutReady, query = '' }) {
  const price = priceText(p);
  const host = p.persona.host;
  const first = host.split(' ')[0];
  const buy = (cls = 'btn') => checkoutReady
    ? `<a class="${cls}" href="/go/${p.key}${esc(query)}">Buy this</a>`
    : `<span class="${cls} off" aria-disabled="true">Checkout opens soon</span>`;
  const tag = `<span class="tag"><span>${price}</span></span>`;
  const guar = `<span class="guar">${shield}${REFUND_DAYS}-day money-back guarantee</span>`;
  const li = t => `<li>${esc(t)}</li>`;

  const body = `<header class="topbar"><div class="topbar-in">
  ${tag}
  <h3>${esc(p.title)}</h3>
  ${guar}
  ${buy('btn btn-sm')}
</div></header>

<main><article class="card">
  <figure class="covers">
    ${SLIDES.map((_, i) => `<input class="sr" type="radio" name="cover" id="c${i + 1}" aria-label="Image ${i + 1} of ${SLIDES.length}"${i ? '' : ' checked'}>`).join('\n    ')}
    ${SLIDES.map(([f, alt], i) => `<img class="slide s${i + 1}" src="${A}${f}" alt="${esc(alt)}" width="900" height="1200"${i ? ' loading="lazy"' : ''}>`).join('\n    ')}
    <div class="dots">${SLIDES.map((_, i) => `<label for="c${i + 1}"></label>`).join('')}</div>
  </figure>

  <header class="title"><h1>${esc(p.title)}</h1></header>

  <section class="price">${tag}</section>

  <section class="controls">
    <div class="buy-box">
      <p class="inc">Includes: 1 file · PDF</p>
      ${buy()}
      <p class="already">Already bought this? Your download link is in your email.</p>
      <div class="attr"><h5>Format</h5><span>${esc(p.format)}</span></div>
      <a class="btn btn-out" href="mailto:?subject=${encodeURIComponent(p.title)}">${share}Share</a>
      <p class="refund">${REFUND_DAYS}-day money-back guarantee</p>
    </div>
    <div class="box2">
      <h3>Guarantee</h3>
      <p>Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> within ${REFUND_DAYS} days of buying and we will refund you in full.</p>
      <p>Right after you pay, we email you a download link. It works for ${LINK_DAYS} days, and you can ask for a fresh one any time.</p>
      <p>Payments go through Commas, so the charge shows as ${STATEMENT_NAME}.</p>
    </div>
  </section>

  <section class="by">
    <span class="author"><span class="av" aria-hidden="true">${esc(first[0])}</span><span class="who">${esc(host)}</span></span>
    ${guar}
  </section>

  <section class="desc">
    <input class="sr" type="checkbox" id="more" aria-label="Read more">
    <div class="desc-body">
      <p>${esc(p.lede)}</p>
      <p>A PDF guide you can print, page by page, for your own kitchen. ${price} once, no subscription, and nothing ships.</p>

      <h2>What you get:</h2>
      <ul>
        <li>The guide as a PDF, with an instant download link emailed right after you pay</li>
        ${p.promises.map(([h, t]) => li(`${h}. ${t}`)).join('\n        ')}
      </ul>

      <h2>What is inside:</h2>
      ${INSIDE.map(([h, t]) => `<p><strong>${esc(h)}</strong> ${esc(t)}</p>`).join('\n      ')}

      <h2>The honest version:</h2>
      <p>${esc(p.notFor)} ${esc(p.notice)}</p>

      <h2>Who it is for:</h2>
      <ul>${p.forWho.map(li).join('')}</ul>

      <h2>Who it is not for:</h2>
      <ul>${NOT_FOR.map(li).join('')}</ul>

      <h2>About ${esc(first)}:</h2>
      <p>${esc(p.title)} is published by ${esc(BRAND)}. ${esc(host)} is an AI-created character.</p>

      <h2>FAQ</h2>
      ${faqItems(p).map(([q, a]) => `<p><strong>${esc(q)}</strong> ${esc(a)}</p>`).join('\n      ')}
    </div>
    <label class="readmore" for="more">${chev}<span>Read more</span></label>
  </section>
</article></main>

<footer><div class="foot-in">
  <a class="brand" href="/">${esc(BRAND)}</a>
  <nav><a href="/refunds">Refunds</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:${SUPPORT_EMAIL}">Contact</a></nav>
  <p>© 2026 ${esc(BRAND)}. Payments are processed by Commas.</p>
</div></footer>

<div class="buybar">${tag}${buy()}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(p.title)} | ${esc(BRAND)}</title>
<meta name="description" content="${esc(p.lede)}">
<link rel="preload" href="${A}fonts/general-sans-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/looks/three-ingredients.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body class="edna-look">
${body}
</body>
</html>`;
}
