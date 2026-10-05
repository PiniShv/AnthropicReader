/* Sample data, part 3: projects, memory and Claude Design chats. Made up, like
 * everything in demo.js. */
'use strict';

/* ---------- Projects ---------- */

function demoProjects() {
  const project = (key, owner, ownerName, name, description, created, updated, docs, flags) => Object.assign({
    uuid: demoUuid('project:' + key), name, description, is_private: true, is_starter_project: false, prompt_template: '',
    created_at: demoIso(demoMs(created), 'p6'), updated_at: demoIso(demoMs(updated), 'p6'),
    creator: { uuid: demoUser(owner), full_name: ownerName },
    docs: docs.map(([filename, content, at], i) => ({ uuid: demoUuid('doc:' + key + ':' + i), filename, content, created_at: demoIso(demoMs(at), 'p6') })),
  }, flags || {});

  const welcomeEmail = demoLines(
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8"><title>Welcome to Northwind</title>',
    '<style>',
    'body{margin:0;background:#f3f1ec;font:16px/1.6 system-ui,sans-serif;color:#1f1e1c}',
    '.mail{max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}',
    '.top{background:#1f9d6b;color:#fff;padding:28px 32px}.top h1{margin:0;font-size:24px}',
    '.body{padding:24px 32px}.btn{display:inline-block;background:#1f9d6b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px}',
    '.note{color:#6b665d;font-size:14px}',
    '</style></head>',
    '<body><div class="mail">',
    '<div class="top"><h1>Welcome to Northwind, {{first_name}}!</h1></div>',
    '<div class="body">',
    '<p>Your team space is ready. Three steps get most teams going in their first week:</p>',
    '<ol><li>Invite two teammates</li><li>Create your first project</li><li>Book a 20-minute kickoff call with us</li></ol>',
    '<p><a class="btn" href="#">Open my team space</a></p>',
    '<p class="note">Questions? Just reply to this email.</p>',
    '</div></div></body></html>',
  );

  return [
    project('onboarding', 'amara', 'Amara Okafor', 'Customer Onboarding', 'Everything we know about getting new customer teams up and running.', '2026-05-12T08:30', '2026-09-10T14:05', [
      ['claude/README.md', demoLines(
        '# Customer Onboarding',
        '',
        'This project holds what Claude needs to help with customer onboarding at Northwind Labs.',
        '',
        '## What is in here',
        '- `source/welcome-email.html`: the email new customers get on day one',
        '- `reference/kickoff-deck.pptx`: text from the deck we use in the first call',
        '',
        '## How to help',
        '- Keep answers short and practical.',
        '- Use our funnel names: signed up, invited teammates, first project, active in week 4.',
      ), '2026-05-12T08:31'],
      ['source/welcome-email.html', welcomeEmail, '2026-05-12T08:33'],
      ['reference/kickoff-deck.pptx', demoLines(
        '## Slide 1', '', 'Customer kickoff', '', 'Northwind Labs', '',
        '## Slide 2', '', 'Your first 30 days', '', '- Week 1: invite your team', '- Week 2: start your first project', '- Week 4: review together', '',
        '## Slide 3', '', 'Who to contact', '', 'Your onboarding manager replies within one working day.',
      ), '2026-06-02T10:12'],
    ]),
    project('getting-started', 'kenji', 'Kenji Watanabe', 'Getting started with Claude', 'An example project that shows how projects work.', '2026-05-04T09:00', '2026-05-04T09:00', [
      ['Prompting tips.md', demoLines(
        '# Prompting tips',
        '',
        '1. Say who the answer is for.',
        '2. Paste the material you want Claude to use.',
        '3. Ask for a format: a table, a list, a short email.',
        '4. Ask again for a shorter or simpler version when you need one.',
      ), '2026-05-04T09:00'],
    ], { is_starter_project: true }),
    project('analytics', 'priya', 'Priya Raman', 'Analytics playbook', 'Shared definitions and helpers for product analytics.', '2026-06-20T11:00', '2026-09-15T09:20', [
      ['claude/metrics-glossary.md', demoLines(
        '# Metrics glossary',
        '',
        '| Metric | Definition |',
        '|---|---|',
        '| Active team | At least one action in the last 7 days |',
        '| Churned team | No activity for 30 days |',
        '| Weekly churn | Teams that churned this week ÷ active teams at the start of the week |',
        '| Activation | Invited a teammate **and** created a first project |',
        '',
        'All numbers come from the `events_daily` table in the warehouse.',
      ), '2026-06-20T11:02'],
      ['source/kpi-helpers.js', demoLines(
        '// Small helpers used in our notebook charts.',
        'export function churnRate(churned, activeAtStart) {',
        '  return activeAtStart ? churned / activeAtStart : 0;',
        '}',
        '',
        'export function weekLabel(isoDate) {',
        '  return new Date(isoDate).toLocaleDateString(\'en-GB\', { day: \'numeric\', month: \'short\' });',
        '}',
        '',
      ), '2026-07-03T15:40'],
    ], { is_private: false }),
    project('untitled', 'jonas', null, '', '', '2026-08-31T09:30', '2026-08-31T09:30', []),
  ];
}

