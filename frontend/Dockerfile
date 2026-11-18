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
