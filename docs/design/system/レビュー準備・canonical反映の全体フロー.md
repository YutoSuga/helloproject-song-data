# Canonical registration 基本設計（FN-003 / FN-004、Milestone 3-B）

> 2026-11-25 運用切替：現行はCSV直接編集を基本とし、FN-002/003は任意です。以下のDecision/Plan/Approval/Apply経路は保存版の説明です。

## 目的・境界

楽曲データの正本は `data/*.csv`。FN-002 が候補を収集し、[FN-003](../functions/FN-003-レビュー準備.md) がレビュー用派生 JSON を生成する。FN-004 は正式な人間の判断から canonical を安全に反映する。FN-004 の runtime・公開 CLI は実装済みで、SCR-101 と管理者向け Web backend は設計段階にある。既存 canonical 登録済み candidate の初期移行は対象外。

本書は全体フローと責務の境界を示す。Design 1〜4を横断統合した詳細は、[Decision Model](../functions/FN-004/10-判断モデル.md)、[Apply Plan](../functions/FN-004/20-反映計画.md)、[Transaction / Recovery](../functions/FN-004/40-反映処理・復旧.md)、[Bootstrap / ID state](../functions/FN-004/50-初期化・ID状態.md)、[History readonly contract](../functions/FN-004/70-成功履歴・読取検証.md)、[共通サービス・CLI](楽曲管理のアプリケーションサービス・CLI契約.md)へ分割する。Decision / Plan / Historyのschema・hash projection・orderingは各文書の完全なversioned契約を正とする。Approval / Request / Receiptの完全schemaとhashは[Approval / Request Hash Contract](../functions/FN-004/30-承認・反映リクエスト.md)を正とする。

## FN-003 / FN-004の関係

```text
staging/song-candidates.json（FN-002の出力）
  + data/*.csv（canonical）
  + staging/review-results.json（過去の人間判断。不在時は空）
  ↓
FN-003 レビュー準備機能（実装済み）
  ↓
staging/song-reviews.json
  ↓
人間レビュー（将来のSCR-101 楽曲管理画面）
  ↓
Decision draft → confirmed revision（人間のidentity判断）
  ↓
FN-004：immutable Apply Plan → Approval（同Plan hashを承認）
  ↓
durable Apply Request（request_id）→ Transaction
  ↓
data/*.csv（canonical）
  ↓ 全体検証・成功確定後
successful Apply History
```

図のTransactionがcanonicalを変更し、成功Historyが結果を記録する。Decision確定・Plan生成・Approval・Request受付だけではCSVを変更しない。SCR-101はreview表示、判断確認、明示的Plan生成、反映確認、結果確認を共通application service経由で行う。現行FN-003の派生JSONを取得・再生成するadapterの技術方式は実装段階で決める。

## staging の責務

```text
staging/
├── song-candidates.json   FN-002が保持する公式source事実、candidate_id、収集情報・履歴
├── song-reviews.json      FN-003が毎回再生成するレビュー用派生データ
└── review-results.json    現行FN-003のlegacy過去判断入力（正式Decisionではない）
```

