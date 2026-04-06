If you see any of these, stop and fix before adding new features:

1. Two functions doing the same thing (DRY violation)

2. A comment saying "legacy" or "backward compat" (broken window)

3. A socket event being emitted that has no server handler (dead code)

4. A reducer case updating only a derived array (state.containers) but not the source of truth (state.modules)

5. A "fallback" path that can never be hit in practice

6. A TODO that's been there for more than one session

7. A schema enum that includes values no longer used
