/* Sample data, part 4: the artifacts (frames zip) with their versions, files and
 * comments. Made up, like everything in demo.js. */
'use strict';

/* ---------- Artifacts (frames) ---------- */

const DEMO_PAGE_CSS = demoLines(
  ':root{--bg:#fbfaf7;--fg:#1f1e1c;--muted:#6b665d;--line:#e4e0d6;--card:#fff;--accent:#1f9d6b;--soft:#e2f4f1}',
  '@media (prefers-color-scheme:dark){:root{--bg:#1b1a18;--fg:#eceae4;--muted:#a49e92;--line:#36332e;--card:#24221f;--accent:#4cc794;--soft:#1f3a31}}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}',
  'main{max-width:880px;margin:0 auto;padding:40px 24px 64px}',
  'h1{font-size:32px;line-height:1.2;margin:0 0 6px}',
  'h2{font-size:20px;margin:36px 0 12px}',
  '.sub{color:var(--muted);margin:0 0 28px}',
  'a{color:var(--accent)}',
  'table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line)}',
  'th,td{text-align:start;padding:9px 14px;border-bottom:1px solid var(--line)}',
  'th{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}',
  '.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}',
  '.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}',
  '.big{display:block;font-size:30px;font-weight:700;color:var(--accent)}',
  '.tag{display:inline-block;padding:1px 10px;border-radius:999px;font-size:13px;background:var(--soft);color:var(--accent)}',
  '.tag.bad{background:#fbe7e5;color:#b3261e}',
  '.foot{margin-top:40px;color:var(--muted);font-size:14px}',
);

// A small, self-contained HTML page: inline styles only, no external links.
function demoHtml(title, body, opts) {
  const o = opts || {};
  return demoLines(
    '<!doctype html>',
    '<html lang="' + (o.lang || 'en') + '"' + (o.dir ? ' dir="' + o.dir + '"' : '') + '>',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + title + '</title>',
    '<style>', DEMO_PAGE_CSS + (o.css ? '\n' + o.css : ''), '</style>',
    '</head>',
    '<body><main>',
    body,
    '</main>' + (o.script ? '\n<script>\n' + o.script + '\n<\/script>' : ''),
    '</body></html>',
    '',
  );
}

const demoRows = rows => rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('\n');

// The Q3 report in three versions: 1 = first draft, 2 = renamed with a share column, 3 = with notes.
function demoReportHtml(v) {
  const title = v === 1 ? 'Q3 Onboarding Report' : 'Q3 Onboarding Review';
  const funnel = [['Signed up', '1,240', '100%', 'All new teams'], ['Invited teammates', '860', '69%', 'Most invite in week one'],
    ['Created first project', '702', '57%', 'Templates help here'], ['Active in week 4', '612', '49%', 'Goal for Q4: 55%']];
  const cols = v === 1 ? 2 : v === 2 ? 3 : 4;
  const head = ['Step', 'Teams', 'Share', 'Notes'].slice(0, cols).map(h => '<th>' + h + '</th>').join('');
  return demoHtml(title, demoLines(
    '<h1>' + title + '</h1>',
    '<p class="sub">Northwind Labs · Customer onboarding · July to September 2026</p>',
    '<nav class="toc"><b>Contents</b><ol><li><a href="#summary">Summary</a></li><li><a href="#funnel">Onboarding funnel</a></li><li><a href="#segments">By segment</a></li><li><a href="#next">Next steps</a></li></ol></nav>',
    '<h2 id="summary">Summary</h2>',
    '<div class="cards"><div class="card"><span class="big">1,240</span>new teams signed up</div><div class="card"><span class="big">69%</span>invited a teammate</div><div class="card"><span class="big">49%</span>still active in week 4</div></div>',
    '<p>More teams signed up than in Q2, and most of them invited someone in their first week. The drop comes later: half of the teams are no longer active by week 4.</p>',
    '<h2 id="funnel">Onboarding funnel</h2>',
    '<table>',
    '<tr>' + head + '</tr>',
    demoRows(funnel.map(r => r.slice(0, cols))),
    '</table>',
    '<h2 id="segments">By segment</h2>',
    '<table>',
    '<tr><th>Segment</th><th>Teams</th><th>Active in week 4</th></tr>',
    demoRows([['Start-ups', '520', '<span class="bar" style="--w:54%"></span>54%'], ['Mid-size', '480', '<span class="bar" style="--w:47%"></span>47%'], ['Enterprise', '240', '<span class="bar" style="--w:42%"></span>42%']]),
    '</table>',
    '<h2 id="next">Next steps</h2>',
    '<ol><li>Roll out the onboarding checklist to every team in October.</li><li>Add usage alerts for teams that go quiet after week 2.</li><li>Run five interviews with enterprise teams about their set-up.</li></ol>',
    '<p class="foot">Made with Claude for the onboarding team. Numbers from the product database, 7 September 2026.</p>',
  ), { css: '.toc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 18px}.toc ol{margin:6px 0 0}\n.bar{display:inline-block;height:10px;width:calc(var(--w) * 2);max-width:140px;background:var(--accent);border-radius:5px;margin-inline-end:8px;vertical-align:middle}' });
}

