# データ仕様 v0.3

## 1. 基本方針

`data/` 以下の UTF-8 CSV（RFC 4180 準拠、ヘッダーあり）を正本とする。1 レコードを物理的な 1 行とし、カンマ・改行・ダブルクォートを含む値はダブルクォートで囲み、内部のダブルクォートは二重化する。列順は本書および各 CSV のヘッダー順に固定する。

### work、song、release

- **work** は「楽曲という作品」そのもの。同一の詞・曲を基礎とする関連版を束ねる。
- **song** は、その作品の具体的な音源・歌唱 Version。登録基準はシングル曲かアルバム曲かではなく、その具体的な音源が既に `songs.csv` に存在するかである。
- **release** は、シングル、アルバム、公式配信等のリリース商品・作品。song の収録先は `release_tracks.csv` で表す。
- 同一音源のアルバム等への再収録では新しい `song_id` を作らず、同じ song を複数の release に紐付ける。New Vocal Ver.、新録・再録、別歌唱者によるカバー、公式に別 Version とされた音源は別 song とし、同じ作品なら `work_id` を共有する。
- Instrumental、MV、Dance Shot 等は song として登録しない。ライブの短縮版、メドレー、ライブ固有アレンジ、一時的な歌唱者変更も、公式に別音源・別 Version としてリリースされない限り新しい song にしない。映像ごとの歌唱者は `video_song_performers.csv` で表す。

### 同一音源の判定と収集順序

収集は発売順でなくてよい。例えばアルバム `terzo` を先に調査し、収録されたシングル既出曲がまだ `songs.csv` にない場合は、その song を登録してよい。後からシングルを調査して同一音源と確認できた場合、新しい song は作らず、既存 `song_id` を維持したまま、その音源の実際の初出日に `songs.release_date` を更新し、必要なら `version_type` も公式情報に基づく正しい値へ更新する。過去の release は `releases.csv` に追加し、`release_tracks.csv` から既存 song に紐付ける。

同じ具体的な音源・歌唱 Version が後から別のシングル、アルバム、ベスト盤等へ再収録されても、「別の商品に収録された」ことだけを理由に song を増やさない。各収録関係を `release_tracks.csv` に追加し、すべて同じ `song_id` を使用する。反対に、同じ work でも New Vocal Ver.（`new_vocal`）、明確な新録・再録（`re_recording`）、別歌唱者によるカバー（`cover`）、その他の公式な別 Version（`other`）は、同じ `work_id` を共有する別 song とする。公式表記だけでは再録と確定できない場合は `other` とし、後から公式情報を確認できた時点で `re_recording` への更新を検討する。

登録時に見るのは「過去にシングル発売されたか」だけではなく「現在の `songs.csv` に同一音源が登録済みか」である。後から過去の release が見つかった場合も、まず同じ音源か別 Version かを確認する。同一音源なら上記のとおり既存 song を更新・再利用し、別音源であると確認できた場合に限り別 `song_id` を採番する。

同一性に確証がないときは、既存 song への統合も新規 `song_id` の採番も推測で行わず、**要確認として保留しユーザー判断を求める**。特に次は自動判断しない。

- 同名だが歌唱メンバーが異なる
- アルバム収録時に新録された可能性がある
- Version 表記が曖昧
- クレジットは同じだが音源が同一か分からない
- 表記違いだが同一 Version の可能性がある

今後のデータ収集でも、Codex は一次情報から確証を持てない同一性判定を勝手に行わない。

ユーザー判断が必要な事項を提示するときは、対象、一次情報から確認できた事実、判断できない理由、選択肢、登録の停止点に加え、判断に用いた一次情報 URL を必ず併記する。複数の一次情報を用いた場合は、関連する URL をすべて提示する。

### 一次情報

楽曲データの一次情報は原則として Hello! Project 公式サイトとし、主に公式リリース情報から曲名、発売日、作詞、作曲、編曲、歌唱者、Version 表記、収録商品を取得する。公式情報が複数ある場合は、楽曲・release を直接説明する情報を優先する。第三者サイトを一次情報として扱わず、公式サイトだけで確認できない値は推測で補完せず要確認とする。

