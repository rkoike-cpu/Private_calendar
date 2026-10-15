"use client";

import { useEffect, useState } from "react";

import { fetchVapidPublicKey, subscribePush, unsubscribePush } from "@/lib/api";

type Props = {
  onStatusChange: (status: string) => void;
  onError: (error: unknown) => void;
};

/** VAPID公開鍵(base64url文字列)を pushManager.subscribe が要求する形式に変換する。 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

/** プッシュ通知の購読を切り替えるボタン。非対応ブラウザでは表示しない。 */
export function NotifyButton({ onStatusChange, onError }: Props) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const existing = await registration.pushManager.getSubscription();
        if (!active) return;
        setSupported(true);
        setSubscribed(Boolean(existing));
      } catch {
        // Service Workerを登録できない環境では、ボタンを出さないだけでよい
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!supported) return null;

  async function toggle() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();

      if (existing) {
        await unsubscribePush(existing.endpoint);
        await existing.unsubscribe();
        setSubscribed(false);
        onStatusChange("通知をオフにしました");
        return;
      }

      if ((await Notification.requestPermission()) !== "granted") {
        onStatusChange("通知が許可されませんでした");
        return;
      }

      const { publicKey } = await fetchVapidPublicKey();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await subscribePush(subscription.toJSON());
      setSubscribed(true);
      onStatusChange("通知をオンにしました(予定の10分前に届きます)");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={subscribed}
      className={`rounded-md border px-3 py-1.5 text-sm disabled:opacity-50 ${
        subscribed ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-300"
      }`}
    >
      🔔 通知
    </button>
  );
}
