<?php
/**
 * PDF temporal para visualización/guardado con nombre correcto.
 * POST JSON: { pdf_base64, filename } → { ok, token, view_url, download_url }
 * POST multipart: file + filename → igual
 * GET ?t=TOKEN → sirve el PDF (inline; &dl=1 → attachment)
 */
header('X-Content-Type-Options: nosniff');

function izc_pdf_tmp_dir() {
  $preferred = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'tmp_pdf';
  if (!is_dir($preferred)) {
    @mkdir($preferred, 0755, true);
  }
  if (is_dir($preferred) && is_writable($preferred)) {
    return $preferred;
  }
  $fallback = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'izc_tmp_pdf';
  if (!is_dir($fallback)) {
    @mkdir($fallback, 0755, true);
  }
  return is_dir($fallback) ? $fallback : $preferred;
}

function izc_pdf_clean_old($dir) {
  $files = @scandir($dir);
  if (!$files) return;
  $now = time();
  foreach ($files as $f) {
    if ($f === '.' || $f === '..') continue;
    if (!preg_match('/\.(pdf|json)$/i', $f)) continue;
    $path = $dir . DIRECTORY_SEPARATOR . $f;
    $mtime = @filemtime($path);
    if ($mtime && ($now - $mtime) > 3600) {
      @unlink($path);
    }
  }
}

function izc_pdf_safe_filename($name) {
  $name = basename(str_replace(array('\\', '/'), '-', (string) $name));
  // Permitir espacio y # (ej. "Cotizacion #12345.pdf")
  $name = preg_replace('/[^\w.\- #()áéíóúÁÉÍÓÚñÑ]+/u', '_', $name);
  $name = preg_replace('/\s+/', ' ', $name);
  $name = trim($name, '._ ');
  if ($name === '' || !preg_match('/\.pdf$/i', $name)) {
    $name = 'Cotizacion.pdf';
  }
  if (strlen($name) > 120) {
    $name = substr($name, 0, 116) . '.pdf';
  }
  return $name;
}

function izc_pdf_content_disposition($disposition, $filename) {
  $filename = izc_pdf_safe_filename($filename);
  $ascii = preg_replace('/[^\x20-\x7E]/', '_', $filename);
  $ascii = str_replace(array('"', '\\'), '', $ascii);
  if ($ascii === '' || !preg_match('/\.pdf$/i', $ascii)) {
    $ascii = 'Cotizacion.pdf';
  }
  $utf = rawurlencode($filename);
  return $disposition . '; filename="' . $ascii . '"; filename*=UTF-8\'\'' . $utf;
}

function izc_pdf_parse_post() {
  static $parsed = null;
  if ($parsed !== null) {
    return $parsed;
  }
  $bin = '';
  $filename = 'Cotizacion.pdf';

  // Multipart (más fiable que JSON base64 gigante)
  foreach (array('file', 'pdf') as $key) {
    if (empty($_FILES[$key]) || !is_array($_FILES[$key])) {
      continue;
    }
    $f = $_FILES[$key];
    $err = isset($f['error']) ? (int) $f['error'] : UPLOAD_ERR_NO_FILE;
    if ($err === UPLOAD_ERR_OK && !empty($f['tmp_name']) && is_uploaded_file($f['tmp_name'])) {
      $tmp = @file_get_contents($f['tmp_name']);
      if ($tmp !== false && strlen($tmp) >= 100) {
        $bin = $tmp;
        if (!empty($f['name'])) {
          $filename = izc_pdf_safe_filename($f['name']);
        }
        break;
      }
    }
  }

  if (isset($_POST['filename']) && trim((string) $_POST['filename']) !== '') {
    $filename = izc_pdf_safe_filename($_POST['filename']);
  }

  if ($bin === '') {
    $raw = file_get_contents('php://input');
    $data = json_decode((string) $raw, true);
    if (!is_array($data)) {
      $data = is_array($_POST) ? $_POST : array();
    }
    $b64 = '';
    if (isset($data['pdf_base64'])) $b64 = (string) $data['pdf_base64'];
    elseif (isset($data['pdf'])) $b64 = (string) $data['pdf'];
    $b64 = preg_replace('#^data:application/pdf;base64,#i', '', $b64);
    $b64 = preg_replace('/\s+/', '', $b64);
    if ($b64 !== '') {
      $decoded = base64_decode($b64, true);
      if ($decoded !== false) {
        $bin = $decoded;
      }
    }
    if (isset($data['filename']) && trim((string) $data['filename']) !== '') {
      $filename = izc_pdf_safe_filename($data['filename']);
    }
  }

  $parsed = array('bin' => $bin, 'filename' => $filename);
  return $parsed;
}

