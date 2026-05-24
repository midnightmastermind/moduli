// docs/TaskListMarkdown.js
// Adds markdown-style input rules so typing `- [ ] ` / `- [x] ` / `* [ ] ` / `+ [ ] `
// at the start of a paragraph converts that paragraph into a taskList > taskItem.
// Seamless replacement — no separate keyboard shortcut needed. Mirrors how
// StarterKit's BulletList rule wraps `- ` into a bullet list.

import { Extension, InputRule } from "@tiptap/core";

const TASK_MARKER = /^\s*([-+*])\s+\[([ xX])\]\s$/;

export const TaskListMarkdown = Extension.create({
  name: "taskListMarkdown",

  addInputRules() {
    return [
      new InputRule({
        find: TASK_MARKER,
        handler: ({ state, range, match, chain }) => {
          const { schema, tr } = state;
          const taskListType = schema.nodes.taskList;
          const taskItemType = schema.nodes.taskItem;
          if (!taskListType || !taskItemType) return null;

          const checked = match[2] === "x" || match[2] === "X";
          const $from = state.doc.resolve(range.from);
          const parent = $from.parent;
          if (parent.type.name !== "paragraph") return null;

          // Strip the matched marker text from the paragraph; whatever the user
          // already typed after the marker (rare but possible) stays in place.
          tr.delete(range.from, range.to);

          // Wrap the now-empty paragraph in taskItem > taskList.
          const blockRange = tr.doc.resolve(tr.mapping.map(range.from)).blockRange();
          if (!blockRange) return null;

          // Build a taskList containing one taskItem(checked) wrapping the paragraph.
          // ReplaceAroundStep via wrap() lifts the paragraph into the new structure.
          const wrap = [{ type: taskListType }, { type: taskItemType, attrs: { checked } }];
          tr.wrap(blockRange, wrap);
        },
      }),
    ];
  },
});

export default TaskListMarkdown;
