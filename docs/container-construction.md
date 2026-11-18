# コンテナ化レポート(Personal Calendar)

## 概要

### 構成の特徴

Step 8でAWSに構築したアプリ(Next.jsのフロントエンド、GoのAPI、PostgreSQL)を3つのコンテナに分け、Docker Composeでローカルに起動できるようにした。`docker compose up -d`の1コマンドで、Web層・アプリ層・DB層の3層がそろって起動する。

```
Mac(ブラウザ / curl)
  │ http://localhost:3000   ※Macに開けるのは、この3000番だけ
  ▼
frontend (Next.js :3000)
  │ http://backend:8080     ※front-tier
  ▼
backend (Go :8080)
  │ db:5432                 ※back-tier(internal)
  ▼
db (PostgreSQL :5432) ─ db-data(名前付きボリューム)
```

| サービス | 層 | 役割 | イメージ | Macからの接続 |
|---|---|---|---|---|
| frontend | Web層 | 画面を返し、`/api/*`をbackendへ転送する | 自作([`frontend/Dockerfile`](../frontend/Dockerfile)) | `127.0.0.1:3000`だけ公開する |
| backend | アプリ層 | APIと認証 | 自作([`Dockerfile`](../Dockerfile)) | 公開しない |
| db | DB層 | データを保存する | 公式の`postgres:17-alpine` | 公開しない |

- **Macに開けるのは、frontendの3000番だけにした**。`127.0.0.1:3000:3000`と書き、Mac自身からの接続に限った。`127.0.0.1`を付けないと、同じWi-Fiにいるほかの端末からも接続できてしまう。backendの8080番とdbの5432番は公開せず、コンテナ同士の通信だけに使う
- **ネットワークを2つに分け、frontendからdbへの経路をなくした**。front-tierにfrontendとbackend、back-tierにbackendとdbを入れた。frontendはback-tierに入っていないため、dbには接続できない。back-tierは`internal: true`にして、外(インターネット)への経路も持たせていない
- **コンテナ同士は、Composeのサービス名で接続する**。コンテナの中の`localhost`はそのコンテナ自身を指すため、frontendからは`http://backend:8080`、backendからは`db:5432`を宛先にした。サービス名は、同じネットワークに入っているコンテナの間でDockerが解決する
- **DBのデータは、名前付きボリューム(`db-data`)に保存する**。コンテナを削除して作り直しても、ToDoやログインのセッションが残る
- **起動の順番を、ヘルスチェックで制御した**。db → backend → frontendの順に、前のコンテナが正常に応答するようになってから次を起動する(`depends_on`の`condition: service_healthy`)
- **パスワードや鍵は`.env`から渡し、イメージにもGitにも入れない**。`docker-compose.yml`には変数の名前だけを書き、値は起動時に`.env`から入る。`.env`は`.gitignore`に入っており、`.dockerignore`でビルドにも渡さない

### Step 8との対応

Step 8で設計した「各層は直前の層からだけ受け付ける」構成を、コンテナでも同じ形で再現した。

| Step 8(AWS) | Step 9(Docker Compose) |
|---|---|
| 1台のEC2の中で、Next.jsとGoを並べて動かす | frontendとbackendを別のコンテナに分ける |
| RDS for PostgreSQL | dbコンテナ(`postgres:17-alpine`)と名前付きボリューム |
| セキュリティグループで、各層が直前の層からだけ受け付ける | ネットワークをfront-tierとback-tierに分ける |
| RDSを、インターネットへの経路がないサブネットに置く | back-tierを`internal: true`にする |
| ALBのヘルスチェック(`/api/health`) | frontendとbackendのヘルスチェック(同じ`/api/health`) |
| Parameter Store | `.env` |
| CloudFormationのテンプレート | `docker-compose.yml` |

### 今回の範囲から外したもの

Step 8と同じく、会社のGoogleカレンダーと連携する機能は、社内のセキュリティ上の判断により使わない。Goは起動時にGoogleの認証情報を必ず読み込むため、形だけ整えたダミーの値を渡した。接続先には存在しないドメイン(`.invalid`)を入れており、誤って連携の操作をしてもGoogleには接続しない。

## 実装コード

GitHub: https://github.com/rkoike-cpu/Private_calendar

