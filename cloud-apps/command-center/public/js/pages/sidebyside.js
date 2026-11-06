import { esc, head } from '../ui.js';

// Landing pages side by side (2026-11-05): each Home Guide Press book page next to the source page it copies.
// Screenshots are full-page, taken 2026-11-05 (public/sbs/<key>-ours.jpg and -src.jpg); src is null where the
// channel's source page was never recorded (rules/facts/channels.md).
const PAIRS = [
  {"key": "peter-collins", "channel": "Peter Collins", "book": "The Driver's Bundle", "ours": "https://homeguidepress.com/drivers-bundle", "src": null, "srcName": "Gary Webster British Trucker (@GaryWebsterBritishTrucker)"},
  {"key": "jack-mercer", "channel": "Jack Mercer", "book": "Ready at Home", "ours": "https://homeguidepress.com/ready-at-home", "src": null, "srcName": "Host \"Ray\" (handle not recorded)"},
  {"key": "rosa-cooks", "channel": "Rosa Cooks", "book": "The Hand-Me-Down Kitchen", "ours": "https://homeguidepress.com/the-hand-me-down-kitchen", "src": null, "srcName": "Creator \"Bertha\" (handle not recorded)"},
  {"key": "rosas-clean-home", "channel": "Rosa's Clean Home", "book": "The Old Way to a Clean House", "ours": "https://homeguidepress.com/the-old-way-to-a-clean-house", "src": null, "srcName": "Creator \"Bertha\" (handle not recorded)"},
  {"key": "rosas-house-hacks", "channel": "Rosa's House Hacks", "book": "Fix It Like Family Did", "ours": "https://homeguidepress.com/fix-it-like-family-did", "src": null, "srcName": "Not recorded"},
  {"key": "giovanni-moretti", "channel": "Giovanni Moretti", "book": "Finally Written Down", "ours": "https://homeguidepress.com/finally-written-down", "src": null, "srcName": "Host \"Angelo\" (handle not recorded)"},
  {"key": "frank-bennett-dogs", "channel": "Frank Bennett Dogs", "book": "The Long-Life Dog", "ours": "https://homeguidepress.com/the-long-life-dog", "src": null, "srcName": "Not confirmed (page rebuilt as a clone of a Frenchie page)"},
  {"key": "ruth-calder", "channel": "Ruth Calder", "book": "The Dark House Plan", "ours": "https://homeguidepress.com/the-dark-house-plan", "src": "https://jodannerprep.com/", "srcName": "Jo Danner (@JoDannerPrep)"},
  {"key": "dale-whitaker", "channel": "Dale Whitaker Pitbulls", "book": "The Pitbull Playbook", "ours": "https://homeguidepress.com/the-pitbull-playbook", "src": "https://pitbulldogdad.com/", "srcName": "Pitbull Dog Dad (@PitbullDogDad)"},
  {"key": "nora-fairweather", "channel": "Nora Fairweather Cats", "book": "Reading Your Cat", "ours": "https://homeguidepress.com/reading-your-cat", "src": "https://leobennettsecrets.com", "srcName": "Leo Bennett Reads Cats (@leobennettreadscats)"},
  {"key": "gail-merriman", "channel": "Gail Merriman Golf", "book": "Yards Back", "ours": "https://homeguidepress.com/yards-back", "src": "https://golfmegan.com", "srcName": "Megan Hayes Golf (@MeganHayesGolf)"},
  {"key": "naomi-takeda", "channel": "Naomi Takeda Japan", "book": "Japan Before You Go", "ours": "https://homeguidepress.com/japan-before-you-go", "src": "https://marikoaono.com", "srcName": "Mariko Aono (@MarikoAono)"},
  {"key": "walter-brandt", "channel": "Walter Brandt Dogs", "book": "The Good Old Dog", "ours": "https://homeguidepress.com/the-good-old-dog", "src": "https://stevecooperpets.com/", "srcName": "Steve Copper Dogs (@SteveCopperDogs)"},
];

const NOTE = 'Both are full-page screenshots from 2026-11-05. Click a picture for the full size, or a link for the live page.';

function side(label, url, name, key, suffix) {
  const live = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\//, ''))}</a>` : '<span class="muted">No page recorded</span>';
  const shot = url
    ? `<a class="sbsshot" href="/dashboard/sbs/${key}-${suffix}.jpg" target="_blank" rel="noopener"><img loading="lazy" src="/dashboard/sbs/${key}-${suffix}.jpg" alt="${esc(label)} page screenshot"></a>`
    : `<div class="sbsshot sbsnone"><p>Source page was never recorded for this channel.</p></div>`;
  return `<div class="sbscol"><h3>${esc(label)}</h3><p class="sbslink">${live}</p><p class="muted">${esc(name)}</p>${shot}</div>`;
}

export function render() {
  const rows = PAIRS.map((p) => `<div class="card pad sbsrow">
    <div class="cardhead"><h2>${esc(p.channel)} <span class="muted">${esc(p.book)}</span></h2></div>
    <div class="sbspair">${side('Our page', p.ours, 'Home Guide Press', p.key, 'ours')}${side('Source page', p.src, p.srcName, p.key, 'src')}</div>
  </div>`).join('');
  const have = PAIRS.filter((p) => p.src).length;
  return `<div class="wrap sbs">${head('Landing pages', `${PAIRS.length} channels, ${have} with a recorded source page. ${NOTE}`)}${rows}</div>`;
}
