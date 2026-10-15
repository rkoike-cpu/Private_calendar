import Link from "next/link";

/**
 * SCR-004 Google連携完了画面。
 *
 * Googleの同意画面から戻ったあと、バックエンドがトークンの交換・アカウントの確認・
 * 保存まで終えてからこの画面へ転送してくる。連携したアカウントを必ず表示して、
 * 意図しないアカウントで連携した場合に気づけるようにする。
 */
export default async function GoogleLinkedPage(props: PageProps<"/google-linked">) {
  const { email } = await props.searchParams;
  const linkedEmail = typeof email === "string" ? email : null;

  return (
    <main className="mx-auto w-full max-w-[420px] px-4 py-16">
      <h1 className="mb-3 text-lg font-bold">Googleカレンダーとの連携が完了しました</h1>

      {linkedEmail && (
        <p className="mb-6 text-sm text-gray-600">
          連携したアカウント: <span className="font-medium">{linkedEmail}</span>
        </p>
      )}

      <Link href="/" className="text-blue-600 underline">
        ダッシュボードに戻る
      </Link>
    </main>
  );
}
