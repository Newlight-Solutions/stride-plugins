#!/usr/bin/env node
// Writes every agent's package, and each agent's marketplace file, from
// `source/`. Run `npm run build` after changing anything in `source/`.
//
//   node scripts/build.mjs          write the packages
//   node scripts/build.mjs --check  fail if a package differs from its source
//
// Each agent reads its own format:
//   claude-code/  Claude Code plugin: .claude-plugin/plugin.json, .mcp.json, skills/
//   codex/        Agent Plugins package with Codex settings: plugin.json, mcp.json, skills/
//   cursor/       Cursor plugin: .cursor-plugin/plugin.json, mcp.json, skills/
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, MCP, OPENAI, PLUGIN } from '../source/plugin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/** path (relative to ROOT) -> file content (string or Buffer) */
const files = new Map();

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const SKILLS = {
  next: {
    description:
      'Pick up your next Stride story: the one a teammate staged for you, or the top story assigned to you, with its acceptance criteria, designs and docs. Starts it in Stride and sets up a branch.',
    argumentHint: '[story key, e.g. ORB-526]',
  },
  done: {
    description:
      'Finish the Stride story you are working on: check it against its acceptance criteria, record what changed, and move it to In Review.',
    argumentHint: '[story key]',
  },
};

function skillBody(skill, agent) {
  const template = readFileSync(join(ROOT, 'source', 'skills', `${skill}.md`), 'utf8');
  const argumentLine =
    agent === 'claude-code'
      ? 'Story the user named, if any: `$ARGUMENTS`'
      : 'If the user named a story key in their message, that is the story.';
  return template
    .replaceAll('{{ARGUMENT_LINE}}', argumentLine)
    .replaceAll('{{NEXT}}', `\`${AGENTS[agent].invoke.next}\``)
    .replaceAll('{{DONE}}', `\`${AGENTS[agent].invoke.done}\``)
    .replaceAll('{{SIGN_IN}}', AGENTS[agent].signIn);
}

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

const REPO = PLUGIN.repository.replace('https://github.com/', '');

/** How each package installs, as its README shows it (each agent's own documented commands). */
const INSTALL = {
  'claude-code': [
    '```bash',
    `claude plugin marketplace add ${REPO}`,
    `claude plugin install ${PLUGIN.name}@${PLUGIN.name}`,
    '```',
    '',
    `Or, in a session on Claude Code 2.1.275 or later: \`/plugin install ${PLUGIN.name} --marketplace ${REPO}\`.`,
  ],
  codex: [
    '```bash',
    `codex plugin marketplace add ${REPO}`,
    '```',
    '',
    'Then run `/plugins` in Codex, open Stride AI and install it.',
  ],
  cursor: ['Copy this folder to `~/.cursor/plugins/local/stride` and run **Developer: Reload Window**.'],
};

function packageReadme(agent) {
  const a = AGENTS[agent];
  return [
    `# Stride for ${a.label}`,
    '',
    `${PLUGIN.description}`,
    '',
    `- \`${a.invoke.next}\` picks up your next story and starts it.`,
    `- \`${a.invoke.done}\` checks it against its acceptance criteria and hands it back for review.`,
    '',
    `It connects ${a.label} to Stride's MCP server, \`${MCP.url}\`. You sign in to Stride in your browser; there is no key to copy.`,
    '',
    '## What it does',
    '',
    `- It adds one MCP server, Stride's, at \`${MCP.url}\`. You sign in to Stride with OAuth in your browser, and the agent acts with your Stride permissions in the projects you allow.`,
    `- \`${a.invoke.next}\` reads your next story from Stride, moves it to In Progress with a short comment if it is still to do, and, in a git repository, creates a branch named after it.`,
    `- \`${a.invoke.done}\` runs your repository's own tests and linters and checks the work against the story's acceptance criteria. When every criterion is met, it moves the story to In Review with a comment saying what changed; otherwise it comments what remains. It commits only when you say so, and pushes or opens a pull request only when you ask.`,
    `- Both run only when you invoke them. The plugin has no hooks and no scripts of its own. Apart from Stride's server, the only place either sends anything is your repository's own git remote, when you ask \`${a.invoke.done}\` to push the branch or open a pull request.`,
    '',
    '## Install',
    '',
    ...INSTALL[agent],
    '',
    // An absolute link: an installed package, or its directory listing, has no `../`.
    `Signing in and the rest of the setup: the [repository README](${PLUGIN.repository}#readme) and ${a.homepage}.`,
    '',
  ].join('\n');
}