### 共通表記、NULL、日時

- ID、列挙値、URL、日付、時刻秒は半角 ASCII、名称・注記は公式表記を原則とする。
- 必須列は空欄不可。任意列の不明・該当なしは空欄とし、`NULL`、`N/A`、`-` 等を入れない。
- 日付は完全に確認できる場合のみ `YYYY-MM-DD` で記録し、年月・年しか分からない値を補完しない。
- 日時はタイムゾーンを含む ISO 8601（例 `2026-09-24T22:15:00+09:00`）とする。
- 真偽値は `true` / `false` とする。
- `source_url` は当該行を裏付ける一次情報の絶対 HTTPS URL。現時点で `source_checked_at` は追加しない。複数出典や確認日を厳密に管理する必要が生じた場合は `sources.csv`、`record_sources.csv` 等を検討する。

マスタ系 CSV（works、songs、creators、artists、members、videos、releases）の `created_at` は正本データへ最初に登録した日時、`updated_at` はそのレコード自体を最後に更新した日時であり、発売日や公式情報公開日ではない。新規作成時は原則同値とし、更新時は `created_at` を変えず `updated_at` のみ更新する。関連テーブル（song_creators、member_affiliations、song_artists、song_performers、release_tracks、video_songs、video_song_performers）には現時点で両列を設けず、詳細な変更履歴は Git で追跡する。

`created_at` / `updated_at` は登録・更新時期を簡単に参照するための情報である。Git は誰が、どのコミットで、何をどのように変更したかを追跡する完全な変更履歴であり、CSV 内に更新履歴自体を複数行・複数列で蓄積しない。

### ID 採番

| 対象 | 形式 | 例 | 方針 |
|---|---|---|---|
| work | `W` + 5 桁連番 | `W00001` | 作品単位で全体一意 |
| creator | `C` + 5 桁連番 | `C00001` | 同一人物・同一制作主体を識別 |
| member | `P` + 5 桁連番 | `P00001` | 人物を識別 |
| artist | `G` + 5 桁連番 | `G00001` | 活動主体を識別 |
| release | `L` + 5 桁連番 | `L00001` | リリース商品・作品単位で一意 |
| video | `V` + 5 桁連番 | `V00001` | YouTube 動画単位で一意 |
| song | 接頭辞 + 5 桁連番 | `J00001` | 主な歌唱側の系列内で一意 |

song 接頭辞は `M`（モーニング娘。）、`A`（アンジュルム）、`J`（Juice=Juice）、`T`（つばきファクトリー）、`B`（BEYOOOOONDS）、`O`（OCHA NORMA）、`R`（ロージークロニクル）、`H`（Hello! Project 全体、企画曲、通常グループに属さないケース）とする。カバーはカバー側を使う。GOODM!X 等の特殊／シャッフルユニット、在籍中メンバーのソロ名義等で通常グループに該当しないものは原則 `H` とし、実際の名義・人物は artists、song_artists、song_performers で表す。採番済み ID は再利用せず欠番を許容する。

ID は永続的な識別子であり、発売順・時系列を表さない。例えば `J00001` は Juice=Juice 系列で最初に採番された song であって、最古に発売された song であることを意味しない。後から過去の song を追加しても既存 ID は振り直さず、発売順の判断には `songs.release_date` と releases / release_tracks の情報を使用する。

### 参照整合性、変更、削除

- PK は一意かつ空欄不可、FK は参照先に存在すること。複合 PK の全列の組み合わせを一意とする。
- 表示順を持つ関連表では、同じ親・文脈における順序値も一意とする。
- 表記訂正は ID を保って更新する。同一性が変わる場合のみ新 ID を採番する。
- 参照中の行を物理削除しない。誤登録は同じ変更で関連行を修正・削除し、履歴は Git で追跡する。FK の連鎖削除は行わない。
- CSV 更新時は重複 PK、FK、列挙値、ID・日付・日時形式を機械検証することを将来想定する。

