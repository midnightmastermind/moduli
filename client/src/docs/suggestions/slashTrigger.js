// docs/suggestions/slashTrigger.js — where a typed "/" may open the command palette.
// Only where a command can start: the start of a line, or after whitespace. Inside a
// word ("zucchini/peppers", "and/or") a slash is text — opening the palette there left
// it sitting on "No commands found" and it swallowed the next Enter.

/** @param {string} textBefore the text of the current block before the caret */
export function slashOpensPalette(textBefore) {
  return textBefore === "" || /\s$/.test(textBefore);
}
