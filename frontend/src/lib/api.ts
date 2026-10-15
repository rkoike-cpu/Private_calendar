// Goバックエンドとのやり取りをまとめる。
// ブラウザからは同一オリジンの /api/* を呼び、next.config.ts の rewrites がGoへ転送する。

/** 予定。Google Calendar由来の項目に、このアプリ独自のCategoryを足したもの。 */
export type CalendarEvent = {
  ID: string;
  Summary: string;
  Start: string;
  End: string;
  Location: string;
  Category: string;
};

/** ToDo。Googleカレンダーとは無関係な、このアプリ内で完結する項目。 */
export type Task = {
  ID: string;
  Title: string;
  /** "YYYY-MM-DD" 形式。期限なしの場合は空文字。 */
  DueDate: string;
  Done: boolean;
};

export type WeatherCondition =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "rain"
  | "snow"
  | "thunder"
  | "unknown";

export type HourlyPoint = {
  time: string;
  tempC: number;
  humidityPct: number;
  condition: WeatherCondition;
};

export type Forecast = {
  hourly: HourlyPoint[] | null;
};

/**
 * セッションが無効だったことを表す。Goは未認証のリクエストをログイン画面へ
 * 302で転送するため、fetchはログイン画面のHTMLを受け取ってしまう。
 * それをJSONとして読もうとして失敗する前に、この型で呼び出し側へ知らせる。
 */
export class UnauthorizedError extends Error {
  constructor() {
    super("セッションが無効です");
    this.name = "UnauthorizedError";
  }
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { redirect: "manual", ...init });

  // Goの RequireAuth は未認証なら /login へ302を返す。redirect:"manual" では
  // リダイレクトが status 0 の不透明なレスポンスになるので、それを未認証とみなす。
  if (res.type === "opaqueredirect" || res.status === 0) {
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const message = await res.text();
    throw new ApiError(res.status, message.trim());
  }
  return res;
}

async function requestJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, init);
  return (await res.json()) as T;
}

function jsonBody(value: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

/** 合言葉でログインする。成功すればセッションCookieが発行される。 */
export async function login(password: string): Promise<void> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }),
    redirect: "manual",
  });

  // 成功時、Goは302でダッシュボードへ転送する(Cookieはこの応答で発行済み)。
  if (res.type === "opaqueredirect" || res.status === 0 || res.ok) {
    return;
  }
  throw new ApiError(res.status, (await res.text()).trim());
}

export function syncGoogle(): Promise<CalendarEvent[] | null> {
  return requestJSON<CalendarEvent[] | null>("/api/sync/google", { method: "POST" });
}

export function fetchWeather(): Promise<Forecast> {
  return requestJSON<Forecast>("/api/weather/today");
}

export function fetchTasks(): Promise<Task[] | null> {
  return requestJSON<Task[] | null>("/api/tasks");
}

export function createTask(title: string, dueDate: string): Promise<Task> {
  return requestJSON<Task>("/api/tasks", {
    method: "POST",
    ...jsonBody({ title, dueDate }),
  });
}

export async function setTaskDone(id: string, done: boolean): Promise<void> {
  await request(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    ...jsonBody({ done }),
  });
}

export async function deleteTask(id: string): Promise<void> {
  await request(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type EventInput = {
  summary: string;
  location: string;
  start: string;
  end: string;
};

export function createEvent(input: EventInput): Promise<CalendarEvent> {
  return requestJSON<CalendarEvent>("/api/events", { method: "POST", ...jsonBody(input) });
}

export function updateEvent(id: string, input: EventInput): Promise<CalendarEvent> {
  return requestJSON<CalendarEvent>(`/api/events/${encodeURIComponent(id)}`, {
    method: "PUT",
    ...jsonBody(input),
  });
}

export async function deleteEvent(id: string): Promise<void> {
  await request(`/api/events/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function setEventCategory(id: string, category: string): Promise<void> {
  await request(`/api/events/${encodeURIComponent(id)}/category`, {
    method: "PUT",
    ...jsonBody({ category }),
  });
}

export function fetchVapidPublicKey(): Promise<{ publicKey: string }> {
  return requestJSON<{ publicKey: string }>("/api/push/vapid-public-key");
}

export async function subscribePush(subscription: PushSubscriptionJSON): Promise<void> {
  await request("/api/push/subscribe", { method: "POST", ...jsonBody(subscription) });
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  await request("/api/push/unsubscribe", { method: "POST", ...jsonBody({ endpoint }) });
}
