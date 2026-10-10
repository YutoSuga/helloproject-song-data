# 楽曲候補収集仕様

## 全体方針

Hello! Project公式サイトを一次情報として、リリース一覧から各詳細ページの音声トラックを収集する。候補は `staging/song-candidates.json` に保存し、人間が確認・修正して確定、保留、除外を選ぶ。確定候補だけを後続処理で正本CSVに反映し、ランキングJSONを再生成する。

Milestone 3-Aは収集、解析、既存CSVとの参考照合、中間JSONへの安全な保存まで。正本CSV、ランキングJSON、管理画面、スケジュール実行は扱わない。

## 実行

`npm run collect:candidates`。任意のartist slugを引数に指定できる。初期設定は `rosychronicle`。artistごとの公式一覧URL、slug、名前、正本artist_idは `src/collector/artists.js` に置く。ロージークロニクルの正本artist_idは未登録なので、現時点では `null` とする。

Node.js標準のfetchでHTMLを取得する。現在の公式一覧HTMLには最新releaseだけが直接描画され、残りはHTML内に示されたversion directoryの公式年別JSON（`/json/{versionDir}/{year}_releases.json`）から表示される。このJSONも通常のfetchで取得し、公式group IDで絞ってHTMLの最新releaseと統合する。ロージークロニクルは2025年以降を取得する。タイムアウト、HTTPエラー、一覧やfeed、詳細の必須構造欠落、未知のrelease種別・media種別はエラーにする。音源リリースの詳細ページを1件でも取得・解析できない場合、中間JSONは更新しない。終了時は機械処理可能なJSON summaryを標準出力に記録する。失敗時は標準エラーにsummaryと原因を記録する。

## 収集単位と判定

一覧の `ReleasePanel` を読み、CDシングル、CDアルバム、アルバム、ミニアルバム、EP、配信を対象にする。写真集、書籍、グッズ、映像単独商品は対象外。未知の種別は安全に停止し、レビューが必要な種別名を出す。

詳細ページの `ReleaseEdition` ごとに `TrackList__inner` のmedia見出しを調べる。`CD`、`STREAMING`、`DIGITAL` の収録曲だけを候補とし、`BD`、`BLU-RAY`、`DVD` はトラック名に関係なく除外する。タイトル末尾の括弧付き `Instrumental`、`Inst.`、`カラオケ` は除外する。除外数はsummaryに記録する。公式表記の作詞、作曲、編曲、歌または出演はrawとして残し、配列にも保持する。区切り文字だけで共同制作者の人数を推測しない。

同じ曲が複数盤や複数releaseに載る場合、各公式source observationを保持する。candidate IDは収集元artist slug、公式release URL、media種別、edition名、商品番号（あれば）、disc位置、track番号のSHA-256から生成する。曲名は含めないため、同じsource位置の曲名表記が修正されてもIDは維持される。edition名と商品番号を両方使い、商品番号が同じ別editionも区別する。同一artistで正規化タイトルが一致する候補のIDは `related_candidates` に参考情報として記録する。

旧形式の曲名を含むIDは、再収集時にsource位置から新IDへ移行する。移行時もstatus、notes、detected_atを保持する。同じsource位置に複数の旧候補が存在する場合は自動統合せず、保存前にエラーとして停止する。

## 中間JSON

`schema_version: 1`、`updated_at`、`candidates` 配列を持つ。候補にはcandidate ID、artist情報、曲・release情報、source URL、track番号、media、盤名、商品番号、status、検出日時、最終確認日時、credits、match、notesを記録する。`detected_at` と `last_seen_at` はUTC ISO 8601形式。公式のグループ別一覧には関連ユニット名義のreleaseも載るため、詳細ページの歌唱名義を`artist_name`に残す。名義が設定上のartist名と異なる場合、`artist_id`と`artist_slug`は`null`とし、一覧の収集元は`source_artist_slug`に記録する。正本artist IDへの対応は人間が確認する。

statusは `pending`（未確認）、`confirmed`（人間が確定）、`hold`（保留）、`rejected`（除外）。再検出時は既存のstatus、notes、detected_at、および管理者が追加したフィールドを保持し、last_seen_atと取得情報を更新する。未検出の既存候補も削除しない。

照合は正本の `data/songs.csv` と `data/works.csv` を既存CSV parserで読み、NFKC正規化と空白除去によるタイトル一致を `match` に保存する。song_idとwork_idのリストは参考候補にすぎず、`confirmed_song_id`、`confirmed_work_id` は `null`。version_type、cover、同一recording、同一workを自動確定しない。

管理画面は将来この中間JSONの候補を表示・編集する。Milestone 3-Bで人間が確定した内容だけを正本に反映し、3-Cで認証付き管理画面を実装する。
