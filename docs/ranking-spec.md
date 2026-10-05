# 作家ランキング集計仕様 v1

## 目的と適用範囲

canonical CSVから、artist別の主要作家と集計根拠を再現可能に導出するためのapplication-level仕様である。canonical schema自体の仕様は`data-spec.md`に置き、本書はschemaを変更しない。初期ページは`G00001`（Juice=Juice）を表示するが、集計coreは任意の`artist_id`を入力に取る。

## 対象songとwork

1. `song_artists`で指定artistが`role=primary`のsongだけを対象にする。`featured`だけのsongは除外する。他artistも`primary`であるmultiple-primary songは含める。
2. 対象songから`work_id`集合を作る。曲数の単位は`song_id`ではなく`work_id`である。
3. creator creditも対象となったspecific recording（対象song）からだけ取得する。同じworkに他artistだけが歌うsongがあっても、そのcreditを混ぜない。
4. 同じ`creator_id + category + work_id`は、対象songが複数あっても1件とする。Versionごとに作家が異なるときは、各作家へそのworkを1件ずつ付与する。

## カテゴリ

- **作詞**: `role=lyrics`のみ。`english_lyrics`は含めない。
- **作曲**: `role=composition`のみ。
- **編曲**: `role=arrangement`のみ。`brass_arrangement`その他のspecialized roleは含めない。
- **作詞・作曲**: 同じcreatorが**同じ`song_id`**で`lyrics`と`composition`の両方を担当した場合だけ成立し、その後`creator_id + work_id`で重複排除する。別Versionをまたいだroleの合成はしない。

共同creditは各creatorに1 workを付与し、按分しない。全creator、全順位、work数、根拠work（`work_id`、title、該当`song_id`、role）を派生データへ保持する。

## 順位

`work_count`降順のcompetition rankingを使う。同数は同順位とし、次の順位は人数分飛ばす（`1, 2, 2, 4`）。同順位内はlocaleに依存しない`creator_id`昇順で安定化する。TOP3は配列の先頭3人ではなく`rank <= 3`の全員である。

## Versionと再利用

`original`、`new_vocal`、`re_recording`、`other`等を一律に別曲加算せず、同じworkへまとめる一方、対象song上にのみ存在する作家差分は保持する。新しいgroupについてcanonicalなartist/song/credit relationが揃えば、同じgeneratorへ`artist_id`を渡して生成できる。派生JSONでも`artist_id`、`creator_id`、`work_id`、`song_id`を保持するため、将来work → song → official video → H!P Station segmentの関係へIDで接続できる。

## 生成物

`site/data/rankings/G00001.json`は`data/*.csv`から生成する静的派生データとしてGit管理する。これによりGitHub Pagesへ`site/`をそのまま配置でき、ブラウザでcanonical CSVを毎回parseする必要がない。手編集せず、canonical更新後は`npm run site:build`で再生成する。

> **Spec consideration:** `data-spec.md`には従来の一般説明としてsong単位のグループ別作家集計が記載されている。canonical schema変更は不要であり同文書は今回変更しないが、このランキングapplicationでは確定要件である本書のwork単位規則を使用する。将来canonical specを改訂する際は両者の説明整理を検討する。
