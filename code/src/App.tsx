import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  GripHorizontal,
  Moon,
  Plus,
  Save,
  Search,
  Settings,
  ListChecks,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type ViewMode = "month" | "week" | "day";
type TaskState = "open" | "done";
type ItemKind = "event" | "task";
type CalendarName = "Local" | "Work" | "Focus";
type PinMode = "normal" | "desktop" | "top";
type ToolRailSide = "left" | "right";

type DayboardItem = {
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

type DraftItem = Omit<DayboardItem, "id">;
type EditorState =
  | { mode: "create"; draft: DraftItem }
  | { mode: "edit"; id: string; draft: DraftItem }
  | null;

type AppSettings = {
  viewMode: ViewMode;
  isTaskPanelOpen: boolean;
  opacity: number;
  pinMode: PinMode;
  toolRailSide: ToolRailSide;
};

const seedItems: DayboardItem[] = [
  {
    id: "standup",
    title: "产品同步",
    date: "2026-06-04",
    start: "09:30",
    end: "10:00",
    kind: "event",
    state: "open",
    calendar: "Work",
    note: "确认 MVP 边界和下一轮开发顺序。",
  },
  {
    id: "sync-notes",
    title: "整理日历同步边界",
    date: "2026-06-04",
    start: "11:00",
    end: "12:00",
    kind: "task",
    state: "open",
    calendar: "Focus",
    note: "时区、重复事件、全天事件、取消事件。",
  },
  {
    id: "prototype",
    title: "桌面贴片原型检查",
    date: "2026-06-04",
    start: "15:30",
    end: "16:30",
    kind: "event",
    state: "open",
    calendar: "Local",
    note: "检查托盘、隐藏、窗口状态和透明度。",
  },
  {
    id: "review",
    title: "PRD 走查",
    date: "2026-06-05",
    start: "10:30",
    end: "11:15",
    kind: "event",
    state: "open",
    calendar: "Work",
    note: "",
  },
  {
    id: "weekly-plan",
    title: "规划下周任务",
    date: "2026-06-07",
    start: "",
    end: "",
    kind: "task",
    state: "open",
    calendar: "Focus",
    note: "",
  },
  {
    id: "archive",
    title: "归档调研链接",
    date: "2026-06-03",
    start: "",
    end: "",
    kind: "task",
    state: "done",
    calendar: "Local",
    note: "保留到 docs/OPEN_SOURCE_RESEARCH.md。",
  },
];

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const STORAGE_KEYS = {
  items: "dayboard.items.v1",
  settings: "dayboard.settings.v1",
};

const defaultSettings: AppSettings = {
  viewMode: "month",
  isTaskPanelOpen: false,
  opacity: 92,
  pinMode: "desktop",
  toolRailSide: "left",
};

const calendarTone: Record<CalendarName, string> = {
  Local: "tone-local",
  Work: "tone-work",
  Focus: "tone-focus",
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

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const todayKey = formatDateKey(new Date());

const getMonthDates = (monthDate: Date) => {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstOfMonth);
    date.setDate(1 - mondayOffset + index);
    return date;
  });
};

