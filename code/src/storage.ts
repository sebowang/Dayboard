export type WidgetMode = "month" | "week" | "fortnight";
export type ThemeMode = "dark" | "light" | "system";
export type EffectiveTheme = "dark" | "light";
export type TaskState = "open" | "done";
export type ItemKind = "event" | "task";
export type CalendarName = "Local" | "Gmail" | "Outlook";
export type CalendarProvider = "local" | "google" | "outlook";
export type PinMode = "normal" | "desktop" | "top";

export type CalendarSource = {
  id: string;
  provider: CalendarProvider;
  remoteId?: string;
  name: string;
  accountLabel: string;
  color?: string;
  primary?: boolean;
  writable: boolean;
  visible: boolean;
};

export type DayboardItem = {
  id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  allDay?: boolean;
  kind: ItemKind;
  state: TaskState;
  calendar: CalendarName;
  calendarId?: string;
  calendarLabel?: string;
  calendarColor?: string;
  remoteId?: string;
  note: string;
};

export type DraftItem = Omit<DayboardItem, "id">;

export type SyncOptions = {
  calendar: boolean;
  tasks: boolean;
  mailEvents: boolean;
};

export type AppSettings = {
  widgetMode: WidgetMode;
  isGlanceOpen: boolean;
  opacity: number;
  pinMode: PinMode;
  themeMode: ThemeMode;
  desktopLocked: boolean;
  autoStart: boolean;
  mousePassthrough: boolean;
  syncOptions: SyncOptions;
};

export const STORAGE_KEYS = {
  items: "dayboard.items.v1",
  settings: "dayboard.settings.v5",
  calendars: "dayboard.calendars.v1",
} as const;

export const localCalendarSource: CalendarSource = {
  id: "local",
  provider: "local",
  name: "本地日历",
  accountLabel: "Dayboard",
  color: "#75d5e8",
  writable: true,
  visible: true,
};

export const defaultSettings: AppSettings = {
  widgetMode: "month",
  isGlanceOpen: false,
  opacity: 88,
  pinMode: "desktop",
  themeMode: "dark",
  desktopLocked: false,
  autoStart: false,
  mousePassthrough: false,
  syncOptions: { calendar: true, tasks: true, mailEvents: false },
};

export const seedItems: DayboardItem[] = [
  {
    id: "today-plan",
    title: "校准今日排期",
    date: "2026-07-04",
    start: "09:30",
    end: "10:00",
    kind: "event",
    state: "open",
    calendar: "Outlook",
    note: "确认桌面贴片 MVP 的优先级顺序。",
  },
  {
    id: "prototype-pass",
    title: "按 OpenDesign 重做主贴片",
    date: "2026-07-04",
    start: "11:00",
    end: "12:00",
    kind: "task",
    state: "open",
    calendar: "Local",
    note: "以 widget-main.html 为基础，而不是继续打磨旧界面。",
  },
  {
    id: "drawer-test",
    title: "验证当日任务抽屉",
    date: "2026-07-04",
    start: "15:30",
    end: "16:30",
    kind: "task",
    state: "open",
    calendar: "Local",
    note: "点击日期后展开右侧抽屉。",
  },
  {
    id: "weekly-review",
    title: "周中产品复盘",
    date: "2026-07-06",
    start: "10:30",
    end: "11:15",
    kind: "event",
    state: "open",
    calendar: "Gmail",
    note: "",
  },
  {
    id: "sync-research",
    title: "整理同步边界",
    date: "2026-07-07",
    start: "",
    end: "",
    kind: "task",
    state: "open",
    calendar: "Local",
    note: "OAuth、重复事件、全天事件、时区。",
  },
  {
    id: "archive-notes",
    title: "归档旧设计反馈",
    date: "2026-07-03",
    start: "",
    end: "",
    kind: "task",
    state: "done",
    calendar: "Local",
    note: "",
  },
];

/* ---- normalizers ---- */

const normalizeMode = (value: unknown): WidgetMode => {
  if (value === "week" || value === "fortnight" || value === "month") return value;
  return defaultSettings.widgetMode;
};

const normalizeTheme = (value: unknown): ThemeMode => {
  if (value === "dark" || value === "light" || value === "system") return value;
  return defaultSettings.themeMode;
};

