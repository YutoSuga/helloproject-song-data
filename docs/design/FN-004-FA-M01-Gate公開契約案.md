# FN-004 FA-M01 — Gate公開契約の変更案

## 1. 状態・適用範囲

**提案 / 人間による設計レビュー待ち**。作成日：2026-11-13 JST。調査基準main：`e119556c1703e7ea963a327832cacf5a3affb647`。本PRは文書だけで、実装・Production操作・merge・FA-M01 CLOSED・FN-004受入PASSを意味しない。

正本は[反映処理・復旧](FN-004-反映処理・復旧.md)の「Slice 2 runtime API」「GateMetadataV1 / GateWitness」「初回取得・successor・common gate」「cleanupとretirement」。本案の採用時に変更する段落を§10に明示する。**レビュー前に既存のwx規則を実装者の判断で置換しない。**

[判断モデル](FN-004-判断モデル.md)、[初期化・ID状態](FN-004-初期化・ID状態.md)、[承認・Request](FN-004-承認・反映リクエスト.md)、[成功履歴](FN-004-成功履歴・読取検証.md)、[CLI契約](楽曲管理のCLI・画面連携.md)、[CLIガイド](../canonical-cli.md)の安全条件は維持する。既存metadata/Receipt/Owner/Intent/Journal/Proof/Completion/History/stateの保存schema・hash projection・ID規則は変更しない。

旧監査報告は別local branch `docs/fn004-final-acceptance` の `docs/reviews/FN-004-Final-Acceptance.md` に存在し参照したが、main未反映のため本PRに混入しない。FA-L01の一般文書整理も対象外。

## 2. 根本原因・再現条件

[現Gate](../../src/fn004-gate.js)は最終path `staging/.fn004.lock` をwx作成してからwrite/file sync/directory syncする。競合側のEEXISTから[readJson](../../src/persistence.js)へ進む間に、次の観測窓がある。

| 観測窓 | 現行の結果 | 問題 |
| --- | --- | --- |
| 最初のwx成功後・metadata write前/途中 | 空/partial JSON → GATE_CORRUPT、cause=PERSISTENCE_PARSE_FAILED | 生きた正規publisherと異常終了した空lockが同bytesで区別不能 |
| EEXIST後・read前に元ownerが正規release | ENOENT → PERSISTENCE_NOT_FOUND → GATE_CORRUPT | 正規の名前消失を破損と断定 |
| 正常metadataが安定して存在 | GATE_BUSY | 正常な競合経路 |
| 既存の空/破損/未知version/読込不能lock | GATE_CORRUPT | 維持すべきfail-closed |

[Decision application](../../src/fn004-decision-application.js)はcallbackに入る前のGATE_BUSYだけを最大5秒retryする。GATE_CORRUPTはOCCより前に返る。期待DECISION_HEAD_CONFLICTは、gate取得後に保存済みhead revision/hashを比較する[Decision lifecycle](../../src/fn004-decision-lifecycle.js)の結果であり、Gate層で捏造しない。

Final Acceptanceの自然発生FAILにはnested causeが残らず、その1回がどの窓だったかは未確定。別の隔離harnessでwx後/write前を停止し、live空lockと放置空lockが同じGATE_CORRUPT/PERSISTENCE_PARSE_FAILEDになること、EEXIST後の正規releaseがGATE_CORRUPT/PERSISTENCE_NOT_FOUND/ENOENTになることを確定再現した。破損JSON・array root・未知schemaも保持して停止した。これは調査証拠であり、新方式の実行試験ではない。

## 3. 方式比較・推奨

