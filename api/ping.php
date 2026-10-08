<?php
/**
 * Diagnóstico WAMP IZC.
 * http://pqr.izc.com.co:8183/IZC/api/ping.php
 * http://pqr.izc.com.co:8183/IZC/api/ping.php?bitrix=1
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
@ini_set('display_errors', '0');

$root = dirname(__DIR__);
$authFile = __DIR__ . DIRECTORY_SEPARATOR . 'auth.php';
$bitrixFile = $root . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'bitrix.json';
$asesoresFile = $root . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'asesores.json';

$authSrc = is_file($authFile) ? (string) file_get_contents($authFile) : '';
$bitrix = [
    'file_exists' => is_file($bitrixFile),
    'enabled' => false,
    'has_webhook' => false,
    'has_stage' => false,
    'webhook_host' => '',
];
$cfg = null;
if (is_file($bitrixFile)) {
    $cfg = json_decode((string) file_get_contents($bitrixFile), true);
    if (is_array($cfg)) {
        $bitrix['enabled'] = !empty($cfg['enabled']);
        $webhook = trim((string) ($cfg['webhook_base'] ?? ''));
        $bitrix['has_webhook'] = $webhook !== '';
        $bitrix['has_stage'] = trim((string) ($cfg['stage_id'] ?? '')) !== '';
        if ($webhook !== '') {
            $parts = parse_url($webhook);
            $bitrix['webhook_host'] = (string) ($parts['host'] ?? '');
        }
    }
}

$out = [
    'ok' => true,
    'php' => PHP_VERSION,
    'sapi' => PHP_SAPI,
    'dir' => __DIR__,
    'writable_data' => is_writable($root . DIRECTORY_SEPARATOR . 'data'),
    'curl' => function_exists('curl_init'),
    'allow_url_fopen' => (bool) ini_get('allow_url_fopen'),
    'auth_php' => [
        'exists' => is_file($authFile),
        'bytes' => is_file($authFile) ? filesize($authFile) : 0,
        'has_list_clientes_asesor' => strpos($authSrc, 'list_clientes_asesor') !== false,
        'has_save_quote' => strpos($authSrc, 'save_quote') !== false,
        'has_izc_starts_with' => strpos($authSrc, 'function izc_starts_with') !== false,
    ],
    'asesores_json' => [
        'exists' => is_file($asesoresFile),
        'bytes' => is_file($asesoresFile) ? filesize($asesoresFile) : 0,
    ],
    'bitrix' => $bitrix,
];

if (!empty($_GET['bitrix']) && is_array($cfg) && !empty($cfg['webhook_base'])) {
    $base = rtrim(str_replace('\\', '/', (string) $cfg['webhook_base']), '/') . '/';
    $url = $base . 'profile.json';
    $raw = null;
    $err = '';
    $http = 0;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json; charset=utf-8'],
            CURLOPT_POSTFIELDS => '{}',
            CURLOPT_TIMEOUT => 20,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
        ]);
        $raw = curl_exec($ch);
        $err = curl_error($ch);
        $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    }
    $decoded = is_string($raw) ? json_decode($raw, true) : null;
    $out['bitrix_test'] = [
        'http' => $http,
        'curl_error' => $err,
        'ok' => is_array($decoded) && empty($decoded['error']),
        'result_keys' => is_array($decoded) ? array_keys($decoded) : [],
        'error' => is_array($decoded) ? ($decoded['error_description'] ?? $decoded['error'] ?? null) : null,
    ];
}

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
