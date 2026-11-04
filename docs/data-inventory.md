# 横断データ一覧

## 調査基準と読み方

調査日：2026-11-04。対象：YutoSuga/helloproject-song-data、main **4a2bb71944121b44d340b8c4bd4244b3ad3b7f4f**。GitHub APIでmainのtree・固定SHAの設計書とソースを照合した。調査時点のopen PRは0件で、未マージ実装は根拠に含めない。対象treeにAGENTS.mdおよび同等の横断データ台帳はない。既存正式仕様を置換せず、補助資料として本書・[CRUD](crud-matrix.md)・[ライフサイクル](data-lifecycle.md)を追加する。

区分は **I＝実装で確認済み、S＝正式設計で確認済み（未接続・未実装を含む）、?＝未確定**。Iはソース上の部品の存在を指し、全体の利用可能性や本番実行実績を保証しない。「永続」はプロセス終了後も保持する意味であり、Git管理とは別である。以下の名称は既存文書の用語・schema/table識別子を併記したもの。独立した日本語正式名が定義されていない表は識別子を優先する。

## 機能の正式責務

| 機能 | 正式名・責務 | 現状と依頼表現との差 |
| --- | --- | --- |
| FN-001 | 公開サイトデータ生成機能。canonicalから作家ランキング・根拠JSONを生成 | I。「公開用JSON」は現在ランキングJSONに限定 |
| FN-002 | 楽曲候補収集機能。公式release情報の音声トラック解析・候補統合 | I。公式情報全般の汎用収集ではない |
| FN-003 | レビュー準備機能。candidate全件とcanonical、legacy判断を照合し提案を生成 | I。承認の保存・canonical反映はしない |
| FN-004 | canonical反映機能。Decision、Plan、Approval、Request、Transaction、History、ID管理 | I/Sの混在。既存参照と新規追加がv1範囲、既存row訂正・削除は対象外 |
| SCR-001 | 公開サイト画面。生成済みランキング表示 | I。CSVへ直接アクセスしない |
| SCR-002 | 楽曲管理画面。6内部viewから共通serviceを利用 | S。backend/frontend未実装。単純な候補status更新画面ではない |

根拠：[機能ID](feature-ids.md)、[公開](design/公開サイトのデータ生成・表示.md)、[収集](design/FN-002-楽曲候補収集.md)、[全体](design/レビュー準備・canonical反映の全体フロー.md)、[CLI・画面](design/楽曲管理のCLI・画面連携.md)。

**設計書の状況表現に注意**：全体設計・機能ID等の「FN-004 runtime未実装」は機能全体の記述として残っているが、mainにはDecision/Plan/Approval/Request、History検証、durable prepare、failure recoveryの部品がある。[承認service](../src/fn004-approval-application.js)はdispatcher/canonical writerを持たず、[prepare](../src/fn004-durable-prepare.js)もRequest submit/retry・CLI・commit executorへ未接続と明記する。[失敗復旧](../src/fn004-failure-recovery.js)も内部service。これらを「実Applyが完成」と解釈しない。

## canonical CSV：14ファイル

全てCSV、唯一の楽曲正本・永続/Git管理。既存データの作成元は手動整備等の既存運用（特定FNだけを作成元と断定しない）。FN-004の正式設計では下表の9表へ新規row追加、残り5表は参照・検証のみ。全14表をFN-003、FN-004のsnapshot/validatorが読む。保持期限・一括GCは定義されていない。FN-004 v1で既存rowのupdate/deleteは行わない。

