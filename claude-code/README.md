# Stride for Claude Code

Work your Stride backlog from your coding agent: pick up your next story with its acceptance criteria, designs and docs, and hand it back for review when it is done.

- `/stride:next` picks up your next story and starts it.
- `/stride:done` checks it against its acceptance criteria and hands it back for review.

It connects Claude Code to Stride's MCP server, `https://www.stride.page/api/mcp/stride`. You sign in to Stride in your browser; there is no key to copy.

## Install

```bash
claude plugin marketplace add Newlight-Solutions/stride-plugins
claude plugin install stride@stride
```

Or, in a session on Claude Code 2.1.275 or later: `/plugin install stride --marketplace Newlight-Solutions/stride-plugins`.

Signing in and the rest of the setup: the [repository README](../README.md) and https://www.stride.page/integrations/claude-code.
