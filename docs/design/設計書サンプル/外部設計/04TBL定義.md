# 03. テーブル定義書
## training-bookshelf

---

## 1. books テーブル（書籍情報）

### 概要
書籍の基本情報を管理するテーブル。システムで扱う全ての書籍データを格納します。

### テーブル定義

| # | 物理名 | 論理名 | 型 | 長さ | 精度 | NULL | デフォルト | 主キー | 外部キー | ユニーク | インデックス | 備考 |
|---|--------|--------|-----|------|------|------|-----------|--------|---------|---------|------------|------|
| 1 | book_id | 書籍ID | INT | - | - | NOT NULL | AUTO_INCREMENT | ○ | - | - | - | 自動採番 |
| 2 | title | タイトル | VARCHAR | 100 | - | NOT NULL | - | - | - | - | ○ | - |
| 3 | author | 著者 | VARCHAR | 50 | - | NOT NULL | - | - | - | - | ○ | - |
| 4 | publisher | 出版社 | VARCHAR | 50 | - | NOT NULL | - | - | - | - | - | - |
| 5 | published_date | 出版日 | DATE | - | - | NOT NULL | - | - | - | - | ○ | YYYY-MM-DD形式 |
| 6 | isbn | ISBN | VARCHAR | 13 | - | NOT NULL | - | - | - | ○ | ○ | 10桁または13桁 |
| 7 | category_id | カテゴリID | INT | - | - | NOT NULL | - | - | ○ | - | ○ | categories.category_id参照 |
| 8 | price | 価格 | INT | - | - | NOT NULL | - | - | - | - | - | 単位:円 |
| 9 | description | 概要 | TEXT | - | - | NULL | NULL | - | - | - | - | 最大65,535文字 |
| 10 | created_at | 作成日時 | DATETIME | - | - | NOT NULL | CURRENT_TIMESTAMP | - | - | - | - | 登録時自動設定 |
| 11 | updated_at | 更新日時 | DATETIME | - | - | NOT NULL | CURRENT_TIMESTAMP ON UPDATE | - | - | - | - | 更新時自動更新 |

### インデックス定義

| インデックス名 | 種類 | カラム | 説明 |
|--------------|------|--------|------|
| PRIMARY | PRIMARY KEY | book_id | 主キー |
| idx_isbn | UNIQUE | isbn | ISBN重複チェック、ISBN検索 |
| idx_title | INDEX | title | タイトル検索の高速化 |
| idx_author | INDEX | author | 著者検索の高速化 |
| idx_category_id | INDEX | category_id | カテゴリフィルタの高速化 |
| idx_published_date | INDEX | published_date | 出版日ソートの高速化 |

### 制約

#### NOT NULL制約
- book_id, title, author, publisher, published_date, isbn, category_id, price, created_at, updated_at

#### UNIQUE制約
- isbn: 同じISBNの書籍は登録不可

#### 外部キー制約
```sql
FOREIGN KEY (category_id) REFERENCES categories(category_id)
```
- category_id は categories テーブルの category_id を参照

#### CHECK制約
- price >= 0: 価格は0以上

### サンプルデータ

```sql
-- ※categoriesテーブル登録後に実行
INSERT INTO books (title, author, publisher, published_date, isbn, category_id, price, description) VALUES
('リーダブルコード', 'Dustin Boswell', 'オライリージャパン', '2012-06-23', '9784873115658', 3, 2640, 'より良いコードを書くためのシンプルで実践的なテクニック'),
('人を動かす', 'デール・カーネギー', '創元社', '2016-01-26', '9784422100517', 2, 1650, '人間関係の古典として、あらゆる自己啓発本の原点となった不朽の名著'),
('吾輩は猫である', '夏目漱石', '岩波書店', '1990-01-16', '9784003101018', 1, 1056, '猫の視点で人間社会を風刺した夏目漱石のデビュー作');
```

### テーブル作成SQL