/* ---- load ---- */

/**
 * Validate a loaded item shape — reject items missing required fields.
 * Guards against corrupted localStorage data.
 */
const isValidItem = (item: unknown): item is DayboardItem => {
  if (!item || typeof item !== "object") return false;
  const o = item as Record<string, unknown>;
  return (
    typeof o.id === "string" && o.id.length > 0 &&
    typeof o.title === "string" &&
    typeof o.date === "string" &&
    (o.kind === "event" || o.kind === "task") &&
    (o.state === "open" || o.state === "done") &&
    (o.calendar === "Local" || o.calendar === "Gmail" || o.calendar === "Outlook")
  );
};

const isValidCalendarSource = (source: unknown): source is CalendarSource => {
  if (!source || typeof source !== "object") return false;
  const value = source as Record<string, unknown>;
  return (
    typeof value.id === "string" && value.id.length > 0 &&
    (value.provider === "local" || value.provider === "google" || value.provider === "outlook") &&
    typeof value.name === "string" && value.name.length > 0 &&
    typeof value.accountLabel === "string" &&
    typeof value.writable === "boolean" &&
    typeof value.visible === "boolean"
  );
};

export const loadItems = (): DayboardItem[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.items);
    if (!raw) return seedItems;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return seedItems;
    const valid = parsed.filter(isValidItem);
    if (valid.length === 0) return seedItems;
    return valid as DayboardItem[];
  } catch {
    return seedItems;
  }
};

export const loadSettings = (): AppSettings => {
  try {
    let raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (raw) {
      // Migration complete — clean up old v2 key
      try { localStorage.removeItem("dayboard.settings.v2"); } catch { /* noop */ }
    } else {
      // Fall back to v2 key for legacy users
      raw = localStorage.getItem("dayboard.settings.v2");
    }
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    return {
      ...defaultSettings,
      ...parsed,
      widgetMode: normalizeMode(parsed.widgetMode ?? parsed.widgetModePreference),
      isGlanceOpen: Boolean(parsed.isGlanceOpen ?? parsed.isTaskPanelOpen),
      themeMode: normalizeTheme(parsed.themeMode),
      desktopLocked: Boolean(parsed.desktopLocked ?? defaultSettings.desktopLocked),
      autoStart: Boolean(parsed.autoStart ?? defaultSettings.autoStart),
      mousePassthrough: Boolean(parsed.mousePassthrough ?? defaultSettings.mousePassthrough),
      syncOptions: parsed.syncOptions && typeof parsed.syncOptions === "object"
        ? {
            calendar: Boolean((parsed.syncOptions as Record<string,unknown>).calendar ?? true),
            tasks: Boolean((parsed.syncOptions as Record<string,unknown>).tasks ?? true),
            mailEvents: Boolean((parsed.syncOptions as Record<string,unknown>).mailEvents ?? false),
          }
        : defaultSettings.syncOptions,
    } as AppSettings;
  } catch {
    return defaultSettings;
  }
};

export const loadCalendarSources = (): CalendarSource[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.calendars);
    if (!raw) return [localCalendarSource];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [localCalendarSource];
    const sources = parsed.filter(isValidCalendarSource);
    const remoteSources = sources.filter((source) => source.id !== localCalendarSource.id);
    const storedLocal = sources.find((source) => source.id === localCalendarSource.id);
    return [{ ...localCalendarSource, visible: storedLocal?.visible ?? true }, ...remoteSources];
  } catch {
    return [localCalendarSource];
  }
};

/* ---- save ---- */

export const saveItems = (items: DayboardItem[]): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.items, JSON.stringify(items));
  } catch (e) {
    console.error("[storage] saveItems failed:", e);
  }
};

export const saveSettings = (settings: AppSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  } catch (e) {
    console.error("[storage] saveSettings failed:", e);
  }
};

export const saveCalendarSources = (sources: CalendarSource[]): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.calendars, JSON.stringify(sources));
  } catch (e) {
    console.error("[storage] saveCalendarSources failed:", e);
  }
};

/* ---- reset ---- */

export const resetToSeedItems = (): DayboardItem[] => {
  localStorage.setItem(STORAGE_KEYS.items, JSON.stringify(seedItems));
  return seedItems;
};
