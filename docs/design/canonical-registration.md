# Canonical registration 基本設計（Milestone 3-B 概要）

## 目的

収集された候補を人間が確認し、確定した判断を整合性のある canonical CSV 変更につなげる。`staging/song-candidates.json` は候補と収集履歴であり、正本は `data/*.csv` である。

## 入力と出力

- 入力：staging の候補、現行 canonical CSV、および人間が確定する判断。
- 出力：3-B1 ではレビュー可能な情報、3-B2 では検証済みの canonical CSV への反映結果。

## 3-B の責務と段階

### 3-B1：review preparation

`song-candidates.json` と canonical CSV を参照し、反映に必要な情報を整理する。自動で分かる情報を補助し、同一 song/work、version、artist identity など人間の判断が必要な項目をレビュー可能な構造にする。この段階では canonical CSV を書き換えない。

### 3-B2：canonical apply

人間が確定した decision を入力として、整合性検証、必要な ID 採番、canonical CSV への反映を行う。途中失敗時は canonical CSV を部分更新しない。具体的な反映手順と安全性の確認方法は 3-B2 着手時に設計する。

## 3-C 管理画面との関係

将来の 3-C では、3-B1 の結果を認証付き管理画面に表示し、人間の判断結果を 3-B2 へ渡す。画面や server-side 処理の構成は現段階では確定しない。

review JSON と decision JSON の詳細 schema は、それぞれ 3-B1 / 3-B2 着手時に設計する。この文書では先に形式を固定しない。

## 関連仕様

- [canonical CSV 仕様](../data-spec.md)
- [候補収集基本設計](candidate-collector.md)
- [マイルストーン](../roadmap.md)
