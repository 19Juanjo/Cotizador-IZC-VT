/* Buscador del header: sugerencias, tokens y redireccion a resultados. */
(function () {
  'use strict';

  var catalog = null;

  var SYNONYMS = {
    lector: ['scanner', 'escaner', 'barcode', 'codigo', 'barras', 'quickscan', 'imager'],
    camara: ['cctv', 'camera', 'ipc', 'seguridad', 'video', 'vigilancia'],
    monitor: ['pantalla', 'touch', 'tactil', 'lcd', 'display'],
    impresora: ['printer', 'etiqueta', 'etiquetas', 'termica'],
    terminal: ['movil', 'handheld', 'tablet', 'ck65', 'ck62', 'eda52', 'eda10'],
    huella: ['biometrico', 'biometricos', 'fingerprint', 'uareu'],
    grabador: ['nvr', 'dvr', 'recorder'],
    tarjeta: ['rfid', 'proximidad', 'card', 'omnikey'],
    codigo: ['barcode', 'barras', 'codigo'],
    honeywell: ['honewell', 'honey', 'voyager', 'xenon', 'orbit'],
    datalogic: ['data logic', 'magellan', 'quickscan'],
    imou: ['imo', 'ranger', 'cruiser', 'bullet', 'turret'],
    elo: ['pos', 'touchscreen'],
    hid: ['global', 'omnikey', 'uareu']
  };

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** En catálogo IZC público no navegar a marca/página SAT. */
  function satNavBlocked(brandId, page) {
    if (window.IZCCatalogScope && typeof IZCCatalogScope.allowSatOnCurrentPage === 'function') {
      if (IZCCatalogScope.allowSatOnCurrentPage()) return false;
    } else if (/valtech/i.test(String(location.pathname || ''))) {
      return false;
    }
    var b = String(brandId || '').toLowerCase();
    var p = String(page || '').toLowerCase();
    return b === 'sat' || p === 'sat.html' || /\/sat\.html$/.test(p);
  }

  function filterSatProducts(products) {
    var list = Array.isArray(products) ? products : [];
    if (!list.length) return list;
    if (window.IZCCatalogScope && typeof IZCCatalogScope.isSatProduct === 'function') {
      if (IZCCatalogScope.allowSatOnCurrentPage()) return list;
      return list.filter(function (p) { return !IZCCatalogScope.isSatProduct(p); });
    }
    return list.filter(function (p) {
      return String(p && p.brand || '').toLowerCase() !== 'sat';
    });
  }

  function isProductCode(word) {
    var w = String(word || '');
    return /[a-z]/.test(w) && /\d/.test(w);
  }

  function isPureDigits(word) {
    return /^\d+$/.test(String(word || ''));
  }

  /** Desglosa nombre/SKU en piezas buscables (N150, zd421t, sat, 11608, etc.). */
  function tokenize(text) {
    var n = normalize(text);
    if (!n) return [];
    var tokens = [];
    var re = /[a-z]+[0-9]+[a-z0-9]*|[0-9]+[a-z]+[a-z0-9]*|[a-z]{2,}|\d{2,}/g;
    var m;
    while ((m = re.exec(n)) !== null) {
      if (tokens.indexOf(m[0]) === -1) tokens.push(m[0]);
    }
    return tokens;
  }

  function paddedWords(text) {
    return ' ' + normalize(text).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }

  /** Códigos tipo N150: coincidencia exacta de token (no N1500). */
  function textHasExactCode(text, code) {
    var c = normalize(code);
    if (!c) return false;
    return paddedWords(text).indexOf(' ' + c + ' ') !== -1;
  }

  function productSearchText(product) {
    if (!product) return '';
    var text = [
      product.sku,
      product.name,
      product.referencia,
      product.ref,
      product.brandName,
      product.brand
    ].filter(Boolean).join(' ');
    // En IZC (clientes): no indexar "SATA" para que la búsqueda "sat" no traiga discos.
    if (
      window.IZCCatalogScope &&
      !IZCCatalogScope.isValtechStore() &&
      !IZCCatalogScope.allowSatOnCurrentPage() &&
      typeof IZCCatalogScope.searchBlobWithoutSata === 'function'
    ) {
      return IZCCatalogScope.searchBlobWithoutSata(text);
    }
    return text;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    var matrix = [];
    var i;
    var j;

    for (i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (i = 1; i <= b.length; i++) {
      for (j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  function expandWord(word) {
    var expanded = [word];
    var key;

    // Códigos de producto (N150, ZD421…): sin sinónimos ni expansiones
    if (isProductCode(word) || isPureDigits(word)) {
      return expanded;
    }

    for (key in SYNONYMS) {
      if (!Object.prototype.hasOwnProperty.call(SYNONYMS, key)) continue;
      var group = [key].concat(SYNONYMS[key]);
      var normalizedGroup = group.map(normalize);
      if (normalizedGroup.indexOf(word) !== -1) {
        expanded = expanded.concat(normalizedGroup);
      }
    }

    var unique = [];
    expanded.forEach(function (item) {
      if (unique.indexOf(item) === -1) unique.push(item);
    });
    return unique;
  }

  function expandQueryWords(query) {
    // Permite palabras mínimas de 2 caracteres (y códigos/SKU más cortos si aplica).
    var words = tokenize(query).filter(function (w) {
      return w.length >= 2;
    });
    // Si tokenize no capturó nada pero hay texto (ej. "n150" raro), usar el query normalizado.
    if (!words.length) {
      var raw = normalize(query).replace(/[^a-z0-9]+/g, ' ').trim();
      if (raw.length >= 2) words = raw.split(/\s+/).filter(function (w) { return w.length >= 2; });
    }
    var expanded = [];

    words.forEach(function (word) {
      expandWord(word).forEach(function (variant) {
        if (expanded.indexOf(variant) === -1) expanded.push(variant);
      });
    });

    return {
      original: words,
      expanded: expanded
    };
  }

  function isSimilarWord(queryWord, targetWord) {
    if (!queryWord || !targetWord) return false;
    if (queryWord === targetWord) return true;

    // Referencias tipo N150 / N140: solo coincidencia exacta del token
    if (isProductCode(queryWord) || isProductCode(targetWord)) {
      return false;
    }

    // Números puros: solo igualdad exacta (150 no entra en 3150)
    if (isPureDigits(queryWord) || isPureDigits(targetWord)) {
      return false;
    }

    // Prefijo / subcadena en palabras de letras (mínimo 2)
    if (/^[a-z]+$/.test(queryWord) && /^[a-z]+$/.test(targetWord)) {
      if (queryWord.length >= 2 && targetWord.indexOf(queryWord) !== -1) return true;
      if (targetWord.length >= 2 && queryWord.indexOf(targetWord) !== -1 && targetWord.length >= 3) return true;
      if (queryWord.length >= 6 && targetWord.length >= 6) {
        if (levenshtein(queryWord, targetWord) <= 1) return true;
      }
    }

    return false;
  }

  function textMatchesWord(text, word) {
    if (!word) return false;

    if (isProductCode(word) || isPureDigits(word)) {
      return textHasExactCode(text, word);
    }

    var tokens = tokenize(text);
    if (tokens.indexOf(word) !== -1) return true;

    // Palabra mínima: subcadena en el texto completo
    var hay = normalize(text);
    if (word.length >= 2 && hay.indexOf(word) !== -1) return true;

    return tokens.some(function (targetWord) {
      return isSimilarWord(word, targetWord);
    });
  }

  function scoreTextMatch(query, text) {
    var queryData = expandQueryWords(query);
    var originalWords = queryData.original;
    var expandedWords = queryData.expanded;
    var tokens = tokenize(text);
    var tokenSet = {};
    tokens.forEach(function (t) { tokenSet[t] = true; });
    var score = 0;
    var matchedOriginal = 0;

    if (!originalWords.length) return 0;

    originalWords.forEach(function (word) {
      var variants = expandWord(word);
      var exact = variants.some(function (variant) {
        if (isProductCode(variant) || isPureDigits(variant)) {
          return textHasExactCode(text, variant) || !!tokenSet[variant];
        }
        return !!tokenSet[variant];
      });
      var fuzzy = !exact && variants.some(function (variant) {
        return textMatchesWord(text, variant);
      });

      if (exact || fuzzy) {
        matchedOriginal++;
        if (exact) {
          score += isProductCode(word) || isPureDigits(word) ? 50 : 20;
        } else {
          score += 10;
        }
      }
    });

    // Sinónimos solo suman extra si no son códigos
    expandedWords.forEach(function (word) {
      if (isProductCode(word) || isPureDigits(word)) return;
      if (tokenSet[word] || normalize(text).indexOf(word) !== -1) score += 3;
    });

    if (matchedOriginal === 0) return 0;

    if (matchedOriginal === originalWords.length) {
      score += 30;
    } else if (matchedOriginal > 0) {
      // Exigir todas las palabras de la query para códigos mixtos
      var hasCode = originalWords.some(function (w) {
        return isProductCode(w) || isPureDigits(w);
      });
      if (hasCode) return 0;
      score += matchedOriginal * 6;
    }

    var qNorm = normalize(query);
    if (qNorm && (tokens.join(' ').indexOf(qNorm) !== -1 || normalize(text).indexOf(qNorm) !== -1)) {
      score += 20;
    }

    return score;
  }

  function scoreProductMatch(query, product) {
    var text = productSearchText(product);
    var score = scoreTextMatch(query, text);
    var q = String(query || '').trim();
    var sku = String((product && product.sku) || '');
    if (sku && normalize(sku) === normalize(q)) score = Math.max(score, 80);
    if (sku && isPureDigits(normalize(q)) && sku === normalize(q)) score = Math.max(score, 80);
    return score;
  }

  function getCurrentPage() {
    var path = window.location.pathname;
    return path.split('/').pop() || 'index.html';
  }

  function extractSku(query) {
    var cleaned = query.replace(/^sku\s*:?\s*/i, '').trim();
    if (/^\d+$/.test(cleaned)) {
      return cleaned;
    }
    return null;
  }

  function findProductsBySku(sku) {
    if (!catalog) return [];
    return catalog.products.filter(function (p) {
      return p.sku === sku;
    });
  }

  function findBrandMatch(query) {
    if (!catalog || query.length < 2) return null;
    var norm = normalize(query);
    var bestBrand = null;
    var bestScore = 0;

    catalog.brands.forEach(function (brand) {
      if (satNavBlocked(brand.id, brand.page)) return;
      var candidates = [brand.name].concat(brand.keywords || []);
      var brandScore = 0;

      candidates.forEach(function (candidate) {
        var candidateNorm = normalize(candidate);
        if (candidateNorm === norm) {
          brandScore = Math.max(brandScore, 100);
        } else if (candidateNorm.indexOf(norm) !== -1 || norm.indexOf(candidateNorm) !== -1) {
          brandScore = Math.max(brandScore, 70);
        } else if (isSimilarWord(norm, candidateNorm)) {
          brandScore = Math.max(brandScore, 55);
        } else {
          var score = scoreTextMatch(query, candidate);
          brandScore = Math.max(brandScore, score);
        }
      });

      if (brandScore > bestScore) {
        bestScore = brandScore;
        bestBrand = brand;
      }
    });

    return bestScore >= 50 ? bestBrand : null;
  }

  function skuMatchScore(query, sku) {
    var q = normalize(query);
    var s = String(sku || '');
    if (!q || !s) return 0;
    if (s === q) return 80;
    if (normalize(s) === q) return 80;
    if (isPureDigits(q) && s === q) return 80;
    // Código alfanumérico no se busca como subcadena del SKU numérico
    if (isProductCode(q)) return 0;
    return 0;
  }

  function findProductsByName(query) {
    if (!catalog || query.length < 2) return [];

    var words = expandQueryWords(query).original;
    var isCodeQuery = words.length === 1 && (isProductCode(words[0]) || isPureDigits(words[0]));
    var minScore = isCodeQuery ? 40 : 16;

    var scored = catalog.products.map(function (product) {
      var score = scoreProductMatch(query, product);
      return {
        product: product,
        score: score
      };
    }).filter(function (item) {
      return item.score >= minScore;
    }).sort(function (a, b) {
      return b.score - a.score;
    });

    return scored.map(function (item) {
      return item.product;
    });
  }

  function findProductType(query) {
    if (window.IZCBuscar && window.IZCBuscar.resolveType) {
      return window.IZCBuscar.resolveType(query);
    }

    var norm = normalize(query);
    var types = {
      lectores: ['lector', 'lectores', 'escaner', 'scanner', 'scaner', 'codigo de barras', 'barcode'],
      balanzas: ['balanza', 'balanzas'],
      impresoras: ['impresora', 'impresoras'],
      monitores: ['monitor', 'monitores', 'touch'],
      camaras: ['camara', 'camaras', 'cctv'],
      movilidad: ['terminal movil', 'movilidad', 'tablet'],
      huella: ['huella', 'biometrico', 'uareu'],
      tarjetas: ['tarjeta', 'rfid', 'omnikey'],
      control: ['control de acceso', 'torniquete', 'barrera'],
      grabadores: ['grabador', 'nvr'],
      digitalizadores: ['digitalizador', 'firma'],
      red: ['switch', 'router', 'access point', 'poe'],
      consumibles: ['consumible', 'ribbon'],
      equipos: ['equipo pos', 'todo en uno']
    };

    var bestId = null;
    var bestScore = 0;

    Object.keys(types).forEach(function (id) {
      types[id].forEach(function (keyword) {
        var keyNorm = normalize(keyword);
        if (norm === keyNorm || id === norm) {
          bestScore = 100;
          bestId = id;
        } else if (norm.indexOf(keyNorm) !== -1 && norm.length >= 3) {
          bestScore = Math.max(bestScore, 80);
          bestId = id;
        }
      });
    });

    return bestScore >= 70 ? bestId : null;
  }

  function countDistinctBrands(products) {
    var brands = {};
    products.forEach(function (product) {
      brands[product.brand] = true;
    });
    return Object.keys(brands).length;
  }

  function findProductsByType(typeId) {
    if (!catalog || !typeId) return [];
    return catalog.products.filter(function (product) {
      return product.type === typeId;
    });
  }

  function preferCurrentBrand(items, brandKey) {
    if (!items.length) return items;
    var current = getCurrentPage();
    var onPage = items.filter(function (item) {
      return item[brandKey] + '.html' === current;
    });
    return onPage.length ? onPage : items;
  }

  function resolveSearch(query) {
    query = String(query || '').trim();
    if (!query || !catalog) return null;

    var normQ = normalize(query);
    if ((normQ === 'sat' || normQ === 'satpcs') && satNavBlocked('sat', 'sat.html')) {
      return null;
    }

    var sku = extractSku(query);
    if (sku) {
      var skuProducts = filterSatProducts(findProductsBySku(sku));
      if (skuProducts.length) {
        var product = preferCurrentBrand(skuProducts, 'brand')[0];
        if (satNavBlocked(product.brand, product.brand + '.html')) {
          return {
            type: 'category',
            query: query,
            page: 'buscar.html'
          };
        }
        return {
          type: 'sku',
          brand: product.brand,
          sku: product.sku,
          page: product.brand + '.html'
        };
      }
    }

    // Subcategorías del menú (ej. lectores-de-mano) antes que tipos generales
    if (window.IZCBuscar && window.IZCBuscar.resolveSubtype) {
      var subtypeId = window.IZCBuscar.resolveSubtype(query);
      if (subtypeId) {
        return {
          type: 'category',
          query: subtypeId,
          page: 'buscar.html'
        };
      }
    } else {
      var maybeSubtype = String(query || '').trim().toLowerCase();
      if (/^(lectores|impresoras|camaras|grabadores|consumibles|control|accesorios|access|radio|routers|switch|mini|equipos|monitores|terminales|impresoras)-[a-z0-9-]+$/.test(maybeSubtype)) {
        return {
          type: 'category',
          query: maybeSubtype,
          page: 'buscar.html'
        };
      }
    }

    var productType = findProductType(query);
    if (productType) {
      var typeProducts = findProductsByType(productType);
      if (typeProducts.length) {
        return {
          type: 'category',
          query: productType,
          page: 'buscar.html'
        };
      }
    }

    var brand = findBrandMatch(query);
    if (brand && satNavBlocked(brand.id, brand.page)) {
      brand = null;
    }
    if (brand) {
      var exactBrand = normalize(brand.name) === normalize(query) ||
        (brand.keywords || []).some(function (k) { return normalize(k) === normalize(query); });
      var likelyBrandOnly = exactBrand || scoreTextMatch(query, brand.name) >= 70;

      if (likelyBrandOnly && normalize(query).length >= 3) {
        return {
          type: 'brand',
          brand: brand.id,
          page: brand.page
        };
      }
    }

    var products = findProductsByName(query);
    if (products.length) {
      // Siempre resultados globales (todas las marcas / todo el catálogo).
      return {
        type: 'category',
        query: query,
        page: 'buscar.html'
      };
    }

    if (brand) {
      return {
        type: 'brand',
        brand: brand.id,
        page: brand.page
      };
    }

    return null;
  }

  function buildTargetUrl(result) {
    if (!result) return null;
    if (satNavBlocked(result.brand, result.page)) {
      return 'buscar.html';
    }
    if (result.type === 'category') {
      return 'buscar.html?q=' + encodeURIComponent(result.query);
    }
    if (result.type === 'sku') {
      return result.page + '?sku=' + encodeURIComponent(result.sku);
    }
    if (result.type === 'query') {
      return result.page + '?q=' + encodeURIComponent(result.query);
    }
    return result.page;
  }

  function cardMatchesQuery(card, query) {
    var skuElem = card.querySelector('.sku');
    var titleElem = card.querySelector('.product-title');
    var skuText = skuElem ? skuElem.textContent : '';
    var titleText = titleElem ? titleElem.textContent : '';
    var combined = titleText + ' ' + skuText;

    return scoreTextMatch(query, combined) >= 16;
  }

  function updateItemCount(visible) {
    var itemCountDisplay = document.getElementById('itemCountDisplay');
    if (itemCountDisplay) {
      itemCountDisplay.textContent = visible + ' artículos';
    }
    var noProductsMsg = document.getElementById('noProductsMessage');
    if (noProductsMsg) {
      noProductsMsg.style.display = visible === 0 ? 'block' : 'none';
    }
  }

  function filterProductGrid(options) {
    var productGrid = document.getElementById('productGrid');
    if (!productGrid) return false;

    var productCards = productGrid.querySelectorAll('.product-card');
    if (!productCards.length) return false;

    var visible = 0;

    productCards.forEach(function (card) {
      var skuElem = card.querySelector('.sku');
      var skuText = skuElem ? skuElem.textContent.replace(/\D/g, '').trim() : '';
      var show = false;

      if (options.sku) {
        show = skuText === options.sku;
      } else if (options.query) {
        show = cardMatchesQuery(card, options.query);
      } else {
        show = true;
      }

      card.style.display = show ? 'flex' : 'none';
      if (show) visible++;
    });

    updateItemCount(visible);

    var searchInput = document.getElementById('searchInput');
    if (searchInput && (options.sku || options.query)) {
      searchInput.value = options.sku || options.query;
    }

    return true;
  }

  function applyUrlSearchFilter() {
    var params = new URLSearchParams(window.location.search);
    var paramSku = params.get('sku');
    var paramQuery = params.get('q');

    if (paramSku) {
      filterProductGrid({ sku: paramSku.replace(/\D/g, '').trim() });
      return;
    }

    if (paramQuery) {
      filterProductGrid({ query: paramQuery });
    }
  }

  function handleSearchSubmit(event) {
    event.preventDefault();

    var searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    var query = searchInput.value.trim();
    if (!query) return;

    var result = resolveSearch(query);
    if (!result) {
      window.location.href = 'buscar.html?q=' + encodeURIComponent(query);
      return;
    }

    if (satNavBlocked(result.brand, result.page)) {
      window.location.href = 'buscar.html?q=' + encodeURIComponent(query);
      return;
    }

    var targetUrl = buildTargetUrl(result);
    var currentPage = getCurrentPage();

    if (result.page === currentPage && document.getElementById('productGrid') && result.type !== 'category') {
      if (result.type === 'sku') {
        filterProductGrid({ sku: result.sku });
      } else if (result.type === 'query') {
        filterProductGrid({ query: result.query });
      }
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', targetUrl);
      }
      return;
    }

    window.location.href = targetUrl;
  }

  function initSearchForm() {
    var searchForm = document.getElementById('searchForm');
    if (!searchForm) return;

    searchForm.setAttribute('action', '#');
    searchForm.addEventListener('submit', handleSearchSubmit);
  }

  function init() {
    initSearchForm();
    applyUrlSearchFilter();
  }

  function loadCatalogJson() {
    if (window.IZCData && typeof window.IZCData.loadJson === 'function') {
      return window.IZCData.loadJson('assets/files/catalogo.json');
    }
    return fetch('assets/files/catalogo.json').then(function (response) {
      if (!response.ok) throw new Error('Catalog not found');
      return response.json();
    });
  }

  function loadOptionalJson(path) {
    var loader = window.IZCData && typeof window.IZCData.loadJson === 'function'
      ? window.IZCData.loadJson(path)
      : fetch(path).then(function (response) {
          if (!response.ok) throw new Error('not found');
          return response.json();
        });
    return loader.catch(function () {
      return {};
    });
  }

  function enrichCatalog(baseCatalog, productosMap, referenciasMap) {
    var data = baseCatalog && typeof baseCatalog === 'object' ? baseCatalog : { brands: [], products: [] };
    var products = Array.isArray(data.products) ? data.products.slice() : [];
    var bySku = {};
    var refs = referenciasMap && typeof referenciasMap === 'object' ? referenciasMap : {};
    var names = productosMap && typeof productosMap === 'object' ? productosMap : {};

    products.forEach(function (p) {
      if (!p || p.sku == null) return;
      var sku = String(p.sku);
      var copy = Object.assign({}, p);
      if (!copy.referencia) {
        copy.referencia = refs[sku] || refs[sku.replace(/^0+/, '')] || '';
      }
      bySku[sku] = copy;
    });

    Object.keys(names).forEach(function (sku) {
      var key = String(sku);
      if (bySku[key]) {
        if (!bySku[key].name) bySku[key].name = String(names[key] || '');
        if (!bySku[key].referencia) {
          bySku[key].referencia = refs[key] || refs[key.replace(/^0+/, '')] || '';
        }
        return;
      }
      bySku[key] = {
        sku: key,
        name: String(names[key] || ('Producto ' + key)),
        referencia: refs[key] || refs[key.replace(/^0+/, '')] || '',
        brand: 'izc',
        brandName: 'IZC',
        brandLogo: 'iconoizc.png',
        brandPage: 'buscar.html',
        img: 'assets/logo/iconoizc.png',
        category: 'otros',
        type: 'otros',
        subtype: '',
        subtypes: []
      };
    });

    // Adjuntar referencias sueltas aunque el SKU no esté en productos.
    Object.keys(refs).forEach(function (sku) {
      var key = String(sku);
      if (bySku[key]) {
        if (!bySku[key].referencia) bySku[key].referencia = String(refs[key] || '');
        return;
      }
      bySku[key] = {
        sku: key,
        name: String(names[key] || ('Producto ' + key)),
        referencia: String(refs[key] || ''),
        brand: 'izc',
        brandName: 'IZC',
        brandLogo: 'iconoizc.png',
        brandPage: 'buscar.html',
        img: 'assets/logo/iconoizc.png',
        category: 'otros',
        type: 'otros',
        subtype: '',
        subtypes: []
      };
    });

    data.products = Object.keys(bySku).map(function (k) { return bySku[k]; });
    if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.mergeIntoCatalog === 'function') {
      data.products = IZCZktecoOverlay.mergeIntoCatalog(data.products);
    }
    if (window.IZCCatalogScope) {
      data.products = IZCCatalogScope.filterProducts(data.products);
      data.brands = IZCCatalogScope.filterBrands(data.brands || []);
    }
    return data;
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

  Promise.all([
    loadCatalogJson(),
    loadOptionalJson('assets/files/productos.json'),
    loadOptionalJson('assets/files/referencias.json'),
    loadZktecoOverlay()
  ])
    .then(function (parts) {
      catalog = enrichCatalog(parts[0], parts[1], parts[2]);
      init();
    })
    .catch(function () {
      init();
    });

  document.addEventListener('izc:auth-changed', function () {
    if (!window.IZCCatalogScope) return;
    if (IZCCatalogScope.applyDomVisibility) IZCCatalogScope.applyDomVisibility();
    try {
      if (IZCCatalogScope.allowSatOnCurrentPage() && !IZCCatalogScope.isValtechStore()) {
        if (!sessionStorage.getItem('izc_sat_scope_reload')) {
          sessionStorage.setItem('izc_sat_scope_reload', '1');
          window.location.reload();
        }
      } else {
        sessionStorage.removeItem('izc_sat_scope_reload');
      }
    } catch (e) { /* ignore */ }
  });

  window.IZCSearch = {
    resolveSearch: resolveSearch,
    applyUrlSearchFilter: applyUrlSearchFilter,
    filterProductGrid: filterProductGrid,
    scoreTextMatch: scoreTextMatch,
    scoreProductMatch: scoreProductMatch,
    productSearchText: productSearchText,
    tokenize: tokenize,
    getCatalog: function () { return catalog; }
  };
})();