```sql
CREATE TABLE books (
    book_id INT AUTO_INCREMENT PRIMARY KEY COMMENT '書籍ID',
    title VARCHAR(100) NOT NULL COMMENT 'タイトル',
    author VARCHAR(50) NOT NULL COMMENT '著者',
    publisher VARCHAR(50) NOT NULL COMMENT '出版社',
    published_date DATE NOT NULL COMMENT '出版日',
    isbn VARCHAR(13) NOT NULL COMMENT 'ISBN',
    category_id INT NOT NULL COMMENT 'カテゴリID',
    price INT NOT NULL COMMENT '価格',
    description TEXT NULL COMMENT '概要',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '作成日時',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新日時',
    UNIQUE KEY idx_isbn (isbn),
    INDEX idx_title (title),
    INDEX idx_author (author),
    INDEX idx_category_id (category_id),
    INDEX idx_published_date (published_date),
    FOREIGN KEY (category_id) REFERENCES categories(category_id),
    CHECK (price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='書籍情報';
```

---

## 2. categories テーブル（カテゴリマスタ）

### 概要
書籍カテゴリの選択肢を管理するマスタテーブル。書籍登録・編集画面のプルダウン選択肢はこのテーブルから取得する。

### テーブル定義

| # | 物理名 | 論理名 | 型 | 長さ | 精度 | NULL | デフォルト | 主キー | 外部キー | ユニーク | インデックス | 備考 |
|---|--------|--------|-----|------|------|------|-----------|--------|---------|---------|------------|------|
| 1 | category_id | カテゴリID | INT | - | - | NOT NULL | AUTO_INCREMENT | ○ | - | - | - | 自動採番 |
| 2 | category_name | カテゴリ名 | VARCHAR | 50 | - | NOT NULL | - | - | - | - | - | 画面表示名 |

### インデックス定義

| インデックス名 | 種類 | カラム | 説明 |
|--------------|------|--------|------|
| PRIMARY | PRIMARY KEY | category_id | 主キー |

### 制約

#### NOT NULL制約
- category_id, category_name

### マスタデータ

| category_id | category_name |
|-------------|---------------|
| 1 | 小説・文学 |
| 2 | ビジネス・経済 |
| 3 | IT・コンピュータ |
| 4 | 科学・技術 |
| 5 | 歴史 |
| 6 | アート・デザイン |
| 7 | 料理・グルメ |
| 8 | 趣味・実用 |
| 9 | その他 |

### テーブル作成SQL

```sql
CREATE TABLE categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'カテゴリID',
    category_name VARCHAR(50) NOT NULL COMMENT 'カテゴリ名'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='カテゴリマスタ';
```

### マスタデータ投入SQL

```sql
INSERT INTO categories (category_id, category_name) VALUES
(1, '小説・文学'),
(2, 'ビジネス・経済'),
(3, 'IT・コンピュータ'),
(4, '科学・技術'),
(5, '歴史'),
(6, 'アート・デザイン'),
(7, '料理・グルメ'),
(8, '趣味・実用'),
(9, 'その他');
```

---

## 3. reviews テーブル（レビュー情報）

### 概要
書籍に対するレビュー（評価・コメント）を管理するテーブル。各書籍に対して複数のレビューが紐づきます。

### テーブル定義

| # | 物理名 | 論理名 | 型 | 長さ | 精度 | NULL | デフォルト | 主キー | 外部キー | ユニーク | インデックス | 備考 |
|---|--------|--------|-----|------|------|------|-----------|--------|---------|---------|------------|------|
| 1 | review_id | レビューID | INT | - | - | NOT NULL | AUTO_INCREMENT | ○ | - | - | - | 自動採番 |
| 2 | book_id | 書籍ID | INT | - | - | NOT NULL | - | - | ○ | - | ○ | books.book_id参照 |
| 3 | reviewer_name | レビュアー名 | VARCHAR | 50 | - | NOT NULL | - | - | - | - | - | - |
| 4 | rating | 評価 | TINYINT | - | - | NOT NULL | - | - | - | - | - | 1-5の整数 |
| 5 | comment | コメント | TEXT | - | - | NULL | NULL | - | - | - | - | 最大65,535文字 |
| 6 | created_at | 投稿日時 | DATETIME | - | - | NOT NULL | CURRENT_TIMESTAMP | - | - | - | ○ | 投稿時自動設定 |

### インデックス定義

| インデックス名 | 種類 | カラム | 説明 |
|--------------|------|--------|------|
| PRIMARY | PRIMARY KEY | review_id | 主キー |
| idx_book_id | INDEX | book_id | 書籍別レビュー取得の高速化 |
| idx_created_at | INDEX | created_at | 投稿日時ソートの高速化 |

