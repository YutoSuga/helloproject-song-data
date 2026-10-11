# helloproject-song-data

Hello! Project の楽曲、作家、歌唱者、所属履歴、公式映像を、検索・集計しやすい形で管理するためのデータリポジトリです。

## プロジェクト概要

このリポジトリは、`data/*.csv` を唯一の正本（canonical CSV）として管理します。Hello! Project 公式サイトから楽曲候補を収集する candidate collector、確認待ちの候補と収集履歴を置く `staging/song-candidates.json`、正本から集計・生成する作家ランキングと公開静的サイトを含みます。人間の判断を経て候補を正本へ登録する canonical registration は Milestone 3-B の予定です。

現在の公開サイトは Juice=Juice のランキングを表示します。collector は設定済みの主要7グループに対応していますが、収集した候補がそのまま公開サイトや正本 CSV に反映されるわけではありません。

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
├── .github/               # GitHub Actions / Pages
├── .vscode/               # 開発用タスク設定
├── data/                  # canonical CSV（唯一の正本）
├── docs/                  # 基本設計、詳細仕様、roadmap、調査記録
│   ├── design/            # 機能ごとの基本設計
│   └── research/          # 調査記録
├── scripts/               # 収集・集計・検証・preview の CLI entrypoint
├── site/                  # 公開静的サイトと生成済み ranking JSON
├── src/                   # application logic
│   ├── collector/         # 公式 release 取得・解析・候補統合
│   ├── canonical.js       # ranking 用の canonical CSV 読み込み
│   ├── csv.js             # CSV 読み込み
│   └── rankings.js        # 作家ランキング集計
├── staging/               # 確認待ち候補と収集履歴
├── test/                  # tests / fixtures
├── .gitignore             # 管理対象外ファイルの指定
├── package.json           # CLI と test の実行定義
└── README.md
```

## データフロー

```text
Hello! Project 公式 release 一覧・詳細
  ↓ candidate collector（実装済み）
staging/song-candidates.json（確認待ち・収集履歴）
  ↓ review / canonical registration（Milestone 3-B、planned）
