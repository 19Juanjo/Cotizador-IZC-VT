/**
 * Boot temprano (sync):
 * 1) Si el HTML se abre como file://, despierta el servidor local.
 * 2) Si un asesor/admin abre el cotizador de cliente, lo manda al cotizador-asesor.
 */
(function () {
  'use strict';

  // --- Staff: nunca dejar al asesor en cotizador de cliente ---
  try {
    var path = String(location.pathname || '').toLowerCase();
    var isClientCotizador =
      /(?:^|\/)cotizador\.html$/i.test(path) ||
      /(?:^|\/)cotizador-valtech\.html$/i.test(path);
    if (isClientCotizador) {
      var role = String(localStorage.getItem('izc_session_role') || '').toLowerCase();
      var nit = String(localStorage.getItem('izc_session_nit') || '')
        .replace(/[\s.]/g, '')
        .toUpperCase();
      // Sesiones viejas: V# sin role → tratar como asesor.
      if (!role && /^V\d{1,4}$/.test(nit)) {
        try { localStorage.setItem('izc_session_role', 'asesor'); } catch (eRole) { /* ignore */ }
        role = 'asesor';
      }
      var dest = '';
      if (role === 'sat' || role === 'gp' || nit === 'SAT' || /^GP\d{1,4}$/.test(nit)) {
        dest = 'cotizador-sat.html';
      } else if (
        role === 'asesor' ||
        role === 'admin' ||
        role === 'zkteco' ||
        role === 'zebra' ||
        /^V\d{1,4}$/.test(nit) ||
        nit === 'ZKTECO'
      ) {
        dest = 'cotizador-asesor.html';
      }
      if (dest) {
        location.replace(dest + (location.search || '') + (location.hash || ''));
        return;
      }
    }
  } catch (eStaff) { /* ignore */ }

  if (location.protocol !== 'file:') return;

  var parts = String(location.pathname || '').split(/[/\\]/);
  var page = parts[parts.length - 1] || 'marcas.html';
  if (!/\.html?/i.test(page)) page = 'marcas.html';
  var rest = (location.search || '') + (location.hash || '');
  var httpUrl = 'http://127.0.0.1:8080/' + page + rest;
  var protoUrl = 'izc:open/' + page + rest;

  try {
    // El handler espera a que la API este viva y abre la URL http.
    location.href = protoUrl;
  } catch (e) {}

  // Si el protocolo no esta registrado o el usuario cancela, ir directo a :8080.
  setTimeout(function () {
    if (location.protocol === 'file:') location.replace(httpUrl);
  }, 2500);
})();
