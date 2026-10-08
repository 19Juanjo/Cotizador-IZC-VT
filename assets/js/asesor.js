/* Panel del asesor: mis clientes e historial de cotizaciones. */
(function () {
  'use strict';

  var API_ORIGIN = 'http://127.0.0.1:8080';

  function isLocalHost() {
    var h = location.hostname;
    return h === '127.0.0.1' || h === 'localhost';
  }

  function siteBasePath() {
    if (window.IZCAuth && typeof IZCAuth.siteBasePath === 'function') {
      return IZCAuth.siteBasePath();
    }
    var path = String(location.pathname || '/');
    var i = path.lastIndexOf('/');
    if (i < 0) return '/';
    return path.slice(0, i + 1);
  }

  /** Mas reciente arriba, mas antiguo abajo. */
  function sortByNewestCreated(list, field) {
    var key = field || 'created_at';
    return (list || []).slice().sort(function (a, b) {
      var ta = String((a && (a[key] || a.activity_at || a.finished_at || a.updated_at)) || '');
      var tb = String((b && (b[key] || b.activity_at || b.finished_at || b.updated_at)) || '');
      if (ta !== tb) return tb.localeCompare(ta);
      return String((a && (a.id || a.nit || a.nombre)) || '').localeCompare(
        String((b && (b.id || b.nit || b.nombre)) || '')
      );
    });
  }

  function apiEndpoints() {
    var base = siteBasePath();
    // En WAMP/subcarpeta solo PHP. Evita /api/auth sin .php (Apache responde HTML).
    if (isLocalHost()) {
      return [base + 'api/asesor_list.php', API_ORIGIN + '/api/auth', base + 'api/auth.php'];
    }
    return [base + 'api/asesor_list.php', base + 'api/auth.php'];
  }

  function apiOfflineMessage(detail) {
    var base = isLocalHost()
      ? 'No se pudo cargar. Ejecuta tools\\ABRIR.bat.'
      : 'No se pudo cargar la API (' + siteBasePath() + 'api/auth.php).';
    if (detail) return base + ' ' + detail;
    return base;
  }
  var quotesCache = [];
  var nuevasCache = [];
  var duplicadasCache = [];
  var gpCache = [];
  var quotesPanelsLoaded = false;
  var clientesCache = [];
  var clientesLoaded = false;
  var clientesLoadPromise = null;
  var quotesPanelsLoadPromise = null;
  var panelSnapshotPersistTimer = null;
  var panelCounts = { nuevas: 0, historial: 0, duplicadas: 0, gp: 0 };
  var PANEL_SNAPSHOT_VERSION = 10;
  var PANEL_QUOTES_DIRTY_KEY = 'izc_asesor_panel_quotes_dirty';
  var quoteDetailsCache = {};
  var activeTab = 'clientes';
  var openDetailCtx = { idx: -1, mode: '', quoteId: '' };

  function panelSnapshotStorageKey(codigo) {
    return 'izc_asesor_panel_v' + PANEL_SNAPSHOT_VERSION + '_' + String(codigo || '').toUpperCase();
  }

  function schedulePanelSnapshotPersist() {
    if (panelSnapshotPersistTimer) {
      clearTimeout(panelSnapshotPersistTimer);
    }
    panelSnapshotPersistTimer = setTimeout(function () {
      panelSnapshotPersistTimer = null;
      persistPanelSnapshot();
    }, 200);
  }

  function snapshotStores() {
    var stores = [];
    try { if (window.localStorage) stores.push(localStorage); } catch (e1) { /* ignore */ }
    try { if (window.sessionStorage) stores.push(sessionStorage); } catch (e2) { /* ignore */ }
    return stores;
  }

  function readPanelSnapshotRaw(codigo) {
    if (!codigo) return null;
    var key = panelSnapshotStorageKey(codigo);
    var stores = snapshotStores();
    for (var s = 0; s < stores.length; s++) {
      try {
        var raw = stores[s].getItem(key);
        if (!raw) continue;
        var data = JSON.parse(raw);
        if (!data || data.v !== PANEL_SNAPSHOT_VERSION) continue;
        if (String(data.codigo || '').toUpperCase() !== String(codigo).toUpperCase()) continue;
        return data;
      } catch (e) { /* try next */ }
    }
    return null;
  }

  function persistPanelSnapshot() {
    var codigo = sessionCodigo() || peekSessionCodigo();
    if (!codigo) return;
    try {
      var prev = readPanelSnapshotRaw(codigo) || {};
      var payload = {
        v: PANEL_SNAPSHOT_VERSION,
        codigo: codigo,
        savedAt: new Date().toISOString(),
        clientesReady: !!(clientesLoaded || prev.clientesReady),
        quotesReady: !!(quotesPanelsLoaded || prev.quotesReady),
        clientes: clientesLoaded ? clientesCache : asFlatArray(prev.clientes),
        quotes: quotesPanelsLoaded ? quotesCache : asFlatArray(prev.quotes),
        nuevas: quotesPanelsLoaded ? nuevasCache : asFlatArray(prev.nuevas),
        duplicadas: quotesPanelsLoaded ? duplicadasCache : asFlatArray(prev.duplicadas),
        gp: quotesPanelsLoaded ? gpCache : asFlatArray(prev.gp),
        counts: quotesPanelsLoaded ? {
          nuevas: panelCounts.nuevas,
          historial: panelCounts.historial,
          duplicadas: panelCounts.duplicadas,
          gp: panelCounts.gp
        } : (prev.counts || { nuevas: 0, historial: 0, duplicadas: 0, gp: 0 })
      };
      var json = JSON.stringify(payload);
      snapshotStores().forEach(function (store) {
        try { store.setItem(panelSnapshotStorageKey(codigo), json); } catch (eSet) { /* quota */ }
      });
    } catch (e) { /* quota or private mode */ }
  }

  function peekSessionCodigo() {
    try {
      if (window.IZCAuth && IZCAuth.getSessionNit) {
        var live = String(IZCAuth.getSessionNit() || '').trim();
        if (live) return live;
      }
    } catch (e0) { /* ignore */ }
    try { return String(localStorage.getItem('izc_session_nit') || '').trim(); } catch (e1) { return ''; }
  }

  function restorePanelSnapshot(codigo) {
    var data = readPanelSnapshotRaw(codigo);
    if (!data) return false;
    clientesCache = asFlatArray(data.clientes);
    quotesCache = onlyPricedQuotes(data.quotes);
    nuevasCache = onlyPricedQuotes(data.nuevas);
    duplicadasCache = onlyPricedQuotes(data.duplicadas);
    gpCache = onlyPricedQuotes(data.gp || data.quotes_gp);
    var hasQuotes = quotesCache.length > 0 || nuevasCache.length > 0 || duplicadasCache.length > 0 || gpCache.length > 0;
    var hasClientes = clientesCache.length > 0;
    // Snapshot vacío no cuenta como "ya cargado" (evita quedar en 0 para siempre).
    if (!hasQuotes && !hasClientes) {
      quotesPanelsLoaded = false;
      clientesLoaded = false;
      panelCounts = { nuevas: 0, historial: 0, duplicadas: 0, gp: 0 };
      return false;
    }
    panelCounts = {
      nuevas: Number((data.counts && data.counts.nuevas) || nuevasCache.length || 0),
      historial: Number((data.counts && data.counts.historial) || quotesCache.length || 0),
      duplicadas: Number((data.counts && data.counts.duplicadas) || duplicadasCache.length || 0),
      gp: Number((data.counts && data.counts.gp) || gpCache.length || 0)
    };
    clientesLoaded = data.clientesReady != null ? !!data.clientesReady : hasClientes;
    quotesPanelsLoaded = data.quotesReady != null ? !!data.quotesReady : hasQuotes;
    if (!hasQuotes) quotesPanelsLoaded = false;
    if (!hasClientes) clientesLoaded = false;
    if (clientesLoaded) {
      var clientCount = document.getElementById('asesorClientCount');
      if (clientCount) clientCount.textContent = String(clientesCache.length);
    }
    if (quotesPanelsLoaded) {
      updateQuoteCounts({
        count_nuevas: panelCounts.nuevas,
        count_historial: panelCounts.historial,
        count_duplicadas: panelCounts.duplicadas,
        count_gp: panelCounts.gp
      });
    }
    return clientesLoaded || quotesPanelsLoaded;
  }

  function showQuoteCountsLoading() {
    ['asesorNuevasCount', 'asesorQuoteCount', 'asesorDuplicadasCount', 'asesorGpCount'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && !quotesPanelsLoaded) el.textContent = '…';
    });
  }

  function consumePanelQuotesDirty() {
    if (!window.sessionStorage) return false;
    try {
      if (sessionStorage.getItem(PANEL_QUOTES_DIRTY_KEY) !== '1') return false;
      sessionStorage.removeItem(PANEL_QUOTES_DIRTY_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  function markPanelQuotesDirty() {
    if (!window.sessionStorage) return;
    try {
      sessionStorage.setItem(PANEL_QUOTES_DIRTY_KEY, '1');
    } catch (e) { /* ignore */ }
  }

  function updateQuoteCounts(data) {
    if (data && typeof data.count_nuevas === 'number') {
      panelCounts.nuevas = data.count_nuevas;
    }
    if (data && typeof data.count_historial === 'number') {
      panelCounts.historial = data.count_historial;
    }
    if (data && typeof data.count_duplicadas === 'number') {
      panelCounts.duplicadas = data.count_duplicadas;
    }
    if (data && typeof data.count_gp === 'number') {
      panelCounts.gp = data.count_gp;
    }
    var nuevasEl = document.getElementById('asesorNuevasCount');
    var histEl = document.getElementById('asesorQuoteCount');
    var dupEl = document.getElementById('asesorDuplicadasCount');
    var gpEl = document.getElementById('asesorGpCount');
    if (data && typeof data.count_nuevas === 'number' && nuevasEl) {
      nuevasEl.textContent = String(data.count_nuevas);
    }
    if (data && typeof data.count_historial === 'number' && histEl) {
      histEl.textContent = String(data.count_historial);
    }
    if (data && typeof data.count_duplicadas === 'number' && dupEl) {
      dupEl.textContent = String(data.count_duplicadas);
    }
    if (data && typeof data.count_gp === 'number' && gpEl) {
      gpEl.textContent = String(data.count_gp);
    }
  }

  function maybeShowQuotesSyncHint(data, mode) {
    if (!data || !data.ok) return;
    var inFile = Number(data.quotes_in_file || 0);
    var matched = Number(data.quotes_matched || 0);
    if (inFile <= 0 || matched > 0) return;
    if (activeTab !== mode && activeTab !== 'clientes') return;
    setMessage(
      'Hay ' + inFile + ' cotización(es) en el sistema, pero ninguna corresponde a tus clientes o a tu código de asesor. ' +
      'Revisa que Bitrix esté activo y que el cliente esté en tu cartera.',
      'error'
    );
  }

  function getListForMode(mode) {
    if (mode === 'nuevas') return nuevasCache;
    if (mode === 'duplicadas') return duplicadasCache;
    if (mode === 'gp') return gpCache;
    return quotesCache;
  }

  function patchQuoteInAllCaches(quoteId, patch) {
    if (!quoteId) return;
    delete quoteDetailsCache[String(quoteId)];
    [quotesCache, duplicadasCache, nuevasCache, gpCache].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (q, i) {
        if (q && String(q.id) === String(quoteId)) {
          list[i] = Object.assign({}, q, patch);
        }
      });
    });
    schedulePanelSnapshotPersist();
  }

  /** Conserva cambios locales (estado, comentario, etc.) al recargar listados del servidor. */
  function mergeQuotesFromServer(incoming, existing) {
    if (!Array.isArray(incoming)) return incoming || [];
    if (!Array.isArray(existing) || !existing.length) return incoming;
    var byId = {};
    existing.forEach(function (q) {
      if (q && q.id) byId[String(q.id)] = q;
    });
    return incoming.map(function (q) {
      if (!q || !q.id) return q;
      var prev = byId[String(q.id)];
      if (!prev) return q;
      var merged = Object.assign({}, q);
      // Solo conservar estado local si el asesor lo cambió en esta sesión/servidor.
      if (prev.asesor_estado_by && String(prev.asesor_estado_by).trim()) {
        merged.asesor_estado = prev.asesor_estado;
        merged.asesor_estado_at = prev.asesor_estado_at;
        merged.asesor_estado_by = prev.asesor_estado_by;
      } else if (q.asesor_estado) {
        merged.asesor_estado = q.asesor_estado;
      }
      if (prev.fecha_cierre) merged.fecha_cierre = prev.fecha_cierre;
      if (prev.fecha_cierre_cliente && !merged.fecha_cierre_cliente) {
        merged.fecha_cierre_cliente = prev.fecha_cierre_cliente;
      }
      if (prev.asesor_comentario != null && String(prev.asesor_comentario) !== '') {
        merged.asesor_comentario = prev.asesor_comentario;
        merged.asesor_comentario_at = prev.asesor_comentario_at;
        merged.asesor_comentario_by = prev.asesor_comentario_by;
      }
      if (prev.empresa_editado_at) {
        merged.empresa = prev.empresa;
        merged.empresa_editado_at = prev.empresa_editado_at;
        merged.empresa_editado_by = prev.empresa_editado_by;
      }
      if (prev.flete_editado_at && prev.totals) {
        var serverTotals = (q.totals && typeof q.totals === 'object') ? q.totals : {};
        var prevTotals = prev.totals;
        merged.totals = Object.assign({}, serverTotals, prevTotals);
        // No perder montos del servidor si el snapshot viejo no los tenía.
        ['usdIva', 'copIva', 'usd', 'cop', 'totalConFlete', 'hasUsd', 'hasCop'].forEach(function (k) {
          var sv = serverTotals[k];
          var pv = merged.totals[k];
          if ((pv == null || pv === '' || Number(pv) === 0) && sv != null && sv !== '' && Number(sv) !== 0) {
            merged.totals[k] = sv;
          }
        });
        merged.flete_editado_at = prev.flete_editado_at;
        merged.flete_editado_by = prev.flete_editado_by;
      }
      // Propagar total_* del servidor siempre que venga.
      if (q.total_usd != null) merged.total_usd = q.total_usd;
      if (q.total_cop != null) merged.total_cop = q.total_cop;
      if (q.total_display) merged.total_display = q.total_display;
      if (prev.items && prev.items.length && (!q.items || !q.items.length)) {
        merged.items = prev.items;
        // Preferir montos del listado del servidor; no pisar con snapshot vacío.
        var prevT = (prev.totals && typeof prev.totals === 'object') ? prev.totals : {};
        var nextT = (q.totals && typeof q.totals === 'object') ? q.totals : {};
        merged.totals = Object.assign({}, prevT, nextT);
        ['usdIva', 'copIva', 'usd', 'cop', 'totalConFlete', 'hasUsd', 'hasCop', 'qty', 'empresa'].forEach(function (k) {
          var sv = nextT[k];
          var pv = merged.totals[k];
          if ((pv == null || pv === '' || Number(pv) === 0) && sv != null && sv !== '' && Number(sv) !== 0) {
            merged.totals[k] = sv;
          }
        });
        merged.trm = prev.trm || q.trm;
      }
      if (q.duplicated_from || q.recotizado_desde || q.is_duplicated || q.recotizado_by || q.duplicate_kind) {
        // Conservar recotización del asesor y duplicados Bitrix (mismo NIT+monto).
        if (
          (String(q.quote_source || '').toLowerCase() === 'asesor' && isDuplicatedQuote(q)) ||
          String(q.duplicate_kind || '') === 'bitrix_same_amount' ||
          (q.is_duplicated && (q.duplicated_from || q.recotizado_desde))
        ) {
          merged.duplicated_from = q.duplicated_from || q.recotizado_desde || merged.duplicated_from;
          merged.recotizado_desde = q.recotizado_desde || q.duplicated_from || merged.recotizado_desde;
          merged.recotizado_by = q.recotizado_by || merged.recotizado_by;
          merged.recotizado_at = q.recotizado_at || merged.recotizado_at;
          merged.duplicate_kind = q.duplicate_kind || merged.duplicate_kind;
          merged.is_duplicated = true;
        } else {
          delete merged.duplicated_from;
          delete merged.recotizado_desde;
          delete merged.recotizado_by;
          delete merged.recotizado_at;
          delete merged.duplicate_kind;
          delete merged.is_duplicated;
          delete merged.duplicated;
        }
      }
      if (prev.duplicated_from || prev.recotizado_desde || prev.recotizado_by || prev.duplicate_kind) {
        if (
          (String(prev.quote_source || merged.quote_source || '').toLowerCase() === 'asesor' && isDuplicatedQuote(prev)) ||
          String(prev.duplicate_kind || '') === 'bitrix_same_amount' ||
          (prev.is_duplicated && (prev.duplicated_from || prev.recotizado_desde))
        ) {
          merged.duplicated_from = prev.duplicated_from || prev.recotizado_desde || merged.duplicated_from;
          merged.recotizado_desde = prev.recotizado_desde || prev.duplicated_from || merged.recotizado_desde;
          merged.recotizado_by = prev.recotizado_by || merged.recotizado_by;
          merged.recotizado_at = prev.recotizado_at || merged.recotizado_at;
          merged.duplicate_kind = prev.duplicate_kind || merged.duplicate_kind;
          merged.is_duplicated = true;
        }
      }
      return merged;
    });
  }

  function refreshHistorialPanels() {
    applyAsesorQuotesFilter();
    applyAsesorDuplicadasFilter();
  }

  var messageTimer = null;
  function setMessage(text, type) {
    var el = document.getElementById('asesorMessage');
    if (!el) return;
    var clean = fixUtf8Mojibake(text || '');
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, clean, type, 'auth-message');
      return;
    }
    window.clearTimeout(messageTimer);
    messageTimer = null;
    el.textContent = clean;
    el.className = 'auth-message' + (type ? ' is-' + type : '');
    if (clean) {
      messageTimer = window.setTimeout(function () {
        if (el.textContent === clean) {
          el.textContent = '';
          el.className = 'auth-message';
        }
        messageTimer = null;
      }, 7000);
    }
  }

  /** Repara textos UTF-8 mal interpretados (ej. cotizaciÃ³n → cotización). */
  function fixUtf8Mojibake(str) {
    var s = String(str == null ? '' : str);
    if (!s || s.indexOf('Ã') < 0) return s;
    try {
      if (typeof TextDecoder !== 'undefined') {
        var bytes = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
        var decoded = new TextDecoder('utf-8').decode(bytes);
        if (decoded && decoded.indexOf('\uFFFD') < 0) return decoded;
      }
    } catch (e) { /* ignore */ }
    return s
      .replace(/cotizaciÃ³n/gi, 'cotización')
      .replace(/Ã³/g, 'ó')
      .replace(/Ã¡/g, 'á')
      .replace(/Ã©/g, 'é')
      .replace(/Ã­/g, 'í')
      .replace(/Ãº/g, 'ú')
      .replace(/Ã±/g, 'ñ');
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatDateOnly(value) {
    if (!value) return '—';
    var raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      var parts = raw.split('-');
      var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (isNaN(d.getTime())) return raw;
      return d.toLocaleDateString('es-CO', {
        year: 'numeric',
        month: 'short',
        day: '2-digit'
      });
    }
    var dt = new Date(raw);
    if (isNaN(dt.getTime())) return raw;
    return dt.toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    });
  }

  function toDateInputValue(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    var d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    if (m.length < 2) m = '0' + m;
    if (day.length < 2) day = '0' + day;
    return y + '-' + m + '-' + day;
  }

  function formatCOP(value) {
    return '$ ' + Math.round(Number(value) || 0).toLocaleString('es-CO') + ' COP';
  }

  function formatCOPDec(value) {
    return '$ ' + Number(value || 0).toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' COP';
  }

  function formatUSD(value) {
    if (window.IZCMoney) return IZCMoney.formatUsd(value);
    return '$ ' + Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatTrm(value) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return '—';
    return n.toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function lpLabel(lp) {
    var map = {
      web: 'Web',
      interna: 'Interna',
      volumen: 'Volumen',
      drm: 'Drm',
      franquicia: 'Franquicia',
      master: 'Master',
      ups: 'UPS',
      pv: 'PV',
      etiquetado: 'Etiquetado',
      contadoras: 'Contadoras',
      lp_promos: 'LP Promos'
    };
    var key = String(lp || '').trim().toLowerCase();
    return map[key] || (lp ? String(lp) : '—');
  }

  var IVA = 0.19;
  var cachedDefaultTrm = 0;
  var defaultTrmPromise = null;

  function loadDefaultTrm(force) {
    if (force) {
      cachedDefaultTrm = 0;
      defaultTrmPromise = null;
    }
    if (!force && cachedDefaultTrm > 0) return Promise.resolve(cachedDefaultTrm);
    if (defaultTrmPromise) return defaultTrmPromise;
    defaultTrmPromise = postApi({ action: 'get_trm' }).then(function (data) {
      var v = data && data.ok ? Number(data.value) : NaN;
      if (isFinite(v) && v > 0) cachedDefaultTrm = v;
      return cachedDefaultTrm;
    }).catch(function () {
      return fetch(siteBasePath() + 'data/trm.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('trm');
        return r.json();
      }).then(function (data) {
        var v = Number(data && data.value);
        if (isFinite(v) && v > 0) cachedDefaultTrm = v;
        return cachedDefaultTrm;
      }).catch(function () { return 0; });
    });
    return defaultTrmPromise;
  }

  function resolveQuoteTrm(quote) {
    var t = Number(quote && quote.trm);
    if (isFinite(t) && t > 0) return t;
    return cachedDefaultTrm > 0 ? cachedDefaultTrm : 0;
  }

  function withQuoteTrm(quote) {
    if (!quote || typeof quote !== 'object') return quote;
    var t = resolveQuoteTrm(quote);
    if (t > 0 && (!quote.trm || Number(quote.trm) <= 0)) {
      return Object.assign({}, quote, { trm: t });
    }
    return quote;
  }

  function resolveEmpresaForQuote(q) {
    var raw = String(
      (q && q.empresa) ||
      (q && q.totals && q.totals.empresa) ||
      ''
    ).trim();
    if (/VALTECH/i.test(raw)) return 'VALTECH MAYORISTA S.A.S.';
    if (/IZC/i.test(raw)) return 'IZC MAYORISTA S.A.S.';
    if (q && /VALTECH/i.test(String(q.seller_name || ''))) return 'VALTECH MAYORISTA S.A.S.';
    if (raw) return raw;
    return 'IZC MAYORISTA S.A.S.';
  }

  // UVT 2026: SAT POS AIO y SAT Verificador de precios con unitario ≤ umbral → sin IVA;
  // si el unitario > $2.618.700 → con IVA. Otros productos → siempre con IVA.
  var UVT_2026 = 52374;
  var UVT_EXENTO_MAX = UVT_2026 * 50; // $2.618.700

  function isAioEquipment(name, sku) {
    var s = (String(name || '') + ' ' + String(sku || '')).toUpperCase();
    if (!s.trim()) return false;
    if (/RIBBON|CINTA|TONER|CARTUCHO|CABLE|ROLLO|ETIQUETA|LABEL|LECTOR|SCANNER|ESCANER|ESCÁNER|HUELLA/.test(s)) {
      return false;
    }
    return /\bAIO\b/.test(s) || /ALL\s*[- ]?\s*IN\s*[- ]?\s*ONE/.test(s) || /TODO\s*EN\s*UNO/.test(s);
  }

  function isSatVerificadorPrecios(name, sku) {
    var s = (String(name || '') + ' ' + String(sku || '')).toUpperCase();
    if (!s.trim()) return false;
    if (!/SAT/.test(s)) return false;
    return /VERIFICADOR\s+(DE\s+)?PRECIOS/.test(s);
  }

  function isUvtExemptEligibleEquipment(name, sku) {
    return isAioEquipment(name, sku) || isSatVerificadorPrecios(name, sku);
  }

  function exceedsUvtThreshold(unitCopSinIva) {
    var u = Number(unitCopSinIva);
    return isFinite(u) && u > UVT_EXENTO_MAX;
  }

  function isIvaExemptUnit(unitCopSinIva, name, sku) {
    var u = Number(unitCopSinIva);
    if (!isFinite(u) || u <= 0) return false;
    if (!isUvtExemptEligibleEquipment(name, sku)) return false;
    return !exceedsUvtThreshold(u);
  }

  function lineUnitCopIva(line, trm) {
    if (!line) return 0;
    var qty = Math.max(1, Number(line.qty) || 1);
    if (line.copIva != null && isFinite(Number(line.copIva)) && Number(line.copIva) > 0) {
      return Number(line.copIva);
    }
    if (line.totalCopIva != null && isFinite(Number(line.totalCopIva))) {
      return Number(line.totalCopIva) / qty;
    }
    var sinIva = 0;
    if (line.copSinIva != null && isFinite(Number(line.copSinIva)) && Number(line.copSinIva) > 0) {
      sinIva = Number(line.copSinIva);
    } else if (line.cop != null && isFinite(Number(line.cop)) && Number(line.cop) > 0) {
      sinIva = Number(line.cop);
    } else if (trm > 0 && line.usd != null && isFinite(Number(line.usd)) && Number(line.usd) > 0) {
      sinIva = Number(line.usd) * trm;
    }
    if (sinIva > 0) {
      return Math.floor(sinIva * (1 + IVA) + 1e-9);
    }
    if (trm > 0) {
      if (line.usdIva != null && isFinite(Number(line.usdIva)) && Number(line.usdIva) > 0) {
        return Number(line.usdIva) * trm;
      }
      if (line.totalUsdIva != null && isFinite(Number(line.totalUsdIva))) {
        return (Number(line.totalUsdIva) / qty) * trm;
      }
    }
    return 0;
  }

  /** Precio unitario COP sin IVA (Prc. unitario del cotizador). */
  function sanitizeUsdCopPair(usd, cop, trm, prefer) {
    if (window.IZCMoney && typeof IZCMoney.alignUsdCop === 'function') {
      return IZCMoney.alignUsdCop(usd, cop, trm, prefer);
    }
    var u = Number(usd);
    var c = Number(cop);
    var rate = Number(trm);
    if (!isFinite(u) || u <= 0) u = NaN;
    if (!isFinite(c) || c <= 0) c = NaN;
    if (!isFinite(rate) || rate <= 0) rate = 0;
    function roundUsd2(v) {
      var sign = v < 0 ? -1 : 1;
      var scaled = Math.abs(Number(v) || 0) * 100;
      var nearest = Math.round(scaled);
      if (Math.abs(scaled - nearest) < 1e-7) scaled = nearest;
      return sign * Math.floor(scaled) / 100;
    }
    var pref = String(prefer || '').toLowerCase();
    if (isFinite(u) && u >= 5000) {
      if (!isFinite(c)) c = u;
      u = NaN;
      pref = 'cop';
    }
    if ((pref === 'cop' || !isFinite(u)) && isFinite(c) && rate > 0) {
      c = Math.round(c);
      return { usd: roundUsd2(c / rate), cop: c };
    }
    if (isFinite(u) && rate > 0) {
      u = roundUsd2(u);
      return { usd: u, cop: Math.round(u * rate) };
    }
    if (isFinite(c) && rate > 0) {
      c = Math.round(c);
      return { usd: roundUsd2(c / rate), cop: c };
    }
    return { usd: isFinite(u) ? roundUsd2(u) : 0, cop: isFinite(c) ? Math.round(c) : 0 };
  }

  function lineUnitCop(line, trm) {
    if (!line) return 0;
    var qty = Math.max(1, Number(line.qty) || 1);
    var rawUsd = line.usdList != null && Number(line.usdList) > 0
      ? Number(line.usdList)
      : (line.unitarioUsd != null ? line.unitarioUsd : line.usd);
    var rawCop = null;
    var rate = Number(trm);
    if (!isFinite(rate) || rate <= 0) rate = 0;
    // Con USD de lista, el peso es siempre USD×TRM (no PESOS Excel).
    if (!line.priceModified && line.listPesos != null && isFinite(Number(line.listPesos)) && Number(line.listPesos) > 0) {
      if (!(isFinite(Number(rawUsd)) && Number(rawUsd) > 0 && Number(rawUsd) < 5000 && rate > 1000)) {
        rawCop = Number(line.listPesos);
      }
    } else if (line.unitarioCop != null && isFinite(Number(line.unitarioCop)) && Number(line.unitarioCop) > 0) {
      rawCop = Number(line.unitarioCop);
    } else if (line.copSinIva != null && isFinite(Number(line.copSinIva)) && Number(line.copSinIva) > 0) {
      rawCop = Number(line.copSinIva);
    } else if (line.cop != null && isFinite(Number(line.cop)) && Number(line.cop) > 0) {
      rawCop = Number(line.cop);
    } else if (line.totalCop != null && isFinite(Number(line.totalCop)) && Number(line.totalCop) > 0) {
      rawCop = Number(line.totalCop) / qty;
    }
    var pair = sanitizeUsdCopPair(rawUsd, rawCop, trm, 'usd');
    if (pair.cop > 0) return pair.cop;
    if (trm > 0 && pair.usd > 0 && pair.usd < 5000) {
      return pair.usd * trm;
    }
    if (trm > 0 && line.usd != null && isFinite(Number(line.usd)) && Number(line.usd) > 0) {
      var only = sanitizeUsdCopPair(line.usd, NaN, trm, 'usd');
      return only.cop > 0 ? only.cop : Number(line.usd) * trm;
    }
    var withIva = lineUnitCopIva(line, trm);
    return withIva > 0 ? withIva / (1 + IVA) : 0;
  }

  function buildLiquidacionCop(quote) {
    quote = withQuoteTrm(quote);
    var totals = (quote && quote.totals) || {};
    var trm = resolveQuoteTrm(quote);
    var items = quoteItemsResolved(quote);
    var lines = items.map(function (line) {
      var qty = Math.max(1, Math.floor(Number(line.qty) || 1));
      var unitSinIva = lineUnitCop(line, trm);
      var unitIva = lineUnitCopIva(line, trm);
      var totalSinIva = (line.totalCop != null && isFinite(Number(line.totalCop)) && Number(line.totalCop) > 0)
        ? Number(line.totalCop)
        : unitSinIva * qty;
      if (totalSinIva <= 0 && unitSinIva > 0) totalSinIva = unitSinIva * qty;

      var exempt = isIvaExemptUnit(unitSinIva, line.name, line.sku, totalSinIva);
      var totalConIva = (line.totalCopIva != null && isFinite(Number(line.totalCopIva)) && Number(line.totalCopIva) > 0)
        ? Number(line.totalCopIva)
        : (unitIva > 0 ? unitIva * qty : totalSinIva * (1 + IVA));
      // Si el “con IVA” guardado es casi igual al sin IVA, recalcular 19 %.
      if (!exempt && totalSinIva > 0 && totalConIva <= totalSinIva * 1.05) {
        totalConIva = Math.floor(unitSinIva * (1 + IVA) + 1e-9) * qty;
      }

      // TOTAL a pagar del ítem: sin IVA si está exento (misma regla del PDF).
      var totalPayable = exempt ? totalSinIva : totalConIva;

      var display = { sku: '—', name: line.name || 'Producto' };
      if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.resolveLineDisplay === 'function') {
        display = IZCCotizacionPdf.resolveLineDisplay(line);
      } else {
        var skuRaw = String(line.sku || '').trim();
        var nameRaw = String(line.name || line.descripcion || '').trim() || 'Producto';
        if (skuRaw) {
          display = {
            sku: skuRaw,
            name: nameRaw.toUpperCase().indexOf(skuRaw.toUpperCase()) === 0
              ? nameRaw
              : (skuRaw + ' - ' + nameRaw)
          };
        } else {
          display = { sku: '—', name: nameRaw };
        }
      }
      var referencia = '—';
      if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.resolveReferencia === 'function') {
        referencia = IZCCotizacionPdf.resolveReferencia(line) || '—';
      } else {
        var refRaw = String(line.referencia || '').trim();
        if (refRaw && refRaw !== '—' && !/^bitrix\s*#/i.test(refRaw)) referencia = refRaw;
      }

      return {
        sku: display.sku,
        referencia: referencia,
        name: display.name,
        qty: qty,
        unitCop: unitSinIva,
        unitCopIva: unitIva,
        totalCopSinIva: totalSinIva,
        totalCop: totalConIva,
        totalPayable: totalPayable,
        ivaExempt: exempt
      };
    });

    // Siempre recalcular con UVT (no usar totalSinFlete guardado, que suele traer IVA).
    var subtotal = lines.reduce(function (sum, row) {
      return sum + (Number(row.totalPayable) || 0);
    }, 0);
    var subtotalSinIva = lines.reduce(function (sum, row) {
      return sum + (Number(row.totalCopSinIva) || 0);
    }, 0);

    var anyExempt = lines.some(function (row) { return !!row.ivaExempt; });
    var anyTaxed = lines.some(function (row) { return !row.ivaExempt; });
    var ivaMode = 'mixed';
    if (lines.length && anyExempt && !anyTaxed) ivaMode = 'exempt';
    else if (lines.length && anyTaxed && !anyExempt) ivaMode = 'taxed';

    var hasAsesorTotals =
      (totals.fleteAntesIva != null && isFinite(Number(totals.fleteAntesIva)) && Number(totals.fleteAntesIva) > 0) ||
      (totals.totalConFlete != null && isFinite(Number(totals.totalConFlete)) && Number(totals.totalConFlete) > 0);

    var fleteAntes = Number(totals.fleteAntesIva);
    if (!isFinite(fleteAntes) || fleteAntes < 0) fleteAntes = 0;

    var fleteIva = Number(totals.fleteIva);
    if (!isFinite(fleteIva) || fleteIva < 0) {
      fleteIva = fleteAntes * IVA;
    }
    if (fleteAntes > 0 && fleteIva > fleteAntes * 0.45) {
      fleteIva = fleteAntes * IVA;
    }

    // Cotizaciones Bitrix / cliente: sin flete guardado → estimar envío nacional
    // (< $1.500.000 sin IVA → $23.000 + IVA; ≥ → 1,85 % sobre mercancía sin IVA + IVA).
    var fleteRaw = String(totals.flete || quote.flete || '').trim();
    var fleteRate = Number(totals.flete_rate);
    var isGratis = /^gratis$/i.test(fleteRaw) || /flete\s*gratis/i.test(fleteRaw);
    var manuallyEdited = !!(quote.flete_editado_at || totals.flete_editado_at);
    var isNacional =
      !fleteRaw ||
      fleteRaw === '0.0185' ||
      Math.abs(Number(fleteRaw) - 0.0185) < 1e-9 ||
      /\bTCC\b/i.test(fleteRaw) ||
      /1\s*[,.]\s*85\s*%/i.test(fleteRaw) ||
      /env[ií]o\s*nacional/i.test(fleteRaw) ||
      (isFinite(fleteRate) && Math.abs(fleteRate - 0.0185) < 1e-9);

    if (!manuallyEdited && !isGratis && isNacional && subtotalSinIva > 0) {
      if (subtotalSinIva < 1500000) {
        if (fleteAntes <= 0) fleteAntes = 23000;
        fleteIva = fleteAntes * IVA;
      } else {
        // Pedido grande: 1,85 % sobre mercancía sin IVA + IVA del flete.
        if (fleteAntes <= 0) fleteAntes = subtotalSinIva * 0.0185;
        fleteIva = fleteAntes * IVA;
      }
      if (!fleteRaw) fleteRaw = 'Envío nacional 1,85 %';
    } else if (isNacional && !isGratis && fleteAntes > 0 && (!(fleteIva > 0) || totals.fleteAplicaIva === false)) {
      // Cotizaciones viejas guardadas sin IVA de flete → corregir al mostrar.
      fleteIva = fleteAntes * IVA;
    }

    var fleteConIva = fleteAntes + fleteIva;

    var totalPagar = subtotal + fleteConIva;

    // Recalcular USD desde el subtotal UVT (no usar usdEquiv guardado con IVA).
    var usdEquiv = trm > 0
      ? (window.IZCMoney ? IZCMoney.roundUsd(subtotal / trm) : subtotal / trm)
      : 0;

    return {
      lines: lines,
      trm: trm,
      empresa: totals.empresa || quote.empresa || '',
      lp: totals.lp || quote.lp || '',
      flete: fleteRaw || totals.flete || quote.flete || '',
      subtotal: subtotal,
      fleteAntes: fleteAntes,
      fleteIva: fleteIva,
      fleteConIva: fleteConIva,
      totalPagar: totalPagar,
      usdEquiv: usdEquiv,
      ivaMode: ivaMode,
      estimated: !hasAsesorTotals && !manuallyEdited
    };
  }

  function parseLocaleNumber(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return NaN;
    s = s.replace(/[$\s]|COP|USD/gi, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
      // 1.234,56 → 1234.56
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.indexOf(',') >= 0) {
      s = s.replace(',', '.');
    }
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function formatFleteInput(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function lineUnitUsd(line, trm) {
    if (!line) return 0;
    var qty = Math.max(1, Number(line.qty) || 1);
    var manualPrice = !!(line.priceModified || line.usdOverride != null || line.copOverride != null ||
      line.copIvaOverride != null || line.priceEditSource);
    // Precio editado por el asesor: no usar usdList de la LP.
    if (manualPrice) {
      var manualUsd = null;
      if (line.usdOverride != null && isFinite(Number(line.usdOverride)) && Number(line.usdOverride) > 0) {
        manualUsd = Number(line.usdOverride);
      } else if (line.unitarioUsd != null && isFinite(Number(line.unitarioUsd)) && Number(line.unitarioUsd) > 0) {
        manualUsd = Number(line.unitarioUsd);
      } else if (line.usd != null && isFinite(Number(line.usd)) && Number(line.usd) > 0) {
        manualUsd = Number(line.usd);
      } else if (line.usdIva != null && isFinite(Number(line.usdIva)) && Number(line.usdIva) > 0) {
        manualUsd = Number(line.usdIva) / (1 + IVA);
      }
      if (manualUsd != null) {
        return window.IZCMoney ? IZCMoney.roundUsd(manualUsd) : manualUsd;
      }
    }
    // Preferir USD de lista de la LP (columna dólar).
    if (line.usdList != null && isFinite(Number(line.usdList)) && Number(line.usdList) > 0) {
      var listU = Number(line.usdList);
      return window.IZCMoney ? IZCMoney.roundUsd(listU) : listU;
    }
    var rawUsd = line.unitarioUsd != null ? line.unitarioUsd : line.usd;
    var rawCop = line.unitarioCop != null ? line.unitarioCop
      : (line.copSinIva != null ? line.copSinIva : line.cop);
    var pair = sanitizeUsdCopPair(rawUsd, rawCop, trm, 'usd');
    if (pair.usd > 0) {
      return window.IZCMoney ? IZCMoney.roundUsd(pair.usd) : pair.usd;
    }
    if (line.usdIva != null && isFinite(Number(line.usdIva)) && Number(line.usdIva) > 0) {
      var u = Number(line.usdIva) / (1 + IVA);
      var fixed = sanitizeUsdCopPair(u, NaN, trm, 'usd');
      u = fixed.usd > 0 ? fixed.usd : u;
      return window.IZCMoney ? IZCMoney.roundUsd(u) : u;
    }
    if (line.totalUsdIva != null && isFinite(Number(line.totalUsdIva))) {
      var u2 = Number(line.totalUsdIva) / qty / (1 + IVA);
      var fixed2 = sanitizeUsdCopPair(u2, NaN, trm, 'usd');
      u2 = fixed2.usd > 0 ? fixed2.usd : u2;
      return window.IZCMoney ? IZCMoney.roundUsd(u2) : u2;
    }
    var unitCop = lineUnitCop(line, trm);
    if (trm > 0 && unitCop > 0) {
      return window.IZCMoney ? IZCMoney.roundUsd(unitCop / trm) : unitCop / trm;
    }
    return 0;
  }

  function lineUnitUsdIva(line, trm) {
    if (!line) return 0;
    var qty = Math.max(1, Number(line.qty) || 1);
    if (line.usdIva != null && isFinite(Number(line.usdIva)) && Number(line.usdIva) > 0) {
      return Number(line.usdIva);
    }
    if (line.totalUsdIva != null && isFinite(Number(line.totalUsdIva))) {
      return Number(line.totalUsdIva) / qty;
    }
    var sinIva = lineUnitUsd(line, trm);
    if (sinIva > 0) {
      return window.IZCMoney ? IZCMoney.roundUsd(sinIva * (1 + IVA)) : sinIva * (1 + IVA);
    }
    if (trm > 0) {
      var copIva = lineUnitCopIva(line, trm);
      if (copIva > 0) {
        return window.IZCMoney ? IZCMoney.roundUsd(copIva / trm) : copIva / trm;
      }
    }
    return 0;
  }

  function lineIsCopPriced(line, trm) {
    if (!line) return false;
    if (String(line.currency || '').toUpperCase() === 'COP') return true;
    var hasCop = (line.cop != null && Number(line.cop) > 0) ||
      (line.copSinIva != null && Number(line.copSinIva) > 0) ||
      (line.unitarioCop != null && Number(line.unitarioCop) > 0);
    var hasUsd = (line.usd != null && Number(line.usd) > 0) ||
      (line.unitarioUsd != null && Number(line.unitarioUsd) > 0);
    return hasCop && !hasUsd;
  }

  function formatCopyCopPrice(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatCopyUsdPrice(value) {
    if (window.IZCMoney && typeof IZCMoney.formatUsdInput === 'function') {
      return IZCMoney.formatUsdInput(value);
    }
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /** Texto plano para copiar/pegar (SKU + nombre / moneda + precio ± IVA). */
  function buildQuoteCopyText(quote, liqLines) {
    var trm = resolveQuoteTrm(quote);
    var items = quoteItemsResolved(quote);
    // Misma fuente/orden que la tabla de liquidación → no puede faltar un ítem.
    if (liqLines && liqLines.length) {
      return liqLines.map(function (row, idx) {
        var line = items[idx] || {};
        var header = String((row && row.name) || line.name || 'Producto').trim().toUpperCase();
        var sku = String((row && row.sku) || line.sku || '').trim();
        if (sku && sku !== '—' && header.indexOf(sku.toUpperCase()) !== 0) {
          header = (sku + ' - ' + header).toUpperCase();
        }
        var exempt = !!(row && row.ivaExempt);
        var copUnit = exempt
          ? (Number(row.unitCop) || 0)
          : (Number(row.unitCopIva) || 0);
        var usdUnit = exempt ? lineUnitUsd(line, trm) : lineUnitUsdIva(line, trm);
        if (!(usdUnit > 0) && trm > 0 && copUnit > 0) {
          usdUnit = window.IZCMoney ? IZCMoney.roundUsd(copUnit / trm) : (copUnit / trm);
        }
        var priceSuffix = exempt ? '' : ' CON IVA INCLUIDO';
        return header + '\n' +
          'USD  ' + formatCopyUsdPrice(usdUnit) + priceSuffix + '\n' +
          'COP ' + formatCopyCopPrice(copUnit) + priceSuffix;
      }).join('\n\n');
    }

    if (!items.length) return '';

    return items.map(function (line) {
      var qty = Math.max(1, Math.floor(Number(line.qty) || 1));
      var unitSinIva = lineUnitCop(line, trm);
      var totalSinIva = (line.totalCop != null && isFinite(Number(line.totalCop)) && Number(line.totalCop) > 0)
        ? Number(line.totalCop)
        : unitSinIva * qty;
      if (totalSinIva <= 0 && unitSinIva > 0) totalSinIva = unitSinIva * qty;

      var exempt = isIvaExemptUnit(unitSinIva, line.name, line.sku, totalSinIva);
      var display = { sku: '—', name: String(line.name || 'Producto') };
      if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.resolveLineDisplay === 'function') {
        display = IZCCotizacionPdf.resolveLineDisplay(line);
      }
      var header = String(display.name || 'Producto').trim().toUpperCase();

      var copUnit = exempt ? unitSinIva : lineUnitCopIva(line, trm);
      var usdUnit = exempt ? lineUnitUsd(line, trm) : lineUnitUsdIva(line, trm);
      var priceSuffix = exempt ? '' : ' CON IVA INCLUIDO';

      var priceLines = [
        'USD  ' + formatCopyUsdPrice(usdUnit) + priceSuffix,
        'COP ' + formatCopyCopPrice(copUnit) + priceSuffix
      ];

      return header + '\n' + priceLines.join('\n');
    }).join('\n\n');
  }

  function applyFleteToQuoteLocal(quote, fleteAntes, fleteIva) {
    var q = Object.assign({}, quote || {});
    var totals = Object.assign({}, (q.totals && typeof q.totals === 'object') ? q.totals : {});
    // Subtotal con regla UVT (igual que PDF / historial).
    var subtotal = buildLiquidacionCop(q).subtotal;
    var flete = Number(fleteAntes);
    if (!isFinite(flete) || flete < 0) flete = 0;
    var iva = Number(fleteIva);
    if (!isFinite(iva) || iva < 0) iva = flete * IVA;
    totals.totalSinFlete = subtotal;
    totals.fleteAntesIva = flete;
    totals.fleteIva = iva;
    totals.totalConFlete = subtotal + flete + iva;
    q.totals = totals;
    return q;
  }

  function liquidacionHtml(quote) {
    quote = withQuoteTrm(quote);
    var liq = buildLiquidacionCop(quote);
    var currentEmpresa = String(liq.empresa || resolveEmpresaForQuote(quote) || '').trim();
    if (!currentEmpresa) currentEmpresa = 'IZC MAYORISTA S.A.S.';
    var isValtech = /VALTECH/i.test(currentEmpresa);
    var empresaSelect =
      '<label class="admin-quote-empresa-filter">' +
        '<select id="asesorQuoteEmpresa" class="admin-quote-empresa-select" aria-label="Empresa">' +
          '<option value="VALTECH MAYORISTA S.A.S."' + (isValtech ? ' selected' : '') + '>VALTECH</option>' +
          '<option value="IZC MAYORISTA S.A.S."' + (!isValtech ? ' selected' : '') + '>IZC MAYORISTA</option>' +
        '</select>' +
      '</label>';
    var metaParts = [empresaSelect];
    var trmText = liq.trm > 0 ? ('TRM ' + formatTrm(liq.trm)) : 'TRM —';

    var rows = liq.lines.map(function (line) {
      var totalCell = escapeHtml(formatCOPDec(line.totalPayable)) +
        (line.ivaExempt
          ? ' <span class="admin-quote-iva-tag">Exento IVA</span>'
          : ' <span class="admin-quote-iva-tag">Con IVA</span>');
      return (
        '<tr>' +
          '<td>' + escapeHtml(line.sku) + '</td>' +
          '<td>' + escapeHtml(line.referencia || '—') + '</td>' +
          '<td>' + escapeHtml(line.name) + '</td>' +
          '<td>' + line.qty + '</td>' +
          '<td class="admin-quote-money">' + escapeHtml(formatCOPDec(line.unitCop)) + '</td>' +
          '<td class="admin-quote-money">' + escapeHtml(formatCOPDec(line.unitCopIva)) + '</td>' +
          '<td class="admin-quote-money">' + escapeHtml(formatCOPDec(line.totalCopSinIva)) + '</td>' +
          '<td class="admin-quote-money">' + totalCell + '</td>' +
        '</tr>'
      );
    }).join('');

    var subtotalLabel =
      liq.ivaMode === 'exempt'
        ? 'Subtotal productos (exento de IVA)'
        : (liq.ivaMode === 'taxed'
          ? 'Subtotal productos (COP + IVA)'
          : 'Subtotal productos (mixto IVA / exento)');

    return (
      '<table class="admin-quote-detail-table admin-quote-detail-table-cop">' +
        '<thead><tr>' +
          '<th>SKU</th><th>Referencia</th><th>Producto</th><th>Cant.</th>' +
          '<th>Prc. unitario</th><th>P.V. COP + IVA</th>' +
          '<th>Total COP sin IVA</th><th>Total</th>' +
        '</tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="8">Sin productos</td></tr>') + '</tbody>' +
      '</table>' +
      '<div class="admin-quote-liquidacion" id="asesorQuoteLiquidacion" data-subtotal="' + escapeHtml(String(liq.subtotal)) + '">' +
        '<div class="admin-quote-liquidacion-head">' +
          '<h4>Liquidación COP</h4>' +
          '<p class="admin-quote-liquidacion-trm">' + escapeHtml(trmText) + '</p>' +
          '<p class="admin-quote-liquidacion-meta">' + metaParts.join(' · ') + '</p>' +
        '</div>' +
        '<dl class="admin-quote-liquidacion-rows">' +
          '<div><dt>' + escapeHtml(subtotalLabel) + '</dt><dd id="asesorLiqSubtotal">' + escapeHtml(formatCOPDec(liq.subtotal)) + '</dd></div>' +
          '<div class="admin-quote-flete-row">' +
            '<dt>Flete antes de IVA</dt>' +
            '<dd>' +
              '<input type="text" inputmode="decimal" class="admin-quote-flete-input" id="asesorQuoteFleteInput" ' +
                'value="' + escapeHtml(formatFleteInput(liq.fleteAntes)) + '" ' +
                'aria-label="Editar flete antes de IVA" title="Editar flete">' +
            '</dd>' +
          '</div>' +
          '<div class="admin-quote-flete-row">' +
            '<dt>IVA flete (19 %)</dt>' +
            '<dd>' +
              '<input type="text" inputmode="decimal" class="admin-quote-flete-input" id="asesorQuoteFleteIvaInput" ' +
                'value="' + escapeHtml(formatFleteInput(liq.fleteIva)) + '" ' +
                'aria-label="Editar IVA del flete" title="Editar IVA flete">' +
            '</dd>' +
          '</div>' +
          '<div class="is-total"><dt>TOTAL A PAGAR</dt><dd id="asesorLiqTotal">' + escapeHtml(formatCOPDec(liq.totalPagar)) + '</dd></div>' +
          '<div><dt>Equivalente USD</dt><dd id="asesorLiqUsd">' + escapeHtml(formatUSD(liq.usdEquiv)) + '</dd></div>' +
        '</dl>' +
        '<p class="admin-quote-flete-status" id="asesorQuoteFleteStatus" aria-live="polite"></p>' +
        (liq.estimated
          ? '<p class="admin-quote-liquidacion-note">Liquidación estimada: flete calculado como envío nacional (editable). Confirma empresa/flete al cotizar.</p>'
          : '') +
      '</div>' +
      (function () {
        var copyText = buildQuoteCopyText(quote, liq.lines);
        if (!copyText) return '';
        // 3 líneas por producto (nombre + USD + COP) + separador; sin tope bajo que oculte ítems.
        var rows = Math.max(6, (liq.lines.length * 4) - 1);
        return (
          '<div class="admin-quote-copy-block">' +
            '<textarea class="admin-quote-copy-text" id="asesorQuoteCopyText" readonly rows="' + rows + '" ' +
              'aria-label="Texto de productos para copiar">' +
              escapeHtml(copyText) +
            '</textarea>' +
            '<div class="admin-quote-copy-actions">' +
              '<button type="button" class="admin-quote-copy-btn" id="asesorQuoteCopyBtn">Copiar texto</button>' +
              '<span class="admin-quote-copy-status" id="asesorQuoteCopyStatus" aria-live="polite"></span>' +
            '</div>' +
          '</div>'
        );
      })()
    );
  }

  function asFlatArray(value) {
    if (value == null) return [];
    if (!Array.isArray(value)) return [value];
    // Unwrap accidental [[...]] from PowerShell ConvertTo-Json
    if (value.length === 1 && Array.isArray(value[0]) && (value[0].length === 0 || typeof value[0][0] === 'object')) {
      return asFlatArray(value[0]);
    }
    return value;
  }

  function quoteHasPricedDeal(quote) {
    if (!quote || typeof quote !== 'object') return false;
    if (Number(quote.total_usd || 0) > 0 || Number(quote.total_cop || 0) > 0) return true;
    var src = String(quote.quote_source || '').toLowerCase();
    if (src === 'gp' && Number(quote.product_count || quote.items_count || 0) > 0) return true;
    var totals = quote.totals || {};
    var keys = ['usdIva', 'copIva', 'totalConFlete', 'usd', 'cop', 'totalUsdIva', 'totalCopIva', 'total_usd', 'total_cop'];
    for (var i = 0; i < keys.length; i++) {
      if (Number(totals[keys[i]] || 0) > 0) return true;
    }
    var items = Array.isArray(quote.items) ? quote.items : [];
    for (var j = 0; j < items.length; j++) {
      var it = items[j] || {};
      var ikeys = ['usdIva', 'copIva', 'totalUsdIva', 'totalCopIva', 'usd', 'cop', 'unitario_usd', 'unitario_cop', 'price'];
      for (var k = 0; k < ikeys.length; k++) {
        if (Number(it[ikeys[k]] || 0) > 0) return true;
      }
    }
    return false;
  }

  /** Bitrix sin compañía/NIT real: aparecen como "Deal 5585" / NIT 0. No mostrar en panel. */
  function isOrphanBitrixDealQuote(quote) {
    if (!quote || typeof quote !== 'object') return false;
    var nombre = String(quote.nombre || '').trim();
    if (/^Deal\s+\d+/i.test(nombre)) return true;
    var nitDigits = String(quote.nit || '').replace(/\D+/g, '');
    var id = String(quote.id || '').trim();
    var isBx = /^bx[-_]/i.test(id) || !!(quote.synced_from_bitrix || quote.bitrix_deal_id);
    if (isBx && (nitDigits === '' || nitDigits === '0')) return true;
    return false;
  }

  function onlyPricedQuotes(list) {
    return asFlatArray(list).filter(function (q) {
      if (isOrphanBitrixDealQuote(q)) return false;
      var src = String((q && q.quote_source) || '').toLowerCase();
      if (src === 'gp' || String((q && q.gp_codigo) || '')) {
        return true;
      }
      return quoteHasPricedDeal(q);
    });
  }

  function quoteItems(q) {
    var items = q && q.items;
    if (!items) return [];
    return asFlatArray(items);
  }

  function quoteItemsResolved(q) {
    var items = quoteItems(q);
    if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.enrichQuote === 'function') {
      return IZCCotizacionPdf.enrichQuote(Object.assign({}, q || {}, { items: items })).items;
    }
    return items.map(function (line) {
      var copy = Object.assign({}, line);
      var sku = String(copy.sku || '').trim();
      var name = String(copy.name || copy.descripcion || copy.referencia || '').trim();
      if (/productos\s+cotizados/i.test(name) && copy.referencia && !/^bitrix\s*#/i.test(String(copy.referencia))) {
        name = String(copy.referencia).trim();
      }
      if (!name || name === '—' || name === '-') {
        name = sku || 'Producto';
      }
      copy.name = name;
      return copy;
    });
  }

  function lineTotal(line) {
    if (!line) return '—';
    if (String(line.currency || '').toUpperCase() === 'COP') {
      return formatCOP(line.totalCop != null ? line.totalCop : line.cop);
    }
    if (String(line.currency || '').toUpperCase() === 'USD') {
      return formatUSD(line.totalUsd != null ? line.totalUsd : line.usd);
    }
    if (line.totalUsd != null || line.usd != null) {
      return formatUSD(line.totalUsd != null ? line.totalUsd : line.usd);
    }
    return formatCOP(line.totalCop != null ? line.totalCop : line.cop);
  }

  function quoteCurrencyFlags(quote) {
    var totals = (quote && quote.totals) || {};
    var items = quoteItems(quote);
    var hasUsd = totals.hasUsd === true;
    var hasCop = totals.hasCop === true;
    if (!hasUsd && !hasCop) {
      items.forEach(function (line) {
        var c = String(line.currency || '').toUpperCase();
        if (c === 'COP') hasCop = true;
        else if (c === 'USD') hasUsd = true;
      });
    }
    if (!hasUsd && !hasCop) {
      hasUsd = Number(totals.usdIva) > 0;
      hasCop = Number(totals.copIva) > 0;
    }
    if (!hasUsd && !hasCop) {
      hasUsd = Number(totals.usd) > 0;
      hasCop = Number(totals.cop) > 0 && !hasUsd;
    }
    return { hasUsd: hasUsd, hasCop: hasCop };
  }

  function quoteNativeSums(quote) {
    var totals = (quote && quote.totals) || {};
    var items = quoteItems(quote);
    var flags = quoteCurrencyFlags(quote);
    var sumUsd = 0;
    var sumCop = 0;
    var fromItems = false;
    items.forEach(function (line) {
      var c = String(line.currency || '').toUpperCase();
      if (c === 'COP') {
        fromItems = true;
        sumCop += Number(line.totalCop != null ? line.totalCop : line.cop) || 0;
      } else if (c === 'USD') {
        fromItems = true;
        sumUsd += Number(line.totalUsd != null ? line.totalUsd : line.usd) || 0;
      }
    });
    if (!fromItems) {
      if (flags.hasUsd && !flags.hasCop) sumUsd = Number(totals.usd) || 0;
      else if (flags.hasCop && !flags.hasUsd) sumCop = Number(totals.cop) || 0;
      else {
        if (flags.hasUsd) sumUsd = Number(totals.usdIva) > 0 ? Number(totals.usdIva) / 1.19 : (Number(totals.usd) || 0);
        if (flags.hasCop) sumCop = Number(totals.copIva) > 0 ? Number(totals.copIva) / 1.19 : (Number(totals.cop) || 0);
      }
    }
    return { hasUsd: flags.hasUsd, hasCop: flags.hasCop, usd: sumUsd, cop: sumCop };
  }

  function quoteProductCount(q) {
    if (q && Number(q.items_count) > 0) return Number(q.items_count);
    var n = quoteItems(q).length;
    if (n > 0) return n;
    if (q && q.totals && Number(q.totals.qty) > 0) return Number(q.totals.qty);
    if (q && Number(q.product_count) > 0) return Number(q.product_count);
    return 0;
  }

  function quoteTotalsDisplay(quote) {
    var totals = (quote && quote.totals) || {};
    var cop = Number(totals.copIva) || Number(totals.totalConFlete) || Number(totals.cop) || 0;
    var usd = Number(totals.usdIva) || Number(totals.usd) || 0;
    // Siempre preferir suma de ítems si traen precio (más fiel a Bitrix productos).
    var items = quoteItems(quote);
    if (items.length) {
      var itemCop = 0;
      var itemUsd = 0;
      items.forEach(function (line) {
        var c = String(line.currency || '').toUpperCase();
        var lineCop = Number(line.totalCopIva) || Number(line.copIva) || Number(line.totalCop) || Number(line.cop) || 0;
        var lineUsd = Number(line.totalUsdIva) || Number(line.usdIva) || Number(line.totalUsd) || Number(line.usd) || 0;
        if (c === 'COP') itemCop += lineCop;
        else if (c === 'USD') itemUsd += lineUsd;
        else {
          if (lineCop > 0) itemCop += lineCop;
          if (lineUsd > 0) itemUsd += lineUsd;
        }
      });
      if (itemUsd > 0) usd = itemUsd;
      if (itemCop > 0) cop = itemCop;
    }
    return { cop: cop, usd: usd };
  }

  function formatUsdAmountOnly(value) {
    var n = Number(value || 0);
    if (window.IZCMoney && typeof IZCMoney.roundUsd === 'function') {
      n = IZCMoney.roundUsd(n);
    }
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatCopAmountOnly(value) {
    return Number(value || 0).toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /** Montos USD/COP para la columna TOTAL del listado. */
  function quoteTotalAmounts(quote) {
    if (!quote || typeof quote !== 'object') {
      return { usd: 0, cop: 0 };
    }
    var usd = Number(quote.total_usd) || 0;
    var cop = Number(quote.total_cop) || 0;
    if (usd > 0 || cop > 0) {
      return { usd: usd, cop: cop };
    }

    var t = quoteTotalsDisplay(quote);
    if (t.usd > 0 || t.cop > 0) {
      return { usd: t.usd || 0, cop: t.cop || 0 };
    }

    var totals = quote.totals || {};
    var usdIva = Number(String(totals.usdIva != null ? totals.usdIva : '').replace(',', '.'));
    var copIva = Number(String(totals.copIva != null ? totals.copIva : '').replace(',', '.'));
    var totalConFlete = Number(String(totals.totalConFlete != null ? totals.totalConFlete : '').replace(',', '.'));
    var usdRaw = Number(String(totals.usd != null ? totals.usd : '').replace(',', '.'));
    var copRaw = Number(String(totals.cop != null ? totals.cop : '').replace(',', '.'));
    if (isFinite(usdIva) && usdIva > 0) usd = usdIva;
    else if (isFinite(usdRaw) && usdRaw > 0) usd = usdRaw;
    if (isFinite(copIva) && copIva > 0) cop = copIva;
    else if (isFinite(totalConFlete) && totalConFlete > 0) cop = totalConFlete;
    else if (isFinite(copRaw) && copRaw > 0) cop = copRaw;

    if (!(usd > 0) && !(cop > 0)) {
      var liq = buildLiquidacionCop(quote);
      if (liq && isFinite(liq.totalPagar) && liq.totalPagar > 0) {
        cop = liq.totalPagar;
      }
    }
    return { usd: usd > 0 ? usd : 0, cop: cop > 0 ? cop : 0 };
  }

  function quoteTotalLabel(quote) {
    var amounts = quoteTotalAmounts(quote);
    var parts = [];
    if (amounts.usd > 0) parts.push('USD $ ' + formatUsdAmountOnly(amounts.usd));
    if (amounts.cop > 0) parts.push('COP $ ' + formatCopAmountOnly(amounts.cop));
    return parts.length ? parts.join('\n') : '—';
  }

  function quoteTotalHtml(quote) {
    var amounts = quoteTotalAmounts(quote);
    var lines = [];
    if (amounts.usd > 0) {
      lines.push('USD $ ' + formatUsdAmountOnly(amounts.usd));
    }
    if (amounts.cop > 0) {
      lines.push('COP $ ' + formatCopAmountOnly(amounts.cop));
    }
    if (!lines.length) return '—';
    if (lines.length === 1) return escapeHtml(lines[0]);
    return (
      '<div class="admin-quote-total-stack">' +
        lines.map(function (line) {
          return '<div>' + escapeHtml(line) + '</div>';
        }).join('') +
      '</div>'
    );
  }

  function quoteTotalTitle(quote) {
    var liq = buildLiquidacionCop(quote);
    if (liq && isFinite(liq.totalPagar) && liq.totalPagar > 0) {
      return 'Total a pagar';
    }
    var flags = quoteCurrencyFlags(quote);
    if (flags.hasUsd && flags.hasCop) return 'Total';
    if (flags.hasCop) return 'Total COP';
    if (flags.hasUsd) return 'Total USD';
    return 'Total';
  }

  function sessionCodigo() {
    return (window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || '';
  }

  var POST_API_FILE_ACTIONS = {
    register_cliente_asesor: true,
    add_cliente_asesor: true,
    update_asesor_nombre: true,
    set_asesor_nombre: true,
    finish_quote_asesor: true,
    enrich_quote_items: true,
    get_quote_asesor: true,
    save_quote: true,
    set_quote_estado: true,
    update_quote_estado: true,
    push_estados_bitrix: true,
    sync_estados_to_bitrix: true,
    set_quote_fecha_cierre: true,
    update_quote_fecha_cierre: true,
    set_quote_comentario: true,
    update_quote_comentario: true,
    set_quote_empresa: true,
    set_quote_flete: true,
    delete_quote_asesor: true,
    hide_quote_asesor: true
  };

  function postApi(payload, options) {
    options = options || {};
    var action = payload && payload.action;
    var useFile = options.fileWrite || (action && POST_API_FILE_ACTIONS[action]);
    var timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 0;
    // Bitrix / paneles pesados: el default 8s de IZCAuth aborta la petición.
    if (!timeoutMs && payload) {
      if (payload.refresh_bitrix || payload.sync_bitrix || payload.force) {
        timeoutMs = 180000;
      } else if (action === 'list_clientes_asesor' || action === 'list_quotes_asesor' || action === 'sync_local_data') {
        timeoutMs = (payload && payload.skip_cache) ? 60000 : 12000;
      }
    }
    // Reusar el cliente que ya funciona en login (misma base /IZC/).
    if (window.IZCAuth) {
      if (useFile && typeof IZCAuth.postAuthFile === 'function') {
        return IZCAuth.postAuthFile(payload, timeoutMs || 45000);
      }
      if (typeof IZCAuth.postAuth === 'function') {
        return timeoutMs ? IZCAuth.postAuth(payload, timeoutMs) : IZCAuth.postAuth(payload);
      }
    }
    var body = JSON.stringify(payload);
    var endpoints = apiEndpoints();
    var lastDetail = '';
    function tryOne(i) {
      if (i >= endpoints.length) {
        return Promise.reject(new Error(lastDetail || 'sin api'));
      }
      return fetch(endpoints[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        cache: 'no-store'
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try {
            data = JSON.parse(text);
          } catch (e) {
            lastDetail = 'HTTP ' + res.status + ' (respuesta no JSON)';
            throw new Error(lastDetail);
          }
          if (!data || typeof data !== 'object') {
            lastDetail = 'Respuesta inválida';
            throw new Error(lastDetail);
          }
          data._http = res.status;
          if (!data.ok && i + 1 < endpoints.length && (res.status === 404 || data.from_cache === false)) {
            lastDetail = String(data.error || ('HTTP ' + res.status));
            return tryOne(i + 1);
          }
          return data;
        });
      }).catch(function (err) {
        lastDetail = (err && err.message) || lastDetail || 'error de red';
        return tryOne(i + 1);
      });
    }
    return tryOne(0);
  }

  function setActiveTab(tab) {
    activeTab = tab || 'clientes';
    var clientesPanel = document.getElementById('asesorPanelClientes');
    var nuevasPanel = document.getElementById('asesorPanelNuevas');
    var quotesPanel = document.getElementById('asesorPanelQuotes');
    var gpPanel = document.getElementById('asesorPanelGp');
    var duplicadasPanel = document.getElementById('asesorPanelDuplicadas');
    document.querySelectorAll('.admin-stat.is-tab').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-tab') === activeTab);
    });
    if (clientesPanel) clientesPanel.hidden = activeTab !== 'clientes';
    if (nuevasPanel) nuevasPanel.hidden = activeTab !== 'nuevas';
    if (quotesPanel) quotesPanel.hidden = activeTab !== 'quotes';
    if (gpPanel) gpPanel.hidden = activeTab !== 'gp';
    if (duplicadasPanel) duplicadasPanel.hidden = activeTab !== 'duplicadas';
    if (activeTab === 'clientes') {
      if (clientesLoaded || clientesCache.length) {
        renderClientes(clientesCache);
        if (!clientesLoaded) loadClientes({ silent: true, fast: true });
        return;
      }
      showClientesLoading();
      loadClientes({ silent: true, fast: true });
      return;
    }
    if (activeTab === 'quotes' || activeTab === 'historial') {
      clearAsesorQuotesFilters();
    }
    if (activeTab === 'duplicadas') {
      clearAsesorDuplicadasFilters();
    }
    if (!quotesPanelsLoaded) {
      loadAllQuotePanels({ silent: true, fast: true });
      return;
    }
    if (activeTab === 'nuevas') renderNuevas(nuevasCache);
    else if (activeTab === 'gp') renderGpQuotes(gpCache);
    else if (activeTab === 'duplicadas') {
      if (!duplicadasCache.length) {
        loadDuplicadas({ silent: true, forceReload: true });
      } else {
        applyAsesorDuplicadasFilter();
      }
    }
    else applyAsesorQuotesFilter();
  }

  function normalizeNitQuery(value) {
    if (window.IZCAuth && typeof IZCAuth.normalizeNit === 'function') {
      return IZCAuth.normalizeNit(value).toLowerCase();
    }
    return String(value == null ? '' : value).replace(/[\s.]/g, '').replace(/-\d$/, '').toLowerCase();
  }

  function filterClientes(clientes, query) {
    var q = String(query || '').trim();
    if (!q) return clientes || [];
    var qNit = normalizeNitQuery(q);
    var qDigits = qNit.replace(/\D/g, '');
    var qName = q.toLowerCase();
    try {
      if (typeof qName.normalize === 'function') {
        qName = qName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      }
    } catch (eFold) { /* ignore */ }
    return (clientes || []).filter(function (c) {
      var nit = normalizeNitQuery(c && c.nit);
      var nombre = String((c && c.nombre) || '').toLowerCase();
      var contacto = String((c && (c.contacto_nombre || c.nombre_contacto)) || '').toLowerCase();
      try {
        if (typeof nombre.normalize === 'function') {
          nombre = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        }
        if (typeof contacto.normalize === 'function') {
          contacto = contacto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        }
      } catch (eNom) { /* ignore */ }
      if (qName.length >= 2 && nombre.indexOf(qName) !== -1) return true;
      if (qName.length >= 2 && contacto.indexOf(qName) !== -1) return true;
      if (nit && qNit && nit.indexOf(qNit) !== -1) return true;
      if (qDigits && nit.replace(/\D/g, '').indexOf(qDigits) !== -1) return true;
      return false;
    });
  }

  function showClientesLoading() {
    var body = document.getElementById('asesorClientesBody');
    if (body) {
      body.innerHTML = '<tr><td colspan="6" class="admin-empty">Cargando clientes…</td></tr>';
    }
  }

  function paintClientesRows(clientes, emptyMsg) {
    var body = document.getElementById('asesorClientesBody');
    if (!body) return;
    if (!clientes.length) {
      body.innerHTML = '<tr><td colspan="6" class="admin-empty">' + emptyMsg + '</td></tr>';
      return;
    }
    body.innerHTML = clientes.map(function (c, idx) {
      var nit = normalizeNitQuery(c && c.nit);
      var nombre = String(c.nombre || '').trim();
      var contactoNombre = String(c.contacto_nombre || c.nombre_contacto || '').trim();
      var telefono = String(c.contacto_telefono || c.telefono || c.telefonos || '').trim();
      return (
        '<tr>' +
          '<td class="admin-row-num">' + (idx + 1) + '</td>' +
          '<td>' + escapeHtml(nit || '—') + '</td>' +
          '<td>' + escapeHtml(c.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(contactoNombre || '—') + '</td>' +
          '<td>' + escapeHtml(telefono || '—') + '</td>' +
          '<td class="admin-actions">' +
            '<button type="button" class="admin-view-quote admin-cotizar-cliente" ' +
              'data-nit="' + escapeHtml(nit) + '" ' +
              'data-nombre="' + escapeHtml(nombre) + '">Cotizar</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderClientes(clientes) {
    var count = document.getElementById('asesorClientCount');
    var search = document.getElementById('asesorClientNitSearch');
    clientesCache = sortByNewestCreated(clientes || [], 'activity_at');
    if (count) count.textContent = String(clientesCache.length);
    var query = search ? search.value : '';
    var filtered = filterClientes(clientesCache, query);
    var emptyMsg = query
      ? 'No hay clientes con ese nombre o NIT. Puedes registrarlo con «Registrar cliente».'
      : 'No hay clientes asignados. Usa «Registrar cliente» para agregar uno.';
    paintClientesRows(filtered, emptyMsg);
    schedulePanelSnapshotPersist();
  }

  function upsertClienteCache(cliente) {
    if (!cliente || !cliente.nit) return;
    var nit = normalizeNitQuery(cliente.nit);
    if (!nit) return;
    var idx = -1;
    for (var i = 0; i < clientesCache.length; i++) {
      if (normalizeNitQuery(clientesCache[i].nit) === nit) {
        idx = i;
        break;
      }
    }
    var nowIso = new Date().toISOString();
    var row = {
      nit: nit,
      nombre: String(cliente.nombre || nit).trim() || nit,
      telefono: String(cliente.contacto_telefono || cliente.telefono || '').trim(),
      contacto_nombre: String(cliente.contacto_nombre || cliente.nombre_contacto || '').trim(),
      contacto_telefono: String(cliente.contacto_telefono || cliente.telefono || '').trim(),
      manual: cliente.manual !== false,
      activity_at: String(cliente.activity_at || cliente.updated_at || cliente.created_at || nowIso),
      created_at: String(cliente.created_at || nowIso)
    };
    if (idx >= 0) {
      clientesCache[idx] = row;
    } else {
      clientesCache.unshift(row);
    }
    clientesCache = sortByNewestCreated(clientesCache, 'activity_at');
    renderClientes(clientesCache);
  }

  function onClientNitSearch() {
    var search = document.getElementById('asesorClientNitSearch');
    var query = search ? search.value : '';
    var filtered = filterClientes(clientesCache, query);
    paintClientesRows(
      filtered,
      query
        ? 'No hay clientes con ese nombre o NIT. Puedes registrarlo con «Registrar cliente».'
        : 'No hay clientes asignados. Usa «Registrar cliente» para agregar uno.'
    );
  }

  function setClienteFormStatus(text, type) {
    var el = document.getElementById('asesorClienteFormStatus');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'auth-message');
      return;
    }
    el.textContent = text || '';
    el.className = 'auth-message' + (type ? ' is-' + type : '');
  }

  function openClienteRegisterModal(prefillNit) {
    var modal = document.getElementById('asesorClienteModal');
    var nitInput = document.getElementById('asesorClienteNitInput');
    var nombreInput = document.getElementById('asesorClienteNombreInput');
    if (!modal) return;
    setClienteFormStatus('', '');
    if (nitInput) {
      nitInput.value = prefillNit ? String(prefillNit) : (document.getElementById('asesorClientNitSearch') || {}).value || '';
    }
    if (nombreInput) nombreInput.value = '';
    modal.hidden = false;
    window.setTimeout(function () {
      if (nitInput && !String(nitInput.value || '').trim()) nitInput.focus();
      else if (nombreInput) nombreInput.focus();
    }, 30);
  }

  function closeClienteRegisterModal() {
    var modal = document.getElementById('asesorClienteModal');
    if (modal) modal.hidden = true;
  }

  function registerClienteAsesor(andCotizar) {
    var codigo = sessionCodigo();
    var nitInput = document.getElementById('asesorClienteNitInput');
    var nombreInput = document.getElementById('asesorClienteNombreInput');
    if (!codigo || !nitInput || !nombreInput) return;
    var nit = normalizeNitQuery(nitInput.value);
    var nombre = String(nombreInput.value || '').trim();
    if (!nit || nit.replace(/\D/g, '').length < 6) {
      setClienteFormStatus('NIT inválido. Usa solo números (6 a 15 dígitos).', 'error');
      return;
    }
    if (nombre.length < 2) {
      setClienteFormStatus('Ingresa el nombre del cliente (mínimo 2 caracteres).', 'error');
      return;
    }
    setClienteFormStatus('Guardando…', '');
    postApi({
      action: 'register_cliente_asesor',
      asesor_codigo: codigo,
      client_nit: nit,
      nombre: nombre
    }).then(function (data) {
      if (!data || !data.ok) {
        var err = (data && data.error) || 'No se pudo registrar el cliente.';
        if (/acci[oó]n no v[aá]lida/i.test(err)) {
          err = 'El servidor está desactualizado. Cierra y vuelve a abrir tools\\ABRIR.bat.';
        }
        setClienteFormStatus(err, 'error');
        return;
      }
      if (data.cliente) {
        upsertClienteCache(data.cliente);
      } else if (Array.isArray(data.clientes) && data.clientes.length) {
        clientesLoaded = true;
        renderClientes(asFlatArray(data.clientes));
      }
      setMessage(data.message || 'Cliente registrado.', 'ok');
      closeClienteRegisterModal();
      if (andCotizar) {
        openCotizadorCliente({
          nit: (data.cliente && data.cliente.nit) || nit,
          nombre: (data.cliente && data.cliente.nombre) || nombre
        });
      }
    }).catch(function (err) {
      var detail = (err && err.message) ? String(err.message).trim() : '';
      var aborted = /abort|The user aborted|Failed to fetch/i.test(detail);
      var msg = aborted
        ? 'El servidor tardó en responder. Espera 5 segundos e intenta de nuevo.'
        : (isLocalHost()
          ? 'No se pudo guardar. Ejecuta tools\\ABRIR.bat.'
          : 'No se pudo guardar en el servidor.');
      if (detail && !aborted && !/sin api/i.test(detail)) {
        msg += ' ' + detail;
      }
      setClienteFormStatus(msg, 'error');
    });
  }

  function quoteEstado(q) {
    var e = String((q && q.asesor_estado) || '').trim().toLowerCase();
    if (e === 'nueva' || e === 'nuevo' || e === 'new') return 'nueva';
    if (e === 'pendiente' || e === 'pending') return 'pendiente';
    if (e === 'seguimiento' || e === 'follow' || e === 'followup') return 'seguimiento';
    if (e === 'vendido' || e === 'venta' || e === 'sold') return 'vendido';
    if (e === 'perdida' || e === 'perdido' || e === 'lost') return 'perdida';
    if (e === 'cerrado_modificado' || e === 'cerrado-modificado' || e === 'cerradomodificado') {
      return 'cerrado_modificado';
    }
    return 'cotizado';
  }

  function quoteEmpresaLabel(q) {
    var raw = String(
      (q && q.empresa) ||
      (q && q.totals && q.totals.empresa) ||
      ''
    ).trim();
    if (/VALTECH/i.test(raw)) return 'VALTECH';
    if (/IZC/i.test(raw)) return 'IZC';
    if (q && /VALTECH/i.test(String(q.seller_name || ''))) return 'VALTECH';
    // Bitrix / sync sin empresa: mostrar IZC por defecto (no guion).
    if (q && (q.synced_from_bitrix || q.bitrix_deal_id || String(q.quote_source || '').toLowerCase() === 'bitrix')) {
      return 'IZC';
    }
    if (!raw) return '—';
    return raw;
  }

  function quoteEmpresaClass(q) {
    var label = quoteEmpresaLabel(q);
    if (label === 'VALTECH') return 'is-valtech';
    if (label === 'IZC') return 'is-izc';
    return 'is-unknown';
  }

  function isDuplicatedQuote(q) {
    if (!q || typeof q !== 'object') return false;
    // Solo recotizaciones del asesor (botón Recotizar). No Bitrix auto.
    if (String(q.quote_source || '').toLowerCase() !== 'asesor') return false;
    if (String(q.recotizado_by || '').trim() !== '') return true;
    if (String(q.recotizado_at || '').trim() !== '') return true;
    if (String(q.recotizado_desde || '').trim() !== '') return true;
    if (String(q.duplicated_from || '').trim() !== '') return true;
    return false;
  }

  function quoteEstadoLabel(estado) {
    if (estado === 'nueva') return 'Nueva';
    if (estado === 'pendiente') return 'Pendiente';
    if (estado === 'seguimiento') return 'Seguimiento';
    if (estado === 'vendido') return 'Vendido';
    if (estado === 'perdida') return 'Perdida';
    if (estado === 'cerrado_modificado') return 'Cerrado Modificado';
    return 'Cotizado';
  }

  /* Historial: Cerrado Modificado siempre visible (filtro + filas). */
  function estadoSelectHtml(estado, idx, mode, quote) {
    if (estado === 'nueva') return '';
    var rowMode = mode || 'historial';
    var opts = [
      { v: 'cotizado', t: 'Cotizado' },
      { v: 'pendiente', t: 'Pendiente' },
      { v: 'seguimiento', t: 'Seguimiento' },
      { v: 'vendido', t: 'Vendido' },
      { v: 'perdida', t: 'Perdida' }
    ];
    // En historial siempre; en pestaña Duplicadas no se ofrece.
    if (rowMode === 'historial') {
      opts.push({ v: 'cerrado_modificado', t: 'Cerrado Modificado' });
    }
    return (
      '<select class="quote-estado-select is-' + estado + '" data-mode="' + rowMode + '" data-idx="' + idx + '" aria-label="Estado de cotización">' +
        opts.map(function (o) {
          return (
            '<option class="is-' + o.v + '" value="' + o.v + '"' +
            (o.v === estado ? ' selected' : '') + '>' + o.t + '</option>'
          );
        }).join('') +
      '</select>'
    );
  }

  function toDateKey(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    var d = new Date(raw);
    if (isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return raw.slice(0, 10);
    }
    if (isNaN(d.getTime())) return '';
    try {
      // Fecha de negocio en Colombia (evita que UTC “mueva” el día).
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
    } catch (e) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1);
      var day = String(d.getDate());
      if (m.length < 2) m = '0' + m;
      if (day.length < 2) day = '0' + day;
      return y + '-' + m + '-' + day;
    }
  }

  function getAsesorQuoteFilters() {
    var estadoEl = document.getElementById('asesorQuoteFilterEstado');
    var fechaEl = document.getElementById('asesorQuoteFilterFecha');
    var nitEl = document.getElementById('asesorQuoteFilterNit');
    return {
      estado: estadoEl ? String(estadoEl.value || '').trim().toLowerCase() : '',
      fecha: fechaEl ? String(fechaEl.value || '').trim() : '',
      nit: nitEl ? normalizeNitQuery(nitEl.value) : ''
    };
  }

  function updateAsesorQuotesFilterMeta(total, shown) {
    var meta = document.getElementById('asesorQuotesFilterMeta');
    if (!meta) return;
    var f = getAsesorQuoteFilters();
    var active = !!(f.estado || f.fecha || f.nit);
    if (!active) {
      meta.hidden = true;
      meta.textContent = '';
      return;
    }
    meta.hidden = false;
    meta.textContent = 'Mostrando ' + shown + ' de ' + total + ' cotizaciones.';
  }

  function getAsesorDuplicadasFilters() {
    var estadoEl = document.getElementById('asesorDupFilterEstado');
    var fechaEl = document.getElementById('asesorDupFilterFecha');
    var nitEl = document.getElementById('asesorDupFilterNit');
    return {
      estado: estadoEl ? String(estadoEl.value || '').trim().toLowerCase() : '',
      fecha: fechaEl ? String(fechaEl.value || '').trim() : '',
      nit: nitEl ? normalizeNitQuery(nitEl.value) : ''
    };
  }

  function updateAsesorDuplicadasFilterMeta(total, shown) {
    var meta = document.getElementById('asesorDuplicadasFilterMeta');
    if (!meta) return;
    var f = getAsesorDuplicadasFilters();
    var active = !!(f.estado || f.fecha || f.nit);
    if (!active) {
      meta.hidden = true;
      meta.textContent = '';
      return;
    }
    meta.hidden = false;
    meta.textContent = 'Mostrando ' + shown + ' de ' + total + ' cotizaciones duplicadas.';
  }

  function paintQuoteHistorialTable(config) {
    var body = document.getElementById(config.bodyId);
    if (!body) return;
    var rows = config.rows || [];
    var getFilters = config.getFilters || getAsesorQuoteFilters;
    var f = getFilters();
    var emptyDefault = config.emptyDefault || 'Aún no hay cotizaciones en el historial.';
    var emptyFiltered = config.emptyFiltered || 'No hay cotizaciones con esos filtros.';
    var mode = config.mode || 'historial';
    var showDupTag = config.showDupTag !== false;
    if (!rows.length) {
      var emptyMsg = (f.estado || f.fecha || f.nit) ? emptyFiltered : emptyDefault;
      body.innerHTML = '<tr><td colspan="9" class="admin-empty">' + emptyMsg + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (entry) {
      var q = entry.quote;
      var idx = entry.idx;
      var estado = quoteEstado(q);
      if (estado === 'nueva') estado = 'cotizado';
      var cierreVal = toDateInputValue(q.fecha_cierre);
      var empresaLabel = quoteEmpresaLabel(q);
      return (
        '<tr>' +
          '<td class="admin-estado-cell">' +
            estadoSelectHtml(estado, idx, mode, q) +
          '</td>' +
          '<td class="admin-date-cell">' + escapeHtml(formatDateOnly(q.created_at)) + '</td>' +
          '<td class="admin-date-cell">' +
            '<input type="date" class="quote-fecha-cierre" data-mode="' + mode + '" data-idx="' + idx + '" ' +
              'value="' + escapeHtml(cierreVal) + '" aria-label="Fecha de cierre">' +
          '</td>' +
          '<td>' + escapeHtml(q.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(normalizeNitQuery(q.nit) || '') + '</td>' +
          '<td class="admin-empresa-cell">' +
            '<span class="admin-quote-empresa-tag ' + quoteEmpresaClass(q) + '">' +
              escapeHtml(empresaLabel) +
            '</span>' +
          '</td>' +
          '<td>' + quoteProductCount(q) + '</td>' +
          '<td class="admin-quote-total-cell">' + quoteTotalHtml(q) + '</td>' +
          '<td class="admin-actions">' +
            (showDupTag && isDuplicatedQuote(q)
              ? '<span class="admin-quote-dup-tag">Cotización duplicada</span>'
              : '') +
            '<div class="admin-actions-btns">' +
              '<button type="button" class="admin-view-quote" data-mode="' + mode + '" data-idx="' + idx + '">Ver</button> ' +
              '<button type="button" class="admin-quote-pdf-row" data-mode="' + mode + '" data-idx="' + idx + '" data-currency="USD">PDF USD</button> ' +
              '<button type="button" class="admin-quote-pdf-row" data-mode="' + mode + '" data-idx="' + idx + '" data-currency="COP">PDF COP</button>' +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function paintHistorialRows(rows) {
    paintQuoteHistorialTable({
      bodyId: 'asesorQuotesBody',
      rows: rows,
      mode: 'historial',
      showDupTag: true
    });
  }

  function paintDuplicadasRows(rows) {
    paintQuoteHistorialTable({
      bodyId: 'asesorDuplicadasBody',
      rows: rows,
      getFilters: getAsesorDuplicadasFilters,
      emptyDefault: 'Aún no hay cotizaciones duplicadas.',
      emptyFiltered: 'No hay cotizaciones duplicadas con esos filtros.',
      mode: 'duplicadas',
      showDupTag: true
    });
  }

  function applyAsesorDuplicadasFilter() {
    var f = getAsesorDuplicadasFilters();
    var filtered = [];
    duplicadasCache.forEach(function (q, idx) {
      if (f.estado && quoteEstado(q) !== f.estado) return;
      if (f.fecha && toDateKey(q.created_at) !== f.fecha) return;
      if (f.nit) {
        var nit = normalizeNitQuery(q.nit);
        if (nit.indexOf(f.nit) === -1) return;
      }
      filtered.push({ quote: q, idx: idx });
    });
    updateAsesorDuplicadasFilterMeta(duplicadasCache.length, filtered.length);
    paintDuplicadasRows(filtered);
  }

  function applyAsesorQuotesFilter() {
    var f = getAsesorQuoteFilters();
    var filtered = [];
    quotesCache.forEach(function (q, idx) {
      if (f.estado && quoteEstado(q) !== f.estado) return;
      if (f.fecha && toDateKey(q.created_at) !== f.fecha) return;
      if (f.nit) {
        var nit = normalizeNitQuery(q.nit);
        if (nit.indexOf(f.nit) === -1) return;
      }
      filtered.push({ quote: q, idx: idx });
    });
    updateAsesorQuotesFilterMeta(quotesCache.length, filtered.length);
    if (!filtered.length && f.fecha && quotesCache.length) {
      paintHistorialRows([]);
      var body = document.getElementById('asesorQuotesBody');
      if (body) {
        body.innerHTML =
          '<tr><td colspan="9" class="admin-empty">' +
          'No hay cotizaciones en esa fecha. Tienes ' + quotesCache.length +
          ' en el historial: pulsa «Limpiar» para verlas todas.' +
          '</td></tr>';
      }
      return;
    }
    paintHistorialRows(filtered);
  }

  function clearAsesorDuplicadasFilters() {
    var estadoEl = document.getElementById('asesorDupFilterEstado');
    var fechaEl = document.getElementById('asesorDupFilterFecha');
    var nitEl = document.getElementById('asesorDupFilterNit');
    if (estadoEl) {
      estadoEl.value = '';
      estadoEl.className = 'admin-filter-select';
    }
    if (fechaEl) fechaEl.value = '';
    if (nitEl) nitEl.value = '';
    applyAsesorDuplicadasFilter();
  }

  function clearAsesorQuotesFilters() {
    var estadoEl = document.getElementById('asesorQuoteFilterEstado');
    var fechaEl = document.getElementById('asesorQuoteFilterFecha');
    var nitEl = document.getElementById('asesorQuoteFilterNit');
    if (estadoEl) {
      estadoEl.value = '';
      estadoEl.className = 'admin-filter-select';
    }
    if (fechaEl) fechaEl.value = '';
    if (nitEl) nitEl.value = '';
    applyAsesorQuotesFilter();
  }

  function renderQuoteRows(quotes, bodyId, emptyMsg, mode) {
    var body = document.getElementById(bodyId);
    if (!body) return;
    var colCount = (mode === 'historial' || mode === 'nuevas' || mode === 'gp') ? 9 : 7;
    if (!quotes.length) {
      body.innerHTML = '<tr><td colspan="' + colCount + '" class="admin-empty">' + emptyMsg + '</td></tr>';
      return;
    }
    body.innerHTML = quotes.map(function (q, idx) {
      var actions =
        '<div class="admin-actions-btns">' +
          '<button type="button" class="admin-view-quote" data-mode="' + mode + '" data-idx="' + idx + '">Ver</button>';
      if (mode === 'nuevas') {
        actions +=
          ' <button type="button" class="admin-view-quote admin-cotizar-btn" data-idx="' + idx + '">Cotizar</button>';
      } else {
        actions +=
          ' <button type="button" class="admin-quote-pdf-row" data-mode="' + mode + '" data-idx="' + idx + '" data-currency="USD">PDF USD</button>' +
          ' <button type="button" class="admin-quote-pdf-row" data-mode="' + mode + '" data-idx="' + idx + '" data-currency="COP">PDF COP</button>';
      }
      actions += '</div>';
      var fechaCotiz = formatDateOnly(q.created_at);
      var fechaCierreCliente = formatDateOnly(q.fecha_cierre_cliente);
      var empresaCell = mode === 'nuevas'
        ? (
          '<td class="admin-empresa-cell">' +
            '<span class="admin-quote-empresa-tag ' + quoteEmpresaClass(q) + '">' +
              escapeHtml(quoteEmpresaLabel(q)) +
            '</span>' +
          '</td>'
        )
        : '';
      var cierreClienteCell = (mode === 'nuevas' || mode === 'gp')
        ? ('<td class="admin-date-cell">' + escapeHtml(fechaCierreCliente) + '</td>')
        : '';
      var gpCell = '';
      if (mode === 'gp') {
        var gpLabel = String(q.gp_codigo || q.asesor_cotizado_by || '').trim();
        var gpName = String(q.gp_nombre || '').trim();
        if (gpLabel && gpName && gpName.toUpperCase() !== gpLabel.toUpperCase()) {
          gpLabel = gpLabel + ' · ' + gpName;
        }
        gpCell = '<td>' + escapeHtml(gpLabel || '—') + '</td>';
      }
      return (
        '<tr>' +
          '<td class="admin-row-num">' + (idx + 1) + '</td>' +
          '<td class="admin-date-cell">' + escapeHtml(fechaCotiz) + '</td>' +
          cierreClienteCell +
          '<td>' + escapeHtml(q.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(normalizeNitQuery(q.nit) || '') + '</td>' +
          empresaCell +
          gpCell +
          '<td>' + quoteProductCount(q) + '</td>' +
          '<td class="admin-quote-total-cell">' + quoteTotalHtml(q) + '</td>' +
          '<td class="admin-actions">' + actions + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderDuplicadas(quotes, options) {
    options = options || {};
    var incoming = quotes || [];
    if (options.replace) {
      duplicadasCache = incoming.filter(function (q) {
        return !!(q && q.id) && isDuplicatedQuote(q);
      });
    } else {
      var incomingIds = {};
      incoming.forEach(function (q) {
        if (q && q.id) incomingIds[String(q.id)] = true;
      });
      var merged = mergeQuotesFromServer(incoming, duplicadasCache);
      duplicadasCache = merged.filter(function (q) {
        if (!q || !q.id) return false;
        return isDuplicatedQuote(q) || !!incomingIds[String(q.id)];
      });
    }
    duplicadasCache = sortByNewestCreated(duplicadasCache);
    var count = document.getElementById('asesorDuplicadasCount');
    if (count) count.textContent = String(duplicadasCache.length);
    applyAsesorDuplicadasFilter();
  }

  function renderQuotes(quotes, options) {
    options = options || {};
    if (options.replace) {
      quotesCache = sortByNewestCreated(quotes || []);
    } else {
      quotesCache = sortByNewestCreated(mergeQuotesFromServer(quotes || [], quotesCache));
    }
    var count = document.getElementById('asesorQuoteCount');
    if (count) count.textContent = String(quotesCache.length);
    applyAsesorQuotesFilter();
  }

  function renderNuevas(quotes, options) {
    options = options || {};
    if (options.replace) {
      nuevasCache = sortByNewestCreated(quotes || []);
    } else {
      nuevasCache = sortByNewestCreated(quotes || []);
    }
    var count = document.getElementById('asesorNuevasCount');
    if (count) count.textContent = String(nuevasCache.length);
    renderQuoteRows(
      nuevasCache,
      'asesorNuevasBody',
      'No hay cotizaciones de clientes.',
      'nuevas'
    );
  }

  function renderGpQuotes(quotes, options) {
    options = options || {};
    if (options.replace) {
      gpCache = sortByNewestCreated(quotes || []);
    } else {
      gpCache = sortByNewestCreated(quotes || []);
    }
    var count = document.getElementById('asesorGpCount');
    if (count) count.textContent = String(gpCache.length);
    renderQuoteRows(
      gpCache,
      'asesorGpBody',
      'Aún no hay cotizaciones asignadas por un GP.',
      'gp'
    );
  }

  function comentarioBlockHtml(quote, editable) {
    var text = String((quote && quote.asesor_comentario) || '');
    var at = quote && quote.asesor_comentario_at;
    var by = quote && quote.asesor_comentario_by;
    if (editable) {
      return (
        '<div class="admin-quote-comentario">' +
          '<label for="asesorQuoteComentario">Comentario del asesor</label>' +
          '<textarea id="asesorQuoteComentario" class="admin-quote-comentario-input" rows="4" maxlength="2000" ' +
            'placeholder="Ej: se perdió por precio / cliente aplazó / ganó la competencia…">' +
            escapeHtml(text) +
          '</textarea>' +
          '<div class="admin-quote-comentario-actions">' +
            '<button type="button" class="admin-quote-comentario-save" id="asesorQuoteComentarioSave">Guardar comentario</button>' +
            '<span class="admin-quote-comentario-status" id="asesorQuoteComentarioStatus" role="status"></span>' +
          '</div>' +
          (at
            ? '<p class="admin-quote-comentario-meta">Última actualización: ' + escapeHtml(formatDate(at)) +
              (by ? ' · ' + escapeHtml(by) : '') + '</p>'
            : '') +
        '</div>' +
        '<div class="admin-quote-recotizar-wrap">' +
          '<button type="button" class="admin-quote-recotizar" id="asesorQuoteRecotizarBtn">' +
            'Recotizar' +
          '</button>' +
        '</div>'
      );
    }
    return (
      '<div class="admin-quote-comentario is-readonly">' +
        '<h4>Comentario del asesor</h4>' +
        (text
          ? '<p class="admin-quote-comentario-text">' + escapeHtml(text).replace(/\n/g, '<br>') + '</p>'
          : '<p class="admin-quote-comentario-empty">Sin comentario.</p>') +
        (at
          ? '<p class="admin-quote-comentario-meta">Última actualización: ' + escapeHtml(formatDate(at)) +
            (by ? ' · ' + escapeHtml(by) : '') + '</p>'
          : '') +
      '</div>'
    );
  }

  function setComentarioStatus(text, type) {
    var el = document.getElementById('asesorQuoteComentarioStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'admin-quote-comentario-status' + (type ? ' is-' + type : '');
  }

  function setFleteStatus(text, type) {
    var el = document.getElementById('asesorQuoteFleteStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'admin-quote-flete-status' + (type ? ' is-' + type : '');
  }

  function readLiquidacionFleteValues(opts) {
    opts = opts || {};
    var fleteInput = document.getElementById('asesorQuoteFleteInput');
    var ivaInput = document.getElementById('asesorQuoteFleteIvaInput');
    var wrap = document.getElementById('asesorQuoteLiquidacion');
    if (!fleteInput || !ivaInput || !wrap) {
      return { ok: false, flete: NaN, iva: NaN };
    }
    var flete = parseLocaleNumber(fleteInput.value);
    var iva = parseLocaleNumber(ivaInput.value);
    if (!isFinite(flete) || flete < 0) return { ok: false, flete: flete, iva: iva };
    if (!isFinite(iva) || iva < 0) return { ok: false, flete: flete, iva: iva };

    // Si editan el flete base, el IVA por defecto sigue al 19 % (salvo que editen el IVA).
    if (opts.from === 'flete') {
      iva = flete * 0.19;
      ivaInput.value = formatFleteInput(iva);
    }

    var subtotal = Number(wrap.getAttribute('data-subtotal'));
    if (!isFinite(subtotal) || subtotal < 0) subtotal = 0;
    var total = subtotal + flete + iva;
    var totalEl = document.getElementById('asesorLiqTotal');
    if (totalEl) totalEl.textContent = formatCOPDec(total);
    return { ok: true, flete: flete, iva: iva, total: total };
  }

  function saveQuoteFlete(fromField) {
    var quoteId = openDetailCtx.quoteId;
    var codigo = sessionCodigo();
    var fleteInput = document.getElementById('asesorQuoteFleteInput');
    var ivaInput = document.getElementById('asesorQuoteFleteIvaInput');
    if (!quoteId || !codigo || !fleteInput || !ivaInput) return;
    var values = readLiquidacionFleteValues({ from: fromField || '' });
    if (!values.ok) {
      setFleteStatus('Flete o IVA inválido.', 'error');
      return;
    }
    fleteInput.value = formatFleteInput(values.flete);
    ivaInput.value = formatFleteInput(values.iva);
    setFleteStatus('Guardando flete…', '');
    postApi({
      action: 'set_quote_flete',
      asesor_codigo: codigo,
      nit: codigo,
      quote_id: quoteId,
      flete_antes_iva: values.flete,
      flete_iva: values.iva
    }).then(function (data) {
      if (!data || !data.ok) {
        var err = (data && data.error) || 'No se pudo guardar el flete.';
        if (/acci[oó]n no v[aá]lida/i.test(err)) {
          err = 'El servidor está desactualizado. Cierra y vuelve a abrir tools\\ABRIR.bat.';
        }
        setFleteStatus(err, 'error');
        return;
      }
      var patched = applyFleteToQuoteLocal(openDetailCtx.quote || {}, values.flete, values.iva);
      if (data.totals && typeof data.totals === 'object') {
        patched.totals = Object.assign({}, patched.totals || {}, data.totals);
      }
      openDetailCtx.quote = patched;
      function applyPatch(list, idx) {
        if (!list || idx < 0 || !list[idx]) return;
        list[idx] = Object.assign({}, list[idx], { totals: patched.totals });
      }
      if (openDetailCtx.mode === 'nuevas') applyPatch(nuevasCache, openDetailCtx.idx);
      else if (openDetailCtx.mode === 'duplicadas') applyPatch(duplicadasCache, openDetailCtx.idx);
      else if (openDetailCtx.mode === 'gp') applyPatch(gpCache, openDetailCtx.idx);
      else applyPatch(quotesCache, openDetailCtx.idx);
      try {
        if (openDetailCtx.mode !== 'nuevas') refreshHistorialPanels();
      } catch (e) { /* ignore */ }
      setFleteStatus(data.message || 'Flete guardado.', 'ok');
    }).catch(function () {
      setFleteStatus(
        isLocalHost() ? 'No se pudo guardar. Ejecuta tools\\ABRIR.bat.' : 'No se pudo guardar en el servidor.',
        'error'
      );
    });
  }

  function fitQuoteCopyTextarea(textarea) {
    if (!textarea) return;
    try {
      textarea.style.height = 'auto';
      var next = Math.max(textarea.scrollHeight || 0, 88);
      textarea.style.height = Math.min(next + 4, 640) + 'px';
      textarea.scrollTop = 0;
    } catch (e) { /* ignore */ }
  }

  function bindQuoteCopyButton() {
    var btn = document.getElementById('asesorQuoteCopyBtn');
    var textarea = document.getElementById('asesorQuoteCopyText');
    var status = document.getElementById('asesorQuoteCopyStatus');
    if (!btn || !textarea) return;
    fitQuoteCopyTextarea(textarea);
    if (btn.getAttribute('data-bound') === '1') return;
    btn.setAttribute('data-bound', '1');

    function setCopyStatus(msg, kind) {
      if (!status) return;
      status.textContent = msg || '';
      status.className = 'admin-quote-copy-status' + (kind ? ' is-' + kind : '');
    }

    function selectAllFromStart() {
      try {
        textarea.select();
        textarea.scrollTop = 0;
      } catch (e) { /* ignore */ }
    }

    textarea.addEventListener('focus', function () {
      selectAllFromStart();
    });

    btn.addEventListener('click', function () {
      var text = textarea.value || '';
      if (!text) return;
      try { textarea.focus(); } catch (e0) { /* ignore */ }
      selectAllFromStart();

      function onOk() {
        setCopyStatus('Copiado al portapapeles.', 'ok');
        window.setTimeout(function () { setCopyStatus('', ''); }, 2200);
      }

      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(onOk).catch(function () {
          try {
            if (document.execCommand('copy')) onOk();
            else setCopyStatus('Selecciona el texto y usa Ctrl+C.', 'error');
          } catch (e) {
            setCopyStatus('Selecciona el texto y usa Ctrl+C.', 'error');
          }
        });
        return;
      }

      try {
        if (document.execCommand('copy')) onOk();
        else setCopyStatus('Selecciona el texto y usa Ctrl+C.', 'error');
      } catch (e2) {
        setCopyStatus('Selecciona el texto y usa Ctrl+C.', 'error');
      }
    });
  }

  function bindQuoteFleteEditor() {
    var fleteInput = document.getElementById('asesorQuoteFleteInput');
    var ivaInput = document.getElementById('asesorQuoteFleteIvaInput');
    if (!fleteInput || !ivaInput) return;
    if (fleteInput.getAttribute('data-bound') === '1') return;
    fleteInput.setAttribute('data-bound', '1');
    ivaInput.setAttribute('data-bound', '1');

    fleteInput.addEventListener('input', function () {
      readLiquidacionFleteValues({ from: 'flete' });
      setFleteStatus('', '');
    });
    fleteInput.addEventListener('change', function () {
      saveQuoteFlete('flete');
    });
    fleteInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        fleteInput.blur();
      }
    });

    ivaInput.addEventListener('input', function () {
      readLiquidacionFleteValues({ from: 'iva' });
      setFleteStatus('', '');
    });
    ivaInput.addEventListener('change', function () {
      saveQuoteFlete('iva');
    });
    ivaInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        ivaInput.blur();
      }
    });
  }

  function applyEmpresaToQuoteLocal(quote, empresa) {
    var q = Object.assign({}, quote || {});
    var totals = Object.assign({}, (q.totals && typeof q.totals === 'object') ? q.totals : {});
    totals.empresa = empresa;
    q.totals = totals;
    q.empresa = empresa;
    return q;
  }

  function saveQuoteEmpresa() {
    var sel = document.getElementById('asesorQuoteEmpresa');
    var quoteId = openDetailCtx.quoteId;
    var codigo = sessionCodigo();
    if (!sel || !quoteId || !codigo) return;
    var empresa = String(sel.value || '').trim() || 'VALTECH MAYORISTA S.A.S.';
    var localQuote = openDetailCtx.quote || {};
    openDetailCtx.quote = applyEmpresaToQuoteLocal(localQuote, empresa);

    function applyPatch(list, idx) {
      if (!list || idx < 0 || !list[idx]) return;
      list[idx] = applyEmpresaToQuoteLocal(list[idx], empresa);
    }
    if (openDetailCtx.mode === 'nuevas') applyPatch(nuevasCache, openDetailCtx.idx);
    else if (openDetailCtx.mode === 'duplicadas') applyPatch(duplicadasCache, openDetailCtx.idx);
    else if (openDetailCtx.mode === 'gp') applyPatch(gpCache, openDetailCtx.idx);
    else applyPatch(quotesCache, openDetailCtx.idx);

    setFleteStatus('Guardando empresa…', '');
    postApi({
      action: 'set_quote_empresa',
      asesor_codigo: codigo,
      quote_id: quoteId,
      empresa: empresa
    }).then(function (data) {
      if (!data || !data.ok) {
        var err = (data && data.error) || 'No se pudo guardar la empresa.';
        if (/acci[oó]n no v[aá]lida/i.test(err)) {
          err = 'El servidor está desactualizado. Sube api/auth.php o reinicia tools\\ABRIR.bat.';
        }
        setFleteStatus(err, 'error');
        return;
      }
      var saved = String(data.empresa || empresa).trim() || empresa;
      openDetailCtx.quote = applyEmpresaToQuoteLocal(openDetailCtx.quote || {}, saved);
      if (openDetailCtx.mode === 'nuevas') applyPatch(nuevasCache, openDetailCtx.idx);
      else if (openDetailCtx.mode === 'duplicadas') applyPatch(duplicadasCache, openDetailCtx.idx);
      else if (openDetailCtx.mode === 'gp') applyPatch(gpCache, openDetailCtx.idx);
      else applyPatch(quotesCache, openDetailCtx.idx);
      setFleteStatus(data.message || 'Empresa actualizada.', 'ok');
    }).catch(function () {
      setFleteStatus(
        isLocalHost() ? 'No se pudo guardar. Ejecuta tools\\ABRIR.bat.' : 'No se pudo guardar en el servidor.',
        'error'
      );
    });
  }

  function bindQuoteEmpresaSelect() {
    var sel = document.getElementById('asesorQuoteEmpresa');
    if (!sel) return;
    if (sel.getAttribute('data-bound') === '1') return;
    sel.setAttribute('data-bound', '1');
    sel.addEventListener('change', function () {
      saveQuoteEmpresa();
    });
  }

  function saveQuoteComentario() {
    var quoteId = openDetailCtx.quoteId;
    var codigo = sessionCodigo();
    var ta = document.getElementById('asesorQuoteComentario');
    if (!quoteId || !codigo || !ta) return;
    var comentario = String(ta.value || '').trim();
    setComentarioStatus('Guardando…', '');
    postApi({
      action: 'set_quote_comentario',
      asesor_codigo: codigo,
      quote_id: quoteId,
      comentario: comentario
    }).then(function (data) {
      if (!data || !data.ok) {
        var err = (data && data.error) || 'No se pudo guardar el comentario.';
        if (/acci[oó]n no v[aá]lida/i.test(err)) {
          err = 'El servidor está desactualizado. Cierra y vuelve a abrir tools\\ABRIR.bat.';
        }
        setComentarioStatus(err, 'error');
        return;
      }
      var patch = {
        asesor_comentario: data.asesor_comentario != null ? data.asesor_comentario : comentario,
        asesor_comentario_at: data.asesor_comentario_at || new Date().toISOString(),
        asesor_comentario_by: data.asesor_comentario_by || codigo
      };
      function applyPatch(list, idx) {
        if (!list || idx < 0 || !list[idx]) return;
        list[idx] = Object.assign({}, list[idx], patch);
      }
      if (openDetailCtx.mode === 'nuevas') applyPatch(nuevasCache, openDetailCtx.idx);
      else if (openDetailCtx.mode === 'duplicadas') applyPatch(duplicadasCache, openDetailCtx.idx);
      else if (openDetailCtx.mode === 'gp') applyPatch(gpCache, openDetailCtx.idx);
      else applyPatch(quotesCache, openDetailCtx.idx);
      setComentarioStatus(data.message || 'Comentario guardado.', 'ok');
      var meta = document.querySelector('.admin-quote-comentario-meta');
      if (!meta) {
        var box = document.querySelector('.admin-quote-comentario');
        if (box) {
          meta = document.createElement('p');
          meta.className = 'admin-quote-comentario-meta';
          box.appendChild(meta);
        }
      }
      if (meta) {
        meta.textContent =
          'Última actualización: ' + formatDate(patch.asesor_comentario_at) +
          (patch.asesor_comentario_by ? ' · ' + patch.asesor_comentario_by : '');
      }
    }).catch(function () {
      setComentarioStatus(isLocalHost() ? 'No se pudo guardar. Ejecuta tools\\ABRIR.bat.' : 'No se pudo guardar en el servidor.', 'error');
    });
  }

  function quoteNeedsItemEnrich(q) {
    var items = quoteItems(q);
    if (!items.length) return true;
    for (var i = 0; i < items.length; i++) {
      var line = items[i];
      if (!line) continue;
      var sku = String(line.sku || '').trim();
      if (sku) return false;
      var name = String(line.name || line.descripcion || '').trim().toLowerCase();
      if (name && name.indexOf('productos cotizados') < 0 && name !== '—' && name !== '-') {
        return false;
      }
    }
    return true;
  }

  function fetchQuoteDetail(quote, options) {
    options = options || {};
    if (!quote || !quote.id) {
      return Promise.resolve(withQuoteTrm(quote));
    }
    var id = String(quote.id);
    if (quoteDetailsCache[id] && !options.force && !quoteNeedsItemEnrich(quoteDetailsCache[id])) {
      return Promise.resolve(quoteDetailsCache[id]);
    }
    var codigo = sessionCodigo();
    if (!codigo) {
      return Promise.resolve(withQuoteTrm(quote));
    }
    var enrichBitrix = options.enrichBitrix === true;
    return postApi({
      action: 'get_quote_asesor',
      asesor_codigo: codigo,
      quote_id: id,
      enrich_bitrix: enrichBitrix ? 1 : 0
    }, { fileWrite: true }).then(function (data) {
      if (data && data.ok && data.quote) {
        quoteDetailsCache[id] = data.quote;
        patchQuoteInAllCaches(id, {
          items: data.quote.items,
          totals: data.quote.totals,
          empresa: data.quote.empresa,
          trm: data.quote.trm,
          bitrix_deal_id: data.quote.bitrix_deal_id
        });
        return data.quote;
      }
      return quoteForDisplayPreview(withQuoteTrm(quote));
    }).catch(function () {
      return quoteForDisplayPreview(withQuoteTrm(quote));
    });
  }

  function quoteForDisplayPreview(quote) {
    if (!quote || typeof quote !== 'object') return quote;
    var id = String(quote.id || '');
    if (id && quoteDetailsCache[id] && !quoteNeedsItemEnrich(quoteDetailsCache[id])) {
      return quoteDetailsCache[id];
    }
    if (quoteItems(quote).length) return quote;
    var totals = quote.totals || {};
    var hasUsd = totals.hasUsd === true || Number(totals.usdIva || totals.usd) > 0;
    var hasCop = totals.hasCop === true || Number(totals.copIva || totals.cop) > 0;
    var currency = (hasUsd && !hasCop) ? 'USD' : 'COP';
    var amount = currency === 'USD'
      ? Number(totals.usdIva || totals.usd || 0)
      : Number(totals.copIva || totals.cop || 0);
    if (!(amount > 0)) return quote;
    var dealId = String(quote.bitrix_deal_id || '').trim();
    var line = {
      sku: '',
      name: 'Productos cotizados',
      referencia: dealId ? ('Bitrix #' + dealId) : '',
      qty: 1,
      currency: currency
    };
    if (currency === 'USD') {
      line.usdIva = amount;
      line.totalUsdIva = amount;
    } else {
      line.copIva = amount;
      line.totalCopIva = amount;
    }
    return Object.assign({}, quote, { items: [line] });
  }

  function renderQuoteDetailBody(quote) {
    var body = document.getElementById('asesorQuoteBody');
    if (!body || !quote) return;
    var q = withQuoteTrm(quote);
    var enriched = Object.assign({}, q, { items: quoteItemsResolved(q) });
    body.innerHTML = liquidacionHtml(enriched) + comentarioBlockHtml(q, true);
    bindQuoteFleteEditor();
    bindQuoteCopyButton();
    bindQuoteEmpresaSelect();
  }

  function isDetailStillOpen(fetchGen, quoteId) {
    return openDetailCtx &&
      openDetailCtx.fetchGen === fetchGen &&
      String(openDetailCtx.quoteId || '') === String(quoteId || '');
  }

  function openQuoteDetail(idx, mode) {
    var list = getListForMode(mode);
    var quote = list[idx];
    var modal = document.getElementById('asesorQuoteModal');
    var meta = document.getElementById('asesorQuoteMeta');
    var body = document.getElementById('asesorQuoteBody');
    if (!quote || !modal || !body) return;
    var quoteId = String(quote.id || '');
    openDetailCtx = {
      idx: idx,
      mode: mode || 'historial',
      quoteId: quoteId,
      quote: quote,
      fetchGen: (openDetailCtx.fetchGen || 0) + 1
    };
    var fetchGen = openDetailCtx.fetchGen;
    if (meta) {
      var cierreClienteLabel = quote.fecha_cierre_cliente
        ? (' · Cierre cliente ' + formatDateOnly(quote.fecha_cierre_cliente))
        : '';
      meta.textContent =
        (quote.nombre || '—') + ' · NIT ' + (normalizeNitQuery(quote.nit) || '') +
        ' · ' + formatDate(quote.created_at) + cierreClienteLabel;
    }
    modal.hidden = false;
    renderQuoteDetailBody(quoteForDisplayPreview(quote));

    function applyIfOpen(nextQuote) {
      if (!isDetailStillOpen(fetchGen, quoteId) || !nextQuote) return;
      openDetailCtx.quote = nextQuote;
      renderQuoteDetailBody(nextQuote);
    }

    if (!resolveQuoteTrm(quote)) {
      loadDefaultTrm().then(function () {
        applyIfOpen(openDetailCtx.quote || quote);
      });
    }

    if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.loadNameMaps === 'function') {
      IZCCotizacionPdf.loadNameMaps().then(function () {
        applyIfOpen(openDetailCtx.quote || quote);
      });
    }

    fetchQuoteDetail(quote, { enrichBitrix: true, force: true })
      .then(function (full) {
        applyIfOpen(full);
      })
      .catch(function () {});
  }

  function fetchQuoteForPdf(quote) {
    if (!quote || !quote.id) {
      return Promise.resolve(withQuoteTrm(quote));
    }
    var mapsReady = Promise.resolve();
    if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.loadNameMaps === 'function') {
      mapsReady = IZCCotizacionPdf.loadNameMaps();
    }
    return Promise.all([
      loadDefaultTrm(),
      mapsReady,
      fetchQuoteDetail(quote, { enrichBitrix: true, force: quoteNeedsItemEnrich(quote) })
    ]).then(function (parts) {
      return parts[2] || withQuoteTrm(quote);
    });
  }

  function downloadQuotePdf(quote, currency) {
    if (!quote) {
      setMessage('Cotización no encontrada.', 'error');
      return;
    }
    if (!window.IZCCotizacionPdf || typeof IZCCotizacionPdf.open !== 'function') {
      setMessage('No se pudo cargar el generador de PDF.', 'error');
      return;
    }
    // Placeholder (gesto del usuario). Reutiliza ventana abierta por el patch HTML si existe.
    var pdfWin = null;
    try {
      if (window.__IZC_PDF_PENDING_WIN && !window.__IZC_PDF_PENDING_WIN.closed) {
        pdfWin = window.__IZC_PDF_PENDING_WIN;
      }
    } catch (ePend) {
      pdfWin = null;
    }
    try { window.__IZC_PDF_PENDING_WIN = null; } catch (eClr) { /* ignore */ }
    if (!pdfWin) {
      try {
        pdfWin = window.open('about:blank', '_blank');
      } catch (eOpen) {
        pdfWin = null;
      }
    }
    if (pdfWin) {
      try {
        pdfWin.document.open();
        pdfWin.document.write(
          '<!doctype html><html><head><meta charset="utf-8"><title>Preparando PDF…</title></head>' +
          '<body style="font-family:Segoe UI,Arial,sans-serif;padding:28px;color:#333">' +
          '<p>Preparando PDF…</p></body></html>'
        );
        pdfWin.document.close();
      } catch (eWrite) { /* ignore */ }
    }

    setMessage('Preparando PDF…', '');
    // No bloquear el PDF si el enrich tarda: timeout corto y abrir con lo que haya.
    var enrichDone = false;
    var enrichTimer = setTimeout(function () {
      if (enrichDone) return;
      enrichDone = true;
      downloadQuotePdfReady(quote, currency, pdfWin);
    }, 2500);
    fetchQuoteForPdf(quote).then(function (fullQuote) {
      if (enrichDone) return;
      enrichDone = true;
      clearTimeout(enrichTimer);
      downloadQuotePdfReady(fullQuote || quote, currency, pdfWin);
    }).catch(function () {
      if (enrichDone) return;
      enrichDone = true;
      clearTimeout(enrichTimer);
      downloadQuotePdfReady(quote, currency, pdfWin);
    });
  }

  function downloadQuotePdfReady(quote, currency, pdfWin) {
    function closePdfWin() {
      if (!pdfWin) return;
      try {
        if (!pdfWin.closed) pdfWin.close();
      } catch (eClose) { /* ignore */ }
      pdfWin = null;
    }
    if (!quote) {
      closePdfWin();
      setMessage('Cotización no encontrada.', 'error');
      return;
    }
    var vendedor = String(quote.seller_name || '').trim();
    var codigo = sessionCodigo();
    if (!vendedor && window.IZCAuth && IZCAuth.getSessionNombre) {
      vendedor = String(IZCAuth.getSessionNombre() || '').trim();
    }
    if (vendedor && codigo && vendedor.indexOf(codigo) === -1) {
      vendedor = codigo + ' · ' + vendedor;
    } else if (!vendedor) {
      vendedor = codigo;
    }
    var empresaSel = document.getElementById('asesorQuoteEmpresa');
    var empresa = (empresaSel && empresaSel.value) || resolveEmpresaForQuote(withQuoteTrm(quote));

    function isLikelyBitrixDealId(val) {
      if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.isLikelyBitrixDealId === 'function') {
        return IZCCotizacionPdf.isLikelyBitrixDealId(val);
      }
      var s = String(val || '').trim();
      return s && /^\d+$/.test(s) && s.length <= 12 && !/^20\d{6,}/.test(s);
    }

    function openPdf(dealId) {
      var numero = String(dealId || '').trim();
      var hasBitrix = isLikelyBitrixDealId(numero);
      var q = Object.assign({}, withQuoteTrm(quote), {
        bitrix_deal_id: hasBitrix ? numero : (quote.bitrix_deal_id || ''),
        empresa: empresa,
        totals: Object.assign({}, quote.totals || {}, { empresa: empresa })
      });
      var extras = {
        empresa: empresa,
        vendedor: vendedor,
        currency: currency || 'COP',
        targetWindow: pdfWin || undefined,
        autoPrint: false
      };
      if (hasBitrix) {
        extras.numero = numero;
      } else {
        // Abrir igual: no depender de Bitrix para ver/imprimir el PDF.
        extras.numeroPendiente = numero || 'Pendiente';
      }
      var opened = IZCCotizacionPdf.open(q, extras);
      if (opened && typeof opened.then === 'function') {
        return opened.then(function (ok) {
          if (!ok) {
            closePdfWin();
            setMessage('No se pudo abrir el PDF. Prueba de nuevo.', 'error');
            return false;
          }
          setMessage(
            hasBitrix ? 'PDF abierto en otra pestaña.' : 'PDF abierto. N° Bitrix pendiente de sincronizar.',
            hasBitrix ? 'ok' : 'warn'
          );
          return true;
        }).catch(function () {
          closePdfWin();
          setMessage('No se pudo generar el PDF.', 'error');
          return false;
        });
      }
      if (opened === false) {
        closePdfWin();
        setMessage('No se pudo abrir el PDF. Prueba de nuevo.', 'error');
        return false;
      }
      setMessage(
        hasBitrix ? 'PDF abierto en otra pestaña.' : 'PDF abierto. N° Bitrix pendiente de sincronizar.',
        hasBitrix ? 'ok' : 'warn'
      );
      return true;
    }

    function rememberDeal(dealId) {
      dealId = String(dealId || '').trim();
      if (!isLikelyBitrixDealId(dealId) || !quote) return;
      quote.bitrix_deal_id = dealId;
      try {
        [quotesCache, nuevasCache, duplicadasCache, gpCache].forEach(function (list) {
          if (!Array.isArray(list)) return;
          list.forEach(function (q) {
            if (q && String(q.id) === String(quote.id)) q.bitrix_deal_id = dealId;
          });
        });
        if (quote.id) {
          patchQuoteInAllCaches(String(quote.id), { bitrix_deal_id: dealId });
        }
      } catch (e) { /* ignore */ }
    }

    function resolveDealFromApi() {
      return postApi({
        action: 'resolve_quote_bitrix_deal',
        asesor_codigo: codigo,
        nit: codigo,
        quote_id: quote.id
      }).then(function (data) {
        var dealId = '';
        if (data && data.ok) {
          dealId = String(data.bitrix_deal_id || data.deal_id || data.resolved_bitrix_deal_id || '').trim();
        }
        if (!isLikelyBitrixDealId(dealId) && data && data.resolved_bitrix_deal_id) {
          dealId = String(data.resolved_bitrix_deal_id).trim();
        }
        return {
          dealId: isLikelyBitrixDealId(dealId) ? dealId : '',
          error: (data && (data.error || data.resolve_error)) || ''
        };
      });
    }

    function resolveDealFallbackList() {
      return postApi({
        action: 'list_quotes_asesor',
        asesor_codigo: codigo,
        nit: codigo,
        filtro: 'all',
        resolve_deal_quote_id: quote.id
      }).then(function (data) {
        var dealId = '';
        if (data && data.resolved_bitrix_deal_id) {
          dealId = String(data.resolved_bitrix_deal_id).trim();
        }
        if (!isLikelyBitrixDealId(dealId) && data && Array.isArray(data.quotes)) {
          data.quotes.forEach(function (row) {
            if (row && String(row.id) === String(quote.id) && row.bitrix_deal_id) {
              dealId = String(row.bitrix_deal_id).trim();
            }
          });
        }
        return {
          dealId: isLikelyBitrixDealId(dealId) ? dealId : '',
          error: (data && data.resolve_error) || ''
        };
      });
    }

    var known = String(quote.bitrix_deal_id || quote.deal_id || '').trim();
    if (known && !isLikelyBitrixDealId(known)) known = '';
    if (known) {
      openPdf(known);
      return;
    }
    // Sin N° Bitrix: abrir PDF de inmediato; resolver Bitrix en paralelo (si llega, reescribe).
    openPdf('');
    if (!quote.id) return;

    resolveDealFromApi().then(function (res) {
      if (res.dealId) {
        rememberDeal(res.dealId);
        // Reescribir solo si la pestaña sigue en “preparando/pendiente” (no romper PDF ya listo).
        try {
          if (pdfWin && !pdfWin.closed) {
            var title = '';
            try { title = String(pdfWin.document && pdfWin.document.title || ''); } catch (eT) { title = ''; }
            if (/preparando|pendiente/i.test(title) || !title) {
              openPdf(res.dealId);
            }
          }
        } catch (eRe) { /* ignore */ }
        return null;
      }
      return resolveDealFallbackList().then(function (res2) {
        if (res2.dealId) {
          rememberDeal(res2.dealId);
          try {
            if (pdfWin && !pdfWin.closed) {
              var title2 = '';
              try { title2 = String(pdfWin.document && pdfWin.document.title || ''); } catch (eT2) { title2 = ''; }
              if (/preparando|pendiente/i.test(title2) || !title2) {
                openPdf(res2.dealId);
              }
            }
          } catch (eRe2) { /* ignore */ }
        }
      });
    }).catch(function () { /* PDF ya abierto */ });
  }

  function loadClientes(options) {
    options = options || {};
    var codigo = sessionCodigo();
    var forceBitrix = !!options.refreshBitrix;
    var useFast = options.fast !== false && !forceBitrix;
    if (!forceBitrix && !options.forceReload && clientesLoaded) {
      renderClientes(clientesCache);
      return Promise.resolve();
    }
    if (!forceBitrix && clientesLoadPromise) {
      return clientesLoadPromise;
    }
    if (!options.silent) {
      setMessage(forceBitrix ? 'Consultando clientes en Bitrix…' : 'Cargando clientes…', '');
    } else if (!clientesLoaded && activeTab === 'clientes') {
      showClientesLoading();
    }
    clientesLoadPromise = postApi({
      action: 'list_clientes_asesor',
      asesor_codigo: codigo,
      nit: codigo,
      refresh_bitrix: forceBitrix ? 1 : 0,
      fast: useFast ? 1 : 0
    }).then(function (data) {
      clientesLoaded = true;
      if (!data.ok) {
        if (!options.silent) setMessage(data.error || 'No se pudieron cargar clientes.', 'error');
        if (!clientesCache.length) renderClientes([]);
        return;
      }
      renderClientes(asFlatArray(data.clientes));
      schedulePanelSnapshotPersist();
      if (!options.silent) {
        if (forceBitrix && data.bitrix_synced) {
          setMessage(
            'Bitrix actualizado: ' + String(data.bitrix_count || 0) +
            ' empresas · total en panel: ' + String(data.count || 0),
            'ok'
          );
        } else {
          setMessage('', '');
        }
      }
    }).catch(function (err) {
      clientesLoaded = true;
      if (!options.silent) {
        setMessage(apiOfflineMessage(err && err.message ? String(err.message) : ''), 'error');
      }
      if (!clientesCache.length) renderClientes([]);
    }).finally(function () {
      clientesLoadPromise = null;
    });
    return clientesLoadPromise;
  }

  function quoteLooksAssignedToMe(q) {
    if (!q || typeof q !== 'object') return false;
    var me = String(sessionCodigo() || '').toUpperCase().replace(/[\s.]/g, '');
    if (!me) return false;
    var assigned = String(q.assigned_vendedor || q.vendedor_codigo || q.assigned_asesor || '').toUpperCase();
    var m = assigned.match(/\bV(\d{1,4})\b/);
    if (m) assigned = 'V' + String(parseInt(m[1], 10));
    else assigned = assigned.replace(/[\s.]/g, '');
    return assigned === me;
  }

  function collectGpQuotesFromBundle(data) {
    var gp = asFlatArray(data.gp || data.quotes_gp);
    if (gp.length) return gp;
    var extra = [];
    ['quotes', 'historial', 'nuevas', 'duplicadas'].forEach(function (k) {
      asFlatArray(data[k]).forEach(function (q) {
        if (!q) return;
        var src = String(q.quote_source || '').toLowerCase();
        var gpCode = String(q.gp_codigo || q.asesor_cotizado_by || '').toUpperCase();
        if ((src === 'gp' || /^GP\d/.test(gpCode)) && quoteLooksAssignedToMe(q)) extra.push(q);
      });
    });
    return extra;
  }

  function applyQuotesBundle(data) {
    if (!data || !data.ok) return;
    var historial = onlyPricedQuotes(data.historial);
    var nuevas = onlyPricedQuotes(data.nuevas);
    var duplicadas = onlyPricedQuotes(data.duplicadas);
    var gp = onlyPricedQuotes(collectGpQuotesFromBundle(data));
    var quotes = onlyPricedQuotes(data.quotes);
    // historial:[] es truthy en JS y borraba el panel; si viene vacío, usar quotes.
    if (!historial.length && quotes.length) {
      historial = quotes;
    }
    var hasBundleKeys = data.historial != null || data.nuevas != null || data.duplicadas != null || data.gp != null || data.quotes_gp != null;
    if (hasBundleKeys) {
      renderQuotes(historial, { replace: true });
      renderNuevas(nuevas, { replace: true });
      renderDuplicadas(duplicadas, { replace: true });
      renderGpQuotes(gp, { replace: true });
    } else if (data.filtro === 'historial' || data.filtro === 'cotizado' || data.filtro === 'cotizados' || !data.filtro) {
      renderQuotes(quotes, { replace: true });
    } else if (data.filtro === 'nuevas') {
      renderNuevas(quotes, { replace: true });
    } else if (data.filtro === 'duplicadas') {
      renderDuplicadas(quotes, { replace: true });
    } else if (data.filtro === 'gp' || data.filtro === 'cotizaciones_gp') {
      renderGpQuotes(quotes, { replace: true });
    }
    // renderQuotes pone el contador = length; alinear con filas visibles (sin precio 0).
    if (hasBundleKeys) {
      updateQuoteCounts({
        count_nuevas: nuevas.length,
        count_historial: historial.length,
        count_duplicadas: duplicadas.length,
        count_gp: gp.length
      });
    } else {
      updateQuoteCounts(data);
    }
    quotesPanelsLoaded = true;
    schedulePanelSnapshotPersist();
  }

  function loadAllQuotePanels(options) {
    options = options || {};
    var codigo = sessionCodigo();
    if (!codigo) return Promise.resolve();
    if (quotesPanelsLoaded && !options.syncBitrix && !options.forceReload && !options.background) {
      return Promise.resolve();
    }
    if (quotesPanelsLoadPromise && !options.syncBitrix && !options.forceReload) {
      return quotesPanelsLoadPromise;
    }
    if (!options.silent && !options.background) setMessage('Cargando cotizaciones…', '');
    if (!quotesPanelsLoaded && !quotesCache.length && !nuevasCache.length) {
      showQuoteCountsLoading();
    }
    var payload = {
      action: 'list_quotes_asesor',
      asesor_codigo: codigo,
      nit: codigo,
      bundle: 1,
      // Tras sync Bitrix no usar fast: hay que remarcar duplicadas en servidor.
      fast: options.syncBitrix ? 0 : 1
    };
    if (options.syncBitrix) payload.sync_bitrix = true;
    if (options.skipCache) payload.skip_cache = 1;
    quotesPanelsLoadPromise = postApi(payload).then(function (data) {
      if (!data || !data.ok) {
        if (!options.silent && !options.background) {
          setMessage((data && data.error) || 'No se pudieron cargar las cotizaciones.', 'error');
        }
        // No marcar como cargado: permitir reintento.
        return null;
      }
      applyQuotesBundle(data);
      var total = Number(data.count_historial || 0) + Number(data.count_nuevas || 0);
      // Empujar a Bitrix los estados que ya tiene el panel (sin tocar cada fila a mano).
      if (!options._skipPushEstados && total > 0 && !options.fast) {
        pushEstadosToBitrix({ silent: true, background: true });
      }
      if (!options.background) maybeShowQuotesSyncHint(data, 'quotes');
      if (!options.silent && !options.background) setMessage('', '');
      return data;
    }).catch(function () {
      if (!options.silent && !options.background) setMessage(apiOfflineMessage(), 'error');
    }).finally(function () {
      quotesPanelsLoadPromise = null;
    });
    return quotesPanelsLoadPromise;
  }

  function syncQuotesBitrixBackground() {
    return loadAllQuotePanels({ silent: true, background: true, forceReload: true, syncBitrix: true });
  }

  function loadDuplicadas(options) {
    options = options || {};
    if (!options.forceReload && quotesPanelsLoaded && !options.syncBitrix) {
      applyAsesorDuplicadasFilter();
      return Promise.resolve();
    }
    var codigo = sessionCodigo();
    if (!options.silent) setMessage('Cargando cotizaciones duplicadas…', '');
    var payload = {
      action: 'list_quotes_asesor',
      asesor_codigo: codigo,
      nit: codigo,
      filtro: 'duplicadas',
      fast: 1,
      list_only: 1
    };
    if (options.syncBitrix) payload.sync_bitrix = true;
    return postApi(payload).then(function (data) {
      if (!data.ok) {
        if (!options.silent) setMessage(data.error || 'No se pudieron cargar las cotizaciones duplicadas.', 'error');
        renderDuplicadas([]);
        return;
      }
      updateQuoteCounts(data);
      renderDuplicadas(onlyPricedQuotes(data.quotes));
      quotesPanelsLoaded = true;
      schedulePanelSnapshotPersist();
      if (!options.silent) setMessage('', '');
    }).catch(function () {
      if (!options.silent) setMessage(apiOfflineMessage(), 'error');
      renderDuplicadas([]);
    });
  }

  function loadQuotes(options) {
    options = options || {};
    if (!options.forceReload && quotesPanelsLoaded && !options.syncBitrix) {
      renderQuotes(quotesCache);
      return Promise.resolve();
    }
    var codigo = sessionCodigo();
    if (!options.silent) setMessage('Cargando historial…', '');
    var payload = {
      action: 'list_quotes_asesor',
      asesor_codigo: codigo,
      nit: codigo,
      filtro: 'historial',
      fast: 1,
      list_only: 1
    };
    if (options.syncBitrix) payload.sync_bitrix = true;
    return postApi(payload).then(function (data) {
      if (!data.ok) {
        if (!options.silent) setMessage(data.error || 'No se pudo cargar el historial.', 'error');
        renderQuotes([]);
        return;
      }
      updateQuoteCounts(data);
      renderQuotes(onlyPricedQuotes(data.quotes));
      quotesPanelsLoaded = true;
      schedulePanelSnapshotPersist();
      maybeShowQuotesSyncHint(data, 'quotes');
      if (!options.silent) setMessage('', '');
    }).catch(function () {
      if (!options.silent) setMessage(apiOfflineMessage(), 'error');
      renderQuotes([]);
    });
  }

  function loadNuevas(options) {
    options = options || {};
    if (!options.forceReload && quotesPanelsLoaded && !options.syncBitrix) {
      renderNuevas(nuevasCache);
      return Promise.resolve();
    }
    var codigo = sessionCodigo();
    if (!options.silent) setMessage('Cargando cotizaciones de clientes…', '');
    var payload = {
      action: 'list_quotes_asesor',
      asesor_codigo: codigo,
      nit: codigo,
      filtro: 'nuevas',
      fast: 1,
      list_only: 1
    };
    if (options.syncBitrix) payload.sync_bitrix = true;
    return postApi(payload).then(function (data) {
      if (!data.ok) {
        if (!options.silent) setMessage(data.error || 'No se pudieron cargar las cotizaciones de clientes.', 'error');
        renderNuevas([]);
        return;
      }
      updateQuoteCounts(data);
      renderNuevas(onlyPricedQuotes(data.quotes));
      quotesPanelsLoaded = true;
      schedulePanelSnapshotPersist();
      maybeShowQuotesSyncHint(data, 'nuevas');
      if (!options.silent) setMessage('', '');
    }).catch(function () {
      if (!options.silent) setMessage(apiOfflineMessage(), 'error');
      renderNuevas([]);
    });
  }

  function findLatestNuevaForNit(nit) {
    var want = normalizeNitQuery(nit);
    if (!want) return null;
    var best = null;
    nuevasCache.forEach(function (q) {
      if (!q || !q.id) return;
      var qNit = normalizeNitQuery(q.nit);
      if (qNit !== want) return;
      if (!best || String(q.created_at || '') > String(best.created_at || '')) best = q;
    });
    return best;
  }

  function openCotizadorAsesor(idx) {
    var quote = nuevasCache[idx];
    if (!quote || !quote.id) {
      setMessage('No se encontró la cotización para cotizar.', 'error');
      return;
    }
    openCotizadorCliente({
      quote_id: quote.id,
      nit: quote.nit,
      nombre: quote.nombre,
      items: quoteItems(quote),
      trm: quote.trm,
      empresa: quote.empresa || (quote.totals && quote.totals.empresa) || '',
      fecha_cierre: quote.fecha_cierre || ''
    });
  }

  function openRecotizarFromDetail() {
    var quote = openDetailCtx && openDetailCtx.quote;
    if (!quote || !quote.id) {
      setMessage('No se encontró la cotización para recotizar.', 'error');
      return;
    }
    var items = quoteItems(quote);
    if (!items.length) {
      setMessage('Esta cotización no tiene productos para recotizar.', 'error');
      return;
    }
    var empresa =
      (document.getElementById('asesorQuoteEmpresa') || {}).value ||
      quote.empresa ||
      (quote.totals && quote.totals.empresa) ||
      '';
    openCotizadorCliente({
      nit: quote.nit,
      nombre: quote.nombre,
      items: items,
      trm: quote.trm,
      empresa: empresa,
      fecha_cierre: quote.fecha_cierre || '',
      recotizar: true,
      duplicated_from: quote.id
    });
  }

  function openCotizadorCliente(opts) {
    opts = opts || {};
    var nit = normalizeNitQuery(opts.nit);
    var nombre = String(opts.nombre || '').trim();
    var quoteId = String(opts.quote_id || opts.id || '').trim();
    var items = Array.isArray(opts.items) ? opts.items : [];
    var trm = opts.trm;
    var recotizar = !!opts.recotizar;
    var duplicatedFrom = String(opts.duplicated_from || '').trim();
    var empresa = String(opts.empresa || '').trim();
    var fechaCierre = toDateInputValue(opts.fecha_cierre);
    if (!nit) {
      setMessage('Falta el NIT del cliente para cotizar.', 'error');
      return;
    }
    // Recotizar = siempre cotización nueva (sin quote_id).
    if (recotizar) {
      quoteId = '';
      if (!duplicatedFrom) duplicatedFrom = String(opts.quote_id || opts.id || '').trim();
    }
    // Desde Clientes: si hay una cotización nueva de ese NIT, llevarla al cotizador.
    if (!quoteId && !recotizar) {
      var latest = findLatestNuevaForNit(nit);
      if (latest) {
        quoteId = String(latest.id || '').trim();
        if (!nombre) nombre = String(latest.nombre || '').trim();
        if (!items.length) items = quoteItems(latest);
        if (trm == null) trm = latest.trm;
        if (!empresa) {
          empresa = String(latest.empresa || (latest.totals && latest.totals.empresa) || '').trim();
        }
        if (!fechaCierre) fechaCierre = toDateInputValue(latest.fecha_cierre);
      }
    }
    var seed = {
      asesor_codigo: sessionCodigo(),
      quote_id: quoteId,
      nit: nit,
      nombre: nombre,
      items: items,
      trm: trm,
      empresa: empresa,
      fecha_cierre: fechaCierre,
      recotizar: recotizar,
      duplicated_from: duplicatedFrom
    };
    try {
      if (window.sessionStorage) {
        sessionStorage.setItem('izc_asesor_cotizar', JSON.stringify(seed));
        var code = String(sessionCodigo() || '').trim().toUpperCase();
        if (code) sessionStorage.setItem('izc_asesor_cotizar_' + code, JSON.stringify(seed));
      }
    } catch (e) { /* ignore */ }
    var qs =
      'nit=' + encodeURIComponent(nit) +
      '&nombre=' + encodeURIComponent(nombre);
    if (quoteId) qs += '&quote_id=' + encodeURIComponent(quoteId);
    if (recotizar) qs += '&recotizar=1';
    if (duplicatedFrom) qs += '&duplicated_from=' + encodeURIComponent(duplicatedFrom);
    window.location.href = 'cotizador-asesor.html?' + qs;
  }

  function setQuoteFechaCierre(idx, fecha, mode) {
    mode = mode || 'historial';
    var quote = getListForMode(mode)[idx];
    var codigo = sessionCodigo();
    if (!quote || !quote.id || !codigo) return;
    fecha = String(fecha || '').trim();
    setMessage('Guardando fecha de cierre…', '');
    postApi({
      action: 'set_quote_fecha_cierre',
      asesor_codigo: codigo,
      quote_id: quote.id,
      fecha_cierre: fecha
    }).then(function (data) {
      if (!data || !data.ok) {
        var err = (data && data.error) || 'No se pudo guardar la fecha de cierre.';
        if (/acci[oó]n no v[aá]lida/i.test(err)) {
          err = 'El servidor está desactualizado. Cierra y vuelve a abrir tools\\ABRIR.bat, luego recarga.';
        }
        setMessage(err, 'error');
        loadQuotes({ silent: true });
        loadDuplicadas({ silent: true });
        return;
      }
      patchQuoteInAllCaches(quote.id, {
        fecha_cierre: data.fecha_cierre != null ? data.fecha_cierre : fecha
      });
      refreshHistorialPanels();
      setMessage(data.message || 'Fecha de cierre guardada.', 'ok');
    }).catch(function () {
      setMessage(isLocalHost() ? 'No se pudo guardar. Ejecuta tools\\ABRIR.bat.' : 'No se pudo guardar en el servidor.', 'error');
      loadQuotes({ silent: true });
      loadDuplicadas({ silent: true });
    });
  }

  var pushEstadosPromise = null;
  function pushEstadosToBitrix(options) {
    options = options || {};
    var codigo = sessionCodigo();
    if (!codigo) return Promise.resolve(null);
    if (pushEstadosPromise) return pushEstadosPromise;
    if (!options.silent && !options.background) {
      setMessage('Sincronizando estados a Bitrix…', '');
    }
    pushEstadosPromise = postApi({
      action: 'push_estados_bitrix',
      asesor_codigo: codigo,
      nit: codigo,
      max: 150
    }, { fileWrite: true }).then(function (data) {
      var updated = data && data.push ? Number(data.push.updated || 0) : 0;
      var failed = data && data.push ? Number(data.push.failed || 0) : 0;
      // Sync al cargar el panel: no mostrar aviso (solo al forzar sync manual).
      if (options.silent || options.background) return data;
      if (data && data.ok && updated > 0) {
        setMessage('Se sincronizaron ' + updated + ' cotización(es) a Bitrix.', 'ok');
      } else if (data && failed > 0) {
        setMessage(
          fixUtf8Mojibake((data && data.message) || '') ||
            'No se pudieron sincronizar algunos estados a Bitrix.',
          'error'
        );
      } else if (data && data.message) {
        setMessage(data.message, data.ok ? 'ok' : '');
      }
      return data;
    }).catch(function () {
      if (!options.silent && !options.background) {
        setMessage('No se pudo sincronizar estados a Bitrix.', 'error');
      }
      return null;
    }).finally(function () {
      pushEstadosPromise = null;
    });
    return pushEstadosPromise;
  }

  function setQuoteEstado(idx, estado, mode) {
    mode = mode || 'historial';
    var quote = getListForMode(mode)[idx];
    var codigo = sessionCodigo();
    if (!quote || !quote.id || !codigo) return;
    var prevEstado = quoteEstado(quote);
    var savedAt = new Date().toISOString();
    patchQuoteInAllCaches(quote.id, {
      asesor_estado: estado,
      asesor_estado_at: savedAt,
      asesor_estado_by: codigo
    });
    refreshHistorialPanels();
    setMessage('Actualizando estado…', '');
    postApi({
      action: 'set_quote_estado',
      asesor_codigo: codigo,
      quote_id: quote.id,
      estado: estado
    }, { fileWrite: true }).then(function (data) {
      if (!data || !data.ok) {
        var err = (data && data.error) || 'No se pudo actualizar el estado.';
        if (/acci[oó]n no v[aá]lida/i.test(err)) {
          err = 'El servidor está desactualizado. Cierra y vuelve a abrir tools\\ABRIR.bat, luego recarga.';
        }
        patchQuoteInAllCaches(quote.id, {
          asesor_estado: prevEstado,
          asesor_estado_by: quote.asesor_estado_by || '',
          asesor_estado_at: quote.asesor_estado_at || ''
        });
        refreshHistorialPanels();
        setMessage(err, 'error');
        return;
      }
      updateQuoteCounts(data);
      patchQuoteInAllCaches(quote.id, {
        asesor_estado: data.asesor_estado || estado,
        asesor_estado_at: savedAt,
        asesor_estado_by: codigo
      });
      refreshHistorialPanels();
      var msg = data.message || 'Estado actualizado.';
      var sync = data.bitrix_sync || null;
      if (sync && sync.ok === false && !sync.skipped && sync.error) {
        setMessage(msg, 'error');
      } else {
        setMessage(msg, 'ok');
      }
    }).catch(function () {
      patchQuoteInAllCaches(quote.id, {
        asesor_estado: prevEstado,
        asesor_estado_by: quote.asesor_estado_by || '',
        asesor_estado_at: quote.asesor_estado_at || ''
      });
      refreshHistorialPanels();
      setMessage(isLocalHost() ? 'No se pudo actualizar. Ejecuta tools\\ABRIR.bat.' : 'No se pudo actualizar en el servidor.', 'error');
    });
  }

  function fillProfile() {
    var codigo = sessionCodigo();
    var nombre = (window.IZCAuth && IZCAuth.getSessionNombre && IZCAuth.getSessionNombre()) || '';
    var greet = document.getElementById('asesorGreeting');

    if (!codigo) {
      setMessage('Debes iniciar sesión como asesor.', 'error');
      window.setTimeout(function () {
        window.location.href = 'login.html';
      }, 600);
      return false;
    }
    if (IZCAuth.isAdmin && IZCAuth.isAdmin()) {
      window.location.replace('admin.html');
      return false;
    }
    if (!(IZCAuth.isAsesor && IZCAuth.isAsesor())) {
      window.location.replace('perfil.html');
      return false;
    }
    if (greet && !isEditingNombre()) greet.textContent = 'Hola ' + (nombre || codigo);
    return true;
  }

  function profileCard() {
    return document.querySelector('.profile-name-card');
  }

  function currentAsesorNombre() {
    var codigo = sessionCodigo();
    return ((window.IZCAuth && IZCAuth.getSessionNombre && IZCAuth.getSessionNombre()) || codigo || '').trim();
  }

  function isEditingNombre() {
    var card = profileCard();
    return !!(card && card.classList.contains('is-editing-name'));
  }

  function setNombreEditUi(editing) {
    var card = profileCard();
    var greet = document.getElementById('asesorGreeting');
    var input = document.getElementById('asesorNombreInput');
    var toggle = document.getElementById('asesorNombreToggle');
    var pencil = toggle ? toggle.querySelector('.is-pencil') : null;
    var check = toggle ? toggle.querySelector('.is-check') : null;
    if (card) card.classList.toggle('is-editing-name', !!editing);
    if (toggle) {
      toggle.setAttribute('aria-pressed', editing ? 'true' : 'false');
      toggle.title = editing ? 'Guardar nombre' : 'Editar nombre';
      toggle.setAttribute('aria-label', editing ? 'Guardar nombre' : 'Editar nombre');
    }
    if (pencil) pencil.hidden = !!editing;
    if (check) check.hidden = !editing;
    if (input) {
      input.hidden = !editing;
      if (editing) {
        input.value = currentAsesorNombre();
        window.setTimeout(function () {
          input.focus();
          input.select();
        }, 0);
      }
    }
    if (greet) greet.hidden = !!editing;
  }

  function setNombreStatus(text, type) {
    var el = document.getElementById('asesorNombreStatus');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'auth-message profile-name-status');
      return;
    }
    el.textContent = text || '';
    el.className = 'auth-message profile-name-status' + (type ? ' is-' + type : '');
  }

  function saveAsesorNombre() {
    var codigo = sessionCodigo();
    var input = document.getElementById('asesorNombreInput');
    if (!codigo || !input) return;
    var nombre = String(input.value || '').trim();
    if (nombre.length < 2) {
      setNombreStatus('Ingresa un nombre válido (mínimo 2 caracteres).', 'error');
      setNombreEditUi(true);
      return;
    }
    setNombreStatus('Guardando…', '');
    postApi({
      action: 'update_asesor_nombre',
      asesor_codigo: codigo,
      nit: codigo,
      nombre: nombre
    }).then(function (data) {
      if (!data || !data.ok) {
        var err = (data && data.error) || 'No se pudo guardar el nombre.';
        if (/acci[oó]n no v[aá]lida/i.test(err)) {
          err = 'El servidor está desactualizado. Cierra y vuelve a abrir tools\\ABRIR.bat.';
        }
        setNombreStatus(err, 'error');
        return;
      }
      var saved = String(data.nombre || nombre).trim();
      if (window.IZCAuth && typeof IZCAuth.setSessionNit === 'function') {
        IZCAuth.setSessionNit(codigo, saved, { role: 'asesor', skipUi: true });
      }
      var greet = document.getElementById('asesorGreeting');
      if (greet) greet.textContent = 'Hola ' + (saved || codigo);
      setNombreEditUi(false);
      setNombreStatus(data.message || 'Nombre actualizado.', 'ok');
      window.setTimeout(function () { setNombreStatus('', ''); }, 2500);
    }).catch(function () {
      setNombreStatus(
        isLocalHost() ? 'No se pudo guardar. Ejecuta tools\\ABRIR.bat.' : 'No se pudo guardar en el servidor.',
        'error'
      );
    });
  }

  function ensureEstadoFilterOptions() {
    var historialOpts = [
      { v: '', t: 'Todos' },
      { v: 'cotizado', t: 'Cotizado' },
      { v: 'pendiente', t: 'Pendiente' },
      { v: 'seguimiento', t: 'Seguimiento' },
      { v: 'vendido', t: 'Vendido' },
      { v: 'perdida', t: 'Perdida' },
      { v: 'cerrado_modificado', t: 'Cerrado Modificado' }
    ];
    var duplicadasOpts = [
      { v: '', t: 'Todos' },
      { v: 'cotizado', t: 'Cotizado' },
      { v: 'pendiente', t: 'Pendiente' },
      { v: 'seguimiento', t: 'Seguimiento' },
      { v: 'vendido', t: 'Vendido' },
      { v: 'perdida', t: 'Perdida' }
    ];

    function fillSelect(el, opts) {
      if (!el) return;
      var current = String(el.value || '');
      el.innerHTML = opts.map(function (o) {
        return (
          '<option class="' + (o.v ? 'is-' + o.v : '') + '" value="' + o.v + '">' +
          o.t +
          '</option>'
        );
      }).join('');
      var allowed = {};
      opts.forEach(function (o) { allowed[o.v] = true; });
      el.value = allowed[current] ? current : '';
      el.className = 'admin-filter-select' + (el.value ? ' is-' + el.value : '');
    }

    fillSelect(document.getElementById('asesorQuoteFilterEstado'), historialOpts);
    fillSelect(document.getElementById('asesorDupFilterEstado'), duplicadasOpts);
  }

  function bindUi() {
    ensureEstadoFilterOptions();
    var logout = document.getElementById('asesorLogout');
    if (logout) {
      logout.addEventListener('click', function () {
        if (window.IZCAuth && IZCAuth.logout) IZCAuth.logout({ redirect: 'login.html' });
        else window.location.replace('login.html');
      });
    }
    var nombreToggle = document.getElementById('asesorNombreToggle');
    var nombreInput = document.getElementById('asesorNombreInput');
    if (nombreToggle) {
      nombreToggle.addEventListener('click', function () {
        if (isEditingNombre()) saveAsesorNombre();
        else {
          setNombreStatus('', '');
          setNombreEditUi(true);
        }
      });
    }
    if (nombreInput) {
      nombreInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveAsesorNombre();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setNombreEditUi(false);
          setNombreStatus('', '');
          var greet = document.getElementById('asesorGreeting');
          if (greet) greet.textContent = 'Hola ' + currentAsesorNombre();
        }
      });
    }
    document.querySelectorAll('.admin-stat.is-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setActiveTab(btn.getAttribute('data-tab') || 'clientes');
      });
    });
    var nitSearch = document.getElementById('asesorClientNitSearch');
    if (nitSearch) {
      nitSearch.addEventListener('input', onClientNitSearch);
      nitSearch.addEventListener('search', onClientNitSearch);
    }
    var registerBtn = document.getElementById('asesorClienteRegisterBtn');
    if (registerBtn) {
      registerBtn.addEventListener('click', function () {
        openClienteRegisterModal();
      });
    }
    var refreshBitrixBtn = document.getElementById('asesorClienteRefreshBitrixBtn');
    if (refreshBitrixBtn) {
      refreshBitrixBtn.addEventListener('click', function () {
        loadClientes({ refreshBitrix: true, forceReload: true });
      });
    }
    var clienteModal = document.getElementById('asesorClienteModal');
    if (clienteModal) {
      clienteModal.addEventListener('click', function (e) {
        if (e.target.closest('[data-cliente-modal-close]')) {
          closeClienteRegisterModal();
        }
      });
    }
    var clienteForm = document.getElementById('asesorClienteForm');
    if (clienteForm) {
      clienteForm.addEventListener('submit', function (e) {
        e.preventDefault();
        registerClienteAsesor(true);
      });
    }
    var bodyClientes = document.getElementById('asesorClientesBody');
    if (bodyClientes) {
      bodyClientes.addEventListener('click', function (e) {
        var btn = e.target.closest('.admin-cotizar-cliente');
        if (!btn) return;
        openCotizadorCliente({
          nit: btn.getAttribute('data-nit'),
          nombre: btn.getAttribute('data-nombre')
        });
      });
    }
    var bodyQuotes = document.getElementById('asesorQuotesBody');
    if (bodyQuotes) {
      bodyQuotes.addEventListener('click', function (e) {
        var pdfBtn = e.target.closest('.admin-quote-pdf-row');
        if (pdfBtn) {
          var pdfMode = pdfBtn.getAttribute('data-mode') || 'historial';
          downloadQuotePdf(getListForMode(pdfMode)[Number(pdfBtn.getAttribute('data-idx'))], pdfBtn.getAttribute('data-currency') || 'COP');
          return;
        }
        var btn = e.target.closest('.admin-view-quote');
        if (!btn) return;
        openQuoteDetail(Number(btn.getAttribute('data-idx')), btn.getAttribute('data-mode') || 'historial');
      });
      bodyQuotes.addEventListener('change', function (e) {
        var sel = e.target.closest('.quote-estado-select');
        if (sel) {
          var nextEstado = String(sel.value || '').trim().toLowerCase();
          sel.className = 'quote-estado-select is-' + nextEstado;
          setQuoteEstado(Number(sel.getAttribute('data-idx')), nextEstado, sel.getAttribute('data-mode') || 'historial');
          return;
        }
        var fecha = e.target.closest('.quote-fecha-cierre');
        if (fecha) {
          setQuoteFechaCierre(Number(fecha.getAttribute('data-idx')), fecha.value, fecha.getAttribute('data-mode') || 'historial');
        }
      });
    }

    var bodyGp = document.getElementById('asesorGpBody');
    if (bodyGp) {
      bodyGp.addEventListener('click', function (e) {
        var pdfBtn = e.target.closest('.admin-quote-pdf-row');
        if (pdfBtn) {
          downloadQuotePdf(gpCache[Number(pdfBtn.getAttribute('data-idx'))], pdfBtn.getAttribute('data-currency') || 'COP');
          return;
        }
        var btn = e.target.closest('.admin-view-quote');
        if (!btn) return;
        openQuoteDetail(Number(btn.getAttribute('data-idx')), 'gp');
      });
    }

    var bodyDuplicadas = document.getElementById('asesorDuplicadasBody');
    if (bodyDuplicadas) {
      bodyDuplicadas.addEventListener('click', function (e) {
        var pdfBtn = e.target.closest('.admin-quote-pdf-row');
        if (pdfBtn) {
          downloadQuotePdf(duplicadasCache[Number(pdfBtn.getAttribute('data-idx'))], pdfBtn.getAttribute('data-currency') || 'COP');
          return;
        }
        var btn = e.target.closest('.admin-view-quote');
        if (!btn) return;
        openQuoteDetail(Number(btn.getAttribute('data-idx')), 'duplicadas');
      });
      bodyDuplicadas.addEventListener('change', function (e) {
        var sel = e.target.closest('.quote-estado-select');
        if (sel) {
          var nextEstado = String(sel.value || '').trim().toLowerCase();
          sel.className = 'quote-estado-select is-' + nextEstado;
          setQuoteEstado(Number(sel.getAttribute('data-idx')), nextEstado, 'duplicadas');
          return;
        }
        var fecha = e.target.closest('.quote-fecha-cierre');
        if (fecha) {
          setQuoteFechaCierre(Number(fecha.getAttribute('data-idx')), fecha.value, 'duplicadas');
        }
      });
    }

    var filterEstado = document.getElementById('asesorQuoteFilterEstado');
    var filterFecha = document.getElementById('asesorQuoteFilterFecha');
    var filterNit = document.getElementById('asesorQuoteFilterNit');
    var filterClear = document.getElementById('asesorQuoteFilterClear');
    if (filterEstado) {
      filterEstado.addEventListener('change', function () {
        var v = String(filterEstado.value || '').trim().toLowerCase();
        filterEstado.className = 'admin-filter-select' + (v ? ' is-' + v : '');
        applyAsesorQuotesFilter();
      });
    }
    if (filterFecha) filterFecha.addEventListener('change', applyAsesorQuotesFilter);
    if (filterNit) {
      filterNit.addEventListener('input', applyAsesorQuotesFilter);
      filterNit.addEventListener('search', applyAsesorQuotesFilter);
    }
    if (filterClear) filterClear.addEventListener('click', clearAsesorQuotesFilters);

    var dupFilterEstado = document.getElementById('asesorDupFilterEstado');
    var dupFilterFecha = document.getElementById('asesorDupFilterFecha');
    var dupFilterNit = document.getElementById('asesorDupFilterNit');
    var dupFilterClear = document.getElementById('asesorDupFilterClear');
    if (dupFilterEstado) {
      dupFilterEstado.addEventListener('change', function () {
        var v = String(dupFilterEstado.value || '').trim().toLowerCase();
        dupFilterEstado.className = 'admin-filter-select' + (v ? ' is-' + v : '');
        applyAsesorDuplicadasFilter();
      });
    }
    if (dupFilterFecha) dupFilterFecha.addEventListener('change', applyAsesorDuplicadasFilter);
    if (dupFilterNit) {
      dupFilterNit.addEventListener('input', applyAsesorDuplicadasFilter);
      dupFilterNit.addEventListener('search', applyAsesorDuplicadasFilter);
    }
    if (dupFilterClear) dupFilterClear.addEventListener('click', clearAsesorDuplicadasFilters);

    var bodyNuevas = document.getElementById('asesorNuevasBody');
    if (bodyNuevas) {
      bodyNuevas.addEventListener('click', function (e) {
        var cotizar = e.target.closest('.admin-cotizar-btn');
        if (cotizar) {
          openCotizadorAsesor(Number(cotizar.getAttribute('data-idx')));
          return;
        }
        var btn = e.target.closest('.admin-view-quote');
        if (!btn) return;
        openQuoteDetail(Number(btn.getAttribute('data-idx')), 'nuevas');
      });
    }
    var modal = document.getElementById('asesorQuoteModal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        var pdfModalBtn = e.target.closest('.admin-quote-pdf-modal');
        if (pdfModalBtn) {
          e.preventDefault();
          downloadQuotePdf(openDetailCtx && openDetailCtx.quote, pdfModalBtn.getAttribute('data-currency') || 'COP');
          return;
        }
        if (e.target.closest('#asesorQuoteRecotizarBtn')) {
          e.preventDefault();
          openRecotizarFromDetail();
          return;
        }
        if (e.target.closest('[data-modal-close]')) modal.hidden = true;
        if (e.target.closest('#asesorQuoteComentarioSave')) {
          e.preventDefault();
          saveQuoteComentario();
        }
      });
    }
  }

  function init() {
    bindUi();
    try { restorePanelSnapshot(peekSessionCodigo()); } catch (eSnap) { /* ignore */ }
    if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.loadNameMaps === 'function') {
      IZCCotizacionPdf.loadNameMaps().catch(function () { /* ignore */ });
    }
    loadDefaultTrm().catch(function () { /* ignore */ });
    if (window.IZCLiveSync && typeof IZCLiveSync.on === 'function') {
      IZCLiveSync.on(function (msg) {
        var t = msg && msg.type;
        if (t === IZCLiveSync.TYPES.TRM || t === IZCLiveSync.TYPES.ALL) {
          loadDefaultTrm(true).catch(function () { /* ignore */ });
        }
      });
    }
    setInterval(function () {
      loadDefaultTrm(true).catch(function () { /* ignore */ });
    }, 20000);
    function start() {
      if (!fillProfile()) return;
      var tab = 'clientes';
      var estadoQ = '';
      try {
        var params = new URLSearchParams(window.location.search);
        tab = String(params.get('tab') || 'clientes').trim() || 'clientes';
        estadoQ = String(params.get('estado') || '').trim().toLowerCase();
      } catch (e) { /* ignore */ }
      if (tab !== 'clientes' && tab !== 'nuevas' && tab !== 'quotes' && tab !== 'historial' && tab !== 'duplicadas') tab = 'clientes';
      if (tab === 'historial') tab = 'quotes';
      clearAsesorQuotesFilters();
      clearAsesorDuplicadasFilters();
      var codigo = sessionCodigo() || peekSessionCodigo();
      var dirty = consumePanelQuotesDirty();
      restorePanelSnapshot(codigo);
      setActiveTab(tab);
      if (tab === 'quotes' && estadoQ) {
        var estadoEl = document.getElementById('asesorQuoteFilterEstado');
        if (estadoEl) {
          estadoEl.value = estadoQ;
          estadoEl.className = 'admin-filter-select' + (estadoQ ? ' is-' + estadoQ : '');
        }
        if (quotesPanelsLoaded && typeof applyAsesorQuotesFilter === 'function') {
          applyAsesorQuotesFilter();
        }
      }
      loadAllQuotePanels({ silent: true, background: true, fast: true });
      loadClientes({ silent: true, background: true, fast: true });
    }
    if (window.IZCAuth && typeof IZCAuth.whenSessionReady === 'function') {
      IZCAuth.whenSessionReady().then(start, start);
    } else {
      start();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.IZCAsesorPanel = {
    build: 120,
    downloadQuotePdfAt: function (mode, idx, currency) {
      var list = getListForMode(mode || 'historial');
      downloadQuotePdf(list[Number(idx)], currency || 'COP');
    },
    pushEstadosToBitrix: function () {
      return pushEstadosToBitrix({ silent: false });
    }
  };
  if (window.IZC_ASESOR_ASSET_BUILD && Number(window.IZC_ASESOR_ASSET_BUILD) !== 120) {
    try {
      var mark = 'izc_asesor_build_mismatch_120';
      if (sessionStorage.getItem(mark) !== '1') {
        sessionStorage.setItem(mark, '1');
        location.reload(true);
      }
    } catch (e) { /* ignore */ }
  }
})();
