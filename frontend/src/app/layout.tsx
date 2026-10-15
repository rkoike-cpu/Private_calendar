import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Calendar",
  description: "会社のGoogleカレンダー・天気・ToDoを1画面にまとめた個人用ダッシュボード",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Calendar", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4a86e8",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