const formatMonthTitle = (date: Date) =>
  `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;

const loadItems = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.items);
    if (!raw) return seedItems;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DayboardItem[]) : seedItems;
  } catch {
    return seedItems;
  }
};

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) } as AppSettings;
  } catch {
    return defaultSettings;
  }
};

const formatItemTime = (item: DayboardItem | DraftItem) => {
  if (item.start && item.end) return `${item.start} - ${item.end}`;
  if (item.start) return item.start;
  return "全天";
};

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

async function applyPinMode(mode: PinMode) {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    await window.setAlwaysOnTop(mode === "top");
    await window.setSkipTaskbar(mode === "desktop");
  } catch {
    return;
  }
}

function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [viewMode, setViewMode] = useState<ViewMode>(settings.viewMode);
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [boardItems, setBoardItems] = useState<DayboardItem[]>(loadItems);
  const [editor, setEditor] = useState<EditorState>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(settings.isTaskPanelOpen);
  const [opacity, setOpacity] = useState(settings.opacity);
  const [pinMode, setPinMode] = useState<PinMode>(settings.pinMode);
  const [toolRailSide, setToolRailSide] = useState<ToolRailSide>(settings.toolRailSide);

  const monthDates = useMemo(() => getMonthDates(currentMonth), [currentMonth]);
  const monthTitle = useMemo(() => formatMonthTitle(currentMonth), [currentMonth]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.items, JSON.stringify(boardItems));
  }, [boardItems]);

  useEffect(() => {
    const nextSettings = { viewMode, isTaskPanelOpen, opacity, pinMode, toolRailSide };
    setSettings(nextSettings);
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(nextSettings));
  }, [viewMode, isTaskPanelOpen, opacity, pinMode, toolRailSide]);

  useEffect(() => {
    void applyPinMode(pinMode);
  }, [pinMode]);

  const selectedItems = useMemo(
    () =>
      boardItems
        .filter((item) => {
          const matchesDate = item.date === selectedDate;
          const matchesQuery = item.title.toLowerCase().includes(query.toLowerCase());
          return matchesDate && matchesQuery;
        })
        .sort((a, b) => a.start.localeCompare(b.start)),
    [boardItems, query, selectedDate],
  );

  const visibleMonthItems = (dateKey: string) => boardItems.filter((item) => item.date === dateKey);

  const setDraftValue = <Key extends keyof DraftItem>(key: Key, value: DraftItem[Key]) => {
    setEditor((current) => {
      if (!current) return current;
      return { ...current, draft: { ...current.draft, [key]: value } };
    });
  };

  const openCreate = (date = selectedDate) => {
    setSelectedDate(date);
    setEditor({ mode: "create", draft: emptyDraft(date) });
  };

  const openEdit = (item: DayboardItem) => {
    const { id, ...draft } = item;
    setSelectedDate(item.date);
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
      setSelectedDate(item.date);
    } else {
      setBoardItems((current) =>
        current.map((item) =>
          item.id === editor.id
            ? { id: editor.id, ...editor.draft, title: editor.draft.title.trim() }
            : item,
        ),
      );
      setSelectedDate(editor.draft.date);
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

  const updatePinMode = (mode: PinMode) => {
    setPinMode(mode);
  };

  const moveMonth = (offset: number) => {
    setCurrentMonth((current) => {
      const next = new Date(current);
      next.setMonth(current.getMonth() + offset);
      return next;
    });
  };

  const resetLocalData = () => {
    setBoardItems(seedItems);
    setViewMode(defaultSettings.viewMode);
    setIsTaskPanelOpen(defaultSettings.isTaskPanelOpen);
    setOpacity(defaultSettings.opacity);
    setPinMode(defaultSettings.pinMode);
    setToolRailSide(defaultSettings.toolRailSide);
    setSelectedDate(todayKey);
    setCurrentMonth(new Date());
  };

  return (
    <main
      className={`app-shell rail-${toolRailSide}`}
      style={{ "--panel-opacity": opacity / 100 } as React.CSSProperties}
    >
      <aside className="tool-rail" aria-label="快捷工具">
        <button className="icon-button drag-button" type="button" aria-label="拖动窗口" data-tauri-drag-region>
          <GripHorizontal size={18} aria-hidden="true" />
        </button>
        <button className="icon-button" type="button" aria-label="新增任务" onClick={() => openCreate()}>
          <Plus size={18} aria-hidden="true" />
        </button>
        <button
          className={`icon-button ${isTaskPanelOpen ? "active" : ""}`}
          type="button"
          aria-label={isTaskPanelOpen ? "收起任务列表" : "展开任务列表"}
          onClick={() => setIsTaskPanelOpen((current) => !current)}
        >
          <ListChecks size={17} aria-hidden="true" />
        </button>
        <button className="icon-button" type="button" aria-label="切换主题预览">
          <Moon size={17} aria-hidden="true" />
        </button>
        <button className="icon-button" type="button" aria-label="打开设置" onClick={() => setShowSettings(true)}>
          <Settings size={17} aria-hidden="true" />
        </button>
        <button className="icon-button" type="button" aria-label="隐藏到托盘" onClick={hideWindow}>
          <X size={18} aria-hidden="true" />
        </button>
      </aside>

      <header className="titlebar" data-tauri-drag-region>
        <button className="mini-nav" type="button" aria-label="上一月" onClick={() => moveMonth(-1)}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <div className="month-title" data-tauri-drag-region>
          <CalendarDays size={16} aria-hidden="true" />
          <strong>{monthTitle}</strong>
        </div>
        <button className="mini-nav" type="button" aria-label="下一月" onClick={() => moveMonth(1)}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </header>

      <section className={`board-layout ${isTaskPanelOpen ? "task-open" : "task-collapsed"}`}>
        <section className="calendar-panel" aria-label="日历">
          {viewMode === "month" && (
            <div className="month-grid">
              {weekdays.map((day) => (
                <span key={day} className="weekday">
                  {day}
                </span>
              ))}
              {monthDates.map((date) => {
                const key = formatDateKey(date);
                const dateItems = visibleMonthItems(key);
                const inMonth = date.getMonth() === currentMonth.getMonth();
                return (
                  <div
                    key={key}
                    className={`date-cell ${key === selectedDate ? "selected" : ""} ${
                      key === todayKey ? "today" : ""
                    } ${inMonth ? "" : "muted"}`}
                  >
                    <button
                      type="button"
                      className="date-head"
                      onClick={() => setSelectedDate(key)}
                      aria-label={`${date.getMonth() + 1} 月 ${date.getDate()} 日`}
                    >
                      <span>{date.getDate()}</span>
                      <small>{dateItems.length || ""}</small>
                    </button>
                    <div className="calendar-items">
                      {dateItems.slice(0, 4).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`calendar-chip ${calendarTone[item.calendar]} ${
                            item.state === "done" ? "done" : ""
                          }`}
                          onClick={() => openEdit(item)}
                          title={item.title}
                        >
                          <span>{item.start || (item.kind === "task" ? "待办" : "全天")}</span>
                          {item.title}
                        </button>
                      ))}
                      {dateItems.length > 4 && <span className="more-count">+{dateItems.length - 4}</span>}
                    </div>
                    <button
                      type="button"
                      className="blank-create"
                      onClick={() => openCreate(key)}
                      aria-label={`${date.getMonth() + 1} 月 ${date.getDate()} 日新增任务`}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {viewMode === "week" && (
            <div className="week-grid">
              {weekdays.map((day) => (
                <span key={day} className="weekday">
                  {day}
                </span>
              ))}
              {monthDates.slice(2, 9).map((date) => {
                const key = formatDateKey(date);
                const dateItems = visibleMonthItems(key);
                return (
                  <div
                    key={key}
                    className={`week-day ${key === selectedDate ? "selected" : ""} ${
                      key === todayKey ? "today" : ""
                    }`}
                  >
                    <button type="button" className="week-day-head" onClick={() => setSelectedDate(key)}>
                      <strong>{date.getDate()}</strong>
                      <small>{dateItems.length}</small>
                    </button>
                    <div className="calendar-items">
                      {dateItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`calendar-chip ${calendarTone[item.calendar]} ${
                            item.state === "done" ? "done" : ""
                          }`}
                          onClick={() => openEdit(item)}
                        >
                          <span>{item.start || "全天"}</span>
                          {item.title}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="blank-create"
                      onClick={() => openCreate(key)}
                      aria-label={`${date.getMonth() + 1} 月 ${date.getDate()} 日新增任务`}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {viewMode === "day" && (
            <div className="day-timeline">
              {selectedItems.length === 0 ? (
                <button type="button" className="empty-day" onClick={() => openCreate(selectedDate)}>
                  这一天还没有安排，点此新增
                </button>
              ) : (
                selectedItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`timeline-item ${calendarTone[item.calendar]} ${
                      item.state === "done" ? "done" : ""
                    }`}
                    onClick={() => openEdit(item)}
                  >
                    <span>{formatItemTime(item)}</span>
                    <strong>{item.title}</strong>
                    {item.note && <em>{item.note}</em>}
                  </button>
                ))
              )}
            </div>
          )}
        </section>

        {isTaskPanelOpen && (
        <aside className="task-panel" aria-label="当天安排">
          <div className="toolbar">
            <div>
              <span className="eyebrow">当前日期</span>
              <strong>{selectedDate}</strong>
            </div>
            <button className="primary-action" type="button" onClick={() => openCreate()}>
              <Plus size={17} aria-hidden="true" />
              新建
            </button>
          </div>

          <div className="search-box">
            <Search size={16} aria-hidden="true" />
            <label className="sr-only" htmlFor="task-search">
              搜索当天安排
            </label>
            <input
              id="task-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索当天安排"
            />
          </div>

          <div className="item-list">
            {selectedItems.map((item) => (
              <article key={item.id} className={`item ${calendarTone[item.calendar]}`}>
                <button
                  className="state-button"
                  type="button"
                  aria-label={item.state === "done" ? "改为未完成" : "标记完成"}
                  onClick={() => toggleDone(item.id)}
                >
                  {item.state === "done" ? (
                    <Check size={16} aria-hidden="true" />
                  ) : (
                    <Circle size={16} aria-hidden="true" />
                  )}
                </button>
                <button type="button" className="item-content" onClick={() => openEdit(item)}>
                  <h2>{item.title}</h2>
                  <p>
                    {formatItemTime(item)} · {item.calendar}
                  </p>
                </button>
              </article>
            ))}
          </div>
        </aside>
        )}
      </section>

      {editor && (
        <div className="editor-backdrop" role="presentation">
          <form className="editor-sheet" onSubmit={saveDraft} aria-label="任务编辑">
            <div className="editor-head">
              <div>
                <span className="eyebrow">{editor.mode === "create" ? "新增" : "编辑"}</span>
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
                  <option value="Work">Work</option>
                  <option value="Focus">Focus</option>
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
        <div className="editor-backdrop" role="presentation">
          <section className="settings-sheet" aria-label="设置">
            <div className="editor-head">
              <div>
                <span className="eyebrow">设置</span>
                <h2>桌面面板</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭设置"
                onClick={() => setShowSettings(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <label className="setting-block">
              <span>面板透明度</span>
              <strong>{opacity}%</strong>
              <input
                type="range"
                min="68"
                max="100"
                value={opacity}
                onChange={(event) => setOpacity(Number(event.target.value))}
                aria-label="调整面板透明度"
              />
            </label>

            <div className="setting-block">
              <span>默认视图</span>
              <div className="pin-options">
                {(["month", "week", "day"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={viewMode === mode ? "active" : ""}
                    onClick={() => setViewMode(mode)}
                  >
                    {mode === "month" ? "月" : mode === "week" ? "周" : "日"}
                  </button>
                ))}
              </div>
              <p>视图切换属于低频操作，默认放在设置里，主界面优先留给日历。</p>
            </div>

            <div className="setting-block">
              <span>固定方式</span>
              <div className="pin-options">
                <button
                  type="button"
                  className={pinMode === "desktop" ? "active" : ""}
                  onClick={() => updatePinMode("desktop")}
                >
                  固定桌面
                </button>
                <button
                  type="button"
                  className={pinMode === "normal" ? "active" : ""}
                  onClick={() => updatePinMode("normal")}
                >
                  普通窗口
                </button>
                <button
                  type="button"
                  className={pinMode === "top" ? "active" : ""}
                  onClick={() => updatePinMode("top")}
                >
                  置顶
                </button>
              </div>
              <p>
                真实桌面贴附需要在 Tauri 壳里继续验证 Windows 窗口层级；当前先保留用户可见的固定方式入口。
              </p>
            </div>

            <div className="setting-block">
              <span>工具条位置</span>
              <div className="pin-options">
                <button
                  type="button"
                  className={toolRailSide === "left" ? "active" : ""}
                  onClick={() => setToolRailSide("left")}
                >
                  左侧
                </button>
                <button
                  type="button"
                  className={toolRailSide === "right" ? "active" : ""}
                  onClick={() => setToolRailSide("right")}
                >
                  右侧
                </button>
              </div>
              <p>日历贴在屏幕右侧时，建议把工具条放左侧；贴在屏幕左侧时可放右侧。</p>
            </div>

            <div className="setting-block">
              <span>本地数据</span>
              <button className="danger-action standalone" type="button" onClick={resetLocalData}>
                恢复示例数据
              </button>
              <p>当前 MVP 使用本地浏览器存储保存任务和设置，后续会迁移到 SQLite。</p>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
