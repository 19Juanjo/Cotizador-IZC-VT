<?php
/**
 * Admin: clientes sin vendedor + asignación a asesor.
 * Incluido desde api/auth.php.
 */

function clientes_sin_vendedor_dismissed_file() {
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'clientes_sin_vendedor_dismissed.json';
}

function read_clientes_sin_vendedor_dismissed() {
    $file = clientes_sin_vendedor_dismissed_file();
    if (!is_file($file)) {
        return [];
    }
    $data = json_decode((string) file_get_contents($file), true);
    if (!is_array($data)) {
        return [];
    }
    $out = [];
    $rows = isset($data['nits']) && is_array($data['nits']) ? $data['nits'] : $data;
    foreach ($rows as $nit) {
        if (is_array($nit)) {
            $nit = $nit['nit'] ?? '';
        }
        $n = normalize_nit($nit);
        if ($n !== '') {
            $out[$n] = true;
        }
    }
    return $out;
}

function write_clientes_sin_vendedor_dismissed(array $map) {
    $file = clientes_sin_vendedor_dismissed_file();
    $nits = array_values(array_keys($map));
    sort($nits);
    return izc_atomic_write_json($file, [
        'updated_at' => date('c'),
        'nits' => $nits,
    ]);
}

function dismiss_cliente_sin_vendedor($nit) {
    $n = normalize_nit($nit);
    if ($n === '') {
        return false;
    }
    $map = read_clientes_sin_vendedor_dismissed();
    if (!empty($map[$n])) {
        return true;
    }
    $map[$n] = true;
    return write_clientes_sin_vendedor_dismissed($map);
}

function undismiss_cliente_sin_vendedor($nit) {
    $n = normalize_nit($nit);
    if ($n === '') {
        return false;
    }
    $map = read_clientes_sin_vendedor_dismissed();
    if (empty($map[$n])) {
        return true;
    }
    unset($map[$n]);
    return write_clientes_sin_vendedor_dismissed($map);
}

function nit_keys_match($a, $b) {
    $na = normalize_nit($a);
    $nb = normalize_nit($b);
    if ($na === '' || $nb === '') {
        return false;
    }
    if ($na === $nb) {
        return true;
    }
    $da = preg_replace('/\D+/', '', $na);
    $db = preg_replace('/\D+/', '', $nb);
    if ($da !== '' && $da === $db) {
        return true;
    }
    $za = ltrim((string) $da, '0');
    $zb = ltrim((string) $db, '0');
    return ($za !== '' && $za === $zb);
}

/** Quita un NIT de todos los asesores en el mapa manual. */
function remove_client_nit_from_asesor_manual($nit) {
    $n = normalize_nit($nit);
    if ($n === '') {
        return false;
    }
    $manual = read_asesor_clientes_manual();
    $changed = false;
    foreach (($manual['by_codigo'] ?? []) as $code => $list) {
        if (!is_array($list)) {
            continue;
        }
        $kept = [];
        foreach ($list as $c) {
            if (!is_array($c)) {
                continue;
            }
            if (normalize_nit($c['nit'] ?? '') === $n) {
                $changed = true;
                continue;
            }
            $kept[] = $c;
        }
        $manual['by_codigo'][$code] = array_values($kept);
    }
    if ($changed) {
        write_asesor_clientes_manual($manual);
    }
    return $changed;
}

/**
 * Clientes con cotización(es) sin vendedor (no llegan a ningún panel de asesor).
 */
