# CRUDマトリクス

基準main・用語・全51データ種別の名称と保存先・根拠は[データ一覧](data-inventory.md)、再実行/復旧は[ライフサイクル](data-lifecycle.md)を参照。縦軸は6機能、横軸は同じデータID。横幅のため分割する。

## 凡例と粒度

- C：新しいfile/record作成、R：読込、U：既存fileの置換またはmutable state更新、D：**物理削除**、—：その機能の操作なし。
- `I:CR S:U`のように区分する。I＝mainソースで確認、S＝正式設計（未接続を含む）、?＝未確定。区分は操作単位であり、Iの内部部品があっても公開機能完成ではない。
- candidateのstatus変更・Decision取消revision・Approval失効イベントはDではない。immutable artifactの新規revision/eventはC。Decision storeのfile全体置換はUでも、過去revision更新を意味しない。
- SCR-002のS操作はbackend共通serviceの呼出しを介する。browserによるfilesystem直接CRUDではない。同じ保存をFN-004と二重に実行する意味ではない。
- `I:R*`は共通gate/runtime検証からの間接読込。正常なgenesisでは一部証跡が不在でも、検査対象pathとしてRに含める。資料を表示するだけの未確定APIをIにしない。

## canonical CSV（file粒度）

| 機能 | C01 | C02 | C03 | C04 | C05 | C06 | C07 | C08 | C09 | C10 | C11 | C12 | C13 | C14 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FN-001 | I:R | I:R | I:R | I:R | I:R* | I:R* | I:R* | I:R* | I:R | I:R | I:R* | I:R* | I:R* | I:R* |
| FN-002 | I:R | I:R | I:R* | I:R* | I:R* | I:R* | I:R* | I:R* | I:R* | I:R* | I:R* | I:R* | I:R* | I:R* |
| FN-003 | I:R | I:R | I:R | I:R | I:R | I:R | I:R | I:R | I:R | I:R | I:R | I:R | I:R | I:R |
| FN-004 | I:R S:CU | I:R S:CU | I:R S:CU | I:R S:CU | I:R | I:R | I:R S:CU | I:R S:CU | I:R S:CU | I:R S:CU | I:R S:CU | I:R | I:R | I:R |
| SCR-001 | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| SCR-002 | S:R | S:R | S:R | S:R | S:R | S:R | S:R | S:R | S:R | S:R | S:R | S:R | S:R | S:R |