const DEMO_SVG_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#1f9d6b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

// Typed artifacts (Slides, Design) carry the app that shows them on claude.ai. The reader
// does not run it; these stand-ins only show what the folder looks like.
function demoTypeFiles(type, title) {
  return {
    'SKILL.md': demoLines('---', 'name: ' + type, 'description: How Claude fills in and edits a ' + (type === 'slides' ? 'deck' : 'design') + ' made from this type.', '---', '',
      '# ' + (type === 'slides' ? 'Slides' : 'Design'), '',
      type === 'slides' ? 'Each slide is one HTML file in project/slides/. The order is in project/deck.json.' : 'Each board is one .dc.html file in project/. The layout is in project/canvas.json.', ''),
    'artifact-type/app.css': '#root{font-family:system-ui,sans-serif;padding:40px;color:#6b665d}\n',
    'artifact-type/app.js': '/* The app for this artifact type. It runs only on claude.ai. */\n(function () {\n  document.getElementById(\'root\').textContent = \'Open this artifact on claude.ai to use the app.\';\n})();\n',
    'artifact-type/thumbnail/thumbnail.json': JSON.stringify({ v: 1, source: 'db', db: { meta: type === 'slides' ? 'deck/meta' : 'design/meta', collections: type === 'slides' ? ['slides', 'notes', 'assets'] : ['boards', 'notes', 'assets'], cover: { collection: type === 'slides' ? 'slides' : 'boards', orderField: type === 'slides' ? 'order' : 'boardOrder' } }, files: { index: type === 'slides' ? 'project/deck.json' : 'project/canvas.json', order: 'order', cover: 'cover' } }),
    'index.html': '<!doctype html>\n<html><head><meta charset="utf-8"><title>' + title + '</title><link rel="stylesheet" href="artifact-type/app.css"></head>\n<body><div id="root"></div><script src="artifact-type/app.js"><\/script></body></html>\n',
  };
}

function demoSlide(id, bg, fg, inner, notes) {
  return '<section id="' + id + '" style="width:1920px;height:1080px;box-sizing:border-box;padding:120px 160px;background:' + bg + ';color:' + fg + ';font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif;display:flex;flex-direction:column;gap:56px">\n' +
    inner + '\n<aside>' + notes + '</aside>\n</section>\n';
}

function demoStat(value, label) {
  return '<div style="flex:1;background:#fff;border-radius:28px;padding:56px;box-shadow:0 6px 24px rgba(0,0,0,.08)"><div style="font-size:130px;font-weight:800;line-height:1;color:#1f9d6b">' + value + '</div><div style="font-size:42px;color:#6b665d;margin-top:20px">' + label + '</div></div>';
}

