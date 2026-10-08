/* Overlay público de productos ZKTeco.
   Gana sobre catálogo LP y sobre el producto original del asesor.
   data/ está bloqueado por HTTP; el precio editado se lee de assets/files. */
(function () {
  'use strict';

  var PATHS = [
    'assets/files/productos_zkteco.json',
    'data/productos_zkteco.json',
    'api/productos_zkteco.php'
  ];
  var bySku = {};
  var loadPromise = null;

  function skuKey(sku) {
    return String(sku || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  function index(list) {
    bySku = {};
    (Array.isArray(list) ? list : []).forEach(function (p) {
      if (!p) return;
      var k = skuKey(p.sku || p.codigo);
      if (!k) return;
      bySku[k] = p;
    });
  }

  function fetchJson(path, force) {
    if (window.IZCData && typeof window.IZCData.loadJson === 'function') {
      return window.IZCData.loadJson(path, { cache: 'no-store', forceReload: !!force });
    }
    var url = path + (path.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function load(force) {
    if (!force && loadPromise) return loadPromise;
    loadPromise = (function tryPath(i) {
      if (i >= PATHS.length) {
        index([]);
        return bySku;
      }
      return fetchJson(PATHS[i], force).then(function (data) {
        var list = data && Array.isArray(data.products) ? data.products : [];
        if (!list.length && i + 1 < PATHS.length) return tryPath(i + 1);
        index(list);
        return bySku;
      }).catch(function () {
        return tryPath(i + 1);
      });
    })(0);
    return loadPromise;
  }

  function get(sku) {
    var k = skuKey(sku);
    if (!k) return null;
    if (bySku[k]) return bySku[k];
    var nz = k.replace(/^0+/, '');
    if (nz && nz !== k && bySku[nz]) return bySku[nz];
    var keys = Object.keys(bySku);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].replace(/^0+/, '') === nz) return bySku[keys[i]];
    }
    return null;
  }

  function isCreated(row) {
    return !!row && String(row.source || '').toLowerCase() === 'created';
  }

  function price(sku) {
    var p = get(sku);
    if (!p) return null;
    var usd = Number(p.unitario_usd || p.unitarioUsd || p.usd || 0);
    var cop = Number(p.unitario_cop || p.unitarioCop || p.cop || 0);
    if (isFinite(usd) && usd > 0) {
      return { amount: usd, currency: 'USD', pesos: cop > 0 ? cop : null, overlay: true };
    }
    if (isFinite(cop) && cop > 0) {
      return { amount: cop, currency: 'COP', overlay: true };
    }
    return null;
  }

  function toCatalogProduct(p) {
    if (!p) return null;
    var sku = skuKey(p.sku || p.codigo);
    return {
      sku: sku || String(p.sku || ''),
      name: p.name || p.nombre || ('Producto ' + (sku || '')),
      referencia: p.referencia || '',
      brand: 'zkteco',
      brandName: 'ZKTeco',
      brandLogo: 'iconoizc.png',
      brandPage: 'zkteco.html',
      img: 'assets/logo/iconoizc.png',
      category: p.category || p.categoria || 'otros',
      type: p.category || p.categoria || 'otros',
      subtype: '',
      subtypes: [],
      unitario_usd: p.unitario_usd,
      unitario_cop: p.unitario_cop,
      zktecoOverlay: true,
      zktecoCreated: isCreated(p)
    };
  }

  function applyToProduct(product) {
    if (!product) return product;
    var o = get(product.sku || product.codigo);
    if (!o) return product;
    var out = {};
    Object.keys(product).forEach(function (k) {
      out[k] = product[k];
    });
    if (o.name || o.nombre) out.name = o.name || o.nombre;
    if (o.referencia != null) out.referencia = o.referencia;
    if (o.category || o.categoria) {
      out.category = o.category || o.categoria;
      out.type = out.category;
    }
    if (Number(o.unitario_usd) > 0) out.unitario_usd = o.unitario_usd;
    if (Number(o.unitario_cop) > 0) out.unitario_cop = o.unitario_cop;
    out.zktecoOverlay = true;
    out.zktecoCreated = isCreated(o);
    return out;
  }

  function extraProducts() {
    return Object.keys(bySku).map(function (k) { return bySku[k]; });
  }

  function forEach(fn) {
    extraProducts().forEach(fn);
  }

  function mergeIntoCatalog(products) {
    var list = Array.isArray(products) ? products.slice() : [];
    var seen = {};
    list = list.map(function (p) {
      var o = applyToProduct(p);
      var k = skuKey(o && (o.sku || o.codigo));
      if (k) seen[k] = true;
      return o;
    });
    extraProducts().forEach(function (p) {
      var k = skuKey(p.sku);
      if (!k || seen[k]) return;
      seen[k] = true;
      list.push(toCatalogProduct(p));
    });
    return list;
  }

  window.IZCZktecoOverlay = {
    load: load,
    get: get,
    price: price,
    isCreated: function (sku) { return isCreated(get(sku)); },
    applyToProduct: applyToProduct,
    toCatalogProduct: toCatalogProduct,
    extraProducts: extraProducts,
    forEach: forEach,
    mergeIntoCatalog: mergeIntoCatalog
  };

  load();
})();
