package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const sessionCookieName = "session_id"

// Session は1ログインセッション分の情報を保持する。
type Session struct {
	Email string
	Token *oauth2.Token
}

// SessionStore はセッションの永続化を担う(実装は internal/store.Store)。
type SessionStore interface {
	SaveSession(id, email string, token *oauth2.Token) error
	GetSession(id string) (email string, token *oauth2.Token, err error)
}

// Service はGoogle OAuthログインとセッション管理を担う。
type Service struct {
	config        *oauth2.Config
	allowedEmails map[string]bool
	store         SessionStore
}

// NewService は credentialsJSON (Google Cloud からダウンロードした
// 「ウェブ アプリケーション」タイプのOAuthクライアントJSONの中身) を読み込み、
// allowedEmails に含まれるアカウントのみログインを許可するServiceを構築する。
// セッションは sessionStore (Supabase/Postgres) に永続化されるため、
// サーバーの再起動・再デプロイ後もログイン状態が保たれる。
//
// redirectURL が空でなければ、credentialsJSON 内のリダイレクトURI(通常はローカル開発用の
// localhost)を上書きする。本番環境(Vercelなど)ではデプロイ先のURLを渡す必要がある。
func NewService(credentialsJSON []byte, allowedEmails []string, sessionStore SessionStore, redirectURL string) (*Service, error) {
	config, err := google.ConfigFromJSON(credentialsJSON,
		"openid",
		"https://www.googleapis.com/auth/userinfo.email",
		// 予定の追加機能のため、読み取り専用(calendar.readonly)から
		// 予定の読み書き(calendar.events)に変更。
		"https://www.googleapis.com/auth/calendar.events",
	)
	if err != nil {
		return nil, fmt.Errorf("parse credentials: %w", err)
	}
	if redirectURL != "" {
		config.RedirectURL = redirectURL
	}

	allowed := make(map[string]bool, len(allowedEmails))
	for _, e := range allowedEmails {
		allowed[e] = true
	}

	return &Service{
		config:        config,
		allowedEmails: allowed,
		store:         sessionStore,
	}, nil
}

// LoginHandler はGoogleのログイン・同意画面へリダイレクトする。
func (s *Service) LoginHandler(w http.ResponseWriter, r *http.Request) {
	url := s.config.AuthCodeURL("state", oauth2.AccessTypeOffline, oauth2.ApprovalForce)
	http.Redirect(w, r, url, http.StatusFound)
}

// CallbackHandler はGoogleからのリダイレクトを受け、認可コードをトークンに交換し、
// ログインしたアカウントがホワイトリストに含まれるか確認したうえでセッションを発行する。
func (s *Service) CallbackHandler(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "missing code", http.StatusBadRequest)
		return
	}

	token, err := s.config.Exchange(r.Context(), code)
	if err != nil {
		http.Error(w, "token exchange failed", http.StatusInternalServerError)
		return
	}

	email, err := fetchEmail(r.Context(), s.config, token)
	if err != nil {
		http.Error(w, "failed to fetch account info", http.StatusInternalServerError)
		return
	}

	if !s.allowedEmails[email] {
		http.Error(w, "forbidden: this account is not allowed to use this app", http.StatusForbidden)
		return
	}

	sessionID, err := newSessionID()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if err := s.store.SaveSession(sessionID, email, token); err != nil {
		http.Error(w, "failed to save session", http.StatusInternalServerError)
		return
	}
	log.Printf("[auth debug] saved session id=%s email=%s host=%s", sessionID, email, r.Host)

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	http.Redirect(w, r, "/", http.StatusFound)
}

// RequireAuth はセッションが無いリクエストをログイン画面へ誘導するミドルウェア。
func (s *Service) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := s.sessionFromRequest(r); !ok {
			http.Redirect(w, r, "/auth/google/login", http.StatusFound)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// HTTPClient はリクエストに紐づくセッションのトークンを使い、
// Google API 呼び出し用に認証済みの http.Client を返す。
func (s *Service) HTTPClient(r *http.Request) (*http.Client, bool) {
	sess, ok := s.sessionFromRequest(r)
	if !ok {
		return nil, false
	}
	return s.config.Client(context.Background(), sess.Token), true
}

func (s *Service) sessionFromRequest(r *http.Request) (*Session, bool) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		log.Printf("[auth debug] no cookie: path=%s host=%s err=%v", r.URL.Path, r.Host, err)
		return nil, false
	}
	email, token, err := s.store.GetSession(cookie.Value)
	if err != nil {
		log.Printf("[auth debug] session lookup failed: path=%s host=%s cookie=%s err=%v", r.URL.Path, r.Host, cookie.Value, err)
		return nil, false
	}
	log.Printf("[auth debug] session ok: path=%s email=%s", r.URL.Path, email)
	return &Session{Email: email, Token: token}, true
}

func fetchEmail(ctx context.Context, config *oauth2.Config, token *oauth2.Token) (string, error) {
	client := config.Client(ctx, token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var info struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", err
	}
	return info.Email, nil
}

func newSessionID() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}
