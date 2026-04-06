Direct answer. Here’s the cleanest setup for what you’re building.

You want:

- Offline
- Executes NodeJS commands
- Understands structured instructions
- Handles Markdown well
- OCR if possible
- Persona layer (frog Jeeves assistant)
- Deterministic + safe execution

This is basically:

> Local LLM + Tool Router + Sandboxed Command Executor + Optional Vision/OCR Layer
