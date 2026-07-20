# Dayboard Feature Gap Analysis

Date: 2026-07-12 | Compared against: TickTick, Google Calendar, Fantastical, Rainlendar

---

## 1. Reference App Feature Matrix

| Feature | TickTick | GCal | Fantastical | Rainlendar |
|---|---|---|---|---|
| Recurring events | yes | yes | yes | yes |
| Notification reminders | yes | yes | yes | yes |
| Multi-calendar toggle | yes | yes | yes | yes |
| Search | yes | yes | yes | -- |
| Keyboard shortcuts | yes | yes | yes | yes |
| Right-click context menu | yes | yes | yes | yes |
| Task priority/tags | yes | -- | -- | -- |
| Natural language input | yes | yes | yes | -- |
| ICS import/export | -- | yes | yes | yes |
| Day view | yes | yes | yes | yes |
| Today quick-jump | yes | yes | yes | yes |
| Event color coding | yes | yes | yes | -- |
| Offline indicator | yes | yes | yes | -- |
| Sync status indicator | yes | yes | yes | yes |
| Task reorder within day | yes | -- | -- | -- |
| Data export/backup | yes | yes | -- | yes |

---

## 2. P0 -- MVP Blocker

Literally unusable for daily calendar-driven workflow without these.

### 2.1 Multi-calendar selection (show/hide specific Google calendars)

The sync module in `sync/google.ts` hardcodes `calendars/primary/events`. Users with
work + personal + shared calendars only see one. `listCalendars()` is implemented but
never wired to a calendar-picker UI.

**Every reference app has this.** TickTick toggles per account calendar; Google Calendar
uses sidebar checkboxes; Fantastical groups them into calendar sets; Rainlendar shows
per-calendar visibility controls on the main surface.

### 2.2 Recurring event support in the local model

Google sync uses `singleEvents: true`, so recurring events *display* correctly when
pulled from Google. But `DayboardItem` in `storage.ts` has no recurrence fields (rule,
exceptions, until-date, count). Users cannot create "every Monday at 10am" locally.
When bidirectional sync arrives (Milestone 4), the model will silently drop recurrence
rules on roundtrip.

**All four reference apps** support full recurring event creation with rule-based
recurrence (RRULE + exceptions).

### 2.3 Notification reminders

A calendar widget that never alerts you is purely passive. `DayboardItem` lacks any
`reminder` or `alert` field. For a Tauri desktop app, `tauri-plugin-notification`
would be the natural path to Windows native toasts.

**TickTick**: time + location reminders. **Google Calendar**: email + popup with
custom lead time (5 min / 15 min / 1 hr / custom). **Fantastical**: native macOS
notifications with snooze. **Rainlendar**: alarm popups configurable per event.

### 2.4 Search

No search input exists in the UI. With 50+ events spanning months, finding a
specific item by scrolling is impractical. No full-text index exists on items.

**TickTick**: full-text across tasks and events with filters. **Google Calendar**:
instant search with autocomplete. **Fantastical**: menu bar search with natural
language interpretation.


---

## 3. P1 -- MVP Polish

The app works without these, but every user will immediately notice the gap.

### 3.1 Keyboard shortcuts

Zero keyboard navigation. No `Space` to open selected event, no `ArrowLeft/Right`
to navigate weeks, no `T` for today, no `N` for new task, no `Escape` to close
editor, no `Ctrl+F` for search.

**All four reference apps** have extensive keyboard shortcut systems. Google Calendar
shows all shortcuts when pressing `?`.

### 3.2 Right-click context menu on calendar cells

Right-clicking a date cell does nothing. Users who spend hours in a calendar widget
expect Delete, Edit, Mark Done, New Task from a right-click.

**All four reference apps** provide rich context menus. Rainlendar (most similar
product to Dayboard): right-click -> New Event, Edit, Delete, Go to Today.

### 3.3 Today quick-jump button

If the user navigates months away, there is no one-click way to return to today.
Must manually click backward through months using the `<` navigation button.

