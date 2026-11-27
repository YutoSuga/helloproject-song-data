# 文書体系・目次

- `design/`：現在有効な正式設計書・仕様書。
- `design/screens/`：画面の責務と操作仕様。
- `management/`：継続的に更新する開発・運用管理文書。
- `history/`：固定SHA・日時に基づく調査、実装計画、受入記録。当時の記述が現在の仕様・実装と異なる可能性がある。

## 正本の参照ルール

| 対象 | 正本・参照先 |
| --- | --- |
| 楽曲データ | `data/*.csv` |
| データ構造・一般整合性 | [データ仕様](design/data/データ仕様.md) |
| 機能別schema・hash・安全契約 | 担当する正式設計書の契約節 |
| 現在の実装状況・開発順序 | [ロードマップ](management/ロードマップ.md) |
| 操作手順 | [CSV直接編集ガイド](management/CSV直接編集ガイド.md)。旧FN-004ガイドは保存版 |
| CI挙動 | [workflow](../.github/workflows/deploy-pages.yml)・[ID比較境界](../.github/scripts/id-ci-base.cjs)。説明は[CI運用ルール](../.github/CI.md) |
| 過去の判断・受入結果 | 固定SHA・日時付き履歴。判定はその対象・時点で読む |

設計契約と実装の不一致は、履歴やロードマップで暗黙に上書きせず、個別に確認する。

## 正式設計書

### システム・共通設計

- [CSV直接編集・現行システム簡素化](design/system/CSV直接編集・現行システム簡素化.md)（PR #113で実装済み）

- [システム構成](design/system/システム構成.md)
- [レビュー準備・canonical反映の全体フロー](design/system/レビュー準備・canonical反映の全体フロー.md)
- [楽曲管理のアプリケーションサービス・CLI契約](design/system/楽曲管理のアプリケーションサービス・CLI契約.md)
- [機能ID体系](design/system/機能ID体系.md)

- [公開サイトデータ生成・ビルド仕様](design/system/公開サイトデータ生成・ビルド仕様.md)（FN番号なしの共通運用）

### データ仕様

- [データ仕様](design/data/データ仕様.md)

### 機能設計

- [FN-001-ランキング集計仕様](design/functions/FN-001-ランキング集計仕様.md)
- [FN-002-楽曲候補収集](design/functions/FN-002-楽曲候補収集.md)
- [FN-002-楽曲候補収集仕様](design/functions/FN-002-楽曲候補収集仕様.md)
- [FN-003-レビュー準備](design/functions/FN-003-レビュー準備.md)
- [FN-004 全体処理設計・APIリファレンス](design/functions/FN-004/00-全体処理設計・APIリファレンス.md)
- [FN-004-Gate公開契約](design/functions/FN-004/60-Gate公開契約.md)
- [FN-004-初期化・ID状態](design/functions/FN-004/50-初期化・ID状態.md)
- [FN-004-判断モデル](design/functions/FN-004/10-判断モデル.md)
- [FN-004-反映処理・復旧](design/functions/FN-004/40-反映処理・復旧.md)
- [FN-004-反映計画](design/functions/FN-004/20-反映計画.md)
- [FN-004-成功履歴・読取検証](design/functions/FN-004/70-成功履歴・読取検証.md)
- [FN-004-承認・反映リクエスト](design/functions/FN-004/30-承認・反映リクエスト.md)
- [FN-005-楽曲一覧データ生成](design/functions/FN-005-楽曲一覧データ生成.md)（設計のみ）

### 画面設計

- [公開サイト画面一覧・遷移](design/screens/画面一覧.md)
- [画面設計書テンプレート](design/screens/画面設計書テンプレート.md)
- [設計レビュー用HTMLモック・確認方法](design/screens/mockups/README.md)

- [公開サイト共通設計](design/screens/公開サイト共通設計.md)（現行の表示・生成JSONとの境界）
- [公開サイトの画面番号](design/system/機能ID体系.md#公開サイトの画面番号)（今後の画面構成）
- [SCR-101-楽曲管理画面](design/screens/SCR-101-楽曲管理画面.md)（設計済み・未実装）

## 継続管理文書

- [CSV直接編集ガイド](management/CSV直接編集ガイド.md)

- [FN-004-canonical操作ガイド](management/FN-004-canonical操作ガイド.md)
- [ロードマップ](management/ロードマップ.md)
- [開発・PR運用ルール](management/開発・PR運用ルール.md)

## 履歴

- [調査記録](history/research/)：横断データ3文書は2026-11-04時点の調査。
- [計画・実装記録](history/plans/)：承認時の参照先を含む [FA-M01 Gate 契約案の固定版](https://github.com/YutoSuga/helloproject-song-data/blob/dc93832d1ac1ce291fd33337b7de9c64e21b57cb/docs/history/plans/FN-004-FA-M01-Gate公開契約案.md)。現行の契約は [FN-004 Gate公開契約](design/functions/FN-004/60-Gate公開契約.md)を参照。
- [受入・レビュー記録と証拠の索引](history/reviews/README.md)：報告書と [証拠 archive](history/reviews/archive/) を `history/reviews/` にまとめて保管する。固定 SHA と当時のパスで行う再現手順は索引を参照。
