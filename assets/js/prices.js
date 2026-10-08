/* Utilidades de precios, moneda y formato. */
(function () {
  'use strict';

  var priceMap = null;
  var loadPromise = null;
  var lastStamp = null;
  var POLL_MS = 3000;
  var PRECIOS_PATH = 'assets/files/precios.json';
  /** Bandera típica en Excel (0 / 0.10) cuando no hay USD real. */
  var USD_FLAG_MAX = 0.10;
  var trmValue = null;
  var trmPromise = null;

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

  function getTrm() {
    if (trmValue != null && isFinite(trmValue) && trmValue > 0) return trmValue;
    try {
      if (window.__IZC_TRM__ != null && Number(window.__IZC_TRM__) > 0) {
        return Number(window.__IZC_TRM__);
      }
    } catch (e) { /* ignore */ }
    return 3101;
  }

  function loadTrm(force) {
    if (!force && trmValue != null && trmValue > 0) return Promise.resolve(trmValue);
    if (!force && trmPromise) return trmPromise;
    var url = 'data/trm.json';
    trmPromise = fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var n = data && Number(data.value != null ? data.value : data.trm);
        if (isFinite(n) && n > 0) trmValue = n;
        return getTrm();
      })
      .catch(function () { return getTrm(); })
      .finally(function () { trmPromise = null; });
    return trmPromise;
  }

  function usdFromCop(pesos, trm) {
    var p = Number(pesos);
    var t = Number(trm);
    if (!(p > 0) || !(t > 0)) return null;
    var usd = p / t;
    if (window.IZCMoney && typeof IZCMoney.roundUsd === 'function') {
      return IZCMoney.roundUsd(usd);
    }
    return Math.floor(usd * 100) / 100;
  }

  function resolveEntry(entry) {
    if (entry == null) return null;
    var trm = getTrm();

    if (typeof entry === 'number' && isFinite(entry)) {
      if (entry > USD_FLAG_MAX) return { amount: entry, currency: 'USD' };
      return null;
    }

    if (typeof entry === 'object') {
      if (entry.overlay) {
        var oAmt = Number(entry.amount != null ? entry.amount : entry.v);
        var oCur = String(entry.currency || entry.c || 'USD').toUpperCase();
        if (isFinite(oAmt) && oAmt > 0) {
          var oOut = { amount: oAmt, currency: oCur };
          var oPesos = Number(entry.pesos != null ? entry.pesos : entry.listCop);
          if (isFinite(oPesos) && oPesos > 0) oOut.pesos = oPesos;
          return oOut;
        }
        return null;
      }
      var amount = entry.amount != null ? entry.amount : entry.v;
      var currency = String(entry.currency || entry.c || 'USD').toUpperCase();
      var pesos = entry.pesos != null ? Number(entry.pesos)
        : (entry.listCop != null ? Number(entry.listCop) : NaN);
      amount = amount != null ? Number(amount) : NaN;

      // Etiquetas / ribbons: se publican como COP y se muestran en COP.
      if (currency === 'COP' && isFinite(amount) && amount > 0) {
        return { amount: amount, currency: 'COP' };
      }

      // USD 0 / 0.10 (bandera) pero hay PESOS → USD desde COP (no consumibles COP).
      if (currency === 'USD' && isFinite(pesos) && pesos > 0) {
        if (!isFinite(amount) || amount <= 0 || amount <= USD_FLAG_MAX) {
          var usd = usdFromCop(pesos, trm);
          if (usd != null && usd > 0) {
            return { amount: usd, currency: 'USD', pesos: pesos };
          }
        }
      }

      if (isFinite(amount) && amount > 0) {
        var out = { amount: amount, currency: currency };
        if (isFinite(pesos) && pesos > 0) out.pesos = pesos;
        return out;
      }
    }
    return null;
  }

  function formatPrice(entry) {
    var resolved = resolveEntry(entry);
    if (!resolved) return null;
    if (resolved.currency === 'COP') return formatCOP(resolved.amount);
    return formatUSD(resolved.amount);
  }

  function normalizeName(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /** Etiquetas, ribbons, rollos, cintas cera/resina y papel térmico → precio en COP. */
  function isEtiquetaOrRibbonName(text) {
    var n = normalizeName(text);
    if (!n) return false;
    if (/impresora|printer|\baio\b|verificador|lector|scanner|escaner/.test(n)) {
      return false;
    }
    if (n.indexOf('ribbon') !== -1) {
      return !/rodamiento|tensor|pinon|eje|soporte|guia|sensor/.test(n);
    }
    if (n.indexOf('cinta') !== -1 && /cera|resina|wax|ribbon|transferencia/.test(n)) {
      return true;
    }
    if (n.indexOf('etiqueta') !== -1) return true;
    if (n.indexOf('rollo') !== -1) {
      return !/impresora|printer|soporte|motor|eje|sensor|rodillo/.test(n);
    }
    if (n.indexOf('papel') !== -1) {
      return !/impresora|soporte|bandeja|rodillo|motor/.test(n);
    }
    return false;
  }

  function formatPriceForProduct(entry, productName) {
    if (!isEtiquetaOrRibbonName(productName)) {
      return formatPrice(entry);
    }
    if (entry == null) return null;
    if (typeof entry === 'object') {
      var currency = String(entry.currency || entry.c || 'USD').toUpperCase();
      var amount = entry.amount != null ? Number(entry.amount) : NaN;
      var pesos = entry.pesos != null ? Number(entry.pesos)
        : (entry.listCop != null ? Number(entry.listCop) : NaN);
      if (currency === 'COP' && isFinite(amount) && amount > 0) {
        return formatCOP(amount);
      }
      if (isFinite(pesos) && pesos > 0) return formatCOP(pesos);
      // Si el amount parece COP (magnitud de pesos), úsalo.
      if (isFinite(amount) && amount >= 1000) return formatCOP(amount);
    }
    return formatPrice(entry);
  }

  function cardProductName(card) {
    if (!card) return '';
    var el = card.querySelector(
      '.product-title, .product-name, .card-name, .product-card-name, .name, h4, h3, h2, .desc, .description'
    );
    return el ? el.textContent : '';
  }

  function cardSku(card, skuElem) {
    if (card) {
      var fromData = card.getAttribute('data-sku');
      if (fromData) return String(fromData).trim();
    }
    var raw = skuElem ? String(skuElem.textContent || '') : '';
    raw = raw.replace(/^.*?:\s*/i, '').trim();
    if (raw) return raw;
    return raw.replace(/\D/g, '').trim();
  }

  function lookupPrice(sku) {
    if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.price === 'function') {
      var overlayPrice = IZCZktecoOverlay.price(sku);
      if (overlayPrice) return overlayPrice;
    }
    if (!priceMap || !sku) return null;
    if (Object.prototype.hasOwnProperty.call(priceMap, sku)) {
      return priceMap[sku];
    }
    var skuNoZeros = String(sku).replace(/^0+/, '');
    if (skuNoZeros && Object.prototype.hasOwnProperty.call(priceMap, skuNoZeros)) {
      return priceMap[skuNoZeros];
    }
    return null;
  }

  function isLoggedIn() {
    if (window.IZCAuth && typeof window.IZCAuth.isLoggedIn === 'function') {
      return !!window.IZCAuth.isLoggedIn();
    }
    try {
      return !!localStorage.getItem('izc_session_nit');
    } catch (e) {
      return false;
    }
  }

  function setPriceLabel(priceElem, text, kind) {
    if (!priceElem) return;
    priceElem.classList.remove('price-locked', 'price-sin-stock');
    priceElem.removeAttribute('title');
    if (kind === 'locked') {
      priceElem.textContent = text || 'Inicia sesión';
      priceElem.classList.add('price-locked');
      priceElem.title = 'Inicia sesión para ver el precio';
      return;
    }
    if (kind === 'sin-stock' || !text) {
      priceElem.textContent = 'Sin stock';
      priceElem.classList.add('price-sin-stock');
      return;
    }
    priceElem.textContent = text;
  }

  function lockPrices(root) {
    var scope = root || document;
    scope.querySelectorAll('.product-card .price, .product-carddatalogic .price').forEach(function (priceElem) {
      setPriceLabel(priceElem, 'Inicia sesión', 'locked');
    });
    var detailPrice = document.getElementById('productPrice');
    if (detailPrice) {
      setPriceLabel(detailPrice, 'Inicia sesión para ver el precio', 'locked');
    }
  }

  function applyPrices(root) {
    if (!isLoggedIn()) {
      lockPrices(root);
      return;
    }
    var overlayReady = window.IZCZktecoOverlay && typeof IZCZktecoOverlay.price === 'function';
    if (!priceMap && !overlayReady) return;
    var scope = root || document;
    scope.querySelectorAll('.product-card, .product-carddatalogic').forEach(function (card) {
      var skuElem = card.querySelector('.sku');
      var priceElem = card.querySelector('.price');
      if (!priceElem) return;
      var text = formatPriceForProduct(
        lookupPrice(cardSku(card, skuElem)),
        cardProductName(card)
      );
      setPriceLabel(priceElem, text, text ? 'ok' : 'sin-stock');
    });

    var detailPrice = document.getElementById('productPrice');
    if (detailPrice && detailPrice.getAttribute('data-sku')) {
      var detailName = '';
      var detailTitle = document.getElementById('productName') || document.querySelector('h1.product-title, .product-detail-title, h1');
      if (detailTitle) detailName = detailTitle.textContent || '';
      var quoteUsd = NaN;
      try {
        quoteUsd = Number(new URLSearchParams(window.location.search).get('usd'));
      } catch (eQuote) { quoteUsd = NaN; }
      var detailEntry = (isFinite(quoteUsd) && quoteUsd > 0)
        ? { amount: quoteUsd, currency: 'USD' }
        : lookupPrice(detailPrice.getAttribute('data-sku'));
      var detailText = formatPriceForProduct(detailEntry, detailName);
      setPriceLabel(detailPrice, detailText, detailText ? 'ok' : 'sin-stock');
    }
  }

  function parsePricePayload(text) {
    var trimmed = String(text || '').trim();
    if (!trimmed || trimmed.charAt(0) !== '{') return null;
    try {
      var data = JSON.parse(trimmed);
      if (!data || typeof data !== 'object' || data.error) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function currentStamp() {
    if (typeof window.__IZC_PRICES_STAMP__ !== 'undefined' && window.__IZC_PRICES_STAMP__ != null) {
      return String(window.__IZC_PRICES_STAMP__);
    }
    if (!priceMap) return '';
    return String(Object.keys(priceMap).length);
  }

  function entryEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a === 'number' || typeof b === 'number') return a === b;
    if (typeof a === 'object' && typeof b === 'object') {
      return a.amount === b.amount && (a.currency || 'USD') === (b.currency || 'USD');
    }
    return false;
  }

  function mapsEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    var keysA = Object.keys(a);
    var keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (var i = 0; i < keysA.length; i++) {
      var key = keysA[i];
      if (!entryEqual(a[key], b[key])) return false;
    }
    return true;
  }

  function fromJson(forceReload) {
    if (window.IZCData && typeof window.IZCData.loadJson === 'function') {
      return window.IZCData.loadJson(PRECIOS_PATH, { cache: 'no-store', forceReload: !!forceReload })
        .then(function (data) {
          if (!data || typeof data !== 'object' || data.error) return null;
          return data;
        })
        .catch(function () { return null; });
    }
    var url = PRECIOS_PATH + (forceReload ? ('?t=' + Date.now()) : '');
    return fetch(url, { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) return null;
        return response.text().then(parsePricePayload);
      })
      .catch(function () { return null; });
  }

  function loadPrices(options) {
    options = options || {};
    var force = !!options.forceReload;

    if (!force && priceMap) return Promise.resolve(priceMap);
    if (!force && loadPromise) return loadPromise;

    var request = fromJson(force)
      .then(function (mapa) {
        if (mapa) return mapa;
        if (location.protocol === 'file:') return null;
        return fetch('assets/files/precios.php', { cache: 'no-store' }).then(function (response) {
          if (!response.ok) throw new Error('No hay precios');
          return response.text().then(function (text) {
            var data = parsePricePayload(text);
            if (!data) throw new Error('precios.php no devolvió JSON');
            return data;
          });
        });
      })
      .then(function (mapa) {
        var next = mapa || {};
        var stamp = currentStamp();
        var changed = !mapsEqual(priceMap, next) || (stamp && stamp !== lastStamp);
        priceMap = next;
        if (stamp) lastStamp = stamp;
        if (changed) {
          applyPrices();
          try {
            document.dispatchEvent(new CustomEvent('izc:prices-updated', { detail: { stamp: lastStamp } }));
          } catch (e) { /* IE ignore */ }
        }
        return priceMap;
      })
      .catch(function (error) {
        console.error('Error al cargar precios:', error);
        return priceMap;
      })
      .finally(function () {
        if (!force) loadPromise = null;
      });

    if (!force) loadPromise = request;
    return request;
  }

  function startAutoRefresh() {
    if (window.__IZC_PRICES_WATCHING__) return;
    window.__IZC_PRICES_WATCHING__ = true;
    setInterval(function () {
      loadPrices({ forceReload: true });
    }, POLL_MS);
    setInterval(function () {
      loadTrm(true).then(function () {
        applyPrices();
      });
    }, 20000);
    if (window.IZCLiveSync && typeof IZCLiveSync.on === 'function') {
      IZCLiveSync.on(function (msg) {
        var t = msg && msg.type;
        if (!t || t === IZCLiveSync.TYPES.ALL || t === IZCLiveSync.TYPES.PRICES) {
          loadPrices({ forceReload: true });
        } else if (t === IZCLiveSync.TYPES.TRM) {
          loadTrm(true).then(function () { loadPrices({ forceReload: true }); });
        }
      });
    }
  }

  function loadZktecoOverlay() {
    if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.load === 'function') {
      return IZCZktecoOverlay.load();
    }
    if (window.__IZC_ZKTECO_OVERLAY_LOADING__) return window.__IZC_ZKTECO_OVERLAY_LOADING__;
    window.__IZC_ZKTECO_OVERLAY_LOADING__ = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'assets/js/zkteco-overlay.js?v=2';
      s.onload = function () {
        resolve(
          window.IZCZktecoOverlay && IZCZktecoOverlay.load
            ? IZCZktecoOverlay.load()
            : null
        );
      };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
    return window.__IZC_ZKTECO_OVERLAY_LOADING__;
  }

  function boot() {
    loadTrm().then(function () {
      return Promise.all([loadPrices(), loadZktecoOverlay()]);
    }).then(function () {
      applyPrices();
      startAutoRefresh();
    });
    document.addEventListener('izc:auth-changed', function () {
      applyPrices();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.IZCPrices = {
    load: loadPrices,
    reload: function () { return loadPrices({ forceReload: true }); },
    apply: applyPrices,
    reloadTrm: function () {
      return loadTrm(true).then(function () {
        applyPrices();
        return getTrm();
      });
    },
    get: lookupPrice,
    format: formatPrice,
    formatForProduct: formatPriceForProduct,
    isEtiquetaOrRibbonName: isEtiquetaOrRibbonName
  };
})();
