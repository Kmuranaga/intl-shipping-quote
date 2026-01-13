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
        $requiredHeaders = ['id', 'name', 'carrier', 'color', 'description'];
        break;
    case 'countries':
        $targetPath = CSV_COUNTRIES;
        $requiredHeaders = ['name', 'code'];
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

function normalizeCarrierKeyServer($value) {
    return strtolower(trim((string)($value ?? '')));
}

function normalizeCountryCodeServer($value) {
    return strtoupper(trim((string)($value ?? '')));
}

/**
 * carrier_zones の行を正規化して返す（必須キーは空文字になり得る）
 * @return array{carrier:string,country_code:string,zone:string}
 */
function normalizeCarrierZonesRow($row) {
    return [
        'carrier' => normalizeCarrierKeyServer($row['carrier'] ?? ''),
        'country_code' => normalizeCountryCodeServer($row['country_code'] ?? ''),
        'zone' => trim((string)($row['zone'] ?? '')),
    ];
}

/**
 * carrier_zones バリデーション
 * - carrier,country_code の重複（ファイル内/既存との重複）を禁止
 * - 存在しない国コード/キャリアを禁止
 * @param array<int, array<string,string>> $rowsLowerAssoc
 * @param array<int, array<string,string>> $existingRowsLowerAssoc
 * @return array{ok:bool,error:?string,normalized:array<int,array{carrier:string,country_code:string,zone:string}>}
 */
function validateCarrierZonesRows($rowsLowerAssoc, $existingRowsLowerAssoc) {
    // 有効国コード
    [, $countries] = readCSVLowerAssoc(CSV_COUNTRIES);
    $validCountryCodes = [];
    foreach ($countries as $c) {
        $code = normalizeCountryCodeServer($c['code'] ?? '');
        if ($code !== '') $validCountryCodes[$code] = true;
    }

    // 有効キャリア（services.csv の carrier）
    [, $services] = readCSVLowerAssoc(CSV_SERVICES);
    $validCarriers = [];
    foreach ($services as $s) {
        $carrier = normalizeCarrierKeyServer($s['carrier'] ?? '');
        if ($carrier !== '') $validCarriers[$carrier] = true;
    }

    // 既存キー集合（carrier|country_code）
    $existingKeys = [];
    foreach ($existingRowsLowerAssoc as $r) {
        $nr = normalizeCarrierZonesRow($r);
        if ($nr['carrier'] === '' || $nr['country_code'] === '') continue;
        $existingKeys[$nr['carrier'] . '|' . $nr['country_code']] = true;
    }

    $seen = [];
    $duplicates = [];
    $missingCountries = [];
    $missingCarriers = [];
    $normalized = [];

    foreach ($rowsLowerAssoc as $row) {
        $nr = normalizeCarrierZonesRow($row);
        $normalized[] = $nr;

        if ($nr['carrier'] === '' || $nr['country_code'] === '') {
            return ['ok' => false, 'error' => 'carrier と country_code は必須です', 'normalized' => []];
        }

        $key = $nr['carrier'] . '|' . $nr['country_code'];
        if (isset($seen[$key])) $duplicates[$key] = true;
        $seen[$key] = true;

        if (isset($existingKeys[$key])) $duplicates[$key] = true;

        if (!isset($validCountryCodes[$nr['country_code']])) $missingCountries[$nr['country_code']] = true;
        if (!isset($validCarriers[$nr['carrier']])) $missingCarriers[$nr['carrier']] = true;
    }

    if (!empty($duplicates)) {
        $keys = array_keys($duplicates);
        return ['ok' => false, 'error' => 'carrier,country_code が同じ組み合わせが存在します: ' . implode(', ', $keys), 'normalized' => []];
    }
    if (!empty($missingCountries)) {
        $codes = array_keys($missingCountries);
        return ['ok' => false, 'error' => '存在しない国コードが含まれています: ' . implode(', ', $codes), 'normalized' => []];
    }
    if (!empty($missingCarriers)) {
        $carriers = array_keys($missingCarriers);
        return ['ok' => false, 'error' => '存在しないキャリアが含まれています: ' . implode(', ', $carriers), 'normalized' => []];
    }

    return ['ok' => true, 'error' => null, 'normalized' => $normalized];
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
        } elseif ($type === 'services') {
            $r['id'] = $r['id'] ?? '';
            $r['name'] = $r['name'] ?? '';
            $r['carrier'] = strtolower($r['carrier'] ?? '');
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

    // carrier_zones は「同一キー上書き」ではなく「重複を禁止」
    if ($type === 'carrier_zones') {
        $v = validateCarrierZonesRows($uploadRows, $existingRows);
        if (!$v['ok']) {
            $response['error'] = $v['error'] ?: 'バリデーションエラー';
            http_response_code(400);
            echo json_encode($response, JSON_UNESCAPED_UNICODE);
            exit;
        }
        // 既存 + 追加（キー重複はvalidateで弾いている）
        $mergedRows = [];
        foreach ($existingRows as $r) $mergedRows[] = $normalizeRow($r);
        foreach ($v['normalized'] as $nr) $mergedRows[] = $nr;
    } else {
        // 既存 + アップロードをマージ（同一キーはアップロード側で上書き）
        $mergedMap = [];
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
    }

    // 書き込み（ヘッダーは必須カラム順）
    $headersCanonical = $requiredHeaders;
    if (writeCSVWithHeaders($targetPath, $headersCanonical, $mergedRows)) {
        $response['success'] = true;
        $response['message'] = $type === 'carrier_zones'
            ? "{$rowCount}件を追加しました"
            : "{$rowCount}件を追加（同一キーは上書き）しました";
        $response['count'] = $rowCount;
        $response['total'] = count($mergedRows);
    } else {
        $response['error'] = 'ファイルの書き込みに失敗しました';
        http_response_code(500);
    }
} else {
    // 全置換（従来通り）
    if ($type === 'carrier_zones') {
        // carrier_zones は全置換でも内容検証する
        [, $uploadRows] = readCSVLowerAssoc($file['tmp_name']);
        $v = validateCarrierZonesRows($uploadRows, []); // 既存は無関係（全置換）
        if (!$v['ok']) {
            $response['error'] = $v['error'] ?: 'バリデーションエラー';
            http_response_code(400);
            echo json_encode($response, JSON_UNESCAPED_UNICODE);
            exit;
        }
        if (writeCSVWithHeaders($targetPath, $requiredHeaders, $v['normalized'])) {
            $response['success'] = true;
            $response['message'] = "{$rowCount}件のデータをアップロードしました";
            $response['count'] = $rowCount;
        } else {
            $response['error'] = 'ファイルの書き込みに失敗しました';
            http_response_code(500);
        }
    } else {
        if (move_uploaded_file($file['tmp_name'], $targetPath)) {
            $response['success'] = true;
            $response['message'] = "{$rowCount}件のデータをアップロードしました";
            $response['count'] = $rowCount;
        } else {
            $response['error'] = 'ファイルの保存に失敗しました';
            http_response_code(500);
        }
    }
}

echo json_encode($response, JSON_UNESCAPED_UNICODE);
