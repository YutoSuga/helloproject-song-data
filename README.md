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

`data/` 以下の CSV を唯一の正本（Single Source of Truth）とし、入力・変更時は [データ仕様 v0.3](docs/data-spec.md) に従います。Juice=Juiceの作家ランキングを検証できる最小静的サイトと、CSVからその派生データを生成する処理も収録しています。ランキングのapplication-level規則は[作家ランキング集計仕様](docs/ranking-spec.md)を参照してください。生成物からCSVを逆更新しません。

`created_at` / `updated_at` はデータとして登録・更新時期を簡単に参照するために使い、Git 履歴は誰がどのコミットで何を変更したかを追跡する完全な履歴として使います。

## 将来構想

静的 Web サイトをGitHub Pagesなどで公開し、作家・メンバー別の楽曲一覧、関連Version／カバー、所属履歴、限定ユニット、公式ライブ映像、および開始時刻付きYouTubeリンクなどへ広げる構成を目指します。DB、API、認証、外部backendは使用しません。

## 作家ランキングの実行

Node.js 20以降だけを使用し、外部dependencyはありません。

```bash
npm test                    # unit test
npm run rankings:validate   # canonical Juice=Juice integration validation
npm run rankings:generate   # site/data/rankings/G00001.json を再生成
npm run site:build          # 現在はranking生成と同じ静的site build
npm run site:preview        # http://localhost:4173 でsite/をpreview
```

Webページは`/`（リポジトリ内では`site/index.html`）で、4カテゴリ、全順位、rank 3以内の強調、作家ごとの根拠workを確認できます。別artistを生成するときは`node scripts/generate-rankings.js Gxxxxx`を実行し、ページ側のartist設定を追加します。
