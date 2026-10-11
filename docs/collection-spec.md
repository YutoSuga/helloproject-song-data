# 楽曲候補収集仕様

## 全体方針

Hello! Project公式サイトを一次情報として、リリース一覧から各詳細ページの音声トラックを収集する。候補は `staging/song-candidates.json` に保存し、人間が確認・修正して確定、保留、除外を選ぶ。確定候補だけを後続処理で正本CSVに反映し、ランキングJSONを再生成する。

Milestone 3-Aは収集、解析、既存CSVとの参考照合、中間JSONへの安全な保存まで。正本CSV、ランキングJSON、管理画面、スケジュール実行は扱わない。

## 実行

通常運用は全設定artist、個別確認は指定artistだけを収集する。

```bash
npm run collect:candidates                         # 全対象artist
npm run collect:candidates -- --artist rosychronicle # 指定artistのみ
```

正式なartist指定は `--artist <slug>`。位置引数、未知オプション、未知slug、値なし、重複した `--artist` は取得・保存前に非0終了する。期間指定は今回実装しない。

### 対象artistと公式根拠

設定は [artists.js](../src/collector/artists.js)。2026-10-11に各公式release一覧の `Release` Astro islandにある `groupSlug` と `fixedFilterProps.selectedGroupIds` を確認した。正本artist IDは既存 [artists.csv](../data/artists.csv) の完全一致名義のみ使用し、未登録グループは `null` とする。

