# Juice=Juice 公式ディスコグラフィー収集計画

調査日: 2026-09-26（配信・特殊音源の専門調査、およびChatGPT側で確認した公式情報を反映）
状態: **CSV投入前のrelease単位のロードマップ**（`data/*.csv`は未変更）

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

その後、ChatGPT側でHello! Project公式サイトを確認した。以下では、依頼文で提供された確認結果を入力データとして**公式確認済み**へ更新した。今回Codex側ではWeb再調査をしていない。個別URLが依頼文にないものは推測せず、その旨を明記する。

## 3. 通常release一覧（優先度A～Cと登録済みterzo）

1タイトルを1候補として数え、盤違いはまとめる（登録済みterzoだけはCSV上で3 release）。更新前27候補に`MORE! MORE! EP`を加え、通常releaseは**28候補**（インディーズシングル3、CDシングル20、アルバム4、EP1）となる。

| 発売日 | 種別 | タイトル | terzo補完 | 優先度 | 公式URL・状態 | notes |
|---|---|---|---|---|---|---|
| 2013-03-31 | インディーズシングル | 私が言う前に抱きしめなきゃね | — | B | [旧公式一覧](https://www.helloproject.com/discography/juicejuice/) | 後発MEMORIAL EDITとは別Version候補。 |
| 2013-05-05 | インディーズシングル | 五月雨美女がさ乱れる | — | B | [旧公式一覧](https://www.helloproject.com/discography/juicejuice/) | 後発MEMORIAL EDITとは別Version候補。 |
| 2013-06-12 | インディーズシングル | 天まで登れ！ | — | B | [旧公式一覧](https://www.helloproject.com/discography/juicejuice/) | 正式名義を投入時確認。 |
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
| 2019-06-05 | CDシングル | 「ひとりで生きられそう」って それってねえ、褒めているの？／25歳永遠説 | J00004–J00006 | A | [公式一覧](https://helloproject.com/juicejuice/release/) | New Vocal Ver.の初出releaseを分けて確認。 |
| 2020-04-01 | CDシングル | ポップミュージック／好きって言ってよ | J00007–J00011候補 | A | [公式詳細](https://helloproject.com/juicejuice/release/6261/) | Borderline、Va-Va-Voom、続いていくSTORY (Symphonic Version feat. Karin)の正式収録を公式確認済み。terzoとの音源同一性は未確定。 |
| 2021-04-28 | CDシングル | DOWN TOWN／がんばれないよ | J00012–J00013 | A | [公式一覧](https://helloproject.com/juicejuice/release/) | 同日のSpecial Edition（D10）とセットで確認。 |
| 2021-12-22 | CDシングル | プラスティック・ラブ／Familia／Future Smile | J00014–J00016 | A | [公式一覧](https://helloproject.com/juicejuice/release/) | 盤別track差と配信版を分離確認。 |
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
2. **次の投入対象: A-2 「ひとりで生きられそう」って…／25歳永遠説**（2019-06-05）: J00004/J00005候補。J00006 New Vocal Ver.をCDへ自動統合せずD08を確認する。
3. **A-3 ポップミュージック／好きって言ってよ**（2020-04-01）: 公式CDにBorderline、Va-Va-Voom、続いていくSTORY (Symphonic Version feat. Karin)が収録済み。J00009/J00010/J00011はこのCDの収録曲との同一音源候補であり、同一性を確認後、該当する`songs.release_date`を2020-04-01まで遡る候補とする。J00011はterzo初出ではない。CSV更新はA-3投入時に行う。
4. **A-4 DOWN TOWN／がんばれないよ**（2021-04-28）: J00012/J00013候補。CDだけで完了とせず、同日の公式配信`DOWN TOWN/がんばれないよ(Special Edition)`（D10）をセットで確認する。ソロ7 Versionは別song候補として保留する。
5. **A-5 プラスティック・ラブ／Familia／Future Smile**（2021-12-22）: J00014～J00016候補。D11も確認する。

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
- **A-1はCSV投入完了**。次の投入対象はA-2であり、本作業ではA-2へ着手していない。

## 5. 優先度B・C

- **B（15件）**: インディーズ3作、2013-09-11から2018-04-18までの主要CD、`First Squeeze！`、`Juice=Juice#2 -¡Una más!-`。明示Version、MEMORIAL EDIT、Album Version、2022 ver.の境界を確認する。
- **C（7件）**: (1) 全部賭けてGO！！…、(2) プライド・ブライト…、(3) Juicetory、(4) トウキョウ・ブラー…、(5) 初恋の亡霊…、(6) 四の五の言わず颯と別れてあげた…、(7) **MORE! MORE! EP**。2026年の通常releaseが未確認という旧状態は解消した。

## 6. 優先度D（特殊release）

### 6.1 既存D01～D13の更新

番号と対象の対応は既存計画を維持する。公式確認済み4件、既存通常CDへ解決した1件、独立release未確認8件である。

| No. | release日 | releaseタイトル | 種別 | 品番 | 公式URL | 最新状態・terzoへの影響 |
|---:|---|---|---|---|---|---|
| D01 | 2017-05-19 | Goal〜明日はあっちだよ〜 | 配信 | UFDL-1334 | [公式詳細](https://helloproject.com/release/5363/) | **公式配信release確認済み**。J00028 Album Versionとの音源同一性は未確定で、通常版は別song候補。 |
| D02 | 2017-06-16 | 如雨露 | 配信 | UFDL-1344 | ChatGPT側で公式release確認済み。個別URLは今回の依頼文では未提示。 | **公式配信release確認済み**。 |
| D03 | 2017-08-23 | Fiesta! Fiesta! | 配信シングル | UFDL-1353 | ChatGPT側で公式release確認済み。個別URLは今回の依頼文では未提示。 | **公式配信release確認済み**。`Wonderful World(English Ver.)`も収録。両曲のsong/version関係を投入時確認。 |
| D04 | 未確認 | Never Never Surrender | 独立配信候補 | 未確認 | [公式一覧](https://helloproject.com/juicejuice/release/) | 曲の公式な存在は確認できるが、**独立配信releaseは未確認**。不存在とは断定しない。J00027は2022 ver.。 |
| D05 | 未確認 | TOKYOグライダー | 独立配信候補 | 未確認 | [公式一覧](https://helloproject.com/juicejuice/release/) | 曲の公式な存在は確認できるが、**独立配信releaseは未確認**。不存在とは断定しない。 |
| D06 | 未確認 | SEXY SEXY／泣いていいよ／Vivid Midnight (Special Edition) | Special Edition候補 | 未確認 | [公式一覧](https://helloproject.com/juicejuice/release/) | 独立release、正式タイトル、全track未確認。 |
| D07 | 未確認 | 微炭酸／ポツリと／Good bye & Good luck！ (Special Edition) | Special Edition候補 | 未確認 | [A-1公式詳細](https://helloproject.com/release/detail/HKCN-50580/?pc=1) | 初回生産限定盤SP（HKCN-50586）との混同の可能性があるが、独立した音源Special Edition releaseは現時点で公式確認できていない。不存在とは断定せず未確認を維持し、release IDは採番しない。後日のイベントV（TGBS-10960）は映像商品のため音源release CSVの対象外。 |
| D08 | 未確認 | 「ひとりで生きられそう」って それってねえ、褒めているの？／25歳永遠説 (Special Edition) | Special Edition候補 | 未確認 | [公式一覧](https://helloproject.com/juicejuice/release/) | J00006の初出候補だが未確認。 |
| D09 | 未確認 | ポップミュージック／好きって言ってよ (Special Edition) | Special Edition候補 | 未確認 | [公式一覧](https://helloproject.com/juicejuice/release/) | Special Edition自体は未確認。ただしJ00009～J00011候補の2020-04-01 **CD収録は公式確認済み**。 |
| D10 | 2021-04-28 | DOWN TOWN/がんばれないよ(Special Edition) | 配信 | UFDL-1473 | [公式詳細](https://helloproject.com/juicejuice/release/detail/UFDL-1473/) | **独立した公式配信releaseとして確認済み**。通常2曲と「がんばれないよ」メンバー別ソロVersion 7曲を収録。 |
| D11 | 未確認 | プラスティック・ラブ／Familia／Future Smile (Special Edition) | Special Edition候補 | 未確認 | [公式一覧](https://helloproject.com/juicejuice/release/) | 独立release・追加track未確認。 |
| D12 | 2020-04-01 | ポップミュージック／好きって言ってよ | CD（通常一覧の既存release） | 未提示 | [公式詳細](https://helloproject.com/juicejuice/release/6261/) | J00011候補の収録を**公式確認済み**。独立したD releaseを追加せず、通常27件に既に含まれるCDへ解決。J00011はterzo初出ではなく、初出候補を2020-04-01まで遡れる。Karin＝宮本佳林はユーザー判断済み。 |
| D13 | 未確認 | プラトニック・プラネット（通常スタジオ版）を収録するrelease | 配信等候補 | 未確認 | [terzo詳細](https://helloproject.com/juicejuice/release/6692/) | **通常版スタジオ音源の公式音源releaseは未確認**。通常版が存在しないとは断定しない。J00024 Ultimate Juice Ver.とは区別。 |

### 6.2 Dリスト外から追加した確定release（D14～D21）

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

### 6.3 Special Editionの設計メモ

- D10は通常2曲に加え「がんばれないよ」のメンバー別ソロVersionを7曲収録する。CSV投入時に**song分割・`version_type`・performerを検討する必要あり**。同じworkに紐づく複数songとなる可能性があるが、今回は`song_id`、`version_type`、`song_performers`を確定しない。
- D15の`Brilliance of memories`は植村あかりの楽曲として扱う可能性があるが、song/artist/member構造は投入時の確認事項とする。
- Special Editionが別releaseであることだけでは、通常CDと別songとは判定しない。

### 6.4 プラトニック・プラネットの3区分

1. **通常スタジオ版**: 通常版の歌唱は公式ライブ映像等で識別できるが、CD・配信等で販売された公式スタジオ音源releaseは現時点で未確認。不存在とは断定しない。
2. **Ultimate Juice Ver.**: terzo収録のJ00024。通常版とは区別する。
3. **ライブ音源版**: D16に通常表記の`プラトニック・プラネット`が収録される。通常スタジオ版、Ultimate Juice Ver.、ライブ音源版を区別して判定する。

通常版には今回`song_id`を採番しない。将来ハロ！ステ等を`video_songs`へ登録する段階で、現在の境界「song＝公式音源releaseされたもの」を「song＝公式に識別可能な具体的歌唱Version」へ拡張するか検討する。今回は仕様を変更しない。

## 7. terzo既存songへの影響

- **J00006**: New Vocal Ver.のterzo以前のreleaseは未確認。D08を照合し、CSV更新は保留。
- **J00009 Borderline**: 2020-04-01 CDへの収録を公式確認済み。terzo収録音源との完全な同一性は未確定のため同一音源候補に留め、A-3投入時に判定する。
- **J00010 Va-Va-Voom**: 2020-04-01 CDへの収録を公式確認済み。J00009と同様、同一音源候補に留める。
- **J00011 続いていくSTORY (Symphonic Version feat. Karin)**: 2020-04-01 CDへの収録を公式確認済みで、terzoが初出ではない。初出候補を少なくとも2020-04-01まで遡れ、`songs.release_date`更新候補とする。CSV更新はA-3投入時に音源同一性を確認して行う。Karin＝宮本佳林は確定済み。
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

1. **優先度A**は完了済みA-1に続き、A-2～A-5の順に投入する。各CDだけで完了とせず、関係する先行配信・Special Editionを同時確認する。特にA-3はJ00009～J00011、A-4はD10をセットで扱う。
2. **優先度B**を、インディーズ3作、メジャーシングル、`First Squeeze！`、`Juice=Juice#2 -¡Una más!-`の順で扱う。
3. **優先度C**を発売順に扱い、2026-06-24 `MORE! MORE! EP`まで進める。
4. **優先度D**を扱う。DのうちA/Cに直接関連する先行配信・Special Editionは当該通常releaseと同時確認するが、2025/2026年ライブ音源をAより先に投入する必要はない。

## 10. CSV投入前の要確認事項

1. **音源同一性**: J00009～J00011と2020年CD、J00027/J00028と2017年配信・#2、通常CDと各Special Edition。公式情報だけで決められなければ統合も新規採番もしない。
2. **未確認の独立release**: D04～D09、D11、D13。未確認は不存在を意味しない。
3. **Special Editionのsong粒度**: D10のソロ7 Versionのsong分割、`version_type`、performer。D15の`Brilliance of memories`のsong/artist/member構造。
4. **特殊音源のsong粒度**: D16～D21のライブ、BAND Live、THE FIRST TAKE各音源を別songとするか、workを共有するか、`version_type`を何にするか。
5. **通常版プラトニック・プラネット**: 公式動画内で識別可能な歌唱Versionにまでsongの境界を拡張するか。`video_songs`実装時まで保留。
6. **名義**: 「天まで登れ！」、NEXT YOU、featured表記、メンバーソロ等をartist/release/song_performersへどう表すか。
7. **アルバム内Version**: MEMORIAL EDIT、Album Version、2022 ver.、Version名なし再収録の音源同一性。

## 11. 登録済みreleaseとCSV投入状況

`data/releases.csv`にはterzo 3盤（L00001～L00003）とA-1の7形態（L00004～L00010）の
**計10 releaseレコード**がある。`release_tracks.csv`はterzo 84行とA-1 21行の計105行である。
A-1では新規song/workを採番せず既存J00001～J00003を再利用した。J00009～J00011、
J00024等のA-1以外の保留事項、member、ハロ！ステDB・Web・集計処理には着手していない。

## 12. 件数集計

一覧から機械的に数えると次のとおりである。

- 更新前: 通常release候補27、D確定0、**確定release候補総数27**、未確定D 13、最大探索母数40。
- 更新後の通常release: 既存27 + `MORE! MORE! EP` 1 = **28**（A 5、B 15、C 7、登録済みterzo 1。各区分はタイトル単位で重複なし）。
- 更新後のD確定: 既存DからD01/D02/D03/D10の4 + Dリスト外D14～D21の8 = **12**。D12は既存通常releaseである2020-04-01 CDへ解決したためD確定件数に重複加算しない。
- 更新後の確定release候補総数: 通常28 + D確定12 = **40**。
- 更新後の未確定候補: D04～D09、D11、D13の**8**。D12は未確定から除外した。
- 更新後の最大探索母数: 確定40 + 未確定8 = **48**。
- DB登録済み: **10 releaseレコード**（terzo 3盤 + A-1 7形態）。確定release候補総数40はタイトル／release単位で数えるため、既に通常release候補へ含まれていたA-1を盤別登録しても増加しない。
- 最古の通常候補: 2013-03-31「私が言う前に抱きしめなきゃね」。最新の確認済みrelease: 2026-06-24 `MORE! MORE! EP`。したがって旧記述「最新は2025-10-08」「2026年作品未確認」は更新済み。

## 13. 公式URL一覧（今回追加分）

- https://helloproject.com/release/5872/ — `微炭酸／ポツリと／Good bye & Good luck！`
- https://helloproject.com/release/detail/HKCN-50580/?pc=1 — 同作の7形態、trackおよびクレジット
- https://helloproject.com/news/9883/ — 2019-02-13配信開始情報
- https://helloproject.com/release/5363/ — `Goal〜明日はあっちだよ〜`
- https://helloproject.com/juicejuice/release/6261/ — `ポップミュージック／好きって言ってよ`
- https://helloproject.com/juicejuice/release/detail/UFDL-1473/ — `DOWN TOWN/がんばれないよ(Special Edition)`
- https://helloproject.com/release/7256/?pc=1 — `トウキョウ・ブラー/ナイモノラブ/おあいこ(Special Edition)`
- https://helloproject.com/release/7273/?pc=1 — `Juice=Juice 10th Anniversary Concert Tour 2023 Final ～Juicetory～`
- https://helloproject.com/release/7625/ — `盛れ！ミ・アモーレ(BAND Live Ver.)`
- https://helloproject.com/release/7662/?pc=1 — `Juice=Juice Concert 2025 Queen of Hearts Special Flush`
- https://helloproject.com/release/7663/ — `Juice=Juiceスペシャルライブ2025 ～10月10日はJuice=Juiceの日～`

`如雨露`、`Fiesta! Fiesta!`、`プライド・ブライト`先行配信、UFDL-1572、UFDL-1573、`MORE! MORE! EP`はChatGPT側でHello! Project公式掲載を確認済みだが、依頼文に個別URLが提示されていないためURLを生成していない。
