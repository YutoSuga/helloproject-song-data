# FN-004 内部処理設計｜Gate 取得・解放

基準は main `6eaeaa2a3e6f3fe5e4a96eef33aeb55bc200a3c9`（PR #109 反映済み）。操作全体は [全体処理設計](00-全体処理設計・APIリファレンス.md) を参照。

## 1. 処理概要

FN-004-61。reader/writer が共通して一つの安定した checkout を排他的に扱う。acquireGate / withCanonicalGate / releaseGate。Linux・Node 20以上、hard link・ディレクトリ同期を支える環境が前提。

## 2. 入力項目定義

| 項目 | 型 | 必須 | 設定元 |
| --- | --- | --- | --- |
| root / operation | path / 非空文字列 | 既定あり | 対象 checkout、操作名 |
| actor | 文字列/null | 任意 | 信頼済み caller |
| gate | live token | 任意 | 所有済み lease の再利用、解放では必須 |
| fn | callback | wrapper で必須 | Gate 所有中の操作 |
| io | adapter | 任意・内部 | 既定は filesystem |

## 3. 参照データ定義

| データ | ファイル・取得元 | 項目・比較キー | 用途 |
| --- | --- | --- | --- |
| 正式 Gate | staging/.fn004.lock | version、root、lock_id、PID・host・boot等、bytes、dev/ino | 他者の占有と自己所有 |
| Gate 候補 | staging の専用 temp | UUID、dev/ino、期待 bytes | atomic publication と証跡 |
| 所有者／復旧 | OS process identity、復旧 mutex/証跡 | PID、開始識別子・namespace、claim/retirement | 通常操作との競合防止 |
| lease | プロセス内 token と descriptor | 同一 token、root、active、descriptor | forged / 解放済み token を拒否 |

## 4. 処理詳細

1. root を解決し、同 scope のネストには既存 token の受渡しを要求。未処理の復旧所有権を確認し通常取得を制限。metadata は version=1、UUID lock_id、root、pid、operation、exclusive、開始時刻、actor、host/platform、process instance と開始/boot/PID namespace を保持。
2. JCS＋改行 bytes を専用候補へ wx/0600 で書き、ファイル同期、descriptor とパスの inode・bytes を照合。完成候補を hard link で正式名へ no-clobber 公開。
3. EEXIST 時に正式名を独立に観測。安定した別所有者なら自分の候補だけを照合して削除・同期し `GATE_BUSY`。不正な正式名は `GATE_CORRUPT`。名前入替等では候補とガードを再確認し最大8再試行、最初の競合から最大1秒、外側予算があればその範囲内。Decision の busy 再取得は別途最大5秒。通常取得すべてが5秒待つ仕様ではない。
4. 成功時は staging を同期、正式名が同じ inode・bytes か確認、候補 unlink・再同期。descriptor を保持して live token を登録。wrapper で渡された token は所有チェックだけで再利用する。専用候補の存在だけから正式所有や実行結果を推測しない。
5. 解放は token の active、同 root と descriptor、正式名の同一 inode/bytes を確認。無効化して descriptor close → 正式名 unlink → staging sync。不一致・unlink・sync 失敗は typed error。callback が失敗しても元 lease が active なら解放を試みる。委譲済み・保全済み lease を二重解放しない。
6. crash や公開成否不明時は候補/正式名が残り得る。失敗保全は descriptor のみ閉じ、正式名を消さない。元所有者の終了・移譲の決定は Recovery の OS/取引証拠に従う。

## 5. 登録・更新仕様

| 対象 | 操作 | 項目・算出元 | 条件 |
| --- | --- | --- | --- |
| 専用候補 | 作成／所定削除 | 完成 metadata bytes | 公開成功、または検証済み別 owner に負けたときだけ対象候補を除去 |
| .fn004.lock | hard link／unlink | 同 inode の metadata | 公開と解放で親 sync |
| descriptor/lease | メモリ登録・無効化 | token と開いたファイル | 正式所有確定／解放 |
| CSV・state 等 | 変更なし | callback が別処理として扱う | Gate 自体は業務データを書かない |

## 6. 出力項目定義

| 項目 | 型 | 条件 |
| --- | --- | --- |
| token | {lock_id,root,operation,acquired_at} | 取得成功、所有検証済み |
| wrapper 結果 | callback の値 | 解放までの成功 |
| エラー | code、phase、published、path/temp 等 | 公開・解放段階に応じる |
| CLI | 診断・exit | 単独の lock 操作 CLI はなし |

## 7. エラー仕様

| コード | 条件 | 対応 |
| --- | --- | --- |
| GATE_BUSY | 安定した valid 他 owner | 終了を待って再取得 |
| GATE_CORRUPT | 正式名の型・内容・root 等が不正 | 残存証拠を保持して調査 |
| GATE_ACQUIRE_FAILED | 作成、確認、公開、同期失敗 | phase/published と残存物を確認 |
| GATE_OWNERSHIP_MISMATCH / GATE_RELEASE_FAILED | token/正式名不一致・解放失敗 | 追加副作用を停止、元証拠を確認 |
| GATE_NESTED | scoped lease を渡さず同 root を再取得 | 元 token を内部呼出に渡す |

## 8. 処理例

二つの候補が完成しても正式名は hard link に成功した一つだけ。敗者が安定した勝者を観測した場合は自己候補だけを削除する。成功側が正式名公開直後に crash した場合は正式名と候補の双方が残り得る。候補が古いことだけでは解除できない。

## 9. 実装・テスト対応

| 段階 | 実装 | 回帰 |
| --- | --- | --- |
| 1、4、5 | acquireGate、assertGateOwnership、releaseGate、withCanonicalGate | token、競合、解放 |
| 2–4 | publishGate、observeFinal、verifyPublishedGate | candidate/publication/crash |
| 6 | closeRetainedGate、adoptRecoveryGate | 復旧所有者・candidate integration |

[Gate](../../../../src/fn004-gate.js)・[公開](../../../../src/fn004-gate-publication.js)・[回帰](../../../../test/fn004-gate-publication.test.js)・[crash](../../../../test/fn004-gate-publication-crash.test.js)・[詳細契約](60-Gate公開契約.md)
