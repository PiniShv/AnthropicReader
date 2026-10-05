/* Sample data, part 2: the conversations, and the builders that turn short specs into
 * the shape of conversations.json. Made up, like everything in demo.js. */
'use strict';

/* ---------- Conversations: builders ---------- */

const DEMO_TOOL_PLACEHOLDER = '\n```\nThis block is not supported on your current device yet.\n```\n\n';
const DEMO_ARTIFACT_PLACEHOLDER = '\n```\nViewing artifacts created via the Analysis Tool web feature preview isn\'t yet supported on mobile.\n```\n\n';

function demoText(text, citations) { return { type: 'text', text, citations: citations || [] }; }

function demoThinking(thinking, summaries, hidden) {
  return {
    type: 'thinking', thinking: hidden ? '' : thinking, summaries: summaries.map(s => ({ summary: s })),
    cut_off: false, truncated: false, hidden: false, thinking_hidden: !!hidden, alternative_display_type: null, signature: null,
  };
}

// A tool call and its result. `res` holds tool_result keys, `use` extra tool_use keys.
function demoTool(name, input, res, use) { return { tool: true, name, input, res: res || {}, use: use || {} }; }
const demoOut = text => [{ type: 'text', text }];

// A web citation over `phrase` in `text`. Offsets count code points, like the export does.
function demoCite(text, phrase, url) {
  const at = text.indexOf(phrase);
  if (at < 0) throw new Error('demo citation not found: ' + phrase);
  const start = Array.from(text.slice(0, at)).length;
  return { uuid: demoUuid('cite:' + url + ':' + at), start_index: start, end_index: start + Array.from(phrase).length, details: { type: 'web_search_citation', url } };
}

// A web page as web_search and web_fetch return it.
function demoWebPage(title, url, site, text, extra) {
  const host = /^https?:\/\/([^/]+)/.exec(url)[1];
  return {
    type: 'knowledge', title, url, text,
    metadata: { type: 'webpage_metadata', site_domain: host, site_name: site, favicon_url: null },
    is_missing: false, is_citable: true, prompt_context_metadata: Object.assign({ url }, extra || {}),
  };
}

function demoAttachment(name, type, text) {
  return { file_name: name, file_size: text.length, file_type: type, extracted_content: text };
}

/* One conversation. Turns are human ('h') or assistant ('a') messages in array order.
 * Each message's parent is the one before it, unless the turn names another (`parent`),
 * or 'root' for an edited first prompt. `wait` is the gap before the turn in seconds. */
function demoChat(spec) {
  const rnd = demoRng(demoHash('chat:' + spec.key));
  const jitter = max => Math.floor(rnd() * max);
  let clock = demoMs(spec.start) + jitter(50000);
  const byKey = new Map();
  let prev = DEMO_ROOT;
  let toolNo = 0;
  let firstMs = 0, lastMs = 0;
  const stamp = (b, secs) => {
    b.start_timestamp = demoIso(clock, 'z6');
    if (secs) clock += Math.round(secs * 1000) + jitter(400);
    b.stop_timestamp = demoIso(clock, 'z6');
    b.flags = null;
    return b;
  };
  const msgs = (spec.turns || []).map((t, i) => {
    const key = t.k || String(i);
    const uuid = demoUuid('msg:' + spec.key + ':' + key);
    if (i) clock += (t.wait != null ? t.wait : t.who === 'h' ? 75 : 2) * 1000 + jitter(9000);
    const parent = t.parent === 'root' ? DEMO_ROOT : t.parent ? byKey.get(t.parent) : prev;
    byKey.set(key, uuid);
    prev = uuid;
    const content = [];
    let text = '';
    let created = clock;
    if (t.who === 'h') {
      if (!t.empty) {
        content.push(stamp(demoText(t.text), 0));
        text = t.text;
        if (t.inject) {
          content.push(stamp({ type: 'injected_prompt_block', prompt: t.inject.prompt, injection_source: t.inject.source, initial_turn_only: false, skip_on_truncated_continuation: false }, 0));
        }
      }
    } else if (!t.empty) {
      clock += 1200 + jitter(800);
      for (const b of (t.blocks || []).flat()) {
        if (b.tool) {
          const id = 'toolu_01' + demoChars(spec.key + ':tool:' + toolNo++, 22, DEMO_B62);
          content.push(stamp(Object.assign({ type: 'tool_use', id, name: b.name, input: b.input, message: null, integration_name: null }, b.use), 1));
          content.push(stamp(Object.assign({ type: 'tool_result', tool_use_id: id, name: b.name, content: [], is_error: false }, b.res), b.res.is_error ? 0.8 : 2.5));
          text += b.name === 'artifacts' ? DEMO_ARTIFACT_PLACEHOLDER : DEMO_TOOL_PLACEHOLDER;
        } else {
          const blk = Object.assign({}, b);
          const len = (blk.text || blk.thinking || '').length;
          content.push(stamp(blk, blk.type === 'thinking' ? 3 + len / 150 : 1 + len / 90));
          text += blk.type === 'thinking' ? blk.thinking : blk.text;
        }
      }
      created = clock + 300;
      clock = created;
    }
    if (!firstMs) firstMs = created;
    lastMs = created;
    const attachments = t.attachments || [];
    // Every attachment also has a same-name entry in files[]; other uploads are references only.
    const fileNames = attachments.map(a => a.file_name).concat(t.files || []);
    return {
      uuid, text, content, sender: t.who === 'h' ? 'human' : 'assistant',
      created_at: demoIso(created, 'z6'), updated_at: demoIso(created, 'z6'),
      attachments,
      files: fileNames.map((n, j) => ({ file_uuid: demoUuid('file:' + spec.key + ':' + key + ':' + j), file_name: n })),
      parent_message_uuid: parent,
    };
  });
  const start = firstMs || demoMs(spec.start);
  return {
    uuid: demoUuid('chat:' + spec.key), name: spec.name || '', summary: spec.summary || '',
    created_at: demoIso(start - 1500, 'z6'), updated_at: demoIso((lastMs || start) + 800, 'z6'),
    account: { uuid: demoUser(spec.owner) }, chat_messages: msgs,
  };
}

/* ---------- Conversations: content ---------- */

