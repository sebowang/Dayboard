# Dayboard

Dayboard is a lightweight Windows desktop calendar and task board prototype. It is designed as a large, translucent desktop panel: the calendar stays visible most of the time, tasks can be edited directly from the calendar, and lower-frequency controls are tucked into settings.

## Current MVP Status

This repository currently contains an early local MVP prototype:

- Large calendar-first desktop board UI.
- OpenDesign-based desktop widget shell with month, week, and double-week views.
- Right-side day task drawer that stays collapsed until needed.
- Tasks and events shown directly inside calendar cells.
- Click an existing item to edit it.
- Click empty space in a day cell to create a task.
- Drag a task or event between days to reschedule it.
- Collapsible day task drawer.
- Settings for opacity, default widget mode, and fixed-window mode.
- Low-emphasis Gmail / Outlook account entry placeholder for the later sync phase.
- Local persistence with `localStorage` for tasks and settings.

Calendar account sync is not implemented yet. Google Calendar and Outlook sync are planned for later phases after the local desktop experience is stable.

## Project Layout

- `docs/` product docs, roadmap, decisions, and research.
- `notes/` technical notes and validation records.
- `assets/` design, bug, and reference assets.
- `code/` application source code, build files, and Tauri shell.

Source code should stay inside `code/`.

## Tech Stack

The current prototype uses:

- Tauri v2 shell configuration.
- React.
- TypeScript.
- Vite.
- `localStorage` for the first MVP persistence layer.

The intended later local data layer is SQLite, once the Tauri desktop shell is verified on Windows.

## Run The Web Prototype

From the repository root:

```powershell
cd code
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:1420/
```

Build check:

```powershell
cd code
npm run build
```

## Run The Tauri Desktop Shell

The Tauri shell is scaffolded, but this machine still needs the native Windows build toolchain before it can run:

- Rustup / Rust / Cargo: https://rustup.rs/
- Visual Studio Build Tools with MSVC and Windows SDK: https://aka.ms/vs/17/release/vs_BuildTools.exe

After those are installed:

```powershell
cd code
npm run tauri dev
```

Desktop behaviors that still need real-shell validation:

- Tray menu.
- Hide/show behavior.
- Transparent window.
- Fixed-to-desktop behavior.
- Skip-taskbar behavior.
- Window position and size persistence.

## Documentation

Start here:

- `docs/PRD.md`
- `docs/ROADMAP.md`
- `docs/DECISIONS.md`
- `docs/dayboard-design-spec-2026-06-06.md`
- `docs/OPEN_SOURCE_RESEARCH.md`
- `notes/windows-desktop-widget-notes.md`
- `notes/calendar-sync-notes.md`

## Privacy Direction

Dayboard should remain local-first. It should not collect calendar data by default, and future OAuth tokens or synced calendar data must use a secure storage strategy instead of plain text.
