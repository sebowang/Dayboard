import { updateGoogleEvent } from "./sync/google";
import type { CalendarSource, DayboardItem, DraftItem } from "./storage";

type GoogleEventUpdater = typeof updateGoogleEvent;

export const getPreferredCalendarSource = (
  sources: CalendarSource[],
  preferredSourceId?: string,
): CalendarSource | undefined => {
  const writableSources = sources.filter((source) => source.writable);
  return writableSources.find((source) => source.id === preferredSourceId)
    ?? writableSources.find((source) => source.provider === "google" && source.primary)
    ?? writableSources.find((source) => source.provider === "google")
    ?? writableSources.find((source) => source.provider === "local")
    ?? writableSources[0];
};

export const applyCalendarSource = (draft: DraftItem, source: CalendarSource): DraftItem => ({
  ...draft,
  calendar: source.provider === "google" ? "Gmail" : source.provider === "outlook" ? "Outlook" : "Local",
  calendarId: source.remoteId ?? source.id,
  calendarLabel: source.name,
  calendarColor: source.color,
});

export const getCalendarSourceId = (draft: DraftItem, sources: CalendarSource[]): string | undefined => {
  const provider = draft.calendar === "Gmail" ? "google" : draft.calendar === "Outlook" ? "outlook" : "local";
  return sources.find((source) => source.provider === provider && (source.remoteId ?? source.id) === draft.calendarId)?.id;
};

export const rescheduleItem = async (
  item: DayboardItem,
  nextDate: string,
  updateRemote: GoogleEventUpdater = updateGoogleEvent,
): Promise<DayboardItem> => {
  if (item.date === nextDate) return item;

  if (item.calendar === "Gmail") {
    if (!item.remoteId) throw new Error("这条 Google 日程缺少远端 ID，无法移动。请重新同步后再试。");
    await updateRemote(item.calendarId ?? "primary", item.remoteId, {
      title: item.title,
      date: nextDate,
      start: item.start || undefined,
      end: item.end || undefined,
      allDay: item.allDay,
      note: item.note || undefined,
    });
  }

  return { ...item, date: nextDate };
};
