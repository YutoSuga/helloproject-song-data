# FN-004 Slice 6F — Public CLI Integration / End-to-End Verification

開始mainはPR #83 merge `a4a0fd0df2fdaa82ed8c0c1e740add8146bcd0d4`。
正式[interface](../design/楽曲管理のCLI・画面連携.md)、[Transaction / Recovery](../design/FN-004-反映処理・復旧.md)、
[Approval / Request](../design/FN-004-承認・反映リクエスト.md)、[Slice 6 Planning](FN-004-Slice-6-Planning.md)を維持する。
利用方法と全command／optionは[CLI guide](../canonical-cli.md)に記載する。

## Boundary / inventory

`canonical:manage` → [executable](../../scripts/canonical-manage.js) → [CLI adapter](../../src/canonical-cli.js)
→ 既存Bootstrap / Decision / Plan / Approval-Request / 6E apply / 6C-6D Recovery。
[parser](../../src/canonical-cli-arguments.js)と[output / exit](../../src/canonical-cli-output.js)を分離する。
保存schema/hash、Request response、readiness/action enumは変更しない。

[application composition](../../src/fn004-management-application.js)はexpected Decision revision/hashと生成Planを照合し、
通常ApplyのApproval・元Request・readonly結果確認を接続する。actor、ID、mutation key、transactionを外部から偽装しない。
初回submit以外のcheck/resultはexecutionを呼ばない。

Decision applicationにsource-bound template、strict外部draft import、readonly show/validate、expected-head confirmを追加する。
保存・OCC・source fingerprint・confirmation完全性は既存lifecycle / core / canonical validatorへ委ねる。
importのID/revision/時刻/actor/hashを外部入力から採用しない。新規IDはserviceが生成し、既存更新は明示base tokenを要求する。
同mutation keyの取込は元recordへ照合する。

History showは既存runtime guardと全History/schema/hash/chain/set/state検証を使う。
失敗側terminalが介在した場合だけ既存transaction-terminal-v1 contextを使い、success-only APIのfalseをtrueにしない。

Recovery対象Bindingは保存Receiptとbootstrapからstrictに解決し、元入力全体の検証は既存collectorへ委ねる。
inspectはdouble collection＋実OS probe＋pure classifier。runはhash/actionを先に照合し、validated snapshotの成功境界から
既存6C/6D serviceを選び、そのservice自身がownership取得・gate下再収集・hash/action照合を行う。
CLIにroll-forward/rollback処理、claim発行、force unlockを複製しない。
Recovery operatorはCLIの信頼済みOS actorを別contextとして既存executorへ渡し、元ReceiptのBinding.actorは変更しない。
executor/authorityはcontextをawait前に複製・検証する。既存内部callerのdefaultは維持し、public actor optionを追加しない。

## TTY / interruption / output

Applyとinitializeはstdin・stderrのTTYを要求し、CIとstdin pipeを拒否する。
確認待ちにgateを保持せず、確認後のApproval／bootstrapはserviceが再検証する。
確認取消し／Ctrl-CはApproval・Receipt作成前にexit 10。
Receipt後はCLIがlockを削除しない。実行中SIGINT/SIGKILL後はreadonly inspectと明示runだけで継続する。

JSONは単一stdout document、promptはstderr。npm自身のbannerだけを`.npmrc`で抑制する。
原DTOはdataに保持する。errorはcode・diagnostics・path/phase/published/descriptor・cause codeを保ち、stackや任意messageを出力しない。
成功side I/O例外は元例外を保持する。追加readonly収集でdurable decision＋exact validated targetを証明できた場合だけ
成功canonical effectと後処理待ちexit 7を表示する。完全検証済みfailure terminalは11、不明状態を成功DTOへ変換しない。
Bootstrap checkの元typed causeは非列挙で保持し、CLIのpermission分類に用いる。保存artifactへcauseを追加しない。

## E2E / regression