関連テーブルに対象行がないことは、関係が存在しないことだけでなく、未調査・未確認のため構造化データがまだ登録されていないことも意味し得る。特に `song_performers` と `video_song_performers` では、行の不在を「該当なし」と断定しない。現時点では status 列を追加せず、将来「該当なし」と「未確認」の機械的な区別が必要になった場合に、status 列または調査状態管理の導入を検討する。

## 2. CSV 定義

以下で「日付」は `YYYY-MM-DD`、「日時」はタイムゾーン付き ISO 8601、「URL」は絶対 HTTPS URL、「正整数」は 1 以上、「非負整数」は 0 以上を表す。

### `data/works.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `work_id` | ID | 必須 | PK、`^W[0-9]{5}$` |
| `title` | 文字列 | 必須 | 作品の代表タイトル |
| `title_kana` | 文字列 | 任意 | 検索用の読み |
| `notes` | 文字列 | 任意 | 同一作品判定等 |
| `source_url` | URL | 必須 | 作品名の一次情報 |
| `created_at` | 日時 | 必須 | 正本への初回登録日時 |
| `updated_at` | 日時 | 必須 | レコードの最終更新日時 |

### `data/songs.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `song_id` | ID | 必須 | PK、`^[MAJTBORH][0-9]{5}$` |
| `work_id` | ID | 必須 | FK → `works.work_id` |
| `title` | 文字列 | 必須 | この版の公式曲名 |
| `version_name` | 文字列 | 任意 | Version 名。なければ空欄 |
| `version_type` | 列挙 | 必須 | `original`, `new_vocal`, `re_recording`, `cover`, `other` |
| `release_date` | 日付 | 任意 | この具体的音源が公式商品または公式配信で最初にリリースされた日 |
| `notes` | 文字列 | 任意 | 版の判定等 |
| `source_url` | URL | 必須 | 曲名・版の一次情報 |
| `created_at` | 日時 | 必須 | 正本への初回登録日時 |
| `updated_at` | 日時 | 必須 | レコードの最終更新日時 |

`release_date` は CD と公式配信で異なる場合、原則として早い方とし、ライブ初披露日は含めない。個別の CD 発売日、配信日、アルバム再収録日、その他の商品収録は releases / release_tracks で管理する。

#### `version_type=original` の定義と判定

`original` は、**その work について、公式情報から確認できる最初の通常の公式リリースとなる song** を意味する。「このプロジェクトの CSV へ最初に登録した song」という意味ではない。CSV への登録順、`song_id` の採番順、release を調査した順番は判定に使用せず、公式情報上のリリース時系列を基準とする。`original` は原則 1 work に 1 件だが、同時に異なる歌唱者で成立した例外は根拠を `notes` に記す。

判定には、その具体的な音源・歌唱 Version が公式商品または公式配信として最初にリリースされた日である `songs.release_date` と、公式の Version 情報を用いる。同一 work に複数の song がある場合も、CSV 上の順番ではなく、公式リリース時系列、Version 表記、カバーか、New Vocal／再録等かを合わせて判断する。したがって、同一 work 内で `release_date` が最古の song を機械的・無条件に `original` とするルールではない。

例えば Hello! Project 対象外の原曲が先に存在し、Juice=Juice がその work を後から歌唱した場合、Juice=Juice 版しかこのリポジトリに登録されていなくても、その song は `cover` であって `original` ではない。リポジトリへの登録有無や対象範囲は作品上の原曲・カバー関係を変えない。

後日の調査で、現在 `original` としている song より前に別の具体的 song が存在したと判明した場合は、公式情報に基づいて正しい song を追加または修正し、関係する `version_type` を見直す。ただし、過去の release が見つかっただけでは別 song を作らない。同一音源なら既存 `song_id` を使用して `release_date` と収録関係を更新し、別音源であると確認できた場合のみ別 song として登録する。

