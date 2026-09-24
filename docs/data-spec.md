# データ仕様

## 1. 基本方針

`data/` 以下の UTF-8 CSV（RFC 4180 準拠、ヘッダーあり）を正本とする。1 レコードを物理的な 1 行とし、カンマ・改行・ダブルクォートを含む値はダブルクォートで囲み、内部のダブルクォートは二重化する。列順は本書および各 CSV のヘッダー順に固定する。

### work と song

- **work** は「楽曲という作品」そのもの。同一の詞・曲を基礎とする関連版を束ねる。
- **song** は、その作品の具体的な音源・歌唱版。オリジナル、新録、New Vocal、別歌唱者によるカバーなどをそれぞれ別 `song_id` とし、同じ作品なら同一 `work_id` に紐付ける。
- Instrumental、MV／Dance Shot など映像だけの違い、同一音源のアルバム再収録は新しい song にしない。
- 新録か同一音源か判断できない場合は推測で追加せず、一次情報を確認する。

### 共通表記と NULL

- ID、列挙値、URL、日付、時刻秒は半角 ASCII、名称・注記は公式表記を原則とする。
- 必須列は空欄不可。任意列の不明・該当なしは空欄とし、`NULL`、`N/A`、`-` などの代替文字列を入れない。空文字と未確認を区別する必要が生じた場合は将来ステータス列を追加する。
- 日付は完全な日付が確認できる場合のみ `YYYY-MM-DD`（ISO 8601）で記録する。年月・年しか分からない値を補完せず空欄にし、必要なら `notes` に記す。
- 真偽値は `true` / `false` とする。
- `source_url` は当該行を裏付ける Hello! Project 公式サイト等の一次情報 URL。複数ある場合は最も直接的なものを記録し、追加出典が必要になれば将来、出典テーブルへの分離を検討する。

### ID 採番

| 対象 | 形式 | 例 | 方針 |
|---|---|---|---|
| work | `W` + 5 桁連番 | `W00001` | 作品単位でリポジトリ全体一意 |
| creator | `C` + 5 桁連番 | `C00001` | 名義を識別する固定 ID |
| member | `P` + 5 桁連番 | `P00001` | 人物を識別する固定 ID |
| artist | `G` + 5 桁連番 | `G00001` | グループ／ユニット／ソロ名義を横断して一意 |
| video | `V` + 5 桁連番 | `V00001` | YouTube 動画単位で一意 |
| song | 接頭辞 + 5 桁連番 | `J00001` | 主な歌唱側の系列内で一意 |

song の接頭辞は `M`（モーニング娘。）、`A`（アンジュルム）、`J`（Juice=Juice）、`T`（つばきファクトリー）、`B`（BEYOOOOONDS）、`O`（OCHA NORMA）、`R`（ロージークロニクル）、`H`（Hello! Project 全体、企画曲、通常グループに属さないケース等）。カバーは原曲側でなく、カバーした側の接頭辞を使う。採番済み ID は名称変更・統合・削除後も再利用せず、番号の欠番を許容する。新たな通常グループが生じた場合は、既存値と衝突しない接頭辞を仕様改定で追加してから採番する。

### 参照整合性、変更、削除

- 主キー（PK）は一意かつ空欄不可。外部キー（FK）は参照先に存在しなければならない。
- 複合 PK の全列の組み合わせを一意とする。表示順を持つ関連表では、同じ親における `position` も一意とする。
- 表記訂正は ID を保ったまま更新する。作品・人物等の同一性が変わる場合のみ新 ID を採番する。
- 参照されている行は物理削除しない。誤登録は同じ変更で関連行を修正・削除し、履歴は Git で追跡する。公式な解散・卒業は削除ではなく終了日で表す。
- FK の連鎖削除は行わない。ID の変更は原則禁止し、やむを得ない場合は全参照を同一コミットで更新する。
- CSV 追加・更新時は、重複 PK、FK、列挙値、ID 形式、日付形式を機械検証することを将来想定する。

## 2. CSV 定義

以下で「文字列」は UTF-8 テキスト、「日付」は `YYYY-MM-DD`、「URL」は絶対 `https` URL、「非負整数」は 0 以上の 10 進整数を表す。

### `data/works.csv`

作品としての楽曲を管理する。

