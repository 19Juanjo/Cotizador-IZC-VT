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

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$usersFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'usuarios.json';
$quotesFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'cotizaciones.json';
$trmFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'trm.json';
$bitrixFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'bitrix.json';
$asesoresFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'asesores.json';
$asesorClientesIndexFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'asesor_clientes_index.json';
$nitTelefonosFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'nit_telefonos.json';

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
        if (str_starts_with($compact, '+57')) {
            $compact = substr($compact, 3);
        } elseif (str_starts_with($compact, '0057')) {
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
                $isList = array_keys($data) === range(0, count($data) - 1);
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

function resolve_cliente_nombre_from_index($nit, $fallback = '') {
    static $mapCache = null;
    global $asesorClientesIndexFile;
    $n = normalize_nit($nit);
    $fb = trim((string) $fallback);
    if ($n === '') {
        return $fb;
    }
    if ($mapCache === null) {
        $mapCache = [];
        $nombresFile = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'nit_nombres.json';
        if (is_file($nombresFile)) {
            $data = json_decode((string) file_get_contents($nombresFile), true);
            if (is_array($data)) {
                // Supports [{nit,nombre}, ...] or {nit: nombre}
                $isList = array_keys($data) === range(0, count($data) - 1);
                if ($isList) {
                    foreach ($data as $row) {
                        if (!is_array($row)) {
                            continue;
                        }
                        $key = normalize_nit($row['nit'] ?? '');
                        $nombre = trim((string) ($row['nombre'] ?? ''));
                        if ($key !== '' && $nombre !== '') {
                            $mapCache[$key] = $nombre;
                        }
                    }
                } else {
                    foreach ($data as $key => $nombre) {
                        $k = normalize_nit((string) $key);
                        $v = trim((string) $nombre);
                        if ($k !== '' && $v !== '') {
                            $mapCache[$k] = $v;
                        }
                    }
                }
            }
        } elseif (is_file($asesorClientesIndexFile)) {
            $data = json_decode((string) file_get_contents($asesorClientesIndexFile), true);
            if (is_array($data) && isset($data['nombres_by_nit']) && is_array($data['nombres_by_nit'])) {
                foreach ($data['nombres_by_nit'] as $key => $nombre) {
                    $k = normalize_nit((string) $key);
                    $v = trim((string) $nombre);
                    if ($k !== '' && $v !== '') {
                        $mapCache[$k] = $v;
                    }
                }
            }
        }
    }
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

function get_asesor_clientes($codigo) {
    global $asesorClientesIndexFile;
    $code = normalize_asesor_codigo($codigo);
    if ($code === '' || !is_file($asesorClientesIndexFile)) {
        return [];
    }
    $data = json_decode((string) file_get_contents($asesorClientesIndexFile), true);
    if (!is_array($data) || !isset($data['by_codigo'][$code]) || !is_array($data['by_codigo'][$code])) {
        return [];
    }
    $entry = $data['by_codigo'][$code];
    $out = [];
    foreach (($entry['clientes'] ?? []) as $c) {
        if (!is_array($c)) {
            continue;
        }
        $nit = normalize_nit($c['nit'] ?? '');
        if ($nit === '') {
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
        $out[] = ['nit' => $nit, 'nombre' => $nombre, 'telefono' => $telefono];
    }
    return $out;
}

function asesor_nit_variants_set($codigo) {
    $set = [];
    foreach (get_asesor_clientes($codigo) as $c) {
        $nit = normalize_nit($c['nit'] ?? '');
        if ($nit !== '') {
            $set[$nit] = true;
        }
        $digits = preg_replace('/\D+/', '', $nit);
        if ($digits !== '') {
            $set[$digits] = true;
            $noZeros = ltrim($digits, '0');
            if ($noZeros !== '') {
                $set[$noZeros] = true;
            }
        }
    }
    return $set;
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
    static $cache = null;
    global $asesorClientesIndexFile;
    if ($cache !== null) {
        return $cache;
    }
    $cache = [];
    if (!is_file($asesorClientesIndexFile)) {
        return $cache;
    }
    $data = json_decode((string) file_get_contents($asesorClientesIndexFile), true);
    if (!is_array($data) || !isset($data['by_codigo']) || !is_array($data['by_codigo'])) {
        return $cache;
    }
    foreach ($data['by_codigo'] as $codeRaw => $entry) {
        $code = normalize_asesor_codigo($codeRaw);
        if ($code === '' || !is_array($entry)) {
            continue;
        }
        foreach (($entry['clientes'] ?? []) as $c) {
            if (!is_array($c)) {
                continue;
            }
            $nit = normalize_nit($c['nit'] ?? '');
            if ($nit === '') {
                continue;
            }
            $cache[$nit] = $code;
            $digits = preg_replace('/\D+/', '', $nit);
            if ($digits !== '') {
                $cache[$digits] = $code;
                $noZeros = ltrim($digits, '0');
                if ($noZeros !== '') {
                    $cache[$noZeros] = $code;
                }
            }
        }
    }
    return $cache;
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
    if ($code !== '' && is_file($asesorClientesIndexFile)) {
        $data = json_decode((string) file_get_contents($asesorClientesIndexFile), true);
        if (is_array($data) && isset($data['by_codigo'][$code]['bitrix_ids']) && is_array($data['by_codigo'][$code]['bitrix_ids'])) {
            foreach ($data['by_codigo'][$code]['bitrix_ids'] as $id) {
                if ($id !== null && $id !== '') {
                    $ids[(string) $id] = true;
                }
            }
        }
    }
    if (!$ids) {
        foreach (bitrix_seller_map() as $id => $name) {
            if (resolve_asesor_codigo_from_bitrix_id($id) === $code) {
                $ids[(string) $id] = true;
            }
        }
    }
    return array_keys($ids);
}

function quote_matches_asesor($quote, $codigo, $nitSet, $bitrixIds) {
    $sellerCode = normalize_asesor_codigo($quote['seller_codigo'] ?? '');
    if ($sellerCode !== '' && $sellerCode === $codigo) {
        return true;
    }
    $assigned = (string) ($quote['assigned_by_id'] ?? '');
    if ($assigned !== '' && isset($bitrixIds[$assigned])) {
        return true;
    }
    return nit_in_asesor_set($quote['nit'] ?? '', $nitSet);
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
    if ($e === 'cotizado' || $e === 'cotizada') {
        return 'cotizado';
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
    if ($e === 'cotizado' || $e === 'cotizada') {
        return 'cotizado';
    }
    return '';
}

function get_quotes_for_asesor($codigo, $filtro = 'all') {
    global $quotesFile;
    $code = normalize_asesor_codigo($codigo);
    $want = strtolower(trim((string) $filtro));
    if ($want === 'nuevo' || $want === 'new') {
        $want = 'nuevas';
    }
    if ($want === 'cotizado' || $want === 'cotizados') {
        $want = 'historial';
    }
    if ($want !== 'nuevas' && $want !== 'historial') {
        $want = 'all';
    }
    $nitSet = asesor_nit_variants_set($code);
    $bitrixIds = [];
    foreach (get_asesor_bitrix_ids($code) as $id) {
        $bitrixIds[(string) $id] = true;
    }
    $quotes = read_quotes($quotesFile);
    usort($quotes, function ($a, $b) {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    $safe = [];
    $countNuevas = 0;
    $countHistorial = 0;
    foreach ($quotes as $q) {
        if (!is_array($q) || !quote_matches_asesor($q, $code, $nitSet, $bitrixIds)) {
            continue;
        }
        $estado = quote_asesor_estado($q);
        if ($estado === 'nueva') {
            $countNuevas++;
        } else {
            $countHistorial++;
        }
        if ($want === 'nuevas' && $estado !== 'nueva') {
            continue;
        }
        if ($want === 'historial' && $estado === 'nueva') {
            continue;
        }
        $safe[] = [
            'id' => (string) ($q['id'] ?? ''),
            'nit' => (string) ($q['nit'] ?? ''),
            'nombre' => trim((string) ($q['nombre'] ?? '')),
            'created_at' => (string) ($q['created_at'] ?? ''),
            'trm' => $q['trm'] ?? null,
            'items' => is_array($q['items'] ?? null) ? $q['items'] : [],
            'totals' => is_array($q['totals'] ?? null) ? $q['totals'] : [],
            'seller_codigo' => normalize_asesor_codigo($q['seller_codigo'] ?? ''),
            'assigned_by_id' => (string) ($q['assigned_by_id'] ?? ''),
            'seller_name' => (string) ($q['seller_name'] ?? ''),
            'asesor_estado' => $estado,
            'asesor_cotizado_at' => (string) ($q['asesor_cotizado_at'] ?? ''),
        ];
    }
    return [
        'quotes' => $safe,
        'count' => count($safe),
        'count_nuevas' => $countNuevas,
        'count_historial' => $countHistorial,
    ];
}

function get_asesor_clientes_merged($codigo) {
    $byNit = [];
    foreach (get_asesor_clientes($codigo) as $c) {
        $nit = normalize_nit($c['nit'] ?? '');
        if ($nit === '') {
            continue;
        }
        $telefono = trim((string) ($c['telefono'] ?? ''));
        if ($telefono === '') {
            $telefono = resolve_cliente_telefono_from_index($nit, '');
        }
        $byNit[$nit] = [
            'nit' => $nit,
            'nombre' => trim((string) ($c['nombre'] ?? $nit)) ?: $nit,
            'telefono' => $telefono,
        ];
    }
    foreach ((get_quotes_for_asesor($codigo, 'all')['quotes'] ?? []) as $q) {
        $nit = normalize_nit($q['nit'] ?? '');
        if ($nit === '') {
            continue;
        }
        $nombreQuote = trim((string) ($q['nombre'] ?? ''));
        $nombre = resolve_cliente_nombre_from_index($nit, $nombreQuote);
        $telefono = resolve_cliente_telefono_from_index($nit, '');
        if (!isset($byNit[$nit])) {
            $byNit[$nit] = [
                'nit' => $nit,
                'nombre' => $nombre !== '' ? $nombre : $nit,
                'telefono' => $telefono,
            ];
        } else {
            $current = trim((string) ($byNit[$nit]['nombre'] ?? ''));
            if (($current === '' || $current === $nit) && $nombre !== '' && $nombre !== $nit) {
                $byNit[$nit]['nombre'] = $nombre;
            }
            if (trim((string) ($byNit[$nit]['telefono'] ?? '')) === '' && $telefono !== '') {
                $byNit[$nit]['telefono'] = $telefono;
            }
        }
    }
    $out = array_values($byNit);
    usort($out, function ($a, $b) {
        return strcmp((string) ($a['nombre'] ?? ''), (string) ($b['nombre'] ?? ''));
    });
    return $out;
}

function normalize_asesor_codigo($codigo) {
    $c = strtoupper(preg_replace('/[\s.]/', '', trim((string) $codigo)));
    if (preg_match('/^V(\d{1,4})$/', $c, $m)) {
        return 'V' . (string) ((int) $m[1]);
    }
    return '';
}
function read_asesores($path) {
    if (!is_file($path)) {
        return [];
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? $data : [];
}

function write_asesores($path, $asesores) {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
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
        $safe[] = [
            'codigo' => $codigo,
            'nombre' => $nombre,
            'password_hash' => $hash,
            'created_at' => (string) ($a['created_at'] ?? date('c')),
        ];
    }
    $json = json_encode(array_values($safe), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    return file_put_contents($path, $json . "\n", LOCK_EX) !== false;
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
        return [];
    }
    $raw = file_get_contents($path);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function write_users($path, $users) {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $json = json_encode(array_values($users), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    return file_put_contents($path, $json . "\n", LOCK_EX) !== false;
}

function read_quotes($path) {
    if (!is_file($path)) {
        return [];
    }
    $raw = file_get_contents($path);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function write_quotes($path, $quotes) {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $json = json_encode(array_values($quotes), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    return file_put_contents($path, $json . "\n", LOCK_EX) !== false;
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
    $marcaField = trim((string) ($data['marca_field'] ?? ''));
    if ($marcaField === '') {
        $marcaField = 'UF_CRM_1749499637';
    }
    $razonField = trim((string) ($data['company_razon_field'] ?? ''));
    if ($razonField === '') {
        $razonField = 'UF_CRM_1746192546';
    }
    return array_merge($defaults, [
        'enabled' => !empty($data['enabled']),
        'webhook_base' => normalize_bitrix_webhook($data['webhook_base'] ?? ''),
        'stage_id' => trim((string) ($data['stage_id'] ?? '')),
        'category_id' => trim((string) ($data['category_id'] ?? '')),
        'currency_id' => strtoupper(trim((string) ($data['currency_id'] ?? 'COP'))) ?: 'COP',
        'marca_field' => $marcaField,
        'company_razon_field' => $razonField,
        'updated_at' => (string) ($data['updated_at'] ?? ''),
        'updated_by_nit' => (string) ($data['updated_by_nit'] ?? ''),
    ]);
}

function write_bitrix($path, $cfg) {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $json = json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    return file_put_contents($path, $json . "\n", LOCK_EX) !== false;
}

function bitrix_rest($webhookBase, $method, $payload) {
    $base = normalize_bitrix_webhook($webhookBase);
    if ($base === '' || !function_exists('curl_init')) {
        return null;
    }
    $url = $base . ltrim($method, '/');
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json; charset=utf-8'],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 20,
    ]);
    $raw = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false || $err) {
        return null;
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
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
    $lines[] = 'NIT: ' . ($quote['nit'] ?? '');
    $lines[] = 'Cliente: ' . ($quote['nombre'] ?? '');
    $lines[] = 'TRM: ' . ($quote['trm'] ?? '');
    $lines[] = 'Fecha: ' . ($quote['created_at'] ?? '');
    $lines[] = '';
    $lines[] = 'Productos:';
    foreach (($quote['items'] ?? []) as $item) {
        if (!is_array($item)) {
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

function ensure_bitrix_company($webhookBase, $nit, $nombre) {
    $nit = trim((string) $nit);
    if ($nit === '') {
        return null;
    }
    $found = bitrix_rest($webhookBase, 'crm.company.list.json', [
        'filter' => ['TITLE' => $nit],
        'select' => ['ID', 'TITLE'],
    ]);
    $existing = bitrix_first_id($found);
    if ($existing) {
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

function ensure_bitrix_contact($webhookBase, $nombre, $companyId = null, $nit = '') {
    $nombre = trim((string) $nombre);
    if ($nombre === '') {
        return null;
    }

    $filter = ['NAME' => $nombre];
    if ($companyId) {
        $filter['COMPANY_ID'] = $companyId;
    }
    $found = bitrix_rest($webhookBase, 'crm.contact.list.json', [
        'filter' => $filter,
        'select' => ['ID', 'NAME', 'LAST_NAME', 'COMPANY_ID'],
    ]);
    $existing = bitrix_first_id($found);
    if ($existing) {
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
        if (!is_array($item)) {
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
    $n = normalize_nit($nit);
    $list = [];
    if ($n !== '') {
        $list[] = $n;
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

function send_bitrix_deal($quote) {
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

    $forcedAssigned = trim((string) ($quote['assigned_by_id'] ?? ''));
    if ($forcedAssigned !== '') {
        $forcedName = trim((string) ($quote['seller_name'] ?? ''));
        if ($forcedName === '') {
            $forcedName = bitrix_user_display_name($cfg['webhook_base'], $forcedAssigned);
        }
        $sellerInfo = [
            'found' => true,
            'seller_missing' => false,
            'assigned_by_id' => $forcedAssigned,
            'seller_name' => $forcedName,
            'razon_social' => '',
            'warning' => '',
            'source' => 'quote',
        ];
    } else {
        $sellerInfo = find_bitrix_seller_by_nit($cfg['webhook_base'], $cfg, $nit);
    }

    $companyId = ensure_bitrix_company($cfg['webhook_base'], $nit, $nombre);
    $contactId = ensure_bitrix_contact($cfg['webhook_base'], $nombre, $companyId, $nit);
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

    $marcaId = get_quote_marca_id($cfg['webhook_base'], $cfg, $quote);
    $fields = [
        'STAGE_ID' => $cfg['stage_id'],
        'OPPORTUNITY' => $opportunity,
        'CURRENCY_ID' => $dealCurrency,
        'COMMENTS' => format_bitrix_comments($quote),
        'OPENED' => 'Y',
        'COMPANY_ID' => $companyId,
        'CONTACT_ID' => $contactId,
        'CONTACT_IDS' => [(int) $contactId],
    ];
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
    // Titulo en espanol sin acentos (evita mojibake)
    $updateFields = ['TITLE' => 'Negociacion #' . $dealId];
    if (!empty($sellerInfo['assigned_by_id'])) {
        $updateFields['ASSIGNED_BY_ID'] = (int) $sellerInfo['assigned_by_id'];
    }
    bitrix_rest($cfg['webhook_base'], 'crm.deal.update.json', [
        'id' => $dealId,
        'fields' => $updateFields,
    ]);
    bitrix_rest($cfg['webhook_base'], 'crm.deal.contact.add.json', [
        'id' => $dealId,
        'fields' => [
            'CONTACT_ID' => $contactId,
            'IS_PRIMARY' => 'Y',
        ],
    ]);

    $rows = build_bitrix_product_rows($quote, $dealCurrency);
    $products = bitrix_rest($cfg['webhook_base'], 'crm.deal.productrows.set.json', [
        'id' => $dealId,
        'rows' => $rows,
    ]);
    $productsOk = is_array($products) && empty($products['error']);

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

function normalize_nit($nit) {
    $nit = trim((string) $nit);
    $nit = preg_replace('/[\s.]/', '', $nit);
    return $nit;
}

function find_user($users, $nit) {
    foreach ($users as $i => $u) {
        if (isset($u['nit']) && normalize_nit($u['nit']) === $nit) {
            return [$i, $u];
        }
    }
    return [null, null];
}

function hash_password($password) {
    $iterations = 100000;
    $salt = random_bytes(16);
    $hash = hash_pbkdf2('sha256', $password, $salt, $iterations, 32, true);
    return 'pbkdf2$' . $iterations . '$' . base64_encode($salt) . '$' . base64_encode($hash);
}

function verify_password($password, $user) {
    $stored = (string) ($user['password_hash'] ?? '');
    if ($stored !== '' && str_starts_with($stored, 'pbkdf2$')) {
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
        return hash_equals($expected, $actual);
    }

    // Compatibilidad con registros viejos en texto plano
    $legacy = (string) ($user['password'] ?? '');
    return $legacy !== '' && hash_equals($legacy, $password);
}

function public_user($nit, $passwordHash, $createdAt, $nombre = '') {
    return [
        'nit' => $nit,
        'nombre' => trim((string) $nombre),
        'password_hash' => $passwordHash,
        'created_at' => $createdAt ?: date('c'),
    ];
}

function json_out($payload, $code = 200) {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

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

    if ($nombre === '' || mb_strlen($nombre) < 2) {
        json_out(['ok' => false, 'error' => 'Ingresa un nombre válido (mínimo 2 caracteres).'], 400);
    }
    if ($nit === '' || !preg_match('/^\d{6,15}(-\d)?$/', $nit)) {
        json_out(['ok' => false, 'error' => 'NIT inválido. Usa solo números (opcional dígito de verificación).'], 400);
    }
    if (strlen($password) < 4) {
        json_out(['ok' => false, 'error' => 'La contraseña debe tener al menos 4 caracteres.'], 400);
    }

    $users = read_users($usersFile);
    [, $existing] = find_user($users, $nit);
    if ($existing) {
        json_out(['ok' => false, 'error' => 'Este NIT ya está registrado.'], 409);
    }

    $users[] = public_user($nit, hash_password($password), date('c'), $nombre);

    if (!write_users($usersFile, $users)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el usuario en el archivo.'], 500);
    }

    json_out(['ok' => true, 'nit' => $nit, 'nombre' => $nombre, 'message' => 'Registro exitoso.']);
}

if ($action === 'login') {
    $rawLogin = (string) ($body['nit'] ?? '');
    $password = (string) ($body['password'] ?? '');
    $asesorCode = normalize_asesor_codigo($rawLogin);
    $nit = normalize_nit($rawLogin);

    if (($asesorCode === '' && $nit === '') || $password === '') {
        json_out(['ok' => false, 'error' => 'Ingresa usuario y contraseña.'], 400);
    }

    if ($asesorCode !== '') {
        global $asesoresFile;
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
            'message' => 'Sesión iniciada.',
        ]);
    }

    $users = read_users($usersFile);
    [$idx, $user] = find_user($users, $nit);
    if (!$user || !verify_password($password, $user)) {
        json_out(['ok' => false, 'error' => 'NIT o contraseña incorrectos.'], 401);
    }

    if (empty($user['password_hash'])) {
        $users[$idx] = public_user($user['nit'], hash_password($password), $user['created_at'] ?? date('c'), $user['nombre'] ?? '');
        write_users($usersFile, $users);
        $user = $users[$idx];
    }

    $role = in_array($nit, ['03166122778'], true) ? 'admin' : 'cliente';
    json_out([
        'ok' => true,
        'nit' => $user['nit'],
        'nombre' => (string) ($user['nombre'] ?? ''),
        'role' => $role,
        'message' => 'Sesión iniciada.',
    ]);
}

$adminNits = ['03166122778'];

if ($action === 'register_asesor') {
    global $asesoresFile, $adminNits;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if ($adminNit === '' || !in_array($adminNit, $adminNits, true)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $codigo = normalize_asesor_codigo($body['codigo'] ?? ($body['nit'] ?? ''));
    $password = (string) ($body['password'] ?? '');
    $nombre = trim((string) ($body['nombre'] ?? ''));
    if ($codigo === '') {
        json_out(['ok' => false, 'error' => 'Código de vendedor inválido. Usa V1, V2, V31, etc.'], 400);
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
    $asesores[] = [
        'codigo' => $codigo,
        'nombre' => $nombre,
        'password_hash' => hash_password($password),
        'created_at' => date('c'),
    ];
    if (!write_asesores($asesoresFile, $asesores)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el asesor.'], 500);
    }
    json_out([
        'ok' => true,
        'codigo' => $codigo,
        'nombre' => $nombre,
        'message' => 'Asesor ' . $codigo . ' registrado.',
    ]);
}

if ($action === 'list_asesores') {
    global $asesoresFile, $adminNits;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if ($adminNit === '' || !in_array($adminNit, $adminNits, true)) {
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
            'created_at' => (string) ($a['created_at'] ?? ''),
        ];
    }
    json_out(['ok' => true, 'asesores' => $safe, 'count' => count($safe)]);
}

if ($action === 'delete_asesor') {
    global $asesoresFile, $adminNits;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if ($adminNit === '' || !in_array($adminNit, $adminNits, true)) {
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

if ($action === 'list_clientes_asesor') {
    global $asesoresFile;
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit'] ?? ''));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $clientes = get_asesor_clientes_merged($codigo);
    json_out([
        'ok' => true,
        'codigo' => $codigo,
        'clientes' => $clientes,
        'count' => count($clientes),
    ]);
}

if ($action === 'list_quotes_asesor') {
    global $asesoresFile;
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit'] ?? ''));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $filtro = strtolower(trim((string) ($body['filtro'] ?? ($body['estado'] ?? 'historial'))));
    $bundle = get_quotes_for_asesor($codigo, $filtro);
    json_out([
        'ok' => true,
        'quotes' => $bundle['quotes'],
        'count' => $bundle['count'],
        'count_nuevas' => $bundle['count_nuevas'],
        'count_historial' => $bundle['count_historial'],
        'filtro' => $filtro,
        'role' => 'asesor',
        'codigo' => $codigo,
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
    $ownedIds = [];
    foreach ((get_quotes_for_asesor($codigo, 'all')['quotes'] ?? []) as $row) {
        $ownedIds[(string) ($row['id'] ?? '')] = true;
    }
    if (!isset($ownedIds[$quoteId])) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
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
        json_out(['ok' => false, 'error' => 'Estado inválido. Usa cotizado, seguimiento o vendido.'], 400);
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
    $ownedIds = [];
    foreach ((get_quotes_for_asesor($codigo, 'all')['quotes'] ?? []) as $row) {
        $ownedIds[(string) ($row['id'] ?? '')] = true;
    }
    if (!isset($ownedIds[$quoteId])) {
        json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
    }

    $quotes = read_quotes($quotesFile);
    $found = false;
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
    $labels = [
        'cotizado' => 'Cotizado',
        'seguimiento' => 'Seguimiento',
        'vendido' => 'Vendido',
    ];
    $bundle = get_quotes_for_asesor($codigo, 'all');
    json_out([
        'ok' => true,
        'message' => 'Estado actualizado a ' . ($labels[$estado] ?? $estado) . '.',
        'quote_id' => $quoteId,
        'asesor_estado' => $estado,
        'count_nuevas' => $bundle['count_nuevas'],
        'count_historial' => $bundle['count_historial'],
    ]);
}

if ($action === 'finish_quote_asesor') {
    global $asesoresFile, $quotesFile;
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit_asesor'] ?? ''));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
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
    if ($clientNit === '') {
        json_out(['ok' => false, 'error' => 'Falta el NIT del cliente.'], 400);
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

    $quotes = read_quotes($quotesFile);
    $updatedQuote = null;
    $isNew = ($quoteId === '');

    if ($isNew) {
        $nitSet = asesor_nit_variants_set($codigo);
        if (!nit_in_asesor_set($clientNit, $nitSet)) {
            json_out(['ok' => false, 'error' => 'Ese cliente no está asignado a tu código de vendedor.'], 403);
        }
        if ($clientNombre === '') {
            $clientNombre = $clientNit;
        }
        $quoteId = date('YmdHis') . substr((string) microtime(true), -6) . '-' . $clientNit;
        $updatedQuote = [
            'id' => $quoteId,
            'nit' => $clientNit,
            'nombre' => $clientNombre,
            'created_at' => date('c'),
            'trm' => $body['trm'] ?? null,
            'items' => $items,
            'totals' => is_array($body['totals'] ?? null) ? $body['totals'] : [],
            'seller_codigo' => $codigo,
            'assigned_by_id' => $sellerAssigned,
            'seller_name' => $sellerName,
            'asesor_estado' => 'cotizado',
            'asesor_cotizado_at' => date('c'),
            'asesor_cotizado_by' => $codigo,
            'quote_source' => 'asesor',
            'finished_at' => date('c'),
        ];
        $quotes[] = $updatedQuote;
    } else {
        $ownedIds = [];
        foreach ((get_quotes_for_asesor($codigo, 'all')['quotes'] ?? []) as $row) {
            $ownedIds[(string) ($row['id'] ?? '')] = true;
        }
        if (!isset($ownedIds[$quoteId])) {
            json_out(['ok' => false, 'error' => 'Cotización no encontrada para este asesor.'], 404);
        }
        foreach ($quotes as &$q) {
            if (!is_array($q) || (string) ($q['id'] ?? '') !== $quoteId) {
                continue;
            }
            if ($clientNit !== '') {
                $q['nit'] = $clientNit;
            }
            if ($clientNombre !== '') {
                $q['nombre'] = $clientNombre;
            }
            $q['trm'] = $body['trm'] ?? null;
            $q['items'] = $items;
            $q['totals'] = is_array($body['totals'] ?? null) ? $body['totals'] : [];
            $q['seller_codigo'] = $codigo;
            $q['assigned_by_id'] = $sellerAssigned;
            $q['seller_name'] = $sellerName;
            $q['asesor_estado'] = 'cotizado';
            $q['asesor_cotizado_at'] = date('c');
            $q['asesor_cotizado_by'] = $codigo;
            $q['quote_source'] = 'asesor';
            $q['finished_at'] = date('c');
            $updatedQuote = $q;
            break;
        }
        unset($q);
        if (!$updatedQuote) {
            json_out(['ok' => false, 'error' => 'Cotización no encontrada.'], 404);
        }
    }

    if (!write_quotes($quotesFile, $quotes)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar.'], 500);
    }

    $bitrix = send_bitrix_deal($updatedQuote);
    if (!empty($bitrix['ok'])) {
        $changed = false;
        if (!empty($bitrix['assigned_by_id'])) {
            $updatedQuote['assigned_by_id'] = $bitrix['assigned_by_id'];
            $resolved = resolve_asesor_codigo_from_bitrix_id($bitrix['assigned_by_id']);
            if ($resolved !== '') {
                $updatedQuote['seller_codigo'] = $resolved;
            }
            $changed = true;
        }
        if (!empty($bitrix['seller_name'])) {
            $updatedQuote['seller_name'] = (string) $bitrix['seller_name'];
            $changed = true;
        }
        if ($changed) {
            foreach ($quotes as &$q) {
                if ((string) ($q['id'] ?? '') === $quoteId) {
                    $q = $updatedQuote;
                    break;
                }
            }
            unset($q);
            write_quotes($quotesFile, $quotes);
        }
    }

    $message = 'Cotización terminada y movida al historial.';
    if (!empty($bitrix['ok'])) {
        $message = 'Cotización terminada, enviada a Bitrix (negocio #' . ($bitrix['deal_id'] ?? '') . ') y marcada como Cotizado.';
        if (!empty($bitrix['seller_name'])) {
            $message .= ' Responsable: ' . $bitrix['seller_name'] . '.';
        }
    } elseif (empty($bitrix['skipped'])) {
        $message = 'Cotización marcada como Cotizado, pero Bitrix falló: ' . ($bitrix['error'] ?? '');
    }

    $bundle = get_quotes_for_asesor($codigo, 'all');
    json_out([
        'ok' => true,
        'message' => $message,
        'quote_id' => $quoteId,
        'bitrix' => $bitrix,
        'count_nuevas' => $bundle['count_nuevas'],
        'count_historial' => $bundle['count_historial'],
    ]);
}

if ($action === 'list') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if ($adminNit === '' || !in_array($adminNit, $adminNits, true)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $users = read_users($usersFile);
    $safe = [];
    foreach ($users as $u) {
        $safe[] = [
            'nit' => (string) ($u['nit'] ?? ''),
            'nombre' => trim((string) ($u['nombre'] ?? '')),
            'created_at' => (string) ($u['created_at'] ?? ''),
        ];
    }
    json_out(['ok' => true, 'users' => $safe, 'count' => count($safe)]);
}

if ($action === 'delete') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if ($adminNit === '' || !in_array($adminNit, $adminNits, true)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $nit = normalize_nit($body['nit'] ?? '');
    if ($nit === '' || !preg_match('/^\d{6,15}(-\d)?$/', $nit)) {
        json_out(['ok' => false, 'error' => 'NIT inválido.'], 400);
    }
    if ($nit === $adminNit) {
        json_out(['ok' => false, 'error' => 'No puedes eliminar tu propia cuenta de administrador.'], 400);
    }
    $users = read_users($usersFile);
    $next = [];
    $removed = false;
    foreach ($users as $u) {
        if (normalize_nit($u['nit'] ?? '') === $nit) {
            $removed = true;
            continue;
        }
        $next[] = $u;
    }
    if (!$removed) {
        json_out(['ok' => false, 'error' => 'Usuario no encontrado.'], 404);
    }
    if (!write_users($usersFile, $next)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar el archivo.'], 500);
    }
    json_out(['ok' => true, 'nit' => $nit, 'message' => 'Usuario eliminado.']);
}

if ($action === 'upsert') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if ($adminNit === '' || !in_array($adminNit, $adminNits, true)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
    }
    $nit = normalize_nit($body['nit'] ?? '');
    $nombre = trim((string) ($body['nombre'] ?? ''));
    $hash = (string) ($body['password_hash'] ?? '');
    $created = (string) ($body['created_at'] ?? date('c'));
    if ($nit === '' || !preg_match('/^\d{6,15}(-\d)?$/', $nit)) {
        json_out(['ok' => false, 'error' => 'NIT inválido.'], 400);
    }
    if ($hash === '' || !str_starts_with($hash, 'pbkdf2$')) {
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
        if ($existingHash !== '' && str_starts_with($existingHash, 'pbkdf2$')) {
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
    $nit = normalize_nit($body['nit'] ?? '');
    $nombre = trim((string) ($body['nombre'] ?? ''));
    if ($nit === '' || !preg_match('/^\d{6,15}(-\d)?$/', $nit)) {
        json_out(['ok' => false, 'error' => 'NIT inválido.'], 400);
    }
    $users = read_users($usersFile);
    [, $user] = find_user($users, $nit);
    if (!$user) {
        json_out(['ok' => false, 'error' => 'Usuario no registrado.'], 403);
    }
    if ($nombre === '') {
        $nombre = trim((string) ($user['nombre'] ?? ''));
    }
    $items = $body['items'] ?? [];
    if (!is_array($items) || count($items) === 0) {
        json_out(['ok' => false, 'error' => 'La cotización no tiene productos.'], 400);
    }
    $sellerCodigo = '';
    $sellerAssigned = null;
    $sellerName = '';
    $cfg = read_bitrix($bitrixFile);
    if (!empty($cfg['enabled']) && !empty($cfg['webhook_base'])) {
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
        'items' => $items,
        'totals' => is_array($body['totals'] ?? null) ? $body['totals'] : [],
        'seller_codigo' => $sellerCodigo,
        'assigned_by_id' => $sellerAssigned,
        'seller_name' => $sellerName,
        'asesor_estado' => 'nueva',
    ];
    $quotes = read_quotes($quotesFile);
    $quotes[] = $quote;
    if (!write_quotes($quotesFile, $quotes)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar la cotización.'], 500);
    }
    $bitrix = send_bitrix_deal($quote);
    if (!empty($bitrix['ok'])) {
        $changed = false;
        if (!empty($bitrix['assigned_by_id'])) {
            $quote['assigned_by_id'] = $bitrix['assigned_by_id'];
            $resolved = resolve_asesor_codigo_from_bitrix_id($bitrix['assigned_by_id']);
            if ($resolved !== '') {
                $quote['seller_codigo'] = $resolved;
            }
            $changed = true;
        }
        if (!empty($bitrix['seller_name'])) {
            $quote['seller_name'] = (string) $bitrix['seller_name'];
            $changed = true;
        }
        if ($changed) {
            $quotes[count($quotes) - 1] = $quote;
            write_quotes($quotesFile, $quotes);
        }
    }
    $message = 'Cotización guardada.';
    if (!empty($bitrix['ok'])) {
        $message = 'Cotización guardada y enviada a Bitrix (negocio #' . ($bitrix['deal_id'] ?? '') . ').';
        if (!empty($bitrix['seller_name'])) {
            $message .= ' Responsable: ' . $bitrix['seller_name'] . '.';
        }
        if (!empty($bitrix['seller_missing']) && !empty($bitrix['seller_warning'])) {
            $message .= ' Aviso: ' . $bitrix['seller_warning'];
        }
        if (isset($bitrix['products_ok']) && $bitrix['products_ok'] === false) {
            $message .= ' Productos/MARCA: revisar en Bitrix.';
        }
    } elseif (empty($bitrix['skipped'])) {
        $message = 'Cotización guardada, pero Bitrix falló: ' . ($bitrix['error'] ?? '');
    }
    json_out(['ok' => true, 'id' => $quote['id'], 'message' => $message, 'bitrix' => $bitrix]);
}

if ($action === 'get_bitrix') {
    global $bitrixFile, $adminNits;
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if ($adminNit === '' || !in_array($adminNit, $adminNits, true)) {
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
    if ($adminNit === '' || !in_array($adminNit, $adminNits, true)) {
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
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if ($adminNit === '' || !in_array($adminNit, $adminNits, true)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
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
        json_out(['ok' => false, 'error' => 'Falta webhook_base.'], 400);
    }
    $profile = bitrix_rest($cfg['webhook_base'], 'profile.json', []);
    if ($profile === null) {
        json_out(['ok' => false, 'error' => 'No se pudo contactar Bitrix.'], 502);
    }
    $stages = [];
    if ($cfg['category_id'] !== '') {
        $stageRes = bitrix_rest($cfg['webhook_base'], 'crm.dealcategory.stage.list.json', ['id' => $cfg['category_id']]);
        if (is_array($stageRes) && isset($stageRes['result']) && is_array($stageRes['result'])) {
            $stages = $stageRes['result'];
        }
    }
    json_out([
        'ok' => true,
        'message' => 'Webhook Bitrix responde correctamente.',
        'profile' => $profile['result'] ?? null,
        'stages' => $stages,
        'stage_id' => $cfg['stage_id'],
    ]);
}

if ($action === 'list_quotes') {
    $adminNit = normalize_nit($body['admin_nit'] ?? '');
    if ($adminNit === '' || !in_array($adminNit, $adminNits, true)) {
        json_out(['ok' => false, 'error' => 'No autorizado.'], 403);
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
        $seller = resolve_quote_seller_label($q);
        $safe[] = [
            'id' => (string) ($q['id'] ?? ''),
            'nit' => (string) ($q['nit'] ?? ''),
            'nombre' => trim((string) ($q['nombre'] ?? '')),
            'created_at' => (string) ($q['created_at'] ?? ''),
            'trm' => $q['trm'] ?? null,
            'items' => is_array($q['items'] ?? null) ? $q['items'] : [],
            'totals' => is_array($q['totals'] ?? null) ? $q['totals'] : [],
            'seller_codigo' => $seller['seller_codigo'],
            'assigned_by_id' => $seller['assigned_by_id'],
            'seller_name' => $seller['seller_name'],
            'seller_label' => $seller['seller_label'],
            'asesor_estado' => quote_asesor_estado($q),
        ];
    }
    json_out(['ok' => true, 'quotes' => $safe, 'count' => count($safe)]);
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
        $safe[] = [
            'id' => (string) ($q['id'] ?? ''),
            'nit' => (string) ($q['nit'] ?? ''),
            'nombre' => trim((string) ($q['nombre'] ?? '')),
            'created_at' => (string) ($q['created_at'] ?? ''),
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
    if ($adminNit === '' || !in_array($adminNit, $adminNits, true)) {
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

json_out(['ok' => false, 'error' => 'Acción no válida.'], 400);
