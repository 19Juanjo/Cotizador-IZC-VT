/* Carga unificada de JSON/data.js del catalogo y precios. */
(function () {
  'use strict';

  if (!window.IZCMoney) {
    (function initMoney() {
      function excelRoundDown(value, digits) {
        var v = Number(value);
        if (!isFinite(v)) return 0;
        digits = digits || 0;
        var sign = v < 0 ? -1 : 1;
        var factor = Math.pow(10, digits);
        var scaled = Math.abs(v) * factor;
        var nearest = Math.round(scaled);
        if (Math.abs(scaled - nearest) < 1e-7) scaled = nearest;
        return sign * Math.floor(scaled) / factor;
      }
      window.IZCMoney = {
        excelRoundDown: excelRoundDown,
        roundUsd: function (value) { return excelRoundDown(value, 2); },
        formatUsd: function (value, opts) {
          opts = opts || {};
          var n = excelRoundDown(value, 2);
          var prefix = opts.prefix != null ? opts.prefix : '$ ';
          return prefix + n.toLocaleString(opts.locale || 'en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          });
        },
        formatUsdLabel: function (value) {
          return 'USD ' + excelRoundDown(value, 2).toLocaleString('es-CO', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          });
        },
        formatUsdInput: function (value) {
          return excelRoundDown(value, 2).toLocaleString('es-CO', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          });
        }
      };
    })();
  }

  window.__IZC_DATA__ = window.__IZC_DATA__ || {};

  function dataScriptPath(jsonPath) {
    return String(jsonPath || '').replace(/\.json$/i, '.data.js');
  }

  function removeOldScripts(basePath) {
    document.querySelectorAll('script[data-izc-base="' + basePath + '"]').forEach(function (node) {
      node.remove();
    });
  }

  function loadScript(src, basePath) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.setAttribute('data-izc-base', basePath);
      script.setAttribute('data-izc-json', src);
      script.onload = function () {
        script.setAttribute('data-loaded', '1');
        resolve();
      };
      script.onerror = function () {
        reject(new Error('No se pudo cargar ' + src));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Carga JSON en http(s) y también en file:// (vía .data.js).
   * options.forceReload = true fuerza releer el archivo (útil al cambiar el Excel).
   */
  function loadJson(path, options) {
    options = options || {};
    var cacheMode = options.cache || 'no-store';
    var force = !!options.forceReload;

    if (location.protocol === 'file:') {
      var basePath = dataScriptPath(path);
      if (force) {
        delete window.__IZC_DATA__[path];
        removeOldScripts(basePath);
      } else if (Object.prototype.hasOwnProperty.call(window.__IZC_DATA__, path)) {
        return Promise.resolve(window.__IZC_DATA__[path]);
      }
      var scriptPath = basePath + '?t=' + Date.now();
      return loadScript(scriptPath, basePath).then(function () {
        if (!Object.prototype.hasOwnProperty.call(window.__IZC_DATA__, path)) {
          throw new Error('Sin datos para ' + path);
        }
        return window.__IZC_DATA__[path];
      });
    }

    var url = path + (force ? ((path.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now()) : '');
    return fetch(url, { cache: cacheMode }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + path);
      return response.json();
    }).catch(function (err) {
      // Fallback: algunos hostings no sirven JSON grandes; usar .data.js
      var basePath = dataScriptPath(path);
      if (force) {
        delete window.__IZC_DATA__[path];
        removeOldScripts(basePath);
      } else if (Object.prototype.hasOwnProperty.call(window.__IZC_DATA__, path)) {
        return window.__IZC_DATA__[path];
      }
      var scriptPath = basePath + '?t=' + Date.now();
      return loadScript(scriptPath, basePath).then(function () {
        if (!Object.prototype.hasOwnProperty.call(window.__IZC_DATA__, path)) {
          throw err || new Error('Sin datos para ' + path);
        }
        return window.__IZC_DATA__[path];
      });
    });
  }

  window.IZCData = {
    loadJson: loadJson,
    dataScriptPath: dataScriptPath
  };

  /* Alcance de catálogo: IZC (clientes sin SAT) / VALTECH (solo SAT) / asesores (todo). */
  window.IZCCatalogScope = (function () {
    function isValtechStore() {
      if (document.body && document.body.getAttribute('data-store') === 'valtech') return true;
      var path = String(location.pathname || '').toLowerCase();
      return /valtech\.html$|cotizador-valtech\.html$|perfil-valtech\.html$|favoritos-valtech\.html$|panel-sat\.html$|cotizador-sat\.html$|panel-gp\.html$/.test(path);
    }

    function isAsesorSession() {
      if (window.IZCAuth && typeof IZCAuth.isAsesor === 'function' && IZCAuth.isAsesor()) return true;
      return hasPrivilegedSessionHint() === 'asesor';
    }

    function isAdminSession() {
      if (window.IZCAuth && typeof IZCAuth.isAdmin === 'function' && IZCAuth.isAdmin()) return true;
      return hasPrivilegedSessionHint() === 'admin';
    }

    /** Lee rol/NIT de localStorage sin esperar a IZCAuth (evita bounce en sat.html). */
    function hasPrivilegedSessionHint() {
      try {
        var role = String(localStorage.getItem('izc_session_role') || '').toLowerCase();
        if (role === 'admin') return 'admin';
        if (role === 'asesor') return 'asesor';
        if (role === 'sat' || role === 'gp' || role === 'zkteco' || role === 'zebra') return 'admin';
        var raw = String(localStorage.getItem('izc_session_nit') || '').replace(/[\s.]/g, '').trim();
        if (/^v\d{1,4}$/i.test(raw)) return 'asesor';
        var nit = raw.replace(/-\d$/, '');
        if (nit === '03166122778' || nit.toUpperCase() === 'ADMINIZC') return 'admin';
        var up = nit.toUpperCase();
        if (up === 'SAT' || up === 'ADMINSAT' || up === 'ZKTECO' || /^GP\d{1,4}$/.test(up)) return 'admin';
      } catch (e) { /* ignore */ }
      return '';
    }

    function isSatProduct(product) {
      if (!product) return false;
      if (String(product.brand || '').toLowerCase() === 'sat') return true;
      // Unificar texto y quitar "SATA" (interfaz de disco), que no es la marca SAT.
      var blob = [product.name, product.brand, product.brandName, product.referencia, product.ref, product.sku]
        .join(' ')
        .toUpperCase()
        .replace(/SATA[A-Z0-9]*/g, ' ');
      // Cualquier "SAT" que quede = marca/producto SAT (SAT16T, TTSAT, SERVSATUPS05, etc.).
      return blob.indexOf('SAT') !== -1;
    }

    function isSatText(name, sku, referencia) {
      return isSatProduct({ name: name, sku: sku, referencia: referencia });
    }

    /** Texto buscable sin SATA, para que "sat" no encuentre discos SATA en IZC. */
    function searchBlobWithoutSata(text) {
      return String(text || '')
        .toUpperCase()
        .replace(/SATA[A-Z0-9]*/g, ' ');
    }

    function isSatBrand(brand) {
      if (!brand) return false;
      var id = String(brand.id || brand.brand || '').toLowerCase();
      if (id === 'sat') return true;
      var name = String(brand.name || '').toLowerCase();
      return name === 'sat' || /\bsat\b/.test(name);
    }

    /** Páginas internas (admin / asesor) — siempre con SAT. */
    function isInternalToolPage() {
      var path = String(location.pathname || '').toLowerCase();
      return /admin\.html$|asesor\.html$|cotizador-asesor\.html$|panel-sat\.html$|cotizador-sat\.html$|panel-gp\.html$|panel-zkteco\.html$/.test(path);
    }

    /** Tienda IZC de clientes (público): sin SAT. */
    function isIzcClientStorefront() {
      if (isValtechStore()) return false;
      if (isInternalToolPage()) return false;
      if (isAsesorSession() || isAdminSession()) return false;
      return true;
    }

    /** SAT permitido: VALTECH, paneles internos, o sesión asesor/admin en cualquier página. */
    function isSatAllowedPage() {
      if (isValtechStore()) return true;
      if (isInternalToolPage()) return true;
      if (isAsesorSession() || isAdminSession()) return true;
      return false;
    }

    /** Clientes IZC: sin SAT. Resto (admin, asesores, VALTECH): con SAT. */
    function allowSatOnCurrentPage() {
      return isSatAllowedPage();
    }

    function isDemoProduct(product) {
      if (!product) return false;
      var blob = [product.name, product.referencia, product.ref, product.sku, product.brandName]
        .join(' ')
        .toUpperCase();
      // "DEMO" como token (DEMO SAT…, PC42T DEMO, MWE-DEMO, …).
      return /(?:^|[^A-Z0-9])DEMO(?:[^A-Z0-9]|$)/.test(blob);
    }

    function isDemoText(name, sku, referencia) {
      return isDemoProduct({ name: name, sku: sku, referencia: referencia });
    }

    function filterProducts(products) {
      var list = Array.isArray(products) ? products : [];
      list = list.filter(function (p) { return !isDemoProduct(p); });
      if (isValtechStore()) {
        return list.filter(isSatProduct);
      }
      if (allowSatOnCurrentPage()) return list;
      return list.filter(function (p) { return !isSatProduct(p); });
    }

    function filterBrands(brands) {
      var list = Array.isArray(brands) ? brands : [];
      if (isValtechStore()) {
        return list.filter(isSatBrand);
      }
      if (allowSatOnCurrentPage()) return list.slice();
      return list.filter(function (b) { return !isSatBrand(b); });
    }

    /** Categorías del menú vacías en tienda clientes (solo SAT). En admin/asesor se muestran. */
    var SAT_ONLY_NAV_QUERIES = [
      'balanzas',
      'cajones',
      'seguridad',
      'cables',
      'energia',
      'grabadores-analogo',
      'accesorios-cctv'
    ];

    function navQueryFromHref(href) {
      var raw = String(href || '');
      if (!/buscar\.html/i.test(raw)) return '';
      try {
        var u = new URL(raw, location.href);
        return String(u.searchParams.get('q') || u.searchParams.get('tipo') || '')
          .trim()
          .toLowerCase();
      } catch (e) {
        var m = raw.match(/[?&](?:q|tipo)=([^&]+)/i);
        return m ? decodeURIComponent(m[1]).trim().toLowerCase() : '';
      }
    }

    function isSatOnlyNavQuery(q) {
      var id = String(q || '').trim().toLowerCase();
      if (!id) return false;
      if (SAT_ONLY_NAV_QUERIES.indexOf(id) >= 0) return true;
      if (id === 'alarmas') return true;
      return false;
    }

    function applyDomVisibility() {
      if (!document.body) return;
      var hideSat = isIzcClientStorefront();
      document.body.classList.toggle('hide-sat-brand', hideSat);
      document.body.classList.toggle('is-valtech-store', isValtechStore());
      document.body.classList.toggle('is-asesor-session', isAsesorSession());
      document.body.classList.toggle('is-admin-session', isAdminSession());
      document.body.classList.toggle('is-internal-tool', isInternalToolPage());

      // Enlaces / tarjetas de marca SAT: ocultos solo en tienda clientes.
      document.querySelectorAll('a[href="sat.html"], a[href="./sat.html"], a[href$="/sat.html"]').forEach(function (a) {
        // No subir al brand-row: solo ocultar el tile / card SAT.
        var card = a.closest('.brand-card, li.brand-card, .brand-column-sat');
        if (hideSat) {
          a.setAttribute('hidden', '');
          if (card) card.setAttribute('hidden', '');
        } else {
          a.removeAttribute('hidden');
          if (card) card.removeAttribute('hidden');
        }
      });
      document.querySelectorAll('.brand-column-sat').forEach(function (col) {
        if (hideSat) col.setAttribute('hidden', '');
        else col.removeAttribute('hidden');
      });
      document.querySelectorAll('.featured-brands-box .brand-row-4').forEach(function (row) {
        row.classList.toggle('is-sat-hidden', hideSat);
      });

      // Carrusel de marcas en sat.html: solo admin / asesor.
      var staffCarousel = isAdminSession() || isAsesorSession() || isInternalToolPage();
      document.querySelectorAll('.featured-brands-staff-only').forEach(function (box) {
        if (staffCarousel) box.removeAttribute('hidden');
        else box.setAttribute('hidden', '');
      });
      if (staffCarousel) {
        window.setTimeout(function () {
          try { window.dispatchEvent(new Event('resize')); } catch (e) { /* ignore */ }
        }, 40);
      }

      // Menú Balanzas / Cajones / etc.: ocultos solo en tienda clientes.
      document.querySelectorAll('a[href*="buscar.html"]').forEach(function (a) {
        var q = navQueryFromHref(a.getAttribute('href'));
        if (!isSatOnlyNavQuery(q)) return;
        var wrap = a.closest('.flyout-group, li, .search-type-tags a, option');
        if (hideSat) {
          if (wrap && wrap !== a) wrap.setAttribute('hidden', '');
          a.setAttribute('hidden', '');
        } else {
          if (wrap && wrap !== a) wrap.removeAttribute('hidden');
          a.removeAttribute('hidden');
        }
      });

      if (hideSat) {
        document.querySelectorAll('option[value="balanzas"], option[value="cajones"], option[value="seguridad"], option[value="cables"], option[value="energia"]').forEach(function (opt) {
          var path = String(location.pathname || '').toLowerCase();
          if (/buscar\.html$|marcas\.html$|favoritos\.html$|producto\.html$|cotizador\.html$|perfil\.html$/.test(path) || path.endsWith('/')) {
            opt.setAttribute('hidden', '');
            opt.disabled = true;
          }
        });
      } else {
        document.querySelectorAll('option[value="balanzas"], option[value="cajones"], option[value="seguridad"], option[value="cables"], option[value="energia"]').forEach(function (opt) {
          opt.removeAttribute('hidden');
          opt.disabled = false;
        });
      }
    }

    function guardSatBrandPage() {
      var path = String(location.pathname || '').toLowerCase();
      if (!/sat\.html$/.test(path)) return;
      // Admin / asesor: nunca expulsar (ni mientras carga la sesión).
      if (hasPrivilegedSessionHint() || allowSatOnCurrentPage()) return;

      function maybeRedirect() {
        if (hasPrivilegedSessionHint() || allowSatOnCurrentPage()) return;
        window.location.replace('marcas.html');
      }

      // Esperar a que auth termine de hidratar sesión antes de expulsar clientes.
      if (window.IZCAuth && typeof IZCAuth.whenSessionReady === 'function') {
        IZCAuth.whenSessionReady().then(maybeRedirect).catch(maybeRedirect);
        return;
      }
      window.setTimeout(maybeRedirect, 500);
    }

    function boot() {
      applyDomVisibility();
      document.addEventListener('izc:auth-changed', function () {
        applyDomVisibility();
        // Solo re-evaluar expulsión cuando ya hay veredicto de sesión.
        guardSatBrandPage();
      });
      if (window.IZCAuth && typeof IZCAuth.whenSessionReady === 'function') {
        IZCAuth.whenSessionReady().then(function () {
          applyDomVisibility();
          guardSatBrandPage();
        }).catch(function () {
          applyDomVisibility();
          guardSatBrandPage();
        });
      } else {
        window.setTimeout(function () {
          applyDomVisibility();
          guardSatBrandPage();
        }, 500);
      }
      window.setTimeout(function () { applyDomVisibility(); }, 0);
      window.setTimeout(function () { applyDomVisibility(); }, 400);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }

    return {
      isValtechStore: isValtechStore,
      isAsesorSession: isAsesorSession,
      isAdminSession: isAdminSession,
      isInternalToolPage: isInternalToolPage,
      isIzcClientStorefront: isIzcClientStorefront,
      isSatProduct: isSatProduct,
      isSatText: isSatText,
      isDemoProduct: isDemoProduct,
      isDemoText: isDemoText,
      searchBlobWithoutSata: searchBlobWithoutSata,
      isSatBrand: isSatBrand,
      isSatAllowedPage: isSatAllowedPage,
      allowSatOnCurrentPage: allowSatOnCurrentPage,
      isSatOnlyNavQuery: isSatOnlyNavQuery,
      filterProducts: filterProducts,
      filterBrands: filterBrands,
      applyDomVisibility: applyDomVisibility
    };
  })();
})();
