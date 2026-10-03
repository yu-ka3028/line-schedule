# line-schedule

LINE Messaging API と Google Calendar を使ったスケジュール管理サービスの最小骨格です。
Vercel Functions 上で Hono を実行し、Supabase、QStash、Google OAuth / Calendar を将来利用します。

## 開発

```sh
npm install
npm run dev
```

`npm run dev` は `npx vercel dev` を起動します。`package.json` の `dev` script を
`vercel dev` にすると Vercel CLI が自分自身を再帰起動するため、ラッパー経由にしています。
ポートを指定する場合は次のようにします。

```sh
npm run dev -- --listen 127.0.0.1:3000
```

Vercel CLI を直接起動する場合も、次のコマンドを使用できます。

```sh
npx vercel dev --listen 127.0.0.1:3000
```

検証コマンド:

```sh
npm run typecheck
npm run lint
npm run test
npm run build
```

`/healthz` が `{"ok":true}` を返します。環境変数名は `config.example` に記載しています。値を含む環境ファイルは作成・コミットしないでください。

## GitHub公開前チェック

- 実値入りの環境変数、OAuthトークン、APIキー、秘密鍵をコミットしない
- `.env*`、`.vercel/`、秘密鍵拡張子、ログ、ローカルDBが除外されていることを確認する
- `git diff --cached` でステージ内容を確認してからpushする
- GitHub/Vercel/Supabaseの環境変数は各サービスの管理画面に登録する

## 現在の構成

- `src/app.ts`: Hono アプリ本体
- `api/[[...route]].ts`: Vercel Functions のエントリポイント
- `POST /webhooks/line`: 署名・入力検証後、ユーザー由来イベントと`line_event_process` outbox jobを原子的に保存する。同期Replyは行わず、成功時は必ず200を返す
- Supabase service role、本文暗号化、イベント保存を実装済み。QStashは署名検証・ジョブ状態管理の安全な骨格を実装済み

## 未実装範囲

- LINE Webhook の業務イベント処理（現時点の同期対象は単一user/textのみ。group/room、非text、複数イベントはReplyしない）
- Supabase実環境への接続確認（単体テストは外部接続なし）、実LINE送信確認。同期処理の実測値は実LINE channel access tokenで未確認
- グループ・ルームイベントの個人登録（MVPでは保存対象外）
- Calendar/LLM executorは未実装。QStash publishは`LINE_ASYNC_PROCESSING_ENABLED=true`の場合だけ試行する（未設定/falseがdefault）。executor実装と検証なしに本番で有効化しない
- Google OAuth、トークン保管、Google Calendar 連携
- エラー監視、レート制限、リプレイ対策、運用設定

レート制限とリプレイ対策は未実装です。本番ではVercelの設定やWAFなどのインフラ側で、レート制限と必要なリプレイ対策を必ず設定してください。

署名検証なしにWebhook本文を処理する実装は追加しないでください。現在は検証成功後に入力検証と冪等保存を行い、成功時は200、入力不正は400、永続化失敗は詳細を含めず500で応答します。LINE_CHANNEL_SECRET、Supabase接続情報、暗号化鍵の未設定は503、署名不正・欠落は401で応答します。ユーザーsourceイベントのみ、イベント単体のJSONを `WEBHOOK_PAYLOAD_ENCRYPTION_KEY`（base64の32バイト鍵）によるAES-256-GCM暗号文として保存します。Webhook全体は保存せず、group/roomや別userイベントを同じ暗号文に含めません。`SUPABASE_SERVICE_ROLE_KEY` はサーバー側だけで使い、anon keyで書き込みません。本文は署名検証前にJSONとして解釈しません。実Supabase接続はまだ確認していません。

Webhook本文は最大1 MiB、1回のWebhookに含められるイベント数は最大100件です。複数イベントの保存は現時点ではイベント単位の逐次処理であり、途中失敗時に一部だけ保存される非原子的な動作です。将来、必要に応じて複数イベント保存をRPCなどで原子化してください。

同期Replyは廃止しました。LINE access tokenは設定として残せますが返信には使用しません。`LINE_ASYNC_PROCESSING_ENABLED`がfalseの場合はイベント保存までで200、trueの場合は短いQStash publishを試行します。publish失敗はDBの`retry_due` outboxとして回収可能です。保証はexactly-onceではなく、at-least-once publishと冪等jobです。replyTokenは保存・ログ・QStash payloadに含めません。Push方式の返信が必要な場合は、executorと認可・再送設計を別途実装してください。

