"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { CalendarSection } from "@/components/CalendarSection";
import { EventDialog } from "@/components/EventDialog";
import { NotifyButton } from "@/components/NotifyButton";
import { TodoSection } from "@/components/TodoSection";
import { WeatherSection } from "@/components/WeatherSection";
import { syncGoogle, UnauthorizedError, type CalendarEvent } from "@/lib/api";
import { startOfDay, type ViewMode } from "@/lib/calendar";

/** SCR-002 ダッシュボード画面。 */
export default function DashboardPage() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(() => startOfDay(new Date()));
  const [syncing, setSyncing] = useState(false);
  /** SCR-003の状態。undefined=閉じている、null=新規追加、予定=編集。 */
  const [editing, setEditing] = useState<CalendarEvent | null | undefined>(undefined);

  /** セッション切れを検知したらログイン画面へ戻す。各セクションから共通で使う。 */
  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setStatus(error instanceof Error ? error.message : "エラーが発生しました");
    },
    [router],
  );

  async function handleSync() {
    setSyncing(true);
    setStatus("同期中...");
    try {
      setEvents((await syncGoogle()) ?? []);
      setStatus(`最終同期: ${new Date().toLocaleTimeString("ja-JP")}`);
    } catch (error) {
      handleError(error);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Personal Calendar</h1>
        <div className="flex gap-2">
          <NotifyButton onStatusChange={setStatus} onError={handleError} />
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            + 予定を追加
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            同期
          </button>
        </div>
      </header>

      <p className="min-h-6 py-1 text-sm text-gray-600" role="status">
        {status}
      </p>

      <WeatherSection onError={handleError} />
      <TodoSection onError={handleError} onStatusChange={setStatus} />
      <CalendarSection
        events={events}
        viewMode={viewMode}
        currentDate={currentDate}
        onViewModeChange={setViewMode}
        onCurrentDateChange={setCurrentDate}
        onEventClick={setEditing}
      />

      {/* keyを変えて開き直すことで、前回の入力内容が残らないようにする */}
      {editing !== undefined && (
        <EventDialog
          key={editing?.ID ?? "new"}
          editing={editing}
          defaultDate={currentDate}
          onClose={() => setEditing(undefined)}
          onSaved={setEvents}
          onStatusChange={setStatus}
          onError={handleError}
        />
      )}
    </main>
  );
}
