// Google Calendar sync module for Dayboard
// OAuth 2.0 with PKCE (S256) — client ID placeholder to be filled later.

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
  expires_at: number; // epoch ms
}

// ---------------------------------------------------------------------------
// OAuth configuration (placeholders — fill in after Google Cloud Console setup)
// ---------------------------------------------------------------------------

export const GOOGLE_AUTH_CONFIG = {
  clientId: "168213630540-0rtq2h73jn4trb3938ard3bmq3o9g77q.apps.googleusercontent.com",
  redirectUri: "http://localhost:1420/oauth/google/callback",
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

/** Generate a cryptographically random code_verifier (43-128 chars). */
function generateCodeVerifier(): string {
  const raw = new Uint8Array(64);
  crypto.getRandomValues(raw);
  return base64UrlEncode(raw).slice(0, 128);
}

/** SHA-256 hash → base64url. */
async function sha256Base64Url(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hash));
}

/** Encode a Uint8Array as a base64url string (no padding). */
function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

function readTokenSet(): TokenSet | null {
  const raw = lsGet("token_set");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
}

function saveTokenSet(tokens: TokenSet): void {
  lsSet("token_set", JSON.stringify(tokens));
}

function clearTokenSet(): void {
  lsRemove("token_set");
  lsRemove("code_verifier");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the Google OAuth authorization URL with PKCE code_challenge (S256).
 * Stores code_verifier in localStorage so handleAuthCallback can retrieve it.
 */
export async function getAuthUrl(): Promise<string> {
  const codeVerifier = generateCodeVerifier();
  lsSet("code_verifier", codeVerifier);

  const codeChallenge = await sha256Base64Url(codeVerifier);

  const params = new URLSearchParams({
    client_id: GOOGLE_AUTH_CONFIG.clientId,
    redirect_uri: GOOGLE_AUTH_CONFIG.redirectUri,
    response_type: "code",
    scope: GOOGLE_AUTH_CONFIG.scopes.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });

  return `${GOOGLE_AUTH_CONFIG.authEndpoint}?${params.toString()}`;
}

/**
 * Handle the OAuth redirect callback. Parses the authorization code from the
 * URL, exchanges it for tokens, and stores them.
 */
export async function handleAuthCallback(url: string): Promise<void> {
  const parsed = new URL(url);
  const error = parsed.searchParams.get("error");

  if (error) {
    throw new GoogleSyncError("AUTH_ERROR", `OAuth error: ${error}`);
  }

  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new GoogleSyncError("NO_CODE", "No authorization code in callback URL");
  }

  const codeVerifier = lsGet("code_verifier");
  if (!codeVerifier) {
    throw new GoogleSyncError("NO_VERIFIER", "Missing code_verifier in localStorage");
  }

  const response = await fetch(GOOGLE_AUTH_CONFIG.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_AUTH_CONFIG.clientId,
      redirect_uri: GOOGLE_AUTH_CONFIG.redirectUri,
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new GoogleSyncError("TOKEN_EXCHANGE_FAILED", text);
  }

  const data = await response.json();

  const tokenSet: TokenSet = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  saveTokenSet(tokenSet);
  lsRemove("code_verifier");
}

/**
 * Return a valid access token, refreshing if expired.
 */
export async function getValidToken(): Promise<string | null> {
  const tokens = readTokenSet();
  if (!tokens) return null;

  // Still fresh with 60 s buffer
  if (tokens.expires_at > Date.now() + 60_000) {
    return tokens.access_token;
  }

  // Refresh
  if (!tokens.refresh_token) {
    clearTokenSet();
    throw new GoogleSyncError("NO_REFRESH_TOKEN", "No refresh token available — re-authenticate.");
  }

  const response = await fetch(GOOGLE_AUTH_CONFIG.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_AUTH_CONFIG.clientId,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!response.ok) {
    clearTokenSet();
    const text = await response.text();
    throw new GoogleSyncError("REFRESH_FAILED", text);
  }

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
 * Fetch calendar events between two ISO-8601 date strings.
 */
export async function fetchCalendarEvents(
  startDate: string,
  endDate: string
): Promise<CalendarEvent[]> {
  const token = await getValidToken();
  if (!token) {
    throw new GoogleSyncError("UNAUTHENTICATED", "No valid token — authenticate first.");
  }

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", startDate);
  url.searchParams.set("timeMax", endDate);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new GoogleSyncError("FETCH_EVENTS_FAILED", text);
  }

  const data = await response.json();
  return data.items ?? [];
}

/**
 * List available calendars for the authenticated user.
 */

/** Returns true if the user has a stored token set (connected or connectable). */
export function isGoogleConnected(): boolean {
  return readTokenSet() !== null;
}

/** Remove all stored Google tokens. */
export function disconnectGoogle(): void {
  clearTokenSet();
}
export async function listCalendars(): Promise<CalendarEntry[]> {
  const token = await getValidToken();
  if (!token) {
    throw new GoogleSyncError("UNAUTHENTICATED", "No valid token — authenticate first.");
  }

  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new GoogleSyncError("LIST_CALENDARS_FAILED", text);
  }

  const data = await response.json();
  return (data.items ?? []).map((item: Record<string, unknown>) => ({
    id: item.id as string,
    summary: (item.summary as string) ?? "",
    primary: item.primary as boolean | undefined,
  }));
}