// ── Claude Code ────────────────────────────────────────────────────────────
{
  const dir = 'claude-code';
  files.set(`${dir}/.claude-plugin/plugin.json`, json({
    name: PLUGIN.name,
    displayName: AGENTS['claude-code'].displayName ?? PLUGIN.displayName,
    version: PLUGIN.version,
    description: PLUGIN.description,
    author: PLUGIN.author,
    homepage: AGENTS['claude-code'].homepage,
    repository: PLUGIN.repository,
    license: PLUGIN.license,
    keywords: PLUGIN.keywords,
    // Read by Anthropic's plugin directory for the listing; Claude Code ignores them.
    icon: './assets/logo.png',
    documentationUrl: AGENTS['claude-code'].homepage,
    supportUrl: PLUGIN.supportUrl,
    privacyPolicyUrl: PLUGIN.privacyPolicyUrl,
    termsOfServiceUrl: PLUGIN.termsOfServiceUrl,
  }));
  files.set(`${dir}/assets/logo.png`, readFileSync(join(ROOT, 'assets', 'logo.png')));
  files.set(`${dir}/.mcp.json`, json({ mcpServers: { [MCP.serverName]: { type: 'http', url: MCP.url } } }));
  for (const [skill, meta] of Object.entries(SKILLS)) {
    const name = AGENTS['claude-code'].skills[skill];
    files.set(
      `${dir}/skills/${name}/SKILL.md`,
      frontmatter({
        name,
        description: meta.description,
        'argument-hint': meta.argumentHint,
        // Both skills write to Stride and to the repository: run them only when asked.
        'disable-model-invocation': true,
      }) + skillBody(skill, 'claude-code'),
    );
  }
  files.set(`${dir}/README.md`, packageReadme('claude-code'));
}

// ── Codex (Agent Plugins with OpenAI settings) ─────────────────────────────
// Also the package submitted to OpenAI's plugin directory: its listing,
// review and publication fields come from `OPENAI`.
{
  const dir = 'codex';
  files.set(`${dir}/plugin.json`, json({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: PLUGIN.name,
    version: OPENAI.version,
    description: PLUGIN.description,
    author: PLUGIN.author,
    homepage: AGENTS.codex.homepage,
    repository: PLUGIN.repository,
    license: PLUGIN.license,
    keywords: PLUGIN.keywords,
    extensions: {
      'com.openai': {
        interface: {
          displayName: OPENAI.displayName,
          shortDescription: OPENAI.shortDescription,
          longDescription: OPENAI.longDescription,
          developerName: PLUGIN.author.name,
          category: OPENAI.category,
          capabilities: OPENAI.capabilities,
          websiteURL: PLUGIN.websiteUrl,
          supportURL: PLUGIN.supportUrl,
          privacyPolicyURL: PLUGIN.privacyPolicyUrl,
          termsOfServiceURL: PLUGIN.termsOfServiceUrl,
          defaultPrompt: OPENAI.defaultPrompt,
          brandColor: PLUGIN.brandColor,
          composerIcon: './assets/logo.png',
          composerIconDark: './assets/logo-dark.png',
          logo: './assets/logo.png',
          logoDark: './assets/logo-dark.png',
        },
        review: OPENAI.review,
        publication: OPENAI.publication,
      },
    },
  }));
  // Codex signs in with its Client ID Metadata Document, which Stride
  // recognises (docs: Codex's plugin build guide, "Declare authentication
  // under each server's extensions["com.openai"].auth").
  files.set(`${dir}/mcp.json`, json({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      [MCP.serverName]: {
        type: 'streamable-http',
        url: MCP.url,
        extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'cimd' } } } },
      },
    },
  }));
  for (const [skill, meta] of Object.entries(SKILLS)) {
    const name = AGENTS.codex.skills[skill];
    files.set(`${dir}/skills/${name}/SKILL.md`, frontmatter({ name, description: meta.description }) + skillBody(skill, 'codex'));
    // Run only when the user invokes it ($stride:next / $stride:done).
    files.set(`${dir}/skills/${name}/agents/openai.yaml`, 'policy:\n  allow_implicit_invocation: false\n');
  }
  files.set(`${dir}/assets/logo.png`, readFileSync(join(ROOT, 'assets', 'logo.png')));
  // The same mark in the brand's dark-mode fill (#F7F8FA), for dark themes.
  files.set(`${dir}/assets/logo-dark.png`, readFileSync(join(ROOT, 'assets', 'logo-dark.png')));
  files.set(`${dir}/README.md`, packageReadme('codex'));
}

