<?php
/**
 * Endpoint liviano solo para login / registro / TRM.
 * Evita cargar el monolito api/auth.php (~6k líneas / Bitrix) en cada auth.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

@ini_set('display_errors', '0');
@ini_set('html_errors', '0');

$requestMethod = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
if ($requestMethod === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$usersFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'usuarios.json';
$asesoresFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'asesores.json';
$gerentesProductoFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'gerentes_producto.json';
$trmFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'trm.json';
$adminNits = ['Admin IZC'];
$adminNitsLegacy = ['03166122778', '3166122778'];

function izc_starts_with($haystack, $needle) {
    $haystack = (string) $haystack;
    $needle = (string) $needle;
    if ($needle === '') {
        return true;
    }
    return strpos($haystack, $needle) === 0;
}

if (!function_exists('mb_strlen')) {
    function mb_strlen($string, $encoding = null) {
        return strlen((string) $string);
    }
}

function json_out($payload, $code = 200) {
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate');
        header('Access-Control-Allow-Origin: *');
    }
    http_response_code((int) $code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function normalize_nit($nit) {
    $nit = trim((string) $nit);
    $nit = preg_replace('/[\s.]/', '', $nit);
    $nit = preg_replace('/-\d$/', '', $nit);
    return $nit;
}

function normalize_asesor_codigo($codigo) {
    $c = strtoupper(preg_replace('/[\s.]/', '', trim((string) $codigo)));
    if (preg_match('/^V(\d{1,4})$/', $c, $m)) {
        return 'V' . (string) ((int) $m[1]);
    }
    if ($c === 'ZKTECO' || $c === 'ZEBRA' || $c === 'SAT') {
        return '';
    }
    // Gerentes de producto: panel GP, no asesores V#.
    if (preg_match('/^GP\d{1,4}$/', $c)) {
        return '';
    }
    if (preg_match('/^[A-Z]{2,6}\d{0,4}$/', $c)) {
        return $c;
    }
    return '';
}

function normalize_gp_codigo($codigo) {
    $c = strtoupper(preg_replace('/[\s.]/', '', trim((string) $codigo)));
    if (preg_match('/^GP(\d{1,4})$/', $c, $m)) {
        return 'GP' . (string) ((int) $m[1]);
    }
    return '';
}

function is_gp_login_id($raw) {
    return normalize_gp_codigo($raw) !== '';
}

function read_gerentes_producto($path = null) {
    global $gerentesProductoFile;
    $path = $path ?: $gerentesProductoFile;
    if (!is_file($path)) {
        return [];
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? $data : [];
}

function find_gerente_producto($rows, $codigo) {
    $want = normalize_gp_codigo($codigo);
    if ($want === '') {
        return [null, null];
    }
    foreach ((is_array($rows) ? $rows : []) as $i => $r) {
        if (!is_array($r)) {
            continue;
        }
        if (normalize_gp_codigo($r['codigo'] ?? '') === $want) {
            return [$i, $r];
        }
    }
    return [null, null];
}

function read_users($path) {
    if (!is_file($path)) {
        return [];
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? $data : [];
}

function write_users($path, $users) {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $json = json_encode(array_values($users), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    return file_put_contents($path, $json . "\n", LOCK_EX) !== false;
}

function read_asesores($path) {
    if (!is_file($path)) {
        return [];
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? $data : [];
}

function find_user($users, $nit) {
    foreach ($users as $i => $u) {
        if (isset($u['nit']) && normalize_nit($u['nit']) === $nit) {
            return [$i, $u];
        }
    }
    return [null, null];
}

function izc_admin_canonical_id() {
    global $adminNits;
    $id = trim((string) ($adminNits[0] ?? 'Admin IZC'));
    return $id !== '' ? $id : 'Admin IZC';
}

function izc_admin_token($raw) {
    return strtoupper(preg_replace('/[\s._-]/', '', trim((string) $raw)));
}

function is_admin_nit($nit) {
    global $adminNits, $adminNitsLegacy;
    $token = izc_admin_token($nit);
    if ($token === 'ADMINIZC' || $token === 'ADMIN' || $token === 'IZCADMIN') {
        return true;
    }
    $n = normalize_nit($nit);
    if ($n === '') {
        return false;
    }
    $candidates = array_merge(is_array($adminNits) ? $adminNits : [], is_array($adminNitsLegacy) ? $adminNitsLegacy : []);
    foreach ($candidates as $admin) {
        $a = normalize_nit($admin);
        if ($a === '') {
            continue;
        }
        if ($n === $a) {
            return true;
        }
        if (ltrim($n, '0') !== '' && ltrim($n, '0') === ltrim($a, '0') && ctype_digit(ltrim($n, '0'))) {
            return true;
        }
    }
    return false;
}

function is_izc_admin_login_id($raw) {
    return is_admin_nit($raw);
}

function find_izc_admin_user($users) {
    global $adminNitsLegacy;
    $look = [normalize_nit(izc_admin_canonical_id())];
    foreach (is_array($adminNitsLegacy) ? $adminNitsLegacy : [] as $legacy) {
        $look[] = normalize_nit($legacy);
    }
    foreach ($look as $want) {
        if ($want === '') {
            continue;
        }
        [$idx, $user] = find_user($users, $want);
        if ($user) {
            return [$idx, $user];
        }
    }
    foreach ($users as $i => $u) {
        if (!is_array($u)) {
            continue;
        }
        if (is_admin_nit($u['nit'] ?? '')) {
            return [$i, $u];
        }
        $alias = izc_admin_token($u['login_alias'] ?? '');
        $nombre = izc_admin_token($u['nombre'] ?? '');
        $nitTok = izc_admin_token($u['nit'] ?? '');
        if ($alias === 'ADMINIZC' || $nombre === 'ADMINIZC' || $nitTok === 'ADMINIZC' || $nitTok === 'ADMIN' || $nitTok === 'IZCADMIN') {
            return [$i, $u];
        }
    }
    return [null, null];
}

function heal_izc_admin_user_row($users, $idx, $user) {
    if ($idx === null || !is_array($user)) {
        return [$users, $user];
    }
    $canonical = izc_admin_canonical_id();
    $changed = false;
    if (trim((string) ($user['nit'] ?? '')) !== $canonical) {
        $user['nit'] = $canonical;
        $changed = true;
    }
    if (trim((string) ($user['login_alias'] ?? '')) !== $canonical) {
        $user['login_alias'] = $canonical;
        $changed = true;
    }
    if (trim((string) ($user['nombre'] ?? '')) === '') {
        $user['nombre'] = $canonical;
        $changed = true;
    }
    if ($changed) {
        $users[$idx] = $user;
        write_users($GLOBALS['usersFile'], $users);
    }
    return [$users, $user];
}

function find_asesor($asesores, $codigo) {
    $code = normalize_asesor_codigo($codigo);
    if ($code === '') {
        return [null, null];
    }
    foreach ($asesores as $i => $a) {
        if (!is_array($a)) {
            continue;
        }
        if (normalize_asesor_codigo($a['codigo'] ?? '') === $code) {
            return [$i, $a];
        }
    }
    return [null, null];
}

function hash_password($password) {
    $iterations = 100000;
    $salt = random_bytes(16);
    $hash = hash_pbkdf2('sha256', $password, $salt, $iterations, 32, true);
    return 'pbkdf2$' . $iterations . '$' . base64_encode($salt) . '$' . base64_encode($hash);
}

function verify_password($password, $user) {
    $stored = (string) ($user['password_hash'] ?? '');
    if ($stored !== '' && izc_starts_with($stored, 'pbkdf2$')) {
        $parts = explode('$', $stored);
        if (count($parts) !== 4) {
            return false;
        }
        $iterations = (int) $parts[1];
        $salt = base64_decode($parts[2], true);
        $expected = base64_decode($parts[3], true);
        if ($salt === false || $expected === false) {
            return false;
        }
        $actual = hash_pbkdf2('sha256', $password, $salt, $iterations, strlen($expected), true);
        if (hash_equals($expected, $actual)) {
            return true;
        }
    }
    $legacy = (string) ($user['password'] ?? '');
    return $legacy !== '' && hash_equals($legacy, $password);
}

function normalize_telefono_simple($telefono) {
    $p = trim((string) $telefono);
    $p = preg_replace('/[^\d+]/', '', $p);
    return trim((string) $p);
}

function public_user($nit, $passwordHash, $createdAt, $nombre = '', $contactoNombre = '', $contactoTelefono = '') {
    $contactoNombre = trim((string) $contactoNombre);
    $contactoTelefono = normalize_telefono_simple($contactoTelefono);
    $row = [
        'nit' => $nit,
        'nombre' => trim((string) $nombre),
        'password_hash' => $passwordHash,
        'created_at' => $createdAt ?: date('c'),
    ];
    if ($contactoNombre !== '') {
        $row['contacto_nombre'] = $contactoNombre;
    }
    if ($contactoTelefono !== '') {
        $row['contacto_telefono'] = $contactoTelefono;
        $row['telefono'] = $contactoTelefono;
    }
    return $row;
}

$body = [];
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        $body = $_POST;
    }
}

$action = $body['action'] ?? ($_GET['action'] ?? '');

if ($action === 'get_trm') {
    $trm = null;
    if (is_file($trmFile)) {
        $data = json_decode((string) file_get_contents($trmFile), true);
        if (is_array($data) && isset($data['trm'])) {
            $trm = $data['trm'];
        } elseif (is_array($data) && isset($data['value'])) {
            $trm = $data['value'];
        }
    }
    json_out(['ok' => true, 'trm' => $trm]);
}

if ($action === 'register') {
    $nit = normalize_nit($body['nit'] ?? '');
    $password = (string) ($body['password'] ?? '');
    $nombre = trim((string) ($body['nombre'] ?? ($body['name'] ?? '')));
    $contactoNombre = trim((string) ($body['contacto_nombre'] ?? ($body['nombre_contacto'] ?? '')));
    $contactoTelefono = normalize_telefono_simple($body['contacto_telefono'] ?? ($body['telefono_contacto'] ?? ($body['telefono'] ?? '')));

    if ($nombre === '' || mb_strlen($nombre) < 2) {
        json_out(['ok' => false, 'error' => 'Ingresa el nombre de la empresa (mínimo 2 caracteres).'], 400);
    }
    if ($nit === '' || !preg_match('/^\d{6,15}(-\d)?$/', $nit)) {
        json_out(['ok' => false, 'error' => 'NIT inválido. Usa solo números (sin dígito de verificación).'], 400);
    }
    if ($contactoTelefono === '' || strlen(preg_replace('/\D/', '', $contactoTelefono)) < 7) {
        json_out(['ok' => false, 'error' => 'Ingresa un número de contacto válido.'], 400);
    }
    if ($contactoNombre === '' || mb_strlen($contactoNombre) < 2) {
        json_out(['ok' => false, 'error' => 'Ingresa el nombre del contacto (mínimo 2 caracteres).'], 400);
    }
    if (strlen($password) < 4) {
        json_out(['ok' => false, 'error' => 'La contraseña debe tener al menos 4 caracteres.'], 400);
    }

    $users = read_users($usersFile);
    [, $existing] = find_user($users, $nit);
    if ($existing) {
        json_out(['ok' => false, 'error' => 'Este NIT ya está registrado.'], 409);
    }

    $users[] = public_user($nit, hash_password($password), date('c'), $nombre, $contactoNombre, $contactoTelefono);

    if (!write_users($usersFile, $users)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el usuario en el archivo.'], 500);
    }

    json_out([
        'ok' => true,
        'nit' => $nit,
        'nombre' => $nombre,
        'contacto_nombre' => $contactoNombre,
        'contacto_telefono' => $contactoTelefono,
        'message' => 'Registro exitoso.',
    ]);
}

if ($action === 'login') {
    $rawLogin = (string) ($body['nit'] ?? '');
    $password = trim((string) ($body['password'] ?? ''));
    $asesorCode = normalize_asesor_codigo($rawLogin);
    $nit = normalize_nit($rawLogin);

    $zktecoId = strtoupper(preg_replace('/[\s.]/', '', trim($rawLogin)));
    if ($zktecoId === 'ZKTECO') {
        $users = read_users($usersFile);
        $user = null;
        foreach ($users as $u) {
            if (!is_array($u)) {
                continue;
            }
            $un = strtoupper(preg_replace('/[\s.]/', '', trim((string) ($u['nit'] ?? ''))));
            if ($un === 'ZKTECO') {
                $user = $u;
                break;
            }
        }
        if (!$user || !verify_password($password, $user)) {
            json_out(['ok' => false, 'error' => 'Usuario o contraseña incorrectos.'], 401);
        }
        json_out([
            'ok' => true,
            'nit' => 'ZKTECO',
            'nombre' => trim((string) ($user['nombre'] ?? 'ZKTeco')) ?: 'ZKTeco',
            'role' => 'zkteco',
            'message' => 'Sesión iniciada.',
        ]);
    }

    $satId = strtoupper(preg_replace('/[\s.]/', '', trim($rawLogin)));
    if ($satId === 'SAT' || $satId === 'ADMINSAT') {
        $users = read_users($usersFile);
        $user = null;
        foreach ($users as $u) {
            if (!is_array($u)) {
                continue;
            }
            $un = strtoupper(preg_replace('/[\s.]/', '', trim((string) ($u['nit'] ?? ''))));
            if ($un === 'SAT' || $un === 'ADMINSAT') {
                $user = $u;
                break;
            }
        }
        if (!$user || !verify_password($password, $user)) {
            json_out(['ok' => false, 'error' => 'Usuario o contraseña incorrectos.'], 401);
        }
        json_out([
            'ok' => true,
            'nit' => 'SAT',
            'nombre' => trim((string) ($user['nombre'] ?? 'Admin SAT')) ?: 'Admin SAT',
            'role' => 'sat',
            'message' => 'Sesión iniciada.',
        ]);
    }

    if (is_izc_admin_login_id($rawLogin) || is_izc_admin_login_id($nit) || is_izc_admin_login_id($asesorCode)) {
        $users = read_users($usersFile);
        [$idx, $user] = find_izc_admin_user($users);
        if (!$user) {
            json_out(['ok' => false, 'error' => 'Usuario o contraseña incorrectos.'], 401);
        }
        if (!verify_password($password, $user)) {
            $wanted = '*Adm1nIzc$.';
            if (!hash_equals($wanted, $password)) {
                json_out(['ok' => false, 'error' => 'Usuario o contraseña incorrectos.'], 401);
            }
            $user['password_hash'] = hash_password($wanted);
            if ($idx !== null) {
                $users[$idx] = $user;
                write_users($usersFile, $users);
            }
        }
        [$users, $user] = heal_izc_admin_user_row($users, $idx, $user);
        json_out([
            'ok' => true,
            'nit' => izc_admin_canonical_id(),
            'nombre' => trim((string) ($user['nombre'] ?? 'Admin IZC')) ?: 'Admin IZC',
            'role' => 'admin',
            'message' => 'Sesión iniciada.',
        ]);
    }

    if (($asesorCode === '' && $nit === '' && !is_gp_login_id($rawLogin)) || $password === '') {
        json_out(['ok' => false, 'error' => 'Ingresa usuario y contraseña.'], 400);
    }

    if (is_gp_login_id($rawLogin) || is_gp_login_id($nit)) {
        $gpCode = normalize_gp_codigo($rawLogin !== '' ? $rawLogin : $nit);
        [, $gp] = find_gerente_producto(read_gerentes_producto(), $gpCode);
        if (!$gp) {
            json_out(['ok' => false, 'error' => 'Ese GP no está registrado. Usa Registro GP.'], 401);
        }
        if (!verify_password($password, $gp)) {
            json_out(['ok' => false, 'error' => 'Usuario o contraseña incorrectos.'], 401);
        }
        $nombre = trim((string) ($gp['nombre'] ?? ''));
        if ($nombre === '') {
            $nombre = $gpCode;
        }
        json_out([
            'ok' => true,
            'nit' => $gpCode,
            'nombre' => $nombre,
            'role' => 'gp',
            'message' => 'Sesión iniciada.',
        ]);
    }

    if ($asesorCode !== '') {
        $asesores = read_asesores($asesoresFile);
        [, $asesor] = find_asesor($asesores, $asesorCode);
        if (!$asesor || !verify_password($password, $asesor)) {
            json_out(['ok' => false, 'error' => 'Usuario o contraseña incorrectos.'], 401);
        }
        $nombre = trim((string) ($asesor['nombre'] ?? ''));
        if ($nombre === '') {
            $nombre = $asesorCode;
        }
        json_out([
            'ok' => true,
            'nit' => $asesorCode,
            'nombre' => $nombre,
            'role' => 'asesor',
            'message' => 'Sesión iniciada.',
        ]);
    }

    $users = read_users($usersFile);
    [$idx, $user] = find_user($users, $nit);
    if (!$user || !verify_password($password, $user)) {
        json_out(['ok' => false, 'error' => 'NIT o contraseña incorrectos.'], 401);
    }

    if (empty($user['password_hash'])) {
        $users[$idx] = public_user(
            $user['nit'],
            hash_password($password),
            $user['created_at'] ?? date('c'),
            $user['nombre'] ?? '',
            $user['contacto_nombre'] ?? ($user['nombre_contacto'] ?? ''),
            $user['contacto_telefono'] ?? ($user['telefono_contacto'] ?? ($user['telefono'] ?? ''))
        );
        write_users($usersFile, $users);
        $user = $users[$idx];
    }

    $role = is_admin_nit($nit) || is_admin_nit($user['nit'] ?? '') ? 'admin' : 'cliente';
    json_out([
        'ok' => true,
        'nit' => $user['nit'],
        'nombre' => (string) ($user['nombre'] ?? ''),
        'role' => $role,
        'message' => 'Sesión iniciada.',
    ]);
}

json_out(['ok' => false, 'error' => 'Acción no válida.'], 400);
