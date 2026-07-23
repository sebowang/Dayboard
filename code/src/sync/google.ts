// Google Calendar sync module for Dayboard
// OAuth 2.0 with PKCE (S256). code_verifier is stored in sessionStorage
// keyed by a random stateId; only the stateId goes into the OAuth URL.

import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../tauri-runtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  summary: string;
  status: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  calendarId?: string;
  calendarSummary?: string;
}

export interface CalendarEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
}

interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

// ---------------------------------------------------------------------------
// OAuth configuration (from VITE_ env vars — see .env)
// ---------------------------------------------------------------------------

export const GOOGLE_AUTH_CONFIG = {
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || "",
  clientSecret: import.meta.env.VITE_GOOGLE_CLIENT_SECRET || "",
  redirectUri: "http://127.0.0.1:1421/oauth/google/callback",
  scopes: [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  ],
  authEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
} as const;

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

export class GoogleSyncError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GoogleSyncError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Logger — writes to console + a localStorage ring buffer for UI diag
// ---------------------------------------------------------------------------

const LOG_KEY = "dayboard.google.v1.last_log";

function oauthLog(step: string, detail?: unknown): void {
  const ts = new Date().toISOString().slice(11, 19);
  const entry = `[${ts}] ${step}`;
  console.log(entry, detail ?? "");
  try {
    const prev = localStorage.getItem(LOG_KEY) ?? "";
    const lines = (prev + entry).split("\n");
    // Cap at 50 most recent lines
    localStorage.setItem(LOG_KEY, lines.slice(-50).join("\n") + "\n");
  } catch { /* noop */ }
}

export function readOauthLog(): string {
  try { return localStorage.getItem(LOG_KEY) ?? ""; } catch { return ""; }
}

