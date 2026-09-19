import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tile = (icon, label, value, extra = {}) => ({ icon, label, value, ...extra });

const snapshot = {
  generatedFrom: 'mockup.html',
  asOf: '2026-09-18',
  nav: {
    brand: 'Jon Mac',
    startMorning: 'Start my morning',
    startMorningMsg: "Walks you through today's items one at a time",
    groups: [
      { title: 'Overview', items: [{ id: 'home', label: 'Command center', icon: 'home' }] },
      { title: 'Business', items: [
        { id: 'sponsors', label: 'Sponsors', icon: 'mail' },
        { id: 'viral', label: 'Viral View', icon: 'chart' },
        { id: 'youtube', label: 'YouTube', icon: 'film' },
        { id: 'content', label: 'Content', icon: 'pen' },
        { id: 'outreach', label: 'Cold outreach', icon: 'send' },
        { id: 'support', label: 'Support', icon: 'chat' },
        { id: 'video', label: 'Video editor', icon: 'up' },
      ] },
      { title: 'Money & life', items: [
        { id: 'money', label: 'Finances', icon: 'wallet' },
        { id: 'markets', label: 'Markets', icon: 'trend' },
        { id: 'life', label: 'Life', icon: 'heart' },
      ] },
      { title: 'System', items: [
        { id: 'mastermind', label: 'Mastermind', icon: 'bulb' },
        { id: 'agents', label: 'Agents', icon: 'bot' },
      ] },
    ],
    badges: { sponsors: 3, content: 7, support: 4, video: 1, money: 4, markets: 1, mastermind: 3, agents: 2 },
  },
  goal: { label: '$10K SPONSOR GOAL', sub: '12 days left in September', pct: 50, see: 'See sponsors' },
  sources: {
    sponsors: { updatedAt: '2026-09-16T00:00:00-07:00' },
    viralview: { updatedAt: '2026-09-18T00:00:00-07:00' },
    moneyclaw: { updatedAt: '2026-09-18T08:12:00-07:00' },
    markets: { updatedAt: '2026-09-18T13:00:00-07:00' },
    youtube: { updatedAt: '2026-09-18T00:00:00-07:00' },
    content: { updatedAt: '2026-09-18T00:00:00-07:00' },
    support: { updatedAt: '2026-09-18T00:00:00-07:00' },
    video: { updatedAt: '2026-09-18T00:00:00-07:00' },
    agents_mac: { updatedAt: '2026-09-18T00:00:00-07:00' },
    agents_gpu2: { updatedAt: '2026-09-18T00:00:00-07:00' },
    mastermind: { updatedAt: '2026-09-18T07:30:00-07:00' },
    life: { updatedAt: '2026-09-18T00:00:00-07:00' },
  },
  pages: {},
};

snapshot.pages.home = {
  greeting: 'Good morning, Jon 👋',
  date: 'Friday, September 18 · Kelowna',
  chip: 'Mockup · sponsor, expense and market numbers come from your own pages · the rest are examples',
  tiles: [
    tile('dollar', 'Sponsors · September collected', '$5,000', { goal: '/ $10K', pct: 50, sub: '$6,700 more is owed · enough to pass $10K' }),
    tile('chart', 'Viral View sales · this week', '$0', { goal: '/ $1K', pct: 0, pg: 'crit', sub: 'No payment recorded since Sep 9' }),
    tile('pen', 'Posts today', '5', { goal: '/ 12', pct: 42, pg: 'risk', sub: 'LinkedIn still at 0' }),
    tile('film', 'YouTube videos · this week', '1', { goal: '/ 3', pct: 33, sub: '1 more in the editor now' }),
  ],
  runThrough: {
    title: 'Morning run-through', done: 2, total: 7, pct: 29,
    steps: [
      { label: 'Sponsor emails', done: true }, { label: 'Bank scan', done: true },
      { label: 'Market check', done: false }, { label: 'Mastermind digest', done: false },
      { label: 'Support replies', done: false }, { label: 'Posts out', done: false },
      { label: 'Workout 11:00', done: false },
    ],
  },
  needsYou: {
    title: 'Needs you today', viewAll: 'View all 6', viewAllMsg: 'Opened the full list · 6 items',
    jobs: [
      { area: 'Sponsors', pill: '7 days late', pillCls: 'crit', title: "Chase TopView's $750 deposit",
        lines: ['Dorothy said it was sent Sep 11 · not in the bank', 'Email drafted asking for the wire receipt'],
        btn: 'Review email', page: 'sponsors' },
      { area: 'Finances', pill: 'Paused', pillCls: 'risk', title: 'Enter bank text code',
        lines: ['2 of 3 accounts scanned at 8:12', 'Business credit card sent you a code'],
        btn: 'Enter code', msg: 'Code box opened', done: true },
      { area: 'Support', pill: 'Drafted', pillCls: 'ok', title: 'Approve 4 support replies',
        lines: ['Oldest ticket has waited 5 hours', '1 is a refund request'],
        btn: 'Review replies', page: 'support' },
    ],
  },
  glance: {
    title: 'Business at a glance',
    rows: [
      { page: 'sponsors', area: 'Sponsors', today: '$5,000 in · $6,700 owed by 3 sponsors', goal: '$10K a month', pct: 50, pg: 'risk', pill: '50%', pillCls: 'risk' },
      { page: 'viral', area: 'Viral View sales', today: 'No payment since Sep 9', goal: '$1K a week', pct: 0, pg: 'crit', pill: '0%', pillCls: 'crit' },
      { page: 'viral', area: 'Subscriptions', today: '$993 a month · 5 customers', goal: 'Grow every month', pct: 100, pg: 'ok', pill: '+$748', pillCls: 'ok' },
      { page: 'content', area: 'Content', today: '5 posts out · LinkedIn at 0', goal: '12 posts a day', pct: 42, pg: 'risk', pill: '42%', pillCls: 'risk' },
      { page: 'content', area: 'YouTube videos', today: '1 live · 1 in the editor', goal: '2–3 a week', pct: 33, pg: 'ok', pill: '1 of 3', pillCls: 'ok' },
      { page: 'viral', area: 'Meta Ads', today: '$210 spent · $39 back', goal: 'Break even', pct: 19, pg: 'crit', pill: '−$171', pillCls: 'crit' },
      { page: 'outreach', area: 'Cold outreach', today: 'Setup 1 of 6 steps done', goal: 'Daily max', pct: 17, pg: 'idle', pill: 'Setup', pillCls: '' },
      { page: 'support', area: 'Support', today: '4 tickets waiting', goal: 'Reply same day', pct: 69, pg: 'ok', pill: '9 of 13', pillCls: 'ok' },
    ],
  },
  mastermindPick: {
    pill: 'Worth doing', heading: 'Best idea from the last 24 hours',
    body: 'One line on what was shared in the group and who shared it.',
    fitTitle: 'How it fits your business',
    fit: 'Two lines on where it plugs in, for example Viral View ads or sponsor outreach.',
    effort: 'about half a day for the Planner agent',
    btn: 'Send to Planner', msg: 'Sent to Planner as a task',
    pager: '1 of 3 picks · 41 messages scanned',
  },
  life: {
    workout: { title: 'Workout with your wife', sub: 'Next: today 11:00', dots: ['on:M', 'on:W', 'next:F'], pct: 67 },
    dateNight: { title: 'Date night in Kelowna', sub: 'Saturday evening is free', btn: 'Book it', msg: 'Saturday 6:30 PM added to your calendar' },
    agents: { title: 'Agents', sub: '2 need you · 1 working · 8 idle' },
  },
};

