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

/**
 * CSVファイルを読み込んで配列で返す（BOM除去、trim付き）
 */
function readCSVAssoc($filepath) {
    if (!file_exists($filepath)) return [];
    $handle = fopen($filepath, 'r');
    if ($handle === false) return [];

    // BOM除去
    $bom = fread($handle, 3);
    if ($bom !== "\xEF\xBB\xBF") rewind($handle);

    $headers = fgetcsv($handle);
    if ($headers === false) {
        fclose($handle);
        return [];
    }
    $headers = array_map(function($h) {
        return trim((string)$h);
    }, $headers);

    $rows = [];
    while (($row = fgetcsv($handle)) !== false) {
        if (count($row) !== count($headers)) continue;
        $item = [];
        foreach ($headers as $i => $h) {
            $item[$h] = trim((string)$row[$i]);
        }
        $rows[] = $item;
    }
    fclose($handle);
    return $rows;
}

function normalizeCarrierKeyServer($value) {
    return strtolower(trim((string)($value ?? '')));
}

function normalizeCountryCodeServer($value) {
    return strtoupper(trim((string)($value ?? '')));
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
        // ---- バリデーション（存在しないサービスNG、存在しない国コード/ゾーンNG、service+zone+weight重複NG）----
        $countries = readCSVAssoc(CSV_COUNTRIES);
        $services = readCSVAssoc(CSV_SERVICES);
        $carrierZones = readCSVAssoc(CSV_CARRIER_ZONES);

        $validCountryCodes = [];
        foreach ($countries as $c) {
            $code = normalizeCountryCodeServer($c['code'] ?? '');
            if ($code !== '') $validCountryCodes[$code] = true;
        }

        // service name -> carrierKey
        $serviceNameToCarrier = [];
        foreach ($services as $s) {
            $name = trim((string)($s['name'] ?? ''));
            $carrier = normalizeCarrierKeyServer($s['carrier'] ?? '');
            if ($name !== '') $serviceNameToCarrier[$name] = $carrier;
        }

        // carrier -> zones(set)
        $carrierToZones = [];
        foreach ($carrierZones as $cz) {
            $carrier = normalizeCarrierKeyServer($cz['carrier'] ?? '');
            $countryCode = normalizeCountryCodeServer($cz['country_code'] ?? '');
            $zone = isset($cz['zone']) ? trim((string)$cz['zone']) : '';
            if ($carrier === '' || $countryCode === '' || $zone === '') continue;
            // 国コードが存在しないものは zone の根拠として使わない
            if (!isset($validCountryCodes[$countryCode])) continue;
            if (!isset($carrierToZones[$carrier])) $carrierToZones[$carrier] = [];
            $carrierToZones[$carrier][$zone] = true;
        }

        $seen = [];
        $duplicates = [];
        $missingServices = [];
        $missingZone = [];

        foreach ($data as $i => $row) {
            $serviceName = trim((string)($row['service'] ?? ''));
            $zone = isset($row['zone']) ? trim((string)$row['zone']) : '';
            $weightRaw = $row['weight'] ?? '';
            $weight = (string)((float)$weightRaw);
            $price = isset($row['price']) ? (string)((int)$row['price']) : '';

            $data[$i] = [
                'service' => $serviceName,
                'zone' => $zone,
                'weight' => $weight,
                'price' => $price
            ];

            if ($serviceName === '' || $zone === '' || $weight === '' || $price === '') {
                $response['error'] = 'service, zone, weight, price は必須です';
                http_response_code(400);
                echo json_encode($response, JSON_UNESCAPED_UNICODE);
                exit;
            }

            $key = $serviceName . '|' . $zone . '|' . $weight;
            if (isset($seen[$key])) $duplicates[$key] = true;
            $seen[$key] = true;

            if (!isset($serviceNameToCarrier[$serviceName])) {
                $missingServices[$serviceName] = true;
                continue;
            }

            $carrier = $serviceNameToCarrier[$serviceName];
            if ($carrier === '' || !isset($carrierToZones[$carrier]) || !isset($carrierToZones[$carrier][$zone])) {
                // そのサービス（=carrier）に対して carrier_zones で成立しない zone はNG（=国コード/ゾーン不正）
                $missingZone[$carrier . '|' . $zone] = true;
            }
        }

        if (!empty($duplicates)) {
            $keys = array_keys($duplicates);
            $response['error'] = 'service,zone,weight が同じ組み合わせが存在します: ' . implode(', ', $keys);
            http_response_code(400);
            echo json_encode($response, JSON_UNESCAPED_UNICODE);
            exit;
        }
        if (!empty($missingServices)) {
            $names = array_keys($missingServices);
            $response['error'] = '存在しないサービスが含まれています（サービス管理に存在しない）: ' . implode(', ', $names);
            http_response_code(400);
            echo json_encode($response, JSON_UNESCAPED_UNICODE);
            exit;
        }
        if (!empty($missingZone)) {
            $pairs = array_keys($missingZone);
            $response['error'] = '存在しないゾーンが含まれています（キャリア別ゾーンに存在しない）: ' . implode(', ', $pairs);
            http_response_code(400);
            echo json_encode($response, JSON_UNESCAPED_UNICODE);
            exit;
        }

        if (writeCSV(CSV_RATES, $data, $headers)) {
            $response['success'] = true;
            $response['message'] = '運賃データを保存しました';
        } else {
            $response['error'] = 'ファイルの書き込みに失敗しました';
            http_response_code(500);
        }
        break;
        
    case 'services':
        $headers = ['id', 'name', 'carrier', 'color', 'description', 'country_codes', 'use_actual_weight'];
        if (writeCSV(CSV_SERVICES, $data, $headers)) {
            $response['success'] = true;
            $response['message'] = 'サービス情報を保存しました';
        } else {
            $response['error'] = 'ファイルの書き込みに失敗しました';
            http_response_code(500);
        }
        break;
        
    case 'countries':
        $headers = ['name', 'code'];
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
        // ---- バリデーション（carrier+country_codeの重複禁止、存在しない国/キャリア禁止）----
        $countries = readCSVAssoc(CSV_COUNTRIES);
        $services = readCSVAssoc(CSV_SERVICES);

        $validCountryCodes = [];
        foreach ($countries as $c) {
            $code = normalizeCountryCodeServer($c['code'] ?? '');
            if ($code !== '') $validCountryCodes[$code] = true;
        }
        $validCarriers = [];
        foreach ($services as $s) {
            $carrier = normalizeCarrierKeyServer($s['carrier'] ?? '');
            if ($carrier !== '') $validCarriers[$carrier] = true;
        }

        $seen = [];
        $duplicates = [];
        $missingCountries = [];
        $missingCarriers = [];

        // 正規化しつつ検証
        foreach ($data as $i => $row) {
            $carrier = normalizeCarrierKeyServer($row['carrier'] ?? '');
            $countryCode = normalizeCountryCodeServer($row['country_code'] ?? '');
            $zone = isset($row['zone']) ? trim((string)$row['zone']) : '';

            $data[$i] = [
                'carrier' => $carrier,
                'country_code' => $countryCode,
                'zone' => $zone
            ];

            if ($carrier === '' || $countryCode === '') {
                $response['error'] = 'carrier と country_code は必須です';
                http_response_code(400);
                echo json_encode($response, JSON_UNESCAPED_UNICODE);
                exit;
            }

            $key = $carrier . '|' . $countryCode;
            if (isset($seen[$key])) {
                $duplicates[$key] = true;
            } else {
                $seen[$key] = true;
            }

            if (!isset($validCountryCodes[$countryCode])) {
                $missingCountries[$countryCode] = true;
            }
            if (!isset($validCarriers[$carrier])) {
                $missingCarriers[$carrier] = true;
            }
        }

        if (!empty($duplicates)) {
            $keys = array_keys($duplicates);
            $response['error'] = 'carrier,country_code が同じ組み合わせが存在します: ' . implode(', ', $keys);
            http_response_code(400);
            echo json_encode($response, JSON_UNESCAPED_UNICODE);
            exit;
        }
        if (!empty($missingCountries)) {
            $codes = array_keys($missingCountries);
            $response['error'] = '存在しない国コードが含まれています: ' . implode(', ', $codes);
            http_response_code(400);
            echo json_encode($response, JSON_UNESCAPED_UNICODE);
            exit;
        }
        if (!empty($missingCarriers)) {
            $carriers = array_keys($missingCarriers);
            $response['error'] = '存在しないキャリアが含まれています: ' . implode(', ', $carriers);
            http_response_code(400);
            echo json_encode($response, JSON_UNESCAPED_UNICODE);
            exit;
        }

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

    case 'boxes':
        $headers = ['key', 'label', 'length_cm', 'width_cm', 'height_cm', 'comment', 'sort'];

        // key重複禁止（小文字で判定）、必須チェック、数値整形
        $seen = [];
        $duplicates = [];
        foreach ($data as $i => $row) {
            $key = strtolower(trim((string)($row['key'] ?? '')));
            $label = trim((string)($row['label'] ?? ''));
            $length = (string)((float)($row['length_cm'] ?? 0));
            $width  = (string)((float)($row['width_cm'] ?? 0));
            $height = (string)((float)($row['height_cm'] ?? 0));
            $comment = trim((string)($row['comment'] ?? ''));
            $sort = (string)((int)($row['sort'] ?? 0));

            $data[$i] = [
                'key' => $key,
                'label' => $label,
                'length_cm' => $length,
                'width_cm' => $width,
                'height_cm' => $height,
                'comment' => $comment,
                'sort' => $sort,
            ];

            if ($key === '' || $label === '') {
                $response['error'] = 'key と label は必須です';
                http_response_code(400);
                echo json_encode($response, JSON_UNESCAPED_UNICODE);
                exit;
            }
            if ((float)$length <= 0 || (float)$width <= 0 || (float)$height <= 0) {
                $response['error'] = 'length_cm / width_cm / height_cm は0より大きい数値を指定してください';
                http_response_code(400);
                echo json_encode($response, JSON_UNESCAPED_UNICODE);
                exit;
            }

            if (isset($seen[$key])) $duplicates[$key] = true;
            $seen[$key] = true;
        }

        if (!empty($duplicates)) {
            $response['error'] = 'key が同じデータが存在します: ' . implode(', ', array_keys($duplicates));
            http_response_code(400);
            echo json_encode($response, JSON_UNESCAPED_UNICODE);
            exit;
        }

        if (writeCSV(CSV_BOXES, $data, $headers)) {
            $response['success'] = true;
            $response['message'] = '箱サイズ設定を保存しました';
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
