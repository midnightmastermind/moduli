import { describe, it, expect } from "vitest";

// D2 — Markdown shortcuts verify. The Editor mounts StarterKit (which carries
// the canonical markdown input rules for # heading, ## h2, ### h3, > blockquote,
// - / * bullet list, 1. ordered list, ``` code block, --- horizontal rule) plus
// the new TaskList + TaskListMarkdown for `- [ ] ` checklist syntax (D3/Q1
// shipped 2026-05-24).
//
// Rather than spin up a full ProseMirror editor in jsdom (heavy, brittle in
// CI), this test asserts the extension imports themselves exist + the names
// of the bundled nodes. If any markdown shortcut regresses, this test fails
// the moment someone removes/renames the underlying TipTap extension.

import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TaskListMarkdown } from "../docs/TaskListMarkdown";

function nodeNames(ext) {
  if (ext?.name) return [ext.name];
  if (Array.isArray(ext)) return ext.flatMap(nodeNames);
  return [];
}

describe("Editor markdown extensions (D2 verification)", () => {
  it("StarterKit ships the nodes that drive markdown shortcuts", () => {
    // StarterKit is itself an Extension with `addExtensions` config; the
    // bundled nodes are the source of the markdown input rules. We resolve
    // the bundled extensions via the kit's `addExtensions()` factory and
    // verify the expected markdown-shortcut-bearing names are present.
    const configured = StarterKit.configure({ heading: { levels: [1, 2, 3] } });
    expect(configured).toBeTruthy();
    expect(typeof configured.config.addExtensions).toBe("function");
    const bundled = configured.config.addExtensions.call({ ...configured, options: configured.options });
    const names = new Set((bundled || []).map(e => e?.name).filter(Boolean));
    for (const name of ["heading", "bulletList", "orderedList", "codeBlock", "blockquote", "horizontalRule"]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("TaskList + TaskItem extensions expose the canonical names", () => {
    expect(TaskList.name).toBe("taskList");
    expect(TaskItem.name).toBe("taskItem");
  });

  it("TaskListMarkdown is an Extension named taskListMarkdown", () => {
    expect(TaskListMarkdown.name).toBe("taskListMarkdown");
    // The extension declares an input rules contribution — that's what makes
    // typing `- [ ] ` auto-convert to a taskList. Without it, only TaskItem's
    // own `[ ] ` rule fires (which requires the user to already be inside a
    // list), and the user has to type `- ` first to make a bullet then `[ ]`
    // to convert. The seamless single-rule path lives in TaskListMarkdown.
    expect(typeof TaskListMarkdown.config.addInputRules).toBe("function");
  });
});
