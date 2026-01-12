<?php
/**
 * データ取得API
 * GET /api/data.php?type=rates|services|countries|settings
 */

require_once __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

/**
 * CSVファイルを読み込んで配列で返す
 */
function readCSV($filepath) {
    if (!file_exists($filepath)) {
        return [];
    }
    
    $data = [];
    $handle = fopen($filepath, 'r');
    
    if ($handle === false) {
        return [];
    }
    
    // BOM除去
    $bom = fread($handle, 3);
    if ($bom !== "\xEF\xBB\xBF") {
        rewind($handle);
    }
    
    $headers = fgetcsv($handle);
    if ($headers === false) {
        fclose($handle);
        return [];
    }
    
    // ヘッダーのトリム
    $headers = array_map('trim', $headers);
    
    while (($row = fgetcsv($handle)) !== false) {
        if (count($row) === count($headers)) {
            $item = [];
            foreach ($headers as $i => $header) {
                $item[$header] = trim($row[$i]);
            }
            $data[] = $item;
        }
    }
    
    fclose($handle);
    return $data;
}

// リクエストタイプ取得
$type = isset($_GET['type']) ? $_GET['type'] : '';

$response = ['success' => false, 'data' => null, 'error' => null];

switch ($type) {
    case 'rates':
        $data = readCSV(CSV_RATES);
        $response['success'] = true;
        $response['data'] = array_map(function($row) {
            return [
                'service' => $row['service'],
                // zoneはキャリアにより文字列の可能性があるため文字列として扱う
                'zone' => (string)$row['zone'],
                'weight' => (float)$row['weight'],
                'price' => (int)$row['price']
            ];
        }, $data);
        break;
        
    case 'services':
        $data = readCSV(CSV_SERVICES);
        $response['success'] = true;
        $response['data'] = $data;
        break;
        
    case 'countries':
        $data = readCSV(CSV_COUNTRIES);
        $response['success'] = true;
        $response['data'] = array_map(function($row) {
            return [
                'name' => $row['name'],
                'code' => $row['code'],
                'zone' => (int)$row['zone']
            ];
        }, $data);
        break;

    case 'carrier_zones':
        $data = readCSV(CSV_CARRIER_ZONES);
        $response['success'] = true;
        $response['data'] = array_map(function($row) {
            return [
                'carrier' => $row['carrier'],
                'country_code' => strtoupper($row['country_code']),
                'zone' => (string)$row['zone']
            ];
        }, $data);
        break;
        
    case 'settings':
        $data = readCSV(CSV_SETTINGS);
        $settings = [];
        foreach ($data as $row) {
            $settings[$row['key']] = $row['value'];
        }
        $response['success'] = true;
        $response['data'] = $settings;
        break;
        
    case 'all':
        $response['success'] = true;
        $response['data'] = [
            'rates' => array_map(function($row) {
                return [
                    'service' => $row['service'],
                    'zone' => (string)$row['zone'],
                    'weight' => (float)$row['weight'],
                    'price' => (int)$row['price']
                ];
            }, readCSV(CSV_RATES)),
            'services' => readCSV(CSV_SERVICES),
            'countries' => array_map(function($row) {
                return [
                    'name' => $row['name'],
                    'code' => $row['code'],
                    'zone' => (int)$row['zone']
                ];
            }, readCSV(CSV_COUNTRIES)),
            'carrier_zones' => array_map(function($row) {
                return [
                    'carrier' => $row['carrier'],
                    'country_code' => strtoupper($row['country_code']),
                    'zone' => (string)$row['zone']
                ];
            }, readCSV(CSV_CARRIER_ZONES)),
            'settings' => (function() {
                $data = readCSV(CSV_SETTINGS);
                $settings = [];
                foreach ($data as $row) {
                    $settings[$row['key']] = $row['value'];
                }
                return $settings;
            })()
        ];
        break;
        
    default:
        $response['error'] = 'Invalid type parameter';
        http_response_code(400);
}

echo json_encode($response, JSON_UNESCAPED_UNICODE);
