#!/usr/bin/env node
// Checks every package, marketplace file and the MCP Registry entry against
// the rules their clients document. No dependencies, so it runs anywhere:
//
//   Claude Code  https://code.claude.com/docs/en/plugins/manifest-reference
//                https://code.claude.com/docs/en/plugins/marketplace-reference
//   Codex        https://developers.openai.com/plugins/build/plugins
//                https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
//   Cursor       https://cursor.com/docs/reference/plugins
//   Registry     https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
//
// Claude Code's own validator is worth running too when it is installed:
//   claude plugin validate . && claude plugin validate ./claude-code
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

const MCP_URL = 'https://www.stride.page/api/mcp/stride';
const KEBAB = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** Agent Plugins 1.0.0 `name` (periods allowed, no `--` or `..`). */
const AGENT_PLUGINS_NAME = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

function readJson(rel) {
  const full = join(ROOT, rel);
  if (!existsSync(full)) {
    fail(rel, 'missing');
    return null;
  }
  try {
    return JSON.parse(readFileSync(full, 'utf8'));
  } catch (err) {
    fail(rel, `invalid JSON (${err.message})`);
    return null;
  }
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

/** A plugin-relative path: `./x` or `x`, no `..`, no absolute path, inside the root. */
function insideRoot(rel, base = '') {
  if (typeof rel !== 'string' || rel.length === 0) return false;
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.includes('\\') || rel.split('/').includes('..')) return false;
  const resolved = normalize(join(ROOT, base, rel));
  return resolved === ROOT || resolved.startsWith(ROOT + sep);
}

function frontmatter(rel) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) {
    fail(rel, 'no YAML frontmatter');
    return {};
  }
  const out = {};
  for (const line of match[1].split('\n')) {
    const m = /^([a-z][a-z0-9-]*):\s*(.*)$/.exec(line);
    if (!m) {
      fail(rel, `unreadable frontmatter line: ${line}`);
      continue;
    }
    const raw = m[2];
    out[m[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw === 'true' ? true : raw === 'false' ? false : raw;
  }
  return out;
}

function checkSkills(pkg, expectedNames, { claude = false } = {}) {
  const dir = join(ROOT, pkg, 'skills');
  if (!existsSync(dir)) return fail(`${pkg}/skills`, 'missing');
  const found = readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory()).sort();
  if (JSON.stringify(found) !== JSON.stringify([...expectedNames].sort())) {
    fail(`${pkg}/skills`, `expected [${expectedNames}], found [${found}]`);
  }
  for (const name of found) {
    const rel = `${pkg}/skills/${name}/SKILL.md`;
    if (!existsSync(join(ROOT, rel))) {
      fail(rel, 'missing');
      continue;
    }
    const fm = frontmatter(rel);
    if (fm.name !== name) fail(rel, `frontmatter name "${fm.name}" must equal its directory "${name}"`);
    if (!KEBAB.test(name)) fail(rel, 'skill name must be lowercase kebab-case');
    if (typeof fm.description !== 'string' || fm.description.length < 20) fail(rel, 'needs a description');
    if ((fm.description ?? '').length > 1024) fail(rel, 'description over 1024 characters');
    if (claude && fm['disable-model-invocation'] !== true) {
      fail(rel, 'Claude Code skills that write must set disable-model-invocation: true');
    }
    const body = readFileSync(join(ROOT, rel), 'utf8');
    if (/\{\{[A-Z_]+\}\}/.test(body)) fail(rel, 'an unreplaced template placeholder');
  }
}