| source slug | 対象グループ | officialGroupId | 正本artist ID | 公式一覧 |
| --- | --- | --- | --- | --- |
| morningmusume | モーニング娘。 | 3 | null | [公式](https://helloproject.com/morningmusume/release/?pc=1) |
| angerme | アンジュルム | 29 | null | [公式](https://helloproject.com/angerme/release/?pc=1) |
| juicejuice | Juice=Juice | 36 | G00001 | [公式](https://helloproject.com/juicejuice/release/?pc=1) |
| tsubakifactory | つばきファクトリー | 477 | null | [公式](https://helloproject.com/tsubakifactory/release/?pc=1) |
| beyooooonds | BEYOOOOONDS | 585 | null | [公式](https://helloproject.com/beyooooonds/release/?pc=1) |
| ochanorma | OCHA NORMA | 634 | null | [公式](https://helloproject.com/ochanorma/release/?pc=1) |
| rosychronicle | ロージークロニクル | 676 | null | [公式](https://helloproject.com/rosychronicle/release/?pc=1) |

新規6グループは `firstReleaseYear` を推測せず、公式HTMLが提示するfeed年度をすべて取得する。この年度一覧はグループの結成年・初回発売年ではない。確認時点では1998〜2026年であり、モーニング娘。の1997年など、公式feedが提示しない年度を別sourceから補完しない。既存ロージークロニクル設定の2025年以降は維持する。

公式が対象group IDのsourceとして返すreleaseだけを収集する。アンジュルム一覧にスマイレージ名義が含まれてもsource observationとしてその名義を残す。旧名義の別一覧を探索・結合せず、スマイレージとアンジュルム、モーニング娘。の年号付き名義、関連ユニットのartist identityを自動統合しない。詳細の名義が設定名と完全一致しなければ `artist_id` と `artist_slug` は `null`。

### 収集と保存

Node.js標準のfetchでHTMLを取得する。最新releaseが0件の一覧も、公式feed metadataが有効なら扱う。公式HTMLが示すversion directoryの年別JSON（`/json/{versionDir}/{year}_releases.json`）を取得し、設定の公式group IDで絞ってHTMLの最新releaseと統合する。同一URLの年別feedは1回の収集内で共有する。年度、slug、group ID等のmetadataが欠落・変化した場合は停止する。

`collectArtist` は観測候補とartist別summaryだけを返し、stagingに触れない。`collectCandidates` は選択した全artistを収集し、全件成功後に既存stagingと全観測候補をまとめて1回mergeする。共通の `staging/song-candidates.json` を同じディレクトリのtemp fileへ排他的に書き、renameで一度だけ置換する。保存済みになるまでは追加・再検出件数を0として報告する。

タイムアウト、HTTPエラー、一覧・feed・詳細の必須構造欠落、未知release種別・media種別はエラーにする。1 artistの詳細1件でも取得・解析できなければ、全artist実行でも単一artist実行でもstagingを一切更新せず非0終了する。途中の成功artistの結果は保存しない。別artistの既存候補と未検出候補は削除しない。

### summary

成功時は標準出力、失敗時は標準エラーに次の共通JSON構造を記録する。

```json
{
  "event": "collection_summary",
  "mode": "all",
  "saved": true,
  "artists": [{
    "artist": "ロージークロニクル",
    "artist_slug": "rosychronicle",
    "releases": 1,
    "detail_success": 1,
    "detail_failed": 0,
    "empty_audio_releases": 0,
    "empty_audio_release_urls": [],
    "tracks_detected": 1,
    "instrumental_excluded": 0,
    "video_excluded": 0,
    "new_candidates": 1,
    "rediscovered_candidates": 0,
    "possible_matches": 0,
    "errors": 0
  }],
  "total": {
    "releases": 1,
    "detail_success": 1,
    "detail_failed": 0,
    "empty_audio_releases": 0,
    "empty_audio_release_urls": [],
    "tracks_detected": 1,
    "instrumental_excluded": 0,
    "video_excluded": 0,
    "new_candidates": 1,
    "rediscovered_candidates": 0,
    "possible_matches": 0,
    "errors": 0
  }
}
```

`detail_success`はHTTP取得とHTML解析が成功したrelease数で、公式emptyも含む。`detail_failed`には含めず、`empty_audio_releases`と`empty_audio_release_urls`へ別途記録する。全体のURL配列はartist別配列の連結。staging schemaには記録しない。

例の数値は説明用。単一指定でも同じ構造で `mode: "single"`、artist配列1件となる。全体値はartist別数値の合計で、読み込み・merge・保存のエラーは `total.errors` に加算する。収集失敗時は最初の失敗artistで停止し、`artists` にはそこまでに試行したartistだけを含む。`saved: false` と `error` により未保存と原因を示す。CLI引数エラーではartist未選択なので空配列と `total.errors: 1` を返す。

## 収集単位と判定

一覧の `ReleasePanel` を読み、CDシングル、CDアルバム、アルバム、ミニアルバム、EP、配信、配信シングル、CDMD、アナログシングル、アナログアルバム、MDアルバム、CDミニアルバムを対象にする。release種別はaudio（収集対象）、video（映像除外）、non-audio（その他除外）を明示的な集合で管理する。videoは映像、Blu-ray、BD、DVD、VHS、VHSシングルV、DVDシングルV、BDシングル。non-audioは写真集、書籍、グッズ。未知の種別は安全に停止し、レビューが必要な種別名を出す。

詳細ページの `ReleaseEdition` ごとに `TrackList__inner` のmedia見出しを調べる。`CD`、`STREAMING`、`DIGITAL`、`ANALOG`、`MD` の収録曲だけを候補とし、`BD`、`BLU-RAY`、`DVD`、`VHS` はトラック名に関係なく除外する。タイトル末尾の括弧付き `Instrumental`、`Inst.`、`カラオケ` は除外する。除外数はsummaryに記録する。公式表記の作詞、作曲、編曲、歌または出演はrawとして残し、配列にも保持する。区切り文字だけで共同制作者の人数を推測しない。

同じ曲が複数盤や複数releaseに載る場合、各公式source observationを保持する。candidate IDは収集元artist slug、公式release URL、media種別、edition名、商品番号（あれば）、disc位置、track番号のSHA-256から生成する。曲名は含めないため、同じsource位置の曲名表記が修正されてもIDは維持される。edition名と商品番号を両方使い、商品番号が同じ別editionも区別する。同一artistで正規化タイトルが一致する候補のIDは `related_candidates` に参考情報として記録する。

今回candidate ID生成方式は変更しない。既存ロージークロニクル73件のIDは維持する。3-Aで実装済みの互換処理として、旧形式の曲名を含むIDは、再収集時にsource位置から新IDへ移行する。移行時もstatus、notes、detected_atを保持する。同じsource位置に複数の旧候補が存在する場合は自動統合せず、保存前にエラーとして停止する。

### 古い媒体ラベルの公式確認（2026-10-11）

[モーニング娘。公式一覧](https://helloproject.com/morningmusume/release/?pc=1)が提示する1998〜2000年の公式feedと各詳細を照合した。

| release種別 | 公式実例 | 詳細media / 商品番号 | 判定 |
| --- | --- | --- | --- |
| CDMD | [ファーストタイム](https://helloproject.com/morningmusume/release/1134/)（1998-12-23） | CD / EPYE-5002、音声トラック10件 | audio |
| CDMD | [セカンド モ-ニング](https://helloproject.com/morningmusume/release/1135/)（1999-07-28） | CD / EPYE-5025、音声トラック12件 | audio |
| CDMD | [3rd-LOVEパラダイス-](https://helloproject.com/morningmusume/release/1136/)（2000-03-29） | CD / EPYE-5051、音声トラック12件 | audio |
| VHS | [Hello! FIRST LIVE AT SHIBUYA KOHKAIDO](https://helloproject.com/morningmusume/release/1057/)（1998-12-12） | VHS / EPVE-5002、映像トラック11件 | video |
| VHS | [ザ・ビデオLOVEマシーン](https://helloproject.com/morningmusume/release/1059/)（1999-10-14） | VHS / EPVE-5005、映像トラック1件 | video |

CDMDは公式feedの `categoryLabel` と詳細見出しの実際の種別ラベル。上記3例の `ReleaseEdition → TrackList__inner → ReleaseEdition__mediaType` はすべて `CD` で、`TrackListItem` に楽曲・時間・作詞・作曲・編曲・歌の情報があるため音源releaseとして収集する。CDMDという略語の正式な展開・物理媒体の厳密な定義はこれらの公式ページでは確認できないため、「CD＋MD」や「MD盤」と推測して補正しない。`release_type: "CDMD"`、`media_type: "CD"` と公式表記をそれぞれ保持する。`MD` は後述のMDアルバム公式詳細で個別確認してaudioへ追加した。その他の未確認mediaはaudio集合へ追加しない。

VHSは公式feedの `category` が `video`、詳細のmediaが `VHS`。映像releaseとして一覧・feedの両方で除外し、詳細は取得しない。音源商品にVHSセクションが含まれた場合も、mediaとしてvideoに分類してそのトラックを除外する。映像にも楽曲名・作家・歌クレジットはあるため、クレジットの存在だけで音源と判断しない。

実例は [legacy-release-types.json](../test/fixtures/legacy-release-types.json) に公式feed抜粋と詳細HTML抜粋を保存している。詳細fixtureは各mediaの先頭トラックのみを残し、上表の元の総トラック数は別途記録した。テストはネットワークに依存しない。未登録release種別や未登録mediaは引き続き停止し、全artistのatomic保存を維持する。

### アナログシングルの公式確認（2026-10-11）

[モーニング娘。公式一覧](https://helloproject.com/morningmusume/release/?pc=1)が提示する公式年別feedの `categoryLabel: "アナログシングル"` は、1999・2000・2001・2016年に以下の5件。feed上の `category` はいずれも `single`。詳細のmedia見出しはいずれも `ANALOG` で、楽曲名、再生時間、作詞・作曲・編曲・歌の情報を確認した。

| 公式release | 発売日 | feed商品番号 | 詳細media | 元の収録トラック数 |
| --- | --- | --- | --- | ---: |
| [LOVEマシーン](https://helloproject.com/morningmusume/release/1052/) | 1999-10-06 | EPJE-5035 | ANALOG | 5 |
| [恋のダンスサイト](https://helloproject.com/morningmusume/release/1053/) | 2000-02-09 | EPJE-5050 | ANALOG | 4 |
| [恋愛レボリューション21](https://helloproject.com/morningmusume/release/1054/) | 2001-01-24 | EPJE-5084 | ANALOG | 4 |
| [泡沫サタデーナイト！/The Vision/Tokyoという片隅](https://helloproject.com/morningmusume/release/4908/) | 2016-08-10 | UFWT-9006_A,UFWT-9006_B | ANALOG、ANALOG | 4 |
| [冷たい風と片思い/ENDLESS SKY/One and Only](https://helloproject.com/morningmusume/release/4792/) | 2016-05-11 | UFWT-9003_A,UFWT-9003_B | ANALOG、ANALOG | 4 |

詳細の先頭mediaセクションの商品番号は上表のfeed商品番号の先頭値と一致する。2016年の詳細では2つ目のmediaセクションに商品番号の表示がないため、feedの2つ目の値をそこへ推測で補完しない。collectorは詳細ページから得た商品番号だけを候補に記録する。

音源トラックとして扱えることを確認できたため、release種別 `アナログシングル` とmedia `ANALOG` をaudio集合に追加する。候補の `release_type` は `アナログシングル`、`media_type` は `ANALOG` と公式表記を保持し、「レコード盤」「VINYL」などに言い換えない。旧名義の`モーニング娘。'15`・`モーニング娘。'16`も詳細の名義を保持し、現在のartist IDへ自動統合しない。

[analog-single-release.json](../test/fixtures/analog-single-release.json) に公式feedの該当項目と各詳細HTMLの抜粋を保存した。詳細抜粋は各mediaセクションの先頭トラックだけを残し、元ページの件数は別途記録する。未登録release種別・未登録mediaは停止し、全artist収集のatomic保存を維持する。

### アナログアルバムとMDアルバムの公式確認（2026-10-11）

[モーニング娘。公式一覧](https://helloproject.com/morningmusume/release/?pc=1)の公式feedで、`category: album` の次の4件を確認した。詳細ページでmedia、音声トラック、楽曲名、作詞・作曲・編曲・歌クレジットを個別に確認した。

| 公式release | 発売日 | feedの商品番号 | 詳細media | 元ページのトラック数 | 先頭トラック |
| --- | --- | --- | --- | ---: | --- |
| [ベスト！モーニング娘。1（アナログアルバム）](https://helloproject.com/morningmusume/release/1055/) | 2001-03-28 | EPJE-5089,EPJE-5090 | ANALOG、ANALOG | 15 | LOVEマシーン |
| [ベスト！モーニング娘。1（MDアルバム）](https://helloproject.com/morningmusume/release/1137/) | 2001-01-31 | EPYE-5089 | MD | 15 | LOVEマシーン |
| [4th「いきまっしょい!」](https://helloproject.com/morningmusume/release/5975/) | 2019-04-01 | UFWT-9009,UFWT-9010 | ANALOG、ANALOG | 13 | ザ☆ピ～ス！(Complete Version） |
| [セカンド モーニング](https://helloproject.com/morningmusume/release/5974/) | 2019-04-01 | UFWT-9007,UFWT-9008 | ANALOG、ANALOG | 12 | NIGHT OF TOKYO CITY |

どちらのrelease種別も、公式詳細に音声トラックとして扱えるmediaセクションと上記クレジットがあるためaudio対象とする。`release_type` は`アナログアルバム`または`MDアルバム`、`media_type` は詳細に表示された`ANALOG`または`MD`を保持し、`VINYL`・`MiniDisc`等へ変換しない。MD mediaを追加する根拠は [MDアルバム詳細](https://helloproject.com/morningmusume/release/1137/)の `ReleaseEdition__mediaType: MD` と15件の楽曲・クレジットであり、名称からの推測ではない。

2001・2019年のアナログアルバムはfeedに2つの商品番号がある一方、詳細の2枚目のmediaセクションには商品番号表示がない。候補の`product_number`は詳細で確認できた1枚目の番号を保持し、2枚目は`null`とする。feedの2つ目の番号を詳細のセクションへ推測で割り当てない。2019年の「＜Disc1＞」「＜Disc2＞」はディスク見出しであり、商品番号として保存しない。

[album-media-release.json](../test/fixtures/album-media-release.json) に公式feedと詳細HTMLの抜粋を保存した。詳細fixtureは各mediaセクションの先頭トラックを残し、元の件数を別途記録した。未知release種別・未知mediaは引き続きSTOPする。全artist実行では後続artistの失敗時もstagingを更新しない。

### VHSシングルV・DVDシングルVの公式確認（2026-10-11）

[モーニング娘。公式一覧](https://helloproject.com/morningmusume/release/?pc=1)が提示する公式年別feedと各詳細を照合した。いずれもfeedの`category`が`video`で、詳細のmediaもVHSまたはDVDと表示される。

| 公式release | feedのrelease type / category | 発売日 | 商品番号 | 詳細media | 収録項目 |
| --- | --- | --- | --- | --- | --- |
| [シングルV「Do it! Now」VHS版](https://helloproject.com/morningmusume/release/1069/) | VHSシングルV / video | 2002-09-26 | EPVE-5043 | VHS | Do it! Now、メイキング映像 |
| [シングルV「Do it! Now」DVD版](https://helloproject.com/morningmusume/release/300/) | DVDシングルV / video | 2002-09-26 | EPBE-5043 | DVD | Do it! Now、メイキング映像 |
| [シングルV「シャボン玉」VHS版](https://helloproject.com/morningmusume/release/1074/) | VHSシングルV / video | 2003-07-30 | EPVE-5084 | VHS | シャボン玉、別バージョン、メイキング映像 |
| [シングルV「シャボン玉」DVD版](https://helloproject.com/morningmusume/release/313/) | DVDシングルV / video | 2003-07-30 | EPBE-5084 | DVD | シャボン玉、別バージョン、メイキング映像 |

各詳細には作詞・作曲・編曲のクレジットがある。VHS版には「歌：モーニング娘。」、DVD版には「出演：モーニング娘。」と表示される。楽曲名やクレジットの存在だけで音源releaseとは判定しない。`VHSシングルV`と`DVDシングルV`を既存の映像release種別`VHS`、`DVD`、`BD`、`Blu-ray`と同じvideo集合に追加し、一覧・feedで除外して詳細を取得せず、candidateを生成しない。

audio releaseの詳細に`VHS`・`DVD`等のmediaセクションが混在する場合は、そのmediaの項目だけを`video_excluded`に数え、確認済みaudio mediaのトラックだけを候補にする。未知release種別・未知mediaは引き続きSTOPし、全artist実行の途中失敗ではstagingを更新しない。

[single-v-release.json](../test/fixtures/single-v-release.json)に公式feedと詳細HTMLの抜粋を保存した。詳細抜粋は先頭の楽曲項目と末尾のメイキング映像を残し、元の項目数を別途記録した。テストはネットワークに依存しない。

### CDミニアルバムの公式確認（2026-10-11）

[モーニング娘。公式一覧](https://helloproject.com/morningmusume/release/?pc=1)の公式年別feedと詳細で次の2件を確認した。両方ともfeedの`category`は`album`、`categoryLabel`と詳細のrelease種別は`CDミニアルバム`。

| 公式release | 発売日 | feedの商品番号 | 詳細media | 元ページの収録項目 |
| --- | --- | --- | --- | --- |
| [(7.5)冬冬モーニング娘。ミニ!](https://helloproject.com/morningmusume/release/633/) | 2006-12-13 | EPCE-5443,EPCE-5444,EPCE-5445 | CD、DVD、CD | CDに各6曲、DVDに2項目 |
| [二十歳のモーニング娘。](https://helloproject.com/morningmusume/release/5514/) | 2018-02-07 | EPCE-7387,EPCE-7389,EPCE-7388 | CD、DVD、CD | CDに各8曲、DVDに13項目 |

2006年のCD先頭曲「歩いてる」、2018年のCD先頭曲「モーニングコーヒー(20th Anniversary Ver.)」にはそれぞれ作詞・作曲・編曲・歌のクレジットがある。公式詳細のmediaは`CD`であり、release種別名から推測した値ではない。したがって`CDミニアルバム`をaudio release typeへ追加し、候補には`release_type: "CDミニアルバム"`、`media_type: "CD"`をそのまま保存する。CDセクションの商品番号は詳細に表示されたEPCE-5443 / EPCE-5445、EPCE-7387 / EPCE-7389を保持する。DVDセクションは候補にせず`video_excluded`へ数える。詳細に表示のないDVDの商品番号をfeedから推測で割り当てない。

2018年の詳細歌唱名義は`モーニング娘。20th`であり、収集元`morningmusume`と区別する。現在のグループIDを自動継承させない。未知release種別・未知detail mediaは引き続きSTOPし、全artist実行の途中失敗ではstagingを更新しない。

[cd-mini-album-release.json](../test/fixtures/cd-mini-album-release.json)には公式feed抜粋と詳細HTML抜粋を保存した。各mediaセクションの先頭項目だけを残し、元ページの項目数は別途記録している。テストはネットワークに依存しない。

### 配信シングルの公式確認（2026-10-11）

[モーニング娘。公式一覧](https://helloproject.com/morningmusume/release/?pc=1)が提示する2018年の公式feedで、`categoryLabel: "配信シングル"`、`category: ["single", "distribution"]`の2件を確認した。`配信`とは別のrelease種別として表記を保持する。

| 公式release | 発売日 | feedの商品番号 | 詳細media | 詳細の収録内容 |
| --- | --- | --- | --- | --- |
| [花が咲く 太陽浴びて](https://helloproject.com/morningmusume/release/5552/) | 2018-01-28 | UFDL-1390 | STREAMING / UFDL-1390 | 楽曲とInstrumentalの2項目 |
| [モーニングコーヒー(20th Anniversary Ver.)](https://helloproject.com/morningmusume/release/5567/) | 2018-01-28 | UFDL-1389 | STREAMING / UFDL-1389 | 「収録内容未定」、トラック0件 |

前者の楽曲「花が咲く 太陽浴びて」には作詞・作曲：つんく、編曲：平田祥一郎、歌：モーニング娘。'18のクレジットがある。詳細で`STREAMING`の音声トラックを確認できたため、`配信シングル`をaudio release種別に追加する。candidateには`release_type: "配信シングル"`、`media_type: "STREAMING"`を保持し、Instrumentalは除外する。詳細に商品番号がない場合はfeedの番号で補わず`null`とする。

後者は公式feed上では同じ種別だが、現時点の詳細に「収録内容未定」と表示されトラックがない。公式emptyの確認条件を満たすため、詳細解析成功・candidate 0件として記録する。収録曲やクレジットを推測しない。詳細の歌唱名義`モーニング娘。20th`を現在のグループIDへ自動統合しない。未知release種別・未知mediaは引き続きSTOPする。

[distribution-single-release.json](../test/fixtures/distribution-single-release.json)に公式feed抜粋と両詳細のHTML抜粋を保存した。テストはネットワークに依存しない。

### BDシングルの公式確認（2026-10-11）

[モーニング娘。公式一覧](https://helloproject.com/morningmusume/release/?pc=1)が提示する2022年の公式feedに、[シングルV「ビートの惑星」](https://helloproject.com/morningmusume/release/6719/)が`categoryLabel: "BDシングル"`、`category: ["video"]`で掲載されている。発売日は2022-04-13、feedと詳細の商品番号は`UFXW-1026`。公式詳細のmediaは`BD`。収録項目は「ビートの惑星」のMusic Video、Dance Shot Ver.、Dance Shot Ver.Ⅱとメイキング映像の4件。前3件に作詞：児玉雨子、作曲：Erik Lidbom/miwaflower、出演：モーニング娘。'21が表示され、編曲・歌クレジットは表示されない。メイキング映像には出演クレジットがある。

feedのvideo categoryと詳細のBD映像項目を根拠に`BDシングル`をvideo release種別へ追加する。一覧・feed段階で除外し、詳細を取得せずcandidateを生成しない。楽曲名や作詞・作曲クレジットだけでaudioへ分類しない。

別の公式[CDシングル「Teenage Solution/よしよししてほしいの/ビートの惑星」](https://helloproject.com/morningmusume/release/6631/)の初回生産限定盤Aには、CDとBDの両mediaセクションがある。CDの「Teenage Solution」は音声候補とし、BDのMusic Video項目は`video_excluded`へ数える。未知release種別・未知detail mediaは引き続きSTOPし、全artist収集の後続失敗ではstagingを更新しない。

[bd-single-release.json](../test/fixtures/bd-single-release.json)に両releaseの公式feed・詳細HTML抜粋を保存した。CDシングルの詳細抜粋は初回生産限定盤Aの各media先頭項目を残し、元ページの項目数を別途記録した。テストはネットワークに依存しない。

### 公式empty audio releaseの扱い（2026-10-11）

[モーニング娘。公式一覧](https://helloproject.com/morningmusume/release/?pc=1)に紐づく次の3詳細を確認した。いずれも`ReleaseEdition`と`TrackList`、`TrackList__inner`、media見出し、`TrackList__content--empty TrackList__content--empty--singleDisc`が存在する。`TrackListItem`は0件で、空表示は「収録内容未定」。楽曲・クレジットは詳細に掲載されていない。

| 公式release | release type / 発売日 | 詳細のartist表記 | media / 商品番号 |
| --- | --- | --- | --- |
| [愛の種(20th Anniversary Ver.)](https://helloproject.com/morningmusume/release/5448/) | 配信シングル / 2017-11-03 | モーニング娘。20th | STREAMING / UFDL-1366 |
| [ミンミンロケンロー！](https://helloproject.com/morningmusume/release/5369/) | 配信 / 2017-07-28 | 船木結(アンジュルム/カントリー・ガールズ）、横山玲奈(モーニング娘。'17) | STREAMING / UFDL-1356 |
| [モーニングコーヒー(20th Anniversary Ver.)](https://helloproject.com/morningmusume/release/5567/) | 配信シングル / 2018-01-28 | モーニング娘。20th | STREAMING / UFDL-1389 |

audio releaseの詳細に確認済みaudio media sectionと正常な`TrackList`構造があり、`TrackListItem`が0件で、当該sectionの空表示が正確に「収録内容未定」の場合に限り、公式emptyとして扱う。今回確認した`--singleDisc`の空構造と一致することも要求する。release全体に音声トラックがなく、audio sectionがすべてこの条件を満たす場合はcandidate 0件で解析成功とし、収集を継続する。`detail_success`に含め、`empty_audio_releases`を加算し、`empty_audio_release_urls`にsource URLを記録する。空sectionと通常の音声トラックが混在する場合は通常の曲を候補化し、release全体をemptyとは数えない。

media section、`TrackList`、media見出し、必須詳細構造の欠落、未知media、空表示の欠落・変更、HTTPエラー、解析不能は従来どおりSTOPする。曲名やwork/song identityを補完しない。summaryにだけ空releaseを記録し、staging schemaは変更しない。後続artistで失敗した場合は全transactionを保存しない。

[official-empty-audio-release.json](../test/fixtures/official-empty-audio-release.json)に3件の公式feedと詳細HTMLの抜粋を保存した。テストはネットワークに依存しない。

## 中間JSON

`schema_version: 1`、`updated_at`、`candidates` 配列を持つ。候補にはcandidate ID、artist情報、曲・release情報、source URL、track番号、media、盤名、商品番号、status、検出日時、最終確認日時、credits、match、notesを記録する。`detected_at` と `last_seen_at` はUTC ISO 8601形式。公式のグループ別一覧には関連ユニット名義のreleaseも載るため、詳細ページの歌唱名義を`artist_name`に残す。名義が設定上のartist名と異なる場合、`artist_id`と`artist_slug`は`null`とし、一覧の収集元は`source_artist_slug`に記録する。正本artist IDへの対応は人間が確認する。

statusは `pending`（未確認）、`confirmed`（人間が確定）、`hold`（保留）、`rejected`（除外）。再検出時は既存のstatus、notes、detected_at、および管理者が追加したフィールド、match内の管理者追加情報と既存confirmed_song_id / confirmed_work_idを保持し、last_seen_atと取得情報を更新する。未検出の既存候補も削除しない。

照合は正本の `data/songs.csv` と `data/works.csv` を既存CSV parserで読み、NFKC正規化と空白除去によるタイトル一致を `match` に保存する。song_idとwork_idのリストは参考候補にすぎず、`confirmed_song_id`、`confirmed_work_id` は `null`。version_type、cover、同一recording、同一workを自動確定しない。

管理画面は将来この中間JSONの候補を表示・編集する。Milestone 3-Bで人間が確定した内容だけを正本に反映し、3-Cで認証付き管理画面を実装する。