/* ---------- Memory ---------- */

function demoMemories() {
  const onboarding = demoUuid('project:onboarding');
  const file = (path, at, content) => ({ path, content, updated_at: demoIso(demoMs(at), 'p6') });
  const memory = (owner, files, chatMemory, projectMemories) => {
    const m = {};
    if (chatMemory) m.conversations_memory = chatMemory;
    if (projectMemories) m.project_memories = projectMemories;
    m.memory_files = files.sort((a, b) => a.path.localeCompare(b.path));
    m.account_uuid = demoUser(owner);
    return m;
  };

  return [
    memory('amara', [
      file('/profile.md', '2026-09-09T15:20', demoLines(
        '---', 'name: profile', 'description: Who Amara is and how she likes to work', 'sources: [backfill]', 'aliases: []', '---',
        '- [stated] Product lead at Northwind Labs, based in Lisbon',
        '- [stated] Leads [[customer-onboarding]] this year',
        '- [stated] Likes a short summary with a table first, details after (see [[report-style]])',
        '- [stated] Writes in British English')),
      file('/areas/customer-onboarding.md', '2026-09-09T15:21', demoLines(
        '---', 'name: customer-onboarding', 'description: Onboarding for new customer teams: goals, numbers and owners', 'sources: [backfill, chat]', 'aliases: [onboarding, "first 30 days"]', '---',
        '- [stated] Owns the Q4 rollout of the onboarding checklist to every customer team',
        '- [stated] Main number is "active in week 4"; it was 49% in Q3',
        '- [stated] Works with [[kenji-watanabe]] on the activation dashboard')),
      file('/people/kenji-watanabe.md', '2026-08-27T10:02', demoLines(
        '---', 'name: kenji-watanabe', 'description: Platform engineer who builds the activation dashboard with Amara', 'sources: [chat]', 'aliases: [Kenji]', '---',
        '- [stated] Owns the data pipeline behind the onboarding dashboard',
        '- [stated] Prefers written specs over meetings')),
      file('/topics/report-style.md', '2026-09-02T12:44', demoLines(
        '---', 'name: report-style', 'description: How Amara wants reports and summaries to look', 'sources: [cowork]', 'aliases: [reports]', '---',
        '- [stated] One page, a table of contents, numbers in a table',
        '- [stated] Publishes finished reports as artifacts for the whole team')),
      file('/projects/' + onboarding + '/index.md', '2026-08-27T10:00', '---\nname: "Customer Onboarding"\ndescription: Customer Onboarding\n---\n'),
      file('/projects/' + onboarding + '/overview.md', '2026-09-10T14:06', demoLines(
        '---', 'name: overview', 'description: What the Customer Onboarding project is for and where it stands', 'sources: [chat]', 'aliases: []', '---',
        '- [stated] Holds the onboarding checklist, the welcome email and the kickoff deck',
        '- [stated] Q4 goal: raise "active in week 4" from 49% to 55%')),
    ], demoLines(
      '**Work context**', '',
      'Amara is the product lead for customer onboarding at Northwind Labs. She plans the onboarding programme, tracks activation numbers and writes the quarterly onboarding report.', '',
      '**Top of mind**', '',
      'Rolling out the new onboarding checklist in Q4, and raising the share of teams that are still active in their fourth week.', '',
      '**Brief history**', '',
      'Over the summer Amara worked on the Q3 onboarding report, a launch email for the activation dashboard and the Q4 roadmap.',
    ), {
      [onboarding]: demoLines(
        '**Purpose & context**', '',
        'This project collects the material for customer onboarding: the checklist, the welcome email and the kickoff deck.', '',
        '**Current state**', '',
        'The Q3 report is published. The checklist rollout starts in October.', '',
        '**Key learnings & principles**', '',
        '- Teams that invite a teammate in week one are twice as likely to stay active.',
        '- Short emails get more replies than long ones.',
      ),
    }),
    // No chat memory summary: the key is simply missing, as in real exports.
    memory('kenji', [
      file('/preferences.md', '2026-08-28T09:12', demoLines(
        '---', 'name: preferences', 'description: How Kenji wants answers', '---',
        '- [stated] Code first, explanation after',
        '- [stated] Python examples unless he asks for another language')),
      file('/profile.md', '2026-08-28T09:13', demoLines(
        '---', 'name: profile', 'description: Who Kenji is', 'sources: [backfill]', 'aliases: []', '---',
        '- [stated] Backend engineer on the platform team',
        '- [stated] Working on [[rate-limiting]] for the public API')),
      file('/topics/rate-limiting.md', '2026-09-22T15:30', demoLines(
        '---', 'name: rate-limiting', 'description: Rate limits for the public API: the chosen design and open questions', 'sources: [chat]', 'aliases: [throttling, "token bucket, per customer"]', '---',
        '- [stated] Chose a token bucket per customer: 100 requests per minute, bursts of 20',
        '- [stated] Open question: share the buckets across the three app servers with Redis')),
    ]),
    memory('noor', [
      file('/profile.md', '2026-09-11T12:40', demoLines(
        '---', 'name: profile', 'description: Who Noor is and how she likes to work', 'sources: [backfill]', 'aliases: []', '---',
        '- [stated] User researcher at Northwind Labs',
        '- [stated] מעדיפה סיכומים קצרים עם נקודות',
        '- [stated] Runs a weekly round of [[customer-interviews]]')),
      file('/topics/customer-interviews.md', '2026-09-11T12:41', demoLines(
        '---', 'name: customer-interviews', 'description: The weekly customer interview programme', 'sources: [chat]', 'aliases: [interviews]', '---',
        '- [stated] Five interviews a week, notes in Markdown',
        '- [stated] Shares the themes with the [[product-team]] every Friday')),
    ], demoLines(
      '**Work context**', '',
      'Noor is a user researcher at Northwind Labs. She runs customer interviews and turns them into themes for the product team.', '',
      '**Personal context**', '',
      'Noor often writes in Hebrew. היא מעדיפה לקבל סיכומים לצוות בעברית.', '',
      '**Top of mind**', '',
      'The quarterly team meeting and the week 36 interview round.',
    )),
    memory('priya', [
      file('/profile.md', '2026-09-14T09:00', demoLines(
        '---', 'name: profile', 'description: Who Priya is', 'sources: [backfill]', 'aliases: []', '---',
        '- [stated] Data analyst at Northwind Labs',
        '- [stated] Prefers SQL answers that use CTEs',
        '- [stated] Works on [[churn-analytics]]')),
      file('/areas/churn-analytics.md', '2026-09-29T10:45', demoLines(
        '---', 'name: churn-analytics', 'description: Churn reporting: weekly numbers, definitions and the dashboard', 'sources: [cowork]', 'aliases: ["churn dashboard", retention]', '---',
        '- [stated] A team counts as churned after 30 days without activity',
        '- [stated] Weekly numbers come from the events_daily table',
        '- [stated] Definitions live in the [[analytics-playbook]] project')),
    ], demoLines(
      '**Work context**', '',
      'Priya is a data analyst at Northwind Labs. She owns the churn dashboard and the shared analytics playbook.', '',
      '**Top of mind**', '',
      'Weekly churn numbers and a cohort view for the October review.',
    )),
  ];
}

