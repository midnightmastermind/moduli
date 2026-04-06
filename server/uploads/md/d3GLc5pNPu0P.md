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
