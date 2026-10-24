// The one place the plugin's identity lives. `scripts/build.mjs` writes every
// agent's package from this and from `source/skills/`; never edit a generated
// package by hand (`npm run check` fails when one drifts from its source).

export const PLUGIN = {
  name: 'stride',
  displayName: 'Stride',
  version: '1.0.2',
  description:
    'Work your Stride backlog from your coding agent: pick up your next story with its acceptance criteria, designs and docs, and hand it back for review when it is done.',
  shortDescription: 'Your next Stride story, with its full spec, in your coding agent.',
  author: { name: 'Newlight Solutions', email: 'info@newlightai.com', url: 'https://www.stride.page' },
  homepage: 'https://www.stride.page/integrations/claude-code',
  repository: 'https://github.com/Newlight-Solutions/stride-plugins',
  license: 'MIT',
  keywords: ['stride', 'mcp', 'project-management', 'agile', 'user-stories', 'acceptance-criteria', 'sprints'],
  websiteUrl: 'https://www.stride.page',
  privacyPolicyUrl: 'https://www.stride.page/legal/privacy',
  supportUrl: 'https://github.com/Newlight-Solutions/stride-plugins/issues',
  termsOfServiceUrl: 'https://www.stride.page/legal/terms',
  brandColor: '#0040E0',
};

/** The MCP server every package connects to. It signs the person in with OAuth; no key is configured. */
export const MCP = {
  serverName: 'stride',
  url: 'https://www.stride.page/api/mcp/stride',
};

/**
 * How each agent names and invokes the two skills, and how a person signs in
 * again when Stride's tools stop answering.
 */
export const AGENTS = {
  'claude-code': {
    label: 'Claude Code',
    homepage: 'https://www.stride.page/integrations/claude-code',
    // Anthropic's directory already lists a different "Stride" (a field-service
    // connector), so this package's listing reads "Stride AI". Only the
    // display name changes: `name` stays `stride`, and with it `/stride:next`.
    displayName: 'Stride AI',
    skills: { next: 'next', done: 'done' },
    invoke: { next: '/stride:next', done: '/stride:done' },
    // The same package is what Anthropic's directory installs in the Claude
    // apps (claude.ai, the desktop app, Cowork), which have no `/mcp`.
    signIn:
      'run `/mcp` in Claude Code, select the Stride server (`plugin:stride:stride`), and choose Authenticate (Re-authenticate if it was signed in before), which opens a browser window to sign in to Stride; in the Claude app, open Customize → Connectors and connect Stride instead.',
  },
  codex: {
    label: 'Codex',
    homepage: 'https://www.stride.page/integrations/codex',
    // This package is also what is submitted to OpenAI's plugin directory
    // (ChatGPT and Codex), under the name and version in `OPENAI` below.
    displayName: 'Stride AI',
    // Codex qualifies a plugin's skills with the plugin's name ("a skill named
    // `search` beneath a plugin named `sample` is exposed as `sample:search`",
    // codex-rs/ext/skills/src/loader/namespace.rs), so `next` is `$stride:next`.
    skills: { next: 'next', done: 'done' },
    invoke: { next: '$stride:next', done: '$stride:done' },
    signIn:
      'open Stride AI in Plugins (`/plugins` in Codex CLI, or Plugins in ChatGPT) and connect it when prompted. A browser window opens to sign in to Stride.',
  },
  cursor: {
    label: 'Cursor',
    homepage: 'https://www.stride.page/integrations/cursor',
    skills: { next: 'stride-next', done: 'stride-done' },
    invoke: { next: '/stride-next', done: '/stride-done' },
    signIn:
      'open Customize → MCPs in Cursor, where Stride shows that it needs to sign in, and connect it again. A browser window opens to sign in to Stride.',
  },
};

/**
 * What OpenAI's plugin directory (ChatGPT and Codex) reads from the Codex
 * package: the listing, and the review material its reviewers test with
 * (developers.openai.com/plugins/deploy/submission, "Manifest fields").
 * `npm run check` holds it to the directory's limits: name and subtitle at
 * most 30 characters, at most three starter prompts of 128, exactly five
 * positive and three negative test cases.
 *
 * The Codex package carries its own version, so a directory release leaves
 * the Claude Code and Cursor packages, and their listings, untouched.
 *
 * The test cases run against the reviewer's account: Owner of the Orbit
 * Payments sample project only. Reviewer sign-in details never go here; they
 * are entered in OpenAI's dashboard.
 */
