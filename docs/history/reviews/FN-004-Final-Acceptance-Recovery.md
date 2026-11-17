# FN-004 旧Final Acceptance報告 — 原本回収記録

これは旧監査報告の保存・出所確認の記録であり、現在のFN-004の受入判定ではない。原本内のBLOCKED、OPEN、テスト結果、未公開という記述は当時の史実として保持し、現在の実装・公開状態に合わせて更新していない。コード修正、Production操作、FindingのCLOSED判定、Final Acceptanceの再判定、mergeは実施しない。

## 保存した原本

- [報告書原本](FN-004-Final-Acceptance.md)：元pathと同じ場所へraw bytesをそのままコピー。本文・リンク・判定を一切編集していない。
- [元Git bundle](../../reviews/archive/fn004-final-acceptance-report-48cac96.bundle)：指定されたbundleそのもの。元branchの2コミットと履歴を保全する。
- [取得元・hash・逐語抜粋](../../reviews/archive/fn004-final-acceptance-report-48cac96.provenance.json)：機械可読の取得記録。

| 項目 | 原本の識別情報 |
| --- | --- |
| 元branch | `docs/fn004-final-acceptance` |
| 元commit | `48cac96f36d913402c1be4c5b7e6ecc9d51eee58` |
| 本文初回commit（親） | `7f02277fbf891bc778d2e5e2d6025fa363f1dbf4` |
| 当時の監査main | `e119556c1703e7ea963a327832cacf5a3affb647` |
| 報告書Git blob | `2fe144c5a3fa0fafbb3d7c75b7c05188a5e3ac10` |
| 報告書bytes / SHA256 | 37,023 / `bfab235e98731d4a441ee5f5c55a226f4f5ddbed8e25d66a1c52928070dc92a9` |
| bundle bytes / SHA256 | 17,171 / `959e79f4cc8f7661328fc7b81a984ff9797b187aa328b5b014f0962cc281f9dc` |
| 取得元bundle | `/workspace/scratch/fn004-final-acceptance-report.bundle` |

元branch・commit内の報告書と、別のbare repositoryへbundleから復元した報告書がbyte単位で一致した。bundleは監査main `e119556c…` をprerequisiteとするincremental bundleであり、単体で全repository履歴を含むものではない。元branch・既存作業branchは変更していない。

原本の相対リンクも変更していないため、GitHubで開くと保存先branchのファイルを指す。当時のsource・正式contractは監査main `e119556c1703e7ea963a327832cacf5a3affb647` のtreeで確認する。保存先の現在のsourceと当時の内容が同一であるとは主張しない。

補助資料 `/workspace/scratch/fn004-final-acceptance-report-final.md` も発見したが、SHA256は `10450ca798915210fd80c30d69e6f837b4e0b4b01c36884906a69447ed506025`、36,034 bytesであり、両Git commitの報告書と一致しない。元commitとbundleで一致した版を原本として選び、このscratch副本を代用していない。各版のhash・取得元はprovenanceに記録した。

## FA-M01・FA-L01の指摘原文

以下は原本§9の表からそのまま抜粋した行であり、今回の評価ではない。

```text
| FA-M01 | MEDIUM / Slice2・4、既知問題の受入再現 | `draft/confirm and confirm/cancel races cannot lose an update`が期待DECISION_HEAD_CONFLICTに対しGATE_CORRUPTでFAIL。file並列度1でもtest内部のPromise.allSettledは並行。winner1件のassertは通過したが、その後半の検証へ進めない | 共通gateのwx/metadata検査窓に関係する既知可用性問題。新規データ破損は確認していないが、必須の現行main一括検証が未達。別fix PRで公開/検査競合を設計・修正し、deterministic regressionと全suiteを再検証する。corruptをBUSYへ一律に丸める/自動unlock/期待assert緩和はしない | OPEN、blocking。CIや過去/lucky再実行PASSで置換しない |
```

```text
| FA-L01 | LOW / 横断文書 | 現行sourceでは6D〜6F接続済みだが、正本Decision/Plan/Transaction冒頭に現在形の「runtime未実装」が残る。現在の進捗注記は実装済みAPIへの対応を示すべき。#81のI/S表は固定SHA時点の正しい調査として別扱い | 誤った運用理解を招く文書保守問題。schema/安全手順の矛盾や未実装codeの証拠ではない。本表/実装対応表とCLIガイドを現行auditの根拠とし、別docs PRで正本status注記/現行対応への案内を整理する。固定SHA調査の史実は書き換えない | OPEN、非blocking。今回のreport-only PRへ無関係な一括cleanupを混ぜない |
```

## CLOSED条件について原本から確認できる範囲

原本にFA-M01／FA-L01それぞれの独立した「正式CLOSED条件」は明記されていない。§9には両FindingのOPEN判定・対応、§14には後続作業がある。以下は§14の原文であり、新しいCLOSED条件の定義・補完ではない。

```text
2. FA-M01を別fix PRで調査・修正。gate metadata公開/検査窓、破損lock拒否、同時Decision更新、実CLI code、crash/ownership/durabilityを回帰検証してmainへ取り込んだ後、新しい固定mainでFinal Acceptanceを再実施する。
```

```text
3. FA-L01は別docs PRでstatus注記を整理。固定SHA資料の史実やnormative contractを黙って書き換えない。
```

原本の他の`CLOSED`記載は旧R84-M02/L01やV84-01についてのもので、FA-M01／FA-L01のCLOSED判定・条件として転用しない。原本に存在しない条件を記憶や推測から再作成していない。

## 再検証方法

prerequisiteのGit objectを持つrepositoryで、保存物自体を確認する。

```sh
sha256sum docs/reviews/FN-004-Final-Acceptance.md docs/reviews/archive/fn004-final-acceptance-report-48cac96.bundle
git bundle verify docs/reviews/archive/fn004-final-acceptance-report-48cac96.bundle
git bundle list-heads docs/reviews/archive/fn004-final-acceptance-report-48cac96.bundle
```

回収に際して原本の全文・該当指摘を読み、branch/commit、bundleの参照・prerequisite、独立import、原本bytes/hash、docsのみの差分を照合した。runtimeテストやProduction監査を今回の受入試験としてやり直していない。このdocs PRは原本回収・永続保存のためのものであり、自動mergeしない。
