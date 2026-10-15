// The 7 Home Guide Press guides. One entry per channel.
// key:   internal slug (Commas success URL /thanks?p=<key>, D1 rows, R2 folder <key>/).
// path:  landing page URL, from the book title. /<key> redirects to it.
// Persona names come from my-agent/state/affiliate/personas.json only. Until a
// persona is final, `persona` stays null and pages show a clear placeholder.
// Checkout links come from the ebook worker (JON-59) and live in the
// CHECKOUT_URLS var, keyed by `key`, so they can change without a code edit.

export const BRAND = 'Home Guide Press';
export const SUPPORT_EMAIL = 'partners@thejonmac.com';
export const REFUND_DAYS = 30;
export const LINK_DAYS = 7;
export const STATEMENT_NAME = 'COMMAS or FANBASIS';

const PENDING = '[persona name pending]';

export const PRODUCTS = [
  {
    key: 'angelo',
    path: 'finally-written-down',
    ready: true,
    persona: { host: 'Carmine Russo', brand: "Carmine's Italian Kitchen" },
    kicker: 'Italian-American home cooking',
    title: 'Finally Written Down',
    subtitle: '100 Sunday-table recipes in cups and grams, each with the old trick that makes it work',
    headline: 'The Sunday cooking nobody ever wrote down. Now it is.',
    lede: 'The old cooks never measured. They knew by the look of the dough and the smell of the pot. This book puts it all on paper: the amounts, the heat, the timing, and the one small move that makes each dish come out right.',
    price: 19,
    format: 'PDF cookbook, about 300 pages, 100 recipes in 10 chapters, a full-page photo of every dish',
    cover: { color: '#7a1f1f', accent: '#f3e3c3' },
    promises: [
      ['One old trick for every recipe', 'Each dish comes with the single thing that makes it work, like when to salt or why you save a cup of pasta water.'],
      ['300 fixes for when it goes wrong', 'Every recipe lists the three things people get wrong with it, why it happens, and how to rescue it.'],
      ['Cups and grams, °F and °C', 'Every ingredient in US cups and spoons with grams or milliliters next to it. Every oven temperature in both.'],
    ],
    chapters: [
      ['Sauces and Sunday Gravy', 'Sunday gravy, quick marinara, slow meat sauce, vodka sauce, pesto, arrabbiata, puttanesca and the white sauce for lasagna.'],
      ['Weeknight Pasta', 'Aglio e olio, white clam sauce, cacio e pepe, carbonara, Alfredo, orecchiette with sausage and broccoli rabe, and more.'],
      ['Baked Pasta, Fresh Pasta and Gnocchi', 'Sunday lasagna, baked ziti, stuffed shells, manicotti, fresh egg pasta, ravioli, potato and ricotta gnocchi.'],
      ['Soups', 'Italian wedding soup, pasta e fagioli, minestrone, escarole and beans, stracciatella, lentil soup with sausage.'],
      ['Meat', 'Sunday meatballs, braciole, sausage and peppers, steak pizzaiola, osso buco, a porchetta-style roast.'],
      ['Chicken', 'Chicken parm, cacciatore, piccata, Marsala, scarpariello, Francese, Milanese and a lemon roast chicken.'],
      ['Fish and Seafood', 'Shrimp scampi, fra diavolo, fried calamari, mussels, clams oreganata, zuppa di pesce, baccalà salad.'],
      ['Vegetables and Sides', 'Eggplant parm, broccoli rabe, stuffed artichokes, giambotta, caponata, polenta and mushroom risotto.'],
      ['Pizza, Bread and Antipasti', 'One dough for pizza, grandma pie, stromboli and calzones. Focaccia, garlic bread, bruschetta, arancini.'],
      ['Desserts and Cookies', 'Cannoli, tiramisu, ricotta cheesecake, pizzelle, biscotti, zeppole, struffoli and lemon ricotta cake.'],
    ],
    forWho: [
      'You grew up with these dishes and want to make them the way they tasted at the Sunday table.',
      'You have tried to cook from memory and something always comes out a little off.',
      'You want plain steps in big, clear print, with nothing to guess.',
    ],
    notFor: 'It is not a restaurant or chef-school book. Everything is made with an ordinary stove, a heavy pot and a wooden spoon.',
    faq: [
      ['Do I need special equipment?', 'No. A heavy pot, a big skillet, a sheet pan, a sharp knife and a wooden spoon cover almost every recipe. A kitchen scale helps for baking but is never required.'],
      ['Are the measurements in cups or grams?', 'Both. US cups and spoons come first, with grams or milliliters in brackets. Oven and oil temperatures are in °F and °C.'],
      ['Are the photos real?', 'The dish photos are AI-generated illustrations of the finished recipes, so you know what you are aiming for. The book says so on its copyright page.'],
    ],
    notice: null,
    files: [{ name: 'Finally Written Down.pdf', object: 'angelo/finally-written-down.pdf' }],
  },
  {
    key: 'steve',
    path: 'steve',
    ready: false,
    persona: null,
    kicker: 'Long-life dog care',
    title: 'Dog care manual (title pending)',
    subtitle: 'A plain-English owner\'s manual for a longer, healthier life with your dog',
    headline: 'Give your dog the longest, healthiest life you can.',
    lede: 'A full owner\'s manual for everyday dog care, from the first weeks at home to the senior years. Written in plain words, with printable checklists for the fridge.',
    price: 34,
    format: 'PDF manual with printable checklists (page count follows the finished book)',
    cover: { color: '#2f4a3a', accent: '#efe6cf' },
    promises: [],
    chapters: [],
    forWho: [],
    notFor: null,
    faq: [],
    notice: 'General dog care only. This guide is not veterinary advice. If your dog is unwell, see your vet.',
    files: [],
  },
  {
    key: 'freddy',
    path: 'freddy',
    ready: false,
    persona: { host: 'Walt Henning', brand: "Walt's Guardian Dogs" },
    kicker: 'Guardian dogs',
    title: 'Guardian dog field books (title pending)',
    subtitle: 'Choose, raise and handle a dog that protects your home',
    headline: 'Will your dog stand its ground at the door, or bark and back away?',
    lede: 'Three field books on picking the right guardian dog for your home, raising it through the first two years, and knowing what to do when something goes wrong.',
    price: 27,
    format: '3 PDF field books (page count follows the finished books)',
    cover: { color: '#3b3226', accent: '#e9dcc0' },
    promises: [],
    chapters: [],
    forWho: [],
    notFor: null,
    faq: [],
    notice: 'General dog care and training only. This guide is not veterinary or legal advice.',
    files: [],
  },
  {
    key: 'gary',
    path: 'gary',
    ready: false,
    persona: null,
    kicker: 'UK lorry drivers',
    title: 'UK driver\'s bundle (title pending)',
    subtitle: 'Know your pay, your rules and your options behind the wheel',
    headline: 'Know what you are really worth behind the wheel.',
    lede: 'Three plain-English books for UK HGV drivers: what you really earn per hour, what the rules actually say, and how to find or build better work.',
    price: 19.99,
    format: '3 PDF books (page count follows the finished books)',
    cover: { color: '#1f3550', accent: '#e8e2d2' },
    promises: [],
    chapters: [],
    forWho: [],
    notFor: null,
    faq: [],
    notice: 'General information only, checked against the rules on the date printed in the book. Not legal or financial advice.',
    files: [],
  },
  {
    key: 'teruko',
    path: 'teruko',
    ready: false,
    persona: { host: 'Michiko Arata', brand: "Michiko's Japanese Way" },
    kicker: 'Japanese packing',
    title: 'Japanese packing guide (title pending)',
    subtitle: 'Pack for any trip in one carry-on, the Japanese way',
    headline: 'Pack for two weeks in one small bag.',
    lede: 'A calm, step-by-step method for packing light: the few pieces that work together, the cloth that replaces half your bags, and printable lists for every kind of trip.',
    price: 27,
    format: 'PDF guide with printable packing lists (page count follows the finished book)',
    cover: { color: '#24364a', accent: '#efe7da' },
    promises: [],
    chapters: [],
    forWho: [],
    notFor: null,
    faq: [],
    notice: null,
    files: [],
  },
  {
    key: 'delton',
    path: 'delton',
    ready: false,
    persona: null,
    kicker: 'Whiskey',
    title: 'Whiskey shelf guide (title pending)',
    subtitle: 'Stop paying for the label and build a shelf you actually enjoy',
    headline: 'Stop paying the label tax on every bottle.',
    lede: 'Three short guides to reading a whiskey label, building a small shelf of bottles you really drink, and pouring them the way you like.',
    price: 27,
    format: '3 PDF guides (page count follows the finished books)',
    cover: { color: '#5a3415', accent: '#f1e2c4' },
    promises: [],
    chapters: [],
    forWho: [],
    notFor: null,
    faq: [],
    notice: 'For adults of legal drinking age only. Please drink responsibly.',
    files: [],
  },
  {
    key: 'prepared',
    path: 'prepared',
    ready: false,
    persona: null,
    kicker: 'UK home preparedness',
    title: 'UK home survival playbook (title pending)',
    subtitle: 'A calm, practical plan to get your household ready for winter and power cuts',
    headline: 'Get your home ready before the next winter warning.',
    lede: 'A practical UK playbook for power cuts, water problems and cold snaps: what to store, what to buy first, and a plan the whole household can follow.',
    price: 47,
    format: 'PDF playbook plus an editable Word version and 4 short bonus guides',
    cover: { color: '#3a4630', accent: '#ece6d3' },
    promises: [],
    chapters: [],
    forWho: [],
    notFor: null,
    faq: [],
    notice: 'General safety guidance only. Follow official UK advice in an emergency.',
    files: [],
  },
];

export const BY_KEY = Object.fromEntries(PRODUCTS.map(p => [p.key, p]));
export const BY_PATH = Object.fromEntries(PRODUCTS.map(p => [p.path, p]));

export function byline(p) {
  return p.persona ? `${p.persona.host}, ${p.persona.brand}` : PENDING;
}
export function fromName(p) {
  return p.persona ? p.persona.brand : BRAND;
}
export function priceText(p) {
  return '$' + (Number.isInteger(p.price) ? p.price : p.price.toFixed(2));
}
