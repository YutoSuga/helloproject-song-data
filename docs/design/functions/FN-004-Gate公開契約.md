# FN-004 Gate 公開契約

FN-004 の共通排他 Gate の公開、取得、解放を定義する。read/write は同じ Gate を利用する。repository root は realpath で確定し、最終名は `staging/.fn004.lock` とする。最終名が排他の基準であり、domain 操作の権限は検証済みの live lease で得る。非再入と、内側 API への同じ lease の明示渡しを守る。

## 取得と公開

1. path safety と Recovery guard を検証し、GateMetadataV1 の lock ID、取得時刻、process identity、root、operation、actor 等を固定する。新規書込は JCS＋LF。Request、Transaction、Apply、Plan の identity は既存の Owner・Receipt・証拠連鎖で結び付ける。
2. 同じ staging ディレクトリに `staging/.fn004-gate-candidate.tmp-<小文字UUID v4>` を `wx`、`0600` で作成する。他の candidate と名前が衝突したら、その名前を再利用しない。
3. metadata の全 bytes を書いて file sync し、作成 descriptor の BigInt `dev/ino` と読み戻した identity・全 bytes を照合する。以後、その inode の内容は書き換えない。
4. 同一ディレクトリ・同一 filesystem で candidate から最終名へ排他的 hard link を行う。成功した link が排他取得の線形化点。通常の rename や弱い durability への fallback は行わない。
5. staging を directory sync し、最終名が非 symlink の regular file で、作成時の inode と全 bytes に一致することを再検証する。本人の作成権限と同一 inode・全 bytes を照合した自己 candidate 名だけを unlink し、再度 directory sync する。
6. private な nominal lease を作り、取得後の guard と所有権の確認を通過した場合だけ caller に返す。domain callback、Receipt/Owner 公開、ID 消費、CSV 更新はこの完了後。取得後 guard が拒否した場合は、本人の検証済み解放を行い、解放も失敗した場合は元の操作エラーを内部証拠に保持する。copied/serialized token、同じ hash の別 inode、client 申告は権限を与えない。

## Candidate と証拠

上記の正確な root-relative 名を持つ regular candidate は非権威の準備物。空・部分書込・完成・孤立・最終名と同一 inode のいずれも、lease、Owner、完了、再公開の根拠にしない。非 regular、symlink、不正な namespace、および安全性を確認できない listing/read は停止する。listing 中の名前消失は権限を与えない。

汎用 publisher temp より先に専用 candidate を分類し、汎用 cleanup、transaction の ArtifactRef、bootstrap intent/temp 判定へ加えない。他者・孤立 candidate の削除、再利用、自動 GC を行わない。Discovery の raw path/kind/bytes/hash は保持し、追加・変更・消失は Observation v2 の fresh hash や競合判定に反映する。保存 schema と projection は [Transaction / Recovery](FN-004-反映処理・復旧.md) に従う。

## 競合と取得予算

`EEXIST` の後は同一 descriptor の regular file、BigInt identity、全 bytes、strict JSON・完全な metadata 型・root を検証し、path identity を再照合する。新しい inode を観測した場合はその inode 自体を検証する。legacy の valid metadata は、通常競合の判定で新規書込の canonical serialization を必須としない。Recovery の exact witness は別途検証する。

| 観測 | 結果 |
| --- | --- |
| 安定した valid 他 owner | `GATE_BUSY`。本人未公開の候補だけを作成権限と inode・bytes の照合後に掃除し sync |
| 正常に読めた名前の消失、検査中の `ENOENT` | 所有や正常 release は未確定。新しい exclusive link に限り、予算内で再試行可能 |
| 空・不正 UTF-8/JSON・未知 field/version・root 不一致・不正/検証不能 final | `GATE_CORRUPT` として停止。後続の `ENOENT` で既に観測した不正を打ち消さない |
| 自己公開が確認できた link 例外、安定 owner を確定できない連続変化、予算枯渇で owner 不明、公開/同期異常 | lease を返さず `GATE_ACQUIRE_FAILED`。元 cause と観測結果を保持 |

初回 link 以外の再 link は最大8回。最初の競合から monotonic 1秒と [Decision](FN-004-判断モデル.md) の残り予算のうち短い方を適用する。候補の metadata は同一取得内で固定し、再試行前に candidate identity、path safety、guard を再検証する。期限は開始済み syscall/callback の強制終了を保証しない。Decision の5秒、安定 BUSY 待機、取得後の元 head CAS、callback 開始後の再 dispatch 禁止は判断モデルが定義する。元 witness を採用すべき Recovery に通常取得の再試行を使わない。

## 解放、エラーと crash 境界

