<?php
/**
 * Recupera data/cotizaciones.json fusionando backups + payload admin.
 * POST { admin_nit, cotizaciones: [...] }  o  multipart file + admin_nit
 * GET  ?admin_nit=...  → conteos
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
@date_default_timezone_set('America/Bogota');
@ini_set('display_errors', '0');
@set_time_limit(180);

$ADMIN = 'Admin IZC';
$root = dirname(__DIR__);
$dataDir = $root . DIRECTORY_SEPARATOR . 'data';
$quotesFile = $dataDir . DIRECTORY_SEPARATOR . 'cotizaciones.json';

function izc_norm_nit($n) {
    $n = strtoupper(preg_replace('/[\s.]/', '', (string) $n));
    $n = preg_replace('/-\d$/', '', $n);
    return $n;
}

function izc_parse_quotes($raw) {
    $raw = trim((string) $raw);
    if ($raw === '') return [];
    if (strncmp($raw, "\xEF\xBB\xBF", 3) === 0) $raw = substr($raw, 3);
    $data = json_decode($raw, true);
    if (!is_array($data)) return [];
    if (isset($data['quotes']) && is_array($data['quotes'])) $data = $data['quotes'];
    if (isset($data['cotizaciones']) && is_array($data['cotizaciones'])) $data = $data['cotizaciones'];
    $out = [];
    foreach ($data as $q) {
        if (is_array($q) && (isset($q['id']) || isset($q['nit']) || isset($q['items']))) {
            $out[] = $q;
        }
    }
    return $out;
}

function izc_key($q) {
    $id = trim((string) ($q['id'] ?? ''));
    if ($id !== '') return 'id:' . $id;
    $did = trim((string) ($q['bitrix_deal_id'] ?? ''));
    if ($did !== '' && ctype_digit($did)) return 'deal:' . $did;
    return 'row:' . implode('|', [
        (string) ($q['created_at'] ?? ''),
        (string) ($q['nit'] ?? ''),
        (string) ($q['seller_codigo'] ?? ''),
        (string) ($q['nombre'] ?? ''),
    ]);
}

function izc_merge($lists) {
    $merged = [];
    $order = [];
    foreach ($lists as $list) {
        if (!is_array($list)) continue;
        foreach ($list as $q) {
            if (!is_array($q)) continue;
            $k = izc_key($q);
            if (!isset($merged[$k])) {
                $merged[$k] = $q;
                $order[] = $k;
            } else {
                $old = $merged[$k];
                $newLen = strlen(json_encode($q));
                $oldLen = strlen(json_encode($old));
                if ($newLen >= $oldLen) {
                    if (trim((string) ($q['bitrix_deal_id'] ?? '')) === '' && trim((string) ($old['bitrix_deal_id'] ?? '')) !== '') {
                        $q['bitrix_deal_id'] = $old['bitrix_deal_id'];
                    }
                    $merged[$k] = $q;
                }
            }
        }
    }
    $out = [];
    foreach ($order as $k) $out[] = $merged[$k];
    return $out;
}

$body = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($body)) $body = [];
$admin = izc_norm_nit($body['admin_nit'] ?? ($_POST['admin_nit'] ?? ($_GET['admin_nit'] ?? '')));
$adminTok = strtoupper(preg_replace('/[\s._-]/', '', (string) $admin));
$adminOk = ($adminTok === 'ADMINIZC' || $adminTok === 'ADMIN' || $adminTok === 'IZCADMIN'
    || $admin === izc_norm_nit($ADMIN)
    || $admin === '03166122778' || ltrim($admin, '0') === '3166122778');
if (!$adminOk) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'No autorizado.']);
    exit;
}

$current = is_file($quotesFile) ? izc_parse_quotes((string) file_get_contents($quotesFile)) : [];
$lastGood = is_file($dataDir . DIRECTORY_SEPARATOR . '_last_good_cotizaciones.json')
    ? izc_parse_quotes((string) file_get_contents($dataDir . DIRECTORY_SEPARATOR . '_last_good_cotizaciones.json'))
    : [];

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    echo json_encode([
        'ok' => true,
        'current' => count($current),
        'last_good' => count($lastGood),
        'writable' => is_writable($dataDir),
    ]);
    exit;
}

$incoming = [];
if (isset($body['cotizaciones']) && is_array($body['cotizaciones'])) {
    $incoming = izc_parse_quotes(json_encode($body['cotizaciones']));
} elseif (isset($body['quotes']) && is_array($body['quotes'])) {
    $incoming = izc_parse_quotes(json_encode($body['quotes']));
}
if (!empty($_FILES['file']['tmp_name']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
    $incoming = array_merge($incoming, izc_parse_quotes((string) file_get_contents($_FILES['file']['tmp_name'])));
}

$merged = izc_merge([$current, $lastGood, $incoming]);
if (count($merged) < 20) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Nada que restaurar.', 'current' => count($current)]);
    exit;
}

if (!is_dir($dataDir)) @mkdir($dataDir, 0755, true);
$json = json_encode($merged, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
if ($json === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'JSON inválido']);
    exit;
}
$tmp = $quotesFile . '.tmp';
if (@file_put_contents($tmp, $json . "\n") === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'No se pudo escribir temporal.']);
    exit;
}
if (!@rename($tmp, $quotesFile)) {
    $ok = @copy($tmp, $quotesFile);
    @unlink($tmp);
    if (!$ok) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'No se pudo reemplazar cotizaciones.json']);
        exit;
    }
}
@copy($quotesFile, $dataDir . DIRECTORY_SEPARATOR . '_last_good_cotizaciones.json');

echo json_encode([
    'ok' => true,
    'message' => 'Historial restaurado (fusionado, sin borrar).',
    'before' => count($current),
    'after' => count($merged),
    'imported' => count($incoming),
]);
