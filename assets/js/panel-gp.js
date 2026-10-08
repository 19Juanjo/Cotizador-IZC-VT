/* Panel Gerente de Producto (GP): clientes Bitrix, historial propio y cotizaciones de clientes. */
(function () {
  'use strict';

  var activeTab = 'clientes';
  var gpCodigo = '';
  var clientesCache = [];
  var historialCache = [];
  var clientQuotesCache = [];
  var fibraCache = [];
  var openQuoteId = '';
  var lastOpenedQuote = null;
  var quoteModalBound = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setMessage(text, type) {
    var el = document.getElementById('gpPanelMessage') || document.getElementById('gpMessage');
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
    if (!logout || logout._gpBound) return;
    logout._gpBound = true;
    logout.addEventListener('click', function (ev) {
      try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) { /* ignore */ }
      doLogout();
    });
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
    var code = gpCodigo || nit || '';
    var base = {
      gp_codigo: code,
      asesor_codigo: code,
      nit: code,
      admin_nit: code
    };
    if (!extra) return base;
    Object.keys(extra).forEach(function (k) { base[k] = extra[k]; });
    return base;
  }

  function formatGpDisplay(codigo) {
    var raw = String(codigo || '').toUpperCase().replace(/[\s.]/g, '');
    var m = raw.match(/^GP(\d+)$/);
    if (!m) return raw || '';
    var digits = String(parseInt(m[1], 10));
    if (digits.length < 2) digits = ('00' + digits).slice(-2);
    return 'GP' + digits;
  }

  function isGpCodeLike(value) {
    var n = String(value || '').trim().toUpperCase().replace(/[\s.]/g, '');
    return /^GP\d{1,4}$/.test(n);
  }

  function isFibraGp() {
    var raw = String(gpCodigo || '').toUpperCase().replace(/[\s.]/g, '');
    var m = raw.match(/^GP(\d{1,4})$/);
    if (!m) return false;
    var n = String(parseInt(m[1], 10));
    return n === '23' || n === '0';
  }

  function syncFibraTabVisibility() {
    var tab = document.getElementById('gpTabFibra');
    var panel = document.getElementById('gpPanelFibra');
    var show = isFibraGp();
    if (tab) tab.hidden = !show;
    if (!show && panel) panel.hidden = true;
    if (!show && activeTab === 'fibra') activeTab = 'clientes';
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
    if (isGpCodeLike(nombre)) nombre = '';
    return nombre;
  }

  function isEditingNombre() {
    var card = profileCard();
    return !!(card && card.classList.contains('is-editing-name'));
  }

  function greetingLabel() {
    var code = formatGpDisplay(gpCodigo);
    var nombre = currentProfileNombre();
    if (nombre) return code ? (code + ' · ' + nombre) : nombre;
    return code || 'GP';
  }

  function setNombreEditUi(editing) {
    var card = profileCard();
    var greet = document.getElementById('profileGreeting');
    var input = document.getElementById('gpNombreInput');
    var toggle = document.getElementById('gpNombreToggle');
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
    var el = document.getElementById('gpNombreStatus');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'auth-message profile-name-status');
      return;
    }
    el.textContent = text || '';
    el.className = 'auth-message profile-name-status' + (type ? ' is-' + type : '');
  }

  function saveGpNombre() {
    var input = document.getElementById('gpNombreInput');
    var code = gpCodigo || '';
    if (!input || !code) return;
    var nombre = String(input.value || '').trim();
    if (nombre.length < 2) {
      setNombreStatus('Ingresa un nombre válido (mínimo 2 caracteres).', 'error');
      setNombreEditUi(true);
      return;
    }
    if (isGpCodeLike(nombre)) {
      setNombreStatus('Escribe tu nombre completo, no el código GP.', 'error');
      setNombreEditUi(true);
      return;
    }
    setNombreStatus('Guardando…', '');
    postApi(actorPayload({
      action: 'update_gp_nombre',
      gp_codigo: code,
      codigo: code,
      nombre: nombre
    })).then(function (data) {
      if (!data || !data.ok) {
        setNombreStatus((data && data.error) || 'No se pudo guardar el nombre.', 'error');
        return;
      }
      var saved = String(data.nombre || nombre).trim();
      if (window.IZCAuth && typeof IZCAuth.setSessionNit === 'function') {
        IZCAuth.setSessionNit(code, saved, { role: 'gp', skipUi: true });
      }
      try { localStorage.setItem('izc_session_nombre', saved); } catch (eS) { /* ignore */ }
      var greet = document.getElementById('profileGreeting');
      if (greet) greet.textContent = 'Hola ' + (formatGpDisplay(code) + ' · ' + saved);
      setNombreEditUi(false);
      setNombreStatus(data.message || 'Nombre actualizado.', 'ok');
    }).catch(function () {
      setNombreStatus('No se pudo guardar el nombre.', 'error');
    });
  }

  function bindNombreEdit() {
    var toggle = document.getElementById('gpNombreToggle');
    var input = document.getElementById('gpNombreInput');
    if (toggle && !toggle._gpNombreBound) {
      toggle._gpNombreBound = true;
      toggle.addEventListener('click', function () {
        if (isEditingNombre()) saveGpNombre();
        else {
          setNombreStatus('', '');
          setNombreEditUi(true);
        }
      });
    }
    if (input && !input._gpNombreBound) {
      input._gpNombreBound = true;
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          saveGpNombre();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          setNombreEditUi(false);
          setNombreStatus('', '');
          var greet = document.getElementById('profileGreeting');
          if (greet) greet.textContent = 'Hola ' + greetingLabel();
        }
      });
    }
  }

  function fillProfile() {
    if (!window.IZCAuth) {
      window.location.replace('login.html');
      return false;
    }
    var allowed = (typeof IZCAuth.isGp === 'function' && IZCAuth.isGp()) ||
      (typeof IZCAuth.isSat === 'function' && IZCAuth.isSat()) ||
      (typeof IZCAuth.isAdmin === 'function' && IZCAuth.isAdmin());
    if (!allowed) {
      window.location.replace('login.html');
      return false;
    }

    var nit = '';
    var nombre = '';
    try {
      nit = String(localStorage.getItem('izc_session_nit') || '').trim().toUpperCase();
      nombre = String(localStorage.getItem('izc_session_nombre') || '').trim();
    } catch (e) { /* ignore */ }
    if (!nit && typeof IZCAuth.getSessionNit === 'function') {
      nit = String(IZCAuth.getSessionNit() || '').trim().toUpperCase();
    }
    if (!nombre && typeof IZCAuth.getSessionNombre === 'function') {
      nombre = String(IZCAuth.getSessionNombre() || '').trim();
    }
    gpCodigo = nit;
    syncFibraTabVisibility();
    var greet = document.getElementById('profileGreeting');
    if (greet && !isEditingNombre()) {
      greet.textContent = 'Hola ' + greetingLabel();
    }
    bindNombreEdit();
    return true;
  }

  function formatDateOnly(raw) {
    var s = String(raw || '').trim();
    if (!s) return '—';
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return s.slice(0, 10) || '—';
    var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var month = meses[parseInt(m[2], 10) - 1];
    if (!month) return m[1] + '-' + m[2] + '-' + m[3];
    return String(parseInt(m[3], 10)) + ' ' + month + ' ' + m[1];
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
      nueva: 'Nueva', cotizado: 'Cotizado', pendiente: 'Pendiente',
      seguimiento: 'Seguimiento', vendido: 'Vendido', perdida: 'Perdida',
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

  function setActiveTab(tab) {
    activeTab = tab || 'clientes';
    if (activeTab === 'fibra' && !isFibraGp()) activeTab = 'clientes';
    document.querySelectorAll('.sat-admin-stats .admin-stat.is-tab').forEach(function (el) {
      var on = el.getAttribute('data-tab') === activeTab;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var pCli = document.getElementById('gpPanelClientes');
    var pHis = document.getElementById('gpPanelHistorial');
    var pQc = document.getElementById('gpPanelQuotesClient');
    var pFib = document.getElementById('gpPanelFibra');
    if (pCli) pCli.hidden = activeTab !== 'clientes';
    if (pHis) pHis.hidden = activeTab !== 'historial';
    if (pQc) pQc.hidden = activeTab !== 'quotes-client';
    if (pFib) pFib.hidden = !(isFibraGp() && activeTab === 'fibra');

    if (activeTab === 'clientes') loadClientes();
    else if (activeTab === 'historial') loadHistorial();
    else if (activeTab === 'quotes-client') loadClientQuotes();
    else if (activeTab === 'fibra') loadFibraQuotes();
  }

  function renderClientes() {
    var body = document.getElementById('gpClientesBody');
    var countEl = document.getElementById('gpClientCount');
    if (countEl) countEl.textContent = String(clientesCache.length);
    if (!body) return;
    if (!clientesCache.length) {
      body.innerHTML = '<tr><td colspan="4">Aún no tienes clientes. Usa «Registrar cliente» para agregar uno.</td></tr>';
      return;
    }
    body.innerHTML = clientesCache.map(function (c, idx) {
      return (
        '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td>' + escapeHtml(c.nit || '—') + '</td>' +
          '<td>' + escapeHtml(c.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(c.telefono || '—') + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function normalizeNitInput(value) {
    return String(value || '').replace(/\D+/g, '');
  }

  function setClienteFormStatus(text, type) {
    var el = document.getElementById('gpClienteFormStatus');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'auth-message');
      return;
    }
    el.textContent = text || '';
    el.className = 'auth-message' + (type ? ' is-' + type : '');
  }

  function openClienteRegisterModal() {
    var modal = document.getElementById('gpClienteModal');
    var nitInput = document.getElementById('gpClienteNitInput');
    var nombreInput = document.getElementById('gpClienteNombreInput');
    if (!modal) return;
    setClienteFormStatus('', '');
    if (nitInput) nitInput.value = '';
    if (nombreInput) nombreInput.value = '';
    modal.hidden = false;
    window.setTimeout(function () {
      if (nitInput) nitInput.focus();
    }, 30);
  }

  function closeClienteRegisterModal() {
    var modal = document.getElementById('gpClienteModal');
    if (modal) modal.hidden = true;
  }

  function registerClienteGp() {
    var nitInput = document.getElementById('gpClienteNitInput');
    var nombreInput = document.getElementById('gpClienteNombreInput');
    if (!gpCodigo || !nitInput || !nombreInput) return;
    var nit = normalizeNitInput(nitInput.value);
    var nombre = String(nombreInput.value || '').trim();
    if (!nit || nit.length < 6 || nit.length > 15) {
      setClienteFormStatus('NIT inválido. Usa solo números (6 a 15 dígitos).', 'error');
      return;
    }
    if (nombre.length < 2) {
      setClienteFormStatus('Ingresa el nombre del cliente (mínimo 2 caracteres).', 'error');
      return;
    }
    setClienteFormStatus('Guardando…', '');
    postApi(actorPayload({
      action: 'register_cliente_gp',
      gp_codigo: gpCodigo,
      client_nit: nit,
      nombre: nombre
    })).then(function (data) {
      if (!data || !data.ok) {
        var err = (data && data.error) || 'No se pudo registrar el cliente.';
        if (/acci[oó]n no v[aá]lida/i.test(err)) {
          err = 'El servidor está desactualizado. Cierra y vuelve a abrir tools\\ABRIR.bat.';
        }
        setClienteFormStatus(err, 'error');
        return;
      }
      if (Array.isArray(data.clientes)) {
        clientesCache = data.clientes;
      } else if (data.cliente) {
        var found = false;
        var newNit = normalizeNitInput(data.cliente.nit || nit);
        clientesCache = clientesCache.map(function (c) {
          if (normalizeNitInput(c.nit) === newNit) {
            found = true;
            return data.cliente;
          }
          return c;
        });
        if (!found) clientesCache = clientesCache.concat([data.cliente]);
      }
      renderClientes();
      setMessage(data.message || 'Cliente registrado.', 'ok');
      closeClienteRegisterModal();
    }).catch(function () {
      setClienteFormStatus('No se pudo guardar. Ejecuta tools\\ABRIR.bat.', 'error');
    });
  }

  function applyQuoteCounts(data) {
    if (!data || !data.ok) return;
    if (typeof data.historial_count === 'number') {
      var h = document.getElementById('gpHistorialCount');
      if (h) h.textContent = String(data.historial_count);
    }
    if (typeof data.client_quotes_count === 'number') {
      var c = document.getElementById('gpClientQuotesCount');
      if (c) c.textContent = String(data.client_quotes_count);
    }
    if (isFibraGp() && typeof data.fibra_count === 'number') {
      var f = document.getElementById('gpFibraCount');
      if (f) f.textContent = String(data.fibra_count);
    }
    if (typeof data.clientes_count === 'number') {
      var n = document.getElementById('gpClientCount');
      if (n && activeTab !== 'clientes') n.textContent = String(data.clientes_count);
    }
  }

  var FIBRA_DESDE = '2026-08-21';

  function quoteDayKey(q) {
    var s = String((q && (q.created_at || q.finished_at)) || '').trim();
    var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    var id = String((q && q.id) || '');
    var im = id.match(/^(20\d{2})(\d{2})(\d{2})/);
    if (im) return im[1] + '-' + im[2] + '-' + im[3];
    return '';
  }

  function quoteIsFibraDateOk(q) {
    var day = quoteDayKey(q);
    return day !== '' && day >= FIBRA_DESDE;
  }

  function quoteSellerLabel(q) {
    var code = String((q && (q.seller_codigo || q.assigned_vendedor)) || '').trim().toUpperCase();
    var name = String((q && q.seller_name) || '').replace(/\s+/g, ' ').trim();
    if (name) {
      name = name.replace(/^V\d{1,4}\s*[·\-:]\s*/i, '').trim();
      if (code && name.toUpperCase().indexOf(code) !== -1) {
        if (!/\bIZC\b/i.test(name)) name = 'IZC ' + name;
        return name;
      }
      if (code) {
        if (!/\bIZC\b/i.test(name)) return ('IZC ' + code + ' ' + name).replace(/\s+/g, ' ').trim();
        return name;
      }
      return name;
    }
    if (code) return 'IZC ' + code;
    return '—';
  }

  function renderQuotes(bodyId, countId, list, emptyMsg, scope) {
    var body = document.getElementById(bodyId);
    var countEl = document.getElementById(countId);
    if (!body) return;
    var showSeller = scope === 'fibra';
    var cols = showSeller ? 8 : 7;
    if (scope === 'fibra') {
      list = (list || []).filter(quoteIsFibraDateOk);
    }
    if (countEl) countEl.textContent = String(list.length);
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="' + cols + '">' + escapeHtml(emptyMsg) + '</td></tr>';
      return;
    }
    body.innerHTML = list.map(function (q) {
      var id = String(q.id || '');
      return (
        '<tr>' +
          '<td class="admin-estado-cell gp-nowrap">' + estadoBadgeHtml(q) + '</td>' +
          '<td class="admin-date-cell gp-nowrap">' + escapeHtml(formatDateOnly(q.created_at)) + '</td>' +
          (showSeller ? '<td class="gp-nowrap">' + escapeHtml(quoteSellerLabel(q)) + '</td>' : '') +
          '<td class="gp-nowrap gp-col-client" title="' + escapeHtml(q.nombre || '—') + '">' + escapeHtml(q.nombre || '—') + '</td>' +
          '<td class="gp-nowrap">' + escapeHtml(q.nit || '') + '</td>' +
          '<td class="gp-nowrap">' + quoteProductCount(q) + '</td>' +
          '<td class="gp-nowrap">' + escapeHtml(quoteTotalLabel(q)) + '</td>' +
          '<td class="admin-actions gp-nowrap">' +
            '<div class="admin-actions-btns">' +
              '<button type="button" class="admin-view-quote" data-quote-id="' + escapeHtml(id) + '" data-scope="' + escapeHtml(scope) + '">Ver</button>' +
              '<button type="button" class="admin-quote-pdf-row" data-quote-id="' + escapeHtml(id) + '" data-scope="' + escapeHtml(scope) + '" data-currency="USD">PDF USD</button>' +
              '<button type="button" class="admin-quote-pdf-row" data-quote-id="' + escapeHtml(id) + '" data-scope="' + escapeHtml(scope) + '" data-currency="COP">PDF COP</button>' +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function loadClientes(opts) {
    opts = opts || {};
    setMessage(opts.refreshBitrix ? 'Actualizando clientes desde Bitrix…' : 'Cargando clientes…', '');
    return postApi(actorPayload({
      action: 'list_clientes_gp',
      refresh_bitrix: opts.refreshBitrix ? 1 : 0
    })).then(function (data) {
      clientesCache = (data && data.ok && Array.isArray(data.clientes)) ? data.clientes : [];
      renderClientes();
      if (data && !data.ok) setMessage(data.error || 'No se pudieron cargar los clientes.', 'error');
      else if (data && data.bitrix_error) setMessage(data.bitrix_error, 'error');
      else setMessage('', '');
    }).catch(function () {
      clientesCache = [];
      renderClientes();
      setMessage('No se pudo cargar. Ejecuta tools\\ABRIR.bat.', 'error');
    });
  }

  function loadHistorial() {
    setMessage('Cargando historial…', '');
    return postApi(actorPayload({
      action: 'list_quotes_gp',
      scope: 'historial',
      fast: 1,
      list_only: 1
    })).then(function (data) {
      historialCache = (data && data.ok && Array.isArray(data.quotes)) ? data.quotes : [];
      renderQuotes('gpHistorialBody', 'gpHistorialCount', historialCache, 'Aún no has creado cotizaciones en el Cotizador SAT.', 'historial');
      applyQuoteCounts(data);
      if (data && !data.ok) setMessage(data.error || 'No se pudo cargar el historial.', 'error');
      else setMessage('', '');
    }).catch(function () {
      historialCache = [];
      renderQuotes('gpHistorialBody', 'gpHistorialCount', [], 'No se pudo cargar.', 'historial');
      setMessage('No se pudo cargar. Ejecuta tools\\ABRIR.bat.', 'error');
    });
  }

  function loadClientQuotes() {
    setMessage('Cargando cotizaciones de clientes…', '');
    return postApi(actorPayload({
      action: 'list_quotes_gp',
      scope: 'clientes',
      fast: 1,
      list_only: 1
    })).then(function (data) {
      clientQuotesCache = (data && data.ok && Array.isArray(data.quotes)) ? data.quotes : [];
      renderQuotes('gpQuotesClientBody', 'gpClientQuotesCount', clientQuotesCache, 'Aún no hay cotizaciones de tus clientes.', 'clientes');
      applyQuoteCounts(data);
      if (data && !data.ok) setMessage(data.error || 'No se pudieron cargar.', 'error');
      else setMessage('', '');
    }).catch(function () {
      clientQuotesCache = [];
      renderQuotes('gpQuotesClientBody', 'gpClientQuotesCount', [], 'No se pudo cargar.', 'clientes');
      setMessage('No se pudo cargar. Ejecuta tools\\ABRIR.bat.', 'error');
    });
  }

  function loadFibraQuotes() {
    if (!isFibraGp()) {
      syncFibraTabVisibility();
      setActiveTab('clientes');
      return Promise.resolve();
    }
    setMessage('Cargando cotizaciones de fibra…', '');
    return postApi(actorPayload({
      action: 'list_quotes_gp',
      scope: 'fibra',
      fast: 1,
      list_only: 1
    })).then(function (data) {
      fibraCache = (data && data.ok && Array.isArray(data.quotes)) ? data.quotes : [];
      renderQuotes('gpFibraBody', 'gpFibraCount', fibraCache, 'Aún no hay cotizaciones de asesores con productos de fibra.', 'fibra');
      applyQuoteCounts(data);
      if (data && !data.ok) setMessage(data.error || 'No se pudieron cargar.', 'error');
      else setMessage('', '');
    }).catch(function () {
      fibraCache = [];
      renderQuotes('gpFibraBody', 'gpFibraCount', [], 'No se pudo cargar.', 'fibra');
      setMessage('No se pudo cargar. Ejecuta tools\\ABRIR.bat.', 'error');
    });
  }

  function quoteItemsList(quote) {
    if (!quote) return [];
    if (Array.isArray(quote.items)) return quote.items.filter(Boolean);
    return [];
  }

  function renderQuoteDetail(quote) {
    var box = document.getElementById('gpQuoteDetailBody');
    var meta = document.getElementById('gpQuoteDetailMeta');
    var estadoEl = document.getElementById('gpQuoteDetailEstado');
    if (!box) return;
    lastOpenedQuote = quote || null;
    if (!quote) {
      box.innerHTML = '<p class="admin-muted">Cotización no encontrada.</p>';
      if (estadoEl) estadoEl.innerHTML = '';
      return;
    }
    if (estadoEl) {
      estadoEl.innerHTML = 'Estado: ' + estadoBadgeHtml(quote);
    }
    if (meta) {
      meta.textContent = [
        quoteSellerLabel(quote) !== '—' ? ('Asesor ' + quoteSellerLabel(quote)) : '',
        quote.nombre || '—',
        quote.nit ? ('NIT ' + quote.nit) : '',
        formatDateOnly(quote.created_at)
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

  function quoteFromCaches(id, scope) {
    var cache = historialCache;
    if (scope === 'clientes') cache = clientQuotesCache;
    else if (scope === 'fibra') cache = fibraCache;
    var found = null;
    (cache || []).forEach(function (q) {
      if (String(q.id || '') === String(id)) found = q;
    });
    if (found) return found;
    [fibraCache, historialCache, clientQuotesCache].forEach(function (list) {
      (list || []).forEach(function (q) {
        if (!found && String(q.id || '') === String(id)) found = q;
      });
    });
    return found;
  }

  function fetchFullQuote(id, hint) {
    if (hint && quoteItemsList(hint).length) {
      return Promise.resolve(hint);
    }
    return postApi(actorPayload({ action: 'get_quote_gp', quote_id: String(id || '') })).then(function (data) {
      if (data && data.ok && data.quote) return data.quote;
      return hint || null;
    });
  }

  function openPdfPlaceholder() {
    var pdfWin = null;
    try {
      pdfWin = window.open('about:blank', '_blank');
    } catch (eOpen) {
      pdfWin = null;
    }
    if (pdfWin) {
      try {
        pdfWin.document.open();
        pdfWin.document.write(
          '<!doctype html><html><head><meta charset="utf-8"><title>Preparando PDF…</title></head>' +
          '<body style="font-family:Segoe UI,Arial,sans-serif;padding:28px;color:#333">' +
          '<p>Preparando PDF…</p></body></html>'
        );
        pdfWin.document.close();
      } catch (eWrite) { /* ignore */ }
    }
    return pdfWin;
  }

  function downloadQuotePdf(quote, currency) {
    if (!quote) {
      setMessage('Cotización no encontrada.', 'error');
      return;
    }
    if (!window.IZCCotizacionPdf || typeof IZCCotizacionPdf.open !== 'function') {
      setMessage('No se pudo cargar el generador de PDF. Recarga con Ctrl+F5.', 'error');
      return;
    }
    var pdfWin = openPdfPlaceholder();
    var id = String(quote.id || '');
    setMessage('Preparando PDF…', '');
    fetchFullQuote(id, quote).then(function (full) {
      var q = full || quote;
      lastOpenedQuote = q;
      var vendedor = quoteSellerLabel(q);
      if (vendedor === '—') vendedor = String(q.seller_codigo || q.seller_name || '').trim();
      var extras = {
        empresa: q.empresa || (q.totals && q.totals.empresa) || '',
        vendedor: vendedor,
        currency: currency || 'COP',
        targetWindow: pdfWin || undefined,
        autoPrint: false
      };
      var deal = String(q.bitrix_deal_id || '').trim();
      if (deal && /^\d+$/.test(deal) && deal.length <= 12) extras.numero = deal;
      else extras.numeroPendiente = deal || 'Pendiente';
      var opened = IZCCotizacionPdf.open(q, extras);
      var done = function (ok) {
        if (!ok) {
          try { if (pdfWin && !pdfWin.closed) pdfWin.close(); } catch (eC) { /* ignore */ }
          setMessage('No se pudo abrir el PDF. Prueba de nuevo.', 'error');
          return;
        }
        setMessage('PDF abierto.', 'ok');
      };
      if (opened && typeof opened.then === 'function') {
        return opened.then(done);
      }
      done(!!opened);
    }).catch(function () {
      try { if (pdfWin && !pdfWin.closed) pdfWin.close(); } catch (eC2) { /* ignore */ }
      setMessage('No se pudo generar el PDF.', 'error');
    });
  }

  function openQuoteModal(id, scope) {
    openQuoteId = String(id || '');
    var modal = document.getElementById('gpQuoteDetailModal');
    var box = document.getElementById('gpQuoteDetailBody');
    if (modal) modal.hidden = false;
    if (box) box.innerHTML = '<p class="admin-muted">Cargando…</p>';
    var found = quoteFromCaches(openQuoteId, scope);
    lastOpenedQuote = found;
    if (found && quoteItemsList(found).length) {
      renderQuoteDetail(found);
      return;
    }
    postApi(actorPayload({ action: 'get_quote_gp', quote_id: openQuoteId })).then(function (data) {
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
    var modal = document.getElementById('gpQuoteDetailModal');
    if (modal) modal.hidden = true;
    openQuoteId = '';
    lastOpenedQuote = null;
  }

  function bindUi() {
    document.querySelectorAll('.sat-admin-stats .admin-stat.is-tab').forEach(function (btn) {
      if (btn._gpTabBound) return;
      btn._gpTabBound = true;
      btn.addEventListener('click', function () {
        setActiveTab(btn.getAttribute('data-tab') || 'clientes');
      });
    });
    var refresh = document.getElementById('gpClientesRefreshBtn');
    if (refresh && !refresh._gpBound) {
      refresh._gpBound = true;
      refresh.addEventListener('click', function () { loadClientes({ refreshBitrix: true }); });
    }
    var registerBtn = document.getElementById('gpClienteRegisterBtn');
    if (registerBtn && !registerBtn._gpBound) {
      registerBtn._gpBound = true;
      registerBtn.addEventListener('click', openClienteRegisterModal);
    }
    var clienteForm = document.getElementById('gpClienteForm');
    if (clienteForm && !clienteForm._gpBound) {
      clienteForm._gpBound = true;
      clienteForm.addEventListener('submit', function (ev) {
        try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) { /* ignore */ }
        registerClienteGp();
      });
    }
    document.querySelectorAll('[data-gp-cliente-modal-close]').forEach(function (el) {
      if (el._gpClienteCloseBound) return;
      el._gpClienteCloseBound = true;
      el.addEventListener('click', closeClienteRegisterModal);
    });
    var card = document.querySelector('.profile-admin-card');
    if (card && !card._gpClickBound) {
      card._gpClickBound = true;
      card.addEventListener('click', function (ev) {
        var pdfBtn = ev.target && ev.target.closest ? ev.target.closest('.admin-quote-pdf-row') : null;
        if (pdfBtn) {
          var pdfId = pdfBtn.getAttribute('data-quote-id');
          var pdfScope = pdfBtn.getAttribute('data-scope') || 'historial';
          var currency = pdfBtn.getAttribute('data-currency') || 'COP';
          downloadQuotePdf(quoteFromCaches(pdfId, pdfScope) || { id: pdfId }, currency);
          return;
        }
        var btn = ev.target && ev.target.closest ? ev.target.closest('.admin-view-quote') : null;
        if (!btn) return;
        openQuoteModal(btn.getAttribute('data-quote-id'), btn.getAttribute('data-scope') || 'historial');
      });
    }
    if (!quoteModalBound) {
      quoteModalBound = true;
      document.querySelectorAll('#gpQuoteDetailModal [data-modal-close]').forEach(function (el) {
        el.addEventListener('click', closeQuoteModal);
      });
      document.querySelectorAll('#gpQuoteDetailModal .admin-quote-pdf-modal').forEach(function (el) {
        el.addEventListener('click', function () {
          var currency = el.getAttribute('data-currency') || 'COP';
          var q = lastOpenedQuote || quoteFromCaches(openQuoteId, 'fibra');
          downloadQuotePdf(q || { id: openQuoteId }, currency);
        });
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          closeClienteRegisterModal();
          closeQuoteModal();
        }
      });
    }
  }

  function boot() {
    bindLogout();
    bindUi();
    function ready() {
      bindLogout();
      if (!fillProfile()) return;
      bindUi();
      syncFibraTabVisibility();
      setActiveTab('clientes');
      // precargar conteos
      postApi(actorPayload({ action: 'list_quotes_gp', scope: 'historial', fast: 1, list_only: 1 }))
        .then(function (data) {
          if (data && data.ok) {
            historialCache = data.quotes || [];
            applyQuoteCounts(data);
            var h = document.getElementById('gpHistorialCount');
            if (h) h.textContent = String(historialCache.length);
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