/* ---------- Design chats ---------- */

const DEMO_TOKENS_CSS = ':root{--accent:#1f9d6b;--ink:#1f1e1c;--paper:#fbfaf7;--muted:#6b665d;--radius:14px;--font:system-ui,-apple-system,"Segoe UI",sans-serif}\n';

// A design board as Claude Design stores it: a full page that loads ./support.js.
function demoBoard(title, css, body) {
  return demoLines(
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><title>' + title + '</title>',
    '<link rel="stylesheet" href="tokens.css">',
    '<style>',
    'body{margin:0;background:var(--paper);font-family:var(--font);color:var(--ink)}',
    '.phone{width:390px;height:844px;margin:0 auto;display:flex;flex-direction:column;justify-content:space-between;padding:72px 28px 40px;box-sizing:border-box}',
    '.btn{display:block;text-align:center;background:var(--accent);color:#fff;text-decoration:none;padding:16px;border-radius:var(--radius);font-weight:600;font-size:17px}',
    css,
    '</style>',
    '<script src="./support.js"><\/script>',
    '</head><body>',
    body,
    '</body></html>',
    '',
  );
}

const DEMO_WELCOME = demoBoard('Welcome',
  '.logo{width:56px;height:56px;border-radius:16px;background:var(--accent)}\nh1{font-size:28px;margin:28px 0 10px;white-space:nowrap}\np{color:var(--muted);font-size:17px;line-height:1.5}\n.dots{display:flex;gap:8px;justify-content:center;margin-bottom:20px}.dots i{width:8px;height:8px;border-radius:50%;background:#d6d2c8}.dots i.on{background:var(--accent)}',
  demoLines(
    '<div class="phone">',
    '  <div><div class="logo"></div><h1>Welcome to Northwind</h1>',
    '  <p>Plan projects with your team, see what everyone is working on, and get a calm summary every Monday.</p></div>',
    '  <div><div class="dots"><i class="on"></i><i></i><i></i></div><a class="btn" href="Team.dc.html">Set up my team</a></div>',
    '</div>',
  ));

