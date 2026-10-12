# 公開サイト 基本設計（FN-001 / SCR-001）

## 目的

canonical CSV から作家ランキングと根拠データを集計し、静的な公開サイトで表示する。現在の公開対象は Juice=Juice（`G00001`）で、集計処理は指定した `artist_id` を受け取れる。

本書は実装済みのFN-001 公開サイトデータ生成機能とSCR-001 公開サイト画面を扱う統合基本設計。生成済みJSONを境界に責務を分ける。短い一連の流れとして確認できるため、現時点ではファイル分割・renameは行わない。

## FN-001 公開サイトデータ生成機能（実装済み）

### 入力と出力

- 入力：`data/*.csv` のうち集計に必要な artist、song、work、creator とその関連 CSV。
- 出力：`site/data/rankings/G00001.json` などの公開用ランキング JSON。

### 主な処理フロー

1. `src/canonical.js` が canonical CSV を読み込む。
2. `src/rankings.js` が指定 artist の primary song、work、creator credit を集計する。
3. `scripts/generate-rankings.js` がランキング JSON を生成する。`site:build` は現在この生成処理を実行する。

## SCR-001 公開サイト画面（実装済み）

- 入力：FN-001がcanonical CSVから生成した公開用JSON。
- 表示：`site/` のHTML・CSS・JavaScriptをブラウザで実行する。`site/app.js` が生成済みJSONを読み、ランキングと作詞 × 作曲の組み合わせ分析を表示する。
- ブラウザではCSVからランキングを集計せず、生成済みJSONを表示する。

## build・公開の運用

GitHub Actions が test、ランキング検証、FN-001のbuild、生成物の差分検査を行い、成功した `site/` を GitHub Pages へ公開する。この公開workflowはJOB-001 楽曲候補定期収集ジョブとは別の既存運用である。

## データの責務

`data/*.csv` が唯一の正本である。`site/data/rankings/*.json` は表示用の生成物であり、正本へ逆反映しない。現在の運用では生成物を CSV とともに管理し、公開前に再生成結果との一致を確認する。ブラウザはランキングを毎回集計せず、生成済み JSON を読む。

## 関連仕様

- [canonical CSV 仕様](../data-spec.md)
- [ランキング詳細仕様](../ranking-spec.md)
- [マイルストーン](../roadmap.md)
- [機能ID体系](../feature-ids.md)
