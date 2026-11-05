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

interface FakeEvent {
  id?: string;
  created?: string;
  summary?: string;
  description?: string;
  attendees?: { email: string; displayName?: string }[];
  extendedProperties?: { private: Record<string, string> };
  calendarId: string;
  start: string;
  end: string;
  transparency?: "opaque" | "transparent";
  status?: "confirmed" | "cancelled";
  conferenceData?: {
    createRequest: {
      requestId: string;
      conferenceSolutionKey: { type: string };
      status: { statusCode: "pending" | "success" | "failure" };
    };
    entryPoints?: { entryPointType: string; uri: string }[];
  };
  hangoutLink?: string;
}

export const fakeGoogle = {
  grants: new Map<string, Grant>(),
  tokens: new Map<string, Grant>(),
  refreshTokens: new Map<string, Grant>(),
  revocations: [] as string[],
  events: [] as FakeEvent[],
  beforeList: undefined as (() => void) | undefined,
  conferenceStatus: "success" as "pending" | "success" | "failure",
  writes: [] as {
    method: string;
    sendUpdates: string | null;
    conferenceDataVersion?: string | null;
    body: Record<string, unknown>;
  }[],
  reset() {
    this.grants.clear();
    this.tokens.clear();
    this.refreshTokens.clear();
    this.revocations = [];
    this.events = [];
    this.writes = [];
    this.beforeList = undefined;
    this.conferenceStatus = "success";
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

const eventsUrl =
  "https://www.googleapis.com/calendar/v3/calendars/:calendarId/events";
function authorized(request: Request, calendarId: string) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return fakeGoogle.tokens
    .get(token)
    ?.calendars.some(
      (c) => c.id === calendarId && ["owner", "writer"].includes(c.accessRole),
    );
}
export const googleHandlers = [
  http.get(eventsUrl, ({ request, params }) => {
    if (!authorized(request, String(params.calendarId)))
      return new HttpResponse(null, { status: 401 });
    fakeGoogle.beforeList?.();
    const url = new URL(request.url);
    const events = fakeGoogle.events.filter(
      (e) =>
        e.calendarId === params.calendarId &&
        e.status !== "cancelled" &&
        Date.parse(e.end) > Date.parse(url.searchParams.get("timeMin")!) &&
        Date.parse(e.start) <
          Date.parse(url.searchParams.get("timeMax") ?? "9999-01-01") &&
        url.searchParams.getAll("privateExtendedProperty").every((pair) => {
          const [key, value] = pair.split("=");
          return e.extendedProperties?.private[key] === value;
        }),
    );
    if (url.searchParams.get("orderBy") === "startTime")
      events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const page = Number(url.searchParams.get("pageToken") ?? 0);
    return HttpResponse.json({
      items: events.slice(page, page + 1).map((e) => ({
        ...e,
        start: { dateTime: e.start },
        end: { dateTime: e.end },
      })),
      ...(page + 1 < events.length ? { nextPageToken: String(page + 1) } : {}),
    });
  }),
  http.delete(eventsUrl + "/:eventId", ({ request, params }) => {
    if (!authorized(request, String(params.calendarId)))
      return new HttpResponse(null, { status: 401 });
    const index = fakeGoogle.events.findIndex(
      (e) => e.id === params.eventId && e.calendarId === params.calendarId,
    );
    fakeGoogle.writes.push({
      method: "DELETE",
      sendUpdates: new URL(request.url).searchParams.get("sendUpdates"),
      body: {},
    });
    if (index < 0) return new HttpResponse(null, { status: 410 });
    fakeGoogle.events.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(eventsUrl, async ({ request, params }) => {
    const calendarId = String(params.calendarId);
    if (!authorized(request, calendarId))
      return new HttpResponse(null, { status: 401 });
    const body = (await request.json()) as Record<string, unknown>;
    fakeGoogle.writes.push({
      method: "POST",
      sendUpdates: new URL(request.url).searchParams.get("sendUpdates"),
      conferenceDataVersion: new URL(request.url).searchParams.get(
        "conferenceDataVersion",
      ),
      body,
    });
    const { conferenceData, ...eventBody } = body;
    const conference = conferenceData as FakeEvent["conferenceData"];
    const event = {
      ...eventBody,
      id: `event${fakeGoogle.events.length + 1}`,
      created: new Date().toISOString(),
      ...(conference &&
      new URL(request.url).searchParams.get("conferenceDataVersion") === "1"
        ? {
            conferenceData: {
              createRequest: {
                ...conference.createRequest,
                status: { statusCode: fakeGoogle.conferenceStatus },
              },
              ...(fakeGoogle.conferenceStatus === "success"
                ? {
                    entryPoints: [
                      {
                        entryPointType: "video",
                        uri: "https://meet.google.com/abc-defg-hij",
                      },
                    ],
                  }
                : {}),
            },
            ...(fakeGoogle.conferenceStatus === "success"
              ? { hangoutLink: "https://meet.google.com/abc-defg-hij" }
              : {}),
          }
        : {}),
    };
    const { start, end } = body as {
      start: { dateTime: string };
      end: { dateTime: string };
    };
    fakeGoogle.events.push({
      ...event,
      calendarId,
      start: start.dateTime,
      end: end.dateTime,
    });
    return HttpResponse.json(event);
  }),
  http.patch(eventsUrl + "/:eventId", async ({ request, params }) => {
    if (!authorized(request, String(params.calendarId)))
      return new HttpResponse(null, { status: 401 });
    const event = fakeGoogle.events.find(
      (e) => e.calendarId === params.calendarId && e.id === params.eventId,
    );
    if (!event) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    fakeGoogle.writes.push({
      method: "PATCH",
      sendUpdates: new URL(request.url).searchParams.get("sendUpdates"),
      conferenceDataVersion: new URL(request.url).searchParams.get(
        "conferenceDataVersion",
      ),
      body,
    });
    Object.assign(event, body);
    return HttpResponse.json({
      ...event,
      start: { dateTime: event.start },
      end: { dateTime: event.end },
    });
  }),
  http.post(
    "https://www.googleapis.com/calendar/v3/freeBusy",
    async ({ request }) => {
      const token =
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      const grant = fakeGoogle.tokens.get(token);
      if (!grant)
        return HttpResponse.json({ error: { code: 401 } }, { status: 401 });
      const { timeMin, timeMax, items } = (await request.json()) as {
        timeMin: string;
        timeMax: string;
        items: { id: string }[];
      };
      return HttpResponse.json({
        timeMin,
        timeMax,
        calendars: Object.fromEntries(
          items.map(({ id }) => [
            id,
            grant.calendars.some((calendar) => calendar.id === id)
              ? {
                  busy: fakeGoogle.events
                    .filter(
                      (event) =>
                        event.calendarId === id &&
                        event.transparency !== "transparent" &&
                        event.status !== "cancelled" &&
                        Date.parse(event.start) < Date.parse(timeMax) &&
                        Date.parse(event.end) > Date.parse(timeMin),
                    )
                    .map(({ start, end }) => ({ start, end })),
                }
              : { errors: [{ domain: "global", reason: "notFound" }] },
          ]),
        ),
      });
    },
  ),
  http.post("https://oauth2.googleapis.com/revoke", async ({ request }) => {
    const form = new URLSearchParams(await request.text());
    const token = form.get("token") ?? "";
    fakeGoogle.revocations.push(token);
    const grant = fakeGoogle.refreshTokens.get(token);
    if (!grant)
      return HttpResponse.json({ error: "invalid_token" }, { status: 400 });
    fakeGoogle.refreshTokens.delete(token);
    for (const [accessToken, issuedGrant] of fakeGoogle.tokens) {
      if (issuedGrant === grant) fakeGoogle.tokens.delete(accessToken);
    }
    return new HttpResponse(null, { status: 200 });
  }),
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
