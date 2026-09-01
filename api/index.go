// Package handler はVercelのGoサーバーレスFunctionのエントリーポイント。
// 初回リクエスト時にルーターを1度だけ構築し、以降のリクエスト(同じ実行環境が
// 再利用される限り)はそれを使い回す。
package handler

import (
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
func Handler(w http.ResponseWriter, r *http.Request) {
	router.ServeHTTP(w, r)
}
