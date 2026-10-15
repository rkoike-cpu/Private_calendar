import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Calendar",
  description: "会社のGoogleカレンダー・天気・ToDoを1画面にまとめた個人用ダッシュボード",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
