# ローカルの `staging/song-reviews.json` 調査メモ

調査日: 2026-11-22

## 結論

- ローカルの `staging/song-reviews.json` は、FN-003 レビュー準備処理が出力する形式のデータ。`schema_version` は `1`、`reviews` は 73 件。
- 現在の作業ツリーでは未追跡ファイルであり、確認時点の `main`、`design/scr001-public-site-screens`、取得済みのリモートブランチには含まれていない。
- 2026-10-12 のローカル Codex チェックポイントコミット `4102804` に同じバイト列のファイルが残っている。ただし、生成コマンドの実行記録は確認できていないため、このファイルを FN-003 が実際に生成したと断定はしない。

## 根拠

- [`npm run prepare:reviews`](../../../package.json) は [`scripts/prepare-reviews.js`](../../../scripts/prepare-reviews.js) を実行する。
- [`prepareReviews`](../../../src/prepare-reviews.js) は `staging/song-candidates.json`、canonical CSV、存在する場合は `staging/review-results.json` を読み込み、結果を `staging/song-reviews.json` に保存する。出力は再生成可能なレビュー提案で、canonical CSV の正本ではない。仕様は [FN-003 レビュー準備](../../design/functions/FN-003-レビュー準備.md) を参照。
- ファイルの作成日時と最終更新日時はどちらも 2026-10-12 01:03:05（ローカル時刻）。チェックポイント `4102804` のコミット日時は同日 01:03:48 +0900。
- ローカルファイルの Git blob SHA-1 と、`4102804:staging/song-reviews.json` の blob SHA-1 はいずれも `1e56b6ba4b86362e06a0ade224968549329c82b9`。これは内容がバイト単位で一致することを示す。
- `git log --remotes -- staging/song-reviews.json` は履歴を返さず、`4102804` を含む参照はローカルの `refs/agents/.../checkpoints/...` のみだった。

## 取り扱い

再生成には `npm run prepare:reviews` を使えるが、実行すると現在の `staging/song-reviews.json` が置き換わる。内容を残したい場合は、実行前にコピーまたは差分確認を行う。