// ── Cursor ─────────────────────────────────────────────────────────────────
{
  const dir = 'cursor';
  files.set(`${dir}/.cursor-plugin/plugin.json`, json({
    name: PLUGIN.name,
    version: PLUGIN.version,
    description: PLUGIN.description,
    author: { name: PLUGIN.author.name, email: PLUGIN.author.email },
    homepage: AGENTS.cursor.homepage,
    repository: PLUGIN.repository,
    license: PLUGIN.license,
    keywords: PLUGIN.keywords,
    logo: 'assets/logo.svg',
  }));
  // Cursor registers itself (Dynamic Client Registration) and signs the person in.
  files.set(`${dir}/mcp.json`, json({ mcpServers: { [MCP.serverName]: { url: MCP.url } } }));
  for (const [skill, meta] of Object.entries(SKILLS)) {
    const name = AGENTS.cursor.skills[skill];
    files.set(`${dir}/skills/${name}/SKILL.md`, frontmatter({ name, description: meta.description }) + skillBody(skill, 'cursor'));
  }
  files.set(`${dir}/assets/logo.svg`, readFileSync(join(ROOT, 'assets', 'logo.svg')));
  files.set(`${dir}/README.md`, packageReadme('cursor'));
}

// ── Marketplaces ───────────────────────────────────────────────────────────
const owner = { name: PLUGIN.author.name, email: PLUGIN.author.email };
files.set('.claude-plugin/marketplace.json', json({
  name: 'stride',
  owner,
  description: 'Stride for Claude Code.',
  plugins: [{ name: PLUGIN.name, source: './claude-code', description: PLUGIN.description, version: PLUGIN.version }],
}));
files.set('.agents/plugins/marketplace.json', json({
  name: 'stride',
  interface: { displayName: PLUGIN.displayName },
  plugins: [
    {
      name: PLUGIN.name,
      source: { source: 'local', path: './codex' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity',
    },
  ],
}));
files.set('.cursor-plugin/marketplace.json', json({
  name: 'stride',
  owner,
  metadata: { description: 'Stride for Cursor.', version: PLUGIN.version },
  plugins: [{ name: PLUGIN.name, source: 'cursor', description: PLUGIN.description }],
}));

// ── Write or check ─────────────────────────────────────────────────────────
const GENERATED_DIRS = ['claude-code', 'codex', 'cursor'];

function listFiles(dir) {
  const out = [];
  if (!existsSync(join(ROOT, dir))) return out;
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out;
}

const same = (path, content) => {
  const full = join(ROOT, path);
  if (!existsSync(full)) return false;
  const current = readFileSync(full);
  return Buffer.isBuffer(content) ? current.equals(content) : current.toString('utf8') === content;
};

const expected = new Set(files.keys());
const stale = GENERATED_DIRS.flatMap(listFiles).filter((p) => !expected.has(p));
const drifted = [...files.entries()].filter(([path, content]) => !same(path, content)).map(([p]) => p);

if (CHECK) {
  if (drifted.length || stale.length) {
    for (const p of drifted) console.error(`out of date: ${p}`);
    for (const p of stale) console.error(`not generated from source: ${p}`);
    console.error('Run `npm run build` and commit the result.');
    process.exit(1);
  }
  console.log(`build: ${files.size} generated files match their source.`);
} else {
  for (const p of stale) rmSync(join(ROOT, p));
  // A renamed skill leaves its folder behind once its files go; drop the
  // folders that are now empty, so the package lists only what is generated.
  const pruneEmpty = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) pruneEmpty(`${dir}/${entry.name}`);
    }
    if (readdirSync(join(ROOT, dir)).length === 0) rmSync(join(ROOT, dir), { recursive: true });
  };
  for (const dir of GENERATED_DIRS) if (existsSync(join(ROOT, dir))) pruneEmpty(dir);
  for (const [path, content] of files) {
    mkdirSync(dirname(join(ROOT, path)), { recursive: true });
    writeFileSync(join(ROOT, path), content);
  }
  console.log(`build: wrote ${files.size} files${stale.length ? `, removed ${stale.length}` : ''}.`);
}
