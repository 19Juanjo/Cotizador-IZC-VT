<?php
/**
 * Admin: subir lista-precios-izc.xlsb y regenerar precios.json / LP / inventario.
 * Multipart: admin_nit + excel (file). También action=status (JSON o form).
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

@date_default_timezone_set('America/Bogota');
@ini_set('display_errors', '0');
@set_time_limit(300);
@ini_set('max_execution_time', '300');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once dirname(__DIR__) . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'files' . DIRECTORY_SEPARATOR . 'precios_sync.php';

$ADMIN_NITS = ['Admin IZC', '03166122778', '3166122778'];

function izc_upload_json($payload, $code = 200) {
    http_response_code((int) $code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function izc_upload_normalize_nit($nit) {
    $n = strtoupper(trim((string) $nit));
    $n = preg_replace('/[\s.]/', '', $n);
    $n = preg_replace('/-\d$/', '', $n);
    return $n;
}

function izc_upload_is_admin($nit) {
    global $ADMIN_NITS;
    $token = strtoupper(preg_replace('/[\s._-]/', '', trim((string) $nit)));
    if ($token === 'ADMINIZC' || $token === 'ADMIN' || $token === 'IZCADMIN') {
        return true;
    }
    $n = izc_upload_normalize_nit($nit);
    if ($n === '') {
        return false;
    }
    foreach ($ADMIN_NITS as $admin) {
        $a = izc_upload_normalize_nit($admin);
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

$adminNit = izc_upload_normalize_nit($_POST['admin_nit'] ?? ($_REQUEST['admin_nit'] ?? ''));
if ($adminNit === '' && ($_SERVER['CONTENT_TYPE'] ?? '') && str_contains(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')) {
    $raw = file_get_contents('php://input');
    $body = json_decode((string) $raw, true);
    if (is_array($body)) {
        $adminNit = izc_upload_normalize_nit($body['admin_nit'] ?? ($body['nit'] ?? ''));
        $_POST['action'] = $body['action'] ?? ($_POST['action'] ?? '');
        $_POST['force'] = $body['force'] ?? ($_POST['force'] ?? '');
    }
}

if (!izc_upload_is_admin($adminNit)) {
    izc_upload_json(['ok' => false, 'error' => 'No autorizado.'], 403);
}

$action = strtolower(trim((string) ($_POST['action'] ?? ($_GET['action'] ?? 'upload'))));
if ($action === '' || $action === 'status' || $action === 'meta' || $action === 'get_precios_meta') {
    $excel = izc_precios_excel_path();
    $preciosJson = izc_precios_files_dir() . DIRECTORY_SEPARATOR . 'precios.json';
    $py = izc_python_precios_ready();
    izc_upload_json([
        'ok' => true,
        'excel' => izc_precios_file_meta($excel),
        'precios' => izc_precios_file_meta($preciosJson),
        'needs_sync' => izc_precios_needs_sync(),
        'python' => !empty($py['ok']),
        'python_ready' => $py,
    ]);
}

if ($action === 'sync' || $action === 'actualizar' || $action === 'force_sync') {
    $sync = izc_sync_precios_from_excel(true);
    izc_upload_json([
        'ok' => !empty($sync['ok']),
        'message' => !empty($sync['ok'])
            ? (!empty($sync['ran']) ? 'Lista de precios actualizada.' : 'Los precios ya estaban al día.')
            : ((string) ($sync['error'] ?? 'No se pudo actualizar.')),
        'sync' => $sync,
        'excel' => $sync['excel'] ?? izc_precios_file_meta(izc_precios_excel_path()),
    ], !empty($sync['ok']) ? 200 : 500);
}

// Upload Excel + sync
if (empty($_FILES['excel']) && empty($_FILES['file']) && empty($_FILES['lista'])) {
    izc_upload_json([
        'ok' => false,
        'error' => 'Selecciona el archivo lista-precios-izc.xlsb.',
    ], 400);
}

$file = null;
foreach (['excel', 'file', 'lista'] as $key) {
    if (!empty($_FILES[$key]) && is_array($_FILES[$key])) {
        $file = $_FILES[$key];
        break;
    }
}
if (!$file || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    $err = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
    $msg = 'No se pudo subir el archivo.';
    if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
        $msg = 'El archivo es demasiado grande para el servidor (sube el límite upload_max_filesize).';
    }
    izc_upload_json(['ok' => false, 'error' => $msg, 'upload_error' => $err], 400);
}

$origName = (string) ($file['name'] ?? '');
$ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
if ($ext !== 'xlsb') {
    izc_upload_json([
        'ok' => false,
        'error' => 'Formato no válido. Sube lista-precios-izc.xlsb',
    ], 400);
}

$tmp = (string) ($file['tmp_name'] ?? '');
$size = (int) ($file['size'] ?? 0);
if ($tmp === '' || !is_uploaded_file($tmp)) {
    izc_upload_json(['ok' => false, 'error' => 'Archivo temporal inválido.'], 400);
}
if ($size < 1000) {
    izc_upload_json(['ok' => false, 'error' => 'El archivo parece vacío o corrupto.'], 400);
}
if ($size > 80 * 1024 * 1024) {
    izc_upload_json(['ok' => false, 'error' => 'El archivo supera 80 MB.'], 400);
}

$destDir = izc_precios_files_dir();
if (!is_dir($destDir)) {
    @mkdir($destDir, 0755, true);
}
$dest = $destDir . DIRECTORY_SEPARATOR . 'lista-precios-izc.xlsb';

// Backup del Excel anterior.
if (is_file($dest)) {
    $bak = $dest . '.bak';
    @copy($dest, $bak);
}

$staging = $dest . '.uploading.' . getmypid();
if (!@move_uploaded_file($tmp, $staging)) {
    izc_upload_json(['ok' => false, 'error' => 'No se pudo guardar el Excel en el servidor.'], 500);
}
if (!@rename($staging, $dest)) {
    if (!@copy($staging, $dest)) {
        @unlink($staging);
        izc_upload_json(['ok' => false, 'error' => 'No se pudo reemplazar lista-precios-izc.xlsb.'], 500);
    }
    @unlink($staging);
}
@chmod($dest, 0666);

$sync = izc_sync_precios_from_excel(true);
if (empty($sync['ok'])) {
    izc_upload_json([
        'ok' => false,
        'error' => (string) ($sync['error'] ?? 'Excel guardado, pero falló la regeneración de precios.'),
        'detail' => (string) ($sync['detail'] ?? ''),
        'excel' => izc_precios_file_meta($dest),
        'sync' => $sync,
    ], 500);
}

$counts = is_array($sync['counts'] ?? null) ? $sync['counts'] : [];
$preciosN = (int) ($counts['precios'] ?? 0);
izc_upload_json([
    'ok' => true,
    'message' => $preciosN > 0
        ? ('Lista actualizada: ' . $preciosN . ' precios regenerados (promedio Web/Interna).')
        : 'Excel guardado y precios regenerados.',
    'excel' => izc_precios_file_meta($dest),
    'sync' => $sync,
    'counts' => $counts,
]);