| 列名 | 型 | 必須 | 意味 | 値の例 | 制約 |
|---|---|---:|---|---|---|
| `work_id` | ID | 必須 | 作品 ID | `W00123` | PK、`^W[0-9]{5}$` |
| `title` | 文字列 | 必須 | 作品の代表タイトル | `ある楽曲` | 空文字不可 |
| `title_kana` | 文字列 | 任意 | 検索・並び替え用の読み | `アルガッキョク` | 公式表記または確認できる読み |
| `notes` | 文字列 | 任意 | 同一作品判定等の注記 | `原曲は企画ユニット版` | 自由記述 |
| `source_url` | URL | 必須 | 作品名を確認した一次情報 | `https://www.helloproject.com/...` | 絶対 HTTPS URL |

### `data/songs.csv`

作品の具体的な歌唱版を管理する。

| 列名 | 型 | 必須 | 意味 | 値の例 | 制約 |
|---|---|---:|---|---|---|
| `song_id` | ID | 必須 | 歌唱版 ID | `J00123` | PK、`^[MAJTBORH][0-9]{5}$`、主歌唱側の接頭辞 |
| `work_id` | ID | 必須 | 元となる作品 | `W00123` | FK → `works.work_id` |
| `title` | 文字列 | 必須 | この版での公式曲名 | `ある楽曲 (New Vocal Ver.)` | 空文字不可 |
| `version_name` | 文字列 | 任意 | 版名のみ | `New Vocal Ver.` | オリジナルで版名がなければ空欄 |
| `version_type` | 列挙 | 必須 | 版の分類 | `new_vocal` | `original`, `new_vocal`, `re_recording`, `cover`, `other` |
| `release_date` | 日付 | 任意 | この版の初出日 | `2025-01-01` | `YYYY-MM-DD`、推測禁止 |
| `notes` | 文字列 | 任意 | 版の判定・収録等の注記 | `メンバー変更後の新録` | 自由記述 |
| `source_url` | URL | 必須 | 曲名・版を確認した一次情報 | `https://www.helloproject.com/...` | 絶対 HTTPS URL |

`version_type=original` は原則として 1 work に 1 件とする。ただし同時に異なる歌唱者で成立した作品など例外は `notes` に根拠を記す。カバー／New Vocal／新録は別 song とし、同じ作品に基づく限り `work_id` を共有する。

### `data/creators.csv`

クレジットに現れる作家名義を管理する。人物名を ID として使わない。

| 列名 | 型 | 必須 | 意味 | 値の例 | 制約 |
|---|---|---:|---|---|---|
| `creator_id` | ID | 必須 | 作家 ID | `C00001` | PK、`^C[0-9]{5}$` |
| `name` | 文字列 | 必須 | 公式クレジット名義 | `山田花子` | 空文字不可 |
| `name_kana` | 文字列 | 任意 | 名義の読み | `ヤマダハナコ` | 確認できる場合のみ |
| `notes` | 文字列 | 任意 | 別名義等の注記 | `別名義あり` | 自由記述 |
| `source_url` | URL | 任意 | 名義を確認した一次情報 | `https://www.helloproject.com/...` | 設定時は絶対 HTTPS URL |

同一人物の別名義を統合するかは個別判断とし、初期運用では公式クレジット名義単位を原則とする。`name` は同姓同名や表記差があるため一意制約を設けない。

### `data/song_creators.csv`

song ごとの作家クレジットを管理する。

| 列名 | 型 | 必須 | 意味 | 値の例 | 制約 |
|---|---|---:|---|---|---|
| `song_id` | ID | 必須 | 対象の歌唱版 | `J00001` | PK（複合）、FK → `songs.song_id` |
| `creator_id` | ID | 必須 | クレジットされた作家 | `C00001` | PK（複合）、FK → `creators.creator_id` |
| `role` | 列挙 | 必須 | 担当 | `lyrics` | PK（複合）、`lyrics`, `composition`, `arrangement` |
| `credit_order` | 正整数 | 任意 | 同一 role 内の公式掲載順 | `1` | 1 以上、同一 `song_id`・`role` 内で一意 |
| `source_url` | URL | 必須 | クレジットの一次情報 | `https://www.helloproject.com/...` | 絶対 HTTPS URL |

