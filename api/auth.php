<?php
/* API PHP de autenticacion y acciones de cuenta (alternativa al servidor local). */
/**
 * Registro e inicio de sesión por NIT y contraseña.
 * Guarda hashes (PBKDF2) en data/usuarios.json — nunca la contraseña en claro.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

@date_default_timezone_set('America/Bogota');
@ini_set('display_errors', '0');
@ini_set('html_errors', '0');
if (function_exists('ob_start')) {
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    ob_start();
}

$requestMethod = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
if ($requestMethod === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$usersFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'usuarios.json';
$quotesFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'cotizaciones.json';
$trmFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'trm.json';
$bitrixFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'bitrix.json';
$asesoresFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'asesores.json';
$gerentesProductoFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'gerentes_producto.json';
$bitrixGerentesFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'bitrix_gerentes.json';
$asesorClientesIndexFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'asesor_clientes_index.json';
$asesorClientesManualFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'asesor_clientes_manual.json';
$gpClientesManualFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'gp_clientes_manual.json';
$productosCreadosAsesorFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'productos_creados_asesor.json';
$productosZktecoFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'productos_zkteco.json';
$productosZktecoPublicFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'files' . DIRECTORY_SEPARATOR . 'productos_zkteco.json';
$asesorClientesBitrixCacheDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'asesor_bitrix_clientes_cache';
$asesorBitrixQuotesSyncCacheDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'asesor_bitrix_quotes_sync';
$nitTelefonosFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'nit_telefonos.json';
$nitDireccionesFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'nit_direcciones.json';
$adminNits = ['Admin IZC'];
$adminNitsLegacy = ['03166122778', '3166122778'];
$BITRIX_COMPANY_NAME_PRIMARY = 'UF_CRM_1746192481';
$BITRIX_COMPANY_NAME_FALLBACK = 'UF_CRM_1746192546';
$ASESOR_BITRIX_CLIENTES_TTL = 300; // 5 minutos
$BITRIX_QUOTES_SYNC_SINCE = '2026-08-20';
$BITRIX_SYNC_MAX_IMPORT_PER_RUN = 120;
$BITRIX_SYNC_FETCH_PRODUCTS = false;

/** Compatible PHP 7+: equivalente a str_starts_with(). */
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

function normalize_telefono_display($telefono) {
    $p = trim((string) $telefono);
    if ($p === '') {
        return '';
    }
    $parts = preg_split('/\s*\/\s*|\s*·\s*|\s*,\s*/u', $p) ?: [];
    $out = [];
    foreach ($parts as $chunk) {
        $one = trim((string) $chunk);
        if ($one === '') {
            continue;
        }
        $compact = preg_replace('/[\s\-]/', '', $one);
        if (izc_starts_with($compact, '+57')) {
            $compact = substr($compact, 3);
        } elseif (izc_starts_with($compact, '0057')) {
            $compact = substr($compact, 4);
        } elseif (preg_match('/^57\d{7,10}$/', $compact)) {
            $compact = substr($compact, 2);
        }
        if ($compact !== '') {
            $out[] = $compact;
        }
    }
    return $out ? implode(' / ', $out) : '';
}

function resolve_cliente_telefono_from_index($nit, $fallback = '') {
    static $mapCache = null;
    global $nitTelefonosFile;
    $n = normalize_nit($nit);
    $fb = normalize_telefono_display($fallback);
    if ($n === '') {
        return $fb;
    }
    if ($mapCache === null) {
        $mapCache = [];
        if (is_file($nitTelefonosFile)) {
            $data = json_decode((string) file_get_contents($nitTelefonosFile), true);
            if (is_array($data)) {
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
                        $key = normalize_nit($row['nit'] ?? '');
                        $tel = normalize_telefono_display($row['telefono'] ?? ($row['telefonos'] ?? ''));
                        if ($key !== '' && $tel !== '') {
                            $mapCache[$key] = $tel;
                        }
                    }
                } else {
                    foreach ($data as $key => $tel) {
                        $k = normalize_nit((string) $key);
                        $v = normalize_telefono_display($tel);
                        if ($k !== '' && $v !== '') {
                            $mapCache[$k] = $v;
                        }
                    }
                }
            }
        }
    }
    $digits = preg_replace('/\D+/', '', $n);
    foreach ([$n, $digits, ltrim((string) $digits, '0')] as $key) {
        if ($key !== '' && isset($mapCache[$key]) && trim((string) $mapCache[$key]) !== '') {
            return normalize_telefono_display($mapCache[$key]);
        }
    }
    return $fb;
}

function resolve_cliente_direccion_from_index($nit, $fallback = '') {
    static $mapCache = null;
    global $nitDireccionesFile;
    $n = normalize_nit($nit);
    $fb = trim((string) $fallback);
    if ($n === '') {
        return $fb;
    }
    if ($mapCache === null) {
        $mapCache = [];
        if (is_file($nitDireccionesFile)) {
            $data = json_decode((string) file_get_contents($nitDireccionesFile), true);
            if (is_array($data)) {
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
                        $key = normalize_nit($row['nit'] ?? '');
                        $dir = trim((string) ($row['direccion'] ?? ($row['address'] ?? '')));
                        if ($key !== '' && $dir !== '') {
                            $mapCache[$key] = $dir;
                        }
                    }
                } else {
                    foreach ($data as $key => $dir) {
                        $k = normalize_nit((string) $key);
                        $v = trim((string) $dir);
                        if ($k !== '' && $v !== '') {
                            $mapCache[$k] = $v;
                        }
                    }
                }
            }
        }
    }
    $digits = preg_replace('/\D+/', '', $n);
    foreach ([$n, $digits, ltrim((string) $digits, '0')] as $key) {
        if ($key !== '' && isset($mapCache[$key]) && trim((string) $mapCache[$key]) !== '') {
            return trim((string) $mapCache[$key]);
        }
    }
    return $fb;
}

function nit_index_put_nombre(&$map, $nit, $nombre) {
    $nombre = trim((string) $nombre);
    $key = normalize_nit($nit);
    if ($key === '' || $nombre === '' || strtoupper($key) === 'ZKTECO' || strcasecmp($nombre, $key) === 0) {
        return;
    }
    $digits = preg_replace('/\D+/', '', $key);
    foreach ([$key, $digits, ltrim((string) $digits, '0')] as $k) {
        if ($k !== '') {
            $map[$k] = $nombre;
        }
    }
}

function load_nit_nombres_fast_map() {
    static $map = null;
    global $asesorClientesIndexFile;
    if (is_array($map)) {
        return $map;
    }
    $dir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data';
    $src = $dir . DIRECTORY_SEPARATOR . 'nit_nombres.json';
    $cache = $dir . DIRECTORY_SEPARATOR . '_nit_nombres_lookup.json';
    $srcM = is_file($src) ? (int) filemtime($src) : 0;
    $cacheM = is_file($cache) ? (int) filemtime($cache) : 0;
    if ($cacheM > 0 && $srcM > 0 && $cacheM >= $srcM) {
        $decoded = json_decode((string) @file_get_contents($cache), true);
        if (is_array($decoded) && $decoded) {
            $map = $decoded;
            return $map;
        }
    }
    $map = [];
    if (is_file($src)) {
        $data = json_decode((string) @file_get_contents($src), true);
        if (is_array($data)) {
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
                    if (is_array($row)) {
                        nit_index_put_nombre($map, $row['nit'] ?? '', $row['nombre'] ?? '');
                    }
                }
            } else {
                foreach ($data as $key => $nombre) {
                    nit_index_put_nombre($map, $key, $nombre);
                }
            }
        }
    } elseif (!empty($asesorClientesIndexFile) && is_file($asesorClientesIndexFile)) {
        $data = json_decode((string) @file_get_contents($asesorClientesIndexFile), true);
        if (is_array($data) && isset($data['nombres_by_nit']) && is_array($data['nombres_by_nit'])) {
            foreach ($data['nombres_by_nit'] as $key => $nombre) {
                nit_index_put_nombre($map, $key, $nombre);
            }
        }
    }
    if ($map) {
        @file_put_contents($cache, json_encode($map, JSON_UNESCAPED_UNICODE));
    }
    return $map;
}

function resolve_cliente_nombre_from_index($nit, $fallback = '') {
    $n = normalize_nit($nit);
    $fb = trim((string) $fallback);
    if ($n === '') {
        return $fb;
    }
    $mapCache = load_nit_nombres_fast_map();
    $digits = preg_replace('/\D+/', '', $n);
    $candidates = [$n];
    if ($digits !== '') {
        $candidates[] = $digits;
        $noZeros = ltrim($digits, '0');
        if ($noZeros !== '') {
            $candidates[] = $noZeros;
        }
    }
    foreach ($candidates as $key) {
        if ($key !== '' && isset($mapCache[$key]) && trim((string) $mapCache[$key]) !== '') {
            return trim((string) $mapCache[$key]);
        }
    }
    if ($fb !== '' && $fb !== $n) {
        return $fb;
    }
    return $fb !== '' ? $fb : $n;
}

function izc_fold_search_text($s) {
    $s = mb_strtolower(trim((string) $s), 'UTF-8');
    return strtr($s, [
        'á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n',
        'à' => 'a', 'è' => 'e', 'ì' => 'i', 'ò' => 'o', 'ù' => 'u',
    ]);
}

function nit_nombres_index_map() {
    return load_nit_nombres_fast_map();
}

function search_nit_nombres_index($q, $limit = 12) {
    $needle = izc_fold_search_text($q);
    $digits = preg_replace('/\D+/', '', (string) $q);
    $limit = (int) $limit;
    if ($limit < 1) {
        $limit = 12;
    }
    if ($limit > 20) {
        $limit = 20;
    }
    if (mb_strlen($needle) < 2 && strlen($digits) < 3) {
        return [];
    }
    $scored = [];
    $needleCompact = preg_replace('/\s+/', '', $needle);
    foreach (nit_nombres_index_map() as $nit => $nombre) {
        $hay = izc_fold_search_text($nombre);
        $hayCompact = preg_replace('/\s+/', '', $hay);
        $pos = (mb_strlen($needle) >= 2) ? mb_strpos($hay, $needle, 0, 'UTF-8') : false;
        if ($pos === false && mb_strlen($needleCompact) >= 2) {
            $p2 = mb_strpos($hayCompact, $needleCompact, 0, 'UTF-8');
            if ($p2 !== false) {
                $pos = $p2;
            }
        }
        $nitPos = false;
        if ($pos === false && strlen($digits) >= 3) {
            $kd = preg_replace('/\D+/', '', (string) $nit);
            $p = strpos($kd, $digits);
            if ($p === false) {
                continue;
            }
            $nitPos = $p;
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

function get_asesor_clientes($codigo) {
    global $asesorClientesIndexFile;
    $code = normalize_asesor_codigo($codigo);
    if ($code === '' || !is_file($asesorClientesIndexFile)) {
        return [];
    }
    $data = json_decode((string) file_get_contents($asesorClientesIndexFile), true);
    if (!is_array($data)) {
        return [];
    }
    $byNit = [];
    foreach (asesor_all_codigos($code) as $cCode) {
        if (!isset($data['by_codigo'][$cCode]) || !is_array($data['by_codigo'][$cCode])) {
            continue;
        }
        $entry = $data['by_codigo'][$cCode];
        foreach (($entry['clientes'] ?? []) as $c) {
            if (!is_array($c)) {
                continue;
            }
            $nit = normalize_nit($c['nit'] ?? '');
            if ($nit === '' || isset($byNit[$nit])) {
                continue;
            }
            $nombre = trim((string) ($c['nombre'] ?? ''));
            if ($nombre === '' || $nombre === $nit) {
                $nombre = resolve_cliente_nombre_from_index($nit, $nombre);
            }
            if ($nombre === '') {
                $nombre = $nit;
            }
            $telefono = normalize_telefono_display($c['telefono'] ?? ($c['telefonos'] ?? ''));
            if ($telefono === '') {
                $telefono = resolve_cliente_telefono_from_index($nit, '');
            }
            $byNit[$nit] = ['nit' => $nit, 'nombre' => $nombre, 'telefono' => $telefono];
        }
    }
    return array_values($byNit);
}

function read_asesor_clientes_manual($path = null) {
    global $asesorClientesManualFile;
    $file = $path ?: $asesorClientesManualFile;
    $tryFiles = [$file, izc_last_good_path($file)];
    $data = null;
    foreach ($tryFiles as $f) {
        if (!is_file($f)) {
            continue;
        }
        $decoded = json_decode((string) file_get_contents($f), true);
        if (is_array($decoded)) {
            $data = $decoded;
            break;
        }
    }
    if (!is_array($data)) {
        return ['by_codigo' => []];
    }
    if (!isset($data['by_codigo']) || !is_array($data['by_codigo'])) {
        $data['by_codigo'] = [];
    }
    // Normaliza claves y listas (PowerShell ConvertTo-Json a veces guarda 1 cliente como objeto).
    $normalized = [];
    foreach ($data['by_codigo'] as $codeRaw => $rows) {
        $code = normalize_asesor_codigo($codeRaw);
        if ($code === '') {
            continue;
        }
        $list = asesor_clientes_manual_rows($rows);
        if (!isset($normalized[$code])) {
            $normalized[$code] = [];
        }
        foreach ($list as $row) {
            if (is_array($row)) {
                $normalized[$code][] = $row;
            }
        }
    }
    $data['by_codigo'] = $normalized;
    return $data;
}

/**
 * Acepta lista JSON [{...}] o un único objeto {...} (bug típico de ConvertTo-Json).
 */
function asesor_clientes_manual_rows($raw) {
    if (!is_array($raw)) {
        return [];
    }
    if ($raw === []) {
        return [];
    }
    if (isset($raw['nit']) || isset($raw['nombre'])) {
        return [$raw];
    }
    $out = [];
    foreach ($raw as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (isset($row['nit']) || isset($row['nombre'])) {
            $out[] = $row;
        }
    }
    return $out;
}

function write_asesor_clientes_manual($data, $path = null) {
    global $asesorClientesManualFile;
    $file = $path ?: $asesorClientesManualFile;
    $dir = dirname($file);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    if (!is_array($data)) {
        $data = ['by_codigo' => []];
    }
    if (!isset($data['by_codigo']) || !is_array($data['by_codigo'])) {
        $data['by_codigo'] = [];
    }
    $safe = ['by_codigo' => []];
    foreach ($data['by_codigo'] as $codeRaw => $rows) {
        $code = normalize_asesor_codigo($codeRaw);
        if ($code === '') {
            continue;
        }
        $list = [];
        foreach (asesor_clientes_manual_rows($rows) as $c) {
            if (!is_array($c)) {
                continue;
            }
            $nit = normalize_nit($c['nit'] ?? '');
            if ($nit === '') {
                continue;
            }
            $list[] = [
                'nit' => $nit,
                'nombre' => trim((string) ($c['nombre'] ?? '')),
                'telefono' => normalize_telefono_display($c['telefono'] ?? ''),
                'created_at' => (string) ($c['created_at'] ?? ''),
                'created_by' => (string) ($c['created_by'] ?? ''),
                'updated_at' => (string) ($c['updated_at'] ?? ''),
                'updated_by' => (string) ($c['updated_by'] ?? ''),
            ];
        }
        $safe['by_codigo'][$code] = array_values($list);
    }
    $onDisk = read_asesor_clientes_manual($file);
    foreach (($onDisk['by_codigo'] ?? []) as $code => $rows) {
        $code = normalize_asesor_codigo($code);
        if ($code === '') {
            continue;
        }
        $diskRows = asesor_clientes_manual_rows($rows);
        if (!isset($safe['by_codigo'][$code])) {
            $safe['by_codigo'][$code] = $diskRows;
            continue;
        }
        $incoming = asesor_clientes_manual_rows($safe['by_codigo'][$code]);
        if (count($diskRows) > count($incoming)) {
            $byNit = [];
            foreach ($diskRows as $c) {
                $nit = normalize_nit($c['nit'] ?? '');
                if ($nit !== '') {
                    $byNit[$nit] = $c;
                }
            }
            foreach ($incoming as $c) {
                $nit = normalize_nit($c['nit'] ?? '');
                if ($nit !== '') {
                    $byNit[$nit] = $c;
                }
            }
            $safe['by_codigo'][$code] = array_values($byNit);
        }
    }
    $countRows = static function ($data) {
        $n = 0;
        foreach (($data['by_codigo'] ?? []) as $rows) {
            $n += count(asesor_clientes_manual_rows($rows));
        }
        return $n;
    };
    $oldCount = $countRows($onDisk);
    $newCount = $countRows($safe);
    if (izc_blocked_shrink($file, $oldCount, $newCount, 20)) {
        error_log('write_asesor_clientes_manual skipped shrink-block; merging and writing anyway');
        $safe = $onDisk;
        foreach (($data['by_codigo'] ?? []) as $codeRaw => $rows) {
            $code = normalize_asesor_codigo($codeRaw);
            if ($code === '') {
                continue;
            }
            $byNit = [];
            foreach (asesor_clientes_manual_rows($safe['by_codigo'][$code] ?? []) as $c) {
                $nit = normalize_nit($c['nit'] ?? '');
                if ($nit !== '') {
                    $byNit[$nit] = $c;
                }
            }
            foreach (asesor_clientes_manual_rows($rows) as $c) {
                $nit = normalize_nit($c['nit'] ?? '');
                if ($nit !== '') {
                    $byNit[$nit] = $c;
                }
            }
            $safe['by_codigo'][$code] = array_values($byNit);
        }
        $newCount = $countRows($safe);
    }
    if (!izc_atomic_write_json($file, $safe)) {
        @chmod($dir, 0777);
        if (is_file($file)) {
            @chmod($file, 0666);
        }
        if (!izc_atomic_write_json($file, $safe)) {
            return false;
        }
    }
    izc_copy_last_good($file, $newCount, 10);
    return true;
}

function get_asesor_clientes_manual($codigo) {
    $code = normalize_asesor_codigo($codigo);
    if ($code === '') {
        return [];
    }
    $data = read_asesor_clientes_manual();
    $byNit = [];
    foreach (asesor_all_codigos($code) as $cCode) {
        foreach (asesor_clientes_manual_rows($data['by_codigo'][$cCode] ?? []) as $c) {
            if (!is_array($c)) {
                continue;
            }
            $nit = normalize_nit($c['nit'] ?? '');
            if ($nit === '' || isset($byNit[$nit])) {
                continue;
            }
            $nombre = trim((string) ($c['nombre'] ?? ''));
            if ($nombre === '') {
                $nombre = $nit;
            }
            $telefono = normalize_telefono_display($c['telefono'] ?? ($c['telefonos'] ?? ''));
            $byNit[$nit] = ['nit' => $nit, 'nombre' => $nombre, 'telefono' => $telefono];
        }
    }
    return array_values($byNit);
}

function asesor_nit_variant_keys($nit) {
    $keys = [];
    $n = normalize_nit($nit);
    if ($n === '') {
        return $keys;
    }
    $keys[$n] = true;
    $digits = preg_replace('/\D+/', '', $n);
    if ($digits === '') {
        return array_keys($keys);
    }
    $keys[$digits] = true;
    $noZeros = ltrim($digits, '0');
    if ($noZeros !== '') {
        $keys[$noZeros] = true;
    }
    // NIT colombiano: a veces viene con dígito de verificación pegado (sin guion).
    if (strlen($digits) >= 10) {
        $noDv = substr($digits, 0, -1);
        $keys[$noDv] = true;
        $noDvTrim = ltrim($noDv, '0');
        if ($noDvTrim !== '') {
            $keys[$noDvTrim] = true;
        }
    }
    return array_keys($keys);
}

function asesor_panel_clientes_nit_set($codigo) {
    $set = [];
    foreach (asesor_clientes_for_quote_matching($codigo) as $c) {
        if (is_array($c)) {
            asesor_add_nit_variants($set, $c['nit'] ?? '');
        }
    }
    $merged = get_asesor_clientes_merged($codigo, ['fast' => true, 'refresh_bitrix' => false]);
    foreach (is_array($merged['clientes'] ?? null) ? $merged['clientes'] : [] as $c) {
        if (is_array($c)) {
            asesor_add_nit_variants($set, $c['nit'] ?? '');
        }
    }
    $dir = function_exists('asesor_quotes_list_cache_dir') ? asesor_quotes_list_cache_dir() : '';
    if ($dir !== '') {
        foreach (asesor_all_codigos($codigo) as $cCode) {
            $safe = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) $cCode));
            if ($safe === '') {
                continue;
            }
            $cliPath = $dir . DIRECTORY_SEPARATOR . $safe . '.clientes.json';
            if (!is_file($cliPath)) {
                continue;
            }
            $raw = json_decode((string) @file_get_contents($cliPath), true);
            foreach (is_array($raw['clientes'] ?? null) ? $raw['clientes'] : [] as $c) {
                if (is_array($c)) {
                    asesor_add_nit_variants($set, $c['nit'] ?? '');
                }
            }
        }
    }
    return $set;
}

function asesor_nit_belongs_to_vendedor($codigo, $nit) {
    return nit_in_asesor_set($nit, asesor_panel_clientes_nit_set($codigo));
}

function asesor_clientes_json_upsert($codigo, $cliente) {
    $code = normalize_asesor_codigo($codigo);
    if ($code === '' || !is_array($cliente)) {
        return;
    }
    $dir = function_exists('asesor_quotes_list_cache_dir') ? asesor_quotes_list_cache_dir() : '';
    if ($dir === '') {
        return;
    }
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $want = normalize_nit($cliente['nit'] ?? '');
    if ($want === '') {
        return;
    }
    foreach (asesor_all_codigos($code) as $cCode) {
        $safe = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) $cCode));
        if ($safe === '') {
            continue;
        }
        $cliPath = $dir . DIRECTORY_SEPARATOR . $safe . '.clientes.json';
        $raw = is_file($cliPath) ? json_decode((string) @file_get_contents($cliPath), true) : [];
        $list = is_array($raw['clientes'] ?? null) ? $raw['clientes'] : [];
        $found = false;
        foreach ($list as $i => $row) {
            if (!is_array($row)) {
                continue;
            }
            if (normalize_nit($row['nit'] ?? '') === $want) {
                $list[$i] = array_merge($row, $cliente);
                $found = true;
                break;
            }
        }
        if (!$found) {
            array_unshift($list, $cliente);
        }
        @file_put_contents($cliPath, json_encode(['clientes' => array_values($list), 'count' => count($list)], JSON_UNESCAPED_UNICODE), LOCK_EX);
    }
}

function asesor_add_nit_variants(&$set, $nit) {
    foreach (asesor_nit_variant_keys($nit) as $key) {
        $set[$key] = true;
    }
}

/** Clientes del asesor (Bitrix + índice + manual) para emparejar cotizaciones. */
function asesor_clientes_for_quote_matching($codigo) {
    $code = normalize_asesor_codigo($codigo);
    if ($code === '') {
        return [];
    }
    $byNit = [];
    foreach (asesor_all_codigos($code) as $cCode) {
        $sync = sync_asesor_clientes_from_bitrix($cCode, false, true);
        foreach (($sync['clientes'] ?? []) as $c) {
            if (!is_array($c)) {
                continue;
            }
            $nit = normalize_nit($c['nit'] ?? '');
            if ($nit !== '') {
                $byNit[$nit] = $c;
            }
        }
    }
    foreach (array_merge(get_asesor_clientes($code), get_asesor_clientes_manual($code)) as $c) {
        if (!is_array($c)) {
            continue;
        }
        $nit = normalize_nit($c['nit'] ?? '');
        if ($nit !== '') {
            $byNit[$nit] = $c;
        }
    }
    return array_values($byNit);
}

function asesor_nit_variants_set($codigo) {
    $set = [];
    foreach (asesor_clientes_for_quote_matching($codigo) as $c) {
        asesor_add_nit_variants($set, $c['nit'] ?? '');
    }
    return $set;
}

function build_nit_to_asesor_map($forceRefresh = false) {
    static $map = null;
    if ($forceRefresh) {
        $map = null;
    }
    if ($map !== null) {
        return $map;
    }
    global $asesorClientesIndexFile, $asesorClientesBitrixCacheDir;
    $map = [];
    $register = function ($codigo, $nit) use (&$map) {
        $code = asesor_canonical_codigo($codigo);
        if ($code === '') {
            $code = normalize_asesor_codigo($codigo);
        }
        if ($code === '') {
            return;
        }
        foreach (asesor_nit_variant_keys($nit) as $key) {
            if (!isset($map[$key])) {
                $map[$key] = $code;
            }
        }
    };
    if (is_file($asesorClientesIndexFile)) {
        $raw = (string) file_get_contents($asesorClientesIndexFile);
        if (strncmp($raw, "\xEF\xBB\xBF", 3) === 0) {
            $raw = substr($raw, 3);
        }
        $data = json_decode($raw, true);
        if (is_array($data)) {
            foreach (($data['by_codigo'] ?? []) as $code => $info) {
                if (!is_array($info)) {
                    continue;
                }
                foreach (($info['clientes'] ?? []) as $c) {
                    if (is_array($c)) {
                        $register($code, $c['nit'] ?? '');
                    }
                }
            }
        }
    }
    $manual = read_asesor_clientes_manual();
    foreach (($manual['by_codigo'] ?? []) as $code => $rows) {
        foreach (asesor_clientes_manual_rows($rows) as $c) {
            $register($code, $c['nit'] ?? '');
        }
    }
    if (is_dir($asesorClientesBitrixCacheDir)) {
        foreach (glob($asesorClientesBitrixCacheDir . DIRECTORY_SEPARATOR . 'V*.json') ?: [] as $path) {
            $code = pathinfo($path, PATHINFO_FILENAME);
            $cached = json_decode((string) file_get_contents($path), true);
            if (!is_array($cached)) {
                continue;
            }
            foreach (($cached['clientes'] ?? []) as $c) {
                if (is_array($c)) {
                    $register($code, $c['nit'] ?? '');
                }
            }
        }
    }
    return $map;
}

function resolve_asesor_codigo_for_nit($nit, $map = null) {
    if ($map === null) {
        $map = build_nit_to_asesor_map();
    }
    foreach (asesor_nit_variant_keys($nit) as $key) {
        if (!empty($map[$key])) {
            return normalize_asesor_codigo($map[$key]);
        }
    }
    return '';
}

/** NIT de la cotización (campo nit o sufijo del id). */
function quote_effective_nit($quote) {
    if (!is_array($quote)) {
        return '';
    }
    $nit = normalize_nit($quote['nit'] ?? '');
    if ($nit !== '' && preg_match('/^\d{6,15}$/', preg_replace('/\D+/', '', $nit))) {
        return $nit;
    }
    $id = (string) ($quote['id'] ?? '');
    if (preg_match('/-(\d{6,15})$/', $id, $m)) {
        return normalize_nit($m[1]);
    }
    return $nit;
}

/** Asigna seller_codigo a cotizaciones antiguas sin vendedor. */
function repair_quote_seller_codes() {
    global $quotesFile, $bitrixFile;
    static $done = false;
    if ($done) {
        return 0;
    }
    $done = true;
    $map = build_nit_to_asesor_map();
    $quotes = read_quotes($quotesFile);
    $changed = 0;
    foreach ($quotes as &$q) {
        if (!is_array($q)) {
            continue;
        }
        if (normalize_asesor_codigo($q['seller_codigo'] ?? '') !== '') {
            continue;
        }
        $fromBitrix = resolve_asesor_codigo_from_bitrix_id($q['assigned_by_id'] ?? '');
        if ($fromBitrix !== '') {
            $q['seller_codigo'] = $fromBitrix;
            $changed++;
            continue;
        }
        $nit = quote_effective_nit($q);
        $code = resolve_asesor_codigo_for_nit($nit, $map);
        if ($code !== '') {
            $q['seller_codigo'] = $code;
            $changed++;
        }
    }
    unset($q);
    reset_auto_duplicate_flags($quotes);
    $dupMarked = mark_duplicate_quotes_by_nit($quotes);
    $flagsChanged = repair_advisor_recotizada_flags($quotes);
    if ($changed > 0 || $dupMarked > 0 || $flagsChanged > 0) {
        write_quotes($quotesFile, $quotes);
    }
    return $changed + $dupMarked + $flagsChanged;
}

/** True si el NIT (o alguna variante sin ceros / dígito de verificación) está en el set del asesor. */
function nit_in_asesor_set($nit, $nitSet) {
    if (!is_array($nitSet) || !$nitSet) {
        return false;
    }
    foreach (asesor_nit_variant_keys($nit) as $key) {
        if (!empty($nitSet[$key])) {
            return true;
        }
    }
    return false;
}

function resolve_asesor_codigo_from_bitrix_id($userId) {
    $map = bitrix_seller_map();
    $key = (string) $userId;
    if ($key === '' || !isset($map[$key])) {
        return '';
    }
    $name = strtoupper((string) $map[$key]);
    if (preg_match('/(?<![A-Z0-9])V(\d{1,4})(?![0-9])/', $name, $m)) {
        return 'V' . (string) ((int) $m[1]);
    }
    // Códigos alfabéticos (p.ej. ADV Mariana López)
    if (preg_match('/(?<![A-Z0-9])(ADV)(?![A-Z0-9])/', $name, $m)) {
        return $m[1];
    }
    return '';
}

function seller_name_from_codigo_or_id($codigo, $assigned) {
    global $asesoresFile;
    $map = bitrix_seller_map();
    $assigned = (string) $assigned;
    if ($assigned !== '' && isset($map[$assigned]) && trim((string) $map[$assigned]) !== '') {
        return trim((string) $map[$assigned]);
    }
    $code = normalize_asesor_codigo($codigo);
    if ($code !== '') {
        foreach ($map as $id => $name) {
            if (resolve_asesor_codigo_from_bitrix_id($id) === $code) {
                $n = trim((string) $name);
                if ($n !== '') {
                    return $n;
                }
            }
        }
        $asesores = read_asesores($asesoresFile);
        foreach ($asesores as $a) {
            if (normalize_asesor_codigo($a['codigo'] ?? '') === $code) {
                $n = trim((string) ($a['nombre'] ?? ''));
                return $n !== '' ? ($code . ' · ' . $n) : $code;
            }
        }
        return $code;
    }
    return '';
}

function asesor_codigo_by_client_nit_map() {
    return build_nit_to_asesor_map();
}

function find_asesor_codigo_by_client_nit($nit) {
    $n = normalize_nit($nit);
    if ($n === '') {
        return '';
    }
    $map = asesor_codigo_by_client_nit_map();
    $digits = preg_replace('/\D+/', '', $n);
    foreach ([$n, $digits, ltrim($digits, '0')] as $key) {
        if ($key !== '' && isset($map[$key]) && $map[$key] !== '') {
            return $map[$key];
        }
    }
    return '';
}

$__izcAssignVendedorFile = __DIR__ . DIRECTORY_SEPARATOR . 'admin_assign_vendedor.php';
if (is_file($__izcAssignVendedorFile)) {
    require_once $__izcAssignVendedorFile;
}
unset($__izcAssignVendedorFile);

function resolve_quote_seller_label($quote) {
    $sellerName = trim((string) ($quote['seller_name'] ?? ''));
    $sellerCodigo = normalize_asesor_codigo($quote['seller_codigo'] ?? '');
    $assigned = (string) ($quote['assigned_by_id'] ?? '');
    if ($sellerCodigo === '' && $assigned !== '') {
        $sellerCodigo = resolve_asesor_codigo_from_bitrix_id($assigned);
    }
    if ($sellerName === '') {
        $sellerName = seller_name_from_codigo_or_id($sellerCodigo, $assigned);
    }
    if ($sellerName === '') {
        $found = find_asesor_codigo_by_client_nit($quote['nit'] ?? '');
        if ($found !== '') {
            $sellerCodigo = $found;
            $sellerName = seller_name_from_codigo_or_id($found, '');
        }
    }
    return [
        'seller_codigo' => $sellerCodigo,
        'assigned_by_id' => $assigned,
        'seller_name' => $sellerName,
        'seller_label' => $sellerName !== '' ? $sellerName : $sellerCodigo,
    ];
}

function get_asesor_bitrix_ids($codigo) {
    global $asesorClientesIndexFile;
    $code = normalize_asesor_codigo($codigo);
    $ids = [];
    $codes = asesor_all_codigos($code);
    if ($codes && is_file($asesorClientesIndexFile)) {
        $data = json_decode((string) file_get_contents($asesorClientesIndexFile), true);
        if (is_array($data)) {
            foreach ($codes as $cCode) {
                if (!isset($data['by_codigo'][$cCode]['bitrix_ids']) || !is_array($data['by_codigo'][$cCode]['bitrix_ids'])) {
                    continue;
                }
                foreach ($data['by_codigo'][$cCode]['bitrix_ids'] as $id) {
                    if ($id !== null && $id !== '') {
                        $ids[(string) $id] = true;
                    }
                }
            }
        }
    }
    // Siempre sumar IDs del mapa Bitrix (aunque el índice ya tenga alguno).
    $codeSet = array_fill_keys($codes ?: [$code], true);
    foreach (bitrix_seller_map() as $id => $name) {
        $resolved = resolve_asesor_codigo_from_bitrix_id($id);
        if ($resolved !== '' && !empty($codeSet[$resolved])) {
            $ids[(string) $id] = true;
        }
    }
    return array_keys($ids);
}

function bitrix_clean_company_nit($title) {
    $t = trim((string) $title);
    if ($t === '') {
        return '';
    }
    if (preg_match('/^(\d{6,15})(-\d)?\b/', $t, $m)) {
        return $m[1];
    }
    $digits = preg_replace('/\D+/', '', $t);
    $len = strlen((string) $digits);
    return ($len >= 6 && $len <= 15) ? $digits : '';
}

function bitrix_company_display_name($co, $nit) {
    global $BITRIX_COMPANY_NAME_PRIMARY, $BITRIX_COMPANY_NAME_FALLBACK;
    $cands = [];
    foreach ([$BITRIX_COMPANY_NAME_PRIMARY, $BITRIX_COMPANY_NAME_FALLBACK, 'TITLE'] as $field) {
        $v = trim((string) ($co[$field] ?? ''));
        if ($v !== '') {
            $cands[] = $v;
        }
    }
    $best = '';
    $bestScore = -1;
    foreach ($cands as $cand) {
        $n = $cand;
        foreach (array_filter([$nit, preg_replace('/\D+/', '', (string) $nit)]) as $key) {
            $n = preg_replace('/^' . preg_quote($key, '/') . '\s*[-–:\/]\s*/iu', '', $n);
            $n = trim((string) $n);
        }
        if ($n === '' || $n === $nit) {
            continue;
        }
        $digits = preg_match_all('/\d/', $n);
        $score = strlen($n) - ((int) $digits) * 2;
        if ($score > $bestScore) {
            $bestScore = $score;
            $best = $n;
        }
    }
    return $best !== '' ? $best : ($nit !== '' ? $nit : '');
}

function bitrix_extract_phones($phoneField) {
    $vals = [];
    $seen = [];
    if ($phoneField === null || $phoneField === '') {
        return $vals;
    }
    $items = is_array($phoneField) ? $phoneField : [$phoneField];
    foreach ($items as $it) {
        $v = is_array($it) ? trim((string) ($it['VALUE'] ?? '')) : trim((string) $it);
        $v = preg_replace('/[\s\-]/', '', $v);
        if (strpos($v, '+57') === 0) {
            $v = substr($v, 3);
        } elseif (strpos($v, '0057') === 0) {
            $v = substr($v, 4);
        } elseif (preg_match('/^57\d{7,10}$/', $v)) {
            $v = substr($v, 2);
        }
        if ($v === '') {
            continue;
        }
        $key = preg_replace('/\D+/', '', $v);
        if ($key === '' || isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $vals[] = $v;
    }
    return $vals;
}

function asesor_bitrix_quotes_sync_cache_path($codigo) {
    global $asesorBitrixQuotesSyncCacheDir;
    $code = normalize_asesor_codigo($codigo);
    if ($code === '') {
        return '';
    }
    if (!is_dir($asesorBitrixQuotesSyncCacheDir)) {
        @mkdir($asesorBitrixQuotesSyncCacheDir, 0755, true);
    }
    return $asesorBitrixQuotesSyncCacheDir . DIRECTORY_SEPARATOR . $code . '.json';
}

function asesor_bitrix_clientes_cache_path($codigo) {
    global $asesorClientesBitrixCacheDir;
    $code = normalize_asesor_codigo($codigo);
    if ($code === '') {
        return '';
    }
    if (!is_dir($asesorClientesBitrixCacheDir)) {
        @mkdir($asesorClientesBitrixCacheDir, 0755, true);
    }
    return $asesorClientesBitrixCacheDir . DIRECTORY_SEPARATOR . $code . '.json';
}

/**
 * Trae compañías de Bitrix asignadas al asesor (ASSIGNED_BY_ID).
 * Cache TTL 5 min; refresh_bitrix fuerza recarga.
 * @return array{clientes:array,synced:bool,from_cache:bool,error:string,fetched_at:string}
 */
function sync_asesor_clientes_from_bitrix($codigo, $force = false, $cacheOnly = false) {
    global $ASESOR_BITRIX_CLIENTES_TTL, $BITRIX_COMPANY_NAME_PRIMARY, $BITRIX_COMPANY_NAME_FALLBACK, $asesorClientesIndexFile, $bitrixFile;
    $code = normalize_asesor_codigo($codigo);
    $empty = [
        'clientes' => [],
        'synced' => false,
        'from_cache' => false,
        'error' => '',
        'fetched_at' => '',
    ];
    if ($code === '') {
        $empty['error'] = 'Código asesor vacío.';
        return $empty;
    }

    $cachePath = asesor_bitrix_clientes_cache_path($code);
    if (!$force && $cachePath !== '' && is_file($cachePath)) {
        $cached = json_decode((string) file_get_contents($cachePath), true);
        $fetchedAt = (string) ($cached['fetched_at'] ?? '');
        $ts = $fetchedAt !== '' ? strtotime($fetchedAt) : false;
        $fresh = $ts && (time() - $ts) < $ASESOR_BITRIX_CLIENTES_TTL;
        if (is_array($cached) && ($fresh || $cacheOnly)) {
            return [
                'clientes' => is_array($cached['clientes'] ?? null) ? $cached['clientes'] : [],
                'synced' => true,
                'from_cache' => true,
                'error' => '',
                'fetched_at' => $fetchedAt,
            ];
        }
    }
    if ($cacheOnly) {
        return $empty;
    }

    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled']) || empty($cfg['webhook_base'])) {
        $empty['error'] = 'Bitrix no configurado.';
        return $empty;
    }
    $ids = get_asesor_bitrix_ids($code);
    if (!$ids) {
        $empty['error'] = 'Asesor sin ID Bitrix mapeado.';
        return $empty;
    }

    $byNit = [];
    foreach ($ids as $assignedId) {
        $start = 0;
        do {
            $payload = [
                'filter' => ['ASSIGNED_BY_ID' => (int) $assignedId],
                'select' => [
                    'ID',
                    'TITLE',
                    'ASSIGNED_BY_ID',
                    'PHONE',
                    $BITRIX_COMPANY_NAME_PRIMARY,
                    $BITRIX_COMPANY_NAME_FALLBACK,
                ],
                'order' => ['ID' => 'ASC'],
                'start' => $start,
            ];
            $resp = bitrix_rest($cfg['webhook_base'], 'crm.company.list.json', $payload);
            if (!is_array($resp) || empty($resp['result']) || !is_array($resp['result'])) {
                if (!empty($resp['error'])) {
                    $empty['error'] = 'Bitrix: ' . (string) ($resp['error_description'] ?? $resp['error']);
                }
                break;
            }
            foreach ($resp['result'] as $co) {
                if (!is_array($co)) {
                    continue;
                }
                $nit = bitrix_clean_company_nit($co['TITLE'] ?? '');
                if ($nit === '') {
                    continue;
                }
                $nombre = bitrix_company_display_name($co, $nit);
                $phones = bitrix_extract_phones($co['PHONE'] ?? null);
                $telefono = $phones ? implode(' / ', $phones) : '';
                if (!isset($byNit[$nit])) {
                    $byNit[$nit] = [
                        'nit' => $nit,
                        'nombre' => $nombre !== '' ? $nombre : $nit,
                        'telefono' => $telefono,
                        'manual' => false,
                        'source' => 'bitrix',
                    ];
                } else {
                    if (($byNit[$nit]['nombre'] === $nit || $byNit[$nit]['nombre'] === '') && $nombre !== '' && $nombre !== $nit) {
                        $byNit[$nit]['nombre'] = $nombre;
                    }
                    if ($byNit[$nit]['telefono'] === '' && $telefono !== '') {
                        $byNit[$nit]['telefono'] = $telefono;
                    }
                }
            }
            if (isset($resp['next'])) {
                $start = (int) $resp['next'];
            } else {
                $start = -1;
            }
        } while ($start >= 0);
    }

    $clientes = array_values($byNit);
    usort($clientes, function ($a, $b) {
        return strcasecmp((string) ($a['nombre'] ?? ''), (string) ($b['nombre'] ?? ''));
    });
    $fetchedAt = date('c');
    $payload = [
        'fetched_at' => $fetchedAt,
        'codigo' => $code,
        'bitrix_ids' => $ids,
        'count' => count($clientes),
        'clientes' => $clientes,
    ];
    if ($cachePath !== '') {
        @file_put_contents($cachePath, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n", LOCK_EX);
    }

    // Actualiza solo este asesor en el índice estático (para otros usos del panel).
    if (is_file($asesorClientesIndexFile)) {
        $idx = json_decode((string) file_get_contents($asesorClientesIndexFile), true);
        if (!is_array($idx)) {
            $idx = [];
        }
        if (!isset($idx['by_codigo']) || !is_array($idx['by_codigo'])) {
            $idx['by_codigo'] = [];
        }
        $prevIds = [];
        if (isset($idx['by_codigo'][$code]['bitrix_ids']) && is_array($idx['by_codigo'][$code]['bitrix_ids'])) {
            $prevIds = $idx['by_codigo'][$code]['bitrix_ids'];
        }
        $prevClientes = [];
        if (isset($idx['by_codigo'][$code]['clientes']) && is_array($idx['by_codigo'][$code]['clientes'])) {
            $prevClientes = $idx['by_codigo'][$code]['clientes'];
        }
        $byNit = [];
        foreach ($prevClientes as $c) {
            if (!is_array($c)) {
                continue;
            }
            $nit = normalize_nit($c['nit'] ?? '');
            if ($nit !== '') {
                $byNit[$nit] = $c;
            }
        }
        foreach ($clientes as $c) {
            if (!is_array($c)) {
                continue;
            }
            $nit = normalize_nit($c['nit'] ?? '');
            if ($nit !== '') {
                $byNit[$nit] = [
                    'nit' => $nit,
                    'nombre' => $c['nombre'] ?? ($byNit[$nit]['nombre'] ?? ''),
                    'telefono' => $c['telefono'] ?? ($byNit[$nit]['telefono'] ?? ''),
                ];
            }
        }
        $mergedClientes = array_values($byNit);
        if (count($mergedClientes) === 0 && count($prevClientes) > 0) {
            $mergedClientes = $prevClientes;
        }
        $idx['by_codigo'][$code] = [
            'bitrix_ids' => $prevIds ?: $ids,
            'count' => count($mergedClientes),
            'clientes' => $mergedClientes,
        ];
        $idx['built_at'] = $fetchedAt;
        $idx['source'] = 'bitrix live sync + bitrix_vendedores.json';
        izc_atomic_write_json($asesorClientesIndexFile, $idx);
    }

    return [
        'clientes' => $clientes,
        'synced' => true,
        'from_cache' => false,
        'error' => '',
        'fetched_at' => $fetchedAt,
    ];
}

function quote_is_duplicated($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (!empty($quote['is_duplicated']) || !empty($quote['duplicated'])) {
        return true;
    }
    return trim((string) ($quote['duplicated_from'] ?? ($quote['recotizado_desde'] ?? ''))) !== '';
}

/** Recotización hecha por el asesor en el cotizador (independiente de la original). */
function quote_is_advisor_recotizada($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (($quote['quote_source'] ?? '') !== 'asesor') {
        return false;
    }
    return trim((string) ($quote['duplicated_from'] ?? ($quote['recotizado_desde'] ?? ''))) !== '';
}

/** No copiar estado/empresa desde la cotización madre (solo duplicados Bitrix automáticos). */
function quote_skip_canonical_metadata_sync($quote) {
    return quote_is_advisor_recotizada($quote);
}

/** Asegura marcas de recotización del asesor (datos antiguos sin recotizado_desde). */
function repair_advisor_recotizada_flags(&$quotes) {
    if (!is_array($quotes)) {
        return 0;
    }
    $changed = 0;
    foreach ($quotes as &$q) {
        if (!is_array($q) || ($q['quote_source'] ?? '') !== 'asesor') {
            continue;
        }
        $src = trim((string) ($q['duplicated_from'] ?? ($q['recotizado_desde'] ?? '')));
        if ($src === '') {
            continue;
        }
        $local = false;
        if (empty($q['recotizado_desde'])) {
            $q['recotizado_desde'] = $src;
            $local = true;
        }
        if (empty($q['duplicated_from'])) {
            $q['duplicated_from'] = $src;
            $local = true;
        }
        if (empty($q['is_duplicated'])) {
            $q['is_duplicated'] = true;
            $local = true;
        }
        if ($local) {
            $changed++;
        }
    }
    unset($q);
    return $changed;
}

/** Cotización visible en pestaña Duplicadas: solo recotizaciones del asesor. */
function quote_in_duplicadas_panel($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (($quote['quote_source'] ?? '') !== 'asesor') {
        return false;
    }
    if (!empty($quote['recotizado_by']) || !empty($quote['recotizado_at'])) {
        return true;
    }
    if (!empty($quote['recotizado_desde'])) {
        return true;
    }
    // Compat: recotizaciones viejas solo con duplicated_from (sin duplicate_kind Bitrix).
    $from = trim((string) ($quote['duplicated_from'] ?? ''));
    if ($from === '') {
        return false;
    }
    if (($quote['duplicate_kind'] ?? '') === 'bitrix_same_amount') {
        return false;
    }
    return true;
}

/** Hereda vendedor/Bitrix de la cotización origen para que el asesor la vea. */
function repair_recotizada_asesor_visibility(&$quotes) {
    if (!is_array($quotes)) {
        return 0;
    }
    $byId = [];
    foreach ($quotes as $i => $q) {
        if (!is_array($q)) {
            continue;
        }
        $id = trim((string) ($q['id'] ?? ''));
        if ($id !== '') {
            $byId[$id] = $i;
        }
    }
    $changed = 0;
    foreach ($quotes as &$q) {
        if (!is_array($q)) {
            continue;
        }
        $srcId = trim((string) ($q['duplicated_from'] ?? ($q['recotizado_desde'] ?? '')));
        $src = null;
        if ($srcId !== '' && isset($byId[$srcId])) {
            $src = $quotes[$byId[$srcId]] ?? null;
        }
        if (is_array($src)) {
            foreach (['seller_codigo', 'assigned_by_id', 'seller_name'] as $field) {
                if (trim((string) ($q[$field] ?? '')) === '' && trim((string) ($src[$field] ?? '')) !== '') {
                    $q[$field] = $src[$field];
                    $changed++;
                }
            }
        }
        $recotBy = normalize_asesor_codigo($q['recotizado_by'] ?? '');
        if ($recotBy !== '' && normalize_asesor_codigo($q['seller_codigo'] ?? '') === '') {
            $q['seller_codigo'] = $recotBy;
            $changed++;
        }
        if ($recotBy !== '' && empty($q['is_duplicated'])) {
            $q['is_duplicated'] = true;
            $changed++;
        }
    }
    unset($q);
    return $changed;
}

/** Quita marca duplicada huérfana (desaparecía del historial y de duplicadas). */
function repair_orphan_duplicate_flags(&$quotes) {
    if (!is_array($quotes)) {
        return 0;
    }
    $byId = [];
    foreach ($quotes as $q) {
        if (!is_array($q)) {
            continue;
        }
        $id = trim((string) ($q['id'] ?? ''));
        if ($id !== '') {
            $byId[$id] = true;
        }
    }
    $changed = 0;
    foreach ($quotes as &$q) {
        if (!is_array($q)) {
            continue;
        }
        if (quote_is_advisor_recotizada($q)) {
            continue;
        }
        if (!empty($q['recotizado_by']) || !empty($q['recotizado_at'])) {
            continue;
        }
        if (!empty($q['is_duplicated']) || !empty($q['duplicated'])) {
            $src = trim((string) ($q['duplicated_from'] ?? ($q['recotizado_desde'] ?? '')));
            if ($src === '' || !isset($byId[$src])) {
                unset($q['duplicated_from'], $q['recotizado_desde'], $q['is_duplicated'], $q['duplicated']);
                $changed++;
            }
        }
    }
    unset($q);
    return $changed;
}

/** Repara visibilidad en panel asesor antes de listar. */
function prepare_quotes_for_asesor_panels(&$quotes) {
    if (!is_array($quotes)) {
        return 0;
    }
    $changed = repair_advisor_recotizada_flags($quotes);
    $changed += repair_recotizada_asesor_visibility($quotes);
    reset_auto_duplicate_flags($quotes);
    $changed += mark_duplicate_quotes_by_nit($quotes);
    $changed += repair_orphan_duplicate_flags($quotes);
    return $changed;
}

/** Cotización hecha por el cliente en el cotizador del portal (no asesor / no Bitrix / no SAT / no GP). */
function quote_is_made_by_cliente($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (function_exists('is_zkteco_login_id')) {
        if (is_zkteco_login_id($quote['nit'] ?? '') || is_zkteco_login_id($quote['seller_codigo'] ?? '')) {
            return false;
        }
    }
    if (function_exists('is_sat_login_id')) {
        foreach (['nit', 'seller_codigo', 'asesor_cotizado_by', 'finished_by', 'sat_user'] as $k) {
            if (is_sat_login_id($quote[$k] ?? '')) {
                return false;
            }
        }
    }
    if (function_exists('is_gp_login_id')) {
        foreach (['nit', 'seller_codigo', 'asesor_cotizado_by', 'finished_by', 'gp_codigo'] as $k) {
            if (is_gp_login_id($quote[$k] ?? '')) {
                return false;
            }
        }
    }
    $src = strtolower(trim((string) ($quote['quote_source'] ?? '')));
    // No contar cotizador interno ni sync Bitrix.
    if (in_array($src, ['zkteco', 'asesor', 'zebra', 'sat', 'gp', 'bitrix', 'izc'], true)) {
        return false;
    }
    // Solo portal del cliente.
    if ($src === 'cliente' || $src === 'portal') {
        return true;
    }
    // Legado: save_quote del portal siempre pide fecha_cierre_cliente (sin quote_source).
    if (trim((string) ($quote['fecha_cierre_cliente'] ?? '')) !== '') {
        // Si ya fue cotizada por asesor/GP/SAT, no es "cotización cliente".
        $by = strtoupper(trim((string) ($quote['asesor_cotizado_by'] ?? ($quote['finished_by'] ?? ''))));
        if ($by !== '' && $by !== 'CLIENTE') {
            return false;
        }
        return true;
    }
    return false;
}


/** Bitrix IDs de todos los GP (gerentes de producto). */
function all_gp_bitrix_id_set() {
    static $set = null;
    if ($set !== null) {
        return $set;
    }
    global $bitrixGerentesFile;
    $set = [];
    if (function_exists('read_gerentes_producto')) {
        foreach (read_gerentes_producto() as $g) {
            if (!is_array($g)) {
                continue;
            }
            $bid = trim((string) ($g['bitrix_id'] ?? ''));
            if ($bid !== '') {
                $set[$bid] = true;
            }
            $code = normalize_gp_codigo($g['codigo'] ?? '');
            if ($code !== '' && function_exists('get_gp_bitrix_ids')) {
                foreach (get_gp_bitrix_ids($code) as $id) {
                    if ($id !== '') {
                        $set[(string) $id] = true;
                    }
                }
            }
        }
    }
    if (is_file($bitrixGerentesFile)) {
        $map = json_decode((string) file_get_contents($bitrixGerentesFile), true);
        if (is_array($map)) {
            foreach ($map as $id => $_label) {
                $sid = trim((string) $id);
                if ($sid !== '') {
                    $set[$sid] = true;
                }
            }
        }
    }
    return $set;
}

/** NIT pertenece a un asesor/vendedor (V#), no solo a un GP. */
function quote_client_belongs_to_asesor($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (function_exists('is_gp_login_id') && is_gp_login_id($quote['seller_codigo'] ?? '')) {
        return false;
    }
    $assigned = trim((string) ($quote['assigned_by_id'] ?? ''));
    if ($assigned !== '') {
        $gpIds = all_gp_bitrix_id_set();
        if (isset($gpIds[$assigned])) {
            // Dueño Bitrix es GP: no entra en Cotizaciones clientes del admin IZC.
            return false;
        }
        if (function_exists('resolve_asesor_codigo_from_bitrix_id') && resolve_asesor_codigo_from_bitrix_id($assigned) !== '') {
            return true;
        }
    }
    $seller = function_exists('normalize_asesor_codigo')
        ? normalize_asesor_codigo($quote['seller_codigo'] ?? '')
        : strtoupper(trim((string) ($quote['seller_codigo'] ?? '')));
    if ($seller !== '' && preg_match('/^V\d+/', $seller)) {
        return true;
    }
    if ($seller === 'ADV') {
        return true;
    }
    $nit = function_exists('normalize_nit') ? normalize_nit($quote['nit'] ?? '') : trim((string) ($quote['nit'] ?? ''));
    if ($nit === '') {
        return false;
    }
    if (!function_exists('build_nit_to_asesor_map') || !function_exists('asesor_nit_variant_keys')) {
        return false;
    }
    $map = build_nit_to_asesor_map();
    foreach (asesor_nit_variant_keys($nit) as $key) {
        if (isset($map[$key])) {
            return true;
        }
    }
    return false;
}

/** El NIT de la cotización sigue registrado en usuarios.json (portal). */
function quote_portal_client_is_registered($quote) {
    global $usersFile;
    if (!is_array($quote)) {
        return false;
    }
    $nit = function_exists('normalize_nit') ? normalize_nit($quote['nit'] ?? '') : trim((string) ($quote['nit'] ?? ''));
    if ($nit === '') {
        return false;
    }
    if (!function_exists('read_users') || !function_exists('find_user')) {
        return false;
    }
    $users = read_users($usersFile);
    [, $user] = find_user($users, $nit);
    return is_array($user);
}

/** NIT / responsable Bitrix pertenece a un GP (gerente de producto). */
function quote_client_belongs_to_gp($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (function_exists('is_gp_login_id') && is_gp_login_id($quote['seller_codigo'] ?? '')) {
        return true;
    }
    $assigned = trim((string) ($quote['assigned_by_id'] ?? ''));
    if ($assigned !== '') {
        $gpIds = all_gp_bitrix_id_set();
        if (isset($gpIds[$assigned])) {
            return true;
        }
    }
    $nit = function_exists('normalize_nit') ? normalize_nit($quote['nit'] ?? '') : trim((string) ($quote['nit'] ?? ''));
    if ($nit === '') {
        return false;
    }
    $cacheDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'gp_bitrix_clientes_cache';
    if (is_dir($cacheDir)) {
        foreach (glob($cacheDir . DIRECTORY_SEPARATOR . 'GP*.json') ?: [] as $path) {
            $cached = json_decode((string) file_get_contents($path), true);
            if (!is_array($cached)) {
                continue;
            }
            foreach ((is_array($cached['clientes'] ?? null) ? $cached['clientes'] : []) as $c) {
                if (!is_array($c)) {
                    continue;
                }
                $cn = function_exists('normalize_nit') ? normalize_nit($c['nit'] ?? '') : trim((string) ($c['nit'] ?? ''));
                if ($cn !== '' && ($cn === $nit || ltrim($cn, '0') === ltrim($nit, '0'))) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Admin IZC "Cotizaciones clientes":
 * portal + usuario aún registrado + cliente de asesor/vendedor (no GP).
 */
function quote_is_admin_client_quote($quote) {
    if (!function_exists('quote_is_made_by_cliente') || !quote_is_made_by_cliente($quote)) {
        return false;
    }
    // Cotizaciones de usuarios borrados (p.ej. al subir usuarios.json) no cuentan.
    if (!quote_portal_client_is_registered($quote)) {
        return false;
    }
    // Clientes de GP van al Admin SAT, no aquí.
    if (quote_client_belongs_to_gp($quote) && !quote_client_belongs_to_asesor($quote)) {
        return false;
    }
    return quote_client_belongs_to_asesor($quote);
}

/** Cotización hecha por Admin ZKTECO en el cotizador-asesor. */
function quote_is_made_by_zkteco($quote) {
    if (!is_array($quote)) {
        return false;
    }
    $src = strtolower(trim((string) ($quote['quote_source'] ?? '')));
    if ($src === 'zkteco' || $src === 'zebra') {
        return true;
    }
    if (function_exists('is_zkteco_login_id')) {
        foreach (['seller_codigo', 'asesor_cotizado_by', 'zkteco_user', 'finished_by'] as $k) {
            if (is_zkteco_login_id($quote[$k] ?? '')) {
                return true;
            }
        }
    }
    return false;
}

/** Cotización hecha por el cliente (portal), visible en pestaña Cotizaciones Cliente. */
function quote_is_cliente_nueva_for_asesor($quote, $nitSet) {
    if (!is_array($quote)) {
        return false;
    }
    // Si el asesor ya terminó/cotizó esta fila, pasa a Historial (no a Cotizaciones Cliente).
    if (trim((string) ($quote['asesor_cotizado_at'] ?? '')) !== '') {
        return false;
    }
    if (trim((string) ($quote['finished_at'] ?? '')) !== '') {
        return false;
    }
    $estado = strtolower(trim((string) ($quote['asesor_estado'] ?? '')));
    if ($estado !== '' && $estado !== 'nueva' && $estado !== 'nuevo' && $estado !== 'new') {
        return false;
    }
    if (!quote_is_made_by_cliente($quote)) {
        return false;
    }
    return nit_in_asesor_set(quote_effective_nit($quote), $nitSet);
}

/** Última cotización "Cotizaciones Cliente" pendiente del NIT (para adoptar al terminar sin quote_id). */
function find_latest_cliente_nueva_quote_id($quotes, $codigo, $clientNit) {
    $want = normalize_nit($clientNit);
    if ($want === '' || !is_array($quotes)) {
        return '';
    }
    $nitSet = asesor_nit_variants_set($codigo);
    $bestId = '';
    $bestAt = '';
    foreach ($quotes as $q) {
        if (!is_array($q) || !quote_is_cliente_nueva_for_asesor($q, $nitSet)) {
            continue;
        }
        if (normalize_nit(quote_effective_nit($q)) !== $want) {
            continue;
        }
        $id = trim((string) ($q['id'] ?? ''));
        if ($id === '') {
            continue;
        }
        $at = (string) ($q['created_at'] ?? '');
        if ($bestId === '' || $at > $bestAt) {
            $bestId = $id;
            $bestAt = $at;
        }
    }
    return $bestId;
}

function parse_izc_quote_id_from_bitrix_comments($comments) {
    $text = (string) $comments;
    if (preg_match('/ID IZC:\s*(\S+)/u', $text, $m)) {
        return trim((string) $m[1]);
    }
    return '';
}

function bitrix_stage_to_asesor_estado($stageId, $cfg) {
    $s = trim((string) $stageId);
    if ($s === '') {
        return 'cotizado';
    }
    $map = is_array($cfg['stage_map'] ?? null) ? $cfg['stage_map'] : [];
    if (isset($map[$s]) && trim((string) $map[$s]) !== '') {
        return normalize_quote_pipeline_estado((string) $map[$s]) ?: 'cotizado';
    }
    $pairs = [
        trim((string) ($cfg['stage_id'] ?? '')) => 'cotizado',
        trim((string) ($cfg['stage_cotizado'] ?? '')) => 'cotizado',
        trim((string) ($cfg['stage_seguimiento'] ?? '')) => 'seguimiento',
        trim((string) ($cfg['stage_seguimiento_2'] ?? '')) => 'seguimiento',
        trim((string) ($cfg['stage_seguimiento_3'] ?? '')) => 'seguimiento',
        trim((string) ($cfg['stage_vendido'] ?? '')) => 'vendido',
        trim((string) ($cfg['stage_vendido_2'] ?? '')) => 'vendido',
        trim((string) ($cfg['stage_perdida'] ?? '')) => 'perdida',
        trim((string) ($cfg['stage_perdida_2'] ?? '')) => 'perdida',
        trim((string) ($cfg['stage_pendiente'] ?? '')) => 'pendiente',
        trim((string) ($cfg['stage_cerrado_modificado'] ?? '')) => 'cerrado_modificado',
        trim((string) ($cfg['stage_duplicada_recotizada'] ?? '')) => 'cotizado',
        'C3:UC_M9PUWP' => 'cotizado', // DUPLICADA RECOTIZADA
    ];
    foreach ($pairs as $stage => $estado) {
        if ($stage !== '' && $stage === $s) {
            return $estado;
        }
    }
    return 'cotizado';
}

/**
 * Panel → Bitrix STAGE_ID (columnas del embudo).
 * Cotizado→COTIZACION, Pendiente→PENDIENTE, Seguimiento→SEGUIMIENTO,
 * Vendido→CERRADO GANADO, Perdida→CERRADO PERDIDO, Cerrado modificado→CERRADO MODIFICADO.
 * Recotizadas del asesor (estado cotizado) → DUPLICADA RECOTIZADA.
 */
function asesor_estado_to_bitrix_stage($estado, $cfg) {
    $estado = normalize_quote_pipeline_estado($estado);
    if ($estado === '') {
        return '';
    }
    $cfg = is_array($cfg) ? $cfg : [];
    $prefer = [
        'cotizado' => ['stage_cotizado', 'stage_id'],
        'pendiente' => ['stage_pendiente'],
        // Solo la columna amarilla "1 SEGUIMIENTO" (no 2/3 SEGUIMIENTO).
        'seguimiento' => ['stage_seguimiento'],
        // Columna "CERRADO GANADO" (EXECUTING), luego WON de respaldo.
        'vendido' => ['stage_vendido', 'stage_vendido_2'],
        'perdida' => ['stage_perdida', 'stage_perdida_2'],
        'cerrado_modificado' => ['stage_cerrado_modificado'],
    ];
    foreach (($prefer[$estado] ?? []) as $key) {
        $stage = trim((string) ($cfg[$key] ?? ''));
        if ($stage !== '') {
            return $stage;
        }
    }
    // Fallback: invertir stage_map si está configurado.
    $map = is_array($cfg['stage_map'] ?? null) ? $cfg['stage_map'] : [];
    foreach ($map as $stageId => $mappedEstado) {
        if (normalize_quote_pipeline_estado($mappedEstado) === $estado) {
            $stageId = trim((string) $stageId);
            if ($stageId !== '') {
                return $stageId;
            }
        }
    }
    // Defaults del embudo IZC (category 3) — evita el aviso si bitrix.json no trae stage_*.
    $defaults = [
        'cotizado' => 'C3:FINAL_INVOICE',           // COTIZACION
        'pendiente' => 'C3:UC_G99HUH',               // PENDIENTE
        'seguimiento' => 'C3:NEW',                   // 1 SEGUIMIENTO (amarilla)
        'vendido' => 'C3:EXECUTING',                 // CERRADO GANADO
        'perdida' => 'C3:UC_S78RLD',                 // CERRADO PERDIDO
        'cerrado_modificado' => 'C3:UC_MGTF3H',      // CERRADO MODIFICADO
    ];
    return trim((string) ($defaults[$estado] ?? ''));
}

/** STAGE_ID de la columna Bitrix "DUPLICADA RECOTIZADA". */
function bitrix_stage_duplicada_recotizada($cfg) {
    $cfg = is_array($cfg) ? $cfg : [];
    $stage = trim((string) ($cfg['stage_duplicada_recotizada'] ?? ''));
    if ($stage !== '') {
        return $stage;
    }
    $map = is_array($cfg['stage_map'] ?? null) ? $cfg['stage_map'] : [];
    foreach ($map as $stageId => $mapped) {
        $m = strtolower(trim((string) $mapped));
        if ($m === 'duplicada_recotizada' || $m === 'recotizada' || $m === 'duplicada') {
            $stageId = trim((string) $stageId);
            if ($stageId !== '') {
                return $stageId;
            }
        }
    }
    return 'C3:UC_M9PUWP';
}

/**
 * Columna Bitrix para una cotización: recotizadas del asesor van a DUPLICADA RECOTIZADA
 * cuando el estado del panel es cotizado (o al crear el deal).
 */
function bitrix_stage_id_for_quote($quote, $cfg, $estado = 'cotizado') {
    $estadoNorm = normalize_quote_pipeline_estado($estado);
    if ($estadoNorm === '') {
        $estadoNorm = 'cotizado';
    }
    if (
        is_array($quote)
        && ($estadoNorm === 'cotizado')
        && (quote_is_advisor_recotizada($quote) || quote_in_duplicadas_panel($quote))
    ) {
        return bitrix_stage_duplicada_recotizada($cfg);
    }
    return asesor_estado_to_bitrix_stage($estadoNorm, $cfg);
}

/** Mueve la negociación Bitrix a la columna del estado del panel. */
function push_quote_estado_to_bitrix($quote, $estado) {
    global $bitrixFile;
    if (!is_array($quote)) {
        return ['ok' => false, 'skipped' => true, 'error' => 'Cotización inválida.'];
    }
    $dealId = trim((string) ($quote['bitrix_deal_id'] ?? ''));
    if ($dealId === '' || !ctype_digit($dealId)) {
        return ['ok' => false, 'skipped' => true, 'error' => 'La cotización no tiene negociación Bitrix.'];
    }
    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled'])) {
        return ['ok' => false, 'skipped' => true, 'error' => 'Bitrix desactivado.'];
    }
    if (trim((string) ($cfg['webhook_base'] ?? '')) === '') {
        return ['ok' => false, 'skipped' => true, 'error' => 'Falta webhook de Bitrix.'];
    }
    $stageId = bitrix_stage_id_for_quote($quote, $cfg, $estado);
    if ($stageId === '') {
        return [
            'ok' => false,
            'skipped' => true,
            'error' => 'No hay STAGE_ID configurado para el estado "' . $estado . '". Revisa data/bitrix.json.',
        ];
    }
    $fields = ['STAGE_ID' => $stageId];
    // No enviar CATEGORY_ID: el STAGE_ID ya incluye el embudo (C3:…) y forzar
    // categoría puede fallar o confundir el update.
    $result = bitrix_rest($cfg['webhook_base'], 'crm.deal.update.json', [
        'id' => (int) $dealId,
        'fields' => $fields,
    ]);
    if ($result === null) {
        return ['ok' => false, 'skipped' => false, 'error' => 'No se pudo contactar Bitrix.', 'deal_id' => $dealId, 'stage_id' => $stageId];
    }
    if (!empty($result['error'])) {
        $errCode = strtoupper(trim((string) ($result['error'] ?? '')));
        $err = isset($result['error_description']) ? (string) $result['error_description'] : (string) $result['error'];
        if (
            $errCode === 'ERROR_WRONG_AUTH'
            || $errCode === 'WRONG_AUTH'
            || stripos($err, 'Invalid request credentials') !== false
            || stripos($err, 'credential') !== false
        ) {
            $err = 'Webhook Bitrix inválido o revocado. En Admin → Bitrix pega un webhook nuevo, pulsa Probar y Guardar (o sube data/bitrix.json con un webhook vigente).';
        }
        return ['ok' => false, 'skipped' => false, 'error' => $err, 'deal_id' => $dealId, 'stage_id' => $stageId, 'error_code' => $errCode];
    }
    return [
        'ok' => true,
        'skipped' => false,
        'deal_id' => $dealId,
        'stage_id' => $stageId,
        'estado' => normalize_quote_pipeline_estado($estado),
    ];
}

/**
 * Empuja a Bitrix los estados que ya tiene el asesor en el panel
 * (Perdida, Seguimiento, Cerrado modificado, etc.) sin cambiarlos a mano.
 */
function push_asesor_estados_to_bitrix($codigo, $max = 150) {
    global $quotesFile, $bitrixFile;
    $code = normalize_asesor_codigo($codigo);
    $out = [
        'ok' => true,
        'pushed' => 0,
        'updated' => 0,
        'failed' => 0,
        'skipped' => 0,
        'error' => '',
        'errors' => [],
    ];
    if ($code === '') {
        $out['ok'] = false;
        $out['error'] = 'Código asesor vacío.';
        return $out;
    }
    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled']) || trim((string) ($cfg['webhook_base'] ?? '')) === '') {
        $out['ok'] = false;
        $out['error'] = 'Bitrix no configurado.';
        return $out;
    }
    $quotes = read_quotes($quotesFile);
    $nitSet = asesor_nit_variants_set($code);
    $bitrixIds = array_fill_keys(get_asesor_bitrix_ids($code), true);
    $changed = false;
    $attempts = 0;
    foreach ($quotes as &$q) {
        if (!is_array($q) || !quote_matches_asesor($q, $code, $nitSet, $bitrixIds)) {
            continue;
        }
        $estado = quote_asesor_estado($q);
        if ($estado === 'nueva') {
            $out['skipped']++;
            continue;
        }
        $dealId = trim((string) ($q['bitrix_deal_id'] ?? ''));
        if ($dealId === '' || !ctype_digit($dealId)) {
            $out['skipped']++;
            continue;
        }
        $stageId = bitrix_stage_id_for_quote($q, $cfg, $estado);
        if ($stageId === '') {
            $out['skipped']++;
            continue;
        }
        // Ya sincronizado a esa columna: no repetir.
        if (
            trim((string) ($q['asesor_estado_bitrix_stage'] ?? '')) === $stageId
            && trim((string) ($q['asesor_estado_bitrix_for'] ?? '')) === $estado
        ) {
            $out['skipped']++;
            continue;
        }
        if ($attempts >= $max) {
            break;
        }
        $attempts++;
        $out['pushed']++;
        $res = push_quote_estado_to_bitrix($q, $estado);
        if (!empty($res['ok'])) {
            $out['updated']++;
            $q['asesor_estado_bitrix_stage'] = $stageId;
            $q['asesor_estado_bitrix_for'] = $estado;
            $q['asesor_estado_bitrix_at'] = date('c');
            $changed = true;
        } elseif (!empty($res['skipped'])) {
            $out['skipped']++;
        } else {
            $out['failed']++;
            $err = trim((string) ($res['error'] ?? 'Error Bitrix'));
            if ($err !== '' && count($out['errors']) < 5) {
                $out['errors'][] = '#' . $dealId . ': ' . $err;
            }
            if ($out['error'] === '' && $err !== '') {
                $out['error'] = $err;
            }
            // Credenciales rotas: no seguir martillando.
            if (!empty($res['error_code']) && in_array(strtoupper((string) $res['error_code']), ['ERROR_WRONG_AUTH', 'WRONG_AUTH'], true)) {
                break;
            }
            if (stripos($err, 'Webhook Bitrix inválido') !== false) {
                break;
            }
        }
    }
    unset($q);
    if ($changed) {
        write_quotes($quotesFile, $quotes);
        $cache = &quotes_memory_cache();
        $cache[quotes_cache_key($quotesFile)] = array_values($quotes);
    }
    if ($out['failed'] > 0 && $out['updated'] === 0) {
        $out['ok'] = false;
    }
    return $out;
}

/**
 * Mueve a Bitrix (columna DUPLICADA RECOTIZADA) todas las recotizaciones del asesor
 * que ya existen y tienen N° de negociación.
 */
function push_recotizadas_to_bitrix_duplicada($max = 300) {
    global $quotesFile, $bitrixFile;
    $out = [
        'ok' => true,
        'pushed' => 0,
        'updated' => 0,
        'failed' => 0,
        'skipped' => 0,
        'error' => '',
        'errors' => [],
    ];
    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled']) || trim((string) ($cfg['webhook_base'] ?? '')) === '') {
        $out['ok'] = false;
        $out['error'] = 'Bitrix no configurado.';
        return $out;
    }
    $target = bitrix_stage_duplicada_recotizada($cfg);
    if ($target === '') {
        $out['ok'] = false;
        $out['error'] = 'Falta STAGE_ID de DUPLICADA RECOTIZADA.';
        return $out;
    }
    $max = max(1, min(500, (int) $max));
    $quotes = read_quotes($quotesFile);
    $changed = false;
    $attempts = 0;
    foreach ($quotes as &$q) {
        if (!is_array($q)) {
            continue;
        }
        if (!quote_is_advisor_recotizada($q) && !quote_in_duplicadas_panel($q)) {
            continue;
        }
        $dealId = trim((string) ($q['bitrix_deal_id'] ?? ''));
        if ($dealId === '' || !ctype_digit($dealId)) {
            $out['skipped']++;
            continue;
        }
        if (trim((string) ($q['asesor_estado_bitrix_stage'] ?? '')) === $target) {
            $out['skipped']++;
            continue;
        }
        if ($attempts >= $max) {
            break;
        }
        $attempts++;
        $out['pushed']++;
        $result = bitrix_rest($cfg['webhook_base'], 'crm.deal.update.json', [
            'id' => (int) $dealId,
            'fields' => ['STAGE_ID' => $target],
        ]);
        if ($result === null) {
            $out['failed']++;
            $out['error'] = 'No se pudo contactar Bitrix.';
            break;
        }
        if (!empty($result['error'])) {
            $out['failed']++;
            $err = isset($result['error_description']) ? (string) $result['error_description'] : (string) $result['error'];
            if ($err !== '' && count($out['errors']) < 8) {
                $out['errors'][] = '#' . $dealId . ': ' . $err;
            }
            if ($out['error'] === '' && $err !== '') {
                $out['error'] = $err;
            }
            $errCode = strtoupper(trim((string) ($result['error'] ?? '')));
            if ($errCode === 'ERROR_WRONG_AUTH' || $errCode === 'WRONG_AUTH' || stripos($err, 'credential') !== false) {
                break;
            }
            continue;
        }
        $out['updated']++;
        $q['asesor_estado_bitrix_stage'] = $target;
        $q['asesor_estado_bitrix_for'] = 'duplicada_recotizada';
        $q['asesor_estado_bitrix_at'] = date('c');
        $changed = true;
    }
    unset($q);
    if ($changed) {
        write_quotes($quotesFile, $quotes);
        $cache = &quotes_memory_cache();
        $cache[quotes_cache_key($quotesFile)] = array_values($quotes);
    }
    if ($out['failed'] > 0 && $out['updated'] === 0) {
        $out['ok'] = false;
    }
    return $out;
}

function bitrix_product_rows_to_quote_items($rows, $currency) {
    $items = [];
    $currency = strtoupper(trim((string) $currency));
    if ($currency !== 'USD') {
        $currency = 'COP';
    }
    foreach ((array) $rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $productName = trim((string) ($row['PRODUCT_NAME'] ?? ''));
        $sku = '';
        $name = $productName;
        if (preg_match('/^([^\-]+)\-(.+)$/u', $productName, $m)) {
            $sku = trim((string) $m[1]);
            $name = trim((string) $m[2]);
        }
        $qty = isset($row['QUANTITY']) ? (float) $row['QUANTITY'] : 1.0;
        if ($qty <= 0) {
            $qty = 1.0;
        }
        $price = isset($row['PRICE']) ? (float) $row['PRICE'] : 0.0;
        $item = [
            'sku' => $sku,
            'name' => $name !== '' ? $name : $sku,
            'referencia' => $name !== '' ? $name : $sku,
            'qty' => $qty,
            'currency' => $currency,
        ];
        if ($currency === 'USD') {
            $item['usdIva'] = $price;
            $item['totalUsdIva'] = $price * $qty;
        } else {
            $item['copIva'] = $price;
            $item['totalCopIva'] = $price * $qty;
        }
        $items[] = $item;
    }
    return $items;
}

function bitrix_company_nit_nombre_cached($webhook, $companyId, &$cache, $cfg) {
    global $BITRIX_COMPANY_NAME_PRIMARY, $BITRIX_COMPANY_NAME_FALLBACK;
    $cid = (string) $companyId;
    if ($cid === '') {
        return ['', ''];
    }
    if (isset($cache[$cid])) {
        return $cache[$cid];
    }
    $co = bitrix_rest($webhook, 'crm.company.get.json', ['id' => (int) $companyId]);
    $row = is_array($co['result'] ?? null) ? $co['result'] : [];
    $nit = bitrix_clean_company_nit($row['TITLE'] ?? '');
    $nombre = bitrix_company_display_name($row, $nit);
    if ($nombre === '' || $nombre === $nit) {
        foreach ([$BITRIX_COMPANY_NAME_PRIMARY, $BITRIX_COMPANY_NAME_FALLBACK] as $field) {
            $v = trim((string) ($row[$field] ?? ''));
            if ($v !== '' && $v !== $nit) {
                $nombre = $v;
                break;
            }
        }
    }
    $cache[$cid] = [$nit, $nombre !== '' ? $nombre : $nit];
    return $cache[$cid];
}

function bitrix_deal_to_quote($deal, $webhook, $cfg, $codigo, $sellerMap, &$companyCache) {
    if (!is_array($deal)) {
        return null;
    }
    $dealId = trim((string) ($deal['ID'] ?? ''));
    if ($dealId === '') {
        return null;
    }
    [$nit, $nombre] = bitrix_company_nit_nombre_cached($webhook, $deal['COMPANY_ID'] ?? '', $companyCache, $cfg);
    if ($nit === '') {
        $nit = '0';
        $nombre = trim((string) ($deal['TITLE'] ?? 'Cliente Bitrix'));
    }
    $assigned = trim((string) ($deal['ASSIGNED_BY_ID'] ?? ''));
    $sellerCodigo = $codigo;
    if ($assigned !== '') {
        $resolved = resolve_asesor_codigo_from_bitrix_id($assigned);
        if ($resolved !== '') {
            $sellerCodigo = $resolved;
        }
    }
    $sellerName = '';
    if ($assigned !== '' && isset($sellerMap[$assigned])) {
        $sellerName = trim((string) $sellerMap[$assigned]);
    }
    $currency = strtoupper(trim((string) ($deal['CURRENCY_ID'] ?? ($cfg['currency_id'] ?? 'COP'))));
    $items = [];
    if (!empty($GLOBALS['BITRIX_SYNC_FETCH_PRODUCTS'])) {
        $products = bitrix_rest($webhook, 'crm.deal.productrows.get.json', ['id' => (int) $dealId]);
        $rows = is_array($products['result'] ?? null) ? $products['result'] : [];
        $items = bitrix_product_rows_to_quote_items($rows, $currency);
    }
    $opportunity = isset($deal['OPPORTUNITY']) ? (float) $deal['OPPORTUNITY'] : 0.0;
    $totals = [
        'hasUsd' => $currency === 'USD',
        'hasCop' => $currency !== 'USD',
    ];
    if ($currency === 'USD') {
        $totals['usdIva'] = $opportunity;
    } else {
        $totals['copIva'] = $opportunity;
    }
    if (!$items && $opportunity > 0) {
        $items = [[
            'sku' => '',
            'name' => 'Productos cotizados',
            'referencia' => 'Bitrix #' . $dealId,
            'qty' => 1,
            'currency' => $currency,
        ]];
        if ($currency === 'USD') {
            $items[0]['usdIva'] = $opportunity;
            $items[0]['totalUsdIva'] = $opportunity;
        } else {
            $items[0]['copIva'] = $opportunity;
            $items[0]['totalCopIva'] = $opportunity;
        }
        $totals['qty'] = 1;
    }
    $comments = (string) ($deal['COMMENTS'] ?? '');
    $originId = trim((string) ($deal['ORIGIN_ID'] ?? ''));
    if ($originId === '') {
        $originId = parse_izc_quote_id_from_bitrix_comments($comments);
    }
    $quoteId = $originId !== '' ? $originId : ('bx' . $dealId . '-' . $nit);
    $createdAt = izc_datetime_bogota(trim((string) ($deal['DATE_CREATE'] ?? '')), $quoteId);
    if ($createdAt === '') {
        $createdAt = date('c');
    }
    $estado = bitrix_stage_to_asesor_estado($deal['STAGE_ID'] ?? '', $cfg);
    $quoteSource = strtolower(trim((string) ($deal['ORIGINATOR_ID'] ?? ''))) === 'izc' ? 'izc' : 'bitrix';
    $quote = [
        'id' => $quoteId,
        'nit' => $nit,
        'nombre' => $nombre,
        'created_at' => $createdAt,
        'items' => $items,
        'totals' => $totals,
        'bitrix_deal_id' => $dealId,
        'assigned_by_id' => $assigned,
        'seller_codigo' => $sellerCodigo,
        'seller_name' => $sellerName,
        'asesor_estado' => $estado,
        'quote_source' => $quoteSource,
        'synced_from_bitrix' => true,
    ];
    $empresa = parse_empresa_from_bitrix_comments($comments);
    if ($empresa === '') {
        $empresa = resolve_quote_empresa($quote);
    }
    $quote['empresa'] = $empresa;
    $quote['totals']['empresa'] = $empresa;
    $closedDate = trim((string) ($deal['CLOSEDATE'] ?? ''));
    if ($closedDate !== '' && trim((string) ($quote['fecha_cierre'] ?? '')) === '') {
        if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $closedDate, $m)) {
            $quote['fecha_cierre'] = $m[1];
        }
    }
    return $quote;
}

function is_valtech_seller($assignedId, $sellerName = '') {
    $sellerName = strtoupper(trim((string) $sellerName));
    if ($sellerName !== '' && strpos($sellerName, 'VALTECH') !== false) {
        return true;
    }
    $map = bitrix_seller_map();
    $name = strtoupper(trim((string) ($map[(string) $assignedId] ?? '')));
    return $name !== '' && strpos($name, 'VALTECH') !== false;
}

/** Extrae Empresa IZC/VALTECH desde comentarios Bitrix (línea "Empresa: ..."). */
function parse_empresa_from_bitrix_comments($comments) {
    $comments = (string) $comments;
    if ($comments === '') {
        return '';
    }
    if (preg_match('/Empresa:\s*(.+)$/mi', $comments, $m)) {
        return normalize_empresa_name(trim((string) $m[1]));
    }
    return '';
}

/** TRM histórica guardada en comentarios del deal Bitrix (línea "TRM: 3099.48"). */
function parse_trm_from_bitrix_comments($comments) {
    $comments = (string) $comments;
    if ($comments === '' || !preg_match('/TRM:\s*([\d.,]+)/i', $comments, $m)) {
        return 0.0;
    }
    $raw = trim((string) $m[1]);
    if (strpos($raw, ',') !== false && strpos($raw, '.') !== false) {
        if (strrpos($raw, ',') > strrpos($raw, '.')) {
            $raw = str_replace('.', '', $raw);
            $raw = str_replace(',', '.', $raw);
        } else {
            $raw = str_replace(',', '', $raw);
        }
    } else {
        $raw = str_replace(',', '.', $raw);
    }
    $v = (float) $raw;
    return $v > 0 ? $v : 0.0;
}

function normalize_empresa_name($raw) {
    $e = trim((string) $raw);
    if ($e === '') {
        return '';
    }
    if (stripos($e, 'VALTECH') !== false) {
        return 'VALTECH MAYORISTA S.A.S.';
    }
    if (stripos($e, 'IZC') !== false) {
        return 'IZC MAYORISTA S.A.S.';
    }
    return $e;
}

function quote_empresa_stored($quote) {
    if (!is_array($quote)) {
        return '';
    }
    $totals = is_array($quote['totals'] ?? null) ? $quote['totals'] : [];
    foreach ([trim((string) ($quote['empresa'] ?? '')), trim((string) ($totals['empresa'] ?? ''))] as $e) {
        if ($e !== '') {
            return normalize_empresa_name($e);
        }
    }
    return '';
}

function quote_empresa_locked($quote) {
    return trim((string) ($quote['empresa_editado_at'] ?? '')) !== '';
}

function quote_estado_locked($quote) {
    return trim((string) ($quote['asesor_estado_by'] ?? '')) !== '';
}

function quote_estado_priority($estado) {
    $e = strtolower(trim((string) $estado));
    $map = [
        'cotizado' => 1,
        'pendiente' => 2,
        'seguimiento' => 3,
        'vendido' => 4,
        'cerrado_modificado' => 4,
        'perdida' => 5,
    ];
    return (int) ($map[$e] ?? 1);
}

function apply_quote_empresa(&$q, $empresa) {
    if (!is_array($q) || $empresa === '') {
        return false;
    }
    $empresa = normalize_empresa_name($empresa);
    if ($empresa === '') {
        return false;
    }
    $changed = false;
    if (normalize_empresa_name($q['empresa'] ?? '') !== $empresa) {
        $q['empresa'] = $empresa;
        $changed = true;
    }
    if (!is_array($q['totals'] ?? null)) {
        $q['totals'] = [];
    }
    if (normalize_empresa_name($q['totals']['empresa'] ?? '') !== $empresa) {
        $q['totals']['empresa'] = $empresa;
        $changed = true;
    }
    return $changed;
}

function resolve_quote_empresa($quote) {
    if (!is_array($quote)) {
        return 'IZC MAYORISTA S.A.S.';
    }
    if (quote_empresa_locked($quote)) {
        $stored = quote_empresa_stored($quote);
        if ($stored !== '') {
            return $stored;
        }
    }
    $stored = quote_empresa_stored($quote);
    if ($stored !== '') {
        return $stored;
    }
    if (is_valtech_seller($quote['assigned_by_id'] ?? '', $quote['seller_name'] ?? '')) {
        return 'VALTECH MAYORISTA S.A.S.';
    }
    return 'IZC MAYORISTA S.A.S.';
}

function repair_quote_totals_from_items(&$q) {
    if (!is_array($q)) {
        return false;
    }
    $items = is_array($q['items'] ?? null) ? $q['items'] : [];
    if (!$items) {
        return false;
    }
    $cop = 0.0;
    $usd = 0.0;
    $qty = 0;
    foreach ($items as $line) {
        if (!is_array($line)) {
            continue;
        }
        $qty += max(1, (int) ($line['qty'] ?? 1));
        $cur = strtoupper(trim((string) ($line['currency'] ?? '')));
        $lineCop = (float) ($line['totalCopIva'] ?? $line['copIva'] ?? $line['totalCop'] ?? $line['cop'] ?? 0);
        $lineUsd = (float) ($line['totalUsdIva'] ?? $line['usdIva'] ?? $line['totalUsd'] ?? $line['usd'] ?? 0);
        if ($cur === 'COP') {
            $cop += $lineCop;
        } elseif ($cur === 'USD') {
            $usd += $lineUsd;
        } else {
            if ($lineCop > 0) {
                $cop += $lineCop;
            }
            if ($lineUsd > 0) {
                $usd += $lineUsd;
            }
        }
    }
    if ($cop <= 0 && $usd <= 0) {
        return false;
    }
    if (!is_array($q['totals'])) {
        $q['totals'] = [];
    }
    $changed = false;
    if ($cop > 0) {
        if ((float) ($q['totals']['copIva'] ?? 0) <= 0) {
            $q['totals']['copIva'] = $cop;
            $changed = true;
        }
        $q['totals']['hasCop'] = true;
    }
    if ($usd > 0) {
        if ((float) ($q['totals']['usdIva'] ?? 0) <= 0) {
            $q['totals']['usdIva'] = $usd;
            $changed = true;
        }
        $q['totals']['hasUsd'] = true;
        if ($cop <= 0) {
            $q['totals']['hasCop'] = false;
        }
    }
    if ($qty > 0 && (int) ($q['totals']['qty'] ?? 0) <= 0) {
        $q['totals']['qty'] = $qty;
        $changed = true;
    }
    return $changed;
}

function quote_item_line_is_real($line) {
    if (!is_array($line)) {
        return false;
    }
    $sku = trim((string) ($line['sku'] ?? ''));
    if ($sku !== '') {
        return true;
    }
    $name = strtolower(trim((string) ($line['name'] ?? ($line['descripcion'] ?? ''))));
    if ($name === '' || $name === '—' || $name === '-') {
        return false;
    }
    if (strpos($name, 'productos cotizados') !== false) {
        return false;
    }
    if (preg_match('/^bitrix\s*#\d+$/i', $name)) {
        return false;
    }
    $ref = trim((string) ($line['referencia'] ?? ''));
    if ($ref !== '' && preg_match('/^bitrix\s*#\d+$/i', $ref) && strpos($name, 'productos cotizados') !== false) {
        return false;
    }
    return true;
}

function quote_has_real_items($quote) {
    if (!is_array($quote)) {
        return false;
    }
    foreach ((array) ($quote['items'] ?? []) as $line) {
        if (quote_item_line_is_real($line)) {
            return true;
        }
    }
    return false;
}

/** Hay monto > 0 en totales o en alguna línea. Los deals en 0 no van al historial. */
function quote_has_priced_deal($quote) {
    if (!is_array($quote)) {
        return false;
    }
    foreach (['total_usd', 'total_cop', 'totalUsdIva', 'totalCopIva'] as $k) {
        if ((float) ($quote[$k] ?? 0) > 0) {
            return true;
        }
    }
    $tot = is_array($quote['totals'] ?? null) ? $quote['totals'] : [];
    foreach (['usdIva', 'copIva', 'totalConFlete', 'usd', 'cop', 'totalUsdIva', 'totalCopIva', 'total_usd', 'total_cop'] as $k) {
        if ((float) ($tot[$k] ?? 0) > 0) {
            return true;
        }
    }
    foreach ((array) ($quote['items'] ?? []) as $line) {
        if (!is_array($line)) {
            continue;
        }
        foreach (['usdIva', 'copIva', 'totalUsdIva', 'totalCopIva', 'usd', 'cop', 'unitario_usd', 'unitario_cop', 'price', 'PRICE'] as $k) {
            if ((float) ($line[$k] ?? 0) > 0) {
                return true;
            }
        }
    }
    return false;
}

/** Bitrix sin NIT/compañía real: nombre "Deal 5585" o id bx-* con nit 0. */
function quote_is_orphan_bitrix_deal($quote) {
    if (!is_array($quote)) {
        return false;
    }
    $nombre = trim((string) ($quote['nombre'] ?? ''));
    if (preg_match('/^Deal\s+\d+/i', $nombre)) {
        return true;
    }
    $nitDigits = preg_replace('/\D+/', '', (string) ($quote['nit'] ?? ''));
    $id = trim((string) ($quote['id'] ?? ''));
    $isBx = (bool) preg_match('/^bx[-_]/i', $id)
        || !empty($quote['synced_from_bitrix'])
        || trim((string) ($quote['bitrix_deal_id'] ?? '')) !== '';
    if ($isBx && ($nitDigits === '' || $nitDigits === '0')) {
        return true;
    }
    return false;
}

/** Historial Admin: desde esta fecha (inclusive) hasta hoy. */
function quote_admin_historial_since() {
    return '2026-08-21';
}

function quote_created_date_key($quote) {
    $fromCreated = '';
    $raw = trim((string) ($quote['created_at'] ?? ($quote['finished_at'] ?? '')));
    if ($raw !== '') {
        if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $raw, $m)) {
            $fromCreated = $m[1];
        }
    }
    $fromId = '';
    $id = (string) ($quote['id'] ?? '');
    if (preg_match('/^(20\d{2})(\d{2})(\d{2})/', $id, $m)) {
        $fromId = $m[1] . '-' . $m[2] . '-' . $m[3];
    }
    // created_at real manda: un id 2026 no debe colar cotizaciones de 2025.
    if ($fromCreated !== '') {
        return $fromCreated;
    }
    return $fromId;
}

function quote_admin_historial_until() {
    try {
        $dt = new DateTime('now', new DateTimeZone('America/Bogota'));
        return $dt->format('Y-m-d');
    } catch (Exception $e) {
        return date('Y-m-d');
    }
}

function quote_in_admin_historial($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (quote_is_orphan_bitrix_deal($quote)) {
        return false;
    }
    $nombre = trim((string) ($quote['nombre'] ?? ''));
    if (preg_match('/^Deal\b/i', $nombre)) {
        return false;
    }
    $key = quote_created_date_key($quote);
    if ($key === '') {
        return false;
    }
    $since = quote_admin_historial_since();
    $until = quote_admin_historial_until();
    return strcmp($key, $since) >= 0 && strcmp($key, $until) <= 0;
}

function quote_items_are_placeholder($quote) {
    if (!is_array($quote)) {
        return true;
    }
    $items = is_array($quote['items'] ?? null) ? $quote['items'] : [];
    if (!$items) {
        return true;
    }
    foreach ($items as $line) {
        if (quote_item_line_is_real($line)) {
            return false;
        }
    }
    return true;
}

function parse_products_from_bitrix_comments($comments) {
    $comments = (string) $comments;
    if ($comments === '') {
        return [];
    }
    $items = [];
    foreach (preg_split('/\r?\n/', $comments) ?: [] as $line) {
        $line = trim((string) $line);
        if (!preg_match('/^-\s*\[([^\]]*)\]\s*(.+?)\s+x([\d.,]+)\s*=\s*([\d.,]+)\s*(USD|COP)/iu', $line, $m)) {
            continue;
        }
        $sku = trim((string) $m[1]);
        $name = trim((string) $m[2]);
        $qty = max(1.0, (float) str_replace(',', '.', $m[3]));
        $totalRaw = trim((string) $m[4]);
        if (strpos($totalRaw, ',') !== false && strpos($totalRaw, '.') !== false) {
            $totalRaw = str_replace('.', '', $totalRaw);
        }
        $total = (float) str_replace(',', '.', $totalRaw);
        $cur = strtoupper(trim((string) $m[5]));
        if ($cur !== 'USD') {
            $cur = 'COP';
        }
        $item = [
            'sku' => $sku,
            'name' => $name !== '' ? $name : ($sku !== '' ? $sku : 'Producto'),
            'referencia' => $name !== '' ? $name : $sku,
            'qty' => $qty,
            'currency' => $cur,
        ];
        if ($cur === 'USD') {
            $item['totalUsdIva'] = $total;
            $item['usdIva'] = $qty > 0 ? ($total / $qty) : $total;
        } else {
            $item['totalCopIva'] = $total;
            $item['copIva'] = $qty > 0 ? ($total / $qty) : $total;
        }
        $items[] = $item;
    }
    return $items;
}

/** Copia ítems reales entre cotizaciones duplicadas (mismo N° Bitrix o recotizada desde otra). */
function repair_quote_items_from_siblings(&$quotes) {
    $byDeal = [];
    $byId = [];
    foreach ($quotes as $i => $q) {
        if (!is_array($q)) {
            continue;
        }
        $qid = trim((string) ($q['id'] ?? ''));
        if ($qid !== '') {
            $byId[$qid] = $i;
        }
        $dealId = trim((string) ($q['bitrix_deal_id'] ?? ''));
        if ($dealId === '') {
            continue;
        }
        if (!isset($byDeal[$dealId])) {
            $byDeal[$dealId] = [];
        }
        $byDeal[$dealId][] = $i;
    }
    $changed = 0;
    $applyDonor = function ($targetIdx, $donorIdx) use (&$quotes, &$changed) {
        if ($targetIdx === $donorIdx || !quote_items_are_placeholder($quotes[$targetIdx])) {
            return;
        }
        if (!quote_has_real_items($quotes[$donorIdx])) {
            return;
        }
        $donor = $quotes[$donorIdx];
        $quotes[$targetIdx]['items'] = $donor['items'];
        if (empty($quotes[$targetIdx]['empresa']) && !empty($donor['empresa'])) {
            $quotes[$targetIdx]['empresa'] = $donor['empresa'];
        }
        if (empty($quotes[$targetIdx]['totals']['empresa']) && !empty($donor['totals']['empresa'])) {
            if (!is_array($quotes[$targetIdx]['totals'])) {
                $quotes[$targetIdx]['totals'] = [];
            }
            $quotes[$targetIdx]['totals']['empresa'] = $donor['totals']['empresa'];
        }
        if (empty($quotes[$targetIdx]['trm']) && !empty($donor['trm'])) {
            $quotes[$targetIdx]['trm'] = $donor['trm'];
        }
        repair_quote_totals_from_items($quotes[$targetIdx]);
        $changed++;
    };
    foreach ($byDeal as $indices) {
        if (count($indices) < 2) {
            continue;
        }
        $donorIdx = null;
        foreach ($indices as $i) {
            if (quote_has_real_items($quotes[$i])) {
                $donorIdx = $i;
                break;
            }
        }
        if ($donorIdx === null) {
            continue;
        }
        foreach ($indices as $i) {
            $applyDonor($i, $donorIdx);
        }
    }
    foreach ($quotes as $i => $q) {
        if (!is_array($q) || !quote_items_are_placeholder($q)) {
            continue;
        }
        $srcId = trim((string) ($q['duplicated_from'] ?? ($q['recotizado_desde'] ?? '')));
        if ($srcId === '' || !isset($byId[$srcId])) {
            continue;
        }
        $applyDonor($i, $byId[$srcId]);
    }
    return $changed;
}

/** Obtiene productos reales desde filas Bitrix o comentarios del deal. */
function enrich_quote_items_from_bitrix(&$quote, $webhook, $cfg) {
    if (!is_array($quote)) {
        return false;
    }
    $dealId = trim((string) ($quote['bitrix_deal_id'] ?? ''));
    if ($dealId === '' || $webhook === '') {
        return false;
    }
    $changed = false;
    $needItems = quote_items_are_placeholder($quote);
    $needTrm = !isset($quote['trm']) || (float) $quote['trm'] <= 0;
    if (!$needItems && !$needTrm) {
        return false;
    }
    $comments = '';
    if ($needItems) {
        $currency = bitrix_deal_currency($quote, $cfg['currency_id'] ?? 'COP');
        $products = bitrix_rest($webhook, 'crm.deal.productrows.get.json', ['id' => (int) $dealId]);
        $rows = is_array($products['result'] ?? null) ? $products['result'] : [];
        $items = bitrix_product_rows_to_quote_items($rows, $currency);
        if ($items && quote_has_real_items(['items' => $items])) {
            $quote['items'] = $items;
            repair_quote_totals_from_items($quote);
            $changed = true;
            $needItems = false;
        }
    }
    if ($needItems || $needTrm) {
        $deal = bitrix_rest($webhook, 'crm.deal.get.json', ['id' => (int) $dealId]);
        $comments = is_array($deal['result'] ?? null) ? (string) ($deal['result']['COMMENTS'] ?? '') : '';
    }
    if ($needItems && $comments !== '') {
        $parsed = parse_products_from_bitrix_comments($comments);
        if ($parsed && quote_has_real_items(['items' => $parsed])) {
            $quote['items'] = $parsed;
            repair_quote_totals_from_items($quote);
            $changed = true;
        }
    }
    if ($needTrm && $comments !== '') {
        $trm = parse_trm_from_bitrix_comments($comments);
        if ($trm > 0) {
            $quote['trm'] = $trm;
            $changed = true;
        }
    }
    return $changed;
}

function repair_all_quote_items(&$quotes, $maxBitrix = 12) {
    global $bitrixFile;
    $changed = repair_quote_items_from_siblings($quotes);
    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled']) || empty($cfg['webhook_base'])) {
        return $changed;
    }
    $webhook = $cfg['webhook_base'];
    $enriched = 0;
    foreach ($quotes as &$q) {
        if ($enriched >= $maxBitrix) {
            break;
        }
        if (!is_array($q) || !quote_items_are_placeholder($q)) {
            continue;
        }
        if (enrich_quote_items_from_bitrix($q, $webhook, $cfg)) {
            $enriched++;
            $changed++;
        }
    }
    unset($q);
    return $changed;
}

function reset_auto_duplicate_flags(&$quotes) {
    foreach ($quotes as &$q) {
        if (!is_array($q)) {
            continue;
        }
        // Recotización manual del asesor: conservar siempre la marca.
        if (!empty($q['recotizado_desde'])) {
            continue;
        }
        if (($q['quote_source'] ?? '') === 'asesor' && trim((string) ($q['duplicated_from'] ?? '')) !== '') {
            continue;
        }
        unset($q['duplicated_from'], $q['is_duplicated'], $q['duplicated'], $q['duplicate_kind']);
    }
    unset($q);
}

/**
 * Marca duplicados Bitrix: mismo vendedor + NIT + monto (USD/COP).
 * Conserva la más antigua como canónica. No van a la pestaña Duplicadas
 * (esa pestaña solo muestra recotizaciones del asesor).
 */
function mark_duplicate_quotes_by_nit(&$quotes) {
    if (!is_array($quotes)) {
        return 0;
    }
    $groups = [];
    foreach ($quotes as $i => $q) {
        if (!is_array($q) || !empty($q['asesor_eliminada'])) {
            continue;
        }
        if (quote_is_advisor_recotizada($q)) {
            continue;
        }
        $seller = strtoupper(trim((string) ($q['seller_codigo'] ?? '')));
        $nit = preg_replace('/\D+/', '', (string) ($q['nit'] ?? ''));
        $money = quote_duplicate_money_key($q);
        if ($seller === '' || $nit === '' || $money === '') {
            continue;
        }
        $key = $seller . '|' . $nit . '|' . $money;
        if (!isset($groups[$key])) {
            $groups[$key] = [];
        }
        $groups[$key][] = $i;
    }
    $changed = 0;
    foreach ($groups as $idxs) {
        if (count($idxs) < 2) {
            continue;
        }
        usort($idxs, function ($a, $b) use ($quotes) {
            $qa = $quotes[$a];
            $qb = $quotes[$b];
            $ca = (string) ($qa['created_at'] ?? '');
            $cb = (string) ($qb['created_at'] ?? '');
            if ($ca !== $cb) {
                return strcmp($ca, $cb);
            }
            $ida = (string) ($qa['id'] ?? '');
            $idb = (string) ($qb['id'] ?? '');
            $pa = (strpos($ida, 'bx') === 0 ? 1 : 0);
            $pb = (strpos($idb, 'bx') === 0 ? 1 : 0);
            if ($pa !== $pb) {
                return $pa < $pb ? -1 : 1;
            }
            return strcmp($ida, $idb);
        });
        $canonIdx = $idxs[0];
        $canonId = trim((string) ($quotes[$canonIdx]['id'] ?? ''));
        if ($canonId === '') {
            continue;
        }
        if (!empty($quotes[$canonIdx]['is_duplicated']) || !empty($quotes[$canonIdx]['duplicated_from'])) {
            if (!quote_is_advisor_recotizada($quotes[$canonIdx])) {
                unset($quotes[$canonIdx]['is_duplicated'], $quotes[$canonIdx]['duplicated'], $quotes[$canonIdx]['duplicated_from'], $quotes[$canonIdx]['duplicate_kind']);
                $changed++;
            }
        }
        for ($n = 1, $len = count($idxs); $n < $len; $n++) {
            $i = $idxs[$n];
            if (quote_is_advisor_recotizada($quotes[$i])) {
                continue;
            }
            $beforeFrom = trim((string) ($quotes[$i]['duplicated_from'] ?? ''));
            $beforeFlag = !empty($quotes[$i]['is_duplicated']);
            $quotes[$i]['is_duplicated'] = true;
            $quotes[$i]['duplicated_from'] = $canonId;
            $quotes[$i]['duplicate_kind'] = 'bitrix_same_amount';
            if ($beforeFrom !== $canonId || !$beforeFlag) {
                $changed++;
            }
        }
    }
    return $changed;
}

function quote_duplicate_money_key($quote) {
    if (!is_array($quote)) {
        return '';
    }
    $t = is_array($quote['totals'] ?? null) ? $quote['totals'] : [];
    $usd = (float) ($t['usdIva'] ?? ($t['usd'] ?? 0));
    $cop = (float) ($t['copIva'] ?? ($t['cop'] ?? 0));
    $trm = (float) ($quote['trm'] ?? ($t['trm'] ?? 0));
    // 1 decimal en USD evita ruido de redondeo entre IZC y Bitrix.
    if ($usd > 0) {
        return 'USD:' . number_format(round($usd, 1), 1, '.', '');
    }
    if ($cop > 0 && $trm > 1000) {
        return 'USD:' . number_format(round($cop / $trm, 1), 1, '.', '');
    }
    if ($cop > 0) {
        return 'COP:' . (string) ((int) round($cop / 10.0) * 10);
    }
    return '';
}

/** Copia empresa/estado de la cotización canónica a duplicadas importadas de Bitrix. */
function repair_quotes_canonical_metadata(&$quotes) {
    if (!is_array($quotes)) {
        return 0;
    }
    $byId = [];
    foreach ($quotes as $i => $q) {
        if (!is_array($q)) {
            continue;
        }
        $id = trim((string) ($q['id'] ?? ''));
        if ($id !== '') {
            $byId[$id] = $i;
        }
    }
    $changed = 0;
    foreach ($quotes as &$q) {
        if (!is_array($q)) {
            continue;
        }
        if (quote_skip_canonical_metadata_sync($q)) {
            continue;
        }
        $srcId = trim((string) ($q['duplicated_from'] ?? ($q['recotizado_desde'] ?? '')));
        if ($srcId === '' || !isset($byId[$srcId])) {
            continue;
        }
        $src = $quotes[$byId[$srcId]];
        if (!is_array($src)) {
            continue;
        }
        $local = false;
        if (!quote_empresa_locked($q)) {
            $srcEmpresa = quote_empresa_stored($src);
            if ($srcEmpresa !== '' && quote_empresa_stored($q) !== $srcEmpresa) {
                if (apply_quote_empresa($q, $srcEmpresa)) {
                    $local = true;
                }
            }
        }
        if (!quote_estado_locked($q)) {
            $srcEstado = quote_asesor_estado($src);
            if ($srcEstado !== 'nueva' && quote_asesor_estado($q) !== $srcEstado) {
                $q['asesor_estado'] = $srcEstado;
                $local = true;
            }
        }
        if (trim((string) ($q['fecha_cierre'] ?? '')) === '' && trim((string) ($src['fecha_cierre'] ?? '')) !== '') {
            $q['fecha_cierre'] = (string) $src['fecha_cierre'];
            $local = true;
        }
        if ($local) {
            $changed++;
        }
    }
    unset($q);
    return $changed;
}

/** Sincroniza asesor_estado desde Bitrix (solo si el asesor no lo cambió manualmente). */
function refresh_quote_estados_from_bitrix(&$quotes, $cfg, $webhook, $maxDeals = 120) {
    if (!is_array($quotes) || empty($cfg['enabled']) || trim((string) $webhook) === '') {
        return 0;
    }
    $dealMap = [];
    foreach ($quotes as $i => $q) {
        if (!is_array($q) || quote_estado_locked($q)) {
            continue;
        }
        $did = trim((string) ($q['bitrix_deal_id'] ?? ''));
        if ($did !== '') {
            $dealMap[$did][] = $i;
        }
    }
    if (!$dealMap) {
        return 0;
    }
    $changed = 0;
    $fetched = 0;
    foreach (array_keys($dealMap) as $dealId) {
        if ($fetched >= $maxDeals) {
            break;
        }
        $resp = bitrix_rest($webhook, 'crm.deal.get.json', ['id' => (int) $dealId]);
        $deal = is_array($resp['result'] ?? null) ? $resp['result'] : null;
        if (!$deal) {
            continue;
        }
        $fetched++;
        $estado = bitrix_stage_to_asesor_estado($deal['STAGE_ID'] ?? '', $cfg);
        foreach ($dealMap[$dealId] as $idx) {
            if (!isset($quotes[$idx]) || !is_array($quotes[$idx])) {
                continue;
            }
            if (quote_estado_locked($quotes[$idx])) {
                continue;
            }
            if (quote_asesor_estado($quotes[$idx]) !== $estado) {
                $quotes[$idx]['asesor_estado'] = $estado;
                $changed++;
            }
        }
    }
    return $changed;
}

/** Rellena empresa, TRM, ítems y totales en cotizaciones importadas de Bitrix. */
function repair_quote_display_fields() {
    global $quotesFile, $trmFile;
    static $done = false;
    if ($done) {
        return 0;
    }
    $done = true;
    $quotes = read_quotes($quotesFile);
    $trmEntry = read_trm($trmFile);
    $defaultTrm = isset($trmEntry['value']) ? (float) $trmEntry['value'] : 0.0;
    if ($defaultTrm <= 0) {
        $defaultTrm = 3204.0;
    }
    $changed = 0;
    foreach ($quotes as &$q) {
        if (!is_array($q)) {
            continue;
        }
        $localChanged = false;
        if (!quote_empresa_locked($q)) {
            $storedEmpresa = quote_empresa_stored($q);
            if ($storedEmpresa === '') {
                $empresa = resolve_quote_empresa($q);
                if (apply_quote_empresa($q, $empresa)) {
                    $localChanged = true;
                }
            } else {
                if (apply_quote_empresa($q, $storedEmpresa)) {
                    $localChanged = true;
                }
            }
        }
        $trm = isset($q['trm']) ? (float) $q['trm'] : 0.0;
        if ($trm <= 0 && $defaultTrm > 0) {
            $q['trm'] = $defaultTrm;
            $localChanged = true;
        }
        if (repair_quote_totals_from_items($q)) {
            $localChanged = true;
        }
        $items = is_array($q['items'] ?? null) ? $q['items'] : [];
        $totals = is_array($q['totals'] ?? null) ? $q['totals'] : [];
        $currency = !empty($totals['hasUsd']) && empty($totals['hasCop']) ? 'USD' : 'COP';
        if (!empty($totals['hasUsd']) && (float) ($totals['usdIva'] ?? 0) > 0) {
            $currency = 'USD';
        }
        $amount = $currency === 'USD'
            ? (float) ($totals['usdIva'] ?? $totals['usd'] ?? 0)
            : (float) ($totals['copIva'] ?? $totals['cop'] ?? 0);
        if (!$items && $amount > 0) {
            $dealId = trim((string) ($q['bitrix_deal_id'] ?? ''));
            $line = [
                'sku' => '',
                'name' => 'Productos cotizados',
                'referencia' => $dealId !== '' ? ('Bitrix #' . $dealId) : '',
                'qty' => 1,
                'currency' => $currency,
            ];
            if ($currency === 'USD') {
                $line['usdIva'] = $amount;
                $line['totalUsdIva'] = $amount;
            } else {
                $line['copIva'] = $amount;
                $line['totalCopIva'] = $amount;
            }
            $q['items'] = [$line];
            $q['totals']['qty'] = 1;
            $localChanged = true;
        }
        if ($localChanged) {
            $changed++;
        }
    }
    unset($q);
    if ($changed > 0) {
        write_quotes($quotesFile, $quotes);
    }
    return $changed;
}

/** Reparaciones ligeras (sin llamadas Bitrix); como máximo cada 5 min en listados. */
function maybe_run_quote_maintenance($force = false) {
    global $quotesFile, $bitrixFile;
    $flag = dirname($quotesFile) . DIRECTORY_SEPARATOR . '.quotes_maintenance_at';
    if (!$force && is_file($flag) && (time() - (int) @filemtime($flag)) < 300) {
        return;
    }
    $quotes = read_quotes($quotesFile);
    $changed = repair_advisor_recotizada_flags($quotes);
    $changed += repair_recotizada_asesor_visibility($quotes);
    reset_auto_duplicate_flags($quotes);
    $changed += mark_duplicate_quotes_by_nit($quotes);
    $changed += repair_orphan_duplicate_flags($quotes);
    $changed += repair_quotes_canonical_metadata($quotes);
    if ($force) {
        $cfg = read_bitrix($bitrixFile);
        if (!empty($cfg['enabled']) && !empty($cfg['webhook_base'])) {
            $changed += refresh_quote_estados_from_bitrix($quotes, $cfg, $cfg['webhook_base'], 200);
        }
    }
    if ($changed > 0) {
        write_quotes($quotesFile, $quotes);
    }
    @touch($flag);
    // Migración: recotizaciones existentes → columna DUPLICADA RECOTIZADA (rate-limited).
    maybe_push_recotizadas_to_duplicada(!$force);
}

/** Empuja recotizaciones existentes a DUPLICADA RECOTIZADA (como máximo cada 10 min). */
function maybe_push_recotizadas_to_duplicada($respectThrottle = true) {
    global $quotesFile, $bitrixFile;
    $flag = dirname($quotesFile) . DIRECTORY_SEPARATOR . '.recotizadas_duplicada_push_at';
    if ($respectThrottle && is_file($flag) && (time() - (int) @filemtime($flag)) < 600) {
        return;
    }
    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled']) || trim((string) ($cfg['webhook_base'] ?? '')) === '') {
        return;
    }
    $push = push_recotizadas_to_bitrix_duplicada(80);
    @touch($flag);
    // Si aún quedan pendientes, permitir otro lote pronto.
    if ((int) ($push['updated'] ?? 0) > 0 || (int) ($push['pushed'] ?? 0) >= 80) {
        @touch($flag, time() - 540);
    }
}

/**
 * Sincroniza negociaciones Bitrix del asesor con cotizaciones.json.
 * Por defecto enlaza/mapea deal_id + estado sobre cotizaciones existentes.
 * Con $importNew=true también importa deals nuevos (puede sumar filas).
 */
function sync_bitrix_deals_for_asesor($codigo, $force = false, $importNew = true) {
    global $quotesFile, $bitrixFile, $ASESOR_BITRIX_CLIENTES_TTL, $BITRIX_QUOTES_SYNC_SINCE, $BITRIX_SYNC_MAX_IMPORT_PER_RUN;
    $code = normalize_asesor_codigo($codigo);
    $empty = [
        'synced' => false,
        'from_cache' => false,
        'imported' => 0,
        'linked' => 0,
        'updated' => 0,
        'deals_found' => 0,
        'error' => '',
        'fetched_at' => '',
        'import_new' => (bool) $importNew,
    ];
    if ($code === '') {
        $empty['error'] = 'Código asesor vacío.';
        return $empty;
    }

    $cachePath = asesor_bitrix_quotes_sync_cache_path($code);
    if (!$force && $cachePath !== '' && is_file($cachePath)) {
        $cached = json_decode((string) file_get_contents($cachePath), true);
        $fetchedAt = (string) ($cached['fetched_at'] ?? '');
        $ts = $fetchedAt !== '' ? strtotime($fetchedAt) : false;
        if (is_array($cached) && $ts && (time() - $ts) < $ASESOR_BITRIX_CLIENTES_TTL) {
            return [
                'synced' => true,
                'from_cache' => true,
                'imported' => (int) ($cached['imported'] ?? 0),
                'linked' => (int) ($cached['linked'] ?? 0),
                'updated' => (int) ($cached['updated'] ?? 0),
                'deals_found' => (int) ($cached['deals_found'] ?? 0),
                'error' => '',
                'fetched_at' => $fetchedAt,
                'import_new' => (bool) $importNew,
            ];
        }
    }

    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled']) || empty($cfg['webhook_base'])) {
        $empty['error'] = 'Bitrix no configurado.';
        return $empty;
    }
    $ids = get_asesor_bitrix_ids($code);
    if (!$ids) {
        $empty['error'] = 'Asesor sin ID Bitrix mapeado.';
        return $empty;
    }

    $webhook = $cfg['webhook_base'];
    $sellerMap = bitrix_seller_map();
    $since = trim((string) $BITRIX_QUOTES_SYNC_SINCE) . ' 00:00:00';
    $deals = [];
    foreach ($ids as $assignedId) {
        $start = 0;
        do {
            $filter = [
                'ASSIGNED_BY_ID' => (int) $assignedId,
                '>=DATE_CREATE' => $since,
            ];
            if (!empty($cfg['category_id'])) {
                $filter['CATEGORY_ID'] = is_numeric($cfg['category_id']) ? (int) $cfg['category_id'] : $cfg['category_id'];
            }
            $resp = bitrix_rest($webhook, 'crm.deal.list.json', [
                'filter' => $filter,
                'select' => [
                    'ID', 'TITLE', 'DATE_CREATE', 'CLOSEDATE', 'ASSIGNED_BY_ID', 'COMPANY_ID',
                    'COMMENTS', 'ORIGIN_ID', 'ORIGINATOR_ID', 'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID',
                ],
                'order' => ['DATE_CREATE' => 'DESC'],
                'start' => $start,
            ]);
            if (!is_array($resp) || empty($resp['result']) || !is_array($resp['result'])) {
                break;
            }
            foreach ($resp['result'] as $deal) {
                if (!is_array($deal)) {
                    continue;
                }
                $did = trim((string) ($deal['ID'] ?? ''));
                if ($did !== '') {
                    $deals[$did] = $deal;
                }
            }
            $start = isset($resp['next']) ? (int) $resp['next'] : null;
        } while ($start !== null);
    }

    $quotes = read_quotes($quotesFile);
    $byDealId = [];
    $byQuoteId = [];
    foreach ($quotes as $i => $q) {
        if (!is_array($q)) {
            continue;
        }
        $did = trim((string) ($q['bitrix_deal_id'] ?? ''));
        if ($did !== '') {
            $byDealId[$did] = $i;
        }
        $qid = trim((string) ($q['id'] ?? ''));
        if ($qid !== '') {
            $byQuoteId[$qid] = $i;
        }
    }

    $imported = 0;
    $linked = 0;
    $updated = 0;
    $companyCache = [];
    $deadline = microtime(true) + 45.0;
    $maxImport = $importNew ? max(10, (int) $BITRIX_SYNC_MAX_IMPORT_PER_RUN) : 0;
    foreach ($deals as $dealId => $deal) {
        if (microtime(true) >= $deadline) {
            break;
        }
        $estadoDeal = bitrix_stage_to_asesor_estado($deal['STAGE_ID'] ?? '', $cfg);
        $closedDate = trim((string) ($deal['CLOSEDATE'] ?? ''));
        $applyDealMap = static function (&$q) use ($dealId, $estadoDeal, $closedDate, &$linked, &$updated) {
            $changed = false;
            if (trim((string) ($q['bitrix_deal_id'] ?? '')) === '') {
                $q['bitrix_deal_id'] = $dealId;
                $linked++;
                $changed = true;
            } elseif (trim((string) ($q['bitrix_deal_id'] ?? '')) === (string) $dealId) {
                // ya mapeada
            }
            if (!quote_estado_locked($q)) {
                $cur = quote_asesor_estado($q);
                if ($estadoDeal !== '' && quote_estado_priority($estadoDeal) >= quote_estado_priority($cur) && $estadoDeal !== $cur) {
                    $q['asesor_estado'] = $estadoDeal;
                    $changed = true;
                }
            }
            if ($closedDate !== '' && trim((string) ($q['fecha_cierre'] ?? '')) === '') {
                if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $closedDate, $mClose)) {
                    $q['fecha_cierre'] = $mClose[1];
                    $changed = true;
                }
            }
            if (empty($q['synced_from_bitrix'])) {
                $q['synced_from_bitrix'] = true;
                $changed = true;
            }
            if ($changed) {
                $updated++;
            }
        };
        if (isset($byDealId[$dealId])) {
            $idxExisting = $byDealId[$dealId];
            if (isset($quotes[$idxExisting]) && is_array($quotes[$idxExisting])) {
                $applyDealMap($quotes[$idxExisting]);
            }
            continue;
        }
        $originId = trim((string) ($deal['ORIGIN_ID'] ?? ''));
        if ($originId === '') {
            $originId = parse_izc_quote_id_from_bitrix_comments((string) ($deal['COMMENTS'] ?? ''));
        }
        if ($originId !== '' && isset($byQuoteId[$originId])) {
            $idx = $byQuoteId[$originId];
            $applyDealMap($quotes[$idx]);
            $byDealId[$dealId] = $idx;
            continue;
        }
        // Evitar importar duplicado genérico si ya existe cotización del asesor con productos.
        [$dealNit, ] = bitrix_company_nit_nombre_cached($webhook, $deal['COMPANY_ID'] ?? '', $companyCache, $cfg);
        if ($dealNit !== '' && $dealNit !== '0') {
            $linkedExisting = false;
            foreach ($quotes as $qi => $existing) {
                if (!is_array($existing) || !quote_matches_asesor($existing, $code, asesor_nit_variants_set($code), array_fill_keys($ids, true))) {
                    continue;
                }
                if (quote_effective_nit($existing) !== $dealNit) {
                    continue;
                }
                if (!quote_has_real_items($existing)) {
                    continue;
                }
                $dealTs = strtotime((string) ($deal['DATE_CREATE'] ?? '')) ?: 0;
                $quoteTs = strtotime((string) ($existing['created_at'] ?? '')) ?: 0;
                if ($dealTs && $quoteTs && abs($dealTs - $quoteTs) > 14 * 86400) {
                    continue;
                }
                $applyDealMap($quotes[$qi]);
                $byDealId[$dealId] = $qi;
                $linkedExisting = true;
                break;
            }
            if ($linkedExisting) {
                continue;
            }
        }
        if (!$importNew || $imported >= $maxImport) {
            continue;
        }
        $quote = bitrix_deal_to_quote($deal, $webhook, $cfg, $code, $sellerMap, $companyCache);
        if (!$quote) {
            continue;
        }
        $qid = trim((string) ($quote['id'] ?? ''));
        if ($qid !== '' && isset($byQuoteId[$qid])) {
            $applyDealMap($quotes[$byQuoteId[$qid]]);
            $byDealId[$dealId] = $byQuoteId[$qid];
            continue;
        }
        $quotes[] = $quote;
        $byQuoteId[$qid] = count($quotes) - 1;
        $byDealId[$dealId] = count($quotes) - 1;
        $imported++;
    }

    reset_auto_duplicate_flags($quotes);
    $dupMarked = mark_duplicate_quotes_by_nit($quotes);
    $flagsChanged = repair_advisor_recotizada_flags($quotes);
    $metaChanged = repair_quotes_canonical_metadata($quotes);
    if ($imported > 0 || $linked > 0 || $updated > 0 || $dupMarked > 0 || $metaChanged > 0 || $flagsChanged > 0) {
        write_quotes($quotesFile, $quotes);
    }

    $fetchedAt = date('c');
    if ($cachePath !== '') {
        @file_put_contents($cachePath, json_encode([
            'fetched_at' => $fetchedAt,
            'imported' => $imported,
            'linked' => $linked,
            'updated' => $updated,
            'deals_found' => count($deals),
            'import_new' => (bool) $importNew,
        ], JSON_UNESCAPED_UNICODE) . "\n");
    }

    return [
        'synced' => true,
        'from_cache' => false,
        'imported' => $imported,
        'linked' => $linked,
        'updated' => $updated,
        'deals_found' => count($deals),
        'error' => '',
        'fetched_at' => $fetchedAt,
        'import_new' => (bool) $importNew,
    ];
}

/**
 * Trae deals Bitrix de los últimos días (todas las vendedoras) e importa los que
 * faltan en el historial. Una sola lista DATE_CREATE DESC: lo de hoy sale en la 1ª página.
 */
function sync_bitrix_recent_quotes($hours = 72, $force = false) {
    global $quotesFile, $bitrixFile;
    $out = [
        'synced' => false,
        'from_cache' => false,
        'imported' => 0,
        'linked' => 0,
        'updated' => 0,
        'deals_found' => 0,
        'error' => '',
        'fetched_at' => '',
    ];
    $cacheFile = dirname((string) $quotesFile) . DIRECTORY_SEPARATOR . 'bitrix_recent_sync_cache.json';
    if (!$force && is_file($cacheFile)) {
        $cached = json_decode((string) @file_get_contents($cacheFile), true);
        $fetchedAt = (string) ($cached['fetched_at'] ?? '');
        $ts = $fetchedAt !== '' ? strtotime($fetchedAt) : false;
        $ttl = !empty($cached['complete']) ? 90 : 25;
        if (is_array($cached) && $ts && (time() - $ts) < $ttl) {
            $cached['from_cache'] = true;
            $cached['synced'] = true;
            return $cached;
        }
    }
    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled']) || empty($cfg['webhook_base'])) {
        $out['error'] = 'Bitrix no configurado.';
        return $out;
    }
    $webhook = $cfg['webhook_base'];
    $since = date('Y-m-d', time() - max(24, (int) $hours) * 3600) . ' 00:00:00';
    $deals = [];
    $start = 0;
    $complete = false;
    $deadline = microtime(true) + 18.0;
    do {
        if (microtime(true) >= $deadline) {
            break;
        }
        $filter = ['>=DATE_CREATE' => $since];
        if (!empty($cfg['category_id'])) {
            $filter['CATEGORY_ID'] = is_numeric($cfg['category_id']) ? (int) $cfg['category_id'] : $cfg['category_id'];
        }
        $resp = bitrix_rest($webhook, 'crm.deal.list.json', [
            'filter' => $filter,
            'select' => [
                'ID', 'TITLE', 'DATE_CREATE', 'CLOSEDATE', 'ASSIGNED_BY_ID', 'COMPANY_ID',
                'COMMENTS', 'ORIGIN_ID', 'ORIGINATOR_ID', 'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID',
            ],
            'order' => ['DATE_CREATE' => 'DESC'],
            'start' => $start,
        ]);
        if (!is_array($resp) || empty($resp['result']) || !is_array($resp['result'])) {
            if (!$deals) {
                $err = '';
                if (function_exists('izc_bitrix_last_error')) {
                    $err = trim((string) izc_bitrix_last_error());
                }
                $out['error'] = $err !== '' ? $err : 'Bitrix no devolvió deals recientes.';
                return $out;
            }
            break;
        }
        foreach ($resp['result'] as $deal) {
            if (!is_array($deal)) {
                continue;
            }
            $did = trim((string) ($deal['ID'] ?? ''));
            if ($did !== '') {
                $deals[$did] = $deal;
            }
        }
        if (!isset($resp['next'])) {
            $complete = true;
            $start = null;
        } else {
            $start = (int) $resp['next'];
        }
    } while ($start !== null);

    $out['deals_found'] = count($deals);
    if (!$deals) {
        $out['synced'] = true;
        $out['fetched_at'] = date('c');
        @file_put_contents($cacheFile, json_encode($out + ['complete' => $complete], JSON_UNESCAPED_UNICODE) . "\n");
        return $out;
    }

    $quotes = read_quotes($quotesFile);
    $byDealId = [];
    $byQuoteId = [];
    foreach ($quotes as $i => $q) {
        if (!is_array($q)) {
            continue;
        }
        $did = trim((string) ($q['bitrix_deal_id'] ?? ''));
        if ($did !== '') {
            $byDealId[$did] = $i;
        }
        $qid = trim((string) ($q['id'] ?? ''));
        if ($qid !== '') {
            $byQuoteId[$qid] = $i;
        }
    }

    $sellerMap = bitrix_seller_map();
    $companyCache = [];
    $imported = 0;
    $linked = 0;
    $updated = 0;
    foreach ($deals as $dealId => $deal) {
        if (microtime(true) >= $deadline) {
            break;
        }
        $estadoDeal = bitrix_stage_to_asesor_estado($deal['STAGE_ID'] ?? '', $cfg);
        $closedDate = trim((string) ($deal['CLOSEDATE'] ?? ''));
        $applyDealMap = static function (&$q) use ($dealId, $estadoDeal, $closedDate, &$linked, &$updated) {
            $changed = false;
            if (trim((string) ($q['bitrix_deal_id'] ?? '')) === '') {
                $q['bitrix_deal_id'] = $dealId;
                $linked++;
                $changed = true;
            }
            if (!quote_estado_locked($q)) {
                $cur = quote_asesor_estado($q);
                if ($estadoDeal !== '' && quote_estado_priority($estadoDeal) >= quote_estado_priority($cur) && $estadoDeal !== $cur) {
                    $q['asesor_estado'] = $estadoDeal;
                    $changed = true;
                }
            }
            if ($closedDate !== '' && trim((string) ($q['fecha_cierre'] ?? '')) === '') {
                if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $closedDate, $mClose)) {
                    $q['fecha_cierre'] = $mClose[1];
                    $changed = true;
                }
            }
            if (empty($q['synced_from_bitrix'])) {
                $q['synced_from_bitrix'] = true;
                $changed = true;
            }
            if ($changed) {
                $updated++;
            }
        };
        if (isset($byDealId[$dealId])) {
            $idxExisting = $byDealId[$dealId];
            if (isset($quotes[$idxExisting]) && is_array($quotes[$idxExisting])) {
                $applyDealMap($quotes[$idxExisting]);
            }
            continue;
        }
        $originId = trim((string) ($deal['ORIGIN_ID'] ?? ''));
        if ($originId === '') {
            $originId = parse_izc_quote_id_from_bitrix_comments((string) ($deal['COMMENTS'] ?? ''));
        }
        if ($originId !== '' && isset($byQuoteId[$originId])) {
            $idx = $byQuoteId[$originId];
            $applyDealMap($quotes[$idx]);
            $byDealId[$dealId] = $idx;
            continue;
        }
        $opp = isset($deal['OPPORTUNITY']) ? (float) $deal['OPPORTUNITY'] : 0.0;
        $commentItems = parse_products_from_bitrix_comments((string) ($deal['COMMENTS'] ?? ''));
        if ($opp <= 0 && !$commentItems) {
            continue;
        }
        $assigned = trim((string) ($deal['ASSIGNED_BY_ID'] ?? ''));
        $codigo = $assigned !== '' ? resolve_asesor_codigo_from_bitrix_id($assigned) : '';
        $quote = bitrix_deal_to_quote($deal, $webhook, $cfg, $codigo, $sellerMap, $companyCache);
        if (!$quote) {
            continue;
        }
        if ($commentItems && quote_items_are_placeholder($quote)) {
            $quote['items'] = $commentItems;
        }
        if (!quote_has_priced_deal($quote)) {
            continue;
        }
        $qid = trim((string) ($quote['id'] ?? ''));
        if ($qid !== '' && isset($byQuoteId[$qid])) {
            $applyDealMap($quotes[$byQuoteId[$qid]]);
            $byDealId[$dealId] = $byQuoteId[$qid];
            continue;
        }
        $quotes[] = $quote;
        $newIdx = count($quotes) - 1;
        if ($qid !== '') {
            $byQuoteId[$qid] = $newIdx;
        }
        $byDealId[$dealId] = $newIdx;
        $imported++;
    }

    if ($imported > 0 || $linked > 0 || $updated > 0) {
        write_quotes($quotesFile, $quotes);
    }

    $out['synced'] = true;
    $out['imported'] = $imported;
    $out['linked'] = $linked;
    $out['updated'] = $updated;
    $out['fetched_at'] = date('c');
    $out['complete'] = $complete;
    @file_put_contents($cacheFile, json_encode($out, JSON_UNESCAPED_UNICODE) . "\n");
    return $out;
}

function quote_to_asesor_list_row($q, $estado) {
    $totals = is_array($q['totals'] ?? null) ? $q['totals'] : [];
    $items = $q['items'] ?? null;
    $productCount = 0;
    $sumUsd = 0.0;
    $sumCop = 0.0;
    if (is_array($items)) {
        foreach ($items as $it) {
            if (!is_array($it)) {
                continue;
            }
            $productCount++;
            $cur = strtoupper(trim((string) ($it['currency'] ?? '')));
            $lineUsd = (float) ($it['totalUsdIva'] ?? $it['usdIva'] ?? $it['totalUsd'] ?? $it['usd'] ?? 0);
            $lineCop = (float) ($it['totalCopIva'] ?? $it['copIva'] ?? $it['totalCop'] ?? $it['cop'] ?? 0);
            if ($cur === 'COP') {
                $sumCop += $lineCop;
            } elseif ($cur === 'USD') {
                $sumUsd += $lineUsd;
            } else {
                if ($lineCop > 0) {
                    $sumCop += $lineCop;
                }
                if ($lineUsd > 0) {
                    $sumUsd += $lineUsd;
                }
            }
        }
    }
    if (isset($totals['qty']) && (int) $totals['qty'] > $productCount) {
        $productCount = (int) $totals['qty'];
    }
    $usdIva = (float) ($totals['usdIva'] ?? 0);
    $copIva = (float) ($totals['copIva'] ?? 0);
    // Preferir suma de productos reales; si no hay, opportunity/totales guardados.
    if ($sumUsd > 0) {
        $usdIva = $sumUsd;
    }
    if ($sumCop > 0) {
        $copIva = $sumCop;
    }
    $hasUsd = !empty($totals['hasUsd']) || $usdIva > 0 || (float) ($totals['usd'] ?? 0) > 0;
    $hasCop = !empty($totals['hasCop']) || $copIva > 0 || (float) ($totals['cop'] ?? 0) > 0 || (float) ($totals['totalConFlete'] ?? 0) > 0;
    if ($hasUsd && $usdIva <= 0 && $sumUsd <= 0 && (float) ($totals['usd'] ?? 0) > 0) {
        $usdIva = (float) $totals['usd'];
    }
    if ($hasCop && $copIva <= 0 && $sumCop <= 0 && (float) ($totals['cop'] ?? 0) > 0) {
        $copIva = (float) $totals['cop'];
    }
    if ($usdIva <= 0 && (float) ($totals['usdIva'] ?? 0) > 0) {
        $usdIva = (float) $totals['usdIva'];
    }
    if ($copIva <= 0 && (float) ($totals['copIva'] ?? 0) > 0) {
        $copIva = (float) $totals['copIva'];
    }
    $empresa = trim((string) ($q['empresa'] ?? ($totals['empresa'] ?? '')));
    if ($empresa === '') {
        $empresa = resolve_quote_empresa($q);
    }
    $outUsd = $usdIva > 0 ? round($usdIva, 4) : null;
    $outCop = $copIva > 0 ? round($copIva, 2) : null;
    if ($outCop === null && (float) ($totals['totalConFlete'] ?? 0) > 0) {
        $outCop = round((float) $totals['totalConFlete'], 2);
    }
    $totalParts = [];
    if ($outUsd !== null) {
        $totalParts[] = 'USD ' . number_format($outUsd, 2, ',', '.');
    }
    if ($outCop !== null) {
        $totalParts[] = '$ ' . number_format($outCop, 2, ',', '.') . ' COP';
    }
    return [
        'id' => (string) ($q['id'] ?? ''),
        'nit' => (string) ($q['nit'] ?? ''),
        'nombre' => trim((string) ($q['nombre'] ?? '')),
        'created_at' => izc_datetime_bogota((string) ($q['created_at'] ?? ''), (string) ($q['id'] ?? '')),
        'empresa' => $empresa,
        'bitrix_deal_id' => (string) ($q['bitrix_deal_id'] ?? ''),
        'seller_codigo' => normalize_asesor_codigo($q['seller_codigo'] ?? ''),
        'seller_name' => (string) ($q['seller_name'] ?? ''),
        'quote_source' => (string) ($q['quote_source'] ?? ''),
        'assigned_vendedor' => extract_asesor_codigo_from_any($q['assigned_vendedor'] ?? ($q['vendedor_codigo'] ?? '')),
        'gp_codigo' => normalize_gp_codigo($q['gp_codigo'] ?? (
            (strtolower(trim((string) ($q['quote_source'] ?? ''))) === 'gp')
                ? ($q['asesor_cotizado_by'] ?? ($q['seller_codigo'] ?? ''))
                : ''
        )),
        'gp_nombre' => trim((string) ($q['gp_nombre'] ?? (
            (strtolower(trim((string) ($q['quote_source'] ?? ''))) === 'gp')
                ? ($q['seller_name'] ?? '')
                : ''
        ))),
        'synced_from_bitrix' => !empty($q['synced_from_bitrix']),
        'asesor_estado' => $estado,
        'asesor_cotizado_at' => (string) ($q['asesor_cotizado_at'] ?? ''),
        'asesor_comentario' => (string) ($q['asesor_comentario'] ?? ''),
        'fecha_cierre' => (string) ($q['fecha_cierre'] ?? ''),
        'fecha_cierre_cliente' => (string) ($q['fecha_cierre_cliente'] ?? ''),
        'duplicated_from' => (string) ($q['duplicated_from'] ?? ($q['recotizado_desde'] ?? '')),
        'is_duplicated' => quote_in_duplicadas_panel($q),
        'recotizado_desde' => (string) ($q['recotizado_desde'] ?? ($q['duplicated_from'] ?? '')),
        'duplicate_kind' => (string) ($q['duplicate_kind'] ?? ''),
        'product_count' => $productCount,
        'items_count' => $productCount,
        'total_usd' => $outUsd,
        'total_cop' => $outCop,
        'total_display' => $totalParts ? implode(' · ', $totalParts) : '',
        'totals' => [
            'cop' => $totals['cop'] ?? null,
            'copIva' => $outCop,
            'usd' => $totals['usd'] ?? null,
            'usdIva' => $outUsd,
            'totalConFlete' => $totals['totalConFlete'] ?? null,
            'qty' => $totals['qty'] ?? null,
            'hasCop' => $outCop !== null || $hasCop,
            'hasUsd' => $outUsd !== null || $hasUsd,
            'empresa' => $empresa,
        ],
    ];
}

function quote_to_asesor_safe_row($q, $estado) {
    $empresa = trim((string) ($q['empresa'] ?? ($q['totals']['empresa'] ?? '')));
    if ($empresa === '') {
        $empresa = resolve_quote_empresa($q);
    }
    $totals = is_array($q['totals'] ?? null) ? $q['totals'] : [];
    if ($empresa !== '' && empty($totals['empresa'])) {
        $totals['empresa'] = $empresa;
    }
    return [
        'id' => (string) ($q['id'] ?? ''),
        'nit' => (string) ($q['nit'] ?? ''),
        'nombre' => trim((string) ($q['nombre'] ?? '')),
        'created_at' => (string) ($q['created_at'] ?? ''),
        'trm' => $q['trm'] ?? null,
        'items' => is_array($q['items'] ?? null) ? $q['items'] : [],
        'totals' => $totals,
        'empresa' => $empresa,
        'bitrix_deal_id' => (string) ($q['bitrix_deal_id'] ?? ''),
        'seller_codigo' => normalize_asesor_codigo($q['seller_codigo'] ?? ''),
        'assigned_by_id' => (string) ($q['assigned_by_id'] ?? ''),
        'seller_name' => (string) ($q['seller_name'] ?? ''),
        'asesor_estado' => $estado,
        'asesor_cotizado_at' => (string) ($q['asesor_cotizado_at'] ?? ''),
        'asesor_comentario' => (string) ($q['asesor_comentario'] ?? ''),
        'asesor_comentario_at' => (string) ($q['asesor_comentario_at'] ?? ''),
        'asesor_comentario_by' => (string) ($q['asesor_comentario_by'] ?? ''),
        'fecha_cierre' => (string) ($q['fecha_cierre'] ?? ''),
        'fecha_cierre_cliente' => (string) ($q['fecha_cierre_cliente'] ?? ''),
        'duplicated_from' => (string) ($q['duplicated_from'] ?? ($q['recotizado_desde'] ?? '')),
        'is_duplicated' => quote_in_duplicadas_panel($q),
        'recotizado_desde' => (string) ($q['recotizado_desde'] ?? ($q['duplicated_from'] ?? '')),
        'recotizado_by' => (string) ($q['recotizado_by'] ?? ''),
        'recotizado_at' => (string) ($q['recotizado_at'] ?? ''),
        'quote_source' => (string) ($q['quote_source'] ?? ''),
        'assigned_vendedor' => extract_asesor_codigo_from_any($q['assigned_vendedor'] ?? ($q['vendedor_codigo'] ?? '')),
        'gp_codigo' => normalize_gp_codigo($q['gp_codigo'] ?? (
            (strtolower(trim((string) ($q['quote_source'] ?? ''))) === 'gp')
                ? ($q['asesor_cotizado_by'] ?? ($q['seller_codigo'] ?? ''))
                : ''
        )),
        'gp_nombre' => trim((string) ($q['gp_nombre'] ?? (
            (strtolower(trim((string) ($q['quote_source'] ?? ''))) === 'gp')
                ? ($q['seller_name'] ?? '')
                : ''
        ))),
        'synced_from_bitrix' => !empty($q['synced_from_bitrix']),
        'finished_at' => (string) ($q['finished_at'] ?? ''),
        'asesor_cotizado_by' => (string) ($q['asesor_cotizado_by'] ?? ''),
    ];
}

function extract_asesor_codigo_from_any($raw) {
    $n = normalize_asesor_codigo($raw);
    if ($n !== '') {
        return $n;
    }
    $c = strtoupper(trim((string) $raw));
    if ($c === '') {
        return '';
    }
    if (preg_match('/\bV(\d{1,4})\b/', $c, $m)) {
        return 'V' . (string) ((int) $m[1]);
    }
    return '';
}

function quote_is_gp_origin($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (strtolower(trim((string) ($quote['quote_source'] ?? ''))) === 'gp') {
        return true;
    }
    foreach (['gp_codigo', 'asesor_cotizado_by', 'seller_codigo'] as $k) {
        if (function_exists('is_gp_login_id') && is_gp_login_id($quote[$k] ?? '')) {
            return true;
        }
    }
    return false;
}

function quote_assigned_vendedor_codigo($quote) {
    if (!is_array($quote)) {
        return '';
    }
    foreach (['assigned_vendedor', 'vendedor_codigo', 'assigned_asesor'] as $k) {
        $c = extract_asesor_codigo_from_any($quote[$k] ?? '');
        if ($c !== '') {
            return $c;
        }
    }
    return '';
}

function quote_is_gp_assigned_to_asesor($quote, $codigo) {
    static $setCache = [];
    if (!quote_is_gp_origin($quote)) {
        return false;
    }
    $want = normalize_asesor_codigo($codigo);
    if ($want === '') {
        return false;
    }
    if (!isset($setCache[$want])) {
        $setCache[$want] = asesor_codes_set($codigo);
        if (!$setCache[$want]) {
            $setCache[$want] = [$want => true];
        }
    }
    $codeSet = $setCache[$want];
    foreach (['assigned_vendedor', 'vendedor_codigo', 'assigned_asesor'] as $k) {
        $c = extract_asesor_codigo_from_any($quote[$k] ?? '');
        if ($c !== '' && !empty($codeSet[$c])) {
            return true;
        }
    }
    return false;
}

function quote_matches_asesor($quote, $codigo, $nitSet, $bitrixIds) {
    if (quote_is_made_by_zkteco($quote)) {
        return false;
    }
    // Cotizaciones GP solo llegan al asesor si el GP lo asignó explícitamente (otra función).
    if (quote_is_gp_origin($quote)) {
        return false;
    }
    $codeSet = asesor_codes_set($codigo);
    if (!$codeSet) {
        $codeSet = [normalize_asesor_codigo($codigo) => true];
    }
    $sellerCode = normalize_asesor_codigo($quote['seller_codigo'] ?? '');
    if ($sellerCode !== '' && !empty($codeSet[$sellerCode])) {
        return true;
    }
    foreach (['asesor_cotizado_by', 'asesor_estado_by', 'asesor_comentario_by', 'empresa_editado_by', 'recotizado_by', 'flete_editado_by', 'fecha_cierre_by', 'asesor_eliminada_by'] as $field) {
        $fieldCode = normalize_asesor_codigo($quote[$field] ?? '');
        if ($fieldCode !== '' && !empty($codeSet[$fieldCode])) {
            return true;
        }
    }
    $assigned = (string) ($quote['assigned_by_id'] ?? '');
    if ($assigned !== '' && isset($bitrixIds[$assigned])) {
        return true;
    }
    // Por si el mapa de IDs Bitrix del índice está desfasado.
    if ($assigned !== '') {
        $resolved = resolve_asesor_codigo_from_bitrix_id($assigned);
        if ($resolved !== '' && !empty($codeSet[$resolved])) {
            return true;
        }
    }
    $nit = quote_effective_nit($quote);
    if (nit_in_asesor_set($nit, $nitSet)) {
        return true;
    }
    $owner = resolve_asesor_codigo_for_nit($nit);
    return $owner !== '' && !empty($codeSet[$owner]);
}

/** Compara ids de cotización con tolerancia (trim / string). */
function quote_ids_equal($a, $b) {
    $a = trim((string) $a);
    $b = trim((string) $b);
    if ($a === '' || $b === '') {
        return false;
    }
    if ($a === $b) {
        return true;
    }
    // A veces el front manda el N° Bitrix en lugar del id interno.
    return false;
}

/**
 * Intenta rellenar seller_codigo vacío para que el match por asesor no falle
 * en cotizaciones viejas / sync Bitrix.
 */
function ensure_quote_seller_codigo_for_match(&$quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (normalize_asesor_codigo($quote['seller_codigo'] ?? '') !== '') {
        return false;
    }
    $fromBitrix = resolve_asesor_codigo_from_bitrix_id($quote['assigned_by_id'] ?? '');
    if ($fromBitrix !== '') {
        $quote['seller_codigo'] = $fromBitrix;
        return true;
    }
    $nit = quote_effective_nit($quote);
    $code = resolve_asesor_codigo_for_nit($nit);
    if ($code !== '') {
        $quote['seller_codigo'] = $code;
        return true;
    }
    return false;
}

function find_asesor_quote_index($quotes, $quoteId, $codigo) {
    $quoteId = trim((string) $quoteId);
    $rawCodigo = strtoupper(preg_replace('/[\s.]/', '', trim((string) $codigo)));
    $codigo = normalize_asesor_codigo($codigo);
    if ($rawCodigo === 'ZKTECO' || $rawCodigo === 'ZEBRA') {
        $codigo = 'ZKTECO';
    }
    if ($quoteId === '' || $codigo === '' || !is_array($quotes)) {
        return -1;
    }
    $nitSet = asesor_nit_variants_set($codigo);
    $bitrixIds = [];
    foreach (get_asesor_bitrix_ids($codigo) as $id) {
        $bitrixIds[(string) $id] = true;
    }
    $foundIdx = -1;
    $foundByDeal = -1;
    foreach ($quotes as $i => $q) {
        if (!is_array($q)) {
            continue;
        }
        $qid = trim((string) ($q['id'] ?? ''));
        if ($qid === $quoteId) {
            $foundIdx = $i;
            break;
        }
        $deal = trim((string) ($q['bitrix_deal_id'] ?? ''));
        if ($deal !== '' && $deal === $quoteId) {
            $foundByDeal = $i;
        }
    }
    if ($foundIdx < 0 && $foundByDeal >= 0) {
        $foundIdx = $foundByDeal;
    }
    if ($foundIdx < 0) {
        return -1;
    }
    $q = $quotes[$foundIdx];
    if (is_zkteco_login_id($codigo) || is_zkteco_login_id($rawCodigo)) {
        return $foundIdx;
    }
    if (quote_is_gp_assigned_to_asesor($q, $codigo)) {
        return $foundIdx;
    }
    if (quote_matches_asesor($q, $codigo, $nitSet, $bitrixIds)) {
        return $foundIdx;
    }
    // Reparar seller vacío y reintentar (cotizaciones sync / antiguas).
    if (ensure_quote_seller_codigo_for_match($quotes[$foundIdx])) {
        if (quote_matches_asesor($quotes[$foundIdx], $codigo, $nitSet, $bitrixIds)) {
            return $foundIdx;
        }
    }
    return -2;
}

function quote_asesor_estado($quote) {
    $e = strtolower(trim((string) ($quote['asesor_estado'] ?? '')));
    if ($e === 'nueva' || $e === 'nuevo' || $e === 'new') {
        return 'nueva';
    }
    if ($e === 'seguimiento' || $e === 'follow' || $e === 'followup') {
        return 'seguimiento';
    }
    if ($e === 'vendido' || $e === 'venta' || $e === 'sold') {
        return 'vendido';
    }
    if ($e === 'perdida' || $e === 'perdido' || $e === 'lost') {
        return 'perdida';
    }
    if ($e === 'cotizado' || $e === 'cotizada') {
        return 'cotizado';
    }
    if ($e === 'pendiente' || $e === 'pending') {
        return 'pendiente';
    }
    if ($e === 'cerrado_modificado' || $e === 'cerrado-modificado') {
        return 'cerrado_modificado';
    }
    return 'cotizado';
}

function normalize_quote_pipeline_estado($raw) {
    $e = strtolower(trim((string) $raw));
    if ($e === 'seguimiento' || $e === 'follow' || $e === 'followup') {
        return 'seguimiento';
    }
    if ($e === 'vendido' || $e === 'venta' || $e === 'sold') {
        return 'vendido';
    }
    if ($e === 'perdida' || $e === 'perdido' || $e === 'lost') {
        return 'perdida';
    }
    if ($e === 'cotizado' || $e === 'cotizada') {
        return 'cotizado';
    }
    if ($e === 'pendiente' || $e === 'pending') {
        return 'pendiente';
    }
    if ($e === 'cerrado_modificado' || $e === 'cerrado-modificado' || $e === 'cerradomodificado') {
        return 'cerrado_modificado';
    }
    return '';
}

function get_quotes_for_asesor($codigo, $filtro = 'all', $opts = []) {
    global $quotesFile;
    $listOnly = !empty($opts['list_only']);
    $code = normalize_asesor_codigo($codigo);
    $want = strtolower(trim((string) $filtro));
    if ($want === 'nuevo' || $want === 'new') {
        $want = 'nuevas';
    }
    if ($want === 'cotizado' || $want === 'cotizados') {
        $want = 'historial';
    }
    if ($want === 'cotizaciones_gp' || $want === 'quotes_gp') {
        $want = 'gp';
    }
    if ($want !== 'nuevas' && $want !== 'historial' && $want !== 'duplicadas' && $want !== 'gp') {
        $want = 'all';
    }
    $nitSet = asesor_nit_variants_set($code);
    $bitrixIds = [];
    foreach (get_asesor_bitrix_ids($code) as $id) {
        $bitrixIds[(string) $id] = true;
    }
    $listOnlyEarly = !empty($opts['list_only']);
    $skipRepairEarly = !empty($opts['skip_repair']);
    if ($listOnlyEarly && $skipRepairEarly) {
        $cachedList = asesor_quotes_list_cache_get($code);
        if (is_array($cachedList)) {
            return asesor_quotes_list_from_cache_apply_want($cachedList, $want);
        }
    }
    $quotes = read_quotes($quotesFile);
    if (empty($opts['skip_repair'])) {
        $repaired = prepare_quotes_for_asesor_panels($quotes);
        if ($repaired > 0) {
            write_quotes($quotesFile, $quotes);
        }
    }
    $quotesInFile = count($quotes);
    usort($quotes, function ($a, $b) {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    $safe = [];
    $bucketHistorial = [];
    $bucketNuevas = [];
    $bucketDuplicadas = [];
    $bucketGp = [];
    $bundleMode = $listOnly && !empty($opts['bundle']);
    $countNuevas = 0;
    $countHistorial = 0;
    $countDuplicadas = 0;
    $countGp = 0;
    $countMatched = 0;
    foreach ($quotes as $q) {
        if (!is_array($q)) {
            continue;
        }
        // Cotizaciones que un GP asignó explícitamente a este vendedor.
        if (quote_is_gp_assigned_to_asesor($q, $code)) {
            if (!empty($q['asesor_eliminada'])) {
                continue;
            }
            $gpHasItems = is_array($q['items'] ?? null) && count($q['items']) > 0;
            if (!quote_has_priced_deal($q) && !quote_has_real_items($q) && !$gpHasItems) {
                continue;
            }
            $countMatched++;
            $countGp++;
            $estadoGp = quote_asesor_estado($q);
            $rowGp = $listOnly
                ? quote_to_asesor_list_row($q, $estadoGp)
                : quote_to_asesor_safe_row($q, $estadoGp);
            $bucketGp[] = $rowGp;
            if ($want === 'gp') {
                $safe[] = $rowGp;
            }
            continue;
        }
        if (!quote_matches_asesor($q, $code, $nitSet, $bitrixIds)) {
            continue;
        }
        $countMatched++;
        // Soft-delete: oculta en panel asesor, sigue en admin.
        if (!empty($q['asesor_eliminada'])) {
            continue;
        }
        if (!quote_has_priced_deal($q)) {
            continue;
        }
        if (quote_is_orphan_bitrix_deal($q)) {
            continue;
        }
        $estado = quote_asesor_estado($q);
        $isNueva = quote_is_cliente_nueva_for_asesor($q, $nitSet);
        $isDuplicada = quote_in_duplicadas_panel($q);
        if ($isNueva) {
            $countNuevas++;
        }
        if ($isDuplicada) {
            $countDuplicadas++;
        }
        // Historial = cotizaciones del asesor (no las que armó el cliente).
        if (!$isNueva) {
            $countHistorial++;
        }
        if ($want === 'gp') {
            continue;
        }
        if ($want === 'nuevas' && !$isNueva) {
            continue;
        }
        if ($want === 'duplicadas' && !$isDuplicada) {
            continue;
        }
        if ($want === 'historial' && $isNueva) {
            continue;
        }
        $row = $listOnly
            ? quote_to_asesor_list_row($q, $estado)
            : quote_to_asesor_safe_row($q, $estado);
        if ($bundleMode) {
            if ($isNueva) {
                $bucketNuevas[] = $row;
            } else {
                $bucketHistorial[] = $row;
            }
            if ($isDuplicada) {
                $bucketDuplicadas[] = $row;
            }
            continue;
        }
        $safe[] = $row;
    }
    if ($bundleMode) {
        $safe = $bucketHistorial;
    }
    $payload = [
        'quotes' => $safe,
        'historial' => $bucketHistorial,
        'nuevas' => $bucketNuevas,
        'duplicadas' => $bucketDuplicadas,
        'gp' => $bucketGp,
        'count' => count($safe),
        'count_nuevas' => $countNuevas,
        'count_historial' => $countHistorial,
        'count_duplicadas' => $countDuplicadas,
        'count_gp' => $countGp,
        'quotes_in_file' => $quotesInFile,
        'quotes_matched' => $countMatched,
    ];
    if ($listOnly && $bundleMode) {
        $cacheFull = $payload;
        $cacheFull['quotes'] = array_values(array_merge($bucketHistorial, $bucketNuevas, $bucketGp));
        asesor_quotes_list_cache_set($code, $cacheFull);
    }
    return $payload;
}

function get_quotes_for_zkteco($opts = []) {
    global $quotesFile;
    $listOnly = !empty($opts['list_only']);
    $quotes = read_quotes($quotesFile);
    usort($quotes, function ($a, $b) {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    $safe = [];
    foreach ($quotes as $q) {
        if (!is_array($q) || !quote_is_made_by_zkteco($q)) {
            continue;
        }
        if (!empty($q['asesor_eliminada'])) {
            continue;
        }
        if (!quote_has_priced_deal($q)) {
            continue;
        }
        if (quote_is_orphan_bitrix_deal($q)) {
            continue;
        }
        $estado = quote_asesor_estado($q);
        $safe[] = $listOnly
            ? quote_to_asesor_list_row($q, $estado)
            : quote_to_asesor_safe_row($q, $estado);
    }
    return [
        'quotes' => $safe,
        'count' => count($safe),
        'count_historial' => count($safe),
        'count_nuevas' => 0,
        'count_duplicadas' => 0,
    ];
}

function zkteco_sku_key($sku) {
    return strtoupper(preg_replace('/\s+/', '', trim((string) $sku)));
}

function zkteco_product_sku_set() {
    static $set = null;
    if (is_array($set)) {
        return $set;
    }
    $set = [];
    $data = function_exists('read_productos_zkteco') ? read_productos_zkteco() : [];
    foreach ((is_array($data['products'] ?? null) ? $data['products'] : []) as $p) {
        if (!is_array($p)) {
            continue;
        }
        $k = zkteco_sku_key($p['sku'] ?? ($p['codigo'] ?? ''));
        if ($k !== '') {
            $set[$k] = true;
        }
    }
    if (function_exists('brand_catalog_map')) {
        foreach (brand_catalog_map() as $sku => $meta) {
            if (!is_array($meta)) {
                continue;
            }
            $brand = strtolower(trim((string) ($meta['brand'] ?? '')));
            $blob = strtolower(trim((string) ($meta['brandName'] ?? '') . ' ' . (string) ($meta['name'] ?? '')));
            if ($brand === 'zkteco' || strpos($blob, 'zkteco') !== false) {
                $k = zkteco_sku_key($sku);
                if ($k !== '') {
                    $set[$k] = true;
                }
            }
        }
    }
    return $set;
}

function quote_item_looks_zkteco($item, $skuSet) {
    if (!is_array($item)) {
        return false;
    }
    $sku = zkteco_sku_key($item['sku'] ?? ($item['codigo'] ?? ''));
    if ($sku !== '' && !empty($skuSet[$sku])) {
        return true;
    }
    if ($sku !== '' && preg_match('/^ZK/', $sku)) {
        return true;
    }
    $blob = strtolower(implode(' ', [
        (string) ($item['brand'] ?? ''),
        (string) ($item['brandName'] ?? ''),
        (string) ($item['marca'] ?? ''),
        (string) ($item['name'] ?? ''),
        (string) ($item['nombre'] ?? ''),
        (string) ($item['referencia'] ?? ''),
        (string) ($item['sku'] ?? ''),
    ]));
    if (strpos($blob, 'zkteco') !== false) {
        return true;
    }
    return (bool) preg_match('/\bzkt\b/', $blob);
}

function created_product_looks_zkteco($row) {
    $skuSet = function_exists('zkteco_product_sku_set') ? zkteco_product_sku_set() : [];
    return quote_item_looks_zkteco($row, $skuSet);
}

/** Cotización de un asesor que incluye productos ZKTeco (no la del Admin ZKTECO). */
function quote_is_asesor_zkteco($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (function_exists('quote_is_made_by_zkteco') && quote_is_made_by_zkteco($quote)) {
        return false;
    }
    $src = strtolower(trim((string) ($quote['quote_source'] ?? '')));
    if ($src === 'cliente' || $src === 'portal') {
        return false;
    }
    $seller = function_exists('normalize_asesor_codigo')
        ? normalize_asesor_codigo($quote['seller_codigo'] ?? '')
        : strtoupper(trim((string) ($quote['seller_codigo'] ?? '')));
    $by = function_exists('normalize_asesor_codigo')
        ? normalize_asesor_codigo($quote['asesor_cotizado_by'] ?? ($quote['finished_by'] ?? ''))
        : strtoupper(trim((string) ($quote['asesor_cotizado_by'] ?? '')));
    $hasAsesor = ($seller !== '' && $seller !== 'ZKTECO') || ($by !== '' && $by !== 'ZKTECO') || $src === 'asesor';
    if (!$hasAsesor) {
        return false;
    }
    $skuSet = zkteco_product_sku_set();
    foreach ((is_array($quote['items'] ?? null) ? $quote['items'] : []) as $it) {
        if (quote_item_looks_zkteco($it, $skuSet)) {
            return true;
        }
    }
    return false;
}

function get_quotes_for_zkteco_asesores($opts = []) {
    global $quotesFile;
    $listOnly = !empty($opts['list_only']);
    $quotes = read_quotes($quotesFile);
    usort($quotes, function ($a, $b) {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    $safe = [];
    foreach ($quotes as $q) {
        if (!is_array($q) || !quote_is_asesor_zkteco($q)) {
            continue;
        }
        if (!empty($q['asesor_eliminada'])) {
            continue;
        }
        if (function_exists('quote_has_priced_deal') && !quote_has_priced_deal($q)) {
            continue;
        }
        if (function_exists('quote_is_orphan_bitrix_deal') && quote_is_orphan_bitrix_deal($q)) {
            continue;
        }
        $estado = quote_asesor_estado($q);
        $safe[] = $listOnly
            ? quote_to_asesor_list_row($q, $estado)
            : quote_to_asesor_safe_row($q, $estado);
    }
    return [
        'quotes' => $safe,
        'count' => count($safe),
        'count_historial' => count($safe),
        'count_nuevas' => 0,
        'count_duplicadas' => 0,
    ];
}

/** Cotizacion hecha por Admin SAT. */
function quote_is_made_by_sat($quote) {
    if (!is_array($quote)) {
        return false;
    }
    $src = strtolower(trim((string) ($quote['quote_source'] ?? '')));
    if ($src === 'sat') {
        return true;
    }
    if (function_exists('is_sat_login_id')) {
        foreach (['seller_codigo', 'asesor_cotizado_by', 'sat_user', 'finished_by', 'nit'] as $k) {
            if (is_sat_login_id($quote[$k] ?? '')) {
                if ($k === 'nit' && ($src === 'cliente' || $src === 'portal')) {
                    continue;
                }
                return true;
            }
        }
    }
    return false;
}

function quote_item_looks_sat($item) {
    if (!is_array($item)) {
        return false;
    }
    $blob = strtolower(implode(' ', [
        (string) ($item['brand'] ?? ''),
        (string) ($item['brandName'] ?? ''),
        (string) ($item['marca'] ?? ''),
        (string) ($item['name'] ?? ''),
        (string) ($item['nombre'] ?? ''),
        (string) ($item['referencia'] ?? ''),
        (string) ($item['sku'] ?? ''),
    ]));
    $blob = preg_replace('/\bsata[a-z0-9]*/', ' ', $blob);
    if (strpos($blob, 'sat') !== false) {
        return true;
    }
    return false;
}

function quote_has_sat_products($quote) {
    if (!is_array($quote)) {
        return false;
    }
    $empresa = strtolower(trim((string) ($quote['empresa'] ?? ($quote['totals']['empresa'] ?? ''))));
    if (strpos($empresa, 'valtech') !== false) {
        return true;
    }
    foreach ((is_array($quote['items'] ?? null) ? $quote['items'] : []) as $it) {
        if (quote_item_looks_sat($it)) {
            return true;
        }
    }
    return false;
}

/** Cotizacion hecha por GP o Admin SAT (no vendedores V# ni portal cliente). */
function quote_is_sat_gerente($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (function_exists('quote_is_made_by_sat') && quote_is_made_by_sat($quote)) {
        return true;
    }
    if (function_exists('quote_is_made_by_gp') && quote_is_made_by_gp($quote)) {
        return true;
    }
    return false;
}

function quote_is_sat_cliente($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (function_exists('quote_is_made_by_sat') && quote_is_made_by_sat($quote)) {
        return false;
    }
    if (!(function_exists('quote_is_made_by_cliente') && quote_is_made_by_cliente($quote))) {
        return false;
    }
    // Usuarios borrados del portal no aparecen.
    if (function_exists('quote_portal_client_is_registered') && !quote_portal_client_is_registered($quote)) {
        return false;
    }
    // Admin SAT: cotizaciones del portal de clientes de los GP.
    if (function_exists('quote_client_belongs_to_gp') && quote_client_belongs_to_gp($quote)) {
        return true;
    }
    // Compat: si tiene productos SAT y no es de un asesor V#, también entra.
    if (function_exists('quote_has_sat_products') && quote_has_sat_products($quote)) {
        if (function_exists('quote_client_belongs_to_asesor') && quote_client_belongs_to_asesor($quote)) {
            return false;
        }
        return true;
    }
    return false;
}

function get_quotes_for_sat($scope = 'gerentes', $opts = []) {
    global $quotesFile;
    $listOnly = !empty($opts['list_only']);
    $scope = strtolower(trim((string) $scope));
    if ($scope !== 'clientes') {
        $scope = 'gerentes';
    }
    $quotes = read_quotes($quotesFile);
    usort($quotes, function ($a, $b) {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    $safe = [];
    foreach ($quotes as $q) {
        if (!is_array($q)) {
            continue;
        }
        if (!empty($q['asesor_eliminada'])) {
            continue;
        }
        if (function_exists('quote_has_priced_deal') && !quote_has_priced_deal($q)) {
            continue;
        }
        if (function_exists('quote_is_orphan_bitrix_deal') && quote_is_orphan_bitrix_deal($q)) {
            continue;
        }
        $ok = ($scope === 'clientes') ? quote_is_sat_cliente($q) : quote_is_sat_gerente($q);
        if (!$ok) {
            continue;
        }
        $estado = function_exists('quote_asesor_estado') ? quote_asesor_estado($q) : (string) ($q['asesor_estado'] ?? '');
        $safe[] = $listOnly
            ? quote_to_asesor_list_row($q, $estado)
            : quote_to_asesor_safe_row($q, $estado);
    }
    return [
        'quotes' => $safe,
        'count' => count($safe),
        'scope' => $scope,
    ];
}

function list_gerentes_producto_rows() {
    $rows = [];
    foreach (read_gerentes_producto() as $g) {
        if (!is_array($g)) {
            continue;
        }
        // Solo GPs que se registraron en registro-gp.html (no el catálogo Bitrix precargado).
        if (!gp_is_self_registered($g)) {
            continue;
        }
        $code = normalize_gp_codigo($g['codigo'] ?? '');
        if ($code === '') {
            continue;
        }
        $rows[] = [
            'codigo' => $code,
            'marca' => 'SAT',
            'brand' => 'SAT',
            'nombre' => resolve_gp_display_nombre($g),
            'usuario' => $code,
            'nit' => $code,
            'bitrix_id' => trim((string) ($g['bitrix_id'] ?? '')),
            'email' => trim((string) ($g['email'] ?? '')),
            'role' => 'gp',
            'created_at' => (string) ($g['created_at'] ?? ''),
            'password_default' => !empty($g['password_default']),
            'self_registered' => true,
            'source' => 'registro',
        ];
    }
    usort($rows, function ($a, $b) {
        return ((int) substr((string) ($a['codigo'] ?? 'GP0'), 2)) <=> ((int) substr((string) ($b['codigo'] ?? 'GP0'), 2));
    });
    return $rows;
}


function filter_asesor_quotes_bundle($bundle, $filtro, $codigo = '') {
    $want = strtolower(trim((string) $filtro));
    if ($want === 'nuevo' || $want === 'new') {
        $want = 'nuevas';
    }
    if ($want === 'cotizado' || $want === 'cotizados' || $want === 'historial') {
        $want = 'historial';
    }
    if ($want !== 'nuevas' && $want !== 'historial' && $want !== 'duplicadas') {
        return $bundle;
    }
    $nitSet = $codigo !== '' ? asesor_nit_variants_set($codigo) : [];
    $quotes = is_array($bundle['quotes'] ?? null) ? $bundle['quotes'] : [];
    $filtered = [];
    foreach ($quotes as $q) {
        if (!is_array($q)) {
            continue;
        }
        if ($want === 'nuevas' && !quote_is_cliente_nueva_for_asesor($q, $nitSet)) {
            continue;
        }
        if ($want === 'historial' && quote_is_cliente_nueva_for_asesor($q, $nitSet)) {
            continue;
        }
        if ($want === 'duplicadas' && !quote_in_duplicadas_panel($q)) {
            continue;
        }
        $filtered[] = $q;
    }
    $out = $bundle;
    $out['quotes'] = $filtered;
    $out['count'] = count($filtered);
    $out['filtro'] = $want;
    return $out;
}

function get_asesor_clientes_merged($codigo, $opts = []) {
    $force = !empty($opts['refresh_bitrix']);
    $fast = !empty($opts['fast']);
    $syncMeta = [
        'synced' => false,
        'from_cache' => false,
        'error' => '',
        'fetched_at' => '',
        'bitrix_count' => 0,
    ];
    $byNit = [];

    $bitrixCount = 0;
    $anySynced = false;
    $anyCache = false;
    $lastErr = '';
    $lastFetched = '';
    foreach (asesor_all_codigos($codigo) as $cCode) {
        $sync = sync_asesor_clientes_from_bitrix($cCode, $force, $fast && !$force);
        if (!empty($sync['synced'])) {
            $anySynced = true;
        }
        if (!empty($sync['from_cache'])) {
            $anyCache = true;
        }
        if ($lastErr === '' && !empty($sync['error'])) {
            $lastErr = (string) $sync['error'];
        }
        if (!empty($sync['fetched_at'])) {
            $lastFetched = (string) $sync['fetched_at'];
        }
        foreach (($sync['clientes'] ?? []) as $c) {
            $nit = normalize_nit($c['nit'] ?? '');
            if ($nit === '') {
                continue;
            }
            $bitrixCount++;
            $byNit[$nit] = [
                'nit' => $nit,
                'nombre' => trim((string) ($c['nombre'] ?? $nit)) ?: $nit,
                'telefono' => trim((string) ($c['telefono'] ?? '')),
                'manual' => false,
                'activity_at' => (string) ($c['activity_at'] ?? ($c['updated_at'] ?? ($c['created_at'] ?? ''))),
            ];
        }
    }
    $syncMeta['synced'] = $anySynced;
    $syncMeta['from_cache'] = $anyCache;
    $syncMeta['error'] = $lastErr;
    $syncMeta['fetched_at'] = $lastFetched;
    $syncMeta['bitrix_count'] = $bitrixCount;

    foreach (array_merge(get_asesor_clientes($codigo), get_asesor_clientes_manual($codigo)) as $c) {
        $nit = normalize_nit($c['nit'] ?? '');
        if ($nit === '') {
            continue;
        }
        $telefono = trim((string) ($c['telefono'] ?? ''));
        if ($telefono === '') {
            $telefono = resolve_cliente_telefono_from_index($nit, '');
        }
        $nombre = trim((string) ($c['nombre'] ?? $nit)) ?: $nit;
        $manual = !empty($c['manual']);
        $activity = (string) ($c['updated_at'] ?? ($c['created_at'] ?? ''));
        if (!isset($byNit[$nit])) {
            $byNit[$nit] = [
                'nit' => $nit,
                'nombre' => $nombre,
                'telefono' => $telefono,
                'manual' => $manual,
                'activity_at' => $activity,
            ];
        } else {
            if ($manual) {
                $byNit[$nit]['nombre'] = $nombre;
                $byNit[$nit]['manual'] = true;
                if ($telefono !== '') {
                    $byNit[$nit]['telefono'] = $telefono;
                }
            } else {
                $current = trim((string) ($byNit[$nit]['nombre'] ?? ''));
                if (($current === '' || $current === $nit) && $nombre !== '' && $nombre !== $nit) {
                    $byNit[$nit]['nombre'] = $nombre;
                }
                if (trim((string) ($byNit[$nit]['telefono'] ?? '')) === '' && $telefono !== '') {
                    $byNit[$nit]['telefono'] = $telefono;
                }
            }
            $prevAt = (string) ($byNit[$nit]['activity_at'] ?? '');
            if ($activity !== '' && ($prevAt === '' || strcmp($activity, $prevAt) > 0)) {
                $byNit[$nit]['activity_at'] = $activity;
            }
        }
    }
    // En modo fast no recorrer cotizaciones.json (eso alarga el listado de clientes).
    $quoteRows = [];
    if (!$fast) {
        $quoteRows = get_quotes_for_asesor($codigo, 'all', ['list_only' => true, 'skip_repair' => true, 'bundle' => true])['quotes'] ?? [];
    } else {
        $cachedQuotes = asesor_quotes_list_cache_get($codigo);
        if (is_array($cachedQuotes)) {
            $quoteRows = $cachedQuotes['quotes'] ?? [];
        }
    }
    foreach ($quoteRows as $q) {
        $nit = normalize_nit($q['nit'] ?? '');
        if ($nit === '') {
            continue;
        }
        $quoteAt = (string) ($q['finished_at'] ?? ($q['created_at'] ?? ''));
        $nombreQuote = trim((string) ($q['nombre'] ?? ''));
        $nombre = $fast ? ($nombreQuote !== '' ? $nombreQuote : $nit) : resolve_cliente_nombre_from_index($nit, $nombreQuote);
        $telefono = $fast ? '' : resolve_cliente_telefono_from_index($nit, '');
        if (!isset($byNit[$nit])) {
            $byNit[$nit] = [
                'nit' => $nit,
                'nombre' => $nombre !== '' ? $nombre : $nit,
                'telefono' => $telefono,
                'manual' => false,
                'activity_at' => $quoteAt,
            ];
        } else {
            if (!$fast) {
                $current = trim((string) ($byNit[$nit]['nombre'] ?? ''));
                if (($current === '' || $current === $nit) && $nombre !== '' && $nombre !== $nit) {
                    $byNit[$nit]['nombre'] = $nombre;
                }
                if (trim((string) ($byNit[$nit]['telefono'] ?? '')) === '' && $telefono !== '') {
                    $byNit[$nit]['telefono'] = $telefono;
                }
            }
            $prevAt = (string) ($byNit[$nit]['activity_at'] ?? '');
            if ($quoteAt !== '' && ($prevAt === '' || strcmp($quoteAt, $prevAt) > 0)) {
                $byNit[$nit]['activity_at'] = $quoteAt;
            }
        }
    }
    $out = array_values($byNit);
    usort($out, function ($a, $b) {
        $ta = (string) ($a['activity_at'] ?? ($a['created_at'] ?? ''));
        $tb = (string) ($b['activity_at'] ?? ($b['created_at'] ?? ''));
        if ($ta !== $tb) {
            return strcmp($tb, $ta); // mas reciente arriba
        }
        return strcasecmp((string) ($a['nombre'] ?? ''), (string) ($b['nombre'] ?? ''));
    });

    // Enriquecer con contacto del registro portal (usuarios.json).
    global $usersFile;
    $portalByNit = [];
    foreach (read_users($usersFile) as $u) {
        if (!is_array($u)) {
            continue;
        }
        $uNit = normalize_nit($u['nit'] ?? '');
        if ($uNit === '') {
            continue;
        }
        $portalByNit[$uNit] = $u;
    }
    foreach ($out as &$cli) {
        $uNit = normalize_nit($cli['nit'] ?? '');
        if ($uNit === '' || !isset($portalByNit[$uNit])) {
            continue;
        }
        $u = $portalByNit[$uNit];
        $cn = trim((string) ($u['contacto_nombre'] ?? ($u['nombre_contacto'] ?? '')));
        $ct = normalize_telefono_display($u['contacto_telefono'] ?? ($u['telefono_contacto'] ?? ($u['telefono'] ?? '')));
        if ($cn !== '') {
            $cli['contacto_nombre'] = $cn;
        }
        if ($ct !== '') {
            $cli['contacto_telefono'] = $ct;
            if (trim((string) ($cli['telefono'] ?? '')) === '') {
                $cli['telefono'] = $ct;
            }
        }
    }
    unset($cli);

    return ['clientes' => $out, 'sync' => $syncMeta];
}


/** Parsea codigos_extra: array o texto "V28, V27". */
function parse_asesor_codigos_list($raw) {
    $out = [];
    if (is_array($raw)) {
        $parts = $raw;
    } else {
        $parts = preg_split('/[\s,;|\/]+/', trim((string) $raw)) ?: [];
    }
    foreach ($parts as $part) {
        if (is_array($part)) {
            continue;
        }
        $c = normalize_asesor_codigo($part);
        if ($c !== '') {
            $out[$c] = true;
        }
    }
    return array_keys($out);
}

function asesor_row_codigos_extra($asesor) {
    if (!is_array($asesor)) {
        return [];
    }
    return parse_asesor_codigos_list($asesor['codigos_extra'] ?? ($asesor['alias_codigos'] ?? []));
}

/**
 * Código canónico de login: si V28 solo existe como extra de V6, devuelve V6.
 * Si V28 tiene su propio usuario en asesores.json, se queda V28.
 */
function asesor_canonical_codigo($codigo) {
    global $asesoresFile;
    $code = normalize_asesor_codigo($codigo);
    if ($code === '') {
        return '';
    }
    $asesores = read_asesores($asesoresFile);
    [, $own] = find_asesor($asesores, $code);
    if ($own) {
        return $code;
    }
    foreach ($asesores as $a) {
        if (!is_array($a)) {
            continue;
        }
        $primary = normalize_asesor_codigo($a['codigo'] ?? '');
        if ($primary === '' || $primary === $code) {
            continue;
        }
        if (in_array($code, asesor_row_codigos_extra($a), true)) {
            return $primary;
        }
    }
    return $code;
}

/** Códigos que ve un asesor logueado: primario + extras. */
function asesor_all_codigos($codigo) {
    global $asesoresFile;
    $code = normalize_asesor_codigo($codigo);
    if ($code === '') {
        return [];
    }
    $primary = asesor_canonical_codigo($code);
    $set = [$primary => true];
    if ($code !== $primary) {
        $set[$code] = true;
    }
    $asesores = read_asesores($asesoresFile);
    [, $row] = find_asesor($asesores, $primary);
    if ($row) {
        foreach (asesor_row_codigos_extra($row) as $extra) {
            $set[$extra] = true;
        }
    }
    return array_keys($set);
}

function asesor_codes_set($codigo) {
    return array_fill_keys(asesor_all_codigos($codigo), true);
}

function normalize_asesor_codigo($codigo) {
    $c = strtoupper(preg_replace('/[\s.]/', '', trim((string) $codigo)));
    if (preg_match('/^V(\d{1,4})$/', $c, $m)) {
        return 'V' . (string) ((int) $m[1]);
    }
    if ($c === 'ZKTECO' || $c === 'ZEBRA' || $c === 'SAT') {
        return '';
    }
    // Gerentes de producto SAT usan panel GP, no el de asesores V#.
    if (preg_match('/^GP\d{1,4}$/', $c)) {
        return '';
    }
    // Códigos alfabéticos tipo ADV (2–6 letras, opcionalmente con dígitos)
    if (preg_match('/^[A-Z]{2,6}\d{0,4}$/', $c)) {
        return $c;
    }
    return '';
}
function read_asesores($path) {
    if (!is_file($path)) {
        $fb = izc_last_good_path($path);
        if (is_file($fb)) {
            $path = $fb;
        } else {
            return [];
        }
    }
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data) || count($data) === 0) {
        $fb = izc_last_good_path($path);
        if (is_file($fb) && $fb !== $path) {
            $data = json_decode((string) file_get_contents($fb), true);
        }
    }
    return is_array($data) ? $data : [];
}

function izc_atomic_write_json($path, $data) {
    $flags = JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE;
    if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) {
        $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
    } elseif (defined('JSON_PARTIAL_OUTPUT_ON_ERROR')) {
        $flags |= JSON_PARTIAL_OUTPUT_ON_ERROR;
    }
    $json = json_encode($data, $flags);
    if ($json === false) {
        error_log('izc_atomic_write_json encode failed for ' . $path . ': ' . json_last_error_msg());
        return false;
    }
    $dir = dirname($path);
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 0777, true) && !is_dir($dir)) {
            return false;
        }
    }
    @chmod($dir, 0777);
    $payload = $json . "\n";
    if (is_file($path)) {
        @chmod($path, 0666);
    }

    $ok = @file_put_contents($path, $payload, LOCK_EX);
    if ($ok === false) {
        $ok = @file_put_contents($path, $payload);
    }
    if ($ok !== false) {
        @chmod($path, 0666);
        return true;
    }

    $tmp = $path . '.' . str_replace('.', '', uniqid('', true)) . '.tmp';
    $ok = @file_put_contents($tmp, $payload, LOCK_EX);
    if ($ok === false) {
        $ok = @file_put_contents($tmp, $payload);
    }
    if ($ok === false) {
        error_log('izc_atomic_write_json tmp write failed for ' . $tmp);
        return false;
    }
    if (is_file($path)) {
        @chmod($path, 0666);
    }
    if (@rename($tmp, $path)) {
        @chmod($path, 0666);
        return true;
    }
    $copied = @copy($tmp, $path);
    @unlink($tmp);
    if ($copied === false) {
        error_log('izc_atomic_write_json copy failed for ' . $path);
        return false;
    }
    @chmod($path, 0666);
    return true;
}

function izc_last_good_path($path) {
    $base = preg_replace('/\.json$/i', '', basename((string) $path));
    return dirname((string) $path) . DIRECTORY_SEPARATOR . '_last_good_' . $base . '.json';
}

function izc_copy_last_good($path, $count, $min = 5) {
    if ($count < $min || !is_file($path)) {
        return;
    }
    @copy($path, izc_last_good_path($path));
}

function izc_blocked_shrink($path, $oldCount, $newCount, $minOld = 8) {
    if ($oldCount >= $minOld && $newCount < max(1, (int) floor($oldCount * 0.5))) {
        $base = preg_replace('/\.json$/i', '', basename((string) $path));
        @copy($path, dirname((string) $path) . DIRECTORY_SEPARATOR . '_blocked_shrink_' . $base . '_' . date('Ymd_His') . '.json');
        error_log('IZC blocked shrink ' . $path . ' ' . $oldCount . ' -> ' . $newCount);
        return true;
    }
    return false;
}

function write_asesores($path, $asesores) {
    $safe = [];
    foreach ($asesores as $a) {
        if (!is_array($a)) {
            continue;
        }
        $codigo = normalize_asesor_codigo($a['codigo'] ?? '');
        if ($codigo === '') {
            continue;
        }
        $nombre = trim((string) ($a['nombre'] ?? ''));
        if ($nombre === '') {
            $nombre = $codigo;
        }
        $hash = (string) ($a['password_hash'] ?? '');
        if ($hash === '') {
            continue;
        }
        $row = [
            'codigo' => $codigo,
            'nombre' => $nombre,
            'password_hash' => $hash,
            'created_at' => (string) ($a['created_at'] ?? date('c')),
        ];
        $extras = asesor_row_codigos_extra($a);
        if ($extras) {
            $row['codigos_extra'] = $extras;
        }
        if (!empty($a['updated_at'])) {
            $row['updated_at'] = (string) $a['updated_at'];
        }
        $safe[] = $row;
    }
    $old = read_asesores($path);
    $oldCount = is_array($old) ? count($old) : 0;
    $newCount = count($safe);
    if (izc_blocked_shrink($path, $oldCount, $newCount, 8)) {
        return false;
    }
    if (!izc_atomic_write_json($path, array_values($safe))) {
        return false;
    }
    izc_copy_last_good($path, $newCount, 5);
    return true;
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

function read_users($path) {
    if (!is_file($path)) {
        $fb = izc_last_good_path($path);
        if (is_file($fb)) {
            $path = $fb;
        } else {
            return [];
        }
    }
    $raw = file_get_contents($path);
    $data = json_decode($raw, true);
    if (!is_array($data) || count($data) === 0) {
        $fb = izc_last_good_path($path);
        if (is_file($fb) && $fb !== $path) {
            $data = json_decode((string) file_get_contents($fb), true);
        }
    }
    return is_array($data) ? $data : [];
}

function write_users($path, $users) {
    $safe = array_values(is_array($users) ? $users : []);
    $old = read_users($path);
    $oldCount = is_array($old) ? count($old) : 0;
    $newCount = count($safe);
    if (izc_blocked_shrink($path, $oldCount, $newCount, 20)) {
        return false;
    }
    if (!izc_atomic_write_json($path, $safe)) {
        return false;
    }
    izc_copy_last_good($path, $newCount, 10);
    return true;
}

function &quotes_memory_cache() {
    static $cache = [];
    return $cache;
}

function quotes_cache_key($path) {
    $real = @realpath($path);
    return $real !== false ? $real : (string) $path;
}

/** SKUs conocidos de LP asesor (caché en memoria por request). */
function asesor_lp_sku_set() {
    static $set = null;
    if (is_array($set)) {
        return $set;
    }
    $set = [];
    $path = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'files' . DIRECTORY_SEPARATOR . 'precios_lp_asesor.json';
    if (!is_file($path)) {
        return $set;
    }
    $raw = (string) @file_get_contents($path);
    if ($raw === '') {
        return $set;
    }
    $data = json_decode($raw, true);
    $by = is_array($data['by_list'] ?? null) ? $data['by_list'] : [];
    foreach ($by as $map) {
        if (!is_array($map)) {
            continue;
        }
        foreach ($map as $sku => $_v) {
            $s = strtoupper(trim((string) $sku));
            if ($s !== '') {
                $set[$s] = true;
            }
        }
    }
    return $set;
}

function izc_datetime_bogota($raw, $quoteId = '') {
    $id = (string) $quoteId;
    if (preg_match('/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/', $id, $m)) {
        return $m[1] . '-' . $m[2] . '-' . $m[3] . 'T' . $m[4] . ':' . $m[5] . ':' . $m[6] . '-05:00';
    }
    $raw = trim((string) $raw);
    if ($raw === '') {
        return '';
    }
    $raw = str_replace(' ', 'T', $raw);
    if (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/', $raw)) {
        if (!preg_match('/:\d{2}(\.\d+)?$/', $raw)) {
            $raw .= ':00';
        }
        $raw .= '-05:00';
    }
    try {
        $dt = new DateTime($raw);
        $dt->setTimezone(new DateTimeZone('America/Bogota'));
        return $dt->format('c');
    } catch (Exception $e) {
        return $raw;
    }
}

function created_product_is_bitrix_catalog($row) {
    $qid = trim((string) ($row['quote_id'] ?? ''));
    if (!preg_match('/^bx-?/i', $qid)) {
        return false;
    }
    $name = trim((string) ($row['name'] ?? ''));
    if ($name !== '' && preg_match('/^producto\s+/i', $name)) {
        return false;
    }
    return true;
}

function quote_item_is_freight($item) {
    if (!is_array($item)) {
        return false;
    }
    if (!empty($item['is_flete']) || !empty($item['flete']) || !empty($item['isFreight'])) {
        return true;
    }
    $blob = strtoupper(trim(
        (string) ($item['sku'] ?? '') . ' ' .
        (string) ($item['name'] ?? '') . ' ' .
        (string) ($item['referencia'] ?? '') . ' ' .
        (string) ($item['tipo'] ?? '')
    ));
    return $blob !== '' && (bool) preg_match('/\bFLETE\b/', $blob);
}

function quote_item_is_created_product($item, $lpSkus = null, $manualOnly = false) {
    if (!is_array($item)) {
        return false;
    }
    if (quote_item_is_freight($item)) {
        return false;
    }
    // Alta manual o edición explícita del asesor.
    if (!empty($item['manual']) || !empty($item['is_manual'])) {
        return true;
    }
    if (!empty($item['created_by'])) {
        return true;
    }
    if (!empty($item['custom'])) {
        return true;
    }
    $sku = strtoupper(trim((string) ($item['sku'] ?? ($item['codigo'] ?? ''))));
    if ($sku === '') {
        return false;
    }
    $name = trim((string) ($item['name'] ?? ''));
    if ($name !== '' && preg_match('/^producto\s+/i', $name)) {
        return true;
    }
    if (!empty($manualOnly)) {
        return false;
    }
    if ($lpSkus === null) {
        $lpSkus = asesor_lp_sku_set();
    }
    if (!$lpSkus) {
        return false;
    }
    if (isset($lpSkus[$sku])) {
        return false;
    }
    $noZeros = ltrim($sku, '0');
    if ($noZeros !== '' && $noZeros !== $sku && isset($lpSkus[$noZeros])) {
        return false;
    }
    // SKU ausente de todas las LP → producto creado / no catalogado.
    return true;
}

function read_productos_creados_asesor($path = null) {
    global $productosCreadosAsesorFile;
    $file = $path ?: $productosCreadosAsesorFile;
    if (!is_file($file)) {
        return ['products' => []];
    }
    $raw = (string) @file_get_contents($file);
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return ['products' => []];
    }
    if (!isset($data['products']) || !is_array($data['products'])) {
        $data['products'] = [];
    }
    return $data;
}

function write_productos_creados_asesor($data, $path = null) {
    global $productosCreadosAsesorFile;
    $file = $path ?: $productosCreadosAsesorFile;
    if (!isset($data['products']) || !is_array($data['products'])) {
        $data['products'] = [];
    }
    $old = read_productos_creados_asesor($file);
    $oldCount = count($old['products'] ?? []);
    $newCount = count($data['products']);
    if (izc_blocked_shrink($file, $oldCount, $newCount, 5)) {
        return false;
    }
    if (!izc_atomic_write_json($file, $data)) {
        return false;
    }
    izc_copy_last_good($file, $newCount, 5);
    return true;
}

function created_product_adopted_sku_map($data) {
    $out = [];
    if (!is_array($data)) {
        return $out;
    }
    foreach (($data['adopted_skus'] ?? []) as $sku) {
        $s = strtoupper(trim((string) $sku));
        if ($s !== '') {
            $out[$s] = true;
        }
    }
    foreach (($data['products'] ?? []) as $p) {
        if (!is_array($p)) {
            continue;
        }
        if (trim((string) ($p['adopted_at'] ?? '')) === '' && trim((string) ($p['adopted_by'] ?? '')) === '') {
            continue;
        }
        $s = strtoupper(trim((string) ($p['sku'] ?? '')));
        if ($s !== '') {
            $out[$s] = true;
        }
    }
    return $out;
}

function created_product_is_adopted($row, $adoptedSkus) {
    if (!is_array($row)) {
        return false;
    }
    $sku = strtoupper(trim((string) ($row['sku'] ?? '')));
    if ($sku !== '' && isset($adoptedSkus[$sku])) {
        return true;
    }
    return trim((string) ($row['adopted_at'] ?? '')) !== ''
        || trim((string) ($row['adopted_by'] ?? '')) !== '';
}

function read_productos_zkteco($path = null) {
    global $productosZktecoFile;
    $file = $path ?: $productosZktecoFile;
    if (!is_file($file)) {
        return ['products' => []];
    }
    $data = json_decode((string) @file_get_contents($file), true);
    if (!is_array($data)) {
        return ['products' => []];
    }
    if (!isset($data['products']) || !is_array($data['products'])) {
        $data['products'] = [];
    }
    return $data;
}

function write_productos_zkteco($data, $path = null) {
    global $productosZktecoFile, $productosZktecoPublicFile;
    $file = $path ?: $productosZktecoFile;
    if (!isset($data['products']) || !is_array($data['products'])) {
        $data['products'] = [];
    }
    $data['updated_at'] = date('c');
    $ok = izc_atomic_write_json($file, $data);
    if ($ok && ($path === null || $path === $productosZktecoFile) && !empty($productosZktecoPublicFile)) {
        @izc_atomic_write_json($productosZktecoPublicFile, $data);
    }
    return $ok;
}

function izc_parse_money($value) {
    if (is_int($value) || is_float($value)) {
        return (float) $value;
    }
    $s = trim((string) $value);
    if ($s === '') {
        return 0.0;
    }
    $s = str_replace(' ', '', $s);
    if (strpos($s, ',') !== false && strpos($s, '.') !== false) {
        if (strrpos($s, ',') > strrpos($s, '.')) {
            $s = str_replace('.', '', $s);
            $s = str_replace(',', '.', $s);
        } else {
            $s = str_replace(',', '', $s);
        }
    } else {
        $s = str_replace(',', '.', $s);
    }
    return is_numeric($s) ? (float) $s : 0.0;
}

function normalize_zkteco_product_row($row) {
    if (!is_array($row)) {
        return null;
    }
    $sku = strtoupper(trim((string) ($row['sku'] ?? ($row['codigo'] ?? ''))));
    $name = trim((string) ($row['name'] ?? ($row['nombre'] ?? '')));
    if ($sku === '' && $name === '') {
        return null;
    }
    $usd = izc_parse_money($row['unitario_usd'] ?? ($row['unitarioUsd'] ?? ($row['usd'] ?? 0)));
    $cop = izc_parse_money($row['unitario_cop'] ?? ($row['unitarioCop'] ?? ($row['cop'] ?? 0)));
    $id = trim((string) ($row['id'] ?? ''));
    if ($id === '') {
        $id = substr(sha1($sku . '|' . $name . '|' . microtime(true)), 0, 16);
    }
    return [
        'id' => $id,
        'sku' => $sku !== '' ? $sku : $id,
        'name' => $name !== '' ? $name : ('Producto ' . ($sku !== '' ? $sku : $id)),
        'referencia' => trim((string) ($row['referencia'] ?? '')),
        'category' => strtolower(trim((string) ($row['category'] ?? ($row['categoria'] ?? '')))),
        'source' => strtolower(trim((string) ($row['source'] ?? ''))),
        'unitario_usd' => $usd > 0 ? $usd : 0,
        'unitario_cop' => $cop > 0 ? $cop : 0,
        'created_at' => (string) ($row['created_at'] ?? date('c')),
        'updated_at' => (string) ($row['updated_at'] ?? date('c')),
        'created_by' => trim((string) ($row['created_by'] ?? 'ZKTECO')),
    ];
}

function is_placeholder_created_product_name($name, $sku = '') {
    $n = trim((string) $name);
    if ($n === '' || $n === '—' || $n === '-' || $n === '–') {
        return true;
    }
    $s = strtoupper(trim((string) $sku));
    if ($s !== '' && strtoupper($n) === $s) {
        return true;
    }
    return (bool) preg_match('/^producto\s+\S+/i', $n);
}

function normalize_created_product_row($row) {
    if (!is_array($row)) {
        return null;
    }
    $sku = strtoupper(trim((string) ($row['sku'] ?? '')));
    if ($sku === '') {
        return null;
    }
    $usd = (float) ($row['unitario_usd'] ?? ($row['unitarioUsd'] ?? ($row['usd'] ?? 0)));
    $cop = (float) ($row['unitario_cop'] ?? ($row['unitarioCop'] ?? ($row['cop'] ?? 0)));
    return [
        'id' => (string) ($row['id'] ?? ''),
        'sku' => $sku,
        'name' => trim((string) ($row['name'] ?? ($row['nombre'] ?? ''))),
        'referencia' => trim((string) ($row['referencia'] ?? '')),
        'unitario_usd' => $usd > 0 ? $usd : 0,
        'unitario_cop' => $cop > 0 ? $cop : 0,
        'seller_codigo' => strtoupper(trim((string) ($row['seller_codigo'] ?? ''))),
        'seller_name' => trim((string) ($row['seller_name'] ?? '')),
        'created_at' => izc_datetime_bogota((string) ($row['created_at'] ?? ''), (string) ($row['quote_id'] ?? '')),
        'quote_id' => (string) ($row['quote_id'] ?? ''),
        'adopted_at' => trim((string) ($row['adopted_at'] ?? '')),
        'adopted_by' => trim((string) ($row['adopted_by'] ?? '')),
    ];
}

function created_product_key($row) {
    return strtoupper(trim((string) ($row['sku'] ?? ''))) . '|' .
        strtoupper(trim((string) ($row['seller_codigo'] ?? ''))) . '|' .
        trim((string) ($row['quote_id'] ?? ''));
}

function upsert_productos_creados_asesor($rows) {
    if (!is_array($rows) || !$rows) {
        return 0;
    }
    $data = read_productos_creados_asesor();
    $adoptedSkus = created_product_adopted_sku_map($data);
    $byKey = [];
    foreach ($data['products'] as $p) {
        $n = normalize_created_product_row($p);
        if (!$n) {
            continue;
        }
        $byKey[created_product_key($n)] = $n;
    }
    $added = 0;
    foreach ($rows as $row) {
        $n = normalize_created_product_row($row);
        if (!$n) {
            continue;
        }
        $key = created_product_key($n);
        if ($n['id'] === '') {
            $n['id'] = $key !== '|' ? substr(sha1($key . '|' . $n['created_at']), 0, 16) : uniqid('pc', true);
        }
        if (isset($byKey[$key])) {
            $prev = $byKey[$key];
            if (($n['created_at'] ?? '') === '' && ($prev['created_at'] ?? '') !== '') {
                $n['created_at'] = $prev['created_at'];
            } elseif (($n['quote_id'] ?? '') !== '') {
                $n['created_at'] = izc_datetime_bogota($n['created_at'], $n['quote_id']);
            }
            // Conservar nombre/ref/precio útiles si la fila nueva llega vacía o con placeholder.
            if (is_placeholder_created_product_name($n['name'], $n['sku'])
                && !is_placeholder_created_product_name($prev['name'] ?? '', $prev['sku'] ?? '')) {
                $n['name'] = $prev['name'];
            }
            if (($n['referencia'] ?? '') === '' && ($prev['referencia'] ?? '') !== '') {
                $n['referencia'] = $prev['referencia'];
            }
            if (($n['unitario_usd'] ?? 0) <= 0 && ($prev['unitario_usd'] ?? 0) > 0) {
                $n['unitario_usd'] = $prev['unitario_usd'];
            }
            if (($n['unitario_cop'] ?? 0) <= 0 && ($prev['unitario_cop'] ?? 0) > 0) {
                $n['unitario_cop'] = $prev['unitario_cop'];
            }
            if (($n['seller_name'] ?? '') === '' && ($prev['seller_name'] ?? '') !== '') {
                $n['seller_name'] = $prev['seller_name'];
            }
        } else {
            $added++;
        }
        if (isset($adoptedSkus[$n['sku']])) {
            if (($n['adopted_at'] ?? '') === '') {
                $n['adopted_at'] = date('c');
            }
            if (($n['adopted_by'] ?? '') === '') {
                $n['adopted_by'] = 'ZKTECO';
            }
        }
        $byKey[$key] = $n;
    }
    $list = array_values($byKey);
    usort($list, function ($a, $b) {
        $ta = strtotime((string) ($a['created_at'] ?? '')) ?: 0;
        $tb = strtotime((string) ($b['created_at'] ?? '')) ?: 0;
        return $tb <=> $ta;
    });
    $data['products'] = $list;
    $data['adopted_skus'] = array_values(array_keys($adoptedSkus));
    $data['updated_at'] = date('c');
    write_productos_creados_asesor($data);
    return $added;
}

function collect_created_products_from_quote($quote, $manualOnly = false) {
    if (!is_array($quote)) {
        return [];
    }
    $items = is_array($quote['items'] ?? null) ? $quote['items'] : [];
    if (!$items) {
        return [];
    }
    $lpSkus = $manualOnly ? [] : asesor_lp_sku_set();
    $sellerCodigo = strtoupper(trim((string) ($quote['seller_codigo'] ?? ($quote['asesor_cotizado_by'] ?? ''))));
    $sellerName = trim((string) ($quote['seller_name'] ?? ''));
    $quoteId = (string) ($quote['id'] ?? '');
    $createdAt = izc_datetime_bogota(
        (string) ($quote['finished_at'] ?? ($quote['created_at'] ?? '')),
        $quoteId
    );
    $trm = (float) ($quote['trm'] ?? 0);
    if ($trm <= 0 && is_array($quote['totals'] ?? null)) {
        $trm = (float) ($quote['totals']['trm'] ?? 0);
    }
    $out = [];
    foreach ($items as $it) {
        if (!is_array($it)) {
            continue;
        }
        if (!empty($quote['imported_from_bitrix'])
            && empty($it['manual']) && empty($it['is_manual']) && empty($it['created_by']) && empty($it['custom'])) {
            $nm = trim((string) ($it['name'] ?? ''));
            if ($nm === '' || !preg_match('/^producto\s+/i', $nm)) {
                continue;
            }
        }
        if (!quote_item_is_created_product($it, $lpSkus, $manualOnly)) {
            continue;
        }
        $usd = (float) ($it['unitarioUsd'] ?? ($it['usd'] ?? 0));
        if ($usd <= 0 && isset($it['usdIva'])) {
            $usd = (float) $it['usdIva'] / 1.19;
        }
        $cop = (float) ($it['unitarioCop'] ?? ($it['copSinIva'] ?? ($it['cop'] ?? 0)));
        if ($cop <= 0 && isset($it['copIva'])) {
            $cop = (float) $it['copIva'] / 1.19;
        }
        if ($usd <= 0 && $cop > 0 && $trm > 1000) {
            $usd = $cop / $trm;
        }
        $itemCreated = izc_datetime_bogota(
            (string) ($it['created_at'] ?? ($it['createdAt'] ?? '')),
            $quoteId
        );
        $itemSeller = strtoupper(trim((string) ($it['created_by'] ?? ($it['seller_codigo'] ?? ''))));
        $out[] = [
            'sku' => (string) ($it['sku'] ?? ($it['codigo'] ?? '')),
            'name' => (string) ($it['name'] ?? ''),
            'referencia' => (string) ($it['referencia'] ?? ''),
            'unitario_usd' => $usd,
            'unitario_cop' => $cop,
            'seller_codigo' => $itemSeller !== '' ? $itemSeller : $sellerCodigo,
            'seller_name' => $sellerName,
            'created_at' => $itemCreated !== '' ? $itemCreated : $createdAt,
            'quote_id' => $quoteId,
        ];
    }
    return $out;
}

function register_created_products_from_quote($quote) {
    $rows = collect_created_products_from_quote($quote);
    if (!$rows) {
        return 0;
    }
    return upsert_productos_creados_asesor($rows);
}

function list_all_productos_creados_asesor($refresh = false) {
    global $quotesFile;
    $data = read_productos_creados_asesor();
    $adoptedSkus = created_product_adopted_sku_map($data);
    $fromFile = [];
    $normalizedAll = [];
    $datesChanged = false;
    foreach ($data['products'] as $p) {
        $n = normalize_created_product_row($p);
        if (!$n) {
            continue;
        }
        $normalizedAll[] = $n;
        $old = (string) ($p['created_at'] ?? '');
        if ($n['created_at'] !== '' && $n['created_at'] !== $old) {
            $datesChanged = true;
        }
        if (quote_item_is_freight($n) || created_product_is_bitrix_catalog($n) || created_product_is_adopted($n, $adoptedSkus)) {
            continue;
        }
        $fromFile[] = $n;
    }
    $sortFn = function ($a, $b) {
        $ta = strtotime((string) ($a['created_at'] ?? '')) ?: 0;
        $tb = strtotime((string) ($b['created_at'] ?? '')) ?: 0;
        return $tb <=> $ta;
    };
    if ($datesChanged && $normalizedAll) {
        $data['products'] = $normalizedAll;
        $data['updated_at'] = date('c');
        write_productos_creados_asesor($data);
    }
    if (!$refresh && $fromFile) {
        usort($fromFile, $sortFn);
        return $fromFile;
    }
    $fromQuotes = [];
    foreach (read_quotes($quotesFile) as $q) {
        foreach (collect_created_products_from_quote($q, true) as $row) {
            if (!quote_item_is_freight($row)) {
                $fromQuotes[] = $row;
            }
        }
    }
    if ($fromQuotes) {
        upsert_productos_creados_asesor($fromQuotes);
    }
    $merged = [];
    foreach (array_merge($fromFile, $fromQuotes) as $row) {
        $n = normalize_created_product_row($row);
        if (!$n || quote_item_is_freight($n) || created_product_is_bitrix_catalog($n) || created_product_is_adopted($n, $adoptedSkus)) {
            continue;
        }
        $merged[created_product_key($n)] = $n;
    }
    $list = array_values($merged);
    usort($list, $sortFn);
    return $list;
}

function invalidate_quotes_cache($path) {
    $cache = &quotes_memory_cache();
    unset($cache[quotes_cache_key($path)]);
}

function asesor_quotes_list_cache_dir() {
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . '_asesor_list_cache';
}

function asesor_quotes_source_mtime() {
    global $quotesFile;
    return is_file($quotesFile) ? (int) @filemtime($quotesFile) : 0;
}

function asesor_quotes_list_cache_path($codigo) {
    $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) $codigo));
    if ($code === '') {
        return '';
    }
    return asesor_quotes_list_cache_dir() . DIRECTORY_SEPARATOR . $code . '.v2.json';
}

function asesor_quotes_list_cache_get($codigo) {
    static $mem = [];
    $code = normalize_asesor_codigo($codigo);
    if ($code === '') {
        return null;
    }
    if (isset($mem[$code]) && is_array($mem[$code])) {
        return $mem[$code];
    }
    $path = asesor_quotes_list_cache_path($code);
    if ($path === '' || !is_file($path)) {
        return null;
    }
    $raw = json_decode((string) @file_get_contents($path), true);
    if (!is_array($raw) || !is_array($raw['data'] ?? null)) {
        return null;
    }
    $mem[$code] = $raw['data'];
    return $raw['data'];
}

function asesor_quotes_list_cache_set($codigo, $data) {
    static $mem = [];
    $code = normalize_asesor_codigo($codigo);
    if ($code === '' || !is_array($data)) {
        return;
    }
    $mtime = asesor_quotes_source_mtime();
    $mem[$code . ':' . $mtime] = $data;
    $dir = asesor_quotes_list_cache_dir();
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $path = asesor_quotes_list_cache_path($code);
    if ($path === '') {
        return;
    }
    @file_put_contents(
        $path,
        json_encode(['mtime' => $mtime, 'data' => $data], JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );
}

function asesor_quotes_list_cache_add_gp_quote($codigo, $quote) {
    $code = normalize_asesor_codigo($codigo);
    if ($code === '' || !is_array($quote)) {
        return;
    }
    $row = quote_to_asesor_list_row($quote, quote_asesor_estado($quote));
    $data = asesor_quotes_list_cache_get($code);
    if (!is_array($data)) {
        $path = asesor_quotes_list_cache_path($code);
        if ($path && is_file($path)) {
            @unlink($path);
        }
        return;
    }
    $id = (string) ($row['id'] ?? '');
    $gp = [];
    foreach (is_array($data['gp'] ?? null) ? $data['gp'] : [] as $r) {
        if (!is_array($r)) {
            continue;
        }
        if ($id !== '' && (string) ($r['id'] ?? '') === $id) {
            continue;
        }
        $gp[] = $r;
    }
    array_unshift($gp, $row);
    $data['gp'] = $gp;
    $data['quotes_gp'] = $gp;
    $data['count_gp'] = count($gp);
    asesor_quotes_list_cache_set($code, $data);
}

function asesor_quotes_list_cache_clear() {
    $dir = asesor_quotes_list_cache_dir();
    if (!is_dir($dir)) {
        return;
    }
    foreach (glob($dir . DIRECTORY_SEPARATOR . '*.json') ?: [] as $f) {
        @unlink($f);
    }
}

function asesor_quotes_list_from_cache_apply_want($cached, $want) {
    if (!is_array($cached)) {
        return null;
    }
    $out = $cached;
    if ($want === 'nuevas') {
        $out['quotes'] = is_array($cached['nuevas'] ?? null) ? $cached['nuevas'] : [];
    } elseif ($want === 'duplicadas') {
        $out['quotes'] = is_array($cached['duplicadas'] ?? null) ? $cached['duplicadas'] : [];
    } elseif ($want === 'gp') {
        $out['quotes'] = is_array($cached['gp'] ?? null) ? $cached['gp'] : [];
    } elseif ($want === 'historial') {
        $out['quotes'] = is_array($cached['historial'] ?? null) ? $cached['historial'] : [];
    } else {
        $out['quotes'] = is_array($cached['quotes'] ?? null) ? $cached['quotes'] : [];
    }
    $out['count'] = count($out['quotes']);
    return $out;
}

function parse_quotes_payload($raw) {
    $raw = (string) $raw;
    if ($raw === '') {
        return [];
    }
    if (strncmp($raw, "\xEF\xBB\xBF", 3) === 0) {
        $raw = substr($raw, 3);
    }
    $raw = trim($raw);
    if ($raw !== '' && $raw[0] !== '[' && $raw[0] !== '{') {
        if (preg_match('/=\s*(\[.*\])\s*;?\s*$/s', $raw, $m)) {
            $raw = $m[1];
        }
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return [];
    }
    // Solo contenedores. Nunca unwrap de "items" (son productos de una cotización).
    if (!isset($data['id']) && !isset($data['nit'])) {
        foreach (['quotes', 'cotizaciones', 'data'] as $wrap) {
            if (isset($data[$wrap]) && is_array($data[$wrap])) {
                $data = $data[$wrap];
                break;
            }
        }
    }
    if (isset($data['id']) && (isset($data['nit']) || isset($data['items']))) {
        return [$data];
    }
    $list = [];
    foreach ($data as $item) {
        if (!is_array($item)) {
            continue;
        }
        if (isset($item['id']) || isset($item['nit']) || isset($item['items'])) {
            $list[] = $item;
        }
    }
    return array_values($list);
}

function quote_backup_candidate_files($path, $includeBackups = true) {
    $dir = dirname((string) $path);
    $out = [];
    $add = function ($file) use (&$out) {
        $file = (string) $file;
        if ($file === '' || !is_file($file)) {
            return;
        }
        $real = realpath($file) ?: $file;
        if (!isset($out[$real])) {
            $out[$real] = $file;
        }
    };
    $add($path);
    $altJs = preg_replace('/\.json$/i', '.js', (string) $path);
    if ($altJs && $altJs !== $path) {
        $add($altJs);
    }
    $add($dir . DIRECTORY_SEPARATOR . '_last_good_cotizaciones.json');
    if ($includeBackups) {
        foreach (glob($dir . DIRECTORY_SEPARATOR . 'cotizaciones*.json') ?: [] as $f) {
            $add($f);
        }
        foreach (glob($dir . DIRECTORY_SEPARATOR . '_blocked_shrink_*.json') ?: [] as $f) {
            $add($f);
        }
        foreach (glob($dir . DIRECTORY_SEPARATOR . '_backup*' . DIRECTORY_SEPARATOR . 'cotizaciones.json') ?: [] as $f) {
            $add($f);
        }
    }
    return array_values($out);
}

function read_quotes_from_disk($path) {
    $best = [];
    foreach (quote_backup_candidate_files($path, false) as $file) {
        $list = parse_quotes_payload((string) @file_get_contents($file));
        if (count($list) > count($best)) {
            $best = $list;
        }
    }
    return $best;
}

/** Recupera el historial si cotizaciones.json se achicó (last_good / backups). */
function heal_quotes_file($path) {
    $current = is_file($path) ? parse_quotes_payload((string) @file_get_contents($path)) : [];
    $best = $current;
    foreach (quote_backup_candidate_files($path, true) as $file) {
        $list = parse_quotes_payload((string) @file_get_contents($file));
        if ($list) {
            $best = merge_quote_lists($best, $list);
        }
    }
    if (count($best) > count($current)) {
        write_quotes($path, $best);
        invalidate_quotes_cache($path);
        return parse_quotes_payload((string) @file_get_contents($path)) ?: $best;
    }
    return $current;
}

function quote_record_score($q) {
    if (!is_array($q)) {
        return 0;
    }
    $items = is_array($q['items'] ?? null) ? $q['items'] : [];
    $skus = 0;
    $priced = 0;
    foreach ($items as $it) {
        if (!is_array($it)) {
            continue;
        }
        if (trim((string) ($it['sku'] ?? '')) !== '') {
            $skus++;
        }
        foreach (['usdIva', 'copIva', 'totalUsdIva', 'totalCopIva', 'usd', 'cop'] as $k) {
            if ((float) ($it[$k] ?? 0) > 0) {
                $priced++;
                break;
            }
        }
    }
    $tot = is_array($q['totals'] ?? null) ? $q['totals'] : [];
    $hasTot = 0;
    foreach (['usdIva', 'copIva', 'totalConFlete', 'usd', 'cop'] as $k) {
        if ((float) ($tot[$k] ?? 0) > 0) {
            $hasTot = 1;
            break;
        }
    }
    $emp = trim((string) ($q['empresa'] ?? ($tot['empresa'] ?? ''))) !== '' ? 1 : 0;
    $nombre = trim((string) ($q['nombre'] ?? ''));
    $nit = trim((string) ($q['nit'] ?? ''));
    $named = ($nombre !== '' && $nombre !== $nit) ? 1 : 0;
    $deal = trim((string) ($q['bitrix_deal_id'] ?? '')) !== '' ? 1 : 0;
    return ($skus * 20) + ($priced * 10) + ($hasTot * 8) + ($named * 4) + ($emp * 2) + $deal + count($items);
}

function quote_record_key($q) {
    $id = trim((string) ($q['id'] ?? ''));
    if ($id !== '') {
        return 'id:' . $id;
    }
    $did = trim((string) ($q['bitrix_deal_id'] ?? ''));
    if ($did !== '' && ctype_digit($did)) {
        return 'deal:' . $did;
    }
    return 'row:' . implode('|', [
        (string) ($q['created_at'] ?? ''),
        (string) ($q['nit'] ?? ''),
        (string) ($q['seller_codigo'] ?? ''),
        (string) ($q['nombre'] ?? ''),
    ]);
}

function merge_quote_lists($base, $incoming) {
    $merged = [];
    $order = [];
    foreach ([$base, $incoming] as $list) {
        if (!is_array($list)) {
            continue;
        }
        foreach ($list as $q) {
            if (!is_array($q)) {
                continue;
            }
            $k = quote_record_key($q);
            if (!isset($merged[$k])) {
                $merged[$k] = $q;
                $order[] = $k;
                continue;
            }
            $old = $merged[$k];
            if (quote_record_score($q) >= quote_record_score($old)) {
                if (trim((string) ($q['bitrix_deal_id'] ?? '')) === '' && trim((string) ($old['bitrix_deal_id'] ?? '')) !== '') {
                    $q['bitrix_deal_id'] = $old['bitrix_deal_id'];
                }
                if (trim((string) ($q['empresa'] ?? '')) === '' && trim((string) ($old['empresa'] ?? '')) !== '') {
                    $q['empresa'] = $old['empresa'];
                }
                $merged[$k] = $q;
            } else {
                if (trim((string) ($old['bitrix_deal_id'] ?? '')) === '' && trim((string) ($q['bitrix_deal_id'] ?? '')) !== '') {
                    $old['bitrix_deal_id'] = $q['bitrix_deal_id'];
                    $merged[$k] = $old;
                }
            }
        }
    }
    $out = [];
    foreach ($order as $k) {
        $out[] = $merged[$k];
    }
    return $out;
}

function read_quotes($path) {
    $cache = &quotes_memory_cache();
    $cacheKey = quotes_cache_key($path);
    if (isset($cache[$cacheKey])) {
        return $cache[$cacheKey];
    }
    $list = read_quotes_from_disk($path);
    $cache[$cacheKey] = $list;
    return $cache[$cacheKey];
}

function quotes_write_last_error($msg = null) {
    static $err = '';
    if ($msg !== null) {
        $err = (string) $msg;
    }
    return $err;
}

function quotes_write_fail_message() {
    $detail = trim(quotes_write_last_error());
    if ($detail !== '') {
        return 'No se pudo guardar la cotización (' . $detail . '). Espera unos segundos e inténtalo de nuevo.';
    }
    return 'No se pudo guardar la cotización. Espera unos segundos e inténtalo de nuevo.';
}

function izc_replace_file($tmp, $path) {
    for ($i = 0; $i < 6; $i++) {
        if (is_file($path)) {
            @chmod($path, 0666);
        }
        if (@rename($tmp, $path)) {
            return true;
        }
        if (is_file($path) && @copy($tmp, $path)) {
            @unlink($tmp);
            return true;
        }
        usleep(200000);
    }
    quotes_write_last_error('el archivo está en uso o no hay permiso de escritura en data/');
    return false;
}

function write_quotes($path, $quotes) {
    quotes_write_last_error('');
    $dir = dirname($path);
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 0755, true) && !is_dir($dir)) {
            quotes_write_last_error('no existe la carpeta data/');
            return false;
        }
    }
    if (!is_writable($dir)) {
        @chmod($dir, 0777);
    }
    if (!is_array($quotes)) {
        quotes_write_last_error('datos inválidos');
        return false;
    }
    $incoming = array_values($quotes);
    $onDisk = is_file($path) ? read_quotes_from_disk($path) : [];
    $oldCount = count($onDisk);
    $newCount = count($incoming);
    if ($oldCount >= 20 && $newCount < $oldCount) {
        $incoming = merge_quote_lists($onDisk, $incoming);
        $newCount = count($incoming);
    }
    if ($oldCount >= 50 && $newCount < max(20, (int) floor($oldCount * 0.5))) {
        @copy($path, $dir . DIRECTORY_SEPARATOR . '_blocked_shrink_' . date('Ymd_His') . '.json');
        error_log('write_quotes blocked shrink ' . $oldCount . ' -> ' . $newCount . ' for ' . $path);
        $lastGood = $dir . DIRECTORY_SEPARATOR . '_last_good_cotizaciones.json';
        if (is_file($lastGood)) {
            $incoming = merge_quote_lists($incoming, parse_quotes_payload((string) @file_get_contents($lastGood)));
            $newCount = count($incoming);
        }
        if ($newCount < max(20, (int) floor($oldCount * 0.5))) {
            $incoming = merge_quote_lists($onDisk, $incoming);
            $newCount = count($incoming);
        }
    }
    $flags = JSON_UNESCAPED_UNICODE;
    if ($newCount < 80) {
        $flags |= JSON_PRETTY_PRINT;
    }
    if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) {
        $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
    }
    $json = json_encode($incoming, $flags);
    if ($json === false) {
        quotes_write_last_error('JSON inválido: ' . (function_exists('json_last_error_msg') ? json_last_error_msg() : 'encode'));
        return false;
    }
    $payload = $json . "\n";
    $tmp = $path . '.tmp';
    @chmod($dir, 0777);
    if (is_file($tmp)) {
        @chmod($tmp, 0666);
        @unlink($tmp);
    }
    $ok = @file_put_contents($tmp, $payload, LOCK_EX);
    if ($ok === false) {
        $ok = @file_put_contents($tmp, $payload);
    }
    if ($ok === false) {
        quotes_write_last_error('no se pudo crear el archivo temporal en data/');
        return false;
    }
    $check = parse_quotes_payload((string) @file_get_contents($tmp));
    if (count($check) < $newCount) {
        @unlink($tmp);
        quotes_write_last_error('verificación del archivo incompleta');
        error_log('write_quotes verify failed for ' . $path);
        return false;
    }
    if (!izc_replace_file($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    if ($newCount >= 50) {
        @copy($path, $dir . DIRECTORY_SEPARATOR . '_last_good_cotizaciones.json');
    }
    invalidate_quotes_cache($path);
    return true;
}

function read_trm($path) {
    if (!is_file($path)) {
        return ['value' => 3204, 'updated_at' => '', 'updated_by_nit' => '', 'updated_by_nombre' => ''];
    }
    $raw = file_get_contents($path);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : ['value' => 3204];
}

function write_trm($path, $value, $adminNit, $adminNombre) {
    $entry = [
        'value' => $value,
        'updated_at' => date('c'),
        'updated_by_nit' => $adminNit,
        'updated_by_nombre' => $adminNombre,
    ];
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $json = json_encode($entry, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    return file_put_contents($path, $json . "\n", LOCK_EX) !== false;
}

function normalize_bitrix_webhook($url) {
    $u = trim((string) $url);
    if ($u === '') {
        return '';
    }
    // Quitar BOM / caracteres invisibles que rompen el token del webhook.
    $u = preg_replace('/^﻿/u', '', $u);
    $u = preg_replace('/[\x00-\x1F\x7F\x{200B}-\x{200D}\x{FEFF}]/u', '', $u);
    $u = trim($u);
    $u = preg_replace('#^https?://vits\.bitrix24\.com#i', 'https://vis.bitrix24.com', $u);
    $u = str_replace('\\', '/', $u);
    $u = preg_replace('#/crm\.[a-z0-9_.]+(\.json)?/?$#i', '/', $u);
    if (substr($u, -1) !== '/') {
        $u .= '/';
    }
    return $u;
}

function read_bitrix($path) {
    $defaults = [
        'enabled' => false,
        'webhook_base' => '',
        'stage_id' => '',
        // Columnas del embudo (panel ↔ Bitrix).
        'stage_cotizado' => '',
        'stage_pendiente' => '',
        'stage_seguimiento' => '',
        'stage_seguimiento_2' => '',
        'stage_seguimiento_3' => '',
        'stage_vendido' => '',
        'stage_vendido_2' => '',
        'stage_perdida' => '',
        'stage_perdida_2' => '',
        'stage_cerrado_modificado' => '',
        'stage_duplicada_recotizada' => '',
        'stage_map' => [],
        'category_id' => '',
        'currency_id' => 'COP',
        'marca_field' => 'UF_CRM_1749499637',
        'company_razon_field' => 'UF_CRM_1746192546',
        'updated_at' => '',
        'updated_by_nit' => '',
    ];
    if (!is_file($path)) {
        return $defaults;
    }
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data)) {
        return $defaults;
    }
    // Conservar stage_* / stage_map y demás claves del JSON (antes se perdían al leer).
    $cfg = array_merge($defaults, $data);
    $cfg['enabled'] = !empty($cfg['enabled']);
    $cfg['webhook_base'] = normalize_bitrix_webhook($cfg['webhook_base'] ?? '');
    $cfg['stage_id'] = trim((string) ($cfg['stage_id'] ?? ''));
    foreach ([
        'stage_cotizado', 'stage_pendiente', 'stage_seguimiento', 'stage_seguimiento_2', 'stage_seguimiento_3',
        'stage_vendido', 'stage_vendido_2', 'stage_perdida', 'stage_perdida_2', 'stage_cerrado_modificado',
        'stage_duplicada_recotizada',
    ] as $stageKey) {
        $cfg[$stageKey] = trim((string) ($cfg[$stageKey] ?? ''));
    }
    if ($cfg['stage_cotizado'] === '' && $cfg['stage_id'] !== '') {
        $cfg['stage_cotizado'] = $cfg['stage_id'];
    }
    // Completar stage_* vacíos con el embudo IZC (category 3).
    $stageDefaults = [
        'stage_cotizado' => 'C3:FINAL_INVOICE',
        'stage_pendiente' => 'C3:UC_G99HUH',
        'stage_seguimiento' => 'C3:NEW',
        'stage_vendido' => 'C3:EXECUTING',
        'stage_perdida' => 'C3:UC_S78RLD',
        'stage_cerrado_modificado' => 'C3:UC_MGTF3H',
        'stage_duplicada_recotizada' => 'C3:UC_M9PUWP',
    ];
    foreach ($stageDefaults as $k => $v) {
        if (trim((string) ($cfg[$k] ?? '')) === '') {
            $cfg[$k] = $v;
        }
    }
    if ($cfg['stage_id'] === '') {
        $cfg['stage_id'] = $cfg['stage_cotizado'];
    }
    if (!is_array($cfg['stage_map'] ?? null) || !$cfg['stage_map']) {
        $cfg['stage_map'] = [
            'C3:FINAL_INVOICE' => 'cotizado',
            'C3:UC_G99HUH' => 'pendiente',
            'C3:NEW' => 'seguimiento',
            'C3:PREPARATION' => 'seguimiento',
            'C3:PREPAYMENT_INVOICE' => 'seguimiento',
            'C3:EXECUTING' => 'vendido',
            'C3:WON' => 'vendido',
            'C3:UC_S78RLD' => 'perdida',
            'C3:LOSE' => 'perdida',
            'C3:UC_MGTF3H' => 'cerrado_modificado',
            'C3:UC_M9PUWP' => 'cotizado',
        ];
    } else {
        // Asegurar mapeo de DUPLICADA RECOTIZADA aunque el JSON sea viejo.
        if (!isset($cfg['stage_map']['C3:UC_M9PUWP'])) {
            $cfg['stage_map']['C3:UC_M9PUWP'] = 'cotizado';
        }
    }
    $cfg['category_id'] = trim((string) ($cfg['category_id'] ?? ''));
    $cfg['currency_id'] = strtoupper(trim((string) ($cfg['currency_id'] ?? 'COP'))) ?: 'COP';
    $marcaField = trim((string) ($cfg['marca_field'] ?? ''));
    $cfg['marca_field'] = $marcaField !== '' ? $marcaField : 'UF_CRM_1749499637';
    $razonField = trim((string) ($cfg['company_razon_field'] ?? ''));
    $cfg['company_razon_field'] = $razonField !== '' ? $razonField : 'UF_CRM_1746192546';
    $cfg['updated_at'] = (string) ($cfg['updated_at'] ?? '');
    $cfg['updated_by_nit'] = (string) ($cfg['updated_by_nit'] ?? '');
    return $cfg;
}

function write_bitrix($path, $cfg) {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $json = json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    return file_put_contents($path, $json . "\n", LOCK_EX) !== false;
}

function izc_bitrix_last_error($msg = null) {
    static $last = '';
    if ($msg !== null) {
        $last = (string) $msg;
    }
    return $last;
}

function bitrix_rest($webhookBase, $method, $payload) {
    $base = normalize_bitrix_webhook($webhookBase);
    izc_bitrix_last_error('');
    if ($base === '') {
        izc_bitrix_last_error('Webhook vacío.');
        return null;
    }
    $url = $base . ltrim($method, '/');
    $jsonBody = json_encode($payload);
    if ($jsonBody === false) {
        $jsonBody = '{}';
    }
    $lastErr = '';

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json; charset=utf-8'],
            CURLOPT_POSTFIELDS => $jsonBody,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
        ];
        if (defined('CURLOPT_NOSIGNAL')) {
            $opts[CURLOPT_NOSIGNAL] = true;
        }
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        $err = curl_error($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($raw !== false && $err === '') {
            $data = json_decode((string) $raw, true);
            if (is_array($data)) {
                return $data;
            }
            $lastErr = 'HTTP ' . $code . ' respuesta no JSON';
        } else {
            $lastErr = $err !== '' ? $err : ('HTTP ' . $code);
        }
        izc_bitrix_last_error($lastErr !== '' ? $lastErr : 'curl sin respuesta');
        return null;
    }

    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json; charset=utf-8\r\n",
            'content' => $jsonBody,
            'timeout' => 12,
            'ignore_errors' => true,
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
        ],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) {
        izc_bitrix_last_error('PHP no pudo salir por HTTPS. En WAMP activa php_curl y php_openssl.');
        return null;
    }
    $data = json_decode((string) $raw, true);
    if (!is_array($data)) {
        izc_bitrix_last_error('Bitrix no devolvió JSON.');
        return null;
    }
    return $data;
}

/**
 * Quita observadores del deal. El responsable (ASSIGNED_BY_ID / vendedor) se mantiene.
 * Bitrix suele poner al usuario del webhook como observador al crear vía REST.
 */
function bitrix_gp_fibra_observer_user_ids() {
    $ids = [];
    if (function_exists('get_gp_bitrix_ids')) {
        foreach (get_gp_bitrix_ids('GP23') as $id) {
            $n = (int) $id;
            if ($n > 0) {
                $ids[] = $n;
            }
        }
    }
    if (!$ids) {
        $ids[] = 201;
    }
    return array_values(array_unique($ids));
}

function quote_should_notify_gp_fibra_bitrix($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (function_exists('quote_is_made_by_asesor_vendedor') && !quote_is_made_by_asesor_vendedor($quote)) {
        return false;
    }
    if (function_exists('quote_has_fibra_product') && !quote_has_fibra_product($quote)) {
        return false;
    }
    $day = function_exists('quote_created_date_key') ? quote_created_date_key($quote) : substr((string) ($quote['created_at'] ?? ''), 0, 10);
    $desde = function_exists('quote_admin_historial_since') ? quote_admin_historial_since() : '2026-08-21';
    if ($day === '' || strcmp($day, $desde) < 0) {
        return false;
    }
    return true;
}

function bitrix_set_deal_observers($webhookBase, $dealId, $observerIds) {
    $dealId = trim((string) $dealId);
    if ($dealId === '' || !ctype_digit($dealId)) {
        return;
    }
    $keep = [];
    foreach (is_array($observerIds) ? $observerIds : [] as $id) {
        $n = (int) $id;
        if ($n > 0) {
            $keep[] = $n;
        }
    }
    $keep = array_values(array_unique($keep));
    bitrix_clear_deal_observers($webhookBase, $dealId);
    if (!$keep) {
        return;
    }
    bitrix_rest($webhookBase, 'crm.item.update.json', [
        'entityTypeId' => 2,
        'id' => (int) $dealId,
        'fields' => [
            'observers' => $keep,
        ],
    ]);
    bitrix_rest($webhookBase, 'crm.observer.add.json', [
        'entityTypeId' => 2,
        'entityId' => (int) $dealId,
        'userIds' => $keep,
    ]);
}

function bitrix_apply_quote_observers($quote, $dealId) {
    global $bitrixFile;
    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled']) || ($cfg['webhook_base'] ?? '') === '') {
        return false;
    }
    $keep = [];
    if (quote_should_notify_gp_fibra_bitrix($quote)) {
        $keep = bitrix_gp_fibra_observer_user_ids();
    }
    bitrix_set_deal_observers($cfg['webhook_base'], $dealId, $keep);
    return !empty($keep);
}

function gp_fibra_backfill_bitrix_observers($limit = 6) {
    global $quotesFile;
    $limit = max(1, min(12, (int) $limit));
    $quotes = read_quotes($quotesFile);
    $changed = false;
    $n = 0;
    foreach ($quotes as $i => $q) {
        if ($n >= $limit) {
            break;
        }
        if (!is_array($q) || !empty($q['bitrix_gp23_observer'])) {
            continue;
        }
        if (!quote_should_notify_gp_fibra_bitrix($q)) {
            continue;
        }
        $dealId = trim((string) ($q['bitrix_deal_id'] ?? ''));
        if (!function_exists('is_likely_bitrix_deal_id') || !is_likely_bitrix_deal_id($dealId)) {
            continue;
        }
        if (bitrix_apply_quote_observers($q, $dealId)) {
            $quotes[$i]['bitrix_gp23_observer'] = true;
            $changed = true;
            $n++;
        }
    }
    if ($changed) {
        write_quotes($quotesFile, $quotes);
    }
    return $n;
}

function bitrix_clear_deal_observers($webhookBase, $dealId) {
    $dealId = trim((string) $dealId);
    if ($dealId === '' || !ctype_digit($dealId)) {
        return;
    }
    // API universal: observers = []
    bitrix_rest($webhookBase, 'crm.item.update.json', [
        'entityTypeId' => 2,
        'id' => (int) $dealId,
        'fields' => [
            'observers' => [],
        ],
    ]);
    // Fallback: borrar uno a uno si el portal aún responde observers poblados.
    $got = bitrix_rest($webhookBase, 'crm.item.get.json', [
        'entityTypeId' => 2,
        'id' => (int) $dealId,
    ]);
    $item = is_array($got['result'] ?? null) ? $got['result'] : [];
    $observers = $item['observers'] ?? ($item['OBSERVERS'] ?? []);
    if (!is_array($observers) || !$observers) {
        return;
    }
    $userIds = [];
    foreach ($observers as $uid) {
        if (is_array($uid)) {
            $uid = $uid['id'] ?? ($uid['ID'] ?? ($uid['userId'] ?? null));
        }
        $uid = (int) $uid;
        if ($uid > 0) {
            $userIds[] = $uid;
        }
    }
    if ($userIds) {
        bitrix_rest($webhookBase, 'crm.observer.delete.json', [
            'entityTypeId' => 2,
            'entityId' => (int) $dealId,
            'userIds' => array_values(array_unique($userIds)),
        ]);
        bitrix_rest($webhookBase, 'crm.item.update.json', [
            'entityTypeId' => 2,
            'id' => (int) $dealId,
            'fields' => [
                'observers' => [],
            ],
        ]);
    }
}

function bitrix_opportunity($quote, $currencyId) {
    $currencyId = strtoupper((string) $currencyId);
    if ($currencyId === '') {
        $currencyId = 'COP';
    }
    $sum = 0.0;
    $hasItem = false;
    foreach (($quote['items'] ?? []) as $item) {
        if (!is_array($item)) {
            continue;
        }
        $hasItem = true;
        if ($currencyId === 'USD') {
            $v = $item['totalUsdIva'] ?? $item['usdIva'] ?? null;
        } else {
            $v = $item['totalCopIva'] ?? $item['copIva'] ?? null;
        }
        if ($v !== null && is_numeric($v)) {
            $sum += (float) $v;
        }
    }
    if ($hasItem && $sum > 0) {
        return $sum;
    }
    $totals = is_array($quote['totals'] ?? null) ? $quote['totals'] : [];
    if ($currencyId === 'USD' && isset($totals['usdIva'])) {
        return (float) $totals['usdIva'];
    }
    if (isset($totals['copIva'])) {
        return (float) $totals['copIva'];
    }
    return 0.0;
}

function bitrix_deal_currency($quote, $fallbackCurrency) {
    $hasUsd = false;
    $hasCop = false;
    foreach (($quote['items'] ?? []) as $item) {
        if (!is_array($item)) {
            continue;
        }
        $c = strtoupper((string) ($item['currency'] ?? 'USD'));
        if ($c === 'COP') {
            $hasCop = true;
        } else {
            $hasUsd = true;
        }
    }
    if ($hasUsd && !$hasCop) {
        return 'USD';
    }
    if ($hasCop && !$hasUsd) {
        return 'COP';
    }
    $totals = is_array($quote['totals'] ?? null) ? $quote['totals'] : [];
    if (!empty($totals['hasUsd']) && empty($totals['hasCop'])) {
        return 'USD';
    }
    if (!empty($totals['hasCop']) && empty($totals['hasUsd'])) {
        return 'COP';
    }
    $fallback = strtoupper((string) $fallbackCurrency);
    return $fallback !== '' ? $fallback : 'COP';
}

function format_bitrix_comments($quote) {
    $lines = [];
    $lines[] = 'Cotización IZC Mayorista';
    $qid = trim((string) ($quote['id'] ?? ''));
    if ($qid !== '') {
        $lines[] = 'ID IZC: ' . $qid;
    }
    $lines[] = 'NIT: ' . ($quote['nit'] ?? '');
    $lines[] = 'Cliente: ' . ($quote['nombre'] ?? '');
    $lines[] = 'TRM: ' . ($quote['trm'] ?? '');
    $lines[] = 'Fecha: ' . ($quote['created_at'] ?? '');
    $lines[] = '';
    $lines[] = 'Productos:';
    foreach (($quote['items'] ?? []) as $item) {
        if (!quote_item_line_is_real($item)) {
            continue;
        }
        $currency = strtoupper((string) ($item['currency'] ?? 'USD'));
        if ($currency === 'COP') {
            $total = $item['totalCopIva'] ?? $item['copIva'] ?? '';
            $suffix = ' COP + IVA';
        } else {
            $total = $item['totalUsdIva'] ?? $item['usdIva'] ?? '';
            $suffix = ' USD + IVA';
        }
        $lines[] = '- [' . ($item['sku'] ?? '') . '] ' . ($item['name'] ?? '') . ' x' . ($item['qty'] ?? '') . ' = ' . $total . $suffix;
    }
    $totals = is_array($quote['totals'] ?? null) ? $quote['totals'] : [];
    $lines[] = '';
    $hasUsd = !empty($totals['hasUsd']);
    $hasCop = !empty($totals['hasCop']);
    if (!$hasUsd && !$hasCop) {
        $hasUsd = isset($totals['usdIva']) && (float) $totals['usdIva'] > 0;
        $hasCop = isset($totals['copIva']) && (float) $totals['copIva'] > 0;
    }
    if ($hasUsd) {
        $lines[] = 'Total USD + IVA: ' . ($totals['usdIva'] ?? '');
    }
    if ($hasCop) {
        $lines[] = 'Total COP + IVA: ' . ($totals['copIva'] ?? '');
    }
    $empresa = quote_empresa_stored($quote);
    if ($empresa !== '') {
        $lines[] = 'Empresa: ' . $empresa;
    }
    return implode("\n", $lines);
}

function bitrix_first_id($response) {
    if (!is_array($response) || !isset($response['result'])) {
        return null;
    }
    $list = $response['result'];
    if (!is_array($list)) {
        return null;
    }
    foreach ($list as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (isset($row['ID'])) {
            return (string) $row['ID'];
        }
        if (isset($row['id'])) {
            return (string) $row['id'];
        }
    }
    return null;
}

function ensure_bitrix_company($webhookBase, $nit, $nombre, $assignedById = null) {
    $nit = trim((string) $nit);
    if ($nit === '') {
        return null;
    }
    $assignedById = trim((string) $assignedById);
    $found = bitrix_rest($webhookBase, 'crm.company.list.json', [
        'filter' => ['TITLE' => $nit],
        'select' => ['ID', 'TITLE', 'ASSIGNED_BY_ID'],
    ]);
    $existing = bitrix_first_id($found);
    if ($existing) {
        if ($assignedById !== '') {
            bitrix_rest($webhookBase, 'crm.company.update.json', [
                'id' => $existing,
                'fields' => ['ASSIGNED_BY_ID' => (int) $assignedById],
            ]);
        }
        return $existing;
    }
    $fields = [
        'TITLE' => $nit,
        'COMPANY_TYPE' => 'CUSTOMER',
        'INDUSTRY' => 'IT',
        'OPENED' => 'Y',
    ];
    if (trim((string) $nombre) !== '') {
        $fields['COMMENTS'] = 'Cliente IZC: ' . $nombre;
    }
    if ($assignedById !== '') {
        $fields['ASSIGNED_BY_ID'] = (int) $assignedById;
    }
    $created = bitrix_rest($webhookBase, 'crm.company.add.json', [
        'fields' => $fields,
        'params' => ['REGISTER_SONET_EVENT' => 'N'],
    ]);
    if (is_array($created) && !empty($created['error'])) {
        return null;
    }
    if (is_array($created) && isset($created['result']) && $created['result'] !== '' && $created['result'] !== null) {
        return (string) $created['result'];
    }
    return null;
}

function ensure_bitrix_contact($webhookBase, $nombre, $companyId = null, $nit = '', $assignedById = null) {
    $nombre = trim((string) $nombre);
    if ($nombre === '') {
        return null;
    }
    $assignedById = trim((string) $assignedById);

    $filter = ['NAME' => $nombre];
    if ($companyId) {
        $filter['COMPANY_ID'] = $companyId;
    }
    $found = bitrix_rest($webhookBase, 'crm.contact.list.json', [
        'filter' => $filter,
        'select' => ['ID', 'NAME', 'LAST_NAME', 'COMPANY_ID', 'ASSIGNED_BY_ID'],
    ]);
    $existing = bitrix_first_id($found);
    if ($existing) {
        if ($assignedById !== '') {
            $upd = ['ASSIGNED_BY_ID' => (int) $assignedById];
            if ($companyId) {
                $upd['COMPANY_ID'] = (int) $companyId;
            }
            bitrix_rest($webhookBase, 'crm.contact.update.json', [
                'id' => $existing,
                'fields' => $upd,
            ]);
        }
        return $existing;
    }

    $fields = [
        'NAME' => $nombre,
        'LAST_NAME' => '',
        'OPENED' => 'Y',
        'TYPE_ID' => 'CLIENT',
    ];
    if ($companyId) {
        $fields['COMPANY_ID'] = $companyId;
    }
    if (trim((string) $nit) !== '') {
        $fields['COMMENTS'] = 'NIT: ' . $nit;
    }
    if ($assignedById !== '') {
        $fields['ASSIGNED_BY_ID'] = (int) $assignedById;
    }

    $created = bitrix_rest($webhookBase, 'crm.contact.add.json', [
        'fields' => $fields,
        'params' => ['REGISTER_SONET_EVENT' => 'N'],
    ]);
    if (is_array($created) && !empty($created['error'])) {
        $fields['LAST_NAME'] = '-';
        $created = bitrix_rest($webhookBase, 'crm.contact.add.json', [
            'fields' => $fields,
            'params' => ['REGISTER_SONET_EVENT' => 'N'],
        ]);
    }
    if (is_array($created) && isset($created['result']) && $created['result'] !== '' && $created['result'] !== null) {
        return (string) $created['result'];
    }
    return null;
}

function brand_catalog_map() {
    $path = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'files' . DIRECTORY_SEPARATOR . 'brand_products.json';
    $map = [];
    if (!is_file($path)) {
        return $map;
    }
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data)) {
        return $map;
    }
    foreach ($data as $list) {
        if (!is_array($list)) {
            continue;
        }
        foreach ($list as $p) {
            if (!is_array($p) || empty($p['sku'])) {
                continue;
            }
            $sku = (string) $p['sku'];
            $meta = [
                'brand' => (string) ($p['brand'] ?? ''),
                'brandName' => (string) ($p['brandName'] ?? ($p['brand'] ?? '')),
                'name' => (string) ($p['name'] ?? ''),
                'category' => (string) ($p['category'] ?? ''),
                'type' => (string) ($p['type'] ?? ''),
            ];
            $map[$sku] = $meta;
            $nz = ltrim($sku, '0');
            if ($nz !== '' && !isset($map[$nz])) {
                $map[$nz] = $meta;
            }
        }
    }
    return $map;
}

function resolve_bitrix_marca_id($marcaItems, $brandKey, $brandName, $productHint) {
    if (!is_array($marcaItems) || !$marcaItems) {
        return null;
    }
    $brandU = strtoupper(trim((string) $brandName));
    if ($brandU === '') {
        $brandU = strtoupper(trim((string) $brandKey));
    }
    if ($brandU === '') {
        return null;
    }
    $hint = strtoupper((string) $productHint);
    $want = [];
    if (preg_match('/IMPRESORA|CABEZAL|RIBBON|ETIQUET|ZD\d|ZT\d|ZC\d|PRINT/i', $hint)) {
        $want[] = 'IMP';
        $want[] = 'ESCR';
    }
    if (preg_match('/LECTOR|SCAN|MAGELLAN|QUICKSCAN|DS\d/i', $hint)) {
        $want[] = 'LECTOR';
    }
    if (preg_match('/MOVIL|MOBILE|TC\d|MC\d|TERMINAL/i', $hint)) {
        $want[] = 'MOV';
    }
    if (preg_match('/CARNET|CARD|ZXP|ZC1|ZC3/i', $hint)) {
        $want[] = 'CARNET';
    }
    if (preg_match('/SUMINIST|RIBBON/i', $hint)) {
        $want[] = 'SUMINIST';
    }

    $bestId = null;
    $bestScore = -1;
    $brandKeyU = strtoupper(trim((string) $brandKey));
    foreach ($marcaItems as $it) {
        if (!is_array($it)) {
            continue;
        }
        $val = (string) ($it['VALUE'] ?? '');
        $valU = strtoupper($val);
        if ($brandU !== '' && strpos($valU, $brandU) === false && ($brandKeyU === '' || strpos($valU, $brandKeyU) === false)) {
            continue;
        }
        $score = 1;
        if ($valU === $brandU) {
            $score += 5;
        }
        foreach ($want as $w) {
            if (strpos($valU, $w) !== false) {
                $score += 3;
            }
        }
        if ($score > $bestScore) {
            $bestScore = $score;
            $bestId = (string) ($it['ID'] ?? '');
        }
    }
    return $bestId !== '' ? $bestId : null;
}

function get_quote_marca_id($webhookBase, $cfg, $quote) {
    $fieldName = (string) ($cfg['marca_field'] ?? 'UF_CRM_1749499637');
    $fields = bitrix_rest($webhookBase, 'crm.deal.fields.json', []);
    $items = [];
    if (is_array($fields) && isset($fields['result'][$fieldName]['items']) && is_array($fields['result'][$fieldName]['items'])) {
        $items = $fields['result'][$fieldName]['items'];
    }
    $brandMap = brand_catalog_map();
    foreach (($quote['items'] ?? []) as $item) {
        if (!is_array($item)) {
            continue;
        }
        $sku = (string) ($item['sku'] ?? '');
        $name = (string) ($item['name'] ?? '');
        $meta = $brandMap[$sku] ?? null;
        if (!$meta && $sku !== '') {
            $nz = ltrim($sku, '0');
            $meta = $brandMap[$nz] ?? null;
        }
        $brandKey = $meta['brand'] ?? (string) ($item['brand'] ?? '');
        $brandName = $meta['brandName'] ?? (string) ($item['brandName'] ?? '');
        if ($name === '' && !empty($meta['name'])) {
            $name = $meta['name'];
        }
        $hint = $name . ' ' . ($meta['category'] ?? '') . ' ' . ($meta['type'] ?? '');
        $id = resolve_bitrix_marca_id($items, $brandKey, $brandName, $hint);
        if ($id) {
            return $id;
        }
    }
    return null;
}

function build_bitrix_product_rows($quote, $dealCurrency) {
    $rows = [];
    $sort = 10;
    $dealCurrency = strtoupper((string) $dealCurrency);
    foreach (($quote['items'] ?? []) as $item) {
        if (!quote_item_line_is_real($item)) {
            continue;
        }
        $sku = (string) ($item['sku'] ?? '');
        $name = (string) ($item['name'] ?? $sku);
        $productName = $sku !== '' ? ($sku . '-' . $name) : $name;
        $qty = isset($item['qty']) ? (float) $item['qty'] : 1.0;
        if ($qty <= 0) {
            $qty = 1.0;
        }
        if ($dealCurrency === 'USD') {
            $unit = (float) ($item['usdIva'] ?? $item['usd'] ?? 0);
        } else {
            $unit = (float) ($item['copIva'] ?? $item['cop'] ?? 0);
        }
        $rows[] = [
            'PRODUCT_ID' => 0,
            'PRODUCT_NAME' => $productName,
            'PRICE' => round($unit, 2),
            'QUANTITY' => $qty,
            'TAX_RATE' => 19,
            'TAX_INCLUDED' => 'Y',
            'MEASURE_CODE' => 796,
            'MEASURE_NAME' => 'pcs.',
            'SORT' => $sort,
        ];
        $sort += 10;
    }
    return $rows;
}

function bitrix_uf_to_item_field($ufName) {
    $uf = trim((string) $ufName);
    if (preg_match('/^UF_CRM_(\d+)_(.+)$/', $uf, $m)) {
        return 'ufCrm' . $m[1] . '_' . $m[2];
    }
    return $uf;
}

function bitrix_nit_variants($nit) {
    $raw = preg_replace('/[\s.]/', '', trim((string) $nit));
    $n = normalize_nit($nit);
    $list = [];
    if ($n !== '') {
        $list[] = $n;
    }
    // Si el original traía DV, también buscar esa forma en Bitrix
    if (preg_match('/^\d+-\d$/', $raw) && !in_array($raw, $list, true)) {
        $list[] = $raw;
    }
    $digits = preg_replace('/\D+/', '', $n);
    if ($digits !== '' && !in_array($digits, $list, true)) {
        $list[] = $digits;
    }
    $noZeros = ltrim($digits, '0');
    if ($noZeros !== '' && !in_array($noZeros, $list, true)) {
        $list[] = $noZeros;
    }
    return $list;
}

function bitrix_seller_map() {
    $mapFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'bitrix_vendedores.json';
    if (!is_file($mapFile)) {
        return [];
    }
    $map = json_decode((string) file_get_contents($mapFile), true);
    return is_array($map) ? $map : [];
}

function bitrix_is_known_seller($userId, $map) {
    if (!$userId) {
        return false;
    }
    $key = (string) $userId;
    return isset($map[$key]) && trim((string) $map[$key]) !== '';
}


function bitrix_user_contact_info($webhookBase, $userId) {
    $userId = trim((string) $userId);
    if ($userId === '' || !ctype_digit($userId)) {
        return [
            'ok' => false,
            'bitrix_user_id' => '',
            'nombre' => '',
            'email' => '',
            'telefono' => '',
            'codigo' => '',
        ];
    }

    static $mem = [];
    if (isset($mem[$userId])) {
        return $mem[$userId];
    }

    $cacheFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'bitrix_user_contacts_cache.json';
    $cache = [];
    if (is_file($cacheFile)) {
        $raw = json_decode((string) file_get_contents($cacheFile), true);
        if (is_array($raw)) {
            $cache = $raw;
        }
    }
    $cached = $cache[$userId] ?? null;
    if (is_array($cached)) {
        $at = strtotime((string) ($cached['cached_at'] ?? ''));
        if ($at && (time() - $at) < 86400) {
            $mem[$userId] = $cached;
            return $cached;
        }
    }

    $resp = bitrix_rest($webhookBase, 'user.get.json', ['ID' => (int) $userId]);
    $u = is_array($resp) ? ($resp['result'] ?? null) : null;
    if (isset($u[0]) && is_array($u[0])) {
        $u = $u[0];
    }
    if (!is_array($u)) {
        $out = [
            'ok' => false,
            'bitrix_user_id' => $userId,
            'nombre' => '',
            'email' => '',
            'telefono' => '',
            'codigo' => resolve_asesor_codigo_from_bitrix_id($userId),
            'cached_at' => date('c'),
        ];
        $mem[$userId] = $out;
        return $out;
    }

    $parts = [];
    foreach (['NAME', 'SECOND_NAME', 'LAST_NAME'] as $keyName) {
        $v = trim((string) ($u[$keyName] ?? ''));
        if ($v !== '') {
            $parts[] = $v;
        }
    }
    $nombre = trim(implode(' ', $parts));
    // Quitar prefijos tipo "IZC V1" del nombre visible al cliente.
    $nombre = preg_replace('/^(?:IZC|VALTECH)\s*V\d+\s*[-–—]?\s*/iu', '', $nombre);
    $nombre = trim((string) $nombre);
    if ($nombre === '') {
        $mapName = trim((string) (bitrix_seller_map()[$userId] ?? ''));
        $nombre = preg_replace('/^(?:IZC|VALTECH)\s*V\d+\s*[-–—]?\s*/iu', '', $mapName);
        $nombre = trim((string) $nombre);
    }

    $email = trim((string) ($u['EMAIL'] ?? ''));
    $telefono = '';
    foreach (['PERSONAL_MOBILE', 'WORK_PHONE', 'PERSONAL_PHONE'] as $phoneKey) {
        $p = normalize_telefono_display($u[$phoneKey] ?? '');
        if ($p !== '') {
            $telefono = $p;
            break;
        }
    }

    $out = [
        'ok' => true,
        'bitrix_user_id' => $userId,
        'nombre' => $nombre,
        'email' => $email,
        'telefono' => $telefono,
        'codigo' => resolve_asesor_codigo_from_bitrix_id($userId),
        'cached_at' => date('c'),
    ];
    $cache[$userId] = $out;
    @file_put_contents($cacheFile, json_encode($cache, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    $mem[$userId] = $out;
    return $out;
}

function bitrix_user_display_name($webhookBase, $userId) {
    if (!$userId) {
        return '';
    }
    $map = bitrix_seller_map();
    $key = (string) $userId;
    if (isset($map[$key]) && trim((string) $map[$key]) !== '') {
        return trim((string) $map[$key]);
    }
    $resp = bitrix_rest($webhookBase, 'user.get.json', ['ID' => $userId]);
    if (!is_array($resp) || empty($resp['result'])) {
        return 'ID ' . $userId;
    }
    $u = $resp['result'];
    if (isset($u[0]) && is_array($u[0])) {
        $u = $u[0];
    }
    if (!is_array($u)) {
        return 'ID ' . $userId;
    }
    $parts = [];
    foreach (['NAME', 'SECOND_NAME', 'LAST_NAME'] as $keyName) {
        $v = trim((string) ($u[$keyName] ?? ''));
        if ($v !== '') {
            $parts[] = $v;
        }
    }
    if ($parts) {
        return trim(implode(' ', $parts));
    }
    $email = trim((string) ($u['EMAIL'] ?? ''));
    return $email !== '' ? $email : ('ID ' . $userId);
}

function bitrix_company_field_value($company, $fieldName) {
    if (!is_array($company) || $fieldName === '') {
        return '';
    }
    if (!array_key_exists($fieldName, $company)) {
        return '';
    }
    $raw = $company[$fieldName];
    if ($raw === null || $raw === '') {
        return '';
    }
    if (is_array($raw)) {
        $parts = [];
        foreach ($raw as $x) {
            if (is_array($x) && isset($x['value'])) {
                $s = trim((string) $x['value']);
            } else {
                $s = trim((string) $x);
            }
            if ($s !== '') {
                $parts[] = $s;
            }
        }
        return trim(implode(', ', $parts));
    }
    return trim((string) $raw);
}

function bitrix_seller_from_company_deals($webhookBase, $companyIds, $sellerMap) {
    foreach ($companyIds as $companyId) {
        if (!$companyId) {
            continue;
        }
        $dealList = bitrix_rest($webhookBase, 'crm.deal.list.json', [
            'filter' => ['COMPANY_ID' => $companyId],
            'select' => ['ID', 'ASSIGNED_BY_ID', 'TITLE', 'DATE_CREATE'],
            'order' => ['ID' => 'DESC'],
            'start' => 0,
        ]);
        if (!is_array($dealList) || empty($dealList['result']) || !is_array($dealList['result'])) {
            continue;
        }
        foreach ($dealList['result'] as $deal) {
            if (!is_array($deal)) {
                continue;
            }
            $assigned = $deal['ASSIGNED_BY_ID'] ?? null;
            if (bitrix_is_known_seller($assigned, $sellerMap)) {
                return [
                    'assigned_by_id' => $assigned,
                    'company_id' => $companyId,
                    'deal_id' => $deal['ID'] ?? null,
                    'source' => 'company_deal',
                ];
            }
        }
    }
    return null;
}

function find_bitrix_seller_by_nit($webhookBase, $cfg, $nit) {
    $razonField = trim((string) ($cfg['company_razon_field'] ?? 'UF_CRM_1746192546'));
    if ($razonField === '') {
        $razonField = 'UF_CRM_1746192546';
    }
    $sellerMap = bitrix_seller_map();
    $variants = bitrix_nit_variants($nit);
    if (!$variants) {
        return [
            'found' => false,
            'seller_missing' => true,
            'assigned_by_id' => null,
            'seller_name' => '',
            'razon_social' => '',
            'nit' => $nit,
            'source' => 'company',
            'warning' => 'NIT vacío; no se pudo buscar vendedor en Compañías.',
        ];
    }

    $companiesFound = [];
    $bestMapped = null;
    $bestAny = null;

    foreach ($variants as $variant) {
        $found = bitrix_rest($webhookBase, 'crm.company.list.json', [
            'filter' => ['TITLE' => $variant],
            'select' => ['ID', 'TITLE', 'ASSIGNED_BY_ID', $razonField],
        ]);
        if (!is_array($found) || empty($found['result']) || !is_array($found['result'])) {
            continue;
        }
        foreach ($found['result'] as $co) {
            if (!is_array($co)) {
                continue;
            }
            $assigned = $co['ASSIGNED_BY_ID'] ?? null;
            $razon = bitrix_company_field_value($co, $razonField);
            if ($razon === '') {
                $razon = trim((string) ($co['TITLE'] ?? ''));
            }
            $row = [
                'assigned_by_id' => $assigned,
                'razon_social' => $razon,
                'nit_matched' => $variant,
                'company_id' => $co['ID'] ?? null,
                'source' => 'company',
            ];
            $companiesFound[] = $row;
            if ($assigned && bitrix_is_known_seller($assigned, $sellerMap)) {
                $bestMapped = $row;
                break 2;
            }
            if ($assigned && $bestAny === null) {
                $bestAny = $row;
            }
            if ($bestAny === null) {
                $bestAny = $row;
            }
        }
    }

    if ($bestMapped) {
        return [
            'found' => true,
            'seller_missing' => false,
            'assigned_by_id' => $bestMapped['assigned_by_id'],
            'seller_name' => bitrix_user_display_name($webhookBase, $bestMapped['assigned_by_id']),
            'razon_social' => (string) $bestMapped['razon_social'],
            'nit' => $nit,
            'source' => 'company',
            'warning' => '',
        ];
    }

    $companyIds = [];
    foreach ($companiesFound as $c) {
        if (!empty($c['company_id'])) {
            $companyIds[] = $c['company_id'];
        }
    }
    $companyIds = array_values(array_unique($companyIds));
    $fromDeal = bitrix_seller_from_company_deals($webhookBase, $companyIds, $sellerMap);
    if (is_array($fromDeal) && !empty($fromDeal['assigned_by_id'])) {
        $razon = '';
        foreach ($companiesFound as $c) {
            if ((string) ($c['company_id'] ?? '') === (string) $fromDeal['company_id']) {
                $razon = (string) $c['razon_social'];
                break;
            }
        }
        return [
            'found' => true,
            'seller_missing' => false,
            'assigned_by_id' => $fromDeal['assigned_by_id'],
            'seller_name' => bitrix_user_display_name($webhookBase, $fromDeal['assigned_by_id']),
            'razon_social' => $razon,
            'nit' => $nit,
            'source' => 'company_deal',
            'warning' => '',
        ];
    }

    if ($bestAny === null) {
        return [
            'found' => false,
            'seller_missing' => true,
            'assigned_by_id' => null,
            'seller_name' => '',
            'razon_social' => '',
            'nit' => $nit,
            'source' => 'company',
            'warning' => 'El cliente NIT ' . $nit . ' no existe en Compañías de Bitrix o no se pudo consultar. Verifica.',
        ];
    }

    if (empty($bestAny['assigned_by_id'])) {
        return [
            'found' => true,
            'seller_missing' => true,
            'assigned_by_id' => null,
            'seller_name' => '',
            'razon_social' => (string) $bestAny['razon_social'],
            'nit' => $nit,
            'source' => 'company',
            'warning' => 'El cliente NIT ' . $nit . ' existe en Compañías pero no tiene vendedor IZC asignado. Verifica.',
        ];
    }

    $sellerName = bitrix_user_display_name($webhookBase, $bestAny['assigned_by_id']);
    return [
        'found' => true,
        'seller_missing' => true,
        'assigned_by_id' => null,
        'seller_name' => $sellerName,
        'razon_social' => (string) $bestAny['razon_social'],
        'nit' => $nit,
        'source' => 'company',
        'warning' => 'El cliente NIT ' . $nit . ' no tiene un vendedor IZC válido en Compañías ni en negociaciones previas (Responsable actual: ' . $sellerName . '). Verifica.',
    ];
}

function send_bitrix_deal($quote, $quick = false) {
    global $bitrixFile;
    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled'])) {
        return ['ok' => false, 'skipped' => true, 'error' => 'Bitrix desactivado.'];
    }
    if ($cfg['webhook_base'] === '' || $cfg['stage_id'] === '') {
        return ['ok' => false, 'skipped' => true, 'error' => 'Falta webhook o STAGE_ID de Bitrix.'];
    }
    $dealCurrency = bitrix_deal_currency($quote, $cfg['currency_id']);
    $opportunity = bitrix_opportunity($quote, $dealCurrency);
    $nit = (string) ($quote['nit'] ?? '');
    $nombre = (string) ($quote['nombre'] ?? '');

    // Prioridad: código del asesor que cotizó → ID Bitrix mapeado.
    // Nunca usar el responsable previo de la compañía/NIT si hay seller_codigo
    // (eso asignaba a David/ST8 en contactos nuevos vía el webhook).
    $sellerCodigo = normalize_asesor_codigo($quote['seller_codigo'] ?? ($quote['asesor_cotizado_by'] ?? ''));
    $forcedAssigned = '';
    if ($sellerCodigo !== '') {
        $ids = get_asesor_bitrix_ids($sellerCodigo);
        if ($ids) {
            $forcedAssigned = (string) $ids[0];
        }
    }
    if ($forcedAssigned === '') {
        $forcedAssigned = trim((string) ($quote['assigned_by_id'] ?? ''));
    }
    $quoteSource = strtolower(trim((string) ($quote['quote_source'] ?? '')));
    if ($forcedAssigned !== '') {
        $forcedName = trim((string) ($quote['seller_name'] ?? ''));
        if ($forcedName === '') {
            $map = bitrix_seller_map();
            if (isset($map[$forcedAssigned]) && trim((string) $map[$forcedAssigned]) !== '') {
                $forcedName = trim((string) $map[$forcedAssigned]);
            }
        }
        if ($forcedName === '' && !$quick) {
            $forcedName = bitrix_user_display_name($cfg['webhook_base'], $forcedAssigned);
        }
        $sellerInfo = [
            'found' => true,
            'seller_missing' => false,
            'assigned_by_id' => $forcedAssigned,
            'seller_name' => $forcedName,
            'razon_social' => '',
            'warning' => '',
            'source' => $sellerCodigo !== '' ? 'asesor' : 'quote',
        ];
    } elseif ($sellerCodigo !== '' || $quoteSource === 'asesor') {
        return [
            'ok' => false,
            'skipped' => false,
            'error' => 'Asesor sin ID Bitrix mapeado (' . ($sellerCodigo !== '' ? $sellerCodigo : 'asesor') . '). Revisa data/asesor_clientes_index.json / bitrix_vendedores.json.',
            'seller_missing' => true,
            'seller_name' => '',
            'seller_warning' => 'No se asignó responsable por NIT para evitar dueño incorrecto del webhook.',
        ];
    } else {
        $sellerInfo = find_bitrix_seller_by_nit($cfg['webhook_base'], $cfg, $nit);
    }

    $assignId = trim((string) ($sellerInfo['assigned_by_id'] ?? ''));
    $companyId = ensure_bitrix_company($cfg['webhook_base'], $nit, $nombre, $assignId !== '' ? $assignId : null);
    $contactId = ensure_bitrix_contact($cfg['webhook_base'], $nombre, $companyId, $nit, $assignId !== '' ? $assignId : null);
    if (!$companyId || !$contactId) {
        return [
            'ok' => false,
            'skipped' => false,
            'error' => 'No se pudo crear Compañía (NIT) o Contacto (nombre) en Bitrix. Revisa permisos CRM del webhook.',
            'seller_missing' => !empty($sellerInfo['seller_missing']),
            'seller_name' => (string) ($sellerInfo['seller_name'] ?? ''),
            'seller_warning' => (string) ($sellerInfo['warning'] ?? ''),
        ];
    }

    // Modo rápido: no cargar crm.deal.fields (marca) — eso suele costar varios segundos.
    $marcaId = $quick ? null : get_quote_marca_id($cfg['webhook_base'], $cfg, $quote);
    $quoteOriginId = trim((string) ($quote['id'] ?? ''));
    $stageForCreate = bitrix_stage_id_for_quote($quote, $cfg, 'cotizado');
    if ($stageForCreate === '') {
        $stageForCreate = trim((string) ($cfg['stage_id'] ?? ''));
    }
    $fields = [
        'STAGE_ID' => $stageForCreate,
        'OPPORTUNITY' => $opportunity,
        'CURRENCY_ID' => $dealCurrency,
        'COMMENTS' => format_bitrix_comments($quote),
        'OPENED' => 'Y',
        'COMPANY_ID' => $companyId,
        'CONTACT_ID' => $contactId,
        'CONTACT_IDS' => [(int) $contactId],
    ];
    if ($quoteOriginId !== '') {
        // Permite recuperar luego el N° de negociación Bitrix desde el id interno IZC.
        $fields['ORIGIN_ID'] = $quoteOriginId;
        $fields['ORIGINATOR_ID'] = 'IZC';
    }
    if ($cfg['category_id'] !== '') {
        $fields['CATEGORY_ID'] = is_numeric($cfg['category_id']) ? (int) $cfg['category_id'] : $cfg['category_id'];
    }
    if ($marcaId) {
        $fields[$cfg['marca_field']] = $marcaId;
    }
    if (!empty($sellerInfo['assigned_by_id'])) {
        $fields['ASSIGNED_BY_ID'] = (int) $sellerInfo['assigned_by_id'];
    }
    $result = bitrix_rest($cfg['webhook_base'], 'crm.deal.add.json', ['fields' => $fields]);
    if ($result === null) {
        return ['ok' => false, 'skipped' => false, 'error' => 'No se pudo contactar Bitrix.'];
    }
    if (!empty($result['error'])) {
        $err = isset($result['error_description']) ? (string) $result['error_description'] : (string) $result['error'];
        return ['ok' => false, 'skipped' => false, 'error' => $err];
    }
    $dealId = isset($result['result']) ? (string) $result['result'] : '';
    if ($dealId === '') {
        return ['ok' => false, 'skipped' => false, 'error' => 'Bitrix no devolvió ID.'];
    }

    // Modo rápido: devolver N° al instante; el resto lo completa sync_bitrix_quote.
    if ($quick) {
        return [
            'ok' => true,
            'skipped' => false,
            'quick' => true,
            'deal_id' => $dealId,
            'company_id' => $companyId,
            'contact_id' => $contactId,
            'marca_id' => null,
            'products_ok' => false,
            'assigned_by_id' => $sellerInfo['assigned_by_id'] ?? null,
            'seller_name' => (string) ($sellerInfo['seller_name'] ?? ''),
            'seller_missing' => !empty($sellerInfo['seller_missing']),
            'seller_warning' => (string) ($sellerInfo['warning'] ?? ''),
            'razon_social' => (string) ($sellerInfo['razon_social'] ?? ''),
        ];
    }

    // Titulo en espanol sin acentos (evita mojibake)
    $updateFields = ['TITLE' => 'Negociacion #' . $dealId];
    if (!empty($sellerInfo['assigned_by_id'])) {
        $updateFields['ASSIGNED_BY_ID'] = (int) $sellerInfo['assigned_by_id'];
    }
    bitrix_rest($cfg['webhook_base'], 'crm.deal.update.json', [
        'id' => $dealId,
        'fields' => $updateFields,
    ]);
    // Vendedor = responsable. GP23 (fibra) queda observador para ver la negociación.
    bitrix_apply_quote_observers($quote, $dealId);
    bitrix_rest($cfg['webhook_base'], 'crm.deal.contact.add.json', [
        'id' => $dealId,
        'fields' => [
            'CONTACT_ID' => $contactId,
            'IS_PRIMARY' => 'Y',
        ],
    ]);

    $rows = build_bitrix_product_rows($quote, $dealCurrency);
    $productsOk = false;
    if ($rows) {
        $products = bitrix_rest($cfg['webhook_base'], 'crm.deal.productrows.set.json', [
            'id' => $dealId,
            'rows' => $rows,
        ]);
        $productsOk = is_array($products) && empty($products['error']);
    }

    return [
        'ok' => true,
        'skipped' => false,
        'deal_id' => $dealId,
        'company_id' => $companyId,
        'contact_id' => $contactId,
        'marca_id' => $marcaId,
        'products_ok' => $productsOk,
        'assigned_by_id' => $sellerInfo['assigned_by_id'] ?? null,
        'seller_name' => (string) ($sellerInfo['seller_name'] ?? ''),
        'seller_missing' => !empty($sellerInfo['seller_missing']),
        'seller_warning' => (string) ($sellerInfo['warning'] ?? ''),
        'razon_social' => (string) ($sellerInfo['razon_social'] ?? ''),
    ];
}

/**
 * Completa título, productos y limpieza de observadores en un deal ya creado (modo rápido).
 */
function complete_bitrix_deal_extras($quote, $dealId) {
    global $bitrixFile;
    $dealId = trim((string) $dealId);
    if ($dealId === '' || !is_array($quote)) {
        return ['ok' => false, 'error' => 'Faltan datos para completar Bitrix.'];
    }
    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled']) || $cfg['webhook_base'] === '') {
        return ['ok' => false, 'skipped' => true, 'error' => 'Bitrix desactivado.'];
    }
    $dealCurrency = bitrix_deal_currency($quote, $cfg['currency_id']);
    $opportunity = bitrix_opportunity($quote, $dealCurrency);
    $assignId = trim((string) ($quote['assigned_by_id'] ?? ''));
    $sellerCodigo = normalize_asesor_codigo($quote['seller_codigo'] ?? ($quote['asesor_cotizado_by'] ?? ''));
    if ($sellerCodigo !== '') {
        $ids = get_asesor_bitrix_ids($sellerCodigo);
        if ($ids) {
            $assignId = (string) $ids[0];
        }
    }
    $quoteOriginId = trim((string) ($quote['id'] ?? ''));
    $hasRealItems = quote_has_real_items($quote);

    $updateFields = [
        'TITLE' => 'Negociacion #' . $dealId,
        'OPPORTUNITY' => $opportunity,
        'CURRENCY_ID' => $dealCurrency,
    ];
    if ($hasRealItems) {
        $updateFields['COMMENTS'] = format_bitrix_comments($quote);
    }
    if ($quoteOriginId !== '') {
        $updateFields['ORIGIN_ID'] = $quoteOriginId;
        $updateFields['ORIGINATOR_ID'] = 'IZC';
    }
    if ($assignId !== '') {
        $updateFields['ASSIGNED_BY_ID'] = (int) $assignId;
    }
    bitrix_rest($cfg['webhook_base'], 'crm.deal.update.json', [
        'id' => $dealId,
        'fields' => $updateFields,
    ]);
    bitrix_apply_quote_observers($quote, $dealId);

    if ($assignId !== '') {
        $dealGot = bitrix_rest($cfg['webhook_base'], 'crm.deal.get.json', ['id' => $dealId]);
        $dealRow = is_array($dealGot) ? ($dealGot['result'] ?? []) : [];
        $companyId = trim((string) ($dealRow['COMPANY_ID'] ?? ($quote['company_id'] ?? '')));
        $contactId = trim((string) ($dealRow['CONTACT_ID'] ?? ($quote['contact_id'] ?? '')));
        if ($companyId !== '' && (int) $companyId > 0) {
            bitrix_rest($cfg['webhook_base'], 'crm.company.update.json', [
                'id' => $companyId,
                'fields' => ['ASSIGNED_BY_ID' => (int) $assignId],
            ]);
        }
        if ($contactId !== '' && (int) $contactId > 0) {
            bitrix_rest($cfg['webhook_base'], 'crm.contact.update.json', [
                'id' => $contactId,
                'fields' => ['ASSIGNED_BY_ID' => (int) $assignId],
            ]);
        }
    }

    $rows = build_bitrix_product_rows($quote, $dealCurrency);
    $productsOk = false;
    if ($rows) {
        $products = bitrix_rest($cfg['webhook_base'], 'crm.deal.productrows.set.json', [
            'id' => $dealId,
            'rows' => $rows,
        ]);
        $productsOk = is_array($products) && empty($products['error']);
    }
    return [
        'ok' => true,
        'deal_id' => $dealId,
        'products_ok' => $productsOk,
        'completed' => true,
        'assigned_by_id' => $assignId !== '' ? $assignId : null,
        'products_skipped' => !$rows,
    ];
}

/**
 * True si parece ID de negociación Bitrix (no el id interno IZC tipo 20260910...).
 */
function is_likely_bitrix_deal_id($val) {
    $s = trim((string) $val);
    if ($s === '' || !preg_match('/^\d+$/', $s)) {
        return false;
    }
    if (strlen($s) > 12) {
        return false;
    }
    if (preg_match('/^20\d{6,}/', $s)) {
        return false;
    }
    return true;
}

/**
 * Obtiene el ID de negociación Bitrix para una cotización IZC.
 * Si lo encuentra y $persist es true, lo guarda en cotizaciones.json.
 */
function resolve_bitrix_deal_id_for_quote($quote, $persist = true) {
    global $bitrixFile, $quotesFile;
    if (!is_array($quote)) {
        return '';
    }
    $quoteId = trim((string) ($quote['id'] ?? ''));
    // Preferir la cotización completa del archivo (el listado a veces viene sin deal_id).
    if ($quoteId !== '') {
        foreach (read_quotes($quotesFile) as $q) {
            if (is_array($q) && (string) ($q['id'] ?? '') === $quoteId) {
                $quote = $q;
                break;
            }
        }
    }
    $existing = trim((string) ($quote['bitrix_deal_id'] ?? ''));
    if ($existing !== '' && is_likely_bitrix_deal_id($existing)) {
        return $existing;
    }
    if ($quoteId === '') {
        return '';
    }
    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled']) || empty($cfg['webhook_base'])) {
        return '';
    }
    $webhook = $cfg['webhook_base'];
    $dealId = '';

    $tryList = function ($filter) use ($webhook, &$dealId) {
        if ($dealId !== '') {
            return;
        }
        $found = bitrix_rest($webhook, 'crm.deal.list.json', [
            'filter' => $filter,
            'select' => ['ID', 'TITLE', 'ORIGIN_ID', 'DATE_CREATE', 'COMPANY_ID', 'COMMENTS'],
            'order' => ['ID' => 'DESC'],
            'start' => 0,
        ]);
        if (!is_array($found) || empty($found['result']) || !is_array($found['result'])) {
            return;
        }
        $first = $found['result'][0] ?? null;
        if (is_array($first) && !empty($first['ID']) && is_likely_bitrix_deal_id($first['ID'])) {
            $dealId = (string) $first['ID'];
        }
    };

    $tryList(['ORIGIN_ID' => $quoteId]);
    $tryList(['%COMMENTS' => 'ID IZC: ' . $quoteId]);
    $tryList(['%COMMENTS' => $quoteId]);
    $idHead = explode('-', $quoteId)[0];
    if ($idHead !== '' && $idHead !== $quoteId) {
        $tryList(['%COMMENTS' => $idHead]);
    }

    if ($dealId === '') {
        $companyId = null;
        foreach (bitrix_nit_variants($quote['nit'] ?? '') as $variant) {
            if ($variant === '') {
                continue;
            }
            $companies = bitrix_rest($webhook, 'crm.company.list.json', [
                'filter' => ['TITLE' => $variant],
                'select' => ['ID', 'TITLE'],
            ]);
            $companyId = bitrix_first_id($companies);
            if ($companyId) {
                break;
            }
            $companies = bitrix_rest($webhook, 'crm.company.list.json', [
                'filter' => ['%TITLE' => $variant],
                'select' => ['ID', 'TITLE'],
            ]);
            $companyId = bitrix_first_id($companies);
            if ($companyId) {
                break;
            }
        }
        if ($companyId) {
            $found = bitrix_rest($webhook, 'crm.deal.list.json', [
                'filter' => ['COMPANY_ID' => $companyId],
                'select' => ['ID', 'TITLE', 'DATE_CREATE', 'COMMENTS', 'ORIGIN_ID'],
                'order' => ['ID' => 'DESC'],
                'start' => 0,
            ]);
            $rows = (is_array($found) && isset($found['result']) && is_array($found['result'])) ? $found['result'] : [];
            $quoteDay = '';
            $created = trim((string) ($quote['created_at'] ?? ''));
            if ($created !== '' && preg_match('/^(\d{4}-\d{2}-\d{2})/', $created, $m)) {
                $quoteDay = $m[1];
            }
            $sameDay = [];
            foreach ($rows as $row) {
                if (!is_array($row) || empty($row['ID'])) {
                    continue;
                }
                $comments = (string) ($row['COMMENTS'] ?? '');
                $origin = (string) ($row['ORIGIN_ID'] ?? '');
                if ($origin === $quoteId || ($comments !== '' && (strpos($comments, $quoteId) !== false || ($idHead !== '' && strpos($comments, $idHead) !== false)))) {
                    $dealId = (string) $row['ID'];
                    break;
                }
                if ($quoteDay !== '') {
                    $dc = (string) ($row['DATE_CREATE'] ?? '');
                    if ($dc !== '' && strpos($dc, $quoteDay) === 0) {
                        $sameDay[] = $row;
                    }
                }
            }
            if ($dealId === '' && count($sameDay) === 1 && !empty($sameDay[0]['ID'])) {
                $dealId = (string) $sameDay[0]['ID'];
            } elseif ($dealId === '' && count($sameDay) > 1 && !empty($sameDay[0]['ID'])) {
                // Varios el mismo día: tomar el más reciente.
                $dealId = (string) $sameDay[0]['ID'];
            }
            if ($dealId === '' && count($rows) === 1 && !empty($rows[0]['ID'])) {
                $dealId = (string) $rows[0]['ID'];
            }
        }
    }

    if ($dealId === '' || !$persist) {
        return $dealId;
    }

    $quotes = read_quotes($quotesFile);
    $changed = false;
    foreach ($quotes as &$q) {
        if (!is_array($q) || (string) ($q['id'] ?? '') !== $quoteId) {
            continue;
        }
        $q['bitrix_deal_id'] = $dealId;
        $changed = true;
        break;
    }
    unset($q);
    if ($changed) {
        write_quotes($quotesFile, $quotes);
    }
    return $dealId;
}

/**
 * Resuelve o crea la negociación Bitrix de una cotización y persiste el ID.
 */
function ensure_bitrix_deal_id_for_quote($quote) {
    global $quotesFile;
    $dealId = resolve_bitrix_deal_id_for_quote($quote, true);
    if ($dealId !== '') {
        return ['ok' => true, 'deal_id' => $dealId, 'created' => false, 'error' => ''];
    }
    $quoteId = trim((string) ($quote['id'] ?? ''));
    if ($quoteId === '') {
        return ['ok' => false, 'deal_id' => '', 'created' => false, 'error' => 'Cotización sin id.'];
    }
    // Usar la cotización completa del archivo (no el resumen del listado).
    $full = null;
    foreach (read_quotes($quotesFile) as $q) {
        if (is_array($q) && (string) ($q['id'] ?? '') === $quoteId) {
            $full = $q;
            break;
        }
    }
    if (!$full) {
        $full = $quote;
    }
    $bitrix = ['ok' => false, 'error' => 'Bitrix no ejecutado.'];
    try {
        $bitrix = send_bitrix_deal($full);
    } catch (Throwable $e) {
        $bitrix = ['ok' => false, 'error' => 'Bitrix: ' . $e->getMessage()];
    }
    $dealId = !empty($bitrix['deal_id']) ? (string) $bitrix['deal_id'] : '';
    if ($dealId === '') {
        $err = trim((string) ($bitrix['error'] ?? ''));
        if ($err === '' && !empty($bitrix['skipped'])) {
            $err = 'Bitrix no está activo o no está configurado.';
        }
        if ($err === '') {
            $err = 'No se pudo crear la negociación en Bitrix.';
        }
        return ['ok' => false, 'deal_id' => '', 'created' => false, 'error' => $err];
    }
    $quotes = read_quotes($quotesFile);
    foreach ($quotes as &$q) {
        if (!is_array($q) || (string) ($q['id'] ?? '') !== $quoteId) {
            continue;
        }
        $q['bitrix_deal_id'] = $dealId;
        break;
    }
    unset($q);
    write_quotes($quotesFile, $quotes);
    return ['ok' => true, 'deal_id' => $dealId, 'created' => true, 'error' => ''];
}

function normalize_nit($nit) {
    $nit = trim((string) $nit);
    $nit = preg_replace('/[\s.]/', '', $nit);
    // Quitar dígito de verificación: 900639921-7 -> 900639921
    $nit = preg_replace('/-\d$/', '', $nit);
    return $nit;
}

/** Identificador del administrador del panel (ver $adminNits arriba). */

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

function find_user($users, $nit) {
    foreach ($users as $i => $u) {
        if (isset($u['nit']) && normalize_nit($u['nit']) === $nit) {
            return [$i, $u];
        }
    }
    return [null, null];
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
    global $usersFile;
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
        write_users($usersFile, $users);
    }
    return [$users, $user];
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

    // Compatibilidad con registros viejos en texto plano
    $legacy = (string) ($user['password'] ?? '');
    return $legacy !== '' && hash_equals($legacy, $password);
}

function public_user($nit, $passwordHash, $createdAt, $nombre = '', $contactoNombre = '', $contactoTelefono = '') {
    $contactoNombre = trim((string) $contactoNombre);
    $contactoTelefono = normalize_telefono_display($contactoTelefono);
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

function json_out($payload, $code = 200) {
    while (function_exists('ob_get_level') && ob_get_level() > 0) {
        @ob_end_clean();
    }
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate');
        header('Access-Control-Allow-Origin: *');
    }
    http_response_code((int) $code);
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        $json = '{"ok":false,"error":"No se pudo codificar la respuesta JSON."}';
        http_response_code(500);
    }
    echo $json;
    exit;
}

function izc_fail_json($message, $code = 500, $extra = []) {
    $payload = array_merge(['ok' => false, 'error' => (string) $message], is_array($extra) ? $extra : []);
    json_out($payload, $code);
}

@ini_set('memory_limit', '512M');
@ini_set('max_execution_time', '120');
@set_time_limit(120);

register_shutdown_function(function () {
    $err = error_get_last();
    if (!$err || !is_array($err)) {
        return;
    }
    $fatalTypes = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR];
    if (!in_array((int) ($err['type'] ?? 0), $fatalTypes, true)) {
        return;
    }
    // Si ya se envió JSON limpio, no pisar.
    if (headers_sent()) {
        return;
    }
    while (function_exists('ob_get_level') && ob_get_level() > 0) {
        @ob_end_clean();
    }
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => 'Error PHP: ' . (string) ($err['message'] ?? 'fatal'),
        'file' => basename((string) ($err['file'] ?? '')),
        'line' => (int) ($err['line'] ?? 0),
    ], JSON_UNESCAPED_UNICODE);
});

set_exception_handler(function ($e) {
    izc_fail_json(
        'Excepción: ' . $e->getMessage(),
        500,
        [
            'file' => basename($e->getFile()),
            'line' => $e->getLine(),
        ]
    );
});

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

if ($action === 'register') {
    $nit = normalize_nit($body['nit'] ?? '');
    $password = (string) ($body['password'] ?? '');
    $nombre = trim((string) ($body['nombre'] ?? ($body['name'] ?? '')));
    $contactoNombre = trim((string) ($body['contacto_nombre'] ?? ($body['nombre_contacto'] ?? '')));
    $contactoTelefono = normalize_telefono_display($body['contacto_telefono'] ?? ($body['telefono_contacto'] ?? ($body['telefono'] ?? '')));

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

function is_zkteco_login_id($raw) {
    $s = strtoupper(preg_replace('/[\s.]/', '', trim((string) $raw)));
    return $s === 'ZKTECO';
}

function is_sat_login_id($raw) {
    $s = strtoupper(preg_replace('/[\s.]/', '', trim((string) $raw)));
    return $s === 'SAT' || $s === 'ADMINSAT';
}

function is_izc_admin_login_id($raw) {
    $s = izc_admin_token($raw);
    if ($s === 'ADMINIZC' || $s === 'ADMIN' || $s === 'IZCADMIN') {
        return true;
    }
    return is_admin_nit($raw);
}

function zkteco_actor_ok($body) {
    if (!is_array($body)) {
        return false;
    }
    foreach (['zkteco_user', 'nit', 'admin_nit', 'asesor_codigo', 'nit_asesor'] as $k) {
        if (is_zkteco_login_id($body[$k] ?? '')) {
            return true;
        }
    }
    return false;
}

function sat_actor_ok($body) {
    if (!is_array($body)) {
        return false;
    }
    foreach (['sat_user', 'nit', 'admin_nit', 'asesor_codigo', 'nit_asesor'] as $k) {
        if (is_sat_login_id($body[$k] ?? '')) {
            return true;
        }
    }
    return false;
}


function normalize_gp_codigo($codigo) {
    $c = strtoupper(preg_replace('/[\s.]/', '', trim((string) $codigo)));
    if (preg_match('/^GP(\d{1,4})$/', $c, $m)) {
        return 'GP' . (string) ((int) $m[1]);
    }
    return '';
}

/** True si el "nombre" es solo el código GP (ej. GP00 / GP23). */
function gp_nombre_is_codigo($nombre, $codigo = '') {
    $n = strtoupper(preg_replace('/[\s.]/', '', trim((string) $nombre)));
    if ($n === '') {
        return true;
    }
    if (normalize_gp_codigo($n) !== '') {
        return true;
    }
    $code = normalize_gp_codigo($codigo);
    if ($code !== '' && $n === $code) {
        return true;
    }
    return false;
}

/**
 * Nombre legible del GP: registro > mapa Bitrix > etiqueta Bitrix > código.
 */
function resolve_gp_display_nombre($row) {
    global $bitrixGerentesFile, $gerentesProductoBitrixMapFile;
    if (!is_array($row)) {
        return '';
    }
    $code = normalize_gp_codigo($row['codigo'] ?? '');
    $nombre = trim((string) ($row['nombre'] ?? ''));
    if ($nombre !== '' && !gp_nombre_is_codigo($nombre, $code)) {
        return $nombre;
    }

    // Mapa enriquecido (gerentes_producto_bitrix_map.json)
    $mapFile = isset($gerentesProductoBitrixMapFile) ? $gerentesProductoBitrixMapFile : (
        dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'gerentes_producto_bitrix_map.json'
    );
    if (is_file($mapFile)) {
        $map = json_decode((string) @file_get_contents($mapFile), true);
        $list = is_array($map) ? ($map['gerentes'] ?? $map) : [];
        if (is_array($list)) {
            foreach ($list as $g) {
                if (!is_array($g)) {
                    continue;
                }
                if (normalize_gp_codigo($g['codigo'] ?? '') !== $code) {
                    continue;
                }
                foreach (['nombre', 'bitrix_nombre', 'nombre_completo'] as $k) {
                    $cand = trim((string) ($g[$k] ?? ''));
                    if ($cand === '' || gp_nombre_is_codigo($cand, $code)) {
                        continue;
                    }
                    // Quitar prefijo "IZC GP23 " si viene en bitrix_nombre
                    $cand = preg_replace('/^IZC\s+' . preg_quote($code, '/') . '\s+/i', '', $cand);
                    $cand = trim((string) $cand);
                    if ($cand !== '' && !gp_nombre_is_codigo($cand, $code)) {
                        return $cand;
                    }
                }
            }
        }
    }

    // bitrix_gerentes.json: { "191": "IZC GP1 Valentina Zambrano" }
    $bxFile = isset($bitrixGerentesFile) ? $bitrixGerentesFile : (
        dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'bitrix_gerentes.json'
    );
    $bitrixId = trim((string) ($row['bitrix_id'] ?? ''));
    if (is_file($bxFile)) {
        $bx = json_decode((string) @file_get_contents($bxFile), true);
        if (is_array($bx)) {
            $label = '';
            if ($bitrixId !== '' && isset($bx[$bitrixId])) {
                $label = trim((string) $bx[$bitrixId]);
            }
            if ($label === '' && $code !== '') {
                foreach ($bx as $lab) {
                    $blob = strtoupper(preg_replace('/[\s.]/', '', (string) $lab));
                    if ($blob !== '' && strpos($blob, $code) !== false) {
                        $label = trim((string) $lab);
                        break;
                    }
                }
            }
            if ($label !== '') {
                $clean = preg_replace('/^IZC\s+/i', '', $label);
                $clean = preg_replace('/^' . preg_quote($code, '/') . '\s+/i', '', trim((string) $clean));
                // Quitar email / cargos entre corchetes al final
                $clean = preg_replace('/\s+\S+@\S+/', '', $clean);
                $clean = preg_replace('/\s*\[[^\]]*\]\s*$/', '', $clean);
                $clean = trim((string) $clean);
                if ($clean !== '' && !gp_nombre_is_codigo($clean, $code)) {
                    return $clean;
                }
            }
        }
    }

    return $nombre !== '' ? $nombre : $code;
}

/** GP creado/actualizado desde registro-gp.html (no precarga Bitrix). */
function gp_is_self_registered($row) {
    if (!is_array($row)) {
        return false;
    }
    if (!empty($row['self_registered'])) {
        return true;
    }
    $src = strtolower(trim((string) ($row['source'] ?? '')));
    if ($src === 'registro' || $src === 'registro-gp' || $src === 'self') {
        return true;
    }
    // Migración: el seed masivo de Bitrix usó created_at fijo; el registro real no.
    $created = trim((string) ($row['created_at'] ?? ''));
    if ($created !== '' && strpos($created, '2026-09-29T15:29:11') === false) {
        return true;
    }
    return false;
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

function write_gerentes_producto($path, $rows) {
    $clean = [];
    foreach ((is_array($rows) ? $rows : []) as $r) {
        if (!is_array($r)) {
            continue;
        }
        $code = normalize_gp_codigo($r['codigo'] ?? '');
        if ($code === '') {
            continue;
        }
        $src = strtolower(trim((string) ($r['source'] ?? '')));
        if ($src === '') {
            $src = !empty($r['self_registered']) ? 'registro' : '';
        }
        $clean[] = [
            'codigo' => $code,
            'nombre' => trim((string) ($r['nombre'] ?? $code)) ?: $code,
            'password_hash' => (string) ($r['password_hash'] ?? ''),
            'bitrix_id' => trim((string) ($r['bitrix_id'] ?? '')),
            'email' => trim((string) ($r['email'] ?? '')),
            'created_at' => (string) ($r['created_at'] ?? date('c')),
            'password_default' => !empty($r['password_default']),
            'self_registered' => !empty($r['self_registered']) || $src === 'registro' || $src === 'registro-gp' || $src === 'self',
            'source' => $src !== '' ? $src : (!empty($r['self_registered']) ? 'registro' : ''),
        ];
    }
    usort($clean, function ($a, $b) {
        return ((int) substr($a['codigo'], 2)) <=> ((int) substr($b['codigo'], 2));
    });
    return izc_atomic_write_json($path, $clean);
}

function find_gerente_producto($rows, $codigo) {
    $want = normalize_gp_codigo($codigo);
    if ($want === '' || !is_array($rows)) {
        return [null, null];
    }
    foreach ($rows as $i => $r) {
        if (!is_array($r)) {
            continue;
        }
        if (normalize_gp_codigo($r['codigo'] ?? '') === $want) {
            return [$i, $r];
        }
    }
    return [null, null];
}

function gp_actor_ok($body) {
    if (!is_array($body)) {
        return false;
    }
    foreach (['gp_codigo', 'asesor_codigo', 'nit', 'admin_nit', 'nit_asesor', 'sat_user'] as $k) {
        if (is_gp_login_id($body[$k] ?? '')) {
            return true;
        }
    }
    return false;
}

function resolve_gp_actor($body) {
    $codigo = normalize_gp_codigo(
        $body['gp_codigo'] ?? ($body['asesor_codigo'] ?? ($body['nit'] ?? ($body['nit_asesor'] ?? '')))
    );
    if ($codigo === '') {
        return ['', null];
    }
    [, $gp] = find_gerente_producto(read_gerentes_producto(), $codigo);
    return [$codigo, $gp];
}

function get_gp_bitrix_ids($codigo) {
    global $bitrixGerentesFile;
    $code = normalize_gp_codigo($codigo);
    $ids = [];
    [, $gp] = find_gerente_producto(read_gerentes_producto(), $code);
    if (is_array($gp) && trim((string) ($gp['bitrix_id'] ?? '')) !== '') {
        $ids[] = (string) $gp['bitrix_id'];
    }
    if (is_file($bitrixGerentesFile)) {
        $map = json_decode((string) file_get_contents($bitrixGerentesFile), true);
        if (is_array($map)) {
            foreach ($map as $id => $label) {
                $blob = strtoupper(preg_replace('/[\s.]/', '', (string) $label));
                if ($blob !== '' && strpos($blob, $code) !== false) {
                    $ids[] = (string) $id;
                }
            }
        }
    }
    return array_values(array_unique(array_filter($ids, function ($x) { return $x !== ''; })));
}

function sync_gp_clientes_from_bitrix($codigo, $force = false) {
    global $bitrixFile, $BITRIX_COMPANY_NAME_PRIMARY, $BITRIX_COMPANY_NAME_FALLBACK;
    $code = normalize_gp_codigo($codigo);
    $empty = [
        'clientes' => [],
        'synced' => false,
        'from_cache' => false,
        'error' => '',
        'fetched_at' => '',
        'bitrix_count' => 0,
    ];
    if ($code === '') {
        $empty['error'] = 'Código GP vacío.';
        return $empty;
    }
    $cacheDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'gp_bitrix_clientes_cache';
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0755, true);
    }
    $cachePath = $cacheDir . DIRECTORY_SEPARATOR . $code . '.json';
    if (!$force && is_file($cachePath)) {
        $cached = json_decode((string) file_get_contents($cachePath), true);
        $fetchedAt = (string) ($cached['fetched_at'] ?? '');
        $ts = $fetchedAt !== '' ? strtotime($fetchedAt) : false;
        if (is_array($cached) && $ts && (time() - $ts) < 300) {
            return [
                'clientes' => is_array($cached['clientes'] ?? null) ? $cached['clientes'] : [],
                'synced' => true,
                'from_cache' => true,
                'error' => '',
                'fetched_at' => $fetchedAt,
                'bitrix_count' => (int) ($cached['count'] ?? count($cached['clientes'] ?? [])),
            ];
        }
    }

    $cfg = read_bitrix($bitrixFile);
    $ids = get_gp_bitrix_ids($code);
    $byNit = [];

    // Prefer live Bitrix; fallback to local companies export.
    if (!empty($cfg['enabled']) && !empty($cfg['webhook_base']) && $ids) {
        foreach ($ids as $assignedId) {
            $start = 0;
            do {
                $payload = [
                    'filter' => ['ASSIGNED_BY_ID' => (int) $assignedId],
                    'select' => [
                        'ID', 'TITLE', 'ASSIGNED_BY_ID', 'PHONE',
                        $BITRIX_COMPANY_NAME_PRIMARY, $BITRIX_COMPANY_NAME_FALLBACK,
                    ],
                    'order' => ['ID' => 'ASC'],
                    'start' => $start,
                ];
                $resp = bitrix_rest($cfg['webhook_base'], 'crm.company.list.json', $payload);
                if (!is_array($resp) || empty($resp['result']) || !is_array($resp['result'])) {
                    if (!empty($resp['error'])) {
                        $empty['error'] = 'Bitrix: ' . (string) ($resp['error_description'] ?? $resp['error']);
                    }
                    break;
                }
                foreach ($resp['result'] as $co) {
                    if (!is_array($co)) continue;
                    $nit = function_exists('bitrix_clean_company_nit')
                        ? bitrix_clean_company_nit($co['TITLE'] ?? '')
                        : preg_replace('/\D+/', '', (string) ($co['TITLE'] ?? ''));
                    $nombre = function_exists('bitrix_company_display_name')
                        ? bitrix_company_display_name($co, $nit)
                        : trim((string) ($co['TITLE'] ?? ''));
                    $phone = '';
                    if (!empty($co['PHONE']) && is_array($co['PHONE'])) {
                        $phone = trim((string) ($co['PHONE'][0]['VALUE'] ?? ''));
                    }
                    $key = $nit !== '' ? $nit : ('ID:' . (string) ($co['ID'] ?? ''));
                    $byNit[$key] = [
                        'nit' => $nit,
                        'nombre' => $nombre !== '' ? $nombre : ($nit !== '' ? $nit : 'Sin nombre'),
                        'telefono' => $phone,
                        'bitrix_company_id' => (string) ($co['ID'] ?? ''),
                    ];
                }
                $start = isset($resp['next']) ? (int) $resp['next'] : -1;
            } while ($start >= 0);
        }
    }

    if (!$byNit && $ids) {
        $exportFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'bitrix_companias.json';
        if (is_file($exportFile)) {
            $export = json_decode((string) file_get_contents($exportFile), true);
            $want = [];
            foreach ($ids as $id) { $want[(string) $id] = true; }
            foreach ((is_array($export['companies'] ?? null) ? $export['companies'] : []) as $co) {
                if (!is_array($co)) continue;
                $aid = (string) ($co['ASSIGNED_BY_ID'] ?? '');
                if ($aid === '' || empty($want[$aid])) continue;
                $nit = function_exists('bitrix_clean_company_nit')
                    ? bitrix_clean_company_nit($co['TITLE'] ?? '')
                    : preg_replace('/\D+/', '', (string) ($co['TITLE'] ?? ''));
                $nombre = trim((string) ($co['UF_CRM_1746192546'] ?? ($co['UF_CRM_1746192481'] ?? ($co['TITLE'] ?? ''))));
                $phone = '';
                if (!empty($co['PHONE']) && is_array($co['PHONE'])) {
                    $phone = trim((string) ($co['PHONE'][0]['VALUE'] ?? ''));
                }
                $key = $nit !== '' ? $nit : ('ID:' . (string) ($co['ID'] ?? ''));
                $byNit[$key] = [
                    'nit' => $nit,
                    'nombre' => $nombre !== '' ? $nombre : ($nit !== '' ? $nit : 'Sin nombre'),
                    'telefono' => $phone,
                    'bitrix_company_id' => (string) ($co['ID'] ?? ''),
                ];
            }
            if ($byNit && $empty['error'] !== '') {
                $empty['error'] = '';
            }
        }
    }

    $clientes = array_values($byNit);
    usort($clientes, function ($a, $b) {
        return strcasecmp((string) ($a['nombre'] ?? ''), (string) ($b['nombre'] ?? ''));
    });
    $fetchedAt = date('c');
    @file_put_contents($cachePath, json_encode([
        'codigo' => $code,
        'fetched_at' => $fetchedAt,
        'count' => count($clientes),
        'clientes' => $clientes,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

    return [
        'clientes' => $clientes,
        'synced' => true,
        'from_cache' => false,
        'error' => $empty['error'],
        'fetched_at' => $fetchedAt,
        'bitrix_count' => count($clientes),
    ];
}

function read_gp_clientes_manual($path = null) {
    global $gpClientesManualFile;
    $file = $path ?: $gpClientesManualFile;
    $tryFiles = [$file, function_exists('izc_last_good_path') ? izc_last_good_path($file) : ''];
    $data = null;
    foreach ($tryFiles as $f) {
        if ($f === '' || !is_file($f)) {
            continue;
        }
        $decoded = json_decode((string) file_get_contents($f), true);
        if (is_array($decoded)) {
            $data = $decoded;
            break;
        }
    }
    if (!is_array($data)) {
        return ['by_codigo' => []];
    }
    if (!isset($data['by_codigo']) || !is_array($data['by_codigo'])) {
        $data['by_codigo'] = [];
    }
    $normalized = [];
    foreach ($data['by_codigo'] as $codeRaw => $rows) {
        $code = normalize_gp_codigo($codeRaw);
        if ($code === '') {
            continue;
        }
        $list = asesor_clientes_manual_rows($rows);
        if (!isset($normalized[$code])) {
            $normalized[$code] = [];
        }
        foreach ($list as $row) {
            if (is_array($row)) {
                $normalized[$code][] = $row;
            }
        }
    }
    $data['by_codigo'] = $normalized;
    return $data;
}

function write_gp_clientes_manual($data, $path = null) {
    global $gpClientesManualFile;
    $file = $path ?: $gpClientesManualFile;
    $dir = dirname($file);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    if (!is_array($data)) {
        $data = ['by_codigo' => []];
    }
    if (!isset($data['by_codigo']) || !is_array($data['by_codigo'])) {
        $data['by_codigo'] = [];
    }
    $safe = ['by_codigo' => []];
    foreach ($data['by_codigo'] as $codeRaw => $rows) {
        $code = normalize_gp_codigo($codeRaw);
        if ($code === '') {
            continue;
        }
        $list = [];
        $seen = [];
        foreach (asesor_clientes_manual_rows($rows) as $c) {
            if (!is_array($c)) {
                continue;
            }
            $nit = normalize_nit($c['nit'] ?? '');
            if ($nit === '' || isset($seen[$nit])) {
                continue;
            }
            $seen[$nit] = true;
            $list[] = [
                'nit' => $nit,
                'nombre' => trim((string) ($c['nombre'] ?? '')),
                'telefono' => normalize_telefono_display($c['telefono'] ?? ''),
                'created_at' => (string) ($c['created_at'] ?? ''),
                'created_by' => (string) ($c['created_by'] ?? ''),
                'updated_at' => (string) ($c['updated_at'] ?? ''),
                'updated_by' => (string) ($c['updated_by'] ?? ''),
            ];
        }
        $safe['by_codigo'][$code] = array_values($list);
    }
    if (!izc_atomic_write_json($file, $safe)) {
        @chmod($dir, 0777);
        if (is_file($file)) {
            @chmod($file, 0666);
        }
        if (!izc_atomic_write_json($file, $safe)) {
            return false;
        }
    }
    if (function_exists('izc_copy_last_good')) {
        $n = 0;
        foreach ($safe['by_codigo'] as $rows) {
            $n += count($rows);
        }
        izc_copy_last_good($file, $n, 5);
    }
    return true;
}

function get_gp_clientes_manual($codigo) {
    $code = normalize_gp_codigo($codigo);
    if ($code === '') {
        return [];
    }
    $data = read_gp_clientes_manual();
    $list = $data['by_codigo'][$code] ?? [];
    if (!is_array($list)) {
        return [];
    }
    $out = [];
    $seen = [];
    foreach (asesor_clientes_manual_rows($list) as $c) {
        if (!is_array($c)) {
            continue;
        }
        $nit = normalize_nit($c['nit'] ?? '');
        if ($nit === '' || isset($seen[$nit])) {
            continue;
        }
        $seen[$nit] = true;
        $nombre = trim((string) ($c['nombre'] ?? ''));
        if ($nombre === '') {
            $nombre = $nit;
        }
        $out[] = [
            'nit' => $nit,
            'nombre' => $nombre,
            'telefono' => normalize_telefono_display($c['telefono'] ?? ''),
            'manual' => true,
        ];
    }
    return $out;
}

/** Une clientes Bitrix + manuales del GP (cada GP solo ve los suyos). */
function merge_gp_clientes_list($codigo, $bitrixClientes) {
    $byNit = [];
    foreach ((is_array($bitrixClientes) ? $bitrixClientes : []) as $c) {
        if (!is_array($c)) {
            continue;
        }
        $nit = normalize_nit($c['nit'] ?? '');
        if ($nit === '') {
            continue;
        }
        $byNit[$nit] = [
            'nit' => $nit,
            'nombre' => trim((string) ($c['nombre'] ?? '')),
            'telefono' => normalize_telefono_display($c['telefono'] ?? ''),
            'bitrix_company_id' => (string) ($c['bitrix_company_id'] ?? ''),
            'manual' => false,
        ];
        if ($byNit[$nit]['nombre'] === '') {
            $byNit[$nit]['nombre'] = $nit;
        }
    }
    foreach (get_gp_clientes_manual($codigo) as $c) {
        $nit = normalize_nit($c['nit'] ?? '');
        if ($nit === '') {
            continue;
        }
        if (isset($byNit[$nit])) {
            if ($byNit[$nit]['nombre'] === '' || $byNit[$nit]['nombre'] === $nit) {
                $nombre = trim((string) ($c['nombre'] ?? ''));
                if ($nombre !== '') {
                    $byNit[$nit]['nombre'] = $nombre;
                }
            }
            if ($byNit[$nit]['telefono'] === '') {
                $byNit[$nit]['telefono'] = normalize_telefono_display($c['telefono'] ?? '');
            }
            continue;
        }
        $byNit[$nit] = [
            'nit' => $nit,
            'nombre' => trim((string) ($c['nombre'] ?? '')) ?: $nit,
            'telefono' => normalize_telefono_display($c['telefono'] ?? ''),
            'manual' => true,
        ];
    }
    $out = array_values($byNit);
    usort($out, function ($a, $b) {
        return strcasecmp((string) ($a['nombre'] ?? ''), (string) ($b['nombre'] ?? ''));
    });
    return $out;
}

function gp_client_nit_set($codigo) {
    $data = sync_gp_clientes_from_bitrix($codigo, false);
    $merged = merge_gp_clientes_list($codigo, is_array($data['clientes'] ?? null) ? $data['clientes'] : []);
    $set = [];
    foreach ($merged as $c) {
        $nit = normalize_nit($c['nit'] ?? '');
        if ($nit !== '') {
            $set[$nit] = true;
            $set[ltrim($nit, '0')] = true;
        }
    }
    return $set;
}

function gp_is_fibra_panel($codigo) {
    $code = normalize_gp_codigo($codigo);
    return $code === 'GP23' || $code === 'GP0';
}

function quote_is_made_by_gp($quote, $codigo = '') {
    if (!is_array($quote)) {
        return false;
    }
    $src = strtolower(trim((string) ($quote['quote_source'] ?? '')));
    $seller = normalize_gp_codigo($quote['seller_codigo'] ?? '');
    $by = normalize_gp_codigo($quote['asesor_cotizado_by'] ?? ($quote['finished_by'] ?? ''));
    $want = normalize_gp_codigo($codigo);
    if ($want !== '') {
        if ($seller === $want || $by === $want) {
            return true;
        }
        return false;
    }
    if ($src === 'gp') {
        return true;
    }
    return $seller !== '' || $by !== '';
}

function izc_fibra_sku_set() {
    static $set = null;
    if (is_array($set)) {
        return $set;
    }
    $set = [];
    $defaults = ['7654', '7655', '7656', '7657', '7660', '7661', '9939', '9941', '13425', '13516', '13517', '13518', '13519', '13520', '13521', '13522', '14181', '15276', '15732'];
    foreach ($defaults as $sku) {
        $set[$sku] = true;
    }
    $path = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'files' . DIRECTORY_SEPARATOR . 'estelar_flete.json';
    if (is_file($path)) {
        $data = json_decode((string) @file_get_contents($path), true);
        if (is_array($data)) {
            foreach (['except_skus', 'sat_precio_skus'] as $k) {
                foreach (is_array($data[$k] ?? null) ? $data[$k] : [] as $sku) {
                    $id = preg_replace('/\D+/', '', (string) $sku);
                    if ($id !== '') {
                        $set[$id] = true;
                    }
                }
            }
            $productos = is_array($data['productos'] ?? null) ? $data['productos'] : [];
            foreach ($productos as $sku => $_row) {
                $id = preg_replace('/\D+/', '', (string) $sku);
                if ($id !== '') {
                    $set[$id] = true;
                }
            }
        }
    }
    return $set;
}

function quote_item_is_fibra($item) {
    if (!is_array($item)) {
        return false;
    }
    $skuRaw = strtoupper(trim((string) ($item['sku'] ?? ($item['codigo'] ?? ($item['id'] ?? '')))));
    $skuDigits = preg_replace('/\D+/', '', $skuRaw);
    $skus = izc_fibra_sku_set();
    if ($skuDigits !== '' && !empty($skus[$skuDigits])) {
        return true;
    }
    $text = strtoupper(trim(implode(' ', [
        (string) ($item['name'] ?? ''),
        (string) ($item['nombre'] ?? ''),
        (string) ($item['referencia'] ?? ''),
        (string) ($item['descripcion'] ?? ''),
        $skuRaw,
    ])));
    if ($text === '') {
        return false;
    }
    if (preg_match('/PUNTA DE FIBRA|L[AÁ]PICES?\s+[OÓ]PTICOS|IDEAL PARA FIBRA|SFP\+?\s+PARA FIBRA/u', $text)) {
        return false;
    }
    if (preg_match('/\bSAT\s+FIBRA\b|\bFIBRA\s+(ASU|ADSS|DROP)\b|FIBRA\s+[OÓ]PTICA/u', $text)) {
        return true;
    }
    return false;
}

function quote_has_fibra_product($quote) {
    if (!is_array($quote)) {
        return false;
    }
    foreach (is_array($quote['items'] ?? null) ? $quote['items'] : [] as $it) {
        if (quote_item_is_fibra($it)) {
            return true;
        }
    }
    return false;
}

function quote_is_made_by_asesor_vendedor($quote) {
    if (!is_array($quote)) {
        return false;
    }
    if (function_exists('quote_is_made_by_gp') && quote_is_made_by_gp($quote, '')) {
        return false;
    }
    if (function_exists('quote_is_made_by_sat') && quote_is_made_by_sat($quote)) {
        return false;
    }
    if (function_exists('quote_is_made_by_zkteco') && quote_is_made_by_zkteco($quote)) {
        return false;
    }
    $src = strtolower(trim((string) ($quote['quote_source'] ?? '')));
    if ($src === 'asesor') {
        return true;
    }
    if (in_array($src, ['gp', 'sat', 'zkteco', 'cliente', 'portal', 'zebra'], true)) {
        return false;
    }
    $seller = function_exists('normalize_asesor_codigo')
        ? normalize_asesor_codigo($quote['seller_codigo'] ?? '')
        : strtoupper(trim((string) ($quote['seller_codigo'] ?? '')));
    return (bool) preg_match('/^V\d{1,4}$/', $seller);
}

function get_quotes_for_gp($codigo, $scope = 'historial', $opts = []) {
    global $quotesFile;
    $code = normalize_gp_codigo($codigo);
    $listOnly = !empty($opts['list_only']);
    $allowFibra = !empty($opts['allow_fibra']) && gp_is_fibra_panel($code);
    $scope = strtolower(trim((string) $scope));
    if ($scope === 'quotes-client' || $scope === 'client') {
        $scope = 'clientes';
    }
    if ($scope === 'asesores-fibra' || $scope === 'quotes-fibra') {
        $scope = 'fibra';
    }
    if ($scope !== 'clientes' && $scope !== 'fibra') {
        $scope = 'historial';
    }
    $quotes = read_quotes($quotesFile);
    usort($quotes, function ($a, $b) {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    $nitSet = gp_client_nit_set($code);
    $bucketHis = [];
    $bucketCli = [];
    $bucketFib = [];
    foreach ($quotes as $q) {
        if (!is_array($q)) {
            continue;
        }
        if (!empty($q['asesor_eliminada'])) {
            continue;
        }
        if (function_exists('quote_is_orphan_bitrix_deal') && quote_is_orphan_bitrix_deal($q)) {
            continue;
        }

        $priced = !function_exists('quote_has_priced_deal') || quote_has_priced_deal($q);
        $isHis = $priced && quote_is_made_by_gp($q, $code);
        $isCli = false;
        $isFib = $allowFibra && quote_is_made_by_asesor_vendedor($q) && quote_has_fibra_product($q);
        if ($isFib) {
            $fibraDesde = function_exists('quote_admin_historial_since') ? quote_admin_historial_since() : '2026-08-21';
            $fibraDia = function_exists('quote_created_date_key') ? quote_created_date_key($q) : substr((string) ($q['created_at'] ?? ''), 0, 10);
            if ($fibraDia === '' || strcmp($fibraDia, $fibraDesde) < 0) {
                $isFib = false;
            }
        }
        if ($priced && function_exists('quote_is_made_by_cliente') && quote_is_made_by_cliente($q)) {
            $nit = normalize_nit($q['nit'] ?? '');
            $src = strtolower(trim((string) ($q['quote_source'] ?? '')));
            if ($nit !== '' && (isset($nitSet[$nit]) || isset($nitSet[ltrim($nit, '0')]))
                && $src !== 'asesor' && $src !== 'gp' && $src !== 'zkteco' && $src !== 'sat') {
                $isCli = true;
            }
        }
        if (!$isHis && !$isCli && !$isFib) {
            continue;
        }

        $estado = function_exists('quote_asesor_estado') ? quote_asesor_estado($q) : (string) ($q['asesor_estado'] ?? '');
        $row = $listOnly
            ? quote_to_asesor_list_row($q, $estado)
            : quote_to_asesor_safe_row($q, $estado);
        if ($isHis) {
            $bucketHis[] = $row;
        }
        if ($isCli) {
            $bucketCli[] = $row;
        }
        if ($isFib) {
            $bucketFib[] = $row;
        }
    }
    $safe = $bucketHis;
    if ($scope === 'clientes') {
        $safe = $bucketCli;
    } elseif ($scope === 'fibra') {
        $safe = $allowFibra ? $bucketFib : [];
    }
    return [
        'quotes' => $safe,
        'count' => count($safe),
        'scope' => $scope,
        'codigo' => $code,
        'historial_count' => count($bucketHis),
        'client_quotes_count' => count($bucketCli),
        'fibra_count' => $allowFibra ? count($bucketFib) : 0,
        'show_fibra' => $allowFibra,
    ];
}


/** Asesor real o sesión ZKTeco en el cotizador-asesor. */
function resolve_asesor_or_zkteco($body) {
    global $asesoresFile;
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit_asesor'] ?? ($body['nit'] ?? '')));
    $codigo = asesor_canonical_codigo($codigo) ?: $codigo;
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    $isZkteco = is_zkteco_login_id($codigo) || zkteco_actor_ok($body);
    if ($isZkteco && !$asesor) {
        $codigo = 'ZKTECO';
        $asesor = [
            'codigo' => 'ZKTECO',
            'nit' => 'ZKTECO',
            'nombre' => 'ZKTeco',
        ];
    }
    return [$codigo, $asesor, $isZkteco];
}

if ($action === 'login') {
    $rawLogin = (string) ($body['nit'] ?? '');
    $password = trim((string) ($body['password'] ?? ''));
    $asesorCode = normalize_asesor_codigo($rawLogin);
    $nit = normalize_nit($rawLogin);

    if (is_zkteco_login_id($rawLogin) || is_zkteco_login_id($nit) || is_zkteco_login_id($asesorCode)) {
        $users = read_users($usersFile);
        [$idx, $user] = find_user($users, 'ZKTECO');
        if (!$user) {
            foreach ($users as $i => $u) {
                if (is_array($u) && is_zkteco_login_id($u['nit'] ?? '')) {
                    $idx = $i;
                    $user = $u;
                    break;
                }
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

    if (is_sat_login_id($rawLogin) || is_sat_login_id($nit) || is_sat_login_id($asesorCode)) {
        $users = read_users($usersFile);
        [$idx, $user] = find_user($users, 'SAT');
        if (!$user) {
            foreach ($users as $i => $u) {
                if (is_array($u) && is_sat_login_id($u['nit'] ?? '')) {
                    $idx = $i;
                    $user = $u;
                    break;
                }
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

    if (($asesorCode === '' && $nit === '') || $password === '') {
        json_out(['ok' => false, 'error' => 'Ingresa usuario y contraseña.'], 400);
    }


    if (is_gp_login_id($rawLogin) || is_gp_login_id($nit) || is_gp_login_id($asesorCode)) {
        $gpCode = normalize_gp_codigo($asesorCode !== '' ? $asesorCode : ($rawLogin !== '' ? $rawLogin : $nit));
        [, $gp] = find_gerente_producto(read_gerentes_producto(), $gpCode);
        if (!$gp || !gp_is_self_registered($gp)) {
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
        global $asesoresFile;
        // V28 (solo alias) inicia sesión como el usuario primario (p.ej. V6).
        $asesorCode = asesor_canonical_codigo($asesorCode) ?: $asesorCode;
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
            'codigos_extra' => asesor_row_codigos_extra($asesor),
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

    $role = is_admin_nit($nit) ? 'admin' : (is_zkteco_login_id($nit) ? 'zkteco' : 'cliente');
    json_out([
        'ok' => true,
        'nit' => $user['nit'],
        'nombre' => (string) ($user['nombre'] ?? ''),
        'role' => $role,
        'message' => 'Sesión iniciada.',
    ]);
}


if ($action === 'register_asesor') {
    global $asesoresFile, $adminNits;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $codigo = normalize_asesor_codigo($body['codigo'] ?? ($body['nit'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    $nombre = trim((string) ($body['nombre'] ?? ''));
    if ($codigo === '') {
        json_out(['ok' => false, 'error' => 'Código de vendedor inválido. Usa V1, V2, V31, ADV, etc.'], 400);
    }
    if (strlen($password) < 4) {
        json_out(['ok' => false, 'error' => 'La contraseña debe tener al menos 4 caracteres.'], 400);
    }
    if ($nombre === '') {
        $nombre = $codigo;
    }
    $asesores = read_asesores($asesoresFile);
    [, $existing] = find_asesor($asesores, $codigo);
    if ($existing) {
        json_out(['ok' => false, 'error' => 'El asesor ' . $codigo . ' ya está registrado.'], 409);
    }
    $extras = parse_asesor_codigos_list($body['codigos_extra'] ?? ($body['extras'] ?? ''));
    $extras = array_values(array_filter($extras, static function ($c) use ($codigo) {
        return $c !== $codigo;
    }));
    // Evitar que un extra sea otro asesor con login propio.
    foreach ($extras as $ex) {
        [, $taken] = find_asesor($asesores, $ex);
        if ($taken) {
            json_out([
                'ok' => false,
                'error' => 'El código ' . $ex . ' ya tiene usuario propio. Elimínalo o quítalo de códigos extra.',
            ], 409);
        }
    }
    $row = [
        'codigo' => $codigo,
        'nombre' => $nombre,
        'password_hash' => hash_password($password),
        'created_at' => date('c'),
    ];
    if ($extras) {
        $row['codigos_extra'] = $extras;
    }
    $asesores[] = $row;
    if (!write_asesores($asesoresFile, $asesores)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el asesor.'], 500);
    }
    json_out([
        'ok' => true,
        'codigo' => $codigo,
        'nombre' => $nombre,
        'codigos_extra' => $extras,
        'message' => 'Asesor ' . $codigo . ' registrado.' . ($extras ? (' (también ' . implode(', ', $extras) . ')') : ''),
    ]);
}


if ($action === 'update_asesor') {
    global $asesoresFile;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $codigo = normalize_asesor_codigo($body['codigo'] ?? ($body['nit'] ?? ''));
    if ($codigo === '') {
        json_out(['ok' => false, 'error' => 'Código de vendedor inválido.'], 400);
    }
    $asesores = read_asesores($asesoresFile);
    [$idx, $existing] = find_asesor($asesores, $codigo);
    if ($idx === null || !$existing) {
        json_out(['ok' => false, 'error' => 'Asesor no encontrado.'], 404);
    }
    if (array_key_exists('nombre', $body)) {
        $nombre = trim((string) $body['nombre']);
        if ($nombre !== '') {
            $asesores[$idx]['nombre'] = $nombre;
        }
    }
    if (array_key_exists('password', $body) && trim((string) $body['password']) !== '') {
        $password = (string) $body['password'];
        if (strlen($password) < 4) {
            json_out(['ok' => false, 'error' => 'La contraseña debe tener al menos 4 caracteres.'], 400);
        }
        $asesores[$idx]['password_hash'] = hash_password($password);
    }
    if (array_key_exists('codigos_extra', $body) || array_key_exists('extras', $body)) {
        $extras = parse_asesor_codigos_list($body['codigos_extra'] ?? ($body['extras'] ?? ''));
        $extras = array_values(array_filter($extras, static function ($c) use ($codigo) {
            return $c !== $codigo;
        }));
        foreach ($extras as $ex) {
            [, $taken] = find_asesor($asesores, $ex);
            if ($taken) {
                json_out([
                    'ok' => false,
                    'error' => 'El código ' . $ex . ' ya tiene usuario propio. Elimínalo antes de unirlo.',
                ], 409);
            }
        }
        if ($extras) {
            $asesores[$idx]['codigos_extra'] = $extras;
        } else {
            unset($asesores[$idx]['codigos_extra'], $asesores[$idx]['alias_codigos']);
        }
    }
    $asesores[$idx]['updated_at'] = date('c');
    if (!write_asesores($asesoresFile, $asesores)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el asesor.'], 500);
    }
    json_out([
        'ok' => true,
        'codigo' => $codigo,
        'nombre' => trim((string) ($asesores[$idx]['nombre'] ?? $codigo)),
        'codigos_extra' => asesor_row_codigos_extra($asesores[$idx]),
        'message' => 'Asesor ' . $codigo . ' actualizado.',
    ]);
}


if ($action === 'save_bitrix_vendedores' || $action === 'update_bitrix_vendedores') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $mapFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'bitrix_vendedores.json';
    $current = [];
    if (is_file($mapFile)) {
        $decoded = json_decode((string) file_get_contents($mapFile), true);
        if (is_array($decoded)) {
            $current = $decoded;
        }
    }
    $incoming = $body['vendedores'] ?? ($body['map'] ?? ($body['bitrix_vendedores'] ?? null));
    if (!is_array($incoming)) {
        json_out(['ok' => false, 'error' => 'Falta el mapa vendedores (objeto id → nombre).'], 400);
    }
    $replace = !empty($body['replace']);
    $map = $replace ? [] : $current;
    $added = 0;
    foreach ($incoming as $id => $name) {
        $id = trim((string) $id);
        $name = trim((string) $name);
        if ($id === '' || !ctype_digit($id) || $name === '') {
            continue;
        }
        if (!isset($map[$id])) {
            $added++;
        }
        $map[$id] = $name;
    }
    ksort($map, SORT_NUMERIC);
    if (!izc_atomic_write_json($mapFile, $map)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar bitrix_vendedores.json.'], 500);
    }
    json_out([
        'ok' => true,
        'count' => count($map),
        'added_or_updated' => $added,
        'message' => 'Mapa Bitrix vendedores guardado (' . count($map) . ').',
    ]);
}

if ($action === 'update_zkteco_nombre' || $action === 'set_zkteco_nombre') {
    if (!zkteco_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $nombre = trim((string) ($body['nombre'] ?? ($body['name'] ?? '')));
    if ($nombre === '' || mb_strlen($nombre) < 2) {
        json_out(['ok' => false, 'error' => 'Ingresa un nombre válido (mínimo 2 caracteres).'], 400);
    }
    if (mb_strlen($nombre) > 80) {
        json_out(['ok' => false, 'error' => 'El nombre es demasiado largo (máx. 80).'], 400);
    }
    $users = read_users($usersFile);
    $found = false;
    foreach ($users as $i => $u) {
        if (!is_array($u)) {
            continue;
        }
        if (!is_zkteco_login_id($u['nit'] ?? '')) {
            continue;
        }
        $users[$i]['nombre'] = $nombre;
        $users[$i]['nombre_updated_at'] = date('c');
        if (trim((string) ($users[$i]['role'] ?? '')) === '') {
            $users[$i]['role'] = 'zkteco';
        }
        $found = true;
        break;
    }
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Usuario ZKTeco no encontrado.'], 404);
    }
    if (!write_users($usersFile, $users)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el nombre.'], 500);
    }
    json_out([
        'ok' => true,
        'nit' => 'ZKTECO',
        'nombre' => $nombre,
        'message' => 'Nombre actualizado.',
    ]);
}

if ($action === 'update_cliente_nombre' || $action === 'update_user_nombre' || $action === 'set_cliente_nombre') {
    $nit = normalize_nit($body['nit'] ?? '');
    $nombre = trim((string) ($body['nombre'] ?? ($body['name'] ?? '')));
    if ($nit === '' || !preg_match('/^\d{6,15}(-\d)?$/', $nit)) {
        json_out(['ok' => false, 'error' => 'NIT inválido.'], 400);
    }
    if (is_admin_nit($nit) || is_zkteco_login_id($nit) || is_sat_login_id($nit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if ($nombre === '' || mb_strlen($nombre) < 2) {
        json_out(['ok' => false, 'error' => 'Ingresa un nombre válido (mínimo 2 caracteres).'], 400);
    }
    if (mb_strlen($nombre) > 80) {
        json_out(['ok' => false, 'error' => 'El nombre es demasiado largo (máx. 80).'], 400);
    }
    $users = read_users($usersFile);
    [$idx, $user] = find_user($users, $nit);
    if (!$user) {
        json_out(['ok' => false, 'error' => 'Usuario no encontrado.'], 404);
    }
    $role = strtolower(trim((string) ($user['role'] ?? '')));
    if ($role === 'admin' || $role === 'zkteco' || $role === 'zebra' || $role === 'asesor' || $role === 'sat' || $role === 'gp') {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $users[$idx]['nombre'] = $nombre;
    $users[$idx]['nombre_updated_at'] = date('c');
    if (!write_users($usersFile, $users)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el nombre.'], 500);
    }
    json_out([
        'ok' => true,
        'nit' => $nit,
        'nombre' => $nombre,
        'message' => 'Nombre actualizado.',
    ]);
}

if ($action === 'update_admin_nombre' || $action === 'set_admin_nombre') {
    $nit = normalize_nit($body['admin_nit'] ?? ($body['nit'] ?? ''));
    $nombre = trim((string) ($body['nombre'] ?? ($body['name'] ?? '')));
    if ($nit === '' || !is_admin_nit($nit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if ($nombre === '' || mb_strlen($nombre) < 2) {
        json_out(['ok' => false, 'error' => 'Ingresa un nombre válido (mínimo 2 caracteres).'], 400);
    }
    if (mb_strlen($nombre) > 80) {
        json_out(['ok' => false, 'error' => 'El nombre es demasiado largo (máx. 80).'], 400);
    }
    $users = read_users($usersFile);
    [$idx, $user] = find_user($users, $nit);
    if (!$user) {
        json_out(['ok' => false, 'error' => 'Usuario administrador no encontrado.'], 404);
    }
    $users[$idx]['nombre'] = $nombre;
    $users[$idx]['nombre_updated_at'] = date('c');
    $users[$idx]['role'] = 'admin';
    if (!write_users($usersFile, $users)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el nombre.'], 500);
    }
    json_out([
        'ok' => true,
        'nit' => $nit,
        'nombre' => $nombre,
        'message' => 'Nombre actualizado.',
    ]);
}

if ($action === 'update_asesor_nombre' || $action === 'set_asesor_nombre') {
    global $asesoresFile;
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['codigo'] ?? ($body['nit'] ?? '')));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $nombre = trim((string) ($body['nombre'] ?? ($body['name'] ?? '')));
    if ($nombre === '' || mb_strlen($nombre) < 2) {
        json_out(['ok' => false, 'error' => 'Ingresa un nombre válido (mínimo 2 caracteres).'], 400);
    }
    if (mb_strlen($nombre) > 80) {
        json_out(['ok' => false, 'error' => 'El nombre es demasiado largo (máx. 80).'], 400);
    }
    $asesores = read_asesores($asesoresFile);
    $found = false;
    foreach ($asesores as &$row) {
        if (!is_array($row)) {
            continue;
        }
        if (normalize_asesor_codigo($row['codigo'] ?? ($row['nit'] ?? '')) !== $codigo) {
            continue;
        }
        $row['nombre'] = $nombre;
        $row['nombre_updated_at'] = date('c');
        $found = true;
        break;
    }
    unset($row);
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Asesor no encontrado.'], 404);
    }
    if (!write_asesores($asesoresFile, $asesores)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el nombre.'], 500);
    }
    json_out([
        'ok' => true,
        'codigo' => $codigo,
        'nombre' => $nombre,
        'message' => 'Nombre actualizado.',
    ]);
}

if ($action === 'update_gp_nombre' || $action === 'set_gp_nombre') {
    global $gerentesProductoFile;
    $codigo = normalize_gp_codigo(
        $body['gp_codigo'] ?? ($body['codigo'] ?? ($body['gp'] ?? ($body['nit'] ?? ($body['asesor_codigo'] ?? ''))))
    );
    if ($codigo === '') {
        json_out(['ok' => false, 'error' => 'Código GP inválido.'], 400);
    }
    // Solo el propio GP (o admin/SAT) puede cambiar el nombre.
    $actorOk = gp_actor_ok($body) || sat_actor_ok($body) || is_admin_nit($body['admin_nit'] ?? ($body['nit'] ?? ''));
    if (!$actorOk) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if (gp_actor_ok($body) && !sat_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        [$actorCode] = resolve_gp_actor($body);
        if ($actorCode !== '' && $actorCode !== $codigo) {
            json_out(['ok' => false, 'error' => 'Solo puedes editar tu propio nombre.'], 403);
        }
    }
    $nombre = trim((string) ($body['nombre'] ?? ($body['name'] ?? '')));
    if ($nombre === '' || mb_strlen($nombre) < 2) {
        json_out(['ok' => false, 'error' => 'Ingresa un nombre válido (mínimo 2 caracteres).'], 400);
    }
    if (mb_strlen($nombre) > 80) {
        json_out(['ok' => false, 'error' => 'El nombre es demasiado largo (máx. 80).'], 400);
    }
    if (gp_nombre_is_codigo($nombre, $codigo)) {
        json_out(['ok' => false, 'error' => 'Escribe tu nombre completo, no el código GP.'], 400);
    }
    $rows = read_gerentes_producto($gerentesProductoFile);
    [$idx, $existing] = find_gerente_producto($rows, $codigo);
    if ($idx === null || !$existing || !gp_is_self_registered($existing)) {
        json_out(['ok' => false, 'error' => 'GP no registrado.'], 404);
    }
    $rows[$idx]['nombre'] = $nombre;
    $rows[$idx]['nombre_updated_at'] = date('c');
    $rows[$idx]['self_registered'] = true;
    $rows[$idx]['source'] = 'registro';
    if (!write_gerentes_producto($gerentesProductoFile, $rows)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el nombre.'], 500);
    }
    json_out([
        'ok' => true,
        'codigo' => $codigo,
        'nit' => $codigo,
        'nombre' => $nombre,
        'message' => 'Nombre actualizado.',
    ]);
}

if ($action === 'update_sat_nombre' || $action === 'set_sat_nombre') {
    if (!sat_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? ($body['nit'] ?? ''))) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $nombre = trim((string) ($body['nombre'] ?? ($body['name'] ?? '')));
    if ($nombre === '' || mb_strlen($nombre) < 2) {
        json_out(['ok' => false, 'error' => 'Ingresa un nombre válido (mínimo 2 caracteres).'], 400);
    }
    if (mb_strlen($nombre) > 80) {
        json_out(['ok' => false, 'error' => 'El nombre es demasiado largo (máx. 80).'], 400);
    }
    $users = read_users($usersFile);
    [$idx, $user] = find_user($users, 'SAT');
    if (!$user) {
        foreach ($users as $i => $u) {
            if (is_array($u) && is_sat_login_id($u['nit'] ?? '')) {
                $idx = $i;
                $user = $u;
                break;
            }
        }
    }
    if (!$user) {
        json_out(['ok' => false, 'error' => 'Usuario SAT no encontrado.'], 404);
    }
    $users[$idx]['nombre'] = $nombre;
    $users[$idx]['nombre_updated_at'] = date('c');
    $users[$idx]['role'] = 'sat';
    if (!write_users($usersFile, $users)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el nombre.'], 500);
    }
    json_out([
        'ok' => true,
        'nit' => 'SAT',
        'nombre' => $nombre,
        'message' => 'Nombre actualizado.',
    ]);
}

if ($action === 'list_asesores') {
    global $asesoresFile, $adminNits;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $safe = [];
    foreach (read_asesores($asesoresFile) as $a) {
        if (!is_array($a)) {
            continue;
        }
        $codigo = normalize_asesor_codigo($a['codigo'] ?? '');
        if ($codigo === '') {
            continue;
        }
        $safe[] = [
            'codigo' => $codigo,
            'nombre' => trim((string) ($a['nombre'] ?? $codigo)),
            'codigos_extra' => asesor_row_codigos_extra($a),
            'created_at' => (string) ($a['created_at'] ?? ''),
        ];
    }
    usort($safe, function ($a, $b) {
        $ca = strtoupper((string) ($a['codigo'] ?? ''));
        $cb = strtoupper((string) ($b['codigo'] ?? ''));
        $na = preg_match('/(\d+)/', $ca, $ma) ? (int) $ma[1] : PHP_INT_MAX;
        $nb = preg_match('/(\d+)/', $cb, $mb) ? (int) $mb[1] : PHP_INT_MAX;
        if ($na !== $nb) {
            return $na <=> $nb; // V1 arriba → mayor abajo
        }
        return strcasecmp($ca, $cb);
    });
    json_out(['ok' => true, 'asesores' => $safe, 'count' => count($safe)]);
}

if ($action === 'list_vendedores_gp' || $action === 'list_asesores_gp') {
    global $asesoresFile;
    [$gpCodigo, $gp] = resolve_gp_actor($body);
    $okSat = sat_actor_ok($body) || is_admin_nit($body['admin_nit'] ?? '');
    if (!$gp && !$okSat) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $safe = [];
    foreach (read_asesores($asesoresFile) as $a) {
        if (!is_array($a)) {
            continue;
        }
        $codigo = normalize_asesor_codigo($a['codigo'] ?? '');
        if ($codigo === '') {
            continue;
        }
        $safe[] = [
            'codigo' => $codigo,
            'nombre' => trim((string) ($a['nombre'] ?? $codigo)),
        ];
    }
    usort($safe, function ($a, $b) {
        $ca = strtoupper((string) ($a['codigo'] ?? ''));
        $cb = strtoupper((string) ($b['codigo'] ?? ''));
        $na = preg_match('/(\d+)/', $ca, $ma) ? (int) $ma[1] : PHP_INT_MAX;
        $nb = preg_match('/(\d+)/', $cb, $mb) ? (int) $mb[1] : PHP_INT_MAX;
        if ($na !== $nb) {
            return $na <=> $nb;
        }
        return strcasecmp($ca, $cb);
    });
    json_out([
        'ok' => true,
        'vendedores' => $safe,
        'asesores' => $safe,
        'count' => count($safe),
        'gp_codigo' => $gpCodigo,
    ]);
}

if ($action === 'delete_asesor') {
    global $asesoresFile, $adminNits;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $codigo = normalize_asesor_codigo($body['codigo'] ?? ($body['nit'] ?? ''));
    if ($codigo === '') {
        json_out(['ok' => false, 'error' => 'Código de asesor inválido.'], 400);
    }
    $asesores = read_asesores($asesoresFile);
    $kept = [];
    $removed = false;
    foreach ($asesores as $a) {
        if (!is_array($a)) {
            continue;
        }
        if (normalize_asesor_codigo($a['codigo'] ?? '') === $codigo) {
            $removed = true;
            continue;
        }
        $kept[] = $a;
    }
    if (!$removed) {
        json_out(['ok' => false, 'error' => 'Asesor no encontrado.'], 404);
    }
    if (!write_asesores($asesoresFile, $kept)) {
        json_out(['ok' => false, 'error' => 'No se pudo actualizar asesores.'], 500);
    }
    json_out(['ok' => true, 'message' => 'Asesor ' . $codigo . ' eliminado.']);
}

if ($action === 'search_clientes_nombre') {
    [$codigo, $asesor, $isZkteco] = resolve_asesor_or_zkteco($body);
    $q = trim((string) ($body['q'] ?? ($body['nombre'] ?? ($body['query'] ?? ''))));
    $limit = (int) ($body['limit'] ?? 12);
    if ($limit < 1 || $limit > 20) {
        $limit = 12;
    }
    $needle = izc_fold_search_text($q);
    $digits = preg_replace('/\D+/', '', $q);
    if (mb_strlen($needle) < 2 && strlen($digits) < 3) {
        json_out(['ok' => true, 'clientes' => [], 'count' => 0]);
    }
    $byNit = [];
    if ($asesor && !$isZkteco) {
        foreach (array_merge(get_asesor_clientes($codigo), get_asesor_clientes_manual($codigo)) as $c) {
            if (!is_array($c)) {
                continue;
            }
            $nit = normalize_nit($c['nit'] ?? '');
            if ($nit === '' || strtoupper($nit) === 'ZKTECO') {
                continue;
            }
            $nombre = trim((string) ($c['nombre'] ?? ''));
            if ($nombre === '' || $nombre === $nit) {
                $nombre = resolve_cliente_nombre_from_index($nit, $nombre);
            }
            if ($nombre === '' || $nombre === $nit) {
                continue;
            }
            $hay = izc_fold_search_text($nombre);
            $pos = ($needle !== '') ? mb_strpos($hay, $needle, 0, 'UTF-8') : false;
            if ($pos === false) {
                $needleCompact = preg_replace('/\s+/', '', $needle);
                $hayCompact = preg_replace('/\s+/', '', $hay);
                if (mb_strlen($needleCompact) >= 2) {
                    $pos = mb_strpos($hayCompact, $needleCompact, 0, 'UTF-8');
                }
            }
            $nitHit = (strlen($digits) >= 3 && strpos(preg_replace('/\D+/', '', $nit), $digits) !== false);
            if ($pos === false && !$nitHit) {
                continue;
            }
            $byNit[$nit] = [
                'nit' => $nit,
                'nombre' => $nombre,
                'telefono' => trim((string) ($c['telefono'] ?? '')),
                '_score' => ($pos === 0 || $nitHit) ? 0 : 1,
                '_len' => mb_strlen($hay, 'UTF-8'),
            ];
        }
    }
    foreach (search_nit_nombres_index($q, $limit) as $row) {
        $nit = normalize_nit($row['nit'] ?? '');
        if ($nit === '' || isset($byNit[$nit])) {
            continue;
        }
        $byNit[$nit] = [
            'nit' => $nit,
            'nombre' => trim((string) ($row['nombre'] ?? '')),
            'telefono' => trim((string) ($row['telefono'] ?? '')),
            '_score' => 1,
            '_len' => mb_strlen(izc_fold_search_text($row['nombre'] ?? ''), 'UTF-8'),
        ];
    }
    $scored = array_values($byNit);
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
    json_out(['ok' => true, 'clientes' => $out, 'count' => count($out)]);
}

if ($action === 'list_clientes_asesor') {
    global $asesoresFile;
    [$codigo, $asesor, $isZkteco] = resolve_asesor_or_zkteco($body);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if ($isZkteco) {
        json_out([
            'ok' => true,
            'codigo' => $codigo,
            'clientes' => [],
            'count' => 0,
            'bitrix_synced' => false,
            'bitrix_from_cache' => false,
            'bitrix_count' => 0,
            'bitrix_fetched_at' => '',
            'bitrix_error' => '',
        ]);
    }
    $force = !empty($body['refresh_bitrix']) || !empty($body['sync_bitrix']) || !empty($body['force']);
    $fast = !$force && (empty($body['full']) && (empty($body['fast']) || !empty($body['fast'])));
    $merged = get_asesor_clientes_merged($codigo, ['refresh_bitrix' => $force, 'fast' => $fast]);
    $clientes = $merged['clientes'] ?? [];
    $sync = $merged['sync'] ?? [];
    $cliPath = asesor_quotes_list_cache_dir() . DIRECTORY_SEPARATOR . strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) $codigo)) . '.clientes.json';
    if ($codigo !== '' && is_array($clientes)) {
        $cliDir = asesor_quotes_list_cache_dir();
        if (!is_dir($cliDir)) {
            @mkdir($cliDir, 0755, true);
        }
        @file_put_contents($cliPath, json_encode(['clientes' => $clientes, 'count' => count($clientes)], JSON_UNESCAPED_UNICODE), LOCK_EX);
    }
    json_out([
        'ok' => true,
        'codigo' => $codigo,
        'clientes' => $clientes,
        'count' => count($clientes),
        'bitrix_synced' => !empty($sync['synced']),
        'bitrix_from_cache' => !empty($sync['from_cache']),
        'bitrix_count' => (int) ($sync['bitrix_count'] ?? 0),
        'bitrix_fetched_at' => (string) ($sync['fetched_at'] ?? ''),
        'bitrix_error' => (string) ($sync['error'] ?? ''),
    ]);
}

if ($action === 'register_cliente_asesor' || $action === 'add_cliente_asesor') {
    global $asesoresFile, $asesorClientesManualFile;
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit_asesor'] ?? ($body['nit'] ?? '')));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado. Cierra sesión y entra de nuevo con tu código de asesor (V45, V1, etc.).'], 200);
    }
    $clientNit = normalize_nit($body['client_nit'] ?? ($body['cliente_nit'] ?? ($body['nit_cliente'] ?? '')));
    $nombre = trim((string) ($body['nombre'] ?? ($body['cliente_nombre'] ?? ($body['name'] ?? ''))));
    $telefono = normalize_telefono_display($body['telefono'] ?? ($body['phone'] ?? ''));
    if ($clientNit === '' || !preg_match('/^\d{6,15}$/', preg_replace('/\D+/', '', $clientNit))) {
        json_out(['ok' => false, 'error' => 'NIT inválido. Usa solo números (6 a 15 dígitos).'], 400);
    }
    if ($nombre === '' || mb_strlen($nombre) < 2) {
        json_out(['ok' => false, 'error' => 'Ingresa el nombre del cliente (mínimo 2 caracteres).'], 400);
    }
    if (mb_strlen($nombre) > 120) {
        json_out(['ok' => false, 'error' => 'El nombre es demasiado largo (máx. 120).'], 400);
    }

    $data = read_asesor_clientes_manual($asesorClientesManualFile);
    if (!isset($data['by_codigo'][$codigo]) || !is_array($data['by_codigo'][$codigo])) {
        $data['by_codigo'][$codigo] = [];
    }
    $list = asesor_clientes_manual_rows($data['by_codigo'][$codigo]);
    $updated = false;
    foreach ($list as &$row) {
        if (!is_array($row)) {
            continue;
        }
        if (normalize_nit($row['nit'] ?? '') !== $clientNit) {
            continue;
        }
        $row['nombre'] = $nombre;
        if ($telefono !== '') {
            $row['telefono'] = $telefono;
        }
        $row['updated_at'] = date('c');
        $row['updated_by'] = $codigo;
        $updated = true;
        break;
    }
    unset($row);
    if (!$updated) {
        $list[] = [
            'nit' => $clientNit,
            'nombre' => $nombre,
            'telefono' => $telefono,
            'created_at' => date('c'),
            'created_by' => $codigo,
        ];
    }
    $data['by_codigo'][$codigo] = array_values($list);
    $written = false;
    for ($wTry = 0; $wTry < 4 && !$written; $wTry++) {
        $written = write_asesor_clientes_manual($data, $asesorClientesManualFile);
        if (!$written) {
            usleep(150000);
        }
    }
    if (!$written) {
        json_out([
            'ok' => false,
            'error' => 'No se pudo guardar el cliente en el servidor. Intenta de nuevo.',
        ], 200);
    }

    $verify = get_asesor_clientes_manual($codigo);
    $found = false;
    foreach ($verify as $vc) {
        if (normalize_nit($vc['nit'] ?? '') === $clientNit) {
            $found = true;
            break;
        }
    }
    if (!$found) {
        json_out([
            'ok' => false,
            'error' => 'El cliente no quedó guardado. Intenta de nuevo.',
        ], 200);
    }

    $clienteRow = [
        'nit' => $clientNit,
        'nombre' => $nombre,
        'telefono' => $telefono,
        'manual' => true,
    ];
    asesor_clientes_json_upsert($codigo, $clienteRow);
    json_out([
        'ok' => true,
        'message' => $updated ? 'Cliente actualizado.' : 'Cliente registrado.',
        'codigo' => $codigo,
        'cliente' => $clienteRow,
        'clientes' => $verify,
        'count' => count($verify),
    ]);
}


if ($action === 'resolve_cliente_asesor_contacto') {
    global $bitrixFile, $asesoresFile;
    $clientNit = normalize_nit($body['nit'] ?? ($body['client_nit'] ?? ($body['cliente_nit'] ?? '')));
    if ($clientNit === '') {
        json_out(['ok' => false, 'error' => 'Falta el NIT del cliente.'], 400);
    }

    $cfg = read_bitrix($bitrixFile);
    $webhook = normalize_bitrix_webhook($cfg['webhook_base'] ?? '');
    if ($webhook === '' || empty($cfg['enabled'])) {
        json_out([
            'ok' => false,
            'error' => 'Bitrix no está configurado.',
            'nit' => $clientNit,
            'asesor' => null,
        ], 503);
    }

    $seller = find_bitrix_seller_by_nit($webhook, $cfg, $clientNit);
    $assigned = trim((string) ($seller['assigned_by_id'] ?? ''));
    if ($assigned === '') {
        $codigo = resolve_asesor_codigo_for_nit($clientNit);
        $nombre = '';
        if ($codigo !== '') {
            [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
            $nombre = trim((string) ($asesor['nombre'] ?? ''));
        }
        json_out([
            'ok' => true,
            'nit' => $clientNit,
            'found' => $codigo !== '' || $nombre !== '',
            'asesor' => [
                'codigo' => $codigo,
                'nombre' => $nombre,
                'telefono' => '',
                'email' => '',
                'bitrix_user_id' => '',
                'source' => 'local_map',
            ],
        ]);
    }

    $contact = bitrix_user_contact_info($webhook, $assigned);
    $codigo = trim((string) ($contact['codigo'] ?? ''));
    if ($codigo === '') {
        $codigo = resolve_asesor_codigo_from_bitrix_id($assigned);
    }
    $nombre = trim((string) ($contact['nombre'] ?? ''));
    if ($nombre === '') {
        $nombre = trim((string) ($seller['seller_name'] ?? ''));
        $nombre = preg_replace('/^(?:IZC|VALTECH)\s*V\d+\s*[-–—]?\s*/iu', '', $nombre);
        $nombre = trim((string) $nombre);
    }

    json_out([
        'ok' => true,
        'nit' => $clientNit,
        'found' => true,
        'asesor' => [
            'codigo' => $codigo,
            'nombre' => $nombre,
            'telefono' => trim((string) ($contact['telefono'] ?? '')),
            'email' => trim((string) ($contact['email'] ?? '')),
            'bitrix_user_id' => $assigned,
            'source' => 'bitrix_user',
        ],
    ]);
}

if ($action === 'resolve_cliente_pdf_contacto') {
    $clientNit = normalize_nit($body['nit'] ?? ($body['client_nit'] ?? ($body['cliente_nit'] ?? '')));
    if ($clientNit === '') {
        json_out(['ok' => false, 'error' => 'Falta el NIT del cliente.'], 400);
    }
    json_out([
        'ok' => true,
        'nit' => $clientNit,
        'telefono' => resolve_cliente_telefono_from_index($clientNit, ''),
        'direccion' => resolve_cliente_direccion_from_index($clientNit, ''),
    ]);
}

if ($action === 'lookup_nit_nombre' || $action === 'lookup_cliente_nit') {
    $q = trim((string) ($body['q'] ?? ($body['nombre'] ?? ($body['query'] ?? ''))));
    $clientNit = normalize_nit($body['client_nit'] ?? ($body['cliente_nit'] ?? ($body['nit_cliente'] ?? ($body['nit'] ?? ''))));
    if ($clientNit === '' && preg_match('/\d{6,}/', $q)) {
        $clientNit = normalize_nit($q);
    }
    $digits = preg_replace('/\D+/', '', $clientNit);
    if (strlen($digits) >= 5) {
        $nombre = resolve_cliente_nombre_from_index($clientNit, '');
        if ($nombre === $clientNit) {
            $nombre = '';
        }
        $telefono = resolve_cliente_telefono_from_index($clientNit, '');
        json_out([
            'ok' => true,
            'nit' => $clientNit,
            'nombre' => $nombre,
            'telefono' => $telefono,
            'found' => ($nombre !== ''),
            'source' => $nombre !== '' ? 'index' : '',
            'clientes' => $nombre !== '' ? [['nit' => $clientNit, 'nombre' => $nombre, 'telefono' => $telefono]] : [],
        ]);
    }
    if (mb_strlen(izc_fold_search_text($q)) >= 2) {
        $hits = search_nit_nombres_index($q, 8);
        $exact = null;
        $qFold = izc_fold_search_text($q);
        foreach ($hits as $row) {
            if (izc_fold_search_text($row['nombre'] ?? '') === $qFold) {
                $exact = $row;
                break;
            }
        }
        if (!$exact && count($hits) === 1) {
            $exact = $hits[0];
        }
        json_out([
            'ok' => true,
            'nit' => $exact ? (string) ($exact['nit'] ?? '') : '',
            'nombre' => $exact ? trim((string) ($exact['nombre'] ?? '')) : '',
            'telefono' => $exact ? trim((string) ($exact['telefono'] ?? '')) : '',
            'found' => $exact ? true : count($hits) > 0,
            'source' => 'index',
            'clientes' => $hits,
            'count' => count($hits),
        ]);
    }
    json_out(['ok' => false, 'error' => 'Falta el NIT o el nombre del cliente.'], 400);
}

if ($action === 'lookup_cliente_asesor') {
    global $asesoresFile;
    [$codigo, $asesor, $isZkteco] = resolve_asesor_or_zkteco($body);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $clientNit = normalize_nit($body['client_nit'] ?? ($body['cliente_nit'] ?? ($body['nit_cliente'] ?? ($body['q'] ?? ''))));
    if ($clientNit === '') {
        json_out(['ok' => false, 'error' => 'Falta el NIT del cliente.'], 400);
    }

    $nombre = '';
    $telefono = '';
    $source = '';
    $nitSet = [$clientNit => true];
    $digits = preg_replace('/\D+/', '', $clientNit);
    if ($digits !== '') {
        $nitSet[$digits] = true;
        $noZeros = ltrim($digits, '0');
        if ($noZeros !== '') {
            $nitSet[$noZeros] = true;
        }
    }

    if (!$isZkteco) {
        $mergedLookup = get_asesor_clientes_merged($codigo, ['refresh_bitrix' => false, 'fast' => true]);
        foreach (($mergedLookup['clientes'] ?? []) as $c) {
            if (!is_array($c)) {
                continue;
            }
            $cNit = normalize_nit($c['nit'] ?? '');
            if ($cNit === '' || empty($nitSet[$cNit])) {
                $cDigits = preg_replace('/\D+/', '', $cNit);
                if ($cDigits === '' || empty($nitSet[$cDigits])) {
                    $cNo = ltrim($cDigits, '0');
                    if ($cNo === '' || empty($nitSet[$cNo])) {
                        continue;
                    }
                }
            }
            $nombre = trim((string) ($c['nombre'] ?? ''));
            $telefono = trim((string) ($c['telefono'] ?? ''));
            $source = 'asesor';
            break;
        }
    }

    if ($nombre === '' || $nombre === $clientNit) {
        $fromIndex = resolve_cliente_nombre_from_index($clientNit, '');
        if ($fromIndex !== '' && $fromIndex !== $clientNit) {
            $nombre = $fromIndex;
            if ($source === '') {
                $source = 'index';
            }
        }
    }
    if ($telefono === '') {
        $telefono = resolve_cliente_telefono_from_index($clientNit, '');
    }

    json_out([
        'ok' => true,
        'nit' => $clientNit,
        'nombre' => $nombre,
        'telefono' => $telefono,
        'found' => ($nombre !== '' && $nombre !== $clientNit),
        'source' => $source !== '' ? $source : 'index',
        'owned' => ($source === 'asesor'),
    ]);
}

/** TRM por defecto, totales e ítems mínimos para mostrar/PDF. */
function prepare_quote_for_display(&$quote, $tryBitrix = false) {
    global $trmFile, $bitrixFile;
    if (!is_array($quote)) {
        return false;
    }
    $changed = false;
    $trmEntry = read_trm($trmFile);
    $defaultTrm = isset($trmEntry['value']) ? (float) $trmEntry['value'] : 0.0;
    if ($defaultTrm <= 0) {
        $defaultTrm = 3204.0;
    }
    $trm = isset($quote['trm']) ? (float) $quote['trm'] : 0.0;
    // Empresa siempre visible en panel/PDF.
    if (!quote_empresa_locked($quote)) {
        $empresa = resolve_quote_empresa($quote);
        if (apply_quote_empresa($quote, $empresa)) {
            $changed = true;
        }
    }
    if (repair_quote_totals_from_items($quote)) {
        $changed = true;
    }
    $items = is_array($quote['items'] ?? null) ? $quote['items'] : [];
    $totals = is_array($quote['totals'] ?? null) ? $quote['totals'] : [];
    $currency = !empty($totals['hasUsd']) && empty($totals['hasCop']) ? 'USD' : 'COP';
    if (!empty($totals['hasUsd']) && (float) ($totals['usdIva'] ?? 0) > 0) {
        $currency = 'USD';
    }
    $amount = $currency === 'USD'
        ? (float) ($totals['usdIva'] ?? $totals['usd'] ?? 0)
        : (float) ($totals['copIva'] ?? $totals['cop'] ?? 0);
    if ((!$items || quote_items_are_placeholder($quote)) && $amount > 0 && !quote_has_real_items($quote)) {
        $dealId = trim((string) ($quote['bitrix_deal_id'] ?? ''));
        $qty = max(1, (int) ($totals['qty'] ?? 1));
        $line = [
            'sku' => '',
            'name' => 'Productos cotizados',
            'referencia' => $dealId !== '' ? ('Bitrix #' . $dealId) : '',
            'qty' => $qty,
            'currency' => $currency,
        ];
        if ($currency === 'USD') {
            $line['usdIva'] = $amount / $qty;
            $line['totalUsdIva'] = $amount;
        } else {
            $line['copIva'] = $amount / $qty;
            $line['totalCopIva'] = $amount;
        }
        $quote['items'] = [$line];
        $quote['totals']['qty'] = $qty;
        $changed = true;
    }
    $needBitrix = $tryBitrix && (
        quote_items_are_placeholder($quote) ||
        !isset($quote['trm']) ||
        (float) ($quote['trm'] ?? 0) <= 0
    );
    if ($needBitrix) {
        $cfg = read_bitrix($bitrixFile);
        if (!empty($cfg['enabled']) && !empty($cfg['webhook_base'])) {
            if (enrich_quote_items_from_bitrix($quote, $cfg['webhook_base'], $cfg)) {
                $changed = true;
            }
        }
    }
    $trm = isset($quote['trm']) ? (float) $quote['trm'] : 0.0;
    if ($trm <= 0 && $defaultTrm > 0) {
        $quote['trm'] = $defaultTrm;
        $changed = true;
    }
    if (repair_quote_totals_from_items($quote)) {
        $changed = true;
    }
    return $changed;
}

if ($action === 'get_quote_asesor') {
    global $asesoresFile, $quotesFile;
    @set_time_limit(60);
    [$codigo, $asesor] = resolve_asesor_or_zkteco($body);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotización.'], 400);
    }

    $quotes = read_quotes($quotesFile);
    $idx = find_asesor_quote_index($quotes, $quoteId, $codigo);
    if ($idx === -2) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
    }
    if ($idx < 0) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }

    // Persistir seller_codigo reparado (si apply) para próximas consultas.
    $sellerRepaired = ensure_quote_seller_codigo_for_match($quotes[$idx]);

    if (array_key_exists('enrich_bitrix', $body)) {
        $tryBitrix = !empty($body['enrich_bitrix']);
    } else {
        $tryBitrix = quote_items_are_placeholder($quotes[$idx]);
    }
    repair_quote_items_from_siblings($quotes);
    $changed = prepare_quote_for_display($quotes[$idx], $tryBitrix);
    if ($changed || $sellerRepaired) {
        write_quotes($quotesFile, $quotes);
    }

    json_out([
        'ok' => true,
        'quote' => quote_to_asesor_safe_row($quotes[$idx], quote_asesor_estado($quotes[$idx])),
        'enriched' => $tryBitrix && !quote_items_are_placeholder($quotes[$idx]),
    ]);
}

if ($action === 'enrich_quote_items') {
    global $asesoresFile, $quotesFile, $bitrixFile;
    @set_time_limit(60);
    [$codigo, $asesor] = resolve_asesor_or_zkteco($body);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotización.'], 400);
    }

    $quotes = read_quotes($quotesFile);
    $idx = find_asesor_quote_index($quotes, $quoteId, $codigo);
    if ($idx === -2) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
    }
    if ($idx < 0) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }

    repair_quote_items_from_siblings($quotes);
    if (array_key_exists('enrich_bitrix', $body)) {
        $tryBitrix = !empty($body['enrich_bitrix']);
    } elseif (!empty($body['bitrix'])) {
        $tryBitrix = true;
    } else {
        $tryBitrix = quote_items_are_placeholder($quotes[$idx]);
    }
    $changed = prepare_quote_for_display($quotes[$idx], $tryBitrix);
    $enriched = !quote_items_are_placeholder($quotes[$idx]);
    if ($changed) {
        write_quotes($quotesFile, $quotes);
    }

    json_out([
        'ok' => true,
        'quote' => quote_to_asesor_safe_row($quotes[$idx], quote_asesor_estado($quotes[$idx])),
        'enriched' => $enriched,
    ]);
}

if ($action === 'list_quotes_zkteco') {
    if (!zkteco_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $listOnly = !empty($body['fast']) || !empty($body['list_only']);
    $data = get_quotes_for_zkteco(['list_only' => $listOnly]);
    json_out([
        'ok' => true,
        'quotes' => $data['quotes'],
        'count' => $data['count'],
        'count_historial' => $data['count_historial'],
        'role' => 'zkteco',
        'codigo' => 'ZKTECO',
    ]);
}

if ($action === 'list_quotes_zkteco_asesores') {
    if (!zkteco_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $listOnly = !empty($body['fast']) || !empty($body['list_only']);
    $data = get_quotes_for_zkteco_asesores(['list_only' => $listOnly]);
    json_out([
        'ok' => true,
        'quotes' => $data['quotes'],
        'count' => $data['count'],
        'count_historial' => $data['count_historial'],
        'role' => 'zkteco',
        'codigo' => 'ZKTECO',
        'scope' => 'asesores',
    ]);
}

if ($action === 'list_quotes_sat') {
    if (!sat_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $scope = strtolower(trim((string) ($body['scope'] ?? 'gerentes')));
    if ($scope !== 'clientes') {
        $scope = 'gerentes';
    }
    $listOnly = !empty($body['fast']) || !empty($body['list_only']);
    $data = get_quotes_for_sat($scope, ['list_only' => $listOnly]);
    $otherScope = $scope === 'clientes' ? 'gerentes' : 'clientes';
    $other = get_quotes_for_sat($otherScope, ['list_only' => true]);
    $gerentes = list_gerentes_producto_rows();
    json_out([
        'ok' => true,
        'quotes' => $data['quotes'],
        'count' => $data['count'],
        'scope' => $scope,
        'client_count' => $scope === 'clientes' ? $data['count'] : $other['count'],
        'gerentes_quotes_count' => $scope === 'gerentes' ? $data['count'] : $other['count'],
        'gerentes_count' => count($gerentes),
        'role' => 'sat',
        'codigo' => 'SAT',
    ]);
}

if ($action === 'get_quote_sat') {
    global $quotesFile;
    if (!sat_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotizacion.'], 400);
    }
    $quotes = read_quotes($quotesFile);
    $found = null;
    foreach ($quotes as $q) {
        if (!is_array($q)) {
            continue;
        }
        $qid = trim((string) ($q['id'] ?? ''));
        $deal = trim((string) ($q['bitrix_deal_id'] ?? ''));
        if ($qid === $quoteId || ($deal !== '' && $deal === $quoteId)) {
            $found = $q;
            break;
        }
    }
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Cotizacion no encontrada.'], 404);
    }
    if (function_exists('prepare_quote_for_display')) {
        prepare_quote_for_display($found, false);
    }
    $estado = function_exists('quote_asesor_estado') ? quote_asesor_estado($found) : (string) ($found['asesor_estado'] ?? '');
    json_out([
        'ok' => true,
        'quote' => quote_to_asesor_safe_row($found, $estado),
    ]);
}

if ($action === 'list_gerentes_producto') {
    if (!sat_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $gerentes = list_gerentes_producto_rows();
    json_out([
        'ok' => true,
        'gerentes' => $gerentes,
        'count' => count($gerentes),
    ]);
}



if ($action === 'register_gp' || $action === 'register_gerente_producto') {
    global $gerentesProductoFile, $bitrixGerentesFile;
    // Registro publico: el GP se registra solo (como registro.html de clientes).
    $codigo = normalize_gp_codigo($body['codigo'] ?? ($body['gp'] ?? ($body['nit'] ?? '')));
    $password = (string) ($body['password'] ?? '');
    $nombre = trim((string) ($body['nombre'] ?? ''));
    $bitrixId = trim((string) ($body['bitrix_id'] ?? ''));
    $email = trim((string) ($body['email'] ?? ''));
    if ($codigo === '') {
        json_out(['ok' => false, 'error' => 'Código GP inválido. Usa GP1, GP23, etc.'], 400);
    }
    if (strlen($password) < 4) {
        json_out(['ok' => false, 'error' => 'La contraseña debe tener al menos 4 caracteres.'], 400);
    }
    if ($nombre === '' || mb_strlen($nombre) < 2) {
        json_out(['ok' => false, 'error' => 'Ingresa tu nombre (mínimo 2 caracteres).'], 400);
    }
    if (gp_nombre_is_codigo($nombre, $codigo)) {
        json_out(['ok' => false, 'error' => 'En Nombre escribe tu nombre completo, no el código GP.'], 400);
    }
    if ($bitrixId === '' && is_file($bitrixGerentesFile)) {
        $map = json_decode((string) file_get_contents($bitrixGerentesFile), true);
        if (is_array($map)) {
            foreach ($map as $id => $label) {
                $blob = strtoupper(preg_replace('/[\s.]/', '', (string) $label));
                if ($blob !== '' && strpos($blob, $codigo) !== false) {
                    $bitrixId = (string) $id;
                    break;
                }
            }
        }
    }
    $rows = read_gerentes_producto($gerentesProductoFile);
    [$idx, $existing] = find_gerente_producto($rows, $codigo);
    // Re-registro: si ya existe, actualiza nombre/contraseña (restablece acceso).
    if ($existing && $idx !== null) {
        $rows[$idx]['nombre'] = $nombre;
        $rows[$idx]['password_hash'] = hash_password($password);
        $rows[$idx]['password_default'] = false;
        $rows[$idx]['self_registered'] = true;
        $rows[$idx]['source'] = 'registro';
        if ($bitrixId !== '') {
            $rows[$idx]['bitrix_id'] = $bitrixId;
        }
        if ($email !== '') {
            $rows[$idx]['email'] = $email;
        }
        if (empty($rows[$idx]['created_at'])) {
            $rows[$idx]['created_at'] = date('c');
        }
        if (!write_gerentes_producto($gerentesProductoFile, $rows)) {
            json_out(['ok' => false, 'error' => 'No se pudo actualizar el gerente.'], 500);
        }
        json_out([
            'ok' => true,
            'codigo' => $codigo,
            'nit' => $codigo,
            'nombre' => $nombre,
            'role' => 'gp',
            'updated' => true,
            'message' => 'Cuenta GP actualizada. Ya puedes iniciar sesión.',
        ]);
    }
    $rows[] = [
        'codigo' => $codigo,
        'nombre' => $nombre,
        'password_hash' => hash_password($password),
        'bitrix_id' => $bitrixId,
        'email' => $email,
        'created_at' => date('c'),
        'password_default' => false,
        'self_registered' => true,
        'source' => 'registro',
    ];
    if (!write_gerentes_producto($gerentesProductoFile, $rows)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el gerente.'], 500);
    }
    json_out([
        'ok' => true,
        'codigo' => $codigo,
        'nit' => $codigo,
        'nombre' => $nombre,
        'role' => 'gp',
        'message' => 'Cuenta GP creada. Ya puedes iniciar sesión.',
    ]);
}

if ($action === 'update_gp' || $action === 'update_gerente_producto') {
    global $gerentesProductoFile;
    if (!sat_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $codigo = normalize_gp_codigo($body['codigo'] ?? ($body['gp'] ?? ''));
    $rows = read_gerentes_producto($gerentesProductoFile);
    [$idx, $existing] = find_gerente_producto($rows, $codigo);
    if ($idx === null || !$existing) {
        json_out(['ok' => false, 'error' => 'Gerente no encontrado.'], 404);
    }
    $nombre = trim((string) ($body['nombre'] ?? ''));
    if ($nombre !== '') {
        $rows[$idx]['nombre'] = $nombre;
    }
    if (isset($body['bitrix_id'])) {
        $rows[$idx]['bitrix_id'] = trim((string) $body['bitrix_id']);
    }
    if (isset($body['email'])) {
        $rows[$idx]['email'] = trim((string) $body['email']);
    }
    $password = (string) ($body['password'] ?? '');
    if ($password !== '') {
        if (strlen($password) < 4) {
            json_out(['ok' => false, 'error' => 'La contraseña debe tener al menos 4 caracteres.'], 400);
        }
        $rows[$idx]['password_hash'] = hash_password($password);
        $rows[$idx]['password_default'] = false;
    }
    if (!write_gerentes_producto($gerentesProductoFile, $rows)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar.'], 500);
    }
    json_out(['ok' => true, 'codigo' => $codigo, 'nombre' => $rows[$idx]['nombre'], 'message' => 'Gerente actualizado.']);
}

if ($action === 'delete_gp' || $action === 'delete_gerente_producto') {
    global $gerentesProductoFile;
    if (!sat_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $codigo = normalize_gp_codigo($body['codigo'] ?? ($body['gp'] ?? ''));
    $rows = read_gerentes_producto($gerentesProductoFile);
    $kept = [];
    $found = false;
    foreach ($rows as $r) {
        if (normalize_gp_codigo($r['codigo'] ?? '') === $codigo) {
            $found = true;
            continue;
        }
        $kept[] = $r;
    }
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Gerente no encontrado.'], 404);
    }
    if (!write_gerentes_producto($gerentesProductoFile, $kept)) {
        json_out(['ok' => false, 'error' => 'No se pudo eliminar.'], 500);
    }
    json_out(['ok' => true, 'message' => 'Gerente ' . $codigo . ' eliminado.']);
}

if ($action === 'list_clientes_gp') {
    [$codigo, $gp] = resolve_gp_actor($body);
    $okAdmin = sat_actor_ok($body) || is_admin_nit($body['admin_nit'] ?? '');
    if (!$gp && !$okAdmin) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if ($okAdmin && $codigo === '') {
        $codigo = normalize_gp_codigo($body['gp_codigo'] ?? ($body['codigo'] ?? ''));
    }
    if ($codigo === '') {
        json_out(['ok' => false, 'error' => 'Falta código GP.'], 400);
    }
    $force = !empty($body['refresh_bitrix']) || !empty($body['sync_bitrix']) || !empty($body['force']);
    $data = sync_gp_clientes_from_bitrix($codigo, $force);
    $clientes = merge_gp_clientes_list($codigo, is_array($data['clientes'] ?? null) ? $data['clientes'] : []);
    json_out([
        'ok' => true,
        'codigo' => $codigo,
        'clientes' => $clientes,
        'count' => count($clientes),
        'bitrix_synced' => !empty($data['synced']),
        'bitrix_from_cache' => !empty($data['from_cache']),
        'bitrix_count' => (int) ($data['bitrix_count'] ?? 0),
        'bitrix_fetched_at' => (string) ($data['fetched_at'] ?? ''),
        'bitrix_error' => (string) ($data['error'] ?? ''),
    ]);
}

if ($action === 'register_cliente_gp' || $action === 'add_cliente_gp') {
    global $gpClientesManualFile;
    [$codigo, $gp] = resolve_gp_actor($body);
    if (!$gp) {
        json_out([
            'ok' => false,
            'error' => 'No autorizado. Cierra sesión y entra de nuevo con tu código GP.',
        ], 200);
    }
    $clientNit = normalize_nit($body['client_nit'] ?? ($body['cliente_nit'] ?? ($body['nit_cliente'] ?? '')));
    $nombre = trim((string) ($body['nombre'] ?? ($body['cliente_nombre'] ?? ($body['name'] ?? ''))));
    $telefono = normalize_telefono_display($body['telefono'] ?? ($body['phone'] ?? ''));
    if ($clientNit === '' || !preg_match('/^\d{6,15}$/', preg_replace('/\D+/', '', $clientNit))) {
        json_out(['ok' => false, 'error' => 'NIT inválido. Usa solo números (6 a 15 dígitos).'], 400);
    }
    if ($nombre === '' || mb_strlen($nombre) < 2) {
        json_out(['ok' => false, 'error' => 'Ingresa el nombre del cliente (mínimo 2 caracteres).'], 400);
    }
    if (mb_strlen($nombre) > 120) {
        json_out(['ok' => false, 'error' => 'El nombre es demasiado largo (máx. 120).'], 400);
    }

    $data = read_gp_clientes_manual($gpClientesManualFile);
    if (!isset($data['by_codigo'][$codigo]) || !is_array($data['by_codigo'][$codigo])) {
        $data['by_codigo'][$codigo] = [];
    }
    $list = asesor_clientes_manual_rows($data['by_codigo'][$codigo]);
    $updated = false;
    foreach ($list as &$row) {
        if (!is_array($row)) {
            continue;
        }
        if (normalize_nit($row['nit'] ?? '') !== $clientNit) {
            continue;
        }
        $row['nombre'] = $nombre;
        if ($telefono !== '') {
            $row['telefono'] = $telefono;
        }
        $row['updated_at'] = date('c');
        $row['updated_by'] = $codigo;
        $updated = true;
        break;
    }
    unset($row);
    if (!$updated) {
        $list[] = [
            'nit' => $clientNit,
            'nombre' => $nombre,
            'telefono' => $telefono,
            'created_at' => date('c'),
            'created_by' => $codigo,
        ];
    }
    $data['by_codigo'][$codigo] = array_values($list);
    $written = false;
    for ($wTry = 0; $wTry < 4 && !$written; $wTry++) {
        $written = write_gp_clientes_manual($data, $gpClientesManualFile);
        if (!$written) {
            usleep(150000);
        }
    }
    if (!$written) {
        json_out([
            'ok' => false,
            'error' => 'No se pudo guardar el cliente en el servidor. Intenta de nuevo.',
        ], 200);
    }

    $verify = get_gp_clientes_manual($codigo);
    $found = false;
    foreach ($verify as $vc) {
        if (normalize_nit($vc['nit'] ?? '') === $clientNit) {
            $found = true;
            break;
        }
    }
    if (!$found) {
        json_out([
            'ok' => false,
            'error' => 'El cliente no quedó guardado. Intenta de nuevo.',
        ], 200);
    }

    $synced = sync_gp_clientes_from_bitrix($codigo, false);
    $all = merge_gp_clientes_list($codigo, is_array($synced['clientes'] ?? null) ? $synced['clientes'] : []);

    json_out([
        'ok' => true,
        'message' => $updated ? 'Cliente actualizado.' : 'Cliente registrado.',
        'codigo' => $codigo,
        'cliente' => [
            'nit' => $clientNit,
            'nombre' => $nombre,
            'telefono' => $telefono,
            'manual' => true,
        ],
        'clientes' => $all,
        'count' => count($all),
    ]);
}

if ($action === 'list_quotes_gp') {
    [$codigo, $gp] = resolve_gp_actor($body);
    $okAdmin = sat_actor_ok($body) || is_admin_nit($body['admin_nit'] ?? '');
    if (!$gp && !$okAdmin) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if ($okAdmin && $codigo === '') {
        $codigo = normalize_gp_codigo($body['gp_codigo'] ?? ($body['codigo'] ?? ''));
    }
    if ($codigo === '') {
        json_out(['ok' => false, 'error' => 'Falta código GP.'], 400);
    }
    $scope = strtolower(trim((string) ($body['scope'] ?? 'historial')));
    $listOnly = !empty($body['fast']) || !empty($body['list_only']);
    $allowFibra = gp_is_fibra_panel($codigo);
    $data = get_quotes_for_gp($codigo, $scope, [
        'list_only' => $listOnly,
        'allow_fibra' => $allowFibra,
    ]);
    $clients = sync_gp_clientes_from_bitrix($codigo, false);
    $scopeNorm = strtolower((string) ($data['scope'] ?? $scope));
    if ($allowFibra && ($scopeNorm === 'fibra' || $scopeNorm === 'asesores-fibra' || $scopeNorm === 'quotes-fibra')) {
        @set_time_limit(90);
        gp_fibra_backfill_bitrix_observers(10);
    }
    json_out([
        'ok' => true,
        'codigo' => $codigo,
        'scope' => $data['scope'] ?? $scope,
        'quotes' => $data['quotes'],
        'count' => $data['count'],
        'historial_count' => (int) ($data['historial_count'] ?? 0),
        'client_quotes_count' => (int) ($data['client_quotes_count'] ?? 0),
        'fibra_count' => $allowFibra ? (int) ($data['fibra_count'] ?? 0) : 0,
        'show_fibra' => $allowFibra,
        'clientes_count' => count($clients['clientes'] ?? []),
        'role' => 'gp',
    ]);
}

if ($action === 'get_quote_gp') {
    global $quotesFile;
    [$codigo, $gp] = resolve_gp_actor($body);
    $okAdmin = sat_actor_ok($body) || is_admin_nit($body['admin_nit'] ?? '');
    if (!$gp && !$okAdmin) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotización.'], 400);
    }
    $quotes = read_quotes($quotesFile);
    $found = null;
    foreach ($quotes as $q) {
        if (!is_array($q)) continue;
        if (trim((string) ($q['id'] ?? '')) === $quoteId) {
            $found = $q;
            break;
        }
    }
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }
    $isFibraAsesor = quote_is_made_by_asesor_vendedor($found) && quote_has_fibra_product($found);
    if ($isFibraAsesor && !quote_is_made_by_gp($found, $codigo) && !gp_is_fibra_panel($codigo)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if (function_exists('prepare_quote_for_display')) {
        prepare_quote_for_display($found, false);
    }
    $estado = function_exists('quote_asesor_estado') ? quote_asesor_estado($found) : (string) ($found['asesor_estado'] ?? '');
    json_out(['ok' => true, 'quote' => quote_to_asesor_safe_row($found, $estado)]);
}


if ($action === 'get_quote_zkteco') {
    global $quotesFile;
    if (!zkteco_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotización.'], 400);
    }
    $quotes = read_quotes($quotesFile);
    $found = null;
    foreach ($quotes as $q) {
        if (!is_array($q)) {
            continue;
        }
        $qid = trim((string) ($q['id'] ?? ''));
        $deal = trim((string) ($q['bitrix_deal_id'] ?? ''));
        if ($qid === $quoteId || ($deal !== '' && $deal === $quoteId)) {
            $found = $q;
            break;
        }
    }
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }
    if (function_exists('prepare_quote_for_display')) {
        prepare_quote_for_display($found, false);
    }
    json_out([
        'ok' => true,
        'quote' => quote_to_asesor_safe_row($found, quote_asesor_estado($found)),
    ]);
}

if ($action === 'list_quotes_asesor') {
    global $asesoresFile;
    @set_time_limit(120);
    [$codigo, $asesor, $isZkteco] = resolve_asesor_or_zkteco($body);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if ($isZkteco) {
        $listOnly = !empty($body['fast']) || !empty($body['bundle']) || !empty($body['list_only']);
        $data = get_quotes_for_zkteco(['list_only' => $listOnly]);
        json_out([
            'ok' => true,
            'quotes' => $data['quotes'],
            'historial' => $data['quotes'],
            'nuevas' => [],
            'duplicadas' => [],
            'count' => $data['count'],
            'count_nuevas' => 0,
            'count_historial' => $data['count_historial'],
            'count_duplicadas' => 0,
            'filtro' => 'historial',
            'role' => 'zkteco',
            'codigo' => 'ZKTECO',
        ]);
    }
    $fast = !empty($body['fast']) || !empty($body['skip_repairs']);
    $bundle = !empty($body['bundle']);
    $listOnly = $fast || $bundle || !empty($body['list_only']);
    $forceSync = !empty($body['refresh_bitrix']) || !empty($body['sync_bitrix']) || !empty($body['force']);
    $skipCache = !empty($body['skip_cache']);
    if (!$forceSync && !$skipCache) {
        $cachedList = asesor_quotes_list_cache_get($codigo);
        if (is_array($cachedList)) {
            $filtroCached = strtolower(trim((string) ($body['filtro'] ?? ($body['estado'] ?? 'historial'))));
            $applied = asesor_quotes_list_from_cache_apply_want($cachedList, $filtroCached);
            json_out([
                'ok' => true,
                'quotes' => $applied['quotes'] ?? [],
                'count' => (int) ($applied['count'] ?? 0),
                'count_nuevas' => (int) ($cachedList['count_nuevas'] ?? 0),
                'count_historial' => (int) ($cachedList['count_historial'] ?? 0),
                'count_duplicadas' => (int) ($cachedList['count_duplicadas'] ?? 0),
                'count_gp' => (int) ($cachedList['count_gp'] ?? 0),
                'historial' => is_array($cachedList['historial'] ?? null) ? $cachedList['historial'] : [],
                'nuevas' => is_array($cachedList['nuevas'] ?? null) ? $cachedList['nuevas'] : [],
                'duplicadas' => is_array($cachedList['duplicadas'] ?? null) ? $cachedList['duplicadas'] : [],
                'gp' => is_array($cachedList['gp'] ?? null) ? $cachedList['gp'] : [],
                'quotes_gp' => is_array($cachedList['gp'] ?? null) ? $cachedList['gp'] : [],
                'from_cache' => true,
                'filtro' => $filtroCached,
                'role' => 'asesor',
                'codigo' => $codigo,
            ]);
        }
    }
    $bitrixSync = [
        'synced' => false,
        'from_cache' => false,
        'imported' => 0,
        'linked' => 0,
        'deals_found' => 0,
        'error' => '',
        'fetched_at' => '',
    ];
    if ($forceSync) {
        try {
            $bitrixSync = sync_bitrix_deals_for_asesor($codigo, $forceSync);
        } catch (Throwable $e) {
            $bitrixSync['error'] = 'Sync Bitrix: ' . $e->getMessage();
        }
        maybe_run_quote_maintenance(true);
    } elseif (!$fast) {
        maybe_run_quote_maintenance(false);
    }
    $filtro = strtolower(trim((string) ($body['filtro'] ?? ($body['estado'] ?? 'historial'))));
    $listOpts = ['list_only' => $listOnly];
    // Tras sync Bitrix siempre remarcar duplicadas; "fast" solo salta repairs si no hubo sync.
    if ($fast && !$forceSync) {
        $listOpts['skip_repair'] = true;
    }
    if ($bundle) {
        $listOpts['bundle'] = true;
    }
    $bundleAll = get_quotes_for_asesor($codigo, 'all', $listOpts);
    $bundle = filter_asesor_quotes_bundle($bundleAll, $filtro, $codigo);
    $resolvedDeal = '';
    $resolveError = '';
    $resolveId = trim((string) ($body['resolve_deal_quote_id'] ?? ''));
    if ($resolveId !== '') {
        $target = null;
        foreach (($bundleAll['quotes'] ?? []) as $row) {
            if (quote_ids_equal($row['id'] ?? '', $resolveId) || quote_ids_equal($row['bitrix_deal_id'] ?? '', $resolveId)) {
                $target = $row;
                break;
            }
        }
        // Fallback: buscar en archivo aunque el listado fast no la haya incluido.
        if (!$target) {
            $allQuotes = read_quotes($quotesFile);
            $idx = find_asesor_quote_index($allQuotes, $resolveId, $codigo);
            if ($idx >= 0) {
                $target = $allQuotes[$idx];
                if (ensure_quote_seller_codigo_for_match($allQuotes[$idx])) {
                    write_quotes($quotesFile, $allQuotes);
                    $target = $allQuotes[$idx];
                }
            } elseif ($idx === -2) {
                $resolveError = 'Cotización no encontrada para este asesor.';
            }
        }
        if ($target) {
            $ensured = ensure_bitrix_deal_id_for_quote($target);
            if (!empty($ensured['ok']) && !empty($ensured['deal_id'])) {
                $resolvedDeal = (string) $ensured['deal_id'];
                $bundleAll = get_quotes_for_asesor($codigo, 'all', $listOpts);
                $bundle = filter_asesor_quotes_bundle($bundleAll, $filtro, $codigo);
            } else {
                $resolveError = trim((string) ($ensured['error'] ?? '')) ?: 'No se encontró la negociación en Bitrix para esta cotización.';
            }
        } elseif ($resolveError === '') {
            $resolveError = 'Cotización no encontrada para este asesor.';
        }
    }
    $out = [
        'ok' => true,
        'quotes' => $bundle['quotes'],
        'count' => $bundle['count'],
        'count_nuevas' => $bundleAll['count_nuevas'] ?? 0,
        'count_historial' => $bundleAll['count_historial'] ?? 0,
        'count_duplicadas' => $bundleAll['count_duplicadas'] ?? 0,
        'count_gp' => $bundleAll['count_gp'] ?? 0,
        'quotes_in_file' => (int) ($bundleAll['quotes_in_file'] ?? 0),
        'quotes_matched' => (int) ($bundleAll['quotes_matched'] ?? 0),
        'bitrix_sync' => $bitrixSync,
        'filtro' => $filtro,
        'role' => 'asesor',
        'codigo' => $codigo,
        'resolved_bitrix_deal_id' => $resolvedDeal,
        'resolve_error' => $resolveError,
    ];
    if ($bundle) {
        $out['historial'] = is_array($bundleAll['historial'] ?? null) ? $bundleAll['historial'] : [];
        $out['nuevas'] = is_array($bundleAll['nuevas'] ?? null) ? $bundleAll['nuevas'] : [];
        $out['duplicadas'] = is_array($bundleAll['duplicadas'] ?? null) ? $bundleAll['duplicadas'] : [];
        $out['gp'] = is_array($bundleAll['gp'] ?? null) ? $bundleAll['gp'] : [];
        $out['quotes_gp'] = $out['gp'];
    }
    json_out($out);
}

if ($action === 'push_estados_bitrix' || $action === 'sync_estados_to_bitrix') {
    global $asesoresFile;
    @set_time_limit(180);
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit'] ?? ''));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $max = isset($body['max']) ? (int) $body['max'] : 150;
    if ($max < 1) {
        $max = 1;
    }
    if ($max > 300) {
        $max = 300;
    }
    $push = push_asesor_estados_to_bitrix($codigo, $max);
    $dupPush = push_recotizadas_to_bitrix_duplicada(min(200, $max));
    $msg = '';
    $updated = (int) ($push['updated'] ?? 0) + (int) ($dupPush['updated'] ?? 0);
    if ($updated > 0) {
        $msg = 'Se sincronizaron ' . $updated . ' cotización(es) a Bitrix.';
        if ((int) ($dupPush['updated'] ?? 0) > 0) {
            $msg .= ' Recotizadas en DUPLICADA RECOTIZADA: ' . (int) $dupPush['updated'] . '.';
        }
    } elseif (!empty($push['error'])) {
        $msg = (string) $push['error'];
    } elseif (!empty($dupPush['error'])) {
        $msg = (string) $dupPush['error'];
    } else {
        $msg = 'Nada pendiente: los estados del panel ya estaban en Bitrix.';
    }
    $failed = (int) ($push['failed'] ?? 0) + (int) ($dupPush['failed'] ?? 0);
    if ($failed > 0) {
        $msg .= ' Fallaron ' . $failed . '.';
    }
    json_out([
        'ok' => $updated > 0 || (!empty($push['ok']) && empty($dupPush['error'])),
        'message' => $msg,
        'push' => $push,
        'recotizadas_duplicada' => $dupPush,
    ]);
}

if ($action === 'resolve_quote_bitrix_deal') {
    global $asesoresFile;
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit'] ?? ''));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotización.'], 400);
    }
    global $quotesFile;
    $quotes = read_quotes($quotesFile);
    $idx = find_asesor_quote_index($quotes, $quoteId, $codigo);
    if ($idx === -2) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
    }
    if ($idx < 0) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }
    if (ensure_quote_seller_codigo_for_match($quotes[$idx])) {
        write_quotes($quotesFile, $quotes);
    }
    $owned = $quotes[$idx];
    $ensured = ensure_bitrix_deal_id_for_quote($owned);
    $dealId = !empty($ensured['deal_id']) ? (string) $ensured['deal_id'] : '';
    if ($dealId === '') {
        json_out([
            'ok' => false,
            'error' => trim((string) ($ensured['error'] ?? '')) ?: 'No se encontró la negociación en Bitrix para esta cotización.',
            'quote_id' => $quoteId,
            'bitrix_deal_id' => '',
        ], 404);
    }
    json_out([
        'ok' => true,
        'quote_id' => $quoteId,
        'bitrix_deal_id' => $dealId,
        'created' => !empty($ensured['created']),
    ]);
}

if ($action === 'marcar_cotizado_asesor') {
    global $asesoresFile, $quotesFile;
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit'] ?? ''));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotización.'], 400);
    }
    $quotesCheck = read_quotes($quotesFile);
    $ownIdx = find_asesor_quote_index($quotesCheck, $quoteId, $codigo);
    if ($ownIdx === -2) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
    }
    if ($ownIdx < 0) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }
    $quotes = read_quotes($quotesFile);
    $found = false;
    foreach ($quotes as &$q) {
        if (!is_array($q)) {
            continue;
        }
        if ((string) ($q['id'] ?? '') !== $quoteId) {
            continue;
        }
        $q['asesor_estado'] = 'cotizado';
        $q['asesor_cotizado_at'] = date('c');
        $q['asesor_cotizado_by'] = $codigo;
        $found = true;
        break;
    }
    unset($q);
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }
    if (!write_quotes($quotesFile, $quotes)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar.'], 500);
    }
    $bundle = get_quotes_for_asesor($codigo, 'all');
    json_out([
        'ok' => true,
        'message' => 'Cotización marcada como cotizada.',
        'quote_id' => $quoteId,
        'count_nuevas' => $bundle['count_nuevas'],
        'count_historial' => $bundle['count_historial'],
    ]);
}

if ($action === 'set_quote_estado' || $action === 'update_quote_estado') {
    global $asesoresFile, $quotesFile;
    $estado = normalize_quote_pipeline_estado($body['estado'] ?? ($body['asesor_estado'] ?? ''));
    if ($estado === '') {
        json_out(['ok' => false, 'error' => 'Estado inválido. Usa cotizado, pendiente, seguimiento, vendido, perdida o cerrado_modificado.'], 400);
    }
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotización.'], 400);
    }
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit_asesor'] ?? ($body['nit'] ?? '')));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'Solo el asesor puede cambiar el estado.'], 403);
    }
    $quotesCheck = read_quotes($quotesFile);
    $ownIdx = find_asesor_quote_index($quotesCheck, $quoteId, $codigo);
    if ($ownIdx === -2) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
    }
    if ($ownIdx < 0) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }

    $quotes = read_quotes($quotesFile);
    $found = false;
    $quoteForBitrix = null;
    foreach ($quotes as &$q) {
        if (!is_array($q) || (string) ($q['id'] ?? '') !== $quoteId) {
            continue;
        }
        if (quote_asesor_estado($q) === 'nueva') {
            json_out(['ok' => false, 'error' => 'Primero termina la cotización (Cotizar) para pasar al historial.'], 400);
        }
        $q['asesor_estado'] = $estado;
        $q['asesor_estado_at'] = date('c');
        $q['asesor_estado_by'] = $codigo;
        $quoteForBitrix = $q;
        $found = true;
        break;
    }
    unset($q);
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }
    if (!write_quotes($quotesFile, $quotes)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar.'], 500);
    }
    $cache = &quotes_memory_cache();
    $cache[quotes_cache_key($quotesFile)] = array_values($quotes);

    // Sincronizar columna del embudo Bitrix (COTIZACION / PENDIENTE / …).
    $bitrixSync = push_quote_estado_to_bitrix($quoteForBitrix, $estado);
    if (!empty($bitrixSync['ok'])) {
        // Marcar para que el push masivo no lo repita.
        $quotes = read_quotes($quotesFile);
        foreach ($quotes as &$qMark) {
            if (!is_array($qMark) || (string) ($qMark['id'] ?? '') !== $quoteId) {
                continue;
            }
            $qMark['asesor_estado_bitrix_stage'] = (string) ($bitrixSync['stage_id'] ?? '');
            $qMark['asesor_estado_bitrix_for'] = $estado;
            $qMark['asesor_estado_bitrix_at'] = date('c');
            break;
        }
        unset($qMark);
        write_quotes($quotesFile, $quotes);
        $cache = &quotes_memory_cache();
        $cache[quotes_cache_key($quotesFile)] = array_values($quotes);
    }

    $labels = [
        'cotizado' => 'Cotizado',
        'pendiente' => 'Pendiente',
        'seguimiento' => 'Seguimiento',
        'vendido' => 'Vendido',
        'perdida' => 'Perdida',
        'cerrado_modificado' => 'Cerrado Modificado',
    ];
    $message = 'Estado actualizado a ' . ($labels[$estado] ?? $estado) . '.';
    if (!empty($bitrixSync['ok'])) {
        $message .= ' Bitrix actualizado.';
    } elseif (empty($bitrixSync['skipped']) && !empty($bitrixSync['error'])) {
        $message .= ' (Panel OK; Bitrix no se movió: ' . $bitrixSync['error'] . ')';
    } elseif (!empty($bitrixSync['skipped']) && !empty($bitrixSync['error']) && stripos((string) $bitrixSync['error'], 'no tiene negociación') === false) {
        // Aviso útil si falta STAGE_ID en config; omitir si simplemente no hay deal.
        if (stripos((string) $bitrixSync['error'], 'STAGE_ID') !== false || stripos((string) $bitrixSync['error'], 'desactivado') !== false) {
            $message .= ' (' . $bitrixSync['error'] . ')';
        }
    }
    $bundle = get_quotes_for_asesor($codigo, 'all');
    json_out([
        'ok' => true,
        'message' => $message,
        'quote_id' => $quoteId,
        'asesor_estado' => $estado,
        'bitrix_sync' => $bitrixSync,
        'count_nuevas' => $bundle['count_nuevas'],
        'count_historial' => $bundle['count_historial'],
    ]);
}

if ($action === 'set_quote_comentario' || $action === 'update_quote_comentario') {
    global $asesoresFile, $quotesFile;
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotización.'], 400);
    }
    $comentario = trim((string) ($body['comentario'] ?? ($body['asesor_comentario'] ?? '')));
    if (mb_strlen($comentario) > 2000) {
        json_out(['ok' => false, 'error' => 'El comentario no puede superar 2000 caracteres.'], 400);
    }
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit_asesor'] ?? ($body['nit'] ?? '')));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'Solo el asesor puede guardar el comentario.'], 403);
    }
    $quotesCheck = read_quotes($quotesFile);
    $ownIdx = find_asesor_quote_index($quotesCheck, $quoteId, $codigo);
    if ($ownIdx === -2) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
    }
    if ($ownIdx < 0) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }

    $quotes = read_quotes($quotesFile);
    $found = false;
    $savedAt = date('c');
    foreach ($quotes as &$q) {
        if (!is_array($q) || (string) ($q['id'] ?? '') !== $quoteId) {
            continue;
        }
        $q['asesor_comentario'] = $comentario;
        $q['asesor_comentario_at'] = $savedAt;
        $q['asesor_comentario_by'] = $codigo;
        $found = true;
        break;
    }
    unset($q);
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }
    if (!write_quotes($quotesFile, $quotes)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar.'], 500);
    }
    json_out([
        'ok' => true,
        'message' => $comentario !== '' ? 'Comentario guardado.' : 'Comentario eliminado.',
        'quote_id' => $quoteId,
        'asesor_comentario' => $comentario,
        'asesor_comentario_at' => $savedAt,
        'asesor_comentario_by' => $codigo,
    ]);
}

if ($action === 'set_quote_fecha_cierre' || $action === 'update_quote_fecha_cierre') {
    global $asesoresFile, $quotesFile;
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotización.'], 400);
    }
    $fecha = trim((string) ($body['fecha_cierre'] ?? ($body['fechaCierre'] ?? '')));
    if ($fecha !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
        json_out(['ok' => false, 'error' => 'Fecha de cierre inválida. Usa AAAA-MM-DD.'], 400);
    }
    [$codigo, $asesor] = resolve_asesor_or_zkteco($body);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'Solo el asesor puede definir la fecha de cierre.'], 403);
    }
    $quotesCheck = read_quotes($quotesFile);
    $ownIdx = find_asesor_quote_index($quotesCheck, $quoteId, $codigo);
    if ($ownIdx === -2) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
    }
    if ($ownIdx < 0) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }

    $quotes = read_quotes($quotesFile);
    $found = false;
    $savedAt = date('c');
    foreach ($quotes as &$q) {
        if (!is_array($q) || (string) ($q['id'] ?? '') !== $quoteId) {
            continue;
        }
        if (quote_asesor_estado($q) === 'nueva') {
            json_out(['ok' => false, 'error' => 'Primero termina la cotización para definir fecha de cierre.'], 400);
        }
        $q['fecha_cierre'] = $fecha;
        $q['fecha_cierre_at'] = $savedAt;
        $q['fecha_cierre_by'] = $codigo;
        $found = true;
        break;
    }
    unset($q);
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }
    if (!write_quotes($quotesFile, $quotes)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar.'], 500);
    }
    json_out([
        'ok' => true,
        'message' => $fecha !== '' ? 'Fecha de cierre guardada.' : 'Fecha de cierre eliminada.',
        'quote_id' => $quoteId,
        'fecha_cierre' => $fecha,
        'fecha_cierre_at' => $savedAt,
        'fecha_cierre_by' => $codigo,
    ]);
}

if ($action === 'set_quote_flete' || $action === 'update_quote_flete') {
    global $asesoresFile, $quotesFile;
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotización.'], 400);
    }
    $rawFlete = $body['flete_antes_iva'] ?? ($body['fleteAntesIva'] ?? ($body['flete'] ?? null));
    if ($rawFlete === null || $rawFlete === '') {
        json_out(['ok' => false, 'error' => 'Falta el valor del flete.'], 400);
    }
    if (is_string($rawFlete)) {
        $rawFlete = str_replace(['$', ' ', 'COP', 'cop'], '', $rawFlete);
        if (strpos($rawFlete, ',') !== false && strpos($rawFlete, '.') !== false) {
            $rawFlete = str_replace('.', '', $rawFlete);
            $rawFlete = str_replace(',', '.', $rawFlete);
        } else {
            $rawFlete = str_replace(',', '.', $rawFlete);
        }
    }
    if (!is_numeric($rawFlete)) {
        json_out(['ok' => false, 'error' => 'Flete inválido.'], 400);
    }
    $fleteAntes = (float) $rawFlete;
    if ($fleteAntes < 0) {
        json_out(['ok' => false, 'error' => 'Flete inválido.'], 400);
    }

    $rawIva = $body['flete_iva'] ?? ($body['fleteIva'] ?? null);
    $fleteIva = null;
    if ($rawIva !== null && $rawIva !== '') {
        if (is_string($rawIva)) {
            $rawIva = str_replace(['$', ' ', 'COP', 'cop'], '', $rawIva);
            if (strpos($rawIva, ',') !== false && strpos($rawIva, '.') !== false) {
                $rawIva = str_replace('.', '', $rawIva);
                $rawIva = str_replace(',', '.', $rawIva);
            } else {
                $rawIva = str_replace(',', '.', $rawIva);
            }
        }
        if (!is_numeric($rawIva)) {
            json_out(['ok' => false, 'error' => 'IVA de flete inválido.'], 400);
        }
        $fleteIva = (float) $rawIva;
        if ($fleteIva < 0) {
            json_out(['ok' => false, 'error' => 'IVA de flete inválido.'], 400);
        }
    }
    if ($fleteIva === null) {
        $fleteIva = $fleteAntes * 0.19;
    }

    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit_asesor'] ?? ($body['nit'] ?? '')));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'Solo el asesor puede editar el flete.'], 403);
    }
    $quotesCheck = read_quotes($quotesFile);
    $ownIdx = find_asesor_quote_index($quotesCheck, $quoteId, $codigo);
    if ($ownIdx === -2) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
    }
    if ($ownIdx < 0) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }

    $quotes = read_quotes($quotesFile);
    $found = false;
    $savedAt = date('c');
    $outTotals = [];
    foreach ($quotes as &$q) {
        if (!is_array($q) || (string) ($q['id'] ?? '') !== $quoteId) {
            continue;
        }
        $totals = is_array($q['totals'] ?? null) ? $q['totals'] : [];
        $subtotal = isset($totals['totalSinFlete']) ? (float) $totals['totalSinFlete'] : null;
        if ($subtotal === null || !is_finite($subtotal) || $subtotal < 0) {
            $subtotal = 0.0;
            foreach ((is_array($q['items'] ?? null) ? $q['items'] : []) as $it) {
                if (!is_array($it)) {
                    continue;
                }
                if (isset($it['totalCopIva']) && is_numeric($it['totalCopIva'])) {
                    $subtotal += (float) $it['totalCopIva'];
                }
            }
        }
        $totals['totalSinFlete'] = $subtotal;
        $totals['fleteAntesIva'] = $fleteAntes;
        $totals['fleteIva'] = $fleteIva;
        $totals['totalConFlete'] = $subtotal + $fleteAntes + $fleteIva;
        $q['totals'] = $totals;
        $q['flete_editado_at'] = $savedAt;
        $q['flete_editado_by'] = $codigo;
        $outTotals = $totals;
        $found = true;
        break;
    }
    unset($q);
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }
    if (!write_quotes($quotesFile, $quotes)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el flete.'], 500);
    }
    json_out([
        'ok' => true,
        'message' => 'Flete guardado.',
        'quote_id' => $quoteId,
        'flete_antes_iva' => $fleteAntes,
        'flete_iva' => $fleteIva,
        'totals' => $outTotals,
        'flete_editado_at' => $savedAt,
        'flete_editado_by' => $codigo,
    ]);
}

if ($action === 'set_quote_empresa' || $action === 'update_quote_empresa') {
    global $asesoresFile, $quotesFile;
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotización.'], 400);
    }
    $empresa = trim((string) ($body['empresa'] ?? ''));
    if ($empresa === '') {
        json_out(['ok' => false, 'error' => 'Falta la empresa.'], 400);
    }
    if (!preg_match('/VALTECH|IZC/i', $empresa)) {
        json_out(['ok' => false, 'error' => 'Empresa no válida.'], 400);
    }
    if (preg_match('/VALTECH/i', $empresa)) {
        $empresa = 'VALTECH MAYORISTA S.A.S.';
    } else {
        $empresa = 'IZC MAYORISTA S.A.S.';
    }

    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit_asesor'] ?? ($body['nit'] ?? '')));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'Solo el asesor puede editar la empresa.'], 403);
    }
    $quotesCheck = read_quotes($quotesFile);
    $ownIdx = find_asesor_quote_index($quotesCheck, $quoteId, $codigo);
    if ($ownIdx === -2) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
    }
    if ($ownIdx < 0) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }

    $quotes = read_quotes($quotesFile);
    $found = false;
    $savedAt = date('c');
    foreach ($quotes as &$q) {
        if (!is_array($q) || (string) ($q['id'] ?? '') !== $quoteId) {
            continue;
        }
        $totals = is_array($q['totals'] ?? null) ? $q['totals'] : [];
        $totals['empresa'] = $empresa;
        $q['totals'] = $totals;
        $q['empresa'] = $empresa;
        $q['empresa_editado_at'] = $savedAt;
        $q['empresa_editado_by'] = $codigo;
        $found = true;
        break;
    }
    unset($q);
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }
    if (!write_quotes($quotesFile, $quotes)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar la empresa.'], 500);
    }
    json_out([
        'ok' => true,
        'message' => 'Empresa actualizada.',
        'quote_id' => $quoteId,
        'empresa' => $empresa,
        'empresa_editado_at' => $savedAt,
        'empresa_editado_by' => $codigo,
    ]);
}

if ($action === 'delete_quote_asesor' || $action === 'hide_quote_asesor') {
    global $asesoresFile, $quotesFile;
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta el id de la cotización.'], 400);
    }
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit_asesor'] ?? ($body['nit'] ?? '')));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'Solo el asesor puede eliminar cotizaciones de su panel.'], 403);
    }

    $nitSet = asesor_nit_variants_set($codigo);
    $bitrixIds = [];
    foreach (get_asesor_bitrix_ids($codigo) as $id) {
        $bitrixIds[(string) $id] = true;
    }

    $quotes = read_quotes($quotesFile);
    $found = false;
    $savedAt = date('c');
    foreach ($quotes as &$q) {
        if (!is_array($q) || (string) ($q['id'] ?? '') !== $quoteId) {
            continue;
        }
        if (!quote_matches_asesor($q, $codigo, $nitSet, $bitrixIds)) {
            json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
        }
        if (!empty($q['asesor_eliminada'])) {
            json_out(['ok' => true, 'message' => 'La cotización ya no aparece en tu historial.', 'quote_id' => $quoteId]);
        }
        $q['asesor_eliminada'] = true;
        $q['asesor_eliminada_at'] = $savedAt;
        $q['asesor_eliminada_by'] = $codigo;
        $found = true;
        break;
    }
    unset($q);
    if (!$found) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }
    if (!write_quotes($quotesFile, $quotes)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar.'], 500);
    }
    json_out([
        'ok' => true,
        'message' => 'Cotización eliminada de tu historial. Sigue visible para el administrador.',
        'quote_id' => $quoteId,
        'asesor_eliminada_at' => $savedAt,
        'asesor_eliminada_by' => $codigo,
    ]);
}

function quote_belongs_to_asesor($quote, $codigo, $nitSet = null, $bitrixIds = null) {
    if (!is_array($quote)) {
        return false;
    }
    $code = normalize_asesor_codigo($codigo);
    if ($nitSet === null || $bitrixIds === null) {
        $nitSet = asesor_nit_variants_set($code);
        $bitrixIds = [];
        foreach (get_asesor_bitrix_ids($code) as $id) {
            $bitrixIds[(string) $id] = true;
        }
    }
    return quote_matches_asesor($quote, $code, $nitSet, $bitrixIds);
}

/** Respuesta Bitrix para finish_quote_asesor: no bloquea; sync en segundo plano. */
function finish_quote_bitrix_response($quote) {
    global $bitrixFile;
    $existing = trim((string) ($quote['bitrix_deal_id'] ?? ''));
    if ($existing !== '') {
        return [
            'ok' => true,
            'skipped' => false,
            'pending' => false,
            'deal_id' => $existing,
            'from_cache' => true,
        ];
    }
    $cfg = read_bitrix($bitrixFile);
    if (empty($cfg['enabled'])) {
        return ['ok' => false, 'skipped' => true, 'pending' => false, 'error' => 'Bitrix desactivado.'];
    }
    if ($cfg['webhook_base'] === '' || $cfg['stage_id'] === '') {
        return ['ok' => false, 'skipped' => true, 'pending' => false, 'error' => 'Falta webhook o STAGE_ID de Bitrix.'];
    }
    return [
        'ok' => false,
        'skipped' => false,
        'pending' => true,
        'error' => '',
    ];
}

if ($action === 'finish_quote_asesor') {
    global $asesoresFile, $quotesFile;
    @set_time_limit(180);
    [$codigo, $asesor, $isZkteco] = resolve_asesor_or_zkteco($body);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $quoteId = trim((string) ($body['quote_id'] ?? ($body['id'] ?? '')));
    $clientNit = normalize_nit($body['client_nit'] ?? ($body['nit'] ?? ''));
    $clientNombre = trim((string) ($body['nombre'] ?? ''));
    $items = $body['items'] ?? [];
    if (!is_array($items) || count($items) === 0) {
        json_out(['ok' => false, 'error' => 'La cotización no tiene productos.'], 400);
    }
    // Marcar productos manuales creados por el asesor.
    $lpSkus = asesor_lp_sku_set();
    $nowIso = date('c');
    foreach ($items as &$itMark) {
        if (!is_array($itMark)) {
            continue;
        }
        if (quote_item_is_created_product($itMark, $lpSkus)) {
            $itMark['custom'] = true;
            if (empty($itMark['created_by'])) {
                $itMark['created_by'] = $codigo;
            }
            $itMark['created_at'] = izc_datetime_bogota(
                !empty($itMark['created_at']) ? (string) $itMark['created_at'] : $nowIso,
                $quoteId
            );
        }
    }
    unset($itMark);
    if ($isZkteco) {
        if ($clientNit === '' || is_zkteco_login_id($clientNit)) {
            $clientNit = '';
        }
        if ($clientNombre === '' || is_zkteco_login_id($clientNombre) || strcasecmp($clientNombre, 'ZKTeco') === 0) {
            $clientNombre = '';
        }
    } else {
        if ($clientNit === '') {
            json_out(['ok' => false, 'error' => 'Falta el NIT del cliente.'], 400);
        }
        if (is_zkteco_login_id($clientNit)) {
            json_out(['ok' => false, 'error' => 'ZKTeco no es un cliente.'], 400);
        }
    }

    $sellerAssigned = null;
    $sellerName = trim((string) ($asesor['nombre'] ?? ''));
    if ($isZkteco) {
        $sellerName = $sellerName !== '' ? $sellerName : 'ZKTeco';
    } else {
        $ids = get_asesor_bitrix_ids($codigo);
        if ($ids) {
            $sellerAssigned = (string) $ids[0];
            $map = bitrix_seller_map();
            if (isset($map[$sellerAssigned]) && trim((string) $map[$sellerAssigned]) !== '') {
                $sellerName = trim((string) $map[$sellerAssigned]);
            }
        }
        if (!$sellerAssigned) {
            json_out([
                'ok' => false,
                'error' => 'Tu código de asesor (' . $codigo . ') no tiene ID de Bitrix. No se puede subir la cotización sin responsable correcto.',
            ], 400);
        }
    }

    $quotes = read_quotes($quotesFile);
    $updatedQuote = null;
    // Cotizar desde "Cotizaciones Cliente" debe actualizar esa fila (pasa a Historial).
    // Si el cotizador perdió el quote_id, adoptar la pendiente del mismo NIT.
    if ($quoteId === '' && !$isZkteco && $clientNit !== '') {
        $quoteId = find_latest_cliente_nueva_quote_id($quotes, $codigo, $clientNit);
    }
    $isNew = ($quoteId === '');

    $dealFromBody = trim((string) ($body['bitrix_deal_id'] ?? ''));
    if ($dealFromBody !== '' && !is_likely_bitrix_deal_id($dealFromBody)) {
        $dealFromBody = '';
    }

    if ($isNew) {
        if (!$isZkteco) {
            if (!asesor_nit_belongs_to_vendedor($codigo, $clientNit)) {
                json_out(['ok' => false, 'error' => 'Este cliente no está asignado a tu código de vendedor. Regístralo en el panel para poder cotizar.'], 403);
            }
        }
        if ($clientNombre === '') {
            $clientNombre = $clientNit;
        }
        $idTail = $clientNit !== '' ? $clientNit : ($isZkteco ? 'ZKTECO' : 'SINNIT');
        $quoteId = date('YmdHis') . substr((string) microtime(true), -6) . '-' . $idTail;
        $dupFrom = trim((string) ($body['duplicated_from'] ?? ($body['recotizado_desde'] ?? '')));
        $updatedQuote = [
            'id' => $quoteId,
            'nit' => $clientNit,
            'nombre' => $clientNombre,
            'created_at' => date('c'),
            'trm' => $body['trm'] ?? null,
            'empresa' => trim((string) ($body['empresa'] ?? '')),
            'items' => $items,
            'totals' => is_array($body['totals'] ?? null) ? $body['totals'] : [],
            'seller_codigo' => $codigo,
            'assigned_by_id' => $sellerAssigned,
            'seller_name' => $sellerName,
            'asesor_estado' => 'cotizado',
            'asesor_cotizado_at' => date('c'),
            'asesor_cotizado_by' => $codigo,
            'quote_source' => $isZkteco ? 'zkteco' : 'asesor',
            'finished_at' => date('c'),
        ];
        $fleteName = trim((string) ($body['flete'] ?? ''));
        if ($fleteName === '' && is_array($updatedQuote['totals'])) {
            $tf = $updatedQuote['totals']['flete'] ?? '';
            if (is_array($tf)) {
                $fleteName = trim((string) ($tf['label'] ?? ($tf['id'] ?? '')));
            } else {
                $fleteName = trim((string) $tf);
            }
        }
        if ($fleteName !== '') {
            $updatedQuote['flete'] = $fleteName;
            if (is_array($updatedQuote['totals']) && (empty($updatedQuote['totals']['flete']) || is_array($updatedQuote['totals']['flete']))) {
                $updatedQuote['totals']['flete'] = $fleteName;
            }
        }
        if ($dealFromBody !== '') {
            $updatedQuote['bitrix_deal_id'] = $dealFromBody;
        }
        $fechaCierreNew = trim((string) ($body['fecha_cierre'] ?? ($body['fechaCierre'] ?? '')));
        if ($fechaCierreNew !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $fechaCierreNew)) {
            $updatedQuote['fecha_cierre'] = $fechaCierreNew;
            $updatedQuote['fecha_cierre_at'] = date('c');
            $updatedQuote['fecha_cierre_by'] = $codigo;
        }
        if ($dupFrom !== '') {
            $updatedQuote['duplicated_from'] = $dupFrom;
            $updatedQuote['recotizado_desde'] = $dupFrom;
            $updatedQuote['is_duplicated'] = true;
            $updatedQuote['recotizado_at'] = date('c');
            $updatedQuote['recotizado_by'] = $codigo;
        }
        $quotes[] = $updatedQuote;
    } else {
        $nitSet = asesor_nit_variants_set($codigo);
        $bitrixIds = [];
        foreach (get_asesor_bitrix_ids($codigo) as $id) {
            $bitrixIds[(string) $id] = true;
        }
        $found = false;
        foreach ($quotes as &$q) {
            if (!is_array($q) || (string) ($q['id'] ?? '') !== $quoteId) {
                continue;
            }
            if (!quote_matches_asesor($q, $codigo, $nitSet, $bitrixIds)) {
                json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
            }
            if ($clientNit !== '') {
                $q['nit'] = $clientNit;
            }
            if ($clientNombre !== '') {
                $q['nombre'] = $clientNombre;
            }
            $q['trm'] = $body['trm'] ?? null;
            $q['empresa'] = trim((string) ($body['empresa'] ?? ''));
            $q['items'] = $items;
            $q['totals'] = is_array($body['totals'] ?? null) ? $body['totals'] : [];
            $fleteNameUpd = trim((string) ($body['flete'] ?? ''));
            if ($fleteNameUpd === '' && is_array($q['totals'])) {
                $tf = $q['totals']['flete'] ?? '';
                if (is_array($tf)) {
                    $fleteNameUpd = trim((string) ($tf['label'] ?? ($tf['id'] ?? '')));
                } else {
                    $fleteNameUpd = trim((string) $tf);
                }
            }
            if ($fleteNameUpd !== '') {
                $q['flete'] = $fleteNameUpd;
                if (is_array($q['totals'])) {
                    $q['totals']['flete'] = $fleteNameUpd;
                }
            }
            $q['seller_codigo'] = $codigo;
            $q['assigned_by_id'] = $sellerAssigned;
            $q['seller_name'] = $sellerName;
            $q['asesor_estado'] = 'cotizado';
            $q['asesor_cotizado_at'] = date('c');
            $q['asesor_cotizado_by'] = $codigo;
            $q['quote_source'] = $isZkteco ? 'zkteco' : 'asesor';
            $q['finished_at'] = date('c');
            if ($dealFromBody !== '') {
                $q['bitrix_deal_id'] = $dealFromBody;
            }
            $fechaCierreUpd = trim((string) ($body['fecha_cierre'] ?? ($body['fechaCierre'] ?? '')));
            if ($fechaCierreUpd === '') {
                // Permitir limpiar la fecha si el asesor la borra al terminar.
                if (array_key_exists('fecha_cierre', $body) || array_key_exists('fechaCierre', $body)) {
                    $q['fecha_cierre'] = '';
                    $q['fecha_cierre_at'] = date('c');
                    $q['fecha_cierre_by'] = $codigo;
                }
            } elseif (preg_match('/^\d{4}-\d{2}-\d{2}$/', $fechaCierreUpd)) {
                $q['fecha_cierre'] = $fechaCierreUpd;
                $q['fecha_cierre_at'] = date('c');
                $q['fecha_cierre_by'] = $codigo;
            }
            $dupFrom = trim((string) ($body['duplicated_from'] ?? ($body['recotizado_desde'] ?? '')));
            if ($dupFrom === '') {
                $dupFrom = trim((string) ($q['duplicated_from'] ?? ($q['recotizado_desde'] ?? '')));
            }
            if ($dupFrom !== '') {
                $q['duplicated_from'] = $dupFrom;
                $q['recotizado_desde'] = $dupFrom;
                $q['is_duplicated'] = true;
                $q['recotizado_at'] = date('c');
                $q['recotizado_by'] = $codigo;
            }
            $updatedQuote = $q;
            $found = true;
            break;
        }
        unset($q);
        if (!$found) {
            json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
        }
    }

    if (!write_quotes($quotesFile, $quotes)) {
        json_out(['ok' => false, 'error' => quotes_write_fail_message()], 500);
    }

    // Bitrix: crear N° en modo rápido (sin productos/observadores) para devolverlo al instante.
    $existingDeal = trim((string) ($updatedQuote['bitrix_deal_id'] ?? ''));
    if ($isZkteco && ($existingDeal === '' || !is_likely_bitrix_deal_id($existingDeal))) {
        $bitrix = ['ok' => true, 'skipped' => true, 'pending' => false, 'deal_id' => ''];
    } elseif ($existingDeal !== '' && is_likely_bitrix_deal_id($existingDeal)) {
        $bitrix = [
            'ok' => true,
            'skipped' => false,
            'pending' => false,
            'deal_id' => $existingDeal,
            'from_cache' => true,
        ];
        // Recotizada: mover el deal existente a DUPLICADA RECOTIZADA.
        if (quote_is_advisor_recotizada($updatedQuote) || quote_in_duplicadas_panel($updatedQuote)) {
            try {
                push_quote_estado_to_bitrix($updatedQuote, 'cotizado');
            } catch (Throwable $eMove) { /* ignore */ }
        }
    } else {
        $bitrix = ['ok' => false, 'skipped' => false, 'pending' => true, 'error' => ''];
        try {
            $created = send_bitrix_deal($updatedQuote, true);
            if (!empty($created['ok']) && !empty($created['deal_id']) && is_likely_bitrix_deal_id($created['deal_id'])) {
                $dealId = (string) $created['deal_id'];
                $updatedQuote['bitrix_deal_id'] = $dealId;
                $bitrix = array_merge($created, ['pending' => false]);
                // Persistir N° ya (el PDF lo necesita).
                $quotes = read_quotes($quotesFile);
                foreach ($quotes as &$qPersist) {
                    if (!is_array($qPersist) || (string) ($qPersist['id'] ?? '') !== $quoteId) {
                        continue;
                    }
                    $qPersist['bitrix_deal_id'] = $dealId;
                    break;
                }
                unset($qPersist);
                write_quotes($quotesFile, $quotes);
            } else {
                $bitrix = [
                    'ok' => false,
                    'skipped' => !empty($created['skipped']),
                    'pending' => true,
                    'error' => (string) ($created['error'] ?? 'No se pudo crear N° Bitrix.'),
                ];
            }
        } catch (Throwable $eBx) {
            $bitrix = [
                'ok' => false,
                'skipped' => false,
                'pending' => true,
                'error' => 'Bitrix: ' . $eBx->getMessage(),
            ];
        }
    }

    try {
        register_created_products_from_quote($updatedQuote);
    } catch (Throwable $e) { /* ignore */ }

    $message = 'Cotizacion guardada';

    json_out([
        'ok' => true,
        'message' => $message,
        'quote_id' => $quoteId,
        'bitrix' => $bitrix,
        'bitrix_deal_id' => (string) ($bitrix['deal_id'] ?? ($updatedQuote['bitrix_deal_id'] ?? '')),
        'is_duplicated' => quote_is_duplicated($updatedQuote ?? []),
        'duplicated_from' => (string) (($updatedQuote['duplicated_from'] ?? '') ?: ($updatedQuote['recotizado_desde'] ?? '')),
    ]);
}

if ($action === 'reserve_bitrix_deal_asesor') {
    global $asesoresFile, $bitrixFile;
    [$codigo, $asesor, $isZkteco] = resolve_asesor_or_zkteco($body);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if ($isZkteco) {
        json_out(['ok' => true, 'deal_id' => '', 'skipped' => true]);
    }
    $clientNit = normalize_nit($body['client_nit'] ?? ($body['nit'] ?? ''));
    $clientNombre = trim((string) ($body['nombre'] ?? ''));
    if ($clientNit === '') {
        json_out(['ok' => false, 'error' => 'Falta el NIT del cliente.'], 400);
    }
    $existingDeal = trim((string) ($body['bitrix_deal_id'] ?? ''));
    if ($existingDeal !== '' && is_likely_bitrix_deal_id($existingDeal)) {
        json_out(['ok' => true, 'deal_id' => $existingDeal, 'from_cache' => true]);
    }
    $sellerAssigned = null;
    $sellerName = trim((string) ($asesor['nombre'] ?? ''));
    $ids = get_asesor_bitrix_ids($codigo);
    if ($ids) {
        $sellerAssigned = (string) $ids[0];
        $map = bitrix_seller_map();
        if (isset($map[$sellerAssigned]) && trim((string) $map[$sellerAssigned]) !== '') {
            $sellerName = trim((string) $map[$sellerAssigned]);
        }
    }
    if (!$sellerAssigned) {
        json_out(['ok' => false, 'error' => 'Asesor sin ID Bitrix mapeado.'], 400);
    }
    $draftId = trim((string) ($body['quote_id'] ?? ''));
    if ($draftId === '') {
        $draftId = 'pending-' . $codigo . '-' . $clientNit . '-' . date('YmdHis');
    }
    $draft = [
        'id' => $draftId,
        'nit' => $clientNit,
        'nombre' => $clientNombre !== '' ? $clientNombre : $clientNit,
        'seller_codigo' => $codigo,
        'assigned_by_id' => $sellerAssigned,
        'seller_name' => $sellerName,
        'quote_source' => 'asesor',
        'empresa' => trim((string) ($body['empresa'] ?? '')),
        'items' => [],
        'totals' => [],
    ];
    try {
        $created = send_bitrix_deal($draft, true);
    } catch (Throwable $e) {
        json_out(['ok' => false, 'error' => 'Bitrix: ' . $e->getMessage()], 500);
    }
    $dealId = !empty($created['deal_id']) ? (string) $created['deal_id'] : '';
    if ($dealId === '' || !is_likely_bitrix_deal_id($dealId)) {
        json_out([
            'ok' => false,
            'error' => (string) ($created['error'] ?? 'No se pudo reservar N° Bitrix.'),
        ], 500);
    }
    json_out([
        'ok' => true,
        'deal_id' => $dealId,
        'draft_id' => $draftId,
        'quick' => true,
    ]);
}

if ($action === 'sync_bitrix_quote') {
    global $asesoresFile, $quotesFile;
    @set_time_limit(120);
    [$codigo, $asesor, $isZkteco] = resolve_asesor_or_zkteco($body);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if ($isZkteco) {
        json_out(['ok' => true, 'skipped' => true, 'bitrix' => ['ok' => true, 'skipped' => true, 'deal_id' => '']]);
    }
    $quoteId = trim((string) ($body['quote_id'] ?? ''));
    if ($quoteId === '') {
        json_out(['ok' => false, 'error' => 'Falta quote_id.'], 400);
    }

    $quotes = read_quotes($quotesFile);
    $nitSet = asesor_nit_variants_set($codigo);
    $bitrixIds = [];
    foreach (get_asesor_bitrix_ids($codigo) as $id) {
        $bitrixIds[(string) $id] = true;
    }
    $quote = null;
    $quoteIdx = -1;
    foreach ($quotes as $i => $q) {
        if (!is_array($q) || (string) ($q['id'] ?? '') !== $quoteId) {
            continue;
        }
        if (!quote_matches_asesor($q, $codigo, $nitSet, $bitrixIds)) {
            json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
        }
        $quote = $q;
        $quoteIdx = $i;
        break;
    }
    if (!$quote || $quoteIdx < 0) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
    }

    $existing = trim((string) ($quote['bitrix_deal_id'] ?? ''));
    if ($existing !== '') {
        // Completar título/productos si el deal se creó en modo rápido al terminar.
        $completed = ['ok' => true, 'deal_id' => $existing, 'from_cache' => true];
        try {
            $completed = complete_bitrix_deal_extras($quote, $existing);
            if (empty($completed['ok'])) {
                $completed = [
                    'ok' => true,
                    'deal_id' => $existing,
                    'from_cache' => true,
                    'complete_error' => (string) ($completed['error'] ?? ''),
                ];
            } else {
                $completed['from_cache'] = true;
            }
        } catch (Throwable $eDone) {
            $completed = [
                'ok' => true,
                'deal_id' => $existing,
                'from_cache' => true,
                'complete_error' => $eDone->getMessage(),
            ];
        }
        json_out([
            'ok' => true,
            'quote_id' => $quoteId,
            'bitrix' => array_merge($completed, ['pending' => false]),
        ]);
    }

    $bitrix = ['ok' => false, 'skipped' => true, 'error' => 'Bitrix no ejecutado.'];
    try {
        $bitrix = send_bitrix_deal($quote);
    } catch (Throwable $e) {
        $bitrix = ['ok' => false, 'skipped' => false, 'error' => 'Bitrix: ' . $e->getMessage()];
    }

    if (!empty($bitrix['ok']) && !empty($bitrix['deal_id'])) {
        $quotes[$quoteIdx]['bitrix_deal_id'] = (string) $bitrix['deal_id'];
        if (!empty($quote['assigned_by_id'])) {
            $quotes[$quoteIdx]['assigned_by_id'] = (string) $quote['assigned_by_id'];
            $quotes[$quoteIdx]['seller_codigo'] = normalize_asesor_codigo($quote['seller_codigo'] ?? $codigo);
            if (!empty($quote['seller_name'])) {
                $quotes[$quoteIdx]['seller_name'] = (string) $quote['seller_name'];
            }
        }
        write_quotes($quotesFile, $quotes);
    }

    json_out([
        'ok' => !empty($bitrix['ok']),
        'quote_id' => $quoteId,
        'bitrix' => array_merge($bitrix, ['pending' => false]),
        'error' => (string) ($bitrix['error'] ?? ''),
    ]);
}

if ($action === 'list') {
    global $asesoresFile;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $asesorNombreByCodigo = [];
    foreach (read_asesores($asesoresFile) as $a) {
        if (!is_array($a)) {
            continue;
        }
        $code = normalize_asesor_codigo($a['codigo'] ?? ($a['nit'] ?? ''));
        if ($code === '') {
            continue;
        }
        $nm = trim((string) ($a['nombre'] ?? ''));
        $asesorNombreByCodigo[$code] = $nm !== '' ? $nm : $code;
    }

    $byNit = [];
    foreach (read_users($usersFile) as $u) {
        if (!is_array($u)) {
            continue;
        }
        $nit = normalize_nit($u['nit'] ?? '');
        if ($nit === '') {
            continue;
        }
        $role = strtolower(trim((string) ($u['role'] ?? '')));
        if (is_zkteco_login_id($nit) || is_sat_login_id($nit) || $role === 'zkteco' || $role === 'zebra' || $role === 'asesor' || $role === 'sat') {
            continue;
        }
        if (is_admin_nit($nit) || $role === 'admin') {
            continue;
        }
        $contactoNombre = trim((string) ($u['contacto_nombre'] ?? ($u['nombre_contacto'] ?? '')));
        $contactoTel = normalize_telefono_display($u['contacto_telefono'] ?? ($u['telefono_contacto'] ?? ($u['telefono'] ?? '')));
        $byNit[$nit] = [
            'nit' => $nit,
            'nombre' => trim((string) ($u['nombre'] ?? '')) ?: $nit,
            'contacto_nombre' => $contactoNombre,
            'contacto_telefono' => $contactoTel,
            'telefono' => $contactoTel,
            'created_at' => (string) ($u['created_at'] ?? ''),
            'origen' => 'portal',
            'vendedor_codigo' => '',
            'vendedor_nombre' => '',
            'vendedor' => '',
        ];
    }

    $manual = read_asesor_clientes_manual();
    foreach (($manual['by_codigo'] ?? []) as $codigoRaw => $list) {
        $codigo = normalize_asesor_codigo($codigoRaw);
        if ($codigo === '' || !is_array($list)) {
            continue;
        }
        $vendedorNombre = $asesorNombreByCodigo[$codigo] ?? $codigo;
        $vendedorLabel = ($vendedorNombre !== '' && $vendedorNombre !== $codigo)
            ? ($codigo . ' - ' . $vendedorNombre)
            : $codigo;
        foreach ($list as $c) {
            if (!is_array($c)) {
                continue;
            }
            $nit = normalize_nit($c['nit'] ?? '');
            if ($nit === '') {
                continue;
            }
            $nombre = trim((string) ($c['nombre'] ?? ''));
            $created = (string) ($c['created_at'] ?? ($c['updated_at'] ?? ''));
            if (!isset($byNit[$nit])) {
                $byNit[$nit] = [
                    'nit' => $nit,
                    'nombre' => $nombre !== '' ? $nombre : $nit,
                    'contacto_nombre' => '',
                    'contacto_telefono' => '',
                    'telefono' => '',
                    'created_at' => $created,
                    'origen' => 'asesor',
                    'vendedor_codigo' => $codigo,
                    'vendedor_nombre' => $vendedorNombre,
                    'vendedor' => $vendedorLabel,
                ];
            } else {
                if (($byNit[$nit]['nombre'] === '' || $byNit[$nit]['nombre'] === $nit) && $nombre !== '') {
                    $byNit[$nit]['nombre'] = $nombre;
                }
                if ($byNit[$nit]['created_at'] === '' && $created !== '') {
                    $byNit[$nit]['created_at'] = $created;
                }
                $byNit[$nit]['origen'] = $byNit[$nit]['origen'] === 'portal' ? 'portal+asesor' : 'asesor';
                $byNit[$nit]['vendedor_codigo'] = $codigo;
                $byNit[$nit]['vendedor_nombre'] = $vendedorNombre;
                $byNit[$nit]['vendedor'] = $vendedorLabel;
            }
        }
    }

    foreach ($byNit as $nit => &$row) {
        if (trim((string) ($row['vendedor_codigo'] ?? '')) !== '') {
            continue;
        }
        $codigo = find_asesor_codigo_by_client_nit($nit);
        if ($codigo === '') {
            $row['vendedor'] = '';
            continue;
        }
        $vendedorNombre = $asesorNombreByCodigo[$codigo] ?? $codigo;
        $row['vendedor_codigo'] = $codigo;
        $row['vendedor_nombre'] = $vendedorNombre;
        $row['vendedor'] = ($vendedorNombre !== '' && $vendedorNombre !== $codigo)
            ? ($codigo . ' - ' . $vendedorNombre)
            : $codigo;
    }
    unset($row);

    $safe = array_values($byNit);
    usort($safe, function ($a, $b) {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    json_out(['ok' => true, 'users' => $safe, 'count' => count($safe)]);
}

if ($action === 'delete') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $nit = normalize_nit($body['nit'] ?? '');
    if ($nit === '' || !preg_match('/^\d{6,15}(-\d)?$/', $nit)) {
        json_out(['ok' => false, 'error' => 'NIT inválido.'], 400);
    }
    if ($nit === $adminNit) {
        json_out(['ok' => false, 'error' => 'No puedes eliminar tu propia cuenta de administrador.'], 400);
    }
    $origen = strtolower(trim((string) ($body['origen'] ?? '')));
    $vendedorCodigo = normalize_asesor_codigo($body['vendedor_codigo'] ?? '');
    $touchPortal = ($origen === '' || strpos($origen, 'portal') !== false);
    $touchAsesor = ($origen === '' || strpos($origen, 'asesor') !== false);
    $removed = false;

    if ($touchPortal) {
        $users = read_users($usersFile);
        $next = [];
        foreach ($users as $u) {
            if (normalize_nit($u['nit'] ?? '') === $nit) {
                $removed = true;
                continue;
            }
            $next[] = $u;
        }
        if (count($next) !== count($users)) {
            if (!write_users($usersFile, $next)) {
                json_out(['ok' => false, 'error' => 'No se pudo guardar el archivo.'], 500);
            }
        }
    }

    if ($touchAsesor) {
        $manual = read_asesor_clientes_manual();
        $changedManual = false;
        foreach (($manual['by_codigo'] ?? []) as $code => $list) {
            if (!is_array($list)) {
                continue;
            }
            if ($vendedorCodigo !== '' && normalize_asesor_codigo($code) !== $vendedorCodigo) {
                continue;
            }
            $kept = [];
            foreach ($list as $c) {
                if (!is_array($c)) {
                    continue;
                }
                if (normalize_nit($c['nit'] ?? '') === $nit) {
                    $removed = true;
                    $changedManual = true;
                    continue;
                }
                $kept[] = $c;
            }
            $manual['by_codigo'][$code] = array_values($kept);
        }
        if ($changedManual) {
            write_asesor_clientes_manual($manual);
        }
    }

    if (!$removed) {
        json_out(['ok' => false, 'error' => 'Cliente no encontrado.'], 404);
    }
    json_out(['ok' => true, 'nit' => $nit, 'message' => 'Cliente eliminado.']);
}

if ($action === 'upsert') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $nit = normalize_nit($body['nit'] ?? '');
    $nombre = trim((string) ($body['nombre'] ?? ''));
    $hash = (string) ($body['password_hash'] ?? '');
    $created = (string) ($body['created_at'] ?? date('c'));
    if ($nit === '' || !preg_match('/^\d{6,15}(-\d)?$/', $nit)) {
        json_out(['ok' => false, 'error' => 'NIT inválido.'], 400);
    }
    if ($hash === '' || !izc_starts_with($hash, 'pbkdf2$')) {
        json_out(['ok' => false, 'error' => 'Hash de contraseña inválido.'], 400);
    }
    $users = read_users($usersFile);
    $found = false;
    foreach ($users as $i => $u) {
        if (normalize_nit($u['nit'] ?? '') === $nit) {
            $users[$i] = public_user($nit, $hash, $created, $nombre);
            $found = true;
            break;
        }
    }
    if (!$found) {
        $users[] = public_user($nit, $hash, $created, $nombre);
    }
    if (!write_users($usersFile, $users)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el archivo.'], 500);
    }
    json_out(['ok' => true, 'nit' => $nit, 'nombre' => $nombre, 'message' => 'Usuario guardado en usuarios.json.']);
}

if ($action === 'sync') {
    $incoming = $body['users'] ?? [];
    if (!is_array($incoming)) {
        json_out(['ok' => false, 'error' => 'Lista de usuarios inválida.'], 400);
    }
    $clean = [];
    foreach ($incoming as $u) {
        if (!is_array($u)) {
            continue;
        }
        $nit = normalize_nit($u['nit'] ?? '');
        if ($nit === '' || !preg_match('/^\d{6,15}(-\d)?$/', $nit)) {
            continue;
        }
        $nombre = trim((string) ($u['nombre'] ?? ($u['name'] ?? '')));
        $existingHash = (string) ($u['password_hash'] ?? '');
        if ($existingHash !== '' && izc_starts_with($existingHash, 'pbkdf2$')) {
            $clean[] = public_user($nit, $existingHash, (string) ($u['created_at'] ?? date('c')), $nombre);
            continue;
        }
        $password = (string) ($u['password'] ?? '');
        if (strlen($password) < 4) {
            continue;
        }
        $clean[] = public_user($nit, hash_password($password), (string) ($u['created_at'] ?? date('c')), $nombre);
    }
    if (!write_users($usersFile, $clean)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar usuarios.json.'], 500);
    }
    json_out(['ok' => true, 'count' => count($clean), 'message' => 'Usuarios guardados en data/usuarios.json']);
}

if ($action === 'save_quote') {
    @set_time_limit(180);
    $rawNitIn = trim((string) ($body['nit'] ?? ''));
    $isSatQuote = is_sat_login_id($rawNitIn) || (strtolower(trim((string) ($body['quote_source'] ?? ''))) === 'sat');
    $gpCodeIn = normalize_gp_codigo($body['seller_codigo'] ?? ($body['gp_codigo'] ?? $rawNitIn));
    $isGpQuote = $gpCodeIn !== '' && (is_gp_login_id($rawNitIn) || strtolower(trim((string) ($body['quote_source'] ?? ''))) === 'gp');
    $clientNitIn = normalize_nit($body['client_nit'] ?? ($body['cliente_nit'] ?? ($body['nit_cliente'] ?? '')));
    if ($isSatQuote) {
        $nit = $clientNitIn !== '' ? $clientNitIn : 'SAT';
    } elseif ($isGpQuote) {
        $nit = $clientNitIn !== '' ? $clientNitIn : $gpCodeIn;
    } else {
        $nit = normalize_nit($rawNitIn);
    }
    $nombre = trim((string) ($body['nombre'] ?? ''));
    if ($isSatQuote) {
        // Admin SAT: login no numerico
        $clientNombreIn = trim((string) ($body['client_nombre'] ?? ($body['cliente_nombre'] ?? '')));
        if ($clientNitIn !== '' && $clientNombreIn !== '') {
            $nombre = $clientNombreIn;
        }
    } elseif ($isGpQuote && $clientNitIn === '') {
        // GP cotizando sin NIT cliente: se guarda con codigo GP
    } elseif ($nit === '' || !preg_match('/^\d{6,15}(-\d)?$/', $nit)) {
        json_out(['ok' => false, 'error' => 'NIT invalido.'], 400);
    }
    $gpRow = null;
    if ($isGpQuote) {
        [, $gpRow] = find_gerente_producto(read_gerentes_producto(), $gpCodeIn);
        if (!$gpRow) {
            json_out(['ok' => false, 'error' => 'Gerente de producto no registrado.'], 403);
        }
    }
    $user = null;
    if ($isSatQuote) {
        $users = read_users($usersFile);
        [, $user] = find_user($users, 'SAT');
    } elseif ($isGpQuote) {
        // GP no requiere que el NIT cliente exista en usuarios.json
        $user = null;
    } else {
        $users = read_users($usersFile);
        [, $user] = find_user($users, $nit);
        if (!$user) {
            json_out(['ok' => false, 'error' => 'Usuario no registrado.'], 403);
        }
    }
    if ($nombre === '' && is_array($user)) {
        $nombre = trim((string) ($user['nombre'] ?? ''));
    }
    $items = $body['items'] ?? [];
    if (!is_array($items) || count($items) === 0) {
        json_out(['ok' => false, 'error' => 'La cotización no tiene productos.'], 400);
    }
    if ($isSatQuote && $nombre === '') {
        $nombre = 'Admin SAT';
    }
    $sellerCodigo = $isSatQuote ? 'SAT' : ($isGpQuote ? $gpCodeIn : '');
    $sellerAssigned = null;
    $sellerName = $isSatQuote ? (($nombre !== '') ? $nombre : 'Admin SAT') : '';
    if ($isGpQuote) {
        $sellerName = is_array($gpRow) ? (trim((string) ($gpRow['nombre'] ?? $gpCodeIn)) ?: $gpCodeIn) : $gpCodeIn;
        $clientNombreIn = trim((string) ($body['client_nombre'] ?? ($body['cliente_nombre'] ?? '')));
        if ($clientNitIn !== '' && $clientNombreIn !== '') {
            $nombre = $clientNombreIn;
        } elseif ($nombre === '') {
            $nombre = $sellerName;
        }
        $gpIds = get_gp_bitrix_ids($gpCodeIn);
        if ($gpIds) {
            $sellerAssigned = $gpIds[0];
        }
    }
    $cfg = read_bitrix($bitrixFile);
    if (!$isSatQuote && !$isGpQuote && !empty($cfg['enabled']) && !empty($cfg['webhook_base'])) {
        $sellerInfoPre = find_bitrix_seller_by_nit($cfg['webhook_base'], $cfg, $nit);
        if (!empty($sellerInfoPre['assigned_by_id'])) {
            $sellerAssigned = $sellerInfoPre['assigned_by_id'];
            $sellerName = (string) ($sellerInfoPre['seller_name'] ?? '');
            $sellerCodigo = resolve_asesor_codigo_from_bitrix_id($sellerAssigned);
        }
    }

    $quote = [
        'id' => date('YmdHis') . substr((string) microtime(true), -6) . '-' . $nit,
        'nit' => $nit,
        'nombre' => $nombre,
        'created_at' => date('c'),
        'trm' => $body['trm'] ?? null,
        'empresa' => trim((string) ($body['empresa'] ?? ($body['totals']['empresa'] ?? ''))),
        'fecha_cierre_cliente' => '',
        'items' => $items,
        'totals' => is_array($body['totals'] ?? null) ? $body['totals'] : [],
        'seller_codigo' => $sellerCodigo,
        'assigned_by_id' => $sellerAssigned,
        'seller_name' => $sellerName,
        'asesor_estado' => ($isSatQuote || $isGpQuote) ? 'cotizado' : 'nueva',
        'quote_source' => $isSatQuote ? 'sat' : ($isGpQuote ? 'gp' : 'cliente'),
    ];
    if ($isSatQuote) {
        $quote['asesor_cotizado_at'] = date('c');
        $quote['asesor_cotizado_by'] = 'SAT';
        $quote['finished_at'] = date('c');
    }
    if ($isGpQuote) {
        $quote['asesor_cotizado_at'] = date('c');
        $quote['asesor_cotizado_by'] = $gpCodeIn;
        $quote['finished_at'] = date('c');
        $quote['seller_codigo'] = $gpCodeIn;
        $quote['seller_name'] = $sellerName;
        $quote['gp_codigo'] = $gpCodeIn;
        $quote['gp_nombre'] = $sellerName;
        $assignedRaw = $body['assigned_vendedor'] ?? ($body['vendedor_codigo'] ?? ($body['assigned_asesor'] ?? ''));
        $assignedVendedor = extract_asesor_codigo_from_any($assignedRaw);
        if ($assignedVendedor !== '') {
            $quote['assigned_vendedor'] = $assignedVendedor;
            $quote['vendedor_codigo'] = $assignedVendedor;
            [, $vendedorRow] = find_asesor(read_asesores($asesoresFile), $assignedVendedor);
            if (is_array($vendedorRow)) {
                $vName = trim((string) ($vendedorRow['nombre'] ?? ''));
                if ($vName !== '') {
                    $quote['assigned_vendedor_nombre'] = $vName;
                }
                $vIds = get_asesor_bitrix_ids($assignedVendedor);
                if ($vIds) {
                    $quote['assigned_by_id'] = $vIds[0];
                    $quote['seller_name'] = $vName !== '' ? $vName : $sellerName;
                }
            }
        }
    }
    $fechaCierreCliente = trim((string) ($body['fecha_cierre_cliente'] ?? ($body['fechaCierreCliente'] ?? '')));
    if ($fechaCierreCliente !== '') {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $fechaCierreCliente)) {
            json_out(['ok' => false, 'error' => 'Fecha de cierre de venta inválida.'], 400);
        }
        $fp = explode('-', $fechaCierreCliente);
        if (!checkdate((int) $fp[1], (int) $fp[2], (int) $fp[0])) {
            json_out(['ok' => false, 'error' => 'Fecha de cierre de venta inválida.'], 400);
        }
        $quote['fecha_cierre_cliente'] = $fechaCierreCliente;
    } else {
        json_out(['ok' => false, 'error' => 'Indica la fecha de cierre de venta.'], 400);
    }
    $quotes = read_quotes($quotesFile);
    $quotes[] = $quote;
    if (!write_quotes($quotesFile, $quotes)) {
        json_out(['ok' => false, 'error' => quotes_write_fail_message()], 500);
    }
    if ($isGpQuote) {
        $assignedSaved = extract_asesor_codigo_from_any($quote['assigned_vendedor'] ?? ($quote['vendedor_codigo'] ?? ''));
        if ($assignedSaved !== '') {
            asesor_quotes_list_cache_add_gp_quote($assignedSaved, $quote);
        }
    }
    $bitrix = ['ok' => false, 'skipped' => true, 'error' => 'Bitrix no ejecutado.'];
    try {
        $bitrix = send_bitrix_deal($quote);
    } catch (Throwable $e) {
        $bitrix = ['ok' => false, 'skipped' => false, 'error' => 'Bitrix: ' . $e->getMessage()];
    }
    if (!empty($bitrix['ok'])) {
        $changed = false;
        if (!empty($bitrix['assigned_by_id'])) {
            $quote['assigned_by_id'] = $bitrix['assigned_by_id'];
            // No pisar seller_codigo del GP con el V# de Bitrix.
            if (!$isGpQuote) {
                $resolved = resolve_asesor_codigo_from_bitrix_id($bitrix['assigned_by_id']);
                if ($resolved !== '') {
                    $quote['seller_codigo'] = $resolved;
                }
            }
            $changed = true;
        }
        if (!empty($bitrix['seller_name']) && !$isGpQuote) {
            $quote['seller_name'] = (string) $bitrix['seller_name'];
            $changed = true;
        }
        if (!empty($bitrix['deal_id'])) {
            $quote['bitrix_deal_id'] = (string) $bitrix['deal_id'];
            $changed = true;
        }
        if ($changed) {
            $quotes[count($quotes) - 1] = $quote;
            write_quotes($quotesFile, $quotes);
        }
    }
    if ($isGpQuote) {
        $assignedSaved = extract_asesor_codigo_from_any($quote['assigned_vendedor'] ?? ($quote['vendedor_codigo'] ?? ''));
        if ($assignedSaved !== '') {
            asesor_quotes_list_cache_add_gp_quote($assignedSaved, $quote);
        }
    }
    $message = 'Cotizacion guardada';
    json_out(['ok' => true, 'id' => $quote['id'], 'message' => $message, 'bitrix' => $bitrix]);
}

if ($action === 'get_bitrix') {
    global $bitrixFile, $adminNits;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $cfg = read_bitrix($bitrixFile);
    $masked = (string) ($cfg['webhook_base'] ?? '');
    if (strlen($masked) > 40) {
        $masked = substr($masked, 0, 28) . '…' . substr($masked, -8);
    }
    json_out([
        'ok' => true,
        'enabled' => !empty($cfg['enabled']),
        'webhook_base' => (string) ($cfg['webhook_base'] ?? ''),
        'webhook_masked' => $masked,
        'stage_id' => (string) ($cfg['stage_id'] ?? ''),
        'category_id' => (string) ($cfg['category_id'] ?? ''),
        'currency_id' => (string) ($cfg['currency_id'] ?? 'COP'),
        'updated_at' => (string) ($cfg['updated_at'] ?? ''),
        'configured' => !empty($cfg['enabled']) && !empty($cfg['webhook_base']) && !empty($cfg['stage_id']),
    ]);
}

if ($action === 'set_bitrix') {
    global $bitrixFile, $adminNits;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $cfg = read_bitrix($bitrixFile);
    if (array_key_exists('enabled', $body)) {
        $cfg['enabled'] = (bool) $body['enabled'];
    }
    if (array_key_exists('webhook_base', $body)) {
        $cfg['webhook_base'] = normalize_bitrix_webhook((string) $body['webhook_base']);
    }
    if (array_key_exists('stage_id', $body)) {
        $cfg['stage_id'] = trim((string) $body['stage_id']);
    }
    if (array_key_exists('category_id', $body)) {
        $cfg['category_id'] = trim((string) $body['category_id']);
    }
    if (array_key_exists('currency_id', $body)) {
        $cfg['currency_id'] = strtoupper(trim((string) $body['currency_id'])) ?: 'COP';
    }
    if ($cfg['webhook_base'] === '' || $cfg['stage_id'] === '') {
        json_out(['ok' => false, 'error' => 'Webhook y STAGE_ID son obligatorios.'], 400);
    }
    if (stripos($cfg['webhook_base'], 'PEGAR_CODIGO') !== false || stripos($cfg['webhook_base'], 'example') !== false) {
        json_out(['ok' => false, 'error' => 'El webhook parece de ejemplo. Pega el webhook real de Bitrix24.'], 400);
    }
    $probe = bitrix_rest($cfg['webhook_base'], 'profile.json', []);
    if ($probe === null) {
        json_out(['ok' => false, 'error' => 'No se pudo contactar Bitrix con ese webhook.'], 400);
    }
    if (!empty($probe['error'])) {
        $desc = isset($probe['error_description']) ? (string) $probe['error_description'] : (string) $probe['error'];
        json_out([
            'ok' => false,
            'error' => 'Webhook inválido o revocado: ' . $desc . '. Crea un webhook nuevo en Bitrix (REST) y pégalo aquí.',
        ], 400);
    }
    $cfg['updated_at'] = date('c');
    $cfg['updated_by_nit'] = $adminNit;
    if (!write_bitrix($bitrixFile, $cfg)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar Bitrix.'], 500);
    }
    json_out([
        'ok' => true,
        'message' => 'Configuración Bitrix guardada.',
        'enabled' => !empty($cfg['enabled']),
        'stage_id' => $cfg['stage_id'],
        'category_id' => $cfg['category_id'],
        'currency_id' => $cfg['currency_id'],
        'updated_at' => $cfg['updated_at'],
    ]);
}

if ($action === 'test_bitrix') {
    global $bitrixFile, $adminNits;
    @set_time_limit(45);
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.']);
    }
    $cfg = read_bitrix($bitrixFile);
    if (!empty($body['webhook_base'])) {
        $cfg['webhook_base'] = normalize_bitrix_webhook((string) $body['webhook_base']);
    }
    if (!empty($body['stage_id'])) {
        $cfg['stage_id'] = trim((string) $body['stage_id']);
    }
    if (array_key_exists('category_id', $body)) {
        $cfg['category_id'] = trim((string) $body['category_id']);
    }
    if ($cfg['webhook_base'] === '') {
        json_out(['ok' => false, 'error' => 'Falta webhook_base.']);
    }
    try {
        $profile = bitrix_rest($cfg['webhook_base'], 'profile.json', []);
    } catch (Throwable $e) {
        json_out(['ok' => false, 'error' => 'Error PHP al contactar Bitrix: ' . $e->getMessage()]);
    }
    if ($profile === null || !empty($profile['error'])) {
        $desc = '';
        if (is_array($profile) && !empty($profile['error'])) {
            $desc = isset($profile['error_description']) ? (string) $profile['error_description'] : (string) $profile['error'];
        }
        if ($desc === '') {
            $desc = izc_bitrix_last_error();
        }
        if ($desc === '') {
            $desc = function_exists('curl_init') ? 'sin respuesta HTTPS' : 'activa php_curl en WAMP';
        }
        json_out([
            'ok' => false,
            'error' => 'No se pudo contactar Bitrix desde el WAMP (' . $desc . ').',
        ]);
    }
    json_out([
        'ok' => true,
        'message' => 'Webhook Bitrix responde correctamente.',
        'profile' => $profile['result'] ?? null,
        'stages' => [],
        'stage_id' => $cfg['stage_id'],
    ]);
}

if ($action === 'list_quotes') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    @set_time_limit(75);
    $importNew = !empty($body['import_new']) || !empty($body['import_bitrix_new']);
    $forceRecent = !empty($body['sync_bitrix']) || !empty($body['refresh_bitrix']) || !empty($body['force']);
    $bitrixSync = [
        'synced' => false,
        'imported' => 0,
        'linked' => 0,
        'updated' => 0,
        'deals_found' => 0,
        'error' => '',
        'import_new' => true,
        'skipped' => false,
        'from_cache' => false,
    ];
    // Sync corto: solo deals recientes (hoy/ayer). No recorre todo el embudo.
    try {
        $bitrixSync = array_merge($bitrixSync, sync_bitrix_recent_quotes(72, $forceRecent));
    } catch (Throwable $e) {
        $bitrixSync['error'] = 'Sync Bitrix: ' . $e->getMessage();
    }
    try {
        heal_quotes_file($quotesFile);
        invalidate_quotes_cache($quotesFile);
    } catch (Throwable $eHeal) { /* ignore */ }
    $quotes = read_quotes($quotesFile);
    usort($quotes, function ($a, $b) {
        $tb = strtotime((string) ($b['created_at'] ?? '')) ?: 0;
        $ta = strtotime((string) ($a['created_at'] ?? '')) ?: 0;
        if ($tb !== $ta) {
            return $tb <=> $ta;
        }
        return strcmp((string) ($b['id'] ?? ''), (string) ($a['id'] ?? ''));
    });
    $safe = [];
    $clientCount = 0;
    foreach ($quotes as $q) {
        if (!is_array($q)) {
            continue;
        }
        if (!quote_has_priced_deal($q)) {
            continue;
        }
        if (!quote_in_admin_historial($q)) {
            continue;
        }
        $isClient = function_exists('quote_is_admin_client_quote') ? quote_is_admin_client_quote($q) : quote_is_made_by_cliente($q);
        if ($isClient) {
            $clientCount++;
        }
        $seller = resolve_quote_seller_label($q);
        $adminAssigned = !empty($q['assigned_by_admin'])
            || trim((string) ($q['vendedor_asignado_at'] ?? '')) !== ''
            || trim((string) ($q['vendedor_asignado_by'] ?? '')) !== '';
        $sellerCodigoRaw = normalize_asesor_codigo($q['seller_codigo'] ?? '');
        $safe[] = [
            'id' => (string) ($q['id'] ?? ''),
            'nit' => (string) ($q['nit'] ?? ''),
            'nombre' => trim((string) ($q['nombre'] ?? '')),
            'created_at' => izc_datetime_bogota((string) ($q['created_at'] ?? ''), (string) ($q['id'] ?? '')),
            'trm' => $q['trm'] ?? null,
            'items' => is_array($q['items'] ?? null) ? $q['items'] : [],
            'totals' => is_array($q['totals'] ?? null) ? $q['totals'] : [],
            'seller_codigo' => $seller['seller_codigo'],
            'seller_codigo_raw' => $sellerCodigoRaw,
            'assigned_by_id' => $seller['assigned_by_id'],
            'seller_name' => $seller['seller_name'],
            'seller_label' => $seller['seller_label'],
            'asesor_estado' => quote_asesor_estado($q),
            'asesor_comentario' => (string) ($q['asesor_comentario'] ?? ''),
            'asesor_comentario_at' => (string) ($q['asesor_comentario_at'] ?? ''),
            'asesor_comentario_by' => (string) ($q['asesor_comentario_by'] ?? ''),
            'fecha_cierre' => (string) ($q['fecha_cierre'] ?? ''),
            'fecha_cierre_cliente' => (string) ($q['fecha_cierre_cliente'] ?? ''),
            'empresa' => (string) (function_exists('quote_empresa_stored')
                ? quote_empresa_stored($q)
                : trim((string) ($q['empresa'] ?? (($q['totals']['empresa'] ?? '') ?? '')))),
            'quote_source' => (string) ($q['quote_source'] ?? ''),
            'synced_from_bitrix' => !empty($q['synced_from_bitrix']),
            'bitrix_deal_id' => (string) ($q['bitrix_deal_id'] ?? ''),
            'asesor_cotizado_by' => (string) ($q['asesor_cotizado_by'] ?? ''),
            'finished_at' => (string) ($q['finished_at'] ?? ''),
            'assigned_by_admin' => $adminAssigned,
            'vendedor_asignado_at' => (string) ($q['vendedor_asignado_at'] ?? ''),
            'is_client_quote' => $isClient,
        ];
    }
    json_out([
        'ok' => true,
        'quotes' => $safe,
        'count' => count($safe),
        'client_count' => $clientCount,
        'bitrix_sync' => $bitrixSync,
    ]);
}

if ($action === 'adopt_producto_creado_asesor') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    $okAdmin = $adminNit !== '' && is_admin_nit($adminNit);
    if (!$okAdmin && !zkteco_actor_ok($body)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $wantId = trim((string) ($body['id'] ?? ''));
    $wantSku = strtoupper(trim((string) ($body['sku'] ?? '')));
    if ($wantId === '' && $wantSku === '') {
        json_out(['ok' => false, 'error' => 'Falta el producto a adoptar.'], 400);
    }
    $data = read_productos_creados_asesor();
    $adoptedSkus = created_product_adopted_sku_map($data);
    $now = date('c');
    $marked = 0;
    foreach ($data['products'] as $i => $p) {
        if (!is_array($p)) {
            continue;
        }
        $pid = (string) ($p['id'] ?? '');
        $psku = strtoupper(trim((string) ($p['sku'] ?? '')));
        if (($wantId !== '' && $pid === $wantId) || ($wantSku !== '' && $psku === $wantSku)) {
            $data['products'][$i]['adopted_at'] = $now;
            $data['products'][$i]['adopted_by'] = 'ZKTECO';
            $marked++;
            if ($psku !== '') {
                $adoptedSkus[$psku] = true;
            }
        }
    }
    if ($wantSku !== '') {
        $adoptedSkus[$wantSku] = true;
    }
    if ($marked === 0 && $wantSku === '') {
        json_out(['ok' => false, 'error' => 'No se encontró ese producto de asesor.'], 404);
    }
    $data['adopted_skus'] = array_values(array_keys($adoptedSkus));
    $data['updated_at'] = $now;
    if (!write_productos_creados_asesor($data)) {
        json_out(['ok' => false, 'error' => 'No se pudo actualizar el producto de asesor.'], 500);
    }
    json_out(['ok' => true, 'message' => 'Producto movido a ZKTeco.', 'count' => $marked]);
}

if ($action === 'list_productos_creados' || $action === 'list_created_products') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    $okAdmin = $adminNit !== '' && is_admin_nit($adminNit);
    if (!$okAdmin && !zkteco_actor_ok($body)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $products = list_all_productos_creados_asesor();
    if (zkteco_actor_ok($body) && empty($body['all_brands'])) {
        $onlyZkteco = [];
        foreach ($products as $p) {
            if (created_product_looks_zkteco($p)) {
                $onlyZkteco[] = $p;
            }
        }
        $products = $onlyZkteco;
    }
    json_out(['ok' => true, 'products' => $products, 'count' => count($products)]);
}

if ($action === 'list_productos_zkteco' || $action === 'list_productos_zebra') {
    if (!zkteco_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $data = read_productos_zkteco();
    $list = [];
    foreach ($data['products'] as $p) {
        $n = normalize_zkteco_product_row($p);
        if ($n) {
            $list[] = $n;
        }
    }
    usort($list, function ($a, $b) {
        return strcmp((string) ($b['updated_at'] ?? $b['created_at'] ?? ''), (string) ($a['updated_at'] ?? $a['created_at'] ?? ''));
    });
    json_out(['ok' => true, 'products' => $list, 'count' => count($list)]);
}

if ($action === 'save_producto_zkteco' || $action === 'save_producto_zebra') {
    if (!zkteco_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $row = normalize_zkteco_product_row($body['product'] ?? $body);
    if (!$row) {
        json_out(['ok' => false, 'error' => 'Indica SKU o nombre del producto.'], 400);
    }
    $data = read_productos_zkteco();
    $found = false;
    $id = (string) ($body['id'] ?? $row['id']);
    foreach ($data['products'] as $i => $p) {
        if (!is_array($p)) {
            continue;
        }
        $pid = (string) ($p['id'] ?? '');
        $psku = strtoupper(trim((string) ($p['sku'] ?? '')));
        if (($id !== '' && $pid === $id) || ($row['sku'] !== '' && $psku === $row['sku'] && $pid !== '')) {
            $row['id'] = $pid !== '' ? $pid : $row['id'];
            $row['created_at'] = (string) ($p['created_at'] ?? $row['created_at']);
            $row['updated_at'] = date('c');
            $prevUsd = izc_parse_money($p['unitario_usd'] ?? 0);
            $prevCop = izc_parse_money($p['unitario_cop'] ?? 0);
            if (($row['unitario_usd'] ?? 0) <= 0 && $prevUsd > 0) {
                $row['unitario_usd'] = $prevUsd;
            }
            if (($row['unitario_cop'] ?? 0) <= 0 && $prevCop > 0) {
                $row['unitario_cop'] = $prevCop;
            }
            $data['products'][$i] = $row;
            $found = true;
            break;
        }
    }
    if (!$found) {
        $row['created_at'] = date('c');
        $row['updated_at'] = $row['created_at'];
        $data['products'][] = $row;
    }
    if (!write_productos_zkteco($data)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el producto ZKTeco.'], 500);
    }
    json_out([
        'ok' => true,
        'product' => $row,
        'message' => $found ? 'Producto ZKTeco actualizado.' : 'Producto ZKTeco creado.',
    ]);
}

if ($action === 'delete_producto_zkteco' || $action === 'delete_producto_zebra') {
    if (!zkteco_actor_ok($body) && !is_admin_nit($body['admin_nit'] ?? '')) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $id = trim((string) ($body['id'] ?? ''));
    $sku = strtoupper(trim((string) ($body['sku'] ?? '')));
    if ($id === '' && $sku === '') {
        json_out(['ok' => false, 'error' => 'Falta el producto a eliminar.'], 400);
    }
    $data = read_productos_zkteco();
    $kept = [];
    $removed = false;
    foreach ($data['products'] as $p) {
        if (!is_array($p)) {
            continue;
        }
        $pid = (string) ($p['id'] ?? '');
        $psku = strtoupper(trim((string) ($p['sku'] ?? '')));
        if (($id !== '' && $pid === $id) || ($sku !== '' && $psku === $sku)) {
            $removed = true;
            continue;
        }
        $kept[] = $p;
    }
    if (!$removed) {
        json_out(['ok' => false, 'error' => 'No se encontró ese producto ZKTeco.'], 404);
    }
    $data['products'] = $kept;
    if (!write_productos_zkteco($data)) {
        json_out(['ok' => false, 'error' => 'No se pudo eliminar el producto.'], 500);
    }
    json_out(['ok' => true, 'message' => 'Producto ZKTeco eliminado.']);
}


if ($action === 'sync_local_data' || $action === 'sync_local_all') {
    global $asesoresFile, $adminNits;
    @set_time_limit(300);
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    $asesorCodigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit'] ?? ''));
    $isAdmin = ($adminNit !== '' && is_admin_nit($adminNit));
    [, $asesor] = $asesorCodigo !== '' ? find_asesor(read_asesores($asesoresFile), $asesorCodigo) : [null, null];
    $isAsesor = (bool) $asesor;
    if (!$isAdmin && !$isAsesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }

    $codes = [];
    if ($isAsesor && !$isAdmin) {
        $codes[] = $asesorCodigo;
    } else {
        foreach (read_asesores($asesoresFile) as $a) {
            if (!is_array($a)) {
                continue;
            }
            $c = normalize_asesor_codigo($a['codigo'] ?? ($a['nit'] ?? ''));
            if ($c !== '') {
                $codes[] = $c;
            }
        }
        $codes = array_values(array_unique($codes));
    }

    $clientesOk = 0;
    $clientesErr = 0;
    $quotesImported = 0;
    $quotesLinked = 0;
    $quotesUpdated = 0;
    $quotesErrors = [];
    // Por defecto SOLO mapea (deal_id/estado) sin crear cotizaciones nuevas,
    // para mantener el mismo set que el servidor. import_new=1 importa deals faltantes.
    $importNew = !empty($body['import_new']) || !empty($body['import_bitrix_new']);
    foreach ($codes as $c) {
        try {
            $syncC = sync_asesor_clientes_from_bitrix($c, true, false);
            if (empty($syncC['error'])) {
                $clientesOk++;
            } else {
                $clientesErr++;
            }
        } catch (Throwable $e) {
            $clientesErr++;
        }
        try {
            $syncQ = sync_bitrix_deals_for_asesor($c, true, $importNew);
            $quotesImported += (int) ($syncQ['imported'] ?? 0);
            $quotesLinked += (int) ($syncQ['linked'] ?? 0);
            $quotesUpdated += (int) ($syncQ['updated'] ?? 0);
            if (!empty($syncQ['error']) && count($quotesErrors) < 5) {
                $quotesErrors[] = $c . ': ' . $syncQ['error'];
            }
        } catch (Throwable $e) {
            if (count($quotesErrors) < 5) {
                $quotesErrors[] = $c . ': ' . $e->getMessage();
            }
        }
    }

    if (function_exists('list_all_productos_creados_asesor')) {
        list_all_productos_creados_asesor();
    }

    $msg = 'Clientes Bitrix: ' . $clientesOk . ' asesores ok';
    if ($clientesErr > 0) {
        $msg .= ', ' . $clientesErr . ' con error';
    }
    if ($importNew) {
        $msg .= '. Cotizaciones Bitrix: +' . $quotesImported . ' importadas, ' . $quotesLinked . ' enlazadas, ' . $quotesUpdated . ' actualizadas.';
    } else {
        $msg .= '. Cotizaciones Bitrix (mapeo): ' . $quotesLinked . ' enlazadas, ' . $quotesUpdated . ' actualizadas (sin crear nuevas).';
    }
    if ($quotesErrors) {
        $msg .= ' Avisos: ' . implode('; ', $quotesErrors);
    }

    json_out([
        'ok' => true,
        'message' => $msg,
        'clientes_ok' => $clientesOk,
        'clientes_err' => $clientesErr,
        'quotes_imported' => $quotesImported,
        'quotes_linked' => $quotesLinked,
        'quotes_updated' => $quotesUpdated,
        'import_new' => $importNew,
        'quotes_errors' => $quotesErrors,
    ]);
}


if ($action === 'export_admin_data' || $action === 'pull_server_data_bundle') {
    // SOLO LECTURA: exporta JSON del servidor para copiar al PC local.
    // No escribe ni modifica ningun archivo en el servidor.
    global $adminNits, $quotesFile, $usersFile, $asesoresFile, $trmFile;
    global $asesorClientesManualFile, $asesorClientesIndexFile, $productosCreadosAsesorFile, $gpClientesManualFile;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $root = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR;
    $map = [
        'cotizaciones.json' => $quotesFile,
        'usuarios.json' => $usersFile,
        'asesores.json' => $asesoresFile,
        'trm.json' => $trmFile,
        'asesor_clientes_manual.json' => $asesorClientesManualFile,
        'gp_clientes_manual.json' => $gpClientesManualFile,
        'asesor_clientes_index.json' => $asesorClientesIndexFile,
        'productos_creados_asesor.json' => $productosCreadosAsesorFile,
        'bitrix_vendedores.json' => $root . 'bitrix_vendedores.json',
        'nit_nombres.json' => $root . 'nit_nombres.json',
        'nit_telefonos.json' => $root . 'nit_telefonos.json',
        'nit_direcciones.json' => $root . 'nit_direcciones.json',
        'clientes_sin_vendedor_dismissed.json' => $root . 'clientes_sin_vendedor_dismissed.json',
    ];
    $filesRaw = [];
    $counts = [];
    foreach ($map as $name => $path) {
        if (!is_file($path)) {
            $filesRaw[$name] = null;
            $counts[$name] = ['exists' => false];
            continue;
        }
        $raw = (string) file_get_contents($path);
        $filesRaw[$name] = $raw;
        $decoded = json_decode($raw, true);
        $isList = false;
        if (is_array($decoded)) {
            if (function_exists('array_is_list')) {
                $isList = array_is_list($decoded);
            } else {
                $isList = (count($decoded) === 0) || (array_keys($decoded) === range(0, count($decoded) - 1));
            }
        }
        if ($isList) {
            $counts[$name] = ['exists' => true, 'count' => count($decoded)];
        } elseif (is_array($decoded) && isset($decoded['by_codigo']) && is_array($decoded['by_codigo'])) {
            $n = 0;
            foreach ($decoded['by_codigo'] as $list) {
                if (is_array($list)) {
                    $n += count($list);
                }
            }
            $counts[$name] = ['exists' => true, 'count' => $n];
        } elseif (is_array($decoded) && isset($decoded['products']) && is_array($decoded['products'])) {
            $counts[$name] = ['exists' => true, 'count' => count($decoded['products'])];
        } else {
            $counts[$name] = ['exists' => true, 'bytes' => strlen($raw)];
        }
    }
    json_out([
        'ok' => true,
        'read_only' => true,
        'message' => 'Exportacion solo lectura. El servidor no se modifico.',
        'exported_at' => date('c'),
        'counts' => $counts,
        'files_raw' => $filesRaw,
    ]);
}

if ($action === 'list_clientes_sin_vendedor' || $action === 'list_unassigned_clients') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if (!function_exists('list_clientes_sin_vendedor')) {
        json_out(['ok' => false, 'error' => 'Falta subir api/admin_assign_vendedor.php.'], 500);
    }
    $clients = list_clientes_sin_vendedor();
    json_out(['ok' => true, 'clients' => $clients, 'count' => count($clients)]);
}

if ($action === 'assign_vendedor_cliente' || $action === 'assign_seller_client') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if (!function_exists('assign_vendedor_to_cliente')) {
        json_out(['ok' => false, 'error' => 'Falta subir api/admin_assign_vendedor.php.'], 500);
    }
    $result = assign_vendedor_to_cliente(
        $body['client_nit'] ?? ($body['nit'] ?? ''),
        $body['seller_codigo'] ?? ($body['asesor_codigo'] ?? ($body['vendedor_codigo'] ?? '')),
        $body['nombre'] ?? ($body['cliente_nombre'] ?? ''),
        $adminNit
    );
    if (empty($result['ok'])) {
        json_out(['ok' => false, 'error' => (string) ($result['error'] ?? 'No se pudo asignar.')], 400);
    }
    json_out([
        'ok' => true,
        'message' => 'Vendedor asignado. Las cotizaciones ya aparecen en el panel del asesor.',
        'quotes_updated' => (int) ($result['quotes_updated'] ?? 0),
        'client' => $result['client'] ?? null,
        'clients' => list_clientes_sin_vendedor(),
    ]);
}

if ($action === 'delete_cliente_sin_vendedor' || $action === 'dismiss_unassigned_client') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    if (!function_exists('delete_cliente_sin_vendedor')) {
        json_out(['ok' => false, 'error' => 'Falta subir api/admin_assign_vendedor.php.'], 500);
    }
    $result = delete_cliente_sin_vendedor(
        $body['client_nit'] ?? ($body['nit'] ?? ''),
        $adminNit
    );
    if (empty($result['ok'])) {
        json_out(['ok' => false, 'error' => (string) ($result['error'] ?? 'No se pudo eliminar.')], 400);
    }
    json_out([
        'ok' => true,
        'message' => (string) ($result['message'] ?? 'Cliente eliminado de la lista.'),
        'nit' => (string) ($result['nit'] ?? ''),
        'quotes_removed' => (int) ($result['quotes_removed'] ?? 0),
        'user_removed' => !empty($result['user_removed']),
        'clients' => list_clientes_sin_vendedor(),
    ]);
}

/** Catálogo compartido de productos manuales (asesores). */
if ($action === 'get_productos_creados') {
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit_asesor'] ?? ''));
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    $okAsesor = $codigo !== '' && find_asesor(read_asesores($asesoresFile), $codigo)[1];
    $okAdmin = $adminNit !== '' && is_admin_nit($adminNit);
    if (!$okAsesor && !$okAdmin && !zkteco_actor_ok($body)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $products = list_all_productos_creados_asesor();
    // Único por SKU para búsqueda en cotizador (el más reciente manda; nombre real gana a placeholder).
    $bySku = [];
    foreach ($products as $p) {
        $sku = strtoupper(trim((string) ($p['sku'] ?? '')));
        if ($sku === '') {
            continue;
        }
        if (!isset($bySku[$sku])) {
            $bySku[$sku] = $p;
            continue;
        }
        $prev = $bySku[$sku];
        $prevPh = is_placeholder_created_product_name($prev['name'] ?? '', $sku);
        $nextPh = is_placeholder_created_product_name($p['name'] ?? '', $sku);
        $newer = strcmp((string) ($p['created_at'] ?? ''), (string) ($prev['created_at'] ?? '')) > 0;
        if ($prevPh && !$nextPh) {
            $bySku[$sku] = $p;
        } elseif (!$prevPh && $nextPh) {
            if ($newer) {
                $merged = $p;
                $merged['name'] = $prev['name'];
                if (($merged['referencia'] ?? '') === '' && ($prev['referencia'] ?? '') !== '') {
                    $merged['referencia'] = $prev['referencia'];
                }
                $bySku[$sku] = $merged;
            }
        } elseif ($newer) {
            $bySku[$sku] = $p;
        }
    }
    json_out(['ok' => true, 'products' => array_values($bySku), 'count' => count($bySku)]);
}

if ($action === 'list_my_quotes') {
    $nit = normalize_nit($body['nit'] ?? '');
    if ($nit === '' || !preg_match('/^\d{6,15}(-\d)?$/', $nit)) {
        json_out(['ok' => false, 'error' => 'NIT inválido.'], 400);
    }
    $quotes = read_quotes($quotesFile);
    usort($quotes, function ($a, $b) {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    $safe = [];
    foreach ($quotes as $q) {
        if (!is_array($q)) {
            continue;
        }
        if (normalize_nit($q['nit'] ?? '') !== $nit) {
            continue;
        }
        repair_quote_totals_from_items($q);
        $safe[] = [
            'id' => (string) ($q['id'] ?? ''),
            'nit' => (string) ($q['nit'] ?? ''),
            'nombre' => trim((string) ($q['nombre'] ?? '')),
            'created_at' => (string) ($q['created_at'] ?? ''),
            'fecha_cierre_cliente' => (string) ($q['fecha_cierre_cliente'] ?? ''),
            'trm' => $q['trm'] ?? null,
            'items' => is_array($q['items'] ?? null) ? $q['items'] : [],
            'totals' => is_array($q['totals'] ?? null) ? $q['totals'] : [],
        ];
    }
    json_out(['ok' => true, 'quotes' => $safe, 'count' => count($safe)]);
}

if ($action === 'get_trm') {
    global $trmFile;
    $entry = read_trm($trmFile);
    $value = (float) ($entry['value'] ?? 3204);
    if ($value <= 0) {
        $value = 3204;
    }
    json_out([
        'ok' => true,
        'value' => $value,
        'updated_at' => (string) ($entry['updated_at'] ?? ''),
        'updated_by_nit' => (string) ($entry['updated_by_nit'] ?? ''),
        'updated_by_nombre' => (string) ($entry['updated_by_nombre'] ?? ''),
    ]);
}

if ($action === 'set_trm') {
    global $trmFile;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $value = (float) ($body['value'] ?? 0);
    if ($value <= 0) {
        json_out(['ok' => false, 'error' => 'La TRM debe ser mayor que cero.'], 400);
    }
    $adminNombre = trim((string) ($body['admin_nombre'] ?? ''));
    if (!write_trm($trmFile, $value, $adminNit, $adminNombre)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar la TRM.'], 500);
    }
    json_out([
        'ok' => true,
        'value' => $value,
        'updated_at' => date('c'),
        'message' => 'TRM actualizada para el cotizador.',
    ]);
}

if ($action === 'restore_quotes_historial' || $action === 'heal_quotes') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $before = is_file($quotesFile) ? parse_quotes_payload((string) @file_get_contents($quotesFile)) : [];
    $after = heal_quotes_file($quotesFile);
    invalidate_quotes_cache($quotesFile);
    $priced = 0;
    foreach ((array) $after as $q) {
        if (quote_has_priced_deal($q) && !quote_is_orphan_bitrix_deal($q)) {
            $priced++;
        }
    }
    json_out([
        'ok' => true,
        'message' => 'Historial recuperado desde backups locales del servidor.',
        'before' => count($before),
        'after' => count($after),
        'visible' => $priced,
    ]);
}

if ($action === 'import_admin_data') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if (!is_admin_nit($adminNit)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    @set_time_limit(180);
    $incoming = $body['cotizaciones'] ?? ($body['quotes'] ?? []);
    if (!is_array($incoming)) {
        json_out(['ok' => false, 'error' => 'Lista de cotizaciones inválida.'], 400);
    }
    $clean = [];
    foreach ($incoming as $q) {
        if (is_array($q) && (isset($q['id']) || isset($q['nit']) || isset($q['items']))) {
            $clean[] = $q;
        }
    }
    $onDisk = is_file($quotesFile) ? parse_quotes_payload((string) @file_get_contents($quotesFile)) : [];
    $merged = merge_quote_lists($onDisk, $clean);
    $healed = heal_quotes_file($quotesFile);
    if (is_array($healed) && count($healed) > count($merged)) {
        $merged = merge_quote_lists($healed, $merged);
    }
    if (!write_quotes($quotesFile, $merged)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el historial fusionado.'], 500);
    }
    invalidate_quotes_cache($quotesFile);
    $final = read_quotes($quotesFile);
    json_out([
        'ok' => true,
        'message' => 'Cotizaciones fusionadas (sin borrar las existentes).',
        'imported' => count($clean),
        'count' => count($final),
        'before' => count($onDisk),
    ]);
}

json_out(['ok' => false, 'error' => 'Acción no válida.'], 400);
