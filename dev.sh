#!/bin/bash
# ローカル開発用。Goバックエンド(:8080)とNext.js(:3000)を同時に起動する。
# ブラウザからは http://localhost:3000 にアクセスする。
#
#   ./dev.sh
#
# 事前に .env へ DATABASE_URL / APP_PASSWORD / WEATHER_API_KEY を設定しておくこと。
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo ".env がありません。README を参照して作成してください。" >&2
  exit 1
fi

# .env を環境変数として読み込む
set -a
# shellcheck disable=SC1091
source .env
set +a

for name in DATABASE_URL APP_PASSWORD WEATHER_API_KEY; do
  if [ -z "${!name:-}" ]; then
    echo ".env の $name が空です。値を設定してください。" >&2
    exit 1
  fi
done

cleanup() {
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Goバックエンドを起動します (http://localhost:${PORT:-8080})"
go run ./cmd/server &

echo "Next.jsを起動します (http://localhost:3000)"
cd frontend && npm run dev
