import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Link2,
  ListFilter,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { open } from "@tauri-apps/plugin-shell";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { DragEvent, FormEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AppSettings, type CalendarName, type CalendarSource, type DayboardItem, type DraftItem, type EffectiveTheme, type ItemKind, type PinMode, type TaskState, type ThemeMode, type WidgetMode, defaultSettings, loadCalendarSources, loadItems, loadSettings, localCalendarSource, resetToSeedItems, saveCalendarSources, saveItems, saveSettings } from "./storage";

import { getAuthUrl, handleAuthCallback, isGoogleConnected, disconnectGoogle, fetchCalendarEvents, listCalendars, createGoogleEvent, updateGoogleEvent, deleteGoogleEvent, getGoogleEvent, moveGoogleEvent } from "./sync/google";
import { clearReminderDeliveries, getDueReminders, loadReminderDeliveries, saveReminderDeliveries, type ReminderDelivery } from "./reminders";
import { isTauriRuntime } from "./tauri-runtime";
type EditorState =
  | { mode: "create"; draft: DraftItem }
  | { mode: "edit"; id: string; draft: DraftItem }
  | null;
type DragPayload = {
  itemId: string;
};

const GOOGLE_SYNC_INTERVAL_MS = 60_000;

type PointerDragState = {
  itemId: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  width: number;
};

type DragPreviewState = {
  item: DayboardItem;
  x: number;
  y: number;
  width: number;
} | null;

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date"; version: string }
  | { kind: "available"; version: string; url: string }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };


const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const APP_VERSION = "0.1.0";
const UPDATE_API_URL = "https://api.github.com/repos/sebowang/Dayboard/releases/latest";

const toneClass: Record<CalendarName, string> = {
  Local: "source-local",
  Gmail: "source-gmail",
  Outlook: "source-outlook",
};

const calendarFallbackColors = ["#6ea8fe", "#75d5e8", "#8fd19e", "#f0b86e", "#d49bf0", "#f08f8f"];

const getCalendarFallbackColor = (id: string) => {
  const hash = Array.from(id).reduce((value, character) => value + character.charCodeAt(0), 0);
  return calendarFallbackColors[hash % calendarFallbackColors.length];
};

const compareVersions = (left: string, right: string) => {
  const leftParts = left.replace(/^v/, "").split(".").map(Number);
  const rightParts = right.replace(/^v/, "").split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const todayKey = formatDateKey(new Date());

const parseDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const getMonday = (date: Date) => {
  const next = new Date(date);
  const offset = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - offset);
  return next;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getMonthDates = (monthDate: Date) => {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monday = getMonday(firstOfMonth);
  return Array.from({ length: 42 }, (_, index) => addDays(monday, index));
};

const getRangeDates = (selectedDate: string, length: number) => {
  const monday = getMonday(parseDateKey(selectedDate));
  return Array.from({ length }, (_, index) => addDays(monday, index));
};

const formatMonthTitle = (date: Date) =>
  date.toLocaleString("en-US", { month: "long", year: "numeric" });

const formatPeriodLabel = (dateKey: string) => {
  const date = parseDateKey(dateKey);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
  });
};

const formatItemTime = (item: DayboardItem | DraftItem) => {
  if (item.kind === "event" && item.allDay) return "全天";
  if (item.start && item.end) return `${item.start} - ${item.end}`;
  if (item.start) return item.start;
  return item.kind === "event" ? "全天" : "TASK";
};

const emptyDraft = (date: string): DraftItem => ({
  title: "",
  date,
  start: "",
  end: "",
  allDay: false,
  kind: "task",
  state: "open",
  calendar: "Local",
  calendarId: "local",
  calendarLabel: "本地日历",
  calendarColor: localCalendarSource.color,
  note: "",
});



const getSystemTheme = (): EffectiveTheme =>
  window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";



async function hideWindow() {
  try {
    const [{ getCurrentWindow }, { saveWindowState, StateFlags }] =
      await Promise.all([
        import("@tauri-apps/api/window"),
        import("@tauri-apps/plugin-window-state"),
      ]);

    await saveWindowState(StateFlags.ALL);
    await getCurrentWindow().hide();
  } catch {
    window.alert("桌面窗口模式下会隐藏到托盘。");
  }
}

async function applyWindowBehavior(mode: PinMode, locked: boolean) {
  try {
    const appWindow = getCurrentWindow();
    const run = (action: Promise<void>) => action.catch(() => undefined);
    await Promise.all([
      run(appWindow.setAlwaysOnTop(mode === "top")),
      run(appWindow.setAlwaysOnBottom(mode === "desktop")),
      run(appWindow.setSkipTaskbar(mode === "desktop")),
      run(appWindow.setResizable(!locked)),
    ]);
  } catch {
    return;
  }
}

