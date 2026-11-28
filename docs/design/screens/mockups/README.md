# ハロプロ作家研究所 PC・SP画面モック

[index.html](index.html)を起点に、PC幅1440pxとSP幅390pxで確認できる。HTML/CSS/通常のJSのみで、ディレクトリごと保持すれば直接開ける。組み合わせランキングの見本は基点の公開JSONの実データ。その他はサンプル。タブ・集計方式の切り替え、自己組み合わせの表示、曲数から共同制作楽曲への遷移を確認できる。モックの作家詳細・楽曲詳細のリンク先はレイアウト見本。新規の共同制作楽曲モックは基点の実データを使う。

- [ホーム](index.html)、[ランキング](creators.html)、[楽曲検索](songs.html)、[作家検索](songs.html?tab=creators)
- [組み合わせランキング](analysis.html)、[作家指定分析](analysis.html?tab=creator&creator_id=C00001)
- [作家詳細](creator-detail.html)、[楽曲詳細・複数音源](song-detail.html)、[楽曲詳細・1音源](song-detail.html?example=single)
- [共同制作楽曲](collaboration-detail.html?pair=C00001-C00002)
- [共通OGPの共有画像案](ogp.svg)
- [その他](more.html)、[動画一覧の公開休止案内](videos.html)

共通レイアウトと状態は[共通設計](../公開サイト共通設計.md)、画面仕様との対応は[画面一覧](../画面一覧.md)を参照。以前のモックと検証記録はPR #119時点の履歴に保存されている。モックはGitHub Pagesの公開範囲外。
