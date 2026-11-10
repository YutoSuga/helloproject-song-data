# FN-004 canonical management CLI

`npm run canonical:manage -- <command>` は既存FN-004 application serviceのlocal adapterです。
作業対象repositoryのrootで実行します。公開HTTP API・SCR-002・DBは含みません。
操作前に別作業者のApply、収集、直接CSV編集、Git checkout等を止めてください。
productionでのテストApply・initialize・Recovery runは禁止です。以下の更新例は隔離fixtureで検証します。

正式契約は[interface](design/楽曲管理のCLI・画面連携.md)、[Transaction / Recovery](design/FN-004-反映処理・復旧.md)、
[Approval / Request](design/FN-004-承認・反映リクエスト.md)、[bootstrap](design/FN-004-初期化・ID状態.md)です。
保存原本は手編集せず、外部入力documentだけを編集してserviceへ取り込みます。

## Commands

全commandで `--json` を使用できます。未知option、重複option、不正なID/hash/revisionは拒否します。
IDは出力された値を使い、hashは小文字64桁、revisionは正整数です。

| Command | 必須入力 / option | Service |
| --- | --- | --- |
| `status` | なし | Bootstrap status / composite runtime guard |
| `init --check` | `--external-declaration <file.json>` | Bootstrap audit |
| `init` | `--external-declaration <file.json> --expect-audit-hash <hash>` | 再監査・TTY確認・initialize |
| `decision template` | `--candidate <candidate-id>` | readonly source token / 空の判断template |
| `decision import` | `--input <external-input.json>` | strict JSON / immutable draft保存 |
| `decision show <decision-id>` | なし | validated store / current head |
| `decision validate <decision-id>` | `--revision <n>` | readonly source / canonical / confirmation validation |
| `decision confirm <decision-id>` | `--revision <n> --expect-head <content-hash>` | OCC / immutable confirmation |
| `plan create` | `--decision <id> --revision <n> --expect-decision-hash <hash>` | Plan generate / identity照合 / save |
| `plan show <plan-id>` | なし | Plan reader |
| `plan check <plan-id>` | なし | current Plan validation |
| `apply` | `--plan <plan-id> --expect-plan-hash <hash>` | TTY確認→独立Approval→durable Request→6E executor |
| `result` | `--request <request-id>` | readonly Request evaluator |
| `history show <apply-id>` | なし | 完全History / composite state proof reader |
| `recovery inspect` | `--request <request-id>` | double collection / OS probe / pure classifier |
| `recovery run` | `--transaction <tx-id> --expect-state-hash <hash> --action <action>` | 6C / 6D ownership / 再検証 / executor |
| `help` / `--help` | なし | command inventory |

interface設計の15提案commandを上記に接続します。Decision cancel、独立したApproval保存／再submit、
失効event操作、任意patch、lock削除、batch Apply、公開test hookはCLIに追加しません。
内部serviceのdefault acceptance-only APIを変更せず、CLIだけが6E compositionを選びます。

## Bootstrap

1. `status`で状態を確認します。exit 0でもApply可能とは限りません。
2. 未初期化の場合、正式external declaration documentを外部fileに用意します。
   `schema_version:1`、全14 namespaceの`namespaces`、正式`statement`、`evidence`が必要です。
   statementは `known_used_id_upper_bounds_including_outside_authoritative_history`。
   `note`は任意、evidence要素は`{kind:"url"|"human_note",value:<nonempty>}`です。
   数値を自動推測・補完せず、authoritative historyの外も含めて人間が監査します。
3. `init --check --external-declaration <file>`でorigin/main全reachable履歴とcanonicalを監査し、audit hashを確認します。
4. `init --external-declaration <file> --expect-audit-hash <hash>`をlocal TTYで実行し、repositoryと監査結果を読み、`[y/N]`で確認します。
5. 実行直前にも再監査します。hash不一致・片側marker/state・破損はSTOPし、自動修復しません。

確認待ちにgateを保持しません。確認取消しではstate/markerを公開しません。
既存bootstrapのdeclarationを新しい監査宣言へ自動流用しません。
初期化済みのvalid lineageへのinit再送もTTY確認を行い、正式serviceが`BOOTSTRAP_ALREADY_INITIALIZED`と既存identityを返します。
新しいgenesis/auditを作成せず、stateやmarkerを上書きしません。fresh audit hashの照合は新規初期化のguardです。
`recovery_required`等の事前条件失敗は元codeで拒否し、audit hash不一致に読み替えません。

## Decision → Plan → Apply

`decision template --candidate <id> --json`の`data`を外部JSONとして保存します。
templateはidentity判断を自動決定せず、source facts / fingerprintだけを固定します。
人間がwork/song identity、既存参照・新規entity、relation、根拠を記入してください。

外部documentは正確に次のfieldだけを持ちます。

```json
{
  "schema_version": 1,
  "decision_id": null,
  "base_revision": null,
  "base_content_hash": null,
  "mutation_key": "templateで生成されたUUID",
  "content": { "templateで生成された正式Decision contentを編集": "例示のみ" }
}
```

新規ID・revision・時刻・actorはserviceが決めます。actorはOS user/hostから得たstable local identityのhashで、
`local_process`を記録します。外部documentやoptionからactorを受け取りません。
既存draft更新ではshowのheadを使い、`decision_id`、`base_revision`、`base_content_hash`を指定します。
保存原本のJSONを編集しないでください。新しい編集には新しいmutation key、同じ取込のretryには元keyを維持します。

