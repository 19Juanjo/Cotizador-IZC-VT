<?php
/* Catálogo público de productos/precios editados por Admin ZKTECO. */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$file = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'productos_zkteco.json';
$raw = is_file($file) ? @file_get_contents($file) : '';
$data = json_decode((string) $raw, true);
if (!is_array($data)) {
    $data = ['products' => []];
}
if (!isset($data['products']) || !is_array($data['products'])) {
    $data['products'] = [];
}
echo json_encode($data, JSON_UNESCAPED_UNICODE);
