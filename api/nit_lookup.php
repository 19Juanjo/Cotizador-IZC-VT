<?php
/**
 * NIT ↔ nombre para el cotizador (lee data/nit_nombres.json del disco).
 * POST JSON: { nit: "900..." } o { q: "grupo empresarial" }
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (!function_exists('mb_strlen')) {
    function mb_strlen($string, $encoding = null) {
        return strlen((string) $string);
    }
}
if (!function_exists('mb_strtolower')) {
    function mb_strtolower($string, $encoding = null) {
        return strtolower((string) $string);
    }
}
if (!function_exists('mb_strpos')) {
    function mb_strpos($haystack, $needle, $offset = 0, $encoding = null) {
        $p = strpos((string) $haystack, (string) $needle, (int) $offset);
        return $p === false ? false : $p;
    }
}

function nit_lookup_out($payload, $code = 200) {
    http_response_code((int) $code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function nit_lookup_normalize($nit) {
    $n = strtoupper(trim((string) $nit));
    $n = preg_replace('/[\s.]/', '', $n);
    $n = preg_replace('/-\d$/', '', $n);
    return $n;
}

function nit_lookup_fold($s) {
    $s = mb_strtolower(trim((string) $s), 'UTF-8');
    return strtr($s, [
        'á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n',
        'à' => 'a', 'è' => 'e', 'ì' => 'i', 'ò' => 'o', 'ù' => 'u',
    ]);
}

function nit_lookup_map() {
    static $map = null;
    if ($map !== null) {
        return $map;
    }
    $map = [];
    $dir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
    $file = $dir . DIRECTORY_SEPARATOR . 'nit_nombres.json';
    $cache = $dir . DIRECTORY_SEPARATOR . '_nit_nombres_lookup.json';
    $srcM = is_file($file) ? (int) filemtime($file) : 0;
    $cacheM = is_file($cache) ? (int) filemtime($cache) : 0;
    if ($cacheM > 0 && ($srcM === 0 || $cacheM >= $srcM)) {
        $decoded = json_decode((string) @file_get_contents($cache), true);
        if (is_array($decoded) && $decoded) {
            $map = $decoded;
            return $map;
        }
    }
    if (!is_file($file)) {
        return $map;
    }
    $data = json_decode((string) file_get_contents($file), true);
    if (!is_array($data)) {
        return $map;
    }
    $isList = false;
    if ($data) {
        $isList = true;
        $i = 0;
        foreach ($data as $k => $_) {
            if ($k !== $i) {
                $isList = false;
                break;
            }
            $i++;
        }
    }
    if ($isList) {
        foreach ($data as $row) {
            if (!is_array($row)) {
                continue;
            }
            $key = nit_lookup_normalize($row['nit'] ?? '');
            $nombre = trim((string) ($row['nombre'] ?? ''));
            if ($key !== '' && $nombre !== '' && strtoupper($key) !== 'ZKTECO' && $nombre !== $key) {
                $map[$key] = $nombre;
                $digits = preg_replace('/\D+/', '', $key);
                if ($digits !== '' && $digits !== $key) {
                    $map[$digits] = $nombre;
                }
            }
        }
    } else {
        foreach ($data as $key => $nombre) {
            $k = nit_lookup_normalize((string) $key);
            $v = trim((string) $nombre);
            if ($k !== '' && $v !== '' && strtoupper($k) !== 'ZKTECO' && $v !== $k) {
                $map[$k] = $v;
                $digits = preg_replace('/\D+/', '', $k);
                if ($digits !== '' && $digits !== $k) {
                    $map[$digits] = $v;
                }
            }
        }
    }
    if ($map) {
        @file_put_contents($cache, json_encode($map, JSON_UNESCAPED_UNICODE));
    }
    return $map;
}

function nit_lookup_variants($nit) {
    $n = nit_lookup_normalize($nit);
    $out = [];
    if ($n !== '') {
        $out[] = $n;
    }
    $digits = preg_replace('/\D+/', '', $n);
    if ($digits !== '' && $digits !== $n) {
        $out[] = $digits;
    }
    if ($digits !== '') {
        $noZeros = ltrim($digits, '0');
        if ($noZeros !== '' && $noZeros !== $digits) {
            $out[] = $noZeros;
        }
    }
    return $out;
}

function nit_lookup_nombre($nit) {
    $map = nit_lookup_map();
    foreach (nit_lookup_variants($nit) as $v) {
        if (isset($map[$v]) && trim((string) $map[$v]) !== '') {
            return trim((string) $map[$v]);
        }
    }
    return '';
}

function nit_lookup_search($q, $limit = 12) {
    $limit = (int) $limit;
    if ($limit < 1) {
        $limit = 12;
    }
    if ($limit > 20) {
        $limit = 20;
    }
    $needle = nit_lookup_fold($q);
    $digits = preg_replace('/\D+/', '', (string) $q);
    if (mb_strlen($needle) < 2 && strlen($digits) < 3) {
        return [];
    }
    $scored = [];
    $needleCompact = preg_replace('/\s+/', '', $needle);
    foreach (nit_lookup_map() as $nit => $nombre) {
        $hay = nit_lookup_fold($nombre);
        $hayCompact = preg_replace('/\s+/', '', $hay);
        $pos = ($needle !== '' && mb_strlen($needle) >= 2) ? mb_strpos($hay, $needle, 0, 'UTF-8') : false;
        if ($pos === false && $needleCompact !== '' && mb_strlen($needleCompact) >= 2) {
            $p2 = mb_strpos($hayCompact, $needleCompact, 0, 'UTF-8');
            if ($p2 !== false) {
                $pos = $p2;
            }
        }
        $nitPos = false;
        if ($pos === false && strlen($digits) >= 3) {
            $kd = preg_replace('/\D+/', '', (string) $nit);
            $nitPos = strpos($kd, $digits);
            if ($nitPos === false) {
                continue;
            }
        } elseif ($pos === false) {
            continue;
        }
        $scored[] = [
            'nit' => (string) $nit,
            'nombre' => (string) $nombre,
            'telefono' => '',
            '_score' => ($pos === 0 || $nitPos === 0) ? 0 : 1,
            '_len' => mb_strlen($hay, 'UTF-8'),
        ];
    }
    usort($scored, function ($a, $b) {
        if ($a['_score'] !== $b['_score']) {
            return $a['_score'] <=> $b['_score'];
        }
        return $a['_len'] <=> $b['_len'];
    });
    $out = [];
    foreach (array_slice($scored, 0, $limit) as $row) {
        unset($row['_score'], $row['_len']);
        $out[] = $row;
    }
    return $out;
}

$raw = file_get_contents('php://input');
$body = json_decode((string) $raw, true);
if (!is_array($body)) {
    $body = [];
}
$nit = nit_lookup_normalize($body['nit'] ?? ($body['client_nit'] ?? ($body['cliente_nit'] ?? ($_GET['nit'] ?? ''))));
$q = trim((string) ($body['q'] ?? ($body['nombre'] ?? ($body['query'] ?? ($_GET['q'] ?? '')))));
if ($q === '' && $nit !== '') {
    $q = $nit;
}
$limit = (int) ($body['limit'] ?? ($_GET['limit'] ?? 12));
$action = strtolower(trim((string) ($body['action'] ?? ($_GET['action'] ?? ''))));
$digits = preg_replace('/\D+/', '', $nit !== '' ? $nit : $q);

if ($action === 'lookup' || ($nit !== '' && strlen($digits) >= 6 && $action !== 'search')) {
    $nombre = nit_lookup_nombre($nit !== '' ? $nit : $q);
    nit_lookup_out([
        'ok' => true,
        'nit' => $nit !== '' ? $nit : nit_lookup_normalize($q),
        'nombre' => $nombre,
        'telefono' => '',
        'found' => ($nombre !== ''),
        'source' => $nombre !== '' ? 'index' : '',
        'clientes' => $nombre !== '' ? [['nit' => ($nit !== '' ? $nit : nit_lookup_normalize($q)), 'nombre' => $nombre, 'telefono' => '']] : [],
    ]);
}

$hits = nit_lookup_search($q !== '' ? $q : $nit, $limit);
nit_lookup_out([
    'ok' => true,
    'q' => $q,
    'clientes' => $hits,
    'count' => count($hits),
    'found' => count($hits) > 0,
]);