function App() {
  const [initialSettings] = useState<AppSettings>(loadSettings);
  const [widgetMode, setWidgetMode] = useState<WidgetMode>(initialSettings.widgetMode);
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [currentMonth, setCurrentMonth] = useState(() => parseDateKey(todayKey));
  const [boardItems, setBoardItems] = useState<DayboardItem[]>(loadItems);
  const [editor, setEditor] = useState<EditorState>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"accounts" | "widget">("widget");
  const [isGlanceOpen, setIsGlanceOpen] = useState(initialSettings.isGlanceOpen);
  const [isCalendarPanelOpen, setIsCalendarPanelOpen] = useState(false);
  const [calendarSources, setCalendarSources] = useState<CalendarSource[]>(loadCalendarSources);
  const [opacity, setOpacity] = useState(initialSettings.opacity);
  const [pinMode, setPinMode] = useState<PinMode>(initialSettings.pinMode);
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialSettings.themeMode);
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>(
    initialSettings.themeMode === "system" ? getSystemTheme() : initialSettings.themeMode,
  );
  const [desktopLocked, setDesktopLocked] = useState(initialSettings.desktopLocked);
  const [autoStart, setAutoStart] = useState(initialSettings.autoStart);
  const [mousePassthrough, setMousePassthrough] = useState(initialSettings.mousePassthrough);
  const [syncing, setSyncing] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);
  const [retryMessage, setRetryMessage] = useState("");
  const [syncOptions, setSyncOptions] = useState(initialSettings.syncOptions);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState>(null);
  const [updateState, setUpdateState] = useState<UpdateState>({ kind: "idle" });
  const dragClickGuardUntil = useRef(0);
  const pointerDrag = useRef<PointerDragState | null>(null);
  const oauthHandled = useRef(false);
  const syncInFlight = useRef(false);
  const reminderDeliveries = useRef<ReminderDelivery>(loadReminderDeliveries());

  const monthDates = useMemo(() => getMonthDates(currentMonth), [currentMonth]);
  const weekDates = useMemo(() => getRangeDates(selectedDate, 7), [selectedDate]);
  const fortnightDates = useMemo(() => getRangeDates(selectedDate, 14), [selectedDate]);
  const monthTitle = useMemo(() => formatMonthTitle(currentMonth), [currentMonth]);

  const primaryGoogleSource = useMemo(
    () => calendarSources.find((source) => source.provider === "google" && source.primary),
    [calendarSources],
  );
  const visibleCalendarIds = useMemo(
    () => new Set(calendarSources.filter((source) => source.visible).map((source) => source.id)),
    [calendarSources],
  );
  const itemsByDate = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const visibleItems = boardItems.filter((item) => {
      const sourceId = item.calendar === "Local"
        ? "local"
        : item.calendar === "Gmail"
          ? `google:${item.calendarId ?? primaryGoogleSource?.remoteId ?? "primary"}`
          : `outlook:${item.calendarId ?? "default"}`;
      return visibleCalendarIds.has(sourceId);
    });
    const source = q
      ? visibleItems.filter((item) => item.title.toLowerCase().includes(q))
      : visibleItems;
    const grouped = new Map<string, DayboardItem[]>();
    source.forEach((item) => {
      grouped.set(item.date, [...(grouped.get(item.date) ?? []), item]);
    });
    grouped.forEach((items) => items.sort((a, b) => a.start.localeCompare(b.start)));
    return grouped;
  }, [boardItems, primaryGoogleSource, searchQuery, visibleCalendarIds]);

  const selectedItems = itemsByDate.get(selectedDate) ?? [];

  const showNotice = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2200);
  }, []);

  const ensureNotificationPermission = useCallback(async () => {
    try {
      if (await isPermissionGranted()) return true;
      const permission = await requestPermission();
      if (permission === "granted") return true;
      showNotice("未获得系统通知权限，提醒不会弹出。");
    } catch {
      showNotice("无法请求系统通知权限，请在 Windows 设置中检查通知权限。");
    }
    return false;
  }, [showNotice]);

  const checkForUpdates = useCallback(async () => {
    setUpdateState({ kind: "checking" });
    try {
      const response = await fetch(UPDATE_API_URL, { headers: { Accept: "application/vnd.github+json" } });
      if (response.status === 404) {
        setUpdateState({ kind: "unavailable" });
        return;
      }
      if (!response.ok) throw new Error(`检查服务返回 ${response.status}`);
      const release = await response.json() as { tag_name?: string; html_url?: string };
      const version = release.tag_name?.replace(/^v/, "");
      if (!version || !release.html_url) throw new Error("发布信息不完整");
      setUpdateState(compareVersions(version, APP_VERSION) > 0
        ? { kind: "available", version, url: release.html_url }
        : { kind: "up-to-date", version });
    } catch (error) {
      setUpdateState({ kind: "error", message: error instanceof Error ? error.message : "无法连接更新服务" });
    }
  }, []);

  const syncGoogleCalendars = useCallback(async (announce = false) => {
    if (!googleConnected) {
      if (announce) showNotice("请先连接 Google 日历再同步。");
      return;
    }
    if (syncInFlight.current) return;

    syncInFlight.current = true;
    setSyncing(true);
    try {
      const calendars = await listCalendars();
      const googleSources: CalendarSource[] = calendars.map((calendar) => ({
        id: `google:${calendar.id}`,
        provider: "google",
        remoteId: calendar.id,
        name: calendar.summary || (calendar.primary ? "主日历" : "未命名日历"),
        accountLabel: "Google",
        color: calendar.backgroundColor || getCalendarFallbackColor(calendar.id),
        primary: calendar.primary,
        writable: calendar.accessRole === "owner" || calendar.accessRole === "writer",
        visible: true,
      }));

      setCalendarSources((current) => {
        const visibility = new Map(current.map((source) => [source.id, source.visible]));
        const local = current.find((source) => source.id === "local") ?? localCalendarSource;
        return [
          local,
          ...googleSources.map((source) => ({
            ...source,
            visible: visibility.get(source.id) ?? true,
          })),
          ...current.filter((source) => source.provider === "outlook"),
        ];
      });

      const rangeStart = new Date();
      rangeStart.setHours(0, 0, 0, 0);
      rangeStart.setDate(rangeStart.getDate() - 7);
      const rangeEnd = new Date();
      rangeEnd.setHours(0, 0, 0, 0);
      rangeEnd.setDate(rangeEnd.getDate() + 37);
      const events = await fetchCalendarEvents(
        rangeStart.toISOString(),
        rangeEnd.toISOString(),
        calendars.map((calendar) => calendar.id),
      );
      const calendarNames = new Map(calendars.map((calendar) => [calendar.id, calendar.summary]));
      const calendarColors = new Map(calendars.map((calendar) => [
        calendar.id,
        calendar.backgroundColor || getCalendarFallbackColor(calendar.id),
      ]));
      const imported: DayboardItem[] = events
        .filter((event) => event.status !== "cancelled")
        .map((event) => {
          const date = event.start?.date
            ? event.start.date
            : event.start?.dateTime?.slice(0, 10) ?? todayKey;
          const calendarId = event.calendarId ?? "primary";
          return {
            id: `gcal-${encodeURIComponent(calendarId)}-${event.id}`,
            remoteId: event.id,
            title: event.summary || "(无标题)",
            date,
            start: event.start?.date ? "" : event.start?.dateTime?.slice(11, 16) ?? "",
            end: event.start?.date ? "" : event.end?.dateTime?.slice(11, 16) ?? "",
            allDay: Boolean(event.start?.date),
            kind: "event" as const,
            state: "open" as const,
            calendar: "Gmail" as const,
            calendarId,
            calendarLabel: event.calendarSummary || calendarNames.get(calendarId) || "Google 日历",
            calendarColor: calendarColors.get(calendarId),
            note: event.description ?? "",
          };
        });

      setBoardItems((current) => [
        ...current.filter((item) => item.calendar !== "Gmail"),
        ...imported,
      ]);
      setGoogleConnected(true);
      setRetryMessage("");
      if (announce) showNotice(`已同步 ${calendars.length} 个日历、${imported.length} 条日程。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRetryMessage(`同步失败：${message}`);
      if (announce) showNotice(`同步失败：${message}`);
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
    }
  }, [googleConnected, showNotice]);

  useEffect(() => {
    saveItems(boardItems);
  }, [boardItems]);

  useEffect(() => {
    let disposed = false;
    const deliverDueReminders = async () => {
      try {
        if (!await isPermissionGranted()) return;
        const dueReminders = getDueReminders(boardItems, reminderDeliveries.current);
        if (!dueReminders.length) return;
        const deliveries = { ...reminderDeliveries.current };
        dueReminders.forEach(({ item, key, triggerAt }) => {
          sendNotification({
            title: item.title,
            body: item.allDay ? "今天的全天日程" : `${item.start} 开始`,
          });
          deliveries[key] = triggerAt;
        });
        if (!disposed) {
          reminderDeliveries.current = deliveries;
          saveReminderDeliveries(deliveries);
        }
      } catch {
        // A failed native notification should not interrupt the calendar UI.
      }
    };
    void deliverDueReminders();
    const timer = window.setInterval(() => void deliverDueReminders(), 30_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [boardItems]);

  useEffect(() => {
    saveCalendarSources(calendarSources);
  }, [calendarSources]);

  useEffect(() => {
    saveSettings({
      widgetMode,
      isGlanceOpen,
      opacity,
      pinMode,
      themeMode,
      desktopLocked,
      autoStart,
      mousePassthrough,
      syncOptions,
    });
  }, [widgetMode, isGlanceOpen, opacity, pinMode, themeMode, desktopLocked, autoStart, mousePassthrough, syncOptions]);

  useEffect(() => {
    void applyWindowBehavior(pinMode, desktopLocked);
  }, [pinMode, desktopLocked]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void isAutostartEnabled().then(setAutoStart).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!googleConnected) return;
    void syncGoogleCalendars(false);
    const interval = window.setInterval(() => void syncGoogleCalendars(false), GOOGLE_SYNC_INTERVAL_MS);
    const syncOnFocus = () => void syncGoogleCalendars(false);
    window.addEventListener("focus", syncOnFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", syncOnFocus);
    };
  }, [googleConnected, syncGoogleCalendars]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // Clean up pointer capture on unmount
  useEffect(() => {
    return () => {
      if (pointerDrag.current?.active) {
        try {
          const el = document.elementFromPoint(pointerDrag.current.startX, pointerDrag.current.startY);
          if (el && "releasePointerCapture" in el) {
            (el as HTMLElement).releasePointerCapture(pointerDrag.current.pointerId);
          }
        } catch { /* best-effort */ }
      }
    };
  }, []);

  useEffect(() => {
    if (themeMode !== "system") {
      setEffectiveTheme(themeMode);
      return;
    }

    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const syncTheme = () => setEffectiveTheme(getSystemTheme());
    syncTheme();
    media?.addEventListener("change", syncTheme);
    return () => media?.removeEventListener("change", syncTheme);
  }, [themeMode]);

  const completeGoogleAuthCallback = useCallback(async (url: string) => {
    if (oauthHandled.current) return;
    oauthHandled.current = true;

    try {
      const parsed = new URL(url);
      const error = parsed.searchParams.get("error");
      const code = parsed.searchParams.get("code");
      if (error) throw new Error(`Google 返回授权错误：${error}`);
      if (!code) throw new Error("授权回调缺少 code 参数。");

      await handleAuthCallback(url);
      setGoogleConnected(true);
      showNotice("Google 日历已连接。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showNotice("授权失败：" + message);
    } finally {
      setGoogleConnecting(false);
    }
  }, [showNotice]);

  useEffect(() => {
    void isGoogleConnected().then(setGoogleConnected).catch(() => {
      setGoogleConnected(false);
      showNotice("无法读取已保存的 Google 授权，请重新连接。" );
    });
    const currentUrl = window.location.href;
    if (currentUrl.includes("oauth/google/callback")) void completeGoogleAuthCallback(currentUrl);

    let unlisten: (() => void) | undefined;
    if (isTauriRuntime()) {
      void listen<string>("google-oauth-callback", (event) => {
        void completeGoogleAuthCallback(event.payload);
      }).then((stopListening) => { unlisten = stopListening; });
    }
    return () => unlisten?.();
  }, [completeGoogleAuthCallback]);

  useEffect(() => {
    if (!googleConnecting) return;
    const timeout = window.setTimeout(() => {
      oauthHandled.current = true;
      if (isTauriRuntime()) void invoke("cancel_google_oauth_listener").catch(() => undefined);
      setGoogleConnecting(false);
      showNotice("Google 授权超时，已恢复为可重新连接状态。");
    }, 5 * 60 * 1000);
    return () => window.clearTimeout(timeout);
  }, [googleConnecting, showNotice]);

  const setDraftValue = <Key extends keyof DraftItem>(key: Key, value: DraftItem[Key]) => {
    setEditor((current) => {
      if (!current) return current;
      return { ...current, draft: { ...current.draft, [key]: value } };
    });
  };

  const setDraftReminder = async (minutes: number | undefined) => {
    if (minutes !== undefined && !await ensureNotificationPermission()) return;
    setDraftValue("reminderMinutes", minutes);
  };

  const setDraftCalendar = (sourceId: string) => {
    const source = calendarSources.find((calendar) => calendar.id === sourceId);
    if (!source) return;
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        draft: {
          ...current.draft,
          calendar: source.provider === "google" ? "Gmail" : source.provider === "outlook" ? "Outlook" : "Local",
          calendarId: source.remoteId ?? source.id,
          calendarLabel: source.name,
          calendarColor: source.color,
        },
      };
    });
  };

  const selectDate = (dateKey: string, openDrawer = false) => {
    setSelectedDate(dateKey);
    setCurrentMonth(parseDateKey(dateKey));
    if (openDrawer) setIsGlanceOpen(true);
  };

  const openCreate = (date = selectedDate) => {
    selectDate(date, false);
    setEditor({ mode: "create", draft: emptyDraft(date) });
  };

  const openEdit = (item: DayboardItem) => {
    const { id, ...draft } = item;
    selectDate(item.date, false);
    setEditor({
      mode: "edit",
      id,
      draft: {
        ...draft,
        allDay: item.kind === "event" ? item.allDay ?? (!item.start && !item.end) : false,
      },
    });
  };

  const handleCloseEditor = () => {
    if (!editor) return;
    if (editor.draft.title.trim() && !window.confirm("关闭将丢弃未保存的内容，确定吗？")) return;
    setEditor(null);
  };

  const saveDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || !editor.draft.title.trim()) { if (editor && !editor.draft.title.trim()) showNotice("\u6807\u9898\u4e0d\u80fd\u4e3a\u7a7a\u3002"); return; }

    let draft = { ...editor.draft, title: editor.draft.title.trim() };
    if (draft.kind === "event") {
      if (!draft.start && !draft.end) {
        draft = { ...draft, allDay: true };
      } else if (!draft.start || !draft.end) {
        showNotice("请同时填写开始和结束时间，或开启全天。");
        return;
      } else if (draft.end <= draft.start) {
        showNotice("结束时间需要晚于开始时间。");
        return;
      }
    }

    if (editor.mode === "create") {
      let item: DayboardItem = {
        id: `item-${crypto.randomUUID()}`,
        ...draft,
      };

      if (item.calendar === "Gmail") {
        if (!googleConnected) {
          showNotice("请先连接 Google 日历。");
          return;
        }
        try {
          const googleId = await createGoogleEvent({
            calendarId: item.calendarId ?? "primary",
            title: item.title,
            date: item.date,
            start: item.start || undefined,
            end: item.end || undefined,
            allDay: item.allDay,
            note: item.note || undefined,
          });
          item = {
            ...item,
            id: `gcal-${encodeURIComponent(item.calendarId ?? "primary")}-${googleId}`,
            remoteId: googleId,
          };
        } catch (error) {
          showNotice("Google 同步失败: " + (error as Error).message);
          return;
        }
      }

      setBoardItems((current) => [...current, item]);
      selectDate(item.date, false);
    } else {
      const existing = boardItems.find((item) => item.id === editor.id);
      if (!existing) return;
      let updatedItem: DayboardItem = { id: editor.id, ...draft };

      if ((existing.calendar === "Gmail" || draft.calendar === "Gmail") && !googleConnected) {
        showNotice("修改 Google 日程前请先连接账号。");
        return;
      }

      try {
        if (existing.calendar === "Gmail" && existing.remoteId) {
          const sourceCalendarId = existing.calendarId ?? "primary";
          if (draft.calendar === "Gmail") {
            const targetCalendarId = draft.calendarId ?? "primary";
            let targetRemoteId = existing.remoteId;
            if (targetCalendarId !== sourceCalendarId) {
              try {
                await moveGoogleEvent(sourceCalendarId, targetCalendarId, existing.remoteId);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const movedEvent = await getGoogleEvent(targetCalendarId, existing.remoteId).catch(() => null);
                if (movedEvent) {
                  targetRemoteId = movedEvent.id;
                } else {
                  if (!message.includes("cannotChangeOrganizer")) throw error;
                  const shouldCopy = window.confirm(
                    "这是一条由他人组织的邀请副本，Google 不允许直接迁移。是否在目标日历创建独立副本，并从原日历移除当前副本？参会人和会议邀请关系不会保留。",
                  );
                  if (!shouldCopy) return;
                  targetRemoteId = await createGoogleEvent({
                    calendarId: targetCalendarId,
                    title: draft.title,
                    date: draft.date,
                    start: draft.start || undefined,
                    end: draft.end || undefined,
                    allDay: draft.allDay,
                    note: draft.note || undefined,
                  });
                  try {
                    await deleteGoogleEvent(sourceCalendarId, existing.remoteId);
                  } catch (deleteError) {
                    await deleteGoogleEvent(targetCalendarId, targetRemoteId).catch(() => undefined);
                    throw deleteError;
                  }
                }
              }
            }
            await updateGoogleEvent(targetCalendarId, targetRemoteId, {
              title: draft.title,
              date: draft.date,
              start: draft.start || undefined,
              end: draft.end || undefined,
              allDay: draft.allDay,
              note: draft.note || undefined,
            });
            updatedItem = {
              ...updatedItem,
              id: `gcal-${encodeURIComponent(targetCalendarId)}-${targetRemoteId}`,
              remoteId: targetRemoteId,
            };
          } else {
            await deleteGoogleEvent(sourceCalendarId, existing.remoteId);
            updatedItem = { ...updatedItem, id: `item-${crypto.randomUUID()}`, remoteId: undefined };
          }
        } else if (draft.calendar === "Gmail") {
          const targetCalendarId = draft.calendarId ?? "primary";
          const googleId = await createGoogleEvent({
            calendarId: targetCalendarId,
            title: draft.title,
            date: draft.date,
            start: draft.start || undefined,
            end: draft.end || undefined,
            allDay: draft.allDay,
            note: draft.note || undefined,
          });
          updatedItem = {
            ...updatedItem,
            id: `gcal-${encodeURIComponent(targetCalendarId)}-${googleId}`,
            remoteId: googleId,
          };
        } else {
          updatedItem = { ...updatedItem, remoteId: undefined };
        }
      } catch (error) {
        showNotice("日历迁移失败: " + (error as Error).message);
        return;
      }

      setBoardItems((current) => current.map((item) => item.id === editor.id ? updatedItem : item));
      selectDate(draft.date, false);
    }

    setEditor(null);
  };

  const deleteItem = () => {
    if (!editor || editor.mode !== "edit") return;
    const itemId = editor.id;
    const item = boardItems.find((i) => i.id === itemId);
    setBoardItems((current) => current.filter((i) => i.id !== itemId));
    setEditor(null);

    // Delete from Google for Gmail-sourced items
    if (item?.calendar === "Gmail" && item.remoteId && googleConnected) {
      deleteGoogleEvent(item.calendarId ?? "primary", item.remoteId).catch((err: Error) =>
        showNotice("Google " + err.message)
      );
    }
  };

  const toggleDone = (id: string) => {
    setBoardItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, state: item.state === "done" ? "open" : "done" }
          : item,
      ),
    );
  };

  const moveMonth = (offset: number) => {
    setCurrentMonth((current) => {
      const next = new Date(current);
      next.setMonth(current.getMonth() + offset);
      return next;
    });
  };

  const movePeriod = (direction: -1 | 1) => {
    if (widgetMode === "month") {
      moveMonth(direction);
      return;
    }

    const days = widgetMode === "week" ? 7 : 14;
    const nextDate = formatDateKey(addDays(parseDateKey(selectedDate), direction * days));
    selectDate(nextDate, false);
  };

  const moveItemToDate = (itemId: string, nextDate: string) => {
    setBoardItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, date: nextDate } : item)),
    );
    // Don't jump the view in month mode — just update items.
    // In week/fortnight mode the user is focused on a narrow window so we follow.
    if (widgetMode === "week" || widgetMode === "fortnight") {
      selectDate(nextDate, false);
    } else {
      setSelectedDate(nextDate);
    }
  };

  const beginDragItem = (event: DragEvent<HTMLElement>, itemId: string) => {
    const payload: DragPayload = { itemId };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/dayboard-item", JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", itemId);
    dragClickGuardUntil.current = Date.now() + 250;
    setDraggingItemId(itemId);
  };

  const endDragItem = () => {
    dragClickGuardUntil.current = Date.now() + 250;
    setDraggingItemId(null);
    setDropTargetDate(null);
  };

  const allowDropOnDate = (event: DragEvent<HTMLElement>, dateKey: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetDate(dateKey);
  };

  const dropItemOnDate = (event: DragEvent<HTMLElement>, dateKey: string) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData("application/dayboard-item");
    try {
      const payload = JSON.parse(raw) as DragPayload;
      if (payload.itemId) moveItemToDate(payload.itemId, dateKey);
    } catch {
      // Ignore drag payloads from outside Dayboard.
    }
    endDragItem();
  };

  const getDateKeyFromPoint = (x: number, y: number) => {
    const target = document.elementFromPoint(x, y);
    return target?.closest<HTMLElement>("[data-date-key]")?.dataset.dateKey ?? null;
  };

  const beginPointerDragItem = (event: PointerEvent<HTMLElement>, item: DayboardItem) => {
    if (event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerDrag.current = {
      itemId: item.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      width: Math.min(Math.max(bounds.width, 160), 260),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePointerDragItem = (event: PointerEvent<HTMLElement>) => {
    const state = pointerDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;

    const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
    if (!state.active && distance < 6) return;

    if (!state.active) {
      state.active = true;
      setDraggingItemId(state.itemId);
      const item = boardItems.find((candidate) => candidate.id === state.itemId);
      if (item) {
        setDragPreview({
          item,
          x: event.clientX,
          y: event.clientY,
          width: state.width,
        });
      }
      dragClickGuardUntil.current = Date.now() + 300;
    } else {
      setDragPreview((current) => current && { ...current, x: event.clientX, y: event.clientY });
    }

    event.preventDefault();
    setDropTargetDate(getDateKeyFromPoint(event.clientX, event.clientY));
  };

  const finishPointerDragItem = (event: PointerEvent<HTMLElement>) => {
    const state = pointerDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;

    if (state.active) {
      event.preventDefault();
      const targetDate = getDateKeyFromPoint(event.clientX, event.clientY) ?? dropTargetDate;
      if (targetDate) moveItemToDate(state.itemId, targetDate);
      dragClickGuardUntil.current = Date.now() + 300;
    }

    pointerDrag.current = null;
    setDraggingItemId(null);
    setDropTargetDate(null);
    setDragPreview(null);
  };

  const cancelPointerDragItem = (event: PointerEvent<HTMLElement>) => {
    const state = pointerDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    pointerDrag.current = null;
    dragClickGuardUntil.current = Date.now() + 300;
    setDraggingItemId(null);
    setDropTargetDate(null);
    setDragPreview(null);
  };

  const resetLocalData = () => {
    setBoardItems(resetToSeedItems());
    clearReminderDeliveries();
    reminderDeliveries.current = {};
    setWidgetMode(defaultSettings.widgetMode);
    setIsGlanceOpen(defaultSettings.isGlanceOpen);
    setOpacity(defaultSettings.opacity);
    setPinMode(defaultSettings.pinMode);
    setThemeMode(defaultSettings.themeMode);
    setDesktopLocked(defaultSettings.desktopLocked);
    setAutoStart(defaultSettings.autoStart);
    setMousePassthrough(defaultSettings.mousePassthrough);
    setSyncOptions(defaultSettings.syncOptions);
    setCalendarSources([localCalendarSource]);
    setIsCalendarPanelOpen(false);
    setGoogleConnected(false);
    void disconnectGoogle();
    setSelectedDate(todayKey);
    setCurrentMonth(parseDateKey(todayKey));
    showNotice("已恢复示例数据，已断开 Google 连接");
  };

  const openAccountSettings = () => {
    setSettingsTab("accounts");
    setShowSettings(true);
  };

  const connectGoogle = async () => {
    setGoogleConnecting(true);
    oauthHandled.current = false;
    try {
      if (isTauriRuntime()) await invoke("start_google_oauth_listener");
      const authUrl = await getAuthUrl();
      if (isTauriRuntime()) {
        await open(authUrl);
      } else {
        window.location.href = authUrl;
      }
    } catch (err) {
      showNotice("无法启动 Google 授权: " + (err as Error).message);
      setGoogleConnecting(false);
    }
  };

  const cancelGoogleConnection = () => {
    oauthHandled.current = true;
    if (isTauriRuntime()) void invoke("cancel_google_oauth_listener").catch(() => undefined);
    setGoogleConnecting(false);
    showNotice("已取消 Google 授权，可重新连接。");
  };

  const toggleAutoStart = async () => {
    const next = !autoStart;
    try {
      if (isTauriRuntime()) {
        if (next) await enableAutostart();
        else await disableAutostart();
        setAutoStart(await isAutostartEnabled());
      } else {
        setAutoStart(next);
      }
      showNotice(next ? "已设置为登录 Windows 后自动启动。" : "已关闭开机启动。");
    } catch (error) {
      showNotice("无法更新开机启动：" + (error instanceof Error ? error.message : String(error)));
    }
  };

  const disconnectGoogleAccount = () => {
    void disconnectGoogle();
    setGoogleConnected(false);
    setCalendarSources((current) => current.filter((source) => source.provider !== "google"));
    setBoardItems((current) => current.filter((item) => item.calendar !== "Gmail"));
    showNotice("Google 日历已断开。");
  };

  const showLockedWindowHint = () => {
    showNotice("窗口已锁定，可在设置里关闭“锁定窗口”后拖动。");
  };

  const getItemCalendarColor = (item: DayboardItem | DraftItem) => {
    if (item.calendarColor) return item.calendarColor;
    const sourceId = item.calendar === "Local"
      ? "local"
      : item.calendar === "Gmail"
        ? `google:${item.calendarId ?? primaryGoogleSource?.remoteId ?? "primary"}`
        : `outlook:${item.calendarId ?? "default"}`;
    return calendarSources.find((source) => source.id === sourceId)?.color
      ?? (item.calendar === "Local" ? "#75d5e8" : item.calendar === "Gmail" ? "#f0b86e" : "#748ff7");
  };

  const renderItemChip = (item: DayboardItem, compact = false) => (
    <button
      key={item.id}
      type="button"
      draggable={false}
      className={`task-pill ${toneClass[item.calendar]} ${item.state === "done" ? "is-done" : ""} ${
        draggingItemId === item.id ? "is-dragging" : ""
      }`}
      style={{ "--calendar-color": getItemCalendarColor(item) } as React.CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        if (Date.now() < dragClickGuardUntil.current) {
          event.preventDefault();
          return;
        }
        openEdit(item);
      }}
      onPointerDown={(event) => beginPointerDragItem(event, item)}
      onPointerMove={movePointerDragItem}
      onPointerUp={finishPointerDragItem}
      onPointerCancel={cancelPointerDragItem}
      title={item.title}
    >
      {!compact && (item.start || item.kind === "task") && <span>{item.start || "TASK"}</span>}
      {item.title}
    </button>
  );

  const renderCalendarCell = (date: Date, options: { monthCell?: boolean } = {}) => {
    const dateKey = formatDateKey(date);
    const dateItems = itemsByDate.get(dateKey) ?? [];
    const inMonth = date.getMonth() === currentMonth.getMonth();
    const isSelected = dateKey === selectedDate;
    const isToday = dateKey === todayKey;
    const cellClass = [
      "calendar-cell",
      options.monthCell ? "calendar-cell--month" : "calendar-cell--week",
      options.monthCell && !inMonth ? "calendar-cell--muted" : "",
      isToday ? "calendar-cell--today" : "",
      isSelected ? "calendar-cell--selected" : "",
      dropTargetDate === dateKey ? "calendar-cell--drop-target" : "",
    ].filter(Boolean).join(" ");
    const openCreateFromBlank = (event: React.MouseEvent<HTMLElement>) => {
      if (Date.now() < dragClickGuardUntil.current) return;
      const target = event.target as HTMLElement;
      if (target.closest(".calendar-cell__head, .task-pill")) return;
      openCreate(dateKey);
    };

    return (
      <article
        key={dateKey}
        data-date-key={dateKey}
        className={cellClass}
        onClick={openCreateFromBlank}
        onDragOver={(event) => allowDropOnDate(event, dateKey)}
        onDragLeave={() => setDropTargetDate((current) => (current === dateKey ? null : current))}
        onDrop={(event) => dropItemOnDate(event, dateKey)}
      >
        <button
          type="button"
          className="calendar-cell__head"
          onClick={() => selectDate(dateKey, true)}
          aria-label={`${date.getMonth() + 1} 月 ${date.getDate()} 日`}
        >
          <span className="calendar-cell__day">
            {options.monthCell ? date.getDate() : `${date.getMonth() + 1}/${date.getDate()}`}
          </span>
          <small>{dateItems.length ? `${dateItems.length} 项` : ""}</small>
        </button>
        <div className="calendar-cell__tasks">
          {dateItems.map((item) => renderItemChip(item, options.monthCell))}
        </div>
        <button
          type="button"
          className="blank-create"
          onClick={(event) => {
            event.stopPropagation();
            openCreate(dateKey);
          }}
          aria-label={`${date.getMonth() + 1} 月 ${date.getDate()} 日新增任务`}
        />
      </article>
    );
  };

  return (
    <main
      className={`desktop-stage theme-${effectiveTheme}`}
      style={{ "--panel-opacity": opacity / 100 } as React.CSSProperties}
    >
      <section
        className={`widget-shell ${isCalendarPanelOpen ? "widget-shell--sources-open" : ""} ${
          isGlanceOpen ? "widget-shell--drawer-open" : "widget-shell--drawer-closed"
        }`}
      >
        {isCalendarPanelOpen && (
          <section className="panel panel--calendar-sources" id="calendar-sources-panel" aria-label="显示的日历">
            <header className="source-panel-head">
              <div>
                <p className="section-title">日历来源</p>
                <h2>显示日历</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="立即同步日历"
                disabled={syncing || !googleConnected}
                onClick={() => void syncGoogleCalendars(true)}
              >
                <RefreshCw className={syncing ? "is-spinning" : ""} size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="calendar-source-groups">
              {(["local", "google", "outlook"] as const).map((provider) => {
                const sources = calendarSources.filter((source) => source.provider === provider);
                if (!sources.length) return null;
                return (
                  <section className="calendar-source-group" key={provider}>
                    <h3>{provider === "local" ? "本地" : provider === "google" ? "Google" : "Outlook"}</h3>
                    {sources.map((source) => (
                      <label className="calendar-source-option" key={source.id}>
                        <input
                          type="checkbox"
                          checked={source.visible}
                          onChange={(event) => {
                            const visible = event.target.checked;
                            setCalendarSources((current) => current.map((candidate) =>
                              candidate.id === source.id ? { ...candidate, visible } : candidate));
                          }}
                        />
                        <span
                          className={`calendar-source-dot source-${source.provider === "google" ? "gmail" : source.provider}`}
                          style={{ backgroundColor: source.color }}
                        />
                        <span className="calendar-source-copy">
                          <strong>{source.name}</strong>
                          <small>{source.primary ? "主日历" : source.accountLabel}</small>
                        </span>
                      </label>
                    ))}
                  </section>
                );
              })}
            </div>

            <p className="source-panel-note">
              {googleConnected ? "启动、回到窗口及每 15 分钟自动同步。" : "连接 Google 后会列出账号下的全部日历。"}
            </p>
          </section>
        )}

        <aside className="panel panel--calendar panel--calendar-focus">
          <div className="panel-topline panel-topline--calendar-focus">
            <div
              className={`panel-title-block panel-title-block--calendar window-drag-zone ${
                desktopLocked ? "is-locked" : ""
              }`}
              data-tauri-drag-region={desktopLocked ? undefined : true}
              title={desktopLocked ? "窗口已锁定，可在设置里关闭后拖动" : "拖动窗口"}
              onMouseDown={(event) => {
                if (!desktopLocked || event.button !== 0) return;
                event.preventDefault();
                showLockedWindowHint();
              }}
            >
              <h1 className="panel-heading panel-heading--large" data-tauri-drag-region={desktopLocked ? undefined : true}>
                {monthTitle}
              </h1>
              <p className="calendar-period" data-tauri-drag-region={desktopLocked ? undefined : true}>
                {formatPeriodLabel(selectedDate)}
              </p>
            </div>
            <div className="panel-toolbar panel-toolbar--tight">

              <button
                className={`icon-button ${isCalendarPanelOpen ? "is-active" : ""}`}
                type="button"
                aria-expanded={isCalendarPanelOpen}
                aria-controls="calendar-sources-panel"
                aria-label={isCalendarPanelOpen ? "收起日历列表" : "选择显示的日历"}
                onClick={() => setIsCalendarPanelOpen((current) => !current)}
              >
                <ListFilter size={18} aria-hidden="true" />
              </button>
              <button
                className="today-button"
                type="button"
                onClick={() => {
                  selectDate(todayKey, false);
                  showNotice("已回到今天");
                }}
                aria-label="回到今天"
              >
                今天
              </button>
              <button
                className={`icon-button icon-button--glance ${isGlanceOpen ? "is-active" : ""}`}
                type="button"
                aria-expanded={isGlanceOpen}
                aria-controls="day-glance-panel"
                aria-label={isGlanceOpen ? "收起当日任务" : "展开当日任务"}
                onClick={() => setIsGlanceOpen((current) => !current)}
              >
                <CalendarDays size={18} aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={widgetMode === "month" ? "上一月" : widgetMode === "week" ? "上一周" : "上两周"}
                onClick={() => movePeriod(-1)}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label={widgetMode === "month" ? "下一月" : widgetMode === "week" ? "下一周" : "下两周"}
                onClick={() => movePeriod(1)}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
              <div className="view-switch" role="tablist" aria-label="视图切换">
                {([
                  ["month", "月"],
                  ["week", "周"],
                  ["fortnight", "双周"],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`view-switch__button ${widgetMode === mode ? "is-active" : ""}`}
                    onClick={() => {
                      setWidgetMode(mode);
                      showNotice(`已切换到${label}视图`);
                    }}
                    role="tab"
                    aria-selected={widgetMode === mode}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button className="icon-button" type="button" aria-label="新建任务" onClick={() => openCreate()}>
                <Plus size={18} aria-hidden="true" />
              </button>
              <button className="icon-button" type="button" aria-label="打开设置" onClick={() => setShowSettings(true)}>
                <Settings size={18} aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="隐藏到托盘"
                onClick={() => {
                  showNotice("桌面壳中会隐藏到托盘；浏览器预览会显示提示。");
                  void hideWindow();
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="widget-mainstage">
            {widgetMode === "month" && (
              <section className="planner-view planner-view--month is-active" aria-label="月视图">
                <div className="calendar-month calendar-month--dense">
                  <div className="calendar-header">
                    {weekdays.map((day) => <span key={day}>{day}</span>)}
                  </div>
                  <div className="calendar-grid calendar-grid--monthly">
                    {monthDates.map((date) => renderCalendarCell(date, { monthCell: true }))}
                  </div>
                </div>
              </section>
            )}

            {widgetMode === "week" && (
              <section className="planner-view is-active" aria-label="周视图">
                <div className="calendar-month calendar-month--week">
                  <div className="calendar-header calendar-header--floating">
                    {weekdays.map((day) => <span key={day}>{day}</span>)}
                  </div>
                  <div className="week-calendar-board">
                    {weekDates.map((date) => renderCalendarCell(date))}
                  </div>
                </div>
              </section>
            )}

            {widgetMode === "fortnight" && (
              <section className="planner-view is-active" aria-label="双周视图">
                <div className="calendar-month calendar-month--fortnight">
                  <div className="calendar-header calendar-header--floating">
                    {weekdays.map((day) => <span key={day}>{day}</span>)}
                  </div>
                  <div className="fortnight-calendar-board">
                    {fortnightDates.map((date) => renderCalendarCell(date))}
                  </div>
                </div>
              </section>
            )}
          </div>
        </aside>

        {isGlanceOpen && (
          <section className="panel panel--glance panel--glance-simple panel--glance-drawer" id="day-glance-panel">
            <header className="timeline-header timeline-header--glance">
              <div className="glance-heading">
                <p className="section-title">{formatPeriodLabel(selectedDate)}</p>
                <h2>当日任务</h2>
              </div>
              <button className="ghost-button ghost-button--compact" type="button" onClick={() => openCreate()}>
                新建
              </button>
            </header>

            <div className="timeline-stack timeline-stack--glance">
              {selectedItems.length ? (
                selectedItems.map((item) => (
                  <article
                    key={item.id}
                    className={`event-card event-card--glance ${
                      item.kind === "event" ? "event-card--event" : "event-card--task"
                    } ${item.state === "done" ? "event-card--done" : ""} ${toneClass[item.calendar]} ${
                      draggingItemId === item.id ? "is-dragging" : ""
                    }`}
                    style={{ "--calendar-color": getItemCalendarColor(item) } as React.CSSProperties}
                    draggable
                    onDragStart={(event) => beginDragItem(event, item.id)}
                    onDragEnd={endDragItem}
                  >
                    <div className="event-card__top">
                      <p className="event-time">{formatItemTime(item)}</p>
                      <button
                        className="state-button"
                        type="button"
                        aria-label={item.state === "done" ? "改为未完成" : "标记完成"}
                        onClick={() => toggleDone(item.id)}
                      >
                        {item.state === "done" ? <Check size={15} aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}
                      </button>
                    </div>
                    <button type="button" className="event-card__content" onClick={() => openEdit(item)}>
                      <h3>{item.title}</h3>
                      <p className="event-meta">
                        {item.calendarLabel ?? item.calendar} · {item.kind === "event" ? "日程" : "任务"}
                        {item.note ? ` · ${item.note}` : ""}
                      </p>
                    </button>
                  </article>
                ))
              ) : (
                <button type="button" className="empty-day" onClick={() => openCreate(selectedDate)}>
                  这一天还没有安排，点此新增
                </button>
              )}
            </div>

            <div className="statusline" aria-label="账号连接状态">
              <button
                className="status-pill status-pill--connected"
                type="button"
                onClick={openAccountSettings}
              >
                <i />GMAIL · OUTLOOK
              </button>
            </div>
          </section>
        )}
      </section>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {dragPreview && (
        <div
          className={`task-drag-preview ${toneClass[dragPreview.item.calendar]}`}
          style={{
            left: dragPreview.x,
            top: dragPreview.y,
            width: dragPreview.width,
          }}
          aria-hidden="true"
        >
          {(dragPreview.item.start || dragPreview.item.kind === "task") && (
            <span>{dragPreview.item.start || "TASK"}</span>
          )}
          <strong>{dragPreview.item.title}</strong>
        </div>
      )}

      {editor && (
        <div className="editor-backdrop" role="presentation">
          <form className="editor-sheet" onSubmit={saveDraft} aria-label="任务编辑">
            <div className="editor-head">
              <div>
                <span className="section-title">{editor.mode === "create" ? "新增" : "编辑"}</span>
                <h2>{editor.mode === "create" ? "新建任务" : "修改安排"}</h2>
              </div>
              <button className="icon-button" type="button" aria-label="关闭编辑" onClick={handleCloseEditor}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <label className="field" htmlFor="editor-title">
              <span>标题</span>
              <input id="editor-title"
                value={editor.draft.title}
                onChange={(event) => setDraftValue("title", event.target.value)}
                required
                autoFocus
              />
            </label>

            <div className="form-grid">
              <label className="field" htmlFor="editor-date">
                <span>日期</span>
                <input id="editor-date"
                  type="date"
                  value={editor.draft.date}
                  onChange={(event) => setDraftValue("date", event.target.value)}
                  required
                />
              </label>
              <label className="field" htmlFor="editor-kind">
                <span>类型</span>
                <select id="editor-kind"
                  value={editor.draft.kind}
                  onChange={(event) => {
                    const kind = event.target.value as ItemKind;
                    setEditor((current) => current && ({
                      ...current,
                      draft: {
                        ...current.draft,
                        kind,
                        allDay: kind === "event" && !current.draft.start && !current.draft.end,
                      },
                    }));
                  }}
                >
                  <option value="task">任务</option>
                  <option value="event">日程</option>
                </select>
              </label>
            </div>

            {editor.draft.kind === "event" && (
              <div className="all-day-row">
                <div className="row-copy">
                  <strong>全天</strong>
                </div>
                <button
                  className={`toggle ${editor.draft.allDay ? "is-on" : ""}`}
                  type="button"
                  role="switch"
                  aria-checked={Boolean(editor.draft.allDay)}
                  aria-label="切换全天日程"
                  onClick={() => setEditor((current) => current && ({
                    ...current,
                    draft: {
                      ...current.draft,
                      allDay: !current.draft.allDay,
                      start: !current.draft.allDay ? "" : current.draft.start,
                      end: !current.draft.allDay ? "" : current.draft.end,
                    },
                  }))}
                />
              </div>
            )}

            <div className="form-grid">
              <label className="field" htmlFor="editor-start">
                <span>开始</span>
                <input id="editor-start"
                  type="time"
                  value={editor.draft.start}
                  disabled={Boolean(editor.draft.allDay)}
                  onChange={(event) => setDraftValue("start", event.target.value)}
                />
              </label>
              <label className="field" htmlFor="editor-end">
                <span>结束</span>
                <input id="editor-end"
                  type="time"
                  value={editor.draft.end}
                  disabled={Boolean(editor.draft.allDay)}
                  onChange={(event) => setDraftValue("end", event.target.value)}
                />
              </label>
            </div>

            {editor.draft.kind === "event" && (
              <label className="field" htmlFor="editor-reminder">
                <span>提醒</span>
                <select
                  id="editor-reminder"
                  value={editor.draft.reminderMinutes ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    void setDraftReminder(value === "" ? undefined : Number(value));
                  }}
                >
                  <option value="">不提醒</option>
                  <option value="0">开始时</option>
                  <option value="5">提前 5 分钟</option>
                  <option value="10">提前 10 分钟</option>
                  <option value="15">提前 15 分钟</option>
                  <option value="30">提前 30 分钟</option>
                  <option value="60">提前 1 小时</option>
                  <option value="120">提前 2 小时</option>
                  <option value="1440">提前 1 天</option>
                </select>
              </label>
            )}

            <div className="form-grid">
              <label className="field" htmlFor="editor-calendar">
                <span>日历</span>
                <select id="editor-calendar"
                  value={editor.draft.calendar === "Local"
                    ? "local"
                    : editor.draft.calendar === "Gmail"
                      ? `google:${editor.draft.calendarId ?? primaryGoogleSource?.remoteId ?? "primary"}`
                      : `outlook:${editor.draft.calendarId ?? "default"}`}
                  onChange={(event) => setDraftCalendar(event.target.value)}
                >
                  {calendarSources.filter((source) => source.writable).map((source) => (
                    <option value={source.id} key={source.id}>
                      {source.provider === "local" ? source.name : `${source.name} · ${source.accountLabel}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" htmlFor="editor-state">
                <span>状态</span>
                <select id="editor-state"
                  value={editor.draft.state}
                  onChange={(event) => setDraftValue("state", event.target.value as TaskState)}
                >
                  <option value="open">未完成</option>
                  <option value="done">已完成</option>
                </select>
              </label>
            </div>

            <label className="field" htmlFor="editor-note">
              <span>备注</span>
              <textarea id="editor-note"
                value={editor.draft.note}
                onChange={(event) => setDraftValue("note", event.target.value)}
                rows={3}
              />
            </label>

            <div className="editor-actions">
              {editor.mode === "edit" && (
                <button className="danger-action" type="button" onClick={deleteItem}>
                  <Trash2 size={16} aria-hidden="true" />
                  删除
                </button>
              )}
              <button className="secondary-action" type="button" onClick={handleCloseEditor}>
                取消
              </button>
              <button className="primary-action" type="submit">
                <Save size={16} aria-hidden="true" />
                保存
              </button>
            </div>
          </form>
        </div>
      )}

      {showSettings && (
        <div className="editor-backdrop editor-backdrop--settings" role="presentation">
          <section className="settings-window" aria-label="Dayboard 设置窗口">
            <header className="window-bar">
              <div className="settings-window-drag-region" data-tauri-drag-region title="拖动窗口">
                <span className="traffic-lights" aria-hidden="true" data-tauri-drag-region><i /><i /><i /></span>
                <span className="window-title" data-tauri-drag-region>Dayboard · {settingsTab === "accounts" ? "账号连接" : "贴片外观"}</span>
              </div>
              <button className="window-close" type="button" aria-label="关闭设置" onClick={() => setShowSettings(false)}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="settings-layout">
              <aside className="settings-sidebar">
                <div className="product-mark">
                  <div className="product-mark__icon" aria-hidden="true">
                    <CalendarDays size={18} />
                  </div>
                  <div>
                    <h1>Dayboard</h1>
                    <p>Widget reference</p>
                  </div>
                </div>

                <nav className="nav-stack" aria-label="设置分组">
                  <button
                    className={`nav-item ${settingsTab === "accounts" ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setSettingsTab("accounts")}
                  >
                    <Link2 size={17} aria-hidden="true" />
                    账号连接
                  </button>
                  <button
                    className={`nav-item ${settingsTab === "widget" ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setSettingsTab("widget")}
                  >
                    <CalendarDays size={17} aria-hidden="true" />
                    贴片外观
                  </button>
                </nav>

                <p className="sidebar-note">
                  {settingsTab === "accounts"
                    ? "这里只定义会影响开发架构的设置项：账号、同步范围、错误状态和低显眼度连接标识。"
                    : "这页只定义桌面贴片本身的显示规则：默认月视图、任务抽屉隐藏、桌面行为和透明度。"}
                </p>
              </aside>

              {settingsTab === "accounts" ? (
                <section className="settings-content">
                  <header className="content-head">
                    <div>
                      <h2>账号连接</h2>
                      <p>连接你的日历账号，将日程同步到桌面贴片。</p>
                    </div>
                    <button
                      className="action-button action-button--primary"
                      type="button"
                      disabled={syncing}
                      onClick={() => void syncGoogleCalendars(true)}
                    >
                      {syncing ? "Syncing..." : "同步"}
                    </button>
                  </header>

                  <div className="card-grid">
                    <article className="account-card">
                      <div className="account-icon">G</div>
                      <div className="account-main">
                        <h3>Google 日历</h3>
                        <p>
                          {googleConnected
                            ? `已连接并发现 ${calendarSources.filter((source) => source.provider === "google").length} 个日历，贴片会自动同步。`
                            : "连接 Google 日历后，账号下的日历会自动出现在贴片上。"}
                        </p>
                        <div className="account-meta">
                          <span className="meta-pill">Calendar</span>
                          {googleConnected && <span className="meta-pill">已授权</span>}
                        </div>
                      </div>
                      {googleConnected ? (
                        <div className="account-actions">
                          <span className="status-chip"><i />CONNECTED</span>
                          <button
                            className="danger-action danger-action--compact"
                            type="button"
                            onClick={disconnectGoogleAccount}
                          >
                            断开
                          </button>
                        </div>
                      ) : (
                        googleConnecting ? (
                          <div className="account-actions">
                            <span className="status-chip status-chip--warning"><i />等待浏览器授权</span>
                            <button className="secondary-action" type="button" onClick={cancelGoogleConnection}>取消</button>
                          </div>
                        ) : (
                          <button className="action-button" type="button" onClick={connectGoogle}>连接</button>
                        )
                      )}
                    </article>

                    <article className="account-card">
                      <div className="account-icon">O</div>
                      <div className="account-main">
                        <h3>Outlook</h3>
                        <p>Outlook 日历同步将在后续版本中接入 Microsoft Graph API。</p>
                        <div className="account-meta">
                          <span className="meta-pill">Calendar</span>
                          <span className="meta-pill">即将推出</span>
                        </div>
                      </div>
                      <button
                        className="action-button"
                        type="button"
                        onClick={() => showNotice("Outlook 同步将在后续 OAuth 阶段接入。")}
                      >
                        连接
                      </button>
                    </article>

                    <article className="account-card">
                      <div className="account-icon">I</div>
                      <div className="account-main">
                        <h3>ICS / Apple Calendar</h3>
                        <p>作为后续订阅入口保留，当前 MVP 暂不连接。</p>
                        <div className="account-meta">
                          <span className="meta-pill">Subscription</span>
                          <span className="meta-pill">Optional</span>
                        </div>
                      </div>
                      <button
                        className="action-button"
                        type="button"
                        onClick={() => showNotice("ICS / Apple Calendar 是后续订阅入口。")}
                      >
                        连接
                      </button>
                    </article>
                  </div>

                  <section className="setting-card">
                    <h3>同步范围</h3>
                    <p>这些开关决定贴片可读取哪些内容。</p>
                    {([
                      ["calendar", "日历事件", "会议、全天事件、外部邀请。"],
                      ["tasks", "任务列表", "Outlook To Do、本地任务和轻量待办。"],
                      ["mailEvents", "邮件识别日程", "从邮件中提取航班、会议和预约。"],
                    ] as const).map(([key, title, desc]) => (
                      <div className="settings-row" key={key}>
                        <div className="row-copy"><strong>{title}</strong><span>{desc}</span></div>
                        <button
                          className={`toggle ${syncOptions[key] ? "is-on" : ""}`}
                          type="button"
                          aria-pressed={syncOptions[key]}
                          aria-label={`切换${title}`}
                          onClick={() => {
                            setSyncOptions((current) => ({ ...current, [key]: !current[key] }));
                            showNotice(`${title}同步范围已更新。`);
                          }}
                        />
                      </div>
                    ))}
                  </section>

                  <div className="sync-alert">
                    <p>{retryMessage}</p>
                    <button
                      className="action-button"
                      type="button"
                      disabled={syncing}
                      onClick={() => void syncGoogleCalendars(true)}
                    >
                      重试
                    </button>
                  </div>
                </section>
              ) : (
                <section className="settings-content">
                  <header className="content-head">
                    <div>
                      <h2>贴片外观</h2>
                      <p>设置桌面贴片默认视图、透明度和桌面行为。窗口尺寸直接通过边缘自由调整，任务抽屉只在点击日历 icon 后展开。</p>
                    </div>
                    <span className="status-chip"><i />MONTH FIRST</span>
                  </header>

                  <div className="card-grid">
                    <section className="setting-card">
                      <h3>默认视图</h3>
                      <p>贴到桌面时默认打开月视图；周和双周是切换态，不是常驻三栏。</p>
                      <div className="settings-row">
                        <div className="row-copy"><strong>启动后显示</strong><span>主视图占满整个贴片。</span></div>
                        <div className="segmented" role="tablist" aria-label="默认视图">
                          {([
                            ["month", "月"],
                            ["week", "周"],
                            ["fortnight", "双周"],
                          ] as const).map(([mode, label]) => (
                            <button
                              key={mode}
                              type="button"
                              className={widgetMode === mode ? "is-active" : ""}
                              onClick={() => {
                                setWidgetMode(mode);
                                showNotice(`默认视图已设为${label}。`);
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </section>
                  </div>

                  <section className="setting-card">
                    <h3>桌面行为</h3>
                    <div className="settings-row">
                      <div className="row-copy"><strong>锁定在桌面</strong><span>避免拖动或误关，适合常驻查看。</span></div>
                      <button
                        className={`toggle ${desktopLocked ? "is-on" : ""}`}
                        type="button"
                        aria-pressed={desktopLocked}
                        aria-label="切换锁定在桌面"
                        onClick={() => {
                          setDesktopLocked((current) => {
                            const next = !current;
                            showNotice(next ? "已锁定窗口拖动和尺寸调整。" : "已允许拖动和调整窗口。");
                            return next;
                          });
                        }}
                      />
                    </div>
                    <div className="settings-row">
                      <div className="row-copy"><strong>开机启动</strong><span>登录 Windows 后自动启动 Dayboard。</span></div>
                      <button
                        className={`toggle ${autoStart ? "is-on" : ""}`}
                        type="button"
                        aria-pressed={autoStart}
                        aria-label="切换开机启动"
                        onClick={() => void toggleAutoStart()}
                      />
                    </div>
                    <div className="settings-row">
                      <div className="row-copy"><strong>固定方式</strong><span>普通窗口、固定桌面、置顶显示。</span></div>
                      <div className="pin-options">
                        {([
                          ["desktop", "固定桌面"],
                          ["normal", "普通窗口"],
                          ["top", "置顶"],
                        ] as const).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            className={pinMode === mode ? "is-active" : ""}
                            onClick={() => {
                              setPinMode(mode);
                              showNotice(`固定方式已切换为${label}。`);
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="row-copy"><strong>鼠标穿透</strong><span>查看时更安静，悬停快捷键可临时解锁。</span></div>
                      <button
                        className={`toggle ${mousePassthrough ? "is-on" : ""}`}
                        type="button"
                        aria-pressed={mousePassthrough}
                        aria-label="切换鼠标穿透"
                        onClick={() => {
                          setMousePassthrough((current) => !current);
                          showNotice("鼠标穿透已记录为后续选项；需要快捷解锁后再接入真实窗口能力。");
                        }}
                      />
                    </div>
                  </section>

                  <div className="card-grid card-grid--two">
                    <section className="setting-card">
                      <h3>透明度与主题</h3>
                      <div className="settings-row">
                        <div className="row-copy"><strong>贴片透明度</strong><span>保持可读，不做重玻璃效果。</span></div>
                        <div className="range-row">
                          <input
                            type="range"
                            min="72"
                            max="100"
                            value={opacity}
                            onChange={(event) => setOpacity(Number(event.target.value))}
                            aria-label="贴片透明度"
                          />
                          <span className="range-value">{opacity}%</span>
                        </div>
                      </div>
                      <div className="settings-row">
                        <div className="row-copy"><strong>主题</strong><span>首版推荐跟随深色贴片系统。</span></div>
                        <div className="segmented" aria-label="主题">
                          {([
                            ["dark", "深色"],
                            ["light", "浅色"],
                            ["system", "跟随系统"],
                          ] as const).map(([mode, label]) => (
                            <button
                              key={mode}
                              className={themeMode === mode ? "is-active" : ""}
                              type="button"
                              onClick={() => {
                                setThemeMode(mode);
                                showNotice(`主题已切换为${label}。`);
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </section>

                    <section className="setting-card">
                      <h3>任务面板</h3>
                      <p>默认不占空间。点击当前视图里的日历 icon 后，日历让出一块区域给当日任务面板。</p>
                      <div className="settings-row">
                        <div className="row-copy"><strong>默认状态</strong><span>隐藏，当日任务不常驻。</span></div>
                        <span className="status-chip status-chip--idle"><i />HIDDEN</span>
                      </div>
                      <div className="settings-row">
                        <div className="row-copy"><strong>展开方式</strong><span>日历 icon 触发，月 / 周 / 双周一致。</span></div>
                        <button
                          className="action-button"
                          type="button"
                          onClick={() => {
                            setIsGlanceOpen((current) => !current);
                            showNotice(isGlanceOpen ? "任务面板预览已隐藏。" : "任务面板预览已展开。");
                          }}
                        >
                          {isGlanceOpen ? "隐藏任务面板" : "展开任务面板"}
                        </button>
                      </div>
                    </section>
                  </div>

                  <section className="setting-card">
                    <h3>贴片预览</h3>
                    <p>开发参考：关闭状态下月视图占满整个贴片；展开后右侧出现当日任务面板。</p>
                    <div className={`mini-preview ${isGlanceOpen ? "is-open" : ""}`}>
                      <div className="preview-calendar">
                        <div className="preview-head"><strong>July 2026</strong><span className="status-chip"><i />CONNECTED</span></div>
                        <div className="preview-grid" aria-hidden="true">
                          {Array.from({ length: 35 }, (_, index) => <i key={index} />)}
                        </div>
                      </div>
                      <aside className="preview-drawer">
                        <span className="section-title">Jul 4</span>
                        <div className="preview-task" />
                        <div className="preview-task" />
                        <p className="footer-note">任务面板只在用户需要下钻时出现。</p>
                      </aside>
                    </div>
                  </section>

                  <section className="setting-card">
                    <h3>本地数据</h3>
                    <p>当前 MVP 使用本地浏览器存储保存任务和设置，后续会迁移到 SQLite。</p>
                    <button className="danger-action standalone" type="button" onClick={resetLocalData}>
                      恢复示例数据
                    </button>
                  </section>

                  <section className="setting-card">
                    <h3>软件更新</h3>
                    <p>当前版本 {APP_VERSION}。更新信息来自 Dayboard 的 GitHub Releases。</p>
                    <div className="settings-row">
                      <div className="row-copy">
                        <strong>
                          {updateState.kind === "checking" ? "正在检查更新" : "检查更新"}
                        </strong>
                        <span>
                          {updateState.kind === "idle" && "尚未检查更新。"}
                          {updateState.kind === "checking" && "正在连接发布服务。"}
                          {updateState.kind === "up-to-date" && `已是最新版本（${updateState.version}）。`}
                          {updateState.kind === "available" && `发现新版本 ${updateState.version}。`}
                          {updateState.kind === "unavailable" && "仓库尚未发布可下载版本。"}
                          {updateState.kind === "error" && `检查失败：${updateState.message}`}
                        </span>
                      </div>
                      <button
                        className="action-button"
                        type="button"
                        disabled={updateState.kind === "checking"}
                        onClick={() => void checkForUpdates()}
                      >
                        {updateState.kind === "checking" ? "检查中..." : "检查更新"}
                      </button>
                    </div>
                  </section>
                </section>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