`import`後に`show`／`validate`し、返されたrevision・content hashで`confirm`します。
Plan createには有効confirmedのrevision/hashを指定します。staleなら新しい判断・Planを確認し直します。
Planを作ってもApplyは開始せず、予定IDは予約されません。

Applyはstdinとprompt出力先stderrがTTYの場合だけ許可します。CI、stdin pipe、`--yes`は禁止です。
repository、Decision/Plan、全operation、予定ID、reuse/no_op、warning、変更CSVを表示し、`[y/N]`で一度確認します。
JSON modeでも同じ確認が必要です。取消しはApproval/Receipt作成前に終了します。
確認後もApproval/Request serviceが現時点のpreconditionを再検証します。
no-opだけでも成功Historyを残しますが、canonical bytesやID上限は変更しません。

durable Receipt受付後はRequest IDをstderrにも表示します。Receipt後のSIGINT／切断／例外は失敗確定ではありません。lockを削除せず、出力されたRequest ID、
または保存済みApprovalのintended_request_idを確認してresult／Recovery inspectへ進んでください。
新しいApplyを再送して復旧しないでください。同Requestのresultはreadonlyで、ID・transaction・apply_timeを作り直しません。
受付を確認できない公開失敗では`intended_request_id`を表示し、durable受付済みの`request_id`と区別します。tempの存在だけで受付済みと判断しません。
成功Historyが存在してもcleanup未完了を隠しません。Git commit/push/PR作成はCLIが行いません。

## Result / History / Recovery

`result --request <id>`は元Receipt・Proof/Completion・History・state・readinessを検証して返します。
`history show <apply-id>`は全History chain / semantic setと現在のstate proofを検証します。
失敗側terminalが介在した場合は既存composite transaction proofを使用し、success-only validatorの拒否境界を弱めません。
History不在を「未受付」「再実行可能」と読み替えません。

`recovery inspect --request <id>`はreadonlyで、`data.observed_state_hash`と`allowed_actions`を表示します。
空のallowed_actionsはrun許可ではありません。UNKNOWN、破損、Ownerなし、終了証明不能ではSTOPします。
runにはinspectのtransaction ID、hashと唯一のactionをそのまま明示します。
actionは`abort`、`rollback`、`finalize_success`、`finish_terminal`、`cleanup`だけです。

runはfresh collectionとhash/action照合、OS終了証明、immutable ownership/claim、gate下の再検証を経ます。
観測が変われば再inspectが必要です。COMMIT_DECIDED後はrollbackせず、high-waterは復元しません。
既存Proof/CompletionやRETIRING/RETIREDからpre-terminal処理へ戻りません。
Recovery操作主体は現在の信頼済みOS actorとして記録し、元Receiptのactorやidentityは変更しません。
Receipt-onlyでOwnerがない場合や未知bytesを、backupがあるという理由で強制restoreしません。

## Output / exit

通常出力はoutcome、canonical effect、readiness、diagnostics、allowed actionsと検証済みdataです。
`--json`のstdoutは単一document、promptはstderrです。`.npmrc`の`loglevel=silent`はnpm自身のbannerを抑制し、
子processの出力を抑制しません。wrapperがnpm設定を上書きする場合は`npm --silent run canonical:manage -- ... --json`を使用します。
JSON modeでstdoutを保存しても、Apply確認のstdin/stderrはTTYでなければなりません。

| Exit | 意味 |
| --- | --- |
| 0 | 操作／取得成功、already_appliedを含む。status/show/inspectの0はApply許可ではない |
| 1 | 想定外／不明・読取失敗等。完了と推測しない |
| 2 | 不正command/option/ID/hash/revision、必須引数不足 |
| 3 | validation/blocked/unsupported、非TTY／CI拒否 |
| 4 | stale Plan／audit hash不一致 |
| 5 | busy |
| 6 | Recovery必要／観測hash・action不一致 |
| 7 | 成功canonical effectは検証済み、finalization/cleanup待ち |
| 8 | OCC／integrity conflict／破損証拠 |
| 9 | 権限（元errnoをcauseから判定） |
| 10 | 実行前取消し |
| 11 | aborted／rolled_back |
| 12 | bootstrap required／incomplete |

message文字列では分岐しません。unknown exceptionやI/O例外を成功DTOへ変換しません。
Request resultには元DTOを保持し、canonical effectと通常readerの利用可否を区別します。

## Known limitation / safe STOP

既存gateはwx作成とmetadata書込みの間に未完成JSONを観測し得ます。
mainの既存deterministic regressionと同じ`GATE_CORRUPT`／`PERSISTENCE_PARSE_FAILED`でSTOPします。
CLIではintegrity exit 8であり、busyへの読み替え・自動unlockをしません。
status/show/Apply/result/Recoveryにも影響する可用性制約です。再実行成功を根治と扱わないでください。
lockの経過時間・PID不存在だけで削除せず、元証拠を保持して調査してください。
自動継承に必要な実OS probeは現在Linuxのboot/start/namespace evidenceを使用します。別host・PID再利用・証明不能なplatformはmanual STOPであり、TTYやlocal actorだけでは継承しません。

本CLIは既存row update/delete、Candidate削除/status変更、自動Recovery、SCR-002、HTTP API、DBを実装しません。
