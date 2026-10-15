// カレンダー表示のための計算。外部依存を持たない純粋関数だけを置く。

import type { CalendarEvent } from "@/lib/api";

/** 時間軸グリッドに表示する時間帯。 */
export const GRID_START_HOUR = 7;
export const GRID_END_HOUR = 22;
/** 1時間あたりの高さ(px)。 */
export const ROW_HEIGHT = 44;

export const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export type ViewMode = "day" | "week" | "month";

/**
 * 予定の色分けカテゴリ。key="" が未分類(仕事)で、これまで通りの青になる。
 * この色分けはこのアプリの画面表示だけのもので、Googleカレンダー本体には影響しない。
 */
export const CATEGORIES = [
  { key: "", label: "仕事", color: "#4a86e8" },
  { key: "personal", label: "プライベート", color: "#34a853" },
  { key: "important", label: "重要", color: "#e04141" },
  { key: "travel", label: "移動", color: "#a142f4" },
] as const;

export function categoryColor(key: string): string {
  return CATEGORIES.find((c) => c.key === (key || ""))?.color ?? CATEGORIES[0].color;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

/** "YYYY-MM-DD"。<input type="date"> に入れる形式。 */
export function formatDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "HH:MM"。<input type="time"> に入れる形式。 */
export function formatTimeInput(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 表示できる日付の範囲。サーバーが取得するのは「今月の前後1ヶ月(暦月)」なので、
 * その範囲を超えて移動しても表示できる予定が無い。
 */
export function getDataBounds(today: Date = new Date()): { minDate: Date; maxDate: Date } {
  return {
    minDate: new Date(today.getFullYear(), today.getMonth() - 1, 1),
    maxDate: new Date(today.getFullYear(), today.getMonth() + 2, 0),
  };
}

/** 基準日から、その週の日曜〜土曜の7日分を返す。 */
export function buildWeekDays(anchor: Date): Date[] {
  const sunday = startOfDay(anchor);
  sunday.setDate(sunday.getDate() - sunday.getDay());

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/** 表示モードに応じて、基準日を前後に動かした日付を返す。 */
export function shiftDate(date: Date, viewMode: ViewMode, delta: number): Date {
  const next = new Date(date);
  if (viewMode === "day") next.setDate(next.getDate() + delta);
  else if (viewMode === "week") next.setDate(next.getDate() + delta * 7);
  else next.setMonth(next.getMonth() + delta);
  return next;
}

/** 日付ナビの見出し。 */
export function navLabel(date: Date, viewMode: ViewMode): string {
  if (viewMode === "day") {
    return `${date.getMonth() + 1}/${date.getDate()}(${DAY_LABELS[date.getDay()]})`;
  }
  if (viewMode === "week") {
    const days = buildWeekDays(date);
    return `${days[0].getMonth() + 1}/${days[0].getDate()} 〜 ${days[6].getMonth() + 1}/${days[6].getDate()}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** グリッド上に配置済みの予定。top/heightはpx、left/widthは%。 */
export type PositionedEvent = {
  event: CalendarEvent;
  start: Date;
  end: Date;
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
};

type LaidOutItem = {
  event: CalendarEvent;
  start: Date;
  end: Date;
  col: number;
  colCount: number;
};

/**
 * 同じ日の予定同士で時間帯が重なっている場合に、横に並べて表示できるよう
 * 各予定へ列番号(col)と、その重なりグループの列数(colCount)を割り当てる。
 */
export function layoutOverlappingEvents(events: CalendarEvent[]): LaidOutItem[] {
  const items = events
    .map((event) => ({ event, start: new Date(event.Start), end: new Date(event.End) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());

  // 連続して重なり合う予定を1つのグループにまとめる
  const groups: (typeof items)[] = [];
  let group: typeof items = [];
  // グループ内で最も遅い終了時刻。まだグループが空なら 0。
  let groupEndMs = 0;
  for (const item of items) {
    // 直前までのグループと重なっていなければ、そこで区切って新しいグループを始める
    if (group.length > 0 && item.start.getTime() >= groupEndMs) {
      groups.push(group);
      group = [];
      groupEndMs = 0;
    }
    group.push(item);
    groupEndMs = Math.max(groupEndMs, item.end.getTime());
  }
  if (group.length > 0) groups.push(group);

  const result: LaidOutItem[] = [];
  for (const g of groups) {
    // 各予定を、直前の予定が終わっている最初の列に割り当てる(貪欲法)
    const columnEndTimes: Date[] = [];
    const assigned = g.map((item) => {
      let col = columnEndTimes.findIndex((endTime) => endTime <= item.start);
      if (col === -1) {
        col = columnEndTimes.length;
        columnEndTimes.push(item.end);
      } else {
        columnEndTimes[col] = item.end;
      }
      return { ...item, col };
    });
    for (const item of assigned) {
      result.push({ ...item, colCount: columnEndTimes.length });
    }
  }
  return result;
}

/** 指定した1日分の予定を、グリッド上の位置に変換する。 */
export function positionEventsForDay(day: Date, events: CalendarEvent[]): PositionedEvent[] {
  const target = startOfDay(day).getTime();
  const dayEvents = events.filter(
    (event) => startOfDay(new Date(event.Start)).getTime() === target,
  );

  const gridStartMin = GRID_START_HOUR * 60;
  const gridEndMin = GRID_END_HOUR * 60;

  return layoutOverlappingEvents(dayEvents).map((item) => {
    const startMin = clamp(
      item.start.getHours() * 60 + item.start.getMinutes(),
      gridStartMin,
      gridEndMin,
    );
    const endMin = clamp(item.end.getHours() * 60 + item.end.getMinutes(), gridStartMin, gridEndMin);
    const widthPct = 100 / item.colCount;

    return {
      event: item.event,
      start: item.start,
      end: item.end,
      topPx: ((startMin - gridStartMin) / 60) * ROW_HEIGHT,
      // 短い予定でも文字が読めるよう、最低限の高さを確保する
      heightPx: Math.max(((endMin - startMin) / 60) * ROW_HEIGHT, 18),
      leftPct: item.col * widthPct,
      widthPct,
    };
  });
}

/**
 * 現在時刻を示す線の位置(px)。グリッドの時間帯の外なら null。
 */
export function nowLineTop(now: Date = new Date()): number | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const gridStartMin = GRID_START_HOUR * 60;
  if (nowMin < gridStartMin || nowMin > GRID_END_HOUR * 60) return null;
  return ((nowMin - gridStartMin) / 60) * ROW_HEIGHT;
}

/** 月表示用に、予定を日付ごとにまとめる(各日は開始時刻順)。 */
export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = dateKey(new Date(event.Start));
    const list = map.get(key);
    if (list) list.push(event);
    else map.set(key, [event]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(a.Start).getTime() - new Date(b.Start).getTime());
  }
  return map;
}

/** 月表示のマス目42個分(前後の月の日を含む6週間)。 */
export function buildMonthGrid(anchor: Date): Date[] {
  const gridStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}
