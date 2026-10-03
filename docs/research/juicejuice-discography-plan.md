# Juice=Juice 公式ディスコグラフィー収集計画

調査日: 2026-10-03（B-4投入およびB-5～B-9調査を反映）
状態: **優先度A 5件およびB-1～B-4投入完了、B-5～B-9は調査・投入計画まで完了（CSV未投入）**

## 1. 目的・判定原則

Hello! Project公式ディスコグラフィーに掲載されたJuice=Juice名義の音源releaseを棚卸しし、3rdアルバム「terzo」から登録済みの28 songを補完する過去作、通常の今後作、配信・特殊releaseの投入順を定める。本書の「同一音源候補」は次回照合すべき対象を示すだけで、依頼文にない音源同一性、`version_type`、work共有、初出日は推測しない。

- **work**、具体的な音源・歌唱Versionである**song**、商品・配信単位である**release**を分離する。
- Special Editionや先行配信が別releaseでも、CDと同一音源なら同じ`song_id`を参照できる。反対にソロVersion、BAND Live Ver.、THE FIRST TAKE、ライブ音源は別songになる可能性が高いが、CSV投入時まで最終判定しない。
- `songs.release_date`は、**その具体的songが公式音源として最初にreleaseされた日**である。CD発売日を機械的に設定せず、先行配信を確認してから確定する。これは`docs/data-spec.md` v0.3の「CDと公式配信で異なる場合は原則早い方」という規則に従う。
- 今回はreleaseの存在確認だけではsongを追加せず、ID採番、CSV投入、song/versionの最終判定を行わない。

> **収集ルール:** CD発売日を機械的に`songs.release_date`へ設定してはいけない。各CD投入時に、その曲の先行配信が存在しないか確認する。

## 2. 調査範囲と履歴

### 対象

- インディーズシングル、CDシングル、CDアルバム、通常EP。
- 公式ディスコグラフィーで音源releaseとして確認できる先行配信、Special Edition、配信限定追加track。
- 独立した公式音源releaseであるライブ音源、THE FIRST TAKE、BAND Live Ver.等（優先度D）。

DVD/Blu-ray、ライブ映像、MV集、写真集、書籍、Instrumentalだけの追加は対象外とする。映像が存在するだけでは音源releaseとしない。

### 公式情報の確認履歴

前回のCodex調査では、次の公式入口がHTTPS接続トンネルで**HTTP 403 Forbidden**となり、検索用Webツールも**HTTP 401 Unauthorized**となった。このため一覧のページング、個別ページ、news検索結果を取得できず、その時点では候補を未確認とした。この失敗は不存在の根拠ではない。

- https://helloproject.com/juicejuice/release/ — HTTP 403
- https://www.helloproject.com/discography/juicejuice/ — HTTP 403
- https://helloproject.com/juicejuice/release/6692/ — repositoryに保存済みのURLと既調査track情報のみ参照し、再取得不能

