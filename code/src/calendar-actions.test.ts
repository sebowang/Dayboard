import { describe, expect, it, vi } from "vitest";
import { applyCalendarSource, getPreferredCalendarSource, rescheduleItem } from "./calendar-actions";
import type { CalendarSource, DayboardItem, DraftItem } from "./storage";

const localSource: CalendarSource = {
  id: "local",
  provider: "local",
  name: "本地日历",
  accountLabel: "Dayboard",
  writable: true,
  visible: true,
};

const googleSource: CalendarSource = {
  id: "google:primary@example.com",
  provider: "google",
  remoteId: "primary@example.com",
  name: "我的日历",
  accountLabel: "Google",
  primary: true,
  writable: true,
  visible: true,
  color: "#4285f4",
};

const googleItem: DayboardItem = {
  id: "gcal-primary-event-1",
  remoteId: "event-1",
  title: "客户会议",
  date: "2026-07-20",
  start: "10:00",
  end: "11:00",
  kind: "event",
  state: "open",
  calendar: "Gmail",
  calendarId: "primary@example.com",
  calendarLabel: "我的日历",
  note: "确认方案",
};

describe("rescheduleItem", () => {
  it("updates Google before returning the new local date", async () => {
    const updateRemote = vi.fn().mockResolvedValue(undefined);

    const updated = await rescheduleItem(googleItem, "2026-07-23", updateRemote);

    expect(updateRemote).toHaveBeenCalledWith("primary@example.com", "event-1", {
      title: "客户会议",
      date: "2026-07-23",
      start: "10:00",
      end: "11:00",
      allDay: undefined,
      note: "确认方案",
    });
    expect(updated).toEqual({ ...googleItem, date: "2026-07-23" });
  });

  it("rejects without returning a new date when the Google update fails", async () => {
    const updateRemote = vi.fn().mockRejectedValue(new Error("network unavailable"));

    await expect(rescheduleItem(googleItem, "2026-07-23", updateRemote)).rejects.toThrow("network unavailable");
    expect(updateRemote).toHaveBeenCalledTimes(1);
    expect(googleItem.date).toBe("2026-07-20");
  });
});

describe("getPreferredCalendarSource", () => {
  it("restores the last successfully used writable calendar", () => {
    const previous = { ...googleSource, id: "google:work@example.com", remoteId: "work@example.com", name: "工作" };

    expect(getPreferredCalendarSource([localSource, googleSource, previous], previous.id)).toBe(previous);
  });

  it("uses the connected primary Google calendar before local for a first event", () => {
    const source = getPreferredCalendarSource([localSource, googleSource]);
    const draft = applyCalendarSource({
      title: "",
      date: "2026-07-23",
      start: "",
      end: "",
      kind: "task",
      state: "open",
      calendar: "Local",
      calendarId: "local",
      note: "",
    } satisfies DraftItem, source!);

    expect(source).toBe(googleSource);
    expect(draft).toMatchObject({ calendar: "Gmail", calendarId: "primary@example.com", calendarLabel: "我的日历" });
  });
});
