<?php

header('Content-Type: text/plain; charset=utf-8');

$root = __DIR__;
$dataDir = $root . DIRECTORY_SEPARATOR . 'data';
$quotes = $dataDir . DIRECTORY_SEPARATOR . 'cotizaciones.json';

$log = [];

if (!is_dir($dataDir)) {
    if (@mkdir($dataDir, 0777, true)) {
        $log[] = 'OK: creada carpeta data/';
    } else {
        $log[] = 'ERROR: no se pudo crear data/';
    }
}

@chmod($dataDir, 0777);
$log[] = 'data/ writable=' . (is_writable($dataDir) ? 'SI' : 'NO');

if (!is_file($quotes)) {
    $ok = @file_put_contents($quotes, "[]\n") !== false;
    $log[] = $ok ? 'OK: creado cotizaciones.json' : 'ERROR: no se pudo crear cotizaciones.json';
}

@chmod($quotes, 0666);

$test = @file_put_contents($quotes . '.write_test', 'ok');
if ($test !== false) {
    @unlink($quotes . '.write_test');
    $log[] = 'OK: prueba de escritura en data/ exitosa';
} else {
    $log[] = 'ERROR: PHP no puede escribir en data/ (bloqueo del hosting)';
}

$log[] = 'cotizaciones.json exists=' . (is_file($quotes) ? 'SI' : 'NO');
$log[] = 'cotizaciones.json writable=' . (is_writable($quotes) ? 'SI' : 'NO');

echo implode("\n", $log) . "\n";
echo "\nSi todo dice OK/SI, borra fix_perms.php y vuelve a terminar la cotizacion.\n";
