package handler

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"time"

	"google.golang.org/api/googleapi"

	"personal-calendar/internal/auth"
	"personal-calendar/internal/calendar"
	"personal-calendar/internal/push"
	"personal-calendar/internal/store"
	"personal-calendar/internal/weather"
	webassets "personal-calendar/web"
)

// writeCalendarError はGoogle Calendar APIのエラーを見て、可能であれば
// ユーザーに分かりやすいメッセージを返す。
func writeCalendarError(w http.ResponseWriter, err error, fallback string) {
	if gerr, ok := err.(*googleapi.Error); ok && gerr.Code == http.StatusForbidden {
		http.Error(w, "この予定はあなたが主催者ではないため変更できません(Googleカレンダーの仕様)", http.StatusForbidden)
		return
	}
	http.Error(w, fallback, http.StatusBadGateway)
}

// NewRouter は本アプリの全HTTPルーティングを構築する。
//
// viewerSvc: ダッシュボードへのアクセス制御(合言葉ログイン、端末ごと)
// googleSvc: Googleカレンダーへのアクセス(サーバー全体で共有する1つの認証)
// weatherSvc: 天気予報の取得
// pushSvc: プッシュ通知の送信、appStore: 通知購読情報の保存
func NewRouter(viewerSvc *auth.ViewerService, googleSvc *auth.GoogleService, weatherSvc *weather.Service, pushSvc *push.Service, appStore *store.Store) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /login", viewerSvc.LoginPageHandler)
	mux.HandleFunc("POST /login", viewerSvc.LoginHandler)

	mux.Handle("GET /auth/google/login", viewerSvc.RequireAuth(http.HandlerFunc(googleSvc.LoginHandler)))
	mux.Handle("GET /auth/google/callback", viewerSvc.RequireAuth(http.HandlerFunc(googleSvc.CallbackHandler)))

	mux.Handle("GET /", viewerSvc.RequireAuth(http.HandlerFunc(dashboardHandler)))
	mux.HandleFunc("GET /sw.js", serviceWorkerHandler)
	mux.Handle("POST /api/sync/google", viewerSvc.RequireAuth(syncGoogleHandler(googleSvc, appStore)))
	mux.Handle("POST /api/events", viewerSvc.RequireAuth(createEventHandler(googleSvc)))
	mux.Handle("PUT /api/events/{id}", viewerSvc.RequireAuth(updateEventHandler(googleSvc)))
	mux.Handle("DELETE /api/events/{id}", viewerSvc.RequireAuth(deleteEventHandler(googleSvc)))
	mux.Handle("PUT /api/events/{id}/category", viewerSvc.RequireAuth(setEventCategoryHandler(appStore)))
	mux.Handle("GET /api/weather/today", viewerSvc.RequireAuth(weatherTodayHandler(weatherSvc)))
	mux.Handle("GET /api/push/vapid-public-key", viewerSvc.RequireAuth(vapidPublicKeyHandler(pushSvc)))
	mux.Handle("POST /api/push/subscribe", viewerSvc.RequireAuth(pushSubscribeHandler(appStore)))
	mux.Handle("POST /api/push/unsubscribe", viewerSvc.RequireAuth(pushUnsubscribeHandler(appStore)))
	mux.Handle("GET /api/tasks", viewerSvc.RequireAuth(listTasksHandler(appStore)))
	mux.Handle("POST /api/tasks", viewerSvc.RequireAuth(createTaskHandler(appStore)))
	mux.Handle("PATCH /api/tasks/{id}", viewerSvc.RequireAuth(updateTaskHandler(appStore)))
	mux.Handle("DELETE /api/tasks/{id}", viewerSvc.RequireAuth(deleteTaskHandler(appStore)))

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

// serviceWorkerHandler はService Workerをルート直下(/sw.js)から配信する。
// ブラウザはService Workerの適用範囲(scope)をそのスクリプトの置き場所以下に
// 制限するため、ダッシュボード全体(/)に効かせるにはルート直下から配信する必要がある。
func serviceWorkerHandler(w http.ResponseWriter, r *http.Request) {
	data, err := webassets.FS.ReadFile("static/sw.js")
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Write(data)
}

