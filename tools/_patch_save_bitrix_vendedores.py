#!/usr/bin/env python3
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "api" / "auth.php"
t = p.read_text(encoding="utf-8")

marker = "if ($action === 'update_zkteco_nombre' || $action === 'set_zkteco_nombre') {"
if "if ($action === 'save_bitrix_vendedores')" in t:
    print("save_bitrix_vendedores already present")
else:
    block = r'''
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

'''
    if marker not in t:
        raise SystemExit("marker missing")
    t = t.replace(marker, block + marker, 1)
    p.write_text(t, encoding="utf-8")
    print("inserted save_bitrix_vendedores")

# Fix registrar_asesores EXTRAS writing
reg = Path(__file__).resolve().parents[1] / "src" / "registrar_asesores.py"
rt = reg.read_text(encoding="utf-8")
old = '''        row = {
            "codigo": code,
            "nombre": nombre,
            "password_hash": hash_password(pwd),
            "created_at": (by.get(code) or {}).get("created_at") or now,
        }
        if code in by:
            updated.append(code)
        else:
            added.append(code)
        by[code] = row'''
new = '''        prev = by.get(code) or {}
        row = {
            "codigo": code,
            "nombre": nombre,
            "password_hash": hash_password(pwd),
            "created_at": prev.get("created_at") or now,
        }
        extras = EXTRAS.get(code) or prev.get("codigos_extra")
        if extras:
            row["codigos_extra"] = list(extras)
        if code in by:
            updated.append(code)
        else:
            added.append(code)
        by[code] = row'''
if "EXTRAS.get(code)" not in rt:
    if old not in rt:
        raise SystemExit("registrar block missing")
    rt = rt.replace(old, new, 1)
    # sort_key for ADV
    old_sk = '''def sort_key(code: str) -> int:
    m = re.match(r"V(\\d+)$", code, re.I)
    return int(m.group(1)) if m else 9999'''
    new_sk = '''def sort_key(code: str):
    m = re.match(r"V(\\d+)$", code, re.I)
    if m:
        return (0, int(m.group(1)), code.upper())
    return (1, 0, code.upper())'''
    if old_sk in rt:
        rt = rt.replace(old_sk, new_sk, 1)
    reg.write_text(rt, encoding="utf-8")
    print("patched registrar_asesores")
else:
    print("registrar ok")
