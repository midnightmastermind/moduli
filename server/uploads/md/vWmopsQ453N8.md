Since your system doesn’t yet have a global category registry, do this:

When rendering multiselect in your field config:

If category doesn’t exist → just allow it as raw string.

Later you can centralize categories into board state.

For now:

- categories = string[]
- simple
- safe