// syncGoogleHandler は Google Calendar から最新の予定を取得して返す。
// 「今月を含む前後1ヶ月(合計3ヶ月分の暦月)」を一度に取得する。
// 例: 今日が9月なら 8/1 00:00 〜 11/1 00:00(排他)の範囲。
func syncGoogleHandler(googleSvc *auth.GoogleService, appStore *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		client, ok := googleSvc.HTTPClient(r.Context())
		if !ok {
			http.Error(w, "Googleカレンダーが未連携です。会社PCなど信頼できる端末で /auth/google/login を開いて連携してください。", http.StatusPreconditionFailed)
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

		categories, err := appStore.GetEventCategories()
		if err != nil {
			http.Error(w, "failed to load categories", http.StatusInternalServerError)
			return
		}
		for i := range events {
			events[i].Category = categories[events[i].ID]
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(events)
	}
}

type createEventRequest struct {
	Summary  string `json:"summary"`
	Location string `json:"location"`
	Start    string `json:"start"` // RFC3339
	End      string `json:"end"`   // RFC3339
}

// createEventHandler はGoogleカレンダーに新しい予定を作成する。
func createEventHandler(googleSvc *auth.GoogleService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		client, ok := googleSvc.HTTPClient(r.Context())
		if !ok {
			http.Error(w, "Googleカレンダーが未連携です。会社PCなど信頼できる端末で /auth/google/login を開いて連携してください。", http.StatusPreconditionFailed)
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

		event, err := calendar.CreateEvent(r.Context(), client, req.Summary, req.Location, start, end)
		if err != nil {
			http.Error(w, "failed to create event", http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(event)
	}
}

// updateEventHandler はGoogleカレンダーの既存の予定を書き換える。
func updateEventHandler(googleSvc *auth.GoogleService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		client, ok := googleSvc.HTTPClient(r.Context())
		if !ok {
			http.Error(w, "Googleカレンダーが未連携です。会社PCなど信頼できる端末で /auth/google/login を開いて連携してください。", http.StatusPreconditionFailed)
			return
		}

		eventID := r.PathValue("id")

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

		event, err := calendar.UpdateEvent(r.Context(), client, eventID, req.Summary, req.Location, start, end)
		if err != nil {
			log.Printf("update event %q failed: %v", eventID, err)
			writeCalendarError(w, err, "failed to update event")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(event)
	}
}

// deleteEventHandler はGoogleカレンダーから予定を削除する。
func deleteEventHandler(googleSvc *auth.GoogleService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		client, ok := googleSvc.HTTPClient(r.Context())
		if !ok {
			http.Error(w, "Googleカレンダーが未連携です。会社PCなど信頼できる端末で /auth/google/login を開いて連携してください。", http.StatusPreconditionFailed)
			return
		}

		eventID := r.PathValue("id")

		if err := calendar.DeleteEvent(r.Context(), client, eventID); err != nil {
			log.Printf("delete event %q failed: %v", eventID, err)
			writeCalendarError(w, err, "failed to delete event")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// vapidPublicKeyHandler は、フロントエンドがプッシュ通知を購読する際に必要な
// VAPID公開鍵を返す。
func vapidPublicKeyHandler(pushSvc *push.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"publicKey": pushSvc.PublicKey()})
	}
}

type pushSubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// pushSubscribeHandler はブラウザからのプッシュ通知購読情報を保存する。
func pushSubscribeHandler(appStore *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req pushSubscribeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Endpoint == "" || req.Keys.P256dh == "" || req.Keys.Auth == "" {
			http.Error(w, "endpoint and keys are required", http.StatusBadRequest)
			return
		}

		if err := appStore.SavePushSubscription(req.Endpoint, req.Keys.P256dh, req.Keys.Auth); err != nil {
			http.Error(w, "failed to save subscription", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

type pushUnsubscribeRequest struct {
	Endpoint string `json:"endpoint"`
}

// pushUnsubscribeHandler はプッシュ通知の購読を解除する。
func pushUnsubscribeHandler(appStore *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req pushUnsubscribeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		if err := appStore.DeletePushSubscription(req.Endpoint); err != nil {
			http.Error(w, "failed to delete subscription", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

type setEventCategoryRequest struct {
	Category string `json:"category"`
}

// setEventCategoryHandler は予定の色分けカテゴリを保存する。このアプリ内だけの
// 表示に使うもので、実際のGoogleカレンダー本体には反映されない。
func setEventCategoryHandler(appStore *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		eventID := r.PathValue("id")

		var req setEventCategoryRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		if err := appStore.SetEventCategory(eventID, req.Category); err != nil {
			http.Error(w, "failed to save category", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// weatherTodayHandler は今日1日分の時間ごとの天気予報を返す。
func weatherTodayHandler(weatherSvc *weather.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		forecast, err := weatherSvc.FetchToday(r.Context())
		if err != nil {
			log.Printf("weather fetch failed: %v", err)
			http.Error(w, "failed to fetch weather", http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(forecast)
	}
}

// listTasksHandler はToDoの一覧を返す。
func listTasksHandler(appStore *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tasks, err := appStore.ListTasks()
		if err != nil {
			http.Error(w, "failed to list tasks", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(tasks)
	}
}

type createTaskRequest struct {
	Title   string `json:"title"`
	DueDate string `json:"dueDate"` // "YYYY-MM-DD"、任意
}

// createTaskHandler はToDoを新規作成する。
func createTaskHandler(appStore *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createTaskRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Title == "" {
			http.Error(w, "title is required", http.StatusBadRequest)
			return
		}

		task, err := appStore.CreateTask(req.Title, req.DueDate)
		if err != nil {
			http.Error(w, "failed to create task", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(task)
	}
}

type updateTaskRequest struct {
	Done bool `json:"done"`
}

// updateTaskHandler はToDoの完了状態を更新する。
func updateTaskHandler(appStore *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req updateTaskRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		if err := appStore.SetTaskDone(r.PathValue("id"), req.Done); err != nil {
			http.Error(w, "failed to update task", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// deleteTaskHandler はToDoを削除する。
func deleteTaskHandler(appStore *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := appStore.DeleteTask(r.PathValue("id")); err != nil {
			http.Error(w, "failed to delete task", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
