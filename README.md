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
- `POST /webhooks/line`: 署名・入力検証後、ユーザー由来イベントをSupabaseへ冪等保存する
- Supabase service role、本文暗号化、イベント保存を実装済み。QStash / Google / LINE SDKは将来利用する

## 未実装範囲

- LINE Webhook の業務イベント処理、返信（受信イベントの冪等保存は実装済み）
- Supabase実環境への接続確認（単体テストは外部接続なし）
- グループ・ルームイベントの個人登録（MVPでは保存対象外）
- QStash の署名検証とジョブ処理
- Google OAuth、トークン保管、Google Calendar 連携
- エラー監視、レート制限、運用設定

署名検証なしにWebhook本文を処理する実装は追加しないでください。現在は検証成功後に入力検証と冪等保存を行い、成功時は200、入力不正は400、永続化失敗は詳細を含めず500で応答します。LINE_CHANNEL_SECRET、Supabase接続情報、暗号化鍵の未設定は503、署名不正・欠落は401で応答します。ユーザーsourceイベントのみ、イベント単体のJSONを `WEBHOOK_PAYLOAD_ENCRYPTION_KEY`（base64の32バイト鍵）によるAES-256-GCM暗号文として保存します。Webhook全体は保存せず、group/roomや別userイベントを同じ暗号文に含めません。`SUPABASE_SERVICE_ROLE_KEY` はサーバー側だけで使い、anon keyで書き込みません。本文は署名検証前にJSONとして解釈しません。実Supabase接続はまだ確認していません。

複数イベントの保存は現時点ではイベント単位の逐次処理であり、途中失敗時に一部だけ保存される非原子的な動作です。将来、必要に応じて複数イベント保存をRPCなどで原子化してください。

## 次の実装順

1. LINE Webhook のイベント処理と単発テキストイベントの入力検証
2. Supabaseマイグレーションの適用と、backend service role を使った永続化
3. Google OAuthと安全なトークン保管
4. Calendar操作をQStashジョブとして実装
5. リトライ、監視、レート制限、統合テスト

## Supabaseマイグレーション

初期スキーマは `supabase/migrations/0001_initial.sql` にあります。Supabase CLIを導入済みの環境では、プロジェクトをリンクした後に次のコマンドで適用できます。

```sh
supabase db push
```

このマイグレーションはまだ実行していません。全テーブルでRLSを有効にし、MVPではクライアント向けpolicyを作成していないため、アクセスはbackendのservice role接続に限定されます。service role keyをクライアントへ渡さないでください。

`inbound_events.payload_ciphertext` は、LINEイベントの本文・画像・イベント内容をアプリケーション側で暗号化した暗号文の保存先です。暗号化、鍵管理、復号はアプリケーション実装が必要であり、このSQL自体は暗号化を行いません。`usage_logs.metadata` に秘密情報や本文・イベント内容を保存しないでください。
