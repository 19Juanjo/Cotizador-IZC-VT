/* Panel Zebra: productos propios y listado de productos creados por asesores. */
(function () {
  'use strict';

  var activeTab = 'catalogo';
  var zebraProducts = [];
  var asesorProducts = [];
  var catalogProducts = [];
  var catalogQuery = '';
  var catalogCategory = '';
  var editingFrom = '';

  var CATEGORY_LABELS = {
    lectores: 'Lectores de Códigos de Barras',
    impresoras: 'Impresoras',
    'impresoras-carnet': 'Impresoras de Carnet',
    movilidad: 'Terminales Móviles',
    consumibles: 'Consumibles',
    cables: 'Cables y conectividad',
    otros: 'Otros'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setMessage(text, type) {
    var el = document.getElementById('zebraMessage');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'auth-message');
      return;
    }
    el.textContent = text || '';
    el.className = 'auth-message' + (type ? ' is-' + type : '');
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
          if (!data.ok && err.indexOf('accion no valida') >= 0 && i + 1 < endpoints.length) {
            return tryOne(i + 1);
          }
          if (!data.ok && err.indexOf('acción no válida') >= 0 && i + 1 < endpoints.length) {
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
    var base = { zebra_user: nit, admin_nit: nit, nit: nit };
    if (!extra) return base;
    Object.keys(extra).forEach(function (k) { base[k] = extra[k]; });
    return base;
  }

  function setActiveTab(tab) {
    activeTab = tab || 'catalogo';
    document.querySelectorAll('.admin-stat.is-tab').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-tab') === activeTab);
    });
    var catalogo = document.getElementById('zebraPanelCatalogo');
    var creados = document.getElementById('zebraPanelCreados');
    var crear = document.getElementById('zebraPanelCrear');
    var editar = document.getElementById('zebraPanelEditar');
    var asesor = document.getElementById('zebraPanelAsesor');
    if (catalogo) catalogo.hidden = activeTab !== 'catalogo';
    if (creados) creados.hidden = activeTab !== 'creados';
    if (crear) crear.hidden = activeTab !== 'crear';
    if (editar) editar.hidden = activeTab !== 'editar';
    if (asesor) asesor.hidden = activeTab !== 'asesor';
    if (activeTab === 'catalogo') loadCatalogProducts();
    if (activeTab === 'creados' || activeTab === 'editar' || activeTab === 'crear') loadZebraProducts();
    if (activeTab === 'asesor') loadAsesorProducts();
    if (activeTab === 'editar' && editingFrom) placeForm('editar');
    else if (activeTab === 'crear') placeForm('crear');
    else if (activeTab !== 'editar') placeForm('crear');
  }

  function placeForm(where) {
    var form = document.getElementById('zebraProductForm');
    var lead = document.getElementById('zebraFormLead');
    var crear = document.getElementById('zebraPanelCrear');
    var wrap = document.getElementById('zebraEditFormWrap');
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

  function oneLinePrice(text) {
    return String(text || '').replace(/\s+/g, ' ').replace(/ COP$/i, '\u00a0COP').trim();
  }

  function overlayForSku(sku) {
    var key = String(sku || '').trim().toUpperCase();
    if (!key) return null;
    var found = null;
    zebraProducts.forEach(function (p) {
      if (p && String(p.sku || '').trim().toUpperCase() === key) found = p;
    });
    return found;
  }

  function mergeCatalogProduct(p) {
    if (!p) return p;
    var o = overlayForSku(p.sku);
    if (!o) return p;
    var out = {};
    Object.keys(p).forEach(function (k) { out[k] = p[k]; });
    if (o.name) out.name = o.name;
    if (o.referencia) out.referencia = o.referencia;
    if (o.category) {
      out.category = o.category;
      out.type = o.category;
    }
    if (Number(o.unitario_usd) > 0) out.unitario_usd = o.unitario_usd;
    if (Number(o.unitario_cop) > 0) out.unitario_cop = o.unitario_cop;
    out.overlayId = o.id;
    return out;
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
    catalogProducts.forEach(function (p) {
      var k = categoryKey(p);
      if (k) keys[k] = true;
    });
    zebraProducts.forEach(function (p) {
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
    var sel = document.getElementById('zebraCategory');
    if (!sel) return;
    sel.innerHTML = categoryOptionsHtml(selected);
    if (selected) sel.value = selected;
  }

  function fillCategoryFilter() {
    var sel = document.getElementById('zebraCatalogCategory');
    if (!sel) return;
    var counts = {};
    catalogProducts.forEach(function (p) {
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

  function filteredCatalog() {
    var q = String(catalogQuery || '').trim().toLowerCase();
    var cat = String(catalogCategory || '').toLowerCase();
    return catalogProducts.map(mergeCatalogProduct).filter(function (p) {
      if (cat && categoryKey(p) !== cat) return false;
      if (!q) return true;
      var blob = [p.sku, p.name, p.referencia, p.subtype].join(' ').toLowerCase();
      return blob.indexOf(q) >= 0;
    });
  }

  function renderCatalog() {
    var body = document.getElementById('zebraCatalogoBody');
    var countEl = document.getElementById('zebraCatalogoCount');
    var meta = document.getElementById('zebraCatalogMeta');
    if (countEl) countEl.textContent = String(catalogProducts.length);
    if (!body) return;
    var rows = filteredCatalog();
    if (meta) {
      if (!catalogProducts.length) {
        meta.textContent = '';
      } else if (rows.length === catalogProducts.length) {
        meta.textContent = catalogProducts.length + ' productos';
      } else {
        meta.textContent = 'Mostrando ' + rows.length + ' de ' + catalogProducts.length;
      }
    }
    if (!catalogProducts.length) {
      body.innerHTML = '<tr><td colspan="5">No se encontraron productos de la marca Zebra.</td></tr>';
      return;
    }
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5">Ningún producto coincide con el filtro.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (p, idx) {
      var sku = String(p.sku || '');
      var href = 'producto.html?sku=' + encodeURIComponent(sku);
      return (
        '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><div><strong><a href="' + escapeHtml(href) + '">' + escapeHtml(p.name || '—') + '</a></strong></div>' +
          '<div class="admin-muted">SKU ' + escapeHtml(sku || '—') + '</div></td>' +
          '<td>' + escapeHtml(categoryLabel(p)) + '</td>' +
          '<td class="zebra-price">' + escapeHtml(catalogPrice(p)) + '</td>' +
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
          return { products: (bp && bp.zebra) || [] };
        });
      }),
      pricesReady
    ]).then(function (results) {
      var catalog = results[0] || {};
      var list = Array.isArray(catalog.products) ? catalog.products : [];
      catalogProducts = list.filter(function (p) {
        return p && String(p.brand || '').toLowerCase() === 'zebra';
      });
      if (!catalogProducts.length && Array.isArray(catalog.zebra)) {
        catalogProducts = catalog.zebra;
      }
      fillCategoryFilter();
      renderCatalog();
    }).catch(function () {
      catalogProducts = [];
      renderCatalog();
      setMessage('No se pudo cargar el catálogo Zebra.', 'error');
    });
  }

  function renderZebraList() {
    var createdOnly = zebraProducts.filter(function (p) {
      return String((p && p.source) || '') !== 'catalog';
    });
    var body = document.getElementById('zebraCreadosBody');
    var editBody = document.getElementById('zebraEditarBody');
    var countEl = document.getElementById('zebraCreadosCount');
    var editCount = document.getElementById('zebraEditarCount');
    if (countEl) countEl.textContent = String(createdOnly.length);
    if (editCount) editCount.textContent = String(zebraProducts.length);
    if (body) {
      if (!createdOnly.length) {
        body.innerHTML = '<tr><td colspan="6">Aún no hay productos Zebra creados.</td></tr>';
      } else {
        body.innerHTML = createdOnly.map(function (p, idx) {
          return (
            '<tr>' +
              '<td>' + (idx + 1) + '</td>' +
              '<td><div><strong>' + escapeHtml(p.name || '—') + '</strong></div>' +
              '<div class="admin-muted">SKU ' + escapeHtml(p.sku || '—') + '</div></td>' +
              '<td>' + escapeHtml(p.referencia || '—') + '</td>' +
              '<td>' + escapeHtml(formatUSD(p.unitario_usd)) + '</td>' +
              '<td>' + escapeHtml(formatCOP(p.unitario_cop)) + '</td>' +
              '<td>' + escapeHtml(formatDate(p.updated_at || p.created_at)) + '</td>' +
            '</tr>'
          );
        }).join('');
      }
    }
    if (editBody) {
      if (!zebraProducts.length) {
        editBody.innerHTML = '<tr><td colspan="6">No hay productos para editar.</td></tr>';
      } else {
        editBody.innerHTML = zebraProducts.map(function (p, idx) {
          return (
            '<tr>' +
              '<td>' + (idx + 1) + '</td>' +
              '<td><div><strong>' + escapeHtml(p.name || '—') + '</strong></div>' +
              '<div class="admin-muted">SKU ' + escapeHtml(p.sku || '—') + '</div></td>' +
              '<td>' + escapeHtml(p.referencia || '—') + '</td>' +
              '<td>' + escapeHtml(formatUSD(p.unitario_usd)) + '</td>' +
              '<td>' + escapeHtml(formatCOP(p.unitario_cop)) + '</td>' +
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

  function loadZebraProducts() {
    return postApi(actorPayload({ action: 'list_productos_zebra' })).then(function (data) {
      zebraProducts = (data && data.ok && Array.isArray(data.products)) ? data.products : [];
      renderZebraList();
      if (data && !data.ok) setMessage(data.error || 'No se pudieron cargar productos Zebra.', 'error');
    }).catch(function () {
      zebraProducts = [];
      renderZebraList();
      setMessage('No se pudo conectar con el servidor.', 'error');
    });
  }

  function renderAsesorProducts() {
    var body = document.getElementById('zebraAsesorBody');
    var countEl = document.getElementById('zebraAsesorCount');
    if (countEl) countEl.textContent = String(asesorProducts.length);
    if (!body) return;
    if (!asesorProducts.length) {
      body.innerHTML = '<tr><td colspan="6">Aún no hay productos creados por asesores.</td></tr>';
      return;
    }
    body.innerHTML = asesorProducts.map(function (p, idx) {
      var usd = Number(p.unitario_usd || p.unitarioUsd || p.usd || 0);
      var cop = Number(p.unitario_cop || p.unitarioCop || p.cop || 0);
      var price = usd > 0 ? formatUSD(usd) : formatCOP(cop);
      var seller = String(p.seller_codigo || '').trim();
      var sellerName = String(p.seller_name || '').trim();
      var sellerLabel = seller ? (sellerName ? seller + ' — ' + sellerName : seller) : (sellerName || '—');
      return (
        '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td><div><strong>' + escapeHtml(p.name || '—') + '</strong></div>' +
          '<div class="admin-muted">SKU ' + escapeHtml(p.sku || '—') + '</div></td>' +
          '<td>' + escapeHtml(p.referencia || '—') + '</td>' +
          '<td>' + escapeHtml(price) + '</td>' +
          '<td>' + escapeHtml(sellerLabel) + '</td>' +
          '<td>' + escapeHtml(formatDate(p.created_at)) + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function loadAsesorProducts() {
    return postApi(actorPayload({ action: 'list_productos_creados' })).then(function (data) {
      asesorProducts = (data && data.ok && Array.isArray(data.products)) ? data.products : [];
      renderAsesorProducts();
      if (data && !data.ok) setMessage(data.error || 'No se pudieron cargar productos de asesores.', 'error');
    }).catch(function () {
      asesorProducts = [];
      renderAsesorProducts();
    });
  }

  function fillForm(p) {
    fillFormCategoryOptions(p && p.category ? p.category : '');
    document.getElementById('zebraProductId').value = p && p.id ? p.id : '';
    document.getElementById('zebraSku').value = p && p.sku ? p.sku : '';
    document.getElementById('zebraName').value = p && p.name ? p.name : '';
    document.getElementById('zebraRef').value = p && p.referencia ? p.referencia : '';
    var catEl = document.getElementById('zebraCategory');
    if (catEl) catEl.value = p && p.category ? p.category : '';
    var srcEl = document.getElementById('zebraProductSource');
    if (srcEl) srcEl.value = p && p.source ? p.source : '';
    var parts = priceParts(p || {});
    var usdEl = document.getElementById('zebraUsd');
    var copEl = document.getElementById('zebraCop');
    if (usdEl) usdEl.value = parts.usd > 0 ? (Math.round(parts.usd * 100) / 100) : '';
    if (copEl) copEl.value = parts.cop > 0 ? Math.round(parts.cop) : '';
    var lead = document.getElementById('zebraFormLead');
    var btn = document.getElementById('zebraSaveBtn');
    if (p && (p.id || p.sku)) {
      if (lead) lead.textContent = 'Editando producto Zebra ' + (p.sku || '');
      if (btn) btn.textContent = 'Guardar cambios';
    } else {
      if (lead) lead.textContent = 'Completa los datos para crear un producto Zebra.';
      if (btn) btn.textContent = 'Guardar producto';
    }
  }

  function startEditCatalog(sku) {
    var found = null;
    catalogProducts.forEach(function (p) {
      if (p && String(p.sku || '') === String(sku || '')) found = p;
    });
    var merged = mergeCatalogProduct(found || { sku: sku });
    var overlay = overlayForSku(sku);
    var parts = priceParts(merged);
    fillForm({
      id: overlay && overlay.id ? overlay.id : '',
      sku: merged.sku || sku,
      name: merged.name || '',
      referencia: merged.referencia || '',
      category: categoryKey(merged),
      source: 'catalog',
      unitario_usd: parts.usd,
      unitario_cop: parts.cop
    });
    editingFrom = 'catalogo';
    setActiveTab('editar');
  }

  function clearForm() {
    fillForm(null);
  }

  function bind() {
    document.querySelectorAll('.admin-stat.is-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setActiveTab(btn.getAttribute('data-tab') || 'catalogo');
      });
    });
    var search = document.getElementById('zebraCatalogSearch');
    if (search) {
      search.addEventListener('input', function () {
        catalogQuery = search.value || '';
        renderCatalog();
      });
    }
    var catSel = document.getElementById('zebraCatalogCategory');
    if (catSel) {
      catSel.addEventListener('change', function () {
        catalogCategory = catSel.value || '';
        renderCatalog();
      });
    }
    var form = document.getElementById('zebraProductForm');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var product = {
          id: document.getElementById('zebraProductId').value,
          sku: document.getElementById('zebraSku').value,
          name: document.getElementById('zebraName').value,
          referencia: document.getElementById('zebraRef').value,
          category: document.getElementById('zebraCategory') ? document.getElementById('zebraCategory').value : '',
          source: document.getElementById('zebraProductSource') ? document.getElementById('zebraProductSource').value : '',
          unitario_usd: document.getElementById('zebraUsd').value,
          unitario_cop: document.getElementById('zebraCop').value
        };
        setMessage('Guardando…', '');
        postApi(actorPayload({ action: 'save_producto_zebra', product: product, id: product.id })).then(function (data) {
          if (!data || !data.ok) {
            setMessage((data && data.error) || 'No se pudo guardar.', 'error');
            return;
          }
          setMessage(data.message || 'Guardado.', 'ok');
          var fromCatalog = editingFrom === 'catalogo' || product.source === 'catalog';
          editingFrom = '';
          clearForm();
          placeForm('crear');
          loadZebraProducts().then(function () {
            if (fromCatalog) {
              loadCatalogProducts();
              setActiveTab('catalogo');
            } else {
              setActiveTab(product.id ? 'editar' : 'creados');
            }
          });
        }).catch(function () {
          setMessage('No se pudo guardar.', 'error');
        });
      });
    }
    var clearBtn = document.getElementById('zebraFormClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        editingFrom = '';
        clearForm();
      });
    }
    var catalogBody = document.getElementById('zebraCatalogoBody');
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
    var editBody = document.getElementById('zebraEditarBody');
    if (editBody) {
      editBody.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.getAttribute) return;
        var editId = t.getAttribute('data-edit');
        var delId = t.getAttribute('data-del');
        if (editId) {
          var found = null;
          zebraProducts.forEach(function (p) { if (p && p.id === editId) found = p; });
          fillForm(found || { id: editId, source: found && found.source });
          editingFrom = 'editar';
          setActiveTab('editar');
          return;
        }
        if (delId) {
          var askDel = (window.IZCAuth && typeof IZCAuth.confirm === 'function')
            ? IZCAuth.confirm({
                title: 'Eliminar producto',
                message: '¿Eliminar este producto Zebra?',
                confirmText: 'Sí, eliminar',
                cancelText: 'Cancelar',
                danger: true
              })
            : Promise.resolve(false);
          askDel.then(function (ok) {
            if (!ok) return;
            postApi(actorPayload({ action: 'delete_producto_zebra', id: delId })).then(function (data) {
              if (!data || !data.ok) {
                setMessage((data && data.error) || 'No se pudo eliminar.', 'error');
                return;
              }
              setMessage(data.message || 'Eliminado.', 'ok');
              loadZebraProducts();
            });
          });
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
    var okZebra = window.IZCAuth.isZebra && IZCAuth.isZebra();
    var okAdmin = window.IZCAuth.isAdmin && IZCAuth.isAdmin();
    if (!okZebra && !okAdmin) {
      if (IZCAuth.isAsesor && IZCAuth.isAsesor()) window.location.replace('asesor.html');
      else window.location.replace('perfil.html');
      return false;
    }
    if (greet) greet.textContent = 'Hola ' + (nombre || 'Zebra');
    return true;
  }

  function init() {
    bind();
    var ready = (window.IZCAuth && IZCAuth.whenSessionReady)
      ? IZCAuth.whenSessionReady()
      : Promise.resolve();
    ready.then(function () {
      if (!fillProfile()) return;
      setActiveTab('catalogo');
      loadZebraProducts();
      fillFormCategoryOptions('');
      loadAsesorProducts();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
