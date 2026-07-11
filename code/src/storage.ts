export type WidgetMode = "month" | "week" | "fortnight";
export type ThemeMode = "dark" | "light" | "system";
export type EffectiveTheme = "dark" | "light";
export type TaskState = "open" | "done";
export type ItemKind = "event" | "task";
export type CalendarName = "Local" | "Gmail" | "Outlook";
export type PinMode = "normal" | "desktop" | "top";

export type DayboardItem = {
  id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  kind: ItemKind;
  state: TaskState;
  calendar: CalendarName;
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
} as const;

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
  if (value === "biweek") return "fortnight";
  return defaultSettings.widgetMode;
};

const normalizeTheme = (value: unknown): ThemeMode => {
  if (value === "dark" || value === "light" || value === "system") return value;
  return defaultSettings.themeMode;
};

/* ---- load ---- */

export const loadItems = (): DayboardItem[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.items);
    if (!raw) return seedItems;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DayboardItem[]) : seedItems;
  } catch {
    return seedItems;
  }
};

export const loadSettings = (): AppSettings => {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEYS.settings) ??
      localStorage.getItem("dayboard.settings.v2");
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

/* ---- reset ---- */

export const resetToSeedItems = (): DayboardItem[] => {
  localStorage.setItem(STORAGE_KEYS.items, JSON.stringify(seedItems));
  return seedItems;
};
