/* Muestra y gestiona la pagina de favoritos. */
(function () {
  'use strict';

  var grid = null;
  var titleEl = null;
  var subtitleEl = null;
  var catalogCache = null;

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isLoggedIn() {
    return !!(window.IZCWishlist && window.IZCWishlist.isLoggedIn
      ? window.IZCWishlist.isLoggedIn()
      : (window.IZCAuth && window.IZCAuth.isLoggedIn && window.IZCAuth.isLoggedIn()));
  }

  function currentNit() {
    if (window.IZCWishlist && window.IZCWishlist.currentNit) {
      return window.IZCWishlist.currentNit();
    }
    if (window.IZCAuth && window.IZCAuth.getSessionNit) {
      return window.IZCAuth.getSessionNit();
    }
    return '';
  }

  function isValtech() {
    return !!(window.IZCWishlist && IZCWishlist.isValtechStore && IZCWishlist.isValtechStore());
  }

  function renderCard(product) {
    var brandPage = product.brandPage || ((product.brand || '') + '.html');
    var logo = product.brandLogo || ((product.brandName || product.brand || 'brand') + '.png');
    var link = 'producto.html?sku=' + encodeURIComponent(product.sku);
    var img = product.img || ('assets/imgmarcas/' + logo);
    var mark = (window.IZCWishlist && IZCWishlist.FULL) ? IZCWishlist.FULL : '♥';
    return (
      '<div class="product-card" data-sku="' + escapeHtml(product.sku) + '">' +
        '<button class="wishlist-btn" type="button" aria-pressed="true">' + mark + '</button>' +
        '<div class="product-img">' +
          '<img src="' + escapeHtml(img) + '" alt="" loading="lazy" onerror="this.onerror=null;this.alt=\'\';this.src=\'assets/imgmarcas/' + escapeHtml(logo) + '\'">' +
        '</div>' +
        '<div class="product-info">' +
          '<span class="sku">Sku: ' + escapeHtml(product.sku) + '</span>' +
          '<span class="price">$ 0.00</span>' +
          '<h4 class="product-title">' +
            '<a href="' + escapeHtml(link) + '">' + escapeHtml(product.name) + '</a>' +
          '</h4>' +
        '</div>' +
      '</div>'
    );
  }

  function updateCount(count) {
    var itemCountDisplay = document.getElementById('itemCountDisplay');
    if (itemCountDisplay) {
      itemCountDisplay.textContent = count + ' artículos';
    }
    var empty = document.getElementById('noProductsMessage');
    if (empty) {
      empty.style.display = count === 0 ? 'block' : 'none';
    }
  }

  function applyPrices() {
    if (window.IZCPrices && grid) {
      window.IZCPrices.apply(grid);
      if (window.IZCPrices.load) {
        window.IZCPrices.load().then(function () {
          window.IZCPrices.apply(grid);
        });
      }
    }
  }

  function renderLoggedOut() {
    if (!grid) return;
    if (titleEl) titleEl.textContent = isValtech() ? 'Mis favoritos VALTECH' : 'Mis favoritos';
    if (subtitleEl) {
      subtitleEl.innerHTML =
        'Inicia sesión con tu NIT para ver tu panel de favoritos. ' +
        '<a href="login.html">Iniciar sesión</a>';
    }
    grid.innerHTML = '';
    updateCount(0);
  }

  function catalogProducts(catalog) {
    var list = (catalog && catalog.products) || [];
    if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.mergeIntoCatalog === 'function') {
      return IZCZktecoOverlay.mergeIntoCatalog(list);
    }
    return list;
  }

  function renderFavorites(catalog) {
    if (!grid) return;

    if (!isLoggedIn()) {
      renderLoggedOut();
      return;
    }

    var liked = window.IZCWishlist ? window.IZCWishlist.getAll() : [];
    var bySku = {};
    catalogProducts(catalog).forEach(function (product) {
      var k = String(product.sku || '');
      if (!k) return;
      bySku[k] = product;
      bySku[k.toUpperCase()] = product;
    });

    var products = liked
      .map(function (sku) {
        var s = String(sku || '');
        return bySku[s] || bySku[s.toUpperCase()];
      })
      .filter(Boolean);

    if (titleEl) titleEl.textContent = isValtech() ? 'Mis favoritos VALTECH' : 'Mis favoritos';
    if (subtitleEl) {
      if (products.length) {
        subtitleEl.textContent = products.length + ' producto(s) guardados.';
      } else {
        subtitleEl.textContent = isValtech()
          ? 'Aún no has marcado productos con la estrella.'
          : 'Aún no has marcado productos con el corazón.';
      }
    }

    grid.innerHTML = products.map(renderCard).join('');
    updateCount(products.length);
    applyPrices();

    if (window.IZCWishlist) {
      window.IZCWishlist.syncCardButtons(grid);
      window.IZCWishlist.updateHeaderBadge();
    }
  }

  function boot() {
    grid = document.getElementById('productGrid');
    titleEl = document.getElementById('searchResultsTitle');
    subtitleEl = document.getElementById('searchResultsSubtitle');

    var loadCatalog = window.IZCData && typeof window.IZCData.loadJson === 'function'
      ? window.IZCData.loadJson('assets/files/catalogo.json', { cache: 'no-store' })
      : fetch('assets/files/catalogo.json', { cache: 'no-store' }).then(function (response) {
          if (!response.ok) throw new Error('No catalog');
          return response.json();
        });

    loadCatalog
      .then(function (catalog) {
        if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.load === 'function') {
          return IZCZktecoOverlay.load().then(function () { return catalog; }).catch(function () { return catalog; });
        }
        return catalog;
      })
      .then(function (catalog) {
        catalogCache = catalog;
        renderFavorites(catalog);
        document.addEventListener('izc:wishlist-changed', function () {
          renderFavorites(catalogCache);
        });
        document.addEventListener('izc:auth-changed', function () {
          renderFavorites(catalogCache);
        });
      })
      .catch(function (error) {
        console.error('No se pudieron cargar los favoritos:', error);
        if (subtitleEl) subtitleEl.textContent = 'No se pudo cargar el catálogo.';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
