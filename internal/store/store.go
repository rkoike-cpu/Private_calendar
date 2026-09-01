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
CREATE TABLE IF NOT EXISTS sessions (
	id            TEXT PRIMARY KEY,
	email         TEXT NOT NULL,
	access_token  TEXT NOT NULL,
	token_type    TEXT,
	refresh_token TEXT,
	expiry        TIMESTAMPTZ
);
`

// Store はセッション(ログイン中のOAuthトークン)をSupabase(Postgres)に永続化する。
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

func (s *Store) SaveSession(id, email string, token *oauth2.Token) error {
	_, err := s.db.Exec(
		`INSERT INTO sessions (id, email, access_token, token_type, refresh_token, expiry)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (id) DO UPDATE SET
			email = excluded.email,
			access_token = excluded.access_token,
			token_type = excluded.token_type,
			refresh_token = excluded.refresh_token,
			expiry = excluded.expiry`,
		id, email, token.AccessToken, token.TokenType, token.RefreshToken, token.Expiry,
	)
	return err
}

// GetSession は保存済みのセッションを返す。見つからない場合は ErrNotFound。
func (s *Store) GetSession(id string) (email string, token *oauth2.Token, err error) {
	var expiry time.Time
	token = &oauth2.Token{}

	row := s.db.QueryRow(
		`SELECT email, access_token, token_type, refresh_token, expiry
		 FROM sessions WHERE id = $1`, id,
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
