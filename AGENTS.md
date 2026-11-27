# みんなの古民家ギャラリー｜AI 相棒のルール（AGENTS.md）

このフォルダは、会員さんが「みんなの古民家ギャラリー」のお部屋を育てるための GitHub 置き場です（**非公開（Private）でも公開（Public）でも OK**）。
Antigravity / Codex / Claude Code のどれで開かれていても、次のルールで動いてください。

## 基本の進め方（超シンプル）

1. **専門用語を使わず、やさしい短い日本語で会話する**
   - 会員さんは非技術者の方が中心です。難しい横文字は日常の言葉に言い換えてください。
2. **`room-recipe.json` を編集して、GitHub にコミット＆プッシュするだけ（鍵や特別な公開スクリプトは不要）**
   - 依頼に合わせて `room-recipe.json` を書き換え、形式と文字数・許可値を確認します。
   - どこを変えたかを短く伝え、わかりやすい日本語の記録メモをつけてコミット＆プッシュします。
   - 会員サイトの **「お部屋を編集」→「GitHub連携」** タブで **「GitHubとつなぐ」** を押してお部屋フォルダを 1 つ選んでおけば（見るだけ専用・書き換え不可・いつでも解除 OK）、部屋を開いたとき（または **「GitHub更新」** ボタン 1 押し）に自動で最新が反映されます。もちろん公開フォルダのまま URL を貼る使い方もできます。
3. **1つ前に戻したいとき**
   - 直近の履歴をわかりやすい日本語で見せ、過去の履歴を消さない安全な方法で `room-recipe.json` を戻してコミット＆プッシュします。

## 絶対に守るルール（非公開でも厳守）

- **重い画像・動画ファイル本体や、大切な写真（会員限定にしたい写真）は GitHub に置かない**
  - 写真（5MBまで）・短い動画（15MBまで）はギャラリー編集画面のアップロード機能、長い動画は YouTube リンク（限定公開 OK）を使うよう案内してください。
  - GitHub に置くのは、お部屋の設計図（`room-recipe.json` や特注 `index.html`）だけです。
- **秘密情報・個人情報（パスワード、本名、住所、連絡先など）は絶対に書かない・上げない**
- **会員さんの明示的な依頼なしに `status` を `"published"` に変えたり、GitHub の公開範囲を広げたり、履歴を消す強制操作をしない**

## `room-recipe.json` の許可値メモ

- 必須・形式：UTF-8 の正しい形式（32KB 以内）、`schemaVersion` は `1` 固定
- `title`（1〜60文字）、`author`（1〜40文字）、`description`（0〜300文字）
- `theme` / 作品の `motif`（9色）：`daybreak` / `moss` / `wind` / `rain` / `dusk` / `cloud` / `lake` / `indigo` / `moon`
- `status`：`"draft"`（下書き・迷ったらこちら）または `"published"`（みんなに公開）
- `works`（0〜8点）：`kind` は `print` / `note` / `motion`。`imageUrl` はギャラリーの `/api/gallery/media/...` または `https://...`、`videoUrl` は `/api/gallery/media/...` または安全な YouTube URL のみ
- `curation`：
  - `printMount`：`frame` / `hanging` / `folding` / `alcove` / `panorama` / `layered`
  - `noteMount`：`case` / `lectern` / `table`
  - `motionMount`：`screen` / `projection` / `recess`
  - `initialNight`：`false`（昼の陽だまり）または `true`（夜の行灯）
  - `notePages`：入れる場合は必ず 3 ページ分（`tabLabel` 20文字、`heading` 60文字、`body` 400文字、`caption` 80文字まで）
  - `projects`（開発中 GitHub 紹介棚・最大 5 件）：`name`（1〜60文字）、`repoUrl`（`https://github.com/...`）、`summary`（0〜240文字）、`stage`（`idea` / `building` / `beta` / `launched`）、`demoUrl`（任意・`https://...`）
- `githubRepoUrl`（任意）：自分の `https://github.com/...` URL
