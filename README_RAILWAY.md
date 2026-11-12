# Railway で公開する手順（会社別の保存・コピー・一覧つき）

Railway で公開すると、事業計画シミュレーターが「ツール」として開け、会社ごとのデータを
データベース（PostgreSQL）に貯められます。Googleスプレッドシート／Apps Script は不要です。

## できること
- **☁ 保存**：会社名を付けて保存 → その会社専用のURL（`?id=...`）が発行される
- **📋 コピーして新規作成**：いま開いている内容をそのままコピーして、別の会社用を作る（元は変わらない）
- **📁 会社一覧**：保存済みの会社を一覧表示。開く／コピー／削除、「初期値から新規作成」も可能
  （管理用パスワードが必要。営業損益は最後に保存した時点の値）

## 手順（初回のみ・約10分）
1. https://railway.com にログイン →「New Project」→「Deploy from GitHub repo」→ `bukkenking2014/bk-plan` を選択
   （GitHubの連携で、組織 `bukkenking2014` へのアクセスを許可する必要があります）
2. 同じプロジェクトで「+ New」→「Database」→「Add PostgreSQL」
3. アプリ（bk-plan）のサービス →「Variables」に次の2つを追加
   - `DATABASE_URL` ＝ `${{Postgres.DATABASE_URL}}`（Railwayの変数参照で入力）
   - `ADMIN_PASSWORD` ＝ 会社一覧を開くための管理用パスワード（推測されにくいもの）
4. 「Settings」→「Networking」→「Generate Domain」で公開URLを発行 → 完了

以降は GitHub の `main` に push するたびに自動で再デプロイされます。

## 注意
- 各会社の専用URLを知っている人は、その会社のデータを閲覧・編集できます（URLは推測困難なランダム値）。
- `ADMIN_PASSWORD` が未設定の本番環境では、会社一覧・削除・エクスポートは無効になります。
- 全データのバックアップ：`/api/export` に `x-admin-password` ヘッダー付きでアクセスするとJSONで取得できます。
- GitHub Pages 版（Googleスプレッドシート保存）は従来どおり動きます。Railway版は同じ画面で保存先だけが切り替わります。

## ローカルで試す
```bash
npm install
npm start        # http://localhost:3000 （DATABASE_URL未設定なら ./data/companies.json に保存）
```
