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
