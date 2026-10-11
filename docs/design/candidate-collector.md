# 候補収集 基本設計

## 目的

Hello! Project 公式サイトの release 情報から音声トラックの候補を収集し、レビュー待ちデータとして `staging/song-candidates.json` に保存する。正本への登録判断はこの処理では行わない。

## 入力と出力

- 入力：設定済み artist の公式 release 一覧・feed・詳細ページ、参考照合用の `data/songs.csv` と `data/works.csv`、既存の staging JSON。
- 出力：収集候補を統合した `staging/song-candidates.json` と artist 別・全体の収集 summary。

対象 artist はモーニング娘。、アンジュルム、Juice=Juice、つばきファクトリー、BEYOOOOONDS、OCHA NORMA、ロージークロニクルの7グループ。通常実行は全対象、`--artist <slug>` で単独確認できる。

## 主な処理

1. `src/collector/artists.js` の設定から対象 artist を選ぶ。
2. 公式 release 一覧・feed・詳細を取得し、音声トラックを解析する。収集根拠は Hello! Project 公式情報に限り、第三者情報で補完しない。
3. Instrumental や対象外映像を除き、正本のタイトルと参考照合する。タイトル一致は登録確定を意味しない。
4. 収集元の位置に基づく candidate ID で既存候補と統合し、`status`、`notes`、検出日時、確認済み ID、管理者追加情報などのレビュー情報を維持する。
5. 選択した全 artist の取得・解析が成功した場合だけ、一時ファイルへの書き込みと rename により staging を一度保存する。

未知の release type または media、必要な詳細構造の欠落、取得・解析失敗は STOP とする。途中失敗時は staging を更新しない。collector は canonical CSV を参考照合のために読むが、直接更新せず、ID 採番や artist identity の自動確定もしない。

## 関連仕様

- [収集詳細仕様](../collection-spec.md)
- [canonical CSV 仕様](../data-spec.md)
- [マイルストーン](../roadmap.md)
