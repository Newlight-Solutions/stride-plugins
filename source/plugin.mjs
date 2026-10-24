// The one place the plugin's identity lives. `scripts/build.mjs` writes every
// agent's package from this and from `source/skills/`; never edit a generated
// package by hand (`npm run check` fails when one drifts from its source).

export const PLUGIN = {
  name: 'stride',
  displayName: 'Stride',
  version: '1.0.0',
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
    skills: { next: 'next', done: 'done' },
    invoke: { next: '/stride:next', done: '/stride:done' },
    signIn:
      'run `/mcp`, select the Stride server (`plugin:stride:stride`), and choose Authenticate (Re-authenticate if it was signed in before). A browser window opens to sign in to Stride.',
  },
  codex: {
    label: 'Codex',
    homepage: 'https://www.stride.page/integrations/codex',
    skills: { next: 'stride-next', done: 'stride-done' },
    invoke: { next: '$stride-next', done: '$stride-done' },
    signIn:
      'open Stride in the plugin browser (`/plugins` in Codex CLI, or the Plugins tab in the ChatGPT desktop app) and connect it when prompted. A browser window opens to sign in to Stride.',
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
