// Google Calendar sync module for Dayboard
// OAuth 2.0 with PKCE (S256). code_verifier is encoded in the OAuth state
// parameter so it survives the roundtrip.

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
}

export interface CalendarEntry {
  id: string;
  summary: string;
  primary?: boolean;
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
  redirectUri: "http://127.0.0.1:1420/oauth/google/callback",
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
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
    // Append so we keep history
    const prev = localStorage.getItem(LOG_KEY) ?? "";
    localStorage.setItem(LOG_KEY, prev + entry + "\n");
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

function readTokenSet(): TokenSet | null {
  const raw = lsGet("token_set");
  if (!raw) return null;
  try { return JSON.parse(raw) as TokenSet; } catch { return null; }
}
function saveTokenSet(tokens: TokenSet): void {
  lsSet("token_set", JSON.stringify(tokens));
}
function clearTokenSet(): void {
  lsRemove("token_set");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getAuthUrl(): Promise<string> {
  oauthLog("getAuthUrl: generating code_verifier");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const state = "v1:" + codeVerifier;

  const params = new URLSearchParams({
    client_id: GOOGLE_AUTH_CONFIG.clientId,
    redirect_uri: GOOGLE_AUTH_CONFIG.redirectUri,
    response_type: "code",
    scope: GOOGLE_AUTH_CONFIG.scopes.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  });

  oauthLog("getAuthUrl: auth URL built, redirectUri=" + GOOGLE_AUTH_CONFIG.redirectUri);
  return `${GOOGLE_AUTH_CONFIG.authEndpoint}?${params.toString()}`;
}

export async function handleAuthCallback(url: string): Promise<void> {
  oauthLog("handleAuthCallback START, url=" + url.substring(0, 150));

  const parsed = new URL(url);
  const error = parsed.searchParams.get("error");
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");

  oauthLog("handleAuthCallback: error=" + error + ", hasCode=" + !!code + ", hasState=" + !!state);

  if (error) {
    oauthLog("handleAuthCallback: Google returned error: " + error);
    throw new GoogleSyncError("AUTH_ERROR", `OAuth error: ${error}`);
  }
  if (!code) {
    oauthLog("handleAuthCallback: NO_CODE");
    throw new GoogleSyncError("NO_CODE", "No authorization code in callback URL");
  }
  if (!state || !state.startsWith("v1:")) {
    oauthLog("handleAuthCallback: invalid state param: " + (state ?? "null"));
    throw new GoogleSyncError("NO_VERIFIER", "Missing or invalid state parameter: " + (state ?? "null"));
  }

  const codeVerifier = state.slice(3);
  oauthLog("handleAuthCallback: code_verifier extracted, len=" + codeVerifier.length);

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

  saveTokenSet({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  oauthLog("handleAuthCallback: token_set SAVED to localStorage");
}

export async function getValidToken(): Promise<string | null> {
  const tokens = readTokenSet();
  if (!tokens) return null;
  if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  if (!tokens.refresh_token) {
    clearTokenSet();
    throw new GoogleSyncError("NO_REFRESH_TOKEN", "No refresh token — re-authenticate.");
  }
  const response = await fetch(GOOGLE_AUTH_CONFIG.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_AUTH_CONFIG.clientId,
      client_secret: GOOGLE_AUTH_CONFIG.clientSecret,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });
  if (!response.ok) { clearTokenSet(); throw new GoogleSyncError("REFRESH_FAILED", await response.text()); }
  const data = await response.json();
  const updated: TokenSet = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  saveTokenSet(updated);
  return updated.access_token;
}

/**
 * Create a new event on the user's primary Google Calendar.
 * Returns the created event's Google ID.
 */
export async function createGoogleEvent(event: {
  title: string;
  date: string;       // YYYY-MM-DD
  start?: string;     // HH:MM
  end?: string;       // HH:MM
  note?: string;
}): Promise<string> {
  const token = await getValidToken();
  if (!token) throw new GoogleSyncError("UNAUTHENTICATED", "No valid token.");

  const isAllDay = !event.start || !event.end;
  const body: Record<string, unknown> = {
    summary: event.title,
    description: event.note ?? "",
  };

  if (isAllDay) {
    body.start = { date: event.date };
    body.end = { date: event.date };
  } else {
    body.start = { dateTime: `${event.date}T${event.start}:00+08:00`, timeZone: "Asia/Shanghai" };
    body.end = { dateTime: `${event.date}T${event.end}:00+08:00`, timeZone: "Asia/Shanghai" };
  }

  const resp = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
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
export async function updateGoogleEvent(googleEventId: string, event: {
  title: string;
  date: string;
  start?: string;
  end?: string;
  note?: string;
}): Promise<void> {
  const token = await getValidToken();
  if (!token) throw new GoogleSyncError("UNAUTHENTICATED", "No valid token.");

  const isAllDay = !event.start || !event.end;
  const body: Record<string, unknown> = {
    summary: event.title,
    description: event.note ?? "",
  };

  if (isAllDay) {
    body.start = { date: event.date };
    body.end = { date: event.date };
  } else {
    body.start = { dateTime: `${event.date}T${event.start}:00+08:00`, timeZone: "Asia/Shanghai" };
    body.end = { dateTime: `${event.date}T${event.end}:00+08:00`, timeZone: "Asia/Shanghai" };
  }

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
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
export async function deleteGoogleEvent(googleEventId: string): Promise<void> {
  const token = await getValidToken();
  if (!token) throw new GoogleSyncError("UNAUTHENTICATED", "No valid token.");

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!resp.ok) throw new GoogleSyncError("DELETE_EVENT_FAILED", await resp.text());
}

export async function fetchCalendarEvents(startDate: string, endDate: string): Promise<CalendarEvent[]> {
  const token = await getValidToken();
  if (!token) throw new GoogleSyncError("UNAUTHENTICATED", "No valid token — authenticate first.");
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", startDate);
  url.searchParams.set("timeMax", endDate);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new GoogleSyncError("FETCH_EVENTS_FAILED", await response.text());
  const data = await response.json();
  return data.items ?? [];
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
  }));
}

export function isGoogleConnected(): boolean { return readTokenSet() !== null; }
export function disconnectGoogle(): void { clearTokenSet(); oauthLog("disconnectGoogle: tokens cleared"); }