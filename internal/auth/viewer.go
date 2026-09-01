package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"net/http"
)

const viewerCookieName = "viewer_session"

// ViewerStore はダッシュボードを閲覧してよい端末のセッションを永続化する。
type ViewerStore interface {
	SaveViewerSession(id string) error
	ViewerSessionExists(id string) (bool, error)
}

// ViewerService はダッシュボードへのアクセス制御を担う。
//
// Google認証(GoogleService)とは完全に独立している。会社のセキュリティポリシー上、
// 個人デバイスからのGoogleサインインが弾かれるため、ダッシュボード自体へのログインは
// シンプルな合言葉(パスワード)方式にしている。
type ViewerService struct {
	password string
	store    ViewerStore
}

func NewViewerService(password string, store ViewerStore) *ViewerService {
	return &ViewerService{password: password, store: store}
}

// LoginPageHandler は合言葉入力フォームを表示する。
func (s *ViewerService) LoginPageHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, loginPageHTML)
}

// LoginHandler は合言葉を確認し、正しければ長期間有効なセッションCookieを発行する。
func (s *ViewerService) LoginHandler(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	if subtle.ConstantTimeCompare([]byte(r.FormValue("password")), []byte(s.password)) != 1 {
		http.Error(w, "パスワードが違います", http.StatusUnauthorized)
		return
	}

	sessionID, err := newSessionID()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := s.store.SaveViewerSession(sessionID); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     viewerCookieName,
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   60 * 60 * 24 * 365, // 1年
	})
	http.Redirect(w, r, "/", http.StatusFound)
}

// RequireAuth は有効なビューアセッションが無いリクエストをログイン画面へ誘導する。
func (s *ViewerService) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(viewerCookieName)
		if err != nil {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		ok, err := s.store.ViewerSessionExists(cookie.Value)
		if err != nil || !ok {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func newSessionID() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

const loginPageHTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Personal Calendar</title>
  <link rel="manifest" href="/static/manifest.json" />
  <link rel="apple-touch-icon" href="/static/apple-touch-icon.png" />
  <link rel="icon" href="/static/icon-192.png" />
  <meta name="theme-color" content="#4a86e8" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <style>
    body { font-family: system-ui, sans-serif; max-width: 320px; margin: 4rem auto; padding: 1rem; }
    input { width: 100%; padding: 0.6rem; font-size: 1rem; margin-bottom: 0.75rem; box-sizing: border-box; }
    button { width: 100%; padding: 0.6rem; font-size: 1rem; background: #4a86e8; color: white; border: none; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Personal Calendar</h1>
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="合言葉" autofocus required />
    <button type="submit">ログイン</button>
  </form>
</body>
</html>`
