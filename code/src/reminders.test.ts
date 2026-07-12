import { describe, expect, it } from "vitest";
import { getDueReminders, getReminderTrigger } from "./reminders";
import type { DayboardItem } from "./storage";

const event = (overrides: Partial<DayboardItem> = {}): DayboardItem => ({
  id: "event-1",
  title: "产品评审",
  date: "2026-07-13",
  start: "10:00",
  end: "11:00",
  kind: "event",
  state: "open",
  calendar: "Local",
  note: "",
  reminderMinutes: 15,
  ...overrides,
});

describe("reminder scheduling", () => {
  it("calculates a timed event reminder relative to the start", () => {
    expect(getReminderTrigger(event())).toBe(new Date(2026, 6, 13, 9, 45).getTime());
  });

  it("uses 09:00 as the all-day reminder baseline", () => {
    expect(getReminderTrigger(event({ allDay: true, start: "", end: "", reminderMinutes: 30 })))
      .toBe(new Date(2026, 6, 13, 8, 30).getTime());
  });

  it("only returns due reminders once within the grace period", () => {
    const item = event();
    const triggerAt = getReminderTrigger(item)!;
    const due = getDueReminders([item], {}, triggerAt + 60_000);
    expect(due).toHaveLength(1);
    expect(getDueReminders([item], { [due[0].key]: triggerAt }, triggerAt + 60_000)).toHaveLength(0);
    expect(getDueReminders([item], {}, triggerAt + 6 * 60_000)).toHaveLength(0);
  });
});
