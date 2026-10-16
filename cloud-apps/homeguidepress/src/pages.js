// Server-rendered HTML for homeguidepress.com. No client JavaScript.
// Large type and high contrast: most visitors come from YouTube and are older.
import { BRAND, BY_KEY, LINK_DAYS, PRODUCTS, REFUND_DAYS, STATEMENT_NAME, SUPPORT_EMAIL, byline, priceText } from './products.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ title, description = '', body, product = null }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
<header class="top"><a href="/" class="brand">${esc(BRAND)}</a></header>
<main>
${body}
</main>
<footer class="foot">
${product?.notice ? `<p class="notice">${esc(product.notice)}</p>` : ''}
<nav><a href="/refunds">Refunds</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="mailto:${SUPPORT_EMAIL}">Contact</a></nav>
<p>© 2026 ${esc(BRAND)}. Payments are processed by Commas.</p>
</footer>
</body>
</html>`;
}

export function cover(p, size = '') {
  if (p.coverImage) return p.coverSet
    ? `<img class="cover set ${size}" src="${esc(p.coverImage)}" alt="${esc(p.coverAlt || `Covers of the 3 books in ${p.title}`)}" width="900" height="880">`
    : `<img class="cover ${size}" src="${esc(p.coverImage)}" alt="Cover of ${esc(p.title)}" width="680" height="880">`;
  return `<div class="cover art ${size}" style="--c:${p.cover.color};--a:${p.cover.accent}" role="img" aria-label="Cover of ${esc(p.title)}">
  <span class="k">${esc(p.kicker)}</span><span class="t">${esc(p.title)}</span><span class="b">${esc(byline(p))}</span></div>`;
}

function buyButton(p, checkoutReady, query) {
  if (!checkoutReady) return `<p class="buy off" aria-disabled="true">Checkout opens soon</p>`;
  return `<a class="buy" href="/go/${p.key}${query}">Buy now for ${priceText(p)}</a>`;
}

const guarantee = () => `<p class="guarantee"><strong>${REFUND_DAYS}-day money-back guarantee.</strong> If it isn't for you, email us within ${REFUND_DAYS} days for a full refund.</p>`;

export function landing(p, { checkoutReady, query = '' }) {
  const sections = [];
  if (p.promises.length) sections.push(`<section><h2>What makes it different</h2><ul class="promises">${p.promises.map(([h, t]) => `<li><strong>${esc(h)}</strong><span>${esc(t)}</span></li>`).join('')}</ul></section>`);
  sections.push(p.chapters.length
    ? `<section><h2>What's inside</h2><p class="format">${esc(p.format)}.</p><ol class="chapters${p.numbered ? ' numbered' : ''}">${p.chapters.map(([h, t]) => `<li><strong>${esc(h)}</strong><span>${esc(t)}</span></li>`).join('')}</ol></section>`
    : `<section><h2>What's inside</h2><p class="format">${esc(p.format)}.</p><p class="pending">The full chapter list goes here once the book is finished.</p></section>`);
  if (p.forWho.length) sections.push(`<section><h2>Who it's for</h2><ul class="ticks">${p.forWho.map(t => `<li>${esc(t)}</li>`).join('')}</ul>${p.notFor ? `<p>${esc(p.notFor)}</p>` : ''}</section>`);
  const faq = [...p.faq,
    ['How do I get it?', `Right after you pay, we email you a download link. Click it and save the PDF to your computer, phone or tablet. The link works for ${LINK_DAYS} days, and you can ask for a fresh one any time.`],
    ['What will my card statement say?', `Payments go through Commas, so the charge shows as ${STATEMENT_NAME}, not the book's name.`],
    ['What if I don\'t like it?', `Email ${SUPPORT_EMAIL} within ${REFUND_DAYS} days of buying and we'll refund you in full.`],
  ];
  sections.push(`<section><h2>Questions</h2><dl class="faq">${faq.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}</dl></section>`);
  const body = `<article class="product">
<section class="hero">
  ${cover(p)}
  <div class="pitch">
    <p class="kicker">${esc(p.kicker)}</p>
    <h1>${esc(p.headline)}</h1>
    <p class="lede">${esc(p.lede)}</p>
    <p class="title-line"><strong>${esc(p.title)}</strong>: ${esc(p.subtitle)}. By ${esc(byline(p))}.</p>
    <p class="price">${priceText(p)} <span>one-time payment, instant download</span></p>
    ${buyButton(p, checkoutReady, query)}
    ${guarantee(p)}
  </div>
</section>
${sections.join('\n')}
<section class="again">
  <p class="price">${priceText(p)} <span>${esc(p.format)}</span></p>
  ${buyButton(p, checkoutReady, query)}
  ${guarantee(p)}
</section>
</article>`;
  return layout({ title: `${p.title} | ${BRAND}`, description: p.lede, body, product: p });
}

export function index() {
  const body = `<section class="intro"><h1>${esc(BRAND)}</h1><p class="lede">Plain, practical guides for home, kitchen, travel and the road. Large print, no fluff, instant download.</p></section>
<ul class="shelf">${PRODUCTS.map(p => `<li><a href="/${p.path}">${cover(p, 'small')}<span class="name">${esc(p.title)}</span><span class="meta">${esc(p.kicker)} · ${priceText(p)}</span></a></li>`).join('')}</ul>`;
  return layout({ title: BRAND, description: 'Practical guides from Home Guide Press.', body });
}

function linkForm(key, label = 'Send me a new link') {
  return `<form class="relink" method="post" action="/api/resend-link">
  <label for="email">The email you used at checkout</label>
  <input id="email" name="email" type="email" autocomplete="email" required>
  <input type="hidden" name="p" value="${esc(key || '')}">
  <button type="submit">${esc(label)}</button>
</form>`;
}