| 案 | atomic / no-clobber | 適合性・制約 | 推奨 |
| --- | --- | --- | --- |
| A 同directoryのtemp＋hard link | 完成済みinodeをlink。最終名があればEEXISTで上書きしない | Node標準fs、既存createJsonExclusiveと同系統。元handle/inodeをleaseへ引き継ぐ必要があり、既存publisherをそのまま呼べば完成するわけではない | **第一候補** |
| B Linux renameat2(RENAME_NOREPLACE) | 対応kernel/FSではatomic no-replace | Node標準fs.renameはこのflagを提供しない。native binding・対応検証・障害契約が必要 | 将来の代替。今回のfallbackにしない |
| C O_TMPFILE＋linkat(AT_EMPTY_PATH) | Linux対応FSで名前なしinodeを完成後公開可能 | Node標準APIだけでは実現できず、native依存・権限/FS検証が必要 | 本変更では採用しない |
| D mkdirによるgate / OS advisory lock | それぞれ排他を作れる | 現在のfile path・GateWitness・参加者protocol・Recoveryを変更する。mkdir後metadata窓も別途必要 | 大きな再設計となるため対象外 |
| E 最終pathのwxを維持 | 排他は成立するがpartial metadataが公開される | 壊れたlockでSTOPする安全性は維持できるが、正常競合の誤STOPを解消しない | 現状維持案。FA-M01を閉じられない |
| 禁止：通常rename / 存在確認後rename | renameは置換可能。exists確認との間にもrace | 他ownerのgateを破壊し得る。no-clobberの代替ではない | 禁止 |

**推奨セットはA＋専用candidate namespace（§5）＋EEXIST観測のbounded再取得（§6）**。単一process内のqueueだけでは別process/workerの窓が残り、根本解消にはしない。corruptを一律BUSYへ変換する案も採用しない。

## 4. 状態・線形化点

以下はprocess内の説明用状態で、readiness enum、Journal phase、保存schemaへ追加しない。

| 状態 | 物理状態 | 権限 |
| --- | --- | --- |
| IDLE | 自己candidateなし | なし |
| PREPARING | 自己tempがwx作成されwrite中 | なし。先にtempを作ったcallerが勝者とは限らない |
| READY_TO_LINK | 完成bytes、file sync、readback、inodeを検証済み | なし |
| PUBLISHED_UNCONFIRMED | 最終名へlinkされたが後続sync/検証等が未完 | 排他名はあるがdomain callback権限なし |
| OWNED | 全同期・照合・自己temp片付け・取得後guard成功、nominal lease完成 | 本人のlive leaseだけ |
| RELEASING | 本人leaseを再利用不可にしrelease中 | 新domain mutation不可 |
| RELEASED | 自己linkのunlinkとdirectory sync完了 | なし |
| FAILED_RETAINED | I/O/整合性不明、証拠保持 | なし。自動修復しない |

競合の線形化点は**最終名への成功したexclusive link**。domain authority成立はそれより後であり、`link成功`やmetadataが見えることだけでleaseを返さない。releaseの名前消失点とdurable release完了点も別である。

## 5. 公開・取得契約案

### 5.1 取得手順

1. rootのrealpath/path safety、non-reentrant、既存Recovery barrier/archive guardを現行どおり検証する。metadataとlock_id/開始時刻/process identityを一度固定する。GateMetadataV1のfield・JCS＋LFを変えない。
2. 同じstaging directoryへ `.fn004-gate-candidate.tmp-<lock_id>` のbasenameでtempをwx/0600作成する。lock_idは小文字UUID v4。名前衝突時は既存tempを使わず失敗する。最終pathはここでは作らない。
3. 全bytesを書き、file sync、handle stat(BigInt)、safe readbackを行う。readbackの対象inode/bytesを元handleと照合する。close/reopenが必要でも同inode/全bytesのbindingを失わない。以降このinodeへwriteしない。
4. tempから最終pathへhard linkでexclusive公開する。同directory・同FSのみ。EEXISTは§6、その他の失敗は§8。普通のrenameや弱いdurabilityへfallbackしない。
5. staging directoryをsyncし、最終pathがregular/non-symlinkで元handleと同dev/ino/全bytesであることを再確認する。最終pathの他inodeやhash一致だけで自己所有としない。
6. 自己temp名を同inode/bytes/内部creation capabilityで確認してunlinkし、directoryを再syncする。最終名をunlinkしてtemp片付けの代わりにしない。
7. step6後にWeakMapへ内部検証用のnominal leaseを登録し、取得後のRecovery/runtime preconditionを既存規則で再検証する。このtokenを外へ渡すのは全guard成功後だけ。内部tokenはguardと拒否時の本人releaseに限定し、domain callbackには渡さない。ここまでdomain callback、Receipt/Owner生成、ID消費、CSV更新を開始しない。初回Applyの同lease継続は維持する。

step7の取得後guard拒否時は、現行の本人による検証済み自己releaseだけを許す。release失敗なら元拒否もoperation_errorへ保持し停止。他ownerのgateや不明な公開を消す経路ではない。step4〜6のI/O失敗を「guard拒否」としてreleaseして成功に変換しない。