$method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper($_SERVER['REQUEST_METHOD']) : 'GET';

if ($method === 'OPTIONS') {
  header('Access-Control-Allow-Origin: *');
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
  http_response_code(204);
  exit;
}

if ($method === 'GET') {
  $token = isset($_GET['t']) ? preg_replace('/[^a-f0-9]/i', '', (string) $_GET['t']) : '';
  if (strlen($token) < 16) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Token inválido';
    exit;
  }
  $dir = izc_pdf_tmp_dir();
  $metaFile = $dir . DIRECTORY_SEPARATOR . $token . '.json';
  $pdfFile = $dir . DIRECTORY_SEPARATOR . $token . '.pdf';
  if (!is_file($pdfFile) || !is_file($metaFile)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'PDF no encontrado o expirado';
    exit;
  }
  $meta = json_decode((string) @file_get_contents($metaFile), true);
  $filename = izc_pdf_safe_filename(is_array($meta) && !empty($meta['filename']) ? $meta['filename'] : 'Cotizacion.pdf');
  if (!empty($_GET['n'])) {
    $filename = izc_pdf_safe_filename($_GET['n']);
  }
  $download = !empty($_GET['dl']);

  header('Content-Type: application/pdf');
  header('X-Content-Type-Options: nosniff');
  header('Cache-Control: private, no-store, max-age=0');
  // Ayuda a Chrome a no marcar la vista inline como descarga “no segura”
  header('Content-Disposition: ' . izc_pdf_content_disposition($download ? 'attachment' : 'inline', $filename));
  header('Content-Length: ' . (string) filesize($pdfFile));
  readfile($pdfFile);
  exit;
}

if ($method !== 'POST') {
  http_response_code(405);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(array('ok' => false, 'error' => 'Método no permitido'));
  exit;
}

header('Content-Type: application/json; charset=utf-8');
$parsed = izc_pdf_parse_post();
$bin = isset($parsed['bin']) ? $parsed['bin'] : '';
$filename = izc_pdf_safe_filename(isset($parsed['filename']) ? $parsed['filename'] : 'Cotizacion.pdf');
if ($bin === '' || strlen($bin) < 100) {
  http_response_code(400);
  echo json_encode(array('ok' => false, 'error' => 'PDF inválido'));
  exit;
}
if (strlen($bin) > 12 * 1024 * 1024) {
  http_response_code(413);
  echo json_encode(array('ok' => false, 'error' => 'PDF demasiado grande'));
  exit;
}
if (strncmp($bin, '%PDF', 4) !== 0) {
  http_response_code(400);
  echo json_encode(array('ok' => false, 'error' => 'No es un PDF válido'));
  exit;
}

$dir = izc_pdf_tmp_dir();
if (!is_dir($dir) || !is_writable($dir)) {
  http_response_code(500);
  echo json_encode(array('ok' => false, 'error' => 'Carpeta temporal no escribible'));
  exit;
}
izc_pdf_clean_old($dir);
$token = bin2hex(random_bytes(16));
$pdfPath = $dir . DIRECTORY_SEPARATOR . $token . '.pdf';
$metaPath = $dir . DIRECTORY_SEPARATOR . $token . '.json';

if (@file_put_contents($pdfPath, $bin) === false) {
  http_response_code(500);
  echo json_encode(array('ok' => false, 'error' => 'No se pudo guardar el PDF temporal'));
  exit;
}
@file_put_contents($metaPath, json_encode(array(
  'filename' => $filename,
  'created_at' => date('c'),
  'bytes' => strlen($bin)
), JSON_UNESCAPED_UNICODE));

// Query-string only: PATH_INFO falla en Apache con AcceptPathInfo Off.
$viewUrl = 'api/cotizacion_pdf_tmp.php?t=' . rawurlencode($token) . '&n=' . rawurlencode($filename);
$downloadUrl = $viewUrl . '&dl=1';

echo json_encode(array(
  'ok' => true,
  'token' => $token,
  'filename' => $filename,
  'view_url' => $viewUrl,
  'download_url' => $downloadUrl
));
