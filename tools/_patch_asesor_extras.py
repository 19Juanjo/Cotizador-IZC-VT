#!/usr/bin/env python3
"""Patch auth.php + admin for codigos_extra (merge V6+V28 into one login)."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUTH = ROOT / "api" / "auth.php"


HELPERS = r'''
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

'''


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing block: {label}")
    return text.replace(old, new, 1)


def main() -> None:
    t = AUTH.read_text(encoding="utf-8")

    if "function asesor_all_codigos(" not in t:
        marker = "function normalize_asesor_codigo($codigo) {"
        if marker not in t:
            raise SystemExit("normalize_asesor_codigo not found")
        t = t.replace(marker, HELPERS + marker, 1)
        print("inserted helpers")
    else:
        print("helpers ok")

    # get_asesor_clientes: merge extras
    old_clientes = '''function get_asesor_clientes($codigo) {
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
}'''
    new_clientes = '''function get_asesor_clientes($codigo) {
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
}'''
    if "foreach (asesor_all_codigos($code) as $cCode)" not in t:
        t = replace_once(t, old_clientes, new_clientes, "get_asesor_clientes")
        print("patched get_asesor_clientes")
    else:
        print("get_asesor_clientes ok")

    # get_asesor_clientes_manual merge extras
    old_manual = '''function get_asesor_clientes_manual($codigo) {
    $code = normalize_asesor_codigo($codigo);'''
    # Only expand the body via a more careful approach - read current function
    # Patch asesor_clientes_for_quote_matching instead which already merges get_asesor_clientes + manual
    # Also patch get_asesor_clientes_manual to union extras

    # get_asesor_bitrix_ids
    old_bitrix = '''function get_asesor_bitrix_ids($codigo) {
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
}'''
    new_bitrix = '''function get_asesor_bitrix_ids($codigo) {
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
    if (!$ids) {
        $codeSet = array_fill_keys($codes ?: [$code], true);
        foreach (bitrix_seller_map() as $id => $name) {
            $resolved = resolve_asesor_codigo_from_bitrix_id($id);
            if ($resolved !== '' && !empty($codeSet[$resolved])) {
                $ids[(string) $id] = true;
            }
        }
    }
    return array_keys($ids);
}'''
    if "foreach ($codes as $cCode)" not in t or "function get_asesor_bitrix_ids" not in t.split("foreach ($codes as $cCode)")[0][-200:]:
        if "asesor_all_codigos($code);\n    $ids = [];\n    $codes = asesor_all_codigos" in t:
            print("get_asesor_bitrix_ids already?")
        elif old_bitrix in t:
            t = replace_once(t, old_bitrix, new_bitrix, "get_asesor_bitrix_ids")
            print("patched get_asesor_bitrix_ids")
        else:
            print("WARN: get_asesor_bitrix_ids pattern mismatch")
    else:
        print("get_asesor_bitrix_ids ok")

    # build_nit_to_asesor_map: register via canonical
    old_reg = '''    $register = function ($codigo, $nit) use (&$map) {
        $code = normalize_asesor_codigo($codigo);
        if ($code === '') {
            return;
        }
        foreach (asesor_nit_variant_keys($nit) as $key) {
            if (!isset($map[$key])) {
                $map[$key] = $code;
            }
        }
    };'''
    new_reg = '''    $register = function ($codigo, $nit) use (&$map) {
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
    };'''
    if "asesor_canonical_codigo($codigo)" not in t.split("function build_nit_to_asesor_map")[1][:800]:
        t = replace_once(t, old_reg, new_reg, "build_nit register")
        print("patched build_nit_to_asesor_map")
    else:
        print("build_nit ok")

    # quote_matches_asesor
    old_match = '''function quote_matches_asesor($quote, $codigo, $nitSet, $bitrixIds) {
    if (quote_is_made_by_zkteco($quote)) {
        return false;
    }
    // Cotizaciones GP solo llegan al asesor si el GP lo asignó explícitamente (otra función).
    if (strtolower(trim((string) ($quote['quote_source'] ?? ''))) === 'gp') {
        return false;
    }
    $sellerCode = normalize_asesor_codigo($quote['seller_codigo'] ?? '');
    if ($sellerCode !== '' && $sellerCode === $codigo) {
        return true;
    }
    foreach (['asesor_cotizado_by', 'asesor_estado_by', 'asesor_comentario_by', 'empresa_editado_by', 'recotizado_by', 'flete_editado_by', 'fecha_cierre_by', 'asesor_eliminada_by'] as $field) {
        if (normalize_asesor_codigo($quote[$field] ?? '') === $codigo) {
            return true;
        }
    }
    $assigned = (string) ($quote['assigned_by_id'] ?? '');
    if ($assigned !== '' && isset($bitrixIds[$assigned])) {
        return true;
    }
    // Por si el mapa de IDs Bitrix del índice está desfasado.
    if ($assigned !== '' && resolve_asesor_codigo_from_bitrix_id($assigned) === $codigo) {
        return true;
    }
    $nit = quote_effective_nit($quote);
    if (nit_in_asesor_set($nit, $nitSet)) {
        return true;
    }
    $owner = resolve_asesor_codigo_for_nit($nit);
    return $owner !== '' && $owner === $codigo;
}'''
    new_match = '''function quote_matches_asesor($quote, $codigo, $nitSet, $bitrixIds) {
    if (quote_is_made_by_zkteco($quote)) {
        return false;
    }
    // Cotizaciones GP solo llegan al asesor si el GP lo asignó explícitamente (otra función).
    if (strtolower(trim((string) ($quote['quote_source'] ?? ''))) === 'gp') {
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
}'''
    if "asesor_codes_set($codigo)" not in t.split("function quote_matches_asesor")[1][:500]:
        t = replace_once(t, old_match, new_match, "quote_matches_asesor")
        print("patched quote_matches_asesor")
    else:
        print("quote_matches ok")

    # get_asesor_clientes_manual - expand to all codes
    old_gm = '''function get_asesor_clientes_manual($codigo) {
    $code = normalize_asesor_codigo($codigo);
    if ($code === '') {
        return [];
    }
    $data = read_asesor_clientes_manual();
    $rows = asesor_clientes_manual_rows($data['by_codigo'][$code] ?? []);'''
    # Read actual function
    start = t.find("function get_asesor_clientes_manual($codigo)")
    if start < 0:
        raise SystemExit("get_asesor_clientes_manual missing")
    # find next function after this
    end = t.find("\nfunction ", start + 10)
    chunk = t[start:end]
    if "asesor_all_codigos($code)" in chunk:
        print("get_asesor_clientes_manual ok")
    else:
        # Replace body to merge
        new_gm_fn = '''function get_asesor_clientes_manual($codigo) {
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
'''
        # Keep original if structure differs - use chunk replace
        t = t[:start] + new_gm_fn + t[end:]
        print("patched get_asesor_clientes_manual")

    # register_asesor: accept codigos_extra
    old_reg_asesor = '''    $asesores[] = [
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
}'''
    new_reg_asesor = '''    $extras = parse_asesor_codigos_list($body['codigos_extra'] ?? ($body['extras'] ?? ''));
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
}'''
    if "'codigos_extra' => $extras" not in t.split("if ($action === 'register_asesor')")[1][:2500]:
        t = replace_once(t, old_reg_asesor, new_reg_asesor, "register_asesor")
        print("patched register_asesor")
    else:
        print("register_asesor ok")

    # list_asesores include extras
    old_list = '''        $safe[] = [
            'codigo' => $codigo,
            'nombre' => trim((string) ($a['nombre'] ?? $codigo)),
            'created_at' => (string) ($a['created_at'] ?? ''),
        ];'''
    new_list = '''        $safe[] = [
            'codigo' => $codigo,
            'nombre' => trim((string) ($a['nombre'] ?? $codigo)),
            'codigos_extra' => asesor_row_codigos_extra($a),
            'created_at' => (string) ($a['created_at'] ?? ''),
        ];'''
    if "'codigos_extra' => asesor_row_codigos_extra($a)" not in t:
        t = replace_once(t, old_list, new_list, "list_asesores")
        print("patched list_asesores")
    else:
        print("list_asesores ok")

    # Add update_asesor action after register_asesor block if missing
    if "if ($action === 'update_asesor')" not in t:
        insert_after = "if ($action === 'update_zkteco_nombre' || $action === 'set_zkteco_nombre') {"
        update_block = r'''
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

'''
        if insert_after not in t:
            raise SystemExit("update insert point missing")
        t = t.replace(insert_after, update_block + insert_after, 1)
        print("inserted update_asesor")
    else:
        print("update_asesor ok")

    # login: if code is only an extra, map to primary account
    old_login_asesor = None
    # Find asesor login section after SAT/GP - look for find_asesor in login
    login_marker = "if ($action === 'login') {"
    # Safer: patch resolve_asesor_or_zkteco / find path used at login
    # Search for typical pattern
    snippet = '''    $asesorCode = normalize_asesor_codigo($rawLogin);
    $nit = normalize_nit($rawLogin);'''
    if "asesor_canonical_codigo($rawLogin)" not in t.split(login_marker)[1][:1200]:
        # After normalizing asesorCode, remap extras without own account to primary for password lookup
        # We'll patch where find_asesor is called in login for asesores
        pass

    # Find login block for asesores - typically after GP checks
    needle = '''    $asesores = read_asesores($asesoresFile);
    [, $asesor] = find_asesor($asesores, $asesorCode);'''
    if needle in t and "asesor_canonical_codigo($asesorCode)" not in t:
        repl = '''    // Si el código es solo alias (p.ej. V28 de Mariana), usar el usuario primario (V6).
    $asesorCode = asesor_canonical_codigo($asesorCode) ?: $asesorCode;
    $asesores = read_asesores($asesoresFile);
    [, $asesor] = find_asesor($asesores, $asesorCode);'''
        # Only first occurrence in login ideally - replace all is ok if identical
        count = t.count(needle)
        t = t.replace(needle, repl)
        print(f"patched login canonical ({count})")
    else:
        print("login canonical skip/ok")

    AUTH.write_text(t, encoding="utf-8")
    print("auth.php written", AUTH.stat().st_size)


if __name__ == "__main__":
    main()