snapshot.pages.sponsors = {
  title: 'Sponsors', sub: 'From your collections tracker · last updated Sep 16',
  actions: [
    { label: 'Open collections page', msg: 'Opens collections.viralview.io' },
    { label: 'Scan inbox now', msg: 'Scanning sponsor inbox now' },
  ],
  tiles: [
    tile('check', 'Collected in September', '$5,000', { goal: '/ $10K', pct: 50, sub: 'Day 18 of 30 · pace would be $6,000' }),
    tile('dollar', 'Owed to you', '$6,700', { sub: '3 sponsors' }),
    tile('chart', 'Average month since May', '$8,802', { goal: '/ $10K', pct: 88, pg: 'risk', sub: '$1,198 a month short of goal' }),
    tile('mail', 'Sponsor emails waiting', '3', { sub: 'All 3 replies drafted' }),
  ],
  septemberBar: {
    title: 'September toward $10,000', meta: '$11,700 if everything owed comes in',
    aria: 'Collected 5,000, collect now 1,500, owed after posting 1,000, lock deal 4,200',
    goalAt: 85.5,
    parts: [
      { pct: 42.7, fill: 'var(--ok-fill)', tip: 'Collected $5,000', legend: 'Collected', amount: '$5,000' },
      { pct: 12.8, fill: 'var(--crit-fill)', tip: 'Collect now $1,500', legend: 'Collect now', amount: '$1,500' },
      { pct: 8.5, fill: 'var(--accent)', tip: 'Owed after posting $1,000', legend: 'Owed after posting', amount: '$1,000' },
      { pct: 35.9, fill: 'var(--risk-fill)', tip: 'Lock deal $4,200', legend: 'Lock deal', amount: '$4,200' },
    ],
    line: 'Line marks the $10K goal',
  },
  board: {
    title: 'Deal board',
    meta: "Drag a card to move it · TopView, InVideo and Viktor come from your tracker · other cards' stages are examples",
    columns: [
      { stage: 'New inquiry', cards: [
        { name: 'Flova AI', pill: 'Your move', pillCls: 'blue', amt: 0, amtLabel: 'Not priced', detail: 'Dedicated video · asked for rates', pct: 12, btn: 'Approve reply', msg: 'Reply sent to Flova AI' },
        { name: 'Seko AI', pill: 'Your move', pillCls: 'blue', amt: 0, amtLabel: 'Not priced', detail: 'Dedicated video · asked for rates', pct: 12, btn: 'Approve reply', msg: 'Reply sent to Seko AI' },
      ] },
      { stage: 'Negotiating', cards: [
        { name: 'GoLogin', pill: 'Your move', pillCls: 'blue', amt: 0, amtLabel: 'Not priced', detail: 'Repeat placement · needs budget and dates', pct: 25, btn: 'Approve reply', msg: 'Reply sent to GoLogin' },
      ] },
      { stage: 'Waiting on deposit', cards: [
        { name: 'TopView', pill: '7 days late', pillCls: 'crit', amt: 1500, amtLabel: '$1,500', detail: '$750 deposit "sent" Sep 11 · not in the bank', pct: 37, pg: 'crit', btn: 'Ask for receipt', msg: 'Email to Dorothy sent' },
        { name: 'InVideo', pill: 'Waiting on them', pillCls: 'risk', amt: 4200, amtLabel: '$4,200', detail: '2 dedicated videos · live Sep 24 and 29 · need billing details', pct: 37, pg: 'risk', btn: 'Nudge Nehal', msg: 'Nudge sent to Nehal', btnCls: 'line' },
      ] },
      { stage: 'Script approval', cards: [
        { name: 'Viktor', pill: '8 days quiet', pillCls: 'risk', amt: 2000, amtLabel: '$2,000', detail: "Script sent Sep 10 · Josef hasn't replied · $1,000 paid", pct: 50, btn: 'Nudge Josef', msg: 'Nudge sent to Josef', btnCls: 'line' },
      ] },
      { stage: 'With editor', cards: [
        { name: 'Creatify', pill: 'In progress', amt: 1500, amtLabel: '$1,500', detail: '90-second ad · $750 deposit paid', pct: 62, btn: 'See edit', page: 'video', btnCls: 'line' },
      ] },
      { stage: 'Video approval', cards: [
        { name: 'Soro', pill: 'Waiting on them', pillCls: 'risk', amt: 1500, amtLabel: '$1,500', detail: '90-second ad · cut sent for sign-off · $750 paid', pct: 75, btn: 'Nudge', msg: 'Nudge sent to Soro', btnCls: 'line' },
      ] },
      { stage: 'Live · send invoice', empty: 'Nothing here. Cards land here the moment a sponsor video goes live.', cards: [] },
      { stage: 'Paid in September', cards: [
        { name: 'Poppy', pill: 'Paid', pillCls: 'ok', amt: 2500, amtLabel: '$2,500', detail: 'Deposit received', pct: 100, pg: 'ok' },
      ] },
    ],
  },
  collect: {
    title: 'Money to collect', meta: '3 open items · $6,700',
    rows: [
      { sponsor: 'TopView', pill: 'Collect now', pillCls: 'crit', total: '$1,500', owed: '$1,500', paidPct: 0, paid: '$0', pg: 'crit',
        block: "Dorothy said the $750 deposit was sent Sep 11. It isn't in the bank.",
        next: "Ask Dorothy for the wire receipt. Don't start production until it lands.",
        btn: 'Send email', msg: 'Email to Dorothy sent' },
      { sponsor: 'InVideo', pill: 'Lock deal', pillCls: 'risk', total: '$4,200', owed: '$4,200', paidPct: 0, paid: '$0', pg: 'risk',
        block: "2 dedicated videos agreed, live Sep 24 and 29. Waiting on Nehal's billing details.",
        next: 'Invoice the $2,100 deposit as soon as details arrive.',
        btn: 'Nudge Nehal', msg: 'Nudge sent to Nehal', btnCls: 'line' },
      { sponsor: 'Viktor', pill: 'Owed after posting', pillCls: 'blue', total: '$2,000', owed: '$1,000', paidPct: 50, paid: '$1,000', pg: 'ok',
        block: "Script sent Sep 10. Josef hasn't approved it.",
        next: 'Nudge Josef, lock the publish date, invoice $1,000 when live.',
        btn: 'Nudge Josef', msg: 'Nudge sent to Josef', btnCls: 'line' },
    ],
  },
  emails: {
    title: 'Sponsor emails', meta: 'From the inbox scan · nothing sends without you',
    rows: [
      { title: 'Flova AI · dedicated video', sub: 'Asked for rates · reply drafted', send: 'Reply sent to Flova AI' },
      { title: 'Seko AI · dedicated video', sub: 'Asked for rates · reply drafted', send: 'Reply sent to Seko AI' },
      { title: 'GoLogin · repeat placement', sub: 'Wants another placement · needs budget and dates confirmed', send: 'Reply sent to GoLogin' },
    ],
  },
  byMonth: {
    title: 'Collected by month', meta: 'Against $10K',
    rows: [
      { label: 'May', value: '$5,600', pct: 56, pg: 'risk' },
      { label: 'June', value: '$10,400 · goal hit', pct: 100, pg: 'ok' },
      { label: 'July', value: '$8,606', pct: 86, pg: 'risk' },
      { label: 'August', value: '$7,401', pct: 74, pg: 'risk' },
      { label: 'September so far', value: '$5,000', pct: 50 },
    ],
  },
};