| ID | table識別子（名称） | 実保存先 | 用途 | FN-004 v1追加 |
| --- | --- | --- | --- | --- |
| C01 | works（作品） | [data/works.csv](../data/works.csv) | 楽曲を束ねる作品 | S：対象 |
| C02 | songs（楽曲（音源）） | [data/songs.csv](../data/songs.csv) | 作品に属する音源・version | S：対象 |
| C03 | artists（アーティスト） | [data/artists.csv](../data/artists.csv) | 歌唱主体 | S：対象 |
| C04 | creators（作家） | [data/creators.csv](../data/creators.csv) | 作詞・作曲等の人物 | S：対象 |
| C05 | members（メンバー） | [data/members.csv](../data/members.csv) | 出演・歌唱メンバー | 対象外 |
| C06 | member_affiliations（所属履歴） | [data/member_affiliations.csv](../data/member_affiliations.csv) | メンバーとアーティストの所属期間 | 対象外 |
| C07 | releases（リリース） | [data/releases.csv](../data/releases.csv) | 発売情報・商品 | S：対象 |
| C08 | release_tracks（収録トラック） | [data/release_tracks.csv](../data/release_tracks.csv) | リリースと楽曲の収録関係 | S：対象 |
| C09 | song_artists（楽曲アーティスト） | [data/song_artists.csv](../data/song_artists.csv) | 楽曲と歌唱主体・roleの関連 | S：対象 |
| C10 | song_creators（楽曲作家） | [data/song_creators.csv](../data/song_creators.csv) | 楽曲と作家・creditの関連 | S：対象 |
| C11 | song_performers（楽曲歌唱メンバー） | [data/song_performers.csv](../data/song_performers.csv) | 楽曲とメンバーの関連 | S：対象 |
| C12 | videos（映像） | [data/videos.csv](../data/videos.csv) | 映像資料 | 対象外 |
| C13 | video_songs（映像内楽曲） | [data/video_songs.csv](../data/video_songs.csv) | 映像内の楽曲区間 | 対象外 |
| C14 | video_song_performers（映像内歌唱メンバー） | [data/video_song_performers.csv](../data/video_song_performers.csv) | 映像内楽曲区間とメンバーの関連 | 対象外 |

根拠：[data-spec](data-spec.md)、[schema](../src/canonical-schema.js)、[全体v1 scope](design/レビュー準備・canonical反映の全体フロー.md)、[commit対象9表](../src/fn004-evidence-types.js)。FN-001の直接集計入力はworks/songs/artists/creators/song_artists/song_creatorsの6表（[reader](../src/canonical.js)）。FN-002の照合入力はsongs/worksの2表（[title index](../src/collector/match-existing.js)）。ただし両者の共通gateでruntime/History証明のため全表snapshotを読む場合があり、CRUDではこの間接読込も別記する。

## 候補・レビュー・公開・外部データ

| ID・名称 | 保存先・形式 | 用途／作成元→利用機能 | 永続性・保持・再生成 | 区分・根拠 |
| --- | --- | --- | --- | --- |
| D01 公式release観測入力 | 公式一覧HTML、年別feed JSON `/json/{versionDir}/{year}_releases.json`、release詳細HTML。URLはartist設定と解析結果による | 公式サイト→FN-002 | 外部原本。取得response/parsed観測はメモリのみ。raw HTML保存先は実装なし | I：[collect](../src/collector/collect.js)、[artists](../src/collector/artists.js) |
| D02 Song Candidate（収集候補・収集情報） | `staging/song-candidates.json`、JSON schema_version=1/candidates | FN-002→FN-002/003/004、将来SCR-002はservice経由 | 永続/Git管理。source位置IDで統合。未再発見分も保持。status/notes/confirmed ID・detected_atを維持しlast_seen_at更新。期限・GCなし | I：[merge](../src/collector/merge-candidates.js)、[collect](../src/collector/collect.js) |
| D03 Song Review（レビュー派生提案） | `staging/song-reviews.json`、JSON schema_version=1/reviews | FN-003→人間レビュー、将来SCR-002 adapter | ファイル保存する再生成可能な派生データ。main treeに現物なし。全件再生成・atomic置換、仮pw_IDは正式IDでない | I：[prepare](../src/prepare-reviews.js)、[全体](design/レビュー準備・canonical反映の全体フロー.md) |
| D04 legacy Review Result（過去判断入力） | `staging/review-results.json`、JSON schema_version=1/results | 人間等の旧運用（writer未実装）→FN-003 | 永続入力想定、main treeに現物なし。不在のみ空。hold/confirmed/rejected/appliedを添付するだけ。正式Decision/Historyへ自動移行しない | I reader/S用途：[prepare](../src/prepare-reviews.js)、[全体](design/レビュー準備・canonical反映の全体フロー.md) |
| D05 公開ランキングJSON | `site/data/rankings/{artist_id}.json`、現物G00001.json | FN-001→SCR-001 | 永続/Git管理の再生成物。canonicalへ逆反映なし。同artistのfileをwriteFileで置換。自動削除・GCなし | I：[generator](../scripts/generate-rankings.js)、[表示](../site/app.js) |
| D06 feed cache・収集summary | メモリMap（feed URL key）、返却summary/CLI標準出力 | FN-002→同一実行/操作者 | 一時。cacheはcollectCandidates一回内で共有、次回には残らない。summaryに取得失敗・empty audio等を含む | I：[collect](../src/collector/collect.js) |

