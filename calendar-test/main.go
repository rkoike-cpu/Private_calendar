package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/calendar/v3"
	"google.golang.org/api/option"
)

const credentialsFile = "client_secret_15308071129-cghhf0hefvk9mugf5ov4rdrac669btn8.apps.googleusercontent.com.json"
const tokenFile = "token.json"

func main() {
	ctx := context.Background()

	b, err := os.ReadFile(credentialsFile)
	if err != nil {
		log.Fatalf("credentials file を読み込めませんでした: %v", err)
	}

	config, err := google.ConfigFromJSON(b, calendar.CalendarReadonlyScope)
	if err != nil {
		log.Fatalf("OAuth設定の読み込みに失敗しました: %v", err)
	}

	client := getClient(config)

	srv, err := calendar.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		log.Fatalf("Calendar サービスの作成に失敗しました: %v", err)
	}

	events, err := srv.Events.List("primary").
		MaxResults(10).
		SingleEvents(true).
		OrderBy("startTime").
		TimeMin(time.Now().Format(time.RFC3339)).
		Do()
	if err != nil {
		log.Fatalf("予定の取得に失敗しました: %v", err)
	}

	fmt.Println("=== 直近の予定 ===")
	if len(events.Items) == 0 {
		fmt.Println("予定が見つかりませんでした。")
		return
	}
	for _, item := range events.Items {
		when := item.Start.DateTime
		if when == "" {
			when = item.Start.Date
		}
		fmt.Printf("- %s: %s\n", when, item.Summary)
	}
}

func getClient(config *oauth2.Config) *http.Client {
	tok, err := tokenFromFile(tokenFile)
	if err != nil {
		tok = getTokenFromWeb(config)
		saveToken(tokenFile, tok)
	}
	return config.Client(context.Background(), tok)
}

func getTokenFromWeb(config *oauth2.Config) *oauth2.Token {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("ローカルサーバーの起動に失敗しました: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	config.RedirectURL = fmt.Sprintf("http://127.0.0.1:%d", port)

	codeCh := make(chan string)
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("code")
		fmt.Fprintln(w, "認証が完了しました。このタブは閉じて構いません。")
		codeCh <- code
	})
	server := &http.Server{Handler: mux}
	go server.Serve(listener)
	defer server.Close()

	authURL := config.AuthCodeURL("state-token", oauth2.AccessTypeOffline)
	fmt.Printf("以下のURLをブラウザで開いて認証してください:\n%v\n\n", authURL)
	fmt.Println("ブラウザでの認証完了を待っています...")

	authCode := <-codeCh

	tok, err := config.Exchange(context.TODO(), authCode)
	if err != nil {
		log.Fatalf("トークンの取得に失敗しました: %v", err)
	}
	return tok
}

func tokenFromFile(file string) (*oauth2.Token, error) {
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	tok := &oauth2.Token{}
	err = json.NewDecoder(f).Decode(tok)
	return tok, err
}

func saveToken(path string, token *oauth2.Token) {
	fmt.Printf("トークンを保存します: %s\n", path)
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		log.Fatalf("トークンファイルの保存に失敗しました: %v", err)
	}
	defer f.Close()
	json.NewEncoder(f).Encode(token)
}

func nowRFC3339() string {
	return "2026-09-01T00:00:00+09:00"
}
