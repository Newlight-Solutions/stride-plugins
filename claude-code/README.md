# Stride for Claude Code

Work your Stride backlog from your coding agent: pick up your next story with its acceptance criteria, designs and docs, and hand it back for review when it is done.

- `/stride:next` picks up your next story and starts it.
- `/stride:done` checks it against its acceptance criteria and hands it back for review.

It connects Claude Code to Stride's MCP server, `https://www.stride.page/api/mcp/stride`. You sign in to Stride in your browser; there is no key to copy.

## What it does

- It adds one MCP server, Stride's, at `https://www.stride.page/api/mcp/stride`. You sign in to Stride with OAuth in your browser, and the agent acts with your Stride permissions in the projects you allow.
- `/stride:next` reads your next story from Stride, moves it to In Progress with a short comment if it is still to do, and, in a git repository, creates a branch named after it.
- `/stride:done` runs your repository's own tests and linters and checks the work against the story's acceptance criteria. When every criterion is met, it moves the story to In Review with a comment saying what changed; otherwise it comments what remains. It commits only when you say so, and pushes or opens a pull request only when you ask.
- Both run only when you invoke them. The plugin has no hooks and no scripts of its own, and its only connection is to Stride through that server.

## Install

```bash
claude plugin marketplace add Newlight-Solutions/stride-plugins
claude plugin install stride@stride
```

Or, in a session on Claude Code 2.1.275 or later: `/plugin install stride --marketplace Newlight-Solutions/stride-plugins`.

Signing in and the rest of the setup: the [repository README](https://github.com/Newlight-Solutions/stride-plugins#readme) and https://www.stride.page/integrations/claude-code.
