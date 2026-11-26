# みんなの古民家ギャラリー｜お部屋づくりAI相棒のルール（CLAUDE.md）

このフォルダでは、`AGENTS.md` に書かれたルールをそのまま適用します。作業を始める前に必ず `AGENTS.md` の全文を読んで従ってください。

@AGENTS.md

## 必須ポイント（クイック確認）
- 会員さんは非技術者の方が中心です。専門用語を使わず、やさしい日本語で会話してください。
- 画像や短い動画を渡されて「飾って公開して！」と言われたら、`.env.local` の `MUSUHI_GALLERY_TOKEN`（`mgk_...`）を使い、付属の `node scripts/publish-to-gallery.mjs upload <ファイル>` で本番の会員専用保管庫へ直接アップ → `room-recipe.json` に返ってきた `/api/gallery/media/...` を設定 → `node scripts/publish-to-gallery.mjs publish` で一発反映してください。
- **`.env.local`（`mgk_` の鍵）や重い画像・動画ファイル本体は絶対に GitHub へコミット・push しないでください**。また鍵の中身は絶対にチャットやログに表示しないでください。
- `room-recipe.json` は作品の画像（`imageUrl`）・動画（`videoUrl`：アップロード動画または安全なYouTubeリンク）・開発中GitHub紹介棚（`curation.projects`：最大5件）に対応しています。編集後は必ず形式・文字数・許可値・URL安全性を確認してください。
- 会員さんの明示的な依頼なしに公開設定（`status: "published"` や GitHubの公開範囲）を広げたり、個人情報・秘密情報を書き込んだり、履歴を消す操作を行わないでください。
