"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ApiError, login } from "@/lib/api";

/** SCR-001 ログイン画面。合言葉を入力してセッションCookieを得る。 */
export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(password);
      router.push("/");
    } catch (err) {
      setError(
        err instanceof ApiError && err.message ? err.message : "ログインに失敗しました",
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[320px] px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold">Personal Calendar</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="password"
          name="password"
          placeholder="合言葉"
          autoFocus
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base
            focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-blue-500 px-3 py-2.5 text-base font-medium text-white
            hover:bg-blue-600 disabled:opacity-60"
        >
          {submitting ? "確認中..." : "ログイン"}
        </button>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
