// Jon's Bluesky 2027 doc as it stood on 2026-11-10, copied unchanged from the approved design (briefs\dashboard3\Bluesky.dc.html).
// Change the words here; the layout is in bluesky.js. Do not rewrite it without Jon.
/* eslint-disable */
export const TABS = [['vision', 'Vision and plans'], ['okrs', 'OKRs 2027'], ['quarters', 'Quarters'], ['depts', 'Departments'], ['y2026', '2026 reflection'], ['call', 'Your call']];
const num = function (list) { return list.map(function (x, i) { x.n = String(i + 1); x.first = i === 0 ? 'first' : ''; return x; }); };
export const values = num([
  { t: 'The system runs without me.', d: 'Work moves from stage to stage with no one messaging a bot to continue. Jon is asked only about money, words under his name, and exceptions.' },
  { t: 'One number per goal.', d: 'Every project has a written target and a live count against it. No number, no goal.' },
  { t: 'Checked before it reaches me.', d: 'QC is the gate. Nothing goes to Jon or to a sponsor without a pass.' },
  { t: 'Scripts before tokens.', d: 'Mechanical work is a script with no model call. Models are for judgment.' },
  { t: 'Family first.', d: 'Three workouts a week and four date nights a month with my wife stay on the board beside the business numbers.' }
]);
const C = function (v, s, tag) { return { v: v || '', hasV: !!v, s: s || '', hasS: !!s, tag: tag || '', hasTag: !!tag }; };
export const horizons = [
  { alt: '50,000 ft', when: '5 years · 2031', cells: [C('$250,000', '', 'Draft'), C('One check-in a week', '', 'Draft'), C('150', '', 'Draft')] },
  { alt: '30,000 ft', when: '3 years · 2029', cells: [C('$100,000', 'No engine above 40% of it.', 'Draft'), C('One check-in a day', '', 'Draft'), C('100', '', 'Draft')] },
  { alt: '20,000 ft', when: '12 months · Nov 2027', cells: [C('$40,000', 'Sponsors $10,000, ebooks $10,000, Viral View $10,000 recurring, webinar $10,000.', 'Written goals'), C('Two check-ins a day', '8:00 AM and 4:00 PM, and no “continue” messages.', 'Jon’s decision, Nov 10'), C('54', 'Home Guide Press 48, Jon Mac main 3, @JonMacAI 3.', 'Written goals')] },
  { alt: 'Today', when: 'Nov 10, 2026', cells: [C('', 'Sponsors $1,500 so far in November. Ebooks $0 in the week of Nov 2 to 8. Viral View $146 recurring. Webinar not tracked.', ''), C('Not measured', 'The team is stopped and new chats do not continue by themselves.', ''), C('9 of 54', 'This week, all Home Guide Press.', '')] }
];
const K = function (t, type, start) { return { t: t, type: type === 'C' ? 'Committed' : 'Aspirational', start: start }; };
export const okrs = [
  { id: 'OKR 1', title: 'Make sponsor income a dependable $10,000 a month', owner: 'Florence. Jon sends the emails and the invoices.', why: 'Sponsors are priority 1 in the team’s rules and the fastest money. A steady $10,000 a month pays for the team while the other engines grow.', krs: [
    K('Collect $120,000 from sponsors in 2027', 'A', '$1,500 so far in November'),
    K('Sign 100 deals in the year, 2 a week', 'A', 'Not counted'),
    K('Deliver every sponsor video on or before its due date: 0 late', 'C', 'Not counted'),
    K('Send every invoice within 1 day of approval: $0 agreed and not invoiced after 7 days', 'C', '$5,500 agreed, not invoiced')] },
  { id: 'OKR 2', title: 'Turn Home Guide Press into an ebook business that sells $10,000 a month', owner: 'Elle.', why: 'The 16 channels cost tokens and GPU time every day and exist to sell books. Videos passed is the input; ebook sales is the result that counts.', krs: [
    K('Reach $10,000 of ebook sales in one month by December 2027', 'A', '$0 in the week of Nov 2 to 8'),
    K('Pass 48 videos through QC a week, in 45 of 52 weeks', 'C', '9 this week'),
    K('70% of videos pass QC on the first try', 'C', '11 of 27 (41%)'),
    K('Measure tokens per finished video in the pilot, then cut it in half by June 30', 'C', 'Not measured')] },
  { id: 'OKR 3', title: 'Grow an audience on Jon’s channels that buys what Jon builds', owner: 'Sydney for the two channels, Scarlett for Viral View.', why: 'The main channel is what sponsors pay for, and @JonMacAI exists to promote Viral View. Publishing on a rhythm is the one part of audience growth the team controls.', krs: [
    K('Publish 150 long-form videos on Jon Mac main, 3 a week', 'C', '0 of 3 in the week of Nov 2 to 8'),
    K('Publish 150 videos on @JonMacAI, 3 a week', 'C', '3 done in the week of Nov 2 to 8'),
    K('Take Viral View from $146 to $10,000 of recurring revenue a month', 'A', '$146, paused Nov 9')] },
  { id: 'OKR 4', title: 'Run the team without babysitting, at a cost Jon can see', owner: 'Ana. Lucy builds it.', why: 'Every hour Jon spends restarting chats is an hour not spent filming. Every week at the token limit stops all four engines at once.', krs: [
    K('Jon sends 0 “continue” messages to any bot, every month', 'C', 'Still needed on Nov 10'),
    K('0 weeks at the weekly token limit', 'C', 'Limit reached Nov 3, 6 and 10'),
    K('90% of Jon’s approvals answered inside the two daily batches', 'A', 'Not measured'),
    K('First call of every run at or under 25,000 input tokens', 'C', '37,400 to 44,900 in OpenBot'),
    K('Daily bank import succeeds on 95% of days', 'C', '4 of 8 runs')] },
  { id: 'Personal', title: 'Protect health, marriage and net worth while the business grows', owner: 'Jon.', why: 'This one is outside the template. It uses the two life targets already on the dashboard.', krs: [
    K('156 workouts with my wife, 3 a week', 'C', 'Not counted'),
    K('48 date nights, 4 a month', 'C', 'Not counted'),
    K('Review net worth on the 1st of all 12 months', 'C', 'First reminder due Dec 1'),
    K('Dip alerts for VOO and QQQ working by Jan 31', 'C', 'Asked Oct 22, never built')] }
].map(function (o) { o.krs = num(o.krs); o.total = String(o.krs.length); return o; });
export const quarters = [
  { title: 'Next quarter: Q1 2027 (Jan to Mar)', kind: '10,000 ft · 90-day projects', intro: 'Q1 makes the four switched-on engines hit their written weekly numbers before anything paused is turned back on.', hasNote: true, note: 'Before Q1, the rest of 2026 is the restart: Arcads video 1 (due Nov 12), Topview video 3 (due Nov 16), the 15 approved videos scheduled, and Home Guide Press at 7 QC-passed videos a day.', rows: [
    { p: 'Sponsors at goal', d: '$10,000 collected in each of January, February and March; 2 deals signed a week; no sponsor video late', o: 'Florence' },
    { p: 'Home Guide Press line at full pace', d: '48 QC-passed videos a week for 8 weeks in a row; 70% pass QC on the first try (11 of 27 today)', o: 'Elle' },
    { p: 'Jon’s two channels on rhythm', d: 'Jon Mac main 3 a week and @JonMacAI 3 a week, published by the bot after QC', o: 'Sydney' },
    { p: 'Books handed over', d: 'January is the third matching month of shadow books; Elizabeth then takes over QuickBooks and Hubdoc', o: 'Elizabeth' },
    { p: 'Dashboard 3 and OKR rhythm', d: 'Queue, Line, Goals and Money live; a weekly check-in every Monday and a review on the first Friday of each month', o: 'Lucy, Ana' },
    { p: 'Decide what to switch back on', d: 'A yes or no from Jon on Viral View, the webinar funnel and short-form, with the token cost of each', o: 'Jon, Ana' }] },
  { title: 'Quarter after next: Q2 2027 (Apr to Jun)', kind: '10,000 ft · 120-day projects', intro: 'Q2 turns the paused engines back on one at a time, only if Q1 held its numbers.', hasNote: false, note: '', rows: [
    { p: 'Viral View back on', d: 'Recurring revenue up from $146 a month toward the written $10,000 goal; its 7 channels at 3 videos a week each', o: 'Scarlett' },
    { p: 'Webinar funnel live', d: 'First session live and recorded, then a daily automated replay; Meta campaigns on at $100 a day after Jon switches them on', o: 'Scarlett' },
    { p: 'Short-form back on', d: '3 clips a day, posted on every platform', o: 'Sydney' },
    { p: 'Ebook sales climbing', d: 'Ebook sales reported per channel each week, on the way to $10,000 a month', o: 'Elle' },
    { p: 'More video lines', d: 'A second Home Guide Press line added only when tokens per passed video have fallen', o: 'Ana, Lucy' }] }
];
export const depts = [
  { d: 'People', w: 'Ana', q1: '9 roles running from cards with no chat restarts; a Stuck list cleared once a day, at most 3 items to Jon per batch', q2: 'Add a second video line only if tokens per passed video have fallen' },
  { d: 'Finance and Admin', w: 'Elizabeth', q1: 'Bank import on 95% of days; weekly cash P&L every Monday; January shadow books match, then take over QuickBooks and Hubdoc', q2: 'Monthly P&L by the 5th working day; invoices drafted the day a sponsor approves' },
  { d: 'Marketing', w: 'Sydney, Elle', q1: 'Jon Mac main 3 a week; @JonMacAI 3 a week; Home Guide Press 48 a week; no approved video waits more than 3 days to go live', q2: 'Short-form back on at 3 clips a day; Viral View’s 7 channels at 3 a week each' },
  { d: 'Sales', w: 'Florence', q1: '$10,000 of sponsor money each month; 2 deals signed a week; 5 new qualified leads a day with a pitch draft', q2: 'Hold $10,000 a month with no single sponsor above half of it (draft)' },
  { d: 'Success', w: 'Florence, Jessica', q1: '0 late sponsor deliveries; every deliverable passes QC before the sponsor sees it', q2: 'A repeat deal from at least half of the sponsors delivered in Q1 (draft)' },
  { d: 'Product', w: 'Elle, Scarlett', q1: '20 ebook pages kept matching their source pages; ebook sales counted per channel each week', q2: 'Viral View back on with its morning numbers; webinar’s first live session recorded' },
  { d: 'Engineering', w: 'Lucy', q1: 'Dispatcher with slots, caps and a pause file; Dashboard 3 live; one targets file; coding cards close after QC', q2: 'Tokens per finished video on the dashboard; old wakers, duplicate scripts and dead routines removed' },
  { d: 'Legal', w: 'Jon', q1: 'Open question: which company invoices sponsors (Ecomm House Inc., 1119432 BC Ltd or Commerce HQ Inc.)', q2: 'Open question: a standard sponsor agreement for Florence to attach' }
];
export const highlights = num([
  { t: 'A 15-bot team was built, audited on Nov 10, and redesigned as 9 roles with one starter and capped runs.', tone: 'g' },
  { t: 'Home Guide Press has 16 focus channels and 20 book pages live, with 20 working Buy links (deploy of Nov 9).', tone: 'g' },
  { t: 'Topview sponsor videos 1 and 2 were approved; video 3 is in work.', tone: 'g' },
  { t: 'Atoms ($2,500) and Enter ($3,000) are agreed and not yet invoiced.', tone: 'y' },
  { t: 'What went badly: the weekly token limit was reached on Nov 3, 6 and 10; about $4,194 of usage at list price in 10 days, about $1,859 of it bots messaging each other.', tone: 'r' }
]);
export const learn = [
  { d: 'People', w: '15 bots with overlapping jobs; 6 roles retired in November', l: 'Fewer roles, one owner per stage' },
  { d: 'Finance and Admin', w: 'Daily bank import worked on 4 of 8 runs; 15 charge questions unanswered; shadow books started in November', l: 'The import is a script with its own retry; questions go to Jon once a week' },
  { d: 'Marketing', w: 'Jon Mac main 0 of 3 and @JonMacAI 3 done in the week of Nov 2 to 8; 15 approved videos not yet live', l: 'The bot publishes after QC so approved work does not wait' },
  { d: 'Sales', w: 'One sponsor deposit in November; 6 sponsor replies waiting on Jon', l: 'Replies arrive in two batches a day with a Send button' },
  { d: 'Success', w: 'Arcads video 1 and Topview video 3 are the open sponsor deliveries; no late count is kept', l: 'Count on-time deliveries as a key result' },
  { d: 'Product', w: 'Viral View at $146 a month and paused with the webinar on Nov 9; 20 ebook pages live', l: 'Fix the engines that are on before adding ones that are off' },
  { d: 'Engineering and Data', w: '249 coding cards with 112 waiting in review; first-try QC pass 11 of 27; dashboard numbers stale or missing', l: 'Coding cards close after QC; one targets file feeds rules and dashboard' }
];
export const calls = num([
  { t: 'The vision sentence and the five values.' },
  { t: 'The 3-year and 5-year numbers ($100,000 and $250,000 a month are placeholders).' },
  { t: '@JonMacAI at 3 a week (the rules) or 7 a week (Dashboard 2).' },
  { t: 'Whether Viral View, the webinar funnel and short-form come back in Q2 2027 or stay off.' },
  { t: 'A subscriber or view number for OKR 3. No channel numbers were on record.' },
  { t: 'Which company invoices sponsors, and whether Topview’s balance invoice #1073 was sent.' },
  { t: '2026 highlights from before October, which the team’s files do not cover.' },
  { t: 'Anything missing on the personal side: only workouts, date nights, net worth and dip alerts are on record.' }
]);
