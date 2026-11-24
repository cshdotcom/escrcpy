---
title: Embedded mirror & key mapping
---

# Embedded mirror & key mapping

The embedded mirror renders the device screen inside an Escrcpy window instead of a native scrcpy window, which makes it possible to overlay keyboard mappings, always-on-top and fullscreen. Video is hardware-decoded with WebCodecs; audio is played through Web Audio.

## Opening

1. Find the device in the device list
2. Click the "more" (＋) button on the row
3. Choose "Embedded mirror"

The window remembers its previous size and position. The header shows the device name, resolution, fps, audio toggle, key mapping, always-on-top, fullscreen and close.

## Input

- **Mouse / touch**: left button drags a touch pointer; multi-touch is supported (each pointer maps to its own contact)
- **Wheel**: scrolls the device; with a "scroll" mapping enabled it becomes a pinch gesture
- **Keyboard**: physical keys map to Android key events; text (Chinese, emoji, …) is injected as text
- **Esc**: back; the clipboard is synced to the device when the window gains focus
- **Right click**: back (in edit mode it adds a mapping instead)

## Keyboard mapping

Open the mapping panel with the grid icon in the header, then switch modes at the top of the panel:

| Mode | Description |
| --- | --- |
| Off | No mappings, plain touch only |
| Edit | Right-click the picture to add mappings, drag nodes, tune parameters |
| Play | Pressing a bound key triggers its mapped gesture |

### Adding a mapping

1. Switch to "Edit"
2. Right-click the picture → a tap mapping is created there
3. Select it, click "Bind key" and press a key combination (Esc cancels)
4. Pick the mapping type and adjust its parameters below

Supported types: tap, swipe, rapid tap, scroll (wheel → pinch), joystick (WASD directions inside a radius), view control (mouse look) and macro (run an existing automation workflow, with a loop count).

### Profiles

Mappings are stored per device in profiles. Use the panel header to create / duplicate / delete profiles; import / export uses JSON files so mappings can move between machines.

## Visual workflow editor

"Tasks → Workflows → New workflow" is now a node canvas:

- Start → steps → End, connected automatically
- Drag nodes to reposition; drop a node onto another to insert it at that position
- Zoom / fit / auto-layout toolbar; Ctrl + wheel zooms, drag the background to pan
- The inspector on the right edits the selected step (AI / action / delay)
- Shortcuts: Delete removes the selected step, Ctrl + D duplicates it

## Web UI

With the web UI enabled, a new "Mirror" tab lets you pick a device and connect. The stream is pushed over SSE and decoded by the browser's WebCodecs; touch, keyboard, wheel, clipboard and key mappings (tap mappings + key binding) are supported. The tasks page also renders each workflow as a visual chain with a one-click run button.
