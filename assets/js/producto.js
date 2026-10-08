/* Logica de la ficha de producto. */
(function () {
  'use strict';

  var state = {
    catalogProduct: null,
    detail: null
  };

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function formatPriceEntry(entry) {
    if (window.IZCPrices && typeof window.IZCPrices.format === 'function') {
      return window.IZCPrices.format(entry);
    }
    if (entry == null) return null;
    if (typeof entry === 'object' && entry.currency === 'COP') {
      return '$ ' + Math.round(Number(entry.amount)).toLocaleString('es-CO') + ' COP';
    }
    var amount = typeof entry === 'object' ? entry.amount : entry;
    if (amount == null) return null;
    if (window.IZCMoney) return IZCMoney.formatUsd(amount);
    return '$ ' + Number(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function setMainImage(url, alt) {
    var img = document.getElementById('productMainImage');
    if (!img) return;
    img.src = url;
    img.alt = alt || '';
  }

  function bindGallery(images, alt) {
    var thumbs = document.getElementById('productThumbs');
    if (!thumbs) return;
    if (!images.length) {
      thumbs.innerHTML = '';
      return;
    }

    thumbs.innerHTML = images.map(function (item, index) {
      return (
        '<button type="button" class="product-thumb' + (index === 0 ? ' is-active' : '') + '" data-index="' + index + '">' +
          '<img src="' + escapeHtml(item.thumb || item.img || item.full) + '" alt="">' +
        '</button>'
      );
    }).join('');

    setMainImage(images[0].full || images[0].img, alt);

    thumbs.querySelectorAll('.product-thumb').forEach(function (btn) {
      btn.addEventListener('click', function () {
        thumbs.querySelectorAll('.product-thumb').forEach(function (el) {
          el.classList.remove('is-active');
        });
        btn.classList.add('is-active');
        var idx = Number(btn.getAttribute('data-index') || 0);
        var item = images[idx];
        if (item) setMainImage(item.full || item.img, alt);
      });
    });
  }

  function bindTabs() {
    var nav = document.getElementById('productTabNav');
    if (!nav) return;
    nav.querySelectorAll('button[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-tab');
        nav.querySelectorAll('button').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        document.querySelectorAll('.product-tab-panel').forEach(function (panel) {
          panel.classList.toggle('is-active', panel.id === id);
        });
      });
    });
  }

  function absoluteUrl(url) {
    var href = String(url || '').trim();
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    if (href.indexOf('//') === 0) return 'https:' + href;
    if (href.charAt(0) === '/') return 'https://izc.com.co' + href;
    return 'https://izc.com.co/' + href.replace(/^\.?\/+/, '');
  }

  var DOWNLOAD_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">' +
      '<path d="M8.5 6.5a.5.5 0 0 0-1 0v3.793L6.354 9.146a.5.5 0 1 0-.708.708l2 2a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0-.708-.708L8.5 10.293V6.5z"/>' +
      '<path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/>' +
    '</svg>';

  function renderFicha(rows) {
    var box = document.getElementById('productFicha');
    if (!box) return;
    if (!rows || !rows.length) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    var body = rows.map(function (row) {
      var href = absoluteUrl(row.fichaUrl);
      var link = href
        ? '<a class="ficha-download" href="' + escapeHtml(href) + '" target="_blank" rel="noopener" title="Descargar ficha técnica" aria-label="Descargar ficha técnica">' + DOWNLOAD_ICON + '</a>'
        : '—';
      return (
        '<tr>' +
          '<td>' + escapeHtml(row.tipo || '') + '</td>' +
          '<td>' + escapeHtml(row.modelo || '') + '</td>' +
          '<td>' + link + '</td>' +
        '</tr>'
      );
    }).join('');
    box.querySelector('tbody').innerHTML = body;
  }

  function renderAttributes(attrs) {
    var panel = document.getElementById('tab-detalles');
    if (!panel) return;
    if (!attrs || !attrs.length) {
      panel.innerHTML = '<p>No hay detalles adicionales para este producto.</p>';
      return;
    }
    panel.innerHTML =
      '<table class="product-attrs">' +
      attrs.map(function (row) {
        return '<tr><th>' + escapeHtml(row.label) + '</th><td>' + escapeHtml(row.value) + '</td></tr>';
      }).join('') +
      '</table>';
  }

  function loadJson(path) {
    if (window.IZCData && typeof window.IZCData.loadJson === 'function') {
      return window.IZCData.loadJson(path, { cache: 'no-store' });
    }
    return fetch(path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function applyPrice(sku) {
    var priceEl = document.getElementById('productPrice');
    if (!priceEl) return;
    priceEl.setAttribute('data-sku', String(sku));

    var loggedIn = window.IZCAuth && window.IZCAuth.isLoggedIn && window.IZCAuth.isLoggedIn();
    if (!loggedIn) {
      priceEl.textContent = 'Inicia sesión para ver el precio';
      priceEl.classList.add('price-locked');
      return;
    }
    priceEl.classList.remove('price-locked');

    var quoteUsd = Number(qs('usd'));
    if (isFinite(quoteUsd) && quoteUsd > 0) {
      var quoteText = formatPriceEntry({ amount: quoteUsd, currency: 'USD' });
      if (quoteText) {
        priceEl.textContent = quoteText;
        return;
      }
    }

    if (window.IZCPrices && typeof window.IZCPrices.get === 'function') {
      var cached = window.IZCPrices.get(sku);
      var cachedText = formatPriceEntry(cached);
      if (cachedText) {
        priceEl.textContent = cachedText;
        return;
      }
    }
    loadJson('assets/files/precios.json')
      .then(function (map) {
        if (!map) return;
        if (!(window.IZCAuth && window.IZCAuth.isLoggedIn && window.IZCAuth.isLoggedIn())) return;
        var value = map[sku] != null ? map[sku] : map[String(sku).replace(/^0+/, '')];
        var text = formatPriceEntry(value);
        if (text) priceEl.textContent = text;
      })
      .catch(function () {});
  }

  function bindWishlist(sku) {
    var btn = document.getElementById('productWishlistBtn');
    if (!btn || !window.IZCWishlist) return;

    function paint() {
      var liked = window.IZCWishlist.has(sku);
      btn.classList.toggle('is-liked', liked);
      btn.innerHTML = (liked ? '♥ ' : '♡ ') + (liked ? 'En la lista de deseos' : 'Añadir a la lista de deseos');
    }

    paint();
    btn.addEventListener('click', function () {
      window.IZCWishlist.toggle(sku);
      paint();
      if (window.IZCWishlist.updateHeaderBadge) window.IZCWishlist.updateHeaderBadge();
    });
    document.addEventListener('izc:wishlist-changed', paint);
  }

  function render(product, detail) {
    var root = document.getElementById('productDetail');
    var loading = document.getElementById('productLoading');
    var empty = document.getElementById('productEmpty');
    if (loading) loading.style.display = 'none';

    if (!product) {
      if (root) root.style.display = 'none';
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';
    if (root) root.style.display = 'block';

    detail = detail || {};
    var name = (product.zktecoOverlay && product.name) ? product.name : (detail.name || product.name || '');
    var sku = String(product.sku);
    var brandPage = product.brandPage || ((product.brand || '') + '.html');
    var images = (detail.images && detail.images.length)
      ? detail.images
      : (product.img ? [{ full: product.img, img: product.img, thumb: product.img }] : []);

    document.title = 'IZC MAYORISTA - ' + name;

    var title = document.getElementById('productTitle');
    var skuEl = document.getElementById('productSku');
    var resumen = document.getElementById('productResumen');
    var crumbBrand = document.getElementById('crumbBrand');
    var moreInfo = document.getElementById('tab-mas-info');

    if (title) title.textContent = name;
    if (skuEl) skuEl.textContent = 'SKU#: ' + sku;
    if (crumbBrand) {
      crumbBrand.textContent = product.brandName || product.brand || 'Marca';
      crumbBrand.href = brandPage;
    }

    if (resumen) {
      if (detail.resumenHtml) {
        resumen.innerHTML = detail.resumenHtml;
      } else if (detail.resumenText) {
        resumen.innerHTML = '<p>' + escapeHtml(detail.resumenText) + '</p>';
      } else {
        resumen.innerHTML = '<p>Consulta las especificaciones y detalles de este producto ' +
          escapeHtml(product.brandName || '') + '.</p>';
      }
    }

    if (moreInfo) {
      moreInfo.innerHTML = detail.descriptionHtml
        ? detail.descriptionHtml
        : '<p>No hay información adicional publicada para este producto.</p>';
    }

    bindGallery(images, name);
    renderFicha(detail.ficha || []);
    renderAttributes(detail.attributes || []);

    var downloads = document.getElementById('tab-descargas');
    if (downloads) {
      var links = (detail.ficha || []).filter(function (row) { return absoluteUrl(row.fichaUrl); });
      if (links.length) {
        downloads.innerHTML = '<ul class="ficha-download-list">' + links.map(function (row) {
          return '<li><a class="ficha-download" href="' + escapeHtml(absoluteUrl(row.fichaUrl)) + '" target="_blank" rel="noopener" title="Descargar ficha técnica" aria-label="Descargar ' + escapeHtml((row.tipo || 'Ficha') + ' ' + (row.modelo || '')) + '">' +
            DOWNLOAD_ICON +
            ' <span>' + escapeHtml((row.tipo || 'Ficha') + ' ' + (row.modelo || '')) + '</span>' +
            '</a></li>';
        }).join('') + '</ul>';
      } else {
        downloads.innerHTML = '<p>No hay descargas disponibles por ahora.</p>';
      }
    }

    bindTabs();
    bindWishlist(sku);
    applyPrice(sku);

    // hidden card for wishlist.js sku detection compatibility
    var mirror = document.getElementById('productMirrorCard');
    if (mirror) {
      mirror.setAttribute('data-sku', sku);
      mirror.innerHTML = '<span class="sku">Sku: ' + escapeHtml(sku) + '</span><button class="wishlist-btn" type="button" style="display:none">♡</button>';
      if (window.IZCWishlist) window.IZCWishlist.syncCardButtons(mirror);
    }
  }

  function boot() {
    var sku = qs('sku');
    if (!sku) {
      render(null, null);
      return;
    }

    var overlayReady = window.IZCZktecoOverlay && typeof IZCZktecoOverlay.load === 'function'
      ? IZCZktecoOverlay.load()
      : Promise.resolve(null);

    Promise.all([
      loadJson('assets/files/catalogo.json'),
      loadJson('assets/files/product_details.json').catch(function () { return {}; }),
      overlayReady
    ])
      .then(function (results) {
        var catalog = results[0];
        var details = results[1] || {};
        var product = (catalog.products || []).find(function (item) {
          return String(item.sku) === String(sku);
        });
        if (window.IZCZktecoOverlay) {
          if (product && typeof IZCZktecoOverlay.applyToProduct === 'function') {
            product = IZCZktecoOverlay.applyToProduct(product);
          } else if (!product && typeof IZCZktecoOverlay.get === 'function') {
            var ov = IZCZktecoOverlay.get(sku);
            if (ov && typeof IZCZktecoOverlay.toCatalogProduct === 'function') {
              product = IZCZktecoOverlay.toCatalogProduct(ov);
            }
          }
        }
        if (
          product &&
          window.IZCCatalogScope &&
          typeof IZCCatalogScope.isDemoProduct === 'function' &&
          IZCCatalogScope.isDemoProduct(product)
        ) {
          product = null;
        }
        state.catalogProduct = product || null;
        state.detail = product ? (details[String(sku)] || null) : null;
        render(state.catalogProduct, state.detail);
      })
      .catch(function (err) {
        console.error(err);
        render(null, null);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
