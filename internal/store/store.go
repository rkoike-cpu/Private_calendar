package store

import (
	"database/sql"
	"errors"
	"time"

	"golang.org/x/oauth2"

	_ "github.com/jackc/pgx/v5/stdlib"
)

var ErrNotFound = errors.New("not found")

const schema = `
CREATE TABLE IF NOT EXISTS google_auth (
	id            INTEGER PRIMARY KEY,
	email         TEXT NOT NULL,
	access_token  TEXT NOT NULL,
	token_type    TEXT,
	refresh_token TEXT,
	expiry        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS viewer_sessions (
	id         TEXT PRIMARY KEY,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

// Store はSupabase(Postgres)への永続化を担う。
//
// google_auth: Googleカレンダーへのアクセス権(リフレッシュトークン)を1件だけ保存する。
// 会社のセキュリティポリシー上、個人デバイスからのGoogleサインインが弾かれるため、
// 信頼できる端末で1回だけ認証し、以降はサーバーがこの1件を使い回す。
//
// viewer_sessions: ダッシュボードを閲覧してよい端末のセッション。Google認証とは無関係に、
// 合言葉(アプリ独自のパスワード)でログインした際に発行する。
type Store struct {
	db *sql.DB
}

// Open は connString (Supabaseの接続文字列 "postgresql://...") を使ってDBに接続する。
func Open(connString string) (*Store, error) {
	db, err := sql.Open("pgx", connString)
	if err != nil {
		return nil, err
	}

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}

	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

// SaveGoogleAuth はGoogleカレンダーへのアクセス権を保存する(常に1件のみ)。
func (s *Store) SaveGoogleAuth(email string, token *oauth2.Token) error {
	_, err := s.db.Exec(
		`INSERT INTO google_auth (id, email, access_token, token_type, refresh_token, expiry)
		 VALUES (1, $1, $2, $3, $4, $5)
		 ON CONFLICT (id) DO UPDATE SET
			email = excluded.email,
			access_token = excluded.access_token,
			token_type = excluded.token_type,
			refresh_token = excluded.refresh_token,
			expiry = excluded.expiry`,
		email, token.AccessToken, token.TokenType, token.RefreshToken, token.Expiry,
	)
	return err
}

// GetGoogleAuth は保存済みのGoogleアクセス権を返す。見つからない場合は ErrNotFound。
func (s *Store) GetGoogleAuth() (email string, token *oauth2.Token, err error) {
	var expiry time.Time
	token = &oauth2.Token{}

	row := s.db.QueryRow(
		`SELECT email, access_token, token_type, refresh_token, expiry FROM google_auth WHERE id = 1`,
	)
	err = row.Scan(&email, &token.AccessToken, &token.TokenType, &token.RefreshToken, &expiry)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil, ErrNotFound
	}
	if err != nil {
		return "", nil, err
	}
	token.Expiry = expiry

	return email, token, nil
}

// SaveViewerSession は合言葉ログインに成功した端末のセッションを記録する。
func (s *Store) SaveViewerSession(id string) error {
	_, err := s.db.Exec(
		`INSERT INTO viewer_sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, id,
	)
	return err
}

// ViewerSessionExists は指定されたセッションIDが有効か確認する。
func (s *Store) ViewerSessionExists(id string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM viewer_sessions WHERE id = $1)`, id,
	).Scan(&exists)
	return exists, err
}
