import type { DayboardItem } from "./storage";

export type ReminderDelivery = Record<string, number>;

export const REMINDER_DELIVERIES_KEY = "dayboard.reminders.v1.delivered";
const REMINDER_GRACE_MS = 5 * 60 * 1000;

export type DueReminder = {
  item: DayboardItem;
  key: string;
  triggerAt: number;
};

const getEventStart = (item: DayboardItem): Date | null => {
  const [year, month, day] = item.date.split("-").map(Number);
  if (!year || !month || !day) return null;
  const [hour, minute] = item.allDay || !item.start ? [9, 0] : item.start.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getReminderTrigger = (item: DayboardItem): number | null => {
  if (item.kind !== "event" || !Number.isInteger(item.reminderMinutes) || item.reminderMinutes! < 0) return null;
  const eventStart = getEventStart(item);
  return eventStart ? eventStart.getTime() - item.reminderMinutes! * 60 * 1000 : null;
};

export const getDueReminders = (
  items: DayboardItem[],
  delivered: ReminderDelivery,
  now = Date.now(),
): DueReminder[] => items.flatMap((item) => {
  const triggerAt = getReminderTrigger(item);
  if (!triggerAt || triggerAt > now || now - triggerAt > REMINDER_GRACE_MS) return [];
  const key = `${item.id}:${triggerAt}`;
  return delivered[key] ? [] : [{ item, key, triggerAt }];
});

export const loadReminderDeliveries = (): ReminderDelivery => {
  try {
    const stored = JSON.parse(localStorage.getItem(REMINDER_DELIVERIES_KEY) ?? "{}");
    return stored && typeof stored === "object" ? stored as ReminderDelivery : {};
  } catch {
    return {};
  }
};

export const saveReminderDeliveries = (deliveries: ReminderDelivery): void => {
  try {
    localStorage.setItem(REMINDER_DELIVERIES_KEY, JSON.stringify(deliveries));
  } catch {
    // Notifications should still work for the current session if local storage is unavailable.
  }
};

export const clearReminderDeliveries = (): void => {
  try {
    localStorage.removeItem(REMINDER_DELIVERIES_KEY);
  } catch {
    // Resetting the board should continue even when local storage is unavailable.
  }
};