live lease を解放中として再利用を止め、本人の最終名の dev/ino・全 bytes を確認後、descriptor を閉じ、本人名を unlink し、staging を sync する。所有権を確認できない名前は unlink しない。unlink/sync 等の異常では token を失効させ、元 cause と `same/absent/other/unknown` の再観測を保持する。不在観測だけで durable release とせず、再 unlink は行わない。別 owner が取得した最終名は保持する。

取得異常は関連する path、phase、元 cause/errno、candidate 名、descriptor、`published` を内部証拠として保持する。link 前は false、公開を証明できれば true、確定できなければ null。通常の EEXIST 敗者として未公開を確認した場合は false。link 例外の後は ENOENT や同じ bytes だけで未公開・自己公開を確定しない。公開 true/unknown では lease を返さず、その時点で残る証拠を追加削除しない。自己 candidate の unlink 後の sync 失敗時など、すでに失われた名前の存在は保証しない。通常競合時の自己 candidate cleanup に失敗した場合も、元 BUSY と cleanup エラーを保持して停止する。

| 停止境界 | 再開時の扱い |
| --- | --- |
| candidate 作成前／write途中／sync後で link 前 | final 公開の権限はない。残存候補を昇格せず、他の domain guard を検証する |
| link 後から directory sync・照合・自己 candidate cleanup 完了まで | full final や alias が残り得る。callback の権限はまだない。final があれば独立に検査し、同期失敗や不在から成功を推測しない |
| 取得完了後、応答または Receipt/Owner より前 | valid final が残り得る。対応する権威証拠を欠く Gate 単体の孤立は手動停止。PID/時刻だけの自動解除は行わない |
| Receipt/Owner 確立後 | 元 witness・元 transaction を既存 Recovery の証拠で検証。fresh Proof と Completion による terminal cleanup の不在例外、adoption、retirement の順序は [Transaction / Recovery](FN-004-反映処理・復旧.md) が定義 |
| close／unlink／sync の途中と解放完了後 | 再試行で他 owner を消さない。未完了の retirement と元 Request の readonly 照会は各契約に従う |

CLI の exit 優先順と公開 JSON は [サービス・CLI契約](../system/楽曲管理のアプリケーションサービス・CLI契約.md#fa-m01-gate公開異常の扱い) に従う。たとえば release の内部 `release_observation` や `operation_error` は [CLI 出力の allowlist](../../../src/canonical-cli-output.js) で公開される field ではない。成功効果は fresh な正式証拠で判定し、Gate の存在・不在で判定しない。

## 対応環境と限界

Node.js 20 以上、Linux、同一の対応 local filesystem が前提。安全なパス、BigInt identity、atomic no-clobber hard link、file sync、directory sync が必要。未対応の primitive は安全停止し、弱い方式へ切り替えない。協調する local writer と単一の authoritative tree を前提とし、旧 writer との混在を対応構成としない。

隔離 fixture の syscall、実 SIGKILL/restart、Node 20/24 の CI で確認された範囲と、実運用 volume の適合、物理電源断時の flush 保証は別である。容量・inode の監視と証拠保全・手動停止は [操作ガイド](../../management/FN-004-canonical操作ガイド.md#fa-m01-gate公開異常の扱い) を参照する。

## 根拠と検証箇所

[設計承認 #85](https://github.com/YutoSuga/helloproject-song-data/pull/85)、[実装 #86](https://github.com/YutoSuga/helloproject-song-data/pull/86)、[原本回収 #87](https://github.com/YutoSuga/helloproject-song-data/pull/87)、[独立検証 #88](https://github.com/YutoSuga/helloproject-song-data/pull/88)、[正式再受入 #89](https://github.com/YutoSuga/helloproject-song-data/pull/89)、[別 finding のクローズ #90](https://github.com/YutoSuga/helloproject-song-data/pull/90)。承認資料は[当時の文書配置](https://github.com/YutoSuga/helloproject-song-data/blob/dc93832d1ac1ce291fd33337b7de9c64e21b57cb/docs/history/plans/FN-004-FA-M01-Gate公開契約案.md)で参照できる。

- 実装は [publication](../../../src/fn004-gate-publication.js)、[lease](../../../src/fn004-gate.js)、[candidate](../../../src/fn004-gate-candidate.js)、[Decision](../../../src/fn004-decision-application.js)。
- 回帰は [publication](../../../test/fn004-gate-publication.test.js)、[crash](../../../test/fn004-gate-publication-crash.test.js)、[candidate integration](../../../test/fn004-gate-candidate-integration.test.js)、[Decision lifecycle](../../../test/fn004-decision-lifecycle.test.js)。
