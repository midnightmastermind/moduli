Alright. Based on your actual repo:

* This zip is frontend-only (Vite client).
* Your operations system lives in:

  * `client/src/blocks/operationExecutor.js`
  * `client/src/state/actions.js`
  * `client/src/state/masterReducer.js`
  * `client/src/state/useBoardState.js`

There is **no backend yet**, so we’ll add a minimal one that plugs cleanly into your operation model.

---

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

---

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

---

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

---

# PART 3 — Add Reducer Case

Open:

```
client/src/state/masterReducer.js
```

Add:

```js
case "EXTERNAL_CREATE_INSTANCE": {
  const { panel, container, fields } = action.payload;

  // Find panel
  const targetPanel = state.panels.find(p => p.name === panel);
  if (!targetPanel) return state;

  // Find container
  const targetContainer = targetPanel.containers.find(c => c.name === container);
  if (!targetContainer) return state;

  const newInstance = {
    id: crypto.randomUUID(),
    fields: {
      text: fields.text,
      categories: fields.categories || []
    }
  };

  targetContainer.instances.push(newInstance);

  return { ...state };
}
```

This matches your existing structure without touching your operations builder.

---

# PART 4 — Category Creation Logic

Since your system doesn’t yet have a global category registry, do this:

When rendering multiselect in your field config:

If category doesn’t exist → just allow it as raw string.

Later you can centralize categories into board state.

For now:

* categories = string[]
* simple
* safe

---

# PART 5 — Bangle.js App

Here’s a minimal Bangle.js app:

## app.js

```js
let text = "";
let categories = [];

function showKeyboard() {
  require("textinput").input().then(result => {
    if (!result) return;
    text = result;
    showCategoryMenu();
  });
}

function showCategoryMenu() {
  const menu = {
    "Work": () => toggleCategory("work"),
    "Personal": () => toggleCategory("personal"),
    "Idea": () => toggleCategory("idea"),
    "Send": sendData,
    "< Back": showKeyboard
  };

  E.showMenu(menu);
}

function toggleCategory(cat) {
  if (categories.includes(cat)) {
    categories = categories.filter(c => c !== cat);
  } else {
    categories.push(cat);
  }
  showCategoryMenu();
}

function sendData() {
  Bluetooth.println(JSON.stringify({
    type: "modulu_bangle",
    text,
    categories
  }));
  E.showAlert("Sent!");
}

showKeyboard();
```

---

# PART 6 — Android Side (Temporary Bridge)

Install Tasker.

Trigger:

* Event → BT Data Received

Then HTTP POST:

```
POST http://localhost:4000/api/external/bangle
Header:
Authorization: Bearer bangle-secret
Content-Type: application/json
```

Body:

```json
{
  "text": "%btdata.text",
  "categories": %btdata.categories
}
```

Now:

Watch → Bluetooth → Phone → Local server → Client poll → Instance appears in:

Panel: `inbox`
Container: `bangle`

---

# Clean Architecture Upgrade (Later)

When you're ready:

Instead of polling:

* Add WebSocket
* Bind to your existing `bindSocketToStore.js`
* Dispatch real operation instead of reducer mutation

That would fully integrate into your block/operation system.

---

# What This Gives You

You now have:

* External capture inbox
* Hardware-triggered instance creation
* Category multiselect
* Extensible event layer

---

If you want next level:

We can:

* Trigger real operation nodes from `operationExecutor.js`
* Auto-create panel/container if missing
* Add voice-to-text pipeline
* Turn Bangle into recurring habit tracker

Just tell me which direction.
