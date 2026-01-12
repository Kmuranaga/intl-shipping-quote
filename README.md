# 国際送料見積もりツール

## ディレクトリ構成

```
tool/
├── index.html          # ユーザー向けメイン画面
├── admin.html          # 管理画面
├── config.php          # 設定ファイル
├── .htaccess           # Apache設定（セキュリティ）
├── api/
│   ├── data.php        # データ取得API
│   ├── auth.php        # 認証API
│   ├── save.php        # データ保存API
│   └── upload.php      # CSVアップロードAPI
├── js/
│   ├── app.js          # メイン画面用JavaScript
│   └── admin.js        # 管理画面用JavaScript
└── DB/
    ├── .htaccess       # アクセス禁止設定
    ├── rates.csv       # 運賃データ
    ├── services.csv    # サービス一覧
    ├── countries.csv   # 国情報
    ├── settings.csv    # サイト設定
    └── auth.csv        # 認証情報
```

## セットアップ手順

### 1. サーバーにアップロード
FTPまたはファイルマネージャーで全ファイルをアップロード

### 2. パーミッション設定
```bash
# DBディレクトリに書き込み権限を付与
chmod 755 DB/
chmod 644 DB/*.csv
```

### 3. 管理者パスワードの変更
`DB/auth.csv` を編集:
```
admin,新しいパスワードのMD5ハッシュ
```

MD5ハッシュの生成方法:
- オンラインツール: https://www.md5hashgenerator.com/
- PHP: `echo md5('新しいパスワード');`

### 4. 動作確認
- ユーザー画面: `https://your-domain.com/tool/`
- 管理画面: `https://your-domain.com/tool/admin.html`

## 初期ログイン情報

- ユーザー名: `admin`
- パスワード: `password`

**※本番公開前に必ず変更してください**

## 機能一覧

### ユーザー向け機能
- 国検索（プルダウン）
- 重量・サイズ入力
- 容積重量自動計算
- 複数キャリア料金一括表示

### 管理機能
- 運賃データのCSVアップロード/編集
- 配送サービスの追加/編集/削除
- 国の管理
- サイト文言の編集

## 必要要件

- PHP 7.4以上
- Apache（mod_rewrite有効）
- または Nginx

## Nginx設定例

```nginx
location /tool/DB/ {
    deny all;
    return 403;
}

location ~ /tool/config\.php$ {
    deny all;
    return 403;
}
```

## トラブルシューティング

### CSVが読み込めない
- ファイルのエンコーディングがUTF-8か確認
- BOM付きUTF-8を推奨

### 保存ができない
- DBディレクトリの書き込み権限を確認
- PHPのエラーログを確認

### 文字化けする
- CSVファイルをUTF-8で保存し直す
- Excelの場合は「CSV UTF-8」形式で保存

## ライセンス

MIT License
