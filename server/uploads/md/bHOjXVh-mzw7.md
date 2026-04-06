Install Tasker.

Trigger:

- Event → BT Data Received

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
