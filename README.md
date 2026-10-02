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
- `POST /webhooks/line`: `LINE_CHANNEL_SECRET` と raw body による LINE 署名検証後、Webhookイベントの最小入力検証を実施し、妥当な入力はイベント処理未実装として 501
- Supabase / QStash / Google / LINE SDK: 将来の実装に備えた依存関係のみ

## 未実装範囲

- LINE Webhook のイベント処理、永続化、返信（署名検証と最小入力検証は実装済み）
- Supabase の永続化処理（初期スキーマと backend service role 専用の RLS 境界は追加済み）
- QStash の署名検証とジョブ処理
- Google OAuth、トークン保管、Google Calendar 連携
- エラー監視、レート制限、運用設定

署名検証なしにWebhook本文を処理する実装は追加しないでください。現在は検証成功後にイベントの最小入力検証のみを行い、妥当な入力は501、入力不正は400で停止します。`LINE_CHANNEL_SECRET` 未設定は503、署名不正・欠落は401で応答します。本文は署名検証前にJSONとして解釈しません。message text/image、postback、followを識別し、未知イベントは副作用なしにunknownとして扱います。

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
