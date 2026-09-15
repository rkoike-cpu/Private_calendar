package auth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// fakeViewerStore はDBを使わずに ViewerStore を模倣するテスト用の実装。
type fakeViewerStore struct {
	sessions map[string]bool
}

func newFakeViewerStore() *fakeViewerStore {
	return &fakeViewerStore{sessions: make(map[string]bool)}
}

func (f *fakeViewerStore) SaveViewerSession(id string) error {
	f.sessions[id] = true
	return nil
}

func (f *fakeViewerStore) ViewerSessionExists(id string) (bool, error) {
	return f.sessions[id], nil
}

func TestLoginHandler_CorrectPassword(t *testing.T) {
	store := newFakeViewerStore()
	svc := NewViewerService("correct-horse", store)

	form := url.Values{"password": {"correct-horse"}}
	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()

	svc.LoginHandler(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("expected redirect (302), got %d", rec.Code)
	}

	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != viewerCookieName {
		t.Fatalf("expected a %s cookie to be set, got %v", viewerCookieName, cookies)
	}
	if len(store.sessions) != 1 {
		t.Fatalf("expected 1 session saved, got %d", len(store.sessions))
	}
}

func TestLoginHandler_WrongPassword(t *testing.T) {
	store := newFakeViewerStore()
	svc := NewViewerService("correct-horse", store)

	form := url.Values{"password": {"wrong-guess"}}
	req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()

	svc.LoginHandler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if len(store.sessions) != 0 {
		t.Fatalf("expected no session to be saved on failed login, got %d", len(store.sessions))
	}
}

func TestRequireAuth_NoCookieRedirectsToLogin(t *testing.T) {
	store := newFakeViewerStore()
	svc := NewViewerService("correct-horse", store)

	called := false
	protected := svc.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	protected.ServeHTTP(rec, req)

	if called {
		t.Fatal("expected the protected handler NOT to be called without a session cookie")
	}
	if rec.Code != http.StatusFound {
		t.Fatalf("expected redirect (302) to /login, got %d", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "/login" {
		t.Fatalf("expected redirect to /login, got %q", loc)
	}
}

func TestRequireAuth_ValidSessionPassesThrough(t *testing.T) {
	store := newFakeViewerStore()
	store.sessions["valid-session-id"] = true
	svc := NewViewerService("correct-horse", store)

	called := false
	protected := svc.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: viewerCookieName, Value: "valid-session-id"})
	rec := httptest.NewRecorder()
	protected.ServeHTTP(rec, req)

	if !called {
		t.Fatal("expected the protected handler to be called with a valid session cookie")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}