export function clearOauthLog(): void {
  try { localStorage.removeItem(LOG_KEY); } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// localStorage helpers (prefix: dayboard.google.v1.)
// ---------------------------------------------------------------------------

const LS_PREFIX = "dayboard.google.v1.";

function lsGet(key: string): string | null {
  return localStorage.getItem(LS_PREFIX + key);
}
function lsSet(key: string, value: string): void {
  localStorage.setItem(LS_PREFIX + key, value);
}
function lsRemove(key: string): void {
  localStorage.removeItem(LS_PREFIX + key);
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateCodeVerifier(): string {
  const raw = new Uint8Array(64);
  crypto.getRandomValues(raw);
  return base64UrlEncode(raw).slice(0, 128);
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

let cachedTokenSet: TokenSet | null | undefined;

async function readTokenSet(): Promise<TokenSet | null> {
  if (cachedTokenSet !== undefined) return cachedTokenSet;
  if (isTauriRuntime()) {
    const stored = await invoke<string | null>("load_google_tokens");
    if (stored) {
      try {
        cachedTokenSet = JSON.parse(stored) as TokenSet;
        return cachedTokenSet;
      } catch {
        cachedTokenSet = null;
        return null;
      }
    }
    // One-time migration for tokens created by earlier Dayboard builds.
    const legacy = lsGet("token_set");
    if (legacy) {
      try {
        const tokens = JSON.parse(legacy) as TokenSet;
        await invoke("store_google_tokens", { tokens: JSON.stringify(tokens) });
        lsRemove("token_set");
        cachedTokenSet = tokens;
        return tokens;
      } catch {
        // Invalid legacy data must not be copied into native storage.
      }
    }
    cachedTokenSet = null;
    return null;
  }
  const raw = lsGet("token_set");
  cachedTokenSet = raw ? JSON.parse(raw) as TokenSet : null;
  return cachedTokenSet;
}
async function saveTokenSet(tokens: TokenSet): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("store_google_tokens", { tokens: JSON.stringify(tokens) });
  } else {
    lsSet("token_set", JSON.stringify(tokens));
  }
  cachedTokenSet = tokens;
}
async function clearTokenSet(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("clear_google_tokens");
  } else {
    lsRemove("token_set");
  }
  cachedTokenSet = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const OAUTH_STATE_PREFIX = "dayboard.oauth.";

export async function getAuthUrl(): Promise<string> {
  oauthLog("getAuthUrl: generating code_verifier");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await sha256Base64Url(codeVerifier);

  // Store verifier in sessionStorage under a random key.
  // Only the random stateId goes into the URL — the secret stays local.
  const stateId = crypto.randomUUID();
  try { sessionStorage.setItem(OAUTH_STATE_PREFIX + stateId, codeVerifier); } catch {}

  const params = new URLSearchParams({
    client_id: GOOGLE_AUTH_CONFIG.clientId,
    redirect_uri: GOOGLE_AUTH_CONFIG.redirectUri,
    response_type: "code",
    scope: GOOGLE_AUTH_CONFIG.scopes.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: stateId,
    access_type: "offline",
    prompt: "consent",
  });

  oauthLog("getAuthUrl: auth URL built, redirectUri=" + GOOGLE_AUTH_CONFIG.redirectUri);
  return `${GOOGLE_AUTH_CONFIG.authEndpoint}?${params.toString()}`;
}

export async function handleAuthCallback(url: string): Promise<void> {
  oauthLog("handleAuthCallback START");

  const parsed = new URL(url);
  const error = parsed.searchParams.get("error");
  const code = parsed.searchParams.get("code");
  const stateId = parsed.searchParams.get("state");

  oauthLog("handleAuthCallback: error=" + error + ", hasCode=" + !!code + ", hasState=" + !!stateId);

  if (error) {
    oauthLog("handleAuthCallback: Google returned error: " + error);
    throw new GoogleSyncError("AUTH_ERROR", `OAuth error: ${error}`);
  }
  if (!code) {
    oauthLog("handleAuthCallback: NO_CODE");
    throw new GoogleSyncError("NO_CODE", "No authorization code in callback URL");
  }
  if (!stateId) {
    oauthLog("handleAuthCallback: missing state param (CSRF)");
    throw new GoogleSyncError("NO_VERIFIER", "Missing state parameter — possible CSRF attack");
  }

  // Retrieve code_verifier from sessionStorage using the stateId as key.
  // The verifier was never in the URL — this prevents logging leakage and CSRF.
  const codeVerifier = (() => { try { return sessionStorage.getItem(OAUTH_STATE_PREFIX + stateId); } catch { return null; } })();
  try { sessionStorage.removeItem(OAUTH_STATE_PREFIX + stateId); } catch {}

  if (!codeVerifier) {
    oauthLog("handleAuthCallback: no verifier for stateId (expired or forged)");
    throw new GoogleSyncError("NO_VERIFIER", "Session expired or invalid state — re-authenticate.");
  }
  oauthLog("handleAuthCallback: code_verifier retrieved from sessionStorage, len=" + codeVerifier.length);

  oauthLog("handleAuthCallback: exchanging code for token...");
  const response = await fetch(GOOGLE_AUTH_CONFIG.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_AUTH_CONFIG.clientId,
      client_secret: GOOGLE_AUTH_CONFIG.clientSecret,
      redirect_uri: GOOGLE_AUTH_CONFIG.redirectUri,
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
    }),
  });

  oauthLog("handleAuthCallback: token exchange status=" + response.status);
  if (!response.ok) {
    const text = await response.text();
    oauthLog("handleAuthCallback: TOKEN EXCHANGE FAILED body=" + text);
    throw new GoogleSyncError("TOKEN_EXCHANGE_FAILED", text);
  }

  const data = await response.json();
  oauthLog("handleAuthCallback: TOKEN OK, has_access_token=" + !!data.access_token + ", has_refresh=" + !!data.refresh_token);

  // Google may omit refresh_token when the user re-authorizes an account. Keep
  // the prior one so a successful re-authorization cannot turn a durable
  // session into an access-token-only session.
  const existingTokens = await readTokenSet();
  const refreshToken = data.refresh_token ?? existingTokens?.refresh_token;
  if (!refreshToken) {
    throw new GoogleSyncError(
      "NO_REFRESH_TOKEN",
      "Google did not return a refresh token. Remove Dayboard from your Google Account permissions, then reconnect.",
    );
  }

  await saveTokenSet({
    access_token: data.access_token,
    refresh_token: refreshToken,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  oauthLog("handleAuthCallback: token_set stored securely");
}

let _refreshPromise: Promise<TokenSet> | null = null;

export async function getValidToken(): Promise<string | null> {
  const tokens = await readTokenSet();
  if (!tokens) return null;
  if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  if (!tokens.refresh_token) {
    await clearTokenSet();
    throw new GoogleSyncError("NO_REFRESH_TOKEN", "No refresh token — re-authenticate.");
  }
  // Deduplicate concurrent refresh attempts
  if (!_refreshPromise) {
    _refreshPromise = (async () => {
      const response = await fetch(GOOGLE_AUTH_CONFIG.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_AUTH_CONFIG.clientId,
          client_secret: GOOGLE_AUTH_CONFIG.clientSecret,
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token ?? "",
        }),
      });
      if (!response.ok) {
        // Clear tokens on auth errors; 429 (rate limit) keeps tokens for retry.
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          await clearTokenSet();
        }
        const text = await response.text();
        _refreshPromise = null;
        throw new GoogleSyncError("REFRESH_FAILED", text);
      }
      const data = await response.json();
      const updated: TokenSet = {
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? tokens.refresh_token,
        expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
      };
      await saveTokenSet(updated);
      oauthLog("getValidToken: refreshed, expires_at=" + updated.expires_at);
      return updated;
    })();
  }
  const updated = await _refreshPromise;
  _refreshPromise = null;
  return updated.access_token;
}

