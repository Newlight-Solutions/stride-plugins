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
  checkSkills(pkg, ['stride-next', 'stride-done']);
  for (const name of ['stride-next', 'stride-done']) {
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
for (const rel of walk('')) {
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
