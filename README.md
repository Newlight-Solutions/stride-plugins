# Stride plugins for Claude Code, Codex and Cursor

Work your [Stride](https://www.stride.page) backlog from your coding agent.
Two commands do the loop:

| | Claude Code | Codex | Cursor |
|---|---|---|---|
| Pick up your next story, with its full spec, and start it | `/stride:next` | `$stride-next` | `/stride-next` |
| Check it against its acceptance criteria and hand it back for review | `/stride:done` | `$stride-done` | `/stride-done` |

**Next** pulls the story a teammate staged for you with "Hand to your agent"
or, when nothing is staged, the top story assigned to you that is still to do
(the active sprint first, then by priority). You get its acceptance criteria,
linked designs and documents, relations and open defects in one call. It moves
the story to In Progress and sets up a branch named after its key. Name a key
(`/stride:next ORB-526`) to pick up a particular story.

**Done** runs your tests, checks every acceptance criterion against the
change, and moves the story to In Review with a comment saying what changed.
If a criterion is not met, it says what remains and leaves the status alone.
It asks before committing, and pushes only when you ask.

Every plugin connects your agent to Stride's MCP server,
`https://www.stride.page/api/mcp/stride`. **You sign in to Stride in your
browser the first time; there is no key to copy.** You choose the project the
agent works in and the projects it can reach, and you can disconnect it at any
time in Stride under Settings → Integrations → Connected apps. The agent
works with your own permissions in each project, and everything it writes is
labeled as your agent's.

## Claude Code

```bash
claude plugin marketplace add Newlight-Solutions/stride-plugins
claude plugin install stride@stride
```

Or, inside a session: `/plugin marketplace add Newlight-Solutions/stride-plugins`,
then `/plugin install stride@stride`.

Then run `/mcp`, select **plugin:stride:stride**, and choose **Authenticate**.
Your browser opens to sign in to Stride. After that, run `/stride:next`.

Prefer the server without the commands?

```bash
claude mcp add --transport http stride https://www.stride.page/api/mcp/stride
```

## Codex

```bash
codex plugin marketplace add Newlight-Solutions/stride-plugins
```

Then start `codex`, run `/plugins`, open **Stride** and install it. Codex asks
you to sign in to Stride when you install. Start a new session, then run
`$stride-next`.

## Cursor

Copy the [`cursor`](./cursor) folder to `~/.cursor/plugins/local/stride` and
run **Developer: Reload Window**. Once Stride is listed in the Cursor
Marketplace, you can install it there instead: open **Customize**, find
Stride, and select **Install**. Sign in when Cursor asks, then run
`/stride-next` in chat.

Prefer the server without the commands? Add it to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "stride": { "url": "https://www.stride.page/api/mcp/stride" }
  }
}
```

## Using an agent key instead

Headless runs (CI, `claude -p`, `codex exec`) cannot open a browser to sign in.
For those, create an agent key in Stride under Settings → Integrations and send
it as `Authorization: Bearer <key>`. Setup for each agent:
[Claude Code](https://www.stride.page/integrations/claude-code),
[Codex](https://www.stride.page/integrations/codex),
[Cursor](https://www.stride.page/integrations/cursor).

## This repository

- `claude-code/`, `codex/` and `cursor/` are the three packages, each in its
  agent's own format. They are generated: edit `source/` and run
  `npm run build`.
- `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json` and
  `.cursor-plugin/marketplace.json` are the marketplaces the install commands
  above read.
- `server.json` is Stride's entry in the
  [MCP Registry](https://registry.modelcontextprotocol.io).
- `npm run check` rebuilds nothing; it fails if a package has drifted from
  `source/` or breaks a rule its agent documents. CI runs it on every push.

Questions or problems: [info@newlightai.com](mailto:info@newlightai.com).
Licensed under the [MIT License](./LICENSE).