data/*.csv（唯一の正本）
  ↓ ranking / site build（実装済み）
site/data/rankings/*.json（生成物）
  ↓ GitHub Pages（実装済み）
公開サイト
```

collector は正本 CSV を参考照合のために読みますが、直接更新しません。`staging/` は確認待ち候補と収集履歴の保存先であり、正本ではありません。`site/data/` などの生成物は正本 CSV から再生成する表示用データです。3-B では人間が確認した判断だけを正本へ反映する経路を設計・実装します。

## 設計書・仕様書

- [公開サイト基本設計](docs/design/public-site.md)：正本からランキングを生成し公開する流れ
- [候補収集基本設計](docs/design/candidate-collector.md)：公式 release から staging までの流れ
- [canonical registration 基本設計](docs/design/canonical-registration.md)：Milestone 3-B の責務と段階
- [データ仕様](docs/data-spec.md)：canonical CSV の列・制約・運用ルール
- [収集仕様](docs/collection-spec.md)：collector の詳細仕様
- [ランキング集計仕様](docs/ranking-spec.md)：集計・生成物の詳細仕様
- [Roadmap](docs/roadmap.md)：milestone と実装計画

## 現在の段階

`data/` 以下の CSV を唯一の正本（Single Source of Truth）とし、入力・変更時は [データ仕様 v0.3](docs/data-spec.md) に従います。Juice=Juiceの作家ランキングを検証できる最小静的サイトと、CSVからその派生データを生成する処理も収録しています。ランキングのapplication-level規則は[作家ランキング集計仕様](docs/ranking-spec.md)を参照してください。生成物からCSVを逆更新しません。

`created_at` / `updated_at` はデータとして登録・更新時期を簡単に参照するために使い、Git 履歴は誰がどのコミットで何を変更したかを追跡する完全な履歴として使います。

## 将来構想

現在の実装状況と機能単位の実装予定は [Roadmap](docs/roadmap.md) を参照してください。

現在の公開サイトは GitHub Pages 上の静的サイトです。作家・メンバー別の楽曲一覧、関連Version／カバー、所属履歴、限定ユニット、公式ライブ映像、および開始時刻付きYouTubeリンクなどは将来の拡張候補です。Milestone 3-C では認証付き管理画面を予定していますが、その実現方式や server-side 処理、DB、API、外部 backend の採否は未決定です。

## 開発フロー

基本方針は **1作業 = 1ブランチ → PR → merge → 作業ブランチ削除** です。

### 作業開始

`main` を最新化し、作業用ブランチを作成します。

```bash
git switch main
git pull
git switch -c feature/xxx
```

### 実装

作業用ブランチ上で Codex 等を利用してソースやドキュメントを修正し、必要に応じてテスト・build・生成物確認を行います。

### commit / push

```bash
git status
git add .
git commit -m "変更内容を表すメッセージ"
git push -u origin feature/xxx
```

初回に upstream を設定した後、2回目以降の push は通常 `git push` で行えます。

### PR / merge

GitHub 上で作業ブランチから `main` への Pull Request を作成します。GitHub Actions 等の確認後、`main` へ merge し、GitHub 上の作業ブランチを削除します。

### ローカルブランチ整理

merge 後はローカルの `main` を最新化し、作業ブランチを削除します。

```bash
git switch main
git pull
git branch -d feature/xxx
```

## 楽曲候補collector（Milestone 3-A Follow-up）

Node.js 20以降。通常運用は設定済み7グループ全体、個別確認は `--artist <slug>` で指定する。

```bash
npm run collect:candidates
npm run collect:candidates -- --artist rosychronicle
node --test
```

対象はモーニング娘。、アンジュルム、Juice=Juice、つばきファクトリー、BEYOOOOONDS、OCHA NORMA、ロージークロニクル。全選択artistの収集・解析が成功した場合だけ、共通の `staging/song-candidates.json` を一度更新する。1件でも失敗すればstagingは変更しない。既存candidate ID、status、notes、detected_at、管理者追加フィールドは維持する。

位置引数、未知オプション、未知slug、値なしは非0終了する。期間指定は実装しない。旧名義・関連ユニットを現在のartist IDへ自動統合せず、正本CSVへの反映やwork/songの採番も行わない。設定根拠・公式feedの範囲・summary仕様は[収集仕様](docs/collection-spec.md)を参照。

## 作家ランキングの実行

Node.js 20以降だけを使用し、外部dependencyはありません。

```bash
npm test                    # unit test
npm run rankings:validate   # canonical Juice=Juice integration validation
npm run rankings:generate   # site/data/rankings/G00001.json を再生成
npm run site:build          # 現在はranking生成と同じ静的site build
npm run site:preview        # http://localhost:4173 でsite/をpreview
```

Webページは`/`（リポジトリ内では`site/index.html`）で、5カテゴリ、全順位、rank 3以内の強調、作家ごとの根拠work、作詞 × 作曲の組み合わせ分析を確認できます。組み合わせ分析では全pairとCreator起点の両方向、自己pair作品数を表示します。別artistを生成するときは`node scripts/generate-rankings.js Gxxxxx`を実行し、ページ側のartist設定を追加します。

## ランキングデータ生成と公開の仕組み

`data/` 配下のCSVが正本データです。`site/data/rankings/G00001.json` は正本ではなく、CSVから生成されるWeb表示用の成果物です。`G00001` は Juice=Juice の `artist_id` です。

```text
data/*.csv
  ↓
src/rankings.js などの集計ロジック
  ↓
site/data/rankings/G00001.json
  ↓
site/app.js が読み込み
  ↓
GitHub Pagesで表示
```

ランキングは事前にJSONへ生成し、静的ファイルとして配信します。ブラウザでページを開くたびにランキングを計算するわけではありません。

- `npm run rankings:generate`: ランキングJSONを生成します。
- `npm run site:build`: サイト公開用データを生成します。現状はランキングJSON生成を含み、`rankings:generate` を実行します。

CSV更新時は、基本的にローカルで次の手順を行い、CSVと生成済みJSONを一緒にcommitする運用です。

```text
CSV更新
  ↓
npm run site:build
  ↓
生成された site/data/rankings/*.json を確認
  ↓
CSVと生成済みJSONを一緒にcommit
  ↓
PR作成
```

GitHub Actionsでもtest / validate / site buildを実行し、再生成したJSONがリポジトリにcommit済みの生成物と一致するかを差分（drift）検査で確認します。JSONの再生成やcommitを忘れ、差分が生じた場合は検査が失敗します。Actionsが生成したJSONを自動commit/pushする仕組みではないため、ローカルで再生成してcommitする必要があります。

## 静的サイトのbuildと公開

`npm run site:build`は、正本である`data/*.csv`からランキングJSONを`site/data/rankings/`へ再生成します。生成後は`npm run site:preview`を実行し、`http://localhost:4173/`で確認できます。HTML、CSS、JavaScript、ランキングJSONの参照にはrelative pathを使用しているため、localhost直下とGitHub Pagesのproject site subpathの両方で動作します。

GitHub Actionsの「Deploy ranking site to GitHub Pages」workflowは、`main`へのpushでtest、ランキング検証、site build、生成物の差分検査を順に実行し、成功した`site/`だけをGitHub Pagesへdeployします。Actions画面の「Run workflow」から手動実行も可能です。Pull Requestでも同じbuild前検証を行いますが、artifact uploadと本番deployは行いません。workflowがrepositoryへ生成物をcommitまたはpushすることはありません。

初回公開時はrepositoryの **Settings → Pages → Build and deployment → Source** で **GitHub Actions** を選択してください。公開URLはhardcodeせず、SettingsのPages画面、またはworkflowのdeploy jobに表示されるenvironment URLから確認します。独自PATやrepository secretは不要です。
