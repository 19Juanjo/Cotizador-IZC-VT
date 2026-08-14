/* Logica compartida para pintar catalogos por marca. */
(function () {
  'use strict';

  var state = {
    brand: null,
    allProducts: [],
    filterData: null,
    active: null, // { groupSlug, optionSlug, label, groupTitle, skus }
    category: null // type/category id from toolbar select
  };

  var CATEGORY_LABELS = {
    lectores: 'Lectores de Códigos de Barras',
    balanzas: 'Balanzas',
    impresoras: 'Impresoras',
    'impresoras-carnet': 'Impresoras de Carnet',
    'impresoras-manillas': 'Impresoras de Manillas',
    'monitores-touch': 'Monitores Touch',
    'equipos-pos': 'Equipos POS',
    'mini-pc': 'Mini PC',
    cajones: 'Cajones monederos',
    digitalizadores: 'Digitalizadores de Firmas',
    movilidad: 'Terminales Móviles',
    consumibles: 'Consumibles',
    cables: 'Cables y conectividad',
    energia: 'Energía / UPS',
    seguridad: 'Seguridad electrónica',
    control: 'Control de acceso',
    tarjetas: 'Lectores de Tarjetas',
    camaras: 'Cámaras',
    grabadores: 'Grabadores',
    otros: 'Otros'
  };

  function detectBrand() {
    var bodyBrand = document.body && document.body.getAttribute('data-brand');
    if (bodyBrand) return bodyBrand.toLowerCase();
    var page = (location.pathname.split('/').pop() || '').replace(/\.html$/i, '').toLowerCase();
    var known = ['datalogic', 'elo', 'hid', 'honeywell', 'imou', 'ruijie', 'sat', 'topaz', 'zebra', 'zkteco'];
    return known.indexOf(page) !== -1 ? page : null;
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isSat(product) {
    var blob = [product.name, product.brand, product.brandName].join(' ').toLowerCase();
    return /\bsat\b/.test(blob) || product.brand === 'sat';
  }

  function isImouMemoria(product) {
    var sku = String(product.sku || '');
    if (sku === '16621' || sku === '16622') return true;
    var cat = product.category || product.type || '';
    if (cat === 'memorias') return true;
    return /memoria|micro\s*sd/i.test(product.name || '');
  }

  function renderCard(product) {
    var brandPage = product.brandPage || ((product.brand || '') + '.html');
    var logo = product.brandLogo || ((product.brandName || product.brand || 'brand') + '.png');
    var category = product.category || product.type || '';
    if (state.brand === 'imou' && isImouMemoria(product)) {
      category = 'memorias';
    }
    var page = (state.brand === 'imou' && isImouMemoria(product)) ? '2' : '1';
    var link = 'producto.html?sku=' + encodeURIComponent(product.sku);
    var img = product.img || ('assets/imgmarcas/' + logo);
    return (
      '<div class="product-card" data-category="' + escapeHtml(category) + '" data-sku="' + escapeHtml(product.sku) + '" data-page="' + page + '">' +
        '<button class="wishlist-btn" type="button">♡</button>' +
        '<div class="product-img">' +
          '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(product.name) + '" onerror="this.src=\'assets/imgmarcas/' + escapeHtml(logo) + '\'">' +
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
  }

  function bindWishlist(root) {
    if (window.IZCWishlist && typeof window.IZCWishlist.syncCardButtons === 'function') {
      window.IZCWishlist.syncCardButtons(root || document);
      return;
    }
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
    return '$ ' + Number(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function paintPrices(root, mapaPrecios) {
    if (!root || !mapaPrecios) return;
    root.querySelectorAll('.product-card').forEach(function (tarjeta) {
      var skuElem = tarjeta.querySelector('.sku');
      var priceElem = tarjeta.querySelector('.price');
      if (!skuElem || !priceElem) return;
      var skuTexto = skuElem.textContent.replace(/\D/g, '').trim();
      if (!skuTexto) return;
      var entry = mapaPrecios[skuTexto];
      if (entry == null) {
        entry = mapaPrecios[skuTexto.replace(/^0+/, '')];
      }
      var text = formatPriceEntry(entry);
      if (text) priceElem.textContent = text;
    });
  }

  function applyPrices(root) {
    if (window.IZCPrices && typeof window.IZCPrices.apply === 'function') {
      window.IZCPrices.apply(root);
      return;
    }
    if (typeof window.cargarPreciosUSD === 'function') {
      window.cargarPreciosUSD();
      return;
    }
    var loadPrecios = window.IZCData && typeof window.IZCData.loadJson === 'function'
      ? window.IZCData.loadJson('assets/files/precios.json', { cache: 'no-store' })
      : fetch('assets/files/precios.json', { cache: 'no-store' }).then(function (response) {
          if (!response.ok) throw new Error('sin precios');
          return response.json();
        });
    loadPrecios
      .then(function (data) {
        if (data && !data.error) paintPrices(root, data);
      })
      .catch(function () { /* silencioso */ });
  }

  function localSkuSet() {
    var set = {};
    state.allProducts.forEach(function (p) {
      set[String(p.sku)] = true;
    });
    return set;
  }

  function optionLocalSkus(option) {
    var available = localSkuSet();
    var skus = (option.skus || []).filter(function (sku) {
      return available[String(sku)];
    });
    return skus;
  }

  function findOption(groupSlug, optionSlug) {
    if (!state.filterData || !state.filterData.groups) return null;
    for (var i = 0; i < state.filterData.groups.length; i++) {
      var group = state.filterData.groups[i];
      if (group.slug !== groupSlug) continue;
      for (var j = 0; j < group.options.length; j++) {
        var opt = group.options[j];
        if (opt.slug === optionSlug) {
          return { group: group, option: opt };
        }
      }
    }
    return null;
  }

  function setUrlFilter(active) {
    var url = new URL(window.location.href);
    url.searchParams.delete('sku');
    if (!active) {
      url.searchParams.delete('filtro');
      url.searchParams.delete('f');
    } else {
      url.searchParams.set('filtro', active.groupSlug + ':' + active.optionSlug);
    }
    if (state.category) {
      url.searchParams.set('cat', state.category);
    } else {
      url.searchParams.delete('cat');
    }
    history.replaceState({}, '', url.pathname + url.search + url.hash);
  }

  function productCategoryId(product) {
    return product.type || product.category || 'otros';
  }

  function productMatchesCategory(product, categoryId) {
    if (!categoryId || categoryId === 'all') return true;
    if (productCategoryId(product) === categoryId) return true;
    var subtypes = product.subtypes || [];
    if (subtypes.indexOf(categoryId) !== -1) return true;
    if (product.subtype === categoryId) return true;
    return false;
  }

  function collectBrandCategories() {
    var counts = {};
    state.allProducts.forEach(function (product) {
      var id = productCategoryId(product);
      counts[id] = (counts[id] || 0) + 1;
    });
    return Object.keys(counts)
      .sort(function (a, b) {
        if (counts[b] !== counts[a]) return counts[b] - counts[a];
        return String(CATEGORY_LABELS[a] || a).localeCompare(String(CATEGORY_LABELS[b] || b), 'es');
      })
      .map(function (id) {
        return {
          id: id,
          label: CATEGORY_LABELS[id] || id,
          count: counts[id]
        };
      });
  }

  function bindCategorySelect() {
    var select = document.getElementById('sortSelect');
    if (!select || !select.parentNode) return;

    // Quita listeners viejos de *-brand.js (capturaban la grilla vacía)
    var fresh = select.cloneNode(false);
    fresh.id = 'sortSelect';
    select.parentNode.replaceChild(fresh, select);
    select = fresh;

    var cats = collectBrandCategories();
    var html = '<option value="all">Todas las Categorías</option>';
    cats.forEach(function (cat) {
      html +=
        '<option value="' +
        escapeHtml(cat.id) +
        '">' +
        escapeHtml(cat.label) +
        '</option>';
    });
    select.innerHTML = html;

    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('cat');
    if (fromUrl && countsHas(cats, fromUrl)) {
      state.category = fromUrl;
      select.value = fromUrl;
    } else {
      state.category = null;
      select.value = 'all';
    }

    select.addEventListener('change', function () {
      var value = select.value || 'all';
      state.category = value === 'all' ? null : value;
      setUrlFilter(state.active);
      applyActiveFilter();
      var grid = document.getElementById('productGrid');
      if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function countsHas(cats, id) {
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].id === id) return true;
    }
    return false;
  }

  function renderActiveFilterBar() {
    var box = document.querySelector('.filter-box');
    if (!box) return;

    var existing = box.querySelector('.active-filters');
    if (existing) existing.remove();

    if (!state.active) return;

    var bar = document.createElement('div');
    bar.className = 'active-filters';
    bar.innerHTML =
      '<div class="active-filters-title">Ahora comprando por:</div>' +
      '<div class="active-filter-chip">' +
        '<span>' + escapeHtml(state.active.groupTitle) + ': ' + escapeHtml(state.active.label) + '</span>' +
        '<button type="button" class="active-filter-clear" aria-label="Quitar filtro">×</button>' +
      '</div>' +
      '<button type="button" class="clear-all-filters">Borrar todo</button>';

    var header = box.querySelector('.featured-header');
    if (header && header.nextSibling) {
      box.insertBefore(bar, header.nextSibling);
    } else {
      box.insertBefore(bar, box.firstChild);
    }

    bar.querySelector('.active-filter-clear').addEventListener('click', clearFilter);
    bar.querySelector('.clear-all-filters').addEventListener('click', clearFilter);
  }

  function renderProducts(products) {
    var grid = document.getElementById('productGrid');
    if (!grid) return;

    products = products.slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'es');
    });

    grid.innerHTML = products.map(renderCard).join('');
    updateCount(products.length);
    bindWishlist(grid);
    applyPrices(grid);

    var empty = document.getElementById('noProductsMessage');
    if (empty) {
      empty.style.display = products.length ? 'none' : 'block';
    }

    try {
      document.dispatchEvent(new CustomEvent('izc:brand-products-rendered', {
        detail: { brand: state.brand, count: products.length }
      }));
    } catch (e) { /* ignore */ }
  }

  function applyActiveFilter() {
    var products = state.allProducts;
    if (state.category) {
      products = products.filter(function (p) {
        return productMatchesCategory(p, state.category);
      });
    }
    if (state.active && state.active.skus && state.active.skus.length) {
      var allow = {};
      state.active.skus.forEach(function (sku) {
        allow[String(sku)] = true;
      });
      products = products.filter(function (p) {
        return allow[String(p.sku)];
      });
    }
    renderProducts(products);
    renderActiveFilterBar();
    highlightSidebar();
    syncCategorySelectValue();
  }

  function syncCategorySelectValue() {
    var select = document.getElementById('sortSelect');
    if (!select) return;
    var wanted = state.category || 'all';
    if (select.value !== wanted) {
      select.value = wanted;
    }
  }

  function clearFilter() {
    state.active = null;
    setUrlFilter(null);
    applyActiveFilter();
  }

  function activateOption(group, option) {
    var skus = optionLocalSkus(option);
    state.active = {
      groupSlug: group.slug,
      optionSlug: option.slug,
      groupTitle: group.title,
      label: option.label,
      skus: skus
    };
    setUrlFilter(state.active);
    applyActiveFilter();

    var grid = document.getElementById('productGrid');
    if (grid) {
      grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function highlightSidebar() {
    document.querySelectorAll('.filter-list a[data-filter-group]').forEach(function (a) {
      a.classList.remove('is-active');
    });
    if (!state.active) return;
    var sel =
      '.filter-list a[data-filter-group="' +
      state.active.groupSlug +
      '"][data-filter-option="' +
      state.active.optionSlug +
      '"]';
    var link = document.querySelector(sel);
    if (link) link.classList.add('is-active');
  }

  function renderSidebarFilters() {
    var box = document.querySelector('.filter-box');
    if (!box || !state.filterData || !Array.isArray(state.filterData.groups)) return;

    var header = box.querySelector('.featured-header');
    var html = '';
    if (header) {
      html += header.outerHTML;
    } else {
      html += '<div class="featured-header"><span>COMPRAR POR</span></div>';
    }

    state.filterData.groups.forEach(function (group) {
      var isColor = group.slug === 'color' || (group.options[0] && group.options[0].type === 'color');
      html += '<div class="filter-group" data-filter-group="' + escapeHtml(group.slug) + '">';
      html +=
        '<div class="filter-header"><span>' +
        escapeHtml(group.title) +
        '</span><span class="arrow">▲</span></div>';

      if (isColor) {
        html += '<ul class="filter-list filter-color-list">';
        group.options.forEach(function (opt) {
          var color = opt.color || '#cccccc';
          html +=
            '<li><a href="#" class="color-filter-link" data-filter-group="' +
            escapeHtml(group.slug) +
            '" data-filter-option="' +
            escapeHtml(opt.slug) +
            '" title="' +
            escapeHtml(opt.label) +
            '"><span class="color-swatch" style="background:' +
            escapeHtml(color) +
            '"></span></a></li>';
        });
        html += '</ul>';
      } else {
        html += '<ul class="filter-list">';
        group.options.forEach(function (opt) {
          var localCount = optionLocalSkus(opt).length;
          var count = localCount || opt.count || 0;
          html +=
            '<li><a href="#" data-filter-group="' +
            escapeHtml(group.slug) +
            '" data-filter-option="' +
            escapeHtml(opt.slug) +
            '">&rsaquo; ' +
            escapeHtml(opt.label) +
            ' <span class="count">' +
            count +
            '</span></a></li>';
        });
        html += '</ul>';
      }
      html += '</div>';
    });

    box.innerHTML = html;
    bindFilterHeaders(box);
    bindFilterLinks(box);
  }

  function bindFilterHeaders(root) {
    root.querySelectorAll('.filter-header').forEach(function (header) {
      header.addEventListener('click', function () {
        var list = this.nextElementSibling;
        var arrow = this.querySelector('.arrow');
        if (!list) return;
        if (list.style.display === 'none') {
          list.style.display = 'block';
          if (arrow) arrow.textContent = '▲';
        } else {
          list.style.display = 'none';
          if (arrow) arrow.textContent = '▼';
        }
      });
    });
  }

  function bindFilterLinks(root) {
    root.querySelectorAll('a[data-filter-group]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        var groupSlug = this.getAttribute('data-filter-group');
        var optionSlug = this.getAttribute('data-filter-option');
        var found = findOption(groupSlug, optionSlug);
        if (!found) return;
        activateOption(found.group, found.option);
      });
    });
  }

  function readFilterFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var raw = params.get('filtro') || params.get('f');
    if (!raw) return;
    var parts = raw.split(':');
    if (parts.length < 2) return;
    var found = findOption(parts[0], parts.slice(1).join(':'));
    if (!found) return;
    state.active = {
      groupSlug: found.group.slug,
      optionSlug: found.option.slug,
      groupTitle: found.group.title,
      label: found.option.label,
      skus: optionLocalSkus(found.option)
    };
  }

  function focusSkuFromQuery() {
    var params = new URLSearchParams(window.location.search);
    var sku = params.get('sku');
    if (!sku) return;
    var card = document.querySelector('.product-card[data-sku="' + sku + '"]');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.style.outline = '2px solid #0b5ed7';
  }

  function boot() {
    var brand = detectBrand();
    if (!brand) return;
    state.brand = brand;
    document.body.setAttribute('data-brand', brand);

    function loadJson(path) {
      if (window.IZCData && typeof window.IZCData.loadJson === 'function') {
        return window.IZCData.loadJson(path, { cache: 'no-store' });
      }
      return fetch(path, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }

    Promise.all([
      loadJson('assets/files/catalogo.json'),
      loadJson('assets/files/brand_filters.json').catch(function () {
        return null;
      })
    ])
      .then(function (results) {
        var catalog = results[0];
        var filters = results[1];

        state.allProducts = (catalog.products || []).filter(function (product) {
          if (product.brand !== brand) return false;
          // En la página SAT sí mostramos SAT; en otras marcas se excluyen cruces
          if (brand === 'sat') return true;
          return !isSat(product);
        });

        if (filters && filters[brand]) {
          state.filterData = filters[brand];
          renderSidebarFilters();
          readFilterFromUrl();
        }

        bindCategorySelect();
        applyActiveFilter();
        focusSkuFromQuery();
      })
      .catch(function (error) {
        console.error('No se pudo cargar el catálogo de marca:', error);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.IZCBrandCatalog = {
    detectBrand: detectBrand,
    clearFilter: clearFilter,
    setCategory: function (categoryId) {
      state.category = !categoryId || categoryId === 'all' ? null : categoryId;
      setUrlFilter(state.active);
      applyActiveFilter();
    }
  };
})();
