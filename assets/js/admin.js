/* Logica del panel admin: cotizaciones, usuarios, Bitrix, TRM. */
(function () {
  'use strict';

  var API_ORIGIN = 'http://127.0.0.1:8080';
  var activeTab = 'users';
  var quotesCache = [];

  function setMessage(elId, text, type) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'auth-message' + (type ? ' is-' + type : '');
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

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function postAdminApi(payload) {
    var body = JSON.stringify(payload);
    var endpoints = [API_ORIGIN + '/api/auth', 'api/auth.php', 'api/auth'];

    function tryOne(i) {
      if (i >= endpoints.length) {
        return Promise.reject(new Error('sin api'));
      }
      return fetch(endpoints[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        cache: 'no-store'
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!data || typeof data !== 'object') throw new Error('Respuesta inválida');
          return data;
        });
      }).catch(function () {
        return tryOne(i + 1);
      });
    }

    function run() {
      return tryOne(0);
    }

    if (window.IZCAuth && typeof window.IZCAuth.ensureLocalApi === 'function') {
      return window.IZCAuth.ensureLocalApi().then(run, run);
    }
    return run();
  }

  function clearAsesorForm() {
    var codigoEl = document.getElementById('adminAsesorCodigo');
    var passEl = document.getElementById('adminAsesorPassword');
    var nombreEl = document.getElementById('adminAsesorNombre');
    if (codigoEl) codigoEl.value = '';
    if (passEl) passEl.value = '';
    if (nombreEl) nombreEl.value = '';
  }

  function setActiveTab(tab) {
    activeTab = tab;
    var usersPanel = document.getElementById('adminPanelUsers');
    var asesoresPanel = document.getElementById('adminPanelAsesores');
    var quotesPanel = document.getElementById('adminPanelQuotes');
    var trmPanel = document.getElementById('adminPanelTrm');
    var bitrixPanel = document.getElementById('adminPanelBitrix');
    var tabs = document.querySelectorAll('.admin-stat.is-tab');

    tabs.forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-tab') === tab);
    });
    if (usersPanel) usersPanel.hidden = tab !== 'users';
    if (asesoresPanel) asesoresPanel.hidden = tab !== 'asesores';
    if (quotesPanel) quotesPanel.hidden = tab !== 'quotes';
    if (trmPanel) trmPanel.hidden = tab !== 'trm';
    if (bitrixPanel) bitrixPanel.hidden = tab !== 'bitrix';

    if (tab === 'users') loadUsers();
    else if (tab === 'asesores') {
      clearAsesorForm();
      window.setTimeout(clearAsesorForm, 50);
      window.setTimeout(clearAsesorForm, 400);
      loadAsesores();
    }
    else if (tab === 'quotes') loadQuotes();
    else if (tab === 'trm') loadTrmPanel();
    else if (tab === 'bitrix') loadBitrixPanel();
  }

  function quoteItems(q) {
    var items = q && q.items;
    if (!items) return [];
    // PowerShell ConvertTo-Json a veces manda 1 ítem como objeto, no como array
    return Array.isArray(items) ? items : [items];
  }

  function quoteEstado(q) {
    var e = String((q && q.asesor_estado) || '').trim().toLowerCase();
    if (e === 'nueva' || e === 'nuevo' || e === 'new') return 'nueva';
    if (e === 'seguimiento' || e === 'follow' || e === 'followup') return 'seguimiento';
    if (e === 'vendido' || e === 'venta' || e === 'sold') return 'vendido';
    if (e === 'cotizado' || e === 'cotizada') return 'cotizado';
    return 'cotizado';
  }

  function quoteEstadoLabel(estado) {
    if (estado === 'nueva') return 'Nueva';
    if (estado === 'seguimiento') return 'Seguimiento';
    if (estado === 'vendido') return 'Vendido';
    return 'Cotizado';
  }

  function estadoBadgeHtml(estado) {
    return (
      '<span class="quote-estado-badge is-' + estado + '">' +
        escapeHtml(quoteEstadoLabel(estado)) +
      '</span>'
    );
  }

  function renderQuotes(quotes) {
    var body = document.getElementById('adminQuotesBody');
    var count = document.getElementById('adminQuoteCount');
    quotesCache = quotes || [];
    if (count) count.textContent = String(quotesCache.length);
    if (!body) return;

    if (!quotesCache.length) {
      body.innerHTML = '<tr><td colspan="7" class="admin-empty">Aún no hay cotizaciones terminadas.</td></tr>';
      return;
    }

    body.innerHTML = quotesCache.map(function (q, idx) {
      var items = quoteItems(q);
      var itemCount = items.length;
      var totalLabel = quoteTotalLabel(q);
      var estado = quoteEstado(q);
      var numCell =
        '<td class="admin-row-num has-estado">' +
          estadoBadgeHtml(estado) +
          '<span class="admin-row-num-value">' + (idx + 1) + '</span>' +
        '</td>';
      return (
        '<tr>' +
          numCell +
          '<td>' + escapeHtml(formatDate(q.created_at)) + '</td>' +
          '<td>' + escapeHtml(q.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(q.nit || '') + '</td>' +
          '<td>' + itemCount + '</td>' +
          '<td>' + escapeHtml(totalLabel) + '</td>' +
          '<td class="admin-actions">' +
            '<button type="button" class="admin-view-quote" data-idx="' + idx + '">Ver</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function fetchQuotes() {
    if (!window.IZCAuth || !IZCAuth.getSessionNit) {
      return Promise.resolve({ ok: false, quotes: [] });
    }
    return postAdminApi({
      action: 'list_quotes',
      admin_nit: IZCAuth.getSessionNit()
    });
  }

  function loadQuotes(options) {
    var silent = !!(options && options.silent);
    if (!silent) setMessage('adminMessage', 'Cargando cotizaciones…', '');

    return fetchQuotes().then(function (data) {
      if (!data.ok) {
        if (!silent) {
          setMessage('adminMessage', data.error || 'No se pudo cargar el historial.', 'error');
        }
        renderQuotes([]);
        return;
      }
      renderQuotes(data.quotes || []);
      if (!silent) setMessage('adminMessage', '', '');
    }).catch(function () {
      if (!silent) {
        setMessage('adminMessage', 'No se pudo cargar. Ejecuta tools\\ABRIR.bat.', 'error');
      }
      renderQuotes([]);
    });
  }

  function fetchTrm() {
    return postAdminApi({ action: 'get_trm' });
  }

  function updateTrmBadge(value) {
    var el = document.getElementById('adminTrmValue');
    if (el && value != null && isFinite(Number(value))) {
      el.textContent = String(Number(value));
    }
  }

  function loadTrmPanel() {
    return fetchTrm().then(function (data) {
      if (!data || !data.ok) return;
      var input = document.getElementById('adminTrmInput');
      var meta = document.getElementById('adminTrmMeta');
      if (input) input.value = data.value;
      updateTrmBadge(data.value);
      if (meta) {
        meta.textContent = data.updated_at
          ? 'Última actualización: ' + formatDate(data.updated_at) +
            (data.updated_by_nombre ? ' · ' + data.updated_by_nombre : '')
          : 'Aún no se ha actualizado la TRM del día.';
      }
    }).catch(function () { /* ignore */ });
  }

  function saveTrmAdmin() {
    var input = document.getElementById('adminTrmInput');
    var value = input ? Number(input.value) : 0;
    if (!isFinite(value) || value <= 0) {
      setMessage('adminMessage', 'Ingresa una TRM válida mayor que cero.', 'error');
      return;
    }
    setMessage('adminMessage', 'Guardando TRM…', '');
    postAdminApi({
      action: 'set_trm',
      admin_nit: IZCAuth.getSessionNit(),
      admin_nombre: IZCAuth.getSessionNombre ? IZCAuth.getSessionNombre() : '',
      value: value
    }).then(function (data) {
      if (!data || !data.ok) {
        var err = (data && data.error) || 'No se pudo guardar la TRM.';
        if (/acción no válida/i.test(err)) {
          err += ' Cierra y vuelve a abrir con tools\\ABRIR.bat (reinicia el servidor solo).';
        }
        setMessage('adminMessage', err, 'error');
        return;
      }
      updateTrmBadge(data.value);
      loadTrmPanel();
      setMessage('adminMessage', data.message || 'TRM actualizada.', 'ok');
    }).catch(function () {
      setMessage('adminMessage', 'No se pudo guardar. Abre tools\\ABRIR.bat para reiniciar el servidor.', 'error');
    });
  }

  function updateBitrixBadge(configured, enabled) {
    var el = document.getElementById('adminBitrixStatus');
    if (!el) return;
    if (enabled && configured) el.textContent = 'On';
    else if (configured) el.textContent = 'Off';
    else el.textContent = '—';
  }

  function loadBitrixPanel() {
    if (!window.IZCAuth || !IZCAuth.getSessionNit) return Promise.resolve();
    return postAdminApi({
      action: 'get_bitrix',
      admin_nit: IZCAuth.getSessionNit()
    }).then(function (data) {
      if (!data || !data.ok) return;
      var enabled = document.getElementById('adminBitrixEnabled');
      var webhook = document.getElementById('adminBitrixWebhook');
      var stage = document.getElementById('adminBitrixStage');
      var category = document.getElementById('adminBitrixCategory');
      var meta = document.getElementById('adminBitrixMeta');
      if (enabled) enabled.checked = !!data.enabled;
      if (webhook) webhook.value = data.webhook_base || '';
      if (stage) stage.value = data.stage_id || '';
      if (category) category.value = data.category_id || '';
      updateBitrixBadge(!!data.configured, !!data.enabled);
      if (meta) {
        meta.textContent = data.updated_at
          ? 'Última actualización: ' + formatDate(data.updated_at)
          : 'Aún no hay configuración Bitrix guardada.';
      }
    }).catch(function () {
      setMessage('adminMessage', 'No se pudo cargar Bitrix. Reinicia con tools\\ABRIR.bat.', 'error');
    });
  }

  function bitrixFormPayload() {
    return {
      admin_nit: IZCAuth.getSessionNit(),
      enabled: !!(document.getElementById('adminBitrixEnabled') || {}).checked,
      webhook_base: (document.getElementById('adminBitrixWebhook') || {}).value || '',
      stage_id: (document.getElementById('adminBitrixStage') || {}).value || '',
      category_id: (document.getElementById('adminBitrixCategory') || {}).value || '',
      currency_id: 'COP'
    };
  }

  function saveBitrixAdmin() {
    setMessage('adminMessage', 'Guardando Bitrix…', '');
    postAdminApi(Object.assign({ action: 'set_bitrix' }, bitrixFormPayload())).then(function (data) {
      if (!data || !data.ok) {
        setMessage('adminMessage', (data && data.error) || 'No se pudo guardar Bitrix.', 'error');
        return;
      }
      setMessage('adminMessage', data.message || 'Bitrix guardado.', 'ok');
      loadBitrixPanel();
    }).catch(function () {
      setMessage('adminMessage', 'Error al guardar Bitrix. Reinicia el servidor.', 'error');
    });
  }

  function testBitrixAdmin() {
    var stagesEl = document.getElementById('adminBitrixStages');
    if (stagesEl) {
      stagesEl.hidden = true;
      stagesEl.textContent = '';
    }
    setMessage('adminMessage', 'Probando Bitrix…', '');
    postAdminApi(Object.assign({ action: 'test_bitrix' }, bitrixFormPayload())).then(function (data) {
      if (!data || !data.ok) {
        setMessage('adminMessage', (data && data.error) || 'Prueba Bitrix fallida.', 'error');
        return;
      }
      setMessage('adminMessage', data.message || 'Bitrix OK.', 'ok');
      if (stagesEl && data.stages && data.stages.length) {
        var lines = data.stages.map(function (s) {
          return (s.STATUS_ID || s.status_id || '') + '  →  ' + (s.NAME || s.name || '');
        });
        stagesEl.textContent = 'Etapas del embudo (copia el STATUS_ID de COTIZACION):\n' + lines.join('\n');
        stagesEl.hidden = false;
      }
    }).catch(function () {
      setMessage('adminMessage', 'No se pudo probar Bitrix. Revisa el webhook y reinicia el servidor.', 'error');
    });
  }

  function openQuoteDetail(idx) {
    var quote = quotesCache[idx];
    var modal = document.getElementById('quoteDetailModal');
    var meta = document.getElementById('quoteDetailMeta');
    var body = document.getElementById('quoteDetailBody');
    if (!quote || !modal || !body) return;

    if (meta) {
      var seller =
        quote.seller_label ||
        quote.seller_name ||
        quote.seller_codigo ||
        '';
      meta.textContent =
        (quote.nombre || '—') + ' · NIT ' + (quote.nit || '') +
        ' · ' + formatDate(quote.created_at) +
        ' · Vendedor: ' + (seller || 'Sin vendedor asignado') +
        ' · Estado: ' + quoteEstadoLabel(quoteEstado(quote));
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

  function bindTabs() {
    document.querySelectorAll('.admin-stat.is-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-tab') || 'users';
        setActiveTab(tab);
      });
    });

    var quotesBody = document.getElementById('adminQuotesBody');
    if (quotesBody) {
      quotesBody.addEventListener('click', function (e) {
        var btn = e.target.closest('.admin-view-quote');
        if (!btn) return;
        openQuoteDetail(Number(btn.getAttribute('data-idx')));
      });
    }

    var quoteModal = document.getElementById('quoteDetailModal');
    if (quoteModal) {
      quoteModal.addEventListener('click', function (e) {
        if (e.target.closest('[data-modal-close]')) quoteModal.hidden = true;
      });
    }

    var trmSave = document.getElementById('adminTrmSave');
    if (trmSave) trmSave.addEventListener('click', saveTrmAdmin);

    var bitrixSave = document.getElementById('adminBitrixSave');
    if (bitrixSave) bitrixSave.addEventListener('click', saveBitrixAdmin);
    var bitrixTest = document.getElementById('adminBitrixTest');
    if (bitrixTest) bitrixTest.addEventListener('click', testBitrixAdmin);

    var asesorForm = document.getElementById('adminAsesorForm');
    if (asesorForm) {
      asesorForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveAsesorAdmin();
      });
    }
    var asesoresBody = document.getElementById('adminAsesoresBody');
    if (asesoresBody) {
      asesoresBody.addEventListener('click', function (e) {
        var btn = e.target.closest('.admin-delete-asesor');
        if (!btn) return;
        var codigo = btn.getAttribute('data-codigo') || '';
        if (!codigo) return;
        if (!window.confirm('¿Eliminar asesor ' + codigo + '?')) return;
        deleteAsesorAdmin(codigo);
      });
    }
  }

  function renderAsesores(asesores) {
    var body = document.getElementById('adminAsesoresBody');
    var count = document.getElementById('adminAsesorCount');
    if (count) count.textContent = String((asesores && asesores.length) || 0);
    if (!body) return;
    if (!asesores || !asesores.length) {
      body.innerHTML = '<tr><td colspan="5" class="admin-empty">Aún no hay asesores registrados.</td></tr>';
      return;
    }
    body.innerHTML = asesores.map(function (a, idx) {
      var codigo = a.codigo || '';
      return (
        '<tr>' +
          '<td class="admin-row-num">' + (idx + 1) + '</td>' +
          '<td>' + escapeHtml(codigo) + '</td>' +
          '<td>' + escapeHtml(a.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(formatDate(a.created_at)) + '</td>' +
          '<td class="admin-actions">' +
            '<button type="button" class="admin-delete admin-delete-asesor" data-codigo="' + escapeHtml(codigo) + '">Eliminar</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function loadAsesores(options) {
    options = options || {};
    if (!window.IZCAuth || !IZCAuth.getSessionNit) return Promise.resolve();
    if (!options.silent && !options.keepMessage) {
      setMessage('adminMessage', 'Cargando asesores…', '');
    }
    return postAdminApi({
      action: 'list_asesores',
      admin_nit: IZCAuth.getSessionNit()
    }).then(function (data) {
      if (!data.ok) {
        if (!options.silent) {
          setMessage('adminMessage', data.error || 'No se pudo cargar asesores.', 'error');
        }
        renderAsesores([]);
        return;
      }
      renderAsesores(data.asesores || []);
      if (!options.silent && !options.keepMessage) {
        setMessage('adminMessage', '', '');
      }
    }).catch(function () {
      if (!options.silent) {
        setMessage('adminMessage', 'No se pudo cargar asesores. Ejecuta tools\\ABRIR.bat.', 'error');
      }
      renderAsesores([]);
    });
  }

  function saveAsesorAdmin() {
    var codigoEl = document.getElementById('adminAsesorCodigo');
    var passEl = document.getElementById('adminAsesorPassword');
    var nombreEl = document.getElementById('adminAsesorNombre');
    var codigo = codigoEl ? codigoEl.value.trim() : '';
    var password = passEl ? passEl.value : '';
    var nombre = nombreEl ? nombreEl.value.trim() : '';
    if (!codigo || !password) {
      setMessage('adminMessage', 'Ingresa código de vendedor y contraseña.', 'error');
      return;
    }
    setMessage('adminMessage', 'Registrando asesor…', '');
    postAdminApi({
      action: 'register_asesor',
      admin_nit: IZCAuth.getSessionNit(),
      codigo: codigo,
      password: password,
      nombre: nombre
    }).then(function (data) {
      if (!data.ok) {
        setMessage('adminMessage', data.error || 'No se pudo registrar.', 'error');
        return;
      }
      if (codigoEl) codigoEl.value = '';
      if (passEl) passEl.value = '';
      if (nombreEl) nombreEl.value = '';
      setMessage('adminMessage', data.message || ('Asesor ' + (data.codigo || codigo) + ' registrado.'), 'ok');
      return loadAsesores({ keepMessage: true });
    }).catch(function () {
      setMessage('adminMessage', 'Error al registrar asesor. Reinicia tools\\ABRIR.bat.', 'error');
    });
  }

  function deleteAsesorAdmin(codigo) {
    postAdminApi({
      action: 'delete_asesor',
      admin_nit: IZCAuth.getSessionNit(),
      codigo: codigo
    }).then(function (data) {
      if (!data.ok) {
        setMessage('adminMessage', data.error || 'No se pudo eliminar.', 'error');
        return;
      }
      setMessage('adminMessage', data.message || 'Asesor eliminado.', 'ok');
      loadAsesores({ keepMessage: true });
    }).catch(function () {
      setMessage('adminMessage', 'Error al eliminar asesor.', 'error');
    });
  }

  function fillProfile() {
    var nit = (window.IZCAuth && IZCAuth.getSessionNit()) || '';
    var nombre = (window.IZCAuth && IZCAuth.getSessionNombre && IZCAuth.getSessionNombre()) || '';
    var input = document.getElementById('profileNit');
    var nombreInput = document.getElementById('profileNombre');
    var greet = document.getElementById('profileGreeting');

    if (!nit) {
      setMessage('adminMessage', 'Debes iniciar sesión como administrador.', 'error');
      if (input) input.value = '';
      if (nombreInput) nombreInput.value = '';
      if (greet) greet.textContent = 'Hola';
      window.setTimeout(function () {
        if (!(window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit())) {
          window.location.href = 'login.html';
        }
      }, 800);
      return false;
    }

    if (!IZCAuth.isAdmin || !IZCAuth.isAdmin()) {
      if (IZCAuth.isAsesor && IZCAuth.isAsesor()) {
        window.location.replace('asesor.html');
      } else {
        window.location.replace('perfil.html');
      }
      return false;
    }

    if (input) input.value = nit;
    if (nombreInput) {
      nombreInput.value = nombre || '—';
      nombreInput.readOnly = true;
    }
    if (greet) greet.textContent = 'Hola ' + (nombre || 'admin');
    setMessage('adminMessage', '', '');
    return true;
  }

  function renderUsers(users) {
    var body = document.getElementById('adminUsersBody');
    var count = document.getElementById('adminUserCount');
    if (count) count.textContent = String((users && users.length) || 0);
    if (!body) return;

    if (!users || !users.length) {
      body.innerHTML = '<tr><td colspan="5" class="admin-empty">No hay usuarios registrados.</td></tr>';
      return;
    }

    body.innerHTML = users.map(function (u, idx) {
      var nit = u.nit || '';
      var btn = '<button type="button" class="admin-delete" data-nit="' + escapeHtml(nit) + '">Eliminar</button>';
      return (
        '<tr>' +
          '<td class="admin-row-num">' + (idx + 1) + '</td>' +
          '<td>' + escapeHtml(u.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(nit) + '</td>' +
          '<td>' + escapeHtml(formatDate(u.created_at)) + '</td>' +
          '<td class="admin-actions">' + btn + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function loadUsers() {
    if (!window.IZCAuth || !IZCAuth.listUsersForAdmin) return;
    setMessage('adminMessage', 'Cargando…', '');
    IZCAuth.listUsersForAdmin().then(function (data) {
      if (!data.ok) {
        setMessage('adminMessage', data.error || 'No se pudo cargar.', 'error');
        return;
      }
      var sourceEl = document.getElementById('adminSource');
      if (sourceEl) sourceEl.textContent = data.source || '—';
      // No mostrar al admin en la tabla; sí permanece en usuarios.json
      var users = (data.users || []).filter(function (u) {
        return !(IZCAuth.isAdminNit && IZCAuth.isAdminNit(u.nit));
      });
      renderUsers(users);
      setMessage('adminMessage', '', '');
    }).catch(function (err) {
      console.error(err);
      setMessage('adminMessage', 'Error al cargar usuarios.', 'error');
    });
  }

  function bindTable() {
    var body = document.getElementById('adminUsersBody');
    var modal = document.getElementById('deleteModal');
    var modalText = document.getElementById('deleteModalText');
    var confirmBtn = document.getElementById('deleteModalConfirm');
    var pendingNit = '';
    var pendingBtn = null;

    function closeModal() {
      if (modal) modal.hidden = true;
      pendingNit = '';
      pendingBtn = null;
    }

    function openModal(nit, btn) {
      pendingNit = nit;
      pendingBtn = btn;
      if (modalText) {
        modalText.textContent = '¿Quieres eliminar el cliente con NIT ' + nit + '?';
      }
      if (modal) modal.hidden = false;
      if (confirmBtn) confirmBtn.focus();
    }

    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target.closest('[data-modal-close]')) closeModal();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.hidden) closeModal();
    });

    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        var nit = pendingNit;
        var btn = pendingBtn;
        closeModal();
        if (!nit || !window.IZCAuth) return;
        if (btn) btn.disabled = true;
        IZCAuth.deleteUserForAdmin(nit).then(function (data) {
          if (!data.ok) {
            setMessage('adminMessage', data.error || 'No se pudo eliminar.', 'error');
            if (btn) btn.disabled = false;
            return;
          }
          setMessage('adminMessage', data.message || 'Usuario eliminado.', 'ok');
          loadUsers();
        }).catch(function (err) {
          console.error(err);
          setMessage('adminMessage', 'Error al eliminar.', 'error');
          if (btn) btn.disabled = false;
        });
      });
    }

    if (!body) return;
    body.addEventListener('click', function (e) {
      var btn = e.target.closest('.admin-delete');
      if (!btn || !window.IZCAuth) return;
      var nit = btn.getAttribute('data-nit') || '';
      if (!nit) return;
      openModal(nit, btn);
    });
  }

  function bindLogout() {
    var btn = document.getElementById('profileLogout');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (window.IZCAuth && IZCAuth.logout) IZCAuth.logout();
      else window.location.href = 'marcas.html';
    });
  }

  function init() {
    bindLogout();
    bindTable();
    bindTabs();
    var refresh = document.getElementById('adminRefresh');
    if (refresh) refresh.addEventListener('click', function () {
      if (activeTab === 'quotes') loadQuotes();
      else if (activeTab === 'asesores') loadAsesores();
      else {
        loadUsers();
        loadAsesores({ silent: true });
        loadQuotes({ silent: true });
      }
    });
    document.addEventListener('izc:auth-changed', function () {
      if (fillProfile()) {
        setActiveTab(activeTab);
        loadAsesores({ silent: true });
        loadQuotes({ silent: true });
        loadTrmPanel();
      }
    });

    var ready = (window.IZCAuth && IZCAuth.whenSessionReady)
      ? IZCAuth.whenSessionReady()
      : Promise.resolve();

    ready.then(function () {
      if (!fillProfile()) return;
      clearAsesorForm();
      window.setTimeout(clearAsesorForm, 100);
      window.setTimeout(clearAsesorForm, 500);
      setActiveTab('users');
      loadAsesores({ silent: true });
      loadQuotes({ silent: true });
      loadTrmPanel();
      loadBitrixPanel();
    }).catch(function () {
      if (!fillProfile()) return;
      setActiveTab('users');
      loadAsesores({ silent: true });
      loadTrmPanel();
      loadBitrixPanel();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
