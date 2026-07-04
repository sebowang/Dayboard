document.addEventListener("DOMContentLoaded", () => {
  const viewSwitches = document.querySelectorAll("[data-view-switch]");
  const glancePanel = document.querySelector("[data-glance-panel]");
  const glanceToggle = document.querySelector("[data-glance-toggle]");
  const widgetShell = document.querySelector("[data-widget-shell]");
  const periodLabel = document.querySelector("[data-period-label]");
  const calendarCells = document.querySelectorAll(".calendar-cell");
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const dayTasks = {
    "2026-05-26": [{ title: "月末归档", source: "Local", type: "task" }],
    "2026-05-27": [{ title: "预留空档", source: "Local", type: "task" }],
    "2026-06-01": [{ title: "周计划回顾", source: "Local", type: "task", status: "done" }],
    "2026-06-02": [{ time: "09:00", title: "同步邮件", source: "Gmail", type: "event" }],
    "2026-06-03": [
      { time: "10:30", title: "设计评审", source: "Outlook", type: "event", priority: "next" },
      { title: "整理反馈", source: "Local", type: "task" }
    ],
    "2026-06-04": [{ title: "留白处理", source: "Local", type: "task" }],
    "2026-06-05": [{ time: "13:00", title: "客户会议", source: "Gmail", type: "event" }],
    "2026-06-06": [{ title: "周报补全", source: "Local", type: "task" }],
    "2026-06-07": [{ title: "整理桌面", source: "Local", type: "task", status: "done" }],
    "2026-06-08": [
      { time: "09:30", title: "校准排期", source: "Outlook", type: "event", priority: "next" },
      { time: "14:00", title: "设计评审", source: "Gmail", type: "event" },
      { time: "18:30", title: "回顾", source: "Local", type: "task", status: "done" }
    ],
    "2026-06-09": [{ time: "11:00", title: "团队同步", source: "Outlook", type: "event" }],
    "2026-06-10": [
      { time: "09:30", title: "周中排期校准", source: "Outlook", type: "event", priority: "next" },
      { time: "11:30", title: "检查双周空档", source: "Local", type: "task" },
      { time: "14:00", title: "贴片视觉微调", source: "Local", type: "task" }
    ],
    "2026-06-11": [{ time: "15:00", title: "留白处理", source: "Local", type: "task" }],
    "2026-06-12": [
      { time: "10:00", title: "客户会议", source: "Gmail", type: "event" },
      { time: "13:00", title: "方案确认", source: "Local", type: "task" },
      { time: "16:00", title: "复盘", source: "Outlook", type: "event" }
    ],
    "2026-06-13": [{ title: "轻整理", source: "Local", type: "task" }],
    "2026-06-14": [{ title: "留白处理", source: "Local", type: "task" }],
    "2026-06-15": [{ time: "10:00", title: "周会", source: "Outlook", type: "event" }],
    "2026-06-16": [
      { title: "需求整理", source: "Local", type: "task" },
      { title: "邮件回复", source: "Gmail", type: "task" }
    ],
    "2026-06-17": [{ title: "专注空档", source: "Local", type: "task" }],
    "2026-06-18": [{ title: "同步会议", source: "Outlook", type: "event" }],
    "2026-06-19": [{ title: "集中处理", source: "Local", type: "task", span: "2d" }],
    "2026-06-20": [{ title: "保持空白", source: "Local", type: "task" }],
    "2026-06-21": [{ title: "保持空白", source: "Local", type: "task" }],
    "2026-06-22": [
      { time: "09:00", title: "今日排期", source: "Outlook", type: "event", priority: "next" },
      { title: "产品对齐", source: "Gmail", type: "task" },
      { title: "回顾摘要", source: "Local", type: "task", status: "done" }
    ],
    "2026-06-23": [{ title: "整理反馈", source: "Local", type: "task" }],
    "2026-06-24": [{ time: "14:30", title: "同步评审", source: "Outlook", type: "event" }],
    "2026-06-25": [{ title: "月底回顾", source: "Local", type: "task" }],
    "2026-06-26": [{ title: "待办收尾", source: "Local", type: "task" }],
    "2026-06-27": [{ title: "任务归档", source: "Local", type: "task" }],
    "2026-06-28": [{ title: "预留空档", source: "Local", type: "task" }],
    "2026-06-29": [{ title: "预留空档", source: "Local", type: "task" }],
    "2026-06-30": [{ title: "月末整理", source: "Local", type: "task", status: "done" }],
    "2026-07-01": [{ title: "新月预告", source: "Local", type: "task" }],
    "2026-07-02": [{ title: "轻整理", source: "Local", type: "task" }],
    "2026-07-03": [{ time: "10:00", title: "下月同步", source: "Outlook", type: "event" }],
    "2026-07-04": [{ title: "回顾", source: "Local", type: "task" }],
    "2026-07-05": [{ title: "待补任务", source: "Local", type: "task" }],
    "2026-07-06": [{ title: "待补任务", source: "Local", type: "task" }]
  };

  const normalizeDateKey = (value) => {
    if (!value) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const day = Number(value);
    if (Number.isNaN(day)) return value;
    if (day >= 26) return `2026-05-${String(day).padStart(2, "0")}`;
    if (day >= 22) return `2026-06-${String(day).padStart(2, "0")}`;
    return `2026-06-${String(day).padStart(2, "0")}`;
  };

  const getCellDate = (cell) => normalizeDateKey(cell.dataset.date || cell.querySelector(".calendar-cell__day")?.textContent?.trim());

  const normalizeTask = (task) => {
    if (typeof task === "string") {
      const time = task.match(/^\d{2}:\d{2}/)?.[0];
      return { time, title: task.replace(/^\d{2}:\d{2}\s*/, ""), source: "Local", type: time ? "event" : "task" };
    }
    return task;
  };

  const taskLabel = (task) => [task.time, task.title].filter(Boolean).join(" ");

  const sourceClass = (source = "Local") => source.toLowerCase().replace(/\s+/g, "-");

  let selectedDate = "2026-06-10";
  let draggedTask = null;

  const setDrawerState = (isOpen) => {
    if (!widgetShell || !glancePanel || !glanceToggle) return;
    widgetShell.classList.toggle("widget-shell--drawer-open", isOpen);
    widgetShell.classList.toggle("widget-shell--drawer-closed", !isOpen);
    glancePanel.hidden = !isOpen;
    glanceToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  };

  const formatDayLabel = (dateKey) => {
    const date = new Date(`${dateKey}T00:00:00`);
    const month = date.toLocaleString("en-US", { month: "short" });
    return `${month} ${date.getDate()} · ${weekdayNames[date.getDay()]}`;
  };

  const renderTaskCard = (task, index) => {
    const taskClass = [
      "event-card",
      "event-card--glance",
      task.type === "event" ? "event-card--event" : "event-card--task",
      task.status === "done" ? "event-card--done" : "",
      task.priority === "next" ? "event-card--next" : "",
      task.span ? "event-card--span" : ""
    ].filter(Boolean).join(" ");

    const timeLabel = task.time || (task.type === "task" ? "TASK" : "EVENT");
    const metaParts = [task.source, task.type === "event" ? "日程" : "任务", task.span ? `跨 ${task.span}` : "", task.status === "done" ? "已完成" : ""].filter(Boolean);
    const sourceAttr = sourceClass(task.source);
    const metaLabel = metaParts.join(" · ");

    return `
      <article class="${taskClass}" draggable="true" data-task-title="${taskLabel(task)}" data-task-source="${sourceAttr}" data-task-status="${task.status || ""}" data-task-type="${task.type || "task"}">
        <p class="event-time">${timeLabel}</p>
        <h3>${task.title}</h3>
        <p class="event-meta" data-source="${task.source}">${metaLabel}</p>
      </article>
    `;
  };

  const renderGlance = (dateKey) => {
    if (!glancePanel) return;
    const tasks = (dayTasks[dateKey] || [{ title: "保持空白", source: "Local", type: "task" }]).map(normalizeTask);
    const title = glancePanel.querySelector("[data-glance-date]");
    const stack = glancePanel.querySelector("[data-glance-stack]");
    if (title) title.textContent = formatDayLabel(dateKey);
    if (!stack) return;

    stack.innerHTML = tasks.map((task, index) => renderTaskCard(task, index)).join("");
  };

  const selectDay = (cell, { openDrawer = false } = {}) => {
    const dateKey = getCellDate(cell);
    if (!dateKey) return;
    selectedDate = dateKey;
    calendarCells.forEach((item) => item.classList.toggle("calendar-cell--selected", getCellDate(item) === dateKey));
    if (periodLabel) periodLabel.textContent = formatDayLabel(dateKey);
    renderGlance(dateKey);
    if (openDrawer) setDrawerState(true);
  };

  const moveTaskToCell = (cell, taskTitle) => {
    const dateKey = getCellDate(cell);
    const taskList = cell.querySelector(".calendar-cell__tasks");
    const bars = cell.querySelector(".calendar-cell__bars");
    if (!dateKey) return;

    const task = { title: taskTitle.replace(/^\d{2}:\d{2}\s*/, ""), source: "Local", type: taskTitle.match(/^\d{2}:\d{2}/) ? "event" : "task" };
    dayTasks[dateKey] = [...(dayTasks[dateKey] || []), task];
    if (taskList) {
      const item = document.createElement("em");
      item.textContent = task.time ? `${task.time} ${task.title}`.trim() : task.title;
      taskList.append(item);
    } else if (bars) {
      const bar = document.createElement("i");
      bar.className = "level-2";
      bars.append(bar);
    } else {
      const newBars = document.createElement("span");
      newBars.className = "calendar-cell__bars";
      newBars.innerHTML = '<i class="level-2"></i>';
      cell.append(newBars);
    }
    cell.classList.add("calendar-cell--drop-confirmed");
    window.setTimeout(() => cell.classList.remove("calendar-cell--drop-confirmed"), 900);
  };

  calendarCells.forEach((cell) => {
    cell.addEventListener("click", () => selectDay(cell, { openDrawer: false }));
    cell.addEventListener("dragover", (event) => {
      if (!draggedTask) return;
      event.preventDefault();
      cell.classList.add("calendar-cell--drop-target");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("calendar-cell--drop-target"));
    cell.addEventListener("drop", (event) => {
      if (!draggedTask) return;
      event.preventDefault();
      cell.classList.remove("calendar-cell--drop-target");
      moveTaskToCell(cell, draggedTask);
      selectDay(cell, { openDrawer: true });
      draggedTask = null;
    });
  });

  if (glancePanel) {
    glancePanel.addEventListener("dragstart", (event) => {
      const card = event.target.closest("[data-task-title]");
      if (!card) return;
      draggedTask = card.dataset.taskTitle;
      card.classList.add("is-dragging");
    });
    glancePanel.addEventListener("dragend", (event) => {
      event.target.closest("[data-task-title]")?.classList.remove("is-dragging");
      draggedTask = null;
    });
  }

  if (glanceToggle) {
    glanceToggle.addEventListener("click", () => {
      const expanded = glanceToggle.getAttribute("aria-expanded") === "true";
      renderGlance(selectedDate);
      setDrawerState(!expanded);
    });
  }

  viewSwitches.forEach((switchRoot) => {
    const buttons = switchRoot.querySelectorAll("[data-view-target]");
    const scope = switchRoot.closest(".panel") || document;
    const panels = scope.querySelectorAll("[data-view-panel]");

    const syncLayout = (target) => {
      document.body.dataset.currentView = target;
      setDrawerState(false);
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.viewTarget;
        buttons.forEach((item) => item.classList.toggle("is-active", item === button));
        panels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.viewPanel === target));
        syncLayout(target);
      });
    });

    const activeButton = switchRoot.querySelector(".is-active") || buttons[0];
    if (activeButton?.dataset.viewTarget) syncLayout(activeButton.dataset.viewTarget);
  });

  renderGlance(selectedDate);
  setDrawerState(false);
});

