<?php
/* Endpoint PHP: sincroniza desde Excel y sirve precios LP asesor (precios_lp_asesor.json). */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

require_once __DIR__ . DIRECTORY_SEPARATOR . 'precios_sync.php';

$json = izc_precios_files_dir() . DIRECTORY_SEPARATOR . 'precios_lp_asesor.json';
$sync = izc_sync_precios_from_excel();

if (is_file($json)) {
    readfile($json);
    exit;
}

http_response_code(503);
echo json_encode([
    'error' => 'No hay precios LP asesor. Sube lista-precios-izc.xlsb y revisa Python.',
    'sync' => $sync,
]);