snapshot.pages.viral = {
  title: 'Viral View',
  sub: 'Subscriptions from your revenue page, synced Sep 18 · traffic is example numbers until the tracker is connected',
  actions: [
    { label: 'Open revenue page', msg: 'Opens app.viralview.io/admin/mrr' },
    { label: 'Open tracker', msg: 'Opens the tracker' },
  ],
  tiles: [
    tile('dollar', 'Sales this week', '$0', { goal: '/ $1K', pct: 0, pg: 'crit', sub: 'No payment recorded since Sep 9' }),
    tile('trend', 'Subscription revenue a month', '$993', { subHtml: '<span class="up">▲ $748</span> on August\'s $245' }),
    tile('heart', 'Paying customers', '5', { sub: 'None cancelled this month' }),
    tile('wallet', 'Revenue per customer', '$198.60', { sub: 'Was $49 in August' }),
  ],
  pieces: {
    title: "September's $993, piece by piece", meta: 'Yearly run rate $11,916',
    parts: [
      { amount: '$993', label: 'This month', total: true },
      { amount: '$245', label: 'Kept from August' },
      { amount: '$748', label: 'Upgrades' },
      { amount: '$0', label: 'New customers', zero: true },
      { amount: '$0', label: 'Came back', zero: true },
      { amount: '$0', label: 'Downgrades', zero: true },
      { amount: '$0', label: 'Cancelled', zero: true },
    ],
    ops: ['=', '+', '+', '+', '−', '−'],
    barAria: '245 kept from August, 748 from upgrades',
    bar: [
      { pct: 24.7, fill: 'var(--accent)', tip: 'Kept from August $245', legend: 'Kept from August', amount: '$245' },
      { pct: 75.3, fill: 'var(--ok-fill)', tip: 'Upgrades $748', legend: 'Upgrades', amount: '$748' },
    ],
  },
  byMonthChart: {
    title: 'Subscription revenue by month', meta: 'Nothing before May',
    cols: [
      { tip: 'April · $0', label: '$0', height: '2px', x: 'Apr' },
      { tip: 'May · $39 · 1 customer', label: '$39', height: '3.9%', x: 'May' },
      { tip: 'June · $117 · 3 customers', label: '$117', height: '11.8%', x: 'Jun' },
      { tip: 'July · $117 · 3 customers', label: '$117', height: '11.8%', x: 'Jul' },
      { tip: 'August · $245 · 5 customers', label: '$245', height: '24.7%', x: 'Aug' },
      { tip: 'September · $993 · 5 customers', label: '$993', height: '94%', x: 'Sep' },
    ],
  },
  check: {
    pill: "Money in doesn't match", heading: '$993 a month on paper, $39 collected in September',
    body: 'No payment has been recorded since Sep 9, even though the subscription sync ran today.',
    cash: [
      { label: 'Monthly plans', amount: '$39' },
      { label: 'Yearly plans', amount: '$0' },
      { label: 'One-time', amount: '$0' },
      { label: 'Refunds', amount: '$0' },
    ],
    note: 'Either the upgraded plans bill later in the month, or payments have stopped reaching the revenue page.',
  },
  plans: {
    title: 'Plans', meta: 'Share of $993',
    note: 'Plan names as they appear in Commas.',
    rows: [
      { plan: 'Commas y2Zqw', customers: 1, month: '$588', pct: 59.2, share: '59%' },
      { plan: 'Commas xLYpn', customers: 1, month: '$228', pct: 23, share: '23%' },
      { plan: 'Commas VJ9pB', customers: 1, month: '$99', pct: 10, share: '10%' },
      { plan: 'Viral View Founders', customers: 2, month: '$78', pct: 7.9, share: '8%' },
    ],
  },
  keeping: {
    title: 'Keeping customers', meta: 'September',
    bars: [
      { label: "August's revenue still paying", value: '100%', pct: 100, pg: 'ok' },
      { label: 'Counting upgrades', value: '405% · grew 4×', pct: 100 },
    ],
    rows: [
      { title: 'Cancelled this month', pill: 'None', pillCls: 'ok' },
      { title: 'Cancelled in August', sub: '1 customer', amount: '−$39', down: true },
      { title: 'Cancelled in July', sub: '1 customer', amount: '−$39', down: true },
    ],
  },
  customersByMonth: {
    title: 'Customers by month',
    rows: [
      { label: 'May', value: '1', pct: 20 }, { label: 'June', value: '3', pct: 60 },
      { label: 'July', value: '3', pct: 60 }, { label: 'August', value: '5', pct: 100 },
      { label: 'September', value: '5', pct: 100 },
    ],
    empty: 'No free trials running.', emptyRest: 'When you start them, this card also shows how many turn into paying customers.',
  },
  cohort: {
    title: 'Do customers keep paying?',
    note: "Each row is the customers who joined that month. Boxes show how much of their first month's revenue is still coming in.",
    headers: ['Joined', 'First month', 'Month 1', 'Month 2', 'Month 3', 'Month 4', 'Month 5'],
    rows: [
      { joined: 'May', first: '$39', cells: [['ok', '100%'], ['ok', '100%'], ['crit', '0%'], ['crit', '0%'], ['crit', '0%']] },
      { joined: 'June', first: '$78', cells: [['ok', '100%'], ['ok', '100%'], ['risk', '50%'], ['risk', '50%'], ['none', '–']] },
      { joined: 'July', first: '$39', cells: [['ok', '100%'], ['ok', '100%'], ['ok', '100%'], ['none', '–'], ['none', '–']] },
      { joined: 'August', first: '$167', cells: [['ok', '100%'], ['up', '541%'], ['none', '–'], ['none', '–'], ['none', '–']] },
    ],
    foot: [['ok', '100%'], ['up', '531%'], ['risk', '50%'], ['crit', '33%'], ['crit', '0%']],
  },
  monthTable: {
    title: 'Month by month', meta: 'No subscriptions before May',
    rows: [
      { month: 'September', rev: '$993', change: '+$748', changeCls: 'up', neu: '$0', upg: '+$748', upgCls: 'up', can: '$0', cust: 5 },
      { month: 'August', rev: '$245', change: '+$128', changeCls: 'up', neu: '+$167', neuCls: 'up', upg: '$0', can: '−$39', canCls: 'down', cust: 5 },
      { month: 'July', rev: '$117', change: '$0', neu: '+$39', neuCls: 'up', upg: '$0', can: '−$39', canCls: 'down', cust: 3 },
      { month: 'June', rev: '$117', change: '+$78', changeCls: 'up', neu: '+$78', neuCls: 'up', upg: '$0', can: '$0', cust: 3 },
      { month: 'May', rev: '$39', change: '+$39', changeCls: 'up', neu: '+$39', neuCls: 'up', upg: '$0', can: '$0', cust: 1 },
    ],
  },
  traffic: {
    title: 'Traffic', meta: 'Last 30 days · example numbers until the tracker is connected',
    tableTitle: 'By traffic source', tableMeta: "Bar shows each source's share of revenue",
    rows: [
      { source: 'YouTube', clicks: '830', carts: '16', sales: '1', rev: '$89', pct: 53, share: '53%' },
      { source: 'X', clicks: '1,240', carts: '14', sales: '1', rev: '$39', pct: 23, share: '23%' },
      { source: 'Meta Ads', clicks: '610', carts: '8', sales: '1', rev: '$39', pct: 23, share: '23%' },
      { source: 'Instagram', clicks: '420', carts: '3', sales: '0', rev: '$0', pct: 0, share: '0%' },
      { source: 'Facebook', clicks: '190', carts: '1', sales: '0', rev: '$0', pct: 0, share: '0%' },
      { source: 'LinkedIn', clicks: '85', carts: '0', sales: '0', rev: '$0', pct: 0, share: '0%' },
      { source: 'Cold email', clicks: '0', carts: '0', sales: '0', rev: '$0', pill: 'Not started' },
    ],
    foot: { clicks: '3,375', carts: '42', sales: '3', rev: '$167' },
  },
  dropoff: {
    title: 'Where people drop off', meta: 'Example',
    bars: [
      { label: 'Clicked a link', value: '3,375', pct: 100 },
      { label: 'Added to cart', value: '42 · 1.2% of clicks', pct: 1.2, min: '6px' },
      { label: 'Bought', value: '3 · 7% of carts', pct: 0.1, min: '4px' },
    ],
    leakTitle: 'Biggest leak', leak: '39 people added to cart and left. A cart reminder email is the cheapest fix.',
  },
  ads: {
    title: 'Meta Ads', meta: 'Example · $210 spent · $39 back',
    note: 'Bars run from $0 to $2 back per $1 spent. Halfway is break even.',
    rows: [
      { ad: 'Ad 1 · polished cut', pill: 'Losing', spent: '$80', back: '$39', pct: 24.5, per: '$0.49', msg: 'Ad 1 paused' },
      { ad: 'Ad 2 · raw phone clip', pill: 'No sales', spent: '$70', back: '$0', pct: 0, per: '$0.00', msg: 'Ad 2 paused' },
      { ad: 'Ad 3 · testimonial', pill: 'No sales', spent: '$60', back: '$0', pct: 0, per: '$0.00', msg: 'Ad 3 paused' },
    ],
  },
};

