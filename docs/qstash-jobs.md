# QStashジョブ処理

## 現在の実装範囲

QStash受信側の安全な骨格を実装済みです。

- 受信エンドポイント: `POST /webhooks/qstash/jobs`
- 必須設定: `QSTASH_CURRENT_SIGNING_KEY`、`QSTASH_NEXT_SIGNING_KEY`、`QSTASH_JOB_RECEIVER_URL`
- 署名検証は設定済みの固定URLに対して実行する
- payloadは`{ "jobId": "<UUID>" }`のみ
- ジョブclaim、lease、token、attempt上限、冪等処理をSupabase RPCで管理
- 未実装のCalendar処理を成功扱いしない安全なexecutor

`supabase/migrations/0002_processing_job_claim.sql`を適用するまで、このエンドポイントは有効化しないでください。migrationはこのリポジトリから自動適用されません。

## 未実装

- QStash publish
- Google Calendar処理
- 実QStash・実Supabaseでの統合確認
- ジョブ処理の本番運用監視

既定executorは意図的に失敗して再試行させます。成功したDB requeueを確認した場合、エンドポイントはHTTP 500を返し、QStashに再配信させます。migrationは`available_at`を`now()`に戻すため、再試行間隔はQStashのretry/backoff設定に委ねられます。

本番では、QStashのretry回数・backoff、レート制限、監視を別途設定してください。Calendar処理を実装する際は、lease切れによる二重実行に備え、外部API操作にもjob ID等の冪等性キーを使用します。
