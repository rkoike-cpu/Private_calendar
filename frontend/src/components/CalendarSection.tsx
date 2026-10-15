"use client";

import { useEffect, useState } from "react";

import type { CalendarEvent } from "@/lib/api";
import {
  buildMonthGrid,
  buildWeekDays,
  categoryColor,
  DAY_LABELS,
  dateKey,
  formatTime,
  getDataBounds,
  GRID_END_HOUR,
  GRID_START_HOUR,
  groupEventsByDate,
  navLabel,
  nowLineTop,
  positionEventsForDay,
  ROW_HEIGHT,
  shiftDate,
  startOfDay,
  type ViewMode,
} from "@/lib/calendar";

type Props = {
  events: CalendarEvent[];
  viewMode: ViewMode;
  currentDate: Date;
  onViewModeChange: (mode: ViewMode) => void;
  onCurrentDateChange: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
};

const VIEW_MODES: { key: ViewMode; label: string }[] = [
  { key: "day", label: "日" },
  { key: "week", label: "週" },
  { key: "month", label: "月" },
];

const GRID_HEIGHT = (GRID_END_HOUR - GRID_START_HOUR) * ROW_HEIGHT;

export function CalendarSection({
  events,
  viewMode,
  currentDate,
  onViewModeChange,
  onCurrentDateChange,
  onEventClick,
}: Props) {
  // 現在時刻の線は再描画でしか動かないため、1分ごとに描き直して実際の時刻に追従させる。
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const { minDate, maxDate } = getDataBounds();
  const prevDisabled = shiftDate(currentDate, viewMode, -1) < minDate;
  const nextDisabled = shiftDate(currentDate, viewMode, 1) > maxDate;

  function move(delta: number) {
    const next = shiftDate(currentDate, viewMode, delta);
    if (next < minDate || next > maxDate) return;
    onCurrentDateChange(next);
  }

  return (
    <section className="py-3">
      <div className="mb-2 flex justify-center gap-1">
        {VIEW_MODES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onViewModeChange(key)}
            aria-pressed={viewMode === key}
            className={`rounded-md border px-4 py-1 text-sm ${
              viewMode === key
                ? "border-blue-500 bg-blue-500 text-white"
                : "border-gray-300 bg-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => move(-1)}
          disabled={prevDisabled}
          aria-label="前へ"
          className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-40"
        >
          &lt;
        </button>
        <span className="min-w-40 text-center text-sm font-medium tabular-nums">
          {navLabel(currentDate, viewMode)}
        </span>
        <button
          type="button"
          onClick={() => move(1)}
          disabled={nextDisabled}
          aria-label="次へ"
          className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-40"
        >
          &gt;
        </button>
      </div>

      {viewMode === "month" ? (
        <MonthView anchor={currentDate} events={events} onEventClick={onEventClick} />
      ) : (
        <TimeGridView
          days={viewMode === "day" ? [startOfDay(currentDate)] : buildWeekDays(currentDate)}
          events={events}
          onEventClick={onEventClick}
        />
      )}
    </section>
  );
}

/** 日表示・週表示で使う時間軸グリッド。 */
function TimeGridView({
  days,
  events,
  onEventClick,
}: {
  days: Date[];
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
}) {
  const today = startOfDay(new Date());
  const hours = Array.from(
    { length: GRID_END_HOUR - GRID_START_HOUR + 1 },
    (_, i) => GRID_START_HOUR + i,
  );
  const nowTop = nowLineTop();

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <div className="min-w-[560px]">
        <div className="flex border-b border-gray-200 bg-gray-50">
          <div className="w-12 shrink-0" />
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className={`flex-1 py-1.5 text-center text-xs ${
                day.getTime() === today.getTime() ? "font-bold text-blue-600" : "text-gray-600"
              }`}
            >
              {day.getMonth() + 1}/{day.getDate()}({DAY_LABELS[day.getDay()]})
            </div>
          ))}
        </div>

        <div className="flex max-h-[70vh] overflow-y-auto">
          <div className="relative w-12 shrink-0" style={{ height: GRID_HEIGHT }}>
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-gray-400 tabular-nums"
                style={{ top: (hour - GRID_START_HOUR) * ROW_HEIGHT }}
              >
                {hour}:00
              </div>
            ))}
          </div>

          <div className="flex flex-1">
            {days.map((day) => (
              <DayColumn
                key={day.toISOString()}
                day={day}
                events={events}
                nowTop={day.getTime() === today.getTime() ? nowTop : null}
                hours={hours}
                onEventClick={onEventClick}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  events,
  nowTop,
  hours,
  onEventClick,
}: {
  day: Date;
  events: CalendarEvent[];
  nowTop: number | null;
  hours: number[];
  onEventClick: (event: CalendarEvent) => void;
}) {
  const positioned = positionEventsForDay(day, events);

  return (
    <div
      className="relative flex-1 border-l border-gray-200 first:border-l-0"
      style={{ height: GRID_HEIGHT }}
    >
      {hours.map((hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 border-t border-gray-100"
          style={{ top: (hour - GRID_START_HOUR) * ROW_HEIGHT }}
        />
      ))}

      {positioned.map((item) => (
        <button
          key={item.event.ID}
          type="button"
          onClick={() => onEventClick(item.event)}
          title={`${item.event.Summary}\n${formatTime(item.start)}〜${formatTime(item.end)}${
            item.event.Location ? `\n${item.event.Location}` : ""
          }`}
          className="absolute overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight text-white"
          style={{
            top: item.topPx,
            height: item.heightPx,
            left: `calc(${item.leftPct}% + 2px)`,
            width: `calc(${item.widthPct}% - 4px)`,
            background: categoryColor(item.event.Category),
          }}
        >
          {formatTime(item.start)} {item.event.Summary}
        </button>
      ))}

      {nowTop !== null && (
        <div
          className="pointer-events-none absolute inset-x-0 border-t-2 border-red-500"
          style={{ top: nowTop }}
        />
      )}
    </div>
  );
}

const MONTH_MAX_SHOWN = 3;

function MonthView({
  anchor,
  events,
  onEventClick,
}: {
  anchor: Date;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
}) {
  const today = startOfDay(new Date());
  const byDate = groupEventsByDate(events);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <div className="grid min-w-[560px] grid-cols-7">
        {DAY_LABELS.map((label) => (
          <div
            key={label}
            className="border-b border-gray-200 bg-gray-50 py-1 text-center text-xs text-gray-600"
          >
            {label}
          </div>
        ))}

        {buildMonthGrid(anchor).map((day) => {
          const dayEvents = byDate.get(dateKey(day)) ?? [];
          const outside = day.getMonth() !== anchor.getMonth();
          const isToday = day.getTime() === today.getTime();

          return (
            <div
              key={day.toISOString()}
              className={`min-h-20 border-t border-l border-gray-100 p-1 first:border-l-0 ${
                outside ? "bg-gray-50 text-gray-400" : ""
              }`}
            >
              <div
                className={`mb-0.5 text-[11px] tabular-nums ${
                  isToday ? "font-bold text-blue-600" : ""
                }`}
              >
                {day.getDate()}
              </div>

              {dayEvents.slice(0, MONTH_MAX_SHOWN).map((event) => (
                <button
                  key={event.ID}
                  type="button"
                  onClick={() => onEventClick(event)}
                  title={event.Summary}
                  className="mb-0.5 block w-full truncate rounded px-1 text-left text-[10px] text-white"
                  style={{ background: categoryColor(event.Category) }}
                >
                  {formatTime(new Date(event.Start))} {event.Summary}
                </button>
              ))}

              {dayEvents.length > MONTH_MAX_SHOWN && (
                <div className="text-[10px] text-gray-500">
                  +{dayEvents.length - MONTH_MAX_SHOWN}件
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
