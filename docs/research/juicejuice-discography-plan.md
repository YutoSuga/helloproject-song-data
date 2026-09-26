# Juice=Juice 公式ディスコグラフィー収集計画

調査日: 2026-09-26
状態: **CSV 投入前の release 単位のロードマップ**（`data/*.csv` は未変更）

## 1. 調査目的

Hello! Project 公式ディスコグラフィーに掲載された Juice=Juice 名義の音源 release を先に棚卸しし、3rdアルバム「terzo」から登録済みの28 songを補完するもの、過去作、今後作、特殊配信の順に、次回以降の調査・投入単位を決める。本書の「収録候補」「同一音源候補」はタイトル一致等から次に照合すべき対象を示すだけで、音源同一性、`version_type`、初出日は確定しない。

## 2. 調査範囲

### 対象と対象外

- 対象: インディーズシングル、CDシングル、CDアルバム、公式ディスコグラフィーで音源 release として確認する配信作品、Special Edition 等。
- 条件付き対象: ライブ音源、THE FIRST TAKE版、BAND Live Ver. 等が独立した公式音源 release である場合（優先度D）。
- 対象外: DVD/Blu-ray、ライブ映像、MV集、写真集、書籍、Instrumentalだけの追加。CD付属映像は盤種の存在としてのみ記録する。
- 本体一覧は「Juice=Juice」名義に限定する。Juice=Juice公式ページに現れる別名義は「別途調査候補」に分離した。

### 使用した公式一覧

- 現行一覧: https://helloproject.com/juicejuice/release/
- 旧ディスコグラフィー入口: https://www.helloproject.com/discography/juicejuice/
- 登録済みterzo詳細: https://helloproject.com/juicejuice/release/6692/

個別詳細URLを今回確実に保持できたterzo以外は、URLを推測せず、確認入口である公式一覧URLを記載して「個別ページ未確認」とした。このため下表は**投入対象候補の基線**であり、特に配信・Special Editionは次回、公式一覧のページングと旧ページを再走査して確定する必要がある。第三者サイトは根拠に使用していない。

## 3. Juice=Juice音源release一覧

以下は1タイトルを1候補として数え、盤違いは「盤種」欄にまとめた（登録済みterzoだけはCSV上で3 release）。発売日順である。全27候補、内訳はインディーズシングル3、CDシングル20、アルバム4。配信版は公式個別ページとの照合が完了していないため、この確定表へ推測で混ぜず、優先度Dの要確認キューに置いた。

