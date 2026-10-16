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
| [canonical-registration.md](design/canonical-registration.md) | FN-003 / FN-004の全体フロー・責務、現行FN-003 | 詳細書の入口 | FN-003の実装済み説明を維持し、FN-004 Design 1〜4を以下へ分割 |
| [fn004-decision.md](design/fn004-decision.md) | FN-004 Decision Model | aggregate・revision・OCC・candidate binding・prefix | 判断モデルの正本 |
| [fn004-apply-plan.md](design/fn004-apply-plan.md) | FN-004 Apply Plan | immutable計画・precondition・予定ID | 計画モデルの正本 |
| [fn004-transaction.md](design/fn004-transaction.md) | FN-004 Validation / Transaction / Recovery | lock・journal・History・ID state・bootstrap | 実行/復旧契約の正本 |
| [fn004-bootstrap.md](design/fn004-bootstrap.md) | FN-004 Bootstrap / ID state | authoritative history・declaration・audit/genesis/state hash | 初期監査契約の正本 |
| [song-admin.md](design/song-admin.md) | FN-004のCLI/application service、SCR-002 | Approval・durable Request・内部view・操作契約 | UI/CLIが共有する境界を一か所で定義 |

Screen / Function / Jobごとの責務を維持し、FN-004の大きな設計は判断・計画・transaction・interfaceへ分割します。既存設計書のrenameや機能IDの変更は行いません。SCR-002の6 viewは一つの画面機能の内部構成であり、viewごとの正式Feature IDは追加しません。

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

- SCR-002 楽曲管理画面：6内部viewと共通serviceを設計済み。管理者backendが必要で、provider等は未選定。runtimeは未実装。
- FN-004 canonical反映機能：Decision → Plan → Approval → durable Request → Transaction → Historyの正式v1設計を上記文書で定義。既存参照・新規追加だけを対象にし、runtimeは未実装。FN-003のsuggestionや仮IDは確定入力ではない。
- JOB-001 楽曲候補定期収集ジョブ：FN-002を定期的に起動する。実装着手時に詳細設計書を追加し、実行環境やスケジュール等を決める。通知は含めず、必要になった場合はJOB-002等の別ジョブとして定義する。
