# SCR-003 公開楽曲JSON設計（設計のみ）

[画面仕様](SCR-003-楽曲一覧・検索.md)のデータ契約案。CSV正本・FN-001の既存ランキング仕様は変更しない。生成スクリプトも今回は追加しない。

## 結合・対象範囲

1. `artists.artist_id = 指定artist_id`。初期はG00001だけ。グループ名はartist.name。
2. `song_artists.artist_id = 指定ID AND role = primary`を選び、song_idで重複排除。`songs.song_id`へ結合。
3. `songs.work_id = works.work_id`でgroupし1work1公開行。同workでも対象artistがprimaryでないsongは今回の詳細・検索・日付から除外。全artistの作品初出と誤認させない。
4. `song_creators.song_id = 対象songs.song_id`、`creator_id = creators.creator_id`。担当・掲載名義はsong単位。work自体に作家を直接割り当てない。
5. releases/release_tracksは今回の日付導出・一覧には使用しない。音源初出日と商品発売日は別概念。worksに日付列はなく、song.release_dateの最小既知日を対象artist内の作品発売日として導出する案。

確認基点mainの実CSVはworks 90行・title_kana全件空、songs 121行・release_date空12行。全songsと対象artistのprimary集合は同じとは限らない。CSV順やIDを時系列と解釈しない。[正式データ仕様](../../data/データ仕様.md)のfull audio基準と名義区分を維持する。

## 出力案・責務

出力先案は `site/data/songs/<artist_id>.json`。`schema_version: 1`。ランキングJSONとは独立した派生物であり逆反映しない。別artist追加時も同schemaと生成引数を使い、artistボタンの有効化はデータ検証後の別変更。混在データや存在しないartistを自動補完しない。
生成側はCSV結合、対象集合の検証、work重複排除、日付導出、role/credit順・音源順の安定化、検索名集合の作成を担当。画面側は1回取得してschemaと必要項目を検証、入力正規化・検索・選択順ソート・件数・モーダルを担当。集計ロジックを画面で変更しない。

```json
{
  "schema_version": 1,
  "artist": {"artist_id": "G00001", "name": "Juice=Juice"},
  "works": [{
    "work_id": "W99991",
    "title": "仮の作品名",
    "title_kana": null,
    "first_release_date": "2025-01-15",
    "date_incomplete": false,
    "search_creator_names": ["仮の掲載名義", "仮の作家正規名"],
    "songs": [{
      "song_id": "J99991",
      "title": "仮の音源名",
      "version_name": null,
      "version_type": "original",
      "release_date": "2025-01-15",
      "credits": [{
        "creator_id": "C99991",
        "creator_name": "仮の作家正規名",
        "credit_name": "仮の掲載名義",
        "role": "lyrics",
        "credit_order": 1
      }]
    }]
  }]
}
```

この例は設計説明用の仮値でありモックはこのJSONを取得しない。

## パス別定義

| JSONパス | 型・不明値 | 参照・導出 | UI用途 |
| --- | --- | --- | --- |
| schema_version | integer=1 | 生成schema | reader互換性 |
| artist.artist_id/name | string・必須 | artists | 対象確認 |
| works | array・空[]可 | 対象songのwork_id集合 | 作品一覧 |
| works[].work_id/title | string・必須 | works | 識別／一覧名・詳細見出し |
| works[].title_kana | string/null | works.title_kana | 将来用。今回のソートは使用しない |
| works[].first_release_date | YYYY-MM-DD/null | 対象songs.release_dateの最小既知日 | 発売日表示・新旧順 |
| works[].date_incomplete | boolean | 対象songに日付欠落が1つ以上 | 一部未確認表示 |
| works[].search_creator_names | string[]・空[]可 | 全対象songのcredit_nameとcreators.nameを文字列で重複排除 | 作品単位AND検索 |
| works[].songs | array・1件以上 | 対象songのみ | 詳細音源一覧 |
| songs[].song_id/title | string・必須 | songs | 音源ID／名称 |
| songs[].version_name | string/null | songs.version_name | 公式Version名（空は表記なし） |
| songs[].version_type | 既存enum必須 | songs.version_type | 種別ラベル |
| songs[].release_date | YYYY-MM-DD/null | songs.release_date | 音源初出日（nullは不明） |
| songs[].credits | array・空[]可 | song_creators | 担当別表示 |
| credits[].creator_id/name | string必須 | creator_id／creators.name | 識別／正規名検索 |
| credits[].credit_name | string必須 | song_creators.credit_name | その音源の掲載名義・検索 |
| credits[].role | 既存enum必須 | song_creators.role | 担当分類・特殊担当ラベル |
| credits[].credit_order | positive integer/null | song_creators.credit_order | 担当内の順序 |

表内songs/creditsはworks[].songsおよびその配下の略記。CSV空欄の任意値はnull、空リストは[]。0や仮日付を入れない。必須列・FK不整合は生成失敗とし黙って削除しない。未知role/enum/schemaも失敗。日付が全てnullならfirst_release_date=null、date_incomplete=true。一部nullなら最小既知日を使い「日付確認中」を添える。これはデータ網羅性保証ではない。

credit_nameは正式仕様で必須のため正規名で隠れて補完しない。検索用名集合は同名複数IDでも文字列単位で重複排除してよいが、creditsのIDやroleは保持。検索は全role対象でもランキングJSONの対象role・作品数は変えない。

## 順序・未確定

生成worksはwork_id ASCII順、songsは日付昇順（不明末尾）・song_id、creditsはrole ASCII順→credit_order数値（不明末尾）→creator_id。画面初期順は発売日降順（不明末尾）・work_id。曲名比較と検索の正規化は画面仕様の推奨案を参照。
対象artist内の最小既知日を画面「発売日」と呼ぶ定義、同日順、曲名のIntl.Collator比較、複数語のwork内横断ANDはレビュー承認待ち。JSONパス・出力先案も後続実装契約としてレビューする。全artist横断の真の作品初出日は推測しない。
