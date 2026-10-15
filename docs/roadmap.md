# Hello! Project Song Data Roadmap

日付ベースではなく、機能単位のマイルストーンとして今後の実装予定を整理します。

Milestoneは開発順序・開発計画、SCR / FN / JOBはシステム上の機能識別子です。設計・実装・PR・会話ではIDと正式機能名を併記します。命名ルールは[機能ID体系](feature-ids.md)、正式な機能一覧は[README](../README.md#機能一覧)を参照してください。

## Milestoneと機能IDの対応

| Milestone | 対応する機能 | 状況 |
| --- | --- | --- |
| 公開サイトの初期実装 / 1 / 2 | FN-001 公開サイトデータ生成機能、SCR-001 公開サイト画面 | 実装済み。1・2で集計と表示を拡張 |
| 3-A / 3-A Follow-up | FN-002 楽曲候補収集機能 | 完了 / 実装済み |
| 3-B0 | 文書・構成の整理（独立した機能IDなし） | 完了 |
| 3-B1 | FN-003 レビュー準備機能 | 完了 / 実装済み |
| 3-B2 | FN-004 canonical反映機能 | Design 1〜4統合済み / runtime未実装 |
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
- **3-B2 / FN-004 canonical反映機能（正式v1設計統合済み / runtime未実装）**：有効confirmed Decisionから不変Planを作り、Approval・request_id付きdurable受付を通して既存参照/新規追加をall-or-nothingに反映する。COMMIT_DECIDED前は原則rollback、後はHistory等をfinalizeする。bootstrap・ID上限・再送/復旧契約を含む。
- **3-C / SCR-002 楽曲管理画面（interface設計済み / runtime未実装）**：管理一覧・レビュー編集・Decision確認・Apply Preflight・Apply結果・System Statusの6内部view。CLIと同じserviceを使い、bootstrap/recovery実行はv1ではCLIのみ。認証/hosting等は別途選定する。
- **3-D / JOB-001 楽曲候補定期収集ジョブ（予定 / 未実装）**：FN-002を定期的に起動する。実装着手時に専用の詳細設計書を追加する。通知は別ジョブとして必要時に定義する。

FN-003の現行schemaとFN-004正式v1設計の入口は[canonical registration](design/canonical-registration.md)。詳細は[Decision](design/fn004-decision.md)、[Plan](design/fn004-apply-plan.md)、[Transaction](design/fn004-transaction.md)、[CLI / SCR-002](design/song-admin.md)を参照する。設計PRのreview/merge後、schema/validator → repository/gate/bootstrap → Decision → Plan → Approval/Request → transaction → History/recovery → CLI実Apply → backend → frontendの順で実装する。目安10 sliceだがPR数は固定せず、大きさと独立検証可能性に応じて分割する。recoveryの障害試験が通るまで実Apply入口を公開しない。

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
