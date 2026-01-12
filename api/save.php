<?php
/**
 * データ保存API
 * POST /api/save.php
 */

require_once __DIR__ . '/../config.php';

session_start();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$response = ['success' => false, 'error' => null];

// 認証チェック
if (!isset($_SESSION['authenticated']) || $_SESSION['authenticated'] !== true) {
    $response['error'] = '認証が必要です';
    http_response_code(401);
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit;
}

// セッションタイムアウトチェック
if (time() - $_SESSION['login_time'] > SESSION_LIFETIME) {
    $_SESSION = [];
    session_destroy();
    $response['error'] = 'セッションがタイムアウトしました';
    http_response_code(401);
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit;
}

// POSTリクエストのみ許可
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    $response['error'] = 'Method not allowed';
    http_response_code(405);
    echo json_encode($response);
    exit;
}

/**
 * 配列をCSVファイルに書き込む
 */
function writeCSV($filepath, $data, $headers) {
    // バックアップ作成
    if (file_exists($filepath)) {
        copy($filepath, $filepath . '.bak');
    }
    
    $handle = fopen($filepath, 'w');
    if ($handle === false) {
        return false;
    }
    
    // BOM付きUTF-8
    fwrite($handle, "\xEF\xBB\xBF");
    
    // ヘッダー書き込み
    fputcsv($handle, $headers);
    
    // データ書き込み
    foreach ($data as $row) {
        $line = [];
        foreach ($headers as $header) {
            $line[] = isset($row[$header]) ? $row[$header] : '';
        }
        fputcsv($handle, $line);
    }
    
    fclose($handle);
    return true;
}

// JSONデータ取得
$input = json_decode(file_get_contents('php://input'), true);

$type = isset($input['type']) ? $input['type'] : '';
$data = isset($input['data']) ? $input['data'] : null;

if ($data === null) {
    $response['error'] = 'データが指定されていません';
    http_response_code(400);
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit;
}

switch ($type) {
    case 'rates':
        $headers = ['service', 'zone', 'weight', 'price'];
        if (writeCSV(CSV_RATES, $data, $headers)) {
            $response['success'] = true;
            $response['message'] = '運賃データを保存しました';
        } else {
            $response['error'] = 'ファイルの書き込みに失敗しました';
            http_response_code(500);
        }
        break;
        
    case 'services':
        $headers = ['id', 'name', 'color', 'description'];
        if (writeCSV(CSV_SERVICES, $data, $headers)) {
            $response['success'] = true;
            $response['message'] = 'サービス情報を保存しました';
        } else {
            $response['error'] = 'ファイルの書き込みに失敗しました';
            http_response_code(500);
        }
        break;
        
    case 'countries':
        $headers = ['name', 'code', 'zone'];
        if (writeCSV(CSV_COUNTRIES, $data, $headers)) {
            $response['success'] = true;
            $response['message'] = '国情報を保存しました';
        } else {
            $response['error'] = 'ファイルの書き込みに失敗しました';
            http_response_code(500);
        }
        break;

    case 'carrier_zones':
        $headers = ['carrier', 'country_code', 'zone'];
        if (writeCSV(CSV_CARRIER_ZONES, $data, $headers)) {
            $response['success'] = true;
            $response['message'] = 'キャリア別ゾーンマッピングを保存しました';
        } else {
            $response['error'] = 'ファイルの書き込みに失敗しました';
            http_response_code(500);
        }
        break;
        
    case 'settings':
        $settingsData = [];
        foreach ($data as $key => $value) {
            $settingsData[] = ['key' => $key, 'value' => $value];
        }
        $headers = ['key', 'value'];
        if (writeCSV(CSV_SETTINGS, $settingsData, $headers)) {
            $response['success'] = true;
            $response['message'] = '設定を保存しました';
        } else {
            $response['error'] = 'ファイルの書き込みに失敗しました';
            http_response_code(500);
        }
        break;
        
    default:
        $response['error'] = 'Invalid type parameter';
        http_response_code(400);
}

echo json_encode($response, JSON_UNESCAPED_UNICODE);
