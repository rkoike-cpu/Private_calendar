# AWS構築手順(Step 8)

[`personal-calendar.yaml`](./personal-calendar.yaml) は、[インフラ構成設計書](../docs/infra-design.md)の構成をそのまま作るCloudFormationテンプレートである。すべて東京リージョン(ap-northeast-1)で操作する。

所要時間の目安は、準備に30分、スタック作成の待ち時間に40〜60分、確認に30分程度。

> **費用に注意**: スタックを作った時点から課金が始まる(RDSマルチAZ・ALB・EC2 2台などで月$100前後)。提出とメンタリングが終わったら「8. 削除」を行う。

## 0. 前提

- アプリのコードが GitHub の `main` に push 済みであること。EC2は起動時に `main` を取得してビルドするため、`/api/health` などの変更が push されていないと動かない
- AWSのコンソールにログインでき、リージョンが東京になっていること

## 1. 使うAZを確認する

VPCオリジンは、AZ IDが `apne1-az3` のAZでは使えない。AZ名とAZ IDの対応はアカウントごとに違うため、先に確認する。

1. EC2コンソールのダッシュボードを開き、右側の「アカウントの属性」>「ゾーン」を見る
2. `ap-northeast-1a` と `ap-northeast-1c` のAZ IDが `apne1-az3` でないことを確認する
3. どちらかが `apne1-az3` なら、もう一方と `ap-northeast-1d` を使う(スタック作成時のパラメータで指定する)

## 2. CloudFrontのプレフィックスリストIDを調べる

1. VPCコンソールの左メニュー「マネージドプレフィックスリスト」を開く
2. `com.amazonaws.global.cloudfront.origin-facing` の行の「プレフィックスリストID」(`pl-` で始まる値)を控える

## 3. 設定値をParameter Storeに登録する

Systems Manager コンソール >「パラメータストア」>「パラメータの作成」で、次をすべて作る。

- 階層: `/personal-calendar/` の下に置く(名前はそのまま環境変数名になる)
- 利用枠: 標準
- タイプ: **安全な文字列(SecureString)**、KMSキーはデフォルト(`alias/aws/ssm`)のまま

| 名前 | 値 |
|---|---|
| `/personal-calendar/DB_PASSWORD` | RDSのパスワード。新しく決める。**英数字のみ・16文字以上**(記号を入れると接続URLが壊れる) |
| `/personal-calendar/APP_PASSWORD` | ダッシュボードの合言葉 |
| `/personal-calendar/WEATHER_API_KEY` | WeatherAPI.com のキー |
| `/personal-calendar/VAPID_PUBLIC_KEY` | プッシュ通知の公開鍵 |
| `/personal-calendar/VAPID_PRIVATE_KEY` | プッシュ通知の秘密鍵 |
| `/personal-calendar/GOOGLE_OAUTH_CREDENTIALS_JSON` | Google Cloud Consoleからダウンロードした `client_secret_*.json` の中身をそのまま貼る |

`APP_PASSWORD` 以降は、ローカルの `.env` や Render で使っている値と同じでよい。VAPIDの鍵を変えると、登録済みの端末のプッシュ通知が届かなくなる。

## 4. スタックを作る

1. CloudFormationコンソール >「スタックの作成」>「新しいリソースを使用(標準)」
2. 「テンプレートファイルのアップロード」で `infra/personal-calendar.yaml` を選ぶ
3. スタック名: `personal-calendar`
4. パラメータ:
   - `CloudFrontPrefixListId`: 手順2で控えた `pl-...`
   - `AvailabilityZone1` / `AvailabilityZone2`: 手順1で確認したAZ
   - それ以外はデフォルトのまま
5. 最後の画面で「AWS CloudFormation によって IAM リソースが作成される場合があることを承認します」にチェックを入れて作成する

作成には40〜60分かかる。時間がかかるのは主に、RDSのマルチAZ(20〜30分)とCloudFrontのVPCオリジン(最大15分)である。状態が `CREATE_COMPLETE` になれば完了。

`ROLLBACK_COMPLETE` になった場合は、「イベント」タブで最初に `CREATE_FAILED` になった行の「状況の理由」を確認する。スタックを削除してから作り直す。

## 5. アプリが起動するのを待つ

スタックが完成しても、EC2の中ではまだビルドが走っている(10分前後)。

1. EC2コンソール >「ターゲットグループ」で、スタックが作ったターゲットグループの「ターゲット」タブを開く
2. 2台とも `healthy` になれば起動完了

`unhealthy` のまま20分以上たつ場合は、「7. 困ったとき」を見る。

## 6. 動作を確認する

スタックの「出力」タブに、使うURLが表示されている。

### Google側にリダイレクトURIを登録する

1. Google Cloud Console >「APIとサービス」>「認証情報」で、使っているOAuthクライアントを開く
2. 「承認済みのリダイレクトURI」に、出力の `GoogleRedirectUri` (`https://xxxx.cloudfront.net/auth/google/callback`)を追加して保存する

`*.cloudfront.net` が登録できない場合は、設計書の「GoogleのOAuthに`*.cloudfront.net`を登録できるかは未確認」の対応(独自ドメインの取得)が必要になる。

### バックエンドの疎通確認(提出用)

```
curl -i https://xxxx.cloudfront.net/api/health
```

`HTTP/2 200` と `{"status":"ok"}` が返れば成功。

### ブラウザでの確認(提出用)

1. 出力の `AppUrl` を開き、合言葉でログインする
2. 会社PCからGoogle連携を行う(RDSは新しいDBなので、連携は最初からやり直しになる)
3. 予定の表示・追加・更新・削除ができることを確認する

## 7. 困ったとき

- **ログを見る**: CloudWatchコンソール >「ロググループ」> `/personal-calendar/app`。インスタンスごとに次の3つのストリームがある
  - `<インスタンスID>/user-data`: 起動時のビルドのログ。ターゲットが `unhealthy` のままならまずここを見る
  - `<インスタンスID>/backend`: Goのログ
  - `<インスタンスID>/frontend`: Next.jsのログ
- **インスタンスに入る**: EC2コンソールでインスタンスを選び「接続」>「Session Manager」。SSHの鍵は不要
  - `sudo systemctl status pc-backend pc-frontend` で起動状態を確認する
  - `sudo systemctl restart pc-backend` で、Parameter Storeの値を読み直して再起動する

## 8. コードを更新したとき

EC2は起動時にGitHubからコードを取得するため、インスタンスを作り直すと最新の `main` が反映される。

1. 変更を `main` に push する
2. EC2コンソール >「Auto Scaling グループ」でグループを選び、「インスタンスの更新」タブ >「インスタンスの更新を開始」
3. 「最小正常率」を50%にして開始する(1台ずつ入れ替わるため、止まらずに更新できる)

## 9. 削除

1. CloudFormationコンソールでスタック `personal-calendar` を削除する(RDSはスナップショットを残さず削除される)
2. Parameter Store の `/personal-calendar/` 以下のパラメータを削除する
3. Google Cloud Console に追加したリダイレクトURIを削除する
