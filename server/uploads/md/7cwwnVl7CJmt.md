Do NOT let the model directly execute Node commands.

You want this pattern:

```

User → LLM → Structured Tool Output → Tool Router → Node Executor → Result → LLM → Response

```

This prevents chaos.
