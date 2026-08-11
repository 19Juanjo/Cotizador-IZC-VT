/* Lógica de la página Mi perfil (clientes) + historial de cotizaciones */
(function () {
  'use strict';

  var API_ORIGIN = 'http://127.0.0.1:8080';
  var redirectTimer = null;
  var quotesCache = [];

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatUSD(value) {
    return '$ ' + Number(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatCOP(value) {
    return '$ ' + Math.round(Number(value)).toLocaleString('es-CO') + ' COP';
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function quoteItems(q) {
    var items = q && q.items;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  }

  function lineTotalIva(line) {
    if (!line) return '—';
    if (String(line.currency || '').toUpperCase() === 'COP') {
      return formatCOP(line.totalCopIva != null ? line.totalCopIva : line.copIva);
    }
    if (line.totalUsdIva != null || line.usdIva != null) {
      return formatUSD(line.totalUsdIva != null ? line.totalUsdIva : line.usdIva);
    }
    return formatCOP(line.totalCopIva != null ? line.totalCopIva : line.copIva);
  }

  function quoteTotalIvaLabel(totals) {
    totals = totals || {};
    var parts = [];
    if (totals.hasUsd) parts.push(formatUSD(totals.usdIva));
    if (totals.hasCop) parts.push(formatCOP(totals.copIva));
    if (parts.length) return parts.join(' · ');
    if (totals.usdIva != null && Number(totals.usdIva) > 0 && !(totals.copIva != null && Number(totals.copIva) > 0)) {
      return formatUSD(totals.usdIva);
    }
    if (totals.copIva != null) return formatCOP(totals.copIva);
    if (totals.usdIva != null) return formatUSD(totals.usdIva);
    return '—';
  }

  function setQuotesMessage(text, type) {
    var el = document.getElementById('profileQuotesMessage');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'auth-message' + (type ? ' is-' + type : '');
  }

  function postApi(payload) {
    var body = JSON.stringify(payload);
    var endpoints = [
      API_ORIGIN + '/api/auth',
      'http://localhost:8080/api/auth',
      'api/auth',
      'api/auth.php'
    ];

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

  function renderQuotes(quotes) {
    var body = document.getElementById('profileQuotesBody');
    var section = document.getElementById('profileQuotesSection');
    quotesCache = quotes || [];
    if (section) section.hidden = false;
    if (!body) return;

    if (!quotesCache.length) {
      body.innerHTML = '<tr><td colspan="5" class="profile-quotes-empty">Aún no tienes cotizaciones terminadas.</td></tr>';
      return;
    }

    body.innerHTML = quotesCache.map(function (q, idx) {
      var items = quoteItems(q);
      return (
        '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td>' + escapeHtml(formatDate(q.created_at)) + '</td>' +
          '<td>' + items.length + '</td>' +
          '<td>' + escapeHtml(quoteTotalIvaLabel(q.totals || {})) + '</td>' +
          '<td><button type="button" class="profile-view-quote" data-idx="' + idx + '">Ver</button></td>' +
        '</tr>'
      );
    }).join('');
  }

  function openQuoteDetail(idx) {
    var quote = quotesCache[idx];
    var modal = document.getElementById('profileQuoteModal');
    var meta = document.getElementById('profileQuoteMeta');
    var body = document.getElementById('profileQuoteBody');
    if (!quote || !modal || !body) return;

    if (meta) {
      meta.textContent = formatDate(quote.created_at) +
        (quote.trm != null ? ' · TRM ' + quote.trm : '');
    }

    var rows = quoteItems(quote).map(function (line) {
      return (
        '<tr>' +
          '<td>' + escapeHtml(line.sku || '') + '</td>' +
          '<td>' + escapeHtml(line.name || '—') + '</td>' +
          '<td>' + (line.qty || 0) + '</td>' +
          '<td>' + escapeHtml(lineTotalIva(line)) + '</td>' +
        '</tr>'
      );
    }).join('');

    body.innerHTML =
      '<table class="profile-quote-detail-table">' +
        '<thead><tr><th>SKU</th><th>Producto</th><th>Cant.</th><th>Total + IVA</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="4">Sin productos</td></tr>') + '</tbody>' +
      '</table>' +
      '<p class="profile-quote-total"><strong>Total + IVA:</strong> ' +
        escapeHtml(quoteTotalIvaLabel(quote.totals || {})) + '</p>';

    modal.hidden = false;
  }

  function closeQuoteModal() {
    var modal = document.getElementById('profileQuoteModal');
    if (modal) modal.hidden = true;
  }

  function loadQuotes() {
    var nit = (window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || '';
    var section = document.getElementById('profileQuotesSection');
    if (!nit) {
      if (section) section.hidden = true;
      return;
    }
    if (section) section.hidden = false;
    setQuotesMessage('Cargando historial…', '');
    postApi({ action: 'list_my_quotes', nit: nit }).then(function (data) {
      if (!data || !data.ok) {
        setQuotesMessage(
          (data && data.error) || 'No se pudo cargar el historial. Abre el sitio con tools\\ABRIR.bat.',
          'error'
        );
        renderQuotes([]);
        return;
      }
      setQuotesMessage('', '');
      renderQuotes(data.quotes || []);
    }).catch(function () {
      setQuotesMessage('No se pudo cargar el historial. Usa http://127.0.0.1:8080/perfil.html', 'error');
      renderQuotes([]);
    });
  }

  function fillProfile() {
    var nit = (window.IZCAuth && IZCAuth.getSessionNit()) || '';
    var nombre = (window.IZCAuth && IZCAuth.getSessionNombre && IZCAuth.getSessionNombre()) || '';
    var input = document.getElementById('profileNit');
    var nombreInput = document.getElementById('profileNombre');
    var msg = document.getElementById('authMessage');
    var greet = document.getElementById('profileGreeting');

    if (!nit) {
      if (msg) {
        msg.className = 'auth-message is-error';
        msg.textContent = 'Debes iniciar sesión para ver tu perfil.';
      }
      if (input) input.value = '';
      if (nombreInput) nombreInput.value = '';
      if (greet) greet.textContent = 'Hola';
      var section = document.getElementById('profileQuotesSection');
      if (section) section.hidden = true;
      if (redirectTimer) window.clearTimeout(redirectTimer);
      redirectTimer = window.setTimeout(function () {
        if (!(window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit())) {
          window.location.href = 'login.html';
        }
      }, 800);
      return;
    }

    if (redirectTimer) {
      window.clearTimeout(redirectTimer);
      redirectTimer = null;
    }

    if (window.IZCAuth && IZCAuth.isAdmin && IZCAuth.isAdmin()) {
      window.location.replace('admin.html');
      return;
    }

    if (input) input.value = nit;
    if (nombreInput) {
      nombreInput.value = nombre || '—';
      nombreInput.readOnly = true;
    }
    if (greet) greet.textContent = 'Hola ' + (nombre || 'cliente');
    if (msg) {
      msg.className = 'auth-message';
      msg.textContent = '';
    }
    loadQuotes();
  }

  function bindLogout() {
    var btn = document.getElementById('profileLogout');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (window.IZCAuth && IZCAuth.logout) IZCAuth.logout();
      else window.location.href = 'index.html';
    });
  }

  function bindQuotesUi() {
    var body = document.getElementById('profileQuotesBody');
    var modal = document.getElementById('profileQuoteModal');

    if (body) {
      body.addEventListener('click', function (e) {
        var btn = e.target.closest('.profile-view-quote');
        if (!btn) return;
        openQuoteDetail(Number(btn.getAttribute('data-idx')));
      });
    }

    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target.closest('[data-modal-close]')) closeQuoteModal();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeQuoteModal();
    });
  }

  function init() {
    bindLogout();
    bindQuotesUi();
    document.addEventListener('izc:auth-changed', fillProfile);
    var ready = (window.IZCAuth && IZCAuth.whenSessionReady)
      ? IZCAuth.whenSessionReady()
      : Promise.resolve();
    ready.then(fillProfile).catch(fillProfile);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
