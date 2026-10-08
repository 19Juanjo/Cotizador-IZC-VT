<?php
/**
 * Regenera precios desde lista-precios-izc.xlsb y lista-precios-zebra.xlsb
 * si algún Excel es más nuevo que los JSON.
 * Usado por precios.php, precios_lp_asesor.php y api/admin_upload_precios.php.
 */
function izc_precios_files_dir() {
    return __DIR__;
}

function izc_precios_excel_paths() {
    $dir = izc_precios_files_dir();
    return [
        $dir . DIRECTORY_SEPARATOR . 'lista-precios-izc.xlsb',
        $dir . DIRECTORY_SEPARATOR . 'lista-precios-zebra.xlsb',
    ];
}

function izc_precios_excel_path() {
    return izc_precios_excel_paths()[0];
}

function izc_precios_script_path() {
    return dirname(izc_precios_files_dir(), 2) . DIRECTORY_SEPARATOR . 'src' . DIRECTORY_SEPARATOR . 'extraer_precios.py';
}

function izc_precios_output_paths() {
    $dir = izc_precios_files_dir();
    return [
        $dir . DIRECTORY_SEPARATOR . 'precios.json',
        $dir . DIRECTORY_SEPARATOR . 'precios_lp_asesor.json',
        $dir . DIRECTORY_SEPARATOR . 'referencias.json',
        $dir . DIRECTORY_SEPARATOR . 'inventario.json',
    ];
}

function izc_find_python_bin() {
    // 1) Comandos en PATH (según el usuario/servicio de Apache).
    foreach (['py -3', 'py', 'python3', 'python'] as $bin) {
        $out = [];
        $code = 1;
        @exec($bin . ' --version 2>&1', $out, $code);
        if ($code === 0) {
            return $bin;
        }
    }

    // 2) Rutas típicas en Windows (Apache/IIS a menudo no hereda el PATH del usuario).
    $candidates = [];
    $pf = getenv('ProgramFiles') ?: 'C:\\Program Files';
    $pf86 = getenv('ProgramFiles(x86)') ?: 'C:\\Program Files (x86)';
    $local = getenv('LOCALAPPDATA') ?: '';
    foreach ([$pf, $pf86] as $root) {
        foreach (glob($root . DIRECTORY_SEPARATOR . 'Python3*') ?: [] as $dir) {
            $candidates[] = $dir . DIRECTORY_SEPARATOR . 'python.exe';
        }
        $candidates[] = $root . DIRECTORY_SEPARATOR . 'Python312' . DIRECTORY_SEPARATOR . 'python.exe';
        $candidates[] = $root . DIRECTORY_SEPARATOR . 'Python311' . DIRECTORY_SEPARATOR . 'python.exe';
        $candidates[] = $root . DIRECTORY_SEPARATOR . 'Python310' . DIRECTORY_SEPARATOR . 'python.exe';
    }
    if ($local !== '') {
        foreach (glob($local . DIRECTORY_SEPARATOR . 'Programs' . DIRECTORY_SEPARATOR . 'Python' . DIRECTORY_SEPARATOR . 'Python3*' . DIRECTORY_SEPARATOR . 'python.exe') ?: [] as $exe) {
            $candidates[] = $exe;
        }
    }
    // py.exe launcher
    $candidates[] = $pf . DIRECTORY_SEPARATOR . 'PythonLauncher' . DIRECTORY_SEPARATOR . 'py.exe';
    $candidates[] = 'C:\\Windows\\py.exe';

    $seen = [];
    foreach ($candidates as $exe) {
        $exe = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, (string) $exe);
        if ($exe === '' || isset($seen[$exe]) || !is_file($exe)) {
            continue;
        }
        $seen[$exe] = true;
        $out = [];
        $code = 1;
        @exec(escapeshellarg($exe) . ' --version 2>&1', $out, $code);
        if ($code === 0) {
            return escapeshellarg($exe);
        }
    }
    return null;
}

/**
 * Comprueba Python + pandas + pyxlsb (lo que necesita extraer_precios.py).
 * @return array{ok:bool,bin:?string,version:string,pandas:bool,pyxlsb:bool,error:string}
 */
