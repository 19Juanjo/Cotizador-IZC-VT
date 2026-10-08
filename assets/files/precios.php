<?php
/* Endpoint PHP: sincroniza desde Excel y sirve precios clientes (precios.json). */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

require_once __DIR__ . DIRECTORY_SEPARATOR . 'precios_sync.php';

$json = izc_precios_files_dir() . DIRECTORY_SEPARATOR . 'precios.json';
$sync = izc_sync_precios_from_excel();

if (is_file($json)) {
    readfile($json);
    exit;
}

http_response_code(503);
echo json_encode([
    'error' => 'No hay precios. Sube lista-precios-izc.xlsb y revisa Python.',
    'sync' => $sync,
]);
