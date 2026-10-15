"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { createTask, deleteTask, fetchTasks, setTaskDone, type Task } from "@/lib/api";

type Props = {
  onError: (error: unknown) => void;
  onStatusChange: (status: string) => void;
};

/**
 * ToDo欄。並び順(未完了が上、期限の早い順)はGo側のSQLが決めているため、
 * 追加・完了・削除のあとは手元で並べ替えず、一覧を取得し直す。
 */
export function TodoSection({ onError, onStatusChange }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  const reload = useCallback(async () => {
    try {
      setTasks((await fetchTasks()) ?? []);
    } catch (error) {
      onError(error);
    }
  }, [onError]);

  // 初期表示でToDo一覧を取得する。表示後に取りに行くため、取得が終わるまでは空の一覧になる。
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await fetchTasks();
        if (active) setTasks(loaded ?? []);
      } catch (error) {
        if (active) onError(error);
      }
    })();
    return () => {
      active = false;
    };
  }, [onError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    try {
      await createTask(trimmed, dueDate);
      setTitle("");
      setDueDate("");
      await reload();
    } catch (error) {
      onError(error);
    }
  }

  async function handleToggle(task: Task, done: boolean) {
    try {
      await setTaskDone(task.ID, done);
      await reload();
    } catch (error) {
      onError(error);
    }
  }

  async function handleDelete(task: Task) {
    try {
      await deleteTask(task.ID);
      await reload();
      onStatusChange("ToDoを削除しました");
    } catch (error) {
      onError(error);
    }
  }

  return (
    <section className="py-3">
      <h2 className="mb-2 text-base font-bold">ToDo</h2>

      <form onSubmit={handleSubmit} className="mb-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="やることを入力"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          追加
        </button>
      </form>

      <ul className="flex flex-col gap-1">
        {tasks.map((task) => (
          <li
            key={task.ID}
            className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              checked={task.Done}
              onChange={(event) => handleToggle(task, event.target.checked)}
              aria-label={`${task.Title}を完了にする`}
            />
            <span className={task.Done ? "flex-1 text-gray-400 line-through" : "flex-1"}>
              {task.Title}
            </span>
            {task.DueDate && <span className="text-xs text-gray-500">{task.DueDate}</span>}
            <button
              type="button"
              onClick={() => handleDelete(task)}
              aria-label={`${task.Title}を削除する`}
              className="px-1 text-gray-400 hover:text-red-600"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
