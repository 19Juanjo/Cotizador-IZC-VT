/* Panel del asesor: mis clientes e historial de cotizaciones. */
(function () {
  'use strict';

  var API_ORIGIN = 'http://127.0.0.1:8080';
  var quotesCache = [];
  var nuevasCache = [];
  var clientesCache = [];
  var activeTab = 'clientes';

  function updateQuoteCounts(data) {
    var nuevasEl = document.getElementById('asesorNuevasCount');
    var histEl = document.getElementById('asesorQuoteCount');
    if (data && typeof data.count_nuevas === 'number' && nuevasEl) {
      nuevasEl.textContent = String(data.count_nuevas);
    }
    if (data && typeof data.count_historial === 'number' && histEl) {
      histEl.textContent = String(data.count_historial);
    }
  }

  function setMessage(text, type) {
    var el = document.getElementById('asesorMessage');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'auth-message' + (type ? ' is-' + type : '');
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatCOP(value) {
    return '$ ' + Math.round(Number(value)).toLocaleString('es-CO') + ' COP';
  }

  function formatUSD(value) {
    return '$ ' + Number(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function asFlatArray(value) {
    if (value == null) return [];
    if (!Array.isArray(value)) return [value];
    // Unwrap accidental [[...]] from PowerShell ConvertTo-Json
    if (value.length === 1 && Array.isArray(value[0]) && (value[0].length === 0 || typeof value[0][0] === 'object')) {
      return asFlatArray(value[0]);
    }
    return value;
  }

  function quoteItems(q) {
    var items = q && q.items;
    if (!items) return [];
    return asFlatArray(items);
  }

  function lineTotal(line) {
    if (!line) return '—';
    if (String(line.currency || '').toUpperCase() === 'COP') {
      return formatCOP(line.totalCop != null ? line.totalCop : line.cop);
    }
    if (String(line.currency || '').toUpperCase() === 'USD') {
      return formatUSD(line.totalUsd != null ? line.totalUsd : line.usd);
    }
    if (line.totalUsd != null || line.usd != null) {
      return formatUSD(line.totalUsd != null ? line.totalUsd : line.usd);
    }
    return formatCOP(line.totalCop != null ? line.totalCop : line.cop);
  }

  function quoteCurrencyFlags(quote) {
    var totals = (quote && quote.totals) || {};
    var items = quoteItems(quote);
    var hasUsd = totals.hasUsd === true;
    var hasCop = totals.hasCop === true;
    if (!hasUsd && !hasCop) {
      items.forEach(function (line) {
        var c = String(line.currency || '').toUpperCase();
        if (c === 'COP') hasCop = true;
        else if (c === 'USD') hasUsd = true;
      });
    }
    if (!hasUsd && !hasCop) {
      hasUsd = Number(totals.usdIva) > 0;
      hasCop = Number(totals.copIva) > 0;
    }
    if (!hasUsd && !hasCop) {
      hasUsd = Number(totals.usd) > 0;
      hasCop = Number(totals.cop) > 0 && !hasUsd;
    }
    return { hasUsd: hasUsd, hasCop: hasCop };
  }

  function quoteNativeSums(quote) {
    var totals = (quote && quote.totals) || {};
    var items = quoteItems(quote);
    var flags = quoteCurrencyFlags(quote);
    var sumUsd = 0;
    var sumCop = 0;
    var fromItems = false;
    items.forEach(function (line) {
      var c = String(line.currency || '').toUpperCase();
      if (c === 'COP') {
        fromItems = true;
        sumCop += Number(line.totalCop != null ? line.totalCop : line.cop) || 0;
      } else if (c === 'USD') {
        fromItems = true;
        sumUsd += Number(line.totalUsd != null ? line.totalUsd : line.usd) || 0;
      }
    });
    if (!fromItems) {
      if (flags.hasUsd && !flags.hasCop) sumUsd = Number(totals.usd) || 0;
      else if (flags.hasCop && !flags.hasUsd) sumCop = Number(totals.cop) || 0;
      else {
        if (flags.hasUsd) sumUsd = Number(totals.usdIva) > 0 ? Number(totals.usdIva) / 1.19 : (Number(totals.usd) || 0);
        if (flags.hasCop) sumCop = Number(totals.copIva) > 0 ? Number(totals.copIva) / 1.19 : (Number(totals.cop) || 0);
      }
    }
    return { hasUsd: flags.hasUsd, hasCop: flags.hasCop, usd: sumUsd, cop: sumCop };
  }

  function quoteTotalLabel(quote) {
    var sums = quoteNativeSums(quote);
    var parts = [];
    if (sums.hasUsd) parts.push(formatUSD(sums.usd));
    if (sums.hasCop) parts.push(formatCOP(sums.cop));
    return parts.length ? parts.join(' · ') : '—';
  }

  function quoteTotalTitle(quote) {
    var flags = quoteCurrencyFlags(quote);
    if (flags.hasUsd && flags.hasCop) return 'Total';
    if (flags.hasCop) return 'Total COP';
    if (flags.hasUsd) return 'Total USD';
    return 'Total';
  }

  function sessionCodigo() {
    return (window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || '';
  }

  function postApi(payload) {
    var body = JSON.stringify(payload);
    var endpoints = [API_ORIGIN + '/api/auth', 'api/auth.php', 'api/auth'];
    function isStaleAction(data) {
      var err = String((data && data.error) || '');
      return /acci[oó]n no v[aá]lida/i.test(err);
    }
    function tryOne(i) {
      if (i >= endpoints.length) return Promise.reject(new Error('sin api'));
      return fetch(endpoints[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        cache: 'no-store'
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!data || typeof data !== 'object') throw new Error('Respuesta inválida');
          if (isStaleAction(data) && i + 1 < endpoints.length) {
            return tryOne(i + 1);
          }
          return data;
        });
      }).catch(function () {
        return tryOne(i + 1);
      });
    }
    function run() { return tryOne(0); }
    if (window.IZCAuth && typeof window.IZCAuth.ensureLocalApi === 'function') {
      return window.IZCAuth.ensureLocalApi().then(run, run);
    }
    return run();
  }

  function setActiveTab(tab) {
    activeTab = tab || 'clientes';
    var clientesPanel = document.getElementById('asesorPanelClientes');
    var nuevasPanel = document.getElementById('asesorPanelNuevas');
    var quotesPanel = document.getElementById('asesorPanelQuotes');
    document.querySelectorAll('.admin-stat.is-tab').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-tab') === activeTab);
    });
    if (clientesPanel) clientesPanel.hidden = activeTab !== 'clientes';
    if (nuevasPanel) nuevasPanel.hidden = activeTab !== 'nuevas';
    if (quotesPanel) quotesPanel.hidden = activeTab !== 'quotes';
    if (activeTab === 'clientes') loadClientes();
    else if (activeTab === 'nuevas') loadNuevas();
    else loadQuotes();
  }

  function normalizeNitQuery(value) {
    return String(value == null ? '' : value).replace(/[\s.]/g, '').toLowerCase();
  }

  function filterClientesByNit(clientes, query) {
    var q = normalizeNitQuery(query);
    if (!q) return clientes || [];
    var qDigits = q.replace(/\D/g, '');
    return (clientes || []).filter(function (c) {
      var nit = normalizeNitQuery(c && c.nit);
      if (!nit) return false;
      if (nit.indexOf(q) !== -1) return true;
      if (qDigits && nit.replace(/\D/g, '').indexOf(qDigits) !== -1) return true;
      return false;
    });
  }

  function paintClientesRows(clientes, emptyMsg) {
    var body = document.getElementById('asesorClientesBody');
    if (!body) return;
    if (!clientes.length) {
      body.innerHTML = '<tr><td colspan="5" class="admin-empty">' + emptyMsg + '</td></tr>';
      return;
    }
    body.innerHTML = clientes.map(function (c, idx) {
      var nit = String(c.nit || '').replace(/[\s.]/g, '').trim();
      var nombre = String(c.nombre || '').trim();
      return (
        '<tr>' +
          '<td class="admin-row-num">' + (idx + 1) + '</td>' +
          '<td>' + escapeHtml(c.nit || '') + '</td>' +
          '<td>' + escapeHtml(c.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(c.telefono || c.telefonos || '—') + '</td>' +
          '<td class="admin-actions">' +
            '<button type="button" class="admin-view-quote admin-cotizar-cliente" ' +
              'data-nit="' + escapeHtml(nit) + '" ' +
              'data-nombre="' + escapeHtml(nombre) + '">Cotizar</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderClientes(clientes) {
    var count = document.getElementById('asesorClientCount');
    var search = document.getElementById('asesorClientNitSearch');
    clientesCache = clientes || [];
    if (count) count.textContent = String(clientesCache.length);
    var query = search ? search.value : '';
    var filtered = filterClientesByNit(clientesCache, query);
    var emptyMsg = query
      ? 'No hay clientes con ese NIT.'
      : 'No hay clientes asignados a tu código de vendedor.';
    paintClientesRows(filtered, emptyMsg);
  }

  function onClientNitSearch() {
    var search = document.getElementById('asesorClientNitSearch');
    var query = search ? search.value : '';
    var filtered = filterClientesByNit(clientesCache, query);
    paintClientesRows(
      filtered,
      query ? 'No hay clientes con ese NIT.' : 'No hay clientes asignados a tu código de vendedor.'
    );
  }

  function quoteEstado(q) {
    var e = String((q && q.asesor_estado) || '').trim().toLowerCase();
    if (e === 'nueva' || e === 'nuevo' || e === 'new') return 'nueva';
    if (e === 'seguimiento' || e === 'follow' || e === 'followup') return 'seguimiento';
    if (e === 'vendido' || e === 'venta' || e === 'sold') return 'vendido';
    return 'cotizado';
  }

  function quoteEstadoLabel(estado) {
    if (estado === 'nueva') return 'Nueva';
    if (estado === 'seguimiento') return 'Seguimiento';
    if (estado === 'vendido') return 'Vendido';
    return 'Cotizado';
  }

  function estadoSelectHtml(estado, idx) {
    if (estado === 'nueva') return '';
    var opts = [
      { v: 'cotizado', t: 'Cotizado' },
      { v: 'seguimiento', t: 'Seguimiento' },
      { v: 'vendido', t: 'Vendido' }
    ];
    return (
      '<select class="quote-estado-select is-' + estado + '" data-idx="' + idx + '" aria-label="Estado de cotización">' +
        opts.map(function (o) {
          return '<option value="' + o.v + '"' + (o.v === estado ? ' selected' : '') + '>' + o.t + '</option>';
        }).join('') +
      '</select>'
    );
  }

  function renderQuoteRows(quotes, bodyId, emptyMsg, mode) {
    var body = document.getElementById(bodyId);
    if (!body) return;
    if (!quotes.length) {
      body.innerHTML = '<tr><td colspan="7" class="admin-empty">' + emptyMsg + '</td></tr>';
      return;
    }
    body.innerHTML = quotes.map(function (q, idx) {
      var actions =
        '<button type="button" class="admin-view-quote" data-mode="' + mode + '" data-idx="' + idx + '">Ver</button>';
      if (mode === 'nuevas') {
        actions +=
          ' <button type="button" class="admin-view-quote admin-cotizar-btn" data-idx="' + idx + '">Cotizar</button>';
      }
      var numCell;
      if (mode === 'historial') {
        var estado = quoteEstado(q);
        if (estado === 'nueva') estado = 'cotizado';
        numCell =
          '<td class="admin-row-num has-estado">' +
            estadoSelectHtml(estado, idx) +
            '<span class="admin-row-num-value">' + (idx + 1) + '</span>' +
          '</td>';
      } else {
        numCell = '<td class="admin-row-num">' + (idx + 1) + '</td>';
      }
      return (
        '<tr>' +
          numCell +
          '<td>' + escapeHtml(formatDate(q.created_at)) + '</td>' +
          '<td>' + escapeHtml(q.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(q.nit || '') + '</td>' +
          '<td>' + quoteItems(q).length + '</td>' +
          '<td>' + escapeHtml(quoteTotalLabel(q)) + '</td>' +
          '<td class="admin-actions">' + actions + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderNuevas(quotes) {
    nuevasCache = quotes || [];
    var count = document.getElementById('asesorNuevasCount');
    if (count) count.textContent = String(nuevasCache.length);
    renderQuoteRows(
      nuevasCache,
      'asesorNuevasBody',
      'No hay cotizaciones nuevas pendientes.',
      'nuevas'
    );
  }

  function renderQuotes(quotes) {
    quotesCache = quotes || [];
    var count = document.getElementById('asesorQuoteCount');
    if (count) count.textContent = String(quotesCache.length);
    renderQuoteRows(
      quotesCache,
      'asesorQuotesBody',
      'Aún no hay cotizaciones en el historial.',
      'historial'
    );
  }

  function openQuoteDetail(idx, mode) {
    var list = mode === 'nuevas' ? nuevasCache : quotesCache;
    var quote = list[idx];
    var modal = document.getElementById('asesorQuoteModal');
    var meta = document.getElementById('asesorQuoteMeta');
    var body = document.getElementById('asesorQuoteBody');
    if (!quote || !modal || !body) return;
    if (meta) {
      meta.textContent =
        (quote.nombre || '—') + ' · NIT ' + (quote.nit || '') +
        ' · ' + formatDate(quote.created_at);
    }
    var rows = quoteItems(quote).map(function (line) {
      return (
        '<tr>' +
          '<td>' + escapeHtml(line.sku || '') + '</td>' +
          '<td>' + escapeHtml(line.name || '—') + '</td>' +
          '<td>' + (line.qty || 0) + '</td>' +
          '<td>' + escapeHtml(lineTotal(line)) + '</td>' +
        '</tr>'
      );
    }).join('');
    body.innerHTML =
      '<table class="admin-quote-detail-table">' +
        '<thead><tr><th>SKU</th><th>Producto</th><th>Cant.</th><th>Total</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="4">Sin productos</td></tr>') + '</tbody>' +
      '</table>' +
      '<p class="admin-quote-total"><strong>' + escapeHtml(quoteTotalTitle(quote)) + ':</strong> ' +
        escapeHtml(quoteTotalLabel(quote)) + '</p>';
    modal.hidden = false;
  }

  function loadClientes(options) {
    options = options || {};
    var codigo = sessionCodigo();
    if (!options.silent) setMessage('Cargando clientes…', '');
    return postApi({
      action: 'list_clientes_asesor',
      asesor_codigo: codigo,
      nit: codigo
    }).then(function (data) {
      if (!data.ok) {
        if (!options.silent) setMessage(data.error || 'No se pudieron cargar clientes.', 'error');
        renderClientes([]);
        return;
      }
      renderClientes(asFlatArray(data.clientes));
      if (!options.silent) setMessage('', '');
    }).catch(function () {
      if (!options.silent) setMessage('No se pudo cargar. Ejecuta tools\\ABRIR.bat.', 'error');
      renderClientes([]);
    });
  }

  function loadQuotes(options) {
    options = options || {};
    var codigo = sessionCodigo();
    if (!options.silent) setMessage('Cargando historial…', '');
    return postApi({
      action: 'list_quotes_asesor',
      asesor_codigo: codigo,
      nit: codigo,
      filtro: 'historial'
    }).then(function (data) {
      if (!data.ok) {
        if (!options.silent) setMessage(data.error || 'No se pudo cargar el historial.', 'error');
        renderQuotes([]);
        return;
      }
      updateQuoteCounts(data);
      renderQuotes(asFlatArray(data.quotes));
      if (!options.silent) setMessage('', '');
    }).catch(function () {
      if (!options.silent) setMessage('No se pudo cargar. Ejecuta tools\\ABRIR.bat.', 'error');
      renderQuotes([]);
    });
  }

  function loadNuevas(options) {
    options = options || {};
    var codigo = sessionCodigo();
    if (!options.silent) setMessage('Cargando nuevas cotizaciones…', '');
    return postApi({
      action: 'list_quotes_asesor',
      asesor_codigo: codigo,
      nit: codigo,
      filtro: 'nuevas'
    }).then(function (data) {
      if (!data.ok) {
        if (!options.silent) setMessage(data.error || 'No se pudieron cargar las nuevas cotizaciones.', 'error');
        renderNuevas([]);
        return;
      }
      updateQuoteCounts(data);
      renderNuevas(asFlatArray(data.quotes));
      if (!options.silent) setMessage('', '');
    }).catch(function () {
      if (!options.silent) setMessage('No se pudo cargar. Ejecuta tools\\ABRIR.bat.', 'error');
      renderNuevas([]);
    });
  }

  function openCotizadorAsesor(idx) {
    var quote = nuevasCache[idx];
    if (!quote || !quote.id) {
      setMessage('No se encontró la cotización para cotizar.', 'error');
      return;
    }
    openCotizadorCliente({
      quote_id: quote.id,
      nit: quote.nit,
      nombre: quote.nombre
    });
  }

  function openCotizadorCliente(opts) {
    opts = opts || {};
    var nit = String(opts.nit || '').replace(/[\s.]/g, '').trim();
    var nombre = String(opts.nombre || '').trim();
    var quoteId = String(opts.quote_id || opts.id || '').trim();
    if (!nit) {
      setMessage('Falta el NIT del cliente para cotizar.', 'error');
      return;
    }
    try {
      if (window.sessionStorage) {
        sessionStorage.setItem('izc_asesor_cotizar', JSON.stringify({
          quote_id: quoteId,
          nit: nit,
          nombre: nombre
        }));
      }
    } catch (e) { /* ignore */ }
    var qs =
      'nit=' + encodeURIComponent(nit) +
      '&nombre=' + encodeURIComponent(nombre);
    if (quoteId) qs += '&quote_id=' + encodeURIComponent(quoteId);
    window.location.href = 'cotizador-asesor.html?' + qs;
  }

  function setQuoteEstado(idx, estado) {
    var quote = quotesCache[idx];
    var codigo = sessionCodigo();
    if (!quote || !quote.id || !codigo) return;
    setMessage('Actualizando estado…', '');
    postApi({
      action: 'set_quote_estado',
      asesor_codigo: codigo,
      quote_id: quote.id,
      estado: estado
    }).then(function (data) {
      if (!data || !data.ok) {
        var err = (data && data.error) || 'No se pudo actualizar el estado.';
        if (/acci[oó]n no v[aá]lida/i.test(err)) {
          err = 'El servidor está desactualizado. Cierra y vuelve a abrir tools\\ABRIR.bat, luego recarga.';
        }
        setMessage(err, 'error');
        loadQuotes({ silent: true });
        return;
      }
      updateQuoteCounts(data);
      if (quotesCache[idx]) quotesCache[idx].asesor_estado = data.asesor_estado || estado;
      renderQuotes(quotesCache);
      setMessage(data.message || 'Estado actualizado.', 'ok');
    }).catch(function () {
      setMessage('No se pudo actualizar. Ejecuta tools\\ABRIR.bat.', 'error');
      loadQuotes({ silent: true });
    });
  }

  function fillProfile() {
    var codigo = sessionCodigo();
    var nombre = (window.IZCAuth && IZCAuth.getSessionNombre && IZCAuth.getSessionNombre()) || '';
    var greet = document.getElementById('asesorGreeting');

    if (!codigo) {
      setMessage('Debes iniciar sesión como asesor.', 'error');
      window.setTimeout(function () {
        window.location.href = 'login.html';
      }, 600);
      return false;
    }
    if (IZCAuth.isAdmin && IZCAuth.isAdmin()) {
      window.location.replace('admin.html');
      return false;
    }
    if (!(IZCAuth.isAsesor && IZCAuth.isAsesor())) {
      window.location.replace('perfil.html');
      return false;
    }
    if (greet) greet.textContent = 'Hola ' + (nombre || codigo);
    return true;
  }

  function bindUi() {
    var logout = document.getElementById('asesorLogout');
    if (logout) {
      logout.addEventListener('click', function () {
        if (window.IZCAuth && IZCAuth.logout) IZCAuth.logout();
      });
    }
    document.querySelectorAll('.admin-stat.is-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setActiveTab(btn.getAttribute('data-tab') || 'clientes');
      });
    });
    var nitSearch = document.getElementById('asesorClientNitSearch');
    if (nitSearch) {
      nitSearch.addEventListener('input', onClientNitSearch);
      nitSearch.addEventListener('search', onClientNitSearch);
    }
    var bodyClientes = document.getElementById('asesorClientesBody');
    if (bodyClientes) {
      bodyClientes.addEventListener('click', function (e) {
        var btn = e.target.closest('.admin-cotizar-cliente');
        if (!btn) return;
        openCotizadorCliente({
          nit: btn.getAttribute('data-nit'),
          nombre: btn.getAttribute('data-nombre')
        });
      });
    }
    var bodyQuotes = document.getElementById('asesorQuotesBody');
    if (bodyQuotes) {
      bodyQuotes.addEventListener('click', function (e) {
        var btn = e.target.closest('.admin-view-quote');
        if (!btn) return;
        openQuoteDetail(Number(btn.getAttribute('data-idx')), 'historial');
      });
      bodyQuotes.addEventListener('change', function (e) {
        var sel = e.target.closest('.quote-estado-select');
        if (!sel) return;
        setQuoteEstado(Number(sel.getAttribute('data-idx')), sel.value);
      });
    }
    var bodyNuevas = document.getElementById('asesorNuevasBody');
    if (bodyNuevas) {
      bodyNuevas.addEventListener('click', function (e) {
        var cotizar = e.target.closest('.admin-cotizar-btn');
        if (cotizar) {
          openCotizadorAsesor(Number(cotizar.getAttribute('data-idx')));
          return;
        }
        var btn = e.target.closest('.admin-view-quote');
        if (!btn) return;
        openQuoteDetail(Number(btn.getAttribute('data-idx')), 'nuevas');
      });
    }
    var modal = document.getElementById('asesorQuoteModal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target.closest('[data-modal-close]')) modal.hidden = true;
      });
    }
  }

  function init() {
    bindUi();
    if (!fillProfile()) return;
    var tab = 'clientes';
    try {
      tab = String(new URLSearchParams(window.location.search).get('tab') || 'clientes').trim() || 'clientes';
    } catch (e) { /* ignore */ }
    if (tab !== 'clientes' && tab !== 'nuevas' && tab !== 'quotes' && tab !== 'historial') tab = 'clientes';
    if (tab === 'historial') tab = 'quotes';
    setActiveTab(tab);
    loadNuevas({ silent: true });
    loadQuotes({ silent: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
