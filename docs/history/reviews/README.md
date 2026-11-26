# 受入・レビュー記録と証拠

各判定は報告書に記された対象 SHA・環境・時点で読む。現在の正式設計は[文書目次](../../README.md)を参照する。

| 報告書 | 保存された証拠 |
| --- | --- |
| [初回 Final Acceptance](FN-004-Final-Acceptance.md)・[原本回収記録](FN-004-Final-Acceptance-Recovery.md) | [元 bundle](archive/fn004-final-acceptance-report-48cac96.bundle)・[provenance](archive/fn004-final-acceptance-report-48cac96.provenance.json) |
| [FA-M01 独立検証](FN-004-FA-M01-Validation-20261115.md) | [検証証拠](archive/fn004-fa-m01-validation-20261115/)・[SHA256SUMS](archive/fn004-fa-m01-validation-20261115/SHA256SUMS) |
| [正式再受入](FN-004-Final-Acceptance-20261115.md) | [再受入証拠](archive/fn004-final-acceptance-20261115/)・[SHA256SUMS](archive/fn004-final-acceptance-20261115/SHA256SUMS) |
| [FA-L01 クローズ](FN-004-FA-L01-Closure.md) | [checker と検査記録](archive/fn004-fa-l01-closure/) |

## 現在の保存先と固定時点の再現

証拠の現在の保存先は `docs/history/reviews/archive/`。報告書内のコマンドや provenance の `docs/reviews/archive/` は当時の配置を記録したもの。B1 時点の保存物は [固定 SHA の旧配置](https://github.com/YutoSuga/helloproject-song-data/tree/dc93832d1ac1ce291fd33337b7de9c64e21b57cb/docs/reviews/archive) から辿れる。

- 各 `SHA256SUMS` は、その manifest の親ディレクトリで `sha256sum -c SHA256SUMS` を実行する。
- bundle は prerequisite `e119556c1703e7ea963a327832cacf5a3affb647` を持つ独立した repository で検証する。原本は bundle の `48cac96f36d913402c1be4c5b7e6ecc9d51eee58:docs/reviews/FN-004-Final-Acceptance.md` から取得し、provenance の SHA-256 と照合する。
- FA-L01 の `check.py` は [対象 merge](https://github.com/YutoSuga/helloproject-song-data/tree/4fa7907fb54deec77ebfe6618a73fb2f720dab88) とその第1親の当時の設計パスを比較する。再現する場合は対象 SHA の独立 checkout を作業ディレクトリとし、現在の保存先にある checker を絶対パスで実行する。現行 CI の検査には使わない。

## CSV直接編集への移行

[CSV簡素化受入記録](CSV簡素化受入.md)に保存タグと比較基準の区別、同等性・通常CI検証を記録する。FN-004の過去受入原本は変更しない。