/**
 * Create a new event on the selected Google Calendar.
 * Returns the created event's Google ID.
 */
export async function createGoogleEvent(event: {
  calendarId: string;
  title: string;
  date: string;       // YYYY-MM-DD
  start?: string;     // HH:MM
  end?: string;       // HH:MM
  allDay?: boolean;
  note?: string;
}): Promise<string> {
  const token = await getValidToken();
  if (!token) throw new GoogleSyncError("UNAUTHENTICATED", "No valid token.");

  const isAllDay = event.allDay ?? (!event.start || !event.end);
  const body: Record<string, unknown> = {
    summary: event.title,
    description: event.note ?? "",
  };

  if (isAllDay) {
    const nextDay = new Date(event.date + "T00:00:00");
    nextDay.setDate(nextDay.getDate() + 1);
    body.start = { date: event.date };
    body.end = { date: nextDay.toISOString().slice(0, 10) };
  } else {
    body.start = { dateTime: `${event.date}T${event.start}:00+08:00`, timeZone: "Asia/Shanghai" };
    body.end = { dateTime: `${event.date}T${event.end}:00+08:00`, timeZone: "Asia/Shanghai" };
  }

  const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(event.calendarId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new GoogleSyncError("CREATE_EVENT_FAILED", await resp.text());
  const data = await resp.json();
  return data.id as string;
}

/**
 * Update an existing event on Google Calendar.
 */
export async function updateGoogleEvent(calendarId: string, googleEventId: string, event: {
  title: string;
  date: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  note?: string;
}): Promise<void> {
  const token = await getValidToken();
  if (!token) throw new GoogleSyncError("UNAUTHENTICATED", "No valid token.");

  const isAllDay = event.allDay ?? (!event.start || !event.end);
  const body: Record<string, unknown> = {
    summary: event.title,
    description: event.note ?? "",
  };

  if (isAllDay) {
    const nextDay = new Date(event.date + "T00:00:00");
    nextDay.setDate(nextDay.getDate() + 1);
    body.start = { date: event.date };
    body.end = { date: nextDay.toISOString().slice(0, 10) };
  } else {
    body.start = { dateTime: `${event.date}T${event.start}:00+08:00`, timeZone: "Asia/Shanghai" };
    body.end = { dateTime: `${event.date}T${event.end}:00+08:00`, timeZone: "Asia/Shanghai" };
  }

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) throw new GoogleSyncError("UPDATE_EVENT_FAILED", await resp.text());
}

