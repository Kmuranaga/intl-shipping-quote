<?php
/**
 * CSVアップロードAPI
 * POST /api/upload.php
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

// POSTリクエストのみ許可
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    $response['error'] = 'Method not allowed';
    http_response_code(405);
    echo json_encode($response);
    exit;
}

// ファイルアップロードチェック
if (!isset($_FILES['csv']) || $_FILES['csv']['error'] !== UPLOAD_ERR_OK) {
    $response['error'] = 'ファイルのアップロードに失敗しました';
    http_response_code(400);
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit;
}

$type = isset($_POST['type']) ? $_POST['type'] : '';
$file = $_FILES['csv'];
// mode: replace|append（デフォルトはreplace=全置換）
$mode = isset($_POST['mode']) ? strtolower(trim((string)$_POST['mode'])) : 'replace';
if ($mode !== 'append') $mode = 'replace';

// ファイルタイプチェック
$allowedMimes = ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/csv'];
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mimeType = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

// 拡張子チェック
$ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
if ($ext !== 'csv') {
    $response['error'] = 'CSVファイルのみアップロード可能です';
    http_response_code(400);
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit;
}

// 保存先決定
switch ($type) {
    case 'rates':
        $targetPath = CSV_RATES;
        $requiredHeaders = ['service', 'zone', 'weight', 'price'];
        break;
    case 'services':
        $targetPath = CSV_SERVICES;
        $requiredHeaders = ['id', 'name', 'color', 'description'];
        break;
    case 'countries':
        $targetPath = CSV_COUNTRIES;
        $requiredHeaders = ['name', 'code', 'zone'];
        break;
    case 'carrier_zones':
        $targetPath = CSV_CARRIER_ZONES;
        $requiredHeaders = ['carrier', 'country_code', 'zone'];
        break;
    default:
        $response['error'] = '無効なタイプです';
        http_response_code(400);
        echo json_encode($response, JSON_UNESCAPED_UNICODE);
        exit;
}

/**
 * CSVを「ヘッダー小文字化」して連想配列で読み込む
 * @return array{0: string[], 1: array<int, array<string, string>>} [headersLower, rows]
 */
function readCSVLowerAssoc($filepath) {
    $handle = fopen($filepath, 'r');
    if ($handle === false) return [[], []];

    // BOM除去
    $bom = fread($handle, 3);
    if ($bom !== "\xEF\xBB\xBF") rewind($handle);

    $headers = fgetcsv($handle);
    if ($headers === false) {
        fclose($handle);
        return [[], []];
    }
    $headersLower = array_map(function($h) {
        return strtolower(trim((string)$h));
    }, $headers);

    $rows = [];
    while (($row = fgetcsv($handle)) !== false) {
        if (count($row) !== count($headersLower)) continue;
        $item = [];
        foreach ($headersLower as $i => $h) {
            $item[$h] = trim((string)$row[$i]);
        }
        $rows[] = $item;
    }
    fclose($handle);
    return [$headersLower, $rows];
}

/**
 * 配列をCSVに書き込む（BOM付きUTF-8）
 */
function writeCSVWithHeaders($filepath, $headers, $rows) {
    $handle = fopen($filepath, 'w');
    if ($handle === false) return false;

    fwrite($handle, "\xEF\xBB\xBF");
    fputcsv($handle, $headers);
    foreach ($rows as $row) {
        $line = [];
        foreach ($headers as $h) {
            $line[] = isset($row[$h]) ? $row[$h] : '';
        }
        fputcsv($handle, $line);
    }
    fclose($handle);
    return true;
}

// CSVファイル検証
$handle = fopen($file['tmp_name'], 'r');
if ($handle === false) {
    $response['error'] = 'ファイルを開けませんでした';
    http_response_code(500);
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit;
}

// BOM除去
$bom = fread($handle, 3);
if ($bom !== "\xEF\xBB\xBF") {
    rewind($handle);
}

// ヘッダー検証
$headers = fgetcsv($handle);
if ($headers === false) {
    fclose($handle);
    $response['error'] = 'CSVファイルが空です';
    http_response_code(400);
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit;
}

$headers = array_map('trim', $headers);
$headers = array_map('strtolower', $headers);

