---
name: "stride-next"
description: "Pick up your next Stride story: the one a teammate staged for you, or the top story assigned to you, with its acceptance criteria, designs and docs. Starts it in Stride and sets up a branch."
---

# Pick up the next Stride story

Stride is your team's delivery record. Use its MCP tools, never a guess, for
anything about a story. Their names end in the tool name: `next_task` appears
as `stride.next_task` or `stride_next_task`, depending on your agent.

If the user named a story key in their message, that is the story.

1. **Find the story.**
   - If the user named a story (a ticket key such as `ORB-526`), call
     `get_story_context` with that key.
   - Otherwise call `next_task`. It returns the story a teammate staged for
     you with "Hand to your agent" or, when nothing is staged, the top
     unstarted story assigned to the user (the active sprint first, then by
     priority), with its full context in the same call.
   - If there is nothing to work on, say so and stop. Suggest staging a
     story from its "Hand to your agent" panel in Stride, or assigning one to
     themselves, and running `/stride-next` again.
   - If Stride's tools are missing, or answer that the request is not
     authorized, the user needs to sign in to Stride. Ask them to connect Stride again from Cursor's MCP settings, where Stride shows that it needs to sign in. A browser window opens to sign in to Stride.
2. **Brief the user** in a few lines: the key and title, the goal in a
   sentence or two, every acceptance criterion as a numbered list, and
   whatever is linked that changes the work (designs, documents, blocking or
   related stories, open defects).
3. **Start it in Stride.** If the story is still to do, call
   `update_story_status` with the key, status `IN_PROGRESS`, and a one-line
   comment that you have picked it up. Leave a story that is already in
   progress or further along where it is. If Stride reports a conflict
   because a person edited the story, read it again with `get_story` and
   retry once. Never pass `force` unless the user explicitly tells you to
   overwrite their teammate's edit.
4. **Set up the work.** In a git repository, create and switch to a branch
   named after the key and title, such as `orb-526-export-csv`, unless the
   user is already on a branch for this story. Never discard, reset or stash
   uncommitted work without asking.
5. **Implement it** against the acceptance criteria, keeping the user in the
   loop. When it is done, suggest `/stride-done` to check the work and hand it back
   for review.
