import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Link2,
  Plus,
  Save,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DragEvent, FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { type AppSettings, type CalendarName, type DayboardItem, type DraftItem, type EffectiveTheme, type ItemKind, type PinMode, type TaskState, type ThemeMode, type WidgetMode, defaultSettings, loadItems, loadSettings, resetToSeedItems, saveItems, saveSettings, seedItems, STORAGE_KEYS } from "./storage";

import { getAuthUrl, handleAuthCallback, isGoogleConnected, disconnectGoogle, fetchCalendarEvents } from "./sync/google";
type EditorState =
  | { mode: "create"; draft: DraftItem }
  | { mode: "edit"; id: string; draft: DraftItem }
  | null;
type DragPayload = {
  itemId: string;
};

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


const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

const toneClass: Record<CalendarName, string> = {
  Local: "source-local",
  Gmail: "source-gmail",
  Outlook: "source-outlook",
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
  if (item.start && item.end) return `${item.start} - ${item.end}`;
  if (item.start) return item.start;
  return item.kind === "event" ? "全天" : "TASK";
};

const emptyDraft = (date: string): DraftItem => ({
  title: "",
  date,
  start: "",
  end: "",
  kind: "task",
  state: "open",
  calendar: "Local",
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
  const [googleConnected, setGoogleConnected] = useState(() => isGoogleConnected());
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);
  const [retryMessage, setRetryMessage] = useState("Outlook 任务列表 16 分钟前同步失败，日历仍可正常显示。");
  const [syncOptions, setSyncOptions] = useState({
    calendar: true,
    tasks: true,
    mailEvents: false,
  });
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState>(null);
  const dragClickGuardUntil = useRef(0);
  const pointerDrag = useRef<PointerDragState | null>(null);

  const monthDates = useMemo(() => getMonthDates(currentMonth), [currentMonth]);
  const weekDates = useMemo(() => getRangeDates(selectedDate, 7), [selectedDate]);
  const fortnightDates = useMemo(() => getRangeDates(selectedDate, 14), [selectedDate]);
  const monthTitle = useMemo(() => formatMonthTitle(currentMonth), [currentMonth]);

  const itemsByDate = useMemo(() => {
    const grouped = new Map<string, DayboardItem[]>();
    boardItems.forEach((item) => {
      grouped.set(item.date, [...(grouped.get(item.date) ?? []), item]);
    });
    grouped.forEach((items) => items.sort((a, b) => a.start.localeCompare(b.start)));
    return grouped;
  }, [boardItems]);

  const selectedItems = itemsByDate.get(selectedDate) ?? [];

  useEffect(() => {
    saveItems(boardItems);
  }, [boardItems]);

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
    });
  }, [widgetMode, isGlanceOpen, opacity, pinMode, themeMode, desktopLocked, autoStart, mousePassthrough]);

  useEffect(() => {
    void applyWindowBehavior(pinMode, desktopLocked);
  }, [pinMode, desktopLocked]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
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

  // Handle OAuth callback on page load
  useEffect(() => {
    const url = window.location.href;
    if (url.includes("oauth/google/callback")) {
      const code = new URL(url).searchParams.get("code");
      const error = new URL(url).searchParams.get("error");
      if (error) {
        showNotice("Google 授权失败，请重试。");
        window.history.replaceState({}, "", "/");
        return;
      }
      if (code) {
        handleAuthCallback(url)
          .then(() => {
            setGoogleConnected(true);
            showNotice("Google 日历已连接。");
          })
          .catch((err: Error) => {
            showNotice("授权失败: " + err.message);
          })
          .finally(() => {
            window.history.replaceState({}, "", "/");
          });
      }
    }
  }, []);

  const showNotice = (message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2200);
  };

  const setDraftValue = <Key extends keyof DraftItem>(key: Key, value: DraftItem[Key]) => {
    setEditor((current) => {
      if (!current) return current;
      return { ...current, draft: { ...current.draft, [key]: value } };
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
    setEditor({ mode: "edit", id, draft });
  };

  const saveDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || !editor.draft.title.trim()) return;

    if (editor.mode === "create") {
      const item: DayboardItem = {
        id: `item-${Date.now()}`,
        ...editor.draft,
        title: editor.draft.title.trim(),
      };
      setBoardItems((current) => [...current, item]);
      selectDate(item.date, false);
    } else {
      setBoardItems((current) =>
        current.map((item) =>
          item.id === editor.id
            ? { id: editor.id, ...editor.draft, title: editor.draft.title.trim() }
            : item,
        ),
      );
      selectDate(editor.draft.date, false);
    }

    setEditor(null);
  };

  const deleteItem = () => {
    if (!editor || editor.mode !== "edit") return;
    setBoardItems((current) => current.filter((item) => item.id !== editor.id));
    setEditor(null);
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
    selectDate(nextDate, false);
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
    setWidgetMode(defaultSettings.widgetMode);
    setIsGlanceOpen(defaultSettings.isGlanceOpen);
    setOpacity(defaultSettings.opacity);
    setPinMode(defaultSettings.pinMode);
    setThemeMode(defaultSettings.themeMode);
    setDesktopLocked(defaultSettings.desktopLocked);
    setAutoStart(defaultSettings.autoStart);
    setMousePassthrough(defaultSettings.mousePassthrough);
    setSelectedDate(todayKey);
    setCurrentMonth(parseDateKey(todayKey));
    showNotice("已恢复示例数据和默认贴片设置");
  };

  const openAccountSettings = () => {
    setSettingsTab("accounts");
    setShowSettings(true);
  };

  const connectGoogle = async () => {
    setGoogleConnecting(true);
    try {
      const authUrl = await getAuthUrl();
      window.open(authUrl, "_blank");
      showNotice("请在浏览器中完成 Google 授权。");
    } catch (err) {
      showNotice("无法启动 Google 授权: " + (err as Error).message);
    } finally {
      setGoogleConnecting(false);
    }
  };

  const disconnectGoogleAccount = () => {
    disconnectGoogle();
    setGoogleConnected(false);
    showNotice("Google 日历已断开。");
  };

  const showLockedWindowHint = () => {
    showNotice("窗口已锁定，可在设置里关闭“锁定窗口”后拖动。");
  };

  const renderItemChip = (item: DayboardItem, compact = false) => (
    <button
      key={item.id}
      type="button"
      draggable={false}
      className={`task-pill ${toneClass[item.calendar]} ${item.state === "done" ? "is-done" : ""} ${
        draggingItemId === item.id ? "is-dragging" : ""
      }`}
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
      {!compact && <span>{item.start || (item.kind === "task" ? "TASK" : "全天")}</span>}
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
        className={`widget-shell ${isGlanceOpen ? "widget-shell--drawer-open" : "widget-shell--drawer-closed"}`}
      >
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
                        {item.calendar} · {item.kind === "event" ? "日程" : "任务"}
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
          <span>{dragPreview.item.start || (dragPreview.item.kind === "task" ? "TASK" : "全天")}</span>
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
              <button className="icon-button" type="button" aria-label="关闭编辑" onClick={() => setEditor(null)}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <label className="field">
              <span>标题</span>
              <input
                value={editor.draft.title}
                onChange={(event) => setDraftValue("title", event.target.value)}
                required
                autoFocus
              />
            </label>

            <div className="form-grid">
              <label className="field">
                <span>日期</span>
                <input
                  type="date"
                  value={editor.draft.date}
                  onChange={(event) => setDraftValue("date", event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>类型</span>
                <select
                  value={editor.draft.kind}
                  onChange={(event) => setDraftValue("kind", event.target.value as ItemKind)}
                >
                  <option value="task">任务</option>
                  <option value="event">日程</option>
                </select>
              </label>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>开始</span>
                <input
                  type="time"
                  value={editor.draft.start}
                  onChange={(event) => setDraftValue("start", event.target.value)}
                />
              </label>
              <label className="field">
                <span>结束</span>
                <input
                  type="time"
                  value={editor.draft.end}
                  onChange={(event) => setDraftValue("end", event.target.value)}
                />
              </label>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>日历</span>
                <select
                  value={editor.draft.calendar}
                  onChange={(event) => setDraftValue("calendar", event.target.value as CalendarName)}
                >
                  <option value="Local">Local</option>
                  <option value="Gmail">Gmail</option>
                  <option value="Outlook">Outlook</option>
                </select>
              </label>
              <label className="field">
                <span>状态</span>
                <select
                  value={editor.draft.state}
                  onChange={(event) => setDraftValue("state", event.target.value as TaskState)}
                >
                  <option value="open">未完成</option>
                  <option value="done">已完成</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span>备注</span>
              <textarea
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
              <button className="secondary-action" type="button" onClick={() => setEditor(null)}>
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
                      onClick={async () => {
                        if (!googleConnected) { showNotice("请先连接 Google 日历再同步。"); return; }
                        setSyncing(true);
                        try {
                          const events = await fetchCalendarEvents(
                            new Date(Date.now() - 7 * 864e5).toISOString(),
                            new Date(Date.now() + 30 * 864e5).toISOString()
                          );
                          showNotice(`已同步 ${events.length} 个日历事件。`);
                        } catch (err) {
                          showNotice("同步失败: " + (err as Error).message);
                        } finally {
                          setSyncing(false);
                        }
                      }}
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
                            ? "已连接你的 Google 账号，日历事件将同步到桌面贴片。"
                            : "连接 Google 日历后，日程自动出现在贴片上。"}
                        </p>
                        <div className="account-meta">
                          <span className="meta-pill">Calendar</span>
                          {googleConnected && <span className="meta-pill">已授权</span>}
                        </div>
                      </div>
                      {googleConnected ? (
                        <span className="status-chip"><i />CONNECTED</span>
                      ) : (
                        <button
                          className="action-button"
                          type="button"
                          disabled={googleConnecting}
                          onClick={connectGoogle}
                        >
                          {googleConnecting ? "跳转中..." : "连接"}
                        </button>
                      )}
                    </article>

                    {googleConnected && (
                      <article className="account-card">
                        <div className="account-main" style={{ width: "100%" }}>
                          <button
                            className="danger-action standalone"
                            type="button"
                            onClick={disconnectGoogleAccount}
                          >
                            断开 Google 日历
                          </button>
                        </div>
                      </article>
                    )}

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
                      onClick={() => {
                        setRetryMessage("正在重新同步...");
                        showNotice("正在重试同步。");
                        window.setTimeout(() => {
                          setRetryMessage("同步队列已更新。");
                          showNotice("同步已进入队列。");
                        }, 800);
                      }}
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
                      <div className="row-copy"><strong>开机启动</strong><span>进入 Windows 后自动恢复上次位置。</span></div>
                      <button
                        className={`toggle ${autoStart ? "is-on" : ""}`}
                        type="button"
                        aria-pressed={autoStart}
                        aria-label="切换开机启动"
                        onClick={() => {
                          setAutoStart((current) => !current);
                          showNotice("开机启动只是界面状态，后续会接 Tauri autostart 插件。");
                        }}
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
