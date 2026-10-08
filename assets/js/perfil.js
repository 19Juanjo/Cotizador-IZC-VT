/* Logica del perfil e historial de cotizaciones del cliente. */
(function () {
  'use strict';

  var API_ORIGIN = 'http://127.0.0.1:8080';
  var redirectTimer = null;
  var quotesCache = [];

  function sortByNewestCreated(list) {
    return (list || []).slice().sort(function (a, b) {
      var ta = String((a && a.created_at) || '');
      var tb = String((b && b.created_at) || '');
      if (ta !== tb) return tb.localeCompare(ta);
      return String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
    });
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatUSD(value) {
    if (window.IZCMoney) return IZCMoney.formatUsd(value);
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
    var c = String(line.currency || '').toUpperCase();
    var cop = Number(line.totalCopIva) || Number(line.copIva) ||
      Number(line.totalCop) || Number(line.cop) || 0;
    var usd = Number(line.totalUsdIva) || Number(line.usdIva) ||
      Number(line.totalUsd) || Number(line.usd) || 0;
    if (c === 'COP' || (c !== 'USD' && cop > 0 && usd <= 0)) {
      if (cop > 0) return formatCOP(cop);
    }
    if (c === 'USD' || usd > 0) {
      if (usd > 0) return formatUSD(usd);
    }
    if (cop > 0) return formatCOP(cop);
    return '—';
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

  function quoteTotalsDisplay(quote) {
    var totals = (quote && quote.totals) || {};
    var cop = Number(totals.copIva) || Number(totals.totalConFlete) || Number(totals.cop) || 0;
    var usd = Number(totals.usdIva) || Number(totals.usd) || 0;
    var itemCop = 0;
    var itemUsd = 0;
    quoteItems(quote).forEach(function (line) {
      var c = String(line.currency || '').toUpperCase();
      var lineCop = Number(line.totalCopIva) || Number(line.copIva) ||
        Number(line.totalCop) || Number(line.cop) || 0;
      var lineUsd = Number(line.totalUsdIva) || Number(line.usdIva) ||
        Number(line.totalUsd) || Number(line.usd) || 0;
      if (c === 'COP') {
        itemCop += lineCop;
      } else if (c === 'USD') {
        itemUsd += lineUsd;
      } else {
        if (lineCop > 0) itemCop += lineCop;
        if (lineUsd > 0) itemUsd += lineUsd;
      }
    });
    if (cop <= 0 && itemCop > 0) cop = itemCop;
    if (usd <= 0 && itemUsd > 0) usd = itemUsd;
    return { cop: cop, usd: usd };
  }

  function quoteNativeSums(quote) {
    var t = quoteTotalsDisplay(quote);
    var flags = quoteCurrencyFlags(quote);
    return {
      hasUsd: flags.hasUsd || t.usd > 0,
      hasCop: flags.hasCop || t.cop > 0,
      usd: t.usd,
      cop: t.cop
    };
  }

  function quoteTotalLabel(quote) {
    var t = quoteTotalsDisplay(quote);
    var parts = [];
    if (t.cop > 0) parts.push(formatCOP(t.cop));
    if (t.usd > 0) parts.push(formatUSD(t.usd));
    return parts.length ? parts.join(' · ') : '—';
  }

  function quoteTotalTitle(quote) {
    var t = quoteTotalsDisplay(quote);
    if (t.cop > 0 && t.usd > 0) return 'Total';
    if (t.cop > 0) return 'Total COP + IVA';
    if (t.usd > 0) return 'Total USD + IVA';
    var flags = quoteCurrencyFlags(quote);
    if (flags.hasUsd && flags.hasCop) return 'Total';
    if (flags.hasCop) return 'Total COP';
    if (flags.hasUsd) return 'Total USD';
    return 'Total';
  }

  function setQuotesMessage(text, type) {
    var el = document.getElementById('profileQuotesMessage');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'auth-message');
      return;
    }
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
          var err = String((data && data.error) || '').toLowerCase();
          // Servidor local viejo: reintentar siguiente endpoint / auth.php
          if (
            !data.ok &&
            i + 1 < endpoints.length &&
            (err.indexOf('accion no valida') >= 0 || err.indexOf('acción no válida') >= 0)
          ) {
            return tryOne(i + 1);
          }
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
    quotesCache = sortByNewestCreated(quotes || []);
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

  function loadQuotes(options) {
    options = options || {};
    var silent = !!options.silent;
    if (!silent) setQuotesMessage('Cargando historial…', '');
    var nit = (window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || '';
    var section = document.getElementById('profileQuotesSection');
    if (!nit) {
      if (section) section.hidden = true;
      return Promise.resolve();
    }
    if (section) section.hidden = false;
    return postApi({ action: 'list_my_quotes', nit: nit }).then(function (data) {
      if (!data || !data.ok) {
        if (!silent) {
          setQuotesMessage(
            (data && data.error) || 'No se pudo cargar el historial. Abre el sitio con tools\\ABRIR.bat.',
            'error'
          );
        }
        renderQuotes([]);
        return;
      }
      if (!silent) setQuotesMessage('', '');
      renderQuotes(data.quotes || []);
    }).catch(function () {
      if (!silent) {
        setQuotesMessage('No se pudo cargar el historial. Usa http://127.0.0.1:8080/perfil.html', 'error');
      }
      renderQuotes([]);
    });
  }

  function whatsappHrefFromPhone(phone) {
    var digits = String(phone || '').replace(/\D+/g, '');
    if (!digits) return '';
    if (digits.length === 10 && digits.charAt(0) === '3') {
      digits = '57' + digits;
    }
    return 'https://api.whatsapp.com/send?phone=' + encodeURIComponent(digits);
  }

  function renderAsesorContacto(asesor, found) {
    var box = document.getElementById('profileAsesorBox');
    var nameEl = document.getElementById('profileAsesorNombre');
    var telEl = document.getElementById('profileAsesorTelefono');
    var emailEl = document.getElementById('profileAsesorEmail');
    var waEl = document.getElementById('profileAsesorWhatsapp');
    var emptyEl = document.getElementById('profileAsesorEmpty');
    if (!box) return;

    box.hidden = false;
    asesor = asesor || {};
    var nombre = String(asesor.nombre || '').trim();
    var telefono = String(asesor.telefono || '').trim();
    var email = String(asesor.email || '').trim();
    var codigo = String(asesor.codigo || '').trim();
    var hasAny = !!(nombre || telefono || email || codigo);

    if (!found || !hasAny) {
      if (nameEl) nameEl.textContent = '';
      if (telEl) { telEl.hidden = true; telEl.textContent = ''; }
      if (emailEl) { emailEl.hidden = true; emailEl.textContent = ''; }
      if (waEl) { waEl.hidden = true; waEl.removeAttribute('href'); }
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    if (nameEl) {
      nameEl.textContent = nombre
        ? (codigo ? (nombre + ' (' + codigo + ')') : nombre)
        : (codigo || 'Asesor asignado');
    }
    if (telEl) {
      if (telefono) {
        telEl.hidden = false;
        telEl.textContent = 'Teléfono: ' + telefono;
      } else {
        telEl.hidden = true;
        telEl.textContent = '';
      }
    }
    if (emailEl) {
      if (email) {
        emailEl.hidden = false;
        emailEl.innerHTML = 'Correo: <a href="mailto:' + escapeHtml(email) + '">' + escapeHtml(email) + '</a>';
      } else {
        emailEl.hidden = true;
        emailEl.textContent = '';
      }
    }
    if (waEl) {
      var wa = whatsappHrefFromPhone(telefono);
      if (wa) {
        waEl.hidden = false;
        waEl.href = wa;
      } else {
        waEl.hidden = true;
        waEl.removeAttribute('href');
      }
    }
  }

  function loadAsesorContacto() {
    var nit = (window.IZCAuth && IZCAuth.getSessionNit()) || '';
    var box = document.getElementById('profileAsesorBox');
    if (!nit || !box) return;
    box.hidden = false;
    var nameEl = document.getElementById('profileAsesorNombre');
    if (nameEl) nameEl.textContent = 'Cargando contacto…';
    var emptyEl = document.getElementById('profileAsesorEmpty');
    if (emptyEl) emptyEl.hidden = true;

    postApi({ action: 'resolve_cliente_asesor_contacto', nit: nit }).then(function (data) {
      if (!data || !data.ok) {
        renderAsesorContacto(null, false);
        return;
      }
      renderAsesorContacto(data.asesor || null, data.found !== false);
    }).catch(function () {
      renderAsesorContacto(null, false);
    });
  }

  function fillProfile() {
    var nit = (window.IZCAuth && IZCAuth.getSessionNit()) || '';
    var nombre = (window.IZCAuth && IZCAuth.getSessionNombre && IZCAuth.getSessionNombre()) || '';
    var input = document.getElementById('profileNit');
    var msg = document.getElementById('authMessage');
    var greet = document.getElementById('profileGreeting');

    if (!nit) {
      if (msg) {
        if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
          IZCAuth.setFlashMessage(msg, 'Debes iniciar sesión para ver tu perfil.', 'error', 'auth-message');
        } else {
          msg.className = 'auth-message is-error';
          msg.textContent = 'Debes iniciar sesión para ver tu perfil.';
        }
      }
      if (input) input.value = '';
      if (greet) greet.textContent = 'Hola';
      setNombreEditUi(false);
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

    var role = '';
    try { role = String(localStorage.getItem('izc_session_role') || '').toLowerCase(); } catch (eRole) { /* ignore */ }
    var nitTok = String(nit || '').replace(/[\s._-]/g, '').toUpperCase();
    if ((window.IZCAuth && IZCAuth.isAdmin && IZCAuth.isAdmin()) || role === 'admin' || nitTok === 'ADMINIZC') {
      window.location.replace('admin.html');
      return;
    }
    if (window.IZCAuth && IZCAuth.isAsesor && IZCAuth.isAsesor()) {
      window.location.replace('asesor.html');
      return;
    }
    if (window.IZCAuth && IZCAuth.isZkteco && IZCAuth.isZkteco()) {
      window.location.replace('panel-zkteco.html');
      return;
    }

    if (input) input.value = nit;
    if (greet && !isEditingNombre()) {
      greet.textContent = 'Hola ' + (nombre || 'cliente');
    }
    if (msg) {
      msg.className = 'auth-message';
      msg.textContent = '';
    }
    loadAsesorContacto();
    loadQuotes();
  }

  function profileCard() {
    return document.querySelector('.profile-name-card');
  }

  function currentProfileNombre() {
    return ((window.IZCAuth && IZCAuth.getSessionNombre && IZCAuth.getSessionNombre()) || '').trim();
  }

  function isEditingNombre() {
    var card = profileCard();
    return !!(card && card.classList.contains('is-editing-name'));
  }

  function setNombreEditUi(editing) {
    var card = profileCard();
    var greet = document.getElementById('profileGreeting');
    var input = document.getElementById('profileNombreInput');
    var toggle = document.getElementById('profileNombreToggle');
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
    var el = document.getElementById('profileNombreStatus');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'auth-message profile-name-status');
      return;
    }
    el.textContent = text || '';
    el.className = 'auth-message profile-name-status' + (type ? ' is-' + type : '');
  }

  function saveClienteNombre() {
    var input = document.getElementById('profileNombreInput');
    var nit = (window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || '';
    if (!input || !nit) return;
    var nombre = String(input.value || '').trim();
    if (nombre.length < 2) {
      setNombreStatus('Ingresa un nombre válido (mínimo 2 caracteres).', 'error');
      setNombreEditUi(true);
      return;
    }
    setNombreStatus('Guardando…', '');
    postApi({ action: 'update_cliente_nombre', nit: nit, nombre: nombre }).then(function (data) {
      if (!data || !data.ok) {
        setNombreStatus((data && data.error) || 'No se pudo guardar el nombre.', 'error');
        return;
      }
      var saved = String(data.nombre || nombre).trim();
      if (window.IZCAuth && typeof IZCAuth.setSessionNit === 'function') {
        IZCAuth.setSessionNit(nit, saved, { skipUi: true });
      }
      var greet = document.getElementById('profileGreeting');
      if (greet) greet.textContent = 'Hola ' + (saved || 'cliente');
      setNombreEditUi(false);
      setNombreStatus(data.message || 'Nombre actualizado.', 'ok');
      window.setTimeout(function () { setNombreStatus('', ''); }, 2500);
    }).catch(function () {
      setNombreStatus('No se pudo guardar el nombre.', 'error');
    });
  }

  function bindNombreEdit() {
    var toggle = document.getElementById('profileNombreToggle');
    var input = document.getElementById('profileNombreInput');
    if (toggle) {
      toggle.addEventListener('click', function () {
        if (isEditingNombre()) saveClienteNombre();
        else {
          setNombreStatus('', '');
          setNombreEditUi(true);
        }
      });
    }
    if (input) {
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          saveClienteNombre();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          setNombreEditUi(false);
          setNombreStatus('', '');
          var greet = document.getElementById('profileGreeting');
          if (greet) greet.textContent = 'Hola ' + (currentProfileNombre() || 'cliente');
        }
      });
    }
  }

  function bindLogout() {
    var btn = document.getElementById('profileLogout');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (window.IZCAuth && IZCAuth.logout) {
        IZCAuth.logout({ redirect: 'login.html' });
        return;
      }
      window.location.replace('login.html');
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
    bindNombreEdit();
    bindQuotesUi();
    document.addEventListener('izc:auth-changed', fillProfile);
    var ready = (window.IZCAuth && IZCAuth.whenSessionReady)
      ? IZCAuth.whenSessionReady()
      : Promise.resolve();
    ready.then(function () {
      fillProfile();
      startPerfilLiveSync();
    }).catch(function () {
      fillProfile();
      startPerfilLiveSync();
    });
  }

  function startPerfilLiveSync() {
    if (!window.IZCLiveSync || typeof IZCLiveSync.startPoll !== 'function') return;
    if (window.__IZC_PERFIL_LIVE__) return;
    window.__IZC_PERFIL_LIVE__ = true;
    IZCLiveSync.startPoll(function () {
      var nit = (window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || '';
      if (!nit) return Promise.resolve();
      return loadQuotes({ silent: true });
    }, 12000, {
      types: [IZCLiveSync.TYPES.ALL, IZCLiveSync.TYPES.QUOTES]
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