function checkAuthor(where, author, { requireName = true, allowed }) {
  if (author === undefined) return;
  if (!author || typeof author !== 'object' || Array.isArray(author)) return fail(where, 'author must be an object');
  if (requireName && typeof author.name !== 'string') fail(where, 'author.name is required');
  for (const key of Object.keys(author)) if (!allowed.includes(key)) fail(where, `author.${key} is not allowed`);
}

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Width and height of a PNG, from its IHDR chunk; null when the file is not a PNG. */
function pngSize(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * OpenAI's plugin directory (ChatGPT and Codex) holds a remote MCP plugin to
 * stricter rules at final submission than a package upload checks:
 * developers.openai.com/plugins/deploy/submission ("Manifest fields") and
 * /deploy/submission-errors ("Final directory submission").
 */
function checkOpenAIDirectory(where, pkg, manifest) {
  const breaks = ['\r', '\n', String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
  const oneLine = (value) => typeof value === 'string' && value.trim() !== '' && !breaks.some((c) => value.includes(c));
  const ext = manifest.extensions?.['com.openai'] ?? {};
  const ui = ext.interface ?? {};
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version ?? '')) fail(where, 'version must be a semantic version');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(manifest.name ?? '')) fail(where, 'name must be at most 64 ASCII letters, digits, _ or -');
  if (typeof manifest.description !== 'string' || !manifest.description.trim() || manifest.description.length > 1024) fail(where, 'description must be 1-1024 characters');
  if (typeof manifest.author?.name !== 'string' || manifest.author.name.length > 120) fail(where, 'author.name is required, at most 120 characters');

  for (const [key, max] of [['displayName', 30], ['shortDescription', 30], ['developerName', 80]]) {
    if (!oneLine(ui[key]) || ui[key].length > max) fail(where, `interface.${key} must be one line of at most ${max} characters`);
  }
  if (typeof ui.longDescription !== 'string' || !ui.longDescription.trim() || ui.longDescription.length > 4000) fail(where, 'interface.longDescription must be 1-4000 characters');
  const categories = ['Productivity', 'Creativity', 'Developer Tools', 'Business & Operations', 'Data & Analytics', 'Communication', 'Education & Research', 'Security', 'Finance', 'Healthcare', 'Travel', 'Entertainment', 'Other'];
  if (!categories.includes(ui.category)) fail(where, `interface.category must be one of: ${categories.join(', ')}`);
  if (!Array.isArray(ui.capabilities) || ui.capabilities.length > 20 || !ui.capabilities.every((c) => oneLine(c) && c.length <= 120)) {
    fail(where, 'interface.capabilities must be at most 20 one-line entries of at most 120 characters');
  }
  // A remote MCP plugin needs all four listing URLs.
  for (const key of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    if (!isHttpsUrl(ui[key]) || ui[key].length > 1024) fail(where, `interface.${key} must be an https URL of at most 1024 characters`);
  }
  const prompts = ui.defaultPrompt === undefined ? [] : [].concat(ui.defaultPrompt);
  if (prompts.length > 3) fail(where, 'interface.defaultPrompt takes at most three prompts');
  const seen = new Set();
  for (const prompt of prompts) {
    if (!oneLine(prompt) || prompt.length > 128) fail(where, `starter prompt must be one line of at most 128 characters: ${prompt}`);
    if (/@\S/.test(prompt ?? '')) fail(where, `starter prompt must not @mention a server: ${prompt}`);
    const key = String(prompt).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(key)) fail(where, `duplicate starter prompt: ${prompt}`);
    seen.add(key);
  }
  if (ui.brandColor !== undefined && contrast(ui.brandColor, '#FFFFFF') < 2) fail(where, 'interface.brandColor needs at least 2:1 contrast against white');
  if (ui.brandColorDark !== undefined && (!/^#[0-9A-Fa-f]{6}$/.test(ui.brandColorDark) || contrast(ui.brandColorDark, '#212121') < 2)) {
    fail(where, 'interface.brandColorDark must be #RRGGBB with at least 2:1 contrast against #212121');
  }
  // Icons: square PNGs of 48 to 4096 pixels, at most 5 MiB, ./-prefixed and inside the package.
  for (const key of ['logo', 'composerIcon', 'logoDark', 'composerIconDark']) {
    const rel = ui[key];
    if (rel === undefined) {
      if (key === 'logo' || key === 'composerIcon') fail(where, `interface.${key} is required`);
      continue;
    }
    if (typeof rel !== 'string' || !rel.startsWith('./') || !insideRoot(rel, pkg) || !existsSync(join(ROOT, pkg, rel))) {
      fail(where, `interface.${key} must be a ./ path to a file inside the package`);
      continue;
    }
    const bytes = readFileSync(join(ROOT, pkg, rel));
    const size = pngSize(bytes);
    if (!rel.endsWith('.png') || !size) fail(where, `interface.${key} must be a PNG`);
    else if (size.width !== size.height || size.width < 48 || size.width > 4096) fail(where, `interface.${key} must be square, 48 to 4096 pixels`);
    if (bytes.length > 5 * 1024 * 1024) fail(where, `interface.${key} is over 5 MiB`);
  }
  // Screenshots are allowed only for a server that renders its own UI; Stride's does not.
  if (ui.screenshots !== undefined) fail(where, 'interface.screenshots: Stride has no custom UI, so the directory rejects screenshots');

  const review = ext.review;
  if (!review) return fail(where, 'extensions["com.openai"].review is missing');
  for (const key of ['test_credentials', 'reviewer_instructions']) {
    if (key in review) fail(where, `review.${key}: reviewer sign-in goes in OpenAI's dashboard, never in the package`);
  }
  const positive = review.test_cases?.positive ?? [];
  const negative = review.test_cases?.negative ?? [];
  if (positive.length !== 5) fail(where, `review needs exactly five positive test cases (found ${positive.length})`);
  if (negative.length !== 3) fail(where, `review needs exactly three negative test cases (found ${negative.length})`);
  for (const [i, c] of positive.entries()) {
    for (const key of ['description', 'prompt', 'tools_triggered', 'expected_behavior']) {
      if (typeof c[key] !== 'string' || !c[key].trim()) fail(where, `positive test case ${i + 1} needs ${key}`);
    }
    if ((c.description ?? '').length > 4000) fail(where, `positive test case ${i + 1}: description over 4000 characters`);
    for (const tool of String(c.tools_triggered ?? '').split(',')) {
      if (!/^stride\.[a-z_]+$/.test(tool.trim())) fail(where, `positive test case ${i + 1}: "${tool.trim()}" is not a Stride tool name`);
    }
  }
  for (const [i, c] of negative.entries()) {
    for (const key of ['description', 'prompt']) {
      if (typeof c[key] !== 'string' || !c[key].trim()) fail(where, `negative test case ${i + 1} needs ${key}`);
    }
  }
  if (!isHttpsUrl(review.demo_recording_url)) fail(where, 'review.demo_recording_url must be an https URL');
  if (typeof review.commerce !== 'boolean') fail(where, 'review.commerce must be true or false');
  const notes = ext.publication?.release_notes;
  if (typeof notes !== 'string' || !notes.trim()) fail(where, 'publication.release_notes is required');
}

