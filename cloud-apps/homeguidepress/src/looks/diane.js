// The Safe House Guide (Diane Kowalski) in the look of the source channel's own sales page, jackieshawsafety.com:
// cream paper, navy type, one red accent, serif headlines set left, a small red label over every section, thin rules,
// alternating bands. Server-rendered, no JavaScript (the lightbox and the buy bar are CSS only).
// Every fact here comes from the book PDF or products.js; page numbers are the book's own.
import { BRAND, LINK_DAYS, REFUND_DAYS, SUPPORT_EMAIL, priceText } from '../products.js';
import { esc, faqItems, guarantee } from '../pages.js';

const A = '/looks/diane/';

// The contents page: 12 chapters in 4 parts, with the pages each part runs.
const PARTS = [
  { img: 'part-1.jpg', first: 1, pages: '5 to 20', chapters: ['See Your Home Like a Stranger', 'Habits That Say Someone Is Home', 'Your Safety Plan on One Page'] },
  { img: 'part-2.jpg', first: 4, pages: '21 to 36', chapters: ['The Front Door That Holds', 'Windows, Sliding Doors and the Garage', 'Outdoor Lighting and a Clear View'] },
  { img: 'part-3.jpg', first: 7, pages: '37 to 52', chapters: ['The Knock at the Door', 'Phone, Mail and Online Tricks', 'Keys, Codes and What You Share'] },
  { img: 'part-4.jpg', first: 10, pages: '53 to 69', chapters: ['A Calm Night Routine', 'When You Are Away', 'Fire, Smoke and Everyday Emergencies'] },
];

// Chapters 7, 8 and 2.
const PAINS = [
  ['The knock', 'A knock comes when you are not expecting one. Your heart jumps, you glance at the clock, and you wonder what to do.'],
  ['The call', 'A call, a text or a letter says something is wrong and you must act now. That jolt is exactly what the sender is aiming for.'],
  ['The house that talks', 'Piled mail, curtains that never move, a first name on the mat. A stranger reads these clues from the sidewalk in a few seconds.'],
];

// Chapters 1 and 2: what a passer-by reads, and the fix the book gives for each, with its page.
const READS = [
  ['Mail piled in the box, packages on the step', 'no one is home'],
  ['A spare key under the mat or in a flowerpot', 'where he looks first'],
  ['The same dark windows every evening', 'looks empty'],
  ['Curtains and blinds that never move', 'looks unused'],
  ['Your first name and “Ms.” on the mat or mailbox', 'one woman lives here'],
];
const FIXES = [
  ['Mail picked up every day, or by a neighbor you trust', 'page 12'],
  ['The key brought inside; the spare goes to a person you trust', 'page 7'],
  ['Two lamps on timers, in two rooms, at their own times', 'page 11'],
  ['Curtains closed at dusk and opened in the morning', 'page 12'],
  ['A plain mat, and your last name or initials on the mailbox', 'page 13'],
];

const FINDS = [
  ['The hiding spot everyone guesses, and a better home for the spare key', 7],
  ['The walk after dark, and the one question to ask at the end of your path', 7],
  ['Lights in more than one room, on timers that change', 11],
  ['Never announce that you live alone: the voicemail, the doormat, the posts', 13],
  ['Your safety plan on one page, made while you are calm', 16],
  ['The front door that holds', 22],
  ['The one rule that makes every knock easier', 38],
  ['What to say through the door, and why you say “we”', 38],
  ['Workers and anyone “from the company”', 40],
  ['The rule that handles every trick call, text and letter', 44],
  ['A family code word nobody could guess', 45],
  ['The bedtime walk, door by door', 58],
];

const LOOK = [
  [4, 'Contents', 'Four parts and twelve chapters, from the sidewalk to bedtime.'],
  [20, 'My One-Page Safety Plan', 'Your numbers, your check-in buddy and your spare key, on one sheet.'],
  [38, 'Chapter 7: The Knock at the Door', 'The one rule that makes the rest easy.'],
  [42, 'My Door Checklist', 'Eight boxes to tick, from the deadbolt to the lines by the door.'],
  [58, 'My Bedtime Walk', 'Every door, window and light, checked before bed.'],
];

// products.js notFor, split into the source's list, plus the format and the notice.
const NOT_FOR = [
  'You want a gadget list. Where a part helps, the guide names the type, never a brand.',
  'You want a self-defense course. There are no weapons and no scare stories in it, just calm habits.',
  'You want a printed book in the mail. It is a PDF you read on a screen, and you can print the checklists.',
  'You need professional security, legal or medical advice. This is general home safety information.',
];

const EXTRA_FAQ = [
  ['Is this a printed book you mail me?', 'No. It is a PDF guide you open on your phone, tablet or computer. Nothing arrives in the mail. You can print the checklists and worksheets for your own use.'],
  ['Is this about fighting back?', 'No. It is not a self-defense course: no weapons, no brands and no scare stories, just calm habits for your doors, windows, lights, phone and nights.'],
];