**All four reference apps** have a "Today" button always visible in the header.

### 3.4 Sync status and offline indicator

When Google sync is connected, there is zero indication of last sync time, whether
the last sync succeeded or failed, or whether the user is currently offline. The
OAuth log exists in localStorage but is never surfaced as UI state.

**Google Calendar**: offline banner, "Last synced" timestamp. **TickTick**: sync
spinner with error/retry states. **Rainlendar**: calendar refresh indicator.

### 3.5 Day view

Month, week, and fortnight views exist, but no single-day detailed view. A user
with 8+ events on one day has no way to see them all clearly -- the month cell
truncates after a few lines, and the glance drawer shows tasks inline without a
time-structured layout.

**Google Calendar**: schedule + day + 4-day views. **Fantastical**: DayTicker +
full day view. **Rainlendar**: day view with hourly grid.

### 3.6 Delete confirmation and undo

Deleting a task is instant and permanent -- no confirmation dialog, no undo toast.
The drag-to-reschedule operation also has no undo path. Accidental deletions are
unrecoverable.

**TickTick**: undo toast after delete. **Google Calendar**: trash bin with 30-day
recovery window.


---

## 4. P2 -- Nice to Have

Quality-of-life features that distinguish mature calendar apps.

### 4.1 Task priority and color coding

All tasks look identical. No high/medium/low priority levels, no tag colors,
no visual distinction between urgent items and casual notes. `DayboardItem` in
`storage.ts` has no `priority` field.

**TickTick**: 4 priority levels (red/orange/blue/gray) with tags. **Google Calendar**:
calendar-level and event-level color assignment.

### 4.2 Natural language date/time input

Creating a task requires manually filling separate date and time fields. Typing
"Friday 3pm design review" should parse automatically into date + time + title.

**TickTick**: NLP date parsing on text input. **Google Calendar**: parses
"Lunch Friday 2pm" into a properly timed event. **Fantastical**: industry-leading
natural language parsing that handles complex expressions.

### 4.3 ICS calendar subscription and import/export

No way to subscribe to holiday calendars, sports schedules, or external ICS feeds.
No way to export Dayboard data for backup or migration to another tool. The
impending localStorage-to-SQLite migration has no data portability plan.

**Google Calendar**: import ICS, subscribe by URL. **Fantastical**: Interesting
Calendars subscription library. **Rainlendar**: ICS import/export via file and URL.

### 4.4 Task reordering within a day

Tasks appear in creation order inside the glance drawer. No drag-to-reorder, no
manual sort by priority, no alphabetical sort. `DayboardItem` has no `sortOrder` field.

**TickTick**: drag-to-reorder, auto-sort by priority, manual sort options.

### 4.5 Multiple time zone support

Hardcoded to `Asia/Shanghai` in `sync/google.ts` (the `timeZone` parameter on all
API calls). Events from other time zones will display at wrong local times. Users
who travel or collaborate across zones are silently affected.

**Google Calendar**: primary + secondary time zone display. **Fantastical**:
per-event time zone with world clock and floating-time-zone support.

### 4.6 Outlook / Microsoft Graph readiness

`CalendarName` includes `"Outlook"` as a type variant in `storage.ts`, but no
OAuth flow, no token storage, and no Microsoft Graph API module exists. The type
is purely cosmetic. This blocks Milestone 4.

**TickTick**: full Outlook/Exchange calendar sync. **Rainlendar**: Outlook
calendar integration via MAPI.

### 4.7 Inline time editing on calendar grid

To change an event's time, the user must open the full editor modal. No
click-and-drag on event edge to resize duration, no click-and-drag to move to
a different time slot within the same day.

**Google Calendar**: drag event edges to resize, drag body to move to different
time. **Fantastical**: drag to reschedule.

### 4.8 Data backup and export path

Current data lives in localStorage with no export mechanism. `localStorage.clear()`
loses everything. The ROADMAP.md mentions a future SQLite migration but there is
no export-to-JSON or import-from-JSON path documented.

