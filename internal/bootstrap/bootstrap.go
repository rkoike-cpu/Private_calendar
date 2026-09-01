// Package bootstrap は、アプリケーションの初期化処理をまとめる。
package bootstrap

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"personal-calendar/internal/auth"
	"personal-calendar/internal/handler"
	"personal-calendar/internal/push"
	"personal-calendar/internal/store"
	"personal-calendar/internal/weather"
)

// AllowedEmails はGoogleカレンダーへの認証を許可するアカウント。
var AllowedEmails = []string{"rkoike@netprotections.co.jp"}

// App は組み立て済みの各サービスをまとめたもの。
// Router はHTTPサーバー用、GoogleSvc/PushSvc/Store はリマインダーの
// バックグラウンド処理(internal/reminder)からも使う。
type App struct {
	Router    http.Handler
	GoogleSvc *auth.GoogleService
	PushSvc   *push.Service
	Store     *store.Store
}

func (a *App) Close() error {
	return a.Store.Close()
}

// New は環境変数から設定を読み込み、DB接続・各サービス・ルーターを構築する。
func New() (*App, error) {
	credentialsJSON, err := loadCredentials()
	if err != nil {
		return nil, fmt.Errorf("load credentials: %w", err)
	}

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set")
	}

	appStore, err := store.Open(dbURL)
	if err != nil {
		return nil, fmt.Errorf("open store: %w", err)
	}

	appPassword := strings.TrimSpace(os.Getenv("APP_PASSWORD"))
	if appPassword == "" {
		appStore.Close()
		return nil, fmt.Errorf("APP_PASSWORD is not set")
	}
	viewerSvc := auth.NewViewerService(appPassword, appStore)

	redirectURL := strings.TrimSpace(os.Getenv("OAUTH_REDIRECT_URL"))

	googleSvc, err := auth.NewGoogleService(credentialsJSON, AllowedEmails, appStore, redirectURL)
	if err != nil {
		appStore.Close()
		return nil, fmt.Errorf("init google auth: %w", err)
	}

	weatherAPIKey := strings.TrimSpace(os.Getenv("WEATHER_API_KEY"))
	if weatherAPIKey == "" {
		appStore.Close()
		return nil, fmt.Errorf("WEATHER_API_KEY is not set")
	}
	weatherSvc := weather.NewService(weatherAPIKey)

	vapidPublicKey := strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY"))
	vapidPrivateKey := strings.TrimSpace(os.Getenv("VAPID_PRIVATE_KEY"))
	if vapidPublicKey == "" || vapidPrivateKey == "" {
		appStore.Close()
		return nil, fmt.Errorf("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY is not set")
	}
	pushSubject := strings.TrimSpace(os.Getenv("VAPID_SUBJECT"))
	if pushSubject == "" {
		pushSubject = "mailto:" + AllowedEmails[0]
	}
	pushSvc := push.NewService(vapidPublicKey, vapidPrivateKey, pushSubject)

	router := handler.NewRouter(viewerSvc, googleSvc, weatherSvc, pushSvc, appStore)

	return &App{
		Router:    router,
		GoogleSvc: googleSvc,
		PushSvc:   pushSvc,
		Store:     appStore,
	}, nil
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