汎用createJsonExclusiveは参考primitiveに留める。現実装ではhandleを閉じ、失敗時のlease ownershipも扱わないため、単純な委譲で本契約を満たしたことにしない。新しいpublic bypass/force/caller指定tempを設けない。

### 5.2 専用candidateと孤立temp（承認事項D2）

**推奨：この正確な新namespaceのregular candidateは非authoritative準備物と定義する。** 内容が空/partialでも最終lockではなく、owner/Request/処理完了の証拠にも、他processによる再公開/resumeの入力にも使わない。

- candidateの存在だけでBOOTSTRAP_INCOMPLETEやGate破損としない。複数callerが公開前に準備することを許す。これを決めず現行のroot temp guardへ追加すると、正常競合でも停止する。
- この例外は正確なbasename/UUID形式だけ。他のtemp・lock・unknown artifactへ一般化しない。symlink/nonregular/path escape、listing/read失敗は従来どおり安全停止する。
- 自己のnominal creation capabilityが検証できるprocessだけが自己candidateを片付ける。完成済み他者temp、古いPID、時刻、filenameだけを理由に消さない。起動時sweep、orphan GC、lock強制削除は提供しない。
- published finalとhard linkを共有する孤立candidateもauthorityではない。finalが消えた後にこれを再linkしない。共有inodeの内容を書き換えない。削除方針未策定の他者orphanは保持・容量監視対象である。
- 新candidateを除外するのは**domain意味判定**だけ。Discoveryのraw path/kind/bytes/hash記録から黙って消さない。Recovery observation v2のprojection形と既存artifact/hashは変えず、candidateの変化もfresh hash/raced判定へ反映する。以前のinspect hashと不一致ならrunは停止する。
- [runtime temp guard](../../src/fn004-runtime-state.js)、[Discovery](../../src/fn004-evidence-discovery.js)、[namespace](../../src/fn004-evidence-namespace.js)、[snapshot](../../src/fn004-recovery-snapshot.js)すべてでこの分類を整合させる。generic publisherTargetの許可を緩めず、candidateをJSON/Journal/汎用publisher証拠としてparse/adoptしない。
- この非authoritative規則は新runtimeのprotocolに基づく設計変更であり、単なるignore追加ではない。採用前に未知tempを無条件無視してよいという意味ではない。既存bootstrap/History/state/Request/pending/terminal guardは独立して全検証する。

代替はorphanをすべてblockする案。ただし正常な他callerの準備中tempと区別できず、並行Decision保証が再び弱くなる。D2を承認しない場合はFA-M01全体の実装着手条件が満たされない。

## 6. EEXIST・release/read競合・bounded retry

### 6.1 EEXIST後の観測

finalをsafe openして、**同一descriptorのregular file/BigInt identity/全bytes**を取得する。GateMetadataV1を既存の完全型/strict JSON・root bindingで検証し、path側のidentityも再照合する。mtime/PID生存だけでvalidとしない。

| 再観測 | 動作 |
| --- | --- |
| 自己candidateと同inode/bytesのfinal | syscall後例外等の自己公開を検出。通常の競合としない。エラーがあった取得は§8の公開済み失敗として停止 |
| 安定した別inodeのvalid final | GATE_BUSY、元metadata保持。所有を得ず、callbackへ進まない |
| final open/read/lstatでENOENT、またはvalid metadata読取り後に名前が消失/別valid inodeへ変化 | 「名前が変化した」という観測。正規releaseだと断定せず、no-leaseの新exclusive取得試行へ戻せる |
| 空/不正UTF-8/JSON/未知schema/field/不正bindingのfinal | GATE_CORRUPT。待てば直ると推測してretryしない |
| EIO/EACCES/EPERM/不明、unsafe path、内容の不正を実際に読んだ後の消失 | 元typed evidenceを保持して停止。不正を後続ENOENTで打ち消さない |

ENOENTはBUSYへの無条件変換でも、他者のrelease証明でもない。**次のexclusive linkが成功した場合だけ**新しい所有候補となる。別ownerが先に取得していれば再びEEXISTとなり、その新inode/metadataを検証する。先に見たownerの情報を新ownerへ流用しない。