const DEMO_TEAM = demoBoard('Pick your team',
  'h1{font-size:26px;margin:0 0 18px}\n.opt{display:flex;align-items:center;gap:14px;padding:16px;border:1.5px solid #e4e0d6;border-radius:var(--radius);margin-bottom:12px;background:#fff}\n.opt.on{border-color:var(--accent);background:#e2f4f1}\n.opt b{display:block}.opt span{color:var(--muted);font-size:14px}\n.back{display:block;text-align:center;margin-top:14px;color:var(--muted)}',
  demoLines(
    '<div class="phone">',
    '  <div><h1>Pick your team</h1>',
    '  <div class="opt on"><div><b>Product</b><span>Roadmaps, specs, launches</span></div></div>',
    '  <div class="opt"><div><b>Marketing</b><span>Campaigns and content</span></div></div>',
    '  <div class="opt"><div><b>Engineering</b><span>Sprints, bugs, releases</span></div></div>',
    '  <div class="opt"><div><b>Something else</b><span>Start from a blank space</span></div></div></div>',
    '  <div><a class="btn" href="#">Continue</a><a class="back" href="Welcome.dc.html">Back</a></div>',
    '</div>',
  ));

/* One design chat. Rows are messages in order. `dupOf` makes a second copy of an earlier
 * user row (same content.id), as the export stores some messages twice. */
