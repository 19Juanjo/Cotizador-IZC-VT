/* Panel Administrador SAT: pestañas historial gerentes / clientes / gerentes de producto. */
(function () {
  'use strict';

  var activeTab = 'quotes-gerentes';
  var gerentesQuotesCache = [];
  var clientQuotesCache = [];
  var gerentesCache = [];
  var openQuoteId = '';
  var quoteModalBound = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setMessage(text, type) {
    var el = document.getElementById('satPanelMessage') || document.getElementById('satAdminMessage');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'auth-message' + (type ? ' is-' + type : '');
  }

  function hardClearSession() {
    try {
      localStorage.removeItem('izc_session_nit');
      localStorage.removeItem('izc_session_nombre');
      localStorage.removeItem('izc_session_role');
    } catch (e1) { /* ignore */ }
    try {
      if (window.sessionStorage) {
        sessionStorage.setItem('izc_logout_at', String(Date.now()));
        sessionStorage.removeItem('izc_asesor_cotizar');
      }
    } catch (e2) { /* ignore */ }
  }

  function doLogout() {
    try {
      if (window.IZCAuth && typeof IZCAuth.logout === 'function') {
        IZCAuth.logout({ redirect: 'login.html' });
        window.setTimeout(function () {
          hardClearSession();
          window.location.replace('login.html');
        }, 1200);
        return;
      }
    } catch (e) { /* ignore */ }
    hardClearSession();
    window.location.replace('login.html');
  }

  function bindLogout() {
    var logout = document.getElementById('profileLogout');
    if (!logout || logout._satBound) return;
    logout._satBound = true;
    logout.addEventListener('click', function (ev) {
      try {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
      } catch (ePrev) { /* ignore */ }
      doLogout();
    });
  }

  function profileCard() {
    return document.querySelector('.profile-name-card');
  }

  function currentProfileNombre() {
    var nombre = '';
    try {
      nombre = String(localStorage.getItem('izc_session_nombre') || '').trim();
    } catch (e) { /* ignore */ }
    if (!nombre && window.IZCAuth && typeof IZCAuth.getSessionNombre === 'function') {
      nombre = String(IZCAuth.getSessionNombre() || '').trim();
    }
    if (!nombre || /^SAT$/i.test(nombre)) nombre = 'Admin SAT';
    return nombre;
  }

  function isEditingNombre() {
    var card = profileCard();
    return !!(card && card.classList.contains('is-editing-name'));
  }

  function setNombreEditUi(editing) {
    var card = profileCard();
    var greet = document.getElementById('profileGreeting');
    var input = document.getElementById('satNombreInput');
    var toggle = document.getElementById('satNombreToggle');
    var pencil = toggle ? toggle.querySelector('.is-pencil') : null;
    var check = toggle ? toggle.querySelector('.is-check') : null;
    if (card) card.classList.toggle('is-editing-name', !!editing);
    if (toggle) {
      toggle.setAttribute('aria-pressed', editing ? 'true' : 'false');
      toggle.title = editing ? 'Guardar nombre' : 'Editar nombre';
      toggle.setAttribute('aria-label', editing ? 'Guardar nombre' : 'Editar nombre');
    }
    if (pencil) pencil.hidden = !!editing;
    if (check) check.hidden = !editing;
    if (input) {
      input.hidden = !editing;
      if (editing) {
        input.value = currentProfileNombre();
        window.setTimeout(function () {
          input.focus();
          input.select();
        }, 0);
      }
    }
    if (greet) greet.hidden = !!editing;
  }

  function setNombreStatus(text, type) {
    var el = document.getElementById('satNombreStatus');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'auth-message profile-name-status');
      return;
    }
    el.textContent = text || '';
    el.className = 'auth-message profile-name-status' + (type ? ' is-' + type : '');
  }

  function saveSatNombre() {
    var input = document.getElementById('satNombreInput');
    if (!input) return;
    var nombre = String(input.value || '').trim();
    if (nombre.length < 2) {
      setNombreStatus('Ingresa un nombre válido (mínimo 2 caracteres).', 'error');
      setNombreEditUi(true);
      return;
    }
    setNombreStatus('Guardando…', '');
    postApi(actorPayload({ action: 'update_sat_nombre', nombre: nombre })).then(function (data) {
      if (!data || !data.ok) {
        setNombreStatus((data && data.error) || 'No se pudo guardar el nombre.', 'error');
        return;
      }
      var saved = String(data.nombre || nombre).trim();
      if (window.IZCAuth && typeof IZCAuth.setSessionNit === 'function') {
        IZCAuth.setSessionNit('SAT', saved, { role: 'sat', skipUi: true });
      }
      try { localStorage.setItem('izc_session_nombre', saved); } catch (eS) { /* ignore */ }
      var greet = document.getElementById('profileGreeting');
      if (greet) greet.textContent = 'Hola, ' + (saved || 'Admin SAT');
      setNombreEditUi(false);
      setNombreStatus(data.message || 'Nombre actualizado.', 'ok');
    }).catch(function () {
      setNombreStatus('No se pudo guardar el nombre.', 'error');
    });
  }

  function bindNombreEdit() {
    var toggle = document.getElementById('satNombreToggle');
    var input = document.getElementById('satNombreInput');
    if (toggle && !toggle._satNombreBound) {
      toggle._satNombreBound = true;
      toggle.addEventListener('click', function () {
        if (isEditingNombre()) saveSatNombre();
        else {
          setNombreStatus('', '');
          setNombreEditUi(true);
        }
      });
    }
    if (input && !input._satNombreBound) {
      input._satNombreBound = true;
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          saveSatNombre();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          setNombreEditUi(false);
          setNombreStatus('', '');
          var greet = document.getElementById('profileGreeting');
          if (greet) greet.textContent = 'Hola, ' + currentProfileNombre();
        }
      });
    }
  }

  function fillProfile() {
    if (!window.IZCAuth) {
      window.location.replace('login.html');
      return false;
    }
    var allowed = (typeof IZCAuth.isSat === 'function' && IZCAuth.isSat()) ||
      (typeof IZCAuth.isAdmin === 'function' && IZCAuth.isAdmin());
    if (!allowed) {
      if (typeof IZCAuth.isZkteco === 'function' && IZCAuth.isZkteco()) {
        window.location.replace('panel-zkteco.html');
        return false;
      }
      if (typeof IZCAuth.isAsesor === 'function' && IZCAuth.isAsesor()) {
        window.location.replace('asesor.html');
        return false;
      }
      window.location.replace('login.html');
      return false;
    }

    var greet = document.getElementById('profileGreeting');
    if (greet && !isEditingNombre()) {
      greet.textContent = 'Hola, ' + currentProfileNombre();
    }
    var msg = document.getElementById('satAdminMessage');
    if (msg) {
      msg.textContent = '';
      msg.className = 'auth-message';
    }
    bindNombreEdit();
    return true;
  }

  function postApi(payload) {
    if (window.IZCAuth && typeof IZCAuth.postAuthFile === 'function') {
      return IZCAuth.postAuthFile(payload);
    }
    if (window.IZCAuth && typeof IZCAuth.postAuth === 'function') {
      return IZCAuth.postAuth(payload);
    }
    return Promise.resolve({ ok: false, error: 'Auth no disponible' });
  }

  function actorPayload(extra) {
    var nit = '';
    try {
      if (window.IZCAuth && typeof IZCAuth.getSessionNit === 'function') {
        nit = String(IZCAuth.getSessionNit() || '').trim();
      }
    } catch (e) { /* ignore */ }
    var base = {
      sat_user: nit || 'SAT',
      nit: nit || 'SAT',
      admin_nit: nit || 'SAT'
    };
    if (!extra) return base;
    Object.keys(extra).forEach(function (k) { base[k] = extra[k]; });
    return base;
  }

  function formatDateOnly(raw) {
    var s = String(raw || '').trim();
    if (!s) return '—';
    var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    return s.slice(0, 10) || '—';
  }

  function formatUSD(n) {
    var v = Number(n || 0);
    if (!(v > 0)) return '';
    return 'USD ' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatCOP(n) {
    var v = Number(n || 0);
    if (!(v > 0)) return '';
    return '$ ' + Math.round(v).toLocaleString('es-CO') + ' COP';
  }

  function quoteEstado(q) {
    var e = String((q && (q.asesor_estado || q.estado)) || '').trim().toLowerCase();
    if (!e) return 'cotizado';
    return e.replace(/\s+/g, '_');
  }

  function quoteEstadoLabel(estado) {
    var map = {
      nueva: 'Nueva',
      nuevo: 'Nueva',
      cotizado: 'Cotizado',
      pendiente: 'Pendiente',
      seguimiento: 'Seguimiento',
      vendido: 'Vendido',
      perdida: 'Perdida',
      cerrado_modificado: 'Cerrado Modificado'
    };
    return map[estado] || (estado ? estado.charAt(0).toUpperCase() + estado.slice(1) : 'Cotizado');
  }

  function estadoBadgeHtml(q) {
    var estado = quoteEstado(q);
    return '<span class="quote-estado-badge is-' + escapeHtml(estado) + '">' + escapeHtml(quoteEstadoLabel(estado)) + '</span>';
  }

  function quoteTotalLabel(q) {
    if (!q) return '—';
    if (q.total_display) return String(q.total_display);
    var parts = [];
    var usd = Number(q.total_usd != null ? q.total_usd : ((q.totals && (q.totals.usdIva || q.totals.usd)) || 0));
    var cop = Number(q.total_cop != null ? q.total_cop : ((q.totals && (q.totals.copIva || q.totals.cop)) || 0));
    var a = formatUSD(usd);
    var b = formatCOP(cop);
    if (a) parts.push(a);
    if (b) parts.push(b);
    return parts.length ? parts.join(' · ') : '—';
  }

  function quoteProductCount(q) {
    var n = Number(q && (q.product_count != null ? q.product_count : q.items_count));
    if (n > 0) return n;
    if (q && Array.isArray(q.items)) return q.items.length;
    return 0;
  }

  function sellerLabel(q) {
    if (!q) return '—';
    var name = String(q.seller_name || q.vendedor_nombre || '').trim();
    var code = String(q.seller_codigo || q.vendedor_codigo || '').trim();
    if (code.toUpperCase() === 'SAT' || String(q.quote_source || '').toLowerCase() === 'sat') {
      return name && name.toUpperCase() !== 'SAT' ? ('SAT · ' + name) : 'SAT';
    }
    if (name && code && name.toUpperCase() !== code.toUpperCase()) return code + ' · ' + name;
    return name || code || '—';
  }

  function toDateKey(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    var d = new Date(s);
    if (isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    var mo = String(d.getMonth() + 1);
    var da = String(d.getDate());
    if (mo.length < 2) mo = '0' + mo;
    if (da.length < 2) da = '0' + da;
    return y + '-' + mo + '-' + da;
  }

  function getReportRange() {
    var fromEl = document.getElementById('satReportFrom');
    var toEl = document.getElementById('satReportTo');
    return {
      from: fromEl ? String(fromEl.value || '').trim() : '',
      to: toEl ? String(toEl.value || '').trim() : ''
    };
  }

  function quoteInDateRange(q, from, to) {
    var key = toDateKey(q && q.created_at);
    if (!key) return !(from || to);
    if (from && key < from) return false;
    if (to && key > to) return false;
    return true;
  }

  function quotesForActiveReport() {
    var list = activeTab === 'quotes-client' ? clientQuotesCache : gerentesQuotesCache;
    var range = getReportRange();
    if (!range.from && !range.to) return list.slice();
    return (list || []).filter(function (q) {
      return quoteInDateRange(q, range.from, range.to);
    });
  }

  function updateReportMeta() {
    var meta = document.getElementById('satReportMeta');
    var toolbar = document.getElementById('satReportToolbar');
    if (toolbar) {
      toolbar.hidden = activeTab !== 'quotes-gerentes' && activeTab !== 'quotes-client';
    }
    if (!meta) return;
    if (activeTab !== 'quotes-gerentes' && activeTab !== 'quotes-client') {
      meta.hidden = true;
      return;
    }
    var range = getReportRange();
    var total = (activeTab === 'quotes-client' ? clientQuotesCache : gerentesQuotesCache).length;
    var shown = quotesForActiveReport().length;
    if (!range.from && !range.to) {
      meta.hidden = true;
      meta.textContent = '';
      return;
    }
    meta.hidden = false;
    var label = '';
    if (range.from && range.to) label = range.from + ' → ' + range.to;
    else if (range.from) label = 'desde ' + range.from;
    else label = 'hasta ' + range.to;
    meta.textContent = 'Rango ' + label + ': ' + shown + ' de ' + total + ' cotizaciones.';
  }

  function formatDateDMY(key) {
    var s = String(key || '');
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return s || '—';
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function fileStampRange(from, to) {
    function stamp(k) {
      var m = String(k || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return '';
      return m[3] + m[2] + m[1];
    }
    var a = stamp(from);
    var b = stamp(to);
    if (a && b) return a + '-' + b;
    if (a) return 'desde-' + a;
    if (b) return 'hasta-' + b;
    var d = new Date();
    var dd = String(d.getDate());
    var mm = String(d.getMonth() + 1);
    if (dd.length < 2) dd = '0' + dd;
    if (mm.length < 2) mm = '0' + mm;
    return dd + mm + d.getFullYear();
  }

  function excelEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function downloadSatQuotesReport() {
    var range = getReportRange();
    if (range.from && range.to && range.from > range.to) {
      setMessage('La fecha "Desde" no puede ser posterior a "Hasta".', 'error');
      return;
    }
    var rows = quotesForActiveReport();
    var isClient = activeTab === 'quotes-client';
    var title = isClient
      ? 'REPORTE COTIZACIONES CLIENTES SAT'
      : 'REPORTE COTIZACIONES GERENTES SAT';
    var scopeLabel = isClient ? 'Clientes GP' : 'Gerentes / Admin SAT';
    var rangoLabel = 'Todas';
    if (range.from && range.to) rangoLabel = formatDateDMY(range.from) + ' - ' + formatDateDMY(range.to);
    else if (range.from) rangoLabel = 'Desde ' + formatDateDMY(range.from);
    else if (range.to) rangoLabel = 'Hasta ' + formatDateDMY(range.to);

    var detailRows = rows.map(function (q, idx) {
      return (
        '<tr class="data">' +
          '<td class="num">' + (idx + 1) + '</td>' +
          '<td class="num">' + excelEscape(formatDateOnly(q.created_at)) + '</td>' +
          '<td class="num">' + excelEscape(quoteEstadoLabel(quoteEstado(q))) + '</td>' +
          (isClient ? '' : ('<td>' + excelEscape(sellerLabel(q)) + '</td>')) +
          '<td>' + excelEscape(q.nombre || '—') + '</td>' +
          '<td class="num">' + excelEscape(q.nit || '') + '</td>' +
          '<td class="num">' + quoteProductCount(q) + '</td>' +
          '<td>' + excelEscape(quoteTotalLabel(q)) + '</td>' +
        '</tr>'
      );
    }).join('');

    var colCount = isClient ? 7 : 8;
    var headCols = isClient
      ? '<th>#</th><th>Fecha</th><th>Estado</th><th>Cliente</th><th>NIT</th><th>Productos</th><th>Total</th>'
      : '<th>#</th><th>Fecha</th><th>Estado</th><th>GP / Responsable</th><th>Cliente</th><th>NIT</th><th>Productos</th><th>Total</th>';

    var html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8">' +
      '<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>' +
      '<x:ExcelWorksheet><x:Name>Reporte SAT</x:Name>' +
      '<x:WorksheetOptions><x:DoNotDisplayGridlines/></x:WorksheetOptions>' +
      '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->' +
      '<style>' +
      'body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000}' +
      'table{border-collapse:collapse}' +
      'td,th{border:1pt solid #000;padding:6px 8px;vertical-align:middle}' +
      '.title{font-size:14pt;font-weight:700;text-align:center}' +
      '.meta{font-weight:700;text-align:center}' +
      '.head th{background:#f2f2f2;font-weight:700;text-align:center}' +
      '.num{text-align:center}' +
      '</style></head><body>' +
      '<table>' +
        '<tr><td class="title" colspan="' + colCount + '">' + excelEscape(title) + '</td></tr>' +
        '<tr><td class="meta" colspan="' + colCount + '">Alcance: ' + excelEscape(scopeLabel) +
          ' · Rango: ' + excelEscape(rangoLabel) +
          ' · Total: ' + rows.length +
          ' · Descarga: ' + excelEscape(formatDateDMY(toDateKey(new Date().toISOString()))) +
        '</td></tr>' +
        '<tr class="head">' + headCols + '</tr>' +
        (detailRows || ('<tr><td class="num" colspan="' + colCount + '">Sin cotizaciones en ese rango</td></tr>')) +
      '</table></body></html>';

    var stamp = fileStampRange(range.from, range.to);
    var prefix = isClient ? 'Reporte-SAT-Clientes-' : 'Reporte-SAT-Gerentes-';
    var blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = prefix + stamp + '.xls';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (eR) { /* ignore */ } }, 1500);
    setMessage(
      rows.length
        ? ('Reporte descargado: ' + rows.length + ' cotización(es).')
        : 'No hay cotizaciones en ese rango de fechas.',
      rows.length ? 'ok' : 'error'
    );
  }

  function setActiveTab(tab) {
    activeTab = tab || 'quotes-gerentes';
    var tabs = document.querySelectorAll('.sat-admin-stats .admin-stat.is-tab');
    tabs.forEach(function (el) {
      var on = el.getAttribute('data-tab') === activeTab;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var pGer = document.getElementById('satPanelQuotesGerentes');
    var pCli = document.getElementById('satPanelQuotesClient');
    var pMgr = document.getElementById('satPanelGerentes');
    if (pGer) pGer.hidden = activeTab !== 'quotes-gerentes';
    if (pCli) pCli.hidden = activeTab !== 'quotes-client';
    if (pMgr) pMgr.hidden = activeTab !== 'gerentes';

    updateReportMeta();

    if (activeTab === 'quotes-gerentes') loadGerentesQuotes();
    else if (activeTab === 'quotes-client') loadClientQuotes();
    else if (activeTab === 'gerentes') loadGerentes();
  }

  function renderGerentesQuotes() {
    var body = document.getElementById('satQuotesGerentesBody');
    var countEl = document.getElementById('satQuoteGerentesCount');
    if (countEl) countEl.textContent = String(gerentesQuotesCache.length);
    if (!body) return;
    var rows = quotesForActiveReport();
    updateReportMeta();
    if (!gerentesQuotesCache.length) {
      body.innerHTML = '<tr><td colspan="8">Aún no hay cotizaciones de gerentes con productos SAT.</td></tr>';
      return;
    }
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8">No hay cotizaciones de gerentes en ese rango de fechas.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (q) {
      var id = String(q.id || '');
      return (
        '<tr>' +
          '<td>' + estadoBadgeHtml(q) + '</td>' +
          '<td>' + escapeHtml(formatDateOnly(q.created_at)) + '</td>' +
          '<td>' + escapeHtml(sellerLabel(q)) + '</td>' +
          '<td>' + escapeHtml(q.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(q.nit || '') + '</td>' +
          '<td>' + quoteProductCount(q) + '</td>' +
          '<td>' + escapeHtml(quoteTotalLabel(q)) + '</td>' +
          '<td class="admin-actions">' +
            '<button type="button" class="admin-view-quote" data-quote-id="' + escapeHtml(id) + '" data-scope="gerentes">Ver</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderClientQuotes() {
    var body = document.getElementById('satQuotesClientBody');
    var countEl = document.getElementById('satQuoteClientCount');
    if (countEl) countEl.textContent = String(clientQuotesCache.length);
    if (!body) return;
    var rows = quotesForActiveReport();
    updateReportMeta();
    if (!clientQuotesCache.length) {
      body.innerHTML = '<tr><td colspan="7">Aún no hay cotizaciones del portal de clientes de los GP.</td></tr>';
      return;
    }
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7">No hay cotizaciones de clientes en ese rango de fechas.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (q) {
      var id = String(q.id || '');
      return (
        '<tr>' +
          '<td>' + estadoBadgeHtml(q) + '</td>' +
          '<td>' + escapeHtml(formatDateOnly(q.created_at)) + '</td>' +
          '<td>' + escapeHtml(q.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(q.nit || '') + '</td>' +
          '<td>' + quoteProductCount(q) + '</td>' +
          '<td>' + escapeHtml(quoteTotalLabel(q)) + '</td>' +
          '<td class="admin-actions">' +
            '<button type="button" class="admin-view-quote" data-quote-id="' + escapeHtml(id) + '" data-scope="clientes">Ver</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderGerentes() {
    var body = document.getElementById('satGerentesBody');
    var countEl = document.getElementById('satGerentesCount');
    if (countEl) countEl.textContent = String(gerentesCache.length);
    if (!body) return;
    if (!gerentesCache.length) {
      body.innerHTML = '<tr><td colspan="6">No hay gerentes de producto registrados.</td></tr>';
      return;
    }
    body.innerHTML = gerentesCache.map(function (g, idx) {
      var rawCode = String(g.codigo || g.usuario || g.nit || '').toUpperCase();
      var code = formatGpDisplay(rawCode);
      var nombre = String(g.nombre || '').trim();
      var nombreNorm = nombre.toUpperCase().replace(/[\s.]/g, '');
      if (!nombre || /^GP\d{1,4}$/.test(nombreNorm) || nombreNorm === rawCode.replace(/[\s.]/g, '')) {
        nombre = '—';
      }
      return (
        '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><strong>' + escapeHtml(code || '—') + '</strong>' +
            (g.password_default ? '<div class="admin-muted">clave temporal</div>' : '') +
          '</td>' +
          '<td>' + escapeHtml(nombre) + '</td>' +
          '<td>' + escapeHtml(g.bitrix_id || '—') + '</td>' +
          '<td>' + escapeHtml(formatDateOnly(g.created_at)) + '</td>' +
          '<td class="admin-actions">' +
            '<button type="button" class="admin-filter-clear sat-gp-delete" data-gp="' + escapeHtml(rawCode) + '">Eliminar</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  var pendingDeleteGp = '';
  var gpDeleteModalBound = false;

  function formatGpDisplay(codigo) {
    var raw = String(codigo || '').toUpperCase();
    var m = raw.match(/^GP(\d+)$/);
    if (!m) return raw;
    var digits = String(parseInt(m[1], 10));
    if (digits.length < 2) digits = ('00' + digits).slice(-2);
    return 'GP' + digits;
  }

  function closeGpDeleteModal() {
    pendingDeleteGp = '';
    var modal = document.getElementById('satGpDeleteModal');
    if (modal) modal.hidden = true;
  }

  function openGpDeleteModal(codigo) {
    var code = String(codigo || '').toUpperCase();
    if (!code) return;
    pendingDeleteGp = code;
    var text = document.getElementById('satGpDeleteText');
    if (text) {
      text.textContent = '¿Seguro que quieres eliminar el gerente ' + formatGpDisplay(code) + '?';
    }
    var modal = document.getElementById('satGpDeleteModal');
    if (modal) modal.hidden = false;
  }

  function confirmDeleteGp() {
    var code = pendingDeleteGp;
    closeGpDeleteModal();
    if (!code) return;
    setMessage('Eliminando ' + formatGpDisplay(code) + '…', '');
    return postApi(actorPayload({ action: 'delete_gp', codigo: code })).then(function (data) {
      if (!data || !data.ok) {
        setMessage((data && data.error) || 'No se pudo eliminar.', 'error');
        return;
      }
      setMessage(data.message || ('Gerente ' + formatGpDisplay(code) + ' eliminado.'), 'ok');
      return loadGerentes();
    }).catch(function () {
      setMessage('No se pudo eliminar.', 'error');
    });
  }

  function deleteGp(codigo) {
    openGpDeleteModal(codigo);
  }

  function loadGerentesQuotes() {
    setMessage('Cargando cotizaciones de gerentes…', '');
    return postApi(actorPayload({
      action: 'list_quotes_sat',
      scope: 'gerentes',
      fast: 1,
      list_only: 1
    })).then(function (data) {
      gerentesQuotesCache = (data && data.ok && Array.isArray(data.quotes)) ? data.quotes : [];
      renderGerentesQuotes();
      if (typeof data.client_count === 'number') {
        var cc = document.getElementById('satQuoteClientCount');
        if (cc) cc.textContent = String(data.client_count);
      }
      if (typeof data.gerentes_count === 'number') {
        var gc = document.getElementById('satGerentesCount');
        if (gc) gc.textContent = String(data.gerentes_count);
      }
      if (data && !data.ok) setMessage(data.error || 'No se pudieron cargar las cotizaciones.', 'error');
      else setMessage('', '');
    }).catch(function () {
      gerentesQuotesCache = [];
      renderGerentesQuotes();
      setMessage('No se pudo cargar. Ejecuta tools\\ABRIR.bat.', 'error');
    });
  }

  function loadClientQuotes() {
    setMessage('Cargando cotizaciones de clientes…', '');
    return postApi(actorPayload({
      action: 'list_quotes_sat',
      scope: 'clientes',
      fast: 1,
      list_only: 1
    })).then(function (data) {
      clientQuotesCache = (data && data.ok && Array.isArray(data.quotes)) ? data.quotes : [];
      renderClientQuotes();
      if (typeof data.gerentes_quotes_count === 'number') {
        var gc = document.getElementById('satQuoteGerentesCount');
        if (gc) gc.textContent = String(data.gerentes_quotes_count);
      }
      if (data && !data.ok) setMessage(data.error || 'No se pudieron cargar las cotizaciones.', 'error');
      else setMessage('', '');
    }).catch(function () {
      clientQuotesCache = [];
      renderClientQuotes();
      setMessage('No se pudo cargar. Ejecuta tools\\ABRIR.bat.', 'error');
    });
  }

  function loadGerentes() {
    setMessage('Cargando gerentes de producto…', '');
    return postApi(actorPayload({
      action: 'list_gerentes_producto'
    })).then(function (data) {
      gerentesCache = (data && data.ok && Array.isArray(data.gerentes)) ? data.gerentes : [];
      renderGerentes();
      if (data && !data.ok) setMessage(data.error || 'No se pudieron cargar los gerentes.', 'error');
      else setMessage('', '');
    }).catch(function () {
      gerentesCache = [];
      renderGerentes();
      setMessage('No se pudo cargar. Ejecuta tools\\ABRIR.bat.', 'error');
    });
  }

  function quoteItemsList(quote) {
    if (!quote) return [];
    if (Array.isArray(quote.items)) return quote.items.filter(Boolean);
    return [];
  }

  function renderQuoteDetail(quote) {
    var box = document.getElementById('satQuoteDetailBody');
    var meta = document.getElementById('satQuoteDetailMeta');
    if (!box) return;
    if (!quote) {
      box.innerHTML = '<p class="admin-muted">Cotización no encontrada.</p>';
      return;
    }
    if (meta) {
      meta.textContent = [
        quote.nombre || '—',
        quote.nit ? ('NIT ' + quote.nit) : '',
        formatDateOnly(quote.created_at),
        sellerLabel(quote)
      ].filter(Boolean).join(' · ');
    }
    var items = quoteItemsList(quote);
    if (!items.length) {
      box.innerHTML = '<p class="admin-muted">Sin detalle de productos. Total: ' + escapeHtml(quoteTotalLabel(quote)) + '</p>';
      return;
    }
    box.innerHTML =
      '<table class="admin-table"><thead><tr><th>Producto</th><th>Cant.</th><th>Total</th></tr></thead><tbody>' +
      items.map(function (it) {
        var name = it.name || it.nombre || it.sku || '—';
        var qty = it.qty || it.cantidad || 1;
        var lineTotal = formatUSD(it.totalUsdIva || it.totalUsd || it.usdIva || it.usd) ||
          formatCOP(it.totalCopIva || it.totalCop || it.copIva || it.cop) || '—';
        return '<tr><td>' + escapeHtml(name) +
          (it.sku ? '<div class="admin-muted">SKU ' + escapeHtml(it.sku) + '</div>' : '') +
          '</td><td>' + escapeHtml(qty) + '</td><td>' + escapeHtml(lineTotal) + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  function openQuoteModal(id, scope) {
    openQuoteId = String(id || '');
    var modal = document.getElementById('satQuoteDetailModal');
    var box = document.getElementById('satQuoteDetailBody');
    if (modal) modal.hidden = false;
    if (box) box.innerHTML = '<p class="admin-muted">Cargando…</p>';
    var cache = scope === 'clientes' ? clientQuotesCache : gerentesQuotesCache;
    var found = null;
    cache.forEach(function (q) {
      if (String(q.id || '') === openQuoteId) found = q;
    });
    if (found && quoteItemsList(found).length) {
      renderQuoteDetail(found);
      return;
    }
    postApi(actorPayload({
      action: 'get_quote_sat',
      quote_id: openQuoteId
    })).then(function (data) {
      if (String(openQuoteId) !== String(id)) return;
      if (data && data.ok && data.quote) renderQuoteDetail(data.quote);
      else if (found) renderQuoteDetail(found);
      else if (box) box.innerHTML = '<p class="admin-muted">No se pudo abrir la cotización.</p>';
    }).catch(function () {
      if (found) renderQuoteDetail(found);
      else if (box) box.innerHTML = '<p class="admin-muted">No se pudo abrir la cotización.</p>';
    });
  }

  function closeQuoteModal() {
    var modal = document.getElementById('satQuoteDetailModal');
    if (modal) modal.hidden = true;
    openQuoteId = '';
  }

  function bindUi() {
    document.querySelectorAll('.sat-admin-stats .admin-stat.is-tab').forEach(function (btn) {
      if (btn._satTabBound) return;
      btn._satTabBound = true;
      btn.addEventListener('click', function () {
        setActiveTab(btn.getAttribute('data-tab') || 'quotes-gerentes');
      });
    });

    var cardGp = document.querySelector('.profile-admin-card');
    if (cardGp && !cardGp._satGpDelBound) {
      cardGp._satGpDelBound = true;
      cardGp.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('.sat-gp-delete') : null;
        if (!btn) return;
        deleteGp(btn.getAttribute('data-gp'));
      });
    }

    var card = document.querySelector('.profile-admin-card');
    if (card && !card._satClickBound) {
      card._satClickBound = true;
      card.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('.admin-view-quote') : null;
        if (!btn) return;
        openQuoteModal(btn.getAttribute('data-quote-id'), btn.getAttribute('data-scope') || 'gerentes');
      });
    }

    if (!quoteModalBound) {
      quoteModalBound = true;
      document.querySelectorAll('#satQuoteDetailModal [data-modal-close]').forEach(function (el) {
        el.addEventListener('click', closeQuoteModal);
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          closeQuoteModal();
          closeGpDeleteModal();
        }
      });
    }

    if (!gpDeleteModalBound) {
      gpDeleteModalBound = true;
      var gpModal = document.getElementById('satGpDeleteModal');
      if (gpModal) {
        gpModal.addEventListener('click', function (ev) {
          var closer = ev.target && ev.target.closest ? ev.target.closest('[data-gp-delete-close]') : null;
          if (closer || ev.target === gpModal) closeGpDeleteModal();
        });
      }
      var gpConfirm = document.getElementById('satGpDeleteConfirm');
      if (gpConfirm) {
        gpConfirm.addEventListener('click', function () {
          confirmDeleteGp();
        });
      }
    }

    if (!document.body._satReportBound) {
      document.body._satReportBound = true;
      var fromEl = document.getElementById('satReportFrom');
      var toEl = document.getElementById('satReportTo');
      var dlBtn = document.getElementById('satReportDownloadBtn');
      function onRangeChange() {
        updateReportMeta();
        if (activeTab === 'quotes-gerentes') renderGerentesQuotes();
        else if (activeTab === 'quotes-client') renderClientQuotes();
      }
      if (fromEl) fromEl.addEventListener('change', onRangeChange);
      if (toEl) toEl.addEventListener('change', onRangeChange);
      if (dlBtn) dlBtn.addEventListener('click', downloadSatQuotesReport);
    }
  }

  function boot() {
    bindLogout();
    bindUi();
    function ready() {
      bindLogout();
      if (!fillProfile()) return;
      bindUi();
      setActiveTab('quotes-gerentes');
      postApi(actorPayload({ action: 'list_quotes_sat', scope: 'clientes', fast: 1, list_only: 1 }))
        .then(function (data) {
          if (data && data.ok && Array.isArray(data.quotes)) {
            clientQuotesCache = data.quotes;
            var cc = document.getElementById('satQuoteClientCount');
            if (cc) cc.textContent = String(clientQuotesCache.length);
          }
        }).catch(function () { /* ignore */ });
      postApi(actorPayload({ action: 'list_gerentes_producto' }))
        .then(function (data) {
          if (data && data.ok && Array.isArray(data.gerentes)) {
            gerentesCache = data.gerentes;
            var gc = document.getElementById('satGerentesCount');
            if (gc) gc.textContent = String(gerentesCache.length);
          }
        }).catch(function () { /* ignore */ });
    }
    if (window.IZCAuth && typeof IZCAuth.whenSessionReady === 'function') {
      IZCAuth.whenSessionReady().then(ready).catch(ready);
    } else {
      window.setTimeout(ready, 80);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