| 発売日 | 種別 | タイトル | 盤種 | 名義 | 登録状況 | terzo補完 | 優先度 | 公式URL | notes |
|---|---|---|---|---|---|---|---|---|---|
| 2013-03-31 | インディーズシングル | 私が言う前に抱きしめなきゃね | あり | Juice=Juice | 未登録 | — | B | [旧公式一覧](https://www.helloproject.com/discography/juicejuice/) | 個別ページ未確認。後発MEMORIAL EDITとは別Version候補。 |
| 2013-05-05 | インディーズシングル | 五月雨美女がさ乱れる | あり | Juice=Juice | 未登録 | — | B | [旧公式一覧](https://www.helloproject.com/discography/juicejuice/) | 個別ページ未確認。後発MEMORIAL EDITとは別Version候補。 |
| 2013-06-12 | インディーズシングル | 天まで登れ！ | あり | Juice=Juice名義か要再確認 | 未登録 | — | B | [旧公式一覧](https://www.helloproject.com/discography/juicejuice/) | 個別ページと正式名義を次回確認。 |
| 2013-09-11 | CDシングル | ロマンスの途中／私が言う前に抱きしめなきゃね(MEMORIAL EDIT)／五月雨美女がさ乱れる(MEMORIAL EDIT) | 複数盤 | Juice=Juice | 未登録 | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | Version検証が必要。個別ページ未確認。 |
| 2013-12-04 | CDシングル | イジワルしないで 抱きしめてよ／初めてを経験中 | 複数盤 | Juice=Juice | 未登録 | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 盤別track差を投入時確認。個別ページ未確認。 |
| 2014-03-19 | CDシングル | 裸の裸の裸のKISS／アレコレしたい！ | 複数盤 | Juice=Juice | 未登録 | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2014-07-30 | CDシングル | ブラックバタフライ／風に吹かれて | 複数盤 | Juice=Juice | 未登録 | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2014-10-01 | CDシングル | 背伸び／伊達じゃないよ うちの人生は | 複数盤 | Juice=Juice | 未登録 | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2015-04-08 | CDシングル | Wonderful World／Ça va ? Ça va ?（サヴァサヴァ） | 複数盤 | Juice=Juice | 未登録 | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 公式の記号・副題表記を個別ページで再確認。 |
| 2015-07-15 | アルバム | First Squeeze！ | 複数盤 | Juice=Juice | 未登録 | 一部（生まれたてのBaby Love、CHOICE & CHANCE） | B | [公式一覧](https://helloproject.com/juicejuice/release/) | terzoの2022 ver.とのwork共有候補。既発曲、アルバム新曲、Version表記を精査。 |
| 2016-02-03 | CDシングル | Next is you！／カラダだけが大人になったんじゃない | 複数盤 | Juice=Juice | 未登録 | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2016-10-26 | CDシングル | Dream Road～心が躍り出してる～／KEEP ON 上昇志向！！／明日やろうはバカやろう | 複数盤 | Juice=Juice | 未登録 | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2017-04-26 | CDシングル | 地団駄ダンス／Feel！感じるよ | 複数盤 | Juice=Juice | 未登録 | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2018-04-18 | CDシングル | SEXY SEXY／泣いていいよ／Vivid Midnight | 複数盤 | Juice=Juice | 未登録 | — | B | [公式一覧](https://helloproject.com/juicejuice/release/) | Special Editionの有無をDで別確認。 |
| 2018-08-01 | アルバム | Juice=Juice#2 -¡Una más!- | 複数盤 | Juice=Juice | 未登録 | 一部（Goal～明日はあっちだよ～等） | B | [公式一覧](https://helloproject.com/juicejuice/release/) | Album Version等と通常版の同一性を要検証。 |
| 2019-02-13 | CDシングル | 微炭酸／ポツリと／Good bye & Good luck！ | 複数盤 | Juice=Juice | 未登録 | **J00001–J00003** | A | [公式一覧](https://helloproject.com/juicejuice/release/) | terzo Disc 1の3曲の初出・同一音源確認に直結。 |
| 2019-06-05 | CDシングル | 「ひとりで生きられそう」って それってねえ、褒めているの？／25歳永遠説 | 複数盤 | Juice=Juice | 未登録 | **J00004–J00006** | A | [公式一覧](https://helloproject.com/juicejuice/release/) | 通常版2曲と、後発New Vocal Ver.の初出releaseを分けて確認。 |
| 2020-04-01 | CDシングル | ポップミュージック／好きって言ってよ | 複数盤 | Juice=Juice | 未登録 | **J00007–J00010候補** | A | [公式一覧](https://helloproject.com/juicejuice/release/) | 表題2曲に加え盤別曲Borderline、Va-Va-Voomの収録有無を公式trackで確認。 |
| 2021-04-28 | CDシングル | DOWN TOWN／がんばれないよ | 複数盤 | Juice=Juice | 未登録 | **J00012–J00013** | A | [公式一覧](https://helloproject.com/juicejuice/release/) | terzo版と同一音源候補。Special Editionは別release候補。 |
| 2021-12-22 | CDシングル | プラスティック・ラブ／Familia／Future Smile | 複数盤 | Juice=Juice | 未登録 | **J00014–J00016** | A | [公式一覧](https://helloproject.com/juicejuice/release/) | terzo直前の3曲。盤別track差と配信版を分離確認。 |
| 2022-04-20 | アルバム | 3rdアルバム「terzo」 | 初回A・初回B・通常 | Juice=Juice | **登録済み（3 releases）** | 基準release（J00001–J00028） | — | [公式詳細](https://helloproject.com/juicejuice/release/6692/) | CSVでは規格品番別にL00001–L00003。 |
| 2022-11-23 | CDシングル | 全部賭けてGO！！／イニミニマニモ～恋のライバル宣言～ | 複数盤 | Juice=Juice | 未登録 | — | C | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。Special Editionは別release候補。 |
| 2023-07-12 | CDシングル | プライド・ブライト／FUNKY FLUSHIN' | 複数盤 | Juice=Juice | 未登録 | — | C | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2023-10-11 | アルバム | Juicetory | 複数盤 | Juice=Juice | 未登録 | — | C | [公式一覧](https://helloproject.com/juicejuice/release/) | 再収録・別Versionを投入時検証。 |
| 2024-05-15 | CDシングル | トウキョウ・ブラー／ナイモノラブ／おあいこ | 複数盤 | Juice=Juice | 未登録 | — | C | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2025-02-26 | CDシングル | 初恋の亡霊／今夜はHearty Party | 複数盤 | Juice=Juice | 未登録 | — | C | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別ページ未確認。 |
| 2025-10-08 | CDシングル | 四の五の言わず颯と別れてあげた／盛れ！ミ・アモーレ | 複数盤 | Juice=Juice | 未登録 | — | C | [公式一覧](https://helloproject.com/juicejuice/release/) | 本調査で確認した最新候補。個別ページ、正式盤数、表記を投入前に再確認。 |

**発売予定:** 調査日時点で、上記より後の発売日を持つ音源releaseを公式一覧から確定できていない。「なし」ではなく**未確認**として扱い、投入開始時に現行一覧の先頭を再確認する。

## 4. 優先度A（terzo補完優先）

発売日順は上表のとおり。推奨投入順も、依存関係が単純な次の順とする。

1. **微炭酸／ポツリと／Good bye & Good luck！**（2019-02-13）: J00001、J00002、J00003の同一音源候補。
2. **「ひとりで生きられそう」って…／25歳永遠説**（2019-06-05）: J00004、J00005の候補。J00006 New Vocal Ver.は同シングルと即時に同一扱いせず、Special Edition/後発配信を探索する。
3. **ポップミュージック／好きって言ってよ**（2020-04-01）: J00007、J00008、さらに盤別収録ならJ00009 Borderline、J00010 Va-Va-Voomの候補。
4. **DOWN TOWN／がんばれないよ**（2021-04-28）: J00012、J00013の候補。
5. **プラスティック・ラブ／Familia／Future Smile**（2021-12-22）: J00014～J00016の候補。

この5タイトルでterzo Disc 1の通常表記曲15曲中、J00011を除く14曲へ到達できる可能性がある。J00011「続いていくSTORY (Symphonic Version feat. Karin)」は通常シングルからの同一音源とみなせないためDで別探索する。

## 5. 優先度B（terzo以前の残りの主要release）

発売日順に、(1) 私が言う前に抱きしめなきゃね、(2) 五月雨美女がさ乱れる、(3) 天まで登れ！、(4) ロマンスの途中…、(5) イジワルしないで…、(6) 裸の裸の裸のKISS…、(7) ブラックバタフライ…、(8) 背伸び…、(9) Wonderful World…、(10) First Squeeze！、(11) Next is you！…、(12) Dream Road…、(13) 地団駄ダンス…、(14) SEXY SEXY…、(15) Juice=Juice#2 -¡Una más!-。

最初の3作はインディーズ期の欠落防止を優先する。2アルバムは一度に多数のworkを得られる一方、MEMORIAL EDIT、Album Version、アルバム新曲、後年の2022 ver.といったVersion境界があるため、シングル群の後に扱う方が安全である。

## 6. 優先度C（terzo以降の通常release）

発売日順に、(1) 全部賭けてGO！！…、(2) プライド・ブライト…、(3) Juicetory、(4) トウキョウ・ブラー…、(5) 初恋の亡霊…、(6) 四の五の言わず颯と別れてあげた…。

## 7. 優先度D（特殊release・個別判断候補）

現段階では件数に含めない**照合キュー**である。公式個別ページが確認できたものだけを将来releaseとして採番する。

| 発売時期/関連作 | 別release候補 | terzoとの関係 | 公式URL | 次回確認 |
|---|---|---|---|---|
| 2017年前後 | Goal～明日はあっちだよ～、如雨露、Fiesta! Fiesta!、Never Never Surrender、TOKYOグライダー等の配信先行作品 | J00027/J00028の元Version・初出候補 | [公式一覧](https://helloproject.com/juicejuice/release/) | 個別releaseの有無、日付、名義、後の#2との関係。 |
| 2018–2021 | 各CDシングルの「Special Edition」 | J00006/J00009/J00010等を含む可能性 | [公式一覧](https://helloproject.com/juicejuice/release/) | CDと同曲だけか、配信限定trackがあるか、独立releaseか。 |
| terzo以前 | 続いていくSTORY (Symphonic Version feat. Karin) | J00011の初出候補 | [terzo詳細](https://helloproject.com/juicejuice/release/6692/) | 初出配信、正式名義、通常版とは別songか。 |
| terzo以前 | プラトニック・プラネット(Ultimate Juice Ver.) | J00024 | [terzo詳細](https://helloproject.com/juicejuice/release/6692/) | 通常版/配信版とUltimate版を分離。 |
| 2022以後 | 各シングルのSpecial Edition、THE FIRST TAKE版、BAND Live Ver.、ライブ音源配信 | 原則なし | [公式一覧](https://helloproject.com/juicejuice/release/) | 独立した公式音源releaseのみ対象。映像だけなら除外。 |

したがって、**優先度Dの確定release件数は0、未確定候補群は5行**である。これは「配信releaseが存在しない」という結論ではなく、URL・日付を推測して確定表へ入れないための保留である。

## 8. 登録済みrelease

`data/releases.csv`にはterzoの3盤だけが存在する。

| release_id | 発売日 | タイトル | 規格品番 | 盤 |
|---|---|---|---|---|
| L00001 | 2022-04-20 | 3rdアルバム「terzo」 | HKCN-50700 | 初回生産限定盤A（2CD＋Blu-ray） |
| L00002 | 2022-04-20 | 3rdアルバム「terzo」 | HKCN-50703 | 初回生産限定盤B（2CD＋Blu-ray） |
| L00003 | 2022-04-20 | 3rdアルバム「terzo」 | HKCN-50706 | 通常盤（2CD） |

各盤は同じ28 song、計84 `release_tracks` 行に接続済み。今回これらも含めCSVは変更していない。

## 9. 別途調査候補

- **NEXT YOU**名義: 「Next is you！」の実際の商品名義・artist表現を公式個別ページで確認する。Juice=Juice本体releaseと別artistの関係を混同しない。
- **Juice=Juice featuring … 等**: 「天まで登れ！」の正式名義を旧公式詳細で確認する。
- メンバーソロ、卒業メンバー、他アーティストとのコラボ、Hello! Project全体・シャッフル/特殊ユニットは今回詳細調査・件数化しない。
- THE FIRST TAKEやライブ映像で公開されただけの音源は対象外。独立配信された公式音源であることが確認できた場合のみDへ移す。

## 10. 推奨投入順

1. **A-1～A-5**を順に投入し、terzo既存songを再利用できるかを1releaseずつ公式trackとVersion表記で判定する。
2. Aと並行して、Special Edition/先行配信をDから検索し、AのCDより早い初出が見つかれば先にrelease関係と`release_date`を確定する。
3. **Bのインディーズ3作 → メジャーシングルを発売順**。同名MEMORIAL EDITを通常版へ統合しない。
4. **First Squeeze！ → Juice=Juice#2 -¡Una más!-**。先行シングル登録後なので再収録の照合が容易になる。
5. **Cを発売順**。各CDについて同日/後発Special Editionを別候補として調べる。
6. **D**は公式詳細URL、日付、trackが揃った単位だけを登録し、ライブ版・FIRST TAKE版等はVersion方針をユーザー確認してからsongを作る。

## 11. 要確認事項

### Q1. 配信／Special Editionの網羅性

- **対象**: 優先度Dの全候補。
- **公式情報から確認できた事実**: 現行Juice=Juice公式release一覧は確認入口であり、terzo詳細には特殊Version名が掲載される。
- **参考URL**: https://helloproject.com/juicejuice/release/ 、https://helloproject.com/juicejuice/release/6692/
- **判断できない理由**: 個別詳細URL、発売日、全trackを今回確定できず、URLを推測してはいけないため。
- **選択肢**: (A) 次回は配信だけを公式一覧の全ページ・旧ページで専門調査、(B) まず確定済みAのCD5作を投入してから調査。
- **影響**: release件数、初出日、CD版と配信版の分割、J00006/J00009/J00010/J00011等の初出とVersion判定。

### Q2. 「天まで登れ！」と「Next is you！」のartist名義

- **対象**: 2013-06-12インディーズ作、2016-02-03シングル。
- **公式情報から確認できた事実**: Juice=Juiceの新旧ディスコグラフィーで追跡すべき作品候補である。
- **参考URL**: https://www.helloproject.com/discography/juicejuice/ 、https://helloproject.com/juicejuice/release/
- **判断できない理由**: 商品上の正式な歌唱名義（featuring/NEXT YOU）と、releaseをJuice=Juice本体として持つかの境界を個別ページで未確認。
- **選択肢**: (A) releaseは本体に置き、song_artistsで別名義を表す、(B) 正式名義ごとにartist/releaseを分ける。
- **影響**: `artists`、`song_artists`、releaseの対象範囲。

### Q3. アルバム内Version

- **対象**: First Squeeze！、#2、Juicetory、およびterzoの2022 ver./Album Version。
- **公式情報から確認できた事実**: terzoは明示的なVersion名を含む。
- **参考URL**: https://helloproject.com/juicejuice/release/6692/ 、https://helloproject.com/juicejuice/release/
- **判断できない理由**: Version名なし再収録の同一音源性、MEMORIAL EDIT/Album Version/2022 ver.の録音差はタイトルだけで確定できない。
- **選択肢**: (A) 公式に別Versionと明示されたものだけ別song、曖昧なものは保留、(B) 追加の公式告知・ライナーノーツを調査してからアルバム投入。
- **影響**: song新規採番、work共有、`version_type`、既存J00017/J00025–J00028との関係。

### Q4. 最新状況と発売予定

- **対象**: 2025-10-08作より後、および調査日現在の発売予定。
- **公式情報から確認できた事実**: 今回の確定候補中の最新日は2025-10-08。
- **参考URL**: https://helloproject.com/juicejuice/release/
- **判断できない理由**: 調査日時点の一覧先頭に対する個別詳細確認が未完了で、未掲載を「予定なし」と断言できない。
- **選択肢**: (A) 次の投入タスク冒頭で現行一覧を再確認、(B) 本計画を2025-10-08までのスナップショットとして固定。
- **影響**: Cの件数、最新release、発売予定フラグ、推奨投入順末尾。

## 12. 新旧公式サイトの差異と調査上の限界

- 旧入口はインディーズ期を確認するために残したが、現行一覧と旧一覧の収録件数・表記の完全な突合は未完了である。
- 現行一覧を根拠にする主要作と、旧入口を根拠にするインディーズ作がある。片方にしかないことを理由に削除・日付補正はしていない。
- 明示的な発売日・タイトルの不一致は今回確定できなかった。ただし「不一致なし」と結論したのではなく、個別ページ照合未完了である。
- したがって次回は、まず旧一覧3作と現行一覧の全ページについて、個別URL・公式種別・盤種・日付を保存する。差が見つかった場合は両URLを併記してユーザー判断へ回す。

## 13. 集計サマリー

- 確定表: **27タイトル候補**（インディーズシングル3、CDシングル20、アルバム4）。
- 優先度: **A 5、B 15、C 6、D 0確定（5候補群を保留）**。登録済みterzo 1タイトルは優先度外。
- DB登録済み: **3 releases**（同一タイトルterzoの3盤）。
- 最古: 2013-03-31「私が言う前に抱きしめなきゃね」。
- 最新: 2025-10-08「四の五の言わず颯と別れてあげた／盛れ！ミ・アモーレ」。
- 2026-09-26時点の発売予定: **確定できず、未確認**。

数値は「公式個別ページまで確認済みの完全な全件数」を装うものではない。配信・Special Editionの確定件数は次回調査で増える前提であり、根拠URLを確保できない候補を無理に総数へ足さない方針を優先した。

## 14. 使用したHello! Project公式URL一覧

1. https://helloproject.com/juicejuice/release/
2. https://www.helloproject.com/discography/juicejuice/
3. https://helloproject.com/juicejuice/release/6692/
