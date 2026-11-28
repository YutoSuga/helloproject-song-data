# ハロプロ作家研究所 PC・SP画面モック

[index.html](index.html)を起点に、PC幅1440pxとSP幅390pxで確認できる。HTML/CSS/通常のJSのみで、ディレクトリごと保持すれば直接開ける。組み合わせランキングの見本は基点の公開JSONの実データ。その他はサンプル。タブ切替・詳細遷移・根拠ダイアログと「同一作家の組み合わせを含む」チェックを操作できる。分析では表示例として各条件での上位を切り替え、`?include_self=1` でもON状態を開ける。分析モックのチェックはURL・再読込・戻る／進むで確認できる。順位と根拠の一部は基点のスナップショットで、詳細リンク先は共通のレイアウト例。既存の作家・担当チェックや他の検索条件の復元・集計は後続の実装で検証する。

- [ホーム](index.html)、[ランキング](creators.html)、[楽曲検索](songs.html)、[作家検索](songs.html?tab=creators)
- [組み合わせランキング](analysis.html)、[作家指定分析](analysis.html?tab=creator&creator_id=C00001)
- [作家詳細](creator-detail.html)、[楽曲詳細・複数音源](song-detail.html)、[楽曲詳細・1音源](song-detail.html?example=single)
- [共通OGPの共有画像案](ogp.svg)
- [その他](more.html)、[動画一覧の公開休止案内](videos.html)

共通レイアウトと状態は[共通設計](../公開サイト共通設計.md)、画面仕様との対応は[画面一覧](../画面一覧.md)を参照。以前のモックと検証記録はPR #119時点の履歴に保存されている。モックはGitHub Pagesの公開範囲外。