export function thanks(key, sent) {
  const p = BY_KEY[key];
  const what = p ? `<strong>${esc(p.title)}</strong>` : 'your guide';
  const body = `<section class="note">
<h1>Thank you! Check your email.</h1>
<p class="lede">We've sent your download link for ${what} to the email you used at checkout. It usually arrives within a minute or two.</p>
<ul class="ticks"><li>Look in your spam or promotions folder if you don't see it.</li><li>The email comes from ${esc(p?.persona?.brand || BRAND)}.</li><li>Your card statement shows the charge as ${STATEMENT_NAME}.</li></ul>
${sent ? `<p class="ok" role="status">If that email matches a purchase, a new link is on its way.</p>` : ''}
<h2>Didn't get it?</h2>
${linkForm(key)}
<p>Still stuck? Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> and we'll sort it out.</p>
</section>`;
  return layout({ title: `Thank you | ${BRAND}`, body, product: p });
}

export function download(p, token, files) {
  const body = `<section class="note">
<h1>Your download is ready</h1>
<p class="lede">${esc(p.title)}, by ${esc(byline(p))}.</p>
<ul class="files">${files.map((f, i) => `<li><a class="buy" href="/download/${esc(token)}/${i}">Download ${esc(f.name)}</a></li>`).join('')}</ul>
<p>Save the file to your computer, phone or tablet. This link works for ${LINK_DAYS} days from the email; after that you can ask for a fresh one on <a href="/thanks?p=${p.key}">this page</a>.</p>
</section>`;
  return layout({ title: `Download | ${BRAND}`, body, product: p });
}

export function linkProblem(kind, key) {
  const text = {
    expired: ['This link has expired', `Download links work for ${LINK_DAYS} days. Enter the email you used at checkout and we'll send you a fresh one.`],
    revoked: ['This link is no longer active', `This purchase was refunded, so the download has been switched off. If you think that's a mistake, email ${SUPPORT_EMAIL}.`],
    invalid: ['We couldn\'t open that link', 'The link may be incomplete. Try clicking the button in the email again, or ask for a new link below.'],
    unavailable: ['Your file is being prepared', `We couldn't find the file just now. Please email ${SUPPORT_EMAIL} and we'll send it to you directly.`],
  }[kind];
  const body = `<section class="note"><h1>${esc(text[0])}</h1><p class="lede">${esc(text[1])}</p>${kind === 'revoked' || kind === 'unavailable' ? '' : linkForm(key)}</section>`;
  return layout({ title: `${text[0]} | ${BRAND}`, body, product: BY_KEY[key] });
}

export function notFound() {
  return layout({ title: `Page not found | ${BRAND}`, body: `<section class="note"><h1>Page not found</h1><p class="lede"><a href="/">See all our guides</a>.</p></section>` });
}

const POLICY = {
  refunds: ['Refund policy', `<p>Every ${BRAND} guide comes with a <strong>${REFUND_DAYS}-day money-back guarantee</strong>.</p>
<p>If a guide isn't right for you, email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> within ${REFUND_DAYS} days of your purchase with the email address you used at checkout. We'll refund the full price to your original payment method. You don't need to give a reason.</p>
<p>Refunds usually reach your card within 5 to 10 business days, depending on your bank. When a purchase is refunded, its download link is switched off.</p>`],
  privacy: ['Privacy policy', `<p>This policy explains what ${BRAND} collects when you visit homeguidepress.com or buy a guide.</p>
<h2>What we collect</h2>
<ul><li><strong>Purchases:</strong> our payment provider, Commas, takes your payment and sends us your name, email address, the guide you bought and the amount. We never see or store your card details.</li>
<li><strong>Delivery:</strong> we use your email address to send your download link and, if you ask, a fresh link. We send these emails through Resend.</li>
<li><strong>Visits:</strong> we count page visits and button clicks per guide, with the link you came from (for example which video) and your country. We don't use advertising cookies or tracking pixels on this site.</li></ul>
<h2>What we don't do</h2>
<p>We don't sell or rent your information, and we don't add you to a marketing list. Delivery emails are the only emails we send you.</p>
<h2>Where it is stored</h2>
<p>Purchase and delivery records are kept on Cloudflare's servers for as long as we need them for support, refunds and our accounts.</p>
<h2>Your choices</h2>
<p>Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> to see, correct or delete your information.</p>`],
  terms: ['Terms of sale', `<p>These terms apply when you buy a guide from ${BRAND} on homeguidepress.com.</p>
<h2>What you get</h2>
<p>A digital guide (PDF and any listed extras) for your own personal use. You get a download link by email right after payment. Please don't share, resell or post the files.</p>
<h2>Payment</h2>
<p>Prices are in US dollars and are one-time payments. Payments are processed by Commas, and your card statement shows the charge as ${STATEMENT_NAME}.</p>
<h2>Refunds</h2>
<p>See our <a href="/refunds">refund policy</a>: full refund within ${REFUND_DAYS} days.</p>
<h2>The content</h2>
<p>Our guides give general information and practical tips. They are not medical, veterinary, legal or financial advice. Recipes, care routines and safety steps should be followed with ordinary care and common sense, and any warnings in a guide apply.</p>
<h2>Contact</h2>
<p>Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>`],
};

export function policy(kind) {
  const [title, html] = POLICY[kind];
  return layout({ title: `${title} | ${BRAND}`, body: `<section class="note policy"><h1>${esc(title)}</h1>${html}<p class="small">Last updated October 15, 2026.</p></section>` });
}