legacy 入力の読取・検査は [FN-003](../functions/FN-003-レビュー準備.md#staging-と-legacy-入力) に従う。legacy 結果・提案・仮 ID は正式な判断に自動昇格しない。

## FN-004 canonical反映機能（CLI実装済み）

FN-004 は [Decision Model](../functions/FN-004/10-判断モデル.md) の有効 confirmed revision を検証し、ID 採番と canonical CSV への安全な反映を行う。状態遷移と失敗時の許容状態は [Transaction / Recovery](../functions/FN-004/40-反映処理・復旧.md) に従う。将来の正式 Decision/History 表示でも legacy 入力との区別を維持する。

### 責務とGit管理

| データ | 責務 / 保存先 | Git |
| --- | --- | --- |
| Candidate | 公式観測facts。song-candidates.json | 管理 |
| Review | derived / rebuildableな提案。song-reviews.json | 正本にしない。現mainに出力なし |
| Decision | 人間のidentity判断。decisions.jsonのimmutable revisions | 管理 |
| Apply Plan | 具体的変更計画。apply-plans/ | derived、原則非管理 |
| Approval | 具体的Plan hashへの承認。apply-approvals/ | 管理。人間行為を追跡 |
| Apply Request | 同じ実行要求のdurable受付。apply-requests/ | 非管理。local実行/再送情報、未完了は保持 |
| Transaction Journal | 実行途中・失敗・復旧。transactions/ | 非管理。未完了は保持 |
| Apply History | 正常適用結果。apply-history/ | 管理。失敗は含めない |
| Terminal state proof | 失敗消費を含む検証可能な終端証跡。transaction-proofs/。完全schemaは[Transaction](../functions/FN-004/40-反映処理・復旧.md) | 管理。成功Historyとは別、v1 GCなし |
| ID / repository state | high-water mark、成功head。fn004-state.json | 管理。採番・履歴整合に必須 |
| Bootstrap | [監査・genesis・completion marker](../functions/FN-004/50-初期化・ID状態.md)。fn004-bootstrap.json | 管理。未初期化と消失を区別 |
| lock / temp / backup | 排他・一時生成・復元根拠 | 非管理。recovery前に削除しない |

canonical以外は楽曲正本ではない。Git非管理とdurability不要を混同しない。requestが失われてもHistoryのrequest/Decision coverageから適用済みを検出し、不明ならSTOPする。上記の保存先は staging/ 配下。

### v1 scope

existing work＋existing song、existing work＋new song、new work＋new song、existing/new creator・artist・release、song_artists / song_creators / song_performers / release_tracksの追加を扱う。memberはexistingのみ。公式発表済みfuture releaseを許可する。reuse/no_opだけでも承認・Request・transaction・成功Historyを通す。

existing master/relationのfield update/patch/delete、work/song統合・分割・work付け替え、canonical correction、new member、member_affiliations変更、video関連、candidate初期migration、aggregate部分適用、rollback commandによる過去成功の取消し、自動Git操作、JOB/notificationはv1対象外。data-specが一般運用として許す訂正までFN-004が実行可能とは意味しない。失敗transactionを元へ復元する内部rollbackは必要な安全機構として含む。

### 横断レビューの確定事項

| 論点 | 統合した契約 / 詳細の正本 |
| --- | --- |
| revision / OCC / prefix | Decisionへ明示保存。draftと有効confirmedを分離。[Decision](../functions/FN-004/10-判断モデル.md) |
| Plan hash / ID | 全preconditionとrowをhashし、予定IDは未予約。[Plan](../functions/FN-004/20-反映計画.md) |
| Approvalとreceipt | 承認全体hash → exact Plan/Approvalを参照するcommand hash → version/receipt hashでbinding。承認後、journal前にdurable受付。[Hash Contract](../functions/FN-004/30-承認・反映リクエスト.md) / [Interface](楽曲管理のアプリケーションサービス・CLI契約.md) |
| 二重送信・受付中断 | 同ID同payloadは照会のみ。未完了receiptは新規受付を止める。未開始を証明できる場合だけABORTED |
| 成功境界 | COMMIT_DECIDED前は原則rollback、後はforward finalize。[Transaction](../functions/FN-004/40-反映処理・復旧.md) |
| 採番・rollback | Planで予約せず、commit開始で消費、復元後も上限不減 |
| trace | Decision → Plan → Approval → Request → Transaction → History → actual IDs |
| UI結果 | committedとreadinessを分け、pending finalizationを再Applyへ誘導しない |
| 実装順 | schema/service/CLIを先にし、recovery検証後に実Apply公開。[Interfaceのslice](楽曲管理のアプリケーションサービス・CLI契約.md) |

Slice 4前のSTOP項目（Decision完全schema/content hash、Plan operation/registry、History readonly proof）は各専用文書で確定する。JSON Schema実装やbackend/認証provider等の技術選定は実装sliceで行うが、本書群の不変条件に従う。実装PR数は固定せず、review/test可能な分割を行う。

## SCR-101 楽曲管理画面との接点（Milestone 3-C、未実装）

SCR-101は一つの正式Feature IDのまま、管理一覧・レビュー編集・Decision確認・Apply Preflight・Apply結果・System Statusを内部viewとする。[画面設計](../screens/SCR-101-楽曲管理画面.md)と[共通サービス・CLI契約](楽曲管理のアプリケーションサービス・CLI契約.md)を参照する。v1のbootstrap/recovery実行はCLIのみ。browserからfilesystem/Gitへ直接書かず、認証済み管理者backendを必要とする。providerやhosting方式は別途選定する。JOB-001や通知は今回実装しない。

## 関連仕様

- [canonical CSV 仕様](../data/データ仕様.md)
- [候補収集基本設計](../functions/FN-002-楽曲候補収集.md)
- [マイルストーン](../../management/ロードマップ.md)
- [機能ID体系](機能ID体系.md)
