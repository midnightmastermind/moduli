// helpers/fieldTypes.js
//
// THE field type list, in one place.
//
// It was written out twice — FieldsTab.jsx (the editor a user actually picks
// from) and AssistantDrawer.jsx — and BOTH copies had drifted to eight, while
// `server/models/Field.js`'s enum has eleven. The three missing ones are real
// and in use: `address` powers the Location picker (2026-08-08), `markdown`
// carries rich text, and `button` runs an operation. A user could not create
// any of them, which also made the promotional site's "eleven kinds of value"
// untrue the moment it shipped.
//
// The server enum is the source of truth. `__tests__/fieldTypes.test.js` reads
// it out of the model file and fails if this list drifts from it again.
export const FIELD_TYPES = [
  "number",
  "text",
  "boolean",
  "select",
  "date",
  "rating",
  "duration",
  "occurrence",
  "markdown",
  "button",
  "address",
];

// Types whose stored value is a plain scalar the assistant can set directly.
// The assistant offers this narrower set on purpose: `occurrence` needs an id
// to point at, `button` runs something, and `address` is an object with
// coordinates — none of them is a value you can type into a chat box.
export const ASSISTANT_FIELD_TYPES = FIELD_TYPES.filter(
  (t) => !["occurrence", "button", "address"].includes(t)
);