### 6.2 予算と安全境界（承認事項D3）

推奨初期値：1 acquire invocation内のnamespace-race再試行を最大8回、monotonic経過1秒の早い方で止める。初回候補準備は1回、bytes/time/IDは固定。再試行前にcandidate identity、path safety、Recovery guardを再検証する。数値は公開optionにせず、承認後の内部定数・trusted test clockで固定する。

- 予算枯渇時、安定valid finalを実際に確認できればGATE_BUSY。それ以外はGATE_ACQUIRE_FAILED＋元EEXIST/ENOENT/phaseを保持し停止。ownerを捏造してBUSYにしない。
- syscall自体のhard timeoutを保証する数値ではない。期限後の新試行を禁止し、in-flight syscallの結果不明を安全停止として扱う。
- Decision既存5秒予算をnested retryで無制限に延ばさない。共通の残り予算に制限し、callbackに入った後の例外/更新は再dispatchしない。5秒以内に取得できなければBUSY/取得失敗があり、常にHEAD_CONFLICTを返す保証ではない。
- **本人が既存gateを採用すべきRecoveryには不適用**。そのwitnessの消失は従来どおりSTOP。Proof＋Completionがvalidなterminal cleanupだけが、新common gateを内部authorityで取得できる。
- 上記取得の再試行は、正常に解放された名前を自分で削除/修復しない。既存のOwner終了証明、claim chain、barrier、観測hash/action検証を迂回しない。

## 7. Release契約

本人のlive tokenをreleasingにし、新mutation/再利用を禁止→finalのdev/ino/全bytesを検証→descriptor close→自己final名unlink→directory sync、の既存原則を維持する。失敗時はtokenを再活性化しない。identity/内容不明ならunlinkしない。

- normal releaseのunlink成功後に別ownerが新finalを作っても、旧ownerはそのfileを削除しない。旧名のunlink成功とdir syncは、新owner名がその後存在しないことの保証ではない。
- unlinkが例外を返した場合も、未実施と断定しない。fresh lstat/readでsame/absent/other/unknownを記録し、元causeを保持してGATE_RELEASE_FAILED。見えないだけでdurable解放成功としない。再unlinkはしない。
- unlink後のdir sync失敗は解放未確定。post-release観測がabsentでもエラーを成功へ変換しない。別ownerが既に存在してもそれを消して帳尻を合わせない。
- Recovery retirementはbarrier下で、Retiring→same gate release→sync/不在確認→Retired→barrier releaseの現契約を維持。正常取得のnamespace retryを、RETIRING途中や未完了transactionのgate消失の救済へ使わない。
- 完了済み意味結果と解放失敗を混同しない。既存Proof/History/stateのfresh検証が成功効果を証明する場合だけ、R84-M02に従いapplied＋finalization待ちを返せる。

## 8. 失敗・typed evidence・CLI分類

成功系でも失敗系でも、保持するcause/path/phase/published/temp/descriptorと原errnoを失わない。保存ErrorEvidenceは既存projectionを維持し、補助観測を新しい永続fieldへ無断追加しない。

| 条件 | code / CLI基本exit | retry・公開情報 |
| --- | --- | --- |
| 安定valid他owner | GATE_BUSY / 5 | Decisionだけ既存予算で再試行。自己未公開candidateは本人照合後のcleanupだけ可 |
| stale Decision head | DECISION_HEAD_CONFLICT / 8 | 保存headを取得後のOCC結果。Gate層でcodeを書き換えない |
| final metadata破損/未知 | GATE_CORRUPT / 8 | 即停止・保持。generic retryなし |
| acquire/preparation/sync/不明公開 | GATE_ACQUIRE_FAILED / 1 | no lease / callbackなし。phase・原cause・公開観測を保持 |
| 既存gate ownership不一致 | GATE_OWNERSHIP_MISMATCH / 8 | 停止・他者名をunlinkしない |
| release/unlink/sync失敗 | GATE_RELEASE_FAILED / 6 | cleanup/Recovery要否を既存contractで判定。自動再実行なし |
| permission cause | 既存code＋EACCES/EPERM / 9 | CLI既存優先規則を維持 |
| 成功効果を証明済みでfinalize待ち | 既存error＋finalization_pending / 7 | R84-M02のfresh証明が必要。Gate存在/absenceだけではappliedにしない |