// ── Claude Code ────────────────────────────────────────────────────────────
{
  const pkg = 'claude-code';
  const manifest = readJson(`${pkg}/.claude-plugin/plugin.json`);
  if (manifest) {
    const where = `${pkg}/.claude-plugin/plugin.json`;
    if (!KEBAB.test(manifest.name ?? '')) fail(where, 'name must be kebab-case');
    if (manifest.name !== 'stride') fail(where, 'name must be "stride" (it is the /stride: command namespace)');
    if (manifest.homepage !== undefined && !isHttpsUrl(manifest.homepage)) fail(where, 'homepage must be a URL');
    for (const key of ['version', 'description', 'author']) if (manifest[key] === undefined) fail(where, `${key} is recommended`);
    checkAuthor(where, manifest.author, { allowed: ['name', 'email', 'url'] });
    if (manifest.displayName !== undefined && typeof manifest.displayName !== 'string') fail(where, 'displayName must be a string');
    // Directory listing fields (Anthropic's directory reads them): an image inside the plugin, and https URLs.
    if (manifest.icon !== undefined && !(typeof manifest.icon === 'string' && manifest.icon.startsWith('./') && insideRoot(manifest.icon, pkg) && existsSync(join(ROOT, pkg, manifest.icon)))) {
      fail(where, 'icon must be a ./ path to an image inside the plugin');
    }
    for (const key of ['documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl']) {
      if (manifest[key] !== undefined && !isHttpsUrl(manifest[key])) fail(where, `${key} must be an https URL`);
    }
  }
  const mcp = readJson(`${pkg}/.mcp.json`);
  const server = mcp?.mcpServers?.stride;
  if (!server) fail(`${pkg}/.mcp.json`, 'mcpServers.stride is missing');
  else {
    if (server.type !== 'http') fail(`${pkg}/.mcp.json`, 'type must be "http" (a url without a type is read as stdio)');
    if (server.url !== MCP_URL) fail(`${pkg}/.mcp.json`, `url must be ${MCP_URL}`);
    if (server.headers) fail(`${pkg}/.mcp.json`, 'no headers: a rejected header never falls back to OAuth');
  }
  checkSkills(pkg, ['next', 'done'], { claude: true });

  const market = readJson('.claude-plugin/marketplace.json');
  if (market) {
    const where = '.claude-plugin/marketplace.json';
    if (!KEBAB.test(market.name ?? '')) fail(where, 'name must be kebab-case');
    if (/^claudeai-|^claude-plugins-official/.test(market.name ?? '')) fail(where, 'reserved marketplace name');
    if (typeof market.owner?.name !== 'string') fail(where, 'owner.name is required');
    if (!Array.isArray(market.plugins) || market.plugins.length === 0) fail(where, 'plugins must list the plugin');
    for (const entry of market.plugins ?? []) {
      if (typeof entry.source !== 'string' || !entry.source.startsWith('./') || !insideRoot(entry.source)) {
        fail(where, `plugin "${entry.name}" source must be a ./ path inside the repository`);
        continue;
      }
      const target = readJson(join(entry.source, '.claude-plugin', 'plugin.json').replaceAll('\\', '/'));
      if (target && target.name !== entry.name) fail(where, `entry "${entry.name}" does not match ${entry.source}'s plugin.json name "${target.name}"`);
    }
  }
}

