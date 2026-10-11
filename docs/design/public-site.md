# 公開サイト 基本設計

## 目的

canonical CSV から作家ランキングと根拠データを集計し、静的な公開サイトで表示する。現在の公開対象は Juice=Juice（`G00001`）で、集計処理は指定した `artist_id` を受け取れる。

## 入力と出力

- 入力：`data/*.csv` のうち集計に必要な artist、song、work、creator とその関連 CSV。
- 出力：`site/data/rankings/G00001.json` などのランキング JSON、および `site/` の HTML・CSS・JavaScript とあわせて公開するサイト。

## 主な処理フロー

1. `src/canonical.js` が canonical CSV を読み込む。
2. `src/rankings.js` が指定 artist の primary song、work、creator credit を集計する。
3. `scripts/generate-rankings.js` がランキング JSON を生成する。`site:build` は現在この生成処理を実行する。
4. `site/app.js` が生成済み JSON を読み、ランキングと作詞 × 作曲の組み合わせ分析を表示する。
5. GitHub Actions が test、ランキング検証、build、生成物の差分検査を行い、成功した `site/` を GitHub Pages へ公開する。

## データの責務

`data/*.csv` が唯一の正本である。`site/data/rankings/*.json` は表示用の生成物であり、正本へ逆反映しない。現在の運用では生成物を CSV とともに管理し、公開前に再生成結果との一致を確認する。ブラウザはランキングを毎回集計せず、生成済み JSON を読む。

## 関連仕様

- [canonical CSV 仕様](../data-spec.md)
- [ランキング詳細仕様](../ranking-spec.md)
- [マイルストーン](../roadmap.md)