function list_clientes_sin_vendedor() {
    global $quotesFile, $usersFile;
    $dismissed = read_clientes_sin_vendedor_dismissed();
    $usersByNit = [];
    foreach (read_users($usersFile) as $u) {
        if (!is_array($u)) {
            continue;
        }
        $nit = normalize_nit($u['nit'] ?? '');
        if ($nit === '') {
            continue;
        }
        if (function_exists('is_zkteco_login_id') && is_zkteco_login_id($nit)) {
            continue;
        }
        $role = strtolower(trim((string) ($u['role'] ?? '')));
        if ($role === 'zkteco' || $role === 'zebra' || $role === 'admin' || $role === 'asesor') {
            continue;
        }
        $usersByNit[$nit] = [
            'nombre' => trim((string) ($u['nombre'] ?? '')),
            'created_at' => (string) ($u['created_at'] ?? ''),
            'registered' => true,
        ];
    }

    $byNit = [];
    foreach (read_quotes($quotesFile) as $q) {
        if (!is_array($q)) {
            continue;
        }
        $nit = quote_effective_nit($q);
        if ($nit === '') {
            continue;
        }
        if (!empty($dismissed[$nit])) {
            continue;
        }
        if (function_exists('is_zkteco_login_id') && is_zkteco_login_id($nit)) {
            continue;
        }
        if (find_asesor_codigo_by_client_nit($nit) !== '') {
            continue;
        }

        $sellerCode = normalize_asesor_codigo($q['seller_codigo'] ?? '');
        if ($sellerCode === '') {
            $sellerCode = resolve_asesor_codigo_from_bitrix_id($q['assigned_by_id'] ?? '');
        }
        $orphan = ($sellerCode === '');

        if (!isset($byNit[$nit])) {
            $byNit[$nit] = [
                'nit' => $nit,
                'nombre' => trim((string) ($q['nombre'] ?? '')),
                'quotes_total' => 0,
                'quotes_sin_vendedor' => 0,
                'last_quote_at' => '',
                'registered' => isset($usersByNit[$nit]),
            ];
        }
        $byNit[$nit]['quotes_total']++;
        if ($orphan) {
            $byNit[$nit]['quotes_sin_vendedor']++;
        }
        $created = (string) ($q['finished_at'] ?? ($q['created_at'] ?? ''));
        if ($created !== '' && strcmp($created, (string) ($byNit[$nit]['last_quote_at'] ?? '')) > 0) {
            $byNit[$nit]['last_quote_at'] = $created;
        }
        if (($byNit[$nit]['nombre'] === '' || $byNit[$nit]['nombre'] === $nit) && trim((string) ($q['nombre'] ?? '')) !== '') {
            $byNit[$nit]['nombre'] = trim((string) $q['nombre']);
        }
    }

    $out = [];
    foreach ($byNit as $nit => $row) {
        if ((int) ($row['quotes_sin_vendedor'] ?? 0) <= 0) {
            continue;
        }
        if (!empty($usersByNit[$nit]['nombre']) && ($row['nombre'] === '' || $row['nombre'] === $nit)) {
            $row['nombre'] = $usersByNit[$nit]['nombre'];
        }
        if ($row['nombre'] === '') {
            $row['nombre'] = $nit;
        }
        $row['registered'] = !empty($usersByNit[$nit]);
        $row['registered_at'] = (string) ($usersByNit[$nit]['created_at'] ?? '');
        $out[] = $row;
    }

    usort($out, function ($a, $b) {
        return strcmp((string) ($b['last_quote_at'] ?? ''), (string) ($a['last_quote_at'] ?? ''));
    });
    return $out;
}

/**
 * Asigna un vendedor a un cliente: mapa manual + sella cotizaciones del NIT.
 */
function assign_vendedor_to_cliente($clientNit, $sellerCodigo, $nombre = '', $adminNit = '') {
    global $quotesFile, $asesoresFile, $asesorClientesManualFile, $usersFile;
    $nit = normalize_nit($clientNit);
    $codigo = normalize_asesor_codigo($sellerCodigo);
    if ($nit === '' || !preg_match('/^\d{6,15}$/', preg_replace('/\D+/', '', $nit))) {
        return ['ok' => false, 'error' => 'NIT inválido.'];
    }
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);
    if (!$asesor) {
        return ['ok' => false, 'error' => 'Vendedor no encontrado.'];
    }
    $nombre = trim((string) $nombre);
    if ($nombre === '') {
        foreach (read_users($usersFile) as $u) {
            if (is_array($u) && normalize_nit($u['nit'] ?? '') === $nit) {
                $nombre = trim((string) ($u['nombre'] ?? ''));
                break;
            }
        }
    }
    if ($nombre === '') {
        foreach (read_quotes($quotesFile) as $q) {
            if (!is_array($q)) {
                continue;
            }
            if (quote_effective_nit($q) !== $nit) {
                continue;
            }
            $nombre = trim((string) ($q['nombre'] ?? ''));
            if ($nombre !== '') {
                break;
            }
        }
    }
    if ($nombre === '') {
        $nombre = $nit;
    }

    remove_client_nit_from_asesor_manual($nit);
    undismiss_cliente_sin_vendedor($nit);
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
        if (normalize_nit($row['nit'] ?? '') !== $nit) {
            continue;
        }
        $row['nombre'] = $nombre;
        $row['updated_at'] = date('c');
        $row['updated_by'] = $adminNit !== '' ? $adminNit : 'admin';
        $row['assigned_by_admin'] = true;
        $updated = true;
        break;
    }
    unset($row);
    if (!$updated) {
        $list[] = [
            'nit' => $nit,
            'nombre' => $nombre,
            'telefono' => '',
            'created_at' => date('c'),
            'created_by' => $adminNit !== '' ? $adminNit : 'admin',
            'assigned_by_admin' => true,
        ];
    }
    $data['by_codigo'][$codigo] = array_values($list);
    if (!write_asesor_clientes_manual($data, $asesorClientesManualFile)) {
        return ['ok' => false, 'error' => 'No se pudo guardar la asignación. Revisa permisos de data/.'];
    }
    build_nit_to_asesor_map(true);

    $bitrixIds = get_asesor_bitrix_ids($codigo);
    $assignedId = $bitrixIds ? (string) $bitrixIds[0] : '';
    $sellerName = seller_name_from_codigo_or_id($codigo, $assignedId);
    if ($sellerName === '') {
        $sellerName = trim((string) ($asesor['nombre'] ?? ''));
        if ($sellerName !== '' && stripos($sellerName, $codigo) === false) {
            $sellerName = $codigo . ' — ' . $sellerName;
        } elseif ($sellerName === '') {
            $sellerName = $codigo;
        }
    }

    $quotes = read_quotes($quotesFile);
    $quotesUpdated = 0;
    foreach ($quotes as &$q) {
        if (!is_array($q)) {
            continue;
        }
        if (quote_effective_nit($q) !== $nit) {
            continue;
        }
        $q['seller_codigo'] = $codigo;
        $q['seller_name'] = $sellerName;
        if ($assignedId !== '') {
            $q['assigned_by_id'] = $assignedId;
        }
        $q['assigned_by_admin'] = true;
        $q['vendedor_asignado_at'] = date('c');
        $q['vendedor_asignado_by'] = $adminNit !== '' ? $adminNit : 'admin';
        $quotesUpdated++;
    }
    unset($q);
    if ($quotesUpdated > 0) {
        write_quotes($quotesFile, $quotes);
    }

    return [
        'ok' => true,
        'quotes_updated' => $quotesUpdated,
        'client' => [
            'nit' => $nit,
            'nombre' => $nombre,
            'vendedor_codigo' => $codigo,
            'vendedor_nombre' => $sellerName,
        ],
    ];
}