function demoDesignChat(spec) {
  const rnd = demoRng(demoHash('design:' + spec.key));
  let clock = demoMs(spec.start) + Math.floor(rnd() * 40000);
  let toolNo = 0;
  const messages = [];
  (spec.rows || []).forEach((r, i) => {
    if (i) clock += (r.wait != null ? r.wait : 45) * 1000 + Math.floor(rnd() * 6000);
    const user = r.role === 'user';
    const uuid = demoUuid('design-row:' + spec.key + ':' + i, user && r.dupOf == null ? 4 : 5);
    const id = r.dupOf != null ? messages[r.dupOf].content.id : user ? uuid : demoChars('design-id:' + spec.key + ':' + i, 10, DEMO_B36);
    const c = Object.assign({ role: r.role, id }, r.c || {});
    if (Array.isArray(c.contentBlocks)) {
      c.contentBlocks = c.contentBlocks.map(b => {
        if (b.type !== 'tool_call' || b.toolCall.id) return b;
        return { type: 'tool_call', toolCall: Object.assign({ id: 'toolu_01' + demoChars(spec.key + ':tool:' + toolNo++, 22, DEMO_B62) }, b.toolCall) };
      });
    }
    // The flat `content` string is the text blocks glued together, as in the export.
    c.content = r.text != null ? r.text : (c.contentBlocks || []).filter(b => b.type === 'text').map(b => b.text).join('');
    c.timestamp = demoIso(clock - (user ? 0 : 5000), 'z3');
    messages.push({ uuid, role: r.role, content: c, created_at: demoIso(clock, 'p6') });
  });
  const start = demoMs(spec.start);
  return {
    uuid: demoUuid('design:' + spec.key), title: 'Chat', project: { uuid: demoUuid('design-project:' + spec.project), name: spec.projectName },
    created_at: demoIso(start, 'p6'), updated_at: demoIso(Math.max(clock, start) + 95000, 'p6'), messages,
  };
}

