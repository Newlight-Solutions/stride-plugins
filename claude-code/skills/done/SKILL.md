---
name: "done"
description: "Finish the Stride story you are working on: check it against its acceptance criteria, record what changed, and move it to In Review."
argument-hint: "[story key]"
disable-model-invocation: true
---

# Finish the current Stride story

Stride is your team's delivery record. Use its MCP tools to read and update
the story. Their names end in the tool name: `update_story_status` appears as
`stride.update_story_status` or `stride_update_story_status`, depending on
your agent.

Story the user named, if any: `$ARGUMENTS`

1. **Find the story**: the ticket key the user named; else the story you
   picked up in this conversation; else the key in the current git branch
   name (`orb-526-export-csv` is `ORB-526`); else ask. Read it with
   `get_story_context` so you have its acceptance criteria. If Stride's tools
   are missing or not authorized, ask the user to run `/mcp`, select the Stride server (`plugin:stride:stride`), and choose Authenticate (Re-authenticate if it was signed in before). A browser window opens to sign in to Stride.
2. **Check the work.** Run the repository's own tests and linters for the
   code you changed. If anything fails, report it and stop, unless the user
   tells you to go on.
3. **Check every acceptance criterion** against the change, and list each as
   met, or not met with the reason.
4. **Commit, if the user wants it.** If the changes are not committed yet,
   ask whether to commit them; if yes, commit on the story's branch with a
   message that starts with the key (`ORB-526: ...`). Push and open a pull
   request only when the user asks for it. When GitHub is connected to
   Stride, a branch or pull request whose name contains the key links to the
   story by itself.
5. **Record it in Stride.**
   - Every criterion met: call `update_story_status` with the key, status
     `IN_REVIEW`, and a comment that says what changed, which tests you ran,
     and the pull request URL if there is one.
   - Some not met: leave the status as it is, add a comment to the story
     with `create_comment` (entity type `story`) saying what is done and what
     remains, and ask the user how to go on.
   If Stride reports a conflict because a person edited the story, read it
   again with `get_story` and retry once. Never pass `force` without the
   user's explicit approval.
6. **Tell the user where the story stands**, with its key. To pick up the
   next one, they can run `/stride:next`.
