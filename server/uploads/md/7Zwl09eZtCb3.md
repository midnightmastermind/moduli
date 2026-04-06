Instead of letting it output raw commands, force it to output JSON like this:

```json

{

"tool": "create_file",

"args": {

"path": "components/FrogPanel.jsx",

"content": "..."

}

}

```

or

```json

{

"tool": "run_command",

"args": {

"command": "npm install axios"

}

}

```

Then your Node backend:

```js

if (tool === "create_file") {

fs.writeFileSync(path, content);

}

```

This is how you avoid it going rogue.
