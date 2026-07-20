import { describe, it, expect, beforeEach } from "vitest";
import {
  loadItems,
  loadCalendarSources,
  saveItems,
  saveCalendarSources,
  loadSettings,
  saveSettings,
  resetToSeedItems,
  seedItems,
  defaultSettings,
  STORAGE_KEYS,
  localCalendarSource,
} from "./storage";
import type { DayboardItem, AppSettings, CalendarSource } from "./storage";

// Mock localStorage
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
};

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

beforeEach(() => {
  store.clear();
});

describe("loadItems", () => {
  it("returns seed items when storage is empty", () => {
    const items = loadItems();
    expect(items).toEqual(seedItems);
    expect(items.length).toBeGreaterThan(0);
  });

  it("returns saved items", () => {
    const custom: DayboardItem[] = [
      { id: "1", title: "Test", date: "2026-07-11", start: "", end: "", kind: "task", state: "open", calendar: "Local", note: "" },
    ];
    saveItems(custom);
    const items = loadItems();
    expect(items).toEqual(custom);
  });

  it("falls back to seed items on corrupt data", () => {
    store.set(STORAGE_KEYS.items, "not-json");
    const items = loadItems();
    expect(items).toEqual(seedItems);
  });

  it("falls back to seed items on non-array data", () => {
    store.set(STORAGE_KEYS.items, '{"x": 1}');
    const items = loadItems();
    expect(items).toEqual(seedItems);
  });

  it("filters out items missing required fields", () => {
    const valid: DayboardItem = { id: "1", title: "Good", date: "2026-07-11", start: "", end: "", kind: "task", state: "open", calendar: "Local", note: "" };
    const bad1 = { id: 123, title: "Bad", date: "2026-07-11", start: "", end: "", kind: "task", state: "open", calendar: "Local", note: "" };
    const bad2 = { id: "2", date: "2026-07-11", start: "", end: "", kind: "task", state: "open", calendar: "Local", note: "" };
    const bad3 = { id: "3", title: "Bad", date: "2026-07-11", start: "", end: "", kind: "invalid", state: "open", calendar: "Local", note: "" };
    saveItems([valid, bad1 as any, bad2 as any, bad3 as any]);
    const items = loadItems();
    expect(items).toEqual([valid]);
  });

  it("falls back to seed items when all items are invalid", () => {
    const bad = { id: 1, title: "Bad", date: "2026-07-11" };
    saveItems([bad as any]);
    expect(loadItems()).toEqual(seedItems);
  });
});

describe("saveItems", () => {
  it("persists items to storage", () => {
    const items: DayboardItem[] = [
      { id: "a", title: "A", date: "2026-07-11", start: "", end: "", kind: "task", state: "open", calendar: "Local", note: "" },
    ];
    saveItems(items);
    expect(store.get(STORAGE_KEYS.items)).toBe(JSON.stringify(items));
  });

  it("round-trips correctly", () => {
    const items: DayboardItem[] = [
      { id: "x", title: "X", date: "2026-07-12", start: "", end: "", allDay: true, kind: "event", state: "open", calendar: "Gmail", note: "hello" },
    ];
    saveItems(items);
    expect(loadItems()).toEqual(items);
  });
});

describe("loadSettings", () => {
  it("returns defaults when storage is empty", () => {
    const settings = loadSettings();
    expect(settings.widgetMode).toBe("month");
    expect(settings.opacity).toBe(88);
    expect(settings.pinMode).toBe("desktop");
  });

  it("merges saved values over defaults", () => {
    const custom = { ...defaultSettings, opacity: 50, themeMode: "light" as const };
    saveSettings(custom);
    const loaded = loadSettings();
    expect(loaded.opacity).toBe(50);
    expect(loaded.themeMode).toBe("light");
    expect(loaded.widgetMode).toBe("month"); // still default
  });

  it("restores the last used calendar source for new events", () => {
    saveSettings({ ...defaultSettings, defaultCalendarSourceId: "google:work@example.com" });

    expect(loadSettings().defaultCalendarSourceId).toBe("google:work@example.com");
  });

  it("normalizes unknown widgetMode", () => {
    store.set(STORAGE_KEYS.settings, JSON.stringify({ widgetMode: "biweek" }));
    expect(loadSettings().widgetMode).toBe("month"); // unknown → default
  });

  it("normalizes unknown themeMode", () => {
    store.set(STORAGE_KEYS.settings, JSON.stringify({ themeMode: "blue" }));
    expect(loadSettings().themeMode).toBe("dark");
  });

  it("falls back to defaults on corrupt data", () => {
    store.set(STORAGE_KEYS.settings, "bad");
    expect(loadSettings()).toEqual(defaultSettings);
  });
});

describe("saveSettings", () => {
  it("persists settings", () => {
    const s = { ...defaultSettings, opacity: 42 };
    saveSettings(s);
    expect(store.get(STORAGE_KEYS.settings)).toBe(JSON.stringify(s));
  });

  it("round-trips correctly", () => {
    const s: AppSettings = { ...defaultSettings, widgetMode: "week", opacity: 70 };
    saveSettings(s);
    const loaded = loadSettings();
    expect(loaded.widgetMode).toBe("week");
    expect(loaded.opacity).toBe(70);
  });
});

describe("resetToSeedItems", () => {
  it("overwrites storage with seed items", () => {
    saveItems([{ id: "z", title: "Z", date: "2026-07-11", start: "", end: "", kind: "task", state: "open", calendar: "Local", note: "" }]);
    const result = resetToSeedItems();
    expect(result).toEqual(seedItems);
    expect(loadItems()).toEqual(seedItems);
  });
});

describe("calendar sources", () => {
  it("starts with the local calendar", () => {
    expect(loadCalendarSources()).toEqual([localCalendarSource]);
  });

  it("persists calendar visibility and restores the local source first", () => {
    const sources: CalendarSource[] = [
      { ...localCalendarSource, visible: false },
      {
        id: "google:team@example.com",
        provider: "google",
        remoteId: "team@example.com",
        name: "团队日历",
        accountLabel: "Google",
        writable: true,
        visible: false,
      },
    ];
    saveCalendarSources(sources);
    expect(loadCalendarSources()).toEqual(sources);
  });

  it("falls back to the local calendar when stored sources are corrupt", () => {
    store.set(STORAGE_KEYS.calendars, "bad");
    expect(loadCalendarSources()).toEqual([localCalendarSource]);
  });
});
