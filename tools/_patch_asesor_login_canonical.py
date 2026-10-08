#!/usr/bin/env python3
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "api" / "auth.php"
t = p.read_text(encoding="utf-8")

old1 = """    if ($asesorCode !== '') {
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
    }"""

new1 = """    if ($asesorCode !== '') {
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
    }"""

old2 = """function resolve_asesor_or_zkteco($body) {
    global $asesoresFile;
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit_asesor'] ?? ($body['nit'] ?? '')));
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);"""

new2 = """function resolve_asesor_or_zkteco($body) {
    global $asesoresFile;
    $codigo = normalize_asesor_codigo($body['asesor_codigo'] ?? ($body['nit_asesor'] ?? ($body['nit'] ?? '')));
    $codigo = asesor_canonical_codigo($codigo) ?: $codigo;
    [, $asesor] = find_asesor(read_asesores($asesoresFile), $codigo);"""

for label, old, new in [("login", old1, new1), ("resolve", old2, new2)]:
    if old not in t:
        raise SystemExit(f"missing {label}")
    t = t.replace(old, new, 1)
    print("patched", label)

p.write_text(t, encoding="utf-8")
print("ok")
