"use client";

import { useEffect, useState } from "react";

import { fetchWeather, type HourlyPoint, type WeatherCondition } from "@/lib/api";

const EMOJI: Record<WeatherCondition, string> = {
  clear: "☀️",
  "partly-cloudy": "⛅",
  cloudy: "☁️",
  fog: "🌫️",
  rain: "🌧️",
  snow: "🌨️",
  thunder: "⛈️",
  unknown: "❓",
};

type Props = {
  onError: (error: unknown) => void;
};

/** 今日1日の時間ごとの天気。現在時刻の枠を強調する。 */
export function WeatherSection({ onError }: Props) {
  const [hourly, setHourly] = useState<HourlyPoint[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const forecast = await fetchWeather();
        if (active) setHourly(forecast.hourly ?? []);
      } catch (error) {
        if (!active) return;
        setFailed(true);
        onError(error);
      }
    })();
    return () => {
      active = false;
    };
  }, [onError]);

  const nowHour = new Date().getHours();

  return (
    <section className="py-3">
      <h2 className="mb-2 text-base font-bold">今日の天気</h2>

      {failed ? (
        <p className="text-sm text-gray-500">天気の取得に失敗しました</p>
      ) : hourly === null ? (
        <p className="text-sm text-gray-500">読み込み中...</p>
      ) : (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {hourly.map((point) => {
            const hour = new Date(point.time).getHours();
            return (
              <div
                key={point.time}
                className={`flex min-w-14 shrink-0 flex-col items-center gap-0.5 rounded-md border px-2 py-1.5 text-center ${
                  hour === nowHour ? "border-blue-400 bg-blue-50" : "border-gray-200"
                }`}
              >
                <span className="text-xs text-gray-500">{hour}時</span>
                <span className="text-lg leading-none">{EMOJI[point.condition]}</span>
                <span className="text-xs tabular-nums">{Math.round(point.tempC)}℃</span>
                <span className="text-xs tabular-nums text-gray-500">
                  {Math.round(point.humidityPct)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