snapshot.pages.youtube = {
  title: 'YouTube', sub: 'From YouTube Gen · 22 channels watched · 516 videos ranked',
  actions: [{ label: 'Open YouTube Gen', msg: 'Opens jonmac.ai/yt2', primary: true }],
  tiles: [
    tile('film', 'Videos live this week', '1', { goal: '/ 3', pct: 33, sub: 'Goal is 2–3 a week' }),
    tile('pen', 'In production', '2', { sub: '1 editing · 1 script ready' }),
    tile('fire', 'Best idea right now', '133×', { sub: "Views against that channel's normal" }),
    tile('dollar', 'Sponsor videos due', '3', { sub: 'InVideo Sep 24 and 29 · Viktor' }),
  ],
  pipeline: {
    title: 'Production pipeline', meta: 'Steps: idea · script · record · edit · your review · live',
    rows: [
      { video: 'Video 1 of the week', type: 'Your channel', pct: 100, pg: 'ok', pill: 'Live', pillCls: 'ok', due: 'Tuesday', next: 'Done' },
      { video: 'Video 2 of the week', type: 'Your channel', pct: 67, pill: 'Step 4 · edit', pillCls: 'blue', due: 'Sunday', next: 'Auto editor finishing', btn: 'See edit', page: 'video' },
      { video: 'Video 3 of the week', type: 'Your channel', pct: 33, pill: 'Step 2 · script', pillCls: 'blue', due: 'Today 2:00', next: 'Record it', btn: 'Open script', msg: 'Opened the script for Video 3', primary: true },
      { video: 'InVideo · video 1', type: 'Sponsor · dedicated', pct: 17, pg: 'risk', pill: 'Step 1 · waiting on deposit', pillCls: 'risk', due: 'Sep 24', next: "Don't start until $2,100 lands", btn: 'See deal', page: 'sponsors' },
      { video: 'InVideo · video 2', type: 'Sponsor · dedicated', pct: 17, pg: 'risk', pill: 'Step 1 · waiting on deposit', pillCls: 'risk', due: 'Sep 29', next: 'Same as above' },
      { video: 'Viktor · 90-second ad', type: 'Sponsor · ad', pct: 33, pg: 'risk', pill: 'Step 2 · script with sponsor', pillCls: 'risk', due: 'September', next: 'Josef to approve script', btn: 'See deal', page: 'sponsors' },
    ],
  },
  remake: {
    title: 'Best videos to remake', seeAll: 'See all 516', seeAllMsg: 'Opens jonmac.ai/yt2 Discover',
    jobs: [
      { area: 'Joshua Mayo', pill: '133× their normal', title: '4 Side Hustles That No One Is Talking About For 2026', lines: ['5M views · 4,562 a day', 'Best fit: AI News format'] },
      { area: 'Mr. Paid Social', pill: '51× their normal', title: 'How To Make Facebook Ads 100% Using AI In 2026', lines: ['233K views · 638 a day', 'Best fit: Brand Build format'] },
      { area: 'Mr. Paid Social', pill: '39× their normal', title: 'This AI Agent Builds Full Video Ads For You', lines: ['44K views · 721 a day', 'Best fit: Brand Build format'] },
    ],
    btn: 'Remake with a template', msg: 'Opens this video in YouTube Gen with a template',
  },
};

