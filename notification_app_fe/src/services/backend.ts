const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const NOTIFICATIONS_URL = `${API_BASE_URL}/api/notifications`;
const LOGS_URL = (import.meta.env.VITE_LOGS_API_URL ?? `${API_BASE_URL}/api/logs`).replace(/\/$/, "");
const NOTIFICATIONS_CACHE_KEY = "campus_notifications_cache";

export type NotificationDataSource = "live" | "cache";
export type LogStack = "backend" | "frontend";
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type LogPackage =
  | "cache"
  | "controller"
  | "cron_job"
  | "db"
  | "domain"
  | "handler"
  | "repository"
  | "route"
  | "service"
  | "api"
  | "component"
  | "hook"
  | "page"
  | "state"
  | "style"
  | "auth"
  | "config"
  | "middleware"
  | "utils";

export interface RawNotification {
  ID?: string | number;
  Type?: string;
  Message?: string;
  Timestamp?: string;
  id?: string | number;
  type?: string;
  message?: string;
  timestamp?: string;
  notificationId?: string | number;
}

interface NotificationsApiResponse {
  notifications?: RawNotification[];
  data?: RawNotification[];
}

const BACKEND_ONLY = new Set(["cache", "controller", "cron_job", "db", "domain", "handler", "repository", "route", "service"]);
const FRONTEND_ONLY = new Set(["api", "component", "hook", "page", "state", "style"]);

let lastNotificationDataSource: NotificationDataSource = "live";
let lastNotificationWarning = "";

export function getLastNotificationDataSource(): NotificationDataSource {
  return lastNotificationDataSource;
}

export function getLastNotificationWarning(): string {
  return lastNotificationWarning;
}

function withHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Accept", "application/json");
  return headers;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: withHeaders(init),
    ...init,
  });

  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown, init?: RequestInit): Promise<T> {
  const headers = withHeaders(init);
  headers.set("Content-Type", "application/json");

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    ...init,
  });

  const text = await response.text();
  const data = (text ? JSON.parse(text) : undefined) as T;

  if (!response.ok) {
    throw new Error(`POST ${url} failed: ${response.status} ${response.statusText}`);
  }

  return data;
}

function extractNotificationArray(payload: unknown): RawNotification[] {
  if (Array.isArray(payload)) return payload;

  if (payload && typeof payload === "object") {
    const obj = payload as NotificationsApiResponse;
    if (Array.isArray(obj.notifications)) return obj.notifications;
    if (Array.isArray(obj.data)) return obj.data;
  }

  throw new Error("API payload does not contain notifications array");
}

function saveNotificationsToCache(items: RawNotification[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(NOTIFICATIONS_CACHE_KEY, JSON.stringify(items));
}

function readNotificationsFromCache(): RawNotification[] {
  if (typeof window === "undefined") {
    return [];
  }

  const cached = window.localStorage.getItem(NOTIFICATIONS_CACHE_KEY);
  if (!cached) {
    return [];
  }

  try {
    const parsed = JSON.parse(cached) as unknown;
    return extractNotificationArray(parsed);
  } catch {
    return [];
  }
}

function validateLogInput(stack: LogStack, packageName: LogPackage, message: string): void {
  if (!message.trim()) {
    throw new Error("Log message is empty");
  }

  if (stack === "frontend" && BACKEND_ONLY.has(packageName)) {
    throw new Error(`Package ${packageName} is backend-only`);
  }

  if (stack === "backend" && FRONTEND_ONLY.has(packageName)) {
    throw new Error(`Package ${packageName} is frontend-only`);
  }
}

export async function logEvent(
  stack: LogStack,
  level: LogLevel,
  packageName: LogPackage,
  message: string
): Promise<void> {
  try {
    validateLogInput(stack, packageName, message);
    await postJson(LOGS_URL, {
      stack,
      level,
      package: packageName,
      message,
    });
  } catch {
    // Logging must not block frontend behavior.
  }
}

export async function fetchNotificationsFromBackend(
  apiUrl = NOTIFICATIONS_URL,
  init?: RequestInit
): Promise<RawNotification[]> {
  try {
    const payload = await getJson<unknown>(apiUrl, init);
    const items = extractNotificationArray(payload);
    saveNotificationsToCache(items);
    lastNotificationDataSource = "live";
    lastNotificationWarning = "";
    void logEvent("frontend", "info", "api", `Fetched notifications count=${items.length}`);
    return items;
  } catch (error) {
    const cachedItems = readNotificationsFromCache();
    const message = error instanceof Error ? error.message : "Unknown notifications API error";

    if (cachedItems.length > 0) {
      lastNotificationDataSource = "cache";
      lastNotificationWarning = `API unavailable. Showing ${cachedItems.length} cached notifications.`;
      void logEvent("frontend", "warn", "api", `${message}. Using cache count=${cachedItems.length}`);
      return cachedItems;
    }

    lastNotificationDataSource = "live";
    lastNotificationWarning = "";
    void logEvent("frontend", "error", "api", message);
    throw error;
  }
}

export { NOTIFICATIONS_URL as NOTIFICATIONS_API };
