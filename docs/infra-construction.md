# インフラ構築レポート(Personal Calendar)

## 概要

### 構成の特徴

Step 7で設計した構成を、AWSの東京リージョンに構築した。

```
ブラウザ → CloudFront ──→ 内部向けALB → EC2 ×2 ─┬─ Next.js (:3000)
 (HTTPS)     (VPCオリジン:                (AZごとに └─ Go API (:8080)
              AWS内部の非公開経路)          1台)           ↓
                                                   RDS for PostgreSQL
                                                       (マルチAZ)
```

- **1台のEC2の中で、フロントエンド(Next.js)とバックエンド(Go)を並べて動かす**。ブラウザは同じドメインの`/api/*`を呼び、Next.jsがインスタンス内のGoへ転送する。ローカルで動かしている構成を変えずにクラウドへ載せられる
- **ALBとAuto Scalingで、2つのAZに1台ずつ配置する**。台数は2台で固定し、Auto Scalingは故障したインスタンスの自動入れ替えに使う
- **HTTPSはCloudFrontで終端する**。独自ドメインを持たないため、`*.cloudfront.net`の証明書を使う。CloudFrontからALBへはVPCオリジンを使い、ALBをインターネットに公開しない
- **構築はCloudFormationのテンプレート1つで行った**([`infra/personal-calendar.yaml`](../infra/personal-calendar.yaml))。EC2は起動時にGitHubからコードを取得してビルドし、パスワードやAPIキーはParameter Storeから読み込む

### 採用したサービス

| 層 | サービス | 用途 |
|---|---|---|
| 配信 | CloudFront(VPCオリジン) | HTTPS終端と、ALBへの非公開の接続 |
| 負荷分散 | ALB(内部向け) | 2台への振り分けとヘルスチェック |
| アプリ | EC2(t3.small)+ Auto Scaling | Next.jsとGoの実行、故障したインスタンスの自動入れ替え |
| データ | RDS for PostgreSQL(db.t4g.micro・マルチAZ) | 永続化 |
| ネットワーク | VPC / サブネット / Internet Gateway | 通信経路の制御 |
| 権限 | IAM(インスタンスロール) | EC2からParameter Store・CloudWatch Logsへのアクセスと、Session Managerでの接続(SSHは開けない) |
| 設定 | Systems Manager パラメータストア | パスワードやAPIキーの保管(SecureString) |
| 監視 | CloudWatch Logs | 起動時のビルドとアプリのログの集約 |
| 構築 | CloudFormation | 上記すべてをテンプレート1つで作成・削除 |

### Step 7からの調整

| 調整 | 内容 | 理由 |
|---|---|---|
| ALBが受け付ける送信元 | CloudFrontが自動で作るセキュリティグループから、AWS管理のプレフィックスリスト(`com.amazonaws.global.cloudfront.origin-facing`)に変えた | 自動で作られるセキュリティグループは、VPCオリジンを作った後にしかIDが決まらず、CloudFormationのテンプレートから参照できない。ALBは内部向けでインターネットからの経路を持たないため、プレフィックスリストにしても、実際に届くのはこのアカウントのVPCオリジンからの通信だけである |
| ヘルスチェック用のエンドポイント | `GET /api/health`を追加し、ALBのヘルスチェックに使った | Step 7で代用を考えていた`/login`はNext.jsだけで応答できるため、Goが止まっていてもヘルスチェックが通ってしまう。`/api/health`はNext.jsを経由してGoまで届くので、両方が動いているときだけ成功する |
| リマインダーの送信 | 「送信済みの記録に成功した1台だけが通知を送る」順序に変えた | Step 7で見つけた、2台で動かすと同じ予定の通知が2回届く問題への対応 |

### 今回の範囲から外したもの

会社のGoogleカレンダーと連携する機能は、社内のセキュリティ上の判断により使わないことにした。そのため今回の構築ではGoogle連携を行わず、それ以外の機能(合言葉ログイン・ToDo・天気・プッシュ通知)で動作を確認する。

## インフラ構成図