snapshot.pages.content = {
  title: 'Content', sub: 'Goal: 3 posts a day on each platform · 2–3 YouTube videos a week',
  actions: [{ label: 'Write a post', msg: 'New post box opened', primary: true }],
  tiles: [
    tile('pen', 'Posts today', '5', { goal: '/ 12', pct: 42, pg: 'risk', sub: '7 queued for this afternoon' }),
    tile('chart', 'Posts this week', '37', { goal: '/ 84', pct: 44, pg: 'risk', sub: 'Should be at 60 by Friday' }),
    tile('film', 'YouTube this week', '1', { goal: '/ 3', pct: 33, sub: 'Video 2 is 70% edited' }),
    tile('fire', 'Days in a row with a post', '11', { sub: 'Best ever: 19' }),
  ],
  todayPlatforms: {
    title: 'Today by platform', meta: '3 each',
    rows: [
      { label: 'X', value: '2 of 3', pct: 67, tall: true },
      { label: 'Instagram', value: '2 of 3', pct: 67, tall: true },
      { label: 'Facebook', value: '1 of 3', pct: 33, pg: 'risk', tall: true },
      { label: 'LinkedIn', value: '0 of 3', pct: 0, pg: 'crit', tall: true },
    ],
  },
  heat: {
    title: 'This week', meta: 'Number in each box is posts that day',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    rows: [
      { p: 'X', cells: [
        { n: 3, tip: 'X · Mon · 3' }, { n: 3, tip: 'X · Tue · 3' }, { n: 2, tip: 'X · Wed · 2' },
        { n: 3, tip: 'X · Thu · 3' }, { n: 2, tip: 'X · today · 2 so far' }, { future: true }, { future: true },
      ] },
      { p: 'Instagram', cells: [
        { n: 3, tip: 'Instagram · Mon · 3' }, { n: 2, tip: 'Instagram · Tue · 2' }, { n: 1, tip: 'Instagram · Wed · 1' },
        { n: 3, tip: 'Instagram · Thu · 3' }, { n: 2, tip: 'Instagram · today · 2 so far' }, { future: true }, { future: true },
      ] },
      { p: 'Facebook', cells: [
        { n: 2, tip: 'Facebook · Mon · 2' }, { n: 2, tip: 'Facebook · Tue · 2' }, { n: 0, tip: 'Facebook · Wed · none' },
        { n: 1, tip: 'Facebook · Thu · 1' }, { n: 1, tip: 'Facebook · today · 1 so far' }, { future: true }, { future: true },
      ] },
      { p: 'LinkedIn', cells: [
        { n: 1, tip: 'LinkedIn · Mon · 1' }, { n: 0, tip: 'LinkedIn · Tue · none' }, { n: 0, tip: 'LinkedIn · Wed · none' },
        { n: 1, tip: 'LinkedIn · Thu · 1' }, { n: 0, tip: 'LinkedIn · today · none yet' }, { future: true }, { future: true },
      ] },
    ],
  },
  queue: {
    title: "Today's queue", meta: '7 left', approveAll: 'Approve all', approveAllMsg: 'All 7 posts approved and scheduled',
    rows: [
      { title: 'LinkedIn · 12:30', quote: 'First line of the post goes here so you can tell which one it is…', msg: 'LinkedIn post approved for 12:30' },
      { title: 'X · 1:00', quote: 'First line of the post goes here…', msg: 'X post approved for 1:00' },
      { title: 'Facebook · 2:00', quote: 'First line of the post goes here…', msg: 'Facebook post approved for 2:00' },
    ],
    more: { title: '4 more', sub: 'LinkedIn ×2 · Instagram · Facebook', btn: 'Show all', msg: 'Showing all 7 queued posts' },
  },
  ytWeek: {
    title: 'YouTube this week', note: 'Steps: record · edit · your review · live',
    rows: [
      { title: 'Video 1', sub: 'Live since Tuesday · 4,200 views', pct: 100, pg: 'ok', pill: 'Live', pillCls: 'ok' },
      { title: 'Video 2', sub: 'Step 2 of 4 · auto editor working', pct: 45, pill: 'Editing', pillCls: 'blue' },
      { title: 'Video 3', sub: 'Step 0 of 4 · script is ready', pct: 0, pg: 'idle', btn: 'Open script', msg: 'Opened the script for Video 3' },
    ],
  },
  bestPosts: {
    title: 'Best posts · last 30 days', meta: 'Ranked by clicks to Viral View',
    rows: [
      { post: 'First line of top post…', platform: 'X', views: '48,200', clicks: '410', sales: '1' },
      { post: 'First line of second post…', platform: 'YouTube Shorts', views: '21,900', clicks: '265', sales: '1' },
      { post: 'First line of third post…', platform: 'Instagram', views: '9,400', clicks: '120', sales: '0' },
    ],
    btn: 'Remix it', msg: 'Remix sent to Content Marketing agent',
  },
};

snapshot.pages.outreach = {
  title: 'Cold outreach', sub: 'Not sending yet · inboxes are warmed up in Instantly', pill: 'Setup',
  setup: {
    title: 'Get the first campaign live', done: '1 of 6 done', pct: 17,
    steps: [
      { n: 1, title: 'Warm up the sending inboxes', sub: 'Done · all inboxes healthy', pill: 'Done', pillCls: 'ok' },
      { n: 2, title: 'Read your daily maximum from Instantly', sub: 'Sets the "sent today" goal on this page', btn: 'Check now', msg: 'Cold Outreach agent is reading your Instantly limits' },
      { n: 3, title: 'Load the lead list', sub: 'Who should hear about Viral View first', btn: 'Build list', msg: 'Opened lead list builder', btnCls: 'line' },
      { n: 4, title: 'Write the emails', sub: 'First email plus 2 follow-ups, drafted for your approval', btn: 'Draft them', msg: 'Cold Outreach agent is drafting 3 emails', btnCls: 'line' },
      { n: 5, title: 'Send a test to yourself', sub: 'Check it lands in the inbox, not spam', pill: 'Waiting on 4' },
      { n: 6, title: 'Launch', sub: 'Starts small and ramps up over 2 weeks', pill: 'Waiting on 5' },
    ],
  },
  inboxes: {
    title: 'Inbox health', meta: 'Warm-up score out of 100',
    rows: [
      { label: 'Inbox 1', value: '98', pct: 98, pg: 'ok' },
      { label: 'Inbox 2', value: '96', pct: 96, pg: 'ok' },
      { label: 'Inbox 3', value: '94', pct: 94, pg: 'ok' },
      { label: 'Inbox 4', value: '81', pct: 81, pg: 'risk' },
    ],
  },
  live: {
    title: "Once it's live, this page shows",
    rows: [
      { label: 'Sent today', value: '0 of your daily max', pct: 0, pg: 'idle' },
      { label: 'Opened', value: '—', pct: 0, pg: 'idle' },
      { label: 'Replied', value: '—', pct: 0, pg: 'idle' },
      { label: 'Signed up for Viral View', value: '—', pct: 0, pg: 'idle' },
    ],
    empty: 'Replies land here.', emptyRest: 'Interested replies come with a drafted answer and an Approve & send button, the same as Sponsors and Support.',
  },
};

