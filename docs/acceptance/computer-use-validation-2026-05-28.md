# Computer Use Validation - 2026-05-28

**Time:** 2026-05-28 16:35:15 CST

**Target:** `http://127.0.0.1:5173/`

**Tool:** Computer Use against Safari on macOS.

## Observed Flow

- Opened the local web console in Safari.
- Computer Use read the login screen with:
  - `Managed Agents Login`
  - `Provider`
  - `Email`
  - `Name`
  - `Sign in`
- Clicked `Sign in` through Computer Use.
- Computer Use confirmed the authenticated Quickstart console with:
  - left navigation for Quickstart, Agents, Sessions, Environments, Credential vaults, Memory, Skills, Templates, Users, Model gateway, Artifacts
  - template buttons
  - prompt composer
  - config preview panel
- Clicked `Templates` through Computer Use and confirmed:
  - Templates table rendered
  - `New template` button visible
  - rows with `ui-e2e-updated` template category visible
  - right-side template detail panel visible
- Clicked `Skills` through Computer Use and confirmed:
  - Skills table rendered
  - `New skill` and `Scan ~/.agents/skills` buttons visible
  - skill file tree visible
  - `SKILL.md` editor and `Save` button visible
- Clicked `Sessions` through Computer Use. One click returned a transient ScreenCaptureKit stream error, but the next `get_app_state` confirmed the Sessions page was active with:
  - session list
  - `Transcript`, `Debug`, and `All events`
  - event rows for status/user events
  - event detail panel
  - bottom chat composer and send button

## Result

PASS with note: Computer Use interaction was able to operate and inspect Safari, but one click emitted `Computer Use server error -10005` / ScreenCaptureKit stream capture failure. The subsequent state read succeeded and verified the Sessions page, so the GUI validation evidence is usable for visual/navigation acceptance but the screen-capture subsystem is not perfectly stable.