### 制約

#### NOT NULL制約
- review_id, book_id, reviewer_name, rating, created_at

#### 外部キー制約
```sql
FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
```
- book_id は books テーブルの book_id を参照
- 書籍が削除されると、紐づくレビューも自動削除される

#### CHECK制約
- rating BETWEEN 1 AND 5: 評価は1-5の整数

### 評価値の意味

| 評価値 | 意味 | 表示 |
|--------|------|------|
| 1 | 非常に悪い | ★☆☆☆☆ |
| 2 | 悪い | ★★☆☆☆ |
| 3 | 普通 | ★★★☆☆ |
| 4 | 良い | ★★★★☆ |
| 5 | 非常に良い | ★★★★★ |

### サンプルデータ

```sql
-- book_id=1（リーダブルコード）に対するレビュー
INSERT INTO reviews (book_id, reviewer_name, rating, comment, created_at) VALUES
(1, '山田太郎', 5, 'コードの可読性を高めるための実践的なテクニックが満載。すべてのエンジニア必読の一冊。', '2024-11-01 10:30:00'),
(1, '佐藤花子', 4, '具体例が豊富でわかりやすい。ただし、初心者には少し難しい部分もあるかも。', '2024-11-15 14:20:00'),
(1, '鈴木一郎', 5, 'チーム開発において必須の知識。この本を読んでからコードレビューの質が上がった。', '2024-12-01 09:15:00');

-- book_id=2（人を動かす）に対するレビュー
INSERT INTO reviews (book_id, reviewer_name, rating, comment, created_at) VALUES
(2, '田中美咲', 5, '人間関係の本質を学べる古典的名著。何度読んでも新しい発見がある。', '2024-10-20 16:45:00'),
(2, '高橋健二', 4, 'ビジネスだけでなく日常生活にも活かせる内容。少し古い事例もあるが本質は変わらない。', '2024-11-10 11:30:00');

-- book_id=3（吾輩は猫である）に対するレビュー
INSERT INTO reviews (book_id, reviewer_name, rating, comment, created_at) VALUES
(3, '伊藤さくら', 5, '猫の視点から人間社会を観察する独特の世界観が面白い。漱石の文学の原点。', '2024-11-25 13:00:00');
```

### テーブル作成SQL

```sql
CREATE TABLE reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'レビューID',
    book_id INT NOT NULL COMMENT '書籍ID',
    reviewer_name VARCHAR(50) NOT NULL COMMENT 'レビュアー名',
    rating TINYINT NOT NULL COMMENT '評価(1-5)',
    comment TEXT NULL COMMENT 'コメント',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '投稿日時',
    INDEX idx_book_id (book_id),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE,
    CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='レビュー情報';
```

---

## 4. データベース作成SQL

### データベース作成

```sql
CREATE DATABASE IF NOT EXISTS training_bookshelf
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE training_bookshelf;
```

---

## 5. テーブル削除SQL（再作成時）

```sql
-- 外部キー制約があるため、依存する順に削除
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS books;
DROP TABLE IF EXISTS categories;
```

---

## 6. 全テーブル作成スクリプト

```sql
-- データベース作成
CREATE DATABASE IF NOT EXISTS training_bookshelf
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE training_bookshelf;

-- categoriesテーブル作成（booksより先に作成）
CREATE TABLE categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'カテゴリID',
    category_name VARCHAR(50) NOT NULL COMMENT 'カテゴリ名'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='カテゴリマスタ';

-- booksテーブル作成
CREATE TABLE books (
    book_id INT AUTO_INCREMENT PRIMARY KEY COMMENT '書籍ID',
    title VARCHAR(100) NOT NULL COMMENT 'タイトル',
    author VARCHAR(50) NOT NULL COMMENT '著者',
    publisher VARCHAR(50) NOT NULL COMMENT '出版社',
    published_date DATE NOT NULL COMMENT '出版日',
    isbn VARCHAR(13) NOT NULL COMMENT 'ISBN',
    category_id INT NOT NULL COMMENT 'カテゴリID',
    price INT NOT NULL COMMENT '価格',
    description TEXT NULL COMMENT '概要',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '作成日時',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新日時',
    UNIQUE KEY idx_isbn (isbn),
    INDEX idx_title (title),
    INDEX idx_author (author),
    INDEX idx_category_id (category_id),
    INDEX idx_published_date (published_date),
    FOREIGN KEY (category_id) REFERENCES categories(category_id),
    CHECK (price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='書籍情報';

-- reviewsテーブル作成
CREATE TABLE reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'レビューID',
    book_id INT NOT NULL COMMENT '書籍ID',
    reviewer_name VARCHAR(50) NOT NULL COMMENT 'レビュアー名',
    rating TINYINT NOT NULL COMMENT '評価(1-5)',
    comment TEXT NULL COMMENT 'コメント',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '投稿日時',
    INDEX idx_book_id (book_id),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE,
    CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='レビュー情報';
```