function demoDesignChats() {
  const mateus = { authorAccountUuid: demoUser('mateus'), authorName: 'Mateus' };
  const lucia = { authorAccountUuid: demoUser('lucia'), authorName: 'Lucía' };
  const amara = { authorAccountUuid: demoUser('amara'), authorName: 'Amara' };
  const text = t => ({ type: 'text', text: t });
  const tool = (name, input, output) => ({ type: 'tool_call', toolCall: output === undefined ? { type: 'edit', name, input } : { type: 'edit', name, input, output } });
  const changes = (created, edited) => ({ created: created || [], edited: edited || [], deleted: [], moved: [], copied: [] });
  const wrote = (path, content) => 'Wrote ' + content.length.toLocaleString('en-US') + ' characters to ' + path;

  // The first Welcome board, before the comment asked for a smaller heading and a clearer button.
  const welcomeFirst = DEMO_WELCOME
    .replace('h1{font-size:28px;margin:28px 0 10px;white-space:nowrap}', 'h1{font-size:34px;margin:28px 0 10px}')
    .replace('>Set up my team<', '>Get started<');
  const questionId = 'q_' + demoChars('design-question', 11, DEMO_B36);
  const questions = {
    title: 'A few questions before I start',
    prompt: 'Answer what you like; I will choose the rest.',
    questions: [
      { id: 'tone', kind: 'text-options', title: 'What tone should the copy have?', options: ['Playful', 'Calm and clear', 'Bold'] },
      { id: 'extras', kind: 'chips', title: 'Any extra screens?', options: ['Notifications', 'Profile photo', 'Dark mode'], multi: true },
      { id: 'notes', kind: 'freeform', title: 'Anything else I should know?', placeholder: 'Optional' },
    ],
  };
  const landing = demoLines(
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><title>Autumn campaign</title>',
    '<link rel="stylesheet" href="tokens.css">',
    '<style>body{margin:0;font-family:var(--font);color:var(--ink);background:var(--paper)}.hero{padding:80px 24px;text-align:center;background:#e2f4f1}.hero h1{font-size:44px;margin:0 0 12px}.benefits{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:960px;margin:40px auto;padding:0 24px}.benefits div{background:#fff;border-radius:var(--radius);padding:20px}form{text-align:center;margin:40px 0 80px}input{padding:12px;border:1px solid #d6d2c8;border-radius:10px;width:260px}button{padding:12px 20px;border:0;border-radius:10px;background:var(--accent);color:#fff}</style>',
    '<script src="./support.js"><\/script>',
    '</head><body>',
    '<section class="hero"><h1>A calm start to the season</h1><p>Plan the next quarter with your whole team in one place.</p></section>',
    '<section class="benefits"><div><b>One plan</b><p>Every project and owner on one page.</p></div><div><b>Weekly summary</b><p>A short email every Monday.</p></div><div><b>Easy start</b><p>A checklist for your first week.</p></div></section>',
    '<form><input type="email" placeholder="Work email"> <button>Get the guide</button></form>',
    '</body></html>',
    '',
  );
  const quote = '<blockquote>“We stopped losing tasks between meetings.” — Operations lead, logistics start-up</blockquote>';
  const welcomeDark = DEMO_WELCOME
    .replace('<link rel="stylesheet" href="tokens.css">', '<link rel="stylesheet" href="tokens.css">\n<style>:root{--paper:#161a18;--ink:#eef3f0;--muted:#9fb0a8;--accent:#4cc794}</style>')
    .replace('<title>Welcome</title>', '<title>Welcome (dark)</title>');

  return [
    demoDesignChat({
      key: 'onboarding-screens', project: 'mobile-app', projectName: 'Northwind Mobile App', start: '2026-08-18T10:02',
      rows: [
        {
          role: 'user', text: 'Design the onboarding screens for our mobile app: a welcome screen, "pick your team" and "invite teammates". Keep it friendly and use our green accent.',
          c: Object.assign({}, mateus, {
            kind: 'chat',
            attachments: [
              { id: demoUuid('att:skill-screens'), name: 'Polished app screens', type: 'skill', content: 'Use this skill to make polished, high-fidelity screens. Work in boards of the real device size, use the project tokens for colour and type, and check contrast before you hand over.' },
              { id: demoUuid('att:moodboard'), name: 'brand-moodboard.png', path: 'uploads/brand-moodboard.png', type: 'image', aspectRatio: 1.5 },
              { id: demoUuid('att:fig'), name: 'Onboarding.fig', type: 'fig-file', selectedFrames: ['/Onboarding/Welcome', '/Onboarding/Team picker'], figOutline: 'Page: Onboarding\n  Frame: Welcome (390×844)\n  Frame: Team picker (390×844)\n  Frame: Invite (390×844)\nPage: Components\n  Button / primary\n  Option card' },
            ],
          }),
        },
        // The same message saved a second time by the app, without the author's account id.
        { role: 'user', dupOf: 0, wait: 0.4, text: 'Design the onboarding screens for our mobile app: a welcome screen, "pick your team" and "invite teammates". Keep it friendly and use our green accent.', c: { authorName: 'Mateus', kind: 'chat', attachments: [{ id: demoUuid('att:moodboard'), name: 'brand-moodboard.png', path: 'uploads/brand-moodboard.png', type: 'image', aspectRatio: 1.5 }] } },
        {
          role: 'assistant', wait: 6, text: '',
          c: { kind: 'question-record', questionRecord: { v: 1, event: 'asked', questionId, round: 1, askedAt: demoIso(demoMs('2026-08-18T10:03:40'), 'z3'), askTurnId: demoUuid('design-ask-turn'), spec: questions } },
        },
        {
          role: 'assistant', wait: 2,
          c: {
            contentBlocks: [
              { type: 'thinking', text: '' },
              text('Before I start, a few quick questions so the screens fit what you have in mind.'),
              tool('ask_user', questions, 'The question form is now up. Waiting for the answers.'),
            ],
            turnInputTokens: 41250,
          },
        },
        {
          role: 'user', wait: 70, text: 'Answered — tone: Calm and clear; extra screens: Notifications; notes: skipped',
          c: { kind: 'question-receipt', questionReceipt: { path: '', questionId, payload: { tone: { choice: 'Calm and clear' }, extras: { selected: ['Notifications'] }, notes: { text: '' } } } },
        },
        {
          role: 'assistant', wait: 240,
          c: {
            contentBlocks: [
              text('Calm and clear it is. I\'ll set up the design tokens first, then the screens.'),
              tool('list_files', { path: '' }, '📁 uploads\n📄 uploads/brand-moodboard.png'),
              tool('write_file', { path: 'tokens.css', content: DEMO_TOKENS_CSS }, wrote('tokens.css', DEMO_TOKENS_CSS)),
              tool('write_file', { path: 'Welcome.dc.html', content: welcomeFirst }, wrote('Welcome.dc.html', welcomeFirst)),
              tool('write_file', { path: 'Team.dc.html', content: DEMO_TEAM }, wrote('Team.dc.html', DEMO_TEAM)),
              { type: 'user_interjection', message: { id: demoUuid('design-interjection'), role: 'user', content: 'Can the invite screen also offer a link instead of email?', attachments: [], timestamp: demoIso(demoMs('2026-08-18T10:07:12'), 'z3'), kind: 'chat' } },
              tool('read_file', { path: 'Welcome.dc.html' }, welcomeFirst.slice(0, 200)),
              tool('show_html', { path: 'Welcome.dc.html' }, '[elided]'),
              text('Here are the first two screens: **Welcome** and **Pick your team**. And yes: the invite screen will have a *Copy invite link* button next to the email field.'),
            ],
            turnChanges: changes(['tokens.css', 'Welcome.dc.html', 'Team.dc.html']),
            turnInputTokens: 86320,
          },
        },
        {
          role: 'user', wait: 20, text: 'Verifier agent check completed',
          c: Object.assign({}, mateus, {
            pill: true, kind: 'chat',
            attachments: [{ id: demoUuid('att:verifier'), name: 'fork_verifier_agent result', type: 'text', hidden: true, content: '<verifier-result verdict="done">\nBoth screens render without console errors.\nText contrast passes WCAG AA.\nThe "Get started" button links to Team.dc.html.\n</verifier-result>' }],
          }),
        },
        {
          role: 'user', wait: 300, text: 'Apply comment',
          c: Object.assign({}, mateus, {
            pill: false, kind: 'chat',
            attachments: [{
              id: 'ann-' + demoUuid('att:comment'), type: 'comment', name: '.phone h1', filePath: 'Welcome.dc.html', selector: '.phone h1',
              descriptor: '<mentioned-element>\ndom:      body › div.phone › div › h1\ntext:     "Welcome to Northwind"\n</mentioned-element>',
              content: 'File: Welcome.dc.html\nElement: <mentioned-element>\ndom:      body › div.phone › div › h1\ntext:     "Welcome to Northwind"\n</mentioned-element>\n\n**Mateus**: Make the heading one size smaller and keep it on one line. The button should also say what happens next.',
            }],
          }),
        },
        {
          role: 'assistant', wait: 30,
          c: {
            contentBlocks: [
              tool('str_replace_edit', {
                path: 'Welcome.dc.html',
                edits: [
                  { old_string: 'h1{font-size:34px;margin:28px 0 10px}', new_string: 'h1{font-size:28px;margin:28px 0 10px;white-space:nowrap}' },
                  { old_string: '>Get started<', new_string: '>Set up my team<' },
                ],
              }, 'Edited Welcome.dc.html (2 replacements)'),
              text('Done. The heading is one size smaller and stays on one line, and the button now says **Set up my team**.'),
            ],
            turnChanges: changes([], ['Welcome.dc.html']),
            turnInputTokens: 90412,
          },
        },
      ],
    }),
    demoDesignChat({
      key: 'autumn-landing', project: 'marketing-site', projectName: 'Northwind Marketing Site', start: '2026-09-02T10:14',
      rows: [
        {
          role: 'user',
          text: '<system-info comment="Only acknowledge these if relevant">\nProject: Northwind Marketing Site\nLocal time: Wednesday, 2 September 2026, 11:14\n</system-info>\n\nCreate a landing page for the autumn campaign: a hero, three benefits and a sign-up form.',
          c: Object.assign({}, lucia, { kind: 'chat', attachments: [{ id: demoUuid('att:skill-landing'), name: 'Campaign page', type: 'skill', content: 'Use this skill for marketing landing pages: one clear message, a short list of benefits, and one call to action.' }] }),
        },
        {
          role: 'assistant', wait: 90,
          c: {
            contentBlocks: [
              text('I\'ll start with a single page.'),
              tool('write_file', { path: 'Landing.dc.html', content: landing }, wrote('Landing.dc.html', landing)),
              tool('show_html', { path: 'Landing.dc.html' }, '[elided]'),
              text('The first version is ready: a hero, three benefit cards and an email sign-up.'),
            ],
            turnChanges: changes(['Landing.dc.html']),
            turnInputTokens: 52310,
          },
        },
        { role: 'user', wait: 1500, text: 'Nice! Can we add a short customer quote under the benefits?', c: Object.assign({}, amara, { kind: 'chat' }) },
        {
          // A turn that broke off: the edit has no result and the turn ends with an error.
          role: 'assistant', wait: 20,
          c: {
            contentBlocks: [
              text('Adding a quote section now.'),
              tool('str_replace_edit', { path: 'Landing.dc.html', old_string: '</section>\n<form>', new_string: '</section>\n' + quote + '\n<form>' }),
              { type: 'error', message: 'Network error: the reply stopped before it was finished' },
            ],
          },
        },
        { role: 'user', wait: 600, text: 'That stopped halfway. Can you try again? Keep the quote short.', c: Object.assign({}, lucia, { kind: 'chat' }) },
        {
          role: 'assistant', wait: 40,
          c: {
            contentBlocks: [
              text('Sorry about that.'),
              tool('str_replace_edit', { path: 'Landing.dc.html', old_string: '</section>\n<form>', new_string: '</section>\n' + quote + '\n<form>' }, 'Edited Landing.dc.html'),
              text('Added the quote under the benefits: *“We stopped losing tasks between meetings.”*'),
            ],
            turnChanges: changes([], ['Landing.dc.html']),
            turnInputTokens: 57880,
          },
        },
      ],
    }),
    // An empty chat: no messages, so no author either.
    demoDesignChat({ key: 'illustrations', project: 'brand-illustrations', projectName: 'Brand Illustrations', start: '2026-09-05T15:20', rows: [] }),
    demoDesignChat({
      key: 'dark-mode', project: 'mobile-app', projectName: 'Northwind Mobile App', start: '2026-08-25T13:30',
      rows: [
        { role: 'user', text: 'Continuing from "Onboarding screens".', c: { authorName: 'Mateus', pill: true } },
        {
          role: 'assistant', wait: 3, c: { kind: 'chat-summary' },
          text: demoLines(
            'We designed onboarding screens for the Northwind mobile app (welcome, pick your team, invite teammates).',
            '',
            '**Decisions made:**',
            '- Calm, clear copy',
            '- Green accent `#1f9d6b`, 14 px corner radius',
            '- The invite screen offers a link as well as email',
            '',
            '**Open:** a dark mode version.',
          ),
        },
        { role: 'user', wait: 60, text: 'Now make a dark mode version of the welcome screen.', c: Object.assign({}, mateus, { kind: 'chat' }) },
        {
          role: 'assistant', wait: 75,
          c: {
            contentBlocks: [
              text('Here is the dark version. I kept the same layout and only changed the colours.'),
              tool('write_file', { path: 'Welcome-dark.dc.html', content: welcomeDark }, wrote('Welcome-dark.dc.html', welcomeDark)),
              text('It sits next to the light board on the canvas.'),
            ],
            turnChanges: changes(['Welcome-dark.dc.html']),
            turnInputTokens: 38190,
          },
        },
      ],
    }),
  ];
}