function demoArtifactSpecs() {
  const officeGuide = {
    'index.html': demoLines(
      '<!doctype html>',
      '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lisbon Office Guide</title>',
      '<style>',
      DEMO_PAGE_CSS,
      '.plan{width:100%;height:auto;border-radius:12px}',
      '.tips{list-style:none;padding:0;display:grid;gap:10px}',
      '.tips li{display:flex;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}',
      '</style></head>',
      '<body><main>',
      '<h1>Welcome to the Lisbon office</h1>',
      '<p class="sub">Everything you need in your first week at Northwind Labs.</p>',
      '<h2>Floor plan</h2>',
      '<img class="plan" src="img/floor-plan.svg" alt="Floor plan of the office">',
      '<h2>Good to know</h2>',
      '<ul class="tips" id="tips"></ul>',
      '<h2>Who to ask</h2>',
      '<p>Reception is open from 08:30 to 18:00. For anything else, ask in the <b>#lisbon-office</b> channel.</p>',
      '</main>',
      '<script>',
      '// The icon file name is built from each tip\'s key.',
      'const tips = [',
      '  [\'wifi\', \'Wi-Fi: <b>Northwind-Guest</b>. The password is on the card at reception.\'],',
      '  [\'coffee\', \'Coffee and tea are free in the kitchen. Please rinse your cup.\'],',
      '  [\'bike\', \'Bike storage is in the basement, next to the showers.\'],',
      '  [\'plant\', \'The plants are watered on Fridays. You may adopt one!\'],',
      '];',
      'const list = document.getElementById(\'tips\');',
      'for (const [icon, text] of tips) {',
      '  const li = document.createElement(\'li\');',
      '  const img = document.createElement(\'img\');',
      '  img.src = \'icons/\' + icon + \'.svg\';',
      '  img.alt = \'\';',
      '  const span = document.createElement(\'span\');',
      '  span.innerHTML = text;',
      '  li.append(img, span);',
      '  list.append(li);',
      '}',
      '<\/script>',
      '</body></html>',
      '',
    ),
    'img/floor-plan.svg': demoLines(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" font-family="system-ui, sans-serif" font-size="15" fill="#1f1e1c">',
      '<rect x="1" y="1" width="598" height="298" rx="12" fill="#fbfaf7" stroke="#b9b4a8" stroke-width="2"/>',
      '<rect x="20" y="20" width="200" height="120" rx="8" fill="#e2f4f1" stroke="#2c8c7c"/><text x="120" y="85" text-anchor="middle">Team area</text>',
      '<rect x="240" y="20" width="160" height="120" rx="8" fill="#eeeafc" stroke="#7b68d9"/><text x="320" y="85" text-anchor="middle">Meeting room</text>',
      '<rect x="420" y="20" width="160" height="120" rx="8" fill="#fdf2da" stroke="#c48a12"/><text x="500" y="85" text-anchor="middle">Kitchen</text>',
      '<rect x="20" y="160" width="380" height="120" rx="8" fill="#e6effc" stroke="#3a73c9"/><text x="210" y="225" text-anchor="middle">Quiet desks</text>',
      '<rect x="420" y="160" width="160" height="120" rx="8" fill="#fde9e3" stroke="#d5694a"/><text x="500" y="225" text-anchor="middle">Reception</text>',
      '</svg>',
      '',
    ),
    'icons/wifi.svg': DEMO_SVG_ICON + '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="#1f9d6b"/></svg>\n',
    'icons/coffee.svg': DEMO_SVG_ICON + '<path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M8 2v3M12 2v3"/></svg>\n',
    'icons/bike.svg': DEMO_SVG_ICON + '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-8h5l3 8M10 8l2 8"/></svg>\n',
    'icons/plant.svg': DEMO_SVG_ICON + '<path d="M12 21v-9"/><path d="M12 12c0-4 3-7 7-7 0 4-3 7-7 7z"/><path d="M12 14c0-3-2.5-5.5-6-5.5 0 3.5 2.5 5.5 6 5.5z"/><path d="M8 21h8"/></svg>\n',
  };

  const deck = {
    v: 4, createdOnFiles: { v: 1, at: '2026-09-15T09:00:00Z' }, lists: 'css', title: 'Sales Kickoff 2026', cover: 'cover',
    order: ['cover', 'agenda', 'wins', 'targets', 'thanks'],
    sections: { s1: { description: 'Looking back', start: 'cover' }, s2: { description: 'Looking ahead', start: 'targets' } },
    faces: {}, designSystems: [],
  };
  const h2 = t => '<h2 style="font-size:84px;font-weight:800;line-height:1.1">' + t + '</h2>';
  const slides = Object.assign(demoTypeFiles('slides', 'Sales Kickoff 2026'), {
    'project/deck.json': JSON.stringify(deck, null, 2),
    'project/slides/cover.html': demoSlide('cover', 'linear-gradient(135deg,#0f3d2e,#1f9d6b)', '#fff',
      '<div style="flex:1"></div>\n<div style="font-size:36px;letter-spacing:6px;text-transform:uppercase;opacity:.8">Northwind Labs</div>\n<h1 style="font-size:150px;line-height:1;font-weight:800">Sales Kickoff 2026</h1>\n<p style="font-size:46px;opacity:.85">Lisbon · 12 October 2026</p>',
      'Welcome everyone. Today: what went well this year, and our three targets for next year.'),
    'project/slides/agenda.html': demoSlide('agenda', '#fbfaf7', '#1f1e1c',
      h2('Agenda') + '\n<ol style="font-size:56px;line-height:1.7;padding-left:70px"><li>This year in numbers</li><li>What our customers told us</li><li>Targets for 2027</li><li>Questions</li></ol>',
      'Keep this short: about one minute.'),
    'project/slides/wins.html': demoSlide('wins', '#f3f1ec', '#1f1e1c',
      h2('This year in numbers') + '\n<div style="display:flex;gap:60px">' + demoStat('104', 'new customers') + demoStat('89%', 'retention') + demoStat('2', 'new regions') + '</div>',
      'Our target was 110 new customers and we reached 104. Retention was the best we have had.'),
    'project/slides/targets.html': demoSlide('targets', '#fbfaf7', '#1f1e1c',
      h2('Targets for 2027') + '\n<div style="display:flex;gap:60px">' + demoStat('120', 'new customers') + demoStat('92%', 'retention') + demoStat('3', 'new regions') + '</div>',
      'Targets agreed with finance on 2 October. This year we reached 104 new customers.'),
    'project/slides/thanks.html': demoSlide('thanks', '#0f3d2e', '#fff',
      '<div style="flex:1"></div>\n<h1 style="font-size:150px;font-weight:800">Thank you</h1>\n<p style="font-size:46px;opacity:.85">Questions? Ask in #sales-kickoff</p>',
      'Open the floor for questions. Share the deck link in the channel afterwards.'),
  });

  const canvas = {
    v: 3, createdOnFiles: { v: 1, at: '2026-08-18T11:40:00Z' }, title: 'Mobile Onboarding Screens',
    launch: { view: 'focused', file: 'Welcome.dc.html' }, pages: [],
    boards: {
      'Welcome.dc.html': { x: 0, y: 0, w: 390, h: 844, title: 'Welcome', is_interactive: true },
      'Team.dc.html': { x: 470, y: 0, w: 390, h: 844, title: 'Pick your team', is_interactive: true },
    },
    order: ['Welcome.dc.html', 'Team.dc.html'],
    notes: { about: { x: 940, y: 0, w: 320, fill: 'blue', text: 'Calm, clear copy. Accent green #1f9d6b.\n\nThe invite screen comes next.' } },
    designSystems: [],
  };
  const design = Object.assign(demoTypeFiles('design', 'Mobile Onboarding Screens'), {
    'artifact-type/dc-runtime.js': '/* Board runtime for claude.ai. Not needed to read the export. */\n',
    'project/canvas.json': JSON.stringify(canvas, null, 2),
    'project/tokens.css': DEMO_TOKENS_CSS,
    'project/Welcome.dc.html': DEMO_WELCOME,
    'project/Team.dc.html': DEMO_TEAM,
  });

  const offsitePage = demoLines(
    '# Team Offsite Plan',
    '',
    '<!-- tab: Plan -->',
    '# Team Offsite Plan',
    '',
    '2026-09-22 · @Lucía Fernández',
    '',
    '## Goals',
    '- Agree on the three marketing bets for next year',
    '- Spend a whole afternoon away from screens',
    '',
    '## Schedule',
    '',
    '| Time | What |',
    '|---|---|',
    '| 09:30 | Coffee and welcome |',
    '| 10:00 | Review of this year\'s campaigns |',
    '| 13:00 | Lunch on the river terrace |',
    '| 14:30 | Walk and talk in pairs |',
    '| 16:00 | Decide the three bets |',
    '',
    '<!-- tab: Budget -->',
    '# Budget',
    '',
    '| Item | Cost (EUR) |',
    '|---|---|',
    '| Venue | 1,200 |',
    '| Lunch for 9 | 540 |',
    '| Travel | 380 |',
    '| **Total** | **2,120** |',
    '',
    '![Venue photo](attachment)',
    '',
  );
  const lucia = { uuid: demoUser('lucia'), full_name: 'Lucía Fernández' };
  const docBlurb = 'Living docs — plans and briefs that you and Claude write and edit together.';

  const hebrew = demoHtml('סיכום ראיונות לקוחות – שבוע 36', demoLines(
    '<h1>סיכום ראיונות לקוחות – שבוע 36</h1>',
    '<p class="sub">חמישה ראיונות · ספטמבר 2026</p>',
    '<h2>הממצאים העיקריים</h2>',
    '<ol>',
    '<li>קשה למצוא איך מזמינים אנשי צוות – שני לקוחות חיפשו את זה בהגדרות.</li>',
    '<li>לא ברור מי אחראי על החשבון בצוות.</li>',
    '<li>לקוחות גדולים מבקשים כניסה מאובטחת (SSO) לפני שהם מרחיבים את השימוש.</li>',
    '<li>יש ביקוש לייצוא נתונים לקובץ CSV.</li>',
    '</ol>',
    '<h2>הצעדים הבאים</h2>',
    '<ul><li>להציג את כפתור ההזמנה כבר במסך הראשון.</li><li>להוסיף שלב "מי מנהל את החשבון?" בתהליך ההרשמה.</li></ul>',
  ), { lang: 'he', dir: 'rtl' });

  const calendarRows = [['Sep 28', 'Blog', 'Why a checklist beats a manual', 'Lucía'], ['Oct 5', 'LinkedIn', 'Checklist launch post', 'Lucía'],
    ['Oct 12', 'Email', 'Autumn newsletter', 'Amara'], ['Oct 19', 'Webinar', 'Your first week with Northwind', 'Amara'],
    ['Oct 26', 'Video', 'Customer story: a logistics start-up', 'Mateus'], ['Nov 2', 'Blog', 'Five habits of calm teams', 'Lucía']];
  const calendar = n => demoHtml('Autumn Campaign Calendar', demoLines(
    '<h1>Autumn Campaign Calendar</h1>',
    '<p class="sub">Marketing · September to November 2026</p>',
    '<table><tr><th>Week</th><th>Channel</th><th>Message</th><th>Owner</th></tr>',
    demoRows(calendarRows.slice(0, n).map(r => [r[0], '<span class="tag">' + r[1] + '</span>', r[2], r[3]])),
    '</table>',
  ));

  const builds = n => demoHtml('Nightly Build Status', demoLines(
    '<h1>Nightly Build Status</h1>',
    '<p class="sub">Updated by the release agent every night at 02:00 UTC.</p>',
    '<table><tr><th>Build</th><th>Branch</th><th>Result</th><th>Time</th></tr>',
    demoRows([['#1482', 'main', '<span class="tag">passed</span>', '12 min'], ['#1481', 'main', '<span class="tag bad">failed: checkout test</span>', '14 min'],
      ['#1480', 'main', '<span class="tag">passed</span>', '11 min'], ['#1479', 'release/2.8', '<span class="tag">passed</span>', '13 min']].slice(4 - n)),
    '</table>',
  ));

  return [
    {
      key: 'report', owner: 'amara', visibility: 'organization', sharedWith: { viewers: 6, editors: 1 }, active: 1, updated: '2026-09-12T08:30',
      versions: [
        { at: '2026-09-12T08:30', title: 'Q3 Onboarding Review (with notes)', description: 'Adds a notes column to the funnel. Rolled back for now.', html: demoReportHtml(3) },
        { at: '2026-09-09T15:01', title: 'Q3 Onboarding Review', description: 'Funnel, week-4 activity by segment and next steps for Q4.', html: demoReportHtml(2) },
        { at: '2026-09-08T09:16', title: 'Q3 Onboarding Report', description: 'First draft from the onboarding numbers.', html: demoReportHtml(1) },
      ],
      threads: [
        {
          created_at: demoIso(demoMs('2026-09-10T09:02'), 'p0'), resolved: true, carried: true,
          comments: [
            { author_index: 1, author_role: '', author_is_artifact_owner: true, text: 'Can we add a short note next to each funnel step?', created_at: demoIso(demoMs('2026-09-10T09:02'), 'p0'), to_claude_at: demoIso(demoMs('2026-09-10T09:02'), 'p0') },
            { author_index: 1, author_role: 'assistant', author_is_artifact_owner: true, text: 'Done: the funnel table now has a Notes column.', created_at: demoIso(demoMs('2026-09-10T09:03'), 'p0') },
          ],
        },
        {
          created_at: demoIso(demoMs('2026-09-11T16:40'), 'p0'), resolved: false, carried: true,
          comments: [{ author_index: 2, author_role: '', author_is_artifact_owner: false, text: 'Nice! Could we split week-4 activity by plan as well?', created_at: demoIso(demoMs('2026-09-11T16:40'), 'p0') }],
        },
      ],
    },
    {
      key: 'office-guide', owner: 'mateus', visibility: 'invited', sharedWith: { viewers: 3, editors: 0 },
      versions: [{ at: '2026-07-21T11:20', title: 'Lisbon Office Guide', description: 'A first-week guide for new people in the Lisbon office.', folder: officeGuide }],
    },
    {
      key: 'kickoff-slides', owner: 'samn', visibility: 'organization',
      versions: [{ at: '2026-09-15T17:45', title: 'Sales Kickoff 2026', description: 'Presentation decks: 16:9 slides you build and edit with Claude.', folder: slides }],
    },
    {
      key: 'onboarding-design', owner: 'mateus', visibility: 'private',
      versions: [{ at: '2026-08-18T11:40', title: 'Mobile Onboarding Screens', description: 'Design canvas for websites, apps and prototypes.', folder: design }],
    },
    {
      key: 'offsite-doc', kind: 'page', owner: 'lucia', visibility: 'organization', updated: '2026-09-23T08:10',
      versions: [
        { at: '2026-09-23T08:20', title: 'Team Offsite Plan', description: docBlurb },
        { at: '2026-09-22T16:40', title: 'Team offsite plan (draft)', description: docBlurb },
      ],
      page: offsitePage,
      comments: [
        {
          resolved: false, tab: 'Plan', quoted_text: 'Walk and talk in pairs',
          comments: [
            { body: '@Claude can you suggest pairs, so people meet someone from another team?', author: lucia, created_at: demoIso(demoMs('2026-09-23T08:14:05'), 'z3') },
            { body: 'Sure. A simple rule: pair people from different teams who have not worked on a project together this year. With nine people, make one group of three.', author: lucia, posted_by_agent: true, created_at: demoIso(demoMs('2026-09-23T08:14:41'), 'z3') },
          ],
        },
        {
          resolved: true, tab: 'Budget', quoted_text: 'Lunch for 9',
          comments: [{ body: 'Price confirmed with the venue.', author: lucia, created_at: demoIso(demoMs('2026-09-24T10:02:17'), 'z3') }],
        },
      ],
      // The same doc question again, as the export also lists it here. The reader hides it.
      threads: [{
        created_at: demoIso(demoMs('2026-09-23T08:14'), 'p0'), resolved: false, carried: true,
        comments: [{ author_index: 1, author_role: 'page', author_is_artifact_owner: true, text: '@Claude can you suggest pairs, so people meet someone from another team?', created_at: demoIso(demoMs('2026-09-23T08:14'), 'p0') }],
      }],
    },
    {
      // Made by an agent: no owner account at all.
      key: 'nightly-builds', owner: null, visibility: 'agent',
      versions: [
        { at: '2026-09-29T02:04', title: 'Nightly Build Status', description: 'Results of the last nightly builds.', html: builds(4) },
        { at: '2026-09-28T02:03', title: 'Nightly Build Status', description: 'Results of the last nightly builds.', html: builds(3) },
      ],
    },
    {
      // A typed app whose content lived in claude.ai's database: only the app files are exported.
      key: 'team-update', owner: 'kenji', visibility: 'private',
      versions: [{ at: '2026-09-02T13:15', title: 'Platform Team Update', description: 'Presentation decks: 16:9 slides you build and edit with Claude.', folder: demoTypeFiles('slides', 'Platform Team Update') }],
    },
    {
      key: 'token-bucket', owner: 'kenji', visibility: 'private',
      versions: [{
        at: '2026-06-17T10:30', title: 'Token Bucket Cheat Sheet', description: 'Rate limits for the public API on one page.',
        html: demoHtml('Token Bucket Cheat Sheet', demoLines(
          '<h1>Token bucket cheat sheet</h1>',
          '<p class="sub">Rate limits for the public API · platform team</p>',
          '<div class="cards"><div class="card"><span class="big">100 / min</span>refill rate</div><div class="card"><span class="big">20</span>largest burst</div><div class="card"><span class="big">429</span>when the bucket is empty</div></div>',
          '<h2>How it works</h2>',
          '<ol><li>Every customer has a bucket of tokens.</li><li>Each request takes one token.</li><li>Tokens come back at a steady rate.</li><li>No token: answer <code>429</code> with a <code>Retry-After</code> header.</li></ol>',
          '<h2>Limits per plan</h2>',
          '<table><tr><th>Plan</th><th>Rate</th><th>Burst</th></tr>',
          demoRows([['Free', '30 / min', '10'], ['Team', '100 / min', '20'], ['Business', '300 / min', '50']]),
          '</table>',
        )),
      }],
    },
    {
      key: 'churn-one-pager', owner: 'priya', visibility: 'organization', sharedWith: { viewers: 4, editors: 0 },
      versions: [{
        at: '2026-09-15T09:10', title: 'Churn Metrics One-Pager', description: 'Weekly churn and how we measure it.',
        html: demoHtml('Churn Metrics One-Pager', demoLines(
          '<h1>Churn metrics</h1>',
          '<p class="sub">Analytics · numbers up to 13 September 2026</p>',
          '<div class="cards"><div class="card"><span class="big">1.2%</span>weekly churn, latest week</div><div class="card"><span class="big">288</span>teams churned in 8 weeks</div><div class="card"><span class="big" id="live">–</span>live number (claude.ai only)</div></div>',
          '<h2>Definitions</h2>',
          '<table><tr><th>Term</th><th>Meaning</th></tr>',
          demoRows([['Active team', 'At least one action in the last 7 days'], ['Churned team', 'No activity for 30 days'], ['Weekly churn', 'Churned this week ÷ active at the start of the week']]),
          '</table>',
        ), { script: '// On claude.ai this reads the latest number from the shared data store.\nif (window.claude && window.claude.use) window.claude.use(\'db\');' }),
      }],
    },
    {
      key: 'campaign-calendar', owner: 'lucia', visibility: 'private',
      versions: [
        { at: '2026-09-25T11:05', title: 'Autumn Campaign Calendar', description: 'Six weeks of posts, emails and events.', html: calendar(6) },
        { at: '2026-09-24T10:00', title: 'Autumn Campaign Calendar', description: 'First four weeks.', html: calendar(4) },
      ],
    },
    {
      key: 'interviews-he', owner: 'noor', visibility: 'invited', sharedWith: { viewers: 2, editors: 1 },
      versions: [{ at: '2026-09-12T09:30', title: 'סיכום ראיונות לקוחות – שבוע 36', description: 'ארבעה ממצאים וצעדים הבאים לצוות המוצר.', html: hebrew }],
    },
    {
      key: 'upgrade-runbook', owner: 'saml', visibility: 'private',
      versions: [{
        at: '2026-07-15T08:50', title: 'Cluster Upgrade Runbook', description: 'Step by step, with owners.',
        html: demoHtml('Cluster Upgrade Runbook', demoLines(
          '<h1>Cluster upgrade runbook</h1>',
          '<p class="sub">Infrastructure · one minor version at a time</p>',
          '<table><tr><th>#</th><th>Step</th><th>Owner</th></tr>',
          demoRows([['1', 'Check for deprecated APIs', 'Sam'], ['2', 'Confirm etcd backups', 'Sam'], ['3', 'Upgrade the staging cluster', 'Kenji'],
            ['4', 'Upgrade the production control plane', 'Sam'], ['5', 'Replace node pools one by one', 'Kenji'], ['6', 'Watch error rates for a day', 'Both']]),
          '</table>',
        )),
      }],
    },
    {
      key: 'triage', owner: 'amara', visibility: 'private',
      versions: [{
        at: '2026-08-22T14:10', title: 'Feature Request Triage', description: 'Top requests from customers this quarter.',
        html: demoHtml('Feature Request Triage', demoLines(
          '<h1>Feature request triage</h1>',
          '<p class="sub">Product · requests from customer calls, Q3 2026</p>',
          '<table><tr><th>Request</th><th>Votes</th><th>Status</th></tr>',
          demoRows([['Onboarding checklist', '41', '<span class="tag">planned for Q4</span>'], ['CSV export for reports', '27', '<span class="tag">planned for Q4</span>'],
            ['SSO for small teams', '19', '<span class="tag">later</span>'], ['Dark mode on the web', '15', '<span class="tag bad">not now</span>']]),
          '</table>',
        )),
      }],
    },
  ];
}

