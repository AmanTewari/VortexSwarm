# VortexSwarm Developer Docs

This folder explains how the project works for engineers who need to extend, test, or debug it.

## Documentation Tree

```txt
docs/
  README.md          -> Entry point + map of all docs
  architecture.md    -> Components and responsibilities
  runtime-flow.md    -> Startup, bot lifecycle, and command flow
  web-api.md         -> HTTP and Socket.IO contract
  debugging.md       -> Debug playbook and common failure cases
```

## Project Tree (Current)

```txt
VortexSwarm/
  README.md
  disclaimer.md
  package.json
  index.js
  accounts.json
  proxies.txt
  public/
    index.html
    styles.css
    app.js
  docs/
    README.md
    architecture.md
    runtime-flow.md
    web-api.md
    debugging.md
```

## Recommended Reading Order

1. architecture.md
2. runtime-flow.md
3. web-api.md
4. debugging.md

## Scope Notes

- Runtime logic is centralized in index.js.
- The web panel is static content served from public/.
- Real-time updates are pushed over Socket.IO.
- Bot actions are exposed through a command dispatcher.
