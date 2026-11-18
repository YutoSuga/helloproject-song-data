# PR・CI運用ルール

正は[workflow](workflows/deploy-pages.yml)と[CI選択処理](scripts/ci-policy.cjs)。開発・レビュー・手動マージの流れは[開発フロー](../docs/management/開発・PR運用ルール.md)を参照する。

## 軽量／フルの選択

`ci:light`ありは軽量、なしはフル。ファイル内容・タイトル・変更量の自動分類はしない。Codexが変更内容から判断する。文書・README・開発ルール・契約に影響しない表記整理は軽量の候補。ただし安全契約・運用手順の実質変更は個別判断する。

実装、canonical CSV、ランキング処理、FN-004 runtime、workflow、テスト、公開HTML/CSS/JavaScript、安全性・整合性に影響する変更は原則フル。迷う場合もフルとし、`ci:full`は導入しない。

軽量PRは`gh pr create --label ci:light`を推奨する。ただしCLI内部ではPR作成とラベル更新が別APIのため、初回フルCIが起動する可能性がある。ラベル追加時の再実行で置き換わるので、ラベルと最新runを必ず確認する。付与できなければ成功と報告しない。

## イベントと検証SHA

| イベント | 選択・実行 | 公開 |
| --- | --- | --- |
| main宛PRのopened / synchronize / reopened | PRイベントの現在ラベルで選択 | artifact upload・Deployなし |
| PRのlabeled / unlabeled | 全ラベル変更で再判定。他ラベルの変更でも起動 | 同上 |
| mainへのpush（マージ後を含む） | 対象SHAと一致するマージ済みPRを照会して選択 | 検証成功後にPages公開 |
| workflow_dispatch | mainのみ実行、常にフル。ラベル照会なし | 検証成功後にPages公開 |
| PR closed（マージ有無を問わず） | 購読しない | closed自体による公開なし |

PRは同じPR番号・イベント名のconcurrency groupで進行中runをキャンセルし、最新ラベルで再実行する。main pushはSHAごとのgroupで検証を独立させる。

`Select CI mode`（ci_mode）はmain pushのSHAに関連するPRをページング取得し、merged_at、merge_commit_sha、base=main、同一repositoryが一致するPRを**ちょうど1件**要求する。さらにPR詳細を再取得し番号・merged・日時・SHA・base・repositoryを再照合して、その時点のラベルを読む。close時のラベルsnapshotではない。不在・不一致・曖昧・API失敗・不正データはwarningを出してフルへfallbackする。

出力shaはイベントの`github.sha`。buildとGateは同じ固定SHAをfull-history checkoutする。非main手動実行は選択jobと依存jobをスキップする。

## job・コマンド

軽量でもjob名を維持する。Gate job全体を省略せず、Node環境の初期化後にテストstepだけをスキップする。

| job表示名 | 両モードで実行 | 軽量で省略 |
| --- | --- | --- |
| Select CI mode | mode / shaの選択 | なし |
| Test and build | `git diff --check "$BASE_SHA" HEAD`、`npm run rankings:validate`、`npm run site:build`、`git diff --exit-code -- site/data/rankings` | Node 20の`npm test`（FN-004含む全テスト） |
| Gate publication (Node 20) / Gate publication (Node 24) | checkout・Node設定 | 下記のGateテストstep |
| Deploy | main push / main手動実行で、選択・build・両Gate成功後のみ | PRではjobをスキップ |

GateのフルCIコマンド：

```bash
node --test --test-concurrency=1 test/fn004-gate-publication.test.js test/fn004-gate-publication-crash.test.js test/fn004-gate-candidate-integration.test.js
```

空白検査のBASE_SHAはPRではbase SHA、それ以外はHEAD^。site buildはcanonical CSVからランキングJSONを生成する。生成物差分があれば失敗し、自動commit / pushはしない。Pages artifact uploadはmain push / main手動実行だけで行う。

## Pages公開と順序

Deployは同じrunの検証済みartifactだけを使用する。`github-pages`のconcurrency lockを取得後、公開直前にmainの最新SHAと検証SHAを比較し、古ければ公開stepをスキップする。照会失敗はjob失敗。lockは公開まで保持し、cancel-in-progressはfalse。古いrunが新しい公開の後に上書きしないようにする。FIFO保証はなく、pending jobは置き換わり得る。

公開中にmainが進めば新run成功まで古いサイトが一時的に見えることはある。外部から進行中Deployをキャンセルするとサーバー処理が継続し得るため避ける。Environmentはmainのみ許可。checkoutで認証情報を保持せず、選択jobはcontents/read・pull-requests/read、Deployはcontents/read・pages/write・id-token/writeを使用する。

## 結果の確認・失敗時

1. PRラベル、対象head SHA、最新run・イベントを確認する。旧キャンセルrunと区別する。
2. `Select CI mode`の出力と、`Run tests`・Gateテストstepのsuccess / skippedを照合し、実際のモードを確認する。
3. buildの空白・ランキング検証・build・生成物整合性、両Gate jobが成功したことを確認する。PRのDeployはskippedが正常。
4. PRのChecksとrequired checksの完了を確認する。保護設定APIを読めない場合、チェック成功とrequired指定の確認を混同せず制約を報告する。
5. ユーザーのマージ後、main push runが対象SHAで起動したか、PR照会の選択結果、全job、artifact、freshness、Pagesデプロイ結果・environment URLの公開内容を確認する。job成功だけで公開step成功を推定しない。

失敗時は最初に失敗したstepとログ・SHA・ラベル・選択結果を調べ、修正と再検証を行う。原因不明のまま軽量化して失敗を隠さない。未完了・未実施・API閲覧不可を成功扱いしない。

## 導入履歴と未検証範囲

PR #92は軽量CIを導入したが、[マージ後run 44003187811](https://github.com/YutoSuga/helloproject-song-data/actions/runs/44003187811)はbuild / Gate成功、Deploy失敗。closedイベントはcheckoutをmainにしても実行refが`refs/pull/92/merge`で、Environmentに拒否された。

PR #93でmain push方式・厳密なラベル照会・固定SHA・公開直前確認へ変更。[マージ後run 44038002025](https://github.com/YutoSuga/helloproject-song-data/actions/runs/44038002025)は全job・Deploy成功。#92の失敗履歴は維持する。

PR #92調査時、classic main branch protection APIはintegration権限不足（403）。チェック名維持とrequired設定の完全照合は別。軽量main push、fallback、非main手動拒否、古い成果物の実スキップ等は、それぞれ実測した範囲で報告する。PR-Aの軽量PR成功だけでマージ後の軽量公開まで検証済みとはしない。検証目的の自動マージは禁止。
