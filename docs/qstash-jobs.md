# QStashジョブ処理

## 受信と安全境界

- `POST /webhooks/qstash/jobs` は署名検証後、payload `{ "jobId": "<UUID>" }` のみを受け付けます。
- `POST /webhooks/qstash/outbox-dispatch` は `LINE_ASYNC_PROCESSING_ENABLED=true` の場合だけ有効で、署名検証後に `{ "kind": "outbox_dispatch" }` のみを受け付けます。最大10件をclaimし、publish後に状態更新します。
- dispatcherはQStash Scheduleから1分程度の間隔で呼び出す想定です。ScheduleはQStash管理画面/APIで後から設定できます。未設定でも未publishレコードはDBに残り、設定後にpending/retry_due/期限切れleaseを回収します。
- `0001`、`0002`、`0003`、`0004`の順で適用してください。`0004`は既存migrationを変更せず、dispatcher RPCと期限切れlease回収を追加します。

## 設定

`QSTASH_CURRENT_SIGNING_KEY`、`QSTASH_NEXT_SIGNING_KEY`、`QSTASH_TOKEN`、`QSTASH_JOB_RECEIVER_URL`、`QSTASH_OUTBOX_DISPATCHER_URL`を設定します。receiver URLはHTTPS、固定path `/webhooks/qstash/jobs`、dispatcher URLはHTTPS、固定path `/webhooks/qstash/outbox-dispatch`、いずれもcredentials/query/hashなしが必須です。ScheduleのPOST先はdispatcher URLです。

`LINE_ASYNC_PROCESSING_ENABLED` は既定falseです。falseではpublisher/dispatcherとも外部通信を行いません。true化前にmigration、署名鍵、Scheduleを確認してください。

## 実行保証と未実装

publishはat-least-onceです。QStash timeout後の重複publishを想定し、jobId由来のdeduplication IDを設定しますが、exactly-onceは謳いません。重複publishとlease切れは監視対象です。replyToken、本文、イベント内容はQStash payloadやログに出しません。

`line_event_process` はreceiverの既定executorに渡されますが、実ジョブexecutorは未実装です。Calendar job typeを壊さず、未知job_type/未実装はretryable failureとして成功扱いしません。

実QStash・実Supabase・Calendar処理の統合確認は未実施です。本番ではretry/backoff、Schedule実行、publish失敗、重複publish、lease回収を監視してください。
