# 文書体系・目次

- `design/`：現在有効な正式設計書・仕様書。
- `management/`：継続的に更新する開発・運用管理文書。
- `history/`：固定SHA・日時に基づく調査、実装計画、受入記録。当時の記述が現在の仕様・実装と異なる可能性がある。

## 正本の参照ルール

| 対象 | 正本・参照先 |
| --- | --- |
| 楽曲データ | `data/*.csv` |
| データ構造・一般整合性 | [データ仕様](design/data/データ仕様.md) |
| 機能別schema・hash・安全契約 | 担当する正式設計書の契約節 |
| 現在の実装状況・開発順序 | [ロードマップ](management/ロードマップ.md) |
| 操作手順 | [canonical操作ガイド](management/FN-004-canonical操作ガイド.md) |
| CI挙動 | [workflow](../.github/workflows/deploy-pages.yml)・[CI選択処理](../.github/scripts/ci-policy.cjs)。説明は[CI運用ルール](../.github/CI.md) |
| 過去の判断・受入結果 | 固定SHA・日時付き履歴。判定はその対象・時点で読む |

設計契約と実装の不一致は、履歴やロードマップで暗黙に上書きせず、個別に確認する。

## 正式設計書

### システム・共通設計

- [システム構成](design/system/システム構成.md)
- [レビュー準備・canonical反映の全体フロー](design/system/レビュー準備・canonical反映の全体フロー.md)
- [楽曲管理のCLI・画面連携](design/system/楽曲管理のCLI・画面連携.md)
- [機能ID体系](design/system/機能ID体系.md)

### データ仕様

- [データ仕様](design/data/データ仕様.md)

### 機能設計

- [FN-001-ランキング集計仕様](design/functions/FN-001-ランキング集計仕様.md)
- [FN-002-楽曲候補収集](design/functions/FN-002-楽曲候補収集.md)
- [FN-002-楽曲候補収集仕様](design/functions/FN-002-楽曲候補収集仕様.md)
- [FN-004-初期化・ID状態](design/functions/FN-004-初期化・ID状態.md)
- [FN-004-判断モデル](design/functions/FN-004-判断モデル.md)
- [FN-004-反映処理・復旧](design/functions/FN-004-反映処理・復旧.md)
- [FN-004-反映計画](design/functions/FN-004-反映計画.md)
- [FN-004-成功履歴・読取検証](design/functions/FN-004-成功履歴・読取検証.md)
- [FN-004-承認・反映リクエスト](design/functions/FN-004-承認・反映リクエスト.md)
- [公開サイトのデータ生成・表示](design/functions/公開サイトのデータ生成・表示.md)

## 継続管理文書

- [FN-004-canonical操作ガイド](management/FN-004-canonical操作ガイド.md)
- [ロードマップ](management/ロードマップ.md)
- [開発・PR運用ルール](management/開発・PR運用ルール.md)

## 履歴

- [調査記録](history/research/)：横断データ3文書は2026-11-04の固定mainに基づく補助調査であり、現在の正式データ仕様ではない。
- [計画・実装記録](history/plans/)：[FA-M01 Gate変更の根拠・承認記録](history/plans/FN-004-FA-M01-Gate公開契約案.md)を含む。既存設計が指定する採用済み条項・適用範囲はB1で変更しない。
- [受入・レビュー記録](history/reviews/)：初回判定、再受入、findingのクローズ記録を別々に保持する。

### 証拠archiveの配置と再現性

[証拠archive](reviews/archive/)は旧配置`docs/reviews/archive/`に保持する。provenanceの保存先、旧パスを前提とする検証スクリプト、原本の相対配置を維持するための例外であり、現在の正式設計を置く場所ではない。内部ファイルは編集しない。

archiveのSHA256SUMSは各manifestの親ディレクトリで検証する。bundleはprovenanceのprerequisite commitを持つrepositoryで検証し、原本は記録されたcommit・pathから取り出す。たとえばFA-L01の`check.py`は記録対象merge `4fa7907fb54deec77ebfe6618a73fb2f720dab88`のcheckoutで実行するもので、新HEAD用の検証ではない。原本のhash・保存先は当時の固定SHAに対する証拠として読む。

## B1の暫定配置・後続作業

以下はB1で分割せず、本文を維持した暫定配置である。

- [公開サイトのデータ生成・表示](design/functions/公開サイトのデータ生成・表示.md)：B2でFN-001とSCR-001を分割。
- [レビュー準備・canonical反映の全体フロー](design/system/レビュー準備・canonical反映の全体フロー.md)：B2でFN-003詳細と全体フローを分割。
- [楽曲管理のCLI・画面連携](design/system/楽曲管理のCLI・画面連携.md)：B2でSCR-002画面と共通application service・CLI契約を分割。

B2でGate変更の採用条項を承認・実装・テストと照合して正式仕様へ抽出する。B3で古い進捗注記・表記・日本語化を整理する。既存設計書内の過去の構成例やrename判断はB1では書き換えていない。現在の配置は本目次を参照する。screens/・jobs/は対応する独立設計書の作成時に追加する。

旧パスの一律の案内ファイルは置かない。現行参照は新パスへ更新し、過去PR・固定SHA参照は維持する。旧mainパスへの外部リンクは切れる可能性があるため、この目次から辿るか、当時の固定SHAで参照する。
