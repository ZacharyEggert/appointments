import { randomBytes } from "node:crypto";
import prisma from "./db.server";
import { decryptToken, encryptToken } from "./token-encryption.server";
import type { Interval } from "./availability";

export class GoogleDisconnectedError extends Error {
  constructor() {
    super("Google is disconnected. Please reconnect.");
  }
}

async function disconnected(shop: string, refreshToken: string) {
  // A response from an old connection must not disconnect a new consent grant.
  await prisma.googleConnection.updateMany({
    where: { shop, refreshToken },
    data: { status: "disconnected" },
  });
  throw new GoogleDisconnectedError();
}

export interface GoogleEvent {
  id: string;
  created: string;
  status?: string;
  description?: string;
  attendees?: { email: string; displayName?: string }[];
  extendedProperties?: { private?: Record<string, string> };
  transparency?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  summary?: string;
}

export async function getGoogleEvent(
  shop: string,
  calendarId: string,
  eventId: string,
): Promise<GoogleEvent | null> {
  const response = await googleFetch(
    shop,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error("Google event lookup failed");
  const event = (await response.json()) as GoogleEvent;
  return event.status === "cancelled" ? null : event;
}

export async function writeGoogleEvent(
  shop: string,
  calendarId: string,
  body: Record<string, unknown>,
  eventId?: string,
  supportsConferenceData = Boolean(body.conferenceData),
  options?: { sendUpdates: "all" | "none" },
): Promise<GoogleEvent> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`,
  );
  url.searchParams.set(
    "sendUpdates",
    options?.sendUpdates ?? (eventId ? "all" : "none"),
  );
  if (supportsConferenceData)
    url.searchParams.set("conferenceDataVersion", "1");
  const response = await googleFetch(shop, url, {
    method: eventId ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Google event write failed");
  return response.json();
}

export async function googleEventsByProperty(
  shop: string,
  calendarId: string,
  key: string,
  value: string,
) {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.search = new URLSearchParams({
      privateExtendedProperty: `${key}=${value}`,
      singleEvents: "true",
      showDeleted: "false",
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const response = await googleFetch(shop, url);
    if (!response.ok) throw new Error("Google event lookup failed");
    const result = (await response.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
    };
    if (!Array.isArray(result.items))
      throw new Error("Invalid Google event list");
    events.push(...result.items);
    pageToken = result.nextPageToken;
  } while (pageToken);
  return events;
}

export async function overlappingGoogleEvents(
  shop: string,
  calendarId: string,
  from: Date,
  to: Date,
) {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.search = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      showDeleted: "false",
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const response = await googleFetch(shop, url);
    if (!response.ok) throw new Error("Google event lookup failed");
    const result = (await response.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
    };
    if (!Array.isArray(result.items))
      throw new Error("Invalid Google event list");
    events.push(...result.items);
    pageToken = result.nextPageToken;
  } while (pageToken);
  return events;
}

export async function upcomingAppEvents(
  shop: string,
  calendarId: string,
  from: Date,
) {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.search = new URLSearchParams([
      ["timeMin", from.toISOString()],
      ["singleEvents", "true"],
      ["orderBy", "startTime"],
      ["showDeleted", "false"],
      ["privateExtendedProperty", "app=appointments"],
      ["privateExtendedProperty", `shop=${shop}`],
      ...(pageToken ? [["pageToken", pageToken]] : []),
    ]).toString();
    const response = await googleFetch(shop, url);
    if (!response.ok) throw new Error("Google event lookup failed");
    const result = (await response.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
    };
    events.push(...(result.items ?? []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return events;
}

export async function deleteGoogleEvent(
  shop: string,
  calendarId: string,
  eventId: string,
  sendUpdates: "none" | "all" = "none",
) {
  const response = await googleFetch(
    shop,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410)
    throw new Error("Google event cleanup failed");
}

export async function googleBusy(
  shop: string,
  calendarId: string,
  from: Date,
  to: Date,
): Promise<Interval[]> {
  const response = await googleFetch(
    shop,
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: calendarId }],
      }),
    },
  );
  if (!response.ok) throw new Response("Booking unavailable", { status: 503 });
  const result = (await response.json()) as {
    calendars?: Record<string, { busy?: Interval[]; errors?: unknown[] }>;
  };
  const calendar = result.calendars?.[calendarId];
  if (
    !Array.isArray(calendar?.busy) ||
    calendar.errors?.length ||
    calendar.busy.some(
      (interval) =>
        !interval ||
        !Number.isFinite(Date.parse(interval.start)) ||
        !Number.isFinite(Date.parse(interval.end)) ||
        Date.parse(interval.start) >= Date.parse(interval.end),
    )
  )
    throw new Response("Booking unavailable", { status: 503 });
  return calendar.busy;
}

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export async function revokeGoogleConnection(shop: string) {
  const connection = await prisma.googleConnection.findUnique({
    where: { shop },
  });
  if (!connection) return;
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    body: new URLSearchParams({ token: decryptToken(connection.refreshToken) }),
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok && response.status !== 400) {
    throw new Error("Google token revocation failed");
  }
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function redirectUri() {
  return (
    process.env.GOOGLE_REDIRECT_URI ??
    new URL("/google/callback", requiredEnv("SHOPIFY_APP_URL")).href
  );
}

export async function googleAuthorizationUrl(shop: string) {
  const state = randomBytes(32).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES.join(" "),
    state,
  }).toString();
  await prisma.googleOAuthState.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  await prisma.googleOAuthState.create({
    data: { state, shop, expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  return url.href;
}

export async function completeGoogleConnection(url: URL) {
  const state = url.searchParams.get("state");
  if (!state) throw new Response("Missing OAuth state", { status: 400 });
  const pending = await prisma.googleOAuthState.findUnique({
    where: { state },
  });
  if (!pending || pending.expiresAt <= new Date()) {
    throw new Response("Invalid or expired OAuth state", { status: 400 });
  }
  const consumed = await prisma.googleOAuthState.deleteMany({
    where: { state },
  });
  if (consumed.count !== 1)
    throw new Response("OAuth state already used", { status: 400 });
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !code) {
    throw new Response(
      "Google connection was not authorized. Please try connecting again.",
      { status: 400 },
    );
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      code,
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok)
    throw new Response(
      "Google connection failed. Please try connecting again.",
      { status: 502 },
    );
  const token = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (
    !token.access_token ||
    !token.refresh_token ||
    !token.expires_in ||
    !token.scope
  ) {
    throw new Response(
      "Google did not grant offline access. Please reconnect.",
      { status: 400 },
    );
  }
  const granted = new Set(token.scope.split(" "));
  if (!GOOGLE_SCOPES.every((scope) => granted.has(scope))) {
    throw new Response(
      "Please grant all Google Calendar permissions and reconnect.",
      { status: 400 },
    );
  }
  const data = {
    refreshToken: encryptToken(token.refresh_token),
    accessToken: encryptToken(token.access_token),
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    scope: token.scope,
    status: "connected",
    connectedAt: new Date(),
  };
  await prisma.googleConnection.upsert({
    where: { shop: pending.shop },
    create: { shop: pending.shop, ...data },
    update: data,
  });
  return pending.shop;
}

export interface CalendarEntry {
  id: string;
  summary: string;
  summaryOverride?: string;
  timeZone: string;
  accessRole: string;
  primary?: boolean;
}

async function accessTokenFor(shop: string, refresh = false) {
  const connection = await prisma.googleConnection.findUnique({
    where: { shop },
  });
  if (!connection) {
    throw new Response("Connect Google to choose a calendar", { status: 409 });
  }
  if (connection.status !== "connected") throw new GoogleDisconnectedError();
  if (!refresh && connection.expiresAt.getTime() > Date.now() + 60_000)
    return { token: decryptToken(connection.accessToken), connection };
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: decryptToken(connection.refreshToken),
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    if (response.status === 400) {
      const error = (await response.json()) as { error?: string };
      if (error.error === "invalid_grant")
        await disconnected(shop, connection.refreshToken);
    }
    throw new Response(
      "Could not refresh Google access. Please reconnect or try again.",
      { status: 502 },
    );
  }
  const token = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  const updated = await prisma.googleConnection.update({
    where: { shop },
    data: {
      accessToken: encryptToken(token.access_token),
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
      ...(token.refresh_token
        ? { refreshToken: encryptToken(token.refresh_token) }
        : {}),
    },
  });
  return { token: token.access_token, connection: updated };
}

async function googleFetch(
  shop: string,
  url: string | URL,
  init: RequestInit = {},
) {
  let credentials = await accessTokenFor(shop);
  const send = () => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${credentials.token}`);
    return fetch(url, { ...init, headers });
  };
  let response = await send();
  if (response.status === 401) {
    credentials = await accessTokenFor(shop, true);
    response = await send();
    if (response.status === 401)
      await disconnected(shop, credentials.connection.refreshToken);
  }
  if (response.status === 403) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as {
      error?: { errors?: { reason?: string }[] };
    } | null;
    if (
      body?.error?.errors?.some(
        (error) => error.reason === "insufficientPermissions",
      )
    )
      await disconnected(shop, credentials.connection.refreshToken);
  }
  return response;
}

export async function listGoogleCalendars(
  shop: string,
): Promise<CalendarEntry[]> {
  const calendars: CalendarEntry[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    );
    url.search = new URLSearchParams({
      minAccessRole: "writer",
      maxResults: "250",
      showHidden: "false",
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const response = await googleFetch(shop, url);
    if (!response.ok)
      throw new Response("Could not load Google calendars. Please try again.", {
        status: 502,
      });
    const result = (await response.json()) as {
      items?: CalendarEntry[];
      nextPageToken?: string;
    };
    calendars.push(...(result.items ?? []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return calendars;
}
