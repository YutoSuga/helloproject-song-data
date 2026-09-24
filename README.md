# helloproject-song-data

Hello! Project の楽曲、作家、歌唱者、所属履歴、公式映像を、検索・集計しやすい形で管理するためのデータリポジトリです。

## 管理対象

- 楽曲作品（work）と、オリジナル／新録／カバーなどの具体的な歌唱版（song）
- 作詞・作曲・編曲などの作家とクレジット
- 通常グループ、限定・シャッフル・企画ユニット
- メンバー、その所属履歴、各 song の実際の歌唱メンバー
- Hello! Project 公式系 YouTube 動画と、動画内の楽曲・開始位置・公演情報
- 各情報を確認した公式一次情報の URL

卒業後に発表された OG のソロ作品、非公式動画、同一音源の再収録、Instrumental や映像違いだけの MV は、現時点の収集対象外です。

## ディレクトリ構成

```text
.
├── README.md
├── docs/
│   └── data-spec.md       # CSV の列、制約、運用ルール
└── data/                  # 正本となる CSV（現在はヘッダーのみ）
    ├── works.csv
    ├── songs.csv
    ├── creators.csv
    ├── song_creators.csv
    ├── artists.csv
    ├── members.csv
    ├── member_affiliations.csv
    ├── song_artists.csv
    ├── song_performers.csv
    ├── videos.csv
    └── video_songs.csv
```

## 現在の段階

現在は**データ設計段階**です。`data/` 以下の CSV を唯一の正本（Single Source of Truth）とし、実データはまだ投入していません。入力・変更時は [データ仕様](docs/data-spec.md) に従います。生成物を将来追加する場合も、CSV を手作業で逆更新せず、CSV から一方向に生成します。

## 将来構想

CSV から静的 Web サイトを生成し、GitHub Pages などで公開することを想定しています。グループ別の作家ランキング、作家・メンバー別の楽曲一覧、関連 Version／カバー、所属履歴、限定ユニット、公式ライブ映像、および開始時刻付き YouTube リンクなどを検索・表示できる構成を目指します。Web サイト、DB、API、スクレイピング処理は今回の範囲には含みません。
