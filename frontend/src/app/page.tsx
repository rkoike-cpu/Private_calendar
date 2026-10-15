"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { TodoSection } from "@/components/TodoSection";
import { UnauthorizedError } from "@/lib/api";

/** SCR-002 ダッシュボード画面。 */
export default function DashboardPage() {
  const router = useRouter();
  const [status, setStatus] = useState("");

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

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Personal Calendar</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            🔔 通知
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            + 予定を追加
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            同期
          </button>
        </div>
      </header>

      <p className="min-h-6 py-1 text-sm text-gray-600" role="status">
        {status}
      </p>

      <TodoSection onError={handleError} onStatusChange={setStatus} />
    </main>
  );
}