- [contract](../../test/fn004-cli-contract.test.js)：closed parser、ID/hash/revision、bypass拒否、exit分類、診断出力。
- [E2E workflow](../../test/fn004-cli-e2e.test.js)：実Node/npm process、Decision外部入力→confirm→Plan→TTY Apply→History/result/terminal、bootstrap、取消し、非TTY/CI、readonly、ID range。
- [crash](../../test/fn004-cli-crash.test.js)：Receipt/Owner/PREPARING/PREPARED/ID/CSV/COMMIT_DECIDED/History/state/Proof/Completion/gate release境界の実SIGKILL→別CLI inspect/run。
- [safety](../../test/fn004-cli-safety.test.js)：metadata race STOP、実OS permission、SIGINT、retirement再開、syscall障害とforward-only restart。

全更新試験はtemp repository。PTY driverと境界hookはtest fixtureだけに置き、public optionや環境変数へ公開しない。
既存6A〜6Eのconcurrency/UNKNOWN/known-mixed/typed error/no-clobber/process kill回帰を維持する。
productionの開始・終了inventoryを別途実測する。CLIでproductionへのApply・initialize・Recovery runは行わない。

## Known limitation / scope

gate acquisition/metadata protocolはmainから変更しない。既存wx→metadata窓はGATE_CORRUPT / PERSISTENCE_PARSE_FAILEDで安全側STOP。
CLIはexit 8を返し、busyへ読み替えず、lockを削除しない。現mainの既存deterministic regressionと同じ可用性制約として残す。
単なる再実行成功を根本原因の解消と主張しない。

SCR-002・HTTP API・DB・Git自動化・Candidate削除/status変更・canonical既存row update/delete・FN-002/003仕様変更は含めない。
実装PRはOPENで独立レビューへ渡し、このタスクでmergeやbranch cleanupを行わない。

## Adapter self-review

未知例外に非array diagnosticsが付くと表示処理が二次例外になった点は、修正前assertion FAILを記録し、
code付き安全なfallbackへ修正した。Error内部・stack・任意messageをserializerから漏らさず、必要なcause codeと公開情報を保持する。
required bootstrap欠損をundefined validator入力へ渡さず、既存collectorと同じtyped missing/path境界に揃えた。
外部入力の不正UTF-8も既存typed codeを使用する。保存schemaやdomain判定を変更する修正ではない。
parserのcommand lookupはown entryだけに限定する。`constructor`等の未知commandがTypeErrorとなる修正前再現を記録し、引数exit 2へ統一した。
Decision template/validateのcollection shapeは既存validateCandidatesを再利用し、不正collectionをfilter時のTypeErrorへ落とさない。

initialize前のcheckが返すtyped cause／blocked statusをhash不一致へ上書きしない。修正前FAILを記録し、
permission・integrity・bootstrap incompleteをそのまま分類する。init --checkのblocked状態もexit 12等へ分類し、
不完全marker/stateの実CLI initialize拒否を回帰試験に含める。

引数末尾改行の疑いは修正前の再現で既に拒否されると確認し、不具合扱いしなかった。
テストのallocation event件数はtransactionごとではなくnamespace rangeごとの正式contractへ合わせ、
単一transaction・range coverage・重複消費なしを確認する。crash fixtureの既存Approval参照もBindingへ修正した。
これらの途中runを最終PASSの根拠へ流用せず、最終sourceの全suiteとCLI groupで確定する。

## Managed environment regression budget

既存6Cのrestore直後SIGKILL試験は、連続実行で180秒上限に達した。
同じassertionの単独比較は、未変更main約130秒／feature約121秒で成功した。
長時間のproof検証とrestartを含む9境界の有限budgetを900秒へ揃え、停止境界・assertion・skip条件は変更しない。
再実行成功だけで環境変動の根本原因を解消したとは扱わず、連続実行の完了も確認する。

## Bootstrap replay adapter correction

正式bootstrap契約のvalid lineage再送はBOOTSTRAP_ALREADY_INITIALIZED＋既存identityであり、
checkが意図的に返すaudit_hash=nullをstaleへ変換しない。新規初期化だけfresh audit hashを照合し、
TTY確認後は既存initialize serviceのfresh gate/revalidation/idempotencyを使用する。
READY／BOOTSTRAP_REQUIRED以外のcheck statusは、readinessがrecovery_requiredの場合も元codeで拒否する。
修正前は実TTY再送で4対期待0、構造化Recovery preconditionで4対期待6のFAILを記録した。
これらの修正後は全CLIファイルを再実行し、旧CLI結果を最終件数へ重複計上しない。