// ── Codex: Agent Plugins 1.0.0 + OpenAI settings ───────────────────────────
{
  const pkg = 'codex';
  const where = `${pkg}/plugin.json`;
  const manifest = readJson(where);
  const allowedTop = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
  if (manifest) {
    if (manifest.$schema !== 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json') fail(where, '$schema must be the Agent Plugins 1.0.0 plugin schema');
    if (!AGENT_PLUGINS_NAME.test(manifest.name ?? '') || manifest.name.length > 64) fail(where, 'name breaks the Agent Plugins name rule');
    for (const key of Object.keys(manifest)) if (!allowedTop.includes(key)) fail(where, `unknown top-level field "${key}"`);
    for (const key of ['version', 'description', 'homepage', 'repository', 'license']) {
      if (manifest[key] !== undefined && typeof manifest[key] !== 'string') fail(where, `${key} must be a string`);
    }
    if (manifest.keywords !== undefined && !(Array.isArray(manifest.keywords) && manifest.keywords.every((k) => typeof k === 'string'))) {
      fail(where, 'keywords must be an array of strings');
    }
    checkAuthor(where, manifest.author, { requireName: false, allowed: ['name', 'email', 'url'] });
    const ext = manifest.extensions ?? {};
    for (const [ns, value] of Object.entries(ext)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where, `extensions["${ns}"] must be an object`);
    }
    const ui = ext['com.openai']?.interface;
    if (!ui) fail(where, 'extensions["com.openai"].interface is missing');
    else {
      for (const key of ['displayName', 'shortDescription', 'developerName', 'category']) {
        if (typeof ui[key] !== 'string' || !ui[key]) fail(where, `interface.${key} is required`);
      }
      for (const key of ['websiteURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
        if (ui[key] !== undefined && !isHttpsUrl(ui[key])) fail(where, `interface.${key} must be an https URL`);
      }
      if (ui.logo !== undefined && !(insideRoot(ui.logo, pkg) && existsSync(join(ROOT, pkg, ui.logo)))) fail(where, 'interface.logo must be a file inside the package');
      if (ui.brandColor !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(ui.brandColor)) fail(where, 'interface.brandColor must be #RRGGBB');
    }
    checkOpenAIDirectory(where, pkg, manifest);
  }
  const mcpWhere = `${pkg}/mcp.json`;
  const mcp = readJson(mcpWhere);
  if (mcp) {
    if (mcp.$schema !== 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json') fail(mcpWhere, '$schema must be the Agent Plugins 1.0.0 MCP schema');
    for (const key of Object.keys(mcp)) if (!['$schema', 'mcpServers'].includes(key)) fail(mcpWhere, `unknown top-level field "${key}"`);
    const server = mcp.mcpServers?.stride;
    if (!server) fail(mcpWhere, 'mcpServers.stride is missing');
    else {
      if (server.type !== 'streamable-http') fail(mcpWhere, 'type must be "streamable-http"');
      if (server.url !== MCP_URL) fail(mcpWhere, `url must be ${MCP_URL}`);
      // Codex reads its auth declaration here (its build guide); nothing else may ride along.
      for (const key of Object.keys(server)) if (!['type', 'url', 'extensions'].includes(key)) fail(mcpWhere, `unknown server field "${key}"`);
      const auth = server.extensions?.['com.openai']?.auth;
      if (!auth || auth.type !== 'oauth' || !['cimd', 'dcr'].includes(auth.client?.mode) || auth.client?.clientId) {
        fail(mcpWhere, 'declare OAuth with a cimd (or dcr) client and no client id');
      }
    }
  }
  // Codex exposes them as `stride:next` and `stride:done` (plugin name : skill name).
  checkSkills(pkg, ['next', 'done']);
  for (const name of ['next', 'done']) {
    const rel = `${pkg}/skills/${name}/agents/openai.yaml`;
    if (!existsSync(join(ROOT, rel)) || !/allow_implicit_invocation:\s*false/.test(readFileSync(join(ROOT, rel), 'utf8'))) {
      fail(rel, 'skills that write must turn off implicit invocation');
    }
  }

  const marketWhere = '.agents/plugins/marketplace.json';
  const market = readJson(marketWhere);
  if (market) {
    if (typeof market.name !== 'string' || !market.name) fail(marketWhere, 'name is required');
    for (const entry of market.plugins ?? []) {
      const path = typeof entry.source === 'string' ? entry.source : entry.source?.path;
      if (typeof entry.source === 'object' && entry.source.source !== 'local') fail(marketWhere, `plugin "${entry.name}" source must be local`);
      if (typeof path !== 'string' || !path.startsWith('./') || !insideRoot(path)) fail(marketWhere, `plugin "${entry.name}" path must start with ./ and stay inside the repository`);
      else {
        const target = readJson(`${path.slice(2)}/plugin.json`);
        if (target && target.name !== entry.name) fail(marketWhere, `entry "${entry.name}" does not match ${path}'s plugin.json name`);
      }
      if (!['AVAILABLE', 'INSTALLED_BY_DEFAULT', 'NOT_AVAILABLE'].includes(entry.policy?.installation)) fail(marketWhere, 'policy.installation is required');
      if (typeof entry.policy?.authentication !== 'string') fail(marketWhere, 'policy.authentication is required');
      if (typeof entry.category !== 'string' || !entry.category) fail(marketWhere, 'category is required');
    }
    if (!Array.isArray(market.plugins) || market.plugins.length === 0) fail(marketWhere, 'plugins must list the plugin');
  }
}

// ── Cursor ─────────────────────────────────────────────────────────────────
{
  const pkg = 'cursor';
  const where = `${pkg}/.cursor-plugin/plugin.json`;
  const manifest = readJson(where);
  if (manifest) {
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(manifest.name ?? '')) fail(where, 'name must be lowercase kebab-case');
    checkAuthor(where, manifest.author, { allowed: ['name', 'email'] });
    if (manifest.logo !== undefined && !(insideRoot(manifest.logo, pkg) && existsSync(join(ROOT, pkg, manifest.logo)))) {
      fail(where, 'logo must be a file inside the package');
    }
    for (const key of ['skills', 'commands', 'rules', 'agents', 'mcpServers', 'hooks']) {
      if (manifest[key] !== undefined) fail(where, `${key} would replace folder discovery; leave it out`);
    }
  }
  const mcp = readJson(`${pkg}/mcp.json`);
  const server = mcp?.mcpServers?.stride;
  if (!server) fail(`${pkg}/mcp.json`, 'mcpServers.stride is missing');
  else {
    if (server.url !== MCP_URL) fail(`${pkg}/mcp.json`, `url must be ${MCP_URL}`);
    for (const key of Object.keys(server)) if (key !== 'url') fail(`${pkg}/mcp.json`, `no "${key}": Cursor registers itself and signs the person in`);
  }
  checkSkills(pkg, ['stride-next', 'stride-done']);

  const marketWhere = '.cursor-plugin/marketplace.json';
  const market = readJson(marketWhere);
  if (market) {
    if (!KEBAB.test(market.name ?? '')) fail(marketWhere, 'name must be kebab-case');
    if (typeof market.owner?.name !== 'string') fail(marketWhere, 'owner.name is required');
    if (!Array.isArray(market.plugins) || market.plugins.length === 0) fail(marketWhere, 'plugins must list the plugin');
    for (const entry of market.plugins ?? []) {
      const source = typeof entry.source === 'string' ? entry.source : entry.source?.path;
      if (!insideRoot(source)) {
        fail(marketWhere, `plugin "${entry.name}" source must be a relative path inside the repository`);
        continue;
      }
      const target = readJson(`${source.replace(/^\.\//, '')}/.cursor-plugin/plugin.json`);
      if (target && target.name !== entry.name) fail(marketWhere, `entry "${entry.name}" does not match ${source}'s plugin.json name`);
    }
    if (Buffer.byteLength(readFileSync(join(ROOT, marketWhere))) > 10 * 1024 * 1024) fail(marketWhere, 'over 10 MB');
  }
}

// ── MCP Registry entry ─────────────────────────────────────────────────────
{
  const where = 'server.json';
  const s = readJson(where);
  if (s) {
    if (s.$schema !== 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json') fail(where, 'unexpected $schema');
    if (!/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(s.name ?? '') || !s.name.startsWith('page.stride/')) {
      fail(where, 'name must be page.stride/<name>: the namespace the stride.page DNS record verifies');
    }
    if (typeof s.description !== 'string' || s.description.length < 1 || s.description.length > 100) fail(where, 'description must be 1-100 characters');
    if (s.title !== undefined && (s.title.length < 1 || s.title.length > 100)) fail(where, 'title must be 1-100 characters');
    if (typeof s.version !== 'string' || /[\^~><*]|\.x$/.test(s.version)) fail(where, 'version must be an exact version');
    if (s.websiteUrl !== undefined && !isHttpsUrl(s.websiteUrl)) fail(where, 'websiteUrl must be a URL');
    if (s.repository && (!isHttpsUrl(s.repository.url) || typeof s.repository.source !== 'string')) fail(where, 'repository needs url and source');
    for (const icon of s.icons ?? []) {
      if (!isHttpsUrl(icon.src) || icon.src.length > 255) fail(where, 'icon src must be an https URL');
      if (icon.mimeType && !['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'].includes(icon.mimeType)) fail(where, 'icon mimeType');
      for (const size of icon.sizes ?? []) if (!/^(\d+x\d+|any)$/.test(size)) fail(where, `icon size "${size}"`);
    }
    const remotes = s.remotes ?? [];
    if (remotes.length !== 1 || remotes[0].type !== 'streamable-http' || remotes[0].url !== MCP_URL) {
      fail(where, `remotes must be the one streamable-http endpoint ${MCP_URL}`);
    }
    if (remotes[0]?.headers) fail(where, 'no headers: clients sign in with OAuth');
  }
}

// ── Every text file: LF and UTF-8 ──────────────────────────────────────────
function walk(rel) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(child));
    else out.push(child);
  }
  return out;
}
// Local-only files that .gitignore keeps out of the repository: the registry
// signing key, the publisher's session, macOS folder metadata.
const LOCAL_ONLY = /(^|\/)(\.DS_Store|\.mcpregistry_[^/]*|[^/]*\.pem)$/;
for (const rel of walk('')) {
  if (LOCAL_ONLY.test(rel)) continue;
  if (/\.(png|ico|jpg|jpeg|webp)$/i.test(rel)) continue;
  const bytes = readFileSync(join(ROOT, rel));
  if (bytes.includes(13)) fail(rel, 'CRLF line endings');
  if (bytes.length && bytes[bytes.length - 1] !== 10) fail(rel, 'no trailing newline');
}

if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`validate: ${errors.length} problem(s).`);
  process.exit(1);
}
console.log('validate: every package, marketplace and the registry entry pass.');
