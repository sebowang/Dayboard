document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-segmented]").forEach((group) => {
    group.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        group.querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
      });
    });
  });

  document.querySelectorAll("[data-toggle]").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      toggle.classList.toggle("is-on");
      toggle.setAttribute("aria-pressed", toggle.classList.contains("is-on") ? "true" : "false");
    });
  });

  document.querySelectorAll("[data-sync-button]").forEach((button) => {
    button.addEventListener("click", () => {
      const original = button.textContent;
      button.textContent = "Syncing…";
      button.disabled = true;
      window.setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
      }, 900);
    });
  });

  document.querySelectorAll("[data-retry-sync]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest(".sync-alert");
      if (!row) return;
      row.style.background = "rgba(117, 213, 232, 0.08)";
      row.style.borderColor = "rgba(117, 213, 232, 0.18)";
      row.querySelector("p").textContent = "正在重新同步 Outlook 任务列表。";
      button.textContent = "Retrying…";
      window.setTimeout(() => {
        row.querySelector("p").textContent = "Outlook 任务列表已重新进入同步队列。";
        button.textContent = "已重试";
      }, 800);
    });
  });

  const opacityRange = document.querySelector("[data-opacity-range]");
  const opacityValue = document.querySelector("[data-opacity-value]");
  if (opacityRange && opacityValue) {
    const sync = () => {
      opacityValue.textContent = `${opacityRange.value}%`;
    };
    opacityRange.addEventListener("input", sync);
    sync();
  }

  const previewShell = document.querySelector("[data-preview-shell]");
  const previewToggle = document.querySelector("[data-preview-toggle]");
  if (previewShell && previewToggle) {
    previewToggle.addEventListener("click", () => {
      const next = !previewShell.classList.contains("is-open");
      previewShell.classList.toggle("is-open", next);
      previewToggle.textContent = next ? "隐藏任务面板" : "展开任务面板";
    });
  }
});