共同作詞・共同作曲は作家ごとに 1 行を登録する。集計では持分で按分せず、各作家を各 role で 1 曲と数える。同一 `song_id`・`creator_id` に `lyrics` と `composition` の両行があれば「作詞・作曲を両方担当した楽曲」1 曲と集計する。版ごとにクレジットが異なり得るため work ではなく song に関連付ける。

### `data/artists.csv`

通常グループから限定ユニット、ソロ名義まで、楽曲の発表・歌唱主体を管理する。

| 列名 | 型 | 必須 | 意味 | 値の例 | 制約 |
|---|---|---:|---|---|---|
| `artist_id` | ID | 必須 | アーティスト ID | `G00001` | PK、`^G[0-9]{5}$` |
| `name` | 文字列 | 必須 | 公式名称 | `GOODM!X` | 空文字不可 |
| `type` | 列挙 | 必須 | 主体の分類 | `special_unit` | `group`, `solo`, `temporary_unit`, `shuffle_unit`, `special_unit`, `project`, `other` |
| `start_date` | 日付 | 任意 | 結成・活動開始日 | `2024-01-01` | `YYYY-MM-DD` |
| `end_date` | 日付 | 任意 | 解散・活動終了日 | `2024-12-31` | `YYYY-MM-DD`、開始日以後、活動中は空欄 |
| `notes` | 文字列 | 任意 | 性質・改名等の注記 | `期間限定ユニット` | 自由記述 |
| `source_url` | URL | 任意 | 名称等の一次情報 | `https://www.helloproject.com/...` | 設定時は絶対 HTTPS URL |

`name` は改名や同名再結成に備えて一意制約を設けない。名称変更を同一主体として扱う場合は ID を維持し、現状は最新名を `name`、旧名を `notes` に記録する。

### `data/members.csv`

人物の基本情報を管理する。`current` / `graduated` のような現在状態は保持せず、所属期間から導出する。

| 列名 | 型 | 必須 | 意味 | 値の例 | 制約 |
|---|---|---:|---|---|---|
| `member_id` | ID | 必須 | 人物 ID | `P00001` | PK、`^P[0-9]{5}$` |
| `name` | 文字列 | 必須 | 公式表記の氏名・芸名 | `山田花子` | 空文字不可 |
| `name_kana` | 文字列 | 任意 | 読み | `ヤマダハナコ` | 確認できる場合のみ |
| `birth_date` | 日付 | 任意 | 生年月日 | `2000-01-01` | `YYYY-MM-DD` |
| `notes` | 文字列 | 任意 | 改名等の注記 | `旧芸名あり` | 自由記述 |
| `source_url` | URL | 任意 | プロフィール等の一次情報 | `https://www.helloproject.com/...` | 設定時は絶対 HTTPS URL |

### `data/member_affiliations.csv`

人物がアーティストに所属した期間を管理する。同じ人物の再加入も別行で表現できる。

| 列名 | 型 | 必須 | 意味 | 値の例 | 制約 |
|---|---|---:|---|---|---|
| `member_id` | ID | 必須 | 人物 | `P00001` | PK（複合）、FK → `members.member_id` |
| `artist_id` | ID | 必須 | 所属先 | `G00001` | PK（複合）、FK → `artists.artist_id` |
| `start_date` | 日付 | 必須 | 所属開始日 | `2020-01-01` | PK（複合）、`YYYY-MM-DD` |
| `end_date` | 日付 | 任意 | 所属終了日 | `2025-03-31` | `YYYY-MM-DD`、開始日以後、空欄は現在所属中 |
| `notes` | 文字列 | 任意 | 兼任・期間の注記 | `サブリーダー兼任` | 自由記述 |
| `source_url` | URL | 必須 | 期間を確認した一次情報 | `https://www.helloproject.com/news/...` | 絶対 HTTPS URL |

同じ `member_id`・`artist_id` の期間は原則重複不可。ただし公式上の兼任は異なる artist 間で期間が重複してよい。

### `data/song_artists.csv`

song と公式なアーティスト名義の多対多関係を管理する。

