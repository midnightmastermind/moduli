If you're letting it run Node commands:

Create a whitelist:

Allowed:

- npm install
- node scripts/*
- file writes inside project directory

Blocked:

- rm -rf /
- system commands
- network calls (if you want isolation)

Example:

```js

const allowedCommands = ["npm install", "node", "touch", "mkdir"];

if (!allowedCommands.some(cmd => input.startsWith(cmd))) {

throw new Error("Command not allowed");

}

```

Even better:

Use a Docker container as execution sandbox.
