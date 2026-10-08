/* Panel ZKTeco: productos propios y listado de productos creados por asesores. */
(function () {
  'use strict';

  var activeTab = 'catalogo';
  var zktecoProducts = [];
  var asesorProducts = [];
  var catalogProducts = [];
  var referenciaMap = {};
  var catalogQuery = '';
  var catalogCategory = '';
  var editingFrom = '';
  var trmRate = 0;
  var pendingDeleteId = '';
  var quotesCache = [];
  var asesorQuotesCache = [];
  var openQuoteId = '';
  var openQuoteDetail = null;
  var quoteModalBound = false;

  var CATEGORY_LABELS = {
    control: 'Control de acceso',
    tarjetas: 'Lectores de Tarjetas',
    huella: 'Lectores de Huella Biométricos',
    consumibles: 'Consumibles',
    seguridad: 'Seguridad electrónica',
    camaras: 'Cámaras',
    grabadores: 'Grabadores',
    otros: 'Otros'
  };
  var CUSTOM_CATS_KEY = 'izc_zkteco_custom_categories';
  var customCategories = {};

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var hideTimers = {};

  function autoHideOk(el, type, baseClass) {
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      // setFlashMessage ya programa el clear; aquí solo si el texto ya está puesto
      IZCAuth.setFlashMessage(el, el.textContent, type, baseClass);
      return;
    }
    var key = el.id || baseClass || 'msg';
    if (hideTimers[key]) {
      window.clearTimeout(hideTimers[key]);
      hideTimers[key] = 0;
    }
    if (!String(el.textContent || '').trim()) return;
    hideTimers[key] = window.setTimeout(function () {
      hideTimers[key] = 0;
      if (!el) return;
      el.textContent = '';
      el.className = baseClass;
    }, 7000);
  }

  function setMessage(text, type) {
    var el = document.getElementById('zktecoMessage');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'auth-message');
      return;
    }
    el.textContent = text || '';
    el.className = 'auth-message' + (type ? ' is-' + type : '');
    autoHideOk(el, type, 'auth-message');
  }

  function parseMoney(value) {
    var n = Number(String(value == null ? '' : value).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) && n > 0 ? n : 0;
  }

  function formatUSD(n) {
    var v = Number(n || 0);
    if (!(v > 0)) return '—';
    return '$ ' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatCOP(n) {
    var v = Number(n || 0);
    if (!(v > 0)) return '—';
    return '$ ' + Math.round(v).toLocaleString('es-CO') + ' COP';
  }

  function getTrm() {
    if (trmRate > 0) return trmRate;
    try {
      var w = Number(window.__IZC_TRM__);
      if (isFinite(w) && w > 0) return w;
    } catch (e) { /* ignore */ }
    return 0;
  }

  function roundUsd(n) {
    if (window.IZCMoney && typeof IZCMoney.roundUsd === 'function') {
      return IZCMoney.roundUsd(n);
    }
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return 0;
    return Math.floor(v * 100 + 1e-9) / 100;
  }

  function roundCop(n) {
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return 0;
    return Math.round(v);
  }

  function loadTrm() {
    return fetch('data/trm.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var n = data && Number(data.value != null ? data.value : data.trm);
        if (isFinite(n) && n > 0) {
          trmRate = n;
          try { window.__IZC_TRM__ = n; } catch (e) { /* ignore */ }
        }
        return getTrm();
      })
      .catch(function () { return getTrm(); });
  }

  function syncPriceFrom(source) {
    var usdEl = document.getElementById('zktecoUsd');
    var copEl = document.getElementById('zktecoCop');
    if (!usdEl || !copEl) return;
    var trm = getTrm();
    if (!(trm > 0)) {
      loadTrm().then(function () {
        if (getTrm() > 0) syncPriceFrom(source);
        else setMessage('No hay TRM para convertir USD/COP.', 'error');
      });
      return;
    }
    if (source === 'usd') {
      var usd = Number(String(usdEl.value || '').replace(',', '.'));
      if (!isFinite(usd) || usd <= 0) {
        copEl.value = '';
        return;
      }
      copEl.value = String(roundCop(usd * trm));
      return;
    }
    var cop = Number(String(copEl.value || '').replace(',', '.'));
    if (!isFinite(cop) || cop <= 0) {
      usdEl.value = '';
      return;
    }
    usdEl.value = String(roundUsd(cop / trm));
  }

  function formatDate(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function postApi(payload) {
    var body = JSON.stringify(payload);
    var endpoints;
    if (window.IZCAuth && typeof IZCAuth.apiEndpoints === 'function') {
      endpoints = IZCAuth.apiEndpoints();
    } else {
      endpoints = ['http://127.0.0.1:8080/api/auth', 'api/auth.php'];
    }
    function tryOne(i) {
      if (i >= endpoints.length) {
        return Promise.resolve({ ok: false, error: 'No hay API (auth.php).' });
      }
      return fetch(endpoints[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        cache: 'no-store'
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = JSON.parse(String(text || '').replace(/^\uFEFF/, '').trim()); } catch (e) { data = null; }
          if (!data || typeof data !== 'object') return tryOne(i + 1);
          var err = String((data && data.error) || '').toLowerCase();
          try { err = err.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (eN) { /* ignore */ }
          if (!data.ok && err.indexOf('accion no valida') >= 0 && i + 1 < endpoints.length) {
            return tryOne(i + 1);
          }
          return data;
        });
      }).catch(function () { return tryOne(i + 1); });
    }
    return tryOne(0);
  }

  function actorPayload(extra) {
    var nit = (window.IZCAuth && IZCAuth.getSessionNit()) || '';
    var base = { zkteco_user: nit, admin_nit: nit, nit: nit };
    if (!extra) return base;
    Object.keys(extra).forEach(function (k) { base[k] = extra[k]; });
    return base;
  }

  function setActiveTab(tab) {
    activeTab = tab || 'catalogo';
    document.querySelectorAll('.admin-stat.is-tab').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-tab') === activeTab);
    });
    var catalogo = document.getElementById('zktecoPanelCatalogo');
    var creados = document.getElementById('zktecoPanelCreados');
    var crear = document.getElementById('zktecoPanelCrear');
    var editar = document.getElementById('zktecoPanelEditar');
    var asesor = document.getElementById('zktecoPanelAsesor');
    var historial = document.getElementById('zktecoPanelHistorial');
    var historialAsesores = document.getElementById('zktecoPanelHistorialAsesores');
    if (catalogo) catalogo.hidden = activeTab !== 'catalogo';
    if (creados) creados.hidden = activeTab !== 'creados';
    if (crear) crear.hidden = activeTab !== 'crear';
    if (editar) editar.hidden = activeTab !== 'editar';
    if (asesor) asesor.hidden = activeTab !== 'asesor';
    if (historial) historial.hidden = activeTab !== 'historial';
    if (historialAsesores) historialAsesores.hidden = activeTab !== 'historial-asesores';
    if (activeTab === 'catalogo') {
      loadZktecoProducts().then(function () { loadCatalogProducts(); });
    }
    if (activeTab === 'creados' || activeTab === 'crear') loadZktecoProducts();
    if (activeTab === 'asesor') loadAsesorProducts();
    if (activeTab === 'historial') loadZktecoQuotes();
    if (activeTab === 'historial-asesores') loadAsesorZktecoQuotes();
    if (activeTab === 'editar') {
      placeForm('editar');
      syncEditTab();
    } else if (activeTab === 'crear') {
      placeForm('crear');
      if (editingFrom === 'catalogo' || editingFrom === 'asesor') clearForm();
      if (editingFrom !== 'creados') {
        editingFrom = 'crear';
        var srcEl = document.getElementById('zktecoProductSource');
        if (srcEl) srcEl.value = 'created';
      }
    } else if (activeTab !== 'editar') {
      placeForm('crear');
    }
  }

  function currentEditSku() {
    var skuEl = document.getElementById('zktecoSku');
    var idEl = document.getElementById('zktecoProductId');
    var sku = skuEl ? String(skuEl.value || '').trim() : '';
    var id = idEl ? String(idEl.value || '').trim() : '';
    return sku || id;
  }

  function syncEditTab() {
    var editing = !!currentEditSku();
    var wrap = document.getElementById('zktecoEditFormWrap');
    var hint = document.getElementById('zktecoEditHint');
    if (wrap) wrap.hidden = !editing;
    if (hint) hint.hidden = editing;
  }

  function placeForm(where) {
    var form = document.getElementById('zktecoProductForm');
    var lead = document.getElementById('zktecoFormLead');
    var crear = document.getElementById('zktecoPanelCrear');
    var wrap = document.getElementById('zktecoEditFormWrap');
    if (!form) return;
    if (where === 'editar' && wrap) {
      wrap.hidden = false;
      if (lead) wrap.appendChild(lead);
      wrap.appendChild(form);
      return;
    }
    if (wrap) wrap.hidden = true;
    if (crear) {
      if (lead) crear.appendChild(lead);
      crear.appendChild(form);
    }
  }

  function categoryKey(p) {
    return String((p && (p.category || p.type)) || '').toLowerCase();
  }

  function categoryLabel(p) {
    var key = categoryKey(p);
    return CATEGORY_LABELS[key] || (key ? key.replace(/-/g, ' ') : '—');
  }

  function loadCustomCategories() {
    try {
      var raw = localStorage.getItem(CUSTOM_CATS_KEY);
      var data = raw ? JSON.parse(raw) : {};
      if (data && typeof data === 'object' && !Array.isArray(data)) customCategories = data;
    } catch (e) {
      customCategories = {};
    }
    Object.keys(customCategories).forEach(function (k) {
      if (customCategories[k]) CATEGORY_LABELS[k] = customCategories[k];
    });
  }

  function saveCustomCategories() {
    try { localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify(customCategories)); } catch (e) { /* ignore */ }
  }

  function slugCategory(label) {
    var s = String(label || '').trim().toLowerCase();
    try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* ignore */ }
    return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function hideCategoryAddInput() {
    var input = document.getElementById('zktecoCategoryNew');
    if (!input) return;
    input.value = '';
    input.hidden = true;
  }

  function addCustomCategory(label) {
    var name = String(label || '').trim();
    if (!name) return '';
    var key = slugCategory(name);
    if (!key) return '';
    CATEGORY_LABELS[key] = name;
    customCategories[key] = name;
    saveCustomCategories();
    fillFormCategoryOptions(key);
    hideCategoryAddInput();
    return key;
  }

  function oneLinePrice(text) {
    return String(text || '').replace(/\s+/g, ' ').replace(/ COP$/i, '\u00a0COP').trim();
  }

  function overlayForSku(sku) {
    var key = String(sku || '').trim().toUpperCase();
    if (!key) return null;
    var found = null;
    zktecoProducts.forEach(function (p) {
      if (p && String(p.sku || '').trim().toUpperCase() === key) found = p;
    });
    return found;
  }

  function isCatalogSku(sku) {
    var key = String(sku || '').trim().toUpperCase();
    if (!key) return false;
    var found = false;
    catalogProducts.forEach(function (p) {
      if (p && String(p.sku || '').trim().toUpperCase() === key) found = true;
    });
    return found;
  }

  function isCreatedOverlay(p) {
    return !!p && String(p.source || '').toLowerCase() === 'created';
  }

  function extraCreatedCatalogProducts() {
    var seen = {};
    catalogProducts.forEach(function (p) {
      var sku = String(p.sku || '').trim().toUpperCase();
      if (sku) seen[sku] = true;
    });
    var extra = [];
    zktecoProducts.forEach(function (p) {
      if (!isCreatedOverlay(p)) return;
      var sku = String(p.sku || '').trim().toUpperCase();
      if (!sku || seen[sku]) return;
      seen[sku] = true;
      extra.push({
        sku: p.sku,
        name: p.name,
        referencia: p.referencia || '',
        category: p.category || '',
        type: p.category || '',
        brand: 'zkteco',
        unitario_usd: p.unitario_usd,
        unitario_cop: p.unitario_cop
      });
    });
    return extra;
  }

  function allCatalogProducts() {
    return extraCreatedCatalogProducts().concat(catalogProducts);
  }

  function upsertOverlay(row) {
    if (!row) return;
    var id = String(row.id || '');
    var sku = String(row.sku || '').trim().toUpperCase();
    var idx = -1;
    zktecoProducts.forEach(function (p, i) {
      if (idx >= 0) return;
      if (id && String(p.id || '') === id) idx = i;
      else if (sku && String(p.sku || '').trim().toUpperCase() === sku) idx = i;
    });
    if (idx >= 0) zktecoProducts[idx] = row;
    else zktecoProducts.push(row);
  }

  function mergeCatalogProduct(p) {
    if (!p) return p;
    var o = overlayForSku(p.sku);
    var out = {};
    Object.keys(p).forEach(function (k) { out[k] = p[k]; });
    if (o) {
      if (o.name) out.name = o.name;
      if (o.referencia) out.referencia = o.referencia;
      if (o.category) {
        out.category = o.category;
        out.type = o.category;
      }
      if (Number(o.unitario_usd) > 0) out.unitario_usd = o.unitario_usd;
      if (Number(o.unitario_cop) > 0) out.unitario_cop = o.unitario_cop;
      out.overlayId = o.id;
    }
    if (!out.referencia) {
      var ref = productReferencia({ sku: p.sku });
      if (ref) out.referencia = ref;
    }
    return out;
  }

  function productReferencia(p) {
    var own = p && p.referencia ? String(p.referencia).trim() : '';
    if (own) return own;
    var sku = String((p && p.sku) || '').trim();
    if (sku && referenciaMap[sku]) return String(referenciaMap[sku]);
    return '';
  }

  function priceParts(p) {
    var usd = Number((p && p.unitario_usd) || 0);
    var cop = Number((p && p.unitario_cop) || 0);
    if (usd > 0 || cop > 0) return { usd: usd, cop: cop };
    if (!window.IZCPrices || typeof IZCPrices.get !== 'function') return { usd: 0, cop: 0 };
    var entry = IZCPrices.get(String((p && p.sku) || ''));
    if (entry == null) return { usd: 0, cop: 0 };
    if (typeof entry === 'number') {
      return { usd: entry > 0.1 ? entry : 0, cop: 0 };
    }
    if (typeof entry === 'object') {
      var currency = String(entry.currency || entry.c || 'USD').toUpperCase();
      var amount = Number(entry.amount != null ? entry.amount : entry.v);
      var pesos = Number(entry.pesos != null ? entry.pesos : entry.listCop);
      if (currency === 'COP' && amount > 0) return { usd: 0, cop: amount };
      return {
        usd: amount > 0.1 ? amount : 0,
        cop: pesos > 0 ? pesos : 0
      };
    }
    return { usd: 0, cop: 0 };
  }

  function catalogPrice(p) {
    var merged = mergeCatalogProduct(p);
    var parts = priceParts(merged);
    if (Number(merged.unitario_usd) > 0) return oneLinePrice(formatUSD(merged.unitario_usd));
    if (Number(merged.unitario_cop) > 0) return oneLinePrice(formatCOP(merged.unitario_cop));
    var sku = String((merged && merged.sku) || '');
    var name = String((merged && merged.name) || '');
    if (window.IZCPrices) {
      var entry = typeof IZCPrices.get === 'function' ? IZCPrices.get(sku) : null;
      var text = typeof IZCPrices.formatForProduct === 'function'
        ? IZCPrices.formatForProduct(entry, name)
        : (typeof IZCPrices.format === 'function' ? IZCPrices.format(entry) : '');
      return oneLinePrice(text || 'Sin stock');
    }
    if (parts.usd > 0) return oneLinePrice(formatUSD(parts.usd));
    if (parts.cop > 0) return oneLinePrice(formatCOP(parts.cop));
    return '—';
  }

  function categoryOptionsHtml(selected) {
    var keys = {};
    Object.keys(CATEGORY_LABELS).forEach(function (k) { keys[k] = true; });
    Object.keys(customCategories).forEach(function (k) { keys[k] = true; });
    catalogProducts.forEach(function (p) {
      var k = categoryKey(p);
      if (k) keys[k] = true;
    });
    zktecoProducts.forEach(function (p) {
      var k = String((p && p.category) || '').toLowerCase();
      if (k) keys[k] = true;
    });
    var list = Object.keys(keys).sort(function (a, b) {
      return categoryLabel({ category: a }).localeCompare(categoryLabel({ category: b }), 'es');
    });
    var sel = String(selected || '').toLowerCase();
    return '<option value="">Sin categoría</option>' + list.map(function (k) {
      return '<option value="' + escapeHtml(k) + '"' + (k === sel ? ' selected' : '') + '>' +
        escapeHtml(categoryLabel({ category: k })) + '</option>';
    }).join('');
  }

  function fillFormCategoryOptions(selected) {
    var sel = document.getElementById('zktecoCategory');
    if (!sel) return;
    sel.innerHTML = categoryOptionsHtml(selected);
    if (selected) sel.value = selected;
  }

  function fillCategoryFilter() {
    var sel = document.getElementById('zktecoCatalogCategory');
    if (!sel) return;
    var counts = {};
    allCatalogProducts().forEach(function (p) {
      var k = categoryKey(p);
      if (!k) return;
      counts[k] = (counts[k] || 0) + 1;
    });
    var keys = Object.keys(counts).sort(function (a, b) {
      return categoryLabel({ category: a }).localeCompare(categoryLabel({ category: b }), 'es');
    });
    var prev = catalogCategory || sel.value || '';
    sel.innerHTML = '<option value="">Todas las categorías</option>' + keys.map(function (k) {
      return '<option value="' + escapeHtml(k) + '">' +
        escapeHtml(categoryLabel({ category: k })) + ' (' + counts[k] + ')</option>';
    }).join('');
    if (prev && counts[prev]) {
      sel.value = prev;
      catalogCategory = prev;
    } else {
      sel.value = '';
      catalogCategory = '';
    }
  }

  function foldSearch(value) {
    var s = String(value == null ? '' : value).toLowerCase();
    try {
      s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) { /* ignore */ }
    return s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function queryTokens(value) {
    var folded = foldSearch(value);
    if (!folded) return [];
    return folded.split(' ').filter(Boolean);
  }

  function productMatchesQuery(p, tokens) {
    if (!tokens.length) return true;
    var hay = foldSearch([
      p.sku,
      p.name,
      p.nombre,
      p.referencia,
      p.subtype,
      categoryLabel(p)
    ].join(' '));
    var compact = hay.replace(/\s+/g, '');
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (hay.indexOf(token) < 0 && compact.indexOf(token) < 0) return false;
    }
    return true;
  }

  function filteredCatalog() {
    var tokens = queryTokens(catalogQuery);
    var cat = String(catalogCategory || '').toLowerCase();
    return allCatalogProducts().map(mergeCatalogProduct).filter(function (p) {
      if (cat && categoryKey(p) !== cat) return false;
      return productMatchesQuery(p, tokens);
    });
  }

  function renderCatalog() {
    var body = document.getElementById('zktecoCatalogoBody');
    var countEl = document.getElementById('zktecoCatalogoCount');
    var meta = document.getElementById('zktecoCatalogMeta');
    var all = allCatalogProducts();
    if (countEl) countEl.textContent = String(all.length);
    if (!body) return;
    var rows = filteredCatalog();
    if (meta) {
      if (!all.length) {
        meta.textContent = '';
      } else if (rows.length === all.length) {
        meta.textContent = all.length + ' productos';
      } else {
        meta.textContent = 'Mostrando ' + rows.length + ' de ' + all.length;
      }
    }
    if (!all.length) {
      body.innerHTML = '<tr><td colspan="6">No se encontraron productos de la marca ZKTeco.</td></tr>';
      return;
    }
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6">Ningún producto coincide con el filtro.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (p, idx) {
      var sku = String(p.sku || '');
      var href = 'producto.html?sku=' + encodeURIComponent(sku);
      var ref = productReferencia(p);
      return (
        '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><div><strong><a href="' + escapeHtml(href) + '">' + escapeHtml(p.name || '—') + '</a></strong></div>' +
          '<div class="admin-muted">SKU ' + escapeHtml(sku || '—') + '</div></td>' +
          '<td>' + escapeHtml(ref || '—') + '</td>' +
          '<td>' + escapeHtml(categoryLabel(p)) + '</td>' +
          '<td class="zkteco-price">' + escapeHtml(catalogPrice(p)) + '</td>' +
          '<td class="admin-actions">' +
            '<button type="button" class="admin-view-quote" data-catalog-edit="' + escapeHtml(sku) + '">Editar</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function loadJsonFile(path) {
    if (window.IZCData && typeof IZCData.loadJson === 'function') {
      return IZCData.loadJson(path, { cache: 'no-store' });
    }
    return fetch(path, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function loadCatalogProducts() {
    var pricesReady = (window.IZCPrices && typeof IZCPrices.load === 'function')
      ? IZCPrices.load()
      : Promise.resolve();
    return Promise.all([
      loadJsonFile('assets/files/catalogo.json').catch(function () {
        return loadJsonFile('assets/files/brand_products.json').then(function (bp) {
          return { products: (bp && bp.zkteco) || [] };
        });
      }),
      pricesReady,
      loadJsonFile('assets/files/referencias.json').catch(function () { return {}; })
    ]).then(function (results) {
      var catalog = results[0] || {};
      var refs = results[2];
      if (refs && typeof refs === 'object' && !Array.isArray(refs)) referenciaMap = refs;
      var list = Array.isArray(catalog.products) ? catalog.products : [];
      catalogProducts = list.filter(function (p) {
        return p && String(p.brand || '').toLowerCase() === 'zkteco';
      });
      if (!catalogProducts.length && Array.isArray(catalog.zkteco)) {
        catalogProducts = catalog.zkteco;
      }
      fillCategoryFilter();
      renderCatalog();
    }).catch(function () {
      catalogProducts = [];
      renderCatalog();
      setMessage('No se pudo cargar el catálogo ZKTeco.', 'error');
    });
  }

  function createdPrice(p) {
    var usd = Number((p && p.unitario_usd) || 0);
    var cop = Number((p && p.unitario_cop) || 0);
    if (usd > 0 && cop > 0) return oneLinePrice(formatUSD(usd) + '  ' + formatCOP(cop));
    if (usd > 0) return oneLinePrice(formatUSD(usd));
    if (cop > 0) return oneLinePrice(formatCOP(cop));
    return '—';
  }

  function renderZktecoList() {
    var createdOnly = zktecoProducts.filter(isCreatedOverlay);
    var body = document.getElementById('zktecoCreadosBody');
    var countEl = document.getElementById('zktecoCreadosCount');
    if (countEl) countEl.textContent = String(createdOnly.length);
    syncEditTab();
    if (body) {
      if (!createdOnly.length) {
        body.innerHTML = '<tr><td colspan="6">Aún no hay productos ZKTeco creados.</td></tr>';
      } else {
        body.innerHTML = createdOnly.map(function (p) {
          return (
            '<tr>' +
              '<td><div><strong>' + escapeHtml(p.name || '—') + '</strong></div>' +
              '<div class="admin-muted">SKU ' + escapeHtml(p.sku || '—') + '</div></td>' +
              '<td>' + escapeHtml(p.referencia || '—') + '</td>' +
              '<td>' + escapeHtml(categoryLabel(p)) + '</td>' +
              '<td class="zkteco-price">' + escapeHtml(createdPrice(p)) + '</td>' +
              '<td>' + escapeHtml(formatDate(p.created_at)) + '</td>' +
              '<td class="admin-actions">' +
                '<button type="button" class="admin-view-quote" data-edit="' + escapeHtml(p.id) + '">Editar</button> ' +
                '<button type="button" class="admin-modal-confirm" data-del="' + escapeHtml(p.id) + '">Eliminar</button>' +
              '</td>' +
            '</tr>'
          );
        }).join('');
      }
    }
  }

  function loadZktecoProducts() {
    return postApi(actorPayload({ action: 'list_productos_zkteco' })).then(function (data) {
      zktecoProducts = (data && data.ok && Array.isArray(data.products)) ? data.products : [];
      renderZktecoList();
      if (catalogProducts.length) {
        fillCategoryFilter();
        if (activeTab === 'catalogo') renderCatalog();
      }
      if (data && !data.ok) setMessage(data.error || 'No se pudieron cargar productos ZKTeco.', 'error');
    }).catch(function () {
      zktecoProducts = [];
      renderZktecoList();
      setMessage('No se pudo conectar con el servidor.', 'error');
    });
  }

  function renderAsesorProducts() {
    var body = document.getElementById('zktecoAsesorBody');
    var countEl = document.getElementById('zktecoAsesorCount');
    if (countEl) countEl.textContent = String(asesorProducts.length);
    if (!body) return;
    if (!asesorProducts.length) {
      body.innerHTML = '<tr><td colspan="7">Aún no hay productos ZKTeco creados por asesores.</td></tr>';
      return;
    }
    body.innerHTML = asesorProducts.map(function (p, idx) {
      var usd = Number(p.unitario_usd || p.unitarioUsd || p.usd || 0);
      var cop = Number(p.unitario_cop || p.unitarioCop || p.cop || 0);
      var price = usd > 0 ? formatUSD(usd) : formatCOP(cop);
      var seller = String(p.seller_codigo || '').trim();
      var sellerName = String(p.seller_name || '').trim();
      var sellerLabel = seller ? (sellerName ? seller + ' — ' + sellerName : seller) : (sellerName || '—');
      var editKey = p.id || p.sku || '';
      return (
        '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><div><strong>' + escapeHtml(p.name || '—') + '</strong></div>' +
          '<div class="admin-muted">SKU ' + escapeHtml(p.sku || '—') + '</div></td>' +
          '<td>' + escapeHtml(p.referencia || '—') + '</td>' +
          '<td>' + escapeHtml(price) + '</td>' +
          '<td>' + escapeHtml(sellerLabel) + '</td>' +
          '<td>' + escapeHtml(formatDate(p.created_at)) + '</td>' +
          '<td class="admin-actions">' +
            '<button type="button" class="admin-view-quote" data-asesor-edit="' + escapeHtml(editKey) + '">Editar</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function formatDateOnly(value) {
    if (!value) return '—';
    var raw = String(value).trim();
    var d = null;
    var mIso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mIso) {
      d = new Date(Number(mIso[1]), Number(mIso[2]) - 1, Number(mIso[3]));
    } else {
      d = new Date(raw);
    }
    if (!d || isNaN(d.getTime())) return raw;
    var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return d.getDate() + ', ' + meses[d.getMonth()] + ', ' + d.getFullYear();
  }

  function quoteEstado(q) {
    var e = String((q && (q.asesor_estado || q.estado)) || '').trim().toLowerCase();
    if (e === 'nueva' || e === 'nuevo' || e === 'new') return 'nueva';
    if (e === 'pendiente' || e === 'pending') return 'pendiente';
    if (e === 'seguimiento' || e === 'follow' || e === 'followup') return 'seguimiento';
    if (e === 'vendido' || e === 'venta' || e === 'sold') return 'vendido';
    if (e === 'perdida' || e === 'perdido' || e === 'lost') return 'perdida';
    if (e === 'cerrado_modificado' || e === 'cerrado-modificado' || e === 'cerradomodificado') {
      return 'cerrado_modificado';
    }
    return 'cotizado';
  }

  function quoteEstadoLabel(estado) {
    if (estado === 'nueva') return 'Nueva';
    if (estado === 'pendiente') return 'Pendiente';
    if (estado === 'seguimiento') return 'Seguimiento';
    if (estado === 'vendido') return 'Vendido';
    if (estado === 'perdida') return 'Perdida';
    if (estado === 'cerrado_modificado') return 'Cerrado Modificado';
    return 'Cotizado';
  }

  function estadoBadgeHtml(q) {
    var estado = quoteEstado(q);
    return '<span class="quote-estado-badge is-' + estado + '">' + escapeHtml(quoteEstadoLabel(estado)) + '</span>';
  }

  function quoteTotalLabel(q) {
    if (!q) return '—';
    if (q.total_display) return String(q.total_display);
    var parts = [];
    var usd = Number(q.total_usd != null ? q.total_usd : ((q.totals && (q.totals.usdIva || q.totals.usd)) || 0));
    var cop = Number(q.total_cop != null ? q.total_cop : ((q.totals && (q.totals.copIva || q.totals.cop)) || 0));
    if (usd > 0) parts.push(formatUSD(usd));
    if (cop > 0) parts.push(formatCOP(cop));
    return parts.length ? parts.join('  ') : '—';
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
    if (name && code && name.toUpperCase() !== code.toUpperCase()) return code + ' · ' + name;
    return name || code || '—';
  }

  function renderZktecoQuotes() {
    var body = document.getElementById('zktecoHistorialBody');
    var countEl = document.getElementById('zktecoHistorialCount');
    if (countEl) countEl.textContent = String(quotesCache.length);
    if (!body) return;
    if (!quotesCache.length) {
      body.innerHTML = '<tr><td colspan="7">Aún no hay cotizaciones de Admin ZKTECO.</td></tr>';
      return;
    }
    body.innerHTML = quotesCache.map(function (q) {
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
            '<button type="button" class="admin-view-quote" data-quote-id="' + escapeHtml(id) + '">Ver</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderAsesorZktecoQuotes() {
    var body = document.getElementById('zktecoHistorialAsesoresBody');
    var countEl = document.getElementById('zktecoHistorialAsesoresCount');
    var table = document.getElementById('zktecoHistorialAsesoresTable');
    if (table) {
      var headRow = table.querySelector('thead tr');
      if (headRow) {
        headRow.innerHTML =
          '<th>Estado</th><th>Fecha</th><th>Vendedor</th><th>Cliente</th>' +
          '<th>NIT</th><th>Productos</th><th>Total</th><th></th>';
      }
    }
    if (countEl) countEl.textContent = String(asesorQuotesCache.length);
    if (!body) return;
    if (!asesorQuotesCache.length) {
      body.innerHTML = '<tr><td colspan="8">Aún no hay cotizaciones ZKTeco hechas por asesores.</td></tr>';
      return;
    }
    body.innerHTML = asesorQuotesCache.map(function (q) {
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
            '<button type="button" class="admin-view-quote" data-quote-id="' + escapeHtml(id) + '" data-quote-scope="asesores">Ver</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function formatCOPDec(n) {
    var v = Number(n || 0);
    if (!isFinite(v)) v = 0;
    return '$ ' + v.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' COP';
  }

  function quoteItemsList(quote) {
    if (!quote) return [];
    if (Array.isArray(quote.items)) return quote.items.filter(Boolean);
    return [];
  }

  function sellerCodigoOf(quote) {
    var code = String((quote && (quote.seller_codigo || quote.vendedor_codigo)) || '').trim();
    if (code && !/^(ZKTECO|ZEBRA)$/i.test(code)) return code;
    var label = sellerLabel(quote);
    var m = String(label).match(/\bV\d+\b/i);
    if (m) return m[0].toUpperCase();
    return code || 'ZKTECO';
  }

  function quotePreview(quote) {
    if (!quote || typeof quote !== 'object') return quote;
    if (quoteItemsList(quote).length) return quote;
    var totals = quote.totals || {};
    var usd = Number(quote.total_usd != null ? quote.total_usd : (totals.usdIva || totals.usd || 0));
    var cop = Number(quote.total_cop != null ? quote.total_cop : (totals.copIva || totals.cop || totals.totalConFlete || 0));
    if (!(usd > 0) && !(cop > 0)) return quote;
    var line = {
      sku: '',
      name: 'Productos cotizados',
      referencia: quote.bitrix_deal_id ? ('Bitrix #' + quote.bitrix_deal_id) : '',
      qty: Number(quote.product_count || quote.items_count || 1) || 1,
      usdIva: usd,
      copIva: cop
    };
    return Object.assign({}, quote, { items: [line] });
  }

  function quoteDetailLines(quote) {
    var q = quotePreview(quote) || {};
    var items = quoteItemsList(q);
    var trm = Number(q.trm || getTrm() || 0);
    return items.map(function (it) {
      var qty = Number(it.qty || it.cantidad || 1) || 1;
      var usdIva = Number(it.usdIva || it.unitarioUsd || it.usd || 0);
      var copIva = Number(it.copIva || it.unitarioCopIva || it.pvCopIva || it.unitarioCop || it.cop || 0);
      if (!(copIva > 0) && usdIva > 0 && trm > 0) copIva = usdIva * trm;
      var unitCop = Number(it.cop || it.unitarioCop || it.unitario_cop || 0);
      if (!(unitCop > 0) && copIva > 0) unitCop = copIva / 1.19;
      var totalCopIva = Number(it.totalCopIva || it.total_cop || 0);
      if (!(totalCopIva > 0)) totalCopIva = copIva * qty;
      var totalSinIva = Number(it.totalCop || it.total_cop_sin_iva || 0);
      if (!(totalSinIva > 0)) totalSinIva = unitCop * qty;
      return {
        sku: String(it.sku || ''),
        referencia: String(it.referencia || it.ref || ''),
        name: String(it.name || it.nombre || it.sku || '—'),
        qty: qty,
        unitCop: unitCop,
        unitCopIva: copIva,
        totalCopSinIva: totalSinIva,
        totalPayable: totalCopIva,
        ivaExempt: !!(it.ivaExempt || it.exento_iva)
      };
    });
  }

  function liquidacionHtml(quote) {
    var q = quotePreview(quote) || {};
    var lines = quoteDetailLines(q);
    var totals = q.totals || {};
    var trm = Number(q.trm || getTrm() || 0);
    var rows = lines.map(function (line) {
      var totalCell = escapeHtml(formatCOPDec(line.totalPayable)) +
        (line.ivaExempt
          ? ' <span class="admin-quote-iva-tag">Exento IVA</span>'
          : ' <span class="admin-quote-iva-tag">Con IVA</span>');
      return (
        '<tr>' +
          '<td>' + escapeHtml(line.sku) + '</td>' +
          '<td>' + escapeHtml(line.referencia || '—') + '</td>' +
          '<td>' + escapeHtml(line.name) + '</td>' +
          '<td>' + line.qty + '</td>' +
          '<td class="admin-quote-money">' + escapeHtml(formatCOPDec(line.unitCop)) + '</td>' +
          '<td class="admin-quote-money">' + escapeHtml(formatCOPDec(line.unitCopIva)) + '</td>' +
          '<td class="admin-quote-money">' + escapeHtml(formatCOPDec(line.totalCopSinIva)) + '</td>' +
          '<td class="admin-quote-money">' + totalCell + '</td>' +
        '</tr>'
      );
    }).join('');
    var subtotal = Number(totals.copIva || totals.cop || 0);
    if (!(subtotal > 0)) {
      subtotal = lines.reduce(function (acc, line) { return acc + Number(line.totalPayable || 0); }, 0);
    }
    var totalPagar = Number(totals.totalConFlete || subtotal || 0);
    var usdEquiv = Number(totals.usdIva || totals.usd || q.total_usd || 0);
    if (!(usdEquiv > 0) && totalPagar > 0 && trm > 0) usdEquiv = totalPagar / trm;
    var comment = String(q.asesor_comentario || '').trim();
    return (
      '<table class="admin-quote-detail-table admin-quote-detail-table-cop">' +
        '<thead><tr>' +
          '<th>SKU</th><th>Referencia</th><th>Producto</th><th>Cant.</th>' +
          '<th>Prc. unitario</th><th>P.V. COP + IVA</th>' +
          '<th>Total COP sin IVA</th><th>Total</th>' +
        '</tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="8">Sin productos</td></tr>') + '</tbody>' +
      '</table>' +
      '<div class="admin-quote-liquidacion">' +
        '<div class="admin-quote-liquidacion-head">' +
          '<h4>Liquidación COP</h4>' +
          '<p class="admin-quote-liquidacion-trm">' + escapeHtml(trm > 0 ? ('TRM ' + trm.toLocaleString('es-CO', { maximumFractionDigits: 2 })) : 'TRM —') + '</p>' +
        '</div>' +
        '<dl class="admin-quote-liquidacion-rows">' +
          '<div><dt>Subtotal productos</dt><dd>' + escapeHtml(formatCOPDec(subtotal)) + '</dd></div>' +
          '<div class="is-total"><dt>TOTAL A PAGAR</dt><dd>' + escapeHtml(formatCOPDec(totalPagar)) + '</dd></div>' +
          '<div><dt>Equivalente USD</dt><dd>' + escapeHtml(formatUSD(usdEquiv)) + '</dd></div>' +
        '</dl>' +
      '</div>' +
      (comment
        ? ('<p class="admin-quote-comment"><strong>Comentario:</strong> ' + escapeHtml(comment) + '</p>')
        : '')
    );
  }

  function quoteModalMarkup() {
    return (
      '<div class="admin-modal-backdrop" data-quote-modal-close></div>' +
      '<div class="admin-modal-dialog admin-modal-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="zktecoQuoteModalTitle">' +
        '<h3 id="zktecoQuoteModalTitle">Detalle de cotización</h3>' +
        '<p id="zktecoQuoteModalMeta" class="admin-quote-meta"></p>' +
        '<div class="admin-quote-detail-wrap" id="zktecoQuoteModalBody"></div>' +
        '<div class="admin-modal-actions">' +
          '<button type="button" class="admin-modal-cancel" data-quote-modal-close>Cerrar</button>' +
        '</div>' +
      '</div>'
    );
  }

  function ensureQuoteModal() {
    var modal = document.getElementById('zktecoQuoteModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'zktecoQuoteModal';
      modal.className = 'admin-modal';
      modal.hidden = true;
      modal.innerHTML = quoteModalMarkup();
      document.body.appendChild(modal);
    } else if (!document.getElementById('zktecoQuoteModalBody')) {
      modal.className = 'admin-modal';
      modal.innerHTML = quoteModalMarkup();
    } else {
      var pdfBtns = modal.querySelectorAll('.admin-quote-pdf');
      for (var i = 0; i < pdfBtns.length; i++) {
        if (pdfBtns[i].parentNode) pdfBtns[i].parentNode.removeChild(pdfBtns[i]);
      }
    }
    return modal;
  }

  function closeQuoteModal() {
    var modal = document.getElementById('zktecoQuoteModal');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('hidden', '');
    modal.style.display = 'none';
    openQuoteId = '';
    openQuoteDetail = null;
  }

  function openQuoteModal() {
    var modal = ensureQuoteModal();
    modal.hidden = false;
    modal.removeAttribute('hidden');
    modal.style.display = 'flex';
    modal.style.zIndex = '5000';
  }

  function setQuoteMeta(quote, scope) {
    var title = document.getElementById('zktecoQuoteModalTitle');
    var meta = document.getElementById('zktecoQuoteModalMeta');
    if (title) {
      title.textContent = 'Detalle de cotización' + (quote && quote.nombre ? (' · ' + quote.nombre) : '');
    }
    if (!meta) return;
    if (!quote) {
      meta.textContent = '';
      return;
    }
    var parts = [];
    parts.push(quoteEstadoLabel(quoteEstado(quote)));
    parts.push(formatDateOnly(quote.created_at));
    if (scope === 'asesores') parts.push(sellerLabel(quote));
    parts.push((quote.nombre || '—') + ' · NIT ' + (quote.nit || ''));
    if (quote.bitrix_deal_id) parts.push('Bitrix #' + quote.bitrix_deal_id);
    meta.textContent = parts.join(' · ');
  }

  function renderQuoteDetail(quote, scope) {
    ensureQuoteModal();
    var box = document.getElementById('zktecoQuoteModalBody');
    if (!box) return;
    if (!quote) {
      box.innerHTML = '<p class="admin-muted">No se pudo cargar el detalle.</p>';
      return;
    }
    openQuoteDetail = quote;
    setQuoteMeta(quote, scope);
    box.innerHTML = liquidacionHtml(quote);
  }

  function findCachedQuote(id) {
    var found = null;
    quotesCache.forEach(function (q) {
      if (q && String(q.id) === String(id)) found = q;
    });
    if (found) return found;
    asesorQuotesCache.forEach(function (q) {
      if (q && String(q.id) === String(id)) found = q;
    });
    return found;
  }

  function fetchZktecoQuoteFull(id, cached) {
    var seller = sellerCodigoOf(cached) || 'ZKTECO';
    return postApi(actorPayload({
      action: 'get_quote_zkteco',
      quote_id: id,
      asesor_codigo: 'ZKTECO'
    })).then(function (data) {
      if (data && data.ok && data.quote) return data.quote;
      return postApi(actorPayload({
        action: 'get_quote_asesor',
        quote_id: id,
        asesor_codigo: seller,
        nit_asesor: seller
      })).then(function (data2) {
        if (data2 && data2.ok && data2.quote) return data2.quote;
        return cached || null;
      });
    }).catch(function () {
      return cached || null;
    });
  }

  function openZktecoQuote(id, scope) {
    scope = scope === 'asesores' ? 'asesores' : 'zkteco';
    id = String(id || '').trim();
    if (!id) return;
    openQuoteId = id;
    ensureQuoteModal();
    var found = findCachedQuote(id);
    var title = document.getElementById('zktecoQuoteModalTitle');
    var box = document.getElementById('zktecoQuoteModalBody');
    if (title) title.textContent = 'Detalle de cotización';
    if (found) {
      renderQuoteDetail(quotePreview(found), scope);
    } else if (box) {
      setQuoteMeta(null, scope);
      box.innerHTML = '<p class="admin-muted">Cargando detalle…</p>';
    }
    openQuoteModal();
    fetchZktecoQuoteFull(id, found).then(function (full) {
      if (String(openQuoteId) !== String(id)) return;
      if (full) {
        renderQuoteDetail(full, scope);
        return;
      }
      if (found) {
        renderQuoteDetail(quotePreview(found), scope);
        return;
      }
      if (box) box.innerHTML = '<p class="admin-muted">No se pudo abrir la cotización.</p>';
    }).catch(function () {
      if (String(openQuoteId) !== String(id)) return;
      if (found) renderQuoteDetail(quotePreview(found), scope);
      else if (box) box.innerHTML = '<p class="admin-muted">No se pudo abrir la cotización.</p>';
    });
  }

  function loadZktecoQuotes() {
    return postApi(actorPayload({
      action: 'list_quotes_zkteco',
      asesor_codigo: 'ZKTECO',
      fast: 1,
      list_only: 1
    })).then(function (data) {
      quotesCache = (data && data.ok && Array.isArray(data.quotes)) ? data.quotes : [];
      quotesCache.sort(function (a, b) {
        var ta = String((a && a.created_at) || '');
        var tb = String((b && b.created_at) || '');
        return tb.localeCompare(ta);
      });
      renderZktecoQuotes();
      if (data && !data.ok && activeTab === 'historial') {
        var err = String(data.error || '');
        try { err = err.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (eN) { /* ignore */ }
        if (err.toLowerCase().indexOf('accion no valida') < 0) {
          setMessage(data.error || 'No se pudieron cargar las cotizaciones.', 'error');
        }
      }
    }).catch(function () {
      quotesCache = [];
      renderZktecoQuotes();
    });
  }

  function loadAsesorZktecoQuotes() {
    return postApi(actorPayload({
      action: 'list_quotes_zkteco_asesores',
      asesor_codigo: 'ZKTECO',
      fast: 1,
      list_only: 1
    })).then(function (data) {
      asesorQuotesCache = (data && data.ok && Array.isArray(data.quotes)) ? data.quotes : [];
      asesorQuotesCache.sort(function (a, b) {
        var ta = String((a && a.created_at) || '');
        var tb = String((b && b.created_at) || '');
        return tb.localeCompare(ta);
      });
      renderAsesorZktecoQuotes();
      if (data && !data.ok && activeTab === 'historial-asesores') {
        var err = String(data.error || '');
        try { err = err.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (eN) { /* ignore */ }
        if (err.toLowerCase().indexOf('accion no valida') < 0) {
          setMessage(data.error || 'No se pudieron cargar las cotizaciones de asesores.', 'error');
        }
      }
    }).catch(function () {
      asesorQuotesCache = [];
      renderAsesorZktecoQuotes();
    });
  }

  function productLooksZkteco(p) {
    if (!p) return false;
    var sku = String(p.sku || p.codigo || '').replace(/[\s.\-]/g, '').toUpperCase();
    if (sku && window.IZCZktecoOverlay && typeof IZCZktecoOverlay.get === 'function' && IZCZktecoOverlay.get(sku)) {
      return true;
    }
    if (sku && /^ZK/.test(sku)) return true;
    var blob = [
      p.brand, p.brandName, p.marca, p.name, p.nombre, p.referencia, p.sku
    ].join(' ').toLowerCase();
    if (blob.indexOf('zkteco') >= 0) return true;
    if (/\bzkt\b/.test(blob)) return true;
    var found = false;
    catalogProducts.forEach(function (c) {
      if (found || !c) return;
      var csku = String(c.sku || '').replace(/[\s.\-]/g, '').toUpperCase();
      if (csku && sku && csku === sku) found = true;
    });
    return found;
  }

  function loadAsesorProducts() {
    return postApi(actorPayload({ action: 'list_productos_creados' })).then(function (data) {
      asesorProducts = (data && data.ok && Array.isArray(data.products)) ? data.products.filter(function (p) {
        return p && !p.adopted_at && !p.adopted_by && productLooksZkteco(p);
      }) : [];
      renderAsesorProducts();
      if (data && !data.ok) setMessage(data.error || 'No se pudieron cargar productos de asesores.', 'error');
    }).catch(function () {
      asesorProducts = [];
      renderAsesorProducts();
    });
  }

  function fillForm(p) {
    fillFormCategoryOptions(p && p.category ? p.category : '');
    document.getElementById('zktecoProductId').value = p && p.id ? p.id : '';
    document.getElementById('zktecoSku').value = p && p.sku ? p.sku : '';
    document.getElementById('zktecoName').value = p && p.name ? p.name : '';
    document.getElementById('zktecoRef').value = p && p.referencia ? p.referencia : '';
    var catEl = document.getElementById('zktecoCategory');
    if (catEl) catEl.value = p && p.category ? p.category : '';
    var srcEl = document.getElementById('zktecoProductSource');
    if (srcEl) srcEl.value = p && p.source ? p.source : (activeTab === 'crear' ? 'created' : '');
    var asEl = document.getElementById('zktecoAsesorId');
    if (asEl) asEl.value = p && p.asesor_id ? p.asesor_id : '';
    var parts = priceParts(p || {});
    var usdEl = document.getElementById('zktecoUsd');
    var copEl = document.getElementById('zktecoCop');
    if (usdEl) usdEl.value = parts.usd > 0 ? (Math.round(parts.usd * 100) / 100) : '';
    if (copEl) copEl.value = parts.cop > 0 ? Math.round(parts.cop) : '';
    var lead = document.getElementById('zktecoFormLead');
    var btn = document.getElementById('zktecoSaveBtn');
    if (p && (p.id || p.sku)) {
      if (lead) lead.textContent = 'Editando producto ZKTeco ' + (p.sku || '');
      if (btn) btn.textContent = 'Guardar cambios';
    } else {
      if (lead) lead.textContent = 'Completa los datos para crear un producto ZKTeco.';
      if (btn) btn.textContent = 'Guardar producto';
    }
    syncEditTab();
  }

  function startEditCatalog(sku) {
    var found = null;
    allCatalogProducts().forEach(function (p) {
      if (p && String(p.sku || '') === String(sku || '')) found = p;
    });
    var merged = mergeCatalogProduct(found || { sku: sku });
    var overlay = overlayForSku(sku);
    var parts = priceParts(merged);
    fillForm({
      id: overlay && overlay.id ? overlay.id : '',
      sku: merged.sku || sku,
      name: merged.name || '',
      referencia: productReferencia(merged) || '',
      category: categoryKey(merged),
      source: (overlay && isCreatedOverlay(overlay)) ? 'created' : 'catalog',
      unitario_usd: parts.usd,
      unitario_cop: parts.cop
    });
    editingFrom = 'catalogo';
    setActiveTab('editar');
  }

  function startEditAsesor(id) {
    var found = null;
    var key = String(id || '');
    asesorProducts.forEach(function (p) {
      if (!p) return;
      if (String(p.id || '') === key || String(p.sku || '') === key) found = p;
    });
    if (!found) return;
    var overlay = overlayForSku(found.sku);
    var usd = Number(found.unitario_usd || found.unitarioUsd || found.usd || 0);
    var cop = Number(found.unitario_cop || found.unitarioCop || found.cop || 0);
    fillForm({
      id: overlay && overlay.id ? overlay.id : '',
      sku: found.sku || '',
      name: found.name || '',
      referencia: found.referencia || '',
      category: (overlay && overlay.category) || found.category || '',
      source: 'created',
      asesor_id: found.id || '',
      unitario_usd: usd,
      unitario_cop: cop
    });
    editingFrom = 'asesor';
    setActiveTab('editar');
  }

  function clearForm() {
    fillForm(null);
  }

  function closeDeleteModal() {
    pendingDeleteId = '';
    var modal = document.getElementById('zktecoDeleteModal');
    if (modal) modal.hidden = true;
  }

  function openDeleteModal(id, name) {
    pendingDeleteId = String(id || '');
    var modal = document.getElementById('zktecoDeleteModal');
    var text = document.getElementById('zktecoDeleteText');
    if (text) {
      var label = String(name || '').trim();
      text.textContent = label
        ? '¿Seguro que quieres eliminar «' + label + '»?'
        : '¿Seguro que quieres eliminar este producto ZKTeco?';
    }
    if (modal) modal.hidden = false;
  }

  function confirmDeleteProduct() {
    var delId = pendingDeleteId;
    if (!delId) {
      closeDeleteModal();
      return;
    }
    closeDeleteModal();
    postApi(actorPayload({ action: 'delete_producto_zkteco', id: delId })).then(function (data) {
      if (!data || !data.ok) {
        setMessage((data && data.error) || 'No se pudo eliminar.', 'error');
        return;
      }
      setMessage(data.message || 'Eliminado.', 'ok');
      if (document.getElementById('zktecoProductId') &&
          document.getElementById('zktecoProductId').value === delId) {
        editingFrom = '';
        clearForm();
      }
      loadZktecoProducts().then(function () {
        if (activeTab === 'catalogo') loadCatalogProducts();
      });
    }).catch(function () {
      setMessage('No se pudo eliminar.', 'error');
    });
  }

  function bind() {
    ensureQuoteModal();
    document.querySelectorAll('.admin-stat.is-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setActiveTab(btn.getAttribute('data-tab') || 'catalogo');
      });
    });
    var search = document.getElementById('zktecoCatalogSearch');
    if (search) {
      var onCatalogSearch = function () {
        catalogQuery = search.value || '';
        renderCatalog();
      };
      search.addEventListener('input', onCatalogSearch);
      search.addEventListener('search', onCatalogSearch);
    }
    var catSel = document.getElementById('zktecoCatalogCategory');
    if (catSel) {
      catSel.addEventListener('change', function () {
        catalogCategory = catSel.value || '';
        renderCatalog();
      });
    }
    var addCatBtn = document.getElementById('zktecoCategoryAdd');
    var addCatInput = document.getElementById('zktecoCategoryNew');
    if (addCatBtn && addCatInput) {
      addCatBtn.addEventListener('click', function () {
        addCatInput.hidden = false;
        addCatInput.focus();
      });
      addCatInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          addCustomCategory(addCatInput.value);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          hideCategoryAddInput();
        }
      });
      addCatInput.addEventListener('blur', function () {
        if (String(addCatInput.value || '').trim()) addCustomCategory(addCatInput.value);
        else hideCategoryAddInput();
      });
    }
    var form = document.getElementById('zktecoProductForm');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var product = {
          id: document.getElementById('zktecoProductId').value,
          sku: document.getElementById('zktecoSku').value,
          name: document.getElementById('zktecoName').value,
          referencia: document.getElementById('zktecoRef').value,
          category: document.getElementById('zktecoCategory') ? document.getElementById('zktecoCategory').value : '',
          source: document.getElementById('zktecoProductSource') ? document.getElementById('zktecoProductSource').value : '',
          unitario_usd: parseMoney(document.getElementById('zktecoUsd').value),
          unitario_cop: parseMoney(document.getElementById('zktecoCop').value)
        };
        var fromAsesor = editingFrom === 'asesor';
        var fromCatalog = !fromAsesor && product.source !== 'created' &&
          (editingFrom === 'catalogo' || product.source === 'catalog');
        if (fromAsesor) product.source = 'created';
        else if (fromCatalog) product.source = 'catalog';
        else product.source = 'created';
        var asesorId = document.getElementById('zktecoAsesorId')
          ? document.getElementById('zktecoAsesorId').value
          : '';
        setMessage('Guardando…', '');
        postApi(actorPayload({ action: 'save_producto_zkteco', product: product, id: product.id })).then(function (data) {
          if (!data || !data.ok) {
            setMessage((data && data.error) || 'No se pudo guardar.', 'error');
            return;
          }
          if (data.product) upsertOverlay(data.product);
          else upsertOverlay(product);
          if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.load === 'function') {
            IZCZktecoOverlay.load(true).then(function () {
              if (window.IZCPrices && typeof IZCPrices.apply === 'function') IZCPrices.apply();
            });
          }
          function finish(msg, type) {
            setMessage(msg, type || 'ok');
            editingFrom = '';
            clearForm();
            placeForm('crear');
            renderZktecoList();
            var next = loadZktecoProducts().then(function () { return loadCatalogProducts(); });
            if (fromAsesor) {
              next = next.then(function () { return loadAsesorProducts(); });
            }
            return next.then(function () {
              setActiveTab('catalogo');
            });
          }
          if (fromAsesor) {
            return postApi(actorPayload({
              action: 'adopt_producto_creado_asesor',
              id: asesorId,
              sku: product.sku
            })).then(function (adoptData) {
              if (!adoptData || !adoptData.ok) {
                return finish((adoptData && adoptData.error) ||
                  'Se guardó en ZKTeco, pero sigue en Producto creado asesor.', 'error');
              }
              return finish('Producto movido a Productos ZKTECO y Productos creados.');
            });
          }
          return finish(fromCatalog ? 'Cambios aplicados en Productos ZKTECO.' : (data.message || 'Guardado.'));
        }).catch(function () {
          setMessage('No se pudo guardar.', 'error');
        });
      });
    }
    var usdEl = document.getElementById('zktecoUsd');
    var copEl = document.getElementById('zktecoCop');
    if (usdEl) {
      usdEl.addEventListener('input', function () { syncPriceFrom('usd'); });
      usdEl.addEventListener('change', function () { syncPriceFrom('usd'); });
    }
    if (copEl) {
      copEl.addEventListener('input', function () { syncPriceFrom('cop'); });
      copEl.addEventListener('change', function () { syncPriceFrom('cop'); });
    }
    var catalogBody = document.getElementById('zktecoCatalogoBody');
    if (catalogBody) {
      catalogBody.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.getAttribute) return;
        var sku = t.getAttribute('data-catalog-edit');
        if (!sku) return;
        ev.preventDefault();
        startEditCatalog(sku);
      });
    }
    var asesorBody = document.getElementById('zktecoAsesorBody');
    if (asesorBody) {
      asesorBody.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.getAttribute) return;
        var asesorEdit = t.getAttribute('data-asesor-edit');
        if (!asesorEdit) return;
        ev.preventDefault();
        startEditAsesor(asesorEdit);
      });
    }
    if (!quoteModalBound) {
      quoteModalBound = true;
      document.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        if (t.closest('#zktecoQuoteModal [data-quote-modal-close]')) {
          closeQuoteModal();
          return;
        }
        var btn = t.closest('.admin-view-quote');
        if (!btn) return;
        var quoteId = btn.getAttribute('data-quote-id');
        if (!quoteId) return;
        ev.preventDefault();
        openZktecoQuote(quoteId, btn.getAttribute('data-quote-scope') === 'asesores' ? 'asesores' : 'zkteco');
      });
    }
    var creadosBody = document.getElementById('zktecoCreadosBody');
    if (creadosBody) {
      creadosBody.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.getAttribute) return;
        var editId = t.getAttribute('data-edit');
        var delId = t.getAttribute('data-del');
        if (editId) {
          var found = null;
          zktecoProducts.forEach(function (p) { if (p && p.id === editId) found = p; });
          fillForm(found || { id: editId, source: found && found.source });
          editingFrom = 'creados';
          setActiveTab('editar');
          return;
        }
        if (delId) {
          var foundDel = null;
          zktecoProducts.forEach(function (p) { if (p && p.id === delId) foundDel = p; });
          openDeleteModal(delId, foundDel && foundDel.name);
          return;
        }
      });
    }
    var deleteModal = document.getElementById('zktecoDeleteModal');
    if (deleteModal) {
      deleteModal.addEventListener('click', function (ev) {
        var t = ev.target;
        if (t && t.getAttribute && t.getAttribute('data-modal-close') != null) closeDeleteModal();
      });
    }
    var deleteCancel = document.getElementById('zktecoDeleteCancel');
    if (deleteCancel) deleteCancel.addEventListener('click', closeDeleteModal);
    var deleteConfirm = document.getElementById('zktecoDeleteConfirm');
    if (deleteConfirm) deleteConfirm.addEventListener('click', confirmDeleteProduct);
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      var modal = document.getElementById('zktecoDeleteModal');
      if (modal && !modal.hidden) closeDeleteModal();
      var quoteModal = document.getElementById('zktecoQuoteModal');
      if (quoteModal && !quoteModal.hidden) closeQuoteModal();
    });
    var nameToggle = document.getElementById('zktecoNombreToggle');
    if (nameToggle) {
      nameToggle.addEventListener('click', function () {
        if (isEditingNombre()) saveZktecoNombre();
        else startEditNombre();
      });
    }
    var nameInput = document.getElementById('zktecoNombreInput');
    if (nameInput) {
      nameInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          saveZktecoNombre();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          cancelEditNombre();
        }
      });
    }
    var logout = document.getElementById('profileLogout');
    if (logout && window.IZCAuth && typeof IZCAuth.logout === 'function') {
      logout.addEventListener('click', function () {
        IZCAuth.logout({ redirect: 'login.html' });
      });
    }
  }

  function fillProfile() {
    var nit = (window.IZCAuth && IZCAuth.getSessionNit()) || '';
    var nombre = (window.IZCAuth && IZCAuth.getSessionNombre && IZCAuth.getSessionNombre()) || '';
    var greet = document.getElementById('profileGreeting');
    if (!nit) {
      window.location.replace('login.html');
      return false;
    }
    var okZkteco = window.IZCAuth.isZkteco && IZCAuth.isZkteco();
    var okAdmin = window.IZCAuth.isAdmin && IZCAuth.isAdmin();
    if (!okZkteco && !okAdmin) {
      if (IZCAuth.isAsesor && IZCAuth.isAsesor()) window.location.replace('asesor.html');
      else window.location.replace('perfil.html');
      return false;
    }
    if (greet) greet.textContent = 'Hola ' + (nombre || 'ZKTeco');
    return true;
  }

  function profileCard() {
    return document.querySelector('.zkteco-profile-card');
  }

  function currentProfileNombre() {
    return ((window.IZCAuth && IZCAuth.getSessionNombre && IZCAuth.getSessionNombre()) || 'ZKTeco').trim();
  }

  function isEditingNombre() {
    var card = profileCard();
    return !!(card && card.classList.contains('is-editing-name'));
  }

  function setNombreEditUi(editing) {
    var card = profileCard();
    var greet = document.getElementById('profileGreeting');
    var input = document.getElementById('zktecoNombreInput');
    var toggle = document.getElementById('zktecoNombreToggle');
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

  function startEditNombre() {
    setNombreStatus('', '');
    setNombreEditUi(true);
  }

  function cancelEditNombre() {
    setNombreEditUi(false);
    setNombreStatus('', '');
    var greet = document.getElementById('profileGreeting');
    if (greet) greet.textContent = 'Hola ' + currentProfileNombre();
  }

  function setNombreStatus(text, type) {
    var el = document.getElementById('zktecoNombreStatus');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'auth-message asesor-name-edit-status');
      return;
    }
    el.textContent = text || '';
    el.className = 'auth-message asesor-name-edit-status' + (type ? ' is-' + type : '');
    autoHideOk(el, type, 'auth-message asesor-name-edit-status');
  }

  function saveZktecoNombre() {
    var input = document.getElementById('zktecoNombreInput');
    if (!input) return;
    var nombre = String(input.value || '').trim();
    if (nombre.length < 2) {
      setNombreStatus('Ingresa un nombre válido (mínimo 2 caracteres).', 'error');
      setNombreEditUi(true);
      return;
    }
    setNombreStatus('Guardando…', '');
    postApi(actorPayload({ action: 'update_zkteco_nombre', nombre: nombre })).then(function (data) {
      if (!data || !data.ok) {
        setNombreStatus((data && data.error) || 'No se pudo guardar el nombre.', 'error');
        return;
      }
      var saved = String(data.nombre || nombre).trim();
      if (window.IZCAuth && typeof IZCAuth.setSessionNit === 'function') {
        IZCAuth.setSessionNit('ZKTECO', saved, { role: 'zkteco', skipUi: true });
      }
      var greet = document.getElementById('profileGreeting');
      if (greet) greet.textContent = 'Hola ' + (saved || 'ZKTeco');
      setNombreEditUi(false);
      setNombreStatus(data.message || 'Nombre actualizado.', 'ok');
    }).catch(function () {
      setNombreStatus('No se pudo guardar el nombre.', 'error');
    });
  }

  function init() {
    loadCustomCategories();
    bind();
    var ready = (window.IZCAuth && IZCAuth.whenSessionReady)
      ? IZCAuth.whenSessionReady()
      : Promise.resolve();
    ready.then(function () {
      if (!fillProfile()) return;
      var tab = 'catalogo';
      try {
        tab = String(new URLSearchParams(window.location.search).get('tab') || 'catalogo').trim() || 'catalogo';
      } catch (eTab) { tab = 'catalogo'; }
      setActiveTab(tab);
      loadTrm();
      loadZktecoProducts();
      fillFormCategoryOptions('');
      loadAsesorProducts();
      loadZktecoQuotes();
      loadAsesorZktecoQuotes();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
