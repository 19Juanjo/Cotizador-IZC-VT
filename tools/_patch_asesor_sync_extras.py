#!/usr/bin/env python3
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "api" / "auth.php"
t = p.read_text(encoding="utf-8")

old = """function asesor_clientes_for_quote_matching($codigo) {
    $code = normalize_asesor_codigo($codigo);
    if ($code === '') {
        return [];
    }
    $byNit = [];
    $sync = sync_asesor_clientes_from_bitrix($code, false, true);
    foreach (($sync['clientes'] ?? []) as $c) {
        if (!is_array($c)) {
            continue;
        }
        $nit = normalize_nit($c['nit'] ?? '');
        if ($nit !== '') {
            $byNit[$nit] = $c;
        }
    }
    foreach (array_merge(get_asesor_clientes($code), get_asesor_clientes_manual($code)) as $c) {"""

new = """function asesor_clientes_for_quote_matching($codigo) {
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
    foreach (array_merge(get_asesor_clientes($code), get_asesor_clientes_manual($code)) as $c) {"""

if old not in t:
    raise SystemExit("matching block missing")
t = t.replace(old, new, 1)

old2 = """    $byNit = [];

    $sync = sync_asesor_clientes_from_bitrix($codigo, $force, $fast && !$force);
    $syncMeta['synced'] = !empty($sync['synced']);
    $syncMeta['from_cache'] = !empty($sync['from_cache']);
    $syncMeta['error'] = (string) ($sync['error'] ?? '');
    $syncMeta['fetched_at'] = (string) ($sync['fetched_at'] ?? '');
    $syncMeta['bitrix_count'] = is_array($sync['clientes'] ?? null) ? count($sync['clientes']) : 0;
    foreach (($sync['clientes'] ?? []) as $c) {
        $nit = normalize_nit($c['nit'] ?? '');
        if ($nit === '') {
            continue;
        }
        $byNit[$nit] = [
            'nit' => $nit,
            'nombre' => trim((string) ($c['nombre'] ?? $nit)) ?: $nit,
            'telefono' => trim((string) ($c['telefono'] ?? '')),
            'manual' => false,
            'activity_at' => (string) ($c['activity_at'] ?? ($c['updated_at'] ?? ($c['created_at'] ?? ''))),
        ];
    }

    foreach (array_merge(get_asesor_clientes($codigo), get_asesor_clientes_manual($codigo)) as $c) {"""

new2 = """    $byNit = [];

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

    foreach (array_merge(get_asesor_clientes($codigo), get_asesor_clientes_manual($codigo)) as $c) {"""

if old2 not in t:
    raise SystemExit("merged block missing")
t = t.replace(old2, new2, 1)

p.write_text(t, encoding="utf-8")
print("ok sync loops")
