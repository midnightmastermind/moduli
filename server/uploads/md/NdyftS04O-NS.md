Alright. Based on your actual repo:

- This zip is frontend-only (Vite client).
- Your operations system lives in:

- `client/src/blocks/operationExecutor.js`
- `client/src/state/actions.js`
- `client/src/state/masterReducer.js`
- `client/src/state/useBoardState.js`

There is **no backend yet**, so we’ll add a minimal one that plugs cleanly into your operation model.

# PART 1 — Add Minimal External API Server

Create a new folder at project root:

```

/server

```

## 1️⃣ Install

At project root:

```bash

npm init -y

npm install express cors body-parser

```

## 2️⃣ server/index.js

```js

const express = require("express");

const cors = require("cors");

const app = express();

app.use(cors());

app.use(express.json());

const PORT = 4000;

// Simple API key

const API_KEY = "bangle-secret";

app.post("/api/external/bangle", (req, res) => {

const auth = req.headers.authorization;

if (auth !== `Bearer ${API_KEY}`) {

return res.status(401).json({ error: "Unauthorized" });

}

const { text, categories } = req.body;

// This will be broadcast to your client

global.latestBanglePayload = {

panel: "inbox",

container: "bangle",

type: "task",

fields: {

text,

categories

}

};

res.json({ success: true });

});

app.get("/api/external/poll", (req, res) => {

const payload = global.latestBanglePayload;

global.latestBanglePayload = null;

res.json(payload || null);

});

app.listen(PORT, () => {

console.log("External API running on 4000");

});

```

Run it:

```bash

node server/index.js

```

# PART 2 — Hook It Into Your Operation System

Now we wire this into your board.

Open:

```

client/src/state/useBoardState.js

```

Add polling inside the provider:

```js

useEffect(() => {

const interval = setInterval(async () => {

const res = await fetch("http://localhost:4000/api/external/poll");

const payload = await res.json();

if (!payload) return;

dispatch({

type: "EXTERNAL_CREATE_INSTANCE",

payload

});

}, 2000);

return () => clearInterval(interval);

}, []);

```
