<?php
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
    return array_merge($defaults, [
        'enabled' => !empty($data['enabled']),
        'webhook_base' => normalize_bitrix_webhook($data['webhook_base'] ?? ''),
        'stage_id' => trim((string) ($data['stage_id'] ?? '')),
        'category_id' => trim((string) ($data['category_id'] ?? '')),
        'currency_id' => strtoupper(trim((string) ($data['currency_id'] ?? 'COP'))) ?: 'COP',
        'marca_field' => $marcaField,
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
    $companyId = ensure_bitrix_company($cfg['webhook_base'], $nit, $nombre);
    $contactId = ensure_bitrix_contact($cfg['webhook_base'], $nombre, $companyId, $nit);
    if (!$companyId || !$contactId) {
        return [
            'ok' => false,
            'skipped' => false,
            'error' => 'No se pudo crear Compañía (NIT) o Contacto (nombre) en Bitrix. Revisa permisos CRM del webhook.',
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
    bitrix_rest($cfg['webhook_base'], 'crm.deal.update.json', [
        'id' => $dealId,
        'fields' => ['TITLE' => 'Negociacion #' . $dealId],
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
    $nit = normalize_nit($body['nit'] ?? '');
    $password = (string) ($body['password'] ?? '');

    if ($nit === '' || $password === '') {
        json_out(['ok' => false, 'error' => 'Ingresa NIT y contraseña.'], 400);
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

    json_out([
        'ok' => true,
        'nit' => $user['nit'],
        'nombre' => (string) ($user['nombre'] ?? ''),
        'message' => 'Sesión iniciada.',
    ]);
}

$adminNits = ['03166122778'];

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
    $quote = [
        'id' => date('YmdHis') . substr((string) microtime(true), -6) . '-' . $nit,
        'nit' => $nit,
        'nombre' => $nombre,
        'created_at' => date('c'),
        'trm' => $body['trm'] ?? null,
        'items' => $items,
        'totals' => is_array($body['totals'] ?? null) ? $body['totals'] : [],
    ];
    $quotes = read_quotes($quotesFile);
    $quotes[] = $quote;
    if (!write_quotes($quotesFile, $quotes)) {
        json_out(['ok' => false, 'error' => 'No se pudo guardar la cotización.'], 500);
    }
    $bitrix = send_bitrix_deal($quote);
    $message = 'Cotización guardada.';
    if (!empty($bitrix['ok'])) {
        $message = 'Cotización guardada y enviada a Bitrix (negocio #' . ($bitrix['deal_id'] ?? '') . ').';
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
