/* Logica del perfil e historial de cotizaciones del cliente. */
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
          '<td>' + escapeHtml(quoteTotalLabel(q)) + '</td>' +
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
          '<td>' + escapeHtml(lineTotal(line)) + '</td>' +
        '</tr>'
      );
    }).join('');

    body.innerHTML =
      '<table class="profile-quote-detail-table">' +
        '<thead><tr><th>SKU</th><th>Producto</th><th>Cant.</th><th>Total</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="4">Sin productos</td></tr>') + '</tbody>' +
      '</table>' +
      '<p class="profile-quote-total"><strong>' + escapeHtml(quoteTotalTitle(quote)) + ':</strong> ' +
        escapeHtml(quoteTotalLabel(quote)) + '</p>';

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
    if (window.IZCAuth && IZCAuth.isAsesor && IZCAuth.isAsesor()) {
      window.location.replace('asesor.html');
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
      else window.location.href = 'marcas.html';
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