snapshot.pages.support = {
  title: 'Support', sub: 'Email and live chat · checked 5 minutes ago',
  actions: [{ label: 'Approve all safe replies', msg: '3 safe replies sent · refund left for you', primary: true }],
  tiles: [
    tile('chat', 'Waiting on you', '4', { sub: 'All have drafted replies' }),
    tile('clock', 'Oldest has waited', '5 hrs', { pct: 21, pg: 'ok', sub: 'Goal: reply within 24 hours' }),
    tile('check', 'Answered today', '9', { goal: '/ 13', pct: 69, pg: 'ok', sub: '4 left' }),
    tile('dollar', 'Refunds this month', '$0', { sub: 'None yet · 1 request open' }),
  ],
  drafts: {
    title: 'Drafted replies', meta: 'Nothing sends without you',
    rows: [
      { title: '"Export stuck at 90%"', sub: 'Paid plan · waited 5 hours', quote: "Draft: Sorry about that. I've restarted your export and it should finish in about 10 minutes…" },
      { title: '"How do I change the voice?"', sub: 'Free trial · waited 2 hours', quote: 'Draft: You can switch voices from the panel on the right of the editor…' },
      { title: '"Do you have a yearly plan?"', sub: 'Visitor on live chat · waited 40 minutes', quote: 'Draft: Yes, the yearly plan saves you two months…' },
    ],
  },
  money: {
    title: 'Money decisions', pill: '1 open', pillCls: 'risk',
    title2: '"Can I get a refund?"', sub: 'Paid $39 six days ago · used it twice',
    decline: 'Decline', declineMsg: 'Polite decline sent', refund: 'Refund $39', refundMsg: '$39 refunded and reply sent',
  },
  topics: {
    title: 'What people ask about', meta: 'This week · 20 tickets',
    rows: [
      { label: 'Export problems', value: '8', pct: 100 },
      { label: 'Billing', value: '5', pct: 63 },
      { label: 'How-to questions', value: '4', pct: 50 },
      { label: 'Bugs', value: '3', pct: 38 },
    ],
    box: 'Export problems are 40% of tickets. Worth a fix.',
  },
};

snapshot.pages.video = {
  title: 'Video editor', sub: '1 editing now · 1 ready for you to watch',
  editing: {
    title: 'In the editor', meta: 'Steps: upload · rough cut · graphics · sound · export',
    rows: [
      { title: 'Video 2 of the week', sub: 'Step 3 of 5 · adding graphics · about 25 minutes left', pct: 55, pill: 'Editing', pillCls: 'blue' },
      { title: 'Sponsor D · dedicated video', sub: 'Step 1 of 5 · uploaded, waiting its turn', pct: 12, pill: 'Queued', btn: 'Do this first', msg: 'Moved to the front of the line' },
    ],
  },
  ready: {
    title: 'Ready for you to watch',
    rows: [{ title: 'Sponsor C · 90-second cut', sub: '1 min 32 sec · finished at 7:40' }],
  },
  finished: {
    title: 'Finished this week',
    rows: [
      { video: 'Video 1 of the week', finished: 'Tuesday', time: '52 min', where: 'Live on YouTube' },
      { video: 'Sponsor B · 90-second cut', finished: 'Monday', time: '18 min', where: 'Approved by sponsor' },
    ],
  },
  upload: { title: 'Upload a recording', drop: 'Drop a video here', sub: 'The auto editor starts right away', btn: 'Choose file', msg: 'File picker opened' },
  target: {
    title: "This week's target",
    rows: [
      { label: 'YouTube videos', value: '1 of 3', pct: 33, tall: true },
      { label: 'Sponsor cuts', value: '2 of 3', pct: 67, pg: 'ok', tall: true },
    ],
  },
};

snapshot.pages.money = {
  title: 'Finances', sub: 'From MoneyClaw Expenses · bank scan ran at 8:12',
  actions: [
    { label: 'Open MoneyClaw', msg: 'Opens moneyclaw.jonmac.ai' },
    { label: 'Scan banks now', msg: 'Bank scan started' },
  ],
  personal: {
    title: 'Personal', meta: '3 accounts',
    stages: [{ label: 'Yesterday', value: '$0' }, { label: 'This week', value: '$751' }, { label: 'This month', value: '$7,850' }, { label: 'Last month', value: '$9,126' }],
    barLabel: 'September against all of August', barValue: '86% · day 18 of 30', pct: 86, pg: 'risk',
    note: '$300 of this month is still pending.',
  },
  business: {
    title: 'Business', meta: '4 accounts',
    stages: [{ label: 'Yesterday', value: '$0' }, { label: 'This week', value: '$2,235' }, { label: 'This month', value: '$8,227' }, { label: 'Last month', value: '$6,502' }],
    barLabel: 'September against all of August', barValue: '127% · already over', pct: 100, pg: 'crit',
    note: '$1,304 of this month is still pending.',
  },
  categories: {
    title: 'Business · this month by category', meta: '$8,227.48 total',
    note: 'Bars are sized against the biggest category. Click a category to see its charges, the same as in MoneyClaw.',
    rows: [
      { label: 'Misc · 26 charges', value: '$4,263.36 · 52%', pct: 100, pg: 'crit', tall: true },
      { label: 'Software · 28 charges', value: '$1,693.85 · 21%', pct: 39.7, tall: true },
      { label: 'Amazon · 11 charges', value: '$1,381.16 · 17%', pct: 32.4, tall: true },
      { label: 'Business advertising', value: '$284.69', pct: 6.7, tall: true },
      { label: 'Business staff', value: '$250.91', pct: 5.9, tall: true },
      { label: 'Fuel', value: '$182.97', pct: 4.3, tall: true },
      { label: 'Bank fees', value: '$164.29', pct: 3.9, tall: true },
      { label: 'Parking', value: '$6.25', pct: 0.2, min: '3px', tall: true },
    ],
  },
  fix: {
    pill: 'Over half is "Misc"', heading: 'Your X ad charges are filed as Misc',
    body: 'At least 9 X Corp Advertising charges this month sit under Misc, so your ad spend looks far smaller than it is.',
    box: 'Move them to Business advertising and file future ones there automatically.',
    btn: 'Move all 9 and remember', msg: '9 charges moved to Business advertising · rule saved',
  },
  bankScan: {
    title: 'Bank scan', meta: '6 of 7 accounts done', pct: 86, pg: 'risk',
    rows: [
      { title: 'RBC business accounts', sub: '3 of 4 scanned', pill: 'Needs code', pillCls: 'risk', btn: 'Enter code', msg: 'Code box opened' },
      { title: 'Personal accounts', sub: '3 of 3 scanned', pill: 'Scanned', pillCls: 'ok' },
    ],
  },
  netWorth: { title: 'Net worth', meta: '90 days', hidden: '$ • • • • • •', shown: '$ from MoneyClaw', spark: 'M0,46 L25,44 50,45 75,40 100,41 125,36 150,37 175,30 200,32 225,24 250,22 275,17 300,14' },
  charges: {
    title: 'Latest business charges',
    rows: [
      { date: 'Sep 16', charge: 'Payment fee', card: 'Current account', filed: 'Misc', amount: '$23.29' },
      { date: 'Sep 13', charge: 'PayPal · WeLaunch', card: 'RBC US Dollar Visa Gold', filed: 'Misc', amount: '$152.30' },
      { date: 'Sep 13', charge: 'The Daily Virals', card: 'RBC US Dollar Visa Gold', filed: 'Misc', amount: '$80.62' },
      { date: 'Sep 13', charge: 'Yuzu Bowl and Bistro, Kelowna', card: 'RBC Avion Visa Business', filed: 'Misc', amount: '$73.81' },
      { date: 'Sep 12', charge: 'X Corp Advertising', card: 'RBC US Dollar Visa Gold', filed: 'Misc · should be ads', filedCls: 'crit', amount: '$31.41' },
      { date: 'Sep 12', charge: 'X Corp Advertising', card: 'RBC US Dollar Visa Gold', filed: 'Misc · should be ads', filedCls: 'crit', amount: '$37.78' },
    ],
  },
};

