<?php
/* Endpoint PHP para servir/actualizar precios en hosting. */
/**
 * Si lista-precios-izc.xlsb es más nuevo que precios.json, regenera el JSON
 * con python src/extraer_precios.py
 * (Stone/A = SKU; BK = USD; BJ = COP solo etiquetas/ribbons) y lo sirve.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

$dir = __DIR__;
$excel = $dir . DIRECTORY_SEPARATOR . 'lista-precios-izc.xlsb';
$json = $dir . DIRECTORY_SEPARATOR . 'precios.json';
$script = dirname($dir, 2) . DIRECTORY_SEPARATOR . 'src' . DIRECTORY_SEPARATOR . 'extraer_precios.py';

function find_python() {
    foreach (['py -3', 'py', 'python', 'python3'] as $bin) {
        $out = [];
        $code = 1;
        @exec($bin . ' --version 2>&1', $out, $code);
        if ($code === 0) {
            return $bin;
        }
    }
    return null;
}

$needsUpdate = is_file($excel) && (
    !is_file($json) || filemtime($excel) > filemtime($json)
);

if ($needsUpdate && is_file($script)) {
    $python = find_python();
    if ($python !== null) {
        @exec($python . ' ' . escapeshellarg($script) . ' 2>&1');
    }
}

if (is_file($json)) {
    readfile($json);
    exit;
}

http_response_code(503);
echo json_encode(['error' => 'No hay precios. Revisa el Excel o Python.']);
