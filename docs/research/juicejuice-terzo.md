# Juice=Juice「terzo」事前調査（data-spec v0.2 検証）

## 0. 調査範囲と前提

- 対象は Juice=Juice の 3rd アルバム「terzo」の **CD 音源**である。映像特典は盤差の確認にだけ用い、`videos.csv` の候補にはしない。
- 正本は変更していない。本書は ID 未採番、`created_at` / `updated_at` 未設定の調査メモである。
- 事実欄は下記の Hello! Project 公式リリースページに記載された情報だけを転記した。既発 release との音源同一性など、ページから分からない事項は推測せず「要確認」とした。
- 調査開始時に `docs/data-spec.md` v0.2、`README.md`、`data/*.csv` の全ヘッダーを確認した。以下の候補は work（詞・曲）、song（具体的音源・歌唱 Version）、release（商品）を分離する現行仕様に従う。

## 1. 一次情報

- [Hello! Project 公式「terzo」リリース情報](https://www.helloproject.com/juicejuice/release/detail/HKCN-50700/)

公式ページは三つの盤、発売日、規格品番、各 CD の曲順・作家クレジット、および各 Blu-ray の内容を一ページに掲載している。本調査の曲名、`track_title`、クレジット、商品情報の出典はすべてこの URL とする。

## 2. release 情報（公式確認済み）

| release 候補 | 公式タイトル | 発売日 | 盤種 | 規格品番 | 構成 | song 対象の CD |
|---|---|---|---|---|---|---|
| release 候補 A | 3rdアルバム「terzo」 | 2022-04-20 | 初回生産限定盤A | HKCN-50700 | 2CD＋Blu-ray | 2 Disc / 28 Track |
| release 候補 B | 3rdアルバム「terzo」 | 2022-04-20 | 初回生産限定盤B | HKCN-50703 | 2CD＋Blu-ray | 2 Disc / 28 Track |
| release 候補 C | 3rdアルバム「terzo」 | 2022-04-20 | 通常盤 | HKCN-50706 | 2CD | 2 Disc / 28 Track |

CD は全盤同一の Disc 1（16曲）＋ Disc 2（12曲）で、CD には Instrumental はない。A と B の Blu-ray 内容は異なるが、本調査では映像項目を登録しない。

### release 粒度の検討

現行仕様は「規格品番**または** song 対象の収録内容が異なる場合は原則別 release」と明記する。三盤は CD 内容が同じでも規格品番が異なるため、仕様をそのまま適用する **Codex 判断は 3 release** である。Blu-ray 差を新たな分割基準にする必要はなく、すでに規格品番差で分かれる。盤種と映像特典は `releases.notes` に記載できる。

ただし、同一 CD 内容を一つの release にまとめたい運用意図があるなら、これは v0.2 の「規格品番」基準と衝突するため、投入前にユーザーが仕様変更を判断する必要がある。現仕様のままなら各盤 28 行、計 84 行の `release_tracks` 候補となる。

## 3. CD Disc / Track と登録候補

`track_title` は次表の公式商品表記をそのまま保持できる。全 28 track は Instrumental や映像ではなく song 対象である。候補番号は説明用であり ID ではない。

### Disc 1「The Best Juice 2019-2022」—16 tracks

| Track | song候補 | 公式 `track_title` | 作詞 | 作曲 | 編曲 | Version / work・song 判定 |
|---:|---|---|---|---|---|---|
| 1 | S01 | 微炭酸 | 山崎あおい | KOUGA | KOUGA | Version表記なし。W01候補／具体的音源はS01候補。既発音源との同一性は要確認。 |
| 2 | S02 | ポツリと | 中島卓偉 | 中島卓偉 | 中島卓偉 | 同上。W02／S02。 |
| 3 | S03 | Good bye & Good luck！ | 三浦徳子 | KOUGA | 炭竃智弘 | 同上。W03／S03。公式表記の全角感嘆符を保持。 |
| 4 | S04 | 「ひとりで生きられそう」って それってねえ、褒めているの？ | 山崎あおい | 山崎あおい | 山崎あおい | Version表記なし。W04／S04。Track 6との関係は後述。 |
| 5 | S05 | 25歳永遠説 | 児玉雨子 | KOUGA | KOUGA | Version表記なし。W05／S05。既発音源との同一性は要確認。 |
| 6 | S06 | 「ひとりで生きられそう」って それってねえ、褒めているの？(New Vocal Ver.) | 山崎あおい | 山崎あおい | 山崎あおい | 公式に別Version。S04と **同じW04、別song S06**、`version_type=new_vocal` とするのが仕様上明確。`version_name` の括弧を除いた値は投入時に表記方針確認。 |
| 7 | S07 | ポップミュージック | KAN | KAN | 炭竃智弘 | Version表記なし。W06／S07。既発音源との同一性は要確認。 |
| 8 | S08 | 好きって言ってよ | 山崎あおい | 山崎あおい | 山崎あおい | 同上。W07／S08。 |
| 9 | S09 | Borderline | 星部ショウ | 星部ショウ | 平田祥一郎 | 同上。W08／S09。 |
| 10 | S10 | Va-Va-Voom | 児玉雨子 | Shusui、Josef Melin | Josef Melin | W09／S10。共同作曲者は2 creator 行に分割し掲載順を保持。 |
| 11 | S11 | 続いていくSTORY (Symphonic Version feat. Karin) | 近藤薫 | 近藤薫 | 上杉洋史 | 公式に別Version。基礎曲と同じW10候補、別song S11、`version_type=other`。`feat. Karin` の artist/member 表現と歌唱者は要確認。 |
| 12 | S12 | DOWN TOWN | 伊藤銀次 | 山下達郎 | Anders Dannvik | カバーであることを公式ページ単独では確定できないため、W11／S12候補までは作れるが `version_type=cover` とカバー元とのwork共有は保留。 |
| 13 | S13 | がんばれないよ | 児玉雨子 | KOUGA | 炭竃智弘 | Version表記なし。W12／S13。既発音源との同一性は要確認。 |
| 14 | S14 | プラスティック・ラブ | 竹内まりや | 竹内まりや | Anders Dannvik | 公式ページ単独ではカバー関係を確定できないため、W13／S14候補、type/work共有は保留。 |
| 15 | S15 | Familia | イイジマケン | Shusui、Stefan Ekstedt | Stefan Ekstedt | W14／S15。共同作曲者を分割。既発音源との同一性は要確認。 |
| 16 | S16 | Future Smile | 大森祥子 | Shusui、Josef Melin | Josef Melin | W15／S16。共同作曲者を分割。既発音源との同一性は要確認。 |

### Disc 2「The Brand-New Juice 2022」—12 tracks

| Track | song候補 | 公式 `track_title` | 作詞 | 作曲 | 編曲 | Version / work・song 判定 |
|---:|---|---|---|---|---|---|
| 1 | S17 | GIRLS BE AMBITIOUS! 2022 | NOBE | 中島卓偉 | 中島卓偉 | 年を含む公式別Version。基礎曲と同じW16候補、別song S17、`version_type` は `re_recording` 又は `other` の要確認。 |
| 2 | S18 | POPPIN' LOVE | 山崎あおい | Andreas Öhrn、Henrik Smith、Olof Lindskog | Olof Lindskog | W17／S18。共同作曲者3名を個別 creator とする。 |
| 3 | S19 | STAGE～アガッてみな～ | 児玉雨子 | KOUGA | KOUGA | W18／S19。 |
| 4 | S20 | Mon Amour | オオヤギヒロオ | Josef Melin | Josef Melin | W19／S20。 |
| 5 | S21 | ノクチルカ | 唐沢美帆 | 松井寛 | 松井寛 | W20／S21。 |
| 6 | S22 | G.O.A.T. | 井筒日美 | Shusui、Josef Melin | Josef Melin | W21／S22。共同作曲者を分割。 |
| 7 | S23 | 雨の中の口笛 | Shusui | Shusui、Josef Melin | Josef Melin | W22／S23。Shusuiは作詞・共同作曲の各roleに1行ずつ。 |
| 8 | S24 | プラトニック・プラネット(Ultimate Juice Ver.) | 児玉雨子 | 炭竃智弘 | 炭竃智弘 | 公式に別Version。基礎曲と同じW23候補、別song S24、`version_type=other`。 |
| 9 | S25 | 生まれたてのBaby Love(2022 ver.) | 三浦徳子 | つんく | 高橋諭一 | 公式に別Version。W24候補、別song S25。`re_recording` / `new_vocal` / `other` は公式表記だけでは決めない。 |
| 10 | S26 | CHOICE & CHANCE(2022 ver.) | 星部ショウ | 星部ショウ | 平田祥一郎 | 同上。W25／S26、version_type要確認。 |
| 11 | S27 | Never Never Surrender(2022 ver.) | 児玉雨子 | 星部ショウ | 大久保薫 | 同上。W26／S27、version_type要確認。 |
| 12 | S28 | Goal～明日はあっちだよ～(Album Version) | 近藤薫 | 近藤薫 | 近藤薫 | 公式にAlbum Version。W27候補、別song S28、`version_type=other` が現行列挙では適切。 |

### 件数

- **work候補：27**。Track 4/6だけは同一の詞・曲であることを同一公式ページの同名・同一作家クレジットと明示的な New Vocal 表記から扱える。他の別Version 5曲は各々の基礎版と work を共有する想定だが、基礎版自体は今回の28 track外であり未登録候補である。
- **song候補：28**。これは「terzoで確認できる具体的音源」の最大候補数であり、Version表記なしの既発15曲を過去releaseのsongと統合できるか確認するまで本採番しない。
- **release_tracks候補：1盤28行、3盤なら84行**。

## 4. creators / song_creators 登録計画

上表の表記を `song_creators.credit_name` にそのまま保存し、role は `lyrics` / `composition` / `arrangement` とする。「、」区切りの共同作曲はそれぞれ1行に分割し、公式掲載順を `credit_order` にする。

重複を表記どおりまとめた creator 候補は次の **31主体**である（ID未採番）：

> 山崎あおい、KOUGA、中島卓偉、三浦徳子、炭竃智弘、児玉雨子、KAN、星部ショウ、平田祥一郎、Shusui、Josef Melin、近藤薫、上杉洋史、伊藤銀次、山下達郎、Anders Dannvik、竹内まりや、Stefan Ekstedt、大森祥子、NOBE、Andreas Öhrn、Henrik Smith、Olof Lindskog、オオヤギヒロオ、松井寛、唐沢美帆、井筒日美、つんく、高橋諭一、大久保薫

上記列挙は **31表記（31主体候補）**であり、別名義同一人物の推測統合はしていない。入力時も公式の別根拠なしに統合しない。欧文のダイアクリティカルマーク（`Öhrn`）、`Shusui`、`KOUGA` などの大文字小文字を `credit_name` で保持する。

### 特殊クレジット

公式CD曲目欄で確認できた音楽クレジットは作詞・作曲・編曲で、英訳詞、補作詞、Brass / Strings / Chorus Arrangement 等の独立表示はない。この範囲ではrole追加は不要である。一方、`feat. Karin` は作家roleではなく、song artist / performer の問題であり既存三roleへ押し込まない。

## 5. artist / member / performer 登録計画

### artist

- `artists`: **Juice=Juice**（`type=group`）を1件候補とする。
- 全28 songの `song_artists`: Juice=Juiceを `primary` とする候補。ただしS11の `feat. Karin` を `featured` artist とするには、「Karin」がソロartist名義なのか歌唱者注記なのかを別の公式情報で確定する必要があるため保留する。

### member と song_performers

公式リリースページの各曲目は個人歌唱者一覧を掲載していない。したがって、発売日時点の所属から推測せず、**S01～S28すべての `song_performers` は未確認・投入保留**とする。特に既発曲、New Vocal、2022 ver.、Album Versionでは録音時の構成が発売時所属と一致する保証がない。

S11について公式曲名中の `feat. Karin` から「Karin」という参加表示の存在までは確認できるが、それを特定の人物レコードへ結び付ける根拠、他の歌唱者、掲載順は同ページにない。人物を推測せず要確認とする。

このため `members.csv` と `member_affiliations.csv` も今回のページだけから必要人物・所属期間を確定して登録する計画にはできない。プロフィールや加入・卒業の公式告知を別途調査してから、かつ performer の公式根拠とは混同せず登録する。

## 6. テーブル別の将来登録計画

| CSV | 今回から得られる候補 | 保留事項 |
|---|---|---|
| `works.csv` | W01～W27相当（本IDなし）、代表タイトル、公式URL | カバー元との共有、track外の基礎版との共有 |
| `songs.csv` | S01～S28相当、title/version候補、公式URL | 既発音源との同一性、初出日、一部version_type |
| `creators.csv` | 公式表記ベース30候補 | 別名義同一人物の統合根拠 |
| `song_creators.csv` | 上表の3role。共同作曲は分割可能 | なし（公式掲載順を入力時に再確認） |
| `artists.csv` | Juice=Juice | `feat. Karin` のartist性 |
| `members.csv` | この公式ページだけでは確定候補なし | 歌唱者の別公式根拠 |
| `member_affiliations.csv` | この公式ページだけでは確定候補なし | 所属期間はperformerから推測しない |
| `song_artists.csv` | 全曲のJuice=Juice primary候補 | S11のfeatured扱い |
| `song_performers.csv` | 全曲保留 | 個人歌唱者を示す公式根拠が必要 |
| `releases.csv` | A/B/Cの3候補 | 1商品へまとめるなら仕様変更が先 |
| `release_tracks.csv` | 各盤Disc 1=16、Disc 2=12 | song確定後に84行を作成 |

`created_at` / `updated_at` は正本へ実際に追加する日時なので、本調査では値を作らない。

## 7. 既発曲・同一音源・Version 判定

### Codex判断で進められるもの

1. Disc 1 Track 4と6は同じW04を共有し、New Vocal Ver.は別songにする。
2. `Symphonic Version feat. Karin`、`Ultimate Juice Ver.`、`2022 ver.`（3曲）、`Album Version` は、各基礎版と同じworkを共有する別song候補にする。
3. Version表記のない曲でも現在のCSVにsongがないため候補から除外しない。ただし過去releaseの調査前には「同一音源の新規採番」も確定しない。
4. Instrumental・映像特典はsong/release_tracksに入れない。

### ユーザー確認が必要なもの

公式ページは「過去商品と同一マスターか」「新録か」を説明していない。このため、次は既存songへの統合と新song作成のどちらにも決定しない。

- **Version表記なしの既発候補（Disc 1 Track 1～5、7～10、12～16）**：過去のシングル／配信収録音源と同一か、アルバム向け変更があるか要確認。
- **S11 `Symphonic Version feat. Karin`**：別songは確定できるが、`version_name` の範囲、`version_type=other`、Karinのartist/member/performer表現を確認。
- **S17 `GIRLS BE AMBITIOUS! 2022`**：年次版が新録・新歌唱・別アレンジのどれか公式欄から判別不能。`re_recording`か`other`かを確認。
- **S24 `Ultimate Juice Ver.`**：別songは確定できるが`other`でよいか確認。
- **S25～S27 `(2022 ver.)`**：別songは確定できるが、`new_vocal`、`re_recording`、`other` のどれかを確認。
- **S28 `(Album Version)`**：別songは確定できるが、変更内容と`other`扱いを確認。
- **S12 / S14**：著名な同名作品とのカバー関係は公式releaseページのクレジット一致だけから断定しない。カバー元work共有と`version_type=cover`には公式根拠が必要。

## 8. data-spec v0.2 の検証結果

### 問題なく表現できる点

- workと具体的音源を分け、New Vocal等を同じworkの別songとして表せる。
- 同一音源の複数release収録を同じsong_idの複数`release_tracks`行で表せる。
- 2 Discの曲順、公式track表記、共同作家と掲載順、商品ごとの規格品番・盤種を既存列で表せる。
- Juice=Juiceというprimary artistと、根拠を得た後の個人performerを分けられる。
- 現行の三つのcreator roleだけで今回掲載された曲目クレジットを表せる。

### 判断・表現が難しい点

1. `version_type` は `2022 ver.` のような曖昧な公式Versionを、変更内容の根拠なしに `new_vocal` / `re_recording` / `other` へ分類できない。
2. `feat. Karin` を曲名の一部、version_name、featured artist、performer注記のどこへ（または複数へ）保持するか明記されていない。
3. 規格品番基準なら同じCD trackを3 releaseへ重複記録する。これは表現可能だが、パッケージ粒度として意図どおりか運用確認が必要。
4. 公式releaseページだけでは個人performerや同一マスターを証明できず、`song_performers`と既発song reuseを完結できない。これは仕様の欠陥というより、推測禁止ルールが正しく停止させた箇所である。
5. カバー元を同じworkへ束ねるには、カバー関係を裏付ける公式資料が別途必要である。

## 9. 事前調査時のCSV投入前ユーザー確認事項（解決済み）

### Q1. 三盤のrelease粒度

- **対象**：初回生産限定盤A/B、通常盤。
- **公式事実**：規格品番はHKCN-50700、HKCN-50703、HKCN-50706。CD 28曲は同一で、限定盤には内容の異なるBlu-rayが付く。
- **判断できない理由**：v0.2は規格品番差で原則分割する一方、今後同内容trackの反復を許容する運用意図の最終確認がない。
- **選択肢**：(A) 現仕様どおり3 releases＋84 tracks、(B) CD内容単位で1 release（先に仕様改定が必要）。
- **停止点**：release IDとrelease_tracksを未採番・未投入。

### Q2. Version表記なしの既発候補の同一音源

- **対象**：Disc 1 Track 1～5、7～10、12～16。
- **公式事実**：terzoにVersion注記なしで収録。
- **判断できない理由**：当該ページは過去releaseの音源と同一とは明記しない。
- **選択肢**：(A) 別の公式根拠で同一なら後に同じsongをreuse、(B) 別音源の公式根拠があれば新song、(C) 根拠取得まで保留。
- **停止点**：統合も新song採番もしていない。

### Q3. 曖昧なVersionの`version_type`

- **対象**：S17、S25、S26、S27（加えてS24/S28の`other`方針確認）。
- **公式事実**：タイトルには`2022` / `2022 ver.` / `Ultimate Juice Ver.` / `Album Version`がある。
- **判断できない理由**：名前だけでは歌だけの差、新録、アレンジ差を区別できない。
- **選択肢**：(A) 追加公式根拠を調査して分類、(B) すべて`other`とする、(C) 未分類を許す仕様改定を検討。
- **停止点**：songのversion_typeを確定せず未採番。

### Q4. `feat. Karin` の構造化

- **対象**：S11。
- **公式事実**：公式track titleに`Symphonic Version feat. Karin`とある。
- **判断できない理由**：リリースページにKarinの人物同定、歌唱者一覧、featured名義の区分がない。
- **選択肢**：(A) 追加公式資料で人物・名義を確認してartist/performerへ登録、(B) 当面track/titleとnotesだけに保持。
- **停止点**：member、featured artist、song_performersを未登録。

### Q5. カバーworkの共有

- **対象**：S12 `DOWN TOWN`、S14 `プラスティック・ラブ`。
- **公式事実**：作詞・作曲者表記は上表のとおり。
- **判断できない理由**：同ページは「カバー」と明記せず、作家一致だけで別releaseのworkと同一と推測してはならない。
- **選択肢**：(A) Hello! Project公式の紹介・告知等でカバー関係を確認して元曲とwork共有、(B) 確認までwork/song採番を保留。
- **停止点**：`version_type=cover`とwork共有を未確定。

### Q6. 個人歌唱者

- **対象**：S01～S28すべて。
- **公式事実**：商品名義はJuice=Juiceだが、曲別の個人一覧はリリースページにない。
- **判断できない理由**：発売時所属から音源の参加者を推測できない。Versionごとに編成が異なる可能性もある。
- **選択肢**：(A) 曲別歌唱者を明示する別のHello! Project公式資料を追加調査、(B) `song_performers`を空のまま先に他テーブルを投入。
- **停止点**：members、affiliations、song_performersを未確定。

上記は事前調査時の停止条件であり、次節のユーザー判断により初回投入に必要な事項は解決した。

## 10. ユーザー判断の反映と初回投入（2026-09-25）

以下は事前調査後に**ユーザー確認により確定**した運用判断であり、公式ページから直接確認した事実とは区別する。公式ページは曲名、Version 表記、作家クレジット、発売日、盤種、規格品番および曲順の出典として用い、ユーザー判断自体を `source_url` として表現しない。

- 初回生産限定盤A、初回生産限定盤B、通常盤を、規格品番ごとの **3 releases** として登録する。CD内容が同じため、3盤の `release_tracks` は同じ28 `song_id` を用いる（計84行）。
- Version表記なしの既発候補も、現在の `songs.csv` に同一songがないためterzoから先行登録する。後日、過去releaseと同一音源だと公式情報で確認できた場合は、新規songを作らず今回のsongを再利用する。
- `GIRLS BE AMBITIOUS! 2022`、`生まれたてのBaby Love(2022 ver.)`、`CHOICE & CHANCE(2022 ver.)`、`Never Never Surrender(2022 ver.)`、`Goal～明日はあっちだよ～(Album Version)` は、具体的な変更種別を公式情報から断定できないため `version_type=other` とする。`プラトニック・プラネット(Ultimate Juice Ver.)` および `続いていくSTORY (Symphonic Version feat. Karin)` も同じ理由で `other` とする。
- `「ひとりで生きられそう」って それってねえ、褒めているの？(New Vocal Ver.)` は公式表記に従い `new_vocal` とし、通常版と同じworkの別songとする。
- `Karin = 宮本佳林` は**ユーザー確認により確定**した人物同定である。曲名の `feat. Karin` から確認できる参加だけを `song_performers` に登録し、歌唱範囲、他の歌唱メンバー、featured artist名義は推測しない。
- `プラスティック・ラブ` と `DOWN TOWN` は、いずれも**ユーザー確認によりカバーと確定**した。作品workを作り、Juice=Juice版songを `version_type=cover` で紐付ける。原曲songは今回登録しない。
- 個人歌唱者が未確認でも、works、songs、creators、song_creators、artists、song_artists、releases、release_tracksの確定情報は先行登録する。発売日時点の所属から歌唱者を生成しない。

以上により、旧「CSV投入前のユーザー確認事項」Q1～Q6のうち、Q1～Q5およびQ6の先行投入方針は解決済みとする。曲別の全歌唱者、既発音源の初出日・同一性、および `feat. Karin` の正式なfeatured artist扱いは、追加の公式根拠が得られるまで未確認のまま残す。

### 今回使用した一次情報

- Hello! Project公式「Juice=Juice 3rdアルバム『terzo』」：https://helloproject.com/juicejuice/release/6692/