**TickTick**: cloud backup + local export. **Rainlendar**: ICS export for events,
config backup.


---

## 5. Summary Matrix

| Gap | Pri | TickTick | GCal | Fantastical | Rainlendar |
|---|---|---|---|---|---|
| Multi-calendar selection | P0 | yes | yes | yes | yes |
| Recurring events (local model) | P0 | yes | yes | yes | yes |
| Notification reminders | P0 | yes | yes | yes | yes |
| Search | P0 | yes | yes | yes | -- |
| Keyboard shortcuts | P1 | yes | yes | yes | yes |
| Right-click context menu | P1 | yes | yes | yes | yes |
| Today quick-jump | P1 | yes | yes | yes | yes |
| Sync/offline status indicator | P1 | yes | yes | yes | yes |
| Day view | P1 | yes | yes | yes | yes |
| Delete confirmation / undo | P1 | yes | yes | -- | -- |
| Task priority / color coding | P2 | yes | yes | -- | -- |
| Natural language date input | P2 | yes | yes | yes | -- |
| ICS subscription / export | P2 | -- | yes | yes | yes |
| Task reorder within day | P2 | yes | -- | -- | -- |
| Multiple time zone support | P2 | -- | yes | yes | -- |
| Outlook Graph readiness | P2 | yes | -- | -- | yes |
| Inline time editing on grid | P2 | -- | yes | yes | -- |
| Data backup / export path | P2 | yes | yes | -- | yes |

---

## 6. Recommended Implementation Order

### First (P0 batch)
1. **Multi-calendar picker UI** -- wire the existing `listCalendars()` to a
   settings-panel checkbox list. Lowest-effort P0 because the API layer exists.
2. **Recurring event model** -- add `recurrence_rule`, `recurrence_exceptions`,
   `recurrence_until` to `DayboardItem`. Needed before bidirectional sync.
3. **Search** -- regex/filter-based search over items[] with a header input.
   Lightweight start; upgrade to full-text index later.
4. **Notification reminders** -- `tauri-plugin-notification` for Windows native
   toasts. Requires a reminder field on the data model and a background check timer.

### Second (P1 batch)
5. **Keyboard shortcuts** -- low-effort, high-impact. Wire `useEffect` keydown
   listeners for navigation, create, close, and today.
6. **Right-click context menu** -- `onContextMenu` handlers on calendar cells
   and task bars.
7. **Today button** -- one button in the header, always visible.
8. **Sync status indicator** -- surface `isGoogleConnected()`, last sync
   timestamp, and error state in a small header chip.
9. **Day view** -- new layout variant showing a single-day timeline/agenda.
10. **Delete confirmation** -- confirm dialog or 3-second undo toast.

### Third (P2 batch)
11. Task priority + color coding on the data model and UI.
12. ICS subscription support (URL-based calendar import).
13. Natural language input for the quick-create field.
14. Data export (JSON dump) before the SQLite migration.
15. Defer Outlook until Google sync is fully stable through Milestone 3-4.

---

## 7. Notes on Methodology

- Rainlendar is the closest comparator: it is also a Windows desktop calendar
  widget with transparency, pinning, and Google Calendar sync.
- Fantastical is included because it sets the gold standard for interaction
  quality (natural language, keyboard-first, DayTicker) that a desktop widget
  should aspire to.
- TickTick is the user's stated reference for "lightweight TickTick experience"
  per PRD.md. Its task+calendar unification and Windows widget are direct
  comparison points.
- Google Calendar web is included as the baseline for what users expect from
  any calendar interface.

This analysis was compiled from training-data knowledge of all four apps, Dayboard's
own source code (App.tsx, storage.ts, sync/google.ts), and project docs (PRD.md,
ROADMAP.md, MVP_ACCEPTANCE.md, DECISIONS.md, OPEN_SOURCE_RESEARCH.md).