function izc_python_precios_ready() {
    $bin = izc_find_python_bin();
    $empty = [
        'ok' => false,
        'bin' => null,
        'version' => '',
        'pandas' => false,
        'pyxlsb' => false,
        'error' => 'Python no disponible en el servidor.',
    ];
    if ($bin === null) {
        return $empty;
    }
    $verOut = [];
    $verCode = 1;
    @exec($bin . ' --version 2>&1', $verOut, $verCode);
    $version = $verCode === 0 ? trim(implode(' ', $verOut)) : '';

    // One-liner (evita \\n en -c de Windows).
    $probe = 'import importlib.util as u; '
        . 'pd=u.find_spec("pandas") is not None; '
        . 'xb=u.find_spec("pyxlsb") is not None; '
        . 'print("PANDAS="+("1" if pd else "0")); '
        . 'print("PYXLSB="+("1" if xb else "0"))';
    $out = [];
    $code = 1;
    @exec($bin . ' -c ' . escapeshellarg($probe) . ' 2>&1', $out, $code);
    $pandas = false;
    $pyxlsb = false;
    foreach ($out as $line) {
        $line = trim((string) $line);
        if (stripos($line, 'PANDAS=1') !== false) {
            $pandas = true;
        }
        if (stripos($line, 'PYXLSB=1') !== false) {
            $pyxlsb = true;
        }
    }
    $ok = ($code === 0) && $pandas && $pyxlsb;
    $error = '';
    if (!$ok) {
        if ($code !== 0) {
            $error = 'Python responde con error: ' . trim(implode(' ', array_slice($out, 0, 4)));
        } else {
            $missing = [];
            if (!$pandas) {
                $missing[] = 'pandas';
            }
            if (!$pyxlsb) {
                $missing[] = 'pyxlsb';
            }
            $error = 'Falta instalar: ' . implode(', ', $missing)
                . '. En el servidor: ' . $bin . ' -m pip install pandas pyxlsb';
        }
    }
    return [
        'ok' => $ok,
        'bin' => $bin,
        'version' => $version,
        'pandas' => $pandas,
        'pyxlsb' => $pyxlsb,
        'error' => $error,
    ];
}

function izc_precios_needs_sync() {
    $outputs = izc_precios_output_paths();
    $oldest = null;
    foreach ($outputs as $path) {
        if (!is_file($path)) {
            return true;
        }
        $mtime = filemtime($path);
        if ($oldest === null || $mtime < $oldest) {
            $oldest = $mtime;
        }
    }
    if ($oldest === null) {
        return true;
    }
    foreach (izc_precios_excel_paths() as $excel) {
        if (!is_file($excel)) {
            continue;
        }
        if (filemtime($excel) > $oldest) {
            return true;
        }
    }
    return false;
}

function izc_precios_file_meta($path) {
    if (!is_file($path)) {
        return [
            'exists' => false,
            'path' => basename((string) $path),
            'size' => 0,
            'mtime' => '',
            'mtime_ts' => 0,
        ];
    }
    $ts = (int) filemtime($path);
    return [
        'exists' => true,
        'path' => basename($path),
        'size' => (int) filesize($path),
        'mtime' => $ts > 0 ? date('c', $ts) : '',
        'mtime_ts' => $ts,
    ];
}

/**
 * @param bool $force Si true, regenera aunque el JSON ya esté al día.
 */
function izc_sync_precios_from_excel($force = false) {
    $excel = izc_precios_excel_path();
    $script = izc_precios_script_path();
    if (!is_file($excel)) {
        return [
            'ok' => false,
            'ran' => false,
            'error' => 'Falta lista-precios-izc.xlsb en assets/files/. Súbelo desde el panel admin.',
        ];
    }
    if (!is_file($script)) {
        return ['ok' => false, 'ran' => false, 'error' => 'Falta src/extraer_precios.py'];
    }
    if (!$force && !izc_precios_needs_sync()) {
        return [
            'ok' => true,
            'ran' => false,
            'error' => '',
            'excel' => izc_precios_file_meta($excel),
        ];
    }
    $python = izc_find_python_bin();
    if ($python === null) {
        return [
            'ok' => false,
            'ran' => false,
            'error' => 'Python no disponible en el servidor. Instálalo o ejecuta tools\\INSTALAR_PYTHON.bat.',
        ];
    }
    $output = [];
    $code = 1;
    @exec($python . ' ' . escapeshellarg($script) . ' 2>&1', $output, $code);
    if ($code !== 0) {
        return [
            'ok' => false,
            'ran' => true,
            'error' => 'Error al ejecutar extraer_precios.py',
            'detail' => implode("\n", array_slice($output, -12)),
            'excel' => izc_precios_file_meta($excel),
        ];
    }
    $counts = [];
    foreach (izc_precios_output_paths() as $path) {
        if (!is_file($path)) {
            continue;
        }
        $key = pathinfo($path, PATHINFO_FILENAME);
        $raw = @file_get_contents($path);
        $decoded = is_string($raw) ? json_decode($raw, true) : null;
        if (is_array($decoded)) {
            if (isset($decoded['by_sku']) && is_array($decoded['by_sku'])) {
                $counts[$key] = count($decoded['by_sku']);
            } elseif (isset($decoded['by_list']) && is_array($decoded['by_list'])) {
                $n = 0;
                foreach ($decoded['by_list'] as $m) {
                    if (is_array($m)) {
                        $n += count($m);
                    }
                }
                $counts[$key] = $n;
            } else {
                $counts[$key] = count($decoded);
            }
        }
    }
    return [
        'ok' => true,
        'ran' => true,
        'error' => '',
        'counts' => $counts,
        'excel' => izc_precios_file_meta($excel),
        'log_tail' => implode("\n", array_slice($output, -8)),
    ];
}
