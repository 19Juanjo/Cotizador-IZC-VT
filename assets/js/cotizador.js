/* Logica del cotizador: carrito, totales, IVA, guardar cotizacion. */
(function () {
  'use strict';

  function redirectAsesorIfNeeded() {
    // Admin SAT / GP usan cotizador-sat.html, no el cotizador-asesor.
    try {
      if (window.IZCAuth && IZCAuth.isSat && IZCAuth.isSat()) {
        if (!/cotizador-sat\.html/i.test(String(location.pathname || ''))) {
          window.location.replace('cotizador-sat.html' + (window.location.search || ''));
          return true;
        }
        return false;
      }
      if (window.IZCAuth && IZCAuth.isGp && IZCAuth.isGp()) {
        if (!/cotizador-sat\.html/i.test(String(location.pathname || ''))) {
          window.location.replace('cotizador-sat.html' + (window.location.search || ''));
          return true;
        }
        return false;
      }
    } catch (eSat) { /* ignore */ }
    var staff = false;
    try {
      if (window.IZCAuth && IZCAuth.isAsesor && IZCAuth.isAsesor()) staff = true;
      if (window.IZCAuth && IZCAuth.isAdmin && IZCAuth.isAdmin()) staff = true;
      if (window.IZCAuth && IZCAuth.isZkteco && IZCAuth.isZkteco()) staff = true;
    } catch (e) { /* ignore */ }
    // Fallback por sesion local (por si auth.js viejo/cacheado).
    if (!staff) {
      try {
        var role = String(localStorage.getItem('izc_session_role') || '').toLowerCase();
        var nit = String(localStorage.getItem('izc_session_nit') || '').replace(/[\s.]/g, '').toUpperCase();
        if (role === 'asesor' || role === 'admin' || role === 'zkteco' || role === 'zebra') staff = true;
        if (/^V\d{1,4}$/.test(nit) || nit === 'ZKTECO') staff = true;
      } catch (e2) { /* ignore */ }
    }
    if (!staff) return false;
    if (/cotizador-asesor\.html/i.test(String(location.pathname || ''))) return false;
    window.location.replace('cotizador-asesor.html' + (window.location.search || ''));
    return true;
  }

  var IVA = 0.19;
  var STORE = String(
    (document.body && document.body.getAttribute('data-store')) || 'izc'
  ).trim().toLowerCase();
  var IS_VALTECH = STORE === 'valtech';

  function isGpSession() {
    try {
      if (window.IZCAuth && typeof IZCAuth.isGp === 'function' && IZCAuth.isGp()) return true;
    } catch (e) { /* ignore */ }
    try {
      var role = String(localStorage.getItem('izc_session_role') || '').toLowerCase();
      if (role === 'gp') return true;
      var nit = String(localStorage.getItem('izc_session_nit') || '').replace(/[\s.]/g, '').toUpperCase();
      return /^GP\d{1,4}$/.test(nit);
    } catch (e2) { return false; }
  }

  function syncGpClientFields() {
    var show = isGpSession();
    ['cotizadorGpClientWrap', 'cotizadorGpClientNameWrap'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = !show;
    });
  }

  var STORAGE_PREFIX = IS_VALTECH ? 'valtech_cotizador_items_' : 'izc_cotizador_items_';
  var DEFAULT_EMPRESA = IS_VALTECH
    ? 'VALTECH MAYORISTA S.A.S.'
    : 'IZC MAYORISTA S.A.S.';
  var DEFAULT_TRM = 3204;
  var API_ORIGIN = 'http://127.0.0.1:8080';
  var PRECIOS_PATH = (function () {
    var h = String(location.hostname || '').toLowerCase();
    if (h === '127.0.0.1' || h === 'localhost') {
      return 'assets/files/precios.json';
    }
    return 'assets/files/precios.php';
  })();
  var PRODUCTOS_PATH = 'assets/files/productos.json';
  var REFERENCIAS_PATH = 'assets/files/referencias.json';
  var INVENTARIO_PATH = 'assets/files/inventario.json';
  var INV_BODEGAS = ['AR', 'CT', 'UN', 'RC'];

  var priceMap = null;
  var productMap = null;
  var referenciaMap = null;
  var createdProductsMap = null;
  var satSkuSet = null;
  var searchCatalog = null;
  var suggestActiveIdx = -1;
  var pendingSelectedSku = '';
  var items = [];
  var previewTimer = null;
  var messageTimer = null;
  var finishing = false;
  var inventarioMap = null;
  var inventarioLoadPromise = null;

  /** Admin / asesor pueden cotizar SAT en el cotizador IZC (igual que el panel asesor). */
  function canQuoteSatOnIzc() {
    if (IS_VALTECH) return true;
    if (window.IZCCatalogScope && typeof IZCCatalogScope.allowSatOnCurrentPage === 'function') {
      if (IZCCatalogScope.allowSatOnCurrentPage()) return true;
    }
    if (window.IZCAuth) {
      if (typeof IZCAuth.isAdmin === 'function' && IZCAuth.isAdmin()) return true;
      if (typeof IZCAuth.isAsesor === 'function' && IZCAuth.isAsesor()) return true;
    }
    try {
      var role = String(localStorage.getItem('izc_session_role') || '').toLowerCase();
      if (role === 'admin' || role === 'asesor' || role === 'zkteco' || role === 'zebra') return true;
      var nit = String(localStorage.getItem('izc_session_nit') || '').replace(/[\s.]/g, '').trim();
      if (nit === '03166122778' || nit.toUpperCase() === 'ADMINIZC' || nit.toUpperCase() === 'ZKTECO') return true;
      if (/^v\d{1,4}$/i.test(nit)) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function isLoggedIn() {
    return !!(window.IZCAuth && IZCAuth.isLoggedIn && IZCAuth.isLoggedIn());
  }

  function getUserNit() {
    if (window.IZCAuth && IZCAuth.getSessionNit) {
      return String(IZCAuth.getSessionNit() || '').replace(/[\s.]/g, '').trim();
    }
    return '';
  }

  function getUserNombre() {
    if (window.IZCAuth && IZCAuth.getSessionNombre) {
      return String(IZCAuth.getSessionNombre() || '').trim();
    }
    return '';
  }

  function itemsStorageKey() {
    var nit = getUserNit();
    return nit ? STORAGE_PREFIX + nit : '';
  }

  function setMessage(text, type) {
    var el = document.getElementById('cotizadorMessage');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'cotizador-message');
      return;
    }
    window.clearTimeout(messageTimer);
    messageTimer = null;
    el.textContent = text || '';
    el.className = 'cotizador-message' + (type ? ' is-' + type : '');
    if (text) {
      messageTimer = window.setTimeout(function () {
        if (el.textContent === text) {
          el.textContent = '';
          el.className = 'cotizador-message';
        }
        messageTimer = null;
      }, 7000);
    }
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

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeSku(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[^A-Z0-9\-_./]/g, '');
  }

  function lookupZktecoOverlay(sku) {
    return window.IZCZktecoOverlay && typeof IZCZktecoOverlay.get === 'function'
      ? IZCZktecoOverlay.get(sku)
      : null;
  }

  function loadZktecoOverlay() {
    if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.load === 'function') {
      return IZCZktecoOverlay.load().then(function () {
        searchCatalog = null;
      });
    }
    return Promise.resolve();
  }

  function lookupReferencia(sku) {
    if (!sku) return '';
    var ov = lookupZktecoOverlay(sku);
    if (ov && ov.referencia) return String(ov.referencia || '');
    if (referenciaMap) {
      if (Object.prototype.hasOwnProperty.call(referenciaMap, sku)) {
        return String(referenciaMap[sku] || '');
      }
      var noZeros = String(sku).replace(/^0+/, '');
      if (noZeros && Object.prototype.hasOwnProperty.call(referenciaMap, noZeros)) {
        return String(referenciaMap[noZeros] || '');
      }
    }
    var created = lookupCreatedProduct(sku);
    if (created && created.referencia) return String(created.referencia);
    return '';
  }

  function lookupCreatedProduct(sku) {
    var ov = lookupZktecoOverlay(sku);
    if (ov) {
      return String(ov.source || '').toLowerCase() === 'created' ? ov : null;
    }
    if (!createdProductsMap || !sku) return null;
    var key = normalizeSku(sku);
    if (Object.prototype.hasOwnProperty.call(createdProductsMap, key)) {
      return createdProductsMap[key];
    }
    var noZeros = String(key).replace(/^0+/, '');
    if (noZeros && Object.prototype.hasOwnProperty.call(createdProductsMap, noZeros)) {
      return createdProductsMap[noZeros];
    }
    return null;
  }

  function isCreatedProductSku(sku) {
    return !!lookupCreatedProduct(sku);
  }

  function normalizeSearchText(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s\-_./]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function queryTokens(query) {
    var n = normalizeSearchText(query);
    if (!n) return [];
    return n.split(' ').filter(function (t) {
      return t.length >= 1;
    });
  }

  function isSatCatalogItem(name, sku, referencia) {
    var key = String(sku || '').trim();
    if (satSkuSet) {
      if (key && satSkuSet[key]) return true;
      var noZeros = key.replace(/^0+/, '');
      if (noZeros && satSkuSet[noZeros]) return true;
    }
    if (window.IZCCatalogScope && typeof IZCCatalogScope.isSatText === 'function') {
      return IZCCatalogScope.isSatText(name, sku, referencia);
    }
    if (window.IZCCatalogScope && typeof IZCCatalogScope.isSatProduct === 'function') {
      return IZCCatalogScope.isSatProduct({ name: name, sku: sku, referencia: referencia });
    }
    var blob = [name, sku, referencia].join(' ').toUpperCase().replace(/SATA[A-Z0-9]*/g, ' ');
    return blob.indexOf('SAT') !== -1;
  }

  function isDemoCatalogItem(name, sku, referencia) {
    if (window.IZCCatalogScope && typeof IZCCatalogScope.isDemoText === 'function') {
      return IZCCatalogScope.isDemoText(name, sku, referencia);
    }
    if (window.IZCCatalogScope && typeof IZCCatalogScope.isDemoProduct === 'function') {
      return IZCCatalogScope.isDemoProduct({ name: name, sku: sku, referencia: referencia });
    }
    var blob = [name, sku, referencia].join(' ').toUpperCase();
    return /(?:^|[^A-Z0-9])DEMO(?:[^A-Z0-9]|$)/.test(blob);
  }

  function stripSataFromSearchHay(text) {
    if (window.IZCCatalogScope && typeof IZCCatalogScope.searchBlobWithoutSata === 'function') {
      return IZCCatalogScope.searchBlobWithoutSata(text);
    }
    return String(text || '').toUpperCase().replace(/SATA[A-Z0-9]*/g, ' ');
  }

  function loadSatSkuSet() {
    return loadJson('assets/files/catalogo.json').then(function (catalog) {
      var set = Object.create(null);
      (catalog && catalog.products ? catalog.products : []).forEach(function (p) {
        if (!p) return;
        var isSat = window.IZCCatalogScope && IZCCatalogScope.isSatProduct
          ? IZCCatalogScope.isSatProduct(p)
          : String(p.brand || '').toLowerCase() === 'sat';
        if (!isSat) return;
        var sku = String(p.sku || '').trim();
        if (!sku) return;
        set[sku] = true;
        var nz = sku.replace(/^0+/, '');
        if (nz) set[nz] = true;
      });
      satSkuSet = set;
      searchCatalog = null;
      return set;
    }).catch(function () {
      satSkuSet = satSkuSet || Object.create(null);
      return satSkuSet;
    });
  }

  function rebuildSearchCatalog() {
    var bySku = {};
    function ensure(sku) {
      var key = String(sku || '').trim();
      if (!key) return null;
      if (!bySku[key]) {
        bySku[key] = { sku: key, name: '', referencia: '' };
      }
      return bySku[key];
    }

    if (productMap) {
      Object.keys(productMap).forEach(function (sku) {
        var row = ensure(sku);
        if (row) row.name = String(productMap[sku] || '');
      });
    }
    if (referenciaMap) {
      Object.keys(referenciaMap).forEach(function (sku) {
        var row = ensure(sku);
        if (row) row.referencia = String(referenciaMap[sku] || '');
      });
    }
    if (priceMap) {
      Object.keys(priceMap).forEach(function (sku) {
        ensure(sku);
      });
    }
    if (createdProductsMap) {
      Object.keys(createdProductsMap).forEach(function (sku) {
        if (lookupZktecoOverlay(sku)) return;
        var created = createdProductsMap[sku];
        var row = ensure(sku);
        if (!row || !created) return;
        if (!row.name && created.name) row.name = String(created.name);
        if (!row.referencia && created.referencia) row.referencia = String(created.referencia);
        row.manual = true;
      });
    }
    if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.forEach === 'function') {
      IZCZktecoOverlay.forEach(function (ov) {
        if (!ov) return;
        var row = ensure(ov.sku);
        if (!row) return;
        if (ov.name) row.name = String(ov.name || '');
        if (ov.referencia) row.referencia = String(ov.referencia || '');
        if (String(ov.source || '').toLowerCase() === 'created') row.manual = true;
      });
    }

    searchCatalog = Object.keys(bySku).map(function (sku) {
      var row = bySku[sku];
      if (!row.name) row.name = lookupName(sku) || '';
      if (!row.referencia) row.referencia = lookupReferencia(sku) || '';
      if (isCreatedProductSku(sku)) row.manual = true;
      var hay = row.sku + ' ' + row.name + ' ' + row.referencia;
      if (!IS_VALTECH) {
        hay = stripSataFromSearchHay(hay);
      } else if (
        window.IZCCatalogScope &&
        !IZCCatalogScope.allowSatOnCurrentPage() &&
        typeof IZCCatalogScope.searchBlobWithoutSata === 'function'
      ) {
        hay = IZCCatalogScope.searchBlobWithoutSata(hay);
      }
      row.haystack = normalizeSearchText(hay);
      return row;
    }).filter(function (row) {
      if (isDemoCatalogItem(row.name, row.sku, row.referencia)) return false;
      var sat = isSatCatalogItem(row.name, row.sku, row.referencia);
      if (IS_VALTECH) return sat;
      if (canQuoteSatOnIzc()) return true;
      return !sat;
    });
  }

  function ensureSearchCatalog() {
    if (!searchCatalog) rebuildSearchCatalog();
    return searchCatalog || [];
  }

  function searchProducts(query, limit) {
    var tokens = queryTokens(query);
    if (!tokens.length) return [];
    if (!IS_VALTECH && tokens.length === 1 && tokens[0] === 'sat' && !canQuoteSatOnIzc()) {
      return [];
    }
    var max = Math.max(1, Math.min(Number(limit) || 12, 30));
    var catalog = ensureSearchCatalog();
    var exactSku = normalizeSku(query);
    var results = [];

    for (var i = 0; i < catalog.length; i++) {
      var row = catalog[i];
      if (!lookupPrice(row.sku)) continue;
      var hay = row.haystack;
      var allMatch = true;
      var score = 0;
      for (var t = 0; t < tokens.length; t++) {
        var token = tokens[t];
        var pos = hay.indexOf(token);
        if (pos < 0) {
          allMatch = false;
          break;
        }
        score += 20;
        if (pos === 0) score += 8;
      }
      if (!allMatch) continue;

      var skuNorm = normalizeSearchText(row.sku);
      if (exactSku && normalizeSku(row.sku) === exactSku) score += 1000;
      else if (skuNorm === tokens.join('')) score += 400;
      else if (skuNorm.indexOf(tokens[0]) === 0) score += 120;
      if (normalizeSearchText(row.referencia).indexOf(tokens.join(' ')) === 0) score += 80;
      if (normalizeSearchText(row.name).indexOf(tokens[0]) === 0) score += 40;

      results.push({
        sku: row.sku,
        name: row.name || ('Producto ' + row.sku),
        referencia: row.referencia || '',
        manual: !!row.manual || isCreatedProductSku(row.sku),
        score: score
      });
    }

    results.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.sku).localeCompare(String(b.sku));
    });
    return results.slice(0, max);
  }

  function hideSkuSuggestions() {
    var list = document.getElementById('cotizadorSkuSuggest');
    if (list) {
      list.innerHTML = '';
      list.hidden = true;
    }
    suggestActiveIdx = -1;
  }

  function paintSuggestActive(list) {
    if (!list) return;
    var buttons = list.querySelectorAll('.cotizador-sku-suggest-item');
    for (var i = 0; i < buttons.length; i++) {
      if (i === suggestActiveIdx) buttons[i].classList.add('is-active');
      else buttons[i].classList.remove('is-active');
    }
  }

  function inventarioSuggestHtml(sku) {
    var data = lookupInventario(sku);
    var company = inventarioCompany();
    var label = IS_VALTECH ? 'VALTECH' : 'IZC';
    var total = data.total || 0;
    if (total <= 0) {
      return '<span class="cotizador-sku-suggest-stock is-agotado">Agotado</span>';
    }
    var parts = INV_BODEGAS.map(function (b) {
      return b + ':' + (data[company][b] || 0);
    }).join(' ');
    return (
      '<span class="cotizador-sku-suggest-stock">' +
        '<span class="cotizador-sku-suggest-stock-line">' + label + ' ' + escapeHtml(parts) + '</span>' +
        '<span class="cotizador-sku-suggest-stock-line is-total">Total ' + escapeHtml(String(total)) + '</span>' +
      '</span>'
    );
  }

  function renderSkuSuggestions(matches) {
    var list = document.getElementById('cotizadorSkuSuggest');
    if (!list) return;
    if (!matches || !matches.length) {
      hideSkuSuggestions();
      return;
    }
    suggestActiveIdx = -1;
    list.innerHTML = matches.map(function (m, idx) {
      var manualTag = m.manual
        ? ' <span class="cotizador-manual-tag" title="Producto creado manualmente">M</span>'
        : '';
      return (
        '<li role="option">' +
          '<button type="button" class="cotizador-sku-suggest-item" data-sku="' + escapeHtml(m.sku) + '" data-idx="' + idx + '">' +
            '<span class="cotizador-sku-suggest-main">' +
              '<span class="cotizador-sku-suggest-code">' + escapeHtml(m.sku) + '</span>' +
              '<span class="cotizador-sku-suggest-name">' + escapeHtml(m.name) + manualTag + '</span>' +
            '</span>' +
            inventarioSuggestHtml(m.sku) +
          '</button>' +
        '</li>'
      );
    }).join('');
    list.hidden = false;
  }

  function selectSkuSuggestion(sku) {
    var input = document.getElementById('cotizadorSku');
    pendingSelectedSku = normalizeSku(sku);
    if (input) {
      input.value = pendingSelectedSku;
      input.focus();
    }
    hideSkuSuggestions();
    updateSkuPreview();
  }

  function resolveSkuFromInput(raw) {
    var text = String(raw || '').trim();
    if (!text) return '';

    if (pendingSelectedSku) {
      var chosen = pendingSelectedSku;
      pendingSelectedSku = '';
      return chosen;
    }

    var exact = normalizeSku(text);
    if (exact && (lookupName(exact) || lookupPrice(exact) || lookupReferencia(exact))) {
      if (isDemoCatalogItem(lookupName(exact) || '', exact, lookupReferencia(exact) || '')) {
        return '';
      }
      return exact;
    }

    var matches = searchProducts(text, 8);
    if (matches.length === 1) return normalizeSku(matches[0].sku);
    if (matches.length > 1) {
      for (var i = 0; i < matches.length; i++) {
        if (normalizeSku(matches[i].sku) === exact) return exact;
      }
      return '';
    }
    return exact;
  }

  function getTrm() {
    var input = document.getElementById('cotizadorTrm');
    var n = input ? Number(input.value) : DEFAULT_TRM;
    if (!isFinite(n) || n <= 0) n = DEFAULT_TRM;
    return n;
  }

  function setTrmValue(value) {
    var input = document.getElementById('cotizadorTrm');
    var n = Number(value);
    if (!input || !isFinite(n) || n <= 0) return;
    input.value = String(n);
    try { window.__IZC_TRM__ = n; } catch (eTrm) { /* ignore */ }
  }

  function startTrmAutoRefresh() {
    if (window.__IZC_TRM_WATCHING__) return;
    window.__IZC_TRM_WATCHING__ = true;
    var refresh = function () {
      var input = document.getElementById('cotizadorTrm');
      if (input && document.activeElement === input) return;
      var prev = getTrm();
      fetchServerTrm().then(function (next) {
        if (Number(next) !== Number(prev)) render();
      });
    };
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refresh();
    });
    window.addEventListener('focus', refresh);
    setInterval(refresh, 20 * 1000);
    if (window.IZCLiveSync && typeof IZCLiveSync.on === 'function') {
      IZCLiveSync.on(function (msg) {
        var t = msg && msg.type;
        if (t === IZCLiveSync.TYPES.TRM || t === IZCLiveSync.TYPES.ALL) refresh();
      });
    }
  }

  function postApi(payload) {
    var body = JSON.stringify(payload);
    var endpoints;
    if (window.IZCAuth && typeof IZCAuth.apiEndpoints === 'function') {
      endpoints = IZCAuth.apiEndpoints();
    } else {
      var path = String(location.pathname || '/');
      var i = path.lastIndexOf('/');
      var base = i < 0 ? '/' : path.slice(0, i + 1);
      endpoints = [
        API_ORIGIN + '/api/auth',
        'http://localhost:8080/api/auth',
        base + 'api/auth',
        base + 'api/auth.php'
      ];
      if (location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') {
        endpoints = [base + 'api/auth.php', base + 'api/auth'];
      }
    }

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
        return res.text().then(function (text) {
          var data;
          try {
            data = JSON.parse(text);
          } catch (e) {
            throw new Error('Respuesta no JSON');
          }
          if (!data || typeof data !== 'object') throw new Error('Respuesta inválida');
          data._http = res.status;
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

  function fetchServerTrm() {
    return postApi({ action: 'get_trm' }).then(function (data) {
      if (data && data.ok && data.value != null) {
        setTrmValue(data.value);
        return Number(data.value);
      }
      return Number(document.getElementById('cotizadorTrm') && document.getElementById('cotizadorTrm').value) || 0;
    }).catch(function () {
      return Number(document.getElementById('cotizadorTrm') && document.getElementById('cotizadorTrm').value) || 0;
    });
  }

  function resolveEntry(entry) {
    if (entry == null) return null;
    if (typeof entry === 'number' && isFinite(entry) && entry > 0) {
      return { amount: entry, currency: 'USD' };
    }
    if (typeof entry === 'object') {
      var amount = entry.amount != null ? entry.amount : entry.v;
      var currency = entry.currency || entry.c || 'USD';
      if (amount != null && isFinite(Number(amount)) && Number(amount) > 0) {
        var out = { amount: Number(amount), currency: String(currency).toUpperCase() };
        var pesos = entry.pesos != null ? Number(entry.pesos)
          : (entry.listCop != null ? Number(entry.listCop) : NaN);
        if (isFinite(pesos) && pesos > 0) out.pesos = pesos;
        return out;
      }
    }
    return null;
  }

  function lookupPrice(sku) {
    if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.price === 'function') {
      var overlayPrice = IZCZktecoOverlay.price(sku);
      if (overlayPrice) return overlayPrice;
    }
    if (sku && priceMap) {
      if (Object.prototype.hasOwnProperty.call(priceMap, sku)) {
        return resolveEntry(priceMap[sku]);
      }
      var noZeros = String(sku).replace(/^0+/, '');
      if (noZeros && Object.prototype.hasOwnProperty.call(priceMap, noZeros)) {
        return resolveEntry(priceMap[noZeros]);
      }
    }
    var created = lookupCreatedProduct(sku);
    if (created) {
      var usd = Number(created.unitario_usd || 0);
      var cop = Number(created.unitario_cop || 0);
      if (isFinite(usd) && usd > 0) {
        return { amount: usd, currency: 'USD', pesos: cop > 0 ? cop : null };
      }
      if (isFinite(cop) && cop > 0) {
        return { amount: cop, currency: 'COP' };
      }
    }
    return null;
  }

  function lookupName(sku) {
    var ov = lookupZktecoOverlay(sku);
    if (ov && (ov.name || ov.nombre)) {
      var fromOv = String(ov.name || ov.nombre || '').trim();
      if (fromOv) return fromOv;
    }
    if (sku && productMap) {
      if (Object.prototype.hasOwnProperty.call(productMap, sku)) return productMap[sku];
      var noZeros = String(sku).replace(/^0+/, '');
      if (noZeros && Object.prototype.hasOwnProperty.call(productMap, noZeros)) {
        return productMap[noZeros];
      }
    }
    var created = lookupCreatedProduct(sku);
    if (created && created.name) return String(created.name);
    return null;
  }

  function applyCreatedProducts(products) {
    var map = {};
    (Array.isArray(products) ? products : []).forEach(function (p) {
      if (!p) return;
      var sku = normalizeSku(p.sku || p.codigo || '');
      if (!sku) return;
      map[sku] = {
        sku: sku,
        name: String(p.name || p.nombre || '').trim(),
        referencia: String(p.referencia || '').trim(),
        unitario_usd: Number(p.unitario_usd || p.unitarioUsd || p.usd || 0),
        unitario_cop: Number(p.unitario_cop || p.unitarioCop || p.cop || 0)
      };
      if (!productMap) productMap = {};
      if (map[sku].name && !productMap[sku]) productMap[sku] = map[sku].name;
      if (!referenciaMap) referenciaMap = {};
      if (map[sku].referencia && !referenciaMap[sku]) {
        referenciaMap[sku] = map[sku].referencia;
      }
    });
    createdProductsMap = map;
    searchCatalog = null;
    return map;
  }

  function loadCreatedProducts() {
    // Solo admin/asesor (misma regla que SAT en cotizador IZC).
    if (!canQuoteSatOnIzc()) {
      createdProductsMap = createdProductsMap || {};
      return Promise.resolve(createdProductsMap);
    }
    var payload = { action: 'get_productos_creados' };
    try {
      var role = String(localStorage.getItem('izc_session_role') || '').toLowerCase();
      var nit = String(localStorage.getItem('izc_session_nit') || '').replace(/[\s.]/g, '').trim();
      if (window.IZCAuth && typeof IZCAuth.isAdmin === 'function' && IZCAuth.isAdmin()) {
        payload.admin_nit = (window.IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || nit;
      } else if (role === 'admin' || nit === '03166122778' || nit.toUpperCase() === 'ADMINIZC') {
        payload.admin_nit = nit || 'Admin IZC';
      } else if (window.IZCAuth && typeof IZCAuth.isAsesor === 'function' && IZCAuth.isAsesor()) {
        var codigo = (window.IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || nit;
        payload.asesor_codigo = codigo;
        payload.nit_asesor = codigo;
      } else if (role === 'asesor' || /^v\d{1,4}$/i.test(nit)) {
        payload.asesor_codigo = nit;
        payload.nit_asesor = nit;
      } else {
        createdProductsMap = createdProductsMap || {};
        return Promise.resolve(createdProductsMap);
      }
    } catch (e) {
      createdProductsMap = createdProductsMap || {};
      return Promise.resolve(createdProductsMap);
    }
    return postApi(payload).then(function (data) {
      if (!data || !data.ok) {
        createdProductsMap = createdProductsMap || {};
        return createdProductsMap;
      }
      return applyCreatedProducts(data.products || []);
    }).catch(function () {
      createdProductsMap = createdProductsMap || {};
      return createdProductsMap;
    });
  }

  function updateSkuPreview() {
    var input = document.getElementById('cotizadorSku');
    var preview = document.getElementById('cotizadorSkuName');
    if (!input || !preview) {
      paintInventario('');
      return;
    }

    var raw = String(input.value || '').trim();
    if (!raw) {
      preview.textContent = '';
      preview.className = 'cotizador-sku-name is-empty';
      hideSkuSuggestions();
      pendingSelectedSku = '';
      paintInventario('');
      return;
    }

    if (pendingSelectedSku && normalizeSku(raw) !== pendingSelectedSku) {
      pendingSelectedSku = '';
    }

    var exactSku = normalizeSku(raw);
    var exactName = exactSku ? lookupName(exactSku) : null;
    var exactPrice = exactSku ? lookupPrice(exactSku) : null;
    var exactRef = exactSku ? (lookupReferencia(exactSku) || '') : '';

    function showWrongBrand(msg) {
      hideSkuSuggestions();
      preview.textContent = msg;
      preview.className = 'cotizador-sku-name is-error';
      paintInventario('');
    }

    if (exactSku && (exactName || exactPrice)) {
      if (IS_VALTECH && !isSatCatalogItem(exactName || '', exactSku, exactRef)) {
        showWrongBrand('Este producto no hace parte de la marca SAT');
        return;
      }
      if (!IS_VALTECH && !canQuoteSatOnIzc() && isSatCatalogItem(exactName || '', exactSku, exactRef)) {
        showWrongBrand('Este producto no hace parte de IZC');
        return;
      }
    }

    if (exactSku && isDemoCatalogItem(exactName || '', exactSku, exactRef)) {
      hideSkuSuggestions();
      preview.textContent = 'Producto demo — no disponible para cotizar.';
      preview.className = 'cotizador-sku-name is-warn';
      paintInventario('');
      return;
    }
    var matches = searchProducts(raw, 12);
    var skuToPaint = pendingSelectedSku || exactSku || '';

    if (exactName && exactPrice && matches.length <= 1) {
      hideSkuSuggestions();
      preview.textContent = exactName;
      preview.className = 'cotizador-sku-name';
      paintInventario(skuToPaint);
      return;
    }

    if (matches.length) {
      renderSkuSuggestions(matches);
      if (matches.length === 1) {
        var only = matches[0];
        if (IS_VALTECH && !isSatCatalogItem(only.name, only.sku, only.referencia)) {
          showWrongBrand('Este producto no hace parte de la marca SAT');
          return;
        }
        if (!IS_VALTECH && !canQuoteSatOnIzc() && isSatCatalogItem(only.name, only.sku, only.referencia)) {
          showWrongBrand('Este producto no hace parte de IZC');
          return;
        }
        preview.textContent = only.sku + ' — ' + only.name;
        preview.className = 'cotizador-sku-name';
        skuToPaint = only.sku;
      } else {
        preview.textContent = matches.length + ' productos encontrados. Elige uno de la lista.';
        preview.className = 'cotizador-sku-name';
      }
      paintInventario(skuToPaint);
      return;
    }

    hideSkuSuggestions();
    if (exactSku && exactName && !exactPrice) {
      preview.textContent = exactName + ' — sin precio disponible.';
      preview.className = 'cotizador-sku-name is-error';
      paintInventario(skuToPaint);
      return;
    }
    preview.textContent = 'No se encontró producto con "' + raw + '".';
    preview.className = 'cotizador-sku-name is-error';
    paintInventario(skuToPaint);
  }

  function unitsFromEntry(entry, trm) {
    if (!entry) return null;
    var currency = entry.currency === 'COP' ? 'COP' : 'USD';
    var usd;
    var cop;
    if (currency === 'COP') {
      cop = entry.amount;
      usd = window.IZCMoney ? IZCMoney.roundUsd(cop / trm) : (cop / trm);
    } else {
      usd = window.IZCMoney ? IZCMoney.roundUsd(entry.amount) : entry.amount;
      cop = Math.round(usd * trm);
    }
    return {
      currency: currency,
      usd: usd,
      cop: cop,
      usdIva: usd * (1 + IVA),
      copIva: cop * (1 + IVA)
    };
  }

  function formatTotalIva(row) {
    if (!row || !row.ok) return '—';
    if (row.currency === 'COP') return formatCOP(row.totalCopIva);
    return formatUSD(row.totalUsdIva);
  }

  function readItems() {
    var key = itemsStorageKey();
    if (!key) return [];
    try {
      var raw = localStorage.getItem(key);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeItems(list) {
    var key = itemsStorageKey();
    items = list;
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  function loadJson(path) {
    if (window.IZCData && typeof IZCData.loadJson === 'function') {
      return IZCData.loadJson(path, { cache: 'no-store' });
    }
    return fetch(path + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('sin datos');
      return r.json();
    });
  }

  function inventarioCompany() {
    return IS_VALTECH ? 'valtech' : 'izc';
  }

  function emptyInventario() {
    return {
      izc: { AR: 0, CT: 0, UN: 0, RC: 0 },
      valtech: { AR: 0, CT: 0, UN: 0, RC: 0 },
      total: 0
    };
  }

  function lookupInventario(sku) {
    var empty = emptyInventario();
    if (!inventarioMap || typeof inventarioMap !== 'object') return empty;
    var raw = String(sku == null ? '' : sku).trim();
    var key = normalizeSku(raw);
    if (!key && !raw) return empty;
    var candidates = [key, raw, raw.replace(/^0+/, ''), key.replace(/^0+/, '')];
    var row = null;
    for (var i = 0; i < candidates.length; i++) {
      var k = candidates[i];
      if (!k) continue;
      if (inventarioMap[k]) {
        row = inventarioMap[k];
        break;
      }
    }
    if (!row || typeof row !== 'object') return empty;
    var company = inventarioCompany();
    var branch = row[company] || {};
    var out = emptyInventario();
    var total = 0;
    INV_BODEGAS.forEach(function (b) {
      var n = Math.max(0, Number(branch[b]) || 0);
      out[company][b] = n;
      total += n;
    });
    out.total = total;
    return out;
  }

  function inventarioCellsHtml(sku) {
    var data = lookupInventario(sku);
    var company = inventarioCompany();
    var label = IS_VALTECH ? 'VALTECH' : 'IZC';
    var html = '';
    INV_BODEGAS.forEach(function (b) {
      var n = data[company][b] || 0;
      html +=
        '<td class="cotizador-inv-cell' + (n > 0 ? ' has-stock' : '') + '" title="' + label + ' ' + b + '">' +
          n +
        '</td>';
    });
    html +=
      '<td class="cotizador-inv-cell cotizador-inv-total-cell' + (data.total > 0 ? ' has-stock' : '') + '" title="Total ' + label + '">' +
        data.total +
      '</td>';
    return html;
  }

  function paintInventario() {}

  function loadInventario() {
    if (inventarioMap) return Promise.resolve(inventarioMap);
    if (inventarioLoadPromise) return inventarioLoadPromise;
    inventarioLoadPromise = loadJson(INVENTARIO_PATH).then(function (data) {
      if (data && data.by_sku && typeof data.by_sku === 'object') {
        inventarioMap = data.by_sku;
      } else if (data && typeof data === 'object' && !Array.isArray(data)) {
        inventarioMap = data.bodegas || data.wh_codes || data.stamp ? {} : data;
      } else {
        inventarioMap = {};
      }
      return inventarioMap;
    }).catch(function () {
      inventarioLoadPromise = null;
      inventarioMap = {};
      return inventarioMap;
    });
    return inventarioLoadPromise;
  }

  function loadPrices() {
    if (window.IZCPrices && typeof IZCPrices.load === 'function') {
      return IZCPrices.load().then(function (map) {
        priceMap = map || null;
        searchCatalog = null;
        return priceMap;
      });
    }
    return loadJson(PRECIOS_PATH).then(function (data) {
      priceMap = data && typeof data === 'object' ? data : null;
      searchCatalog = null;
      return priceMap;
    }).catch(function () {
      priceMap = null;
      searchCatalog = null;
      return null;
    });
  }

  function loadProducts() {
    return loadJson(PRODUCTOS_PATH).then(function (data) {
      productMap = data && typeof data === 'object' ? data : {};
      searchCatalog = null;
      return productMap;
    }).catch(function () {
      productMap = {};
      searchCatalog = null;
      return productMap;
    });
  }

  function loadReferencias() {
    return loadJson(REFERENCIAS_PATH).then(function (data) {
      referenciaMap = data && typeof data === 'object' ? data : {};
      searchCatalog = null;
      return referenciaMap;
    }).catch(function () {
      referenciaMap = {};
      searchCatalog = null;
      return referenciaMap;
    });
  }

  function lineCalc(item, trm) {
    var entry = lookupPrice(item.sku);
    var units = unitsFromEntry(entry, trm);
    var nombre = lookupName(item.sku) || '—';
    var manual = isCreatedProductSku(item.sku);
    if (!units) {
      return { ok: false, sku: item.sku, name: nombre, qty: item.qty, manual: manual };
    }
    return {
      ok: true,
      sku: item.sku,
      name: nombre,
      qty: item.qty,
      manual: manual,
      currency: units.currency,
      usd: units.usd,
      cop: units.cop,
      usdIva: units.usdIva,
      copIva: units.copIva,
      totalUsdIva: units.usdIva * item.qty,
      totalCopIva: units.copIva * item.qty,
      totalUsd: units.usd * item.qty,
      totalCop: units.cop * item.qty
    };
  }

  function computeTotals(rows) {
    var qty = 0;
    var totalUsd = 0;
    var totalCop = 0;
    var totalUsdIva = 0;
    var totalCopIva = 0;
    var hasUsd = false;
    var hasCop = false;
    rows.forEach(function (row) {
      if (!row.ok) return;
      qty += row.qty;
      totalUsd += row.totalUsd;
      totalCop += row.totalCop;
      if (row.currency === 'COP') {
        hasCop = true;
        totalCopIva += row.totalCopIva;
      } else {
        hasUsd = true;
        totalUsdIva += row.totalUsdIva;
      }
    });
    return {
      qty: qty,
      usd: totalUsd,
      cop: totalCop,
      usdIva: totalUsdIva,
      copIva: totalCopIva,
      hasUsd: hasUsd,
      hasCop: hasCop
    };
  }

  function render() {
    var body = document.getElementById('cotizadorBody');
    if (!body) return;
    var trm = getTrm();
    var rows = items.map(function (item) { return lineCalc(item, trm); });

    if (!rows.length) {
      body.innerHTML = '<tr class="cotizador-empty-row"><td colspan="14">Aún no hay productos en la cotización.</td></tr>';
    } else {
      body.innerHTML = rows.map(function (row, idx) {
        var manualTag = row.manual
          ? ' <span class="cotizador-manual-tag" title="Producto creado manualmente">M</span>'
          : '';
        var invCells = inventarioCellsHtml(row.sku);
        if (!row.ok) {
          return (
            '<tr' + (row.manual ? ' class="is-manual-item"' : '') + '>' +
              invCells +
              '<td>' + escapeHtml(row.sku) + '</td>' +
              '<td>' + escapeHtml(row.name) + manualTag + '</td>' +
              '<td class="cotizador-qty-cell">' + qtyInputHtml(idx, row.qty) + '</td>' +
              '<td colspan="5">Sin precio en lista</td>' +
              '<td><button type="button" class="cotizador-remove" data-idx="' + idx + '">Quitar</button></td>' +
            '</tr>'
          );
        }
        return (
          '<tr' + (row.manual ? ' class="is-manual-item"' : '') + '>' +
            invCells +
            '<td>' + escapeHtml(row.sku) + '</td>' +
            '<td class="cotizador-name-cell" title="' + escapeHtml(row.name) + '">' + escapeHtml(row.name) + manualTag + '</td>' +
            '<td class="cotizador-qty-cell">' + qtyInputHtml(idx, row.qty) + '</td>' +
            '<td>' + formatUSD(row.usd) + '</td>' +
            '<td>' + formatCOP(row.cop) + '</td>' +
            '<td>' + formatUSD(row.totalUsd) + '</td>' +
            '<td>' + formatCOP(row.totalCop) + '</td>' +
            '<td>' + formatTotalIva(row) + '</td>' +
            '<td><button type="button" class="cotizador-remove" data-idx="' + idx + '">Quitar</button></td>' +
          '</tr>'
        );
      }).join('');
    }

    var totals = computeTotals(rows);
    var elQty = document.getElementById('totalQty');
    var elUsd = document.getElementById('totalUsd');
    var elCop = document.getElementById('totalCop');
    var elUsdIva = document.getElementById('totalUsdIva');
    var elCopIva = document.getElementById('totalCopIva');
    var cardUsdIva = elUsdIva ? elUsdIva.closest('.cotizador-total-card') : null;
    var cardCopIva = elCopIva ? elCopIva.closest('.cotizador-total-card') : null;
    if (elQty) elQty.textContent = String(totals.qty);
    if (elUsd) elUsd.textContent = formatUSD(totals.usd);
    if (elCop) elCop.textContent = formatCOP(totals.cop);
    if (elUsdIva) elUsdIva.textContent = formatUSD(totals.usdIva);
    if (elCopIva) elCopIva.textContent = formatCOP(totals.copIva);
    var anyPriced = rows.some(function (r) { return r.ok; });
    if (cardUsdIva) cardUsdIva.hidden = anyPriced && !totals.hasUsd;
    if (cardCopIva) cardCopIva.hidden = anyPriced && !totals.hasCop;

    var finishBtn = document.getElementById('cotizadorFinish');
    if (finishBtn) finishBtn.disabled = !rows.some(function (r) { return r.ok; }) || finishing;
  }

  function addItem(sku, qty) {
    var resolved = resolveSkuFromInput(sku);
    if (!resolved) {
      var ambiguous = searchProducts(String(sku || ''), 8);
      if (ambiguous.length > 1) {
        setMessage('Hay varias coincidencias. Elige un producto de la lista.', 'error');
        renderSkuSuggestions(ambiguous);
        return;
      }
      setMessage('Ingresa un código o busca por nombre/referencia.', 'error');
      return;
    }
    sku = normalizeSku(resolved);
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    if (!sku) {
      setMessage('Ingresa un código de producto.', 'error');
      return;
    }
    if (IS_VALTECH) {
      var satName = lookupName(sku) || '';
      var satRef = lookupReferencia(sku) || '';
      if (!isSatCatalogItem(satName, sku, satRef)) {
        setMessage('Este producto no hace parte de la marca SAT', 'error');
        return;
      }
    } else if (!canQuoteSatOnIzc()) {
      var blockName = lookupName(sku) || '';
      var blockRef = lookupReferencia(sku) || '';
      if (isSatCatalogItem(blockName, sku, blockRef)) {
        setMessage('Este producto no hace parte de IZC', 'error');
        return;
      }
    }
    if (!lookupPrice(sku)) {
      setMessage('No hay precio para el código ' + sku + '.', 'error');
      return;
    }

    var list = items.slice();
    var found = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].sku === sku) { found = i; break; }
    }
    if (found >= 0) {
      list[found].qty += qty;
    } else {
      list.push({ sku: sku, qty: qty });
    }
    writeItems(list);
    hideSkuSuggestions();

    var nombre = lookupName(sku);
    setMessage(
      nombre ? 'Producto agregado: ' + nombre : 'Producto ' + sku + ' agregado.',
      'ok'
    );
    render();
  }

  function removeItem(idx) {
    var list = items.slice();
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    writeItems(list);
    setMessage('Producto quitado.', 'ok');
    render();
  }

  function updateItemQty(idx, qty) {
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    var list = items.slice();
    if (idx < 0 || idx >= list.length) return;
    if (list[idx].qty === qty) return;
    list[idx].qty = qty;
    writeItems(list);
    render();
  }

  function qtyInputHtml(idx, qty) {
    return (
      '<input type="number" class="cotizador-qty-input" data-idx="' + idx + '" ' +
      'min="1" step="1" value="' + qty + '" aria-label="Cantidad">'
    );
  }

  function getEmpresa() {
    return DEFAULT_EMPRESA;
  }

  function syncLegalBrand() {
    var brand = document.getElementById('cotizadorLegalBrand');
    if (!brand) return;
    var empresa = getEmpresa() || DEFAULT_EMPRESA;
    brand.textContent = empresa + ' - Documento generado electrónicamente';
  }

  function getFechaCierreCliente() {
    var el = document.getElementById('cotizadorFechaCierreCliente');
    return el ? String(el.value || '').trim() : '';
  }

  function buildQuotePayload() {
    var trm = getTrm();
    var rows = items.map(function (item) { return lineCalc(item, trm); }).filter(function (r) { return r.ok; });
    if (!rows.length) return null;

    var totals = computeTotals(rows);
    var empresa = getEmpresa();
    var fechaCierreCliente = getFechaCierreCliente();
    return {
      action: 'save_quote',
      nit: getUserNit(),
      nombre: getUserNombre(),
      quote_source: (function () {
        if (isGpSession()) return 'gp';
        if (window.IZCAuth && IZCAuth.isSat && IZCAuth.isSat()) return 'sat';
        return 'cliente';
      })(),
      seller_codigo: isGpSession() ? String((window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || localStorage.getItem('izc_session_nit') || '').toUpperCase() : '',
      gp_codigo: isGpSession() ? String((window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || localStorage.getItem('izc_session_nit') || '').toUpperCase() : '',
      client_nit: (document.getElementById('cotizadorClientNit') || {}).value || '',
      client_nombre: (document.getElementById('cotizadorClientNombre') || {}).value || '',
      trm: trm,
      empresa: empresa,
      fecha_cierre_cliente: fechaCierreCliente,
      items: rows.map(function (row) {
        return {
          sku: row.sku,
          name: row.name,
          qty: row.qty,
          currency: row.currency,
          usd: row.usd,
          cop: row.cop,
          usdIva: row.usdIva,
          copIva: row.copIva,
          totalUsd: row.totalUsd,
          totalCop: row.totalCop,
          totalUsdIva: row.totalUsdIva,
          totalCopIva: row.totalCopIva
        };
      }),
      totals: {
        qty: totals.qty,
        usd: totals.usd,
        cop: totals.cop,
        usdIva: totals.usdIva,
        copIva: totals.copIva,
        hasUsd: totals.hasUsd,
        hasCop: totals.hasCop,
        empresa: empresa
      }
    };
  }

  function fireSyncBitrixQuote(quoteId) {
    var qid = String(quoteId || '').trim();
    var nit = getUserNit();
    if (!qid || !nit) return;
    var payload = JSON.stringify({
      action: 'sync_bitrix_client_quote',
      quote_id: qid,
      nit: nit
    });
    var endpoints;
    if (window.IZCAuth && typeof IZCAuth.apiEndpoints === 'function') {
      endpoints = IZCAuth.apiEndpoints();
    } else {
      var path = String(location.pathname || '/');
      var i = path.lastIndexOf('/');
      var base = i < 0 ? '/' : path.slice(0, i + 1);
      endpoints = [base + 'api/auth.php', base + 'api/auth'];
    }
    for (var i = 0; i < endpoints.length; i++) {
      try {
        fetch(endpoints[i], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          cache: 'no-store',
          keepalive: true
        });
        break;
      } catch (e) { /* ignore */ }
    }
  }

  function finishQuote() {
    if (finishing) return;
    var payload = buildQuotePayload();
    if (!payload) {
      setMessage('Agrega al menos un producto con precio para terminar.', 'error');
      return;
    }
    if (!payload.nit) {
      setMessage('Debes iniciar sesión para guardar la cotización.', 'error');
      return;
    }
    if (!payload.fecha_cierre_cliente || !/^\d{4}-\d{2}-\d{2}$/.test(payload.fecha_cierre_cliente)) {
      setMessage('Indica la fecha de cierre de venta.', 'error');
      var fechaEl = document.getElementById('cotizadorFechaCierreCliente');
      if (fechaEl) fechaEl.focus();
      return;
    }

    finishing = true;
    render();
    setMessage('Guardando cotización…', '');

    postApi(payload).then(function (data) {
      finishing = false;
      if (!data || !data.ok) {
        var err = (data && data.error) || 'No se pudo guardar la cotización.';
        if (/acción no válida|accion no valida/i.test(err)) {
          err += ' Reinicia el servidor con tools\\ABRIR.bat.';
        }
        setMessage(err, 'error');
        render();
        return;
      }
      if (data.bitrix && data.bitrix.pending) {
        fireSyncBitrixQuote(data.id || data.quote_id);
      }
      writeItems([]);
      var fechaEl = document.getElementById('cotizadorFechaCierreCliente');
      if (fechaEl) fechaEl.value = '';
      setMessage('Cotizacion guardada', 'ok');
      try {
        if (window.IZCLiveSync) {
          IZCLiveSync.emit(IZCLiveSync.TYPES.QUOTES, {
            quote_id: data.id || data.quote_id || '',
            nit: payload.nit || ''
          });
        }
      } catch (eSync) { /* ignore */ }
      render();
    }).catch(function () {
      finishing = false;
      setMessage((location.hostname === '127.0.0.1' || location.hostname === 'localhost') ? 'No se pudo guardar. Abre tools\\ABRIR.bat e inténtalo de nuevo.' : 'No se pudo guardar. Verifica api/auth.php en el servidor.', 'error');
      render();
    });
  }

  function applyGate() {
    var gate = document.getElementById('cotizadorGate');
    var panel = document.getElementById('cotizadorPanel');
    var logged = isLoggedIn();
    if (gate) gate.hidden = logged;
    if (panel) panel.hidden = !logged;
    return logged;
  }

  function reloadUserData() {
    items = readItems();
    render();
  }

  function bind() {
    var form = document.getElementById('cotizadorAddForm');
    var skuInput = document.getElementById('cotizadorSku');
    var finishBtn = document.getElementById('cotizadorFinish');
    var body = document.getElementById('cotizadorBody');
    var empresaSel = document.getElementById('cotizadorEmpresa');
    if (empresaSel) {
      empresaSel.addEventListener('change', syncLegalBrand);
      syncLegalBrand();
    }

    if (skuInput) {
      skuInput.addEventListener('input', function () {
        window.clearTimeout(previewTimer);
        previewTimer = window.setTimeout(updateSkuPreview, 120);
      });
      skuInput.addEventListener('keydown', function (e) {
        var list = document.getElementById('cotizadorSkuSuggest');
        var open = list && !list.hidden;
        var buttons = open ? list.querySelectorAll('.cotizador-sku-suggest-item') : [];
        if (e.key === 'ArrowDown' && open && buttons.length) {
          e.preventDefault();
          suggestActiveIdx = Math.min(buttons.length - 1, suggestActiveIdx + 1);
          paintSuggestActive(list);
          return;
        }
        if (e.key === 'ArrowUp' && open && buttons.length) {
          e.preventDefault();
          suggestActiveIdx = Math.max(0, suggestActiveIdx - 1);
          paintSuggestActive(list);
          return;
        }
        if (e.key === 'Enter' && open && suggestActiveIdx >= 0 && buttons[suggestActiveIdx]) {
          e.preventDefault();
          selectSkuSuggestion(buttons[suggestActiveIdx].getAttribute('data-sku'));
          return;
        }
        if (e.key === 'Escape') {
          hideSkuSuggestions();
        }
      });
      skuInput.addEventListener('blur', function () {
        window.setTimeout(hideSkuSuggestions, 180);
      });
    }

    var suggestList = document.getElementById('cotizadorSkuSuggest');
    if (suggestList) {
      suggestList.addEventListener('mousedown', function (e) {
        var btn = e.target.closest('.cotizador-sku-suggest-item');
        if (!btn) return;
        e.preventDefault();
        selectSkuSuggestion(btn.getAttribute('data-sku'));
      });
    }

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!isLoggedIn()) {
          window.location.href = 'login.html';
          return;
        }
        var sku = document.getElementById('cotizadorSku');
        var qty = document.getElementById('cotizadorQty');
        addItem(sku ? sku.value : '', qty ? qty.value : 1);
        if (sku) sku.value = '';
        if (qty) qty.value = '1';
        pendingSelectedSku = '';
        hideSkuSuggestions();
        updateSkuPreview();
        if (sku) sku.focus();
      });
    }

    var removeModal = document.getElementById('cotizadorRemoveModal');
    var removeModalText = document.getElementById('cotizadorRemoveText');
    var removeConfirmBtn = document.getElementById('cotizadorRemoveConfirm');
    var pendingRemoveIdx = -1;

    function closeRemoveModal() {
      if (removeModal) removeModal.hidden = true;
      pendingRemoveIdx = -1;
    }

    function openRemoveModal(idx) {
      pendingRemoveIdx = idx;
      var item = items[idx];
      var name = item ? (lookupName(item.sku) || item.sku) : '';
      if (removeModalText) {
        removeModalText.textContent = name
          ? '¿Quieres quitar "' + name + '" de la cotización?'
          : '¿Quieres quitar este producto de la cotización?';
      }
      if (removeModal) removeModal.hidden = false;
      if (removeConfirmBtn) removeConfirmBtn.focus();
    }

    if (removeModal) {
      removeModal.addEventListener('click', function (e) {
        if (e.target.closest('[data-modal-close]')) closeRemoveModal();
      });
    }

    if (removeConfirmBtn) {
      removeConfirmBtn.addEventListener('click', function () {
        var idx = pendingRemoveIdx;
        closeRemoveModal();
        if (idx >= 0) removeItem(idx);
      });
    }

    if (finishBtn) {
      finishBtn.addEventListener('click', function () {
        finishQuote();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (removeModal && !removeModal.hidden) closeRemoveModal();
    });

    if (body) {
      body.addEventListener('click', function (e) {
        var btn = e.target.closest('.cotizador-remove');
        if (!btn) return;
        openRemoveModal(Number(btn.getAttribute('data-idx')));
      });

      body.addEventListener('change', function (e) {
        var input = e.target.closest('.cotizador-qty-input');
        if (!input) return;
        updateItemQty(Number(input.getAttribute('data-idx')), input.value);
      });

      body.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var input = e.target.closest('.cotizador-qty-input');
        if (!input) return;
        e.preventDefault();
        input.blur();
      });
    }

    document.addEventListener('izc:auth-changed', function () {
      if (redirectAsesorIfNeeded()) return;
      if (!applyGate()) {
        items = [];
        render();
        return;
      }
      searchCatalog = null;
      reloadUserData();
      Promise.all([loadPrices(), loadProducts(), loadReferencias(), loadCreatedProducts(), loadZktecoOverlay(), loadSatSkuSet(), fetchServerTrm(), loadInventario()]).then(function () {
        searchCatalog = null;
        updateSkuPreview();
        render();
      });
    });
  }

  function init() {
    if (redirectAsesorIfNeeded()) return;
    bind();
    var productsPromise = Promise.all([loadProducts(), loadReferencias(), loadCreatedProducts(), loadZktecoOverlay(), loadSatSkuSet()]);
    if (!applyGate()) return;
    reloadUserData();
    Promise.all([loadPrices(), productsPromise, fetchServerTrm(), loadInventario()]).then(function () {
      updateSkuPreview();
      render();
      startTrmAutoRefresh();
    });
  }

  function boot() {
    if (window.IZCAuth && typeof IZCAuth.whenSessionReady === 'function') {
      IZCAuth.whenSessionReady().then(init, init);
    } else {
      init();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { syncGpClientFields(); });
    } else {
      syncGpClientFields();
    }
  } catch (eBootGp) { /* ignore */ }
})();