`published`は単なる「syscallがthrowしたか」ではない。linkが成功したと分かればtrue。link前の失敗ならfalse。link呼出し後例外は原errorを保ち、自己candidateとfinalの同dev/ino/全bytesならtrue、確定できなければnull。**同bytesだけ、ENOENTだけからfalse/未公開を断定しない。** EEXIST競合の再試行は§6の限定分岐であり、一般EIO/公開後sync failureのretry許可ではない。

公開後エラーが起きた取得は、再観測でtrueとなっても「成功したらしい」とleaseを返さない。final/candidateを保持し、descriptorだけを安全に閉じる。EEXIST敗者が自分の未公開candidateを片付ける場合も、自己証明・unlink・dir syncの失敗はGATE_ACQUIRE_FAILEDとして停止し、元BUSYも保持する。孤立tempが非authoritativeでもI/O failureを成功にしない。

errorExit/resultDocumentの既存優先順、canonical_effect/readiness/diagnostics/allowed_actionsを変更しない。new readiness/action/error enum、force flag、client申告leaseは追加しない。

## 9. Crash consistency・Recovery matrix

前提：file sync/dir sync/no-clobberが契約どおり成立するlocal同FS。SIGKILL試験を実power-cutやstorageのflush保証と同一視しない。

| 停止境界 | 残り得るもの / authority | restartの安全方針 |
| --- | --- | --- |
| temp作成前 | なし / なし | 通常guard後の新しい明示操作のみ。自動Request生成なし |
| temp wx後・write途中 | 空/partial candidate、finalなし / なし | candidateは保持し非authoritative扱い。他のdomain証拠を全検証。candidateをfinalへ昇格しない |
| metadata完成/file sync前後・link前 | 完成候補、finalなし / なし | 完成bytesでも他processが再利用しない。dir entry消失もあり得る。domain work開始済みと推測しない |
| link直後・最初のdir sync前 | full final＋candidate、durability不明 / callback権限なし | runtimeで取得失敗なら証拠保持・停止。restartでfinal存在なら通常取得はBUSY/破損STOP。不在なら未公開成功を推測せずdomain guardで判定 |
| final dir sync後・temp unlink/sync途中 | full final＋aliasの可能性 / なし | finalだけを所有候補として検証。aliasは新ownerの証拠でなく、無断cleanupしない |
| 全取得手順完了・callerへの応答前 | durable full final、tokenはprocess内だけ | 応答なしを未取得とみなさない。liveならBUSY、死亡してもstale PIDだけで解除しない |
| lease応答後・Receipt/Ownerより前 | full final、business bindingがない可能性 | orphan gateだけでは6Cの必要証明を作れない。現行同様manual STOP、Transactionを捏造しない |
| Receipt/Owner/実行以降に異常終了 | final＋domain evidence | 既存6C/6Dの元tx・OS終了証明・claim/barrier・fresh gate witnessで明示Recovery。pre-decision/成功後境界を変えない |
| release verify/close後・unlink前 | 既存finalが残る / 旧token失効 | 不明所有の再unlinkなし。domain証明と既存Recovery契約に従う |
| unlink後・dir sync前 | final不在/再出現/別ownerの可能性 | 不在だけでclean/READYへしない。旧tokenで再取得・他者削除不可。Retiring等の残存証拠を優先 |
| unlink＋sync完了後・応答前 | 自己finalは解放済み、別ownerがあり得る | 旧leaseは再利用不可。元Requestはreadonly照会し、再dispatchしない |

Gateだけのorphanを自動救済する新Recovery APIは追加しない。公開済みgateがvalidでも、対応Owner/Receipt/archiveが不足すれば既存のmanual STOPである。tempを使ってmissing ownerやRetiredを再生成しない。

## 10. 既存contractへの影響・採用時の差分

