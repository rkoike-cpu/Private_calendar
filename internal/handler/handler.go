package handler

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"time"

	"personal-calendar/internal/auth"
	"personal-calendar/internal/calendar"
	"personal-calendar/internal/weather"
	webassets "personal-calendar/web"
)

// NewRouter は本アプリの全HTTPルーティングを構築する。
func NewRouter(authSvc *auth.Service) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /auth/google/login", authSvc.LoginHandler)
	mux.HandleFunc("GET /auth/google/callback", authSvc.CallbackHandler)

	mux.Handle("GET /", authSvc.RequireAuth(http.HandlerFunc(dashboardHandler)))
	mux.Handle("POST /api/sync/google", authSvc.RequireAuth(syncGoogleHandler(authSvc)))
	mux.Handle("POST /api/events", authSvc.RequireAuth(createEventHandler(authSvc)))
	mux.Handle("GET /api/weather/today", authSvc.RequireAuth(http.HandlerFunc(weatherTodayHandler)))

	staticFS, err := fs.Sub(webassets.FS, "static")
	if err != nil {
		panic(err) // 埋め込みファイルシステムの構成ミス。起動時に気づけるようpanicする。
	}
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.FS(staticFS))))

	return mux
}

// dashboardHandler はダッシュボード画面を返す。
func dashboardHandler(w http.ResponseWriter, r *http.Request) {
	data, err := webassets.FS.ReadFile("templates/dashboard.html")
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}

// syncGoogleHandler は Google Calendar から最新の予定を取得して返す。
// 「今月を含む前後1ヶ月(合計3ヶ月分の暦月)」を一度に取得する。
// 例: 今日が9月なら 8/1 00:00 〜 11/1 00:00(排他)の範囲。
func syncGoogleHandler(authSvc *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		client, ok := authSvc.HTTPClient(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		now := time.Now()
		firstOfThisMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		from := firstOfThisMonth.AddDate(0, -1, 0)
		to := firstOfThisMonth.AddDate(0, 2, 0)

		events, err := calendar.FetchRange(r.Context(), client, from, to)
		if err != nil {
			http.Error(w, "failed to fetch calendar events", http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(events)
	}
}

type createEventRequest struct {
	Summary string `json:"summary"`
	Start   string `json:"start"` // RFC3339
	End     string `json:"end"`   // RFC3339
}

// createEventHandler はGoogleカレンダーに新しい予定を作成する。
func createEventHandler(authSvc *auth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		client, ok := authSvc.HTTPClient(r)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req createEventRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Summary == "" {
			http.Error(w, "summary is required", http.StatusBadRequest)
			return
		}

		start, err := time.Parse(time.RFC3339, req.Start)
		if err != nil {
			http.Error(w, "invalid start time", http.StatusBadRequest)
			return
		}
		end, err := time.Parse(time.RFC3339, req.End)
		if err != nil {
			http.Error(w, "invalid end time", http.StatusBadRequest)
			return
		}
		if !end.After(start) {
			http.Error(w, "end must be after start", http.StatusBadRequest)
			return
		}

		event, err := calendar.CreateEvent(r.Context(), client, req.Summary, start, end)
		if err != nil {
			http.Error(w, "failed to create event", http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(event)
	}
}

// weatherTodayHandler は今日1日分の時間ごとの天気予報を返す。
func weatherTodayHandler(w http.ResponseWriter, r *http.Request) {
	forecast, err := weather.FetchToday(r.Context())
	if err != nil {
		http.Error(w, "failed to fetch weather", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(forecast)
}