foreach ($requiredHeaders as $required) {
    if (!in_array(strtolower($required), $headers)) {
        fclose($handle);
        $response['error'] = "必須カラム '{$required}' がありません";
        http_response_code(400);
        echo json_encode($response, JSON_UNESCAPED_UNICODE);
        exit;
    }
}

// 行数カウント
$rowCount = 0;
while (fgetcsv($handle) !== false) {
    $rowCount++;
}
fclose($handle);

// バックアップ作成
if (file_exists($targetPath)) {
    $backupPath = $targetPath . '.' . date('YmdHis') . '.bak';
    copy($targetPath, $backupPath);
}

if ($mode === 'append') {
    // 既存 + アップロードをマージ（同一キーはアップロード側で上書き）
    [$uploadHeaders, $uploadRows] = readCSVLowerAssoc($file['tmp_name']);
    if (empty($uploadHeaders)) {
        $response['error'] = 'CSVファイルが空です';
        http_response_code(400);
        echo json_encode($response, JSON_UNESCAPED_UNICODE);
        exit;
    }

    $existingRows = [];
    if (file_exists($targetPath)) {
        [, $existingRows] = readCSVLowerAssoc($targetPath);
    }

    $mergedMap = [];
    $normalizeRow = function($row) use ($type) {
        $r = $row;
        // 共通トリム
        foreach ($r as $k => $v) $r[$k] = trim((string)$v);

        if ($type === 'rates') {
            $r['service'] = $r['service'] ?? '';
            $r['zone'] = $r['zone'] ?? '';
            $r['weight'] = isset($r['weight']) ? (string)((float)$r['weight']) : '';
            $r['price'] = isset($r['price']) ? (string)((int)$r['price']) : '';
        } elseif ($type === 'countries') {
            $r['name'] = $r['name'] ?? '';
            $r['code'] = strtoupper($r['code'] ?? '');
            $r['zone'] = isset($r['zone']) ? (string)((int)$r['zone']) : '';
        } elseif ($type === 'services') {
            $r['id'] = $r['id'] ?? '';
            $r['name'] = $r['name'] ?? '';
            $r['color'] = $r['color'] ?? '';
            $r['description'] = $r['description'] ?? '';
        } elseif ($type === 'carrier_zones') {
            $r['carrier'] = strtolower($r['carrier'] ?? '');
            $r['country_code'] = strtoupper($r['country_code'] ?? '');
            $r['zone'] = $r['zone'] ?? '';
        }
        return $r;
    };

    $keyOf = function($row) use ($type) {
        if ($type === 'rates') {
            return ($row['service'] ?? '') . '|' . ($row['zone'] ?? '') . '|' . ($row['weight'] ?? '');
        }
        if ($type === 'countries') {
            return ($row['code'] ?? '');
        }
        if ($type === 'services') {
            return ($row['id'] ?? '');
        }
        if ($type === 'carrier_zones') {
            return ($row['carrier'] ?? '') . '|' . ($row['country_code'] ?? '');
        }
        return '';
    };

    foreach ($existingRows as $r) {
        $nr = $normalizeRow($r);
        $k = $keyOf($nr);
        if ($k === '') continue;
        $mergedMap[$k] = $nr;
    }
    foreach ($uploadRows as $r) {
        $nr = $normalizeRow($r);
        $k = $keyOf($nr);
        if ($k === '') continue;
        $mergedMap[$k] = $nr;
    }

    $mergedRows = array_values($mergedMap);

    // 書き込み（ヘッダーは必須カラム順）
    $headersCanonical = $requiredHeaders;
    if (writeCSVWithHeaders($targetPath, $headersCanonical, $mergedRows)) {
        $response['success'] = true;
        $response['message'] = "{$rowCount}件を追加（同一キーは上書き）しました";
        $response['count'] = $rowCount;
        $response['total'] = count($mergedRows);
    } else {
        $response['error'] = 'ファイルの書き込みに失敗しました';
        http_response_code(500);
    }
} else {
    // 全置換（従来通り）
    if (move_uploaded_file($file['tmp_name'], $targetPath)) {
        $response['success'] = true;
        $response['message'] = "{$rowCount}件のデータをアップロードしました";
        $response['count'] = $rowCount;
    } else {
        $response['error'] = 'ファイルの保存に失敗しました';
        http_response_code(500);
    }
}

echo json_encode($response, JSON_UNESCAPED_UNICODE);