| ファイル | 内容 |
|---|---|
| [`Dockerfile`](https://github.com/rkoike-cpu/Private_calendar/blob/main/Dockerfile) | backend(Go)のイメージ |
| [`.dockerignore`](https://github.com/rkoike-cpu/Private_calendar/blob/main/.dockerignore) | backendのビルドに渡すファイルを、Goのコードだけに絞る |
| [`frontend/Dockerfile`](https://github.com/rkoike-cpu/Private_calendar/blob/main/frontend/Dockerfile) | frontend(Next.js)のイメージ |
| [`frontend/.dockerignore`](https://github.com/rkoike-cpu/Private_calendar/blob/main/frontend/.dockerignore) | 手元の`node_modules`や`.env`をビルドに持ち込まない |
| [`docker-compose.yml`](https://github.com/rkoike-cpu/Private_calendar/blob/main/docker-compose.yml) | 3つのコンテナ、2つのネットワーク、ボリュームの定義 |
| [`frontend/next.config.ts`](https://github.com/rkoike-cpu/Private_calendar/blob/main/frontend/next.config.ts) | Dockerでビルドするときだけ、実行に必要なファイルをまとめて出力する設定を追加した |

Goのコードは変更していない(`/api/health`はStep 8で追加済み)。

### backendのDockerfile

```dockerfile
# backend(Go API)のイメージ。
#
# マルチステージビルドで、ビルドに使う環境(Goのコンパイラなど)と、実行する環境を分ける。
# 最終的なイメージには、ビルドした実行ファイル1つと、最小限のOSだけが残る。

# ---- 1. ビルド用のステージ ----
# go.mod の go 1.26.5 に合わせる
FROM golang:1.26-alpine AS build
WORKDIR /src

# 依存モジュールを先に取得する。go.mod と go.sum が変わらない限り、
# 次回以降のビルドではこの層のキャッシュが使われ、ダウンロードを省ける
COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

# CGOを無効にして、Cのライブラリに依存しない1つの実行ファイルにする。
# -trimpath と -ldflags="-s -w" で、ビルド環境のパスとデバッグ情報を取り除き、サイズを小さくする
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ---- 2. 実行用のステージ ----
# 小さなOS(Alpine)を使う。空のイメージ(scratch)より少し大きくなるが、
# ヘルスチェックに使う wget と、調査のときに入れるシェルが入っている
FROM alpine:3.22

# rootではなく、専用のユーザーで動かす
RUN adduser -D -H app
USER app

COPY --from=build /out/server /app/server

EXPOSE 8080
ENTRYPOINT ["/app/server"]
```

- **ビルド用と実行用で、ステージを分けた**。ビルド用のステージ(`golang:1.26-alpine`)でコンパイルし、実行用のステージ(`alpine:3.22`)には、できあがった実行ファイル1つだけをコピーする。Goのコンパイラ、ソースコード、依存モジュールは、最終的なイメージに残らない
- **Cのライブラリに依存しない実行ファイルにした**。`CGO_ENABLED=0`でビルドすると実行ファイル1つで動くため、実行用のイメージに追加のライブラリを入れなくてよい
- **依存モジュールの取得を、ソースコードのコピーより先に行う**。`go.mod`と`go.sum`が変わらない限り`go mod download`の層のキャッシュが使われ、コードだけを直したときのビルドが速くなる
- **rootではなく、専用のユーザー(`app`)で動かす**

### frontendのDockerfile

```dockerfile
# frontend(Next.js)のイメージ。
#
# マルチステージビルドで、ビルドに使う環境(開発用のパッケージを含む node_modules)と、
# 実行する環境を分ける。最終的なイメージには、Next.jsが実行に必要なファイルだけを
# まとめた standalone 出力を入れる。

# ---- 1. ビルド用のステージ ----
# Step 8のEC2と同じ Node.js 22 を使う
FROM node:22-alpine AS build
WORKDIR /app

# 依存パッケージを先にインストールする。package.json と package-lock.json が
# 変わらない限り、次回以降のビルドではこの層のキャッシュが使われる
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# /api/* の転送先。Next.jsの転送の設定はビルドの時点で固定されるため、
# 起動時の環境変数ではなく、ビルドの引数で渡す。
# コンテナの中の localhost はそのコンテナ自身を指すので、Composeのサービス名(backend)で指定する
ARG BACKEND_ORIGIN=http://backend:8080
ENV BACKEND_ORIGIN=${BACKEND_ORIGIN} \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 2. 実行用のステージ ----
FROM node:22-alpine
WORKDIR /app

# DockerはHOSTNAMEにコンテナのホスト名を自動で入れ、Next.jsはその値のアドレスでだけ待ち受ける。
# コンテナ自身の 127.0.0.1(ヘルスチェック)からも接続できるよう、すべてのアドレス(0.0.0.0)を指定する
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# rootではなく、Node.jsの公式イメージに用意されている node ユーザーで動かす
USER node

EXPOSE 3000
CMD ["node", "server.js"]
```

- **実行用のステージには、Next.jsのstandalone出力と静的ファイルだけを入れる**。standalone出力は実行に必要なファイルだけをまとめたもので、これに画面で使う静的ファイル(`.next/static`と`public`)を加える。開発用のパッケージを含む`node_modules`全体はコピーしない
- **`/api/*`の転送先は、ビルド引数で渡す**。Next.jsの転送の設定はビルドの時点で固定されるため、起動時の環境変数では変えられない。ビルド引数`BACKEND_ORIGIN`で`http://backend:8080`を指定した
- **`HOSTNAME=0.0.0.0`を指定した**。Dockerは環境変数`HOSTNAME`にコンテナのホスト名を自動で入れ、Next.jsはその値のアドレスでだけ待ち受ける。そのままでは、コンテナの中から`127.0.0.1`に送るヘルスチェックが届かない
- **Step 8の起動方法は変えていない**。standalone出力は、Dockerfileが`NEXT_OUTPUT=standalone`を渡したときだけ有効になるよう、`next.config.ts`に1行追加した。EC2のように`next start`で起動する場合は、これまでどおりの出力になる
- **Node.jsの公式イメージにある`node`ユーザーで動かす**

### docker-compose.yml

```yaml
# Personal Calendar を、3層(Web / アプリ / DB)のコンテナとしてローカルで起動する。
#
#   docker compose up -d
#
#   ブラウザ → frontend (:3000) → backend (:8080) → db (:5432)
#               └── front-tier ──────┘└── back-tier ─────┘
#
# 起動する前に、このファイルと同じフォルダに .env を作り、次の値を書いておく。
# .env はGitに含めない(.gitignore 済み)。
#
#   POSTGRES_PASSWORD=   DBのパスワード。英数字のみ(記号を入れると接続URLが壊れる)
#   APP_PASSWORD=        ダッシュボードの合言葉
#   WEATHER_API_KEY=     WeatherAPI.com のキー
#   VAPID_PUBLIC_KEY=    プッシュ通知の鍵(go run ./cmd/genvapidkeys で作れる)
#   VAPID_PRIVATE_KEY=

name: personal-calendar

services:
  # Web層: 画面を返し、/api/* を backend へ転送する
  frontend:
    build:
      context: ./frontend
      args:
        BACKEND_ORIGIN: http://backend:8080
    ports:
      # Macに開けるのはこの3000番だけ。127.0.0.1 を付けて、Mac自身からの接続に限る
      # (付けないと、同じWi-Fiにいる他の端末からも接続できてしまう)
      - "127.0.0.1:3000:3000"
    networks:
      - front-tier
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      # Step 8のALBと同じく、Next.jsを経由してGoまで届くかを確認する
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 3

  # アプリ層: APIと認証
  backend:
    build: .
    environment:
      DATABASE_URL: postgres://calendar:${POSTGRES_PASSWORD:?.envに設定してください}@db:5432/personal_calendar?sslmode=disable
      APP_PASSWORD: ${APP_PASSWORD:?.envに設定してください}
      WEATHER_API_KEY: ${WEATHER_API_KEY:?.envに設定してください}
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:?.envに設定してください}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:?.envに設定してください}
      # Google連携は使わない。Goは起動時にこの値を必ず読み込むため、形だけ整えたダミーを渡す。
      # 接続先には存在しないドメイン(.invalid)を入れ、誤って「Google連携」を押してもGoogleには繋がらない
      GOOGLE_OAUTH_CREDENTIALS_JSON: >-
        {"web":{"client_id":"dummy","client_secret":"dummy",
        "redirect_uris":["http://localhost:3000/auth/google/callback"],
        "auth_uri":"https://google-disabled.invalid/auth",
        "token_uri":"https://google-disabled.invalid/token"}}
    networks:
      - front-tier
      - back-tier
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/api/health"]
      interval: 10s
      timeout: 3s
      retries: 3

  # DB層: データを保存する
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: calendar
      POSTGRES_DB: personal_calendar
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?.envに設定してください}
    volumes:
      # DBのデータを名前付きボリュームに置き、コンテナを作り直しても残るようにする
      - db-data:/var/lib/postgresql/data
    networks:
      - back-tier
    healthcheck:
      # 127.0.0.1 を指定してTCPで確認する。初回の初期化中に動く一時的なサーバーは
      # TCPで待ち受けないため、本来のサーバーが起動するまでhealthyにならない
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U calendar -d personal_calendar"]
      interval: 5s
      timeout: 3s
      retries: 10

networks:
  # frontendとbackendをつなぐ
  front-tier: {}
  # backendとdbをつなぐ。internal にして、外(インターネット)への経路を持たせない。
  # frontendはこのネットワークに入っていないため、dbへは直接つながらない
  back-tier:
    internal: true

volumes:
  db-data: {}
```

- **値が欠けていたら、起動する前に止める**。`${APP_PASSWORD:?.envに設定してください}`のように書くと、`.env`に値がないときはComposeがエラーを出し、どのコンテナも起動しない
- **dbのヘルスチェックは、TCPで接続を確かめる**。Postgresの公式イメージは、初回の起動時に、初期設定のための一時的なサーバーを動かす。このサーバーはTCPで待ち受けないため、`pg_isready -h 127.0.0.1`とTCPを指定すると、本来のサーバーが起動するまでhealthyにならない。初期設定の途中でbackendが接続しにいくことを防げる

### .dockerignore(backend)

```
# backendのイメージのビルドに渡すファイルを、必要なものだけに絞る(許可リスト方式)。
# まずすべてを除外し、Goのビルドに使うものだけを戻す。
# .env やGoogleの認証情報など、ここに書かれていないファイルはビルドに一切渡らない。
*
!go.mod
!go.sum
!cmd
!internal

# テストのコードはイメージに不要
**/*_test.go
```

- **許可リスト方式にした**。まずすべてを除外し、Goのビルドに使う4つ(`go.mod`、`go.sum`、`cmd`、`internal`)だけを戻す。`.env`やGoogleの認証情報のように、あとからフォルダに置いたファイルも、ビルドに渡ることはない

## 動作確認

MacのDocker Desktopで、`docker compose up -d`で起動したうえで、curlで疎通・書き込み・読み取りの3つを確認した。curlの宛先はすべて`http://localhost:3000`で、Next.js(frontend)を経由してGo(backend)に届く。

### 起動

```
$ docker compose up -d
[+] up 21/21
 ✔ Image postgres:17-alpine               Pulled   26.8s
 ✔ Image personal-calendar-frontend       Built    69.6s
 ✔ Image personal-calendar-backend        Built    69.6s
 ✔ Volume personal-calendar_db-data       Created   0.0s
 ✔ Network personal-calendar_front-tier   Created   0.0s
 ✔ Network personal-calendar_back-tier    Created   0.0s
 ✔ Container personal-calendar-db-1       Healthy   5.8s
 ✔ Container personal-calendar-backend-1  Healthy  16.2s
 ✔ Container personal-calendar-frontend-1 Started  16.3s
```

dbがHealthyになってからbackend、backendがHealthyになってからfrontendが起動している。

```
$ docker compose ps
NAME                           IMAGE                        COMMAND                   SERVICE    CREATED          STATUS                    PORTS
personal-calendar-backend-1    personal-calendar-backend    "/app/server"             backend    33 minutes ago   Up 33 minutes (healthy)   8080/tcp
personal-calendar-db-1         postgres:17-alpine           "docker-entrypoint.s…"   db         33 minutes ago   Up 33 minutes (healthy)   5432/tcp
personal-calendar-frontend-1   personal-calendar-frontend   "docker-entrypoint.s…"   frontend   33 minutes ago   Up 33 minutes (healthy)   127.0.0.1:3000->3000/tcp
```

3つともhealthyである。PORTSを見ると、Macとつながっているのはfrontendの`127.0.0.1:3000->3000/tcp`だけで、backendとdbはポートを公開していない。

### 1. 疎通(ヘルスチェック)

```
$ curl -i http://localhost:3000/api/health
HTTP/1.1 200 OK
content-type: application/json
date: Wed, 18 Nov 2026 07:15:42 GMT
content-length: 16
connection: keep-alive
Vary: Accept-Encoding

{"status":"ok"}
```

`200 OK`と`{"status":"ok"}`が返った。Macからfrontendに送ったリクエストが、Next.jsの転送を通ってbackendまで届いている。

### 準備: ログイン

ToDoのAPIは合言葉でのログインが必要なため、先にログインしてCookieを保存した。合言葉は`.env`から読み込み、コマンドにも出力にも出さない。

```
$ APP_PASSWORD=$(grep '^APP_PASSWORD=' .env | cut -d= -f2- | tr -d '[:space:]')
$ curl -i -c /tmp/cookie.txt -X POST http://localhost:3000/api/login --data-urlencode "password=$APP_PASSWORD"
HTTP/1.1 302 Found
location: /
set-cookie: viewer_session=(伏せ字); Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax
date: Wed, 18 Nov 2026 06:57:08 GMT
content-length: 0
connection: keep-alive
```

`302 Found`は、ログインに成功してトップページへ移動するよう指示する応答である。セッションのCookie(`viewer_session`)が発行された(値は伏せた)。

### 2. 書き込み(POST)

```
$ curl -i -b /tmp/cookie.txt -X POST http://localhost:3000/api/tasks -H "Content-Type: application/json" -d '{"title":"Step 9 の動作確認","dueDate":"2026-11-20"}'
HTTP/1.1 200 OK
content-type: application/json
date: Wed, 18 Nov 2026 07:08:14 GMT
content-length: 111
connection: keep-alive
Vary: Accept-Encoding

{"ID":"2aa77fd228cbf6a1055370531a13449f","Title":"Step 9 の動作確認","DueDate":"2026-11-20","Done":false}
```

backendがdbにToDoを保存し、IDを付けて返した。

### 3. 読み取り(GET)

```
$ curl -i -b /tmp/cookie.txt http://localhost:3000/api/tasks
HTTP/1.1 200 OK
content-type: application/json
date: Wed, 18 Nov 2026 07:08:36 GMT
content-length: 113
connection: keep-alive
Vary: Accept-Encoding

[{"ID":"2aa77fd228cbf6a1055370531a13449f","Title":"Step 9 の動作確認","DueDate":"2026-11-20","Done":false}]
```

書き込んだToDo(同じID)を取得できた。frontend → backend → dbの経路で、書き込みと読み取りができている。

### 追加の確認1: コンテナを作り直しても、データが残る

```
$ docker compose down
[+] down 5/5
 ✔ Container personal-calendar-frontend-1 Removed  0.2s
 ✔ Container personal-calendar-backend-1  Removed  0.1s
 ✔ Container personal-calendar-db-1       Removed  0.1s
 ✔ Network personal-calendar_back-tier    Removed  0.1s
 ✔ Network personal-calendar_front-tier   Removed  0.1s
$ docker compose up -d --wait
[+] up 5/5
 ✔ Network personal-calendar_back-tier    Created   0.0s
 ✔ Network personal-calendar_front-tier   Created   0.0s
 ✔ Container personal-calendar-db-1       Healthy  16.9s
 ✔ Container personal-calendar-backend-1  Healthy  16.8s
 ✔ Container personal-calendar-frontend-1 Healthy  26.8s
$ curl -i -b /tmp/cookie.txt http://localhost:3000/api/tasks
HTTP/1.1 200 OK
content-type: application/json
date: Wed, 18 Nov 2026 07:26:05 GMT
content-length: 113
connection: keep-alive
Vary: Accept-Encoding

[{"ID":"2aa77fd228cbf6a1055370531a13449f","Title":"Step 9 の動作確認","DueDate":"2026-11-20","Done":false}]
```

- `down`でコンテナとネットワークは削除されたが、ボリューム(`db-data`)は削除の一覧にない
- 作り直したあとも、同じIDのToDoが返った。データはコンテナではなくボリュームに保存されている。ログインのセッションもDBに保存しているため、同じCookieのまま読み取れた

### 追加の確認2: frontendからdbへは接続できない

```
$ docker compose exec frontend wget -qO- -T 3 http://backend:8080/api/health
{"status":"ok"}
$ docker compose exec frontend wget -qO- -T 3 http://db:5432
wget: bad address 'db:5432'
```

- frontendとbackendは同じfront-tierにいるため、サービス名(`backend`)で接続できる
- frontendはback-tierに入っていないため、`db`という名前を解決できない。設計どおり、frontendからdbへの経路はない

### 追加の確認3: マルチステージビルドで、イメージが小さくなる

比較のため、ビルド用のステージ(`AS build`)までで止めたイメージも作った。このイメージは、ステージを分けずに1つのイメージでビルドと実行をした場合の大きさに近い。

```
$ docker build --target build -t personal-calendar-backend:build-stage .
$ docker build --target build -t personal-calendar-frontend:build-stage ./frontend
$ docker images --filter "reference=personal-calendar-*"
IMAGE                                    ID             DISK USAGE   CONTENT SIZE   EXTRA
personal-calendar-backend:build-stage    d89e6bbc2cc9       1.45GB          272MB
personal-calendar-backend:latest         c3e400887212       38.9MB         10.8MB    U
personal-calendar-frontend:build-stage   963738411062       1.33GB          356MB
personal-calendar-frontend:latest        dac3d2a8da42        303MB         77.4MB    U
```

`build-stage`が比較用に作ったイメージ、`latest`が`docker compose up`でビルドし、コンテナが使っているイメージである(`EXTRA`の`U`は使用中を表す)。

| イメージ | ビルド用のステージ | 最終的なイメージ |
|---|---|---|
| backend | 1.45GB | 38.9MB(約37分の1) |
| frontend | 1.33GB | 303MB(約4分の1) |

- 表の数字は`DISK USAGE`(手元のディスクで使っている容量)である。`CONTENT SIZE`(圧縮した状態の大きさ)で比べても、backendは272MBから10.8MB、frontendは356MBから77.4MBに小さくなった
- backendのビルド用のステージには、Goのコンパイラ、ソースコード、ダウンロードした依存モジュール、ビルドのキャッシュが入っている。最終的なイメージに残るのは、Alpineと実行ファイル1つだけである
- frontendの最終的なイメージには、開発用のパッケージを含む`node_modules`全体とソースコードが入らない。ただし、実行にはNode.js本体が必要なため、backendほどは小さくならない

## まとめ

### 工夫したこと

- **Step 8の層の分け方を、コンテナでも再現した**。Step 8では、セキュリティグループとサブネットで「各層は直前の層からだけ受け付ける」ようにした。今回は、ポートの公開をfrontendの3000番だけにし、ネットワークを2つに分けることで同じ形にした。frontendからdbへ接続できないことは、追加の確認2で確かめた
- **秘密の値を、イメージにもGitにも入れない**。値は起動時に`.env`から渡し、`.dockerignore`は許可リスト方式にして、`.env`がビルドに紛れ込まないようにした。Googleの認証情報はダミーにして、本物を手元に置かずに済むようにした
- **マルチステージビルドで、実行に必要なものだけをイメージに残した**。backendのイメージには、実行ファイル1つと最小限のOSだけが入る。frontendも、実行用のイメージにはstandalone出力と静的ファイルだけを入れた。ビルド用のステージと比べて、backendは1.45GBから38.9MB、frontendは1.33GBから303MBになった(追加の確認3)
- **起動の順番を、ヘルスチェックで確実にした**。`depends_on`は、何も指定しないと、前のコンテナが起動しただけで次へ進む。`condition: service_healthy`を指定し、前のコンテナが実際に応答できるようになるまで待つようにした
- **既存の構成を壊さない変更にした**。Goのコードは変更せず、Next.jsの設定もDockerでビルドするときだけ切り替わるようにした。Step 8のEC2での起動方法は、そのまま使える
- **rootで動かさない**。backendは専用のユーザー、frontendは`node`ユーザーで動かす。アプリが乗っ取られた場合でも、コンテナの中でできることを限れる

### 学んだこと

- **コンテナの中の`localhost`は、そのコンテナ自身を指す**。ほかのコンテナへはサービス名で接続し、その名前は同じネットワークに入っているコンテナからしか解決できない。ネットワークの分け方が、そのまま「どのコンテナがどのコンテナに接続できるか」になる
- **設定には、ビルドの時点で決まるものと、起動のときに渡すものがある**。Next.jsの転送先はビルドの時点で固定されるため、起動時の環境変数では変えられなかった。値がいつ決まるかによって、ビルド引数と環境変数を使い分ける必要がある
- **マルチステージビルドで外せるのは、ビルドにだけ使うものである**。Goは実行ファイル1つで動くため、コンパイラなどを外すとbackendは38.9MBまで小さくなった。Next.jsは実行にもNode.js本体が必要なため、frontendはbackendほど小さくならなかった。どこまで小さくできるかは、実行に何が必要かで決まる
- **コンテナの中のデータは、コンテナと一緒に消える**。残したいデータはボリュームに置く。`docker compose down`ではボリュームは残り、`-v`を付けると消える
- **Postgresの公式イメージは、初期設定をボリュームが空のときにしか行わない**。DBのパスワードは初回の起動時に記録されるため、あとから`.env`の値を変えても反映されない。変えるときは、ボリュームごと作り直す必要がある