// The zip entries for one artifact, in the order real exports write them.
function demoArtifactEntries(spec) {
  const enc = new TextEncoder();
  const id = demoUuid('art:' + spec.key);
  const base = 'artifacts/' + id + '/';
  const versions = spec.versions.map((v, i) => Object.assign({ id: Math.floor(demoMs(v.at) / 1000) + '-' + demoChars('vid:' + spec.key + ':' + i, 4, DEMO_HEX) }, v));
  const meta = {
    id, kind: spec.kind || 'artifact', visibility: spec.visibility,
    versions: versions.map(v => Object.assign({ id: v.id, title: v.title }, v.description ? { description: v.description } : {}, { created_at: demoIso(demoMs(v.at), 'p0') })),
  };
  if (spec.owner) meta.owner_account = demoUser(spec.owner);
  else meta.created_by_agent = true;
  meta.updated_at = demoIso(demoMs(spec.updated || spec.versions[0].at), 'p0');
  meta.active_version = versions[spec.active || 0].id;
  if (spec.sharedWith) meta.shared_with = spec.sharedWith;

  const entries = [[base + 'artifact.json', JSON.stringify(meta)]];
  for (const v of versions) {
    if (v.html != null) entries.push([base + 'versions/' + v.id + '.html', v.html]);
    if (!v.folder) continue;
    const list = [];
    for (const [path, text] of Object.entries(v.folder)) {
      const bytes = enc.encode(text);
      entries.push([base + 'versions/' + v.id + '/' + path, bytes]);
      list.push({ original_path: path, exported_as: path, sha256: demoSha256(bytes), size_bytes: bytes.length, mime_type: demoMime(path) });
    }
    list.sort((a, b) => (a.original_path < b.original_path ? -1 : a.original_path > b.original_path ? 1 : 0));
    entries.push([base + 'versions/' + v.id + '.files.json', JSON.stringify({ files: list })]);
  }
  if (spec.page != null) entries.push([base + 'page.md', spec.page]);
  if (spec.comments) entries.push([base + 'comments.json', JSON.stringify(spec.comments)]);
  if (spec.threads) entries.push([base + 'artifact_comments.json', JSON.stringify({ threads: spec.threads })]);
  return entries;
}
