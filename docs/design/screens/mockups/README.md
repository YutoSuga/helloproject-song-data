# ハロプロ作家研究所 PC・SP画面モック

[index.html](index.html)を起点に、PC幅1440pxとSP幅390pxで確認できる。HTML/CSS/通常のJSのみで、ディレクトリごと保持すれば直接開ける。表示はサンプル。タブ切替・詳細遷移・根拠ダイアログを操作できる。検索、フィルタ、集計、URLと履歴の保存は正式設計の実装時に検証する。

- [ホーム](index.html)、[ランキング](creators.html)、[楽曲検索](songs.html)、[作家検索](songs.html?tab=creators)
- [組み合わせランキング](analysis.html)、[作家指定分析](analysis.html?tab=creator&creator_id=C00001)
- [作家詳細](creator-detail.html)、[楽曲詳細・複数音源](song-detail.html)、[楽曲詳細・1音源](song-detail.html?example=single)
- [その他](more.html)、[動画一覧の公開休止案内](videos.html)

共通レイアウトと状態は[共通設計](../公開サイト共通設計.md)、画面仕様との対応は[画面一覧](../画面一覧.md)を参照。以前のモックと検証記録はPR #119時点の履歴に保存されている。モックはGitHub Pagesの公開範囲外。
