# 公開手順（GitHub Pages）

このアプリはバックエンド不要の静的HTML/CSS/JSです。GitHub Pagesで無料公開すると、
URLに「claude」が入らない、あなた専用のURL（例：`https://(ユーザー名).github.io/(リポジトリ名)/`）
で誰でもアクセスできるようになります。

## A. GitHub Desktop を使う方法（おすすめ・コマンド操作不要）

1. https://desktop.github.com/ から GitHub Desktop をインストールし、お持ちのGitHubアカウントで
   ログイン（アカウントが無ければ https://github.com で無料作成）
2. 「File」→「Add Local Repository」→ この `bk-business-plan-simulator` フォルダを選択
   （「これはGitリポジトリではありません。作成しますか？」と出たら「作成」を選択）
3. 左下の「Publish repository」をクリック。リポジトリ名を入力（例：`bk-business-plan`）し、
   「Keep this code private」のチェックを外して「Publish」
4. ブラウザで https://github.com/(ユーザー名)/(リポジトリ名) を開き、「Settings」→ 左メニューの
   「Pages」→「Build and deployment」の「Source」を「Deploy from a branch」、
   「Branch」を「main」／「/ (root)」にして「Save」
5. 数分待つと、同じ画面に公開URL（`https://(ユーザー名).github.io/(リポジトリ名)/`）が表示されます

以降、内容を更新した場合は GitHub Desktop で変更点を確認して「Commit to main」→「Push origin」
するだけで、公開ページも自動的に更新されます。

## B. コマンドライン（git）を使う方法

```bash
cd "このフォルダのパス"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/(ユーザー名)/(リポジトリ名).git
git push -u origin main
```

その後、GitHub上のリポジトリの Settings → Pages で「A」の手順4と同じ設定を行ってください。

## 独自ドメインにしたい場合

GitHub Pagesの同じ設定画面（Settings → Pages）の「Custom domain」に、お持ちのドメイン
（例：`plan.bukkenking.com`）を入力すると、そのドメインでも公開できます
（別途、ドメインのDNS設定でCNAMEレコードの追加が必要です。設定方法が分からない場合はお知らせください）。

## クラウド保存機能について

会社ごとのデータ保存・専用URL発行・スプレッドシート管理は、`gas-backend` フォルダの
`README_GAS_SETUP.md` の手順で別途セットアップが必要です（Googleスプレッドジート側の設定）。
アプリのヘッダーにある「⚙」ボタンから、発行されたURLをアプリに設定してください。