### `data/creators.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `creator_id` | ID | 必須 | PK、`^C[0-9]{5}$` |
| `name` | 文字列 | 必須 | 人物・制作主体を識別する代表名 |
| `name_kana` | 文字列 | 任意 | 代表名の読み |
| `notes` | 文字列 | 任意 | 別名義等 |
| `source_url` | URL | 任意 | 同一性・名称の一次情報 |
| `created_at` | 日時 | 必須 | 正本への初回登録日時 |
| `updated_at` | 日時 | 必須 | レコードの最終更新日時 |

`creator_id` はクレジット名義でなく、原則として同一人物・同一制作主体を識別する。同一人物による複数名義と確認できれば同じ ID を用い、曲ごとの実際の名義は `song_creators.credit_name` に残す。確証がない名義は推測で統合せず、別 ID とするか要確認として保留する。集計は `creator_id` を用いる。より厳密な名義履歴が必要なら `creator_aliases` 等を追加できる。

### `data/song_creators.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `song_id` | ID | 必須 | 複合 PK、FK → `songs.song_id` |
| `creator_id` | ID | 必須 | 複合 PK、FK → `creators.creator_id` |
| `role` | 列挙 | 必須 | 複合 PK、`lyrics`, `composition`, `arrangement` |
| `credit_name` | 文字列 | 必須 | その song で実際に表示されたクレジット名義 |
| `credit_order` | 正整数 | 任意 | 同一 song・role 内の公式掲載順 |
| `source_url` | URL | 必須 | クレジットの一次情報 |

共同担当は作家ごとに 1 行とする。集計では持分按分せず、各 `creator_id` を role ごとに 1 曲と数える。Web 等で当時の正式名義を表示するときは `credit_name` を用いる。

### `data/artists.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `artist_id` | ID | 必須 | PK、`^G[0-9]{5}$` |
| `name` | 文字列 | 必須 | 現在または代表となる公式名称 |
| `type` | 列挙 | 必須 | `group`, `solo`, `temporary_unit`, `shuffle_unit`, `special_unit`, `project`, `other` |
| `start_date` | 日付 | 任意 | 結成・活動開始日 |
| `end_date` | 日付 | 任意 | 活動終了日。開始日以後 |
| `notes` | 文字列 | 任意 | 旧名称・性質等 |
| `source_url` | URL | 任意 | 名称等の一次情報 |
| `created_at` | 日時 | 必須 | 正本への初回登録日時 |
| `updated_at` | 日時 | 必須 | レコードの最終更新日時 |

名称変更後も活動主体の継続が明確なら同じ `artist_id` を維持し、単純な改名だけで別 ID を採番しない。旧名称は当面 `notes` に記す。主体の同一性が不明なら統合せずユーザー確認事項とする。厳密な履歴が必要になれば `artist_names`、`artist_name_history` 等を追加できる。

### `data/members.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `member_id` | ID | 必須 | PK、`^P[0-9]{5}$` |
| `name` | 文字列 | 必須 | 公式表記の氏名・芸名 |
| `name_kana` | 文字列 | 任意 | 読み |
| `birth_date` | 日付 | 任意 | 生年月日 |
| `notes` | 文字列 | 任意 | 改名等 |
| `source_url` | URL | 任意 | プロフィール等の一次情報 |
| `created_at` | 日時 | 必須 | 正本への初回登録日時 |
| `updated_at` | 日時 | 必須 | レコードの最終更新日時 |

現在状態は持たず所属期間から導出する。

### `data/member_affiliations.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `member_id` | ID | 必須 | 複合 PK、FK → `members.member_id` |
| `artist_id` | ID | 必須 | 複合 PK、FK → `artists.artist_id` |
| `start_date` | 日付 | 必須 | 複合 PK、所属開始日 |
| `end_date` | 日付 | 任意 | 所属終了日。開始日以後 |
| `notes` | 文字列 | 任意 | 兼任等 |
| `source_url` | URL | 必須 | 期間の一次情報 |

同じ member・artist の期間は原則重複不可。公式上の異なる artist 間の兼任は重複してよい。

### `data/song_artists.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `song_id` | ID | 必須 | 複合 PK、FK → `songs.song_id` |
| `artist_id` | ID | 必須 | 複合 PK、FK → `artists.artist_id` |
| `role` | 列挙 | 必須 | 複合 PK、`primary`, `featured` |
| `credit_order` | 正整数 | 任意 | 同一 song 内の公式掲載順 |
| `source_url` | URL | 必須 | 名義の一次情報 |

