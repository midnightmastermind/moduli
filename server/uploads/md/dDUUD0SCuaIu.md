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
