// The 7-day email sequence for the AI Video Lab Skool group (Jon's ask, 2026-11-16), as plain data plus a renderer.
// Day 0 goes out right after the email is entered, then days 1 to 6, one idea per email. Written in Jon's spoken voice
// (rules/skills/jon-mac-speaking-voice): casual, value first, a soft sell that builds to one clear offer on days 5 and 6.
// Original copy. No numbers, results, testimonials or deadlines are claimed: the only facts used are the ones on the
// group's own about page (what is inside, and the price line below). Jon reads all seven on /track/emails before he switches
// the sequence on. Edit the words here; {{video}} is the title of the video the lead came from, {{link}} their Skool link.
export const SKOOL_ABOUT = 'https://www.skool.com/ai-ugc';
// The only price in the copy. Check it against the Skool page before switching the sequence on.
export const PRICE_LINE = '$9 a month, and you can cancel any time';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const EMAILS = [
  {
    day: 0,
    subject: 'Got your email (and one quick tip)',
    preview: 'One idea you can use on your next AI video.',
    paras: [
      'Hey, Jon here.',
      'So you came over from my video "{{video}}", and I wanted to say thanks for stopping by. Really.',
      "Over the next week I'm going to send you one short email a day. Each one has one idea you can use on your next AI video, no matter which tool you're using. That's it.",
      "Here's idea number one, and it's very very simple: make one shot at a time.",
      "When you ask an AI tool for a whole scene in one prompt, it has to guess at everything, and that's where the weird hands and the floaty faces come from. Ask for one shot instead. One person, one action, one camera move, about five seconds. Then stitch the shots together in your editor.",
      "Try it on your next video and see how much cleaner it looks. I think you're gonna like it.",
      "And if you're curious what the AI Video Lab actually is, it's the Skool group I run for exactly this stuff. Here's the page, no rush:",
    ],
    cta: 'See the AI Video Lab page',
    ps: ["P.S. If this isn't for you, there's an unsubscribe link at the very bottom and it works in one click. No hard feelings."],
  },
  {
    day: 1,
    subject: 'The 5 boxes I fill in before every prompt',
    preview: 'Why vague prompts give you fake-looking video.',
    paras: [
      'Hey, Jon here.',
      "Yesterday was one shot at a time. Today is how to write that one shot so it stops looking like AI.",
      'Most fake-looking video starts with a vague prompt. Something like "a woman talking about skincare" leaves the tool with about a thousand decisions to make, and it makes all of them for you.',
      'So before I write any prompt, I fill in five boxes:',
      '1. Who: age, look, what they\'re wearing.\n2. Where: the room, kitchen, car, whatever it is.\n3. What they\'re doing: one action, not three.\n4. Camera: handheld selfie, close up, over the shoulder.\n5. Light: soft window light, daytime, lamp at night.',
      'Here\'s what that looks like: "A woman in her 30s in a grey hoodie, sitting on her kitchen counter, holding a face cream jar up to the camera and smiling, handheld selfie style, soft window light from the left."',
      "Nothing fancy, right? Specific beats clever every single time.",
      "That's the whole idea for today. If you want to see how the rest of it fits together, the group is here:",
    ],
    cta: 'Take a look inside the AI Video Lab',
    ps: ["P.S. Tomorrow: how to get the same face in every shot. That's the one that trips up almost everybody."],
  },
  {
    day: 2,
    subject: 'Same face, every shot',
    preview: 'The reason your character keeps changing.',
    paras: [
      'Hey, Jon here.',
      "Ever make a great first clip, then the second clip comes out and it's a completely different person? Yeah. That's the thing that makes AI video feel cheap, and it's fixable.",
      "Here's the idea: lock your character.",
      "First, pick one reference image of the person you want to use. Second, write one sentence that describes them, and then paste that exact sentence at the start of every prompt. Don't reword it. If you say \"brown hair\" in one prompt and \"brunette\" in the next, you've just handed the tool a reason to change the face.",
      "Most of the big tools have some kind of reference image feature now, so check what yours offers and use it every time.",
      "One person, one sentence, one reference image. Do that and your clips start to look like they belong to the same video, which is super important if you want anyone to believe it.",
      "Character consistency is one of the main things we dig into inside the AI Video Lab, if you want to go deeper:",
    ],
    cta: 'See how the group covers it',
    ps: ["P.S. Tomorrow is about the first two seconds of your video, because that's where most people leave."],
  },
  {
    day: 3,
    subject: 'The first 2 seconds',
    preview: 'Write the hook first. Everything else comes after.',
    paras: [
      'Hey, Jon here.',
      "Doesn't matter how good your AI video looks if nobody watches past the first two seconds. So here's what I'd do: write the hook first, before any shots, before any prompts.",
      "Think of the video as four little pieces:",
      '1. Hook: something that makes a thumb stop.\n2. Problem: what the person is stuck on.\n3. Show it: the product or the idea, doing its job.\n4. One ask: one thing you want them to do next.',
      "A few hook shapes that work for talking-to-camera clips:",
      '- "Stop doing X if you want Y."\n- "Here\'s the thing nobody tells you about X."\n- "I didn\'t think this would work, but..."',
      "The best UGC style videos feel like a person telling a friend something, not a brand making an announcement. So write it the way you'd say it out loud, and read it out loud before you generate anything. If it sounds like a blog post, rewrite it.",
      "We do a lot of hooks, scripts and teardowns in the group if that's your thing:",
    ],
    cta: 'Peek inside the AI Video Lab',
    ps: ["P.S. Tomorrow I'll show you how I get Claude to do the boring parts, so you spend your time on the fun parts."],
  },
  {
    day: 4,
    subject: 'Let Claude write the boring parts',
    preview: 'Ten hooks and ten shot prompts from one product description.',
    paras: [
      'Hey, Jon here.',
      "Okay, so you've got the five boxes, you've got a locked character, and you've got a hook. Now there's a lot of typing. Here's how I'd cut that down.",
      "Give Claude three things: your character sentence, your five boxes, and a short description of the product or idea. Then ask it something like:",
      '"Write 10 different hooks for a 15 second talking-to-camera video, and for each one write the shot prompt using my character sentence and my five boxes."',
      "Now you've got ten options to choose from instead of a blank page. Pick the best two or three and make those.",
      "One honest note: read everything it writes and rewrite any line that doesn't sound like a real person. Claude is a really good first draft, it's not the finished video.",
      "Claude Code workflows are a big part of what we build in the AI Video Lab, because once you have a process like this, making videos gets a lot lighter. Here's the group if you want a look:",
    ],
    cta: 'See the workflows inside the group',
    ps: ["P.S. Tomorrow I'll lay out exactly what's inside the AI Video Lab, in plain words, so you can decide if it's for you."],
  },
  {
    day: 5,
    subject: "What's actually inside the AI Video Lab",
    preview: 'Plain words, no hype. Then you decide.',
    paras: [
      'Hey, Jon here.',
      "You can learn all of this on your own. Lots of videos out there, lots of trial and error. That works. The thing that slows most people down isn't the tools though, it's not knowing whether what they made is any good, or what to fix next.",
      "That's what the AI Video Lab is for. It's my Skool group, and here's what's in it:",
      '- Realistic AI UGC, talking avatars, product videos, AI influencers and faceless content.\n- Step-by-step workflows for Higgsfield, Seedance, Kling, Veo, Claude Code and Codex.\n- Character consistency, prompts, scenes, camera movement, lighting, voice and editing.\n- Feedback on your videos, your prompts, your offers and your creative direction.\n- Weekly workflow drops, tool updates, teardowns and challenges.',
      "It's {{price}}. If it's not for you, cancel and that's it.",
      "If you want in, here's the link:",
    ],
    cta: 'Join the AI Video Lab',
    ps: ["P.S. I'm not going to pretend a group does the work for you. You still make the videos. What it gives you is a clear path and people to ask when you get stuck."],
  },
  {
    day: 6,
    subject: 'Last one from me (for now)',
    preview: 'A quick recap, and the link if you want it.',
    paras: [
      'Hey, Jon here.',
      "This is the last email in this little series, so here's the whole week in one place:",
      '1. One shot at a time.\n2. Fill in the five boxes: who, where, what they\'re doing, camera, light.\n3. Lock your character with one sentence and one reference image.\n4. Write the hook first.\n5. Let Claude draft the boring parts, then make it sound like a human.',
      "If you use just those five, I think you'll see the difference in your next video.",
      "And if you'd like help, feedback and workflows to go with it, the AI Video Lab is {{price}}. No countdown from me and no tricks, the link is just here whenever you want it:",
    ],
    cta: 'Join the AI Video Lab',
    ps: ["P.S. Thanks for reading all the way through. Keep an eye on the channel for new videos, and keep making stuff. That's honestly the best way to get better."],
  },
];