| 列名 | 型 | 必須 | 意味 | 値の例 | 制約 |
|---|---|---:|---|---|---|
| `song_id` | ID | 必須 | 歌唱版 | `J00001` | PK（複合）、FK → `songs.song_id` |
| `artist_id` | ID | 必須 | 発表・歌唱アーティスト | `G00001` | PK（複合）、FK → `artists.artist_id` |
| `role` | 列挙 | 必須 | song に対する関係 | `primary` | PK（複合）、`primary`, `featured` |
| `credit_order` | 正整数 | 任意 | 連名時の公式掲載順 | `1` | 1 以上、同一 song 内で一意 |
| `source_url` | URL | 必須 | 名義を確認した一次情報 | `https://www.helloproject.com/...` | 絶対 HTTPS URL |

各 song に `primary` を 1 件以上必須とする。複数名義の共同曲は複数行で表現する。

### `data/song_performers.csv`

所属履歴から推定せず、各歌唱版で実際に歌唱した人物を明示する。

| 列名 | 型 | 必須 | 意味 | 値の例 | 制約 |
|---|---|---:|---|---|---|
| `song_id` | ID | 必須 | 歌唱版 | `J00001` | PK（複合）、FK → `songs.song_id` |
| `member_id` | ID | 必須 | 実際の歌唱者 | `P00001` | PK（複合）、FK → `members.member_id` |
| `performer_order` | 正整数 | 任意 | 公式掲載順 | `1` | 1 以上、同一 song 内で一意 |
| `notes` | 文字列 | 任意 | 参加形態等 | `コーラス参加` | 自由記述 |
| `source_url` | URL | 必須 | 歌唱者を確認した一次情報 | `https://www.helloproject.com/...` | 絶対 HTTPS URL |

これによりソロ（1 人）、グループ内ユニット、シャッフル、限定ユニットを同じ構造で検索できる。全員歌唱であっても確認できる各 member を明示的に登録する。

### `data/videos.csv`

対象は原則として Hello! Project 公式系 YouTube チャンネルの動画のみとする。

| 列名 | 型 | 必須 | 意味 | 値の例 | 制約 |
|---|---|---:|---|---|---|
| `video_id` | ID | 必須 | 内部動画 ID | `V00001` | PK、`^V[0-9]{5}$` |
| `youtube_video_id` | 文字列 | 必須 | YouTube の動画 ID | `dQw4w9WgXcQ` | 一意、`^[A-Za-z0-9_-]{11}$` |
| `title` | 文字列 | 必須 | 動画タイトル | `ハロ！ステ #XXX` | 空文字不可 |
| `channel_name` | 文字列 | 必須 | 公開チャンネル名 | `ハロ！ステ` | 公式系チャンネルのみ |
| `channel_id` | 文字列 | 任意 | YouTube チャンネル ID | `UCxxxxxxxxxxxxxxxxxxxxxx` | 設定時は YouTube channel ID |
| `published_date` | 日付 | 必須 | YouTube 公開日 | `2025-01-01` | `YYYY-MM-DD` |
| `url` | URL | 必須 | 動画 URL | `https://www.youtube.com/watch?v=dQw4w9WgXcQ` | 一意、絶対 HTTPS URL、ID と一致 |
| `notes` | 文字列 | 任意 | 公開状態等の注記 | `期間限定公開` | 自由記述 |
| `source_url` | URL | 必須 | 動画情報の出典 | `https://www.youtube.com/watch?v=dQw4w9WgXcQ` | 絶対 HTTPS URL（通常は `url` と同値） |

第三者の非公式・違法アップロードは登録しない。削除・非公開になっても参照保全のため行は残し、判明した状態を `notes` に記す。

### `data/video_songs.csv`

1 本の動画に含まれる各楽曲区間を管理する。同じ song が同一動画に複数回現れる場合も開始秒で区別する。

| 列名 | 型 | 必須 | 意味 | 値の例 | 制約 |
|---|---|---:|---|---|---|
| `video_id` | ID | 必須 | 動画 | `V00001` | PK（複合）、FK → `videos.video_id` |
| `song_id` | ID | 必須 | 歌唱された版 | `J00001` | PK（複合）、FK → `songs.song_id` |
| `start_seconds` | 非負整数 | 必須 | 動画先頭からの開始秒 | `332` | PK（複合）、0 以上 |
| `performer_artist_id` | ID | 任意 | この映像での歌唱アーティスト | `G00001` | FK → `artists.artist_id` |
| `performer_credit` | 文字列 | 必須 | 映像上の実際の歌唱者・歌唱名義 | `Juice=Juice（○○・△△）` | 公式表記を優先、空文字不可 |
| `event_name` | 文字列 | 任意 | 公演・イベント名 | `Hello! Project 2025 Winter` | 不明なら空欄 |
| `event_date` | 日付 | 任意 | 収録公演日 | `2025-01-02` | `YYYY-MM-DD`、公開日とは区別 |
| `notes` | 文字列 | 任意 | メドレー等の注記 | `メドレー内` | 自由記述 |
| `source_url` | URL | 必須 | 区間・クレジットの出典 | `https://www.youtube.com/watch?v=...&t=332s` | 絶対 HTTPS URL |

