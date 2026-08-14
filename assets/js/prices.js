/* Utilidades de precios, moneda y formato. */
(function () {
  'use strict';

  var priceMap = null;
  var loadPromise = null;
  var lastStamp = null;
  var POLL_MS = 3000;
  var PRECIOS_PATH = 'assets/files/precios.json';

  function formatUSD(value) {
    return '$ ' + Number(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatCOP(value) {
    return '$ ' + Math.round(Number(value)).toLocaleString('es-CO') + ' COP';
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
        return { amount: Number(amount), currency: String(currency).toUpperCase() };
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

  function lookupPrice(sku) {
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

  function lockPrices(root) {
    var scope = root || document;
    scope.querySelectorAll('.product-card .price, .product-carddatalogic .price').forEach(function (priceElem) {
      priceElem.textContent = 'Inicia sesión';
      priceElem.classList.add('price-locked');
      priceElem.title = 'Inicia sesión para ver el precio';
    });
    var detailPrice = document.getElementById('productPrice');
    if (detailPrice) {
      detailPrice.textContent = 'Inicia sesión para ver el precio';
      detailPrice.classList.add('price-locked');
    }
  }

  function applyPrices(root) {
    if (!isLoggedIn()) {
      lockPrices(root);
      return;
    }
    if (!priceMap) return;
    var scope = root || document;
    scope.querySelectorAll('.product-card, .product-carddatalogic').forEach(function (card) {
      var skuElem = card.querySelector('.sku');
      var priceElem = card.querySelector('.price');
      if (!skuElem || !priceElem) return;
      priceElem.classList.remove('price-locked');
      priceElem.removeAttribute('title');
      var text = formatPrice(lookupPrice(skuElem.textContent.replace(/\D/g, '').trim()));
      if (text) priceElem.textContent = text;
    });

    var detailPrice = document.getElementById('productPrice');
    if (detailPrice && detailPrice.getAttribute('data-sku')) {
      detailPrice.classList.remove('price-locked');
      var detailText = formatPrice(lookupPrice(detailPrice.getAttribute('data-sku')));
      if (detailText) detailPrice.textContent = detailText;
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
  }

  function boot() {
    loadPrices().then(function () {
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
    get: lookupPrice,
    format: formatPrice
  };
})();