| 対象 | 採用時に必要な変更 / 維持する条件 |
| --- | --- |
| 反映処理・復旧 / Slice2 | 最終path wx→metadataの記述を§5の候補wx→linkへ置換。不完全**final**のSTOP、nominal lease、自己release、durabilityを維持 |
| 同 / GateWitness | metadata v1/全bytes/dev/ino/Hashは維持。candidateのinodeを完成finalへ引き継ぎ、hash一致だけで別inodeを採用しない |
| 同 / DG03 terminal cleanup | 「同common lockのwx primitive」を「本案のcommon gate exclusive publication」へ変更。gate不在例外はProof＋Completion validのcleanupだけ、adoptionは元witness固定 |
| Decision OCC | BUSY待機後に元revision/hashでCAS。publicationの先着が勝者、受付順/先temp作成を優先しない。異payload再送・staleを成功へしない |
| Bootstrap/runtime | 新candidateだけ非authoritative classとして分離。外部宣言、expected audit hash、genesis/marker/state/HWM、他の未証明tempのSTOPを維持 |
| Apply/Request | Gate取得完了前にReceipt等を公開しない。取得後は同live lease、receipt以降のretain、既存再検証/ID消費/CSV順序を維持。新Request/新IDで復旧しない |
| Recovery/reader | namespace/discovery/parser/runtimeを一緒に更新。candidateのraw観測は残し、変化したinspect hashでrunしない。terminal priority、OS proof、permanent archive/retirementを維持 |
| CLI | 既存exit tableとDTOを維持。GATE_ACQUIRE_FAILEDは取得不明の停止であり、安定したBUSYや成功と混同しない |
| 過去実装計画 | 6E/6Fの「wx窓を保持」は当時の実装記録。採用後は本案/新実装計画への追記で変更範囲を示し、過去の試験結果は書き換えない |

段階導入は停止時間を設けた単一authoritative treeで行う。全reader/writer/CLIを停止し新namespaceの既存不明残骸がないことを確認してから同一版へ揃える。旧writerと新writerの混在運用をFA-M01解消済みと扱わない。legacyのvalid full metadataはschemaを変えず検証・既存adoptionするが、旧式のempty/partial finalは従来どおりSTOP。現物を新metadataに書き換えたり、観測hash/Owner参照を付け替えたりしない。

## 11. 必要な回帰テスト（実装時）

本PRでは試験を追加・実行して新runtimeのPASSとはしない。全mutation試験は独立identityのtemp repository、test seamは非公開。

| ID | 確認事項 |
| --- | --- |
| GP01 | 正常なsingle acquisition/release、metadata v1・root・process、元inode/bytes・0600、directory sync完了までcallbackなし |
| GP02 | temp write前/途中でpauseして別process/worker取得。finalにpartialが現れず、winnerだけがcallbackへ進む。先temp作成と勝敗を混同しない |
| GP03 | 同時linkのno-clobber、同bytes別inode、同lock_id衝突、別root、symlink/unsafe/nonregular、EXDEV/ENOTSUP。rename fallbackなし |
| GP04 | EEXIST→正規unlink→read ENOENT→fresh link成功、および別ownerが先に取得するABA。旧metadata流用・他者unlinkなし |
| GP05 | read/lstat中のidentity変更、予算枯渇、monotonic期限、EIO/EACCES/EPERM。不正をENOENTで消さず、unknownをBUSYにしない |
| GP06 | 既存空/partial JSON/UTF8/array/未知version/field/wrong root/読込不能finalは停止・bytes保持。PID/時刻で解除しない |
| GP07 | 各temp create/write/file sync/readback/link/dir sync/temp unlinkのbefore/after例外。syscall後throw、published true/false/null、cause/path/phase/descriptor保持 |
| GP08 | §9の全停止境界へ実SIGKILL/再起動。候補だけ、公開済み無応答、Owner不足orphanを区別し、勝手なrestore/claim/cleanupなし |
| GP09 | release前後のunlink-after-effect/dir sync失敗、新owner取得、token二重release、copy/forged token、自己candidate cleanup失敗。元error保持 |
| GP10 | candidateの空/partial/完成/alias/孤立でnamespace分類。正確な新class以外はunknown STOP。既存bootstrap/publisherの不正を隠さない |
| GP11 | candidateがObservationHashに含まれ、書換え/追加/消失でstale token拒否。完成tempをleaseやGateWitnessへ昇格しない |
| GP12 | 元Decision draft/confirm・confirm/cancel raceをそのまま使用。通常競合で単一winner、敗者HEAD_CONFLICT。bounded BUSY時の停止も別試験で明示。失敗causeを記録 |
| GP13 | 同一Request retry/concurrency、新Request初回dispatch、ID非二重消費、History非重複。callback開始後の自動retryなし |
| GP14 | Recovery adoption/current successor、wrong predecessor/sequence/gate、RETIRING/RETIRED/SEALED、terminal-cleanup新gate、未完了gate消失STOP |
| GP15 | 既存R80/R82/R83/R84、known-mixed diagnostics、COMMIT_DECIDED後rollback禁止、HWM非巻戻し、Proof/Completion優先、reader再開 |
| GP16 | CLI BUSY5/integrity8/permission9/acquire failure1/Recovery6/applied pending7、単一JSON・非TTY/CI/--yes拒否、inspect readonly/hash/action |