---

## 7. サンプルデータ投入スクリプト

```sql
USE training_bookshelf;

-- カテゴリマスタ投入（最初に実行）
INSERT INTO categories (category_id, category_name) VALUES
(1, '小説・文学'),
(2, 'ビジネス・経済'),
(3, 'IT・コンピュータ'),
(4, '科学・技術'),
(5, '歴史'),
(6, 'アート・デザイン'),
(7, '料理・グルメ'),
(8, '趣味・実用'),
(9, 'その他');

-- 書籍データ投入（category_idで指定）
INSERT INTO books (title, author, publisher, published_date, isbn, category_id, price, description) VALUES
('リーダブルコード', 'Dustin Boswell', 'オライリージャパン', '2012-06-23', '9784873115658', 3, 2640, 'より良いコードを書くためのシンプルで実践的なテクニック'),
('人を動かす', 'デール・カーネギー', '創元社', '2016-01-26', '9784422100517', 2, 1650, '人間関係の古典として、あらゆる自己啓発本の原点となった不朽の名著'),
('吾輩は猫である', '夏目漱石', '岩波書店', '1990-01-16', '9784003101018', 1, 1056, '猫の視点で人間社会を風刺した夏目漱石のデビュー作'),
('ゼロ秒思考', '赤羽雄二', 'ダイヤモンド社', '2013-12-20', '9784478022207', 2, 1540, 'A4メモ書きで思考力と行動力を高める'),
('イシューからはじめよ', '安宅和人', '英治出版', '2010-11-24', '9784862760852', 2, 1980, '知的生産の「シンプルな本質」'),
('プリンシプル オブ プログラミング', '上田勲', '秀和システム', '2016-03-23', '9784798046143', 3, 2420, '3年目までに身につけたい一生役立つ101の原理原則'),
('達人プログラマー', 'David Thomas', 'オーム社', '2020-11-21', '9784274226298', 3, 3520, 'システム開発の職人から名匠への道'),
('7つの習慣', 'スティーブン・R・コヴィー', 'キングベアー出版', '2013-08-30', '9784863940246', 2, 2420, '人格主義の回復'),
('こころ', '夏目漱石', '岩波書店', '1991-01-16', '9784003101124', 1, 572, '人間の孤独とエゴイズムを描いた名作'),
('ファクトフルネス', 'ハンス・ロスリング', '日経BP', '2019-01-11', '9784822289607', 4, 1980, 'データを基に世界を正しく見る習慣');

-- レビューデータ投入
INSERT INTO reviews (book_id, reviewer_name, rating, comment, created_at) VALUES
-- book_id=1（リーダブルコード）のレビュー
(1, '山田太郎', 5, 'コードの可読性を高めるための実践的なテクニックが満載。すべてのエンジニア必読の一冊。', '2024-11-01 10:30:00'),
(1, '佐藤花子', 4, '具体例が豊富でわかりやすい。ただし、初心者には少し難しい部分もあるかも。', '2024-11-15 14:20:00'),
(1, '鈴木一郎', 5, 'チーム開発において必須の知識。この本を読んでからコードレビューの質が上がった。', '2024-12-01 09:15:00'),

-- book_id=2（人を動かす）のレビュー
(2, '田中美咲', 5, '人間関係の本質を学べる古典的名著。何度読んでも新しい発見がある。', '2024-10-20 16:45:00'),
(2, '高橋健二', 4, 'ビジネスだけでなく日常生活にも活かせる内容。少し古い事例もあるが本質は変わらない。', '2024-11-10 11:30:00'),

-- book_id=3（吾輩は猫である）のレビュー
(3, '伊藤さくら', 5, '猫の視点から人間社会を観察する独特の世界観が面白い。漱石の文学の原点。', '2024-11-25 13:00:00'),
(3, '渡辺誠', 3, '文体が古いので現代人には読みにくいかもしれない。でも一度は読むべき作品。', '2024-12-05 15:20:00'),

-- book_id=4（ゼロ秒思考）のレビュー
(4, '中村あゆみ', 5, 'シンプルだが効果的。A4メモを続けることで思考がクリアになった。', '2024-11-18 10:00:00'),
(4, '小林大輔', 4, '実践しやすいメソッド。ただし継続するには強い意志が必要。', '2024-11-28 14:30:00'),

-- book_id=5（イシューからはじめよ）のレビュー
(5, '加藤みどり', 5, '問題解決の本質を学べる良書。「何に答えを出すべきか」という視点が新鮮。', '2024-10-15 09:45:00'),
(5, '木村拓也', 5, 'コンサル志望者だけでなく、全てのビジネスパーソンに役立つ内容。', '2024-11-05 16:15:00'),

-- book_id=6（プリンシプル オブ プログラミング）のレビュー
(6, '松本和也', 4, 'プログラミングの原理原則が体系的にまとまっている。辞書的に使える。', '2024-11-20 11:20:00'),

-- book_id=7（達人プログラマー）のレビュー
(7, '井上真理', 5, 'プログラミングに対する考え方が変わった。技術者としての哲学を学べる。', '2024-10-28 13:50:00'),
(7, '斉藤隆', 5, '20年以上前の初版から読み継がれる名著。時代を超えた価値がある。', '2024-11-12 10:10:00'),

-- book_id=8（7つの習慣）のレビュー
(8, '橋本由美', 5, '自己啓発書の金字塔。主体性を持つことの重要性を再認識させられた。', '2024-11-08 15:40:00'),
(8, '森田浩二', 4, 'Win-Winの考え方など、今でも色あせない原則が学べる。やや長いが読む価値あり。', '2024-11-22 09:25:00'),

-- book_id=9（こころ）のレビュー
(9, '吉田涼子', 4, '人間の内面を深く掘り下げた作品。「先生」の苦悩が心に残る。', '2024-10-30 14:15:00'),

-- book_id=10（ファクトフルネス）のレビュー
(10, '石川健太', 5, 'データで世界を見る重要性を学んだ。思い込みを正してくれる良書。', '2024-11-16 11:50:00'),
(10, '山口恵子', 5, '楽観的になれる本。世界は思っているよりも良くなっていることがわかる。', '2024-12-03 16:30:00');
```

