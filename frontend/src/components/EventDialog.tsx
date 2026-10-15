"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  createEvent,
  deleteEvent,
  setEventCategory,
  updateEvent,
  type CalendarEvent,
  type EventInput,
} from "@/lib/api";
import { CATEGORIES, formatDateInput, formatTimeInput } from "@/lib/calendar";

type Props = {
  /** null なら新規追加、予定が渡されていれば編集。 */
  editing: CalendarEvent | null;
  /** 新規追加のときに日付欄の初期値として使う日付。 */
  defaultDate: Date;
  onClose: () => void;
  onSaved: (events: (prev: CalendarEvent[]) => CalendarEvent[]) => void;
  onStatusChange: (status: string) => void;
  onError: (error: unknown) => void;
};

type FormState = {
  summary: string;
  date: string;
  start: string;
  end: string;
  location: string;
  category: string;
};

function toFormState(event: CalendarEvent | null, defaultDate: Date): FormState {
  if (!event) {
    return {
      summary: "",
      date: formatDateInput(defaultDate),
      start: "",
      end: "",
      location: "",
      category: "",
    };
  }
  const start = new Date(event.Start);
  const end = new Date(event.End);
  return {
    summary: event.Summary,
    date: formatDateInput(start),
    start: formatTimeInput(start),
    end: formatTimeInput(end),
    location: event.Location ?? "",
    category: event.Category ?? "",
  };
}

/**
 * SCR-003 予定追加・編集ダイアログ。ダッシュボードの上にモーダルとして重なる。
 *
 * 開いている間だけ描画される想定。呼び出し側がkeyを変えて開き直すことで、
 * 入力内容が前回の状態を引きずらないようにしている。
 */
export function EventDialog({
  editing,
  defaultDate,
  onClose,
  onSaved,
  onStatusChange,
  onError,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<FormState>(() => toFormState(editing, defaultDate));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isEditing = Boolean(editing);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // showModal()はブラウザが自動で最初の入力欄へフォーカスを当てるため、
    // スマホでは開いた瞬間にキーボードが出てしまう。フォーカスを外して防ぐ。
    (document.activeElement as HTMLElement | null)?.blur();
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const summary = form.summary.trim();
    if (!summary || !form.date || !form.start || !form.end) return;

    const start = new Date(`${form.date}T${form.start}:00`);
    const end = new Date(`${form.date}T${form.end}:00`);
    if (end <= start) {
      setError("終了時刻は開始時刻より後にしてください。");
      return;
    }

    setError(null);
    setSubmitting(true);
    onStatusChange(isEditing ? "予定を更新中..." : "予定を追加中...");

    const input = {
      summary,
      location: form.location.trim(),
      start: start.toISOString(),
      end: end.toISOString(),
    };

    try {
      if (editing) {
        await submitUpdate(editing.ID, input);
      } else {
        await submitCreate(input);
      }
    } catch (err) {
      onError(err);
      onStatusChange("");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCreate(input: EventInput) {
    let saved: CalendarEvent;
    try {
      saved = await createEvent(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "追加に失敗しました");
      onStatusChange("");
      return;
    }

    const categorySaved = await trySetCategory(saved.ID, form.category);
    onSaved((prev) => [...prev, { ...saved, Category: form.category }]);
    onClose();
    onStatusChange(
      categorySaved ? "予定を追加しました" : "予定は追加しましたが、カテゴリの保存に失敗しました",
    );
  }

  /**
   * 色分け(カテゴリ)はこのアプリ内だけの情報でGoogle側に影響しないため、
   * 件名・時間の更新が(主催者でない等の理由で)失敗しても、色の変更だけは必ず試みる。
   */
  async function submitUpdate(id: string, input: EventInput) {
    let saved: CalendarEvent | null = null;
    let updateFailed: string | null = null;
    try {
      saved = await updateEvent(id, input);
    } catch (err) {
      updateFailed = err instanceof Error ? err.message : "更新に失敗しました";
    }

    const categorySaved = await trySetCategory(id, form.category);

    onSaved((prev) =>
      prev.map((ev) =>
        ev.ID !== id
          ? ev
          : saved
            ? { ...saved, Category: form.category }
            : { ...ev, Category: form.category },
      ),
    );

    if (updateFailed) {
      setError(`${updateFailed}(色の変更は${categorySaved ? "反映しました" : "失敗しました"})`);
      onStatusChange("");
      return;
    }

    onClose();
    onStatusChange(
      categorySaved ? "予定を更新しました" : "予定は更新しましたが、カテゴリの保存に失敗しました",
    );
  }

  async function trySetCategory(id: string, category: string): Promise<boolean> {
    try {
      await setEventCategory(id, category);
      return true;
    } catch {
      return false;
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm("この予定を削除しますか?")) return;

    setError(null);
    onStatusChange("予定を削除中...");
    try {
      await deleteEvent(editing.ID);
      onSaved((prev) => prev.filter((ev) => ev.ID !== editing.ID));
      onClose();
      onStatusChange("予定を削除しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
      onStatusChange("");
    }
  }

  const mapLink = form.location.trim()
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(form.location.trim())}`
    : null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="w-[min(92vw,420px)] rounded-lg p-0 backdrop:bg-black/40"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
        <h2 className="text-lg font-bold">{isEditing ? "予定を編集" : "予定を追加"}</h2>

        <label className="flex flex-col gap-1 text-sm">
          タイトル
          <input
            type="text"
            required
            value={form.summary}
            onChange={(e) => update("summary", e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          日付
          <input
            type="date"
            required
            value={form.date}
            onChange={(e) => update("date", e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            開始時刻
            <input
              type="time"
              required
              value={form.start}
              onChange={(e) => update("start", e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            終了時刻
            <input
              type="time"
              required
              value={form.end}
              onChange={(e) => update("end", e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          場所
          <input
            type="text"
            placeholder="例: 東京駅"
            value={form.location}
            onChange={(e) => update("location", e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        {mapLink && (
          <a
            href={mapLink}
            target="_blank"
            rel="noopener"
            className="text-sm text-blue-600 underline"
          >
            📍地図で見る
          </a>
        )}

        <label className="flex flex-col gap-1 text-sm">
          カテゴリ
          <select
            value={form.category}
            onChange={(e) => update("category", e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
          >
            {CATEGORIES.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          {isEditing && (
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-600"
            >
              削除
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {isEditing ? "更新" : "追加"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
