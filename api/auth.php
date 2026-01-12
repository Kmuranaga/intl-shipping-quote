<?php
/**
 * 認証API
 * POST /api/auth.php
 */

require_once __DIR__ . '/../config.php';

session_start();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$response = ['success' => false, 'error' => null];

// POSTリクエストのみ許可
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    $response['error'] = 'Method not allowed';
    http_response_code(405);
    echo json_encode($response);
    exit;
}

// JSONデータ取得
$input = json_decode(file_get_contents('php://input'), true);

$action = isset($input['action']) ? $input['action'] : '';

switch ($action) {
    case 'login':
        $username = isset($input['username']) ? trim($input['username']) : '';
        $password = isset($input['password']) ? $input['password'] : '';
        
        if (empty($username) || empty($password)) {
            $response['error'] = 'ユーザー名とパスワードを入力してください';
            http_response_code(400);
            break;
        }
        
        // 認証情報読み込み
        $authenticated = false;
        if (file_exists(CSV_AUTH)) {
            $handle = fopen(CSV_AUTH, 'r');
            while (($row = fgetcsv($handle)) !== false) {
                if (count($row) >= 2 && $row[0] === $username) {
                    // MD5ハッシュで比較（本番環境ではpassword_hashを推奨）
                    if ($row[1] === md5($password)) {
                        $authenticated = true;
                        break;
                    }
                }
            }
            fclose($handle);
        }
        
        if ($authenticated) {
            // セッション再生成（セッション固定攻撃対策）
            session_regenerate_id(true);
            $_SESSION['authenticated'] = true;
            $_SESSION['username'] = $username;
            $_SESSION['login_time'] = time();
            
            $response['success'] = true;
        } else {
            $response['error'] = 'ユーザー名またはパスワードが正しくありません';
            http_response_code(401);
        }
        break;
        
    case 'logout':
        $_SESSION = [];
        session_destroy();
        $response['success'] = true;
        break;
        
    case 'check':
        if (isset($_SESSION['authenticated']) && $_SESSION['authenticated'] === true) {
            // セッションタイムアウトチェック
            if (time() - $_SESSION['login_time'] > SESSION_LIFETIME) {
                $_SESSION = [];
                session_destroy();
                $response['success'] = false;
                $response['error'] = 'セッションがタイムアウトしました';
            } else {
                $response['success'] = true;
                $response['data'] = ['username' => $_SESSION['username']];
            }
        } else {
            $response['success'] = false;
        }
        break;
        
    default:
        $response['error'] = 'Invalid action';
        http_response_code(400);
}

echo json_encode($response, JSON_UNESCAPED_UNICODE);
