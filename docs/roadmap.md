# Hello! Project Song Data Roadmap

Last updated: 2026-10-29

Current phase: Milestone 3-B2 / FN-004 canonical反映機能 — Slice 5（Approval / Apply Request）の実装・修正・最終レビュー中。

本書は、2026-10-29時点の進捗と直近の開発ペースを前提にした、人間判断によるplanning estimateです。期日までの完成を約束するcommitmentやdeadlineではありません。標準完成目標は**2027年3月のMilestone 3完成（日常運用可能な管理基盤の完成）**です。設計変更、独立レビューでのSTOP、追加Follow-up、外部サービス選定などで時期は変動します。

設計のSource of Truthは[機能ID体系](feature-ids.md)と各正式設計書です。本書は計画・見積もりを確認するliving documentであり、formal design contractを変更しません。

## 基準日時点の現在地と根拠

- 確認したmain: `c200c1c95e6daf0dba060a26c7d29aa2368bceb8`。FN-002 楽曲候補収集機能、FN-003 レビュー準備機能、FN-001 公開サイトデータ生成機能、SCR-001 公開サイト画面は実装済み。
- FN-004はSlice 1〜3（schema / repository / bootstrap）、Slice 4（Decision / Apply Plan）とHistory readonlyがmainへ反映済み。Slice 5は終盤で、Approval / Apply Requestの実装・修正・最終レビュー中。Transaction / Recovery・実Apply入口は未完成。
- 基準日時点の参考情報：[PR #68](https://github.com/YutoSuga/helloproject-song-data/pull/68)はOPEN。mainには[Request response契約](design/fn004-approval-request.md#apply-request-application-response-contract-v1)のfollow-upもmerge済みで、未mergeの実装は正式契約への追従・レビューを経て完了とする。OPENは完了を意味しない。
- 確認資料：[README](../README.md)、[機能ID体系](feature-ids.md)、[候補収集](design/candidate-collector.md)、[公開サイト](design/public-site.md)、[canonical registration](design/canonical-registration.md)、[Decision](design/fn004-decision.md)、[Apply Plan](design/fn004-apply-plan.md)、[Approval / Request](design/fn004-approval-request.md)、[Transaction / Recovery](design/fn004-transaction.md)、[History readonly](design/fn004-history.md)、[Bootstrap](design/fn004-bootstrap.md)、[CLI / SCR-002](design/song-admin.md)。正式設計書やREADMEに残る「runtime未実装」は初期設計時の記載であり、上記の部分実装とFN-004全体の完成を区別する。

## メインロードマップ（計画値）

Milestone 3の正式名称は「他Hello! Projectグループへの展開」。3-Bは3-B0 / 3-B1 / 3-B2からなり、残るFN-004完成でレビューからcanonical反映までの人間確認フローを揃える。

| 時期 | マイルストーン | 到達状態 |
| --- | --- | --- |
| 2026年10月末〜11月上旬 | FN-004 Slice 5 完了 | Approval / Apply Request周辺の実装・修正・最終レビュー・merge |
| 2026年11月前半〜中旬 | FN-004 Slice 6 設計・実装（計画上の呼称） | Transaction / journal / commit処理を中心に実装 |
| 2026年11月中旬〜下旬 | FN-004 Recovery系 | 中断・失敗時の安全な復旧まで完成 |
| 2026年11月末〜12月上旬 | FN-004 canonical反映機能 完成 | Decision → Apply Plan → Approval → Request → canonical反映が一連で動作。History・CLI統合と障害試験を含む |
| 2026年12月前半 | Milestone 3-B 完了 | レビューからcanonical反映までの人間確認フローが完成 |
| 2026年12月中旬 | SCR-002 楽曲管理画面 設計 | 既存interface設計を前提に管理画面・Backend/API・認証・デプロイ構成を決定 |
| 2026年12月後半〜2027年1月 | SCR-002 楽曲管理画面 実装 | ブラウザから候補確認・Decision・反映操作を行える状態 |
| 2027年1月末ごろ | Milestone 3-C 完了 | CLI中心から管理画面中心の通常運用へ移行 |
| 2027年2月前半 | JOB-001 楽曲候補定期収集ジョブ 実装 | FN-002を定期実行できる状態 |
| 2027年2月中旬〜下旬 | Milestone 3-D 完了 | 楽曲候補収集の自動化が完成 |
| 2027年2月〜3月 | Milestone 3 全体安定化 | 実運用テスト・不具合修正・不足機能調整 |
| 2027年3月ごろ | Milestone 3 全体完成目標 | 自動収集 → 管理画面で確認 → canonical反映 → 公開サイト更新が一連で動く |

正式な[実装順](design/song-admin.md#実装順・検証)はSlice 5後のslice / PR数を固定していない。「Slice 6」は本計画のTransaction着手フェーズの呼称で、契約上の番号追加ではない。実Apply公開はRecovery・障害試験・CLI統合の検証後とする。FN-004完成から3-B完了までの期間はフロー全体の確認を想定する。

## 3パターンの完成見込み

| ケース | FN-004 canonical反映機能 | SCR-002 楽曲管理画面 | JOB-001を含むMilestone 3完成 |
| --- | --- | --- | --- |
| 順調 | 2026年11月末 | 2027年1月中旬 | 2027年2月 |
| 標準予想 | 2026年12月上旬 | 2027年1月末 | 2027年3月 |
| STOP・設計変更多め | 2026年12月末 | 2027年2〜3月 | 2027年4〜5月 |

中心的な見積もりは**2027年3月**。各ケースはplanning estimateでありdeadlineではない。メイン表は標準予想を軸にし、安定化は先行して進められる範囲から行う。

## フェーズの流れ

```text
現在：FN-004 Slice 5（実装・修正・最終レビュー）
  ↓ Transaction / Recovery（History・CLI統合・障害試験を含む）
FN-004 完成 → Milestone 3-B 完了
  ↓ SCR-002 Architecture / Design → SCR-002 実装
Milestone 3-C 完了
  ↓ JOB-001 → Milestone 3-D 完了
Milestone 3 安定化
  ↓
日常運用可能な管理基盤の完成
```

## SCR-002：Web管理画面へのArchitecture milestone

現在はCLI / file中心で、以下の責務を順に構築している（FN-004全体は未完成）。

```text
official source → FN-002 → song-candidates → FN-003
  → human review / Decision → FN-004 → canonical CSV
  → FN-001 → SCR-001 public site
```

SCR-002以降の想定は次の役割分担となる。

```text
SCR-002 admin UI → authenticated Backend / API
  → FN-003 / Decision / FN-004（CLIと共通のapplication service）
  → canonical CSV
```

既存の6内部view・共通service境界を基礎に、Web管理画面中心へ移行する大きなArchitecture milestoneとなる。Backend技術、API方式、認証provider / session、hosting / deployment方式は未決定で、2026年12月の設計で選定する。browserがGitHub tokenやCSV・lock・journalを直接操作する構成にはしない。SCR-001は静的公開を維持し、bootstrap / recovery実行はv1ではCLIのみとするため、通常運用の管理画面化と障害復旧のCLI運用は両立する。

## JOB-001後の運用イメージ

基本思想は**「収集は自動化、確定は人間」**。

```text
JOB-001の定期実行 → FN-002 candidate collection
  → FN-003によるレビュー準備 → SCR-002で人間確認 → Decision
  → FN-004 canonical apply（Plan / Approval / Request / Transaction）
  → canonical data → FN-001 → SCR-001 public site
```

JOB-001はFN-002を起動し、判断・canonical反映を自動確定しない。通知は対象外。Apply後のdiff確認・validation・site build・通常commit / push / PRはTransaction外の既存運用を維持し、この図は全工程の無人実行を意味しない。

## 「完成」の定義

2027年3月の目標はMilestone 3完成、すなわち日常運用可能な管理基盤の完成を意味する。

- 候補収集を自動化できる。
- 人間が管理画面で候補を確認し、Decisionを安全に作成できる。
- FN-004でcanonicalへ安全に反映できる。
- canonicalから公開サイトを更新できる。
- 通常運用を管理画面中心で行える。

その後もデータ拡充、UX改善、新機能、追加分析、新しいofficial source対応、保守などの継続開発を行い得る。Milestone 4や将来拡張までの完了をこの目標には含めない。

## 見積もりの変動要因

独立レビューでのSTOP / finding、Design Follow-up、Transaction / Recoveryの複雑度、SCR-002 Architecture、Backend/API方式、認証方式、hosting/deployment方式、実運用で見つかる追加要件によって変動する。特にSCR-002はこれまでのCLI中心開発より不確定要素が大きく、見積もり幅が広がるポイントとなる。

## 更新方針

固定日程ではなくliving documentとして扱う。FN-004完成時、Milestone 3-B完了時、SCR-002 Architecture確定時、Milestone 3-C完了時、JOB-001完成時などに、Last updated / Current phase、実績、残りの見積もり、3ケースの前提を更新する。設計判断は正式docsへ記録し、本書ではその参照と計画への影響を更新する。

以下は既存の機能単位のMilestone構成と将来拡張。日付付き見積もりと合わせて参照する。

Milestoneは開発順序・開発計画、SCR / FN / JOBはシステム上の機能識別子です。設計・実装・PR・会話ではIDと正式機能名を併記します。命名ルールは[機能ID体系](feature-ids.md)、正式な機能一覧は[README](../README.md#機能一覧)を参照してください。

## Milestoneと機能IDの対応

| Milestone | 対応する機能 | 状況 |
| --- | --- | --- |
| 公開サイトの初期実装 / 1 / 2 | FN-001 公開サイトデータ生成機能、SCR-001 公開サイト画面 | 実装済み。1・2で集計と表示を拡張 |
| 3-A / 3-A Follow-up | FN-002 楽曲候補収集機能 | 完了 / 実装済み |
| 3-B0 | 文書・構成の整理（独立した機能IDなし） | 完了 |
| 3-B1 | FN-003 レビュー準備機能 | 完了 / 実装済み |
| 3-B2 | FN-004 canonical反映機能 | 正式v1設計あり / Slice 4までmain反映済み、Slice 5レビュー中 |
| 3-C | SCR-002 楽曲管理画面 | interface・6内部view設計済み / runtime未実装 |
| 3-D | JOB-001 楽曲候補定期収集ジョブ | 予定 / 未実装。FN-002を定期起動 |

通知はJOB-001に含めません。必要になった場合はJOB-002等の別ジョブとして定義し、開発計画への追加もその時点で検討します。未確定の将来拡張には今回IDを割り当てません。

## 現在

公開サイト系はJuice=Juice（`G00001`）を対象に、FN-001 公開サイトデータ生成機能とSCR-001 公開サイト画面で以下を実装済みです。

- CSVによる正本データ管理
- 作詞ランキング
- 作曲ランキング
- 作詞・作曲ランキング
- 編曲ランキング
- 作詞 × 作曲 組み合わせ分析
- GitHub Pagesでのランキング表示

## Milestone 1：ランキングカテゴリ拡張

対象：FN-001 公開サイトデータ生成機能 / SCR-001 公開サイト画面。

実装済み。ランキングJSONの既存カテゴリ構成を維持したまま、通常ランキングを5カテゴリへ拡張しました。

今回の実装内容は以下のとおりです。

- 現在の「作詞・作曲」を「作詞 & 作曲」へ表示名変更
- 「作詞 or 作曲」ランキングを追加

カテゴリIDは既存の `lyrics_composition` を維持し、新カテゴリには `lyrics_or_composition` を使用します。対象artist、primary song、work単位の重複排除、competition rankingの既存仕様も維持します。

「作詞 & 作曲」は、同じcreatorが同じ具体的な`song_id`上で作詞と作曲の両方を担当している場合を対象とします。

「作詞 or 作曲」は、同一workについて作詞または作曲を担当していれば1作品として数えます。同じcreatorが作詞・作曲の両方を担当していても2件にはしません。

## Milestone 2：作詞 × 作曲 組み合わせ分析

対象：FN-001 公開サイトデータ生成機能 / SCR-001 公開サイト画面。

実装済み。通常のランキングカテゴリとは別の分析機能として、以下を追加しました。

- 作詞者 × 作曲者の組み合わせランキング
- 同一人物による作詞・作曲の組み合わせも対象
- 共同作詞・共同作曲は全組み合わせを対象
- 同じwork・同じ組み合わせはバージョン違いでも重複カウントしない
- 組み合わせは同じ具体的な`song_id`上のcreditから生成する
- 別version間の作詞者と作曲者を組み合わせない

表示機能として、以下を追加しました。

- 全組み合わせランキング
- 特定Creatorを作詞者として選択し、組んだ作曲者を表示
- 特定Creatorを作曲者として選択し、組んだ作詞者を表示
- 自作詞・自作曲作品数

指定artistがprimaryのsongのみを対象とし、pairごとのwork数と根拠songを派生JSONへ保存します。全組み合わせ・Creator起点の両方向ともcompetition rankingで表示します。詳細は[集計仕様](ranking-spec.md)を参照してください。

## Milestone 3：他Hello! Projectグループへの展開

3-A と 3-A Follow-up は完了。FN-002 楽曲候補収集機能はモーニング娘。、アンジュルム、Juice=Juice、つばきファクトリー、BEYOOOOONDS、OCHA NORMA、ロージークロニクルの主要7グループに対応し、実サイトで全対象 artist の収集に成功した。FN-001のランキング処理は特定の `artist_id` をハードコードせず、指定して集計できる構成を維持する。3-B1 / FN-003は完了しており、次フェーズは3-B2 / FN-004 canonical反映機能とする。

- **3-A / FN-002 楽曲候補収集機能（完了）**：公式 release 一覧・詳細から音声トラックを収集し、正本 CSV と参考照合して `staging/song-candidates.json` に保存する。人間の status と notes を再実行時も保持する。詳細は[収集仕様](collection-spec.md)。手動CLIはFN-002の入口であり、定期起動のJOB-001は未実装。
- **3-A Follow-up / FN-002 複数artist収集（完了）**：通常運用は設定済み7グループ全体、個別確認は `--artist <slug>` を使用する。全選択 artist の成功後だけ共通 staging を一度保存し、途中失敗時は更新しない。旧名義・関連ユニットは source と実名義を区別して保持し、artist identity を自動統合しない。
- **3-B0 structure / docs refresh（完了）**：現行構造、実装機能、データフローを README と基本設計に反映し、3-B1 / 3-B2 の入口を整理した。
- **3-B1 / FN-003 レビュー準備機能（完了）**：候補と正本 CSV、過去レビューを照合し、自動で分かる情報と人間判断が必要な項目を `staging/song-reviews.json` に整理する。正本 CSV は書き換えない。
- **3-B2 / FN-004 canonical反映機能（正式v1設計統合済み / 部分実装済み、Slice 5レビュー中）**：有効confirmed Decisionから不変Planを作り、Approval・request_id付きdurable受付を通して既存参照/新規追加をall-or-nothingに反映する。COMMIT_DECIDED前は原則rollback、後はHistory等をfinalizeする。bootstrap・ID上限・再送/復旧契約を含む。
- **3-C / SCR-002 楽曲管理画面（interface設計済み / runtime未実装）**：管理一覧・レビュー編集・Decision確認・Apply Preflight・Apply結果・System Statusの6内部view。CLIと同じserviceを使い、bootstrap/recovery実行はv1ではCLIのみ。認証/hosting等は別途選定する。
- **3-D / JOB-001 楽曲候補定期収集ジョブ（予定 / 未実装）**：FN-002を定期的に起動する。実装着手時に専用の詳細設計書を追加する。通知は別ジョブとして必要時に定義する。

FN-003の現行schemaとFN-004正式v1設計の入口は[canonical registration](design/canonical-registration.md)。詳細は[Decision](design/fn004-decision.md)、[Plan](design/fn004-apply-plan.md)、[Transaction](design/fn004-transaction.md)、[CLI / SCR-002](design/song-admin.md)を参照する。Slice 1/2はPR #56/#57、Slice 3はPR #59、full-history CIはPR #60、本番bootstrap genesisはPR #61で完了。Slice 4（Decision + Apply Plan）とHistory readonlyはmain反映済み。現在はSlice 5（Approval + Apply Request / idempotency）の実装・修正・最終レビュー中で、その後Transaction / History publication / Recovery・CLI統合へ進む。PR数は固定せず、recovery障害試験前に実Apply入口を公開しない。

公開サイトはGitHub Pagesを継続する。独自ドメインは将来の公開設定として検討する。

## Milestone 4：複数artist横断機能

複数グループのデータが揃った段階で検討します。特に以下の仕様を確定する必要があります。

- 同じworkを複数artistが歌っている場合の集計方法
- coverの扱い
- multiple primary artist
- NEXT YOU等の別名義
- temporary / shuffle unit
- solo
- featured artist

Hello! Project全体ランキングなどの横断集計は、これらの仕様確定後に実装します。

## 将来的な拡張候補

以下は確定マイルストーンではなく、将来的な拡張候補です。

- 楽曲検索
- Creator検索
- メンバー検索
- 公式MV / YouTube動画情報
- ハロ！ステ等の公式動画と楽曲の紐付け
