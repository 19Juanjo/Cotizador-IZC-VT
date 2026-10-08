<?php
/**
 * Lectura rápida del panel asesor: solo archivos de caché, sin cargar auth.php.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function izc_list_out($payload, $code = 200) {
    http_response_code((int) $code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function izc_list_code($raw) {
    $c = strtoupper(preg_replace('/[\s.]/', '', trim((string) $raw)));
    if (preg_match('/^V(\d{1,4})$/', $c, $m)) {
        return 'V' . (string) ((int) $m[1]);
    }
    return $c;
}

$body = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($body)) {
    $body = $_POST;
}
if (!is_array($body)) {
    $body = [];
}

$action = (string) ($body['action'] ?? '');
$codigo = izc_list_code($body['asesor_codigo'] ?? ($body['nit'] ?? ($body['codigo'] ?? '')));
if ($codigo === '') {
    izc_list_out(['ok' => false, 'error' => 'Falta código de asesor.', 'from_cache' => false], 400);
}

$dir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . '_asesor_list_cache';
$safe = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $codigo));

if ($action === 'list_quotes_asesor') {
    $path = $dir . DIRECTORY_SEPARATOR . $safe . '.v2.json';
    if (!is_file($path)) {
        izc_list_out(['ok' => false, 'error' => 'Sin caché.', 'from_cache' => false], 404);
    }
    $raw = json_decode((string) @file_get_contents($path), true);
    $data = is_array($raw) ? ($raw['data'] ?? $raw) : null;
    if (!is_array($data)) {
        izc_list_out(['ok' => false, 'error' => 'Caché inválida.', 'from_cache' => false], 404);
    }
    $historial = is_array($data['historial'] ?? null) ? $data['historial'] : [];
    $nuevas = is_array($data['nuevas'] ?? null) ? $data['nuevas'] : [];
    $duplicadas = is_array($data['duplicadas'] ?? null) ? $data['duplicadas'] : [];
    $gp = is_array($data['gp'] ?? null) ? $data['gp'] : [];
    izc_list_out([
        'ok' => true,
        'from_cache' => true,
        'quotes' => $historial,
        'historial' => $historial,
        'nuevas' => $nuevas,
        'duplicadas' => $duplicadas,
        'gp' => $gp,
        'quotes_gp' => $gp,
        'count' => count($historial),
        'count_nuevas' => (int) ($data['count_nuevas'] ?? count($nuevas)),
        'count_historial' => (int) ($data['count_historial'] ?? count($historial)),
        'count_duplicadas' => (int) ($data['count_duplicadas'] ?? count($duplicadas)),
        'count_gp' => (int) ($data['count_gp'] ?? count($gp)),
        'filtro' => 'historial',
        'role' => 'asesor',
        'codigo' => $codigo,
    ]);
}

if ($action === 'list_clientes_asesor') {
    $path = $dir . DIRECTORY_SEPARATOR . $safe . '.clientes.json';
    if (!is_file($path)) {
        izc_list_out(['ok' => false, 'error' => 'Sin caché.', 'from_cache' => false], 404);
    }
    $raw = json_decode((string) @file_get_contents($path), true);
    $clientes = is_array($raw['clientes'] ?? null) ? $raw['clientes'] : [];
    izc_list_out([
        'ok' => true,
        'from_cache' => true,
        'codigo' => $codigo,
        'clientes' => $clientes,
        'count' => count($clientes),
        'bitrix_synced' => false,
        'bitrix_from_cache' => true,
        'bitrix_count' => 0,
        'bitrix_fetched_at' => '',
        'bitrix_error' => '',
    ]);
}

izc_list_out(['ok' => false, 'error' => 'Acción no válida.'], 400);