---

## 8. データ確認クエリ

### 全書籍の一覧取得（平均評価付き）

```sql
SELECT 
    b.book_id,
    b.title,
    b.author,
    c.category_name,
    b.price,
    b.published_date,
    COALESCE(ROUND(AVG(r.rating), 1), 0) AS avg_rating,
    COUNT(r.review_id) AS review_count
FROM books b
INNER JOIN categories c ON b.category_id = c.category_id
LEFT JOIN reviews r ON b.book_id = r.book_id
GROUP BY b.book_id
ORDER BY b.book_id;
```

### 特定書籍の詳細とレビュー取得

```sql
-- 書籍情報（カテゴリ名をJOINして取得）
SELECT b.*, c.category_name FROM books b
INNER JOIN categories c ON b.category_id = c.category_id
WHERE b.book_id = 1;

-- レビュー一覧
SELECT 
    review_id,
    reviewer_name,
    rating,
    comment,
    created_at
FROM reviews
WHERE book_id = 1
ORDER BY created_at DESC;
```

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|------|------|----------|--------|
| 1.0 | 2024-12-15 | 初版作成（books・reviewsテーブル定義） | - |
| 1.1 | 2026-03-27 | レビュー投稿画面（BK11〜BK13）追加に伴う記載整備 | - |
| 1.2 | 2026-03-27 | カテゴリをマスタテーブル（categories）化。booksテーブルのcategoryカラムをcategory_id（FK）に変更 | - |
