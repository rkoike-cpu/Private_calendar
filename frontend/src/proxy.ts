import { NextResponse, type NextRequest } from "next/server";

/**
 * セッションCookieが無いリクエストをログイン画面へ転送する。
 *
 * これはCookieの有無だけを見る簡易チェックで、認証の判断そのものではない。
 * Cookieが本当に有効かはGo側の RequireAuth が毎回DBと照合する。ここでの目的は、
 * 明らかに未ログインの状態でダッシュボードを描画してAPIが全部失敗する、という
 * 無駄な往復を避けることにある。
 */
export default function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("viewer_session");
  const { pathname } = request.nextUrl;

  if (!hasSession && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }
  // Cookieを持っている場合に /login からダッシュボードへ戻す処理は入れない。
  // Cookieが残っているがGo側のセッションは失効している状態だと、
  // ダッシュボード→(APIが未認証)→/login→ダッシュボード、と往復し続けてしまう。
  return NextResponse.next();
}

export const config = {
  // /api/* はGoへ転送されるもので、認証もGo側で行うため対象外にする。
  matcher: ["/((?!api|auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|json|js)$).*)"],
};
