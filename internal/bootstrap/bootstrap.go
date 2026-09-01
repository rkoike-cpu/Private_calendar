// Package bootstrap は、アプリケーションの初期化処理をまとめる。
package bootstrap

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"personal-calendar/internal/auth"
	"personal-calendar/internal/handler"
	"personal-calendar/internal/store"
)

// AllowedEmails はGoogleカレンダーへの認証を許可するアカウント。
var AllowedEmails = []string{"rkoike@netprotections.co.jp"}

// NewRouter は環境変数から設定を読み込み、DB接続・認証サービス・ルーターを構築する。
func NewRouter() (router http.Handler, cleanup func(), err error) {
	credentialsJSON, err := loadCredentials()
	if err != nil {
		return nil, nil, fmt.Errorf("load credentials: %w", err)
	}

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		return nil, nil, fmt.Errorf("DATABASE_URL is not set")
	}

	appStore, err := store.Open(dbURL)
	if err != nil {
		return nil, nil, fmt.Errorf("open store: %w", err)
	}

	appPassword := strings.TrimSpace(os.Getenv("APP_PASSWORD"))
	if appPassword == "" {
		appStore.Close()
		return nil, nil, fmt.Errorf("APP_PASSWORD is not set")
	}
	viewerSvc := auth.NewViewerService(appPassword, appStore)

	redirectURL := strings.TrimSpace(os.Getenv("OAUTH_REDIRECT_URL"))

	googleSvc, err := auth.NewGoogleService(credentialsJSON, AllowedEmails, appStore, redirectURL)
	if err != nil {
		appStore.Close()
		return nil, nil, fmt.Errorf("init google auth: %w", err)
	}

	return handler.NewRouter(viewerSvc, googleSvc), func() { appStore.Close() }, nil
}

// loadCredentials は環境変数 GOOGLE_OAUTH_CREDENTIALS_JSON (JSON文字列そのもの) を優先し、
// 無ければ GOOGLE_OAUTH_CREDENTIALS_FILE (ファイルパス、ローカル開発用) を読む。
func loadCredentials() ([]byte, error) {
	if raw := strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_CREDENTIALS_JSON")); raw != "" {
		return []byte(raw), nil
	}

	path := os.Getenv("GOOGLE_OAUTH_CREDENTIALS_FILE")
	if path == "" {
		path = "client_secret_15308071129-7nh1hs5dlt5o11b1rustb6otv358mj5s.apps.googleusercontent.com.json"
	}
	return os.ReadFile(path)
}