各 song に `primary` を 1 件以上必須とする。

### `data/song_performers.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `song_id` | ID | 必須 | 複合 PK、FK → `songs.song_id` |
| `member_id` | ID | 必須 | 複合 PK、FK → `members.member_id` |
| `performer_order` | 正整数 | 任意 | 同一 song 内の公式掲載順 |
| `notes` | 文字列 | 任意 | 参加形態等 |
| `source_url` | URL | 必須 | 歌唱者の一次情報 |

所属履歴から推定せず、その音源で実際に歌唱した確認可能な member を登録する。

### `data/releases.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `release_id` | ID | 必須 | PK、`^L[0-9]{5}$` |
| `title` | 文字列 | 必須 | 商品・配信作品の公式タイトル |
| `release_type` | 列挙 | 必須 | `single`, `album`, `digital`, `other` |
| `release_date` | 日付 | 任意 | 当該 release の公式発売・配信日。未確認時は空欄 |
| `catalog_number` | 文字列 | 任意 | 公式規格品番。ない場合は空欄 |
| `notes` | 文字列 | 任意 | 盤種等 |
| `source_url` | URL | 必須 | release の一次情報 |
| `created_at` | 日時 | 必須 | 正本への初回登録日時 |
| `updated_at` | 日時 | 必須 | レコードの最終更新日時 |

分類は当初この 4 値に留め、mini album / best album は `album` として必要なら `notes` に記す。検索上の必要性が確認できた場合に限り `mini_album`、`best_album` 等を追加する。初回盤・通常盤等は、規格品番または song 対象の収録内容が異なる場合は原則別 release とする。パッケージのみの差などをどこまで分けるか、公式情報から盤の差を確定できない場合は要確認とし、勝手に複雑化しない。

### `data/release_tracks.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `release_id` | ID | 必須 | 複合 PK、FK → `releases.release_id` |
| `disc_number` | 正整数 | 必須 | 複合 PK、Disc 番号 |
| `track_number` | 正整数 | 必須 | 複合 PK、Disc 内トラック番号 |
| `song_id` | ID | 必須 | FK → `songs.song_id` |
| `track_title` | 文字列 | 必須 | 商品上の曲名表記。一致時も保持 |
| `notes` | 文字列 | 任意 | 収録上の注記 |
| `source_url` | URL | 必須 | 収録情報の一次情報 |

同じ音源がシングルとアルバムに収録された場合、両行の `song_id` は同じにする。原則として song 管理対象だけを紐付け、Instrumental、MV、Dance Shot 等は登録しない。そのためトラック番号の欠番を許容する。将来、商品の完全なトラックリストが必要になれば、非 song トラックを nullable な `song_id` や種別で扱う等の拡張を仕様改定で検討する。

### `data/videos.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `video_id` | ID | 必須 | PK、`^V[0-9]{5}$` |
| `youtube_video_id` | 文字列 | 必須 | 一意、YouTube 動画 ID |
| `title` | 文字列 | 必須 | 動画タイトル |
| `channel_name` | 文字列 | 必須 | 公式系チャンネル名 |
| `channel_id` | 文字列 | 任意 | YouTube channel ID |
| `published_date` | 日付 | 必須 | YouTube 公開日 |
| `url` | URL | 必須 | 一意、動画 URL |
| `notes` | 文字列 | 任意 | 公開状態等 |
| `source_url` | URL | 必須 | 動画情報の出典 |
| `created_at` | 日時 | 必須 | 正本への初回登録日時 |
| `updated_at` | 日時 | 必須 | レコードの最終更新日時 |

対象は原則 Hello! Project 公式系 YouTube のみ。非公式・違法アップロードは登録しない。削除・非公開後も行を残し状態を `notes` に記す。

