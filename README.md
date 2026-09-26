# helloproject-song-data

Hello! Project の楽曲、作家、歌唱者、所属履歴、公式映像を、検索・集計しやすい形で管理するためのデータリポジトリです。

## 管理対象

- 楽曲作品（work）、具体的な音源・歌唱版（song）、シングル／アルバム／配信等の商品（release）
- 作詞・作曲・編曲などの作家とクレジット
- 通常グループ、限定・シャッフル・企画ユニット
- メンバー、その所属履歴、各 song の実際の歌唱メンバー
- Hello! Project 公式系 YouTube 動画と、動画内の楽曲・開始位置・公演情報
- release ごとの収録 song とトラック表記
- 各情報を確認した公式一次情報の URL

卒業後に発表された OG のソロ作品、非公式動画、Instrumental や映像違いだけの MV は、現時点の収集対象外です。`songs.version_type=original` は公式情報上でその work の最初の通常の公式リリースとなる song を表し、CSV への登録順では決まりません。`song_id` も永続的な識別子であって発売順を表しません。同一音源の再収録では song を増やさず、別 release への収録関係を `releases.csv` と `release_tracks.csv` で表します。同一音源か確証がない場合は、推測で統合・新規採番せずユーザー確認事項として保留します。詳細な判定・更新ルールは [データ仕様](docs/data-spec.md) を正とします。

データ収集の一次情報は原則として Hello! Project 公式サイトの、対象楽曲・release を直接説明する情報です。公式情報で確認できない内容を第三者サイトから推測補完しません。

## ディレクトリ構成

```text
.
├── README.md
├── docs/
│   └── data-spec.md       # CSV の列、制約、運用ルール
└── data/                  # 正本となる CSV
    ├── works.csv
    ├── songs.csv
    ├── creators.csv
    ├── song_creators.csv
    ├── artists.csv
    ├── members.csv
    ├── member_affiliations.csv
    ├── song_artists.csv
    ├── song_performers.csv
    ├── releases.csv
    ├── release_tracks.csv
    ├── videos.csv
    ├── video_songs.csv
    └── video_song_performers.csv
```

## 現在の段階

現在は**データ設計・収集段階**です。`data/` 以下の CSV を唯一の正本（Single Source of Truth）とし、入力・変更時は [データ仕様 v0.3](docs/data-spec.md) に従います。生成物を将来追加する場合も、CSV を手作業で逆更新せず、CSV から一方向に生成します。

`created_at` / `updated_at` はデータとして登録・更新時期を簡単に参照するために使い、Git 履歴は誰がどのコミットで何を変更したかを追跡する完全な履歴として使います。

## 将来構想

CSV から静的 Web サイトを生成し、GitHub Pages などで公開することを想定しています。グループ別の作家ランキング、作家・メンバー別の楽曲一覧、関連 Version／カバー、所属履歴、限定ユニット、公式ライブ映像、および開始時刻付き YouTube リンクなどを検索・表示できる構成を目指します。Web サイト、DB、API、スクレイピング処理は今回の範囲には含みません。