export function dianeLook(p, { checkoutReady, query = '' }) {
  const price = priceText(p);
  const buy = (label = `Buy now for ${price}`) => checkoutReady
    ? `<a class="btn" href="/go/${p.key}${esc(query)}">${esc(label)}</a>`
    : `<p class="btn off" aria-disabled="true">Checkout opens soon</p>`;
  const cover = `<img src="${esc(p.coverImage)}" alt="Cover of ${esc(p.title)}" width="680" height="880">`;
  const lab = (t, c = '') => `<div class="lab${c}">${esc(t)}</div>`;
  const faq = [...EXTRA_FAQ, ...faqItems(p)];
  const host = p.persona.host;

  const body = `<div class="head"><div class="wrap">
  <a class="mark" href="#top"><i>${esc(host.split(' ').map(w => w[0]).join(''))}</i><span>${esc(host.toUpperCase())}</span></a>
  <a class="btn" href="#buy">Get my copy</a>
</div></div>

<div class="hero" id="top"><div class="wrap">
  ${lab(p.kicker, ' c')}
  <h1>${esc(p.headline)}</h1>
  <p class="paren">(${esc(p.title)})</p>
  <p class="photo-cap">Tap the video to play it. Diane explains it in under a minute.</p>
  <div class="photo"><video controls playsinline preload="none" poster="${A}diane-intro-poster.jpg" width="1280" height="720"><source src="${A}diane-intro.mp4" type="video/mp4"><track kind="captions" src="${A}diane-intro.vtt" srclang="en" label="English" default></video></div>
  <p class="intro">${esc(p.lede)}</p>
  <div class="offer">
    <div class="cov">${cover}</div>
    <div>
      <div class="price"><span class="now">${price}</span></div>
      <div class="what">${esc(p.format)}</div>
      <div class="goes">One payment, no subscription.</div>
      <div class="btnrow">${buy()}</div>
      <div class="promise1">${REFUND_DAYS}-day money-back guarantee · One payment, no subscription</div>
      <ul class="dots"><li>Instant download</li><li>Reads on phone, tablet or computer</li><li>Secure checkout</li></ul>
      <p class="links"><a class="tlink" href="#look">See real pages from the book first</a> · It's a PDF: nothing is mailed to you.</p>
    </div>
  </div>
</div></div>

<div class="how"><div class="wrap">
  ${lab('How it works')}
  <div class="steps">
    <div class="step"><i>1</i><div><b>You pay</b><p>Once, through a secure checkout. There is nothing to renew.</p></div></div>
    <div class="step"><i>2</i><div><b>The link is emailed right away</b><p>Right after you pay, we email you a download link. Click it and save the PDF.</p></div></div>
    <div class="step"><i>3</i><div><b>It's yours to keep</b><p>Phone, tablet or computer. The link works for ${LINK_DAYS} days, and you can ask for a fresh one any time.</p></div></div>
  </div>
  <p class="nothing">Nothing ships and nothing renews.</p>
</div></div>

<div class="after">
<section class="band"><div class="wrap">
  ${lab('Where you probably are')}
  <h2>You live on your own, and you'd like the nights to feel calmer.</h2>
  <div class="prose">
    <p>You know your home so well that you have stopped seeing it. A stranger sees only what is on show, and in a few seconds forms a quick picture of who lives here and how closely the place is watched.</p>
    <p>The good news is that you can see that same picture, and many of the fixes cost little or nothing. The aim is not to feel worried. The aim is to give a passer-by less to notice, so your home is more likely to be skipped.</p>
  </div>
  <div class="pains">${PAINS.map(([h, t]) => `<div class="pain"><h3>${esc(h)}</h3><p>${esc(t)}</p></div>`).join('')}</div>
</div></section>

<section><div class="wrap">
  ${lab('What your home says')}
  <h2>A stranger reads your home in a few seconds. Most of the fixes are habits.</h2>
  <p class="prose">What a passer-by notices from the sidewalk, and what the book has you do instead, with the page it's on.</p>
  <div class="math">
    <div class="mcol bad">${lab('What a passer-by reads')}
      ${READS.map(([a, b]) => `<div class="mrow"><span>${esc(a)}</span><span>${esc(b)}</span></div>`).join('\n      ')}
      <div class="mtot"><span>Together they say</span><span>nobody is home</span></div>
    </div>
    <div class="mcol good">${lab('What the book has you do')}
      ${FIXES.map(([a, b]) => `<div class="mrow"><span>${esc(a)}</span><span>${esc(b)}</span></div>`).join('\n      ')}
      <div class="mtot"><span>The walk-around</span><span>about ten minutes, twice a year</span></div>
    </div>
  </div>
  <p class="mline">Many of them are habits, and habits are <em>something you control.</em></p>
  <p class="note">From chapters 1 and 2. Many of these steps cost little or nothing. Nothing here can promise that no one will ever try your door; it makes your home less inviting and more likely to be passed over.</p>
</div></section>

<section class="band"><div class="wrap">
  ${lab('What the book is')}
  <h2>One book in four parts, from the sidewalk to bedtime.</h2>
  <p class="prose">It starts where a stranger starts: out on the sidewalk, looking at your home. Then the doors, windows and lights, the knock and the phone call, and the night. Along the way are checklists and worksheets you can print and keep by the door.</p>
  <div class="shelf">${p.chapters.map(([h, t], i) => {
    const part = PARTS[i];
    return `<div class="bk"><img src="${A}${part.img}" alt="" width="480" height="720" loading="lazy">
      ${lab(`Part ${i + 1}`)}<h3>${esc(h)}</h3><p class="sub">${esc(t)}</p>
      <ul>${part.chapters.map((c, j) => `<li>${part.first + j}. ${esc(c)}</li>`).join('')}</ul>
      <div class="pp">Chapters ${part.first} to ${part.first + 2} · pages ${part.pages}</div></div>`;
  }).join('\n    ')}</div>
  <p class="shelfnote">Every chapter works for renters, and it tells you when to ask your landlord before changing a lock or drilling.</p>
</div></section>

<section id="contents"><div class="wrap">
  ${lab("What you'll find inside")}
  <h2>What to do, and what to say, for the door, the phone and the night.</h2>
  <p class="prose">A few of the things inside, with the page they're on:</p>
  <ul class="finds">${FINDS.map(([t, n]) => `<li><span>${esc(t)}</span><small>page ${n}</small></li>`).join('')}</ul>
  <p class="fraction">And that's a fraction of it.</p>
  <div class="stats">
    <div><b>69</b><span>pages</span></div>
    <div><b>12</b><span>short chapters</span></div>
    <div><b>4</b><span>parts, from the sidewalk to bedtime</span></div>
    <div><b>1</b><span>rule for every trick call: hang up and call back</span></div>
  </div>
</div></section>

<section class="band"><div class="wrap idea">
  <div>
    ${lab('One idea from the book')}
    <h2>You never have to open the door.</h2>
    <p>Not for a polite person, not for a pushy one, not for someone in a uniform, and not for someone who says it will only take a minute. A closed door is not rude. It is how a careful household works.</p>
    <p>You already hold the most useful tool in the house: a closed, locked door. Once you settle this in your mind, each knock gets simpler.</p>
    <div class="verdict">${lab("Diane's rule")}<p>The question is no longer “Should I open it?” The question is only “What do I need to say through it?”</p></div>
  </div>
  <div class="measure">
    <h3>Before you answer</h3>
    <p class="sub">Take these steps, in this order.</p>
    <ol><li>Stay back from the door and keep it locked, deadbolt and all.</li><li>Look first: the door viewer, a side window or a doorbell screen.</li><li>Decide whether to answer at all. Nobody is owed a reply.</li></ol>
    <div class="say"><b>What to say</b><p>“Thank you, we are not interested.”</p></div>
    <p class="note">From chapter 7, The Knock at the Door. Notice the word “we”: it tells the visitor nothing about who lives inside.</p>
  </div>
</div></section>

<section id="look"><div class="wrap">
  ${lab('Look inside')}
  <h2>Real pages from the book.</h2>
  <p class="prose">This is exactly what opens on your phone. Tap any page to see it larger.</p>
  <div class="pages" id="pages">${LOOK.map(([n, b, t]) => `<div class="pg"><a class="sheet" href="#p${n}"><img src="${A}page-${n}.jpg" alt="Page ${n} of the book: ${esc(b)}" width="640" height="829" loading="lazy"></a><b>${esc(b)}</b><p>${esc(t)}</p></div>`).join('')}</div>
  <div class="center"><a class="btn" href="#buy">Get the book</a></div>
</div></section>

<section class="band"><div class="wrap">
  ${lab('Is it for you')}
  <h2>Written for one kind of reader.</h2>
  <div class="fit">
    <div class="yes"><h3>It's for you if</h3><ul>${p.forWho.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
    <div class="no"><h3>It isn't for you if</h3><ul>${NOT_FOR.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
  </div>
</div></section>

<section id="buy"><div class="wrap">
  <div class="shop">
    <div class="buybox">
      <div class="buyimg">${cover}</div>
      <div>
        ${lab('Get your copy')}
        <h2>${esc(p.title)}</h2>
        <p class="sub">${esc(p.subtitle)}</p>
        <ul class="ticks">
          <li>69 pages, 12 chapters in 4 parts</li>
          <li>See your home the way a stranger does, by day and after dark</li>
          <li>A front door that holds, windows and sliding doors locked every night, and outdoor light with a clear view</li>
          <li>What to say through a closed door, and the hang-up-and-call-back rule for tricks</li>
          <li>A bedtime lock walk, trips away and everyday emergencies</li>
          <li><b>Printable checklists and worksheets</b>: your walk-around, your one-page safety plan, your door checklist and your phone rules</li>
          <li>Instant PDF: the download link is emailed right after you pay</li>
        </ul>
        <div class="price"><span class="now">${price}</span></div>
        <div class="goes">One payment, no subscription.</div>
        ${buy()}
        <div class="secure">Secure checkout · ${REFUND_DAYS}-day money back</div>
      </div>
    </div>
    <div class="trust"><span>Secure checkout</span><span>One payment, no subscription</span><span>${REFUND_DAYS} days, money back</span></div>
  </div>
  <p class="readnote"><b>Please read this before you buy.</b> What you get is a PDF you read on a screen: a phone, a tablet or a computer. Nothing is posted to you. You may print the checklists and worksheets for your own use.</p>
  <div class="promise">${lab(`The ${REFUND_DAYS}-day promise`)}${guarantee()}</div>
</div></section>

<section class="author"><div class="wrap">
  <img src="${A}diane.jpg" alt="${esc(host)}" width="720" height="720" loading="lazy">
  <div>
    ${lab('Who wrote it')}
    <h2>${esc(host)}</h2>
    <p>${esc(host)} wrote this guide for women who live on their own, in a house or an apartment, and want to feel calmer at home. It is plain and step by step, and most of the steps are habits that cost little or nothing.</p>
    <p>She is not a security professional, and she says so. For your own doors, locks and wiring the book sends you to a licensed locksmith, an electrician or your local fire department, and renters to the landlord first.</p>
    <blockquote>The aim is not to feel worried. The aim is to give a passer-by less to notice.</blockquote>
    <div class="sig">Diane</div>
    <p class="ai">${esc(host)} is an AI-created character.</p>
  </div>
</div></section>

<section><div class="wrap">
  ${lab('Questions')}
  <h2>Before you buy.</h2>
  <div class="faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n    ')}</div>
</div></section>

<section class="band" id="contact"><div class="wrap ask">
  <div>
    ${lab('Questions before you buy?')}
    <h2>Ask us.</h2>
    <p>Not sure it's right for you? Write, and a person will answer by email.</p>
    <a class="btn ghost" href="mailto:${SUPPORT_EMAIL}">Email ${SUPPORT_EMAIL}</a>
  </div>
  <div class="askcard">
    ${lab('Lost your link?')}
    <h3>We'll send it again.</h3>
    <p>Write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> with the email you paid with, and we'll send a fresh download link.</p>
  </div>
</div></section>

<section class="last"><div class="wrap">
  ${lab('Start tonight', ' c')}
  <h2>Start with the walk-around. It takes about ten minutes.</h2>
  <p class="prose">One PDF guide with printable checklists and worksheets. The download link is emailed right after you pay. Nothing ships.</p>
  <div class="price"><span class="now">${price}</span></div>
  <div class="goes">One payment, no subscription.</div>
  <div class="btnrow">${buy()}</div>
  <div class="trustrow"><span>${REFUND_DAYS}-day money back</span><span>Instant download</span><span>One payment, no subscription</span></div>
</div></section>

<div class="sticky"><div class="wrap"><div class="sl"><b>${esc(p.title)}</b><span><span class="now">${price}</span><span class="long"> · instant PDF</span> · ${REFUND_DAYS}-day money back</span></div>${buy('Buy now')}</div></div>
</div>

<footer><div class="wrap">
  <p>Questions before you buy? Write to us: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
  <p>${esc(p.title)} is a digital book (PDF). Nothing is shipped. One payment, no subscription. ${REFUND_DAYS}-day money-back guarantee.</p>
  <p class="notice">${esc(p.notice)}</p>
  <p>${esc(host)} is an AI-created character.</p>
  <nav><a href="/refunds">Refunds</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="mailto:${SUPPORT_EMAIL}">Contact</a></nav>
  <p>© 2026 ${esc(BRAND)}. Payments are processed by Commas.</p>
</div></footer>

${LOOK.map(([n, b]) => `<a class="lbox" id="p${n}" href="#pages" aria-label="Close the larger page"><img src="${A}page-${n}.jpg" alt="Page ${n} of the book, larger: ${esc(b)}" width="640" height="829" loading="lazy"><small>Tap anywhere to close</small></a>`).join('\n')}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(p.title)} | ${esc(BRAND)}</title>
<meta name="description" content="${esc(p.lede)}">
<link rel="stylesheet" href="/looks/diane.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body class="diane-look">
${body}
</body>
</html>`;
}
