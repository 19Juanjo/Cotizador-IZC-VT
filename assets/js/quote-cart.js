/* Carrito de cotización (cliente IZC / VALTECH): panel lateral + seed al cotizador. */
(function () {
  'use strict';

  var GUEST_SUFFIX = 'guest';

  function isValtechStore() {
    if (document.body && document.body.getAttribute('data-store') === 'valtech') return true;
    var path = String(location.pathname || '').toLowerCase();
    return /valtech\.html$|cotizador-valtech\.html$|perfil-valtech\.html$|favoritos-valtech\.html$/.test(path);
  }

  function storeId() {
    return isValtechStore() ? 'valtech' : 'izc';
  }

  function cotizadorHref() {
    try {
      var role = String(localStorage.getItem('izc_session_role') || '').toLowerCase();
      var nit = String(localStorage.getItem('izc_session_nit') || '').replace(/[\s.]/g, '').toUpperCase();
      if (role === 'sat' || role === 'gp' || nit === 'SAT' || /^GP\d{1,4}$/.test(nit)) {
        return 'cotizador-sat.html';
      }
      if (
        role === 'asesor' ||
        role === 'admin' ||
        role === 'zkteco' ||
        role === 'zebra' ||
        /^V\d{1,4}$/.test(nit) ||
        nit === 'ZKTECO'
      ) {
        return 'cotizador-asesor.html';
      }
    } catch (eLs) { /* ignore */ }
    try {
      if (window.IZCAuth) {
        if (typeof IZCAuth.isSat === 'function' && IZCAuth.isSat()) return 'cotizador-sat.html';
        if (typeof IZCAuth.isGp === 'function' && IZCAuth.isGp()) return 'cotizador-sat.html';
        if (
          (typeof IZCAuth.isAsesor === 'function' && IZCAuth.isAsesor()) ||
          (typeof IZCAuth.isAdmin === 'function' && IZCAuth.isAdmin()) ||
          (typeof IZCAuth.isZkteco === 'function' && IZCAuth.isZkteco())
        ) {
          return 'cotizador-asesor.html';
        }
      }
    } catch (eAuth) { /* ignore */ }
    return isValtechStore() ? 'cotizador-valtech.html' : 'cotizador.html';
  }

  function loginHref() {
    return 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() || 'marcas.html');
  }

  function currentNit() {
    if (window.IZCAuth && typeof window.IZCAuth.getSessionNit === 'function') {
      return String(window.IZCAuth.getSessionNit() || '').trim();
    }
    try {
      return localStorage.getItem('izc_session_nit') || '';
    } catch (e) {
      return '';
    }
  }

  function normalizeSku(sku) {
    return String(sku || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  function cartStorageKey() {
    var nit = currentNit() || GUEST_SUFFIX;
    return storeId() + '_quote_browse_cart_' + nit;
  }

  function cotizadorStorageKey() {
    var nit = currentNit();
    if (!nit) return '';
    return (isValtechStore() ? 'valtech_cotizador_items_' : 'izc_cotizador_items_') + nit;
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readCart() {
    try {
      var raw = localStorage.getItem(cartStorageKey());
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeCart(list, silent) {
    try {
      localStorage.setItem(cartStorageKey(), JSON.stringify(Array.isArray(list) ? list : []));
    } catch (e) { /* ignore */ }
    if (!silent) {
      document.dispatchEvent(new CustomEvent('izc:quote-cart-changed'));
    }
  }

  function totalQty(list) {
    return (list || []).reduce(function (sum, it) {
      return sum + Math.max(1, Math.floor(Number(it.qty) || 1));
    }, 0);
  }

  function ensureUi() {
    if (document.getElementById('quoteCartPanel')) return;
    var fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'quoteCartFab';
    fab.className = 'quote-cart-fab';
    fab.setAttribute('aria-label', 'Abrir carrito de cotización');
    fab.hidden = true;
    fab.setAttribute('hidden', '');
    fab.style.display = 'none';
    fab.innerHTML =
      '<span class="quote-cart-fab-icon" aria-hidden="true">☰</span>' +
      '<span class="quote-cart-fab-label">Cotizar</span>' +
      '<span class="quote-cart-badge" id="quoteCartBadge" hidden>0</span>';

    var backdrop = document.createElement('div');
    backdrop.id = 'quoteCartBackdrop';
    backdrop.className = 'quote-cart-backdrop';
    backdrop.hidden = true;
    backdrop.setAttribute('hidden', '');
    backdrop.style.display = 'none';

    var panel = document.createElement('aside');
    panel.id = 'quoteCartPanel';
    panel.className = 'quote-cart-panel';
    panel.setAttribute('aria-label', 'Carrito de cotización');
    panel.hidden = true;
    panel.setAttribute('hidden', '');
    panel.style.display = 'none';
    panel.innerHTML =
      '<div class="quote-cart-head">' +
        '<div>' +
          '<h2 class="quote-cart-title">Para cotizar</h2>' +
          '<p class="quote-cart-sub">Productos listos para enviar al cotizador</p>' +
        '</div>' +
        '<button type="button" class="quote-cart-close" id="quoteCartClose" aria-label="Cerrar">×</button>' +
      '</div>' +
      '<div class="quote-cart-body" id="quoteCartBody"></div>' +
      '<div class="quote-cart-foot">' +
        '<button type="button" class="quote-cart-clear" id="quoteCartClear">Vaciar</button>' +
        '<button type="button" class="quote-cart-go" id="quoteCartGo">Cotizar</button>' +
      '</div>';

    document.body.appendChild(fab);
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
  }

  function closePanel() {
    var panel = document.getElementById('quoteCartPanel');
    var backdrop = document.getElementById('quoteCartBackdrop');
    if (panel) {
      panel.hidden = true;
      panel.setAttribute('hidden', '');
      panel.style.display = 'none';
    }
    if (backdrop) {
      backdrop.hidden = true;
      backdrop.setAttribute('hidden', '');
      backdrop.style.display = 'none';
    }
    document.body.classList.remove('quote-cart-open');
  }

  function openPanel() {
    ensureUi();
    var panel = document.getElementById('quoteCartPanel');
    var backdrop = document.getElementById('quoteCartBackdrop');
    if (panel) {
      panel.hidden = false;
      panel.removeAttribute('hidden');
      panel.style.display = 'flex';
    }
    if (backdrop) {
      backdrop.hidden = false;
      backdrop.removeAttribute('hidden');
      backdrop.style.display = 'block';
    }
    document.body.classList.add('quote-cart-open');
    renderPanel();
  }

  function eventEl(e) {
    var t = e && e.target;
    if (!t) return null;
    if (t.nodeType !== 1) t = t.parentElement;
    return t;
  }

  function matchesClosest(el, selector) {
    if (!el || typeof el.closest !== 'function') return null;
    try {
      return el.closest(selector);
    } catch (err) {
      return null;
    }
  }

  function paintPanelBody(list) {
    var body = document.getElementById('quoteCartBody');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<p class="quote-cart-empty">Aún no has agregado productos para cotizar.</p>';
      return;
    }
    body.innerHTML = list.map(function (it, idx) {
      var name = it.name || ('Producto ' + it.sku);
      var img = it.img || '';
      var price = it.price || '';
      return (
        '<article class="quote-cart-item" data-idx="' + idx + '">' +
          '<div class="quote-cart-thumb">' +
            (img
              ? '<img src="' + escapeHtml(img) + '" alt="" loading="lazy" onerror="this.onerror=null;this.remove();this.parentNode.innerHTML=\'<span class=&quot;quote-cart-thumb-fallback&quot;>SKU</span>\'">'
              : '<span class="quote-cart-thumb-fallback">SKU</span>') +
          '</div>' +
          '<div class="quote-cart-meta">' +
            '<div class="quote-cart-sku">Sku: ' + escapeHtml(it.sku) + '</div>' +
            '<div class="quote-cart-name">' + escapeHtml(name) + '</div>' +
            (price ? '<div class="quote-cart-price">' + escapeHtml(price) + '</div>' : '') +
            '<div class="quote-cart-qty-row">' +
              '<button type="button" class="quote-cart-qty-btn" data-action="dec" data-idx="' + idx + '" data-sku="' + escapeHtml(it.sku) + '" aria-label="Menos">−</button>' +
              '<input type="number" class="quote-cart-qty" min="1" step="1" inputmode="numeric" ' +
                'value="' + escapeHtml(String(Math.max(1, parseInt(it.qty, 10) || 1))) + '" ' +
                'data-idx="' + idx + '" data-sku="' + escapeHtml(it.sku) + '" aria-label="Cantidad">' +
              '<button type="button" class="quote-cart-qty-btn" data-action="inc" data-idx="' + idx + '" data-sku="' + escapeHtml(it.sku) + '" aria-label="Más">+</button>' +
              '<button type="button" class="quote-cart-remove" data-action="remove" data-idx="' + idx + '" data-sku="' + escapeHtml(it.sku) + '" title="Quitar" aria-label="Quitar">×</button>' +
            '</div>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  }

  function renderPanel() {
    ensureUi();
    var list = readCart();
    if (enrichCartItems(list)) writeCart(list, true);
    var fab = document.getElementById('quoteCartFab');
    var badge = document.getElementById('quoteCartBadge');
    var go = document.getElementById('quoteCartGo');
    var count = totalQty(list);
    if (fab) {
      if (count > 0) {
        fab.hidden = false;
        fab.removeAttribute('hidden');
        fab.style.display = '';
      } else {
        fab.hidden = true;
        fab.setAttribute('hidden', '');
        fab.style.display = 'none';
        closePanel();
      }
    }
    if (badge) {
      badge.textContent = String(count);
      badge.hidden = count <= 0;
    }
    if (go) go.disabled = list.length === 0;
    paintPanelBody(list);

    var needsCatalog = list.some(function (it) {
      return it && (!it.img || !it.name || /^Producto\s+/i.test(it.name));
    });
    if (!needsCatalog) return;
    loadCatalogBySku().then(function () {
      var latest = readCart();
      if (!enrichCartItems(latest)) return;
      writeCart(latest, true);
      paintPanelBody(latest);
    });
  }

  function isPlaceholderImg(src) {
    return !src || /imgmarcas|iconoizc|logo\/icono|placeholder/i.test(String(src));
  }

  function findProductCard(fromEl) {
    if (!fromEl || typeof fromEl.closest !== 'function') return null;
    return fromEl.closest('.product-card, .product-detail, #productDetail');
  }

  function cardMeta(card) {
    if (!card) return { sku: '', name: '', img: '', price: '' };
    var sku = normalizeSku(card.getAttribute('data-sku') || '');
    if (!sku) {
      var skuEl = card.querySelector('.sku, .product-detail-sku, #productSku');
      var m = skuEl && String(skuEl.textContent || '').match(/(?:sku\s*#?\s*:?\s*)([A-Z0-9\-_.\/]+)/i);
      if (m) sku = normalizeSku(m[1]);
    }
    var nameEl = card.querySelector('.product-title a, .product-title, #productTitle, h1');
    var imgEl = card.querySelector(
      '#productMainImage, .product-img img, .product-detail-gallery img, .product-detail-media img, img'
    );
    var priceEl = card.querySelector('.price, .product-detail-price, #productPrice');
    var img = imgEl ? String(imgEl.getAttribute('src') || imgEl.currentSrc || '').trim() : '';
    if (isPlaceholderImg(img)) img = '';
    return {
      sku: sku,
      name: nameEl ? String(nameEl.textContent || '').trim() : '',
      img: img,
      price: priceEl ? String(priceEl.textContent || '').trim() : ''
    };
  }

  function metaFromDom(sku) {
    sku = normalizeSku(sku);
    if (!sku) return { sku: '', name: '', img: '', price: '' };
    var card =
      document.querySelector('.product-card[data-sku="' + sku + '"]') ||
      document.querySelector('.product-card[data-sku="' + String(sku).toLowerCase() + '"]');
    if (!card) {
      var detail = document.getElementById('productDetail');
      if (detail) {
        var detailMeta = cardMeta(detail);
        if (normalizeSku(detailMeta.sku) === sku) return detailMeta;
      }
      return { sku: sku, name: '', img: '', price: '' };
    }
    return cardMeta(card);
  }

  var catalogBySku = null;
  var catalogLoading = null;

  function loadCatalogBySku() {
    if (catalogBySku) return Promise.resolve(catalogBySku);
    if (catalogLoading) return catalogLoading;
    var loader =
      window.IZCData && typeof window.IZCData.loadJson === 'function'
        ? window.IZCData.loadJson('assets/files/catalogo.json', { cache: 'force-cache' })
        : fetch('assets/files/catalogo.json', { cache: 'force-cache' }).then(function (r) {
            if (!r.ok) throw new Error('catalog');
            return r.json();
          });
    var overlayReady = window.IZCZktecoOverlay && typeof IZCZktecoOverlay.load === 'function'
      ? IZCZktecoOverlay.load()
      : Promise.resolve(null);
    catalogLoading = Promise.all([loader, overlayReady])
      .then(function (parts) {
        var data = parts[0];
        var map = {};
        var products = (data && data.products) || [];
        if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.mergeIntoCatalog === 'function') {
          products = IZCZktecoOverlay.mergeIntoCatalog(products);
        }
        products.forEach(function (p) {
          var s = normalizeSku(p && p.sku);
          if (s) map[s] = p;
        });
        catalogBySku = map;
        catalogLoading = null;
        return map;
      })
      .catch(function () {
        catalogBySku = catalogBySku || {};
        catalogLoading = null;
        return catalogBySku;
      });
    return catalogLoading;
  }

  function enrichCartItems(list) {
    var changed = false;
    (list || []).forEach(function (it) {
      if (!it) return;
      var sku = normalizeSku(it.sku);
      if (!sku) return;
      if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.get === 'function') {
        var ovEarly = IZCZktecoOverlay.get(sku);
        if (ovEarly && ovEarly.name && String(it.name || '') !== String(ovEarly.name)) {
          it.name = ovEarly.name;
          changed = true;
        }
      }
      if (it.img && it.name && !/^Producto\s+/i.test(it.name)) return;
      var dom = metaFromDom(sku);
      if (!it.img && dom.img) {
        it.img = dom.img;
        changed = true;
      }
      if ((!it.name || /^Producto\s+/i.test(it.name)) && dom.name) {
        it.name = dom.name;
        changed = true;
      }
      if (!it.price && dom.price) {
        it.price = dom.price;
        changed = true;
      }
      if (catalogBySku && catalogBySku[sku]) {
        var p = catalogBySku[sku];
        if (!it.img && p.img && !isPlaceholderImg(p.img)) {
          it.img = p.img;
          changed = true;
        }
        if ((!it.name || /^Producto\s+/i.test(it.name)) && p.name) {
          it.name = p.name;
          changed = true;
        }
      }
    });
    return changed;
  }

  function addItem(sku, qty, meta) {
    sku = normalizeSku(sku);
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    if (!sku) return false;
    meta = meta || {};
    var list = readCart();
    var found = -1;
    for (var i = 0; i < list.length; i++) {
      if (normalizeSku(list[i].sku) === sku) {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      list[found].qty = Math.max(1, Math.floor(Number(list[found].qty) || 1) + qty);
      if (meta.name) list[found].name = meta.name;
      if (meta.img) list[found].img = meta.img;
      if (meta.price) list[found].price = meta.price;
    } else {
      list.push({
        sku: sku,
        qty: qty,
        name: meta.name || '',
        img: meta.img || '',
        price: meta.price || ''
      });
    }
    writeCart(list);
    return true;
  }

  function itemQty(it) {
    return Math.max(1, Math.floor(Number(it && it.qty) || 1));
  }

  function findCartIndex(list, idx, sku) {
    list = list || [];
    idx = Number(idx);
    if (isFinite(idx) && idx >= 0 && idx < list.length) return idx;
    sku = normalizeSku(sku);
    if (!sku) return -1;
    for (var i = 0; i < list.length; i++) {
      if (normalizeSku(list[i] && list[i].sku) === sku) return i;
    }
    return -1;
  }

  function setQty(idx, qty) {
    var list = readCart();
    if (idx < 0 || idx >= list.length) return;
    list[idx].qty = Math.max(1, Math.floor(Number(qty) || 1));
    writeCart(list);
  }

  function bumpQty(idx, delta, sku) {
    var list = readCart();
    var i = findCartIndex(list, idx, sku);
    if (i < 0) return;
    var next = itemQty(list[i]) + Number(delta || 0);
    if (next < 1) {
      list.splice(i, 1);
      writeCart(list);
      return;
    }
    list[i].qty = next;
    writeCart(list);
  }

  function applyQtyFromInput(input) {
    if (!input) return;
    var list = readCart();
    var i = findCartIndex(list, input.getAttribute('data-idx'), input.getAttribute('data-sku'));
    if (i < 0) return;
    var next = Math.max(1, Math.floor(Number(input.value) || 1));
    list[i].qty = next;
    writeCart(list);
  }

  function removeAt(idx) {
    var list = readCart();
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    writeCart(list);
  }

  function mergeIntoCotizador(cart) {
    var key = cotizadorStorageKey();
    if (!key) return false;
    var existing = [];
    try {
      var raw = localStorage.getItem(key);
      existing = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(existing)) existing = [];
    } catch (e) {
      existing = [];
    }
    var bySku = {};
    existing.forEach(function (it) {
      var s = normalizeSku(it && it.sku);
      if (!s) return;
      bySku[s] = { sku: s, qty: Math.max(1, Math.floor(Number(it.qty) || 1)) };
    });
    (cart || []).forEach(function (it) {
      var s = normalizeSku(it && it.sku);
      if (!s) return;
      var q = Math.max(1, Math.floor(Number(it.qty) || 1));
      if (bySku[s]) bySku[s].qty += q;
      else bySku[s] = { sku: s, qty: q };
    });
    var merged = Object.keys(bySku).map(function (k) { return bySku[k]; });
    try {
      localStorage.setItem(key, JSON.stringify(merged));
    } catch (e2) {
      return false;
    }
    return true;
  }

  function goToCotizador() {
    var cart = readCart();
    if (!cart.length) return;
    if (window.IZCAuth && typeof window.IZCAuth.requireLogin === 'function') {
      if (!window.IZCAuth.requireLogin('Inicia sesión para cotizar estos productos.')) {
        try {
          sessionStorage.setItem(storeId() + '_quote_cart_resume', '1');
        } catch (e) { /* ignore */ }
        return;
      }
    } else if (!currentNit()) {
      location.href = loginHref();
      return;
    }
    if (!mergeIntoCotizador(cart)) {
      window.alert('No se pudo preparar el cotizador. Revisa que la sesión esté activa.');
      return;
    }
    writeCart([]);
    closePanel();
    location.href = cotizadorHref();
  }

  function flashAdded(btn) {
    if (!btn) return;
    var prev = btn.textContent;
    btn.classList.add('is-added');
    btn.textContent = 'Agregado';
    window.setTimeout(function () {
      btn.classList.remove('is-added');
      btn.textContent = prev || 'Agregar a cotizar';
    }, 900);
  }

  function onAddClick(btn) {
    var card = findProductCard(btn) || document.getElementById('productDetail');
    var meta = cardMeta(card);
    var sku = normalizeSku(btn.getAttribute('data-sku') || meta.sku);
    if (!sku) return;
    if (!meta.img || !meta.name) {
      var dom = metaFromDom(sku);
      if (!meta.img && dom.img) meta.img = dom.img;
      if (!meta.name && dom.name) meta.name = dom.name;
      if (!meta.price && dom.price) meta.price = dom.price;
    }
    if ((!meta.img || !meta.name) && catalogBySku && catalogBySku[sku]) {
      var p = catalogBySku[sku];
      if (!meta.img && p.img && !isPlaceholderImg(p.img)) meta.img = p.img;
      if (!meta.name && p.name) meta.name = p.name;
    }
    if (addItem(sku, 1, meta)) {
      flashAdded(btn);
      renderPanel();
    }
  }

  function bind() {
    ensureUi();
    closePanel();
    renderPanel();
    closePanel();

    var closeBtn = document.getElementById('quoteCartClose');
    if (closeBtn && !closeBtn.__izcBound) {
      closeBtn.__izcBound = true;
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closePanel();
      });
    }
    var backdrop = document.getElementById('quoteCartBackdrop');
    if (backdrop && !backdrop.__izcBound) {
      backdrop.__izcBound = true;
      backdrop.addEventListener('click', function (e) {
        e.preventDefault();
        closePanel();
      });
    }

    if (document.__izcQuoteCartBound) return;
    document.__izcQuoteCartBound = true;

    document.addEventListener('click', function (e) {
      var el = eventEl(e);
      if (!el) return;

      var addBtn = matchesClosest(el, '.quote-cart-add');
      if (addBtn) {
        e.preventDefault();
        onAddClick(addBtn);
        return;
      }
      if (matchesClosest(el, '#quoteCartFab')) {
        e.preventDefault();
        openPanel();
        return;
      }
      if (matchesClosest(el, '#quoteCartClose') || matchesClosest(el, '.quote-cart-close') || matchesClosest(el, '#quoteCartBackdrop')) {
        e.preventDefault();
        closePanel();
        return;
      }
      if (matchesClosest(el, '#quoteCartClear')) {
        e.preventDefault();
        writeCart([]);
        renderPanel();
        return;
      }
      if (matchesClosest(el, '#quoteCartGo')) {
        e.preventDefault();
        goToCotizador();
        return;
      }
      var qtyBtn = matchesClosest(el, '.quote-cart-qty-btn, .quote-cart-remove');
      if (qtyBtn) {
        e.preventDefault();
        e.stopPropagation();
        var action = qtyBtn.getAttribute('data-action');
        var idx = qtyBtn.getAttribute('data-idx');
        var sku = qtyBtn.getAttribute('data-sku');
        if (action === 'remove') {
          var list = readCart();
          var ri = findCartIndex(list, idx, sku);
          if (ri >= 0) removeAt(ri);
        } else if (action === 'inc') {
          bumpQty(idx, 1, sku);
        } else if (action === 'dec') {
          bumpQty(idx, -1, sku);
        }
        renderPanel();
        return;
      }
    });

    document.addEventListener('change', function (e) {
      var el = eventEl(e);
      var input = matchesClosest(el, 'input.quote-cart-qty');
      if (!input) return;
      e.preventDefault();
      applyQtyFromInput(input);
      renderPanel();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closePanel();
        return;
      }
      var el = eventEl(e);
      var input = matchesClosest(el, 'input.quote-cart-qty');
      if (input && e.key === 'Enter') {
        e.preventDefault();
        applyQtyFromInput(input);
        renderPanel();
        input.blur();
      }
    });

    document.addEventListener('izc:quote-cart-changed', renderPanel);
    document.addEventListener('izc:auth-changed', function () {
      // Migrar carrito guest → sesión al iniciar.
      try {
        var guestKey = storeId() + '_quote_browse_cart_' + GUEST_SUFFIX;
        var guestRaw = localStorage.getItem(guestKey);
        var guest = guestRaw ? JSON.parse(guestRaw) : [];
        if (currentNit() && Array.isArray(guest) && guest.length) {
          var current = readCart();
          guest.forEach(function (it) {
            addItem(it.sku, it.qty, it);
          });
          // addItem already writes; clear guest
          localStorage.removeItem(guestKey);
          if (!current.length && sessionStorage.getItem(storeId() + '_quote_cart_resume') === '1') {
            sessionStorage.removeItem(storeId() + '_quote_cart_resume');
            goToCotizador();
            return;
          }
        }
      } catch (err) { /* ignore */ }
      renderPanel();
    });
  }

  function addButtonHtml(sku) {
    var s = escapeHtml(normalizeSku(sku) || '');
    return (
      '<button type="button" class="quote-cart-add" data-sku="' + s + '" title="Agregar a cotizar">' +
        'Agregar a cotizar' +
      '</button>'
    );
  }

  window.IZCQuoteCart = {
    addItem: addItem,
    readCart: readCart,
    openPanel: openPanel,
    closePanel: closePanel,
    renderPanel: renderPanel,
    addButtonHtml: addButtonHtml,
    isValtechStore: isValtechStore
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  // Si volvió del login con carrito pendiente de cotizar, completar el salto.
  document.addEventListener('DOMContentLoaded', function () {
    try {
      if (sessionStorage.getItem(storeId() + '_quote_cart_resume') !== '1') return;
      if (!currentNit()) return;
      if (!readCart().length) {
        sessionStorage.removeItem(storeId() + '_quote_cart_resume');
        return;
      }
      sessionStorage.removeItem(storeId() + '_quote_cart_resume');
      goToCotizador();
    } catch (e) { /* ignore */ }
  });
})();
