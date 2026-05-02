import {
  fetchNotificationsFromBackend,
  getLastNotificationDataSource,
  getLastNotificationWarning,
  NOTIFICATIONS_API,
  type NotificationDataSource,
  type RawNotification,
  logEvent,
} from "../services/backend";

export { getLastNotificationDataSource, getLastNotificationWarning, type NotificationDataSource };

export type NotificationType = "Placement" | "Result" | "Event";

export interface NotificationRecord {
  id: string | number;
  type: NotificationType;
  message: string;
  timestamp: string;
}

interface RankedNotification extends NotificationRecord {
  _priorityWeight: number;
  _priorityTs: number;
}

const TYPE_WEIGHT: Record<Lowercase<NotificationType>, number> = {
  placement: 3,
  result: 2,
  event: 1,
};

function toNotificationType(rawType: unknown): NotificationType {
  const normalized = String(rawType ?? "").trim().toLowerCase();
  if (normalized === "placement") return "Placement";
  if (normalized === "result") return "Result";
  if (normalized === "event") return "Event";
  throw new Error(`Unsupported notification type: ${String(rawType)}`);
}

function normalizeNotification(raw: RawNotification): RankedNotification {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid notification object");
  }

  const rawId = raw.id ?? raw.ID ?? raw.notificationId;
  const type = toNotificationType(raw.type ?? raw.Type);
  const message = String(raw.message ?? raw.Message ?? "").trim();
  const timestampRaw = raw.timestamp ?? raw.Timestamp;

  if (rawId === undefined || rawId === null || String(rawId).trim() === "") {
    throw new Error("Notification is missing id");
  }

  if (typeof rawId !== "string" && typeof rawId !== "number") {
    throw new Error("Notification id must be string or number");
  }

  const tsMs = Date.parse(String(timestampRaw));
  if (Number.isNaN(tsMs)) {
    throw new Error(`Invalid timestamp for id=${String(rawId)}`);
  }

  return {
    id: rawId,
    type,
    message,
    timestamp: new Date(tsMs).toISOString(),
    _priorityWeight: TYPE_WEIGHT[type.toLowerCase() as Lowercase<NotificationType>],
    _priorityTs: tsMs,
  };
}

function isLowerPriority(a: RankedNotification, b: RankedNotification): boolean {
  if (a._priorityWeight !== b._priorityWeight) {
    return a._priorityWeight < b._priorityWeight;
  }
  if (a._priorityTs !== b._priorityTs) {
    return a._priorityTs < b._priorityTs;
  }
  return String(a.id) < String(b.id);
}

function isHigherPriority(a: RankedNotification, b: RankedNotification): boolean {
  if (a._priorityWeight !== b._priorityWeight) {
    return a._priorityWeight > b._priorityWeight;
  }
  if (a._priorityTs !== b._priorityTs) {
    return a._priorityTs > b._priorityTs;
  }
  return String(a.id) > String(b.id);
}

class MinHeap<T> {
  private readonly data: T[] = [];
  private readonly compare: (a: T, b: T) => boolean;

  constructor(compareFn: (a: T, b: T) => boolean) {
    this.compare = compareFn;
  }

  size(): number {
    return this.data.length;
  }

  peek(): T | null {
    return this.data[0] ?? null;
  }

  push(value: T): void {
    this.data.push(value);
    this.bubbleUp(this.data.length - 1);
  }

  replaceTop(value: T): void {
    if (this.data.length === 0) {
      this.push(value);
      return;
    }
    this.data[0] = value;
    this.bubbleDown(0);
  }

  toArray(): T[] {
    return [...this.data];
  }

  private bubbleUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (!this.compare(this.data[i]!, this.data[parent]!)) {
        break;
      }
      [this.data[i], this.data[parent]] = [this.data[parent]!, this.data[i]!];
      i = parent;
    }
  }

  private bubbleDown(index: number): void {
    let i = index;
    const n = this.data.length;

    while (true) {
      let smallest = i;
      const left = i * 2 + 1;
      const right = i * 2 + 2;

      if (left < n && this.compare(this.data[left]!, this.data[smallest]!)) {
        smallest = left;
      }
      if (right < n && this.compare(this.data[right]!, this.data[smallest]!)) {
        smallest = right;
      }
      if (smallest === i) {
        break;
      }

      [this.data[i], this.data[smallest]] = [this.data[smallest]!, this.data[i]!];
      i = smallest;
    }
  }
}

export class TopNNotifications {
  private readonly limit: number;
  private readonly heap: MinHeap<RankedNotification>;

  constructor(limit = 10) {
    this.limit = limit;
    this.heap = new MinHeap<RankedNotification>(isLowerPriority);
  }

  add(notification: RankedNotification): void {
    if (this.heap.size() < this.limit) {
      this.heap.push(notification);
      return;
    }

    const lowest = this.heap.peek();
    if (lowest && isHigherPriority(notification, lowest)) {
      this.heap.replaceTop(notification);
    }
  }

  addMany(notifications: RankedNotification[]): void {
    notifications.forEach((n) => this.add(n));
  }

  getTopSorted(): NotificationRecord[] {
    return this.heap
      .toArray()
      .sort((a, b) => {
        if (a._priorityWeight !== b._priorityWeight) {
          return b._priorityWeight - a._priorityWeight;
        }
        if (a._priorityTs !== b._priorityTs) {
          return b._priorityTs - a._priorityTs;
        }
        return String(b.id).localeCompare(String(a.id));
      })
      .map(({ _priorityWeight, _priorityTs, ...clean }) => clean);
  }
}

export async function fetchNotifications(
  apiUrl = NOTIFICATIONS_API,
  init?: RequestInit
): Promise<RankedNotification[]> {
  const rawItems = await fetchNotificationsFromBackend(apiUrl, init);
  const normalized: RankedNotification[] = [];
  let invalidCount = 0;

  for (const raw of rawItems) {
    try {
      normalized.push(normalizeNotification(raw));
    } catch (error) {
      // Continue processing valid records if a few malformed items are present.
      console.warn("Skipping malformed notification", error);
      invalidCount += 1;
    }
  }

  if (invalidCount > 0) {
    void logEvent("frontend", "warn", "utils", `Skipped malformed notifications count=${invalidCount}`);
  }

  void logEvent("frontend", "info", "utils", `Normalized notifications count=${normalized.length}`);

  return normalized;
}

export async function getTop10Notifications(
  apiUrl = NOTIFICATIONS_API,
  init?: RequestInit
): Promise<NotificationRecord[]> {
  const notifications = await fetchNotifications(apiUrl, init);
  const tracker = new TopNNotifications(10);
  tracker.addMany(notifications);
  const topItems = tracker.getTopSorted();
  void logEvent("frontend", "info", "utils", `Top10 selection generated count=${topItems.length}`);
  return topItems;
}

export interface TopNStreamTracker {
  ingestBatch: (notifications: RankedNotification[]) => void;
  getTopSorted: () => NotificationRecord[];
}

export function createTopNStreamTracker(topN = 10): TopNStreamTracker {
  const seenIds = new Set<string>();
  const tracker = new TopNNotifications(topN);

  return {
    ingestBatch(notifications: RankedNotification[]) {
      notifications.forEach((notification) => {
        const key = String(notification.id);
        if (seenIds.has(key)) {
          return;
        }
        seenIds.add(key);
        tracker.add(notification);
      });
    },
    getTopSorted() {
      return tracker.getTopSorted();
    },
  };
}