/**
 * Quita un cliente de la cola "sin vendedor": borra cotizaciones huérfanas
 * y, si es usuario portal (no admin/asesor), también la cuenta.
 */
function delete_cliente_sin_vendedor($clientNit, $adminNit = '') {
    global $quotesFile, $usersFile, $adminNits;
    $nit = normalize_nit($clientNit);
    if ($nit === '' || !preg_match('/^\d{6,15}$/', preg_replace('/\D+/', '', $nit))) {
        return ['ok' => false, 'error' => 'NIT inválido.'];
    }

    $quotes = read_quotes($quotesFile);
    $kept = [];
    $quotesRemoved = 0;
    foreach ($quotes as $q) {
        if (!is_array($q)) {
            continue;
        }
        $qNit = quote_effective_nit($q);
        if ($qNit === '' || !nit_keys_match($qNit, $nit)) {
            $kept[] = $q;
            continue;
        }
        $sellerCode = normalize_asesor_codigo($q['seller_codigo'] ?? '');
        if ($sellerCode === '') {
            $sellerCode = resolve_asesor_codigo_from_bitrix_id($q['assigned_by_id'] ?? '');
        }
        // Solo quitar cotizaciones sin vendedor (las que alimentan esta cola).
        if ($sellerCode === '') {
            $quotesRemoved++;
            continue;
        }
        $kept[] = $q;
    }
    if ($quotesRemoved > 0) {
        if (!write_quotes($quotesFile, array_values($kept))) {
            return ['ok' => false, 'error' => 'No se pudieron borrar las cotizaciones. Revisa permisos de data/.'];
        }
    }

    $userRemoved = false;
    $users = read_users($usersFile);
    $nextUsers = [];
    foreach ($users as $u) {
        if (!is_array($u) || !nit_keys_match($u['nit'] ?? '', $nit)) {
            if (is_array($u)) {
                $nextUsers[] = $u;
            }
            continue;
        }
        $role = strtolower(trim((string) ($u['role'] ?? '')));
        // Nunca borrar admin/asesor/zkteco/zebra ni la cuenta del admin que ejecuta.
        if (
            $role === 'admin'
            || $role === 'asesor'
            || $role === 'zkteco'
            || $role === 'zebra'
            || (function_exists('is_admin_nit') && is_admin_nit($nit))
            || (is_array($adminNits) && in_array($nit, $adminNits, true))
            || ($adminNit !== '' && nit_keys_match($nit, $adminNit))
        ) {
            $nextUsers[] = $u;
            continue;
        }
        $userRemoved = true;
    }
    if ($userRemoved) {
        if (!write_users($usersFile, array_values($nextUsers))) {
            return ['ok' => false, 'error' => 'Se borraron cotizaciones, pero no se pudo actualizar usuarios.json.'];
        }
    }

    remove_client_nit_from_asesor_manual($nit);
    // Siempre ocultar de la cola, aunque no hubiera nada que borrar (evita reaparición).
    dismiss_cliente_sin_vendedor($nit);

    return [
        'ok' => true,
        'nit' => $nit,
        'quotes_removed' => $quotesRemoved,
        'user_removed' => $userRemoved,
        'dismissed' => true,
        'message' => 'Cliente quitado de la lista'
            . ($quotesRemoved > 0 ? (' (' . $quotesRemoved . ' cotización(es) sin vendedor eliminadas)') : '')
            . ($userRemoved ? ' y cuenta portal eliminada' : '')
            . '.',
    ];
}