### `data/video_songs.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `video_id` | ID | 必須 | 複合 PK、FK → `videos.video_id` |
| `song_id` | ID | 必須 | 複合 PK、FK → `songs.song_id` |
| `start_seconds` | 非負整数 | 必須 | 複合 PK、動画先頭からの開始秒 |
| `performer_artist_id` | ID | 任意 | FK → `artists.artist_id` |
| `performer_credit` | 文字列 | 必須 | 公式表示・自由記述の歌唱名義 |
| `event_name` | 文字列 | 任意 | 公演・イベント名 |
| `event_date` | 日付 | 任意 | 収録公演日 |
| `notes` | 文字列 | 任意 | メドレー等 |
| `source_url` | URL | 必須 | 区間・クレジットの一次情報 |

開始リンクは動画 URL と開始秒から生成する。個人単位の検索は `video_song_performers` を使用し、`performer_credit` は原文の歌唱名義を保持する。

### `data/video_song_performers.csv`

| 列名 | 型 | 必須 | 意味・制約 |
|---|---|---:|---|
| `video_id` | ID | 必須 | 複合 PK の区間部分 |
| `song_id` | ID | 必須 | 複合 PK の区間部分 |
| `start_seconds` | 非負整数 | 必須 | 複合 PK の区間部分 |
| `member_id` | ID | 必須 | 複合 PK、FK → `members.member_id` |
| `performer_order` | 正整数 | 任意 | 同一区間内の表示順 |
| `notes` | 文字列 | 任意 | 歌唱形態等 |
| `source_url` | URL | 必須 | 歌唱者の一次情報 |

`(video_id, song_id, start_seconds)` は `video_songs` の対象区間への複合 FK であり、行の PK はこれに `member_id` を加えた 4 列とする。特定メンバーの公式映像、特定曲の歌唱、卒業前や限定編成の映像を人物単位で検索するための構造化データである。

## 3. 列挙値一覧

| 列 | 値 |
|---|---|
| `songs.version_type` | `original`, `new_vocal`, `re_recording`, `cover`, `other` |
| `artists.type` | `group`, `solo`, `temporary_unit`, `shuffle_unit`, `special_unit`, `project`, `other` |
| `releases.release_type` | `single`, `album`, `digital`, `other` |
| `song_creators.role` | `lyrics`, `composition`, `arrangement` |
| `song_artists.role` | `primary`, `featured` |

列挙値は既存値を読み替えず、仕様を先に改定して追加する。訳詞・補作詞等も既存 role へ無理に寄せない。

## 4. 収集範囲と集計規則

- 現役・過去グループ曲、在籍中メンバーのソロ曲、限定／シャッフル／企画ユニット曲、カバー、New Vocal 等を対象とする。卒業後に発表された OG のソロ作品は現時点では対象外。
- グループ別作家集計は song_artists から song を選び、song_creators を `creator_id`・role ごとに数える。同じ作家・song・role は複合 PK により 1 回だけ数え、共同担当を按分しない。
- work の関連 Version／カバーは同じ `work_id` の songs を列挙する。
- 標準音源の歌唱者は song_performers、映像区間の歌唱者は video_song_performers、所属履歴は member_affiliations を参照し、相互に推測で代用しない。

## 5. 今後判断が必要な事項

実データ投入前後に少量のサンプルで確認し、確証のないものはユーザーへ確認する。

1. 同一人物・制作主体と確認できない creator 名義を別 ID にするか、登録を保留するか。
2. 活動主体の継続が不明な改名・再結成と、名称履歴テーブル導入時期。
3. 初回盤・通常盤等について、規格品番・収録曲差以外の違いまで別 release とする境界。
4. 公式表記だけでは判別できない同一音源、新録、歌唱者違いの扱い。
5. mini album / best album を独立した `release_type` にする必要性。
6. 完全な商品トラックリストを保持する場合の Instrumental・映像トラックの表現。
7. 複数出典と確認日を管理する sources / record_sources の導入時期。

公式ページの消失・URL 変更、クレジットの粒度差、同一性判定、表記揺れも継続課題とする。出典 URL と Git 履歴を維持し、推測による補完・統合・新規採番を避ける。
