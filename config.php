<?php
/**
 * 設定ファイル
 * 本番環境ではこのファイルのパーミッションを適切に設定してください
 */

// タイムゾーン設定
date_default_timezone_set('Asia/Tokyo');

// エラー表示設定（本番環境では false に変更）
define('DEBUG_MODE', false);

if (DEBUG_MODE) {
    error_reporting(E_ALL);
    ini_set('display_errors', 1);
} else {
    error_reporting(0);
    ini_set('display_errors', 0);
}

// パス設定
define('BASE_PATH', __DIR__);
define('DB_PATH', BASE_PATH . '/DB/');

// セッション設定
define('SESSION_LIFETIME', 3600); // 1時間

// CSVファイルパス
define('CSV_RATES', DB_PATH . 'rates.csv');
define('CSV_SERVICES', DB_PATH . 'services.csv');
define('CSV_COUNTRIES', DB_PATH . 'countries.csv');
define('CSV_CARRIER_ZONES', DB_PATH . 'carrier_zones.csv');
define('CSV_SETTINGS', DB_PATH . 'settings.csv');
define('CSV_AUTH', DB_PATH . 'auth.csv');

// セキュリティ設定
define('CSRF_TOKEN_NAME', 'csrf_token');
