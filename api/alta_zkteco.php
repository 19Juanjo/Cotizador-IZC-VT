<?php
/**
 * Alta única del usuario Admin ZKTECO en data/usuarios.json.
 * Abrir una vez: http://pqr.izc.com.co:8183/IZC/api/alta_zkteco.php
 * Después BORRAR este archivo.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$usersFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'usuarios.json';
$pass = 'ZKT3cO.*';

function izc_hash_password($password) {
    $iterations = 100000;
    $salt = random_bytes(16);
    $hash = hash_pbkdf2('sha256', $password, $salt, $iterations, 32, true);
    return 'pbkdf2$' . $iterations . '$' . base64_encode($salt) . '$' . base64_encode($hash);
}

if (!is_file($usersFile)) {
    http_response_code(500);
    echo json_encode(array('ok' => false, 'error' => 'No existe data/usuarios.json'));
    exit;
}

$raw = (string) file_get_contents($usersFile);
$raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
$users = json_decode($raw, true);
if (!is_array($users)) {
    http_response_code(500);
    echo json_encode(array('ok' => false, 'error' => 'usuarios.json no es JSON válido'));
    exit;
}

$idx = -1;
foreach ($users as $i => $u) {
    if (!is_array($u)) {
        continue;
    }
    $nit = strtoupper(preg_replace('/[\s.]/', '', trim((string) (isset($u['nit']) ? $u['nit'] : ''))));
    if ($nit === 'ZKTECO' || $nit === 'ZEBRA') {
        $idx = $i;
        break;
    }
}

$row = array(
    'nit' => 'ZKTECO',
    'nombre' => ($idx >= 0 && !empty($users[$idx]['nombre'])) ? $users[$idx]['nombre'] : 'ZKTeco',
    'role' => 'zkteco',
    'password' => $pass,
    'password_hash' => izc_hash_password($pass),
    'created_at' => ($idx >= 0 && !empty($users[$idx]['created_at'])) ? $users[$idx]['created_at'] : date('c'),
);

if ($idx >= 0) {
    $users[$idx] = array_merge($users[$idx], $row);
    $msg = 'Usuario ZKTECO actualizado. Borra api/alta_zkteco.php';
} else {
    $users[] = $row;
    $msg = 'Usuario ZKTECO creado. Borra api/alta_zkteco.php';
}

$json = json_encode(array_values($users), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
if ($json === false || file_put_contents($usersFile, $json . "\n", LOCK_EX) === false) {
    http_response_code(500);
    echo json_encode(array(
        'ok' => false,
        'error' => 'No se pudo escribir data/usuarios.json (permisos).',
    ));
    exit;
}

echo json_encode(array('ok' => true, 'message' => $msg, 'nit' => 'ZKTECO'));
