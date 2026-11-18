# 機能ID体系

## 命名と運用

| 接頭辞 | 種別 | 責務 | 例 |
| --- | --- | --- | --- |
| SCR- | Screen | 画面・UI | SCR-001 公開サイト画面 |
| FN- | Function | 画面やジョブから呼ばれるロジック | FN-003 レビュー準備機能 |
| JOB- | Job | 定期または手動で起動され、Functionを呼ぶジョブ・バッチ | JOB-001 楽曲候補定期収集ジョブ |

IDは種別ごとに3桁ゼロ埋めとします。設計・実装・PR・会話では `FN-003 レビュー準備機能` のようにIDと正式名を併記します。Milestone番号は開発順序・開発計画、機能IDはシステム上の機能識別子であり、別物です。1つのMilestoneが複数機能を扱うことや、同じ機能を複数Milestoneで拡張することがあります。

正式な機能一覧と実装状況は[README](../../../README.md#機能一覧)、開発計画との対応は[Roadmap](../../management/ロードマップ.md)に記載します。機能IDは `song_id`、`candidate_id` 等のデータ識別子やschemaを変更しません。

## 機能IDと正式設計書

| ID | 設計書・責務 |
| --- | --- |
| FN-001 | [公開データ生成](../functions/FN-001-公開サイトデータ生成.md)と[ランキング集計](../functions/FN-001-ランキング集計仕様.md) |
| FN-002 | [楽曲候補収集](../functions/FN-002-楽曲候補収集.md)と[詳細仕様](../functions/FN-002-楽曲候補収集仕様.md) |
| FN-003 | [レビュー準備](../functions/FN-003-レビュー準備.md)と[全体フロー](レビュー準備・canonical反映の全体フロー.md) |
| FN-004 | [判断モデル](../functions/FN-004-判断モデル.md)、[反映計画](../functions/FN-004-反映計画.md)、[承認・反映リクエスト](../functions/FN-004-承認・反映リクエスト.md)、[Gate公開](../functions/FN-004-Gate公開契約.md)、[反映処理・復旧](../functions/FN-004-反映処理・復旧.md)、[成功履歴・読取検証](../functions/FN-004-成功履歴・読取検証.md)、[初期化・ID状態](../functions/FN-004-初期化・ID状態.md)、[共通サービス・CLI](楽曲管理のアプリケーションサービス・CLI契約.md) |
| SCR-001 | [公開サイト画面](../screens/SCR-001-公開サイト画面.md) |
| SCR-002 | [楽曲管理画面](../screens/SCR-002-楽曲管理画面.md)。6 view は一つの画面機能の内部構成 |
| JOB-001 | [FN-002 との呼出境界](../functions/FN-002-楽曲候補収集.md)。詳細設計書は着手時に追加 |

## 提供範囲と将来の接続

- SCR-002 楽曲管理画面：6内部viewと共通serviceを設計済み。管理者backendが必要で、provider等は未選定。runtimeは未実装。
- FN-004 canonical反映機能：Decision → Plan → Approval → durable Request → Transaction → Historyの正式v1設計を上記文書で定義。既存参照・新規追加を対象とする runtime と公開 CLI は実装済み。FN-003のsuggestionや仮IDは確定入力ではない。
- JOB-001 楽曲候補定期収集ジョブ：FN-002を定期的に起動する。実装着手時に詳細設計書を追加し、実行環境やスケジュール等を決める。通知は含めず、必要になった場合はJOB-002等の別ジョブとして定義する。
