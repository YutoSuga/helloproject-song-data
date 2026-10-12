# 機能ID体系

## 命名と運用

| 接頭辞 | 種別 | 責務 | 例 |
| --- | --- | --- | --- |
| SCR- | Screen | 画面・UI | SCR-001 公開サイト画面 |
| FN- | Function | 画面やジョブから呼ばれるロジック | FN-003 レビュー準備機能 |
| JOB- | Job | 定期または手動で起動され、Functionを呼ぶジョブ・バッチ | JOB-001 楽曲候補定期収集ジョブ |

IDは種別ごとに3桁ゼロ埋めとします。設計・実装・PR・会話では `FN-003 レビュー準備機能` のようにIDと正式名を併記します。Milestone番号は開発順序・開発計画、機能IDはシステム上の機能識別子であり、別物です。1つのMilestoneが複数機能を扱うことや、同じ機能を複数Milestoneで拡張することがあります。

正式な機能一覧と実装状況は[README](../README.md#機能一覧)、開発計画との対応は[Roadmap](roadmap.md)に記載します。機能IDは `song_id`、`candidate_id` 等のデータ識別子やschemaを変更しません。

## 現行設計書の責務と整理判断

| 設計書 | 扱う機能 | 複数機能の混在 | 今回の分割・rename判断 |
| --- | --- | --- | --- |
| [public-site.md](design/public-site.md) | FN-001 公開サイトデータ生成機能、SCR-001 公開サイト画面 | 生成と表示の2機能。GitHub Pages公開手順も含む | 分割・rename不要。短い基本設計であり、2機能を章分けすると生成物を介した境界も一緒に確認できる |
| [candidate-collector.md](design/candidate-collector.md) | FN-002 楽曲候補収集機能。将来の呼出元としてJOB-001に言及 | 本体はFN-002のみ。JOB-001の詳細は含まない | 分割・rename不要。単一Functionの責務が明確 |
| [canonical-registration.md](design/canonical-registration.md) | FN-003 レビュー準備機能、FN-004 canonical反映機能。接点としてSCR-002に言及 | FN-003の詳細とFN-004の将来概要 | 統合設計書を維持。本文はFN-003が中心で、FN-004はdecision schemaも未設計。現時点の分割は概要だけの文書を増やすため、章分けで境界を示す |

最終的にはScreen / Function / Jobごとの責務が分かる構成を目指します。今回は機能IDを付ける目的だけのrenameは行いません。独立した詳細設計が必要になった時点で分割・追加し、READMEと関連文書のリンクを同時に更新します。

将来の構成例（現時点のファイル名ではありません）：

```text
docs/design/
├── SCR-001-public-site.md
├── SCR-002-admin.md
├── FN-001-site-data-generation.md
├── FN-002-candidate-collector.md
├── FN-003-review-preparation.md
├── FN-004-canonical-apply.md
└── JOB-001-candidate-collection.md
```

## 未実装機能の境界

- SCR-002 楽曲管理画面：candidate / reviewを確認し、人間が確定・保留・却下等を判断する。FN-003 / FN-004の呼出タイミングや事前生成済みJSONを読む方式はMilestone 3-Cの設計時に決める。
- FN-004 canonical反映機能：人間が確定したdecisionを検証し、canonical CSVへ安全に反映する。確定decision schema、ID採番、整合性検証、部分更新を残さない反映方式を次フェーズで設計する。FN-003のsuggestionや仮IDは確定入力ではない。
- JOB-001 楽曲候補定期収集ジョブ：FN-002を定期的に起動する。実装着手時に詳細設計書を追加し、実行環境やスケジュール等を決める。通知は含めず、必要になった場合はJOB-002等の別ジョブとして定義する。
