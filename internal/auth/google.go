package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// GoogleStore はGoogleカレンダーへのアクセス権(1件のみ)の永続化を担う。
type GoogleStore interface {
	SaveGoogleAuth(email string, token *oauth2.Token) error
	GetGoogleAuth() (email string, token *oauth2.Token, err error)
}

// GoogleService は、サーバー全体で共有する「1つだけのGoogle認証」を管理する。
//
// 会社のセキュリティポリシー上、個人のスマホ等からのGoogleサインイン(同意画面)が
// ブロックされるため、この認証は信頼できる端末(会社PCなど)で一度だけ行う想定。
// 一度成功すればリフレッシュトークンが保存され、以降はどの端末からのリクエストでも
// サーバーがそれを使い回してGoogle Calendar APIを呼び出す。ブラウザのセッションには依存しない。
type GoogleService struct {
	config        *oauth2.Config
	allowedEmails map[string]bool
	store         GoogleStore
}

// NewGoogleService は credentialsJSON (Google Cloud からダウンロードした
// 「ウェブ アプリケーション」タイプのOAuthクライアントJSONの中身) を読み込む。
// redirectURL が空でなければ、credentialsJSON 内のリダイレクトURIを上書きする。
func NewGoogleService(credentialsJSON []byte, allowedEmails []string, store GoogleStore, redirectURL string) (*GoogleService, error) {
	config, err := google.ConfigFromJSON(credentialsJSON,
		"openid",
		"https://www.googleapis.com/auth/userinfo.email",
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

	return &GoogleService{config: config, allowedEmails: allowed, store: store}, nil
}

// LoginHandler はGoogleのログイン・同意画面へリダイレクトする。
// 信頼できる端末からのみ実行することを想定した「管理者操作」。
func (s *GoogleService) LoginHandler(w http.ResponseWriter, r *http.Request) {
	url := s.config.AuthCodeURL("state", oauth2.AccessTypeOffline, oauth2.ApprovalForce)
	http.Redirect(w, r, url, http.StatusFound)
}

// CallbackHandler はGoogleからのリダイレクトを受け、認可コードをトークンに交換し、
// アカウントがホワイトリストに含まれるか確認したうえで、共有の認証情報として保存する。
func (s *GoogleService) CallbackHandler(w http.ResponseWriter, r *http.Request) {
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
		http.Error(w, "forbidden: this account is not allowed to authorize this app", http.StatusForbidden)
		return
	}

	if err := s.store.SaveGoogleAuth(email, token); err != nil {
		http.Error(w, "failed to save authorization", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if _, err := fmt.Fprintf(w, `<p>Googleカレンダーとの連携が完了しました(%s)。</p><p><a href="/">ダッシュボードに戻る</a></p>`, email); err != nil {
		log.Printf("failed to write response: %v", err)
	}
}

// HTTPClient は、サーバーが保持している共有のGoogle認証情報を使い、
// Google API呼び出し用の認証済みHTTPクライアントを返す。特定のブラウザセッションには依存しない。
func (s *GoogleService) HTTPClient(ctx context.Context) (*http.Client, bool) {
	_, token, err := s.store.GetGoogleAuth()
	if err != nil {
		return nil, false
	}
	return s.config.Client(ctx, token), true
}

func fetchEmail(ctx context.Context, config *oauth2.Config, token *oauth2.Token) (string, error) {
	client := config.Client(ctx, token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return "", err
	}
	defer func() {
		if cerr := resp.Body.Close(); cerr != nil {
			log.Printf("failed to close response body: %v", cerr)
		}
	}()

	var info struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", err
	}
	return info.Email, nil
}