export const OPENAI = {
  version: '1.1.0',
  displayName: AGENTS.codex.displayName,
  shortDescription: 'Work your Stride backlog',
  longDescription: [
    'Stride (stride.page) is an AI software delivery platform where product and engineering teams keep their backlog, designs, documents and tests in one connected record. Stride AI brings that record into ChatGPT and Codex, so they work from the real requirement instead of a pasted ticket.',
    '',
    'With Stride AI you can:',
    '- Read a story with its acceptance criteria, linked UI designs, architecture diagrams, documents, related stories, test cases, defects and pull requests, in one step.',
    '- Pick up the next story staged for you, or the top story assigned to you, and move work across your board.',
    '- Create and update stories, epics, sprints, releases, labels, comments and story relations.',
    '- Write test cases from acceptance criteria, record test runs and results, file defects and check quality gates.',
    '- Search your project library (meeting notes, PRDs, specs, retros) and save new documents.',
    '- Generate UI mockups, architecture diagrams and BPMN processes for a story.',
    '',
    'In Codex, two skills run the coding loop: $stride:next picks up your next story with its full spec and starts it, and $stride:done checks the work against the story\'s acceptance criteria and moves it to In Review.',
    '',
    'Stride AI is for product managers, engineers and testers whose team works in Stride, and it needs a Stride account. You sign in with it and choose which projects Stride AI can reach. It acts with your own role in each project, so it can never do more than you can. Everything it writes is labeled as the agent\'s in Stride and recorded in the audit log, and you can disconnect it at any time in Stride under Settings → Integrations → Connected apps.',
    '',
    'Limitations: generating designs, diagrams and processes counts toward your workspace\'s AI usage and can take one to four minutes. Opening a draft pull request needs GitHub connected to your Stride workspace. Stride AI does not handle billing or payments.',
  ].join('\n'),
  category: 'Productivity',
  capabilities: [
    'Read stories with acceptance criteria',
    'Pick up your next story',
    'Update story status',
    'Plan sprints, epics and releases',
    'Write test cases',
    'File defects',
    'Search project documents',
    'Generate designs and diagrams',
  ],
  defaultPrompt: [
    'Pick up my next Stride story and summarize what it needs.',
    "What's still open in the current sprint, and who's on it?",
    'Draft test cases from the acceptance criteria of a story.',
  ],
  review: {
    test_cases: {
      positive: [
        {
          description: 'Read a story with its full context',
          prompt: "Show me ORB-64 in Stride with its acceptance criteria and everything it's linked to.",
          tools_triggered: 'stride.get_story_context',
          expected_behavior:
            'Returns ORB-64, "Add error handling for FX settlement", from the Orbit Payments project: its status, priority and assignee, its four acceptance criteria, its epic (Multi-currency native support), its sprint (S9 — Multi-currency + tax), the story it blocks (ORB-34), and any test cases and defects linked to it.',
        },
        {
          description: 'Triage open defects across a project',
          prompt: 'Which defects in Orbit Payments are still open or in progress? Group them by severity.',
          tools_triggered: 'stride.list_projects, stride.list_defects',
          expected_behavior:
            'Finds the Orbit Payments project and lists its defects whose status is Open or In Progress, grouped by severity, each with its title and assignee. Resolved defects are left out.',
        },
        {
          description: 'Write test cases from acceptance criteria',
          prompt: 'Write a test case for each acceptance criterion of ORB-64.',
          tools_triggered: 'stride.create_test_case_from_ac',
          expected_behavior:
            "Gives each of ORB-64's four acceptance criteria a linked test case and lists their titles; they appear on the story's Tests tab in Stride. The tool is idempotent per criterion: a criterion that already has a case (from an earlier run) returns that case instead of a duplicate, and the reply says so.",
        },
        {
          description: 'File a defect against a story',
          prompt: 'Log a high-severity defect on ORB-64: FX settlement throws an error when the currency code is empty.',
          tools_triggered: 'stride.list_projects, stride.create_defect',
          expected_behavior:
            'After ChatGPT asks to allow the write, creates an Open defect with severity High, filed against ORB-64 in Orbit Payments, with the reported behavior in its title and description, and confirms its title, severity and status.',
        },
        {
          description: "Move a story across the board with a comment",
          prompt: "Move ORB-64 to In Progress and add a comment that I've started on the FX settlement error handling.",
          tools_triggered: 'stride.update_story_status',
          expected_behavior:
            "ORB-64's status becomes In Progress and the comment is recorded on the story; the reply confirms both.",
        },
      ],
      negative: [
        {
          description: 'Unrelated request. Stride AI has no weather data, so none of its tools should run.',
          prompt: "What's the weather in London today?",
          expected_behavior: 'ChatGPT answers without calling any Stride AI tool.',
        },
        {
          description:
            'Billing and payments. Stride AI has no tools that change a plan or take a payment, so it should not try.',
          prompt: 'Upgrade my Stride workspace to the Enterprise plan and charge the card on file.',
          expected_behavior: "Explains that Stride AI can't change plans or take payments. No Stride AI tool makes a change.",
        },
        {
          description:
            'Access outside the connected account. The test account reaches only the Orbit Payments project, and Stride AI sees only the projects the signed-in account can access.',
          prompt: 'List the stories in the Acme Bank project in Stride.',
          expected_behavior:
            'Finds no accessible project named Acme Bank (only Orbit Payments is available), says so, and returns no data from any other workspace or project.',
        },
      ],
    },
    demo_recording_url: 'https://www.stride.page/demo/stride-ai-chatgpt.webm',
    commerce: false,
    commerce_description: 'Stride AI does not sell products or process payments.',
  },
  publication: {
    release_notes:
      "First release in OpenAI's plugin directory: Stride's hosted MCP server, with OAuth sign-in and tools for stories, sprints, designs, documents, tests and defects, and the two Codex skills $stride:next and $stride:done.",
  },
};
