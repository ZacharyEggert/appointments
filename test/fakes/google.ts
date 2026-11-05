import { http, HttpResponse } from "msw";

export interface FakeCalendar {
  id: string;
  summary: string;
  timeZone: string;
  accessRole: "owner" | "writer" | "reader";
  primary?: boolean;
}

interface Grant {
  refreshToken: string;
  calendars: FakeCalendar[];
  scope?: string;
}

export const fakeGoogle = {
  grants: new Map<string, Grant>(),
  tokens: new Map<string, Grant>(),
  refreshTokens: new Map<string, Grant>(),
  reset() {
    this.grants.clear();
    this.tokens.clear();
    this.refreshTokens.clear();
  },
  grant(code = "google_code", options: Partial<Grant> = {}) {
    this.grants.set(code, {
      refreshToken: "google_refresh_token",
      calendars: [
        {
          id: "merchant@example.com",
          summary: "Bookings",
          timeZone: "America/Los_Angeles",
          accessRole: "owner",
          primary: true,
        },
      ],
      ...options,
    });
  },
};

export const googleHandlers = [
  http.post("https://oauth2.googleapis.com/token", async ({ request }) => {
    const form = new URLSearchParams(await request.text());
    if (
      form.get("client_id") !== "google_test_client" ||
      form.get("client_secret") !== "google_test_secret"
    ) {
      return HttpResponse.json({ error: "invalid_client" }, { status: 401 });
    }
    if (form.get("grant_type") === "refresh_token") {
      const grant = fakeGoogle.refreshTokens.get(
        form.get("refresh_token") ?? "",
      );
      if (!grant)
        return HttpResponse.json({ error: "invalid_grant" }, { status: 400 });
      const accessToken = `refreshed_${grant.refreshToken}`;
      fakeGoogle.tokens.set(accessToken, grant);
      return HttpResponse.json({
        access_token: accessToken,
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    const grant = fakeGoogle.grants.get(form.get("code") ?? "");
    if (
      !grant ||
      form.get("grant_type") !== "authorization_code" ||
      form.get("redirect_uri") !== "https://app.test/google/callback"
    ) {
      return HttpResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    fakeGoogle.grants.delete(form.get("code")!);
    const accessToken = `access_${grant.refreshToken}`;
    fakeGoogle.tokens.set(accessToken, grant);
    fakeGoogle.refreshTokens.set(grant.refreshToken, grant);
    return HttpResponse.json({
      access_token: accessToken,
      refresh_token: grant.refreshToken,
      expires_in: 3600,
      token_type: "Bearer",
      scope:
        grant.scope ??
        "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    });
  }),
  http.get(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    ({ request }) => {
      const token =
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      const grant = fakeGoogle.tokens.get(token);
      if (!grant)
        return HttpResponse.json({ error: { code: 401 } }, { status: 401 });
      const url = new URL(request.url);
      const calendars = grant.calendars.filter(
        (calendar) =>
          url.searchParams.get("minAccessRole") !== "writer" ||
          ["owner", "writer"].includes(calendar.accessRole),
      );
      const page = Number(url.searchParams.get("pageToken") ?? 0);
      return HttpResponse.json({
        items: calendars.slice(page, page + 1),
        ...(page + 1 < calendars.length
          ? { nextPageToken: String(page + 1) }
          : {}),
      });
    },
  ),
];