snapshot.pages.markets = {
  title: 'Markets', sub: 'From MoneyClaw Market · updated 1:00 PM · after hours',
  actions: [{ label: 'Open MoneyClaw', msg: 'Opens moneyclaw.jonmac.ai market page' }],
  tiles: [
    tile('trend', 'Market mood', 'Calm', { sub: 'After hours' }),
    tile('chart', 'Fear gauge (VIX)', '14.9', { goal: 'low', pct: 30, pg: 'ok', sub: '−3.5% today · above 30 means panic' }),
    tile('dollar', 'VOO', '$701.89', { subHtml: '<span class="up">+0.1%</span> today' }),
    tile('mail', 'News', 'Quiet', { sub: 'No major market news' }),
  ],
  discount: {
    title: 'How big is the discount?', meta: 'Bar fills as the price falls from its all-time high · full bar is 50% off',
    rows: [
      { fund: 'VOO', small: 'S&P 500', price: '$701.90', ath: '$716.39', today: '+0.1%', todayCls: 'up', pct: 4, off: '2.0%', rise: '2.1%', read: 'Near its high' },
      { fund: 'QQQ', small: 'Nasdaq 100', price: '$721.35', ath: '$748.65', today: '+0.6%', todayCls: 'up', pct: 7.2, off: '3.6%', rise: '3.8%', read: 'Near its high' },
      { fund: 'DIA', small: 'Dow', price: '$515.93', ath: '$546.75', today: '−0.5%', todayCls: 'down', pct: 11.2, pg: 'risk', off: '5.6%', rise: '6.0%', read: 'Small discount', readCls: 'risk' },
      { fund: 'XAU', small: 'Gold', price: '$4,421.00', ath: '$5,586.20', today: '+0.5%', todayCls: 'up', pct: 41.8, pg: 'ok', off: '20.9%', rise: '26.4%', read: 'Big discount', readCls: 'ok' },
      { fund: 'IBIT', small: 'Bitcoin fund', price: '$46.02', ath: '$71.82', today: '+6.3%', todayCls: 'up', pct: 71.8, pg: 'ok', off: '35.9%', rise: '56.1%', read: 'Big discount', readCls: 'ok' },
      { fund: 'XAG', small: 'Silver', price: '$66.97', ath: '$121.30', today: '+2.3%', todayCls: 'up', pct: 89.6, pg: 'ok', off: '44.8%', rise: '81.1%', read: 'Big discount', readCls: 'ok' },
    ],
  },
  read: {
    pill: 'No stock sale today', heading: 'The big index funds are within 4% of their highs',
    body: 'VOO is 2% off and QQQ is 3.6% off. Gold, silver and the bitcoin fund are 21% to 45% below their highs.',
    boxTitle: 'This is a read, not advice', box: 'The page only measures distance from the high. What counts as "buy" comes from rules you set on the right.',
  },
  rules: {
    title: 'Your alert rules', meta: 'Example rules · you set the numbers',
    rows: [
      { label: 'Tell me when VOO is 10% off', value: '2.0 of 10', pct: 20 },
      { label: 'Tell me when QQQ is 10% off', value: '3.6 of 10', pct: 36 },
      { label: 'Tell me when the fear gauge passes 30', value: '14.9 of 30', pct: 50 },
    ],
    box: 'When a rule fires you get a Telegram message and a card on the home screen.',
  },
};

snapshot.pages.life = {
  title: 'Life', sub: 'The things that matter outside work',
  actions: [{ label: 'Add a habit', msg: 'New habit box opened' }],
  tiles: [
    tile('heart', 'Workouts this week', '2', { goal: '/ 3', pct: 67, pg: 'ok', sub: 'Today 11:00 finishes the week' }),
    tile('chart', 'Workouts in September', '7', { goal: '/ 8 so far', pct: 88, pg: 'ok', sub: 'Missed one on Sep 9' }),
    tile('check', 'Date nights in September', '2', { goal: '/ 4', pct: 50, pg: 'risk', sub: "This week's isn't booked yet" }),
    tile('fire', 'Full weeks in a row', '1', { sub: '3 workouts plus a date night' }),
  ],
  workouts: {
    title: 'Workouts with your wife', meta: 'Mon · Wed · Fri at 11:00',
    weeks: [
      { title: 'This week', sub: 'Sep 14–20', dots: ['on:M', 'on:W', 'next:F'] },
      { title: 'Last week', sub: 'Sep 7–13', dots: ['on:M', 'miss:W', 'on:F'] },
      { title: 'Two weeks ago', sub: 'Aug 31–Sep 6', dots: ['on:M', 'on:W', 'on:F'] },
    ],
    box: 'Your calendar is blocked 10:45–12:15 on workout days so no sponsor call lands on top.',
    btn: 'Mark today done', msg: 'Friday workout marked done',
  },
  dateNight: {
    title: 'Date night in Kelowna', pill: 'Not booked', pillCls: 'risk',
    rows: [
      { title: 'This week', sub: 'Saturday evening is free on both calendars', btn: 'Book Saturday 6:30', msg: 'Saturday 6:30 PM added to both calendars' },
      { title: 'Last week', sub: 'Thursday · dinner downtown', pill: 'Done', pillCls: 'ok' },
      { title: 'Two weeks ago', sub: 'Saturday · winery dinner', pill: 'Done', pillCls: 'ok' },
    ],
    ideasTitle: "Ideas you haven't done lately", ideas: 'Lakefront walk and dessert · a new restaurant · sunset at a winery',
  },
  today: {
    title: 'Today', meta: 'From your calendar',
    rows: [
      { title: '9:00 · Morning run-through', sub: 'Sponsors, bank scan, support', pill: 'Now', pillCls: 'blue' },
      { title: '11:00 · Workout with your wife', sub: 'Blocked until 12:15', pill: 'Next' },
      { title: '2:00 · Record Video 3', sub: 'Script is ready', btn: 'Open script', page: 'content' },
    ],
  },
};

