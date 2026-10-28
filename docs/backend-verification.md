# バックエンド実装・動作確認レポート(Personal Calendar)

## 概要

### バックエンドの構成
- 言語: Go
- Webサーバー: 標準ライブラリの`net/http`のみ(Gin等のフレームワークは不使用)。Go 1.22以降で`net/http.ServeMux`自体がメソッド指定ルーティング(`GET /path`)やパスパラメータ(`{id}`)に対応しているため、ルーティングのために外部フレームワークを追加する必要が無いと判断した
- データベース: Supabase(PostgreSQL)。ORM(GORMなど)は使わず、`database/sql` + `pgx`ドライバで素のSQLを実行している
- ホスティング: Render(常駐サーバーとしてGoバイナリをそのまま実行)
- 外部連携: Google Calendar API(OAuth2)、WeatherAPI.com、Web Push API

### 工夫した点
1. **認証を2つに分離**: ダッシュボードへのアクセス(合言葉によるビューア認証)と、Googleカレンダーへのアクセス権(信頼できる端末で1回だけ行うGoogle認証・サーバー全体で共有)を独立させた。会社のセキュリティポリシー上、個人デバイスから直接Googleへサインインできないという制約に対応するための設計
2. **予定データを自前のDBにキャッシュしない**: 予定の実体は常にGoogle側に問い合わせて取得する「ステートレスな窓口」方式にし、DBには予定に付随する情報(色分け・通知送信済み記録)だけを外部IDをキーにして保持している
3. **書き込みの信頼性でエンドポイントを分離**: 予定本体の更新(Google側で失敗し得る)と、色分けカテゴリの更新(アプリ内のDBのみ、必ず成功する)をあえて別エンドポイントにし、片方が失敗してももう片方に影響しない設計にした

(詳細な設計判断は [`api-db-design.md`](./api-db-design.md) を参照)

## ソースコード

GitHubリポジトリ: https://github.com/rkoike-cpu/Private_calendar (Private)

主なディレクトリ構成:
```
personal-calendar/
  cmd/server/          エントリーポイント
  internal/
    auth/              ビューア認証・Google認証
    calendar/          Google Calendar API連携
    weather/           天気予報API連携
    push/              Web Push通知
    reminder/          バックグラウンドのリマインダー処理(goroutine)
    store/             Supabase(Postgres)へのデータアクセス
    handler/           HTTPルーティング
  web/                 埋め込みHTML/CSS/JS
```

## APIの動作確認

ToDo(`/api/tasks`)のCRUD一連の流れを、本番環境(Render)に対してcurlで実行して確認した。ToDoはGoogleカレンダー本体に影響しない、アプリ内で完結する機能のため、安全に動作確認できる。

### 1. ログイン(合言葉認証)
```
$ curl -s -c cookies.txt -X POST https://private-calendar-9ptj.onrender.com/login \
    --data-urlencode "password=********" -D - -o /dev/null

HTTP/2 302
location: /
set-cookie: viewer_session=3SrH9-AmutlEJGhFXCaMZatOjkKLfyMe-ZCqiC9gL18=; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax
```
合言葉が正しければ、`302`でダッシュボードへリダイレクトされ、長期間有効なセッションCookieが発行される。

### 2. ToDo一覧取得(作成前)
```
$ curl -s -b cookies.txt https://private-calendar-9ptj.onrender.com/api/tasks

null
```

### 3. ToDoを新規作成
```
$ curl -s -b cookies.txt -X POST https://private-calendar-9ptj.onrender.com/api/tasks \
    -H "Content-Type: application/json" \
    -d '{"title":"APIテスト用のタスク","dueDate":"2026-09-20"}'

{"ID":"b8b09ea7d9d28e081552db69cb31e0ef","Title":"APIテスト用のタスク","DueDate":"2026-09-20","Done":false}
```

### 4. ToDo一覧取得(作成後・永続化確認)
```
$ curl -s -b cookies.txt https://private-calendar-9ptj.onrender.com/api/tasks

[{"ID":"b8b09ea7d9d28e081552db69cb31e0ef","Title":"APIテスト用のタスク","DueDate":"2026-09-20","Done":false}]
```
→ 作成したタスクが一覧に反映されていることを確認。

### 5. ToDoを完了状態に更新
```
$ curl -s -b cookies.txt -X PATCH https://private-calendar-9ptj.onrender.com/api/tasks/b8b09ea7d9d28e081552db69cb31e0ef \
    -H "Content-Type: application/json" \
    -d '{"done":true}' -D - -o /dev/null

HTTP/2 204
```

