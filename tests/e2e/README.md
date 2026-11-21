# E2E full-chain tests

Runs the real app (built `desktop/` bundle) under Xvfb against:

- **fake-adb-server.mjs** — a protocol-level fake ADB server (adb wire protocol
  on `:5037`): device discovery, `track-devices` change pushes, v1 shell with
  the real CRLF mangling, byte-exact `screencap` PNGs, sync push (yadb upload),
  `reconnect offline`. Controlled via HTTP on `:5038` (state flips, call log).
- **fake-adb-bin/** — fake `adb` / `scrcpy` CLIs on PATH so the app's
  child-process code paths (`adb reconnect offline`) are exercised too.
- **mock-llm-server.mjs** — OpenAI-compatible API on `:5039` (models list,
  streaming + non-streaming chat, scripted tool_calls) with a control API on
  `:5040` to inject response scripts and inspect every request (vision
  round-trips, conversation continuity).
- **run-e2e.mjs** — boots everything + Electron (`--remote-debugging-port`),
  drives the UI through CDP the way a user would (typing, buttons, windows,
  IPC) and asserts 33 checks across boot, config persistence, Copilot tool
  loops + vision, context auto-compaction, scheduled agent tasks (session
  continuity, unlimited steps) and phantom-offline self-healing.

## Usage

```bash
cd desktop && pnpm install && pnpm build   # produces dist/ + dist-electron/
cd .. && node tests/e2e/run-e2e.mjs        # Xvfb required (headless display)
```

`smoke-fake-adb.mjs` is a fast protocol-only check of the fake server against
the real bundled adbkit client (no Electron needed).