snapshot.pages.mastermind = {
  title: 'Mastermind', sub: 'AI Advanced group on Telegram · last 24 hours · scanned at 7:30',
  actions: [{ label: 'Scan now', msg: 'Scanning the group now' }],
  tiles: [
    tile('chat', 'Messages read for you', '41', { sub: '3 kept · 38 skipped' }),
    tile('bulb', 'Picks waiting on you', '3', { sub: '2 worth doing · 1 maybe' }),
    tile('send', 'Sent to Planner this month', '5', { sub: '2 already built' }),
    tile('check', 'Ideas built · September', '2', { goal: '/ 5', pct: 40, sub: '3 in progress' }),
  ],
  picks: {
    title: "Today's picks",
    jobs: [
      { area: 'Viral View', pill: 'Worth doing', pillCls: 'ok', title: 'Idea headline goes here', lines: ['What was shared, and by whom', 'Why it fits: where it plugs into Viral View', 'Effort: about half a day'] },
      { area: 'Sponsors', pill: 'Worth doing', pillCls: 'ok', title: 'Second idea headline', lines: ['What was shared, and the link they posted', 'Why it fits: could speed up sponsor replies', 'Effort: about 2 hours'] },
      { area: 'Content', pill: 'Maybe', pillCls: 'risk', title: 'Third idea headline', lines: ['What was shared', "The filter wasn't sure, so it's here for you to decide", 'Effort: 1 to 2 days'] },
    ],
  },
  building: {
    title: 'Being built', meta: 'Ideas you sent to Planner',
    rows: [
      { title: 'Idea from Sep 12', sub: 'Planner · step 3 of 4 · testing', pct: 75, pill: 'Building', pillCls: 'blue' },
      { title: 'Idea from Sep 15', sub: 'Planner · step 1 of 4 · planning', pct: 25, pill: 'Building', pillCls: 'blue' },
      { title: 'Idea from Sep 3', sub: 'Live since Sep 10', pct: 100, pg: 'ok', pill: 'Built', pillCls: 'ok' },
    ],
  },
  parked: {
    title: 'Parked', meta: '4 saved for later',
    rows: [
      { title: 'Parked idea', sub: 'Sep 16 · Content' },
      { title: 'Parked idea', sub: 'Sep 11 · Cold outreach' },
    ],
    more: { title: '2 more', sub: 'Older than 2 weeks', btn: 'Show all', msg: 'Showing all parked ideas' },
  },
};

snapshot.pages.agents = {
  title: 'Agents', sub: '11 pinned in Orca · across the Mac mini and GPU2',
  tiles: [
    tile('clock', 'Need you', '2', { sub: 'Planner · Finances' }),
    tile('bot', 'Working now', '2', { sub: 'Meta Ads · Video Editor' }),
    tile('check', 'Daily jobs done today', '5', { goal: '/ 8', pct: 63, pg: 'ok', sub: '3 run this afternoon' }),
    tile('fire', 'Gone quiet', '1', { sub: 'Content Marketing · 2 days' }),
  ],
  waiting: {
    title: 'Waiting on you',
    jobs: [
      { area: 'Planner', pill: 'Waiting 8 min', pillCls: 'risk', title: '"Pause the 2 ads with no sales?"',
        lines: ['Ad 2 and Ad 3 spent $130 with no sales', 'Ad 1 made one $39 sale'],
        lineBtn: 'Open in Orca', lineMsg: 'Opened Planner in Orca', btn: 'Pause both', msg: 'Told Planner: pause Ad 2 and Ad 3' },
      { area: 'Finances', pill: 'Paused 35 min', pillCls: 'risk', title: "Needs the bank's text code",
        lines: ['Business credit card scan is paused', 'Everything else finished'],
        btn: 'Enter code', msg: 'Code box opened' },
    ],
  },
  all: {
    title: 'All agents',
    rows: [
      { agent: 'Sponsors', runs: 'Mac mini', now: 'Finished inbox scan at 8:05', pct: 100, pg: 'ok', job: 'Done', pill: 'Idle', page: 'sponsors' },
      { agent: 'Finances', runs: 'Mac mini', now: 'Paused on a bank code', pct: 67, pg: 'risk', job: '2 of 3', pill: 'Needs you', pillCls: 'risk', page: 'money' },
      { agent: 'MoneyClaw', runs: 'Mac mini', now: 'Checking prices every 5 minutes', pct: 100, pg: 'ok', job: 'Running', pill: 'Working', pillCls: 'ok', page: 'markets' },
      { agent: 'Telegram', runs: 'GPU2', now: 'Mastermind scan finished at 7:30', pct: 100, pg: 'ok', job: 'Done', pill: 'Idle', page: 'mastermind' },
      { agent: 'Planner', runs: 'GPU2', now: 'Asked you a question', pct: 50, pg: 'risk', job: 'Waiting', pill: 'Needs you', pillCls: 'risk', msg: 'Opened Planner in Orca' },
      { agent: 'Meta Ads', runs: 'GPU2', now: 'Polishing a new ad', pct: 40, job: '40%', pill: 'Working', pillCls: 'ok', page: 'viral' },
      { agent: 'Content Marketing', runs: 'GPU2', now: 'Last ran 2 days ago', pct: 0, pg: 'crit', job: 'Not run', pill: 'Quiet too long', pillCls: 'crit', restart: 'Restart', restartMsg: 'Content Marketing agent restarted' },
      { agent: 'Cold Outreach', runs: 'GPU2', now: 'Morning check done · not sending', pct: 100, pg: 'ok', job: 'Done', pill: 'Idle', page: 'outreach' },
      { agent: 'Customer Support', runs: 'GPU2', now: '4 drafts ready for you', pct: 100, pg: 'ok', job: 'Done', pill: 'Idle', page: 'support' },
      { agent: 'YouTube', runs: 'GPU2', now: 'Script for Video 3 is ready', pct: 100, pg: 'ok', job: 'Done', pill: 'Idle', page: 'content' },
      { agent: 'Video Editor', runs: 'GPU2', now: 'Editing Video 2 · 25 minutes left', pct: 55, job: '55%', pill: 'Working', pillCls: 'ok', page: 'video' },
    ],
  },
};

function dump(obj) {
  const { pages, ...rest } = obj;
  const keys = Object.keys(rest);
  let s = '{\n';
  for (const k of keys) s += `  ${JSON.stringify(k)}: ${JSON.stringify(rest[k])},\n`;
  s += '  "pages": {\n';
  const ids = Object.keys(pages);
  ids.forEach((id, i) => {
    s += `    ${JSON.stringify(id)}: ${JSON.stringify(pages[id])}${i < ids.length - 1 ? ',' : ''}\n`;
  });
  return s + '  }\n}\n';
}
const out = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/snapshot.json');
const text = dump(snapshot);
writeFileSync(out, text);
console.log('wrote', out, 'lines', text.split('\n').length);