C01〜C14の対応は[canonical一覧](data-inventory.md#canonical-csv14ファイル)。FN-004のC/Uは初回作成一般ではなく、正式v1の「既存canonical fileへ新rowを追加する書換え」をC（row）/U（file）で併記したもの。欠落CSVを自動作成する意味ではない。新規row追加以外の既存row field更新・削除は対象外。内部rollback writerは実装があるが、通常ApplyのC/Uを実装済みに格上げしない。

根拠：[canonical reader](../src/canonical.js)、[collector reader](../src/collector/match-existing.js)、[review reader](../src/prepare-reviews.js)、[commit対象](../src/fn004-evidence-types.js)、[scope](design/レビュー準備・canonical反映の全体フロー.md)。SCR-001は公開JSONだけを読む。

## 外部観測・候補・レビュー・公開

| 機能 | D01 | D02 | D03 | D04 | D05 | D06 |
| --- | --- | --- | --- | --- | --- | --- |
| FN-001 | — | — | — | — | I:CU | — |
| FN-002 | I:R | I:CRU | — | — | — | I:CRU |
| FN-003 | — | I:R | I:CU | I:R | — | — |
| FN-004 | — | I:R | — | — | — | — |
| SCR-001 | — | — | — | — | I:R | — |
| SCR-002 | — | S:R | S:R | ? | — | — |

D01公式入力、D02候補、D03派生review、D04legacy判断、D05公開JSON、D06実行内cache/summary。D06はメモリC/R/Uであり永続台帳作成ではない。D04のC/Uは現行6機能のwriterとしては確認できず、SCR-002の正式判断はF01を用いる。D03にはFN-004への正式入力としてのRを付けない（入力はcandidate＋Decision）。SCR-002からFN-003を再実行するadapter方式は未確定で、画面によるD03更新保証は記載しない。

根拠：[collector](../src/collector/collect.js)、[merge](../src/collector/merge-candidates.js)、[prepare](../src/prepare-reviews.js)、[公開generator](../scripts/generate-rankings.js)、[app](../site/app.js)。

## Decision・Plan・承認・結果・ID管理

| 機能 | F01 | F02 | F03 | F04 | F05 | F06 | F07 | F08 | F09 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FN-001 | — | — | — | — | — | — | I:R* | I:R* | I:R* |
| FN-002 | — | — | — | — | — | — | I:R* | I:R* | I:R* |
| FN-003 | — | — | — | — | — | — | I:R* | I:R* | I:R* |
| FN-004 | I:CRU | I:CR | I:CR | I:CR | I:CR | I:CR S:C | I:R S:C | I:CRU S:U | I:CR |
| SCR-001 | — | — | — | — | — | — | — | — | — |
| SCR-002 | S:CRU | S:CR | S:CR | S:CR | S:CR | S:R | S:R | S:R | S:R |

F06は失敗終端の内部writerをI、正常成功経路をSとして併記。F07には構築pure部品もあるが、保存publication接続はS。F08のI:Uは初期化/内部失敗復旧の限定経路を含み、通常commit writer完成ではない。F05のprocessingは設計にadvisory cache更新の説明がある一方、現mainの受付はenvelope不変、後続接続は未完成のため、一般Uを付けない。

根拠：[repository](../src/fn004-repository.js)、[Decision](../src/fn004-decision-application.js)、[Plan](../src/fn004-plan-application.js)、[Approval/Request](../src/fn004-approval-application.js)、[History readonly](../src/fn004-history-runtime.js)、[failure terminal](../src/fn004-failure-terminal.js)、[bootstrap](../src/fn004-bootstrap.js)。

## Transaction・Snapshot

| 機能 | F10 | F11 | F12 | F13 | F14 | F15 | F16 | F17 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FN-001 | I:R* | — | — | — | — | — | — | — |
| FN-002 | I:R* | — | — | — | — | — | — | — |
| FN-003 | I:R* | — | — | — | — | — | — | — |
| FN-004 | I:CR | I:CR | I:CR | I:CRU | I:CR | I:CR | I:CR | I:CR |
| SCR-001 | — | — | — | — | — | — | — | — |
| SCR-002 | — | — | — | — | — | — | — | — |

F10 owner、F11 intent、F12 journal、F13 cache、F14〜F17固定入力copy。IのCは内部evidence publisher/prepare/failure経路であり、Request submitからの自動実行ではない。通常readerはtransactions directory存在を確認し未解決ならSTOPし、全raw journalを正常表示用として読むわけではない。SCR-002は将来System Status/APIの診断結果を受けるが、raw fileへのR契約はここでは確定しない。

| 機能 | F18 | F19 | F20 | F21 | F22 | F23 |
| --- | --- | --- | --- | --- | --- | --- |
| FN-001 | — | — | — | — | — | — |
| FN-002 | — | — | — | — | — | — |
| FN-003 | — | — | — | — | — | — |
| FN-004 | I:CR S:D | I:CR S:D | I:CR S:D | I:CRD | S:CRD | I:CR S:C |
| SCR-001 | — | — | — | — | — | — |
| SCR-002 | — | — | — | — | — | — |

F18全14CSV backup、F19state backup、F20target temp、F21restore temp、F22History temp、F23terminal proof。Dは検証済みtemp/backupのcleanup（F20は成功時renameによる元path消滅も含む）に限定。永続History/proof削除ではない。F18〜F20の一般cleanupは正常/終端経路接続を含めSとし、未完了時に削除可能とは読まない。

根拠：[prepare publisher](../src/fn004-prepare-artifacts.js)、[durable prepare](../src/fn004-durable-prepare.js)、[failure recovery](../src/fn004-failure-recovery.js)、[terminal proof](../src/fn004-terminal-evidence.js)、[Transaction契約](design/FN-004-反映処理・復旧.md)。

## Recovery・排他・temp

| 機能 | F24 | F25 | F26 | F27 | F28 | F29 | F30 | F31 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FN-001 | — | — | — | I:CRD | I:R* | I:R* | I:R* | — |
| FN-002 | — | — | — | I:CRD | I:R* | I:R* | I:R* | I:CD |
| FN-003 | — | — | — | I:CRD | I:R* | I:R* | I:R* | I:CD |
| FN-004 | I:CR | I:CR | I:CR | I:CRD | I:CRD | I:CRD | I:CRD | — |
| SCR-001 | — | — | — | — | — | — | — | — |
| SCR-002 | — | — | — | — | — | — | — | — |

F24〜F26は永久保持のownership archive、F27common gate、F28Recovery barrier、F29publisher temp、F30bootstrap intent、F31collector/review temp。F27はshared基盤をFN-001/002/003も呼ぶためC/Dを持つ。F29は書込完了後rename/publicationで元pathが消えるが、起動時の一括Dは許されない。F30のDはbootstrap完了確認後の限定cleanup。F31のC/Dは各々の自分のtempだけ。

SCR-002からbootstrap/recovery実行はv1対象外（CLIのみ）。未実装の画面にD権限を推定しない。根拠：[gate](../src/fn004-gate.js)、[persistence](../src/persistence.js)、[ownership](../src/fn004-evidence-ownership.js)、[bootstrap](../src/fn004-bootstrap.js)、[画面契約](design/楽曲管理のCLI・画面連携.md)。

## マトリクス外の監査入力

Git object history・origin/main全reachable commit、index/working tree、外部bootstrap declarationはFN-004の監査R入力。生成物や候補の別コピーではなく、51種別の件数に含めない。SCR-002のGit差分APIは?。FN-004による自動commit/push/PRは正式v1対象外。公開workflowはFN-001を呼ぶ運用であり、新しい7番目の対象機能として列挙しない。
