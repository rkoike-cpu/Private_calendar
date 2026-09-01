# アーキテクチャ図

個人用カレンダーアプリの全体構成。Go製のバックエンドが1つの常駐サーバーとしてRender上で動作し、Google Calendar・天気情報・データベース(Supabase)と連携する。

## システム構成図

```mermaid
flowchart TB
    subgraph devices["利用する端末"]
        Phone["📱 スマホ<br/>(PWA / 合言葉ログイン)"]
        CompanyPC["💻 会社PC<br/>(Google認証は<br/>ここで1回だけ行う)"]
    end

    subgraph render["Render(常駐サーバー)"]
        Server["Goアプリ<br/>(cmd/server)"]
    end

    subgraph external["外部サービス"]
        Google["Google Calendar API"]
        WeatherAPI["WeatherAPI.com"]
    end

    Supabase[("Supabase (Postgres)<br/>google_auth / viewer_sessions")]

    Phone -- "HTTPS(合言葉でログイン)" --> Server
    CompanyPC -- "HTTPS(初回のみGoogle同意)" --> Server

    Server -- "セッション/トークンの保存・参照" --> Supabase
    Server -- "共有トークンでAPI呼び出し" --> Google
    Server -- "天気取得" --> WeatherAPI
```

## ポイント

- **Google認証とアプリの利用を分離している**: 会社のセキュリティポリシー上、個人デバイスからのGoogleサインインが弾かれるため、Google認証は信頼できる会社PCで1回だけ行い、発行されたリフレッシュトークンをSupabaseに保存する。以降はどの端末からのリクエストでも、サーバーがこの共有トークンを使ってGoogle Calendar APIを呼び出す(詳細: [docs/google-auth-separation.md](docs/google-auth-separation.md))
- **ダッシュボードへのアクセスは合言葉方式**: スマホなどの個人デバイスは、Googleとは無関係な合言葉(`APP_PASSWORD`)でログインする
- **常駐サーバーとして動作**: サーバーレス(Vercel)ではなく、Renderで通常のGoプロセスとして動かしている(詳細: [docs/vercel-deployment-incident.md](docs/vercel-deployment-incident.md))

## アプリケーション内部構成(Goパッケージ構成)

```mermaid
flowchart LR
    main["cmd/server<br/>(エントリーポイント)"]
    bootstrap["internal/bootstrap<br/>(環境変数読み込み・組み立て)"]
    handler["internal/handler<br/>(HTTPルーティング)"]

    subgraph auth["internal/auth"]
        viewer["viewer.go<br/>(合言葉ログイン)"]
        googleauth["google.go<br/>(Google共有認証)"]
    end

    calendar["internal/calendar<br/>(Google Calendar API呼び出し)"]
    weather["internal/weather<br/>(WeatherAPI.com呼び出し)"]
    store["internal/store<br/>(Supabase/Postgresアクセス)"]
    webfs["web/<br/>(埋め込みHTML/CSS/JS, embed.FS)"]

    main --> bootstrap
    bootstrap --> handler
    bootstrap --> auth
    bootstrap --> store
    handler --> auth
    handler --> calendar
    handler --> weather
    handler --> webfs
    viewer --> store
    googleauth --> store
```

## 主なデータの流れ(予定を同期する場合)

1. スマホがダッシュボード(`/`)にアクセス。合言葉ログイン済みならそのまま表示
2. 「同期」ボタンを押すと `POST /api/sync/google` をサーバーへ送信
3. サーバーはSupabaseに保存されている共有のGoogle認証情報(リフレッシュトークン)を取得
4. そのトークンでGoogle Calendar APIに `GET .../events` をリクエストし、今月±1ヶ月分の予定を取得
5. 終日予定(有休・全休など)を除外し、JSON形式でスマホに返す
6. フロントエンド(`app.js`)がレスポンスを受け取り、日/週/月表示のグリッドに描画