その後、ChatGPT側でHello! Project公式サイトを確認した。以下では、依頼文で提供された確認結果を入力データとして**公式確認済み**へ更新した。個別URLが依頼文にないものは推測せず、その旨を明記する。2026-10-03のB-2投入時には[公式release](https://helloproject.com/release/2211/)を、B-3投入時には[公式release](https://helloproject.com/release/2212/)を再取得し、発売日、規格品番、収録曲、作家クレジットおよび歌唱名義を確認した。

2026-09-27のA-3再開時にも公式URLへの接続はHTTP 403、Web検索はHTTP 401となった。音源同一性とカバー区分はその後のユーザー確定判断を採用した。当時取得できなかった商品形態・規格品番・盤別track構成、および追加公式ニュースの確認結果は、その後ユーザーから提供された確定情報として4.7節へ反映した。

## 3. 通常release一覧（優先度A～Cと登録済みterzo）

1タイトルを1候補として数え、盤違いはまとめる（登録済みterzoだけはCSV上で3 release）。更新前27候補に`MORE! MORE! EP`を加え、通常releaseは**28候補**（インディーズシングル3、CDシングル20、アルバム4、EP1）となる。

| 発売日 | 種別 | タイトル | terzo補完 | 優先度 | 公式URL・状態 | notes |
|---|---|---|---|---|---|---|
| 2013-04-03 | インディーズシングル | 私が言う前に抱きしめなきゃね | — | B | [公式詳細](https://helloproject.com/release/2210/) | **B-1投入完了。** `L00038` / `W00028` / `J00036`。通常版と後発MEMORIAL EDITは同一work／別songとする。 |
| 2013-05-05 | インディーズシングル | 五月雨美女がさ乱れる | — | B | [公式詳細](https://helloproject.com/release/2211/) | **B-2投入完了。** `L00039` / `W00029` / `J00037`。通常版と後発MEMORIAL EDITは同一work／別songとする。 |
| 2013-06-12 | インディーズシングル | 天まで登れ！ | — | B | [公式詳細](https://helloproject.com/release/2212/) | **B-3投入完了。** `L00040` / `W00030` / `H00001`・`J00038`。同一work／別song。 |
| 2013-09-11 | CDシングル | ロマンスの途中／私が言う前に抱きしめなきゃね(MEMORIAL EDIT)／五月雨美女がさ乱れる(MEMORIAL EDIT) | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | Version検証が必要。 |
| 2013-12-04 | CDシングル | イジワルしないで 抱きしめてよ／初めてを経験中 | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 盤別track差を確認。 |
| 2014-03-19 | CDシングル | 裸の裸の裸のKISS／アレコレしたい！ | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2014-07-30 | CDシングル | ブラックバタフライ／風に吹かれて | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2014-10-01 | CDシングル | 背伸び／伊達じゃないよ うちの人生は | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2015-04-08 | CDシングル | Wonderful World／Ça va ? Ça va ?（サヴァサヴァ） | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 記号・副題を再確認。 |
| 2015-07-15 | アルバム | First Squeeze！ | J00025/J00026の基礎版候補 | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 既発曲、アルバム新曲、Version表記を精査。 |
| 2016-02-03 | CDシングル | Next is you！／カラダだけが大人になったんじゃない | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 名義を確認。 |
| 2016-10-26 | CDシングル | Dream Road～心が躍り出してる～／KEEP ON 上昇志向！！／明日やろうはバカやろう | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2017-04-26 | CDシングル | 地団駄ダンス／Feel！感じるよ | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2018-04-18 | CDシングル | SEXY SEXY／泣いていいよ／Vivid Midnight | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | Special EditionはD06で未確認。 |
| 2018-08-01 | アルバム | Juice=Juice#2 -¡Una más!- | J00027/J00028の基礎版候補 | B | [公式一覧](https://helloproject.com/juicejuice/release/) | Album Version等との同一性を要検証。 |
| 2019-02-13 | CDシングル | 微炭酸／ポツリと／Good bye & Good luck！ | J00001–J00003 | A | [公式一覧](https://helloproject.com/juicejuice/release/) | 初出・同一音源確認に直結。 |
| 2019-06-05／2019-10-23 | CDシングル | 「ひとりで生きられそう」って それってねえ、褒めているの？／25歳永遠説 | J00004–J00006 | A | [2019-06-05公式詳細](https://helloproject.com/release/detail/HKCN-50610/?pc=1)／[通常盤C公式詳細](https://helloproject.com/juicejuice/release/detail/HKCN-50629/) | 2019-06-05の5形態と、後発の2019-10-23通常盤Cを同一タイトル候補内で区別。 |
| 2020-04-01 | CDシングル | ポップミュージック／好きって言ってよ | J00007–J00011 | A | [公式詳細](https://helloproject.com/juicejuice/release/6261/) | **A-3完了**。5形態をL00017～L00021へ登録済み。J00009/J00010はterzoと同一音源、J00011は再録と確定。 |
| 2021-04-28 | CDシングル | DOWN TOWN／がんばれないよ | J00012–J00013 | A | [公式詳細](https://helloproject.com/juicejuice/release/detail/HKCN-50646/) | **A-4完了**。通常CD 6形態と同日のSpecial Edition（D10）をCSV登録済み。 |
| 2021-12-22 | CDシングル | プラスティック・ラブ／Familia／Future Smile | J00014–J00016 | A | [公式詳細](https://helloproject.com/juicejuice/release/6613/) | **A-5完了**。CD 9形態をL00029～L00037へ登録し、一般デジタル配信は存在確認のみ。 |
| 2022-04-20 | アルバム | 3rdアルバム「terzo」 | J00001–J00028 | — | [公式詳細](https://helloproject.com/juicejuice/release/6692/) | CSV登録済み。規格品番別L00001–L00003。 |
| 2022-11-23 | CDシングル | 全部賭けてGO！！／イニミニマニモ～恋のライバル宣言～ | — | C | [公式一覧](https://helloproject.com/juicejuice/release/) | Special Edition有無を確認。 |
| 2023-07-12 | CDシングル | プライド・ブライト／FUNKY FLUSHIN' | — | C | [公式一覧](https://helloproject.com/juicejuice/release/) | 「プライド・ブライト」は2023-06-29先行配信あり（D14）。 |
| 2023-10-11 | アルバム | Juicetory | — | C | [公式一覧](https://helloproject.com/juicejuice/release/) | 再収録・別Versionを検証。 |
| 2024-05-15 | CDシングル | トウキョウ・ブラー／ナイモノラブ／おあいこ | — | C | [公式一覧](https://helloproject.com/juicejuice/release/) | 同日のSpecial Edition（D15）をセットで確認。 |
| 2025-02-26 | CDシングル | 初恋の亡霊／今夜はHearty Party | — | C | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2025-10-08 | CDシングル | 四の五の言わず颯と別れてあげた／盛れ！ミ・アモーレ | — | C | [公式一覧](https://helloproject.com/juicejuice/release/) | 後発の特殊Version（D17～D19）とは分離。 |
| 2026-06-24 | EP | MORE! MORE! EP | — | C | ChatGPT側でHello! Project公式掲載を確認済み。個別URLは今回の依頼文では未提示。 | 特殊配信ではなく通常EP。 |

## 4. 優先度A（terzo補完優先）

5シングルは維持し、関連する先行配信・Special Editionを同時に確認する。

1. **A-1 完了 — 微炭酸／ポツリと／Good bye & Good luck！**（2019-02-13）: 公式情報確認およびユーザーの音源同一性判断に基づき、7形態をCSV投入済み。J00001～J00003を接続し、初出日を2019-02-13へ更新した。
2. **A-2 完了（D08独立Special Edition確認は継続） — 「ひとりで生きられそう」って…／25歳永遠説**: 2019-06-05の5形態を訂正しJ00004/J00005へ接続。2019-10-23通常盤CをJ00004/J00005/J00006へ接続し、J00006の2019-10-10先行配信を初出日に反映した。
3. **A-3 完了（D09独立Special Edition確認は継続）— ポップミュージック／好きって言ってよ**（2020-04-01）: 通常CD 5形態と17 trackをCSV投入し、対象5曲のsong整理、J00011の再録判定、同日公式配信の存在確認まで完了した。
4. **A-4 完了 — DOWN TOWN／がんばれないよ**（2021-04-28）: 通常CD 6形態をJ00012/J00013へ接続し、同日の公式配信`DOWN TOWN／がんばれないよ(Special Edition)`（D10）とソロ7 VersionもCSV投入した。
5. **A-5 完了 — プラスティック・ラブ／Familia／Future Smile**（2021-12-22）: CD 9形態をL00029～L00037へ登録し、既存J00014～J00016を接続した。一般デジタル配信は存在確認のみとし、CSV化していない。

### 4.1 A-1投入作業の停止記録（2026-09-26）

- `songs.csv`、`works.csv`、`release_tracks.csv`を照合し、J00001＝「微炭酸」
  （W00001）、J00002＝「ポツリと」（W00002）、J00003＝「Good bye & Good
  luck！」（W00003）であること、および3曲がterzo 3盤（L00001～L00003）の
  Disc 1、track 1～3にそれぞれ接続済みであることを確認した。3 songはいずれも
  `version_type=original`、`release_date`空欄であり、notesには初出日および過去
  releaseとの音源同一性が未確認と記録されている。
- A-1の公式詳細、2019-02-13以前の先行配信、D07 Special Editionをオンラインで
  再確認しようとしたが、調査環境からHello! Project公式サイトへの接続がHTTP 403、
  Web検索機能がHTTP 401となり、公式ページ本文を取得できなかった。取得不能を
  「先行配信なし」「Special Editionなし」の根拠にはしていない。
- このため、盤種・規格品番・盤別track list、先行配信、D07の存在、および2019年盤と
  terzoの音源同一性は今回確定していない。D07は未確認状態を維持する。
- 未検証の規格品番やURLを推測で登録せず、J00001～J00003の`release_date`、notes、
  source URLも変更していない。新規release、release_tracks、song、work、creator、
  song_creators、song_artists、song_performersは追加していない。
- **停止点**: Hello! Project公式の個別releaseページ本文へアクセスできる環境、または
  その保存内容が提供された時点で、CD各盤、先行配信、D07を再調査する。その上で、
  terzoとの音源同一性を公式情報から確定できた場合に限り既存J00001～J00003へ
  `release_tracks`を接続し、具体的音源の最初の公式release日に`songs.release_date`を
  更新する。同一性を確定できない場合は、ユーザー判断を求めるまで当該接続を保留する。

### 4.2 A-1再開・CSV投入完了（2026-09-26）

- 停止後にChatGPT側で[公式release](https://helloproject.com/release/5872/)、
  [公式詳細](https://helloproject.com/release/detail/HKCN-50580/?pc=1)、
  [配信開始情報](https://helloproject.com/news/9883/)を確認し、その確認結果を入力情報として採用した。
- 初回生産限定盤A/B/C/SP、通常盤A/B/Cの7形態（L00004～L00010）を登録し、各盤の
  CD track 1～3を既存J00001～J00003へ接続した。Instrumentalおよび映像部分は仕様に
  従って登録していない。
- ユーザー確定判断により2019年盤とterzo収録版を同一音源として扱い、song/work IDと
  `version_type=original`を維持したまま、3 songの`release_date`を2019-02-13へ更新した。
  今回の公式確認では同日より前の先行配信は確認されず、公式ニュースでは同日から
  シングル、ビデオ、ハイレゾの配信開始を確認した。
- J00002「ポツリと」の編曲クレジットを中島卓偉から浜田ピエール裕介（C00032）へ訂正した。
  中島卓偉の作詞・作曲、およびJ00001/J00003の既存クレジットは維持した。
- **A-1はCSV投入完了**。この節はA-1完了時点の記録であり、後続のA-2作業は4.3節に記録する。

### 4.3 A-2 CD調査・CSV投入（2026-09-26）

- 初回投入では2019-06-05発売分をL00011～L00015へ登録したが、盤種・規格品番の対応を誤登録していた。履歴はGitと本節に残し、CSVには追加公式確認に基づく訂正後の値だけを保持する。

### 4.4 A-2追加公式確認・訂正（2026-09-27）

- 2019-06-05発売分は、L00011＝初回生産限定盤A（HKCN-50610）、L00012＝初回生産限定盤B（HKCN-50612）、L00013＝初回生産限定盤SP（HKCN-50616）、L00014＝通常盤A（HKCN-50618）、L00015＝通常盤B（HKCN-50619）へ確定した。既存IDを維持し、L00013～L00015の盤種・規格品番を訂正した。誤登録していたHKCN-50614/HKCN-50615はA-2レコードから除去したが、別商品の品番としての存在は判断していない。5形態のtrack 1～2はJ00004/J00005への既存接続を維持した。
- [通常盤C公式詳細](https://helloproject.com/juicejuice/release/detail/HKCN-50629/)に基づき、2019-10-23発売の通常盤C（HKCN-50629）をL00016として追加した。track 1＝J00004、track 2＝J00005、track 3＝J00006を接続し、Instrumentalは対象外とした。
- [公式ニュース](https://helloproject.com/news/11099/)により、J00006 New Vocal Ver.は2019-10-10にiTunesで先行配信されたこと、パート割りを一新しoriginal発売後に加入した新メンバーも歌唱する別Versionであることを確認した。`J00006.release_date`を2019-10-10へ更新した。J00004（`original`、2019-06-05）とJ00006（`new_vocal`、2019-10-10）は統合せず、W00004を共有する別songとして維持する。J00005（`original`、2019-06-05）も変更しない。個人別歌唱者は推測せず、`song_performers.csv`は変更しない。
- 現在のCSVは配信releaseを独立レコードとして管理可能な設計だが、確認済みの配信releaseもまだCSV投入しておらず、配信release投入フェーズ自体が未実施である。このため今回だけ特殊扱いせず、2019-10-10 iTunes先行配信は`J00006.release_date`へ反映する一方、releaseレコード化と`release_tracks`接続は配信release投入フェーズまで保留する。
- `songs.source_url`は曲名・Versionを直接示す通常盤C公式詳細を採用し、初出日の根拠となる公式ニュースとの複数出典は本節で管理する。複数URLを1セルへ格納していない。新規song/work/creatorはなく、A-1およびA-3以降は変更していない。
- **最終状態**: 通常release、後発通常盤C、New Vocal Ver.初出の必要情報が確定したため、**A-2本体は完了**。独立したSpecial Editionの存在は今回も根拠を確認できず、D08として不存在と断定せず未確認を継続する。次の通常CD投入対象はA-3「ポップミュージック／好きって言ってよ」。

### 4.5 A-3公式情報再調査・停止記録（2026-09-27）

- CSV投入前に全表を照合し、対象5曲はすべてterzoから登録済みであることを確認した。
  `J00007`＝ポップミュージック（`W00006`）、`J00008`＝好きって言ってよ（`W00007`）、
  `J00009`＝Borderline（`W00008`）、`J00010`＝Va-Va-Voom（`W00009`）、
  `J00011`＝続いていくSTORY (Symphonic Version feat. Karin)（`W00010`）である。
  いずれもterzo 3盤へ接続済みで、`release_date`は空欄である。作詞・作曲・編曲、
  Juice=Juice（`G00001`）との関係も既存CSVに登録済みで、新規song/work/creatorは不要な候補である。
- リポジトリ保存済みの[公式詳細URL](https://helloproject.com/juicejuice/release/6261/)と既調査結果から、
  正式タイトル、2020-04-01発売、およびCDに上記5曲が収録されたことまでは再確認した。
  一方、今回の実行環境では同URLへの直接接続がHTTP 403、Web検索がHTTP 401となり、
  商品形態、規格品番、盤別track list、先行配信、D09 Special Editionを再検証できなかった。
  取得不能を「先行配信なし」「Special Editionなし」とは扱わない。
- 2020年CDとterzoはいずれもBorderlineおよびVa-Va-VoomをVersion表記なしで掲載し、
  既存の作家クレジットはそれぞれ星部ショウ／平田祥一郎、児玉雨子／Shusui／Josef Melinである。
  しかし、保存済み公式情報とresearch文書には、同一マスター、再録なし、New Vocalなし等を
  明示する説明も、ユーザーによる同一音源の確定判断もない。同名・Version表記なし・作家一致
  だけでは`docs/data-spec.md`の同一音源基準を満たさないため、既存songへの接続も別song採番も行わない。
- 同じ理由でJ00007/J00008/J00011についても2020年CDとterzoの同一音源を確定せず、
  `release_date`、notes、source URLを変更しない。仮IDを用いた`release_tracks`も作成しない。
  新規release、release_tracks、song、work、creator、song_creators、song_artists、
  song_performersはいずれも追加していない。配信release投入フェーズも開始していない。

#### ユーザー確認事項: Borderline

- **対象**: 2020-04-01 CD収録版とterzo収録版の音源同一性。
- **既存song_id / work_id**: `J00009` / `W00008`。
- **既存CSVの状態**: `version_type=original`、`release_date`空欄、初出日と過去releaseとの同一性は未確認。
- **公式に確認できた事実**: 両releaseのtrack表記は「Borderline」でVersion注記がなく、
  2020年CDへの正式収録と既存クレジット（作詞・作曲 星部ショウ、編曲 平田祥一郎）を確認済み。
- **参考にした公式URL**: 2020年CDは https://helloproject.com/juicejuice/release/6261/ 、
  terzoは https://helloproject.com/juicejuice/release/6692/ 。
- **判断できない理由**: 公式ページに同一マスターまたは再録の有無を明示する説明がなく、
  Version表記なしと作家一致だけでは具体的音源の同一性を証明できない。
- **選択肢**: (A) ユーザー確認により同一音源として既存J00009を再利用する、
  (B) 別音源と確認できる公式根拠を提示して同じW00008の新songを採番する、
  (C) 根拠取得まで当該track接続を保留する。
- **各選択肢のCSVへの影響**: AはJ00009を各該当盤の`release_tracks`へ接続し、初出日を
  先行配信調査後の確定日へ更新する。Bは新songとcreator/artist関係を追加してCDへ接続し、
  J00009はterzo版として維持する。Cはreleaseを確定できてもBorderlineのtrackだけ接続しない。
- **推奨**: 音源を聴取済みなどの根拠を持つユーザーが同一性を確認できるならA。確認できなければC。

#### ユーザー確認事項: Va-Va-Voom

- **対象**: 2020-04-01 CD収録版とterzo収録版の音源同一性。
- **既存song_id / work_id**: `J00010` / `W00009`。
- **既存CSVの状態**: `version_type=original`、`release_date`空欄、初出日と過去releaseとの同一性は未確認。
- **公式に確認できた事実**: 両releaseのtrack表記は「Va-Va-Voom」でVersion注記がなく、
  2020年CDへの正式収録と既存クレジット（作詞 児玉雨子、作曲 Shusui・Josef Melin、
  編曲 Josef Melin）を確認済み。
- **参考にした公式URL**: 2020年CDは https://helloproject.com/juicejuice/release/6261/ 、
  terzoは https://helloproject.com/juicejuice/release/6692/ 。
- **判断できない理由**: Borderlineと同様、公式情報に同一マスターや再録の有無の明示がない。
- **選択肢**: (A) ユーザー確認により同一音源として既存J00010を再利用する、
  (B) 別音源と確認できる公式根拠を提示して同じW00009の新songを採番する、
  (C) 根拠取得まで当該track接続を保留する。
- **各選択肢のCSVへの影響**: AはJ00010を各該当盤の`release_tracks`へ接続し、初出日を
  先行配信調査後の確定日へ更新する。Bは新songとcreator/artist関係を追加してCDへ接続し、
  J00010はterzo版として維持する。Cはreleaseを確定できてもVa-Va-Voomのtrackだけ接続しない。
- **推奨**: 音源を聴取済みなどの根拠を持つユーザーが同一性を確認できるならA。確認できなければC。

- **停止点（当時）**: BorderlineとVa-Va-Voomの上記判断、ならびに公式ページ本文または同等の保存済み
  公式情報による全商品形態・規格品番・盤別track・先行配信・Special Editionの確認後から再開する。
  その時点でポップミュージック、好きって言ってよ、続いていくSTORYについても同一性を確定し、
  release採番、確定songへのtrack接続、初出日・notes・source URL更新、validationを一括して行う。
- **A-3の当時の最終状態**: **未完了（ユーザー判断および公式商品詳細の再取得待ち）**。次の投入対象は
  A-3の再開であり、A-4以降には着手しない。通常release候補・D候補の件数に変更はない。

### 4.6 A-3ユーザー判断による再開（2026-09-27）

- 4.5節の停止記録は調査履歴として維持する。その後のユーザー判断により、2020-04-01
  シングルとterzoに収録された`Borderline`は同一音源（`J00009` / `W00008`）、
  `Va-Va-Voom`も同一音源（`J00010` / `W00009`）として確定した。新規song/workは
  作成せず、terzo 3盤の既存接続を維持する。
- ユーザー判断により、`ポップミュージック`はKANの既発曲をJuice=Juiceがカバーした
  音源と確定した。`J00007` / `W00006`を維持して`version_type`を`original`から
  `cover`へ訂正し、収集対象外のKAN版songは登録していない。
- 保存済み公式調査で対象5曲が2020-04-01 CDに収録されたことを確認済みであり、
  これより前の公式音源releaseは保存済み調査にない。このため`J00007`～`J00011`の
  初出日を2020-04-01へ更新し、曲名・収録と初出を直接示す
  [2020年公式release](https://helloproject.com/juicejuice/release/6261/)を各songの
  `source_url`とした。確認できない先行配信日は推測していない。配信releaseのCSV化も
  従来方針どおり行っていない。
- `J00008` / `W00007`は維持し、別Versionを示す保存情報がないため新規songを作成して
  いない。`J00011` / `W00010`も維持し、公式表記だけでは再録と断定できないため
  `version_type=other`を維持した。`feat. Karin`は過去のユーザー判断に従い宮本佳林
  （`P00001`）として既に`song_performers.csv`へ登録済みであり、追加変更はない。
- 対象5曲の既存作詞・作曲・編曲クレジットと`G00001`（Juice=Juice）のartist関係を
  照合し、追加・訂正は不要と判断した。新規creator、song、workはない。
- 再開時点でも公式URL本文はHTTP 403、Web検索はHTTP 401で取得できなかった。
  repository内に保存されているのは正式タイトル、発売日、対象5曲の収録までであり、
  **商品形態、各形態の規格品番、盤別track構成は保存されていない**。これらを推測で
  生成してはならないため、`releases.csv`の`L00017`以降と`release_tracks.csv`への
  投入はこの項目で停止した。最大release IDは引き続き`L00016`である。
- D09 Special Editionも公式根拠を取得できず、存在・不存在のいずれとも断定せず
  **未確認を継続**する。D09未確認とは別に、通常盤の商品情報が未確定なので、現時点の
  **4.6節時点の状態**はA-3 song整理完了／通常release投入未完了（A-3本体は未完了）であった。
- 一次情報で通常商品の形態・規格品番・盤別track構成を確認できた時点で、`L00017`以降を
  採番して既存`J00007`～`J00011`へ接続する。次の投入対象A-4へ進む前にこのrelease投入を
  完了する方針としていた。4.6節時点ではロードマップ候補件数（確定41、未確定8、最大探索母数49）への変更はなかった。

### 4.7 A-3通常CD投入・完了（2026-09-27）

- [公式release](https://helloproject.com/juicejuice/release/6261/)に基づき、2020-04-01発売の5形態を登録した。`L00017`＝初回生産限定盤A（HKCN-50630）、`L00018`＝初回生産限定盤B（HKCN-50632）、`L00019`＝初回生産限定盤SP（HKCN-50634）、`L00020`＝通常盤A（HKCN-50636）、`L00021`＝通常盤B（HKCN-50637）である。
- 初回生産限定盤A/B/SPはtrack 1～3を`J00007`、`J00008`、`J00011`へ接続した。通常盤Aは同3曲にtrack 4の`J00009`、通常盤Bは同3曲にtrack 4の`J00010`を接続し、計17行を追加した。InstrumentalおよびDVD等の映像trackは仕様どおり登録していない。
- [公式ニュース11719](https://helloproject.com/news/11719/)により、「ポップミュージック」がKAN楽曲のカバーであること、「Borderline」と「Va-Va-Voom」が本シングルで初音源化されたこと、「続いていくSTORY (Symphonic Version feat. Karin)」が宮本佳林をフィーチャーしてすべて新たに録り直されたVersionであることを確認した。
- `J00007`は`W00006`、`version_type=cover`、`release_date=2020-04-01`を維持し、公式根拠確認済みとした。`J00008`は`W00007`、`original`、同日を維持する。`J00009` / `W00008`と`J00010` / `W00009`はユーザー判断どおり2020年版とterzo版を同一音源として扱い、既存ID、`original`、同日、およびterzo 3盤への接続を維持する。
- `J00011` / `W00010`は、公式に新たな録音と確認できたため、データ仕様の「同じworkを改めて録音した音源」に従い`version_type`を`other`から`re_recording`へ変更した。元音源の別releaseへの再収録は同じsong ID、明確な再録は同じworkの別song ID、New Vocal Ver.は`new_vocal`、別歌唱者によるカバーは`cover`という既存ルールを適用した代表例である。`release_date=2020-04-01`および宮本佳林（`P00001`）との既存performer関係は維持し、他のperformerを推測追加していない。
- [公式配信ニュース11918](https://helloproject.com/news/11918/)により、2020-04-01からアルバム配信、ハイレゾ配信、ビデオ配信等が開始され、音源として`J00007`～`J00011`の5曲が配信されたことを確認した。現在は確認済み配信releaseもまとめて後の配信release投入フェーズでCSV化する方針のため、今回だけ特殊なreleaseレコードを作らず保留した。
- 上記の公式配信は確認済みだが、独立releaseの正式名称が「Special Edition」である根拠は確認できない。したがってD09は存在・不存在のいずれとも断定せず未確認を継続する。通常CDと配信確認の完了からD09を切り離し、**A-3本体は完了**、次の投入対象は**A-4**とする。
- 新規song/work/creator/artist/memberはなく、作家クレジット、`G00001`とのartist関係、Juicetoryを含むA-4以降のCSVは変更していない。

### 4.8 A-4通常CD・Special Edition投入／完了（2026-09-29）

- [通常CD公式release](https://helloproject.com/juicejuice/release/detail/HKCN-50646/)に基づき、発売日は当初予定日ではなく実際の`2021-04-28`とした。通常CDは`L00022`＝初回生産限定盤A（HKCN-50646）、`L00023`＝初回生産限定盤B（HKCN-50648）、`L00024`＝初回生産限定盤SP1（HKCN-50650）、`L00025`＝初回生産限定盤SP2（HKCN-50652）、`L00026`＝通常盤A（HKCN-50654）、`L00027`＝通常盤B（HKCN-50655）の6形態である。各盤の音源track 1「DOWN TOWN」とtrack 2「がんばれないよ」の計12行だけを登録し、InstrumentalおよびDVD等の映像trackは登録していない。
- `J00012` / `W00011`「DOWN TOWN」は`version_type=cover`を維持する。作詞＝伊藤銀次（C00014）、作曲＝山下達郎（C00015）、編曲＝Anders Dannvik（C00016）の既存クレジットと一致した。ユーザー確定判断により2021年シングル版とterzo収録版は同一音源であり、既存IDとterzo 3盤への接続を維持して、初出日を`2021-04-28`とした。
- `J00013` / `W00012`「がんばれないよ」も、ユーザー確定判断により2021年シングル版とterzo収録版を同一音源として既存ID・既存terzo接続を維持し、初出日を`2021-04-28`とした。[2021年公式release](https://helloproject.com/juicejuice/release/detail/HKCN-50646/)と[terzo公式release](https://helloproject.com/juicejuice/release/6692/)の双方で作詞＝山崎あおい、作曲・編曲＝KOUGAと確認した。terzo初期投入時の作詞＝児玉雨子（C00006）、編曲＝炭竃智弘（C00005）は誤登録だったため、作詞＝山崎あおい（C00001）、編曲＝KOUGA（C00002）へ訂正し、作曲＝KOUGA（C00002）は維持した。旧誤データはCSVに残さず、訂正履歴を本節とGitで管理する。
- [Special Edition公式release](https://helloproject.com/juicejuice/release/detail/UFDL-1473/)を`L00028`（`digital`、UFDL-1473、2021-04-28）として登録した。track 1・2は通常版と同じ`J00012` / `J00013`、track 3～9は金澤朋子、植村あかり、稲場愛香、井上玲音、段原瑠々、工藤由愛、松永里愛の各「がんばれないよ」ソロVer.である。独自の正式release名・規格品番・9曲構成を持ち、ソロ7音源の公式初出でもあるため、一般的な同内容配信を後で一括投入する方針の例外としてA-4と同時にCSV化した。過去の未確認候補という状態は公式確認により解消済みである。
- ソロ7 Versionは`J00029`～`J00035`の独立songとし、すべて通常版と同じ`W00012`、`release_date=2021-04-28`、`version_type=other`とした。公式情報だけでは新録か既存セッション由来か断定できないため`re_recording`や`new_vocal`にはしていない。作詞＝C00001、作曲・編曲＝C00002を各songへ登録し、artistはJuice=Juice（G00001）とした。
- 各曲名に明記された歌唱者を構造化するため、金澤朋子（P00002）、植村あかり（P00003）、稲場愛香（P00004）、井上玲音（P00005）、段原瑠々（P00006）、工藤由愛（P00007）、松永里愛（P00008）を最小情報で新規member登録し、それぞれ1名を対応songのperformerとした。所属開始日等は今回の一次情報から確認できないため`member_affiliations.csv`へ推測登録していない。ソロsongを作成した根拠はSP盤の映像ではなく、Special Editionで正式な音源trackとして配信されたことである。
- 新規work、creator、artistはなく、通常版2曲の新規songもない。通常CD 6形態、Special Edition、ソロ7 song、performer、作家クレジットまで投入できたため、**A-4は完了**。通常release候補総数28件は変わらず、優先度A 5件中4件が完了し、残る次の投入対象は**A-5「プラスティック・ラブ／Familia／Future Smile」**である。A-5以降のCSVには着手していない。A-4に残る未確認事項およびユーザー判断事項はない。

### 4.9 A-5 CD 9形態投入／優先度A完了（2026-09-29）

- [公式release](https://helloproject.com/juicejuice/release/6613/)に基づき、2021-12-22発売「プラスティック・ラブ／Familia／Future Smile」のCD 9形態を登録した。`L00029`＝初回生産限定盤A（HKCN-50677）、`L00030`＝初回生産限定盤B（HKCN-50679）、`L00031`＝初回生産限定盤C（HKCN-50681）、`L00032`＝初回生産限定盤SP1（HKCN-50683）、`L00033`＝初回生産限定盤SP2（HKCN-50685）、`L00034`＝通常盤A（HKCN-50686）、`L00035`＝通常盤B（HKCN-50687）、`L00036`＝通常盤C（HKCN-50688）、`L00037`＝金澤朋子卒業記念盤（HKCP-50001）である。卒業記念盤は限定販売商品だが、公式ページの独立形態かつ独自規格品番を持つため別releaseとした。
- 9形態すべてのCD音源trackはtrack 1＝`J00014`「プラスティック・ラブ」、track 2＝`J00015`「Familia」、track 3＝`J00016`「Future Smile」であり、合計27 `release_tracks`を追加した。Instrumental、DVD、Blu-ray等の映像trackは登録していない。
- 3曲はいずれも2021年シングル版とterzo収録版が同一音源であるとのユーザー確定判断に基づき、既存song/work IDとterzo 3盤への接続を維持した。既存調査・CSVに2021-12-22より前の公式音源releaseはないため、3曲の`release_date`を`2021-12-22`、初出releaseを示す`source_url`をA-5公式releaseへ更新した。
- `J00014` / `W00013`「プラスティック・ラブ」は`version_type=cover`を維持し、作詞・作曲＝竹内まりや（C00017）、編曲＝Anders Dannvik（C00016）を確認した。`J00016` / `W00015`「Future Smile」は作詞＝大森祥子（C00019）、作曲＝Shusui（C00010）／Josef Melin（C00011）、編曲＝Josef Melin（C00011）を確認した。
- terzo初期投入時の`J00015` / `W00014`「Familia」は、作曲＝Shusui／Stefan Ekstedt、編曲＝Stefan Ekstedtと誤登録されていた。A-5公式releaseと[terzo公式release](https://helloproject.com/juicejuice/release/6692/)の双方で、作詞＝イイジマケン、作曲＝Shusui／Shim Zeyun／tsubomi、編曲＝鈴木俊介と一致することをユーザーが再確認したため、誤ったC00018との2関係を削除し、C00033＝Shim Zeyun、C00034＝tsubomi、C00035＝鈴木俊介を追加して訂正した。共同作曲は公式順1～3で独立creditとし、旧誤データはCSVに残さず本節とGitで履歴を管理する。C00018 creator masterおよび他songは変更していない。
- 金澤朋子卒業記念盤BDの「プラスティック・ラブ(feat. 金澤朋子 Ver.)」「Familia(feat. 金澤朋子 Ver.)」「Future Smile(feat. 金澤朋子 Ver.)」は映像収録のみ確認でき、独立した公式音源releaseではないため、song/work、song_performers、release_tracksを追加していない。SP1等の有澤一華「赤い日記帳」、入江里咲「恋ならとっくに始まってる」、江端妃咲「My Days for You」等のBDソロ映像も同様にsong化していない。これらは将来`videos.csv`、`video_songs.csv`、`video_song_performers.csv`を本格整備する際の候補とする。
- 映像に独自Version名があっても、それだけでは別songを作らず、独立した公式音源releaseを確認できる場合にsong化する方針を維持した。これは独自release名・規格品番・独自音源trackを持つA-4 Special Editionのソロ7音源とは異なる。
- 2021-12-22から同内容の一般デジタル配信が開始されたことは確認済みだが、一般配信releaseは今回CSV化しない。A-4 Special Edition相当の独自release名、独自規格品番、独自音源trackを推測作成していない。
- 新規song/work/artist/memberはなく、既存song_artists、song_performers、member_affiliationsも変更していない。新規creatorは上記3名のみである。以上により**A-5は完了**し、**優先度A 5件すべて完了**となった。通常release候補総数28件は変わらず、次の調査・投入対象はロードマップどおり**優先度Bのインディーズ3作から**とする。今回は優先度BのCSV投入およびJuicetoryには着手していない。

## 5. 優先度B・C

### 5.1 B-1「私が言う前に抱きしめなきゃね」投入完了（2026-10-02）

- 対象は **2013-04-03** 発売の「私が言う前に抱きしめなきゃね」、規格品番 `UFCW-1057`。[公式release](https://helloproject.com/release/2210/)のCD構成はtrack 1「私が言う前に抱きしめなきゃね」、track 2「私が言う前に抱きしめなきゃね (Instrumental)」である。`L00038`にtrack 1の `J00036` のみを登録し、Instrumentalは収集対象外として除外した。
- 事前確認時点の正本CSVにはMEMORIAL EDITと対応workが存在せず一度投入を停止した。その後、ユーザー判断で選択肢B（B-1でworkを新設）を採用し、`W00028`「私が言う前に抱きしめなきゃね」と `J00036` を新設して投入を再開した。`J00036` は `version_type=original`、`release_date=2013-04-03` である。
- 作家クレジットは作詞・作曲＝つんく（`C00028`）、編曲＝平田祥一郎（`C00009`）。artistはJuice=Juice（`G00001`）を `primary` とした。個々のperformerは当時の所属から推測せず、`song_performers.csv` には追加していない。
- 後発「私が言う前に抱きしめなきゃね(MEMORIAL EDIT)」と2013-09-11メジャーデビューreleaseは今回未投入。将来MEMORIAL EDITを登録する際は、`W00028` を必ず再利用し、originalの `J00036` は再利用せず新規song IDを作成する。`version_type` はその時点のdata-specと2013-09-11公式release情報に従って確定し、通常版とMEMORIAL EDITを同一workの別songとして維持する。
- artist共通設計は `docs/data-spec.md` で確定済みである。「天まで登れ！」の将来投入時は、ハロプロ研修生 feat. Juice=Juice版をハロプロ研修生=`primary`、Juice=Juice=`featured`、Juice=Juice単独版をJuice=Juice=`primary` とする。B-3のrelease/song/artistデータはまだ投入していない。
- **B-1は完了**。B-1完了時点では次のCSV投入対象をB-2「五月雨美女がさ乱れる」とし、B-2以降には着手していなかった。

### 5.2 B-2「五月雨美女がさ乱れる」投入完了（2026-10-03）

- 対象は **2013-05-05** 発売の「五月雨美女がさ乱れる」、規格品番 `UFCW-1065`。[公式release](https://helloproject.com/release/2211/)のCD構成はtrack 1「五月雨美女がさ乱れる」、track 2「五月雨美女がさ乱れる(Instrumental)」である。`L00039`にはdisc 1・track 1の `J00037` のみを登録し、Instrumentalは収集対象外として除外した。
- 事前確認時点の正本CSVには通常版、MEMORIAL EDITおよび対応workが存在しなかったため、ユーザー確定方針に従い `W00029` と通常版 `J00037` を新設した。`J00037` は `version_type=original`、`release_date=2013-05-05` である。後発「五月雨美女がさ乱れる(MEMORIAL EDIT)」とそれを収録するreleaseは今回未投入であり、将来は `W00029` を共有する別song IDを作成する。通常版の `J00037` は再利用せず、version_typeは将来の登録時点の仕様と公式情報から確定する。
- 作家クレジットは作詞・作曲＝つんく（`C00028`）、編曲＝板垣祐介（新規 `C00036`）、ブラスアレンジ＝鈴木俊介（既存 `C00035`）。`song_creators.role` に `brass_arrangement` を正式追加し、通常の `arrangement` と分離する共通仕様を `docs/data-spec.md` に定めた。鈴木俊介を通常編曲へ統合していない。
- artistはJuice=Juice（`G00001`）を `primary`、`credit_order=1` とした。featured artistはない。個々のperformerは当時の所属から推測せず、`song_performers.csv` には追加していない。
- **B-2は完了**。次のCSV投入対象はB-3「天まで登れ！」とする。B-3のwork、song、release、track、artistおよびcreator relationには着手していない。B-3の公式creditでブラスアレンジが明示された場合は、今回追加した `brass_arrangement` roleを再利用する。

### 5.3 B-3「天まで登れ！」投入完了（2026-10-03）

- 対象は **2013-06-12** 発売の「天まで登れ！」、規格品番 `UFCW-1066`。[公式release](https://helloproject.com/release/2212/)に基づき `L00040` を登録した。CDのtrack 1はハロプロ研修生 feat. Juice=Juice、track 2はJuice=Juiceによる「天まで登れ！」、track 3はInstrumentalである。`release_tracks`には実CDの番号を維持してtrack 1・2だけを登録し、track 3 Instrumentalは収集対象外として除外した。
- ユーザー確定判断に従い、抽象楽曲を `W00030` の1 workとし、track 1を `H00001`、track 2を `J00038` の別songとした。両方とも同日の最初の通常公式releaseとして異なる歌唱者で成立したため、data-specの同時成立例外に従い `version_type=original` とし、その根拠を各songのnotesに記録した。`H00001`は通常グループに属さないハロプロ研修生がprimaryのためH prefix、`J00038`はJuice=Juice単独primaryのためJ prefixである。両songの`release_date`は2013-06-12とした。
- 作家クレジットは両songとも、作詞・作曲＝つんく（`C00028`）、編曲＝平田祥一郎（`C00009`）、ブラスアレンジ＝鈴木俊介（`C00035`）である。`brass_arrangement`はB-2で追加済みの共通roleを再利用し、鈴木俊介を通常の`arrangement`へ統合していない。新規creatorはない。
- ハロプロ研修生を独立artist `G00002`、`type=trainee`として登録した。厳密な活動開始日は本releaseから確定できないため空欄とした。Juice=Juice（`G00001`）は既存の`type=group`を維持した。track 1では`G00002`を`primary`・order 1、`G00001`を`featured`・order 2、track 2では`G00001`を`primary`・order 1とした。「ハロプロ研修生 feat. Juice=Juice」という複合artist entityは作成していない。公式artist-credit textの専用schemaは未導入のため、公式表記は本調査記録に保持し、検索relationを`song_artists`へ登録した。
- `artists.type`に、公式の研修生・候補生・育成組織を別entityのまま横断分類する`trainee`を正式追加した。`project`はHello! Project全体または複数のデビューグループ等を横断する独立した公式artist名義向けと明文化し、`group`および既存typeとの境界も整理した。複数artist参加だけを理由にprojectを作らない。
- 個々の歌唱memberはartist creditや当時の所属から推測せず、`song_performers`を追加していない。ハロプロ研修生の`member_affiliations`も追加していない。First Squeeze！等の後続releaseと音源同一性には着手していない。
- **B-3は完了**。次のCSV投入対象は2013-09-11メジャーデビュー作とし、B-3より後のrelease/songは今回投入していない。

- **B（15件）**: インディーズ3作、2013-09-11から2018-04-18までの主要CD、`First Squeeze！`、`Juice=Juice#2 -¡Una más!-`。明示Version、MEMORIAL EDIT、Album Version、2022 ver.の境界を確認する。
- **C（7件）**: (1) 全部賭けてGO！！…、(2) プライド・ブライト…、(3) Juicetory、(4) トウキョウ・ブラー…、(5) 初恋の亡霊…、(6) 四の五の言わず颯と別れてあげた…、(7) **MORE! MORE! EP**。2026年の通常releaseが未確認という旧状態は解消した。

## 6. 優先度D（特殊release）

### 6.1 既存D01～D13の更新

番号と対象の対応は既存計画を維持する。D08は確認済みの先行配信・後発通常盤Cとは分離し、独立Special Edition候補として未確認を継続する。

| No. | release日 | releaseタイトル | 種別 | 品番 | 公式URL | 最新状態・terzoへの影響 |
|---:|---|---|---|---|---|---|
| D01 | 2017-05-19 | Goal〜明日はあっちだよ〜 | 配信 | UFDL-1334 | [公式詳細](https://helloproject.com/release/5363/) | **公式配信release確認済み**。J00028 Album Versionとの音源同一性は未確定で、通常版は別song候補。 |
| D02 | 2017-06-16 | 如雨露 | 配信 | UFDL-1344 | ChatGPT側で公式release確認済み。個別URLは今回の依頼文では未提示。 | **公式配信release確認済み**。 |
| D03 | 2017-08-23 | Fiesta! Fiesta! | 配信シングル | UFDL-1353 | ChatGPT側で公式release確認済み。個別URLは今回の依頼文では未提示。 | **公式配信release確認済み**。`Wonderful World(English Ver.)`も収録。両曲のsong/version関係を投入時確認。 |
| D04 | 未確認 | Never Never Surrender | 独立配信候補 | 未確認 | [公式一覧](https://helloproject.com/juicejuice/release/) | 曲の公式な存在は確認できるが、**独立配信releaseは未確認**。不存在とは断定しない。J00027は2022 ver.。 |
| D05 | 未確認 | TOKYOグライダー | 独立配信候補 | 未確認 | [公式一覧](https://helloproject.com/juicejuice/release/) | 曲の公式な存在は確認できるが、**独立配信releaseは未確認**。不存在とは断定しない。 |
| D06 | 未確認 | SEXY SEXY／泣いていいよ／Vivid Midnight (Special Edition) | Special Edition候補 | 未確認 | [公式一覧](https://helloproject.com/juicejuice/release/) | 独立release、正式タイトル、全track未確認。 |
| D07 | 未確認 | 微炭酸／ポツリと／Good bye & Good luck！ (Special Edition) | Special Edition候補 | 未確認 | [A-1公式詳細](https://helloproject.com/release/detail/HKCN-50580/?pc=1) | 初回生産限定盤SP（HKCN-50586）との混同の可能性があるが、独立した音源Special Edition releaseは現時点で公式確認できていない。不存在とは断定せず未確認を維持し、release IDは採番しない。後日のイベントV（TGBS-10960）は映像商品のため音源release CSVの対象外。 |
| D08 | 未確認 | 「ひとりで生きられそう」って それってねえ、褒めているの？／25歳永遠説 (Special Edition) | Special Edition候補 | 未確認 | [公式一覧](https://helloproject.com/juicejuice/release/) | 2019-10-10先行配信および2019-10-23通常盤Cとは別候補。独立Special Editionと呼べる公式根拠は未確認で、不存在とは断定せずrelease IDを採番しない。 |
| D09 | 未確認 | ポップミュージック／好きって言ってよ (Special Edition) | Special Edition候補 | 未確認 | [公式一覧](https://helloproject.com/juicejuice/release/) | 「Special Edition」という独立releaseは未確認。2020-04-01公式配信の存在確認済み（D23）とは分離し、不存在とも断定しない。 |
| D10 | 2021-04-28 | DOWN TOWN／がんばれないよ(Special Edition) | 配信 | UFDL-1473 | [公式詳細](https://helloproject.com/juicejuice/release/detail/UFDL-1473/) | **公式確認・CSV投入済み（L00028）**。通常2曲と、別songとして登録したメンバー別ソロVersion 7曲を収録。 |
| D11 | 2021-12-22 | プラスティック・ラブ／Familia／Future Smile | 一般デジタル配信 | 未提示 | [公式詳細](https://helloproject.com/juicejuice/release/6613/) | **公式配信の存在確認済み**。CDと同内容の一般配信としてCSV化を保留し、独自音源を持つSpecial Edition相当のreleaseは推測作成しない。 |
| D12 | 2020-04-01 | ポップミュージック／好きって言ってよ | CD（通常一覧の既存release） | 未提示 | [公式詳細](https://helloproject.com/juicejuice/release/6261/) | 通常28候補に含まれるCDとして解決し、5形態をCSV登録済み。J00011は2020-04-01初出の`re_recording`、Karin＝宮本佳林（P00001）として確定済み。 |
| D13 | 未確認 | プラトニック・プラネット（通常スタジオ版）を収録するrelease | 配信等候補 | 未確認 | [terzo詳細](https://helloproject.com/juicejuice/release/6692/) | **通常版スタジオ音源の公式音源releaseは未確認**。通常版が存在しないとは断定しない。J00024 Ultimate Juice Ver.とは区別。 |

### 6.2 Dリスト外から追加した確定release（D14～D23）

便宜上、既存番号に続けて管理番号を付す。すべて独立した公式音源releaseとして確認済みであり、CSVのrelease/song IDではない。

| No. | release日 | releaseタイトル | 種別 | 品番 | 公式URL | notes |
|---:|---|---|---|---|---|---|
| D14 | 2023-06-29 | プライド・ブライト | 先行配信 | 未提示 | ChatGPT側で公式release確認済み。個別URLは今回の依頼文では未提示。 | CDは2023-07-12。同一タイトルだが音源同一性は未判定。先行配信確認を必須にする根拠例。 |
| D15 | 2024-05-15 | トウキョウ・ブラー/ナイモノラブ/おあいこ(Special Edition) | 配信 | UFDL-1534 | [公式詳細](https://helloproject.com/release/7256/?pc=1) | 通常3曲と`Brilliance of memories`を収録。後者を植村あかりのsong/artist/memberとしてどう構造化するかは未確定。 |
| D16 | 2024-05-29 | Juice=Juice 10th Anniversary Concert Tour 2023 Final ～Juicetory～ | ライブ音源配信 | UFDL-1536 | [公式詳細](https://helloproject.com/release/7273/?pc=1) | プライド・ブライト、Next is you!、プラトニック・プラネット、Dream Road～心が躍り出してる～等を含む。各trackは今回song化しない。 |
| D17 | 2025-12-23 | 盛れ！ミ・アモーレ(BAND Live Ver.) | 配信 | UFDL-1571 | [公式詳細](https://helloproject.com/release/7625/) | 映像だけでなく公式音源release。同一workの別song/version候補。 |
| D18 | 2025-12-23 | 盛れ！ミ・アモーレ(Concert 2025 Queen of Hearts Special Flush) | 配信 | UFDL-1572 | ChatGPT側で公式release確認済み。個別URLは今回の依頼文では未提示。 | 同一workの別song/version候補。 |
| D19 | 2025-12-23 | 盛れ！ミ・アモーレ - From THE FIRST TAKE | 配信 | UFDL-1573 | ChatGPT側で公式release確認済み。個別URLは今回の依頼文では未提示。 | 映像だけでなく公式音源release。同一workの別song/version候補。 |
| D20 | 2026-04-06 | Juice=Juice Concert 2025 Queen of Hearts Special Flush | ライブ音源配信 | UFDL-1586 | [公式詳細](https://helloproject.com/release/7662/?pc=1) | 各trackのsong化は今回行わない。 |
| D21 | 2026-04-06 | Juice=Juiceスペシャルライブ2025 ～10月10日はJuice=Juiceの日～ | ライブ音源配信 | UFDL-1587 | [公式詳細](https://helloproject.com/release/7663/) | 各trackのsong化は今回行わない。 |
| D22 | 2019-10-10 | 「ひとりで生きられそう」って それってねえ、褒めているの？(New Vocal Ver.) | iTunes先行配信 | 未提示 | [公式ニュース](https://helloproject.com/news/11099/) | **公式配信確認済み**。J00006の初出日へ反映済み。配信releaseのCSV投入フェーズでレコード化する。2019-10-23通常盤CおよびD08候補とは区別する。 |
| D23 | 2020-04-01 | ポップミュージック／好きって言ってよ | 公式配信 | 未提示 | [公式ニュース](https://helloproject.com/news/11918/) | **公式配信確認済み**。J00007～J00011の5音源を確認済み。配信release投入フェーズまでCSV化を保留し、名称未確認のD09 Special Edition候補とは区別する。 |

### 6.3 Special Editionの設計メモ

- D10はL00028としてCSV投入済み。通常2曲は既存songを参照し、「がんばれないよ」のメンバー別ソロVersion 7曲はW00012を共有するJ00029～J00035、`version_type=other`として各performerとともに確定した。
- D15の`Brilliance of memories`は植村あかりの楽曲として扱う可能性があるが、song/artist/member構造は投入時の確認事項とする。
- Special Editionが別releaseであることだけでは、通常CDと別songとは判定しない。

### 6.4 プラトニック・プラネットの3区分

1. **通常スタジオ版**: 通常版の歌唱は公式ライブ映像等で識別できるが、CD・配信等で販売された公式スタジオ音源releaseは現時点で未確認。不存在とは断定しない。
2. **Ultimate Juice Ver.**: terzo収録のJ00024。通常版とは区別する。
3. **ライブ音源版**: D16に通常表記の`プラトニック・プラネット`が収録される。通常スタジオ版、Ultimate Juice Ver.、ライブ音源版を区別して判定する。

通常版には今回`song_id`を採番しない。将来ハロ！ステ等を`video_songs`へ登録する段階で、現在の境界「song＝公式音源releaseされたもの」を「song＝公式に識別可能な具体的歌唱Version」へ拡張するか検討する。今回は仕様を変更しない。

## 7. terzo既存songへの影響

- **J00006**: 2019-10-10 iTunes先行配信を初出として`release_date`へ反映し、2019-10-23通常盤C（L00016）のtrack 3へ接続済み。J00004とW00004を共有する別songである。先行配信release自体のCSV化は配信release投入フェーズまで保留し、D08独立Special Edition候補とは区別する。
- **J00009 Borderline**: 2020-04-01シングルでの初音源化を公式確認済み。ユーザー判断によりterzo収録版と同一音源として確定し、`release_date=2020-04-01`、`version_type=original`および両releaseへの接続を維持する。
- **J00010 Va-Va-Voom**: 2020-04-01シングルでの初音源化を公式確認済み。ユーザー判断によりterzo収録版と同一音源として確定し、`release_date=2020-04-01`、`version_type=original`および両releaseへの接続を維持する。
- **J00011 続いていくSTORY (Symphonic Version feat. Karin)**: 2020-04-01初出、`version_type=re_recording`として確定。公式の「すべて新たに録り直したVersion」を根拠とし、Karin＝宮本佳林（P00001）の既存関係を維持する。
- **J00024 プラトニック・プラネット(Ultimate Juice Ver.)**: terzoのVersion表記を維持。通常スタジオ版の公式音源releaseは未確認であり統合しない。D16のライブ音源とも区別し、いずれも今回はsong化しない。
- **J00027/J00028**: D04の独立配信は未確認だが、D01は公式配信release確認済み。2022 ver./Album Versionと無表記版の音源同一性は未確定。

## 8. CSV投入時の必須確認手順

各CDシングル・アルバム・EPについて、次の順で確認する。

1. CD／通常release詳細ページ
2. 同日Special Edition
3. CDより前の先行配信
4. 配信限定追加track
5. New Vocal等の別Version
6. 後日の公式ライブ音源、THE FIRST TAKE、BAND Live等

**1～5は初出日・song判定に直接影響するためCSV投入時の必須確認**とする。**6は後発Versionなので元songの`release_date`判定と分離して追加調査できる**。`プライド・ブライト`（配信2023-06-29、CD2023-07-12）は、CD日を自動採用できない具体例である。

## 9. 推奨投入順

1. **優先度A**はA-1～A-5の5件すべて完了済みである。
2. **優先度B**を、インディーズ3作、メジャーシングル、`First Squeeze！`、`Juice=Juice#2 -¡Una más!-`の順で扱う。
3. **優先度C**を発売順に扱い、2026-06-24 `MORE! MORE! EP`まで進める。
4. **優先度D**を扱う。DのうちA/Cに直接関連する先行配信・Special Editionは当該通常releaseと同時確認するが、2025/2026年ライブ音源をAより先に投入する必要はない。

## 10. CSV投入前の要確認事項

1. **音源同一性**: J00009～J00011と2020年CDは解決済み。残るJ00027/J00028と2017年配信・#2、通常CDと各Special Editionは、公式情報だけで決められなければ統合も新規採番もしない。
2. **未確認の独立release**: D04～D09、D13。D08は2019-10-10先行配信や2019-10-23通常盤Cではなく独立Special Edition候補を指す。D11は同内容の一般デジタル配信として確認済みであり、独立Special Editionを推測しない。未確認は不存在を意味しない。
3. **Special Editionのsong粒度**: D10は解決済み。D15の`Brilliance of memories`のsong/artist/member構造。
4. **特殊音源のsong粒度**: D16～D21のライブ、BAND Live、THE FIRST TAKE各音源を別songとするか、workを共有するか、`version_type`を何にするか。
5. **通常版プラトニック・プラネット**: 公式動画内で識別可能な歌唱Versionにまでsongの境界を拡張するか。`video_songs`実装時まで保留。
6. **名義**: 「天まで登れ！」はB-3で解決済み。残るNEXT YOU、featured表記、メンバーソロ等をartist/release/song_performersへどう表すか。
7. **アルバム内Version**: MEMORIAL EDIT、Album Version、2022 ver.、Version名なし再収録の音源同一性。

## 11. 登録済みreleaseとCSV投入状況

`data/releases.csv`にはterzo 3盤（L00001～L00003）、A-1～A-5の34盤（L00004～L00037）、B-1～B-3のインディーズシングル（L00038～L00040）の**計40 releaseレコード**がある。`release_tracks.csv`は187行、`songs.csv`は39行、`works.csv`は30行である。
A-4では通常版J00012/J00013を再利用し、ソロVersion J00029～J00035を追加した。A-5ではJ00014～J00016を再利用し、Familiaの作家誤登録訂正に伴うcreator 3件だけを追加した。B-1ではL00038/W00028/J00036、B-2ではL00039/W00029/J00037およびC00036、B-3ではL00040/W00030/H00001/J00038/G00002を追加した。B-3より後、Juicetory、ハロ！ステDB・Web・集計処理には着手していない。

## 12. 件数集計

一覧から機械的に数えると次のとおりである。

- 更新前: 通常release候補27、D確定0、**確定release候補総数27**、未確定D 13、最大探索母数40。
- 更新後の通常release: 既存27 + `MORE! MORE! EP` 1 = **28**（A 5、B 15、C 7、登録済みterzo 1。各区分はタイトル単位で重複なし）。
- 更新後のD確定: 既存DからD01/D02/D03/D10/D11の5 + Dリスト外D14～D23の10 = **15**。D11は一般デジタル配信として確認済みだがCSV化を保留する。D12は既存通常releaseである2020-04-01 CDへ解決したためD確定件数に重複加算しない。D22は2019-10-10先行配信で、後発通常盤CやD08候補とは別releaseとして数える。
- 更新後の確定release候補総数: 通常28 + D確定15 = **43**。2019-10-23通常盤Cは既存のA-2タイトル候補に含まれる盤違いのため通常候補へ単純加算しない。
- 更新後の未確定候補: D04～D09、D13の**7**。D11は一般デジタル配信の確認により未確定から除外した。
- 更新後の最大探索母数: 確定43 + 未確定7 = **50**。
- DB登録済み: **40 releaseレコード**（terzo 3盤 + A-1 7形態 + A-2の2019-06-05 CD 5形態 + 後発通常盤C 1形態 + A-3 5形態 + A-4通常CD 6形態・Special Edition 1件 + A-5 CD 9形態 + B-1～B-3各1件）。確定release候補総数43はタイトル／release単位のロードマップ件数であり、CSVの盤単位レコード数とは一致しない。
- 最古の通常候補: 2013-04-03「私が言う前に抱きしめなきゃね」。最新の確認済みrelease: 2026-06-24 `MORE! MORE! EP`。したがって旧記述「最新は2025-10-08」「2026年作品未確認」は更新済み。

## 13. 公式URL一覧（今回追加分）

- https://helloproject.com/release/2212/ — B-3「天まで登れ！」の発売日、規格品番、track、作家クレジットおよび歌唱名義

- https://helloproject.com/release/5872/ — `微炭酸／ポツリと／Good bye & Good luck！`
- https://helloproject.com/release/detail/HKCN-50580/?pc=1 — 同作の7形態、trackおよびクレジット
- https://helloproject.com/news/9883/ — 2019-02-13配信開始情報
- https://helloproject.com/juicejuice/release/detail/HKCN-50629/ — 2019-10-23通常盤C、収録trackおよびNew Vocal Ver.
- https://helloproject.com/news/11099/ — 2019-10-10 New Vocal Ver. iTunes先行配信
- https://helloproject.com/release/5363/ — `Goal〜明日はあっちだよ〜`
- https://helloproject.com/juicejuice/release/6261/ — `ポップミュージック／好きって言ってよ`の5形態、規格品番、track
- https://helloproject.com/news/11719/ — カバー、初音源化、再録の根拠
- https://helloproject.com/news/11918/ — 2020-04-01公式配信開始と対象音源
- https://helloproject.com/juicejuice/release/detail/UFDL-1473/ — `DOWN TOWN/がんばれないよ(Special Edition)`
- https://helloproject.com/juicejuice/release/6613/ — `プラスティック・ラブ／Familia／Future Smile`の9形態、track、クレジットおよび一般配信
- https://helloproject.com/release/7256/?pc=1 — `トウキョウ・ブラー/ナイモノラブ/おあいこ(Special Edition)`
- https://helloproject.com/release/7273/?pc=1 — `Juice=Juice 10th Anniversary Concert Tour 2023 Final ～Juicetory～`
- https://helloproject.com/release/7625/ — `盛れ！ミ・アモーレ(BAND Live Ver.)`
- https://helloproject.com/release/7662/?pc=1 — `Juice=Juice Concert 2025 Queen of Hearts Special Flush`
- https://helloproject.com/release/7663/ — `Juice=Juiceスペシャルライブ2025 ～10月10日はJuice=Juiceの日～`

`如雨露`、`Fiesta! Fiesta!`、`プライド・ブライト`先行配信、UFDL-1572、UFDL-1573、`MORE! MORE! EP`はChatGPT側でHello! Project公式掲載を確認済みだが、依頼文に個別URLが提示されていないためURLを生成していない。

## 14. B-4 2013-09-11メジャーデビューシングル調査・投入（完了）

調査日・投入日: 2026-10-03。前回の調査記録と投入計画を保持し、確定方針に基づく実投入結果を14.8へ追記する。

### 14.1 公式release情報

1. **公式release情報**: Hello! Project公式詳細は本作をJuice=JuiceのCDシングルとして掲載している。公式artist creditは3曲とも「歌：Juice=Juice」である。
2. **release title**: `ロマンスの途中/私が言う前に抱きしめなきゃね(MEMORIAL EDIT)/五月雨美女がさ乱れる(MEMORIAL EDIT)`。
3. **release date**: 2013-09-11。
4. **label**: hachama。
5. **edition一覧**: 初回生産限定盤A、B、C、D、E、通常盤の6形態。
6. **各catalog number**:

   | edition | catalog number | 付属物 |
   |---|---|---|
   | 初回生産限定盤A | HKCN-50310 | DVD付 |
   | 初回生産限定盤B | HKCN-50312 | DVD付 |
   | 初回生産限定盤C | HKCN-50314 | DVD付 |
   | 初回生産限定盤D | HKCN-50316 | DVD付 |
   | 初回生産限定盤E | HKCN-50318 | DVD付 |
   | 通常盤 | HKCN-50320 | CD |

7. **各editionのCD track構成**: 6形態すべて同一で、1 `ロマンスの途中`（04:58）、2 `私が言う前に抱きしめなきゃね(MEMORIAL EDIT)`（04:13）、3 `五月雨美女がさ乱れる(MEMORIAL EDIT)`（04:10）、4 `ロマンスの途中(Instrumental)`（04:58）、5 `私が言う前に抱きしめなきゃね(MEMORIAL EDIT)(Instrumental)`（04:13）、6 `五月雨美女がさ乱れる(MEMORIAL EDIT)(Instrumental)`（04:11）。
8. **Instrumental構成**: 各盤track 4～6。現行仕様ではInstrumentalはsongにもrelease_tracksにも登録しないため、計画対象は各盤track 1～3のみとする。
9. **DVD/映像構成の概要**: Aは`ロマンスの途中` Music Video／Dance Shot Ver.、Bは`私が言う前に抱きしめなきゃね(MEMORIAL EDIT)` Music Video／Dance Shot Ver.、Cは`五月雨美女がさ乱れる(MEMORIAL EDIT)` Music Video／Dance Shot Ver.、Dは`私が言う前に抱きしめなきゃね(MEMORIAL EDIT)` Close-up Ver／Dance Shot Ver.Ⅱ、Eは`五月雨美女がさ乱れる(MEMORIAL EDIT)` Close-up Ver／Dance Shot Ver.Ⅱ。音源song/release_tracksには登録せず、将来のvideos/video_songs候補とする。
10. **公式NEWS等の追加一次情報**: 2013-06-13公式NEWSは新曲`ロマンスの途中`で今夏メジャーデビュー決定と告知し、2013-07-27公式NEWSは本作を9月11日発売のデビューシングルと告知した。2013-08-19公式NEWSも6形態と各品番を列挙する。2013-09-11公式NEWSは3曲の着うた・着うたフルおよびビデオクリップの同日配信開始を明記する。一方、確認できた公式情報には`MEMORIAL EDIT`の録音・ボーカル・アレンジ・編集上の差分説明はなかった。

公式一次情報:

- https://helloproject.com/release/1656/
- https://helloproject.com/news/346/
- https://helloproject.com/news/300/
- https://helloproject.com/news/265/?pc=1
- https://helloproject.com/news/232/

### 14.2 現在CSVとの突合結果

11. **現在CSVとの突合結果**: 現在の正本はreleases 40行、release_tracks 187行、songs 39行、works 30行、creators 36行、artists 2行、members 8行。対象タイトル、6品番、および`ロマンスの途中`に一致するwork/song/release_trackは未登録。最大IDはrelease `L00040`、Juice=Juice song `J00038`、work `W00030`。
12. **ロマンスの途中の既存work有無**: なし。works.csv全体およびterzo関連行を突合した。
13. **ロマンスの途中の既存song有無**: なし。songs.csv、release_tracks.csv、terzo 3盤を含む既存Juice=Juiceデータに該当なし。
14. **私が言う前に抱きしめなきゃねの既存work/song**: `W00028`と、2013-04-03インディーズ通常版`J00036`（`original`）が存在する。
15. **五月雨美女がさ乱れるの既存work/song**: `W00029`と、2013-05-05インディーズ通常版`J00037`（`original`）が存在する。
16. **MEMORIAL EDITと既存originalの関係**: ユーザー確定方針どおり、それぞれW00028／W00029を共有する別songとする。新規workは作らない。公式releaseページはMEMORIAL EDITを明示した別表記で掲載するが、元音源との技術的差分までは説明しない。
17. **MEMORIAL EDITの公式説明有無**: 今回確認した公式releaseおよびNEWSに、新録、vocal再録、arrangement変更、単なるeditのいずれかを特定できる説明はない。曲名、尺、同一の作家クレジットだけから差分を推測しない。

### 14.3 MEMORIAL EDITのversion_type検討

18. **候補**: 現行enumのうち`re_recording`または`other`。`original`は同workの先行通常版J00036/J00037が既に存在し、`new_vocal`は公式にNew Vocalまたはボーカル差し替えと説明されず、`cover`は同一artistの後発Versionなので適合しない。
19. **各候補の理由**: `re_recording`は新録・再録が公式根拠で確認できる場合に検索・集計上明瞭だが、本件ではその根拠が不足する。`other`は公式に別Versionとされたものの再録と確定できない場合というdata-specの定義に合い、推測を避けられる一方、将来の再録集計には含まれず、根拠判明時に更新が必要となる。
20. **推奨version_type**: 既存仕様をそのまま適用するなら2曲とも`other`を推奨する。これは`MEMORIAL EDIT`という名称だけで分類する結論ではなく、公式な別Version表記がある一方で、変更内容を特定する公式説明がないためである。
21. **ユーザー判断の要否**: 必要。別song化は確定済みだが、`other`で投入するか、追加一次情報を待って保留するか、別途再録根拠をユーザーが提示・確定して`re_recording`とするかは実投入前に確定する。

### 14.4 creditおよびrelation計画

22. **creator credit**:

   | song | lyrics | composition | arrangement | brass_arrangement |
   |---|---|---|---|---|
   | ロマンスの途中 | つんく | つんく | 鈴木俊介 | — |
   | 私が言う前に抱きしめなきゃね(MEMORIAL EDIT) | つんく | つんく | 平田祥一郎 | — |
   | 五月雨美女がさ乱れる(MEMORIAL EDIT) | つんく | つんく | 板垣祐介 | 鈴木俊介 |

23. **creator ID突合**: つんく=`C00028`、平田祥一郎=`C00009`、鈴木俊介=`C00035`、板垣祐介=`C00036`を再利用する。`五月雨美女がさ乱れる(MEMORIAL EDIT)`では板垣を`arrangement`、鈴木を`brass_arrangement`として分離する。
24. **新規creator必要有無**: なし。
25. **song_artists計画**: 新規3 songすべて`G00001` Juice=Juice、`role=primary`、`credit_order=1`。featured artistは追加しない。
26. **song_performers計画**: 公式情報に個別歌唱者の明示がないため追加なし。当時の所属から推測しない。

### 14.5 release、song、work、track投入計画

27. **release登録計画**: 品番が異なる6 physical editionを各1 release（`release_type=single`、日付2013-09-11、labelは現行releases列にないため構造化しない）として登録する。notesに盤名とDVD有無を記録する。映像trackは音源release_tracksへ入れない。
28. **想定release ID**: 現在の状態なら`L00041`～`L00046`。今回は確定・採番しない。
29. **song登録計画**: `ロマンスの途中`を新規song（`original`、2013-09-11）、両MEMORIAL EDITをW00028／W00029配下の新規別song（version_type要判断、2013-09-11）として計3件登録する。公式NEWS上、3曲はCDと同日配信であり、これより前の公式音源releaseは今回確認できなかった。ライブ披露日は初出日に用いない。
30. **想定song ID**: 現在の状態なら`J00039`～`J00041`。想定対応はJ00039=`ロマンスの途中`、J00040=`私が言う前に抱きしめなきゃね(MEMORIAL EDIT)`、J00041=`五月雨美女がさ乱れる(MEMORIAL EDIT)`だが、今回は確定・採番しない。
31. **work登録計画**: `ロマンスの途中`だけ新規workを1件作成し、両MEMORIAL EDITは既存W00028／W00029を再利用する。
32. **想定work ID**: 現在の状態なら`W00031`。今回は確定・採番しない。
33. **release_tracks登録計画**: 6 releaseそれぞれdisc 1のtrack 1～3を同じ3 songへ接続し、商品上のMEMORIAL EDIT表記をtrack_titleに保持する。track 4～6のInstrumentalとDVD映像は除外する。
34. **想定追加release_tracks件数**: 6形態×3曲=18行。
35. **同日デジタル配信の扱い**: 2013-09-11公式NEWSで同日配信を確認した。ただしNEWSは着うた・着うたフル・ビデオクリップを複数サイトで開始したことを示す一方、現行仕様・既存運用から、CDと同内容の一般配信を独立した`digital` releaseとして必ず登録するか、サービス別に分けるかは一意に決まらない。今回の6 physical releaseとは別の要判断事項として保留し、勝手にreleaseを増やさない。
36. **後続releaseとの関係**: 2015-07-15 `First Squeeze！`公式ページは通常盤Disc 1に同じ3表記・尺・作家クレジット（04:58／04:13／04:10）を掲載する。ただし現在CSVに同アルバムは未登録で、公式ページは「同一audio」と明言しないため、今回のsongとの統合は後続release投入時に確認する。尺一致だけでは断定しない。terzoには3曲のsong登録・release_tracks登録がない。
37. **既存データへの影響候補**: W00028/J00036およびW00029/J00037の既存original判定は維持でき、B-3とterzo/A-1～A-5に今回修正すべき箇所は見つからなかった。First Squeeze！は将来の追加対象だが既存データの誤りではない。
38. **未確認事項**: MEMORIAL EDITの具体的変更内容、First Squeeze！収録音源との厳密な同一性、2013-09-11より前の配信音源の有無（今回確認した公式情報では見つからないが不存在の断定はしない）、デジタルreleaseの粒度。

### 14.6 ユーザー判断事項

39. **MEMORIAL EDITのversion_type**

対象：`私が言う前に抱きしめなきゃね(MEMORIAL EDIT)`、`五月雨美女がさ乱れる(MEMORIAL EDIT)`。

公式事実：2013-09-11 releaseで公式にMEMORIAL EDITと表記され、Juice=Juice歌唱として収録・同日配信された。確認できた公式情報は変更内容を説明していない。

公式URL：https://helloproject.com/release/1656/ 、https://helloproject.com/news/232/

現在の既存データ：W00028/J00036（2013-04-03、original）およびW00029/J00037（2013-05-05、original）。MEMORIAL EDITは各workを共有する別songとすることが確定済み。

現在のdata-spec：enumは`original`, `new_vocal`, `re_recording`, `cover`, `other`。公式表記だけで再録と確定できない公式別Versionは`other`とし、根拠確認後に`re_recording`への更新を検討する。

判断できない理由：名称、尺、作家クレジットは判明するが、新録、ボーカル再録、アレンジ変更、編集のどれかを特定する公式説明がない。

選択肢A：2曲とも`other`。

影響：現行仕様に最も直接整合し、根拠のない再録分類を避ける。再録検索・集計には含まれず、公式根拠が後日判明した場合は更新する。

選択肢B：2曲とも保留し、追加一次情報が得られるまでsong/release一式の実投入を待つ。

影響：分類誤りを最大限避けるが、確認済みphysical release 6形態の投入も進められない。

選択肢C：ユーザーが別途公式の再録根拠を提示・確定できる場合に限り`re_recording`。

影響：再録検索・集計に含められるが、現時点の確認済み一次情報だけで選ぶと仕様の根拠要件を満たさない。

推奨案：選択肢A（2曲とも`other`）。

推奨理由：別song化は確定済みであり、現行data-specが「公式表記だけでは再録と確定できない別Version」に明示的な受け皿を設けているため。

**同日デジタル配信のrelease登録**も次回投入前に判断が必要である。推奨は、まず確実な6 physical editionのみを投入し、一般配信を独立release化する全体方針と粒度が決まるまでデジタルreleaseを保留すること。音源3件の`release_date=2013-09-11`は同日なので、この保留によって初出日は変わらない。

### 14.7 推奨投入手順と変更範囲

40. **推奨投入手順**: (1) ユーザーがMEMORIAL EDITのversion_typeとデジタルrelease方針を確定、(2) W00031候補を作成、(3) J00039～J00041候補を作成、(4) 既存creatorでsong_creatorsを作成、(5) G00001のsong_artistsを作成しsong_performersは追加しない、(6) L00041～L00046候補を6形態分作成、(7) release_tracks 18行を作成、(8) schema・参照整合性・件数・CSV差分を検証、(9) 後続First Squeeze！および映像は別タスクで扱う。
41. **前回調査フェーズで変更したファイル**: `docs/research/juicejuice-discography-plan.md`のみ。
42. **前回調査フェーズのCSV未変更確認**: `data/*.csv`は変更しなかった。
43. **data-spec未変更確認**: `docs/data-spec.md`は変更しない。新enumも追加しない。

### 14.8 実投入結果

44. **完了状態**: 2013-09-11メジャーデビューシングルのphysical 6形態を正本CSVへ投入完了。labelは`hachama`だが現行release schemaにlabel列がないため構造化していない。
45. **release ID・盤種・品番**:

   | release ID | edition | catalog number |
   |---|---|---|
   | L00041 | 初回生産限定盤A（DVD付） | HKCN-50310 |
   | L00042 | 初回生産限定盤B（DVD付） | HKCN-50312 |
   | L00043 | 初回生産限定盤C（DVD付） | HKCN-50314 |
   | L00044 | 初回生産限定盤D（DVD付） | HKCN-50316 |
   | L00045 | 初回生産限定盤E（DVD付） | HKCN-50318 |
   | L00046 | 通常盤（CD） | HKCN-50320 |

46. **work・song**: 新規workはW00031=`ロマンスの途中`のみ。J00039（W00031、version_nameなし、`original`）、J00040（W00028、`MEMORIAL EDIT`、`other`）、J00041（W00029、`MEMORIAL EDIT`、`other`）を追加し、release_dateはいずれも2013-09-11とした。MEMORIAL EDIT用のworkは作らず既存W00028／W00029を共有し、既存J00036／J00037の`original`は維持した。
47. **creator credit**: J00039はつんく（C00028）がlyrics／composition、鈴木俊介（C00035）がarrangement。J00040はつんく（C00028）がlyrics／composition、平田祥一郎（C00009）がarrangement。J00041はつんく（C00028）がlyrics／composition、板垣祐介（C00036）がarrangement、鈴木俊介（C00035）が`brass_arrangement`。鈴木俊介をJ00041の通常arrangementには重複登録していない。新規creatorは追加していない。
48. **artist・performer**: 3 songともJuice=Juice（G00001）を`primary`、credit_order 1で登録した。featured artistおよびsong_performersは追加していない。
49. **release_tracks**: L00041～L00046の各releaseにdisc 1、track 1=J00039、track 2=J00040、track 3=J00041を登録し、合計18行を追加した。商品上のtrack番号を維持した。
50. **対象外・後続**: Instrumental（各盤track 4～6）は本DBのsong／release_tracks管理対象外として登録していない。DVD映像は音源データへ追加せず、将来のvideos／video_songs系タスク候補とする。2013-09-11のデジタル配信はrelease粒度確定後の後続タスク、`First Squeeze！`は収録音源の同一性を同アルバム調査時に確認する後続タスクとして、いずれも今回登録していない。
51. **投入後件数**: releases 46、release_tracks 205、songs 42、works 31、creators 36、artists 2、members 8。data-spec変更なし。

## 15. B-5～B-9 1stアルバム前5シングル調査・投入計画（未投入）

調査日: 2026-10-03。対象は2013-12-04から2015-04-08までの5シングルだけとし、`First Squeeze！`は関係確認に限った。Hello! Project公式release本文と公式NEWSを一次情報に用い、正本CSV 14表、README、data-specを再照合した。**この節は調査・計画のみで、`data/*.csv`および`docs/data-spec.md`は変更していない。**

### 15.1 結論と停止点

- **そのまま投入可能（分類A）**: physical 29形態、各盤の通常曲2 track（計58 relation）、10 work、10 song（いずれも`original`候補）、公式作家relation、各songの`G00001` / `primary`。InstrumentalとDVD映像は現仕様どおり投入しない。
- **DB方針判断が必要（分類B）**: 2013-11-27先行「着うたフル」とCD収録音源の同一性を一次情報が明言していないため、最初の2 songの`release_date`を11月27日にするか12月4日にするか。さらに、シングルでは正式track titleが`Ça va ? Ça va ?`、アルバムでは`Ça va ? Ça va ?(サヴァサヴァ)`となる表記差を、同一songの`track_title`差として将来扱うか、音源同一性確認まで別song候補として保留するか。
- **一次情報不足（分類C）**: 残る4作の発売日前full-audio配信の不存在、全10曲と`First Squeeze！`収録音源の同一audio、個人歌唱者。見つからないことを不存在とはしていない。
- **停止点**: 上記Bの判断が必要になるまでCSVは一切変更していない。推奨投入単位は **C（判断のある第2シングルを分離し、残る4作をまとめる）**。ただし4作もalbum音源再利用はせず、まずsingle songを作り、`First Squeeze！`投入時に同一audioを再確認する。

### 15.2 公式release・physical edition一覧

全作のartistはJuice=Juice、種別はCDシングル、labelはhachama。sourceは各行の公式詳細。planned IDは現在最大`L00046`からの便宜的な候補であり、予約・確定ではない。

| single（official title） | edition | catalog | date | CD track差 | DVD | source | planned ID |
|---|---|---|---|---|---|---|---|
| イジワルしないで 抱きしめてよ/初めてを経験中 | 初回A | HKCN-50324 | 2013-12-04 | 順序A | MV: イジワル | [公式](https://helloproject.com/release/1667/) | L00047 |
| 同上 | 初回B | HKCN-50326 | 同日 | 順序A | MV: 初めて | 同上 | L00048 |
| 同上 | 初回C | HKCN-50328 | 同日 | 順序A | 両曲Close-up、making/off shot | 同上 | L00049 |
| 同上 | 初回D | HKCN-50330 | 同日 | 順序A | なし | 同上 | L00050 |
| 同上 | 通常A | HKCN-50331 | 同日 | 順序A | なし | 同上 | L00051 |
| 同上 | 通常B | HKCN-50332 | 同日 | 順序A | なし | 同上 | L00052 |
| 裸の裸の裸のKISS/アレコレしたい！ | 初回A | HKCN-50343 | 2014-03-19 | 順序A | 裸… MV/Dance Shot | [公式](https://helloproject.com/release/8/) | L00053 |
| 同上 | 初回B | HKCN-50345 | 同日 | 順序B | アレコレ… MV/Dance Shot | 同上 | L00054 |
| 同上 | 初回C | HKCN-50347 | 同日 | 順序A | 両曲Close-up、making/off shot | 同上 | L00055 |
| 同上 | 通常A | HKCN-50349 | 同日 | 順序A | なし | 同上 | L00056 |
| 同上 | 通常B | HKCN-50350 | 同日 | 順序B | なし | 同上 | L00057 |
| ブラックバタフライ/風に吹かれて | 初回A | HKCN-50367 | 2014-07-30 | 順序A | ブラック… MV | [公式](https://helloproject.com/release/2277/) | L00058 |
| 同上 | 初回B | HKCN-50369 | 同日 | 順序B | 風… MV | 同上 | L00059 |
| 同上 | 初回C | HKCN-50371 | 同日 | 順序A | ブラック… Dance Shot、making/off shot | 同上 | L00060 |
| 同上 | 初回D | HKCN-50373 | 同日 | 順序B | 風… Dance Shot、making/off shot | 同上 | L00061 |
| 同上 | 通常A | HKCN-50375 | 同日 | 順序A | なし | 同上 | L00062 |
| 同上 | 通常B | HKCN-50376 | 同日 | 順序B | なし | 同上 | L00063 |
| 背伸び/伊達じゃないよ うちの人生は | 初回A | HKCN-50387 | 2014-10-01 | 順序A | 背伸び MV | [公式](https://helloproject.com/release/2371/) | L00064 |
| 同上 | 初回B | HKCN-50389 | 同日 | 順序B | 伊達… MV | 同上 | L00065 |
| 同上 | 初回C | HKCN-50391 | 同日 | 順序A | 背伸び Dance Shot、making/off shot | 同上 | L00066 |
| 同上 | 初回D | HKCN-50393 | 同日 | 順序B | 伊達… Dance Shot、making/off shot | 同上 | L00067 |
| 同上 | 通常A | HKCN-50395 | 同日 | 順序A | なし | 同上 | L00068 |
| 同上 | 通常B | HKCN-50396 | 同日 | 順序B | なし | 同上 | L00069 |
| Wonderful World/Ça va ? Ça va ? | 初回A | HKCN-50407 | 2015-04-08 | 順序A | Wonderful… MV | [公式](https://helloproject.com/release/4094/) | L00070 |
| 同上 | 初回B | HKCN-50409 | 同日 | 順序B | Ça va… MV | 同上 | L00071 |
| 同上 | 初回C | HKCN-50411 | 同日 | 順序A | Wonderful… Dance Shot、making/off shot | 同上 | L00072 |
| 同上 | 初回D | HKCN-50413 | 同日 | 順序B | Ça va… Dance Shot、making/off shot | 同上 | L00073 |
| 同上 | 通常A | HKCN-50415 | 同日 | 順序A | なし | 同上 | L00074 |
| 同上 | 通常B | HKCN-50416 | 同日 | 順序B | なし | 同上 | L00075 |

**CD構成凡例:** 順序Aは「表題1、表題2、表題1(Instrumental)、表題2(Instrumental)」、順序Bは両曲を逆順にした全4 track。第1作だけ全6形態が順序A。その他は上表どおりA/Bがある。通常曲の盤間差はなく、track順だけが異なる。Instrumentalは実CDに全盤2曲あるが、work/song/creator/artist/release_tracksを作らない。映像も今回video系CSVへ入れず、別song作成理由にしない。

### 15.3 対象10曲・既存CSV突合・投入候補

現在CSVを完全一致・部分一致・`version_name`・later releaseまで検索した結果、対象10 titleはworks/songs/release_tracksのいずれにも存在しない。したがって全曲を **C（新規work + 新規song候補）** と分類する。後年の`(2023)`は現CSV未登録で、同一work候補ではあるが今回投入しない。

| title（single公式track表記） | single日 | earliest confirmed full audio / `release_date`候補 | existing work/song | 判定・planned IDs | version | lyrics / composition / arrangement / specialized | artist / performer | First Squeeze！ |
|---|---:|---|---|---|---|---|---|---|
| イジワルしないで 抱きしめてよ | 2013-12-04 | 2013-11-27 着うたフル確認。ただしCD同一audio明記なし（B） | — / — | C / W00032・J00042 | original候補 | つんく(C00028) / つんく / 大久保薫(C00030) / — | G00001 primary / 追加なし | Disc1-5、表記差なし。audio同一性未確定 |
| 初めてを経験中 | 同上 | 同上 | — / — | C / W00033・J00043 | original候補 | つんく / つんく / AKIRA(新規候補) / 鈴木俊介(C00035), brass_arrangement | 同上 | Disc1-6、表記差なし。audio同一性未確定 |
| 裸の裸の裸のKISS | 2014-03-19 | 2014-03-19（同日full配信確認、先行未確認） | — / — | C / W00034・J00044 | original候補 | つんく / つんく / 平田祥一郎(C00009) / — | 同上 | Disc1-7、表記差なし。audio同一性未確定 |
| アレコレしたい！ | 同上 | 同上 | — / — | C / W00035・J00045 | original候補 | つんく / つんく / 近藤圭一(新規候補) / — | 同上 | Disc1-8、表記差なし。audio同一性未確定 |
| ブラックバタフライ | 2014-07-30 | 2014-07-30（同日full配信確認、先行未確認） | — / — | C / W00036・J00046 | original候補 | つんく / つんく / 平田祥一郎 / — | 同上 | Disc1-9、表記差なし。audio同一性未確定 |
| 風に吹かれて | 同上 | 同上 | — / — | C / W00037・J00047 | original候補 | つんく / つんく / 平田祥一郎 / — | 同上 | Disc1-10、表記差なし。audio同一性未確定 |
| 背伸び | 2014-10-01 | 2014-10-01（physical。発売日前full配信未確認） | — / — | C / W00038・J00048 | original候補 | つんく / つんく / 平田祥一郎 / — | 同上 | Disc1-11、表記差なし。audio同一性未確定 |
| 伊達じゃないよ うちの人生は | 同上 | 同上 | — / — | C / W00039・J00049 | original候補 | つんく / つんく / 平田祥一郎 / — | 同上 | Disc1-12、表記差なし。audio同一性未確定 |
| Wonderful World | 2015-04-08 | 2015-04-08（physical。発売日前full配信未確認） | — / — | C / W00040・J00050 | original候補 | イイジマケン(C00031) / 同 / gaokalab(新規候補) / — | 同上 | Disc2-1、表記差なし。audio同一性未確定 |
| Ça va ? Ça va ? | 同上 | 同上 | — / — | C / W00041・J00051 | original候補 | 三浦徳子(C00004) / 川辺ヒロシ・上田禎(各新規候補) / CMJK(新規候補) / — | 同上 | Disc2-6は`Ça va ? Ça va ?(サヴァサヴァ)`。audio同一性・表記方針未確定 |

sourceは各曲のsingle公式詳細（15.2）および[First Squeeze！公式詳細](https://helloproject.com/release/4204/)。`credit_name`は上表の公式表記をそのまま使う。共同作曲は川辺ヒロシと上田禎を別relationにする。新規creator候補は6名（AKIRA、近藤圭一、gaokalab、川辺ヒロシ、上田禎、CMJK）で、実投入時に最大IDを再確認して採番する。今回のspecialized roleは既存仕様で扱える`brass_arrangement` 1件だけで、新roleは不要。

公式の「歌」は全曲Juice=Juiceで、featured/別artist/特殊名義なし。従って`G00001` / `primary`候補。公式releaseは個人歌唱者を明示しないため、在籍から推測せず`song_performers`追加なしとする。

### 15.4 デジタル配信調査

| 対象 | 公式NEWSで確認した事実 | 発売前か | full-audio判断 | source |
|---|---|---:|---|---|
| イジワル… / 初めて… | 2013-11-27、両曲の「着うたフル」をDAM★うたフルで独占先行、同日「着うた」を各サイトで開始 | はい（7日前） | 着うたフルはfull、着うたは部分音源として区別 | [先行NEWS](https://helloproject.com/news/153/)、[12/4各社開始](https://helloproject.com/juicejuice/news/142/) |
| 裸… / アレコレ… | 2014-03-19から着うた、着うたフル、PC・スマホシングル、ビデオ配信 | 同日 | 着うたフルおよびPC・スマホシングルはfull候補 | [公式NEWS](https://helloproject.com/news/5/) |
| ブラック… / 風… | 2014-07-30から着うた、着うたフル、PC・スマホシングル、ビデオ配信 | 同日 | 同上 | [公式NEWS](https://helloproject.com/news/1886/) |
| 背伸び / 伊達… | 今回の公式NEWS検索では発売日前後の音源配信告知を取得できず | 未確認 | 未確認。不存在とはしない | [公式release](https://helloproject.com/release/2371/)の現行「音楽配信一覧」導線のみ |
| Wonderful… / Ça va… | 今回の公式NEWS検索では購入特典告知は確認したが、日付入り音源配信告知を取得できず | 未確認 | 未確認。不存在とはしない | [購入特典NEWS](https://helloproject.com/juicejuice/news/2687/)、[公式release](https://helloproject.com/release/4094/) |

配信サービス単位のdigital release entityは今回作らない。先行NEWSは両曲をsingle名で特定するが、「CD収録と同一マスター/audio」とまでは明記しないため、2013-11-27を`songs.release_date`へ確定適用するには次節の判断が必要。その他8曲は、確認できた最早full audioが同日またはphysicalであるため、現時点の候補日は各physical日とする。

### 15.5 First Squeeze！との関係（参考のみ）

公式albumページでは今回の10曲すべてを収録し、明示的なNew Vocal等のversion表記はない。最初の8曲はDisc 1 track 5～12、`Wonderful World`はDisc 2 track 1、`Ça va ? Ça va ?(サヴァサヴァ)`はDisc 2 track 6。creator creditはsingleと一致する。durationはsingle→albumで、イジワル04:02→04:01、初めて04:14→04:14、裸03:58→03:58、アレコレ03:48→03:47、ブラック03:52→03:52、風03:42→03:41、背伸び04:28→04:28、伊達04:07→04:07、Wonderful04:14→04:14、Ça va03:46→03:46。

一致するtitle/credit/durationだけでは同一audioを証明しない。差があることも別audioの証明とはしない。したがってalbum側は**全10曲とも「First Squeeze！投入時に再確認」**であり、今回release/release_tracks/song/workを追加しない。特に`Ça va ? Ça va ?`はsingle公式trackに読み仮名がなく、album trackだけに`(サヴァサヴァ)`があるため、single DB title候補は公式どおり`Ça va ? Ça va ?`（アクセント付き、半角空白を挟む疑問符）とし、括弧をversion_nameへ推測移送しない。

### 15.6 ユーザー判断事項

**対象:** 「イジワルしないで 抱きしめてよ」「初めてを経験中」の`songs.release_date`

- **公式に確認できた事実:** 2013-11-27に両曲の着うたフル先行配信、2013-12-04にphysical発売および各社着うたフル配信。
- **現在CSV:** work/songとも未登録。
- **参考URL:** [先行NEWS](https://helloproject.com/news/153/)、[公式release](https://helloproject.com/release/1667/)。
- **判断できない理由:** NEWSはsingleと両曲を特定するが、先行ファイルとCD収録audioが同一であることを明記しない。
- **選択肢:** A. 同一audioとして2013-11-27（2 songを先行日にする） / B. 厳格に2013-12-04（physical日） / C. song作成自体を保留。
- **各選択肢のCSV影響:** A/BはJ00042・J00043の`release_date`だけが異なる。Cは第2シングルのwork/song/release投入を全保留。
- **推奨:** A。公式が当該single両曲の「着うたフル」と明示するため。ただし厳格なaudio identity基準を優先するならB。
- **停止点:** この判断が必要になるまでCSVは変更していない。

**対象:** `Ça va ? Ça va ?`と`First Squeeze！`の`Ça va ? Ça va ?(サヴァサヴァ)`

- **公式に確認できた事実:** single CD trackは読み仮名なし、album trackは括弧付き。creditと03:46は一致し、別version表記はない。
- **現在CSV:** どちらも未登録。
- **参考URL:** [single](https://helloproject.com/release/4094/)、[album](https://helloproject.com/release/4204/)。
- **判断できない理由:** 公式は同一audioを明言せず、同名・同尺・同creditだけでは統合禁止。
- **選択肢:** A. 今回single songだけ作りalbum投入時に再確認 / B. 今回から同一song再利用を予定 / C. single songも保留。
- **各選択肢のCSV影響:** AはW00041/J00051を作るがalbum relationなし。Bは将来同じJ00051へalbumを接続。Cは当該work/songと関連trackを保留。
- **推奨:** A。今回のsingle投入を妨げず、未証明のalbum同一性を断定しない。
- **停止点:** この判断が必要になるまでCSVは変更していない。

### 15.7 件数、後続タスク、仕様検討

- physical release追加予定: **29**（候補L00047～L00075）。通常曲のrelease_tracks追加予定: **58**。Instrumental 58 trackは商品上の存在だけ記録し、relation追加なし。
- work追加予定: **10**（候補W00032～W00041）。song追加予定: **10**（候補J00042～J00051）。全曲`original`候補。IDは投入直前に再計算する。
- creator: 既存4名（C00028/C00030/C00009/C00035）に加え、C00031/C00004も利用し、新規6名候補。artist追加なし、song_artists 10、song_performers 0。
- 後続1: ユーザー判断後、推奨どおり第2シングルを単独投入し、残る4作を一括投入する。各単位でvalidationと件数を確認する。
- 後続2: digital release entityの粒度を別設計し、今回確認した着うた/着うたフル/PC・スマホ配信はそのフェーズまでrelease化しない。
- 後続3: `First Squeeze！`調査時にmaster/audio identityを公式資料で再確認し、証明できた曲だけsingle song IDを再利用する。
- **仕様検討事項（data-specは未変更）:** 同じrelease告知に紐づく着うたフルを、明示的な「CDと同一audio」という記述なしでspecific song初出とみなす証拠基準。括弧付き読み仮名の`track_title`差をwork/song identityから独立して扱う運用。
