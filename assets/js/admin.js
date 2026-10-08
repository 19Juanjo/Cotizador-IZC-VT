/* Logica del panel admin: cotizaciones, usuarios, Bitrix, TRM. */
(function () {
  'use strict';

  var API_ORIGIN = 'http://127.0.0.1:8080';
  var activeTab = 'users';
  var quotesCache = [];
  var usersCache = [];
  var asesoresCache = [];
  var productosCache = [];
  var asignarCache = [];
  var ADMIN_SNAP_KEY = 'izc_admin_panel_v1';

  function persistAdminSnapshot() {
    try {
      localStorage.setItem(ADMIN_SNAP_KEY, JSON.stringify({
        at: Date.now(),
        users: usersCache || [],
        quotes: quotesCache || [],
        asesores: asesoresCache || [],
        productos: productosCache || []
      }));
    } catch (e) { /* quota */ }
  }

  function restoreAdminSnapshot() {
    try {
      var data = JSON.parse(localStorage.getItem(ADMIN_SNAP_KEY) || 'null');
      if (!data || typeof data !== 'object') return false;
      if (Array.isArray(data.users) && data.users.length) {
        usersCache = data.users;
        if (typeof renderUsers === 'function') renderUsers(usersCache);
      }
      if (Array.isArray(data.quotes) && data.quotes.length) {
        quotesCache = data.quotes;
        if (typeof renderQuotes === 'function') renderQuotes(quotesCache);
      }
      return !!(usersCache.length || quotesCache.length);
    } catch (e) {
      return false;
    }
  }

  function normalizeNit(value) {
    if (window.IZCAuth && typeof IZCAuth.normalizeNit === 'function') {
      return IZCAuth.normalizeNit(value);
    }
    return String(value == null ? '' : value).replace(/[\s.]/g, '').replace(/-\d$/, '').trim();
  }

  /** Mas reciente arriba, mas antiguo abajo. */
  function sortByNewestCreated(list, field) {
    var key = field || 'created_at';
    return (list || []).slice().sort(function (a, b) {
      var ta = String((a && (a[key] || a.finished_at || a.activity_at)) || '');
      var tb = String((b && (b[key] || b.finished_at || b.activity_at)) || '');
      if (ta !== tb) return tb.localeCompare(ta);
      return String((a && (a.id || a.nit || a.codigo)) || '').localeCompare(
        String((b && (b.id || b.nit || b.codigo)) || '')
      );
    });
  }

  /** Asesores: V1, V2, V3… (numero ascendente). */
  function sortAsesoresByCodigo(list) {
    function num(code) {
      var m = String(code || '').match(/(\d+)/);
      return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
    }
    return (list || []).slice().sort(function (a, b) {
      var na = num(a && a.codigo);
      var nb = num(b && b.codigo);
      if (na !== nb) return na - nb;
      return String((a && a.codigo) || '').localeCompare(String((b && b.codigo) || ''), 'es', { numeric: true });
    });
  }

  var messageTimers = {};

  function setMessage(elId, text, type) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'auth-message');
      return;
    }
    if (messageTimers[elId]) {
      clearTimeout(messageTimers[elId]);
      messageTimers[elId] = null;
    }
    el.textContent = text || '';
    el.className = 'auth-message' + (type ? ' is-' + type : '');
    if (!text) return;
    messageTimers[elId] = setTimeout(function () {
      messageTimers[elId] = null;
      if (!el) return;
      if (el.textContent === text) {
        el.textContent = '';
        el.className = 'auth-message';
      }
    }, 7000);
  }

  function bogotaFromQuoteId(quoteId) {
    var m = String(quoteId || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (!m) return '';
    return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '-05:00';
  }

  function toBogotaDate(value) {
    if (!value) return null;
    var raw = String(value).trim();
    if (!raw) return null;
    var fromId = bogotaFromQuoteId(raw);
    if (fromId) raw = fromId;
    raw = raw.replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw)) {
      raw += '-05:00';
    }
    var d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDate(value) {
    if (!value) return '—';
    var d = toBogotaDate(value);
    if (!d) return String(value);
    return d.toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
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
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    });
  }

  function formatDateDMY(value) {
    if (!value) return '—';
    var raw = String(value).trim();
    var d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      var parts = raw.split('-');
      d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      d = new Date(raw);
    }
    if (isNaN(d.getTime())) return raw;
    var day = String(d.getDate());
    var month = String(d.getMonth() + 1);
    if (day.length < 2) day = '0' + day;
    if (month.length < 2) month = '0' + month;
    return day + '/' + month + '/' + d.getFullYear();
  }

  function todayDMY() {
    return formatDateDMY(new Date());
  }

  function formatDateLongES(value) {
    var d;
    if (value instanceof Date) {
      d = value;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim())) {
      var parts = String(value).trim().split('-');
      d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      d = new Date(value || Date.now());
    }
    if (isNaN(d.getTime())) return '—';
    var months = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  /** Fecha de descarga estilo Excel: 25-ago-26 */
  function formatDateDescargaES(value) {
    var d = value instanceof Date ? value : new Date(value || Date.now());
    if (isNaN(d.getTime())) return '—';
    var months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    var day = String(d.getDate());
    if (day.length < 2) day = '0' + day;
    var yy = String(d.getFullYear()).slice(-2);
    return day + '-' + months[d.getMonth()] + '-' + yy;
  }

  function fileStampDMY(value) {
    var label = formatDateDMY(value);
    if (!label || label === '—') {
      label = todayDMY();
    }
    return String(label).replace(/\//g, '-');
  }

  function cleanSellerDisplayName(name, code) {
    var out = String(name || '').trim();
    if (!out) return '';
    out = out.replace(/^IZC\s+/i, '').replace(/^VALTECH\s+/i, '').trim();
    var c = String(code || '').trim();
    if (c) {
      var re = new RegExp('^' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—:]?\\s*', 'i');
      out = out.replace(re, '').trim();
    }
    out = out.replace(/^V\d+\s+/i, '').trim();
    return out;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatCOP(value) {
    return '$ ' + Math.round(Number(value)).toLocaleString('es-CO') + ' COP';
  }

  function formatCOPDec(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    return '$ ' + n.toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' COP';
  }

  function formatUSD(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    if (window.IZCMoney && typeof IZCMoney.roundUsd === 'function') {
      n = IZCMoney.roundUsd(n);
    }
    return '$ ' + n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' USD';
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
  // UVT 2026: SAT POS AIO y SAT Verificador de precios ≤ umbral → sin IVA;
  // si unitario o total de línea > $2.618.700 → con IVA.
  // Otros productos → siempre con IVA.
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

  /** Precio unitario COP sin IVA (misma base que PDF / panel asesor). */
  function lineUnitCop(line, trm) {
    if (!line) return 0;
    var qty = Math.max(1, Number(line.qty) || 1);
    var rawUsd = (line.usdList != null && Number(line.usdList) > 0)
      ? Number(line.usdList)
      : (line.unitarioUsd != null ? Number(line.unitarioUsd) : Number(line.usd));
    var rawCop = (line.unitarioCop != null && Number(line.unitarioCop) > 0)
      ? Number(line.unitarioCop)
      : (line.copSinIva != null && Number(line.copSinIva) > 0
        ? Number(line.copSinIva)
        : Number(line.cop));
    var prefer = (line.priceModified && (String(line.priceEditSource || '').toLowerCase() === 'cop'
      || String(line.priceEditSource || '').toLowerCase() === 'copiva')) ? 'cop' : 'usd';
    if (window.IZCMoney && typeof IZCMoney.alignUsdCop === 'function' && Number(trm) > 0) {
      var pair = IZCMoney.alignUsdCop(rawUsd, rawCop, trm, prefer);
      if (pair.cop > 0) return pair.cop;
    }
    if (isFinite(rawUsd) && rawUsd > 0 && rawUsd < 5000 && Number(trm) > 0) {
      var u = window.IZCMoney ? IZCMoney.roundUsd(rawUsd) : rawUsd;
      return Math.round(u * Number(trm));
    }
    if (line.unitarioCop != null && isFinite(Number(line.unitarioCop)) && Number(line.unitarioCop) > 0) {
      return Number(line.unitarioCop);
    }
    if (line.copSinIva != null && isFinite(Number(line.copSinIva)) && Number(line.copSinIva) > 0) {
      return Number(line.copSinIva);
    }
    if (line.cop != null && isFinite(Number(line.cop)) && Number(line.cop) > 0) {
      return Number(line.cop);
    }
    if (line.totalCop != null && isFinite(Number(line.totalCop)) && Number(line.totalCop) > 0) {
      return Number(line.totalCop) / qty;
    }
    if (trm > 0 && line.usd != null && isFinite(Number(line.usd)) && Number(line.usd) > 0) {
      var usdU = window.IZCMoney ? IZCMoney.roundUsd(Number(line.usd)) : Number(line.usd);
      return Math.round(usdU * trm);
    }
    var withIva = lineUnitCopIva(line, trm);
    return withIva > 0 ? withIva / (1 + IVA) : 0;
  }

  function buildLiquidacionCop(quote) {
    var totals = (quote && quote.totals) || {};
    var trm = Number(quote && quote.trm);
    if (!isFinite(trm) || trm <= 0) trm = 0;
    var items = quoteItemsResolved(quote);

    // Recalcular con UVT 2026 (no usar totalSinFlete guardado con IVA).
    var subtotalSinIva = 0;
    var subtotal = items.reduce(function (sum, line) {
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
      if (!exempt && totalSinIva > 0 && totalConIva <= totalSinIva * 1.05) {
        totalConIva = Math.floor(unitSinIva * (1 + IVA) + 1e-9) * qty;
      }
      subtotalSinIva += totalSinIva;
      return sum + (exempt ? totalSinIva : totalConIva);
    }, 0);

    var hasAsesorTotals =
      (totals.fleteAntesIva != null && isFinite(Number(totals.fleteAntesIva))) ||
      (totals.totalConFlete != null && isFinite(Number(totals.totalConFlete)));

    var fleteRaw = totals.flete || quote.flete || '';
    var fleteAntes = Number(totals.fleteAntesIva);
    if (!isFinite(fleteAntes) || fleteAntes < 0) fleteAntes = 0;

    var fleteIva = Number(totals.fleteIva);
    var isNacional =
      /\bTCC\b/i.test(String(fleteRaw)) ||
      /1\s*[,.]\s*85\s*%/i.test(String(fleteRaw)) ||
      /env[ií]o\s*nacional/i.test(String(fleteRaw)) ||
      Math.abs(Number(totals.flete_rate) - 0.0185) < 1e-9;

    // 1,85 % / umbral TCC sobre mercancía sin IVA (no sobre total con IVA); flete siempre + IVA.
    if (isNacional && subtotalSinIva > 0) {
      if (subtotalSinIva < 1500000) {
        fleteAntes = 23000;
      } else {
        fleteAntes = subtotalSinIva * 0.0185;
      }
      fleteIva = fleteAntes * IVA;
    } else if (!isFinite(fleteIva) || fleteIva < 0 || (fleteAntes > 0 && fleteIva > fleteAntes * 0.45)) {
      fleteIva = fleteAntes * IVA;
    }

    var fleteConIva = fleteAntes + fleteIva;
    var totalPagar = subtotal + fleteConIva;
    var usdEquiv = trm > 0
      ? (window.IZCMoney ? IZCMoney.roundUsd(subtotal / trm) : subtotal / trm)
      : 0;

    return {
      trm: trm,
      empresa: totals.empresa || quote.empresa || '',
      lp: totals.lp || quote.lp || '',
      flete: totals.flete || quote.flete || '',
      subtotal: subtotal,
      fleteAntes: fleteAntes,
      fleteIva: fleteIva,
      totalPagar: totalPagar,
      usdEquiv: usdEquiv,
      estimated: !hasAsesorTotals
    };
  }

  function liquidacionHtml(quote) {
    var liq = buildLiquidacionCop(quote);
    var metaBits = [];
    if (liq.lp) metaBits.push('LP ' + lpLabel(liq.lp));
    if (liq.flete) metaBits.push(liq.flete);
    var metaLine = metaBits.length
      ? '<p class="admin-quote-liquidacion-meta">' + escapeHtml(metaBits.join(' · ')) + '</p>'
      : '';

    return (
      '<div class="admin-quote-liquidacion is-compact">' +
        '<div class="admin-quote-liquidacion-grid">' +
          '<div class="admin-quote-liquidacion-head">' +
            '<h4>Liquidación COP</h4>' +
            '<p class="admin-quote-liquidacion-trm">TRM: ' + escapeHtml(formatTrm(liq.trm)) + '</p>' +
            metaLine +
          '</div>' +
          '<dl class="admin-quote-liquidacion-rows">' +
            '<div><dt>Subtotal (sin flete)</dt><dd>' + escapeHtml(formatCOP(liq.subtotal)) + '</dd></div>' +
            '<div><dt>' + (liq.fleteIva > 0 ? 'Flete antes de IVA' : 'Flete') + '</dt><dd>' + escapeHtml(formatCOPDec(liq.fleteAntes)) + '</dd></div>' +
            (liq.fleteIva > 0
              ? '<div><dt>IVA flete (19 %)</dt><dd>' + escapeHtml(formatCOPDec(liq.fleteIva)) + '</dd></div>'
              : '') +
            '<div class="is-total"><dt>TOTAL A PAGAR</dt><dd>' + escapeHtml(formatCOPDec(liq.totalPagar)) + '</dd></div>' +
            '<div class="is-usd"><dt>Equivalente USD</dt><dd>' + escapeHtml(formatUSD(liq.usdEquiv)) + '</dd></div>' +
          '</dl>' +
        '</div>' +
        (liq.estimated
          ? '<p class="admin-quote-liquidacion-note">Liquidación estimada: esta cotización aún no tiene flete/empresa del cotizador del asesor.</p>'
          : '') +
      '</div>'
    );
  }

  function lineTotal(line) {
    if (!line) return '—';
    var cur = String(line.currency || '').toUpperCase();
    var usd = Number(line.totalUsdIva);
    if (!(isFinite(usd) && usd > 0)) usd = Number(line.usdIva);
    if (!(isFinite(usd) && usd > 0)) usd = Number(line.totalUsd);
    if (!(isFinite(usd) && usd > 0)) usd = Number(line.usd);
    var cop = Number(line.totalCopIva);
    if (!(isFinite(cop) && cop > 0)) cop = Number(line.copIva);
    if (!(isFinite(cop) && cop > 0)) cop = Number(line.totalCop);
    if (!(isFinite(cop) && cop > 0)) cop = Number(line.cop);
    if (cur === 'COP') {
      if (isFinite(cop) && cop > 0) return formatCOPDec(cop);
      if (isFinite(usd) && usd > 0) return formatUSD(usd);
      return '—';
    }
    if (cur === 'USD' || (isFinite(usd) && usd > 0)) {
      if (isFinite(usd) && usd > 0) return formatUSD(usd);
      if (isFinite(cop) && cop > 0) return formatCOPDec(cop);
      return '—';
    }
    if (isFinite(cop) && cop > 0) return formatCOPDec(cop);
    return '—';
  }

  function quoteCurrencyFlags(quote) {
    var totals = (quote && quote.totals) || {};
    var items = quoteItemsResolved(quote);
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

  function numMoney(v) {
    if (v == null || v === '') return NaN;
    var n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : NaN;
  }

  function quoteNativeSums(quote) {
    var totals = (quote && quote.totals) || {};
    var items = quoteItemsResolved(quote);
    var flags = quoteCurrencyFlags(quote);
    var sumUsd = 0;
    var sumCop = 0;
    var fromItems = false;

    items.forEach(function (line) {
      var c = String(line.currency || '').toUpperCase();
      if (c === 'COP') {
        fromItems = true;
        sumCop += numMoney(line.totalCopIva != null ? line.totalCopIva : (line.copIva != null ? line.copIva : (line.totalCop != null ? line.totalCop : line.cop))) || 0;
      } else if (c === 'USD') {
        fromItems = true;
        sumUsd += numMoney(line.totalUsdIva != null ? line.totalUsdIva : (line.usdIva != null ? line.usdIva : (line.totalUsd != null ? line.totalUsd : line.usd))) || 0;
      } else {
        // Sin moneda: sumar lo que haya.
        var copLine = numMoney(line.totalCopIva) || numMoney(line.copIva) || numMoney(line.totalCop) || numMoney(line.cop) || 0;
        var usdLine = numMoney(line.totalUsdIva) || numMoney(line.usdIva) || numMoney(line.totalUsd) || numMoney(line.usd) || 0;
        if (copLine > 0) { fromItems = true; sumCop += copLine; }
        if (usdLine > 0) { fromItems = true; sumUsd += usdLine; }
      }
    });

    if (!fromItems) {
      var copIva = numMoney(totals.copIva) || numMoney(totals.totalConFlete) || 0;
      var usdIva = numMoney(totals.usdIva) || 0;
      var cop = numMoney(totals.cop) || 0;
      var usd = numMoney(totals.usd) || 0;
      if (copIva > 0) sumCop = copIva;
      else if (cop > 0) sumCop = cop;
      if (usdIva > 0) sumUsd = usdIva;
      else if (usd > 0) sumUsd = usd;
      if (sumCop <= 0 && sumUsd <= 0) {
        if (flags.hasUsd && !flags.hasCop) sumUsd = usdIva || usd;
        else if (flags.hasCop && !flags.hasUsd) sumCop = copIva || cop;
      }
    }

    return {
      hasUsd: flags.hasUsd || sumUsd > 0,
      hasCop: flags.hasCop || sumCop > 0,
      usd: sumUsd,
      cop: sumCop
    };
  }

  var HISTORIAL_DESDE = '2026-08-21';

  function historialHastaHoy() {
    try {
      var parts = new Date().toLocaleString('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      var m = String(parts).match(/(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
    } catch (e) { /* ignore */ }
    var d = new Date();
    var mm = String(d.getMonth() + 1);
    var dd = String(d.getDate());
    if (mm.length < 2) mm = '0' + mm;
    if (dd.length < 2) dd = '0' + dd;
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function quoteHasPricedDeal(quote) {
    var sums = quoteNativeSums(quote);
    if (sums.usd > 0 || sums.cop > 0) return true;
    var totals = (quote && quote.totals) || {};
    return numMoney(totals.totalConFlete) > 0
      || numMoney(totals.copIva) > 0
      || numMoney(totals.usdIva) > 0
      || numMoney(totals.cop) > 0
      || numMoney(totals.usd) > 0;
  }

  function isDealNombreQuote(quote) {
    var nombre = String((quote && quote.nombre) || '').trim();
    if (/^Deal\b/i.test(nombre)) return true;
    var nit = String((quote && quote.nit) || '').replace(/\D+/g, '');
    var id = String((quote && quote.id) || '');
    var isBx = /^bx[-_]/i.test(id) || !!(quote && quote.synced_from_bitrix);
    return !!(isBx && (nit === '' || nit === '0'));
  }

  function quoteCreatedDateKey(quote) {
    var raw = String((quote && (quote.created_at || quote.finished_at)) || '').trim();
    var fromCreated = '';
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) fromCreated = raw.slice(0, 10);
    else fromCreated = toDateKey(raw);
    var id = String((quote && quote.id) || '');
    var m = id.match(/^(20\d{2})(\d{2})(\d{2})/);
    var fromId = m ? (m[1] + '-' + m[2] + '-' + m[3]) : '';
    if (fromCreated) return fromCreated;
    return fromId;
  }

  function quoteInAdminHistorial(quote) {
    if (!quoteHasPricedDeal(quote)) return false;
    if (isDealNombreQuote(quote)) return false;
    var key = quoteCreatedDateKey(quote);
    if (!key) return false;
    return key >= HISTORIAL_DESDE && key <= historialHastaHoy();
  }

  function quoteTotalLabel(quote) {
    // Preferir totales guardados / ítems con precio; liquidación solo si da > 0.
    // Cotizaciones Bitrix en USD no tienen COP: hay que mostrar USD (no $ 0,00 COP).
    var totals = (quote && quote.totals) || {};
    var totalConFlete = numMoney(totals.totalConFlete);
    var copIva = numMoney(totals.copIva);
    var usdIva = numMoney(totals.usdIva);
    var cop = numMoney(totals.cop);
    var usd = numMoney(totals.usd);
    if (totalConFlete > 0) return formatCOPDec(totalConFlete);
    if (copIva > 0) return formatCOPDec(copIva);
    if (usdIva > 0) return formatUSD(usdIva);
    if (cop > 0) return formatCOP(cop);
    if (usd > 0) return formatUSD(usd);

    var sums = quoteNativeSums(quote);
    var parts = [];
    if (sums.usd > 0) parts.push(formatUSD(sums.usd));
    if (sums.cop > 0) parts.push(formatCOPDec(sums.cop));
    if (parts.length) return parts.join(' · ');

    var liq = buildLiquidacionCop(quote);
    if (liq && isFinite(liq.totalPagar) && liq.totalPagar > 0) {
      return formatCOPDec(liq.totalPagar);
    }
    return '—';
  }

  function quoteTotalTitle(quote) {
    var totals = (quote && quote.totals) || {};
    if (Number(totals.totalConFlete) > 0 || Number(totals.copIva) > 0) return 'Total a pagar';
    if (Number(totals.usdIva) > 0 || Number(totals.usd) > 0) return 'Total USD';
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

  function postAdminApi(payload) {
    payload = payload || {};
    if (sessionIsAdmin()) {
      payload.admin_nit = 'Admin IZC';
    }
    var body = JSON.stringify(payload);
    var endpoints;
    if (window.IZCAuth && typeof IZCAuth.apiEndpoints === 'function') {
      endpoints = IZCAuth.apiEndpoints();
    } else {
      var path = String(location.pathname || '/');
      var slash = path.lastIndexOf('/');
      var base = slash < 0 ? '/' : path.slice(0, slash + 1);
      var host = location.hostname;
      if (host === '127.0.0.1' || host === 'localhost') {
        endpoints = [API_ORIGIN + '/api/auth', base + 'api/auth.php', base + 'api/auth'];
      } else {
        endpoints = [base + 'api/auth.php', base + 'api/auth'];
      }
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
          var trimmed = String(text || '').replace(/^\uFEFF/, '').trim();
          var data = null;
          try {
            data = JSON.parse(trimmed);
          } catch (e) {
            var start = trimmed.indexOf('{');
            if (start >= 0) {
              try { data = JSON.parse(trimmed.slice(start)); } catch (e2) { data = null; }
            }
          }
          if (!data || typeof data !== 'object') {
            var snippet = trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
            if (i + 1 < endpoints.length) return tryOne(i + 1);
            return {
              ok: false,
              error: 'El servidor no respondió JSON (HTTP ' + res.status + '). ' + (snippet || 'Revisa php_curl en WAMP.')
            };
          }
          var err = String((data && data.error) || '').toLowerCase();
          var invalidAction = !data.ok && (
            err.indexOf('accion no valida') >= 0
            || err.indexOf('acción no válida') >= 0
            || err.indexOf('invalid action') >= 0
          );
          if (invalidAction && i + 1 < endpoints.length) {
            return tryOne(i + 1);
          }
          return data;
        });
      }).catch(function () {
        return tryOne(i + 1);
      });
    }

    function run() {
      return tryOne(0);
    }

    if (window.IZCAuth && typeof window.IZCAuth.ensureLocalApi === 'function') {
      return window.IZCAuth.ensureLocalApi().then(run, run);
    }
    return run();
  }

  function clearAsesorForm() {
    var codigoEl = document.getElementById('adminAsesorCodigo');
    var passEl = document.getElementById('adminAsesorPassword');
    var nombreEl = document.getElementById('adminAsesorNombre');
    if (codigoEl) codigoEl.value = '';
    if (passEl) passEl.value = '';
    if (nombreEl) nombreEl.value = '';
  }

  function setActiveTab(tab) {
    activeTab = tab;
    var usersPanel = document.getElementById('adminPanelUsers');
    var asesoresPanel = document.getElementById('adminPanelAsesores');
    var quotesPanel = document.getElementById('adminPanelQuotes');
    var trmPanel = document.getElementById('adminPanelTrm');
    var preciosPanel = document.getElementById('adminPanelPrecios');
    var bitrixPanel = document.getElementById('adminPanelBitrix');
    var productosPanel = document.getElementById('adminPanelProductos');
    var asignarPanel = document.getElementById('adminPanelAsignar');
    var usersHint = document.getElementById('adminUsersHint');
    var quotesHint = document.getElementById('adminQuotesHint');
    var tabs = document.querySelectorAll('.admin-stat.is-tab');
    var isUsersTab = tab === 'users' || tab === 'users-all';
    var isQuotesTab = tab === 'quotes' || tab === 'quotes-client';

    tabs.forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-tab') === tab);
    });
    if (usersPanel) usersPanel.hidden = !isUsersTab;
    if (asesoresPanel) asesoresPanel.hidden = tab !== 'asesores';
    if (quotesPanel) quotesPanel.hidden = !isQuotesTab;
    if (trmPanel) trmPanel.hidden = tab !== 'trm';
    if (preciosPanel) preciosPanel.hidden = tab !== 'precios';
    if (bitrixPanel) bitrixPanel.hidden = tab !== 'bitrix';
    if (productosPanel) productosPanel.hidden = tab !== 'productos';
    if (asignarPanel) asignarPanel.hidden = tab !== 'asignar';

    if (usersHint) {
      usersHint.textContent = tab === 'users-all'
        ? 'Clientes que se registraron ellos mismos en el portal (registro.html).'
        : 'Clientes que los asesores han registrado en el panel del asesor.';
    }
    if (quotesHint) {
      quotesHint.textContent = tab === 'quotes-client'
        ? 'Cotizaciones del portal de clientes registrados de asesores/vendedores. Las de clientes GP van al Admin SAT.'
        : 'Historial completo de cotizaciones.';
    }
    var reportBtn = document.getElementById('adminQuotesReportBtn');
    if (reportBtn) {
      reportBtn.hidden = tab === 'quotes-client';
    }
    var estadoFilterWrap = document.getElementById('adminQuoteFilterEstado');
    if (estadoFilterWrap) {
      var hideEstado = tab === 'quotes-client';
      // Mantener la celda para no desalinear filtros; solo ocultar el control.
      estadoFilterWrap.hidden = false;
      estadoFilterWrap.style.visibility = hideEstado ? 'hidden' : '';
      estadoFilterWrap.style.pointerEvents = hideEstado ? 'none' : '';
      if (hideEstado) estadoFilterWrap.value = '';
      var estadoTh = estadoFilterWrap.closest('th');
      if (estadoTh) estadoTh.hidden = false;
    }
    var quotesTable = document.getElementById('adminQuotesTable');
    if (quotesTable) {
      quotesTable.classList.toggle('is-client-quotes', tab === 'quotes-client');
    }

    if (isUsersTab) loadUsers();
    else if (tab === 'asesores') {
      clearAsesorForm();
      window.setTimeout(clearAsesorForm, 50);
      window.setTimeout(clearAsesorForm, 400);
      loadAsesores();
    }
    else if (isQuotesTab) {
      // Asegurar asesores + cola "sin vendedor" (fallback de detección de cotizaciones cliente).
      Promise.all([
        loadAsesores({ silent: true }),
        loadQuotes({ syncBitrix: true }),
        loadClientesSinVendedor({ silent: true })
      ]).then(function () {
        fillVendedorFilterOptions(quotesForActiveTab());
        if (activeTab === 'quotes-client') {
          updateClientQuoteCount();
          applyQuotesFilter();
        }
      });
    }
    else if (tab === 'trm') loadTrmPanel();
    else if (tab === 'precios') loadPreciosPanel();
    else if (tab === 'bitrix') loadBitrixPanel();
    else if (tab === 'productos') loadProductosCreados();
    else if (tab === 'asignar') {
      loadAsesores({ silent: true }).then(function () {
        return loadClientesSinVendedor();
      });
    }
  }

  function quoteItems(q) {
    var items = q && q.items;
    if (!items) return [];
    // PowerShell ConvertTo-Json a veces manda 1 ítem como objeto, no como array
    return Array.isArray(items) ? items : [items];
  }

  function quoteItemsResolved(q) {
    var items = quoteItems(q);
    if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.enrichQuote === 'function') {
      return IZCCotizacionPdf.enrichQuote({ items: items }).items;
    }
    return items;
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
    if (e === 'cotizado' || e === 'cotizada') return 'cotizado';
    return 'cotizado';
  }

  function isDuplicatedQuote(q) {
    if (!q || typeof q !== 'object') return false;
    if (q.is_duplicated === true || q.duplicated === true) return true;
    return String(q.duplicated_from || q.recotizado_desde || '').trim() !== '';
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

  function estadoBadgeHtml(estado) {
    return (
      '<span class="quote-estado-badge is-' + estado + '">' +
        escapeHtml(quoteEstadoLabel(estado)) +
      '</span>'
    );
  }

  function toDateKey(value) {
    var d = toBogotaDate(value);
    if (d) {
      var parts = d.toLocaleString('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      var m = String(parts).match(/(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
    }
    var raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    return '';
  }

  function getQuoteFilters() {
    var estadoEl = document.getElementById('adminQuoteFilterEstado');
    var fechaEl = document.getElementById('adminQuoteFilterFecha');
    var nitEl = document.getElementById('adminQuoteFilterNit');
    var vendEl = document.getElementById('adminQuoteFilterVendedor');
    return {
      estado: estadoEl ? String(estadoEl.value || '').trim().toLowerCase() : '',
      fecha: fechaEl ? String(fechaEl.value || '').trim() : '',
      nit: nitEl ? normalizeNit(nitEl.value) : '',
      vendedor: vendEl ? String(vendEl.value || '').trim().toUpperCase() : ''
    };
  }

  function updateQuotesFilterMeta(total, shown) {
    var meta = document.getElementById('adminQuotesFilterMeta');
    if (!meta) return;
    var f = getQuoteFilters();
    var active = !!(f.estado || f.fecha || f.nit || f.vendedor);
    if (!active) {
      meta.hidden = true;
      meta.textContent = '';
      return;
    }
    meta.hidden = false;
    meta.textContent = 'Mostrando ' + shown + ' de ' + total + ' cotizaciones.';
  }

  function quoteSellerCodigo(q) {
    var code = String((q && (q.seller_codigo || q.asesor_codigo)) || '').trim().toUpperCase();
    if (!code) return '';
    // Códigos tipo V1, V2, V31… o alfabéticos tipo ADV
    if (!/^(V\d+|[A-Z]{2,6}\d{0,4})$/i.test(code)) return '';
    return code;
  }

  function isClientMadeQuote(q) {
    if (!q) return false;
    var src = String(q.quote_source || '').trim().toLowerCase();
    // Interno / sync / GP: nunca en pestaña Cotizaciones clientes del admin.
    if (src === 'asesor' || src === 'zkteco' || src === 'zebra' || src === 'sat' || src === 'gp' || src === 'bitrix' || src === 'izc') {
      return false;
    }
    var nit = String((q && q.nit) || '').replace(/[\s.]/g, '').toUpperCase();
    var seller = String((q && (q.seller_codigo_raw || q.seller_codigo || q.asesor_codigo || q.asesor_cotizado_by || q.finished_by)) || '')
      .replace(/[\s.]/g, '').toUpperCase();
    if (nit === 'SAT' || seller === 'SAT' || nit === 'ADMINSAT' || seller === 'ADMINSAT') return false;
    if (nit === 'ZKTECO' || seller === 'ZKTECO') return false;
    if (/^GP\d{1,4}$/.test(nit) || /^GP\d{1,4}$/.test(seller)) return false;

    // El API ya filtra: solo clientes de asesores/vendedores (no de GP).
    if (typeof q.is_client_quote === 'boolean') return q.is_client_quote;
    if (q.is_client_quote === 1 || q.is_client_quote === '1' || q.is_client_quote === 'true') return true;
    if (q.is_client_quote === 0 || q.is_client_quote === '0' || q.is_client_quote === 'false') return false;

    // Fallback local (sin mapa NIT): portal + vendedor V#/ADV.
    var isPortal = (src === 'cliente' || src === 'portal' || String(q.fecha_cierre_cliente || '').trim() !== '');
    if (!isPortal) return false;
    if (/^V\d+$/i.test(seller) || seller === 'ADV') return true;
    // Sin vendedor asesor claro: no contar (evita el "1" fantasma de clientes GP).
    return false;
  }

  function quoteHasAdminAssignedSeller(q) {
    if (!q) return false;
    if (q.assigned_by_admin === true || q.assigned_by_admin === 1 || q.assigned_by_admin === '1') return true;
    if (String(q.vendedor_asignado_at || '').trim()) return true;
    if (String(q.vendedor_asignado_by || '').trim()) return true;
    return false;
  }

  /** En Cotizaciones clientes: vendedor solo si el admin lo asignó. */
  function quoteVendedorForDisplay(q) {
    if (activeTab === 'quotes-client') {
      if (!quoteHasAdminAssignedSeller(q)) return '';
      var assigned = String(q.seller_codigo_raw || q.seller_codigo || '').trim().toUpperCase();
      if (assigned && /^(V\d+|[A-Z]{2,6}\d{0,4})$/i.test(assigned)) return assigned;
      return quoteSellerCodigo(q);
    }
    return quoteSellerCodigo(q);
  }

  function quotesForActiveTab() {
    if (activeTab === 'quotes-client') {
      return (quotesCache || []).filter(isClientMadeQuote);
    }
    return quotesCache || [];
  }

  function updateClientQuoteCount(apiCount) {
    var el = document.getElementById('adminQuoteClientCount');
    if (!el) return;
    // Contar en cliente con la misma regla del tab (ignora SAT/GP mal marcados por el API).
    var local = (quotesCache || []).filter(isClientMadeQuote).length;
    if ((quotesCache || []).length) {
      el.textContent = String(local);
      return;
    }
    if (typeof apiCount === 'number' && !isNaN(apiCount)) {
      el.textContent = String(apiCount);
      return;
    }
    el.textContent = String(local);
  }

  function quoteEmpresaLabel(q) {
    var raw = String(
      (q && q.empresa) ||
      (q && q.totals && q.totals.empresa) ||
      ''
    ).trim();
    if (!raw) return '—';
    if (/valtech/i.test(raw)) return 'VALTECH';
    if (/izc/i.test(raw)) return 'IZC';
    return raw;
  }

  function paintQuotesRows(quotes) {
    var body = document.getElementById('adminQuotesBody');
    if (!body) return;

    if (!quotes.length) {
      var f = getQuoteFilters();
      var emptyMsg;
      if (f.estado || f.fecha || f.nit || f.vendedor) {
        emptyMsg = 'No hay cotizaciones con esos filtros.';
      } else if (activeTab === 'quotes-client') {
        emptyMsg = 'Aún no hay cotizaciones hechas por clientes.';
      } else {
        emptyMsg = 'Aún no hay cotizaciones terminadas.';
      }
      body.innerHTML = '<tr><td colspan="10" class="admin-empty">' + emptyMsg + '</td></tr>';
      return;
    }

    body.innerHTML = quotes.map(function (q, displayIdx) {
      var idx = q.__idx != null ? q.__idx : displayIdx;
      var items = quoteItems(q);
      var itemCount = items.length;
      if (!itemCount && q.totals && Number(q.totals.qty) > 0) itemCount = Number(q.totals.qty);
      if (!itemCount && (Number((q.totals || {}).copIva) > 0 || Number((q.totals || {}).usdIva) > 0)) itemCount = 1;
      var totalLabel = quoteTotalLabel(q);
      var estado = quoteEstado(q);
      var vendedor = quoteVendedorForDisplay(q);
      var empresa = quoteEmpresaLabel(q);
      var numCell = activeTab === 'quotes-client'
        ? ('<td class="admin-row-num"><span class="admin-row-num-value">' + (displayIdx + 1) + '</span></td>')
        : (
          '<td class="admin-row-num has-estado">' +
            estadoBadgeHtml(estado) +
            '<span class="admin-row-num-value">' + (displayIdx + 1) + '</span>' +
          '</td>'
        );
      var cierreFecha = activeTab === 'quotes-client'
        ? (q.fecha_cierre_cliente || '')
        : (q.fecha_cierre || '');
      return (
        '<tr>' +
          numCell +
          '<td class="admin-date-cell">' + escapeHtml(formatDateOnly(q.created_at)) + '</td>' +
          '<td class="admin-date-cell admin-col-center">' + escapeHtml(formatDateOnly(cierreFecha)) + '</td>' +
          '<td>' + escapeHtml(q.nombre || '—') + '</td>' +
          '<td class="admin-col-center">' + escapeHtml(normalizeNit(q.nit) || '') + '</td>' +
          '<td class="admin-col-center">' + escapeHtml(empresa) + '</td>' +
          '<td class="admin-vendedor-cell admin-col-center">' + escapeHtml(vendedor) + '</td>' +
          '<td class="admin-col-center">' + itemCount + '</td>' +
          '<td class="admin-quote-total-cell">' + escapeHtml(totalLabel) + '</td>' +
          '<td class="admin-actions">' +
            (isDuplicatedQuote(q)
              ? '<span class="admin-quote-dup-tag">Cotización duplicada</span>'
              : '') +
            '<button type="button" class="admin-view-quote" data-idx="' + idx + '">Ver</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function applyQuotesFilter() {
    var f = getQuoteFilters();
    var base = quotesForActiveTab();
    var filtered = [];
    base.forEach(function (q) {
      var idx = (quotesCache || []).indexOf(q);
      if (idx < 0) {
        // Si se filtró a una copia, buscar por id.
        var qid = String((q && q.id) || '');
        for (var i = 0; i < (quotesCache || []).length; i++) {
          if (String((quotesCache[i] && quotesCache[i].id) || '') === qid) {
            idx = i;
            break;
          }
        }
      }
      if (f.estado && quoteEstado(q) !== f.estado) return;
      if (f.fecha && toDateKey(q.created_at) !== f.fecha) return;
      if (f.nit) {
        var nit = normalizeNit(q.nit);
        if (nit.indexOf(f.nit) === -1) return;
      }
      if (f.vendedor && quoteSellerCodigo(q) !== f.vendedor) return;
      filtered.push(Object.assign({}, q, { __idx: idx >= 0 ? idx : 0 }));
    });
    updateQuotesFilterMeta(base.length, filtered.length);
    paintQuotesRows(filtered);
  }

  function fillVendedorFilterOptions(quotes) {
    var sel = document.getElementById('adminQuoteFilterVendedor');
    if (!sel) return;
    var current = String(sel.value || '').trim().toUpperCase();
    var seen = {};
    var list = [];

    function addSeller(code, name) {
      var key = String(code || '').trim().toUpperCase();
      if (!key || seen[key]) {
        if (key && seen[key] && name && !seen[key].hasName) {
          seen[key].label = key + ' · ' + name;
          seen[key].hasName = true;
        }
        return;
      }
      var cleanName = String(name || '').trim();
      var hasName = !!(cleanName && cleanName.toUpperCase() !== key);
      var item = {
        code: key,
        label: hasName ? (key + ' · ' + cleanName) : key,
        hasName: hasName
      };
      seen[key] = item;
      list.push(item);
    }

    // Primero todos los asesores registrados (aunque no tengan cotizaciones).
    (asesoresCache || []).forEach(function (a) {
      addSeller(a && a.codigo, a && a.nombre);
    });

    // Completar / enriquecer con vendedores que aparezcan en cotizaciones.
    (quotes || quotesCache || []).forEach(function (q) {
      var code = quoteSellerCodigo(q);
      if (!code) return;
      addSeller(code, q && (q.seller_name || q.asesor_nombre));
    });

    list.sort(function (a, b) {
      return a.code.localeCompare(b.code, 'es', { numeric: true });
    });
    sel.innerHTML = '<option value="">Todos</option>' + list.map(function (item) {
      return '<option value="' + escapeHtml(item.code) + '">' + escapeHtml(item.label) + '</option>';
    }).join('');
    if (current && seen[current]) sel.value = current;
  }

  function renderQuotes(quotes, meta) {
    var count = document.getElementById('adminQuoteCount');
    quotesCache = sortByNewestCreated((quotes || []).filter(quoteInAdminHistorial));
    if (count) count.textContent = String(quotesCache.length);
    updateClientQuoteCount(meta && meta.client_count);
    fillVendedorFilterOptions(quotesForActiveTab());
    applyQuotesFilter();
  }

  function clearQuotesFilters() {
    var estadoEl = document.getElementById('adminQuoteFilterEstado');
    var fechaEl = document.getElementById('adminQuoteFilterFecha');
    var nitEl = document.getElementById('adminQuoteFilterNit');
    var vendEl = document.getElementById('adminQuoteFilterVendedor');
    if (estadoEl) estadoEl.value = '';
    if (fechaEl) fechaEl.value = '';
    if (nitEl) nitEl.value = '';
    if (vendEl) vendEl.value = '';
    applyQuotesFilter();
  }

  function getFilteredQuotes() {
    var f = getQuoteFilters();
    var filtered = [];
    quotesCache.forEach(function (q) {
      if (f.estado && quoteEstado(q) !== f.estado) return;
      if (f.fecha && toDateKey(q.created_at) !== f.fecha) return;
      if (f.nit) {
        var nit = normalizeNit(q.nit);
        if (nit.indexOf(f.nit) === -1) return;
      }
      if (f.vendedor && quoteSellerCodigo(q) !== f.vendedor) return;
      filtered.push(q);
    });
    return filtered;
  }

  function quoteSellerNombre(q) {
    var name = String((q && (q.seller_name || q.asesor_nombre || q.seller_label)) || '').trim();
    if (!name) return '';
    var code = quoteSellerCodigo(q);
    if (code && name.toUpperCase() === code) return '';
    return name.replace(/^IZC\s+/i, '').replace(/^VALTECH\s+/i, '').trim() || name;
  }

  function asesorNombreByCodigo(code) {
    var key = String(code || '').trim().toUpperCase();
    if (!key) return '';
    for (var i = 0; i < asesoresCache.length; i++) {
      var a = asesoresCache[i];
      if (String((a && a.codigo) || '').trim().toUpperCase() === key) {
        return String((a && a.nombre) || '').trim();
      }
    }
    return '';
  }

  function buildAsesorReportRows(filteredQuotes, filters) {
    var byCode = {};
    var order = [];

    function ensureSeller(code, name) {
      var key = String(code || '').trim().toUpperCase();
      if (!key) key = 'SIN CODIGO';
      if (!byCode[key]) {
        byCode[key] = {
          codigo: key === 'SIN CODIGO' ? '—' : key,
          nombre: name || '',
          quotes: []
        };
        order.push(key);
      } else if (name && !byCode[key].nombre) {
        byCode[key].nombre = name;
      }
      return byCode[key];
    }

    // Incluir todos los asesores registrados (como en el ejemplo con ceros),
    // salvo si el admin filtró un vendedor concreto.
    if (!filters.vendedor) {
      asesoresCache.forEach(function (a) {
        var code = String((a && a.codigo) || '').trim().toUpperCase();
        if (!code) return;
        ensureSeller(code, String((a && a.nombre) || '').trim());
      });
    } else {
      ensureSeller(filters.vendedor, asesorNombreByCodigo(filters.vendedor));
    }

    (filteredQuotes || []).forEach(function (q) {
      var code = quoteSellerCodigo(q) || 'SIN CODIGO';
      var name = quoteSellerNombre(q) || asesorNombreByCodigo(code);
      var row = ensureSeller(code, name);
      row.quotes.push(q);
    });

    order.sort(function (a, b) {
      if (a === 'SIN CODIGO') return 1;
      if (b === 'SIN CODIGO') return -1;
      return a.localeCompare(b, 'es', { numeric: true });
    });

    return order.map(function (key) {
      return byCode[key];
    });
  }

  function excelEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function downloadAsesorQuotesReport() {
    var filters = getQuoteFilters();
    var filtered = getFilteredQuotes();
    var sellers = buildAsesorReportRows(filtered, filters);
    var fechaFiltroKey = filters.fecha || '';
    var fechaFiltroLabel = fechaFiltroKey ? formatDateDMY(fechaFiltroKey) : 'Todas';
    var fechaDescargaLabel = formatDateDescargaES(new Date());
    var totalCotizaciones = filtered.length;
    var title = 'REPORTE DE COTIZACIONES ASESORES';

    var detailRows = sellers.map(function (s) {
      var counts = {
        cotizado: 0,
        vendido: 0,
        seguimiento: 0,
        perdida: 0,
        pendiente: 0,
        cerrado_modificado: 0,
        nueva: 0
      };
      var comments = [];
      var cierres = [];
      (s.quotes || []).forEach(function (q) {
        var est = quoteEstado(q);
        if (counts[est] != null) counts[est] += 1;
        else counts.cotizado += 1;
        var cmt = String((q && q.asesor_comentario) || '').trim();
        if (cmt) comments.push(cmt);
        if (q && q.fecha_cierre) {
          var ck = formatDateDMY(q.fecha_cierre);
          if (ck && ck !== '—' && cierres.indexOf(ck) === -1) cierres.push(ck);
        }
      });
      var nombre = cleanSellerDisplayName(s.nombre, s.codigo) || s.nombre || '—';
      var comentario = comments.length ? comments.join(' | ') : '';
      var cierreLabel = cierres.length === 1 ? cierres[0] : (cierres.length > 1 ? cierres.join(', ') : '—');
      var blankZero = function (n) { return n > 0 ? String(n) : ''; };

      return (
        '<tr class="data">' +
          '<td class="col-code">' + excelEscape(s.codigo) + '</td>' +
          '<td class="col-name">' + excelEscape(nombre) + '</td>' +
          '<td class="num col-qty">' + s.quotes.length + '</td>' +
          '<td class="num">' + excelEscape(blankZero(counts.cotizado + counts.nueva)) + '</td>' +
          '<td class="num">' + excelEscape(blankZero(counts.vendido)) + '</td>' +
          '<td class="num">' + excelEscape(blankZero(counts.seguimiento)) + '</td>' +
          '<td class="num">' + excelEscape(blankZero(counts.perdida)) + '</td>' +
          '<td class="num">' + excelEscape(blankZero(counts.pendiente)) + '</td>' +
          '<td class="num">' + excelEscape(blankZero(counts.cerrado_modificado)) + '</td>' +
          '<td class="col-comment">' + excelEscape(comentario) + '</td>' +
          '<td class="num">' + excelEscape(cierreLabel) + '</td>' +
        '</tr>'
      );
    }).join('');

    var html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8">' +
      '<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>' +
      '<x:ExcelWorksheet><x:Name>Reporte asesores</x:Name>' +
      '<x:WorksheetOptions><x:DoNotDisplayGridlines/></x:WorksheetOptions>' +
      '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->' +
      '<style>' +
      'html,body{margin:0;padding:0;background:#fff}' +
      'body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000}' +
      'table{border-collapse:collapse;table-layout:fixed}' +
      'col.c1{width:90px}' +
      'col.c2{width:160px}' +
      'col.c3{width:95px}' +
      'col.c4{width:70px}' +
      'col.c5{width:70px}' +
      'col.c6{width:85px}' +
      'col.c7{width:70px}' +
      'col.c8{width:85px}' +
      'col.c9{width:110px}' +
      'col.c10{width:220px}' +
      'col.c11{width:100px}' +
      'td,th{border:none;padding:6px 8px;vertical-align:middle;background:#fff}' +
      '.title{font-size:14pt;font-weight:700;text-align:center;border:1.5pt solid #000}' +
      '.meta-label{font-weight:700;text-align:center;border:1.5pt solid #000}' +
      '.meta-value{text-align:center;font-style:italic;border:1.5pt solid #000}' +
      '.meta-filter{font-weight:700;text-align:center;border:1.5pt solid #000}' +
      '.meta-total-val{font-weight:700;text-align:center;border:1.5pt solid #000;font-style:normal}' +
      '.section{font-weight:700;text-align:center;border-top:1pt solid #000;border-left:1pt solid #000;border-right:1pt solid #000;border-bottom:0.5pt solid #000;background:#fff}' +
      '.head th{font-weight:700;text-align:center;border:1pt solid #000;background:#fff}' +
      '.head th.col-qty{background:#f2f2f2;border-bottom:0.5pt solid #000}' +
      'tr.data td{border:1pt solid #000}' +
      'tr.data td.col-qty{background:#f2f2f2;border-bottom:0.5pt solid #000}' +
      '.num{text-align:center}' +
      '.col-code{text-align:center}' +
      '.col-name{text-align:left}' +
      '.col-comment{text-align:left}' +
      '.col-qty{text-align:center}' +
      '</style></head><body>' +
      '<table>' +
        '<colgroup>' +
          '<col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5">' +
          '<col class="c6"><col class="c7"><col class="c8"><col class="c9"><col class="c10"><col class="c11">' +
        '</colgroup>' +
        '<tr>' +
          '<td class="title" colspan="3" rowspan="2">' + excelEscape(title) + '</td>' +
          '<td class="meta-label" colspan="2">Fecha de descarga:</td>' +
          '<td class="meta-filter" colspan="3" rowspan="2">Fecha filtrada: ' + excelEscape(fechaFiltroLabel) + '</td>' +
          '<td class="meta-label" colspan="3">Total de cotizaciones</td>' +
        '</tr>' +
        '<tr>' +
          '<td class="meta-value" colspan="2">' + excelEscape(fechaDescargaLabel) + '</td>' +
          '<td class="meta-total-val" colspan="3">' + totalCotizaciones + '</td>' +
        '</tr>' +
        '<tr><td class="section" colspan="11">Detalle de cotizaciones</td></tr>' +
        '<tr class="head">' +
          '<th>Código vendedor</th>' +
          '<th>Nombre vendedor</th>' +
          '<th class="col-qty"># Cotizaciones</th>' +
          '<th>Cotizado</th>' +
          '<th>Vendido</th>' +
          '<th>Seguimiento</th>' +
          '<th>Perdida</th>' +
          '<th>Pendiente</th>' +
          '<th>Cerrado Modificado</th>' +
          '<th>Comentario Asesor</th>' +
          '<th>Fecha de cierre</th>' +
        '</tr>' +
        (detailRows || '<tr class="data"><td colspan="11" class="num">Sin datos</td></tr>') +
      '</table></body></html>';

    var stamp = fileStampDMY(fechaFiltroKey || new Date());
    var blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'Reporte-Cotizaciones-Asesores-' + stamp + '.xls';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    setMessage(
      'adminMessage',
      'Reporte descargado (' + totalCotizaciones + ' cotización(es)).',
      'ok'
    );
  }

  function fetchQuotes(options) {
    options = options || {};
    if (!window.IZCAuth || !IZCAuth.getSessionNit) {
      return Promise.resolve({ ok: false, quotes: [] });
    }
    return postAdminApi({
      action: 'list_quotes',
      admin_nit: IZCAuth.getSessionNit(),
      sync_bitrix: options.syncBitrix ? 1 : 0
    });
  }

  function loadQuotes(options) {
    var silent = !!(options && options.silent);
    if (!silent) setMessage('adminMessage', 'Cargando cotizaciones…', '');

    return fetchQuotes(options).then(function (data) {
        if (!data.ok) {
        if (!silent) {
          setMessage('adminMessage', data.error || 'No se pudo cargar el historial.', 'error');
        }
        if (!quotesCache.length) renderQuotes([], { client_count: 0 });
        return;
      }
      if ((data.quotes || []).length === 0 && quotesCache.length) {
        if (!silent) setMessage('adminMessage', 'El servidor no devolvió cotizaciones; se mantiene el historial en pantalla.', 'error');
        return;
      }
      renderQuotes(data.quotes || [], {
        client_count: typeof data.client_count === 'number' ? data.client_count : undefined
      });
      var countEl = document.getElementById('adminQuoteCount');
      if (countEl && typeof data.count === 'number') {
        countEl.textContent = String(data.count);
      }
      if (typeof data.client_count === 'number') {
        updateClientQuoteCount(data.client_count);
      }
      persistAdminSnapshot();
      if (!silent) setMessage('adminMessage', '', '');
    }).catch(function () {
      if (!silent) {
        setMessage('adminMessage', 'No se pudo cargar. Ejecuta tools\\ABRIR.bat.', 'error');
      }
      if (!quotesCache.length) renderQuotes([], { client_count: 0 });
    });
  }

  function renderProductosCreados(products) {
    productosCache = sortByNewestCreated(Array.isArray(products) ? products : [], 'created_at');
    var body = document.getElementById('adminProductosBody');
    var countEl = document.getElementById('adminProductosCount');
    if (countEl) countEl.textContent = String(productosCache.length);
    if (!body) return;
    if (!productosCache.length) {
      body.innerHTML = '<tr><td colspan="6">Aún no hay productos creados por asesores.</td></tr>';
      return;
    }
    body.innerHTML = productosCache.map(function (p, idx) {
      var sellerCode = String(p.seller_codigo || '').trim();
      var sellerName = String(p.seller_name || '').trim();
      var seller = sellerCode
        ? (sellerName ? (sellerCode + ' — ' + sellerName) : sellerCode)
        : (sellerName || '—');
      var usd = Number(p.unitario_usd || p.unitarioUsd || p.usd || 0);
      var cop = Number(p.unitario_cop || p.unitarioCop || p.cop || 0);
      var price = usd > 0
        ? formatUSD(usd)
        : (cop > 0 ? ('$ ' + Math.round(cop).toLocaleString('es-CO') + ' COP') : '—');
      return (
        '<tr>' +
          '<td>' + (idx + 1) + '</td>' +
          '<td>' +
            '<div><strong>' + escapeHtml(p.name || '—') + '</strong></div>' +
            '<div class="admin-muted">SKU ' + escapeHtml(p.sku || '—') + '</div>' +
          '</td>' +
          '<td>' + escapeHtml(p.referencia || '—') + '</td>' +
          '<td>' + escapeHtml(price) + '</td>' +
          '<td>' + escapeHtml(seller) + '</td>' +
          '<td>' + escapeHtml(formatDate(bogotaFromQuoteId(p.quote_id) || p.created_at || '')) + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function loadProductosCreados(options) {
    var silent = !!(options && options.silent);
    if (!window.IZCAuth || !IZCAuth.getSessionNit) {
      renderProductosCreados([]);
      return Promise.resolve();
    }
    if (!silent) setMessage('adminMessage', 'Cargando productos creados…', '');
    return postAdminApi({
      action: 'list_productos_creados',
      admin_nit: IZCAuth.getSessionNit()
    }).then(function (data) {
      if (!data || !data.ok) {
        // Fallback silencioso: servidor viejo sin la acción → derivar de cotizaciones.
        return fetchQuotes({ syncBitrix: false, silent: true }).then(function (qData) {
          var derived = deriveProductosFromQuotes((qData && qData.quotes) || quotesCache || []);
          renderProductosCreados(derived);
          if (!silent) setMessage('adminMessage', '', '');
        });
      }
      renderProductosCreados(data.products || []);
      if (!silent) setMessage('adminMessage', '', '');
    }).catch(function () {
      var derived = deriveProductosFromQuotes(quotesCache || []);
      renderProductosCreados(derived);
      if (!silent) setMessage('adminMessage', '', '');
    });
  }

  function deriveProductosFromQuotes(quotes) {
    var out = [];
    var seen = {};
    (Array.isArray(quotes) ? quotes : []).forEach(function (q) {
      if (!q) return;
      var items = quoteItems(q);
      var sellerCodigo = String(q.seller_codigo || '').trim();
      var sellerName = String(q.seller_name || '').trim();
      var created = bogotaFromQuoteId(q.id) || q.finished_at || q.created_at || '';
      var trm = Number(q.trm || (q.totals && q.totals.trm) || 0);
      items.forEach(function (it) {
        if (!it) return;
        var name = String(it.name || '');
        var blob = (String(it.sku || '') + ' ' + name + ' ' + String(it.referencia || '')).toUpperCase();
        if (/\bFLETE\b/.test(blob)) return;
        var manual = !!(it.manual || it.is_manual || it.created_by || it.custom);
        if (!manual && !/^producto\s+/i.test(name)) return;
        var usd = Number(it.unitarioUsd != null ? it.unitarioUsd : (it.usd != null ? it.usd : 0));
        if (!(usd > 0) && it.usdIva != null) usd = Number(it.usdIva) / 1.19;
        var cop = Number(it.unitarioCop != null ? it.unitarioCop : (it.copSinIva != null ? it.copSinIva : (it.cop != null ? it.cop : 0)));
        if (!(cop > 0) && it.copIva != null) cop = Number(it.copIva) / 1.19;
        if (!(usd > 0) && cop > 0 && trm > 1000) usd = cop / trm;
        var row = {
          sku: String(it.sku || it.codigo || ''),
          name: name,
          referencia: String(it.referencia || ''),
          unitario_usd: usd,
          unitario_cop: cop,
          seller_codigo: String(it.created_by || sellerCodigo),
          seller_name: sellerName,
          created_at: it.created_at || created,
          quote_id: q.id || ''
        };
        var key = String(row.sku).toUpperCase() + '|' + String(row.seller_codigo).toUpperCase() + '|' + String(row.quote_id);
        if (seen[key]) return;
        seen[key] = true;
        out.push(row);
      });
    });
    return sortByNewestCreated(out, 'created_at');
  }

  function asesorSelectOptionsHtml(selected) {
    var opts = '<option value="">Elegir vendedor…</option>';
    (asesoresCache || []).forEach(function (a) {
      var code = String(a.codigo || '').trim();
      if (!code) return;
      var name = String(a.nombre || '').trim();
      var label = name && name !== code ? (code + ' — ' + name) : code;
      var sel = selected && String(selected).toUpperCase() === code.toUpperCase() ? ' selected' : '';
      opts += '<option value="' + escapeHtml(code) + '"' + sel + '>' + escapeHtml(label) + '</option>';
    });
    return opts;
  }

  function renderClientesSinVendedor(clients) {
    asignarCache = Array.isArray(clients) ? clients : [];
    var body = document.getElementById('adminAsignarBody');
    var countEl = document.getElementById('adminAsignarCount');
    if (countEl) countEl.textContent = String(asignarCache.length);
    if (!body) return;
    if (!asignarCache.length) {
      body.innerHTML = '<tr><td colspan="7">No hay clientes sin vendedor con cotizaciones pendientes de asignar.</td></tr>';
      return;
    }
    body.innerHTML = asignarCache.map(function (c, idx) {
      var nit = String(c.nit || '');
      var quotes = Number(c.quotes_sin_vendedor != null ? c.quotes_sin_vendedor : (c.quotes_total || 0));
      var reg = c.registered ? 'Registrado' : 'Solo cotizó';
      return (
        '<tr data-nit="' + escapeHtml(nit) + '">' +
          '<td>' + (idx + 1) + '</td>' +
          '<td>' +
            '<div><strong>' + escapeHtml(c.nombre || '—') + '</strong></div>' +
            '<div class="admin-muted">' + escapeHtml(reg) + '</div>' +
          '</td>' +
          '<td>' + escapeHtml(nit || '—') + '</td>' +
          '<td>' + escapeHtml(String(quotes)) + '</td>' +
          '<td>' + escapeHtml(formatDate(c.last_quote_at)) + '</td>' +
          '<td>' +
            '<select class="admin-assign-select" data-nit="' + escapeHtml(nit) + '" aria-label="Vendedor">' +
              asesorSelectOptionsHtml() +
            '</select>' +
          '</td>' +
          '<td class="admin-actions">' +
            '<button type="button" class="admin-assign-btn" data-nit="' + escapeHtml(nit) + '" data-nombre="' + escapeHtml(c.nombre || '') + '">Asignar</button> ' +
            '<button type="button" class="admin-delete admin-dismiss-sin-vendedor" data-nit="' + escapeHtml(nit) + '" data-nombre="' + escapeHtml(c.nombre || '') + '">Eliminar</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function deriveClientesSinVendedorFromQuotes(quotes) {
    var usersByNit = {};
    (Array.isArray(usersCache) ? usersCache : []).forEach(function (u) {
      if (!u) return;
      var nit = String(u.nit || '').replace(/[\s.]/g, '').replace(/-\d$/, '');
      if (!nit) return;
      usersByNit[nit] = u;
    });
    var byNit = {};
    (Array.isArray(quotes) ? quotes : []).forEach(function (q) {
      if (!q) return;
      var nit = String(q.nit || '').replace(/[\s.]/g, '').replace(/-\d$/, '');
      if (!nit) return;
      var seller = String(q.seller_codigo || '').trim();
      var assigned = String(q.assigned_by_id || '').trim();
      var orphan = !seller && !assigned;
      if (!orphan) return;
      if (!byNit[nit]) {
        byNit[nit] = {
          nit: nit,
          nombre: String(q.nombre || '').trim() || nit,
          quotes_total: 0,
          quotes_sin_vendedor: 0,
          last_quote_at: '',
          registered: !!usersByNit[nit]
        };
      }
      byNit[nit].quotes_total += 1;
      byNit[nit].quotes_sin_vendedor += 1;
      var created = q.finished_at || q.created_at || '';
      if (created && String(created) > String(byNit[nit].last_quote_at || '')) {
        byNit[nit].last_quote_at = created;
      }
      if (usersByNit[nit] && usersByNit[nit].nombre) {
        byNit[nit].nombre = usersByNit[nit].nombre;
        byNit[nit].registered = true;
      }
    });
    return Object.keys(byNit).map(function (k) { return byNit[k]; }).sort(function (a, b) {
      return String(b.last_quote_at || '').localeCompare(String(a.last_quote_at || ''));
    });
  }

  function loadClientesSinVendedor(options) {
    var silent = !!(options && options.silent);
    if (!window.IZCAuth || !IZCAuth.getSessionNit) {
      renderClientesSinVendedor([]);
      return Promise.resolve();
    }
    if (!silent) setMessage('adminMessage', 'Cargando clientes sin vendedor…', '');
    return postAdminApi({
      action: 'list_clientes_sin_vendedor',
      admin_nit: IZCAuth.getSessionNit()
    }).then(function (data) {
      if (!data || !data.ok) {
        // Fallback silencioso: derivar de cotizaciones (servidor sin la acción nueva).
        return fetchQuotes({ syncBitrix: false, silent: true }).then(function (qData) {
          var derived = deriveClientesSinVendedorFromQuotes((qData && qData.quotes) || quotesCache || []);
          renderClientesSinVendedor(derived);
          if (!silent) setMessage('adminMessage', '', '');
        });
      }
      renderClientesSinVendedor(data.clients || []);
      if (!silent) setMessage('adminMessage', '', '');
    }).catch(function () {
      var derived = deriveClientesSinVendedorFromQuotes(quotesCache || []);
      renderClientesSinVendedor(derived);
      if (!silent) setMessage('adminMessage', '', '');
    });
  }

  function assignVendedorCliente(nit, sellerCodigo, nombre) {
    if (!window.IZCAuth || !IZCAuth.getSessionNit) return;
    nit = String(nit || '').trim();
    sellerCodigo = String(sellerCodigo || '').trim();
    if (!nit) {
      setMessage('adminMessage', 'NIT inválido.', 'error');
      return;
    }
    if (!sellerCodigo) {
      setMessage('adminMessage', 'Elige un vendedor antes de asignar.', 'error');
      return;
    }
    setMessage('adminMessage', 'Asignando vendedor…', '');
    postAdminApi({
      action: 'assign_vendedor_cliente',
      admin_nit: IZCAuth.getSessionNit(),
      client_nit: nit,
      seller_codigo: sellerCodigo,
      nombre: nombre || ''
    }).then(function (data) {
      if (!data || !data.ok) {
        var err = String((data && data.error) || 'No se pudo asignar.');
        if (/accion no valida|acción no válida|invalid action/i.test(err)) {
          err = 'El servidor no tiene la acción nueva. Reinicia con tools\\ABRIR.bat y sube api/auth.php + api/admin_assign_vendedor.php.';
        }
        setMessage('adminMessage', err, 'error');
        return;
      }
      if (Array.isArray(data.clients)) {
        renderClientesSinVendedor(data.clients);
      } else {
        loadClientesSinVendedor({ silent: true });
      }
      var n = Number(data.quotes_updated || 0);
      setMessage(
        'adminMessage',
        data.message || ('Vendedor asignado' + (n ? (' (' + n + ' cotización' + (n === 1 ? '' : 'es') + ').') : '.')),
        'ok'
      );
    }).catch(function () {
      setMessage('adminMessage', 'Error al asignar. Reinicia el servidor local.', 'error');
    });
  }

  function fetchTrm() {
    return postAdminApi({ action: 'get_trm' });
  }

  function updateTrmBadge(value) {
    var el = document.getElementById('adminTrmValue');
    if (el && value != null && isFinite(Number(value))) {
      el.textContent = String(Number(value));
    }
  }

  function loadTrmPanel() {
    return fetchTrm().then(function (data) {
      if (!data || !data.ok) return;
      var input = document.getElementById('adminTrmInput');
      var meta = document.getElementById('adminTrmMeta');
      if (input) input.value = data.value;
      updateTrmBadge(data.value);
      if (meta) {
        meta.textContent = data.updated_at
          ? 'Última actualización: ' + formatDate(data.updated_at) +
            (data.updated_by_nombre ? ' · ' + data.updated_by_nombre : '')
          : 'Aún no se ha actualizado la TRM del día.';
      }
    }).catch(function () { /* ignore */ });
  }

  function saveTrmAdmin() {
    var input = document.getElementById('adminTrmInput');
    var value = input ? Number(input.value) : 0;
    if (!isFinite(value) || value <= 0) {
      setMessage('adminMessage', 'Ingresa una TRM válida mayor que cero.', 'error');
      return;
    }
    setMessage('adminMessage', 'Guardando TRM…', '');
    postAdminApi({
      action: 'set_trm',
      admin_nit: IZCAuth.getSessionNit(),
      admin_nombre: IZCAuth.getSessionNombre ? IZCAuth.getSessionNombre() : '',
      value: value
    }).then(function (data) {
      if (!data || !data.ok) {
        var err = (data && data.error) || 'No se pudo guardar la TRM.';
        if (/acción no válida/i.test(err)) {
          err += ' Cierra y vuelve a abrir con tools\\ABRIR.bat (reinicia el servidor solo).';
        }
        setMessage('adminMessage', err, 'error');
        return;
      }
      updateTrmBadge(data.value);
      loadTrmPanel();
      setMessage('adminMessage', data.message || 'TRM actualizada.', 'ok');
      if (window.IZCLiveSync) IZCLiveSync.emit(IZCLiveSync.TYPES.TRM, { value: data.value });
    }).catch(function () {
      setMessage('adminMessage', 'No se pudo guardar. Abre tools\\ABRIR.bat para reiniciar el servidor.', 'error');
    });
  }

  function preciosUploadEndpoints() {
    var path = String(location.pathname || '/');
    var slash = path.lastIndexOf('/');
    var base = slash < 0 ? '/' : path.slice(0, slash + 1);
    var host = location.hostname;
    if (host === '127.0.0.1' || host === 'localhost') {
      return [base + 'api/admin_upload_precios.php', API_ORIGIN + '/api/admin_upload_precios.php'];
    }
    return [base + 'api/admin_upload_precios.php'];
  }

  function postPreciosUpload(formData) {
    var endpoints = preciosUploadEndpoints();
    function tryOne(i) {
      if (i >= endpoints.length) {
        return Promise.resolve({ ok: false, error: 'No se encontró api/admin_upload_precios.php' });
      }
      return fetch(endpoints[i], {
        method: 'POST',
        body: formData,
        cache: 'no-store'
      }).then(function (res) {
        return res.text().then(function (text) {
          var trimmed = String(text || '').replace(/^\uFEFF/, '').trim();
          var data = null;
          try { data = trimmed ? JSON.parse(trimmed) : null; } catch (e) { data = null; }
          if (!data) {
            if (res.status >= 400) {
              return tryOne(i + 1);
            }
            return { ok: false, error: 'Respuesta inválida del servidor.' };
          }
          return data;
        });
      }).catch(function () {
        return tryOne(i + 1);
      });
    }
    return tryOne(0);
  }

  function setPreciosStatusMsg(text, type) {
    var el = document.getElementById('adminPreciosStatusMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'auth-message' + (type ? ' is-' + type : '');
  }

  function formatPreciosMeta(data) {
    var excel = (data && data.excel) || {};
    var precios = (data && data.precios) || {};
    var py = (data && data.python_ready) || null;
    var parts = [];
    if (excel.exists) {
      parts.push('Excel: ' + (excel.mtime || 'sí') + (excel.size ? (' · ' + Math.round(excel.size / 1024) + ' KB') : ''));
    } else {
      parts.push('Aún no hay lista-precios-izc.xlsb en el servidor.');
    }
    if (precios.exists && precios.mtime) {
      parts.push('precios.json: ' + precios.mtime);
    }
    if (data && data.needs_sync) parts.push('Pendiente regenerar.');
    if (py) {
      if (py.ok) {
        parts.push('Python OK' + (py.version ? (' (' + py.version + ')') : '') + ' · pandas · pyxlsb');
      } else {
        parts.push(py.error || 'Python/pandas/pyxlsb no listos.');
      }
    } else if (data && data.python === false) {
      parts.push('Python no detectado en el servidor.');
    }
    return parts.join(' · ');
  }

  function updatePreciosBadge(data) {
    var el = document.getElementById('adminPreciosStatus');
    if (!el) return;
    var pyOk = data && (data.python_ready ? !!data.python_ready.ok : !!data.python);
    if (!pyOk) el.textContent = 'Sin Py';
    else if (data && data.needs_sync) el.textContent = 'Sync';
    else if (data && data.excel && data.excel.exists) el.textContent = 'OK';
    else el.textContent = '—';
  }

  function loadPreciosPanel() {
    if (!window.IZCAuth || !IZCAuth.getSessionNit) return Promise.resolve();
    var fd = new FormData();
    fd.append('action', 'status');
    fd.append('admin_nit', IZCAuth.getSessionNit());
    setPreciosStatusMsg('', '');
    return postPreciosUpload(fd).then(function (data) {
      var meta = document.getElementById('adminPreciosMeta');
      if (!data || !data.ok) {
        if (meta) meta.textContent = (data && data.error) || 'No se pudo leer el estado de precios.';
        updatePreciosBadge(null);
        return;
      }
      if (meta) meta.textContent = formatPreciosMeta(data);
      updatePreciosBadge(data);
    }).catch(function () {
      var meta = document.getElementById('adminPreciosMeta');
      if (meta) meta.textContent = 'No se pudo consultar el estado de precios.';
    });
  }

  function uploadPreciosLista() {
    if (!window.IZCAuth || !IZCAuth.getSessionNit) {
      setMessage('adminMessage', 'Sesión de admin no disponible.', 'error');
      return;
    }
    var fileInput = document.getElementById('adminPreciosFile');
    var file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    if (!file) {
      setPreciosStatusMsg('Selecciona el archivo lista-precios-izc.xlsb.', 'error');
      return;
    }
    var name = String(file.name || '').toLowerCase();
    if (!/\.xlsb$/i.test(name)) {
      setPreciosStatusMsg('El archivo debe ser .xlsb (lista-precios-izc.xlsb).', 'error');
      return;
    }
    var btn = document.getElementById('adminPreciosUploadBtn');
    var syncBtn = document.getElementById('adminPreciosSyncBtn');
    if (btn) btn.disabled = true;
    if (syncBtn) syncBtn.disabled = true;
    setPreciosStatusMsg('Subiendo Excel y regenerando precios… (puede tardar 1–2 min)', '');
    setMessage('adminMessage', 'Actualizando lista de precios…', '');
    var fd = new FormData();
    fd.append('action', 'upload');
    fd.append('admin_nit', IZCAuth.getSessionNit());
    fd.append('excel', file, file.name);
    postPreciosUpload(fd).then(function (data) {
      if (btn) btn.disabled = false;
      if (syncBtn) syncBtn.disabled = false;
      if (!data || !data.ok) {
        var err = (data && (data.error || data.message)) || 'No se pudo actualizar la lista.';
        if (data && data.detail) err += ' ' + String(data.detail).slice(0, 240);
        setPreciosStatusMsg(err, 'error');
        setMessage('adminMessage', err, 'error');
        loadPreciosPanel();
        return;
      }
      var counts = data.counts || ((data.sync && data.sync.counts) || {});
      var n = Number(counts.precios || 0);
      var msg = data.message || (n > 0
        ? ('Lista actualizada: ' + n + ' precios (promedio Web/Interna + demás LP).')
        : 'Lista de precios actualizada.');
      setPreciosStatusMsg(msg, 'ok');
      setMessage('adminMessage', msg, 'ok');
      if (fileInput) fileInput.value = '';
      loadPreciosPanel();
    }).catch(function () {
      if (btn) btn.disabled = false;
      if (syncBtn) syncBtn.disabled = false;
      setPreciosStatusMsg('Error de red al subir. Revisa Python en el servidor.', 'error');
      setMessage('adminMessage', 'No se pudo subir la lista de precios.', 'error');
    });
  }

  function syncPreciosListaOnly() {
    if (!window.IZCAuth || !IZCAuth.getSessionNit) return;
    var btn = document.getElementById('adminPreciosUploadBtn');
    var syncBtn = document.getElementById('adminPreciosSyncBtn');
    if (btn) btn.disabled = true;
    if (syncBtn) syncBtn.disabled = true;
    setPreciosStatusMsg('Regenerando precios desde el Excel del servidor…', '');
    var fd = new FormData();
    fd.append('action', 'sync');
    fd.append('admin_nit', IZCAuth.getSessionNit());
    fd.append('force', '1');
    postPreciosUpload(fd).then(function (data) {
      if (btn) btn.disabled = false;
      if (syncBtn) syncBtn.disabled = false;
      if (!data || !data.ok) {
        var err = (data && (data.error || data.message)) || 'No se pudo regenerar.';
        setPreciosStatusMsg(err, 'error');
        setMessage('adminMessage', err, 'error');
        return;
      }
      var msg = data.message || 'Precios regenerados.';
      setPreciosStatusMsg(msg, 'ok');
      setMessage('adminMessage', msg, 'ok');
      loadPreciosPanel();
    }).catch(function () {
      if (btn) btn.disabled = false;
      if (syncBtn) syncBtn.disabled = false;
      setPreciosStatusMsg('No se pudo regenerar.', 'error');
    });
  }

  function updateBitrixBadge(configured, enabled) {
    var el = document.getElementById('adminBitrixStatus');
    if (!el) return;
    if (enabled && configured) el.textContent = 'On';
    else if (configured) el.textContent = 'Off';
    else el.textContent = '—';
  }

  function loadBitrixPanel() {
    if (!window.IZCAuth || !IZCAuth.getSessionNit) return Promise.resolve();
    return postAdminApi({
      action: 'get_bitrix',
      admin_nit: IZCAuth.getSessionNit()
    }).then(function (data) {
      if (!data || !data.ok) return;
      var enabled = document.getElementById('adminBitrixEnabled');
      var webhook = document.getElementById('adminBitrixWebhook');
      var stage = document.getElementById('adminBitrixStage');
      var category = document.getElementById('adminBitrixCategory');
      var meta = document.getElementById('adminBitrixMeta');
      if (enabled) enabled.checked = !!data.enabled;
      if (webhook) webhook.value = data.webhook_base || '';
      if (stage) stage.value = data.stage_id || '';
      if (category) category.value = data.category_id || '';
      updateBitrixBadge(!!data.configured, !!data.enabled);
      if (meta) {
        meta.textContent = data.updated_at
          ? 'Última actualización: ' + formatDate(data.updated_at)
          : 'Aún no hay configuración Bitrix guardada.';
      }
    }).catch(function () {
      setMessage('adminMessage', 'No se pudo cargar Bitrix. Reinicia con tools\\ABRIR.bat.', 'error');
    });
  }

  function bitrixFormPayload() {
    return {
      admin_nit: IZCAuth.getSessionNit(),
      enabled: !!(document.getElementById('adminBitrixEnabled') || {}).checked,
      webhook_base: (document.getElementById('adminBitrixWebhook') || {}).value || '',
      stage_id: (document.getElementById('adminBitrixStage') || {}).value || '',
      category_id: (document.getElementById('adminBitrixCategory') || {}).value || '',
      currency_id: 'COP'
    };
  }

  function adminAuthError(data, fallback) {
    var err = String((data && data.error) || fallback || 'No autorizado.').trim();
    if (/no autorizado/i.test(err)) {
      var nit = '';
      try { nit = (window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || ''; } catch (e) { /* ignore */ }
      return 'No autorizado para Bitrix. Cierra sesión e inicia con el usuario administrador (Admin IZC). Sesión actual: ' + (nit || '(vacía)');
    }
    return err;
  }

  function saveBitrixAdmin() {
    setMessage('adminMessage', 'Guardando Bitrix…', '');
    postAdminApi(Object.assign({ action: 'set_bitrix' }, bitrixFormPayload())).then(function (data) {
      if (!data || !data.ok) {
        setMessage('adminMessage', adminAuthError(data, 'No se pudo guardar Bitrix.'), 'error');
        return;
      }
      setMessage('adminMessage', data.message || 'Bitrix guardado.', 'ok');
      loadBitrixPanel();
    }).catch(function () {
      setMessage('adminMessage', 'Error al guardar Bitrix. Reinicia el servidor.', 'error');
    });
  }

  function testBitrixAdmin() {
    var stagesEl = document.getElementById('adminBitrixStages');
    if (stagesEl) {
      stagesEl.hidden = true;
      stagesEl.textContent = '';
    }
    setMessage('adminMessage', 'Probando Bitrix…', '');
    postAdminApi(Object.assign({ action: 'test_bitrix' }, bitrixFormPayload())).then(function (data) {
      if (!data || !data.ok) {
        setMessage('adminMessage', adminAuthError(data, 'Prueba Bitrix fallida.'), 'error');
        return;
      }
      setMessage('adminMessage', data.message || 'Bitrix OK.', 'ok');
      if (stagesEl && data.stages && data.stages.length) {
        var lines = data.stages.map(function (s) {
          return (s.STATUS_ID || s.status_id || '') + '  →  ' + (s.NAME || s.name || '');
        });
        stagesEl.textContent = 'Etapas del embudo (copia el STATUS_ID de COTIZACION):\n' + lines.join('\n');
        stagesEl.hidden = false;
      }
    }).catch(function (err) {
      var detail = (err && err.message) ? String(err.message).trim() : '';
      var msg = 'No se pudo probar Bitrix.';
      if (detail && detail !== 'sin api') msg += ' ' + detail;
      setMessage('adminMessage', msg, 'error');
    });
  }

  function syncLocalDataAdmin() {
    if (!window.IZCAuth || !IZCAuth.getSessionNit) return;
    setMessage('adminMessage', 'Mapeando historial con Bitrix (deal_id/estado, sin crear nuevas)…', '');
    postAdminApi({
      action: 'sync_local_data',
      admin_nit: IZCAuth.getSessionNit(),
      import_new: 0
    }).then(function (data) {
      if (!data || !data.ok) {
        setMessage('adminMessage', (data && data.error) || 'No se pudo sincronizar.', 'error');
        return;
      }
      setMessage('adminMessage', data.message || 'Mapeo Bitrix listo.', 'ok');
      try { loadUsers({ silent: true }); } catch (e1) { /* ignore */ }
      try { fetchQuotes({ syncBitrix: true, silent: true }); } catch (e2) { /* ignore */ }
      try { loadClientesSinVendedor({ silent: true }); } catch (e3) { /* ignore */ }
      try { if (typeof loadProductosCreados === 'function') loadProductosCreados({ silent: true }); } catch (e4) { /* ignore */ }
      if (window.IZCLiveSync) IZCLiveSync.emit(IZCLiveSync.TYPES.ALL);
    }).catch(function () {
      setMessage('adminMessage', 'Error al sincronizar. Reinicia con tools\\ABRIR.bat y revisa data/bitrix.json.', 'error');
    });
  }

  function pullServerDataToLocalAdmin() {
    var isLocal = false;
    try {
      var h = location.hostname;
      isLocal = h === '127.0.0.1' || h === 'localhost';
    } catch (e) { /* ignore */ }
    if (!isLocal) {
      setMessage(
        'adminMessage',
        'Esta acción solo corre en el PC local (127.0.0.1). En el servidor no se usa: evita sobrescribir producción.',
        'error'
      );
      return;
    }
    if (!window.IZCAuth || typeof IZCAuth.confirm !== 'function') {
      setMessage('adminMessage', 'Actualiza auth.js en el servidor (Ctrl+F5).', 'error');
      return;
    }
    IZCAuth.confirm({
      title: 'Traer datos del servidor',
      message:
        'Esto COPIARÁ los datos del servidor al PC local.\n\n' +
        '• El servidor NO se modifica (solo lectura).\n' +
        '• Se hace backup de tu data/ local antes.\n' +
        '• Tus cotizaciones locales de más se reemplazan por las del servidor.\n\n' +
        '¿Continuar?',
      confirmText: 'Sí, continuar',
      cancelText: 'Cancelar',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      setMessage('adminMessage', 'Traendo datos del servidor → local…', '');
      postAdminApi({
        action: 'pull_from_remote_server',
        admin_nit: IZCAuth.getSessionNit(),
        server_base: 'http://pqr.izc.com.co:8183/IZC'
      }).then(function (data) {
        if (!data || !data.ok) {
          var err = (data && data.error) || 'No se pudo traer del servidor.';
          if (/export_admin_data|accion no|no v[aá]lida|pull_from_remote/i.test(err)) {
            err = 'Sube api/auth.php al servidor y reinicia el local, o ejecuta tools\\TRAER_DATOS_DEL_SERVIDOR.bat';
          }
          setMessage('adminMessage', err, 'error');
          return;
        }
        setMessage('adminMessage', data.message || 'Local actualizado desde el servidor.', 'ok');
        try { loadUsers({ silent: true }); } catch (e1) { /* ignore */ }
        try { fetchQuotes({ syncBitrix: false, silent: true }); } catch (e2) { /* ignore */ }
        try { loadClientesSinVendedor({ silent: true }); } catch (e3) { /* ignore */ }
        try { if (typeof loadProductosCreados === 'function') loadProductosCreados({ silent: true }); } catch (e4) { /* ignore */ }
        if (window.IZCLiveSync) IZCLiveSync.emit(IZCLiveSync.TYPES.ALL);
      }).catch(function () {
        setMessage('adminMessage', 'No se pudo traer del servidor.', 'error');
      });
    });
  }

  function openQuoteDetail(idx) {
    var quote = quotesCache[idx];
    var modal = document.getElementById('quoteDetailModal');
    var meta = document.getElementById('quoteDetailMeta');
    var body = document.getElementById('quoteDetailBody');
    if (!quote || !modal || !body) return;

    if (meta) {
      var seller =
        quote.seller_label ||
        quote.seller_name ||
        quote.seller_codigo ||
        '';
      meta.textContent =
        (quote.nombre || '—') + ' · NIT ' + (normalizeNit(quote.nit) || '') +
        ' · ' + formatDate(quote.created_at) +
        ' · Vendedor: ' + (seller || 'Sin vendedor asignado') +
        ' · Estado: ' + quoteEstadoLabel(quoteEstado(quote));
    }

    var paintDetail = function () {
      var enriched = Object.assign({}, quote, { items: quoteItemsResolved(quote) });
      var rows = enriched.items.map(function (line) {
        var referencia = '—';
        if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.resolveReferencia === 'function') {
          referencia = IZCCotizacionPdf.resolveReferencia(line) || '—';
        } else {
          var refRaw = String(line.referencia || '').trim();
          if (refRaw && refRaw !== '—' && !/^bitrix\s*#/i.test(refRaw)) referencia = refRaw;
        }
        var displayName = line.name || '—';
        if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.resolveLineDisplay === 'function') {
          displayName = IZCCotizacionPdf.resolveLineDisplay(line).name || displayName;
        }
        return (
          '<tr>' +
            '<td>' + escapeHtml(line.sku || '') + '</td>' +
            '<td>' + escapeHtml(referencia) + '</td>' +
            '<td>' + escapeHtml(displayName) + '</td>' +
            '<td>' + (line.qty || 0) + '</td>' +
            '<td>' + escapeHtml(lineTotal(line)) + '</td>' +
          '</tr>'
        );
      }).join('');

      body.innerHTML =
        '<table class="admin-quote-detail-table">' +
          '<thead><tr><th>SKU</th><th>Referencia</th><th>Producto</th><th>Cant.</th><th>Total</th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="5">Sin productos</td></tr>') + '</tbody>' +
        '</table>' +
        '<p class="admin-quote-total"><strong>' + escapeHtml(quoteTotalTitle(quote)) + ':</strong> ' +
          escapeHtml(quoteTotalLabel(quote)) + '</p>' +
        liquidacionHtml(enriched) +
        comentarioAsesorHtml(quote);

      modal.hidden = false;
    };

    if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.loadNameMaps === 'function') {
      IZCCotizacionPdf.loadNameMaps().then(paintDetail).catch(paintDetail);
    } else {
      paintDetail();
    }
  }

  function comentarioAsesorHtml(quote) {
    var text = String((quote && quote.asesor_comentario) || '');
    var at = quote && quote.asesor_comentario_at;
    var by = quote && quote.asesor_comentario_by;
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

  function bindTabs() {
    document.querySelectorAll('.admin-stat.is-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-tab') || 'users';
        setActiveTab(tab);
      });
    });

    var quotesBody = document.getElementById('adminQuotesBody');
    if (quotesBody) {
      quotesBody.addEventListener('click', function (e) {
        var btn = e.target.closest('.admin-view-quote');
        if (!btn) return;
        openQuoteDetail(Number(btn.getAttribute('data-idx')));
      });
    }

    var filterEstado = document.getElementById('adminQuoteFilterEstado');
    var filterFecha = document.getElementById('adminQuoteFilterFecha');
    var filterNit = document.getElementById('adminQuoteFilterNit');
    var filterVendedor = document.getElementById('adminQuoteFilterVendedor');
    var filterClear = document.getElementById('adminQuoteFilterClear');
    if (filterEstado) filterEstado.addEventListener('change', applyQuotesFilter);
    if (filterFecha) filterFecha.addEventListener('change', applyQuotesFilter);
    if (filterNit) {
      filterNit.addEventListener('input', applyQuotesFilter);
      filterNit.addEventListener('search', applyQuotesFilter);
    }
    if (filterVendedor) filterVendedor.addEventListener('change', applyQuotesFilter);
    if (filterClear) filterClear.addEventListener('click', clearQuotesFilters);

    var reportBtn = document.getElementById('adminQuotesReportBtn');
    if (reportBtn) {
      reportBtn.addEventListener('click', function () {
        downloadAsesorQuotesReport();
      });
    }

    var quoteModal = document.getElementById('quoteDetailModal');
    if (quoteModal) {
      quoteModal.addEventListener('click', function (e) {
        if (e.target.closest('[data-modal-close]')) quoteModal.hidden = true;
      });
    }

    var trmSave = document.getElementById('adminTrmSave');
    if (trmSave) trmSave.addEventListener('click', saveTrmAdmin);

    var preciosUpload = document.getElementById('adminPreciosUploadBtn');
    if (preciosUpload) preciosUpload.addEventListener('click', uploadPreciosLista);
    var preciosSync = document.getElementById('adminPreciosSyncBtn');
    if (preciosSync) preciosSync.addEventListener('click', syncPreciosListaOnly);

    var bitrixSave = document.getElementById('adminBitrixSave');
    if (bitrixSave) bitrixSave.addEventListener('click', saveBitrixAdmin);
    var bitrixTest = document.getElementById('adminBitrixTest');
    if (bitrixTest) bitrixTest.addEventListener('click', testBitrixAdmin);
    var syncLocalBtn = document.getElementById('adminSyncLocalBtn');
    if (syncLocalBtn) syncLocalBtn.addEventListener('click', syncLocalDataAdmin);
    var pullServerBtn = document.getElementById('adminPullServerBtn');
    if (pullServerBtn) pullServerBtn.addEventListener('click', pullServerDataToLocalAdmin);

    var asesorForm = document.getElementById('adminAsesorForm');
    if (asesorForm) {
      asesorForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveAsesorAdmin();
      });
    }
    var asesoresBody = document.getElementById('adminAsesoresBody');
    if (asesoresBody) {
      asesoresBody.addEventListener('click', function (e) {
        var btn = e.target.closest('.admin-delete-asesor');
        if (!btn) return;
        var codigo = btn.getAttribute('data-codigo') || '';
        if (!codigo) return;
        var ask = (window.IZCAuth && typeof IZCAuth.confirm === 'function')
          ? IZCAuth.confirm({
              title: 'Eliminar asesor',
              message: '¿Eliminar asesor ' + codigo + '?',
              confirmText: 'Sí, eliminar',
              cancelText: 'Cancelar',
              danger: true
            })
          : Promise.resolve(false);
        ask.then(function (ok) {
          if (ok) deleteAsesorAdmin(codigo);
        });
      });
    }
  }

  function renderAsesores(asesores) {
    var body = document.getElementById('adminAsesoresBody');
    var count = document.getElementById('adminAsesorCount');
    asesoresCache = sortAsesoresByCodigo(Array.isArray(asesores) ? asesores : []);
    if (count) count.textContent = String(asesoresCache.length);
    if (!body) return;
    if (!asesoresCache.length) {
      body.innerHTML = '<tr><td colspan="6" class="admin-empty">Aún no hay asesores registrados.</td></tr>';
      return;
    }
    body.innerHTML = asesoresCache.map(function (a, idx) {
      var codigo = a.codigo || '';
      var extras = Array.isArray(a.codigos_extra) ? a.codigos_extra.join(', ') : '';
      return (
        '<tr>' +
          '<td class="admin-row-num">' + (idx + 1) + '</td>' +
          '<td>' + escapeHtml(codigo) + '</td>' +
          '<td>' + escapeHtml(extras || '—') + '</td>' +
          '<td>' + escapeHtml(a.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(formatDate(a.created_at)) + '</td>' +
          '<td class="admin-actions">' +
            '<button type="button" class="admin-delete admin-delete-asesor" data-codigo="' + escapeHtml(codigo) + '">Eliminar</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
    // Refrescar filtro de vendedores del historial con la lista completa.
    fillVendedorFilterOptions(quotesCache);
  }

  function loadAsesores(options) {
    options = options || {};
    if (!window.IZCAuth || !IZCAuth.getSessionNit) return Promise.resolve();
    if (!options.silent && !options.keepMessage) {
      setMessage('adminMessage', 'Cargando asesores…', '');
    }
    return postAdminApi({
      action: 'list_asesores',
      admin_nit: IZCAuth.getSessionNit()
    }).then(function (data) {
      if (!data.ok) {
        if (!options.silent) {
          setMessage('adminMessage', data.error || 'No se pudo cargar asesores.', 'error');
        }
        if (!asesoresCache.length) renderAsesores([]);
        return;
      }
      if ((data.asesores || []).length === 0 && asesoresCache.length) {
        return;
      }
      renderAsesores(data.asesores || []);
      if (!options.silent && !options.keepMessage) {
        setMessage('adminMessage', '', '');
      }
    }).catch(function () {
      if (!options.silent) {
        setMessage('adminMessage', 'No se pudo cargar asesores. Ejecuta tools\\ABRIR.bat.', 'error');
      }
    });
  }

  function saveAsesorAdmin() {
    var codigoEl = document.getElementById('adminAsesorCodigo');
    var extrasEl = document.getElementById('adminAsesorExtras');
    var passEl = document.getElementById('adminAsesorPassword');
    var nombreEl = document.getElementById('adminAsesorNombre');
    var codigo = codigoEl ? codigoEl.value.trim() : '';
    var extras = extrasEl ? extrasEl.value.trim() : '';
    var password = passEl ? passEl.value : '';
    var nombre = nombreEl ? nombreEl.value.trim() : '';
    if (!codigo || !password) {
      setMessage('adminMessage', 'Ingresa código de vendedor y contraseña.', 'error');
      return;
    }
    setMessage('adminMessage', 'Registrando asesor…', '');
    postAdminApi({
      action: 'register_asesor',
      admin_nit: IZCAuth.getSessionNit(),
      codigo: codigo,
      password: password,
      nombre: nombre,
      codigos_extra: extras
    }).then(function (data) {
      if (!data.ok) {
        setMessage('adminMessage', data.error || 'No se pudo registrar.', 'error');
        return;
      }
      if (codigoEl) codigoEl.value = '';
      if (extrasEl) extrasEl.value = '';
      if (passEl) passEl.value = '';
      if (nombreEl) nombreEl.value = '';
      setMessage('adminMessage', data.message || ('Asesor ' + (data.codigo || codigo) + ' registrado.'), 'ok');
      if (window.IZCLiveSync) IZCLiveSync.emit(IZCLiveSync.TYPES.ASESORES);
      return loadAsesores({ keepMessage: true });
    }).catch(function () {
      setMessage('adminMessage', 'Error al registrar asesor. Reinicia tools\\ABRIR.bat.', 'error');
    });
  }

  function deleteAsesorAdmin(codigo) {
    postAdminApi({
      action: 'delete_asesor',
      admin_nit: IZCAuth.getSessionNit(),
      codigo: codigo
    }).then(function (data) {
      if (!data.ok) {
        setMessage('adminMessage', data.error || 'No se pudo eliminar.', 'error');
        return;
      }
      setMessage('adminMessage', data.message || 'Asesor eliminado.', 'ok');
      if (window.IZCLiveSync) IZCLiveSync.emit(IZCLiveSync.TYPES.ASESORES);
      loadAsesores({ keepMessage: true });
    }).catch(function () {
      setMessage('adminMessage', 'Error al eliminar asesor.', 'error');
    });
  }

  function sessionIsAdmin() {
    try {
      if (window.IZCAuth && typeof IZCAuth.isAdmin === 'function' && IZCAuth.isAdmin()) return true;
    } catch (e0) { /* ignore */ }
    var role = '';
    var nit = '';
    try { role = String(localStorage.getItem('izc_session_role') || '').toLowerCase(); } catch (e1) { /* ignore */ }
    try { nit = String((window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || localStorage.getItem('izc_session_nit') || ''); } catch (e2) { /* ignore */ }
    if (role === 'admin') return true;
    var tok = String(nit || '').replace(/[\s._-]/g, '').toUpperCase();
    if (tok === 'ADMINIZC' || tok === 'ADMIN' || tok === 'IZCADMIN') return true;
    try {
      if (window.IZCAuth && typeof IZCAuth.isAdminNit === 'function' && IZCAuth.isAdminNit(nit)) return true;
    } catch (e3) { /* ignore */ }
    return false;
  }

  function fillProfile() {
    var nit = (window.IZCAuth && IZCAuth.getSessionNit()) || '';
    var nombre = (window.IZCAuth && IZCAuth.getSessionNombre && IZCAuth.getSessionNombre()) || '';
    var greet = document.getElementById('profileGreeting');

    if (!nit) {
      setMessage('adminMessage', 'Debes iniciar sesión como administrador.', 'error');
      if (greet) greet.textContent = 'Hola';
      setNombreEditUi(false);
      window.setTimeout(function () {
        if (!(window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit())) {
          window.location.href = 'login.html';
        }
      }, 800);
      return false;
    }

    if (!sessionIsAdmin()) {
      if ((IZCAuth.isZkteco && IZCAuth.isZkteco()) || (IZCAuth.isZebra && IZCAuth.isZebra())) {
        window.location.replace('panel-zkteco.html');
      } else if (IZCAuth.isAsesor && IZCAuth.isAsesor()) {
        window.location.replace('asesor.html');
      } else {
        window.location.replace('perfil.html');
      }
      return false;
    }

    if (greet && !isEditingNombre()) greet.textContent = 'Hola ' + (nombre || 'admin');
    setMessage('adminMessage', '', '');
    return true;
  }

  function profileCard() {
    return document.querySelector('.profile-name-card');
  }

  function currentAdminNombre() {
    return ((window.IZCAuth && IZCAuth.getSessionNombre && IZCAuth.getSessionNombre()) || 'admin').trim();
  }

  function isEditingNombre() {
    var card = profileCard();
    return !!(card && card.classList.contains('is-editing-name'));
  }

  function setNombreEditUi(editing) {
    var card = profileCard();
    var greet = document.getElementById('profileGreeting');
    var input = document.getElementById('adminNombreInput');
    var toggle = document.getElementById('adminNombreToggle');
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
        input.value = currentAdminNombre();
        window.setTimeout(function () {
          input.focus();
          input.select();
        }, 0);
      }
    }
    if (greet) greet.hidden = !!editing;
  }

  function setNombreStatus(text, type) {
    var el = document.getElementById('adminNombreStatus');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'auth-message profile-name-status');
      return;
    }
    el.textContent = text || '';
    el.className = 'auth-message profile-name-status' + (type ? ' is-' + type : '');
  }

  function saveAdminNombre() {
    var nit = (window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || '';
    var input = document.getElementById('adminNombreInput');
    if (!nit || !input) return;
    var nombre = String(input.value || '').trim();
    if (nombre.length < 2) {
      setNombreStatus('Ingresa un nombre válido (mínimo 2 caracteres).', 'error');
      setNombreEditUi(true);
      return;
    }
    setNombreStatus('Guardando…', '');
    postAdminApi({
      action: 'update_admin_nombre',
      admin_nit: nit,
      nit: nit,
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
        IZCAuth.setSessionNit(nit, saved, { role: 'admin', skipUi: true });
      }
      var greet = document.getElementById('profileGreeting');
      if (greet) greet.textContent = 'Hola ' + (saved || 'admin');
      setNombreEditUi(false);
      setNombreStatus(data.message || 'Nombre actualizado.', 'ok');
      window.setTimeout(function () { setNombreStatus('', ''); }, 2500);
    }).catch(function () {
      setNombreStatus('No se pudo guardar el nombre.', 'error');
    });
  }

  function bindNombreEdit() {
    var toggle = document.getElementById('adminNombreToggle');
    var input = document.getElementById('adminNombreInput');
    if (toggle) {
      toggle.addEventListener('click', function () {
        if (isEditingNombre()) saveAdminNombre();
        else {
          setNombreStatus('', '');
          setNombreEditUi(true);
        }
      });
    }
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveAdminNombre();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setNombreEditUi(false);
          setNombreStatus('', '');
          var greet = document.getElementById('profileGreeting');
          if (greet) greet.textContent = 'Hola ' + currentAdminNombre();
        }
      });
    }
  }

  function isAsesorRegisteredUser(u) {
    if (window.IZCAuth && typeof IZCAuth.isInternalStaffUser === 'function' && IZCAuth.isInternalStaffUser(u)) {
      return false;
    }
    return String((u && u.origen) || '').toLowerCase().indexOf('asesor') !== -1;
  }

  function isPortalRegisteredUser(u) {
    if (window.IZCAuth && typeof IZCAuth.isInternalStaffUser === 'function' && IZCAuth.isInternalStaffUser(u)) {
      return false;
    }
    return String((u && u.origen) || '').toLowerCase().indexOf('portal') !== -1;
  }

  function cleanVendedorLabel(text) {
    return String(text || '')
      .replace(/\u00C2\u00B7/g, '\u00B7')
      .replace(/Â·/g, '\u00B7')
      .trim();
  }

  function renderUsers(users) {
    usersCache = sortByNewestCreated(Array.isArray(users) ? users : [], 'created_at');
    var allCountEl = document.getElementById('adminUserAllCount');
    var asesorCountEl = document.getElementById('adminUserCount');
    var asesorUsers = usersCache.filter(isAsesorRegisteredUser);
    var portalUsers = usersCache.filter(isPortalRegisteredUser);
    if (allCountEl) allCountEl.textContent = String(portalUsers.length);
    if (asesorCountEl) asesorCountEl.textContent = String(asesorUsers.length);

    var showPortal = activeTab === 'users-all';
    var view = showPortal ? portalUsers : asesorUsers;
    var body = document.getElementById('adminUsersBody');
    if (!body) return;

    if (!view.length) {
      body.innerHTML = showPortal
        ? '<tr><td colspan="8" class="admin-empty">No hay clientes registrados por el portal.</td></tr>'
        : '<tr><td colspan="8" class="admin-empty">Aún no hay clientes registrados por asesores.</td></tr>';
      return;
    }

    body.innerHTML = view.map(function (u, idx) {
      var nit = normalizeNit(u.nit);
      var origen = String(u.origen || 'portal');
      var vendCodigo = String(u.vendedor_codigo || '');
      var vendedor = cleanVendedorLabel(u.vendedor);
      var contactoNombre = String(u.contacto_nombre || u.nombre_contacto || '').trim();
      var contactoTel = String(u.contacto_telefono || u.telefono_contacto || u.telefono || '').trim();
      if (!vendedor || vendedor.charCodeAt(0) === 0xe2) {
        vendedor = 'Sin asignar';
      }
      var btn =
        '<button type="button" class="admin-delete" data-nit="' + escapeHtml(nit) +
        '" data-origen="' + escapeHtml(origen) +
        '" data-vendedor-codigo="' + escapeHtml(vendCodigo) +
        '">Eliminar</button>';
      return (
        '<tr>' +
          '<td class="admin-row-num">' + (idx + 1) + '</td>' +
          '<td>' + escapeHtml(u.nombre || '—') + '</td>' +
          '<td>' + escapeHtml(nit) + '</td>' +
          '<td>' + escapeHtml(contactoNombre || '—') + '</td>' +
          '<td>' + escapeHtml(contactoTel || '—') + '</td>' +
          '<td>' + escapeHtml(vendedor) + '</td>' +
          '<td>' + escapeHtml(formatDate(u.created_at)) + '</td>' +
          '<td class="admin-actions">' + btn + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function loadUsers(options) {
    options = options || {};
    if (!window.IZCAuth || !IZCAuth.listUsersForAdmin) return Promise.resolve();
    if (!options.silent) setMessage('adminMessage', 'Cargando…', '');
    return IZCAuth.listUsersForAdmin().then(function (data) {
      if (!data.ok) {
        if (!options.silent) setMessage('adminMessage', data.error || 'No se pudo cargar.', 'error');
        return;
      }
      var sourceEl = document.getElementById('adminSource');
      if (sourceEl) sourceEl.textContent = data.source || '—';
      // No mostrar admin / ZKTeco / asesores como si fueran clientes del portal.
      var users = (data.users || []).filter(function (u) {
        if (window.IZCAuth && typeof IZCAuth.isInternalStaffUser === 'function') {
          return !IZCAuth.isInternalStaffUser(u);
        }
        if (IZCAuth.isAdminNit && IZCAuth.isAdminNit(u.nit)) return false;
        if (IZCAuth.isZktecoLogin && IZCAuth.isZktecoLogin(u.nit)) return false;
        var role = String((u && u.role) || '').toLowerCase();
        return role !== 'admin' && role !== 'zkteco' && role !== 'zebra' && role !== 'asesor';
      });
      renderUsers(users);
      persistAdminSnapshot();
      if (!options.silent) setMessage('adminMessage', '', '');
    }).catch(function (err) {
      console.error(err);
      if (!options.silent) setMessage('adminMessage', 'Error al cargar usuarios.', 'error');
    });
  }

  function bindTable() {
    var body = document.getElementById('adminUsersBody');
    var modal = document.getElementById('deleteModal');
    var modalTitle = document.getElementById('deleteModalTitle');
    var modalText = document.getElementById('deleteModalText');
    var confirmBtn = document.getElementById('deleteModalConfirm');
    var pendingNit = '';
    var pendingNombre = '';
    var pendingOrigen = '';
    var pendingVendedorCodigo = '';
    var pendingBtn = null;
    var pendingKind = 'user';

    function closeModal() {
      if (modal) modal.hidden = true;
      pendingNit = '';
      pendingNombre = '';
      pendingOrigen = '';
      pendingVendedorCodigo = '';
      pendingBtn = null;
      pendingKind = 'user';
    }

    function openModal(opts) {
      opts = opts || {};
      pendingKind = opts.kind || 'user';
      pendingNit = opts.nit || '';
      pendingNombre = opts.nombre || '';
      pendingOrigen = opts.origen || '';
      pendingVendedorCodigo = opts.vendedorCodigo || '';
      pendingBtn = opts.btn || null;
      if (modalTitle) {
        modalTitle.textContent = pendingKind === 'sin_vendedor'
          ? 'Eliminar de “Asignar vendedor”'
          : 'Eliminar cliente';
      }
      if (modalText) {
        if (pendingKind === 'sin_vendedor') {
          var label = pendingNombre || pendingNit;
          var isSelf = pendingNit === String((window.IZCAuth && IZCAuth.getSessionNit && IZCAuth.getSessionNit()) || '');
          modalText.textContent = isSelf
            ? ('¿Eliminar a "' + label + '" de la lista? Se borrarán sus cotizaciones sin vendedor (tu cuenta admin no se elimina).')
            : ('¿Eliminar a "' + label + '" de la lista? Se borrarán sus cotizaciones sin vendedor y su cuenta portal si existe.');
        } else {
          modalText.textContent = '¿Quieres eliminar el cliente con NIT ' + pendingNit + '?';
        }
      }
      if (modal) modal.hidden = false;
      if (confirmBtn) confirmBtn.focus();
    }

    window.__IZCAdminOpenDeleteModal = openModal;

    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target.closest('[data-modal-close]')) closeModal();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.hidden) closeModal();
    });

    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        var nit = pendingNit;
        var nombre = pendingNombre;
        var origen = pendingOrigen;
        var vendedorCodigo = pendingVendedorCodigo;
        var btn = pendingBtn;
        var kind = pendingKind;
        closeModal();
        if (!nit || !window.IZCAuth) return;
        if (kind === 'sin_vendedor') {
          runDeleteClienteSinVendedor(nit, nombre);
          return;
        }
        if (btn) btn.disabled = true;
        IZCAuth.deleteUserForAdmin(nit, { origen: origen, vendedor_codigo: vendedorCodigo }).then(function (data) {
          if (!data.ok) {
            setMessage('adminMessage', data.error || 'No se pudo eliminar.', 'error');
            if (btn) btn.disabled = false;
            return;
          }
          setMessage('adminMessage', data.message || 'Cliente eliminado.', 'ok');
          if (window.IZCLiveSync) IZCLiveSync.emit(IZCLiveSync.TYPES.USERS);
          loadUsers({ silent: true });
        }).catch(function (err) {
          console.error(err);
          setMessage('adminMessage', 'Error al eliminar.', 'error');
          if (btn) btn.disabled = false;
        });
      });
    }

    if (!body) return;
    body.addEventListener('click', function (e) {
      var btn = e.target.closest('.admin-delete');
      if (!btn || !window.IZCAuth) return;
      if (btn.classList.contains('admin-dismiss-sin-vendedor')) return;
      var nit = btn.getAttribute('data-nit') || '';
      if (!nit) return;
      openModal({
        kind: 'user',
        nit: nit,
        origen: btn.getAttribute('data-origen') || '',
        vendedorCodigo: btn.getAttribute('data-vendedor-codigo') || '',
        btn: btn
      });
    });
  }

  function runDeleteClienteSinVendedor(nit, nombre) {
    if (!window.IZCAuth || !IZCAuth.getSessionNit) return;
    nit = String(nit || '').trim();
    if (!nit) {
      setMessage('adminMessage', 'NIT inválido.', 'error');
      return;
    }
    setMessage('adminMessage', 'Eliminando…', '');
    postAdminApi({
      action: 'delete_cliente_sin_vendedor',
      admin_nit: IZCAuth.getSessionNit(),
      client_nit: nit
    }).then(function (data) {
      if (!data || !data.ok) {
        var err = String((data && data.error) || 'No se pudo eliminar.');
        if (/accion no valida|acción no válida|invalid action/i.test(err)) {
          err = 'El servidor no tiene la acción nueva. Sube api/auth.php + api/admin_assign_vendedor.php.';
        }
        setMessage('adminMessage', err, 'error');
        return;
      }
      if (Array.isArray(data.clients)) {
        renderClientesSinVendedor(data.clients);
      } else {
        asignarCache = (asignarCache || []).filter(function (c) {
          return String((c && c.nit) || '') !== nit;
        });
        renderClientesSinVendedor(asignarCache);
        loadClientesSinVendedor({ silent: true });
      }
      setMessage('adminMessage', data.message || 'Cliente eliminado de la lista.', 'ok');
    }).catch(function () {
      setMessage('adminMessage', 'Error al eliminar. Revisa api/admin_assign_vendedor.php en el hosting.', 'error');
    });
  }

  function deleteClienteSinVendedor(nit, nombre) {
    nit = String(nit || '').trim();
    if (!nit) {
      setMessage('adminMessage', 'NIT inválido.', 'error');
      return;
    }
    if (typeof window.__IZCAdminOpenDeleteModal === 'function') {
      window.__IZCAdminOpenDeleteModal({
        kind: 'sin_vendedor',
        nit: nit,
        nombre: String(nombre || '').trim()
      });
      return;
    }
    runDeleteClienteSinVendedor(nit, nombre);
  }

  function bindAsignarPanel() {
    var body = document.getElementById('adminAsignarBody');
    if (!body || body.__izcAsignarBound) return;
    body.__izcAsignarBound = true;
    body.addEventListener('click', function (e) {
      var dismiss = e.target.closest('.admin-dismiss-sin-vendedor');
      if (dismiss) {
        deleteClienteSinVendedor(
          dismiss.getAttribute('data-nit') || '',
          dismiss.getAttribute('data-nombre') || ''
        );
        return;
      }
      var btn = e.target.closest('.admin-assign-btn');
      if (!btn) return;
      var nit = btn.getAttribute('data-nit') || '';
      var nombre = btn.getAttribute('data-nombre') || '';
      var row = btn.closest('tr');
      var select = row ? row.querySelector('select.admin-assign-select') : null;
      var seller = select ? String(select.value || '').trim() : '';
      assignVendedorCliente(nit, seller, nombre);
    });
  }

  function bindLogout() {
    var btn = document.getElementById('profileLogout');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (window.IZCAuth && IZCAuth.logout) IZCAuth.logout({ redirect: 'login.html' });
      else window.location.replace('login.html');
    });
  }

  function init() {
    bindLogout();
    bindNombreEdit();
    bindTable();
    bindTabs();
    bindAsignarPanel();
    if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.loadNameMaps === 'function') {
      IZCCotizacionPdf.loadNameMaps().catch(function () { /* ignore */ });
    }
    var refresh = document.getElementById('adminRefresh');
    if (refresh) refresh.addEventListener('click', function () {
      if (activeTab === 'quotes' || activeTab === 'quotes-client') loadQuotes({ syncBitrix: true });
      else if (activeTab === 'users' || activeTab === 'users-all') loadUsers();
      else if (activeTab === 'asesores') loadAsesores();
      else if (activeTab === 'precios') loadPreciosPanel();
      else if (activeTab === 'productos') loadProductosCreados();
      else if (activeTab === 'asignar') {
        loadAsesores({ silent: true }).then(function () {
          return loadClientesSinVendedor();
        });
      }
      else {
        loadUsers();
        loadAsesores({ silent: true });
        loadQuotes({ silent: true });
        loadProductosCreados({ silent: true });
        loadClientesSinVendedor({ silent: true });
      }
    });
    document.addEventListener('izc:auth-changed', function () {
      if (!fillProfile()) return;
      loadAsesores({ silent: true });
      loadQuotes({ silent: true });
      loadTrmPanel();
    });

    var ready = (window.IZCAuth && IZCAuth.whenSessionReady)
      ? IZCAuth.whenSessionReady()
      : Promise.resolve();

    ready.then(function () {
      if (!fillProfile()) return;
      restoreAdminSnapshot();
      clearAsesorForm();
      window.setTimeout(clearAsesorForm, 100);
      window.setTimeout(clearAsesorForm, 500);
      setActiveTab('users');
      loadAsesores({ silent: true });
      loadQuotes({ silent: true });
      loadProductosCreados({ silent: true });
      loadClientesSinVendedor({ silent: true });
      loadTrmPanel();
      loadBitrixPanel();
      startAdminLiveSync();
    }).catch(function () {
      if (!fillProfile()) return;
      setActiveTab('users');
      loadAsesores({ silent: true });
      loadProductosCreados({ silent: true });
      loadClientesSinVendedor({ silent: true });
      loadTrmPanel();
      loadBitrixPanel();
      startAdminLiveSync();
    });
  }

  function isTypingInAdmin() {
    var ae = document.activeElement;
    if (!ae || ae === document.body) return false;
    var tag = String(ae.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') {
      var type = String(ae.type || 'text').toLowerCase();
      return type === 'text' || type === 'password' || type === 'search' || type === 'number' || type === 'tel' || type === '';
    }
    return !!ae.isContentEditable;
  }

  function startAdminLiveSync() {
    if (!window.IZCLiveSync || typeof IZCLiveSync.startPoll !== 'function') return;
    if (window.__IZC_ADMIN_LIVE__) return;
    window.__IZC_ADMIN_LIVE__ = true;
    IZCLiveSync.startPoll(function (reason) {
      if (isTypingInAdmin() && reason === 'interval') return Promise.resolve();
      var jobs = [
        loadUsers({ silent: true }),
        loadQuotes({ silent: true }),
        loadAsesores({ silent: true }),
        loadTrmPanel()
      ];
      return Promise.all(jobs);
    }, 10000, {
      types: [
        IZCLiveSync.TYPES.ALL,
        IZCLiveSync.TYPES.QUOTES,
        IZCLiveSync.TYPES.USERS,
        IZCLiveSync.TYPES.CLIENTS,
        IZCLiveSync.TYPES.ASESORES,
        IZCLiveSync.TYPES.TRM
      ]
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