[repository tests](../../test/fn004-repository.test.js)の「metadata write failure leaves incomplete lock」は、**公開前candidate失敗でfinalなし**と、**既存の不完全finalを保持・拒否**へ分割する。後者を削除しない。[6E guards](../../test/fn004-normal-apply-guards.test.js)の旧metadata窓も、旧不正final拒否と新公開前の並行進行へ分ける。単にGATE_CORRUPTを期待codeのallowlistへ追加しない。

実装PRでは6A48/6B52/6C60/6D57/6E79/6F44等の過去件数を新結果へ流用せず、focused/FN-004/通常unfiltered npm testのactual集計・exit・source前後を取得する。file並列度1でもtest内競合は残す。timeout/assertionを緩和せず、rankings/site/anomaly/Markdown/generated diff/Production hashも確認する。

## 12. 承認待ち設計判断・実装着手条件

| ID | 人間が判断する点 | 推奨 / 未採用時 |
| --- | --- | --- |
| D1 | hard linkでの完成済みmetadata公開を正式採用するか | A推奨。非対応FSでは安全停止、通常rename fallbackなし |
| D2 | 正確なcandidate namespaceを非authoritativeとし、孤立candidate保持を許すか | §5.2推奨。承認しないなら並行準備/残骸readinessの代替protocolが必要で着手不可 |
| D3 | ENOENT/identity変化時の最大8回/1秒とDecision総予算、枯渇時分類 | §6推奨。数値調整は可だが無限retry・不正final待機は禁止 |
| D4 | 対象OS/FSと運用上のorphan対応 | Node20以降/Linux/local対応FS、quiesced upgrade・原証拠保管・manual STOPを承認。自動GC/force rescueは別設計が必要 |

**本案は技術的な推奨を提示したもので、D1〜D4はまだ承認されていない。** 特にD2は既存unknown temp規則に対する明示的な限定変更であり、実装者が省略/推測してはならない。承認時に§10の正本差分、namespace/observation全経路、試験範囲を同時確定すれば実装へ進める。native代替や孤立gate自動Recoveryは今回採用しない未実装領域として残す。

本設計PRのレビューだけでFA-M01をCLOSEDにしない。実装・独立レビュー・回帰PASS・merge後の別Final Acceptanceで判定する。

## 13. 推奨実装Slice

1. **GP-A 基盤と分類を同一PRで接続**：専用candidate/metadata/ownership-aware link publisher、EEXIST観測・予算、release evidence、runtime/namespace/discovery/snapshotの必要変更。GP01〜11のdeterministic fault/crash試験。publisherだけを通常入口へ先行接続しない。
2. **GP-B Application/Recovery/CLI統合と全回帰**：Decision総予算・原cause観測、Bootstrap/Request/reader/Recovery cleanup・旧valid metadata、GP12〜16、通常一括suiteとsource/Production照合。GP-A時点の通常利用公開はGP-B完了を条件とする。分割で安全な途中状態を保証できなければA/Bを一つの実装PRへまとめる。
3. **GP-C 独立Review & Merge後のFinal Acceptance**：review済みheadのCI・post-merge検証後に受入を別判定。今回この工程は実施しない。

## 14. この設計PRの検証・非実施

文書のlink/fragment、git diff --check、branch差分が提案書1ファイルだけであることを検証する。runtime/source/tests/package/schema、Production canonical/staging/state/History/ownershipを変更しない。実Apply/init/Recovery、障害注入、rankings生成、runtime全suiteは本設計フェーズでは実施しない。§11は今後必要な試験であり、今回の成功実績ではない。

文書検証実績：32 Markdown files、481 local links、16 fragments、missing/broken 0。git diff --check成功。設計書以外の差分なし。runtime試験の実行結果ではない。