/**
 * Delete an event from Google Calendar.
 */
export async function deleteGoogleEvent(calendarId: string, googleEventId: string): Promise<void> {
  const token = await getValidToken();
  if (!token) throw new GoogleSyncError("UNAUTHENTICATED", "No valid token.");

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!resp.ok) throw new GoogleSyncError("DELETE_EVENT_FAILED", await resp.text());
}

export async function moveGoogleEvent(
  sourceCalendarId: string,
  targetCalendarId: string,
  googleEventId: string,
): Promise<void> {
  const token = await getValidToken();
  if (!token) throw new GoogleSyncError("UNAUTHENTICATED", "No valid token.");

  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(sourceCalendarId)}/events/${encodeURIComponent(googleEventId)}/move`,
  );
  url.searchParams.set("destination", targetCalendarId);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new GoogleSyncError("MOVE_EVENT_FAILED", await response.text());
}

export async function getGoogleEvent(calendarId: string, googleEventId: string): Promise<CalendarEvent | null> {
  const token = await getValidToken();
  if (!token) throw new GoogleSyncError("UNAUTHENTICATED", "No valid token.");
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new GoogleSyncError("GET_EVENT_FAILED", await response.text());
  return await response.json() as CalendarEvent;
}

/**
 * Fetch events from a specific calendar.
 */
export async function fetchEventsFromCalendar(
  calendarId: string,
  startDate: string,
  endDate: string,
  calendarSummary?: string,
): Promise<CalendarEvent[]> {
  const token = await getValidToken();
  if (!token) throw new GoogleSyncError("UNAUTHENTICATED", "No valid token — authenticate first.");
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("timeMin", startDate);
  url.searchParams.set("timeMax", endDate);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new GoogleSyncError("FETCH_EVENTS_FAILED", await response.text());
  const data = await response.json();
  return (data.items ?? []).map((event: CalendarEvent) => ({
    ...event,
    calendarId,
    calendarSummary,
  }));
}

/**
 * Fetch events from all available calendars (or primary only as fallback).
 * @param calendarIds — specific calendar IDs to fetch, or undefined for all.
 */
export async function fetchCalendarEvents(
  startDate: string,
  endDate: string,
  calendarIds?: string[]
): Promise<CalendarEvent[]> {
  const token = await getValidToken();
  if (!token) throw new GoogleSyncError("UNAUTHENTICATED", "No valid token — authenticate first.");

  // If no specific calendars requested, fetch from all available
  const requested = calendarIds
    ? calendarIds.map((id) => ({ id, summary: "" }))
    : await listCalendars();
  const allEvents: CalendarEvent[] = [];
  for (const calendar of requested) {
    const events = await fetchEventsFromCalendar(calendar.id, startDate, endDate, calendar.summary);
    allEvents.push(...events);
  }
  return allEvents;
}

export async function listCalendars(): Promise<CalendarEntry[]> {
  const token = await getValidToken();
  if (!token) throw new GoogleSyncError("UNAUTHENTICATED", "No valid token — authenticate first.");
  const response = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new GoogleSyncError("LIST_CALENDARS_FAILED", await response.text());
  const data = await response.json();
  return (data.items ?? []).map((item: Record<string, unknown>) => ({
    id: item.id as string,
    summary: (item.summary as string) ?? "",
    primary: item.primary as boolean | undefined,
    accessRole: item.accessRole as string | undefined,
    backgroundColor: item.backgroundColor as string | undefined,
  }));
}

export async function isGoogleConnected(): Promise<boolean> { return (await readTokenSet()) !== null; }
export async function disconnectGoogle(): Promise<void> {
  await clearTokenSet();
  oauthLog("disconnectGoogle: tokens cleared");
}