function demoConversations() {
  const F = DEMO_FENCE;
  const T = demoText;
  const fileTool = { integration_name: 'File Creation' };
  const bash = (command, description, stdout, code, stderr) => demoTool('bash_tool', { command, description },
    { content: demoOut(JSON.stringify({ returncode: code || 0, stdout, stderr: stderr || '' })) },
    Object.assign({ message: description, icon_name: 'commandLine', display_content: { type: 'json_block', json_block: JSON.stringify({ language: 'bash', code: command }) } }, fileTool));
  const createFile = (path, fileText, description) => demoTool('create_file', { description, path, file_text: fileText },
    { content: demoOut('File created successfully: ' + path), meta: { output_format_category: path.split('.').pop() === 'html' ? 'html' : 'other' } },
    Object.assign({ message: description, icon_name: 'file' }, fileTool));
  const present = files => demoTool('present_files', { filepaths: files.map(f => f[0]) },
    { content: files.map(([p, mime]) => ({ type: 'local_resource', file_path: p, name: p.split('/').pop(), mime_type: mime, uuid: demoUuid('res:' + p) })), message: files.length === 1 ? 'Presented file' : 'Presented ' + files.length + ' files' },
    Object.assign({ message: 'Presenting file(s)...', icon_name: 'file', display_content: { type: 'table', table: files.map(f => ['File', f[0].split('/').pop()]) } }, fileTool));
  const replace = (path, oldStr, newStr, description) => demoTool('str_replace', { description, path, old_str: oldStr, new_str: newStr },
    { content: demoOut('Successfully replaced string in ' + path) },
    Object.assign({ message: description, icon_name: 'edit', display_content: { type: 'text', text: description } }, fileTool));
  const widget = { integration_name: 'Dynamic Widget' };

  const reportPath = '/mnt/user-data/outputs/q3-onboarding-report.html';
  const reportId = demoUuid('art:report');
  const slidesId = demoUuid('art:kickoff-slides');

  const spring = demoLines(
    '🌱 Spring campaigns this year share three ideas.',
    '',
    '**1. A fresh start for team habits.** Many brands frame spring as a reset and offer checklists and templates to tidy up projects.',
    '',
    '**2. Free seats for small teams.** Several tools give small teams extra seats for a few months to grow usage.',
    '',
    '**3. Customers tell the story.** Short customer videos replace product tours in ads.',
    '',
    'For Northwind, the fresh-start idea fits our new onboarding checklist best.',
  );
  const springUrls = [
    'https://marketing-weekly.example/2026/fresh-start-campaigns',
    'https://saas-notes.example/free-seats-for-small-teams',
    'https://brand-stories.example/customer-led-campaigns',
  ];

  const interviewNotes = demoLines(
    '# Customer interviews, week 36',
    '',
    '## 1. Design agency, 12 people',
    '- Set-up took one afternoon',
    '- Did not find the invite button at first ("I looked for it under Settings")',
    '- Loves the weekly summary email',
    '',
    '## 2. Logistics start-up, 40 people',
    '- Uses Northwind for sprint planning',
    '- Wants SSO before they add more teams',
    '- Invited 6 teammates in week one',
    '',
    '## 3. Accounting firm, 25 people',
    '- Only two people use it so far',
    '- Not sure who should own the account',
    '',
    '## 4. Online shop, 8 people',
    '- Uses the mobile app every day',
    '- Wants CSV export for monthly reports',
    '',
    '## 5. Non-profit, 15 people',
    '- Struggled to import old tasks',
    '- Not sure who should be the admin',
  );

  const pythonScript = demoLines(
    '"""Find customers that appear more than once with slightly different emails."""',
    'import sys',
    '',
    'import pandas as pd',
    '',
    '',
    'def normalise(email: str) -> str:',
    '    return "".join(str(email).split()).lower()',
    '',
    '',
    'def main(src: str, dest: str) -> None:',
    '    df = pd.read_csv(src)',
    '    print(f"Read {len(df):,} rows")',
    '    df["email_key"] = df["email"].map(normalise)',
    '    dupes = df[df.duplicated("email_key", keep=False)].sort_values("email_key")',
    '    print(f"Found {dupes[\'email_key\'].nunique():,} duplicate groups ({len(dupes):,} rows)")',
    '    dupes.to_excel(dest, index=False)',
    '    print(f"Wrote {dest}")',
    '',
    '',
    'if __name__ == "__main__":',
    '    main(sys.argv[1], sys.argv[2])',
    '',
  );

  const roadmapSvg = demoLines(
    '<svg width="100%" viewBox="0 0 680 200" role="img" xmlns="http://www.w3.org/2000/svg">',
    '<title>Q4 retention plan</title>',
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round"/></marker></defs>',
    '<g class="c-teal"><rect x="20" y="50" width="180" height="96" rx="12" stroke-width="1"/><text class="th" x="110" y="92" text-anchor="middle">Onboarding checklist</text><text class="ts" x="110" y="116" text-anchor="middle">Web team · Oct–Nov</text></g>',
    '<g class="c-purple"><rect x="250" y="50" width="180" height="96" rx="12" stroke-width="1"/><text class="th" x="340" y="92" text-anchor="middle">First project</text><text class="ts" x="340" y="116" text-anchor="middle">Goal: 60% of new teams</text></g>',
    '<g class="c-amber"><rect x="480" y="50" width="180" height="96" rx="12" stroke-width="1"/><text class="th" x="570" y="92" text-anchor="middle">Usage alerts</text><text class="ts" x="570" y="116" text-anchor="middle">Data team · Nov–Dec</text></g>',
    '<line class="arr" x1="202" y1="98" x2="246" y2="98" marker-end="url(#arrow)"/>',
    '<line class="arr" x1="432" y1="98" x2="476" y2="98" marker-end="url(#arrow)"/>',
    '<text class="ts" x="340" y="184" text-anchor="middle">Q4 focus: keep new teams active after week 4</text>',
    '</svg>',
  );

  const brandGuide = demoLines(
    '# Northwind brand voice',
    '',
    'We sound like a helpful colleague: **clear first, warm second, never pushy.**',
    '',
    '## Three rules',
    '1. **Say it simply.** Short sentences, common words.',
    '2. **Lead with what the reader gets.**',
    '3. **Be human.** It is fine to say "we" and "you".',
    '',
    '## Do and don\'t',
    '',
    '| Do | Don\'t |',
    '|---|---|',
    '| "Invite your team in two clicks." | "Leverage our seamless collaboration suite." |',
    '| "Something went wrong. Please try again." | "An unexpected error has occurred." |',
    '| "Thanks for telling us!" | "Your feedback is valuable to us." |',
    '',
    '## Words we like',
    '*team, project, start, simple, together*',
  );

  const churnRows = [['2026-07-20', 42, 1.9], ['2026-07-27', 39, 1.8], ['2026-08-03', 45, 2.0], ['2026-08-10', 37, 1.7],
    ['2026-08-17', 33, 1.5], ['2026-08-24', 36, 1.6], ['2026-08-31', 29, 1.3], ['2026-09-07', 27, 1.2]];
  const churnData = churnRows.map(([week, churned, pct]) => ({ week, churned_teams: churned, churn_pct: pct }));
  const warehouse = { integration_name: 'Warehouse', mcp_server_url: 'https://mcp.warehouse.example/mcp', is_mcp_app: false, icon_name: 'search' };

  const travelPolicy = demoLines(
    'Travel policy (excerpt)',
    '',
    '3.1 Book through the travel desk when you can.',
    '3.2 Trains: second class by default. First class is allowed for trips longer than 4 hours, or when it costs the same as second class.',
    '3.3 Flights: economy class only.',
  );

  const specs = [
    // ---- Amara Okafor: product lead ----
    {
      key: 'q3-report', owner: 'amara', name: 'Q3 onboarding report', start: '2026-09-08T09:12',
      summary: demoLines(
        '**Conversation Overview**',
        '',
        'Amara shared the Q3 onboarding numbers as a CSV file and asked for a one-page HTML report with a table of contents. Claude built the report, then renamed it to *Q3 Onboarding Review*, added percentages to the funnel table and published it for the team.',
        '',
        '**Key numbers**',
        '',
        '- 1,240 new teams signed up; 49% were still active in week 4',
        '- Start-ups had the best week-4 activity (54%)',
      ),
      turns: [
        {
          who: 'h', text: 'Here are our Q3 onboarding numbers. Can you turn them into a one-page HTML report for the team? Keep it clean, with a short table of contents at the top.',
          attachments: [demoAttachment('q3-onboarding.csv', 'text/csv', demoLines(
            'step,teams,share_of_signups', 'Signed up,1240,100%', 'Invited teammates,860,69%', 'Created first project,702,57%', 'Active in week 4,612,49%',
            '', 'segment,teams,active_week_4', 'Start-ups,520,54%', 'Mid-size,480,47%', 'Enterprise,240,42%'))],
        },
        {
          who: 'a', blocks: [
            demoThinking('Amara wants a one-page HTML report from the CSV. The data has two parts: the funnel and the segments. A table of contents with links to each section fits a one-pager. I will keep the styling simple so it reads well in light and dark mode, and put the three key numbers at the top.',
              ['Read the funnel and segment numbers from the CSV.', 'Planned a one-page layout with a table of contents and key numbers first.']),
            T('I\'ll build a single HTML page with four short sections: summary, funnel, segments and next steps.'),
            createFile(reportPath, demoReportHtml(1), 'Q3 onboarding report as a one-page HTML file'),
            present([[reportPath, 'text/html']]),
            T(demoLines(
              'Here\'s the report. The table of contents at the top links to each section.',
              '',
              'A few things stand out:',
              '',
              '- **69%** of new teams invited a teammate, but only **49%** were still active in week 4.',
              '- Start-ups stay active more often than enterprise teams (54% vs 42%).',
              '',
              'Want me to change anything before you share it?',
            )),
          ],
        },
        { who: 'h', wait: 107000, text: 'Looks great. Please rename it to “Q3 Onboarding Review”, add the percentages to the funnel table and publish it so the team can open it.' },
        {
          who: 'a', blocks: [
            replace(reportPath, '<h1>Q3 Onboarding Report</h1>', '<h1>Q3 Onboarding Review</h1>', 'Rename the report'),
            replace(reportPath, '<tr><th>Step</th><th>Teams</th></tr>', '<tr><th>Step</th><th>Teams</th><th>Share</th></tr>', 'Add a share column to the funnel table'),
            demoTool('Artifact', { action: 'publish', file_path: reportPath, title: 'Q3 Onboarding Review', favicon: 'chart' }, {
              content: demoOut('Published https://claude.ai/code/artifact/' + reportId),
              display_content: { type: 'file', published_url: 'https://claude.ai/code/artifact/' + reportId, published_artifact_id: reportId, published_action: 'published', title: 'Q3 Onboarding Review', pinned: null, owned_by_account: true },
              structured_content: { url: 'https://claude.ai/code/artifact/' + reportId, owned: true, title: 'Q3 Onboarding Review', artifact_id: reportId },
              message: 'Published artifact',
            }, { message: 'Publishing the report' }),
            T('Done. The report is published as **Q3 Onboarding Review**, and everyone at Northwind Labs can open it. I changed the title and added a share column to the funnel table.'),
          ],
        },
      ],
    },
    {
      key: 'launch-email', owner: 'amara', name: 'Activation dashboard launch email', start: '2026-09-15T13:40',
      turns: [
        { who: 'h', text: 'We launch the new activation dashboard on Monday. Draft a short email to all customer success managers. Two versions please: one warm, one very short.' },
        {
          who: 'a', blocks: [
            T('Here are two drafts.'),
            demoTool('message_compose_v1', {
              kind: 'email', summary_title: 'Activation dashboard launch',
              variants: [
                { label: 'Warm', subject: 'Meet the new activation dashboard', body: demoLines('Hi team,', '', 'On Monday we launch the new activation dashboard. For every customer, it shows how far they got in onboarding and where they got stuck.', '', 'Two things get easier:', '- spotting teams that have not invited anyone yet', '- seeing which accounts need a check-in call this week', '', 'There is a 15-minute walkthrough on Monday at 10:00. Bring your questions!', '', 'Thanks,', 'Amara') },
                { label: 'Short', subject: 'New: activation dashboard (Monday)', body: demoLines('Hi all,', '', 'The activation dashboard goes live on Monday. It shows where each customer is in onboarding. Walkthrough on Monday at 10:00.', '', 'Amara') },
              ],
            }, { content: demoOut('The drafts were shown to the user.') }, widget),
            T('Tell me if you want a version for customers too.'),
          ],
        },
      ],
    },
    {
      key: 'roadmap', owner: 'amara', name: 'Q4 roadmap priorities', start: '2026-08-21T10:05',
      turns: [
        { who: 'h', text: 'Help me prioritise the Q4 roadmap. The candidates are: onboarding checklist, SSO for small teams, usage alerts, a new mobile home screen and CSV export for reports.' },
        {
          who: 'a', blocks: [
            T('Happy to help. Two quick questions first, so the ranking fits your goals.'),
            demoTool('ask_user_input_v0', {
              questions: [
                { question: 'What matters most in Q4?', options: ['Retention', 'New revenue', 'Team speed'], type: 'single_select' },
                { question: 'Which teams have time this quarter?', options: ['Web', 'Mobile', 'Data'], type: 'multi_select' },
              ],
            }, { content: demoOut('The questions were shown to the user.'), message: 'Generated ask_user_input_v0 widget' }, widget),
          ],
        },
        { who: 'h', text: 'Retention matters most. Web and Data have time; Mobile is busy until November.' },
        {
          who: 'a', blocks: [
            T(demoLines(
              'Here is a ranking based on retention and the teams you have:',
              '',
              '| Rank | Feature | Why | Team |',
              '|---|---|---|---|',
              '| 1 | Onboarding checklist | Directly lifts week-4 activity | Web |',
              '| 2 | Usage alerts | Warns customer success before a team goes quiet | Data |',
              '| 3 | CSV export for reports | Small, and often asked for | Data |',
              '| 4 | SSO for small teams | More about revenue than retention | Web |',
              '| 5 | Mobile home screen | Mobile is busy until November | Mobile |',
              '',
              'And here is how the top two fit together:',
            )),
            demoTool('visualize:show_widget', { title: 'Q4 retention plan', loading_messages: ['Drawing the plan', 'Placing the arrows'], widget_code: roadmapSvg },
              { content: demoOut('The widget was shown to the user.'), meta: { 'io.modelcontextprotocol/serverInfo': { name: 'visualize', version: '1.0.0' } } },
              { integration_name: 'visualize', is_mcp_app: true }),
            T('The checklist gets new teams to their first project; the alerts catch teams that slip after that.'),
          ],
        },
      ],
    },
    {
      key: 'slide-sentence', owner: 'amara', name: '', start: '2026-07-02T16:20',
      turns: [
        { who: 'h', text: 'Can you make this sentence shorter for a slide? “We are rolling out the new onboarding checklist to every customer team over the next six weeks, starting with the teams that signed up most recently.”' },
        { who: 'a', blocks: [T(demoLines('Three options, from shortest to longest:', '', '1. **Onboarding checklist: all teams in six weeks**', '2. **A new checklist for every team, newest first**', '3. **Rolling out the onboarding checklist to all teams over six weeks, newest teams first**'))] },
      ],
    },

    // ---- Kenji Watanabe: platform engineer ----
    {
      key: 'flaky-test', owner: 'kenji', name: 'Flaky checkout test on CI', start: '2026-08-04T11:30',
      summary: demoLines(
        '**Conversation Overview**',
        '',
        'Kenji asked why the checkout integration test failed about one run in ten on CI. Claude found a fixed 0.5 second sleep after the payment webhook, replaced it with a polling wait, and the test then passed 50 times in a row.',
      ),
      turns: [
        { who: 'h', text: 'Our checkout integration test fails about one run in ten on CI. The repo is in /home/claude/repo. Can you find out why?' },
        {
          who: 'a', blocks: [
            demoThinking('A failure rate of about 10% points to timing, not logic. Payment flows often wait for a webhook, so I should look for fixed sleeps or waits around the webhook in the checkout test. Then run the test many times to see the failure, and check the git history for recent changes to the test.',
              ['Suspected a timing problem rather than a logic bug.', 'Planned to look for fixed waits and to run the test many times.']),
            bash('cd /home/claude/repo && ls tests/integration', 'List the integration tests', 'conftest.py\ntest_cart.py\ntest_checkout.py\ntest_login.py\n'),
            bash('cd /home/claude/repo && grep -n "sleep\\|webhook" tests/integration/test_checkout.py', 'Look for waits in the checkout test',
              '14:from time import sleep\n41:    trigger_payment_webhook(order.id)\n42:    sleep(0.5)\n43:    assert order.refresh().status == "paid"\n'),
            bash('cd /home/claude/repo && python -m pytest tests/integration/test_checkout.py -q --count 20 2>&1 | tail -3', 'Run the test 20 times',
              'FAILED tests/integration/test_checkout.py::test_paid_order[7] - AssertionError: assert \'pending\' == \'paid\'\nFAILED tests/integration/test_checkout.py::test_paid_order[15] - AssertionError: assert \'pending\' == \'paid\'\n2 failed, 18 passed in 41.20s\n', 1,
              'DeprecationWarning: payment_client.sync_charge() will be removed in version 3\n'),
            bash('cd /home/claude/repo && git log --oneline -3 -- tests/integration/test_checkout.py', 'See recent changes to the test',
              'a41c9e2 Speed up checkout tests\n7d02b18 Add paid-order test\n3f9e011 Move checkout tests to integration\n'),
            T(demoLines(
              'Found it. The test triggers the payment webhook and then waits a fixed **0.5 seconds** before it checks the order:',
              '',
              F + 'python',
              'trigger_payment_webhook(order.id)',
              'sleep(0.5)',
              'assert order.refresh().status == "paid"',
              F,
              '',
              'On a busy CI runner the webhook sometimes takes longer than that, so the order is still `pending`. The commit *Speed up checkout tests* lowered the wait from 2 s to 0.5 s.',
              '',
              'A fixed sleep is fragile either way, so I\'ll replace it with a short polling wait.',
            )),
            replace('/home/claude/repo/tests/integration/test_checkout.py', '    sleep(0.5)\n    assert order.refresh().status == "paid"',
              '    wait_for(lambda: order.refresh().status == "paid", timeout=10)', 'Replace the fixed sleep with a polling wait'),
            bash('cd /home/claude/repo && python -m pytest tests/integration/test_checkout.py -q --count 50 2>&1 | tail -1', 'Run the test 50 times', '50 passed in 96.84s\n'),
            T('With the polling wait, **all 50 runs pass**. `wait_for` checks every 100 ms and gives up after 10 s, so the test stays fast when the webhook is quick.'),
          ],
        },
      ],
    },
    {
      // An edited first prompt: two versions of it. Kenji then went back to the first one and
      // carried on there, so the newest message sits on the older branch.
      key: 'rate-limit', owner: 'kenji', name: 'Rate limiting the public API', start: '2026-06-16T09:45',
      turns: [
        { k: 'h1', who: 'h', text: 'What\'s a good way to rate-limit our public API per customer?' },
        { k: 'a1', who: 'a', blocks: [T(demoLines(
          'A **token bucket** per customer is the usual choice:',
          '',
          '- Each customer has a bucket that holds up to *N* tokens (the burst size).',
          '- Tokens refill at a steady rate, for example 100 per minute.',
          '- Each request takes one token. No token, no request: return `429 Too Many Requests` with a `Retry-After` header.',
          '',
          'It allows short bursts but keeps the average rate under control, and it is easy to explain to customers.',
        ))] },
        { k: 'h1b', who: 'h', parent: 'root', wait: 300, text: 'What\'s a good way to rate-limit our public API per customer? We run three app servers behind a load balancer.' },
        { k: 'a1b', who: 'a', blocks: [T(demoLines(
          'With three servers the limit must be shared, or each customer gets three times the limit. Two common options:',
          '',
          '1. **A central counter in Redis.** Each request runs one small atomic script that updates the customer\'s bucket. Simple and exact, but Redis is now on every request.',
          '2. **Limits at the load balancer.** Many gateways support limits per API key. No app code, but less control over the response.',
          '',
          'For most teams, option 1 is the best start.',
        ))] },
        { k: 'h2', who: 'h', parent: 'a1', wait: 900, text: 'Let\'s keep it simple and stay with the plain token bucket for now. Can you show it in Python?' },
        { k: 'a2', who: 'a', blocks: [T(demoLines(
          'Here is a small version that keeps one bucket per customer in memory:',
          '',
          F + 'python',
          'import time',
          'from dataclasses import dataclass, field',
          '',
          '',
          '@dataclass',
          'class TokenBucket:',
          '    rate: float        # tokens added per second',
          '    capacity: int      # largest burst',
          '    tokens: float = field(init=False)',
          '    updated: float = field(init=False)',
          '',
          '    def __post_init__(self):',
          '        self.tokens = self.capacity',
          '        self.updated = time.monotonic()',
          '',
          '    def allow(self) -> bool:',
          '        now = time.monotonic()',
          '        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)',
          '        self.updated = now',
          '        if self.tokens >= 1:',
          '            self.tokens -= 1',
          '            return True',
          '        return False',
          '',
          '',
          'buckets: dict[str, TokenBucket] = {}',
          '',
          '',
          'def allow_request(customer_id: str) -> bool:',
          '    bucket = buckets.setdefault(customer_id, TokenBucket(rate=100 / 60, capacity=20))',
          '    return bucket.allow()',
          F,
          '',
          'This works per server. When you move to the shared set-up, the same logic can run as a Redis script.',
        ))] },
      ],
    },
    {
      // A regenerated reply: two answers to the same prompt.
      key: 'order-regex', owner: 'kenji', name: 'Regex for order IDs', start: '2026-09-22T15:10',
      turns: [
        { k: 'h1', who: 'h', text: 'I need a regex that matches order IDs like NW-2026-000123 but not NW-26-123.' },
        { k: 'a1', who: 'a', blocks: [T(demoLines('This should do it:', '', F, '^NW-\\d{4}-\\d{6}$', F))] },
        { k: 'a1b', who: 'a', parent: 'h1', wait: 40, blocks: [T(demoLines(
          'Use this pattern:',
          '',
          F + 'regex',
          '^NW-(?<year>\\d{4})-(?<number>\\d{6})$',
          F,
          '',
          '- `^` and `$` make sure the whole string is an order ID, not just part of it.',
          '- `\\d{4}` needs a four-digit year, so `NW-26-123` does not match.',
          '- The named groups let you read the year and the number directly.',
          '',
          '| Input | Match? |',
          '|---|---|',
          '| `NW-2026-000123` | yes |',
          '| `NW-26-123` | no |',
          '| `XNW-2026-000123` | no |',
        ))] },
        { k: 'h2', who: 'h', parent: 'a1b', text: 'Perfect. Does that work in JavaScript too?' },
        { k: 'a2', who: 'a', blocks: [T(demoLines(
          'Yes. Named groups work in all current browsers and in Node:',
          '',
          F + 'js',
          'const m = /^NW-(?<year>\\d{4})-(?<number>\\d{6})$/.exec(\'NW-2026-000123\');',
          'console.log(m.groups.year);   // "2026"',
          F,
        ))] },
      ],
    },
    {
      key: 'dedupe', owner: 'kenji', name: 'Find duplicate customers in a CSV', start: '2026-07-28T14:00',
      turns: [
        { who: 'h', text: 'I have customers.csv with about 40,000 rows. Some customers appear twice with small differences in the email (upper case, spaces). Can you write a script that finds them and gives me a spreadsheet?', files: ['customers.csv'] },
        {
          who: 'a', blocks: [
            T('I\'ll write a small script that normalises the emails and groups the rows that match.'),
            createFile('/mnt/user-data/outputs/find_duplicates.py', pythonScript, 'Script that finds duplicate customers'),
            bash('cd /mnt/user-data/outputs && python find_duplicates.py /mnt/user-data/uploads/customers.csv duplicates-report.xlsx', 'Run the script on the uploaded file',
              'Read 40,212 rows\nFound 1,318 duplicate groups (2,701 rows)\nWrote duplicates-report.xlsx\n'),
            present([['/mnt/user-data/outputs/find_duplicates.py', 'text/x-python'], ['/mnt/user-data/outputs/duplicates-report.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]),
            T('Done. The spreadsheet has one row per duplicate customer, sorted so that each group sits together: **1,318 groups** in total. The script is attached too, so you can run it again next month.'),
          ],
        },
      ],
    },

    // ---- Noor Haddad: user researcher (one chat in Hebrew, to show right-to-left text) ----
    {
      key: 'team-meeting-he', owner: 'noor', name: 'סדר יום לישיבת צוות רבעונית', start: '2026-09-03T07:50',
      turns: [
        { who: 'h', text: 'אני צריכה סדר יום לישיבת צוות רבעונית של שעתיים. אנחנו שמונה אנשים, וחלק מהם מצטרפים מרחוק.' },
        { who: 'a', blocks: [T(demoLines(
          'הנה הצעה לסדר יום של שעתיים:',
          '',
          '1. **פתיחה וסבב הצלחות (15 דקות)** – כל אחד משתף הצלחה אחת מהרבעון.',
          '2. **סקירת יעדים (30 דקות)** – מה השגנו, מה נדחה ולמה.',
          '3. **הפסקה (10 דקות)**',
          '4. **סדנת תכנון (45 דקות)** – עבודה בזוגות על היעדים לרבעון הבא.',
          '5. **סיכום ומשימות (20 דקות)** – מי עושה מה ועד מתי.',
          '',
          'טיפ למשתתפים מרחוק: תנו להם לדבר ראשונים בכל סבב, והשתמשו בלוח משותף אחד לכולם.',
        ))] },
        { who: 'h', text: 'מעולה, תודה! אפשר גם הודעה קצרה להזמנה?' },
        { who: 'a', blocks: [T(demoLines(
          'בטח:',
          '',
          '> היי צוות,',
          '> ביום חמישי הקרוב נקיים את ישיבת הצוות הרבעונית, בין 10:00 ל-12:00.',
          '> נעבור על הרבעון, נתכנן את הבא ונסיים עם משימות ברורות.',
          '> מי שמצטרף מרחוק – הקישור נמצא בהזמנה ביומן.',
          '> נתראה!',
        ))] },
      ],
    },
    {
      key: 'interviews', owner: 'noor', name: 'Interview themes, week 36', start: '2026-09-11T12:25',
      summary: demoLines(
        '**Conversation Overview**',
        '',
        'Noor shared notes and quotes from five customer interviews. Claude grouped them into four themes. The strongest one: new teams struggle to find how to invite teammates.',
      ),
      turns: [
        {
          who: 'h', text: 'Here are my notes from this week\'s five customer interviews, plus a few quotes I pasted from the recordings and a photo of our whiteboard. What are the main themes?',
          attachments: [
            demoAttachment('interview-notes-week-36.md', 'text/markdown', interviewNotes),
            demoAttachment('', 'txt', demoLines('"I looked for the invite button under Settings and gave up."', '"If we had SSO, we would roll it out to the whole company."', '"Nobody told us who should be the admin."', '"The weekly summary email is the first thing I read on Monday."')),
          ],
          files: ['whiteboard-photo.png'],
        },
        { who: 'a', blocks: [T(demoLines(
          'Across the five interviews, four themes stand out:',
          '',
          '| Theme | Interviews | What we heard |',
          '|---|---|---|',
          '| **Inviting teammates is hard to find** | 1, 3 | People look for invites under Settings |',
          '| **Unclear ownership** | 3, 5 | Teams do not know who should be the admin |',
          '| **Needs of bigger companies** | 2 | SSO blocks a wider rollout |',
          '| **Reporting** | 4 | CSV export for monthly reports |',
          '',
          'The strongest signal is the first one. The team that invited people early (interview 2) is also the most active, and the biggest cluster on your whiteboard is about invites too.',
          '',
          'Want me to turn this into a one-page summary for the product team?',
        ))] },
      ],
    },

    // ---- Lucía Fernández: marketing ----
    {
      key: 'spring-campaigns', owner: 'lucia', name: 'Spring campaign ideas from other tools', start: '2026-05-19T10:00',
      summary: demoLines(
        '**Conversation Overview**',
        '',
        'Lucía asked what other productivity tools do in their spring campaigns. Claude searched the web and found three common ideas: a fresh start for team habits, free seats for small teams, and customer stories. It suggested the fresh-start idea for Northwind.',
      ),
      turns: [
        { who: 'h', text: 'What are other productivity tools doing in their spring campaigns this year? A short overview with sources, please.' },
        {
          who: 'a', blocks: [
            demoThinking('', ['Searched for this year\'s spring campaigns from productivity tools.', 'Grouped what I found into three common ideas.'], true),
            demoTool('web_search', { query: 'productivity software spring campaign 2026' }, {
              content: [
                demoWebPage('Why “fresh start” campaigns work every spring', springUrls[0], 'Marketing Weekly', 'Spring is the season of resets. This year many software brands frame their spring campaigns as a fresh start for team habits, with checklists, templates and short guides that help teams tidy up their projects.', { age: '3 weeks ago' }),
                demoWebPage('Free seats for small teams: a trend to watch', springUrls[1], 'SaaS Notes', 'Several tools now give small teams extra seats for two or three months. The offers aim to grow usage inside a company before the first renewal.', { age: '1 month ago' }),
                demoWebPage('Customer-led campaigns beat product tours', springUrls[2], 'Brand Stories', 'Short videos where customers explain how they work are replacing classic product tours in ads. They feel more honest and are cheaper to make.', { age: '2 weeks ago' }),
              ],
            }, { message: 'Searching the web', icon_name: 'globe' }),
            T(spring, [
              demoCite(spring, 'Many brands frame spring as a reset and offer checklists and templates to tidy up projects.', springUrls[0]),
              demoCite(spring, 'Several tools give small teams extra seats for a few months to grow usage.', springUrls[1]),
              demoCite(spring, 'Short customer videos replace product tours in ads.', springUrls[2]),
            ]),
          ],
        },
      ],
    },
    {
      key: 'linkedin-post', owner: 'lucia', name: 'Post for the checklist launch', start: '2026-09-24T09:15',
      turns: [
        { who: 'h', text: 'Write a LinkedIn post about our new onboarding checklist. Friendly, not salesy, at most 80 words.' },
        {
          who: 'a', blocks: [
            T('Here\'s a draft:'),
            // The model sometimes sends `variants` as a broken string; the real text is in `body`.
            demoTool('message_compose_v1', {
              kind: 'other', summary_title: 'Checklist launch post', variants: 'label',
              body: demoLines('New at Northwind: an onboarding checklist that walks your team through the first week. ✅', '', 'Invite your teammates, start your first project and set up your weekly summary, one step at a time.', '', 'We built it after talking to dozens of new customers. Their most common question was “what should we do first?” Now the answer is right there.', '', 'Try it in your team space today.'),
            }, { content: demoOut('The draft was shown to the user.') }, widget),
          ],
        },
      ],
    },
    {
      key: 'brand-voice', owner: 'lucia', name: 'Brand voice guide', start: '2026-06-30T11:45',
      turns: [
        { who: 'h', text: 'Can you write a short brand voice guide for Northwind? We want to sound helpful, clear and a little warm. Include do\'s and don\'ts.' },
        {
          who: 'a', blocks: [
            T('Here\'s a first version of the guide.'),
            demoTool('artifacts', { version_uuid: demoUuid('artifact-version:brand-voice'), command: 'create', id: 'brand-voice-guide', type: 'text/markdown', title: 'Northwind brand voice guide', content: brandGuide, language: null, source: 'c' },
              { content: demoOut('OK') }),
            T('It\'s short on purpose, so people actually read it. I can add examples for support replies next.'),
          ],
        },
      ],
    },

    // ---- Priya Raman: data analyst ----
    {
      key: 'weekly-churn', owner: 'priya', name: 'Weekly churn numbers', start: '2026-09-14T08:40',
      summary: demoLines(
        '**Conversation Overview**',
        '',
        'Priya asked for weekly churn over the last eight weeks. The first query used a table that does not exist; Claude rebuilt the numbers from the daily events table and drew a bar chart.',
        '',
        '**Finding:** weekly churn fell from about 2% in July to 1.2% in early September, starting the week the new welcome email went out.',
      ),
      turns: [
        { who: 'h', text: 'Can you pull weekly churn for the last eight weeks from the warehouse and chart it?' },
        {
          who: 'a', blocks: [
            T('Let me query the warehouse.'),
            demoTool('Warehouse:run_query', { query: 'SELECT week, churned_teams, churn_pct FROM analytics.weekly_churn WHERE week >= \'2026-07-20\' ORDER BY week', limit: 20 },
              { content: demoOut('ERROR: relation "analytics.weekly_churn" does not exist'), is_error: true, meta: { error_type: 'tool_error' } }, warehouse),
            T('That table does not exist. I\'ll compute churn from the daily events table instead.'),
            demoTool('Warehouse:run_query', {
              query: demoLines(
                'WITH last_seen AS (',
                '  SELECT team_id, MAX(day) AS last_day FROM events_daily GROUP BY team_id',
                ')',
                'SELECT date_trunc(\'week\', last_day + 30) AS week, COUNT(*) AS churned_teams',
                'FROM last_seen',
                'WHERE last_day + 30 BETWEEN \'2026-07-20\' AND \'2026-09-13\'',
                'GROUP BY 1 ORDER BY 1'),
              limit: 20,
            }, { content: demoOut(JSON.stringify(churnData)), structured_content: { rows: churnData, row_count: churnData.length }, meta: { output_format_category: 'other' } }, warehouse),
            demoTool('chart_display_v0', {
              title: 'Weekly churn rate', style: 'bar',
              series: [{ name: 'Churn %', values: churnRows.map(r => r[2]), color: '#2c8c7c' }],
              xAxis: { data: ['Jul 20', 'Jul 27', 'Aug 3', 'Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7'] },
              yAxis: { title: '% of active teams' },
            }, { content: demoOut('The chart was shown to the user.') }, widget),
            T('Churn dropped from about **2%** a week in July to **1.2%** in early September. The drop starts in the week of August 17, when the new welcome email went out.'),
          ],
        },
      ],
    },
    {
      key: 'cohorts', owner: 'priya', name: 'Which cohort method for the churn dashboard?', start: '2026-08-12T13:20',
      turns: [
        { who: 'h', text: 'Can you read these two articles and tell me which cohort method fits our churn dashboard? https://analytics-handbook.example/cohort-analysis and https://data-blog.example/posts/retention-curves' },
        {
          who: 'a', blocks: [
            demoTool('web_fetch', { url: 'https://analytics-handbook.example/cohort-analysis' }, {
              content: [demoWebPage('Cohort analysis, step by step', 'https://analytics-handbook.example/cohort-analysis', 'Analytics Handbook',
                'A cohort is a group of users who started in the same period. The most useful cohorts for retention are signup-month cohorts. For each cohort, plot the share of users who are still active after 1, 2, 4 and 8 weeks. Compare cohorts before and after a product change to see its effect.',
                { content_type: 'html', mime_type: 'text/html' })],
              display_content: { type: 'rich_link', link: { title: 'Cohort analysis, step by step', url: 'https://analytics-handbook.example/cohort-analysis', icon_url: null, source: 'analytics-handbook.example', subtitles: null, resource_type: null }, is_trusted: false },
            }, { message: 'Fetching: https://analytics-handbook.example/cohort-analysis', integration_name: 'Web Fetch', icon_name: 'globe' }),
            demoTool('web_fetch', { url: 'https://data-blog.example/posts/retention-curves' }, {
              content: demoOut(JSON.stringify({ error_type: 'CLIENT_ERROR', error_message: 'The page returned HTTP 404 (not found).' })),
              is_error: true,
              display_content: { type: 'rich_link', link: { title: 'https://data-blog.example/posts/retention-curves', url: 'https://data-blog.example/posts/retention-curves', icon_url: null, source: 'data-blog.example', subtitles: null, resource_type: null }, is_trusted: false },
              message: 'Failed to fetch: https://data-blog.example/posts/retention-curves',
            }, { message: 'Fetching: https://data-blog.example/posts/retention-curves', integration_name: 'Web Fetch', icon_name: 'globe' }),
            T(demoLines(
              'I could read the first article. The second link returned an error (page not found).',
              '',
              'The handbook recommends **signup-month cohorts** with one retention curve per cohort. For your dashboard that means:',
              '',
              '- Group teams by the month they signed up.',
              '- For each cohort, plot the share still active after 1, 2, 4 and 8 weeks.',
              '- Compare cohorts before and after a change, such as the new welcome email.',
              '',
              'This fits well, because your churn rule (30 days without activity) already gives a clear "active" flag for every week.',
            )),
          ],
        },
      ],
    },
    {
      key: 'churn-recap', owner: 'priya', name: 'Churn findings for Friday\'s review', start: '2026-09-29T10:30',
      turns: [
        { who: 'h', text: 'What did we find about churn a couple of weeks ago? I need it for Friday\'s review.' },
        {
          who: 'a', blocks: [
            demoTool('conversation_search', { query: 'weekly churn' }, {
              content: demoOut('<chat url="https://claude.ai/chat/' + demoUuid('chat:weekly-churn') + '" updated_at="2026-09-14T08:52:10Z">\nTitle: Weekly churn numbers\nChurn dropped from about 2% a week in July to 1.2% in early September.\n</chat>'),
              display_content: { type: 'rich_content', content: [{ title: 'Weekly churn numbers', subtitles: ['14 Sep 2026'], url: 'https://claude.ai/chat/' + demoUuid('chat:weekly-churn'), icon_url: null, resource_type: null, source: null }] },
            }, { message: 'Searching past chats', integration_name: 'Search Past Conversations', icon_name: 'search' }),
            T('In **Weekly churn numbers** (14 September) we found that weekly churn fell from about 2% in July to **1.2%** in early September, starting the week the new welcome email went out.\n\nFor Friday, I\'d show the eight-week bar chart and one sentence about the welcome email.'),
          ],
        },
      ],
    },

    // ---- Mateus Costa: designer ----
    {
      key: 'icon-names', owner: 'mateus', name: 'Icon naming conventions', start: '2026-06-09T15:00',
      turns: [
        { who: 'h', text: 'We have 300 icons with messy names like "Icon_final2.svg". Suggest a naming convention.' },
        { who: 'a', blocks: [T(demoLines(
          'Use **`category-name-variant`**, all lower case, with hyphens between words:',
          '',
          '| Today | New name |',
          '|---|---|',
          '| `Icon_final2.svg` | `action-add-filled.svg` |',
          '| `arrowLeft copy.svg` | `nav-arrow-left.svg` |',
          '| `Trash_NEW.svg` | `action-delete-outline.svg` |',
          '',
          'Rules:',
          '- **Category** first (`action`, `nav`, `status`, `file`), so related icons sort together.',
          '- **Variant** last: `outline` or `filled`.',
          '- No version words like *final* or *new*. Version history belongs in git.',
        ))] },
      ],
    },
    {
      key: 'checkout-a11y', owner: 'mateus', name: 'Accessibility review of checkout step 2', start: '2026-08-26T09:35',
      turns: [
        { who: 'h', text: 'Here\'s a screenshot of step 2 of our checkout. Can you check it for accessibility problems?', files: ['checkout-step-2.png'] },
        {
          who: 'a', blocks: [
            demoTool('view', { description: 'Look at the checkout screenshot', path: '/mnt/user-data/uploads/checkout-step-2.png' },
              { content: [{ type: 'image', file_uuid: demoUuid('image:checkout-step-2') }] },
              Object.assign({ message: 'Look at the checkout screenshot', icon_name: 'file', display_content: { type: 'text', text: 'Look at the checkout screenshot' } }, fileTool)),
            demoTool('image_search', { query: 'accessible form error message example', max_results: 2 }, {
              content: [{
                type: 'image_gallery', is_expired: false,
                images: [
                  { id: 'img_1', title: 'Inline error message under a card number field', url: 'https://design-patterns.example/img/inline-error.png', thumbnail_url: 'https://design-patterns.example/img/inline-error-thumb.png', page_url: 'https://design-patterns.example/forms/errors', source: 'design-patterns.example', width: 1200, height: 800, thumbnail_width: 300, thumbnail_height: 200 },
                  { id: 'img_2', title: 'Error summary at the top of a form', url: 'https://a11y-notes.example/img/error-summary.png', thumbnail_url: 'https://a11y-notes.example/img/error-summary-thumb.png', page_url: 'https://a11y-notes.example/error-summaries', source: 'a11y-notes.example', width: 1000, height: 700, thumbnail_width: 300, thumbnail_height: 210 },
                ],
              }],
            }, { message: 'Searching for images', icon_name: 'search' }),
            T(demoLines(
              'I found four problems:',
              '',
              '1. **Low contrast** on the grey hint text (about 2.8:1; it needs 4.5:1).',
              '2. **Placeholder used as a label** in the card number field. The label disappears when people type.',
              '3. **The error is shown only in red.** Add an icon and a short text, like *"Card number is too short"*.',
              '4. **A small tap target** for the *Edit address* link (about 24 px high; aim for 44 px).',
              '',
              'The two images show good examples of error messages next to the field.',
            )),
          ],
        },
      ],
    },

    // ---- The two Sams ----
    {
      key: 'kickoff-deck', owner: 'samn', name: 'Check the sales kickoff deck', start: '2026-09-16T16:05',
      turns: [
        { who: 'h', text: 'I made the kickoff deck yesterday. Can you open it and check that the targets slide matches these numbers: 120 new customers, 92% retention, 3 new regions?' },
        {
          who: 'a', blocks: [
            demoTool('Artifact', { action: 'open', url: 'https://claude.ai/code/artifact/' + slidesId }, {
              content: demoOut('Opened "Sales Kickoff 2026" (5 slides).'),
              display_content: { type: 'file', published_url: 'https://claude.ai/code/artifact/' + slidesId, published_artifact_id: slidesId, published_action: 'opened', title: 'Sales Kickoff 2026', pinned: null, owned_by_account: true },
              structured_content: { url: 'https://claude.ai/code/artifact/' + slidesId, owned: true, title: 'Sales Kickoff 2026', opened: true, artifact_id: slidesId },
            }, { message: 'Opening the deck' }),
            T('I checked the **Targets for 2027** slide. All three numbers match: 120 new customers, 92% retention and 3 new regions. The speaker notes also mention this year\'s results (104 customers), which is fine as context.'),
          ],
        },
      ],
    },
    {
      // The export sometimes keeps a chat but none of its text.
      key: 'empty', owner: 'samn', name: '', start: '2026-09-18T08:00',
      turns: [{ who: 'h', empty: true }, { who: 'a', empty: true }],
    },
    {
      key: 'k8s-upgrade', owner: 'saml', name: 'Kubernetes upgrade checklist', start: '2026-07-14T10:10',
      turns: [
        { who: 'h', text: 'We\'re upgrading our clusters by one Kubernetes minor version next week. Give me a short checklist.' },
        { who: 'a', blocks: [T(demoLines(
          'Here is a checklist for a minor-version upgrade:',
          '',
          '**Before**',
          '- [ ] Read the release notes for removed APIs.',
          '- [ ] Check if anything still calls deprecated APIs:',
          '  ' + F + 'bash',
          '  kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis',
          '  ' + F,
          '- [ ] Back up etcd, or check your provider\'s backups.',
          '- [ ] Upgrade a staging cluster first.',
          '',
          '**During**',
          '- [ ] Upgrade the control plane, then the node pools one by one.',
          '- [ ] Drain each node before it is replaced: `kubectl drain <node> --ignore-daemonsets`.',
          '',
          '**After**',
          '- [ ] Check that all pods are `Running` and that no `PodDisruptionBudget` blocked a drain.',
          '- [ ] Watch error rates and latency for a day.',
        ))] },
      ],
    },
    { key: 'no-messages', owner: 'saml', name: 'Quick question', start: '2026-09-25T17:30', turns: [] },

    // ---- Jonas Berg: no name in users.json ----
    {
      key: 'travel-policy', owner: 'jonas', name: 'First class train tickets', start: '2026-08-31T09:00',
      turns: [
        { who: 'h', text: 'Can I expense a first class train ticket if the trip is longer than four hours?', inject: { source: 'date_note', prompt: '\n\nThe current date is ' + demoLongDate('2026-08-31T09:00') + '.' } },
        { who: 'a', blocks: [T('I don\'t have Northwind\'s travel policy, so I can\'t say for sure. Many policies allow first class only for long trips, often over four hours, or when it costs the same as second class.\n\nIf you paste the travel part of the policy here, I can find the exact rule for you.')] },
        { who: 'h', text: 'Here\'s the travel part of the policy.', attachments: [demoAttachment('', '', travelPolicy)] },
        { who: 'a', blocks: [T('Yes. Rule **3.2** says first class is allowed for trips **longer than 4 hours**. Keep the ticket, and write the trip time in your expense note so finance can see why.')] },
      ],
    },

    // ---- A former member: owns chats, but is no longer in users.json ----
    {
      key: 'billing-migration', owner: 'former', name: 'Legacy billing migration plan', start: '2026-05-06T10:30',
      summary: demoLines(
        '**Conversation Overview**',
        '',
        'Planning how to move 2,400 customers from the old billing system to the new one without charging anyone twice. Claude suggested four phases and one rule: a customer is billed by exactly one system at any time.',
      ),
      turns: [
        { who: 'h', text: 'We need to move 2,400 customers from the old billing system to the new one without charging anyone twice. How would you plan it?' },
        { who: 'a', blocks: [T(demoLines(
          'I\'d do it in four phases:',
          '',
          '1. **Freeze changes.** No new plans or prices in the old system during the move.',
          '2. **Dry run.** Copy all customers to the new system in test mode and compare the next invoice for each one. Fix every difference.',
          '3. **Move in batches.** 10% of customers per day, simplest plans first. Turn off billing in the old system for a customer *before* you turn it on in the new one.',
          '4. **Watch, then close.** Compare payments for one full billing cycle, then switch off the old system.',
          '',
          'The key rule: a customer is billed by exactly one system at any time. Keep a table that says which one.',
        ))] },
        { who: 'h', text: 'How do we handle customers whose renewal falls in the middle of the move?' },
        { who: 'a', blocks: [T('Move them right **after** their renewal, not before. Then their first invoice from the new system is a normal one a month later, and nobody gets two invoices for the same period.')] },
      ],
    },
    {
      key: 'vendor-renewal', owner: 'former', name: 'Monitoring vendor renewal', start: '2026-05-27T14:15',
      turns: [
        { who: 'h', text: 'Our contract with a monitoring vendor renews in July. What should I ask for before I sign?' },
        { who: 'a', blocks: [T(demoLines(
          'Five things worth asking for:',
          '',
          '1. **A price lock** for two years, or a cap on yearly increases (for example 5%).',
          '2. **A usage review:** pay for what you used last year, not for an estimate.',
          '3. **Exit terms:** an export of your data in a standard format, and 60 days to move.',
          '4. **Support times** in writing.',
          '5. **Their latest security audit report.**',
          '',
          'Ask early: vendors are more flexible a few weeks before the renewal date than on the last day.',
        ))] },
      ],
    },
  ];

  return specs.map(demoChat).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// "Monday, August 31, 2026", as in the platform's date notes.
function demoLongDate(s) {
  const d = new Date(demoMs(s));
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return days[d.getUTCDay()] + ', ' + months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}
