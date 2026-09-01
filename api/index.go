// Package handler はVercelのGoサーバーレスFunctionのエントリーポイント。
// 初回リクエスト時にルーターを1度だけ構築し、以降のリクエスト(同じ実行環境が
// 再利用される限り)はそれを使い回す。
package handler

import (
	"log"
	"net/http"

	"personal-calendar/internal/bootstrap"
)

var router http.Handler

func init() {
	r, _, err := bootstrap.NewRouter()
	if err != nil {
		panic(err)
	}
	router = r
}

// Handler はVercelが呼び出すエントリーポイント関数。
//
// vercel.json のrewriteは全リクエストをこの関数(/api/index)へ転送するため、
// r.URL.Path は常に "/api/index" になってしまう。本来のパスは
// destinationに付けたクエリパラメータ "path" 経由で受け取り、ここで復元する。
func Handler(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Path
	rawQuery := r.URL.RawQuery
	log.Printf("[vercel debug] raw incoming path=%q rawQuery=%q", rawPath, rawQuery)

	if p := r.URL.Query().Get("path"); p != "" {
		r.URL.Path = "/" + p
		q := r.URL.Query()
		q.Del("path")
		r.URL.RawQuery = q.Encode()
	}

	// ログ検索に頼らず curl -v で直接確認できるよう、デバッグ情報をヘッダーにも出す。
	w.Header().Set("X-Debug-Raw-Path", rawPath)
	w.Header().Set("X-Debug-Raw-Query", rawQuery)
	w.Header().Set("X-Debug-Resolved-Path", r.URL.Path)

	router.ServeHTTP(w, r)
}