独立した永続「収集済み・検索済み台帳」は確認できない。D02にdetected_at/last_seen_at等を保持することと、HTTP再取得を省略することは別である。詳細は[ライフサイクルA](data-lifecycle.md#fn-002の再収集防止)を参照。

## FN-004永続証跡・状態・一時生成物

下表はパターンを含む論理的データ種別。UUIDはschemaで許可するUUID、txは`tx_{UUID}`。特記しないJSONはプロセスを越えて保持する。main treeにある現物はD02/D05とcanonicalのほか、`fn004-bootstrap.json`・`fn004-state.json`。他のpathはソース・設計で確認した保存契約であり、実運用生成済みとはしない。

| ID・正式用語 | 実パス（staging/基準）・形式 | 作成元→利用／用途 | 保持・再生成・実装区分 |
| --- | --- | --- | --- |
| F01 Decision store | `decisions.json` JSON/revisions | FN-004→FN-004、SCR-002(S)／人間のidentity判断 | I append保存。各revision immutable、ファイルは追記内容でatomic更新。Git管理、取消しも新revision |
| F02 Apply Plan | `apply-plans/ap_{64桁hash}.json` JSON | FN-004→FN-004、SCR-002(S)／具体的row・予定ID・precondition | I生成/保存。payload immutable、derived・原則Git非管理(S)。変更時は別Plan、ID予約ではない |
| F03 Approval | `apply-approvals/apr_{UUID}.json` JSON | FN-004（人間確認）→FN-004、SCR-002(S) | I保存。immutable/Git管理。同Plan hashへbinding |
| F04 Approval Invalidation | `apply-approvals/invalidations/ainv_{UUID}.json` JSON | FN-004→FN-004、SCR-002(S)／永久失効イベント | I追記。immutable/Git管理、Approval自体を書き換えない |
| F05 durable Apply Request | `apply-requests/{request_id UUID}.json` JSON/envelope/receipt | FN-004→FN-004、SCR-002(S)／受付と唯一のtx対応 | I受付保存。Git非管理、未完了保持。mainの受付はexecutor未接続。processing cacheを成功証拠としない |
| F06 Request Completion | `apply-requests/completions/{request_id}.json` JSON | FN-004→FN-004／terminal結果 | I失敗側内部writer、S正常経路。immutable。proofとbinding、同要求の終了時刻・内容を再利用 |
| F07 successful Apply History | `apply-history/apply_{UUID}.json` JSON | FN-004→FN-004、SCR-002(S)／成功と確定ID・candidate coverage | I readonly検証・構築部品、S正常publication接続。immutable/Git管理、失敗を混ぜない |
| F08 ID/repository state | `fn004-state.json` JSON | FN-004→FN-004、間接FN-001/002/003 | I bootstrap/state検証、S通常commit接続。永続/Git管理・mutable。high-water markをrollbackでも下げない |
| F09 Bootstrap/genesis | `fn004-bootstrap.json` JSON | FN-004→FN-004、間接reader／初期監査・completion marker | I生成・検証。immutable/Git管理。通常cloneでrepository identity継承 |
| F10 Initial Owner | `transactions/{tx}/owner.json` JSON | FN-004→FN-004／元live leaseと入力binding | I検証・永続化部品/S submit接続。immutable、runtime-local |
| F11 Intent | `transactions/{tx}/intent.json` JSON | FN-004→FN-004／before/target manifest・backup参照 | I durable prepare。immutable、未完了保持 |
| F12 Transaction Journal | `transactions/{tx}/journal/{sequence}.json` JSON | FN-004→FN-004／phase・authority・hash chain | I prepare/失敗経路、S正常commit接続。immutable追記。sequenceは6桁zero-pad、1000000以降通常桁 |
| F13 latest transaction cache | `transactions/{tx}/transaction.json` JSON | FN-004→FN-004／journal由来の表示cache | I部品。atomic置換可能、判定正本でなく検証・再構築対象 |
| F14 Plan入力copy | `transactions/{tx}/plan.json` JSON | FN-004→FN-004／immutable入力固定 | I prepare。元Planのcopy、未完了保持 |
| F15 Decision Snapshot | `transactions/{tx}/decision-snapshot.json` JSON | FN-004→FN-004／元revision固定 | I prepare。immutable、candidate正本の代替ではない |
| F16 Approval入力copy | `transactions/{tx}/approval.json` JSON | FN-004→FN-004／元承認固定 | I prepare。immutable |
| F17 Request入力copy | `transactions/{tx}/request.json` JSON/ReceiptCopy | FN-004→FN-004／元receipt固定 | I prepare。envelope全体でなくReceiptCopy |
| F18 canonical backup Snapshot | `transactions/{tx}/backup/data/{14表名}.csv` CSV/raw bytes | FN-004→FN-004／復元根拠 | I prepare/失敗復旧。全14表copy/hash照合、hardlink退避ではない。安全確認前削除不可 |
| F19 state backup | `transactions/{tx}/backup/fn004-state.json` JSON/raw bytes | FN-004→FN-004／before state証明 | I prepare。元stateとbyte照合、未完了保持 |
| F20 canonical target temp | `transactions/{tx}/temp/data/{追加対象9表名}.csv` CSV | FN-004→FN-004／変更対象のみのtarget bytes | I prepare。限定pathへexclusive生成・sync、S正常rename |
| F21 canonical restore temp | `transactions/{tx}/restore/data/{追加対象9表名}.csv` CSV | FN-004→FN-004／rollback用 | I失敗復旧。byte確認後復元、安全な終端後のみcleanup |
| F22 History temp | `transactions/{tx}/temp/apply-history.json` JSON | FN-004→FN-004／公開前の完成History | S正常成功経路。tempの存在は成功証拠ではない |
| F23 Terminal state proof | `transaction-proofs/{tx}.json` JSON | FN-004→FN-004／失敗消費を含む終端証明 | I失敗側/S正常経路。immutable/Git管理、v1 GCなし |
| F24 Recovery ownership anchor | `recovery-ownership/{tx}/anchor.json` JSON | FN-004→FN-004／所有権lineage起点 | I内部永続化。runtime-local・永久保持、Gitへ持ち運ばない |
| F25 Recovery claims | `recovery-ownership/{tx}/claims/{sequence}.json` JSON | FN-004→FN-004／所有権移管 | I内部部品。immutable・永久保持、sequence再利用禁止 |
| F26 Recovery retirements | `recovery-ownership/{tx}/retirements/{owner_sequence}.retiring.json` と `*.retired.json` JSON | FN-004→FN-004／所有権終了段階 | I内部部品。各file immutable・永久保持。sequence=000000も許可 |
| F27 common gate | `.fn004.lock` JSON | FN-004基盤、FN-001/002/003 reader→共通排他 | I ephemeral。所有権確認後release、古いPID/時刻だけで削除しない |
| F28 Recovery MutexBarrier | `.fn004-recovery.lock` JSON | FN-004→FN-004／復旧排他 | I内部部品。ephemeral、retirement後のみ削除。所有権正本はarchive |
| F29 publisher temp | 各出力親directoryの `.fn004-{basename}.tmp-{UUID}` bytes | FN-004基盤→共通reader/writer | I atomic/durable出版。一時だが無条件起動GC禁止、残存時は整合検査 |
| F30 Bootstrap intent | `transactions/bootstrap_{UUID}/intent.json` JSON | FN-004→FN-004／初期化中断証跡 | I。完了marker/stateと照合したcleanupのみ。Git非管理 |
| F31 単一JSON保存temp | `song-candidates.json.{pid}.tmp`、`song-reviews.json.{pid}.{UUID}.tmp` JSON | FN-002/003→各保存処理 | I一時。rename成功で消滅、保存例外時に自分のtempを除去。kill時残存の自動回収仕様は未確認 |

F01〜F09の根拠：[repository](../src/fn004-repository.js)、[Decision service](../src/fn004-decision-application.js)、[Plan service](../src/fn004-plan-application.js)、[Approval repository](../src/fn004-approval-repository.js)、[runtime state](../src/fn004-runtime-state.js)、[History](design/FN-004-成功履歴・読取検証.md)、[Bootstrap](design/FN-004-初期化・ID状態.md)。
F10〜F30のpath/保存根拠：[namespace](../src/fn004-evidence-namespace.js)、[prepare artifacts](../src/fn004-prepare-artifacts.js)、[failure recovery](../src/fn004-failure-recovery.js)、[archive](../src/fn004-recovery-archive.js)、[Transaction正式契約](design/FN-004-反映処理・復旧.md)。F31：[collector](../src/collector/collect.js)、[review保存](../src/prepare-reviews.js)。

F10〜F22のruntime-local証跡について一律の保存期限は定義されていない。未完了は保持し、終端proof/completion・所有権・bytes/durabilityを検証したcleanupだけを認める。永久保持のarchiveやterminal proofとtemp/backupを混同しない。現行ignoreは[.gitignore](../.gitignore)を参照し、設計上の非管理方針が全てignoreへ反映済みとは扱わない。

## 保存ファイルを持たない内部snapshot

[readCanonicalSnapshot](../src/canonical-snapshot.js)のrawBytes/tables/manifest/validationと、[RecoverySnapshot](../src/fn004-recovery-snapshot.js)の検証済み観測はメモリ上の一時値（I）。FN-004等の読込・計画・復旧に利用し、後続write時にgateを再取得して再検証する。これらを永続の独立Snapshot JSONと呼ばない。永続copyはF15/F18/F19、観測結果の保存契約は各journal/proofに従う。51種別は保存artifact/外部入力単位の集計で、内部projectionの個数ではない。

## 件数・未確定事項

6機能、**51データ種別**（C01〜C14＝14、D01〜D06＝6、F01〜F31＝31）。動的な個々のtx/sequence/CSV copyを数えた物理ファイル総数ではない。F18は14パターン、F20/F21は最大9表、F26は2種のfilenameへ分解している。

独立した検索済み台帳、candidateのApply後status自動更新、保持期限/一般GC、legacy判断writer、SCR-002 adapter/backend/認証、Git差分取得API、一括承認の原子性・部分失敗は未確認または未確定。[ライフサイクル](data-lifecycle.md)で判断可能な範囲と追加調査を区別する。設定ファイル・ソース・テストfixtureは実行データの別正本として数えない。Git履歴/origin/main監査と外部bootstrap declarationは初期化/ID監査の重要入力であり、外部declarationのファイル名は正式に固定されていない（[Bootstrap契約](design/FN-004-初期化・ID状態.md)）。