![AWS構成図](./images/infra-architecture.png)

編集用の元データは[`infra-architecture.drawio`](./infra-architecture.drawio)(draw.io / app.diagrams.net で開く)。

## 動作確認

### curlでの疎通確認

```
curl -i https://dni7puxfgc6ua.cloudfront.net/api/health
```

![curlの実行結果](./images/step8_01_curl.png)

`HTTP/2 200`と`{"status":"ok"}`が返った。`via: ... (CloudFront)`と`x-amz-cf-pop: NRT20-P6`(成田のエッジ)から、CloudFrontを経由して届いていることがわかる。

`/api/health`はALBのヘルスチェックにも使っているパスで、ブラウザと同じくNext.jsを経由してGoまで届く。200が返ることは、CloudFront → VPCオリジン → ALB → EC2のNext.js → Goの全区間が通っていることを示す。

### ブラウザでの操作

**1. ログイン画面**

`https://dni7puxfgc6ua.cloudfront.net`を開くと、未ログインのため`/login`へ転送された。

![ログイン画面](./images/step8_02_login.png)

**2. ダッシュボード**

合言葉でログインすると、ダッシュボードが表示された。「今日の天気」は、EC2からInternet Gateway経由で外部のWeatherAPI.comを呼び出した結果である。

![ダッシュボード](./images/step8_03_dashboard.png)

**3. ToDoの追加**

ToDoを1件追加し、ページを再読み込みしても消えずに残ることを確認した。ToDoはGoがRDSに保存しているため、EC2からRDSまでの区間も動いていることがわかる。

![ToDoを追加した状態](./images/step8_04_todo.png)

## 机上確認

Step 7で設計した内容が、実際の環境に反映されていることを確認した。

### CloudFormationのスタック

テンプレート1つから、すべてのリソースが作成された(`CREATE_COMPLETE`)。

![CloudFormationのスタック](./images/step8_10_stack.png)

### CloudFront(VPCオリジン)

VPCオリジンが内部向けALBを指しており(プロトコルは`http-only`、ポート80)、ステータスは`Deployed`。関連付けられたディストリビューションのドメイン`dni7puxfgc6ua.cloudfront.net`は、動作確認で使ったURLと一致する。

![VPCオリジン](./images/step8_11_cloudfront.png)

### ALB(内部向け)

スキームが`Internal`で、インターネットから直接到達できない。ALBは`ap-northeast-1a`と`ap-northeast-1c`の2つのAZに置いた。

![ALB](./images/step8_12_alb.png)

### ターゲットグループとヘルスチェック

EC2が2台とも`Healthy`で、`ap-northeast-1a (apne1-az4)`と`ap-northeast-1c (apne1-az1)`に1台ずつ配置されている。VPCオリジンが使えない`apne1-az3`は避けている。

![ターゲット](./images/step8_13_targets.png)

ヘルスチェックのパスは`/api/health`。間隔30秒・2回連続の失敗で異常と判定する標準的な設定は、設計どおりである。

![ヘルスチェックの設定](./images/step8_14_healthcheck.png)

### Auto Scaling

希望するキャパシティが2、スケーリング制限が2〜2で、台数は2台に固定されている。インスタンスタイプは`t3.small`。

![Auto Scalingグループ](./images/step8_15_asg.png)

### セキュリティグループ

各層は、直前の層からの通信だけを受け付ける。送信元のIDをたどると、通信が一本の鎖でつながっていることがわかる。

| 対象 | ポート | 送信元 |
|---|---|---|
| ALB(`sg-0b419cfee4d789350`) | 80 | `pl-58a04531`(CloudFrontのプレフィックスリスト) |
| EC2(`sg-0c58ef6725cd05c71`) | 3000 | `sg-0b419cfee4d789350`(ALBのセキュリティグループ) |
| RDS(`sg-07baa3425e03381d2`) | 5432 | `sg-0c58ef6725cd05c71`(EC2のセキュリティグループ) |

![ALBのセキュリティグループ](./images/step8_16_sg_alb.png)

