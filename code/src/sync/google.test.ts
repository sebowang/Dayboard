import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const storedTokens = {
  access_token: "stored-access-token",
  refresh_token: "stored-refresh-token",
  expires_at: Date.now() + 3_600_000,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  vi.stubGlobal("fetch", vi.fn());
});

describe("Google credential persistence", () => {
  it("restores a saved Windows credential after a fresh application load", async () => {
    invoke.mockResolvedValueOnce(JSON.stringify(storedTokens));
    const { isGoogleConnected } = await import("./google");

    await expect(isGoogleConnected()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("load_google_tokens");
  });

  it("keeps the existing refresh token when Google omits it during re-authorization", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "load_google_tokens") return Promise.resolve(JSON.stringify(storedTokens));
      if (command === "store_google_tokens") return Promise.resolve();
      return Promise.resolve();
    });
    sessionStorage.setItem("dayboard.oauth.reauth-state", "pkce-verifier");
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "new-access-token", expires_in: 3600 }),
    } as Response);
    const { handleAuthCallback } = await import("./google");

    await handleAuthCallback("http://127.0.0.1:1421/oauth/google/callback?code=code&state=reauth-state");

    expect(invoke).toHaveBeenCalledWith(
      "store_google_tokens",
      expect.objectContaining({
        tokens: expect.stringContaining("stored-refresh-token"),
      }),
    );
  });

  it("rejects a first authorization that has no refresh token", async () => {
    invoke.mockResolvedValue(null);
    sessionStorage.setItem("dayboard.oauth.first-auth-state", "pkce-verifier");
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "new-access-token", expires_in: 3600 }),
    } as Response);
    const { handleAuthCallback } = await import("./google");

    await expect(
      handleAuthCallback("http://127.0.0.1:1421/oauth/google/callback?code=code&state=first-auth-state"),
    ).rejects.toMatchObject({
      code: "NO_REFRESH_TOKEN",
    });
    expect(invoke).not.toHaveBeenCalledWith("store_google_tokens", expect.anything());
  });
});