### 6. ToDo一覧取得(更新後・永続化確認)
```
$ curl -s -b cookies.txt https://private-calendar-9ptj.onrender.com/api/tasks

[{"ID":"b8b09ea7d9d28e081552db69cb31e0ef","Title":"APIテスト用のタスク","DueDate":"2026-09-20","Done":true}]
```
→ `Done`が`true`に更新され、反映されていることを確認。

### 7. ToDoを削除
```
$ curl -s -b cookies.txt -X DELETE https://private-calendar-9ptj.onrender.com/api/tasks/b8b09ea7d9d28e081552db69cb31e0ef -D - -o /dev/null

HTTP/2 204
```

### 8. ToDo一覧取得(削除後・永続化確認)
```
$ curl -s -b cookies.txt https://private-calendar-9ptj.onrender.com/api/tasks

null
```
→ 削除され、一覧から消えていることを確認。

**結論**: 作成・更新・削除のいずれも、その後の取得系エンドポイントで結果が正しく反映されており、データが永続化されていることを確認できた。

## 静的解析・自動テスト

### 自動テスト(`go test`)
```
$ go test ./... -v

=== RUN   TestLoginHandler_CorrectPassword
--- PASS: TestLoginHandler_CorrectPassword (0.00s)
=== RUN   TestLoginHandler_WrongPassword
--- PASS: TestLoginHandler_WrongPassword (0.00s)
=== RUN   TestRequireAuth_NoCookieRedirectsToLogin
--- PASS: TestRequireAuth_NoCookieRedirectsToLogin (0.00s)
=== RUN   TestRequireAuth_ValidSessionPassesThrough
--- PASS: TestRequireAuth_ValidSessionPassesThrough (0.00s)
PASS
ok  	personal-calendar/internal/auth	0.347s

=== RUN   TestCategorize
    --- PASS: TestCategorize/晴れ (0.00s)
    --- PASS: TestCategorize/晴れ時々曇り (0.00s)
    --- PASS: TestCategorize/曇り (0.00s)
    --- PASS: TestCategorize/本曇り (0.00s)
    --- PASS: TestCategorize/霧 (0.00s)
    --- PASS: TestCategorize/着氷性の霧 (0.00s)
    --- PASS: TestCategorize/雨 (0.00s)
    --- PASS: TestCategorize/みぞれ(軽い) (0.00s)
    --- PASS: TestCategorize/みぞれ(にわか雨) (0.00s)
    --- PASS: TestCategorize/雪 (0.00s)
    --- PASS: TestCategorize/吹雪 (0.00s)
    --- PASS: TestCategorize/雷雨 (0.00s)
    --- PASS: TestCategorize/雷を伴う雪 (0.00s)
    --- PASS: TestCategorize/未知のコード (0.00s)
PASS
ok  	personal-calendar/internal/weather	0.641s
```
全テスト成功。`internal/auth`(ビューア認証のログイン成功・失敗、認証ミドルウェアの挙動)と`internal/weather`(天気コードの分類ロジック)を対象に、テーブル駆動テスト・`httptest`を用いたHTTPハンドラのテストを実装した。

### 静的解析(`golangci-lint`)
```
$ golangci-lint run ./...

0 issues.
```
導入直後は`errcheck`(エラーの戻り値を確認していない)の指摘が18件出たため、全て修正した上での結果。

## まとめ

### 実装中に苦労したこと
- 静的解析ツールを導入して初めて、`resp.Body.Close()`や`w.Write(...)`など、**「失敗する可能性はほぼ無いから」と戻り値を確認せずに書いていた箇所**が18箇所も見つかった。動作は問題なくしていたが、ツールを通すことで初めて可視化される問題だと実感した
- テストを書く対象を選ぶ際、Google Calendar APIやDBに直接依存する処理は簡単にはテストできず、**純粋なロジック(天気コードの分類など)や、インターフェース越しに差し替えられる部分(認証のストア)**から着手する必要があった

### 工夫したこと
- エラーの戻り値を無視していた箇所は、直接処理を変えるのではなく、**まず全てログに残すようにした**。多くは「この時点でもう対処のしようがない」処理(レスポンス書き込み中の失敗など)だったため、可観測性を上げることを優先した
- `json.NewEncoder(w).Encode(...)`が7箇所で同じパターンだったため、`writeJSON`という共通関数に集約し、修正箇所を減らした

### 学んだこと
- 自動テストが無い状態から始めると、「何をテストすべきか」の判断自体が難しい。まずは外部依存の無い純粋関数と、インターフェースで抽象化されている境界(ストアなど)を見つけることが、テストを書き始める際の取っ掛かりになる
- 静的解析は、動いているコードの「隠れた前提」を洗い出すのに有効。今回のケースでは、実害が出る前に潜在的なバグ(エラーが起きても気づけない箇所)を可視化できた