export const SEQUENCE_DAYS = EMAILS.length;

// The Skool link for a lead's email: their own video slug and the day in utm_campaign.
export function skoolLink(slug, day) {
  const u = new URL(SKOOL_ABOUT);
  u.searchParams.set('utm_source', 'email');
  u.searchParams.set('utm_medium', 'sequence');
  u.searchParams.set('utm_campaign', `${slug || 'unknown'}-email-d${day}`);
  return u.href;
}

const fill = (s, v) => s.replace(/\{\{video\}\}/g, v.video).replace(/\{\{price\}\}/g, PRICE_LINE);

// One email, ready to send: { subject, text, html }. title is the video the lead came from (may be empty).
export function renderEmail(day, { title = '', slug = '', unsubUrl, business, address }) {
  const e = EMAILS[day];
  if (!e) throw new Error(`No email for day ${day}`);
  const v = { video: (title || 'my video').trim() };
  const link = skoolLink(slug, day);
  const social = ['ig', 'tt', 'x', 'fb', 'li', 'youtube'].includes(slug); // bio links: no video to name
  const paras = e.paras.map((p) => fill(social ? p.replace('from my video "{{video}}"', 'from my profile') : p, v));
  const ps = e.ps.map((p) => fill(p, v));
  const why = `You're getting this because you entered your email${slug ? ` on jonmac.ai/${slug}` : ''} to get to the AI Video Lab on Skool.`;
  const text = [...paras, `${e.cta}: ${link}`, 'Jon', ...ps, '--', `${business}\n${address}`, why, `Unsubscribe in one click: ${unsubUrl}`].join('\n\n');
  const para = (p) => {
    const lines = p.split('\n');
    return `<p style="margin:0 0 16px">${lines.map((l) => esc(l)).join('<br>')}</p>`;
  };
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(fill(e.preview, v))}</div>
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1f1f1f">
${paras.map(para).join('\n')}
<p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#f8d481;color:#202124;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:8px">${esc(e.cta)}</a></p>
<p style="margin:0 0 16px">Jon</p>
${ps.map(para).join('\n')}
<hr style="border:0;border-top:1px solid #dddddd;margin:28px 0 12px">
<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#6b6b6b">${esc(business)}<br>${esc(address)}</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#6b6b6b">${esc(why)} <a href="${esc(unsubUrl)}" style="color:#6b6b6b">Unsubscribe in one click</a>.</p>
</div></body></html>`;
  return { subject: e.subject, text, html, link };
}
