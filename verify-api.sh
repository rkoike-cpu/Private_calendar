#!/bin/bash
# API動作確認スクリプト(ToDoのCRUD一連の流れ)
# 実行例: APP_PASSWORD=あなたの合言葉 ./verify-api.sh

BASE_URL="https://private-calendar-9ptj.onrender.com"
APP_PASSWORD="${APP_PASSWORD:?APP_PASSWORD を環境変数で渡してください}"
COOKIE_JAR=$(mktemp)

echo "=== 1. ログイン (POST /login) ==="
curl -s -c "$COOKIE_JAR" -X POST "$BASE_URL/login" \
  --data-urlencode "password=$APP_PASSWORD" \
  -D - -o /dev/null

echo -e "\n=== 2. ToDo一覧を取得 (GET /api/tasks) - 作成前 ==="
curl -s -b "$COOKIE_JAR" "$BASE_URL/api/tasks"
echo

echo -e "\n=== 3. ToDoを新規作成 (POST /api/tasks) ==="
CREATE_RES=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE_URL/api/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"APIテスト用のタスク","dueDate":"2026-09-20"}')
echo "$CREATE_RES"
TASK_ID=$(echo "$CREATE_RES" | grep -o '"ID":"[^"]*"' | sed 's/"ID":"//;s/"//')
echo "作成されたタスクID: $TASK_ID"

echo -e "\n=== 4. ToDo一覧を取得 (GET /api/tasks) - 作成後、永続化確認 ==="
curl -s -b "$COOKIE_JAR" "$BASE_URL/api/tasks"
echo

echo -e "\n=== 5. ToDoを完了状態に更新 (PATCH /api/tasks/{id}) ==="
curl -s -b "$COOKIE_JAR" -X PATCH "$BASE_URL/api/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -d '{"done":true}' \
  -D - -o /dev/null

echo -e "\n=== 6. ToDo一覧を取得 (GET /api/tasks) - 更新後、永続化確認 ==="
curl -s -b "$COOKIE_JAR" "$BASE_URL/api/tasks"
echo

echo -e "\n=== 7. ToDoを削除 (DELETE /api/tasks/{id}) ==="
curl -s -b "$COOKIE_JAR" -X DELETE "$BASE_URL/api/tasks/$TASK_ID" \
  -D - -o /dev/null

echo -e "\n=== 8. ToDo一覧を取得 (GET /api/tasks) - 削除後、永続化確認 ==="
curl -s -b "$COOKIE_JAR" "$BASE_URL/api/tasks"
echo

rm -f "$COOKIE_JAR"