![EC2のセキュリティグループ](./images/step8_16_sg_ec2.png)

![RDSのセキュリティグループ](./images/step8_16_sg_rds.png)

### ルートテーブル

パブリックサブネット(EC2)は`0.0.0.0/0`をInternet Gatewayへ向けている。プライベートサブネット(ALB・RDS)は`10.0.0.0/16 → local`の1行だけで、VPCの外への経路を持たない。NAT Gatewayは置いていない。

![パブリックのルートテーブル](./images/step8_17_route_public.png)

![プライベートのルートテーブル](./images/step8_17_route_private.png)

### RDS

マルチAZが有効で、プライマリが`ap-northeast-1c`、スタンバイ(セカンダリ)が`ap-northeast-1a`にある。

![RDSの設定](./images/step8_18_rds_multiaz.png)

受け付ける通信は、EC2のセキュリティグループからのインバウンド1件だけである。プライベートサブネットに外への経路がないことと合わせ、RDSにはインターネットから到達できない。

![RDSのセキュリティグループのルール](./images/step8_18_rds_network.png)

### Parameter Store

アプリの設定値を`/personal-calendar/`の下に置いた。パスワードやAPIキーは`SecureString`(暗号化)で保管し、EC2は起動時にインスタンスロールの権限で読み込む。`GOOGLE_OAUTH_CREDENTIALS_JSON`はGoの起動時に必須のため登録しているが、Google連携は行わないため実際には使っていない。この1件だけ種類が`String`になっているのは登録時の設定漏れで、本来は他と同じく`SecureString`にすべきだった。

![Parameter Store](./images/step8_19_ssm.png)

### CloudWatch Logs

ロググループ`/personal-calendar/app`に、インスタンスごとの`user-data`(起動時のビルド)・`backend`(Go)・`frontend`(Next.js)の3つのストリームが届いている。

![CloudWatch Logs](./images/step8_20_logs.png)

## まとめ

### 工夫したこと

- **テンプレート1つで作成から削除までできるようにした**。手作業で作ると、削除のときに消し忘れが出たり、作り直したときに設定が変わったりする。CloudFormationにまとめたことで、同じ構成をいつでも作り直せ、課金を止めたいときはスタックの削除だけで済む
- **秘密情報をテンプレートにもディスクにも書かない**。DBのパスワードはテンプレートの中でParameter Storeを参照し、アプリの設定値はGoの起動のたびにParameter Storeから読み込む。インスタンスのディスクやAMIに値が残らない
- **ヘルスチェックでDBを確認しない**。`/api/health`はNext.jsとGoが動いていることだけを確認する。DBまで確認すると、RDSのフェイルオーバー中に2台とも異常と判定され、正常なインスタンスまでAuto Scalingに入れ替えられてしまうため
- **起動時のビルドのログを、最初にCloudWatchへ送る設定にした**。EC2は起動時にGitHubからコードを取得してビルドするため、ビルドが失敗するとアプリが起動しない。ログの送信を最初に設定しておくことで、インスタンスに入らなくても失敗の原因を追える
- **インスタンスへの接続はSession Managerに限った**。SSHの22番を開けず、鍵の管理も不要にした

### 学んだこと

- **AZの名前はアカウントごとに指す場所が違う**。`ap-northeast-1a`のようなAZ名と、物理的な場所を表すAZ ID(`apne1-az4`など)の対応はアカウントごとに異なる。VPCオリジンのように「特定のAZ IDでは使えない」機能を使うときは、名前ではなくIDで確認する必要がある
- **設計どおりに作れるかは、構築の手段まで考えて初めてわかる**。VPCオリジン用のセキュリティグループは、AWSが後から自動で作るため、CloudFormationのテンプレートからは参照できなかった。設計の段階で「どう作るか」まで確認しておくと、構築時の変更を減らせる
- **複数台にすると、1台では起きない不具合が出る**。リマインダーの二重送信は、1台で動かしている限り起きない。台数を増やすときは、各台が同じ処理を同時に行っても問題ないかを確認する必要がある