開始リンクは `videos.url` と `start_seconds` から生成する。`performer_artist_id` は登録済み名義がある場合に用い、個人列挙・当日だけの編成などは `performer_credit` に原文で残す。これは特定 song の標準的歌唱者を表す `song_performers` と区別する。映像単位で個々の member を厳密検索する要件が生じた場合は、区切り文字入り ID を格納せず `video_song_performers` 関連表を追加する。

## 3. 列挙値一覧

| 列 | 値 | 意味 |
|---|---|---|
| `songs.version_type` | `original` | 最初の歌唱版 |
|  | `new_vocal` | New Vocal と明記された版 |
|  | `re_recording` | 新録・再録版 |
|  | `cover` | 別歌唱側によるカバー |
|  | `other` | 上記以外の別歌唱版（理由を notes に記載） |
| `artists.type` | `group` | 通常グループ |
|  | `solo` | H!P 在籍中のソロ名義 |
|  | `temporary_unit` | 期間限定ユニット |
|  | `shuffle_unit` | シャッフルユニット |
|  | `special_unit` | GOODM!X 等の特殊ユニット |
|  | `project` | H!P 全体・企画名義 |
|  | `other` | 上記に分類できない名義 |
| `song_creators.role` | `lyrics` | 作詞 |
|  | `composition` | 作曲 |
|  | `arrangement` | 編曲 |
| `song_artists.role` | `primary` | 主名義 |
|  | `featured` | 客演・併記名義 |

列挙値の追加は既存値を読み替えず、本書と検証処理を先に更新する。作家 role（訳詞、補作詞等）が必要になった場合も、既存 3 値へ無理に寄せず仕様改定で追加する。

## 4. 収集範囲と集計規則

- 現役・過去グループ曲、在籍中メンバーのソロ曲、限定／シャッフル／企画ユニット曲、過去の限定ユニット曲、カバー、New Vocal 等を対象とする。
- Hello! Project 卒業後に発表されたソロ作品は現時点では対象外。在籍中に歌唱した song は、現在の所属状態にかかわらず保持する。将来対象を広げても、既存 ID・関係表はそのまま利用できる。
- グループ別の作家集計は `song_artists` から song を選び、`song_creators` を role ごとに数える。同じ作家・song・role は複合 PK により 1 回だけ数える。
- 「作詞・作曲両方」は同じ `song_id` で同じ `creator_id` に両 role が存在するかで判定する。共同担当も単独担当と同じ 1 曲で、0.5 曲にはしない。
- work 単位の関連 Version／カバー検索は、同一 `work_id` の songs を列挙し `version_type` で分類する。
- メンバーの歌唱曲は `song_performers`、所属履歴は `member_affiliations` を参照し、両者を推測で代用しない。

## 5. 初期運用で判断が必要な事項

実データ投入前に、次を少量のサンプルで確認し、必要なら後方互換性を保って仕様を更新する。

1. 作家の別名義・表記揺れを同一 `creator_id` に統合する範囲。
2. グループ改名を同一 artist とするか、新 artist とするか、および名称履歴テーブルの要否。
3. 発表日を配信日・CD 発売日・初披露日のどれに統一するか。
4. メドレー、短縮版、ライブ固有アレンジを新 song とする境界（現仕様では新録音源として独立して公式化された場合を基本とする）。
5. 動画内の個人歌唱者を構造化検索するための `video_song_performers` 追加要否。
6. 複数の一次情報や確認日を正規化する `sources` 関連表の追加要否。

将来的には、公式ページの消失・URL 変更、YouTube 動画の非公開、改名、日付不明、公式クレジットの粒度差、同一音源判定、表記揺れが主な課題になる。出典 URL と Git 履歴を維持し、推測による補完や既存 ID の再利用を避ける。