migration `0003_line_event_outbox.sql`〜`0005_qstash_executor_safety.sql` は未適用です。適用後、Supabase service roleでRPCを利用し、`QSTASH_TOKEN`とreceiver URLを登録してください。0005は既存LINE jobの`expires_at`を`created_at + 15分`以内に正規化し、期限切れjobを`failed`/`skipped`として再publish対象外にします。適用前にDBバックアップと対象件数を確認し、適用後に次のSQLで残存違反がないことを確認してください。

```sql
select count(*) from public.processing_jobs
where job_type = 'line_event_process'
  and (expires_at is null or expires_at > created_at + interval '15 minutes');
```

rollbackはflagをfalseに戻してpublishを停止し、必要に応じてoutboxを監視してからmigrationを計画的に戻します。QStash/DB/LLMの費用は各サービスの従量料金に依存し、Phase 1では保存・publish回数×各サービス単価が概算です。

## 次の実装順

1. `0003_line_event_outbox.sql`を適用し、flag falseでhealth/webhookを確認
2. executor実装と外部接続なしの統合検証を完了
3. 少量環境でflag true、publish/retry_due/重複を監視
4. Calendar/LLM、Push返信、監視、レート制限を実装

## Supabaseマイグレーション

初期スキーマは `supabase/migrations/0001_initial.sql` にあります。Supabase CLIを導入済みの環境では、プロジェクトをリンクした後に次のコマンドで適用できます。

```sh
supabase db push
```

このマイグレーションはまだ実行していません。全テーブルでRLSを有効にし、MVPではクライアント向けpolicyを作成していないため、アクセスはbackendのservice role接続に限定されます。service role keyをクライアントへ渡さないでください。

`inbound_events.payload_ciphertext` は、LINEイベントの本文・画像・イベント内容をアプリケーション側で暗号化した暗号文の保存先です。暗号化、鍵管理、復号はアプリケーション実装が必要であり、このSQL自体は暗号化を行いません。`usage_logs.metadata` に秘密情報や本文・イベント内容を保存しないでください。同期計測metadataはschema_version、固定outcome、total_ms、persistence_ms、reply_msだけです。replyTokenはDB・暗号化payload・usage/logへ保存せず、実行時だけ保持します。LINE_CHANNEL_ACCESS_TOKEN未設定時はReplyを実行せず、保存後に200を返します。保存成功後のReply失敗・timeoutも200です。`inbound_events` は `insert(...).select('id').single()` の戻り値で新規挿入を判定し、`line_event_id` のunique違反（Postgres code `23505`）だけをduplicateとして扱います。それ以外の保存エラーは処理を中断します。

## QStash jobs

QStash受信側の安全な骨格を実装済みです。詳細、必要な設定、migration適用条件、未実装範囲は[QStashジョブ処理の設計メモ](docs/qstash-jobs.md)を参照してください。

## Outbox dispatcher運用

`POST /webhooks/qstash/outbox-dispatch` はQStash署名付きの固定payload `{ "kind": "outbox_dispatch" }` を受け、最大10件のpending/retry_due/lease切れをclaimしてpublishします。QStash Scheduleを後からこのURLへ1分間隔などで設定すれば、未publishを回収できます。Schedule設定はQStash管理画面/APIで行い、`QSTASH_JOB_RECEIVER_URL`（HTTPS、固定path `/webhooks/qstash/jobs`、credentials/query/hashなし）とは分離します。

migrationは `0001` → `0002` → `0003` → `0004` → `0005` の順に適用してください。0005適用後、期限切れLINE jobは`publish_status = 'skipped'`（既にpublishedの場合はpublished）となり、lease token/expiryをクリアし、`next_publish_at`を無限時刻へ移して再送対象外になります。`LINE_ASYNC_PROCESSING_ENABLED` はdefault falseで、flag offではpublisher/dispatcher/receiverの外部通信・DB処理はありません。Productionではfalseを維持してください。publishはat-least-onceで、timeout後の重複publishを監視します（exactly-onceではありません）。job payloadにreplyToken/本文は含めません。`line_event_process` の実executorは未実装です。receiverは未実装・未知job_typeをretryable failureとして成功扱いせず、LINE jobは15分TTL超過後にexecutor/publish対象外になります。retryable failureでは処理job再queueとoutbox retry_due復帰を行います。
