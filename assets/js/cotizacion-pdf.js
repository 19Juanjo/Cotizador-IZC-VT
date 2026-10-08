/* Genera PDF (imprimir / guardar) de cotización IZC o VALTECH para asesores. */
(function (global) {
  'use strict';

  var IZC_SENDER = {
    brand: 'IZC MAYORISTA',
    enviadaPorLabel: 'ENVIADA POR',
    nit: '800153963',
    web: 'HTTPS://IZC.COM.CO/',
    address: 'Av Calle 80 - K.m 1.7 vía Siberia Terrapuerto - Bodega 20',
    phone: '',
    logo: 'assets/logo/logoizc.png'
  };

  var VALTECH_SENDER = {
    brand: 'VALTECH',
    enviadaPorLabel: 'ENVIADA POR:',
    nit: '800153963',
    web: '',
    address: 'CL 30 66 25, Armenia - Quindío',
    phone: '',
    logo: 'assets/logo/valtech.png'
  };

  var DISTRIBUIDOR_URL = 'https://izc.com.co/inscripcion-distribuidor';
  var ACTUALIZACION_DATOS_URL = 'https://izc.com.co/actualizacion-datos';
  var PSE_URL = 'https://izc.com.co/pagos';
  var DEVOLUCION_DINERO_URL = 'https://izc.com.co/politica-devolucion-dinero-izc';
  var GARANTIA_URL = 'https://izc.com.co/politicas-de-garantia';
  var MERCADEO_URL = 'https://izc.com.co/material-de-mercadeo';

  /** Enlaces de políticas / trámites según empresa del PDF (VALTECH → satpcs.com). */
  function resolvePolicyUrls(isValtech) {
    if (!isValtech) {
      return {
        distribuidor: DISTRIBUIDOR_URL,
        actualizacionDatos: ACTUALIZACION_DATOS_URL,
        pse: PSE_URL,
        devolucionDinero: DEVOLUCION_DINERO_URL,
        garantia: GARANTIA_URL,
        mercadeo: MERCADEO_URL
      };
    }
    return {
      distribuidor: 'https://satpcs.com/distribuidores',
      // No hay equivalente claro en satpcs → se mantiene IZC.
      actualizacionDatos: ACTUALIZACION_DATOS_URL,
      pse: 'https://valtechmayorista.com:8012/PortalRecaudo/',
      // No hay página dedicada de devolución de dinero → se mantiene IZC.
      devolucionDinero: DEVOLUCION_DINERO_URL,
      garantia: 'https://satpcs.com/sp/politica-de-garantia/',
      mercadeo: 'https://satpcs.com/descargas'
    };
  }

  var IVA = 0.19;
  var defaultTrmCache = 0;
  var defaultTrmPromise = null;

  function siteBasePathPdf() {
    try {
      var path = String(location.pathname || '/');
      var i = path.lastIndexOf('/');
      return i < 0 ? '/' : path.slice(0, i + 1);
    } catch (e) {
      return '/';
    }
  }

  function normalizeNitKey(nit) {
    var s = String(nit || '').replace(/[\s.]/g, '').trim();
    s = s.replace(/-\d$/, '');
    return s.replace(/\D/g, '');
  }

  var clientContactByNitCache = Object
  var clientContactMapsPromise = null;

  function lookupClientContactCache(nit) {
    var key = normalizeNitKey(nit);
    if (!key) return { telefono: '', direccion: '' };
    var hit = clientContactByNitCache[key];
    if (hit) return hit;
    var noZeros = key.replace(/^0+/, '');
    if (noZeros && clientContactByNitCache[noZeros]) return clientContactByNitCache[noZeros];
    return { telefono: '', direccion: '' };
  }

  function rememberClientContact(nit, telefono, direccion) {
    var key = normalizeNitKey(nit);
    if (!key) return { telefono: '', direccion: '' };
    var prev = clientContactByNitCache[key] || { telefono: '', direccion: '' };
    var next = {
      telefono: String(telefono || prev.telefono || '').trim(),
      direccion: String(direccion || prev.direccion || '').trim()
    };
    clientContactByNitCache[key] = next;
    return next;
  }

  function ingestContactRows(rows, field) {
    if (!Array.isArray(rows)) return;
    rows.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var nit = normalizeNitKey(row.nit);
      if (!nit) return;
      var val = String(row[field] || '').trim();
      if (!val) return;
      if (field === 'telefono') rememberClientContact(nit, val, '');
      else rememberClientContact(nit, '', val);
    });
  }

  function loadClientContactMaps() {
    if (clientContactMapsPromise) return clientContactMapsPromise;
    var base = siteBasePathPdf();
    clientContactMapsPromise = Promise.all([
      fetch(base + 'data/nit_telefonos.json', { cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; }),
      fetch(base + 'data/nit_direcciones.json', { cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; })
    ]).then(function (parts) {
      ingestContactRows(parts[0], 'telefono');
      ingestContactRows(parts[1], 'direccion');
      return true;
    }).catch(function () {
      return false;
    });
    return clientContactMapsPromise;
  }

  function resolveClientContactForPdf(nit) {
    var key = normalizeNitKey(nit);
    if (!key) return Promise.resolve({ telefono: '', direccion: '' });
    var cached = lookupClientContactCache(key);
    if (cached.telefono && cached.direccion) {
      return Promise.resolve(cached);
    }
    return loadClientContactMaps().then(function () {
      var fromFiles = lookupClientContactCache(key);
      if (fromFiles.telefono && fromFiles.direccion) {
        return fromFiles;
      }
      if (fromFiles.telefono || fromFiles.direccion) {
        // Completar el faltante vía API
        return fetch(siteBasePathPdf() + 'api/auth.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resolve_cliente_pdf_contacto', nit: key }),
          cache: 'no-store'
        }).then(function (r) {
          return r.ok ? r.json() : null;
        }).then(function (data) {
          if (!data || !data.ok) return fromFiles;
          return rememberClientContact(
            key,
            data.telefono || fromFiles.telefono,
            data.direccion || fromFiles.direccion
          );
        }).catch(function () {
          return fromFiles;
        });
      }
      return fetch(siteBasePathPdf() + 'api/auth.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve_cliente_pdf_contacto', nit: key }),
        cache: 'no-store'
      }).then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (data) {
        if (!data || !data.ok) return fromFiles;
        return rememberClientContact(key, data.telefono, data.direccion);
      }).catch(function () {
        return fromFiles;
      });
    });
  }

  function loadDefaultTrm(force) {
    if (force) {
      defaultTrmCache = 0;
      defaultTrmPromise = null;
    }
    if (!force && defaultTrmCache > 0) return Promise.resolve(defaultTrmCache);
    if (defaultTrmPromise) return defaultTrmPromise;
    defaultTrmPromise = fetch(siteBasePathPdf() + 'data/trm.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('trm');
      return r.json();
    }).then(function (data) {
      var v = Number(data && data.value);
      if (isFinite(v) && v > 0) defaultTrmCache = v;
      return defaultTrmCache;
    }).catch(function () {
      if (window.IZCAuth && typeof IZCAuth.postApi === 'function') {
        return IZCAuth.postApi({ action: 'get_trm' }).then(function (data) {
          var v = data && data.ok ? Number(data.value) : NaN;
          if (isFinite(v) && v > 0) defaultTrmCache = v;
          return defaultTrmCache;
        }).catch(function () { return 0; });
      }
      return 0;
    });
    return defaultTrmPromise;
  }

  function resolveQuoteTrm(quote) {
    var t = Number(quote && quote.trm);
    if (isFinite(t) && t > 0) return t;
    return defaultTrmCache > 0 ? defaultTrmCache : 0;
  }

  function resolveQuoteEmpresa(quote, extras) {
    extras = extras || {};
    var fromExtra = String(extras.empresa == null ? '' : extras.empresa).trim();
    if (fromExtra) return fromExtra;
    if (quote && /VALTECH/i.test(String(quote.seller_name || ''))) return 'VALTECH MAYORISTA S.A.S.';
    var raw = String(
      (quote && quote.empresa) ||
      (quote && quote.totals && quote.totals.empresa) ||
      ''
    ).trim();
    if (/VALTECH/i.test(raw)) return 'VALTECH MAYORISTA S.A.S.';
    if (/IZC/i.test(raw)) return 'IZC MAYORISTA S.A.S.';
    return 'IZC MAYORISTA S.A.S.';
  }

  var UVT_2026 = 52374;
  var UVT_EXENTO_MAX = UVT_2026 * 50;

  function isAioEquipment(name, sku) {
    var s = (String(name || '') + ' ' + String(sku || '')).toUpperCase();
    if (!s.trim()) return false;
    if (/RIBBON|CINTA|TONER|CARTUCHO|CABLE|ROLLO|ETIQUETA|LABEL|LECTOR|SCANNER|ESCANER|ESCÁNER|HUELLA/.test(s)) {
      return false;
    }
    return /(?:^|[^A-Z0-9])AIO(?:[^A-Z]|$)/.test(s) || /ALL\s*[- ]?\s*IN\s*[- ]?\s*ONE/.test(s) || /TODO\s*EN\s*UNO/.test(s);
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

  /** Solo AIO / verificador SAT con unitario ≤ umbral UVT quedan sin IVA. */
  function isIvaExemptUnit(unitCopSinIva, name, sku) {
    var u = Number(unitCopSinIva);
    if (!isFinite(u) || u <= 0) return false;
    if (!isUvtExemptEligibleEquipment(name, sku)) return false;
    return !exceedsUvtThreshold(u);
  }

  /** IVA unitario COP; misma regla Excel ROUNDDOWN(sin×1.19,0) − sin. */
  function ivaUnitAmountCop(unitSinIva, copIvaStored) {
    if (!isFinite(unitSinIva) || unitSinIva <= 0) return 0;
    var stored = Number(copIvaStored);
    if (isFinite(stored) && stored > 0) {
      var diff = Math.max(0, Math.round(stored) - Math.round(unitSinIva));
      // copIva guardado = precio con IVA → diferencia es el IVA unitario.
      if (diff > unitSinIva * 0.05) return diff;
    }
    var withIva = Math.floor(unitSinIva * (1 + IVA) + 1e-9);
    return Math.max(0, withIva - Math.round(unitSinIva));
  }

  function lineIsIvaExempt(line, unitSinIva, name, sku) {
    var src = String((line && (line.priceEditSource || line.price_edit_source)) || '').toLowerCase();
    if (src === 'copiva') return false;
    if (line && line.ivaExempt === true) return true;
    return isIvaExemptUnit(unitSinIva, name, sku);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isValtechEmpresa(empresa) {
    return /VALTECH/i.test(String(empresa || ''));
  }

  function resolveSender(empresa) {
    return isValtechEmpresa(empresa) ? VALTECH_SENDER : IZC_SENDER;
  }

  function formatMoney(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return x.toLocaleString('en-US', {
      minimumFractionDigits: x % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    });
  }

  function formatUsd(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    if (window.IZCMoney && typeof IZCMoney.roundUsd === 'function') {
      x = IZCMoney.roundUsd(x);
    } else {
      var sign = x < 0 ? -1 : 1;
      var scaled = Math.abs(x) * 100;
      var nearest = Math.round(scaled);
      if (Math.abs(scaled - nearest) < 1e-7) scaled = nearest;
      x = sign * Math.floor(scaled) / 100;
    }
    return (
      'USD ' +
      x.toLocaleString('es-CO', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    );
  }

  /** Solo número USD (tabla PDF: una línea, sin prefijo). */
  function formatUsdAmount(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    if (window.IZCMoney && typeof IZCMoney.roundUsd === 'function') {
      x = IZCMoney.roundUsd(x);
    } else {
      var sign = x < 0 ? -1 : 1;
      var scaled = Math.abs(x) * 100;
      var nearest = Math.round(scaled);
      if (Math.abs(scaled - nearest) < 1e-7) scaled = nearest;
      x = sign * Math.floor(scaled) / 100;
    }
    return x.toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /** Pesos colombianos. Sin sufijo COP: las columnas ya dicen COP. */
  function formatPesos(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return (
      '$\u00A0' +
      x.toLocaleString('es-CO', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    );
  }

  /** Solo número COP (tabla PDF: una línea, sin $ ni COP). */
  function formatPesosAmount(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return x.toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
     
  /**
   * Garantiza que un monto de flete esté en COP.
   * Si llegó guardado en USD (valor típico bajo) y hay TRM, convierte a pesos.
   * No usar para el IVA del flete: el 19 % de $23.000 es ~$4.370 y se confundía con USD.
   */
  function fleteAmountToPesos(amount, quote, subtotalCop) {
    var n = Number(amount);
    if (!isFinite(n) || n < 0) return 0;
    var trm = Number(quote && quote.trm);
    if (!isFinite(trm) || trm <= 0) trm = 0;
    var sub = Number(subtotalCop);
    if (!isFinite(sub) || sub < 0) sub = 0;
    // Heurística: flete en USD suele ser < 5.000; TCC en COP es 23.000.
    if (trm > 1000 && n > 0 && n < 5000 && (sub >= 20000 || n * trm >= 15000)) {
      return n * trm;
    }
    return n;
  }

  /** IVA del flete en COP = 19 % de la base ya convertida. Nunca multiplicar el IVA por TRM. */
  function fleteIvaToPesos(fleteIvaRaw, fleteAntesCop, quote) {
    var base = Number(fleteAntesCop);
    if (!isFinite(base) || base <= 0) return 0;
    var expected = base * 0.19;
    var iva = Number(fleteIvaRaw);
    if (!isFinite(iva) || iva < 0) return expected;
    // Ya es ~19 % de la base en COP.
    if (Math.abs(iva - expected) <= Math.max(2, expected * 0.08)) {
      return iva;
    }
    // Valor absurdo (p. ej. $4.370 COP tratados como USD × TRM).
    if (iva > base * 0.45) {
      return expected;
    }
    var trm = Number(quote && quote.trm);
    if (isFinite(trm) && trm > 1000 && iva > 0 && iva < 5000) {
      var asCopFromUsd = iva * trm;
      // Si convertido se parece al 19 %, el guardado ya era COP; no convertir.
      if (Math.abs(asCopFromUsd - expected) / expected > 0.25 && Math.abs(iva - expected) / expected < 0.25) {
        return iva;
      }
      if (asCopFromUsd > base * 0.45) {
        return expected;
      }
    }
    return expected;
  }
  
  function absolutize(path) {
    var p = String(path || '');
    if (!p) return '';
    if (/^https?:\/\//i.test(p) || /^data:/i.test(p)) return p;
    try {
      return new URL(p, location.href).href;
    } catch (e) {
      return p;
    }
  }

  /** URL absoluta para anotaciones de enlace en el PDF (lectores no resuelven relativas). */
  function pdfLinkUrl(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    try {
      return new URL(u, window.location.href).href;
    } catch (e) {
      return u;
    }
  }

  function pdfAddLink(doc, x, y, w, h, url) {
    var href = pdfLinkUrl(url);
    if (!doc || !href) return;
    try {
      doc.link(x, y, Math.max(Number(w) || 0, 4), Math.max(Number(h) || 0, 4), { url: href });
    } catch (eLink) { /* ignore */ }
  }

  /** Cache de logos embebidos en el PDF nativo (data URL + tamaño). */
  var logoDataCache = {};

  function loadLogoDataUrl(path) {
    var url = absolutize(path);
    if (!url) return Promise.resolve(null);
    if (logoDataCache[url]) return Promise.resolve(logoDataCache[url]);
    return new Promise(function (resolve) {
      var done = false;
      function finish(val) {
        if (done) return;
        done = true;
        resolve(val);
      }
      var timer = setTimeout(function () { finish(null); }, 1200);
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          var w = Math.max(1, img.naturalWidth || img.width || 1);
          var h = Math.max(1, img.naturalHeight || img.height || 1);
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          var entry = {
            dataUrl: canvas.toDataURL('image/png'),
            w: w,
            h: h
          };
          logoDataCache[url] = entry;
          clearTimeout(timer);
          finish(entry);
        } catch (eCanvas) {
          clearTimeout(timer);
          finish(null);
        }
      };
      img.onerror = function () {
        clearTimeout(timer);
        finish(null);
      };
      try {
        img.src = url;
      } catch (eSrc) {
        clearTimeout(timer);
        finish(null);
      }
    });
  }

  function lineUnitPrice(line, trm) {
    return lineUnitCopSinIva(line, trm);
  }

  /**
   * USD y COP siempre con la misma TRM. El valor mostrado en USD (2 decimales)
   * es el que se multiplica para el peso.
   */
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
      var scaled = Math.abs(v) * 100;
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

  function lineNameForCopCheck(line) {
    return String((line && (line.name || line.nombre || line.descripcion || '')) || '');
  }

  function lineIsCopPriced(line) {
    if (!line || typeof line !== 'object') return false;
    if (String(line.currency || '').toUpperCase() === 'COP') return true;
    var usdFlag = Number(line.usdList != null ? line.usdList : (line.unitarioUsd != null ? line.unitarioUsd : line.usd));
    var copVal = Number(line.listPesos != null ? line.listPesos : (line.copSinIva != null ? line.copSinIva : line.cop));
    if (isFinite(usdFlag) && usdFlag > 0 && usdFlag <= 0.10 && isFinite(copVal) && copVal > 1) return true;
    var n = lineNameForCopCheck(line).toLowerCase();
    try { n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (eN) { /* ignore */ }
    if (/impresora|printer|\baio\b|verificador|lector|scanner|escaner/.test(n)) return false;
    if (n.indexOf('etiqueta') >= 0) return true;
    if (n.indexOf('ribbon') >= 0) return !/rodamiento|tensor|pinon|eje|soporte|guia|sensor/.test(n);
    if (n.indexOf('cinta') >= 0 && /cera|resina|wax|ribbon|transferencia/.test(n)) return true;
    if (n.indexOf('rollo') >= 0) return !/impresora|printer|soporte|motor|eje|sensor|rodillo/.test(n);
    return false;
  }

  function lineUnitCopSinIva(line, trm) {
    var qty = Math.max(1, Math.floor(Number(line.qty) || 1));
    var manualPrice = !!(line.priceModified || line.usdOverride != null || line.copOverride != null ||
      line.copIvaOverride != null || line.priceEditSource);
    var rawUsd = line.unitarioUsd != null ? line.unitarioUsd : line.usd;
    if (!manualPrice && line.usdList != null && isFinite(Number(line.usdList)) && Number(line.usdList) > 0.10) {
      rawUsd = Number(line.usdList);
    }
    if (manualPrice && line.usdOverride != null && isFinite(Number(line.usdOverride)) && Number(line.usdOverride) > 0) {
      rawUsd = Number(line.usdOverride);
    }
    if (isFinite(Number(rawUsd)) && Number(rawUsd) > 0 && Number(rawUsd) <= 0.10) rawUsd = NaN;
    var copPriced = lineIsCopPriced(line);
    var rawCop = null;
    var rate = Number(trm);
    if (!isFinite(rate) || rate <= 0) rate = 0;
    if (manualPrice && line.copOverride != null && isFinite(Number(line.copOverride)) && Number(line.copOverride) > 0) {
      rawCop = Number(line.copOverride);
    } else if (manualPrice && line.unitarioCop != null && isFinite(Number(line.unitarioCop)) && Number(line.unitarioCop) > 0) {
      rawCop = Number(line.unitarioCop);
    } else if (manualPrice && line.copSinIva != null && isFinite(Number(line.copSinIva)) && Number(line.copSinIva) > 0) {
      rawCop = Number(line.copSinIva);
    } else if (!manualPrice && line.listPesos != null && isFinite(Number(line.listPesos)) && Number(line.listPesos) > 0) {
      var lp = Number(line.listPesos);
      // Con USD de lista real, el peso visible es USD×TRM. Etiquetas/COP: usar PESOS.
      if (!copPriced && isFinite(rawUsd) && rawUsd > 0 && rawUsd < 5000 && rate > 1000) {
        rawCop = NaN;
      } else {
        rawCop = lp;
      }
    } else if (line.copSinIva != null && isFinite(Number(line.copSinIva)) && Number(line.copSinIva) > 0) {
      rawCop = Number(line.copSinIva);
    } else if (line.unitarioCop != null && isFinite(Number(line.unitarioCop)) && Number(line.unitarioCop) > 0) {
      rawCop = Number(line.unitarioCop);
    } else if (line.cop != null && isFinite(Number(line.cop)) && Number(line.cop) > 0) {
      rawCop = Number(line.cop);
    } else if (line.totalCop != null && isFinite(Number(line.totalCop))) {
      rawCop = Number(line.totalCop) / qty;
    } else if (line.totalSinFlete != null && isFinite(Number(line.totalSinFlete))) {
      // totalSinFlete a veces trae IVA; solo fallback.
      rawCop = Number(line.totalSinFlete) / qty;
    } else if (line.copIva != null && isFinite(Number(line.copIva)) && Number(line.copIva) > 0) {
      rawCop = Number(line.copIva) / (1 + IVA);
    } else if (line.totalCopIva != null && isFinite(Number(line.totalCopIva))) {
      rawCop = Number(line.totalCopIva) / qty / (1 + IVA);
    }

    var prefer = (copPriced || (manualPrice && (
      (line.priceEditSource === 'cop' || line.priceEditSource === 'copiva') ||
      (line.copOverride != null && Number(line.copOverride) > 0 && !(Number(line.usdOverride) > 0))
    ))) ? 'cop' : 'usd';
    var pair = sanitizeUsdCopPair(rawUsd, rawCop, trm, prefer);
    if (pair.cop > 0) return pair.cop;

    if (trm > 0 && line.usdIva != null && isFinite(Number(line.usdIva)) && Number(line.usdIva) > 0) {
      var fromUsdIva = sanitizeUsdCopPair(Number(line.usdIva) / (1 + IVA), NaN, trm);
      if (fromUsdIva.cop > 0) return fromUsdIva.cop;
      return (Number(line.usdIva) / (1 + IVA)) * trm;
    }
    if (trm > 0 && pair.usd > 0 && pair.usd < 5000) {
      return pair.usd * trm;
    }
    if (trm > 0 && line.usd != null && isFinite(Number(line.usd))) {
      var only = sanitizeUsdCopPair(line.usd, NaN, trm);
      return only.cop > 0 ? only.cop : Number(line.usd) * trm;
    }
    return 0;
  }

  function lineUnitIvaCop(line, trm, maps) {
    var qty = Math.max(1, Math.floor(Number(line.qty) || 1));
    var unitSinIva = lineUnitCopSinIva(line, trm);
    if (!isFinite(unitSinIva) || unitSinIva <= 0) return 0;

    var name = resolveProductName(line, maps);
    if (lineIsIvaExempt(line, unitSinIva, name, line.sku, qty)) return 0;
    return ivaUnitAmountCop(unitSinIva, line.copIva);
  }

  function lineTotalCopPayable(line, trm, maps) {
    var qty = Math.max(1, Math.floor(Number(line.qty) || 1));
    var unit = lineUnitCopSinIva(line, trm);
    var totalSinIva = unit * qty;
    var name = resolveProductName(line, maps);
    if (lineIsIvaExempt(line, unit, name, line.sku, qty)) return totalSinIva;

    var ivaUnit = ivaUnitAmountCop(unit, null);
    return totalSinIva + ivaUnit * qty;
  }

  function lineUnitUsd(line, trm) {
    var qty = Math.max(1, Math.floor(Number(line.qty) || 1));
    var rate = Number(trm);
    if (!isFinite(rate) || rate <= 0) rate = 0;

    var manualPrice = !!(line.priceModified || line.usdOverride != null || line.copOverride != null ||
      line.copIvaOverride != null || line.priceEditSource);

    // Precio editado por el asesor: unitario guardado manda (no usdList de la LP).
    if (manualPrice) {
      var manualUsd = NaN;
      if (line.usdOverride != null && isFinite(Number(line.usdOverride)) && Number(line.usdOverride) > 0) {
        manualUsd = Number(line.usdOverride);
      } else if (line.unitarioUsd != null && isFinite(Number(line.unitarioUsd)) && Number(line.unitarioUsd) > 0) {
        manualUsd = Number(line.unitarioUsd);
      } else if (line.usd != null && isFinite(Number(line.usd)) && Number(line.usd) > 0) {
        manualUsd = Number(line.usd);
      } else if (line.usdIva != null && isFinite(Number(line.usdIva)) && Number(line.usdIva) > 0) {
        manualUsd = Number(line.usdIva) / (1 + IVA);
      }
      var src = String(line.priceEditSource || '').toLowerCase();
      if (src !== 'cop' && src !== 'copiva' && isFinite(manualUsd) && manualUsd > 0) {
        return sanitizeUsdCopPair(manualUsd, NaN, trm, 'usd').usd;
      }
    }

    // Preferir USD de lista (columna dólar de la LP), redondeado igual que se muestra.
    if (line.usdList != null && isFinite(Number(line.usdList)) && Number(line.usdList) > 0.10 && !manualPrice && !lineIsCopPriced(line)) {
      return sanitizeUsdCopPair(Number(line.usdList), NaN, trm, 'usd').usd;
    }

    var rawUsd = line.unitarioUsd != null ? line.unitarioUsd : line.usd;
    var rawCop = null;
    if (!line.priceModified && line.listPesos != null && isFinite(Number(line.listPesos)) && Number(line.listPesos) > 0) {
      rawCop = Number(line.listPesos);
    } else if (line.unitarioCop != null && isFinite(Number(line.unitarioCop)) && Number(line.unitarioCop) > 0) {
      rawCop = Number(line.unitarioCop);
    } else if (line.copSinIva != null && isFinite(Number(line.copSinIva)) && Number(line.copSinIva) > 0) {
      rawCop = Number(line.copSinIva);
    } else if (line.cop != null && isFinite(Number(line.cop)) && Number(line.cop) > 0) {
      rawCop = Number(line.cop);
    }

    var preferUsd = !(lineIsCopPriced(line) || (manualPrice && (
      line.priceEditSource === 'cop' || line.priceEditSource === 'copiva'
    )));
    var pair = sanitizeUsdCopPair(rawUsd, rawCop, trm, preferUsd ? 'usd' : 'cop');
    if (pair.usd > 0) return pair.usd;

    if (line.usdIva != null && isFinite(Number(line.usdIva)) && Number(line.usdIva) > 0) {
      var u = Number(line.usdIva) / (1 + IVA);
      return sanitizeUsdCopPair(u, rawCop, trm).usd || u;
    }
    if (line.totalUsdIva != null && isFinite(Number(line.totalUsdIva))) {
      var u2 = Number(line.totalUsdIva) / qty / (1 + IVA);
      return sanitizeUsdCopPair(u2, rawCop, trm).usd || u2;
    }
    var cop = lineUnitPrice(line, trm);
    if (trm > 0 && cop > 0) return cop / trm;
    return 0;
  }

  function lineTotal(line, unit) {
    var qty = Math.max(1, Math.floor(Number(line.qty) || 1));
    // Preferir unit × qty (ya saneado); totalCop guardado puede estar inflado.
    return unit * qty;
  }

  function lineTotalUsd(line, unitUsd) {
    var qty = Math.max(1, Math.floor(Number(line.qty) || 1));
    return unitUsd * qty;
  }

  function isPlaceholderProductName(name, sku) {
    var n = String(name || '').trim();
    if (!n || n === '—' || n === '-' || n === '–') return true;
    if (/productos\s+cotizados/i.test(n)) return true;
    if (/^bitrix\s*#\d+$/i.test(n)) return true;
    var s = String(sku || '').trim();
    if (s && n.toUpperCase() === s.toUpperCase()) return true;
    if (s && (n === s + '—' || n === s + '-')) return true;
    return false;
  }

  function isPlaceholderReferencia(ref) {
    var r = String(ref || '').trim();
    if (!r) return true;
    if (/productos\s+cotizados/i.test(r)) return true;
    if (/^bitrix\s*#\d+$/i.test(r)) return true;
    return false;
  }

  function nameFromReferencia(sku, ref) {
    var s = String(sku || '').trim();
    var r = String(ref || '').trim();
    if (!r) return '';
    if (s && r.toUpperCase().indexOf(s.toUpperCase()) === 0) return r;
    return s ? (s + '-' + r) : r;
  }

  function lookupNameInMaps(sku, maps) {
    maps = maps || {};
    var productos = maps.productos || {};
    var referencias = maps.referencias || {};
    var s = String(sku || '').trim();
    if (!s) return '';
    if (productos[s]) return String(productos[s]);
    var noZeros = s.replace(/^0+/, '');
    if (noZeros && productos[noZeros]) return String(productos[noZeros]);
    var ref = referencias[s] || (noZeros ? referencias[noZeros] : '');
    if (ref) return nameFromReferencia(s, ref);
    return '';
  }

  function lookupReferenciaInMaps(sku, maps) {
    maps = maps || {};
    var referencias = maps.referencias || {};
    var s = String(sku || '').trim();
    if (!s) return '';
    if (referencias[s]) return String(referencias[s]);
    var noZeros = s.replace(/^0+/, '');
    if (noZeros && referencias[noZeros]) return String(referencias[noZeros]);
    return '';
  }

  function resolveReferencia(line, maps) {
    maps = maps || nameMapsCache || { productos: {}, referencias: {} };
    var stored = String((line && line.referencia) || '').trim();
    if (
      stored &&
      stored !== '—' &&
      !/^bitrix\s*#/i.test(stored) &&
      !/^productos\s+cotizados/i.test(stored)
    ) {
      return stored;
    }
    var fromMaps = lookupReferenciaInMaps((line && line.sku) || '', maps);
    if (fromMaps) return fromMaps;
    return stored || '—';
  }

  function resolveProductName(line, maps) {
    var sku = String((line && line.sku) || '').trim();
    var stored = String((line && (line.name || line.descripcion)) || '').trim();
    var ref = String((line && line.referencia) || '').trim();
    if (!isPlaceholderReferencia(ref) && isPlaceholderProductName(stored, sku)) {
      stored = ref;
    }
    if (/productos\s+cotizados/i.test(stored) && !isPlaceholderReferencia(ref)) {
      stored = ref;
    }
    if (!isPlaceholderProductName(stored, sku)) return stored;
    var fromMaps = lookupNameInMaps(sku, maps);
    if (fromMaps) return fromMaps;
    if (!isPlaceholderReferencia(ref)) return ref;
    return stored || sku || 'Producto';
  }

  /** SKU y nombre para tablas: sin SKU solo nombre; con SKU → "SKU - nombre". */
  function resolveLineDisplay(line, maps) {
    maps = maps || nameMapsCache || { productos: {}, referencias: {} };
    var sku = String((line && line.sku) || '').trim();
    var name = resolveProductName(line, maps);
    if (!sku) {
      return { sku: '—', name: name || 'Producto' };
    }
    if (name && name.toUpperCase().indexOf(sku.toUpperCase()) === 0) {
      return { sku: sku, name: name };
    }
    return { sku: sku, name: (name ? (sku + ' - ' + name) : sku) };
  }

  var nameMapsCache = null;
  var nameMapsPromise = null;
  var lpPriceMapsCache = null;
  var lpPriceMapsPromise = null;
  var catalogSkuSetCache = null;
  var catalogSkuSetPromise = null;

  function skuKeyPdf(sku) {
    return String(sku || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  function addSkuToSet(set, sku) {
    var k = skuKeyPdf(sku);
    if (!k) return;
    set[k] = true;
    var nz = k.replace(/^0+/, '');
    if (nz && nz !== k) set[nz] = true;
  }

  function loadCatalogSkuSet() {
    if (catalogSkuSetCache) return Promise.resolve(catalogSkuSetCache);
    if (catalogSkuSetPromise) return catalogSkuSetPromise;
    var base = siteBasePathPdf();
    function fetchJson(path) {
      if (window.IZCData && typeof window.IZCData.loadJson === 'function') {
        return window.IZCData.loadJson(path, { cache: 'force-cache' }).catch(function () { return null; });
      }
      return fetch(base + path, { cache: 'force-cache' }).then(function (r) {
        if (!r.ok) throw new Error('missing');
        return r.json();
      }).catch(function () { return null; });
    }
    var overlayReady = window.IZCZktecoOverlay && typeof IZCZktecoOverlay.load === 'function'
      ? IZCZktecoOverlay.load().catch(function () { return null; })
      : Promise.resolve(null);
    catalogSkuSetPromise = Promise.all([
      fetchJson('assets/files/catalogo.json'),
      fetchJson('assets/files/product_details.json'),
      overlayReady
    ]).then(function (parts) {
      var set = {};
      var catalog = parts[0] || {};
      ((catalog && catalog.products) || []).forEach(function (p) {
        if (p) addSkuToSet(set, p.sku);
      });
      var details = parts[1] && typeof parts[1] === 'object' ? parts[1] : {};
      Object.keys(details).forEach(function (k) { addSkuToSet(set, k); });
      if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.forEach === 'function') {
        IZCZktecoOverlay.forEach(function (p) {
          if (p) addSkuToSet(set, p.sku);
        });
      }
      catalogSkuSetCache = set;
      return set;
    }).catch(function () {
      catalogSkuSetCache = catalogSkuSetCache || {};
      return catalogSkuSetCache;
    });
    return catalogSkuSetPromise;
  }

  function catalogHasSku(sku) {
    var set = catalogSkuSetCache;
    var k = skuKeyPdf(sku);
    if (!k || !set) return false;
    if (set[k]) return true;
    var nz = k.replace(/^0+/, '');
    return !!(nz && set[nz]);
  }

  function productFichaPageUrl(sku, unitUsd) {
    var s = String(sku || '').trim();
    if (!s) return '';
    var url = absolutize('producto.html?sku=' + encodeURIComponent(s));
    var n = Number(unitUsd);
    if (isFinite(n) && n > 0) {
      if (window.IZCMoney && typeof IZCMoney.roundUsd === 'function') n = IZCMoney.roundUsd(n);
      else n = Math.round(n * 100) / 100;
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 'usd=' + encodeURIComponent(n.toFixed(2));
    }
    return url;
  }

  function fichaMissingHtml() {
    return '<span class="ficha-missing">Sin ficha Tecnica</span>';
  }

  function fichaCellHtml(sku, unitUsd) {
    var s = String(sku || '').trim();
    if (!s || s === '—' || !catalogHasSku(s)) return fichaMissingHtml();
    var url = productFichaPageUrl(s, unitUsd);
    if (!url) return fichaMissingHtml();
    return (
      '<a class="ficha-link" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">Ver ficha</a>'
    );
  }

  function loadProductNameMaps() {
    if (nameMapsCache) return Promise.resolve(nameMapsCache);
    if (nameMapsPromise) return nameMapsPromise;
    function fetchJson(path) {
      return fetch(path, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('missing');
        return r.json();
      }).catch(function () { return {}; });
    }
    var base = '';
    try {
      if (location.pathname) {
        var i = location.pathname.lastIndexOf('/');
        base = i < 0 ? '/' : location.pathname.slice(0, i + 1);
      }
    } catch (e) { /* ignore */ }
    nameMapsPromise = Promise.all([
      fetchJson(base + 'assets/files/productos.json'),
      fetchJson(base + 'assets/files/referencias.json')
    ]).then(function (parts) {
      nameMapsCache = { productos: parts[0] || {}, referencias: parts[1] || {} };
      return nameMapsCache;
    }).catch(function () {
      nameMapsCache = { productos: {}, referencias: {} };
      return nameMapsCache;
    });
    return nameMapsPromise;
  }

  function loadLpPriceMaps() {
    if (lpPriceMapsCache) return Promise.resolve(lpPriceMapsCache);
    if (lpPriceMapsPromise) return lpPriceMapsPromise;
    var base = siteBasePathPdf();
    lpPriceMapsPromise = fetch(base + 'assets/files/precios_lp_asesor.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('lp');
        return r.json();
      })
      .then(function (data) {
        lpPriceMapsCache = (data && data.by_list && typeof data.by_list === 'object') ? data.by_list : {};
        return lpPriceMapsCache;
      })
      .catch(function () {
        lpPriceMapsCache = {};
        return lpPriceMapsCache;
      });
    return lpPriceMapsPromise;
  }

  function normalizeLpIdPdf(lp) {
    var v = String(lp || '').trim().toLowerCase();
    if (!v) return '';
    if (v === 'lp volumen' || v === 'lp_volumen') return 'volumen';
    if (v === 'lp interna' || v === 'lp_interna') return 'interna';
    if (v === 'lp web' || v === 'lp_web') return 'web';
    return v;
  }

  function lookupLpEntryPdf(sku, lpId) {
    var maps = lpPriceMapsCache || {};
    var lp = normalizeLpIdPdf(lpId);
    if (!sku || !lp || !maps[lp]) return null;
    var map = maps[lp];
    if (Object.prototype.hasOwnProperty.call(map, sku)) return map[sku];
    var nz = String(sku).replace(/^0+/, '');
    if (nz && nz !== String(sku) && Object.prototype.hasOwnProperty.call(map, nz)) return map[nz];
    return null;
  }

  function applyLpPriceToLine(line, trm) {
    if (!line || line.priceModified) return line;
    // Si la línea ya viene liquidada del cotizador, no pisar montos/IVA con la LP.
    var hasLiquidation =
      (line.copIva != null && Number(line.copIva) > 0) ||
      (line.totalCopIva != null && Number(line.totalCopIva) > 0) ||
      (line.usdIva != null && Number(line.usdIva) > 0) ||
      (line.copSinIva != null && Number(line.copSinIva) > 0) ||
      (line.listPesos != null && Number(line.listPesos) > 0);
    if (hasLiquidation) return line;
    var lp = normalizeLpIdPdf(line.lp || (line.totals && line.totals.lp) || '');
    if (!lp) return line;
    var raw = lookupLpEntryPdf(line.sku || line.codigo, lp);
    if (raw == null) return line;
    var rate = Number(trm);
    if (!isFinite(rate) || rate <= 0) rate = 0;

    var amount = null;
    var currency = 'USD';
    var pesos = NaN;
    if (typeof raw === 'number') {
      amount = Number(raw);
    } else if (raw && typeof raw === 'object') {
      amount = raw.amount != null ? Number(raw.amount) : NaN;
      currency = String(raw.currency || 'USD').toUpperCase();
      pesos = raw.pesos != null ? Number(raw.pesos) : NaN;
    }
    if (!isFinite(amount) || amount <= 0) return line;
    if (currency === 'USD' && amount <= 0.10) {
      if (isFinite(pesos) && pesos > 0) {
        currency = 'COP';
        amount = pesos;
      } else {
        return line;
      }
    }

    var copy = Object.assign({}, line);
    copy.currency = currency;
    if (currency === 'COP') {
      var copAmt = Math.round(isFinite(pesos) && pesos > 0 ? pesos : amount);
      copy.listPesos = copAmt;
      copy.currency = 'COP';
      if (!copy.priceModified) {
        copy.copSinIva = copAmt;
        copy.unitarioCop = copAmt;
        copy.cop = copAmt;
        if (rate > 0) {
          copy.usd = copAmt / rate;
          copy.unitarioUsd = copy.usd;
        }
      }
      return copy;
    }
    if (isFinite(pesos) && pesos > 0) {
      if (currency === 'USD') {
        var listUsd = amount;
        copy.usdList = listUsd;
        if (!copy.priceModified) {
          copy.usd = listUsd;
          copy.unitarioUsd = listUsd;
        }
        // El peso visible siempre es el USD mostrado × TRM (no PESOS Excel con TRM vieja).
        var usdShown = sanitizeUsdCopPair(listUsd, NaN, rate, 'usd').usd;
        var copVal = rate > 0 ? Math.round(usdShown * rate) : Math.round(pesos);
        copy.listPesos = copVal;
        if (!copy.priceModified) {
          copy.copSinIva = copVal;
          copy.unitarioCop = copVal;
          copy.cop = copVal;
        }
      } else if (rate > 0) {
        copy.listPesos = Math.round(pesos);
        copy.usdList = pesos / rate;
        if (!copy.priceModified) {
          copy.copSinIva = copy.listPesos;
          copy.unitarioCop = copy.listPesos;
          copy.cop = copy.listPesos;
          copy.usd = copy.usdList;
          copy.unitarioUsd = copy.usdList;
        }
      }
    } else if (currency === 'USD' && !copy.priceModified) {
      // Sin PESOS: usar USD de la LP asignada (no mezclar con otra lista).
      copy.usd = amount;
      copy.unitarioUsd = amount;
    }
    return copy;
  }

  function enrichQuoteItems(quote) {
    var items = (quote && Array.isArray(quote.items)) ? quote.items : [];
    var maps = nameMapsCache || { productos: {}, referencias: {} };
    var trm = resolveQuoteTrm(quote);
    return items.map(function (line) {
      if (!line || typeof line !== 'object') return line;
      var copy = Object.assign({}, line);
      copy.name = resolveProductName(copy, maps);
      copy = applyLpPriceToLine(copy, trm);
      return copy;
    });
  }

  function enrichQuote(quote) {
    if (!quote || typeof quote !== 'object') return quote;
    var copy = Object.assign({}, quote);
    copy.trm = resolveQuoteTrm(copy);
    copy.items = enrichQuoteItems(copy);
    return copy;
  }

  function lineDescription(line, maps) {
    return resolveLineDisplay(line, maps).name;
  }

  function buildLines(quote, maps) {
    var items = (quote && Array.isArray(quote.items)) ? quote.items : [];
    var trm = Number(quote && quote.trm);
    if (!isFinite(trm) || trm <= 0) trm = 0;
    return items.map(function (line, i) {
      var qty = Math.max(1, Math.floor(Number(line.qty) || 1));
      var unit = lineUnitCopSinIva(line, trm);
      var unitUsd = lineUnitUsd(line, trm);
      var preferCop = lineIsCopPriced(line) || !!(line.priceModified && (String(line.priceEditSource || '').toLowerCase() === 'cop'
        || String(line.priceEditSource || '').toLowerCase() === 'copiva'));
      var aligned = sanitizeUsdCopPair(unitUsd, unit, trm, preferCop ? 'cop' : 'usd');
      unit = aligned.cop;
      unitUsd = aligned.usd;
      var name = resolveProductName(line, maps);
      var exempt = lineIsIvaExempt(line, unit, name, line.sku, qty);
      var unitIva = exempt ? 0 : ivaUnitAmountCop(unit, null);
      var total = (unit * qty) + (unitIva * qty);
      var unitUsdIva = 0;
      if (!exempt) {
        unitUsdIva = unitUsd * (1 + IVA);
      }
      var totalUsd = (exempt ? unitUsd : unitUsdIva) * qty;
      var desc = lineDescription(line, maps);
      var display = resolveLineDisplay(line, maps);
      var referencia = resolveReferencia(line, maps);
      return {
        n: i + 1,
        sku: display.sku === '—' ? '' : display.sku,
        referencia: referencia,
        descripcion: desc,
        qty: qty,
        precio: unit,
        precioIva: unitIva,
        precioUsd: unitUsd,
        precioUsdIva: unitUsdIva,
        ivaExempt: exempt,
        descPct: 0,
        total: total,
        totalUsd: totalUsd
      };
    });
  }

  /** Nombre del flete en el PDF (Gratis, TCC, Estelar, etc.). */
  function fleteTokenToLabel(raw) {
    if (raw == null || raw === false) return '';
    if (typeof raw === 'object') {
      if (raw.gratis === true || String(raw.id || '').toLowerCase() === 'gratis') return 'Gratis';
      raw = raw.label != null ? raw.label : (raw.name != null ? raw.name : raw.id);
    }
    var s = String(raw == null ? '' : raw).trim();
    if (!s || s === '0' || s === '[object Object]') return '';
    if (/^gratis$/i.test(s) || /flete\s*gratis/i.test(s)) return 'Gratis';
    if (/estelar/i.test(s)) return 'Estelar';
    if (/transarm/i.test(s)) return 'TransArm 1,76 %';
    if (/TCC/i.test(s)) return 'TCC';
    if (/especial/i.test(s) && /3/i.test(s)) return 'Especial 3,5%';
    if (/env[ií]o\s*nacional/i.test(s) || (/1\s*[,.]\s*85/i.test(s) && /%/i.test(s))) {
      return /23/.test(s) ? 'TCC' : 'Envío nacional 1,85 %';
    }
    if (/^\d+[,.]?\d*\s*%$/.test(s)) return 'Envío nacional ' + s;
    return s;
  }

  function resolveQuoteFleteLabel(quote, totals) {
    totals = totals && typeof totals === 'object' ? totals : {};
    var quoteObj = quote && typeof quote === 'object' ? quote : {};
    var candidates = [
      totals.flete,
      totals.flete_label,
      quoteObj.flete,
      quoteObj.flete_label
    ];
    var items = Array.isArray(quoteObj.items) ? quoteObj.items : [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].flete != null && items[i].flete !== '') {
        candidates.push(items[i].flete);
      }
    }
    var found = '';
    for (var j = 0; j < candidates.length; j++) {
      var label = fleteTokenToLabel(candidates[j]);
      if (label) {
        found = label;
        break;
      }
    }
    var fleteAntes = Number(totals.fleteAntesIva);
    if (!isFinite(fleteAntes) || fleteAntes < 0) fleteAntes = 0;
    var fleteIva = Number(totals.fleteIva);
    if (!isFinite(fleteIva) || fleteIva < 0) fleteIva = 0;
    if (/^gratis$/i.test(found)) found = 'Gratis';
    else if (!found) {
      if (fleteAntes <= 0 && fleteIva <= 0) found = 'Gratis';
      else found = '';
    }
    if (!found) return 'Flete';
    if (/^flete\b/i.test(found)) return found.replace(/^flete\b/i, 'Flete');
    return 'Flete ' + found;
  }

  function fleteLabelForPdf(raw) {
    return fleteTokenToLabel(raw) || 'Flete';
  }

  function buildFleteBlock(quote) {
    var totals = (quote && quote.totals && typeof quote.totals === 'object') ? quote.totals : {};
    var items = (quote && Array.isArray(quote.items)) ? quote.items : [];

    var subtotal = Number(totals.totalSinFlete);
    if (!isFinite(subtotal) || subtotal < 0) subtotal = 0;
    var maps = nameMapsCache || { productos: {}, referencias: {} };
    var trmPdf = Number(quote && quote.trm);
    if (!isFinite(trmPdf) || trmPdf <= 0) trmPdf = 0;
    var subtotalRecalc = 0;
    items.forEach(function (it) {
      if (!it) return;
      subtotalRecalc += lineTotalCopPayable(it, trmPdf, maps);
    });
    if (subtotalRecalc > 0) {
      subtotal = subtotalRecalc;
    } else if (subtotal <= 0) {
      items.forEach(function (it) {
        if (!it) return;
        if (it.totalCopIva != null && isFinite(Number(it.totalCopIva))) {
          subtotal += Number(it.totalCopIva);
        } else if (it.totalSinFlete != null && isFinite(Number(it.totalSinFlete))) {
          subtotal += Number(it.totalSinFlete);
        } else if (it.totalCop != null && isFinite(Number(it.totalCop))) {
          subtotal += Number(it.totalCop) * 1.19;
        }
      });
    }

    var fleteAntes = Number(totals.fleteAntesIva);
    if (!isFinite(fleteAntes) || fleteAntes < 0) fleteAntes = 0;
    fleteAntes = fleteAmountToPesos(fleteAntes, quote, subtotal);

    var fleteLabel = resolveQuoteFleteLabel(quote, totals);
    var fleteRaw = String(
      totals.flete || totals.flete_label || quote.flete || quote.flete_label || fleteLabel || ''
    );
    // Detectar envío nacional 1,85 % aunque venga como rate "0.0185" (id) o solo en el label.
    var isNacional185 =
      fleteRaw === '0.0185' ||
      Math.abs(Number(fleteRaw) - 0.0185) < 1e-9 ||
      Math.abs(Number(totals.flete_rate) - 0.0185) < 1e-9 ||
      /\bTCC\b/i.test(fleteRaw) ||
      /1\s*[,.]\s*85\s*%/i.test(fleteRaw) ||
      /env[ií]o\s*nacional/i.test(fleteRaw) ||
      /1\s*[,.]\s*85\s*%/i.test(fleteLabel) ||
      /env[ií]o\s*nacional/i.test(fleteLabel);

    // Base mercancía sin IVA (para umbral $1.5M y 1,85 %).
    var subtotalSinIvaPdf = 0;
    items.forEach(function (it) {
      if (!it) return;
      var qty = Math.max(1, Math.floor(Number(it.qty) || 1));
      var lineSin = Number(it.totalCop);
      if (!isFinite(lineSin) || lineSin <= 0) {
        var u = Number(it.copSinIva != null ? it.copSinIva : it.cop);
        if (isFinite(u) && u > 0) lineSin = u * qty;
      }
      if (isFinite(lineSin) && lineSin > 0) subtotalSinIvaPdf += lineSin;
    });
    if (!(subtotalSinIvaPdf > 0) && subtotal > 0) {
      subtotalSinIvaPdf = subtotal / 1.19;
    }

    var fleteIva = Number(totals.fleteIva);
    var isTccFijo = Math.abs(fleteAntes - 23000) < 0.5;
    if (isNacional185 && fleteAntes > 0) {
      if (subtotalSinIvaPdf < 1500000 && (isTccFijo || !(fleteAntes > 23000))) {
        if (!(fleteAntes > 0)) fleteAntes = 23000;
      }
    }
    if (fleteAntes > 0) {
      fleteIva = fleteIvaToPesos(fleteIva, fleteAntes, quote);
    } else {
      fleteIva = 0;
    }

    var totalPagar = Number(totals.totalConFlete);
    if (!isFinite(totalPagar) || totalPagar < 0) {
      totalPagar = subtotal + fleteAntes + fleteIva;
    } else {
      totalPagar = subtotal + fleteAntes + fleteIva;
    }

    var trm = Number(quote && quote.trm);
    if (!isFinite(trm) || trm <= 0) trm = 0;

    var subtotalUsd = Number(totals.usdIva);
    if (!isFinite(subtotalUsd) || subtotalUsd < 0) {
      subtotalUsd = 0;
      items.forEach(function (it) {
        if (!it) return;
        var qty = Math.max(1, Math.floor(Number(it.qty) || 1));
        if (it.totalUsdIva != null && isFinite(Number(it.totalUsdIva))) {
          subtotalUsd += Number(it.totalUsdIva);
        } else if (it.usdIva != null && isFinite(Number(it.usdIva))) {
          subtotalUsd += Number(it.usdIva) * qty;
        } else if (it.totalUsd != null && isFinite(Number(it.totalUsd))) {
          subtotalUsd += Number(it.totalUsd) * 1.19;
        } else if (it.usd != null && isFinite(Number(it.usd))) {
          subtotalUsd += Number(it.usd) * qty * 1.19;
        }
      });
      if (subtotalUsd <= 0 && trm > 0) subtotalUsd = subtotal / trm;
    }

    var fleteAntesUsd = trm > 0 ? sanitizeUsdCopPair(NaN, fleteAntes, trm, 'cop').usd : 0;
    var fleteIvaUsd = trm > 0 ? sanitizeUsdCopPair(NaN, fleteIva, trm, 'cop').usd : 0;
    var totalPagarUsd = trm > 0 ? sanitizeUsdCopPair(NaN, totalPagar, trm, 'cop').usd : (subtotalUsd + fleteAntesUsd + fleteIvaUsd);

    return {
      subtotal: subtotal,
      fleteAntes: fleteAntes,
      fleteIva: fleteIva,
      fleteConIva: fleteAntes + fleteIva,
      totalPagar: totalPagar,
      fleteLabel: fleteLabel,
      trm: trm,
      subtotalUsd: subtotalUsd,
      fleteAntesUsd: fleteAntesUsd,
      fleteIvaUsd: fleteIvaUsd,
      totalPagarUsd: totalPagarUsd
    };
  }

  function isLikelyBitrixDealId(val) {
    var s = String(val == null ? '' : val).trim();
    if (!s || !/^\d+$/.test(s)) return false;
    if (s.length > 12) return false;
    if (/^20\d{6,}/.test(s)) return false;
    return true;
  }

  function quoteNumber(quote, extras) {
    extras = extras || {};
    var fromExtra = String(extras.numero == null ? '' : extras.numero).trim();
    if (fromExtra && isLikelyBitrixDealId(fromExtra)) return fromExtra;

    if (!quote || typeof quote !== 'object') return '';

    // Solo el N° de negociación Bitrix (ej. 11900), nunca el id interno IZC.
    var deal = String(quote.bitrix_deal_id || quote.deal_id || '').trim();
    if (deal && isLikelyBitrixDealId(deal)) return deal;

    var pending = String(extras.numeroPendiente == null ? '' : extras.numeroPendiente).trim();
    if (pending) return pending;
    return '';
  }

  function formatQuoteDate(value) {
    if (!value) return '';
    var raw = String(value).trim();
    var d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      var parts = raw.split('-');
      d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      d = new Date(raw);
    }
    if (isNaN(d.getTime())) return '';
    var day = String(d.getDate());
    var month = String(d.getMonth() + 1);
    var year = d.getFullYear();
    if (day.length < 2) day = '0' + day;
    if (month.length < 2) month = '0' + month;
    return day + '/' + month + '/' + year;
  }

  function resolveQuoteDate(quote, extras) {
    extras = extras || {};
    var candidates = [
      extras.fecha,
      quote && quote.created_at,
      quote && quote.asesor_cotizado_at,
      quote && quote.finished_at
    ];
    for (var i = 0; i < candidates.length; i++) {
      var formatted = formatQuoteDate(candidates[i]);
      if (formatted) return formatted;
    }
    return formatQuoteDate(new Date().toISOString());
  }

  function pageHeaderHtml(logoUrl, pageLabel, num, logoAlt, fecha) {
    return (
      '<div class="page-head">' +
        '<img class="logo" src="' + escapeHtml(logoUrl) + '" alt="' + escapeHtml(logoAlt || 'IZC MAYORISTA') + '">' +
        '<div class="page-head-right">' +
          '<div class="page-label">' + escapeHtml(pageLabel) + '</div>' +
          '<div class="quote-no">N° COTIZACIÓN: ' + escapeHtml(num || '') + '</div>' +
          (fecha ? '<div class="quote-date">Fecha: ' + escapeHtml(fecha) + '</div>' : '') +
        '</div>' +
      '</div>'
    );
  }

  function buildExtraPages(logoUrl, num, logoAlt, isValtech, fecha) {
    var head2 = pageHeaderHtml(logoUrl, 'Página 2', num, logoAlt, fecha);
    var head3 = pageHeaderHtml(logoUrl, 'Página 3', num, logoAlt, fecha);
    var head4 = pageHeaderHtml(logoUrl, 'Página 4', num, logoAlt, fecha);
    var company = isValtech ? 'VALTECH MAYORISTA SAS' : 'IZC Mayorista SAS';
    var companyShort = isValtech ? 'VALTECH' : 'IZC';
    var companyEsc = escapeHtml(company);
    var companyShortEsc = escapeHtml(companyShort);
    var bannerTitle = isValtech ? 'VALTECH MAYORISTA SAS' : 'SOMOS AUTO RETENEDORES';
    var urls = resolvePolicyUrls(!!isValtech);
    var garantiaMarcas = isValtech
      ? ('Todos los Productos comercializados por ' + companyEsc +
         ' cuentan con el respaldo y garantía de sus fabricantes y de sí misma. ' +
         'Para el detalle de políticas de garantía, remítase al enlace <a href="' +
         urls.garantia + '" target="_blank" rel="noopener">' + urls.garantia + '</a>.')
      : ('Todos los Productos comercializados por ' + companyEsc +
         ' cuentan con el respaldo y garantía sea de sus fabricantes y de sí misma; algunos de ellos tienen centro de servicio u otras marcas es ' +
         companyShortEsc +
         ' quien velará por brindar este servicio de acuerdo con las políticas internas de garantías. Las garantías de las marcas ACCUBANKER, BIXOLON, DATALOGIC, ELO, HONEYWELL, ZEBRA, son directamente con centro de Servicio; por favor remítase al enlace <a href="' +
         urls.garantia + '" target="_blank" rel="noopener">' + urls.garantia + '</a> para ver el detalle de cada uno de ellos.');

    var page2 =
      '<section class="sheet page-break">' +
        head2 +
        '<h1 class="sec-title">CONDICIONES COMERCIALES</h1>' +
        '<h2 class="sec-title">' + escapeHtml(bannerTitle) + '</h2>' +
        '<p>En ' + companyEsc + ' trabajamos para brindarle una experiencia comercial segura, transparente y eficiente. A continuación, compartimos nuestras condiciones comerciales vigentes:</p>' +
        '<p>' + companyEsc + ' es autorretenedor, por lo tanto, no debe realizarse ningún tipo de retención en los pagos.</p>' +
        '<h3 class="sec-sub">Términos de Cotización</h3>' +
        '<ul>' +
          '<li>Cotizaciones en dólares: vigencia de 8 días.</li>' +
          '<li>Cotizaciones en pesos colombianos: válidas solo el día de emisión.</li>' +
          '<li>Los precios pueden cambiar sin previo aviso y dependen de la disponibilidad en inventario.</li>' +
          '<li>Todas las facturas se emiten en pesos colombianos, indexadas al dólar con la TRM del día de facturación.</li>' +
          '<li>El pago debe realizarse conforme a los términos indicados en la factura.</li>' +
        '</ul>' +
        '<h3 class="sec-sub">Clientes Nuevos</h3>' +
        '<p>Para registrarse como distribuidor, por favor diligencie el formulario en el siguiente enlace:</p>' +
        '<p class="link-line">🔗 <a href="' + urls.distribuidor + '" target="_blank" rel="noopener">Inscripción como Distribuidor</a></p>' +
        '<h3 class="sec-left">Documentos requeridos:</h3>' +
        '<ul>' +
          '<li>Certificado de Cámara de Comercio (máximo 30 días)</li>' +
          '<li>RUT</li>' +
          '<li>Cédula del representante legal</li>' +
        '</ul>' +
        '<h2 class="sec-title">DISPONIBILIDAD DE INVENTARIO</h2>' +
        '<p>' + companyEsc + ' procura tener a disposición un inventario óptimo que satisfaga la demanda y proyección del mercado, basado en un adecuado forecast en las referencias de una permanente rotación; los productos que no estén disponibles en el inventario físico de ' + companyEsc + ' contarán con un tiempo estimado de entrega de 20 días, sobre orden de compra y anticipo, el cual no tendrá retorno en ninguno de los casos ajenos a la responsabilidad de ' + companyEsc + '. Los tiempos estimados son programados de acuerdo con las políticas de entregas por parte del fabricante; no obstante, pueden presentarse retrasos por parte de los mismos. ' + companyEsc + ' se encargará del debido seguimiento de las órdenes de compra requeridas y notificará toda novedad que pueda presentarse en estas, así como los diferentes procedimientos alternos, en pro de la prestación de un buen servicio. Para negociaciones puntuales es normal la exigencia de pago de anticipos mínimo del 30%. El incumplimiento por parte del distribuidor frente a la confirmación del pedido tendrá una multa del 15% sobre el valor total de la negociación.</p>' +
        '<h2 class="sec-title">Política de Productos Bajo Pedido</h2>' +
        '<p>Con el fin de garantizar una gestión eficiente y servicio personalizado, aplicamos las siguientes condiciones para productos solicitados exclusivamente bajo pedido:</p>' +
        '<h3 class="sec-left">🪙 Venta al Contado</h3>' +
        '<ul>' +
          '<li>Requiere anticipo del 30%, calculado al tipo de cambio del día.</li>' +
          '<li>El pago del anticipo implica aceptación total de esta política.</li>' +
          '<li>Se confirma y gestiona el pedido al recibir el anticipo.</li>' +
          '<li>El saldo del 70% se paga al llegar el producto, con proforma actualizada a la TRM del día de llegada.</li>' +
          '<li>La entrega se realiza únicamente con el pago completo.</li>' +
        '</ul>' +
      '</section>';

    var page3 =
      '<section class="sheet page-break">' +
        head3 +
        '<h3 class="sec-left">📄 Venta a Crédito</h3>' +
        '<ul>' +
          '<li>El pedido se confirma con una Orden de Compra (OC), sin necesidad de consignar el anticipo.</li>' +
          '<li>El anticipo del 30% será reservado del cupo de crédito disponible.</li>' +
          '<li>El saldo del 70% se facturará al momento de llegada, según disponibilidad del cupo. Si no hay cupo, el valor deberá ser cancelado antes de la entrega.</li>' +
          '<li>La entrega se realiza únicamente con el pago completo.</li>' +
        '</ul>' +
        '<h3 class="sec-left">⚠️ Condiciones Generales</h3>' +
        '<ul>' +
          '<li>El tiempo estimado de llegada será informado al confirmar el pedido y puede variar por temas logísticos o aduaneros.</li>' +
          '<li>No se aceptan cancelaciones una vez confirmado el pedido.</li>' +
          '<li>En caso de cancelación, el cliente deberá pagar el valor del anticipo como compensación por la gestión y logística.</li>' +
          '<li>' + companyEsc + ' determinará si el producto es o no de rotación, lo cual puede afectar la devolución del anticipo en caso de no retiro.</li>' +
        '</ul>' +
        '<h2 class="sec-title">FACTURACIÓN, TÉRMINOS Y FORMAS DE PAGO</h2>' +
        '<ul>' +
          '<li>Descuento Financiero: 1% para clientes a crédito que paguen dentro de los 5 días hábiles posteriores a la factura.</li>' +
          '<li>Para garantizar la recepción correcta de facturas electrónicas, su correo debe coincidir con el registrado en el RUT.</li>' +
          '<li>Por favor verifique y actualice su correo aquí:</li>' +
        '</ul>' +
        '<p class="link-line">🔗 <a href="' + urls.actualizacionDatos + '" target="_blank" rel="noopener">Actualización de Datos</a></p>' +
        '<ol class="steps">' +
          '<li>Verifique su correo en el RUT.</li>' +
          '<li>Actualícelo en nuestro portal.</li>' +
          '<li>Asegure la correcta recepción de documentos fiscales.</li>' +
        '</ol>' +
        '<h2 class="sec-title">' + escapeHtml(company.toUpperCase()) + ' BRINDA DIFERENTES MODALIDADES DE PAGO:</h2>' +
        '<p>Brindamos opciones flexibles para su comodidad:</p>' +
        '<ul>' +
          '<li>PSE: <a href="' + urls.pse + '" target="_blank" rel="noopener">Pagos en Línea</a></li>' +
          '<li>Crédito con Aseguradora: sujeto a estudio ($103.000, reembolsable en la primera compra si es aprobado).</li>' +
          '<li>Crédito Covifactura: sujeto a estudio y aprobación.</li>' +
          (isValtech
            ? ''
            : '<li>Factoring Bancolombia: aplica para clientes con cupo aprobado.</li>' +
              '<li>Tarjeta de Crédito: disponible para su conveniencia.</li>') +
        '</ul>' +
        '<p>✏️ Créditos a 30 días. Pedidos mayores a USD 25.000: crédito hasta 45 días. Pasados los 30 días, se aplicarán intereses de mora según ley.</p>' +
        '<h2 class="sec-title">ENTREGAS</h2>' +
        '<ul>' +
          '<li><strong>Sede Cota:</strong> lunes a viernes, 8:00 a.m. – 4:00 p.m.</li>' +
          '<li><strong>Sede Unilago:</strong> lunes a viernes, 9:00 a.m. – 6:00 p.m. / sábados, 9:00 a.m. – 1:00 p.m.</li>' +
        '</ul>' +
        '<p>📦 Para recoger mercancía es necesario:</p>' +
        '<ul>' +
          '<li>Sello de la empresa y/o carta membretada de autorización.</li>' +
          '<li>Datos de la persona que retira (nombre, cédula, placas del vehículo).</li>' +
        '</ul>' +
      '</section>';

    var page4 =
      '<section class="sheet page-break">' +
        head4 +
        '<p>📦 <strong>Transporte:</strong></p>' +
        '<ul>' +
          '<li>Contamos con convenio con TCC.</li>' +
          '<li>Pedidos &gt; $1.500.000: tarifa del 1,85% sobre el valor del pedido + IVA.</li>' +
          '<li>Pedidos &lt; $1.500.000: $23.000 + IVA.</li>' +
        '</ul>' +
        '<h2 class="sec-title">ENTREGA A USUARIO FINAL</h2>' +
        '<p>La entrega a Usuario final solo podrá realizarse posterior a enviar autorización formal (formato establecido por ' +
          companyShortEsc +
          ') por parte de ustedes como distribuidores y aplica para facturaciones realizadas por forma de pago Efectivo; casos excepcionales deberán ser aprobados por la Gerencia de la compañía de acuerdo con las políticas internas vigentes.</p>' +
        '<h2 class="sec-title">DEVOLUCIONES DE PRODUCTO</h2>' +
        '<p>La mercancía con carácter de Préstamo o Demo debe ser devuelta en los plazos establecidos en la solicitud; de lo contrario será facturada al cliente.</p>' +
        '<p>No se aceptan devolución de mercancía; en casos puntuales tendrán previa autorización de gerencia y un cobro del 10% que será facturado a nuestro distribuidor.</p>' +
        '<p>Para los casos en que son aprobadas la devolución de mercancía es importante que esté bajo las siguientes condiciones:</p>' +
        '<ul>' +
          '<li>El producto debe estar en su empaque original y con los accesorios completos, como bolsas, medios de información, etc. Junto a copia de la factura y ticket de aprobación de la devolución.</li>' +
          '<li>Solo se aceptarán devoluciones de productos que se encuentren vigentes (versiones actuales).</li>' +
          '<li>No se aceptarán en devolución productos que hayan sido despachados bajo pedido especial.</li>' +
          '<li>La devolución de los productos debe hacerse en reempaque para evitar los daños en el empaque original al pegar cinta o guías de transportadora.</li>' +
          '<li>Los productos por daños en el transporte no se tienen en cuenta para devolución; se debe hacer el respectivo trámite con la transportadora, por lo cual se pide validar el estado del producto cuando sea entregado y dejar la nota en guía de recibido.</li>' +
        '</ul>' +
        '<h2 class="sec-title">DEVOLUCIONES DE DINERO</h2>' +
        '<p class="link-line"><a href="' + urls.devolucionDinero + '" target="_blank" rel="noopener">' + urls.devolucionDinero + '</a></p>' +
        '<h2 class="sec-title">NORMAS Y POLITICAS DE GARANTIAS</h2>' +
        '<p>' + garantiaMarcas + '</p>' +
        '<h2 class="sec-title">MATERIAL DE MERCADEO PARA DISTRIBUIDORES</h2>' +
        '<p>' + companyShortEsc + ' proporciona imágenes, logos, fichas técnicas y catálogos como herramientas para uso de la comercialización de los productos, los cuales podrán acceder en el siguiente link:</p>' +
        '<p class="link-line"><a href="' + urls.mercadeo + '" target="_blank" rel="noopener">' + urls.mercadeo + '</a></p>' +
        '<p class="closing">Agradecemos su confianza en ' + companyEsc + '. Estas políticas están diseñadas para proteger sus intereses y asegurar una relación comercial fluida, clara y beneficiosa para ambas partes.</p>' +
      '</section>';

    return page2 + page3 + page4;
  }

  function buildPdfHtml(quote, extras) {
    extras = extras || {};
    var pdfCurrency = String(extras.currency || 'COP').toUpperCase();
    var isUsd = pdfCurrency === 'USD';
    quote = enrichQuote(quote || {});
    var maps = nameMapsCache || { productos: {}, referencias: {} };
    var empresa = resolveQuoteEmpresa(quote, extras);
    var isValtech = isValtechEmpresa(empresa);
    var sender = resolveSender(empresa);
    var lines = buildLines(quote || {}, maps);
    var liq = buildFleteBlock(quote || {});
    var trm = Number(quote && quote.trm);
    if (!isFinite(trm) || trm <= 0) trm = 0;
    var cliente = String((quote && quote.nombre) || extras.cliente || 'Cliente').trim();
    var nitCliente = String((quote && (quote.nit || quote.client_nit)) || extras.nit || '').replace(/[\s.]/g, '').trim();
    var telefono = String((quote && (quote.telefono || quote.client_telefono)) || extras.telefono || '').trim();
    var direccion = String((quote && (quote.direccion || quote.client_direccion)) || extras.direccion || '').trim();
    var vendedor = String(extras.vendedor || (quote && (quote.seller_name || quote.asesor_nombre)) || '').trim();
    var num = quoteNumber(quote, extras);
    if ((!telefono || !direccion) && nitCliente) {
      var contactHit = lookupClientContactCache(nitCliente);
      if (!telefono && contactHit.telefono) telefono = contactHit.telefono;
      if (!direccion && contactHit.direccion) direccion = contactHit.direccion;
    }
    var fecha = resolveQuoteDate(quote, extras);
    var logoUrl = absolutize(sender.logo);

    var rows, fleteRow, tableHead, totalsHtml, currencyTitle, colspanAll;

    if (isUsd) {
      var subtotalUsdLines = 0;
      rows = lines.map(function (row) {
        var sinIva = row.ivaExempt === true || !(Number(row.precioIva) > 0);
        var unitUsdIva = sinIva ? 0 : (Number(row.precioUsdIva) > 0 ? Number(row.precioUsdIva) : row.precioUsd * (1 + IVA));
        var totalUsd = Number(row.totalUsd);
        if (!isFinite(totalUsd) || totalUsd < 0) {
          totalUsd = (sinIva ? row.precioUsd : unitUsdIva) * row.qty;
        }
        subtotalUsdLines += totalUsd;
        return (
          '<tr>' +
            '<td class="c">' + row.n + '</td>' +
            '<td class="c ficha">' + fichaCellHtml(row.sku, row.precioUsd) + '</td>' +
            '<td class="c">' + escapeHtml(row.sku) + '</td>' +
            '<td class="c">' + escapeHtml(row.referencia || '—') + '</td>' +
            '<td class="desc">' + escapeHtml(row.descripcion) + '</td>' +
            '<td class="c">' + row.qty + ' pcs.</td>' +
            '<td class="r money">' + escapeHtml(formatUsdAmount(row.precioUsd)) + '</td>' +
            '<td class="r money">' + escapeHtml(formatUsdAmount(unitUsdIva)) + '</td>' +
            '<td class="r money">' + escapeHtml(formatUsdAmount(totalUsd)) + '</td>' +
          '</tr>'
        );
      }).join('');

      fleteRow =
        '<tr class="flete-row">' +
          '<td class="c">' + (lines.length + 1) + '</td>' +
          '<td class="c ficha"></td>' +
          '<td class="c">—</td>' +
          '<td class="c">—</td>' +
          '<td class="desc">' + escapeHtml(liq.fleteLabel) + '</td>' +
          '<td class="c">1 pcs.</td>' +
          '<td class="r money">' + escapeHtml(formatUsdAmount(liq.fleteAntesUsd)) + '</td>' +
          '<td class="r money">' + escapeHtml(formatUsdAmount(liq.fleteAntesUsd + liq.fleteIvaUsd)) + '</td>' +
          '<td class="r money">' + escapeHtml(formatUsdAmount(liq.fleteAntesUsd + liq.fleteIvaUsd)) + '</td>' +
        '</tr>';

      tableHead =
        '<colgroup>' +
          '<col style="width:4%"><col style="width:10%"><col style="width:7%"><col style="width:13%"><col style="width:24%"><col style="width:6%">' +
          '<col style="width:12%"><col style="width:12%"><col style="width:12%">' +
        '</colgroup>' +
        '<thead><tr>' +
          '<th>N°</th><th>Ficha Tecnica</th><th>SKU</th><th>REFERENCIA</th><th>DESCRIPCIÓN</th><th>CANT</th>' +
          '<th>P. UNIT.</th><th>P. + IVA</th><th>TOTAL</th>' +
        '</tr></thead>';

      var subtotalUsd = subtotalUsdLines;
      var fleteUsd = liq.fleteAntesUsd;
      var fleteIvaUsd = liq.fleteIvaUsd;
      var totalPagarUsd = subtotalUsd + fleteUsd + fleteIvaUsd;

      totalsHtml =
        '<div class="totals">' +
          '<div class="totals-row"><span>Subtotal productos (USD)</span><span>' + escapeHtml(formatUsd(subtotalUsd)) + '</span></div>' +
          '<div class="totals-row"><span>Flete (' + escapeHtml(liq.fleteLabel) + ')</span><span>' + escapeHtml(formatUsd(fleteUsd)) + '</span></div>' +
          (liq.fleteIva > 0.005
            ? '<div class="totals-row"><span>IVA flete (19 %)</span><span>' + escapeHtml(formatUsd(fleteIvaUsd)) + '</span></div>'
            : '') +
          '<div class="totals-row totals-grand"><span>TOTAL A PAGAR</span><span>' + escapeHtml(formatUsd(totalPagarUsd)) + '</span></div>' +
        '</div>';

      currencyTitle = 'Valores en dólares (USD)';
      colspanAll = 9;
    } else {
      rows = lines.map(function (row) {
        return (
          '<tr>' +
            '<td class="c">' + row.n + '</td>' +
            '<td class="c ficha">' + fichaCellHtml(row.sku, row.precioUsd) + '</td>' +
            '<td class="c">' + escapeHtml(row.sku) + '</td>' +
            '<td class="c">' + escapeHtml(row.referencia || '—') + '</td>' +
            '<td class="desc">' + escapeHtml(row.descripcion) + '</td>' +
            '<td class="c">' + row.qty + ' pcs.</td>' +
            '<td class="r">' + escapeHtml(formatUsdAmount(row.precioUsd)) + '</td>' +
            '<td class="r money">' + escapeHtml(formatPesosAmount(row.precio)) + '</td>' +
            '<td class="r money">' + escapeHtml(formatPesosAmount(row.precioIva)) + '</td>' +
            '<td class="r money">' + escapeHtml(formatPesosAmount(row.total)) + '</td>' +
          '</tr>'
        );
      }).join('');

      fleteRow =
        '<tr class="flete-row">' +
          '<td class="c">' + (lines.length + 1) + '</td>' +
          '<td class="c ficha"></td>' +
          '<td class="c">—</td>' +
          '<td class="c">—</td>' +
          '<td class="desc">' + escapeHtml(liq.fleteLabel) + '</td>' +
          '<td class="c">1 pcs.</td>' +
          '<td class="r">' + escapeHtml(formatUsdAmount(liq.fleteAntesUsd)) + '</td>' +
          '<td class="r money">' + escapeHtml(formatPesosAmount(liq.fleteAntes)) + '</td>' +
          '<td class="r money">' + escapeHtml(formatPesosAmount(liq.fleteIva)) + '</td>' +
          '<td class="r money">' + escapeHtml(formatPesosAmount(liq.fleteAntes + liq.fleteIva)) + '</td>' +
        '</tr>';

      tableHead =
        '<colgroup>' +
          '<col class="c-n"><col class="c-ficha"><col class="c-sku"><col class="c-ref"><col class="c-desc"><col class="c-cant">' +
          '<col class="c-precio-usd"><col class="c-precio"><col class="c-iva"><col class="c-total">' +
        '</colgroup>' +
        '<thead><tr>' +
          '<th>N°</th><th>Ficha Tecnica</th><th>SKU</th><th>REFERENCIA</th><th>DESCRIPCIÓN</th><th>CANT</th>' +
          '<th>P. UNIT.</th><th>P. UNIT.</th><th>IVA UNIT.</th><th>TOTAL</th>' +
        '</tr></thead>';

      totalsHtml =
        '<div class="totals">' +
          '<div class="totals-row"><span>Subtotal productos (COP + IVA)</span><span>' + escapeHtml(formatPesos(liq.subtotal)) + '</span></div>' +
          '<div class="totals-row"><span>Flete (' + escapeHtml(liq.fleteLabel) + ')</span><span>' + escapeHtml(formatPesos(liq.fleteAntes)) + '</span></div>' +
          (liq.fleteIva > 0.005
            ? '<div class="totals-row"><span>IVA flete (19 %)</span><span>' + escapeHtml(formatPesos(liq.fleteIva)) + '</span></div>'
            : '') +
          '<div class="totals-row totals-grand"><span>TOTAL A PAGAR</span><span>' + escapeHtml(formatPesos(liq.totalPagar)) + '</span></div>' +
        '</div>';

      currencyTitle = 'Valores en pesos (COP)';
      colspanAll = 10;
    }

    var page1 =
      '<section class="sheet">' +
        '<div class="toolbar">' +
          '<button type="button" onclick="window.print()">Descargar / Imprimir PDF</button>' +
        '</div>' +
        '<div class="top">' +
          '<img class="logo" src="' + escapeHtml(logoUrl) + '" alt="' + escapeHtml(isValtech ? 'VALTECH Mayorista' : sender.brand) + '">' +
          '<div class="quote-head-right">' +
            '<div class="quote-no">N° COTIZACIÓN: ' + escapeHtml(num) + '</div>' +
            (fecha ? '<div class="quote-date">Fecha: ' + escapeHtml(fecha) + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="cols">' +
          '<div class="col">' +
            '<h2>' + escapeHtml(sender.enviadaPorLabel || 'ENVIADA POR') + '</h2>' +
            '<div class="brand">' + escapeHtml(sender.brand) + '</div>' +
            '<div class="muted">' + escapeHtml(sender.nit) + '</div>' +
            (String(sender.web || '').trim()
              ? '<div class="muted">Sitio Web: ' + escapeHtml(String(sender.web).trim()) + '</div>'
              : '') +
            '<div class="muted">Dirección: ' + escapeHtml(sender.address) + '</div>' +
            '<div class="muted">Vendedor: ' + escapeHtml(vendedor) + '</div>' +
          '</div>' +
          '<div class="col">' +
            '<h2>SOLICITADA POR</h2>' +
            '<div class="brand">Cliente: ' + escapeHtml(cliente) + '</div>' +
            (nitCliente ? '<div class="muted">NIT: ' + escapeHtml(nitCliente) + '</div>' : '') +
            '<div class="muted">Negociacion #' + escapeHtml(num) + '</div>' +
            '<div class="muted">Teléfono: ' + escapeHtml(telefono) + '</div>' +
            '<div class="muted">Dirección: ' + escapeHtml(direccion) + '</div>' +
          '</div>' +
        '</div>' +
        '<h3 class="currency-title">' + escapeHtml(currencyTitle) + '</h3>' +
        '<table class="items">' +
          tableHead +
          '<tbody>' +
            (rows || '<tr><td colspan="' + colspanAll + '" class="c">Sin productos</td></tr>') +
            fleteRow +
          '</tbody>' +
        '</table>' +
        totalsHtml +
      '</section>';

    var logoAlt = isValtech ? 'VALTECH Mayorista' : 'IZC MAYORISTA';
    var extra = buildExtraPages(logoUrl, num, logoAlt, isValtech, fecha);

    return (
      '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
      '<title>Cotización ' + escapeHtml(num || '') + '</title>' +
      '<style>' +
      '@page { size: letter; margin: 12mm 11mm; }' +
      'html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;}' +
      '.sheet{max-width:900px;margin:0 auto;padding:8px 4px 20px;}' +
      '.page-break{page-break-before:always;break-before:page;}' +
      '.top,.page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px;}' +
      '.page-head-right{text-align:right;}' +
      '.page-label{font-size:14px;color:#222;margin-bottom:4px;}' +
      '.logo{max-height:78px;max-width:280px;object-fit:contain;}' +
      '.quote-head-right{text-align:right;}' +
      '.quote-no{color:#2f7cc0;font-weight:700;font-size:17px;letter-spacing:0.02em;}' +
      '.quote-date{color:#333;font-size:14px;margin-top:6px;font-weight:600;}' +
      '.cols{display:flex;gap:28px;margin-bottom:20px;}' +
      '.col{flex:1;min-width:0;font-size:13px;line-height:1.45;}' +
      '.col h2{margin:0 0 8px;color:#2f7cc0;font-size:15px;font-weight:700;}' +
      '.col .brand{font-weight:700;margin-bottom:2px;}' +
      '.col .muted{color:#222;}' +
      'table.items{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;}' +
      'table.items th,table.items td{border:1px solid #b9b9b9;padding:7px 6px;vertical-align:middle;}' +
      'table.items th{background:#ececec;font-weight:700;text-align:center;}' +
      'table.items td.c{text-align:center;}' +
      'table.items td.r{text-align:right;}' +
      'table.items td.money{white-space:nowrap;font-size:10px;font-variant-numeric:tabular-nums;overflow:hidden;}' +
      'table.items td.desc{text-align:left;word-wrap:break-word;}' +
      'table.items td.ficha{font-size:9px;line-height:1.25;}' +
      'table.items .ficha-link{color:#2f7cc0;text-decoration:underline;font-weight:700;}' +
      'table.items .ficha-missing{color:#888;font-weight:600;}' +
      'table.items col.c-n{width:4%;} table.items col.c-ficha{width:10%;} table.items col.c-sku{width:6%;} table.items col.c-ref{width:11%;} table.items col.c-desc{width:21%;}' +
      'table.items col.c-cant{width:6%;} table.items col.c-precio-usd{width:10%;} table.items col.c-precio{width:11%;} table.items col.c-iva{width:10%;} table.items col.c-total{width:11%;}' +
      'table.items th{font-size:10px;}' +
      'table.items tr.flete-row td{background:#f7fafc;font-weight:600;}' +
      '.totals{margin:14px 0 8px;margin-left:auto;width:min(420px,100%);font-size:13px;}' +
      '.totals-row{display:flex;justify-content:space-between;gap:16px;padding:5px 0;border-bottom:1px solid #ddd;}' +
      '.totals-row span:last-child{font-variant-numeric:tabular-nums;font-weight:600;}' +
      '.totals-grand{border-bottom:0;margin-top:4px;padding-top:8px;border-top:2px solid #1653a0;font-size:14px;}' +
      '.totals-grand span{color:#1653a0;font-weight:700;}' +
      '.currency-title{margin:8px 0 10px;color:#1653a0;font-size:14px;font-weight:700;}' +
      '.toolbar{display:flex;justify-content:flex-end;gap:8px;margin:0 0 12px;}' +
      '.toolbar button{border:0;border-radius:4px;background:#1653a0;color:#fff;font-weight:700;padding:9px 14px;cursor:pointer;}' +
      '.sec-title{margin:16px 0 8px;color:#2f7cc0;font-size:15px;font-weight:700;text-align:center;text-transform:uppercase;}' +
      '.sec-sub{margin:14px 0 6px;color:#2f7cc0;font-size:14px;font-style:italic;font-weight:700;}' +
      '.sec-left{margin:12px 0 6px;color:#2f7cc0;font-size:14px;font-weight:700;}' +
      'p,li{font-size:13px;line-height:1.45;}' +
      'ul,ol{margin:6px 0 10px;padding-left:22px;}' +
      '.steps{margin:8px 0 12px;padding-left:22px;}' +
      '.link-line{margin:6px 0 12px;}' +
      'a{color:#2f7cc0;}' +
      '.closing{margin-top:18px;}' +
      '@media print{.toolbar{display:none!important;} .sheet{padding:0;max-width:none;} a{color:#2f7cc0;text-decoration:underline;}}' +
      '/* Evitar rasterizar: no filters/transforms; tip si se usa imprimir */' +
      'html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
      '</style></head><body>' +
      page1 +
      extra +
      '<script>window.addEventListener("load",function(){' +
      (extras.autoPrint === false
        ? ''
        : 'setTimeout(function(){window.focus();window.print();},450);') +
      '});<\/script>' +
      '</body></html>'
    );
  }

  function getJsPdfCtor() {
    var ctor = null;
    if (window.jspdf && typeof window.jspdf.jsPDF === 'function') ctor = window.jspdf.jsPDF;
    else if (typeof window.jsPDF === 'function') ctor = window.jsPDF;
    if (!ctor) return null;
    // Asegurar autoTable en el prototipo (si el plugin no se enganchó al cargar).
    try {
      var probe = new ctor({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      if (typeof probe.autoTable !== 'function') {
        if (window.jspdfAutoTable && typeof window.jspdfAutoTable.applyPlugin === 'function') {
          window.jspdfAutoTable.applyPlugin(ctor);
        } else if (window.autoTable && typeof window.autoTable.applyPlugin === 'function') {
          window.autoTable.applyPlugin(ctor);
        }
      }
    } catch (eProbe) { /* ignore */ }
    return ctor;
  }

  /** Texto seguro para Helvetica/WinAnsi (español OK; sin emojis ni símbolos raros). */
  function pdfSafe(s) {
    return String(s == null ? '' : s)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
  }

  function pdfDrawWrapped(doc, text, x, y, maxWidth, lineHeight) {
    var lines = doc.splitTextToSize(pdfSafe(text), maxWidth);
    doc.text(lines, x, y);
    return y + lines.length * (lineHeight || 4.5);
  }

  /** Encabezado con logo de empresa (IZC / VALTECH) + N° cotización. */
  function pdfDrawBrandHeader(doc, logoData, brandFallback, pageLabel, num, fecha, margin) {
    var pageW = doc.internal.pageSize.getWidth();
    var y = margin;
    var logoH = 16;
    var logoDrawn = false;
    if (logoData && logoData.dataUrl && logoData.w > 0 && logoData.h > 0) {
      var aspect = logoData.w / logoData.h;
      var logoW = Math.min(58, logoH * aspect);
      try {
        doc.addImage(logoData.dataUrl, 'PNG', margin, y - 1, logoW, logoH);
        logoDrawn = true;
      } catch (eImg) {
        logoDrawn = false;
      }
    }
    if (!logoDrawn) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(22, 83, 160);
      doc.text(pdfSafe(brandFallback || 'IZC MAYORISTA'), margin, y + 6);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(22, 83, 160);
    var rightLines = [];
    if (pageLabel) rightLines.push(String(pageLabel));
    rightLines.push('N. COTIZACION: ' + (num || '—'));
    if (fecha) rightLines.push('Fecha: ' + fecha);
    var ry = y + 3;
    rightLines.forEach(function (line) {
      doc.text(pdfSafe(line), pageW - margin, ry, { align: 'right' });
      ry += 4.5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(51, 51, 51);
    });
    doc.setTextColor(17, 17, 17);
    return Math.max(y + logoH, ry) + 4;
  }

  function appendLegalPagesText(doc, isValtech, company, logoData, num, fecha, brandFallback) {
    var urls = resolvePolicyUrls(!!isValtech);
    var companyName = pdfSafe(company || (isValtech ? 'VALTECH MAYORISTA S.A.S.' : 'IZC MAYORISTA S.A.S.'));
    var companyShort = pdfSafe(isValtech ? 'VALTECH' : 'IZC');
    var bannerTitle = isValtech ? 'VALTECH MAYORISTA SAS' : 'SOMOS AUTO RETENEDORES';
    var margin = 14;
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var maxW = pageW - margin * 2;
    var blue = [47, 124, 192];
    var nextPageNum = 2;
    var y;

    function newLegalPage(pageLabel) {
      doc.addPage();
      var label = pageLabel || ('Pagina ' + nextPageNum);
      nextPageNum += 1;
      y = pdfDrawBrandHeader(doc, logoData, brandFallback, label, num, fecha, margin);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(17, 17, 17);
    }

    function ensureSpace(need) {
      if (y > pageH - (need || 18)) {
        newLegalPage();
      }
    }

    function addCenterTitle(text) {
      ensureSpace(18);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(blue[0], blue[1], blue[2]);
      var lines = doc.splitTextToSize(pdfSafe(text), maxW);
      lines.forEach(function (line) {
        doc.text(line, pageW / 2, y, { align: 'center' });
        y += 5;
      });
      y += 2;
      doc.setTextColor(17, 17, 17);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
    }

    function addSub(text) {
      ensureSpace(16);
      doc.setFont('helvetica', 'bolditalic');
      doc.setFontSize(9.5);
      doc.setTextColor(blue[0], blue[1], blue[2]);
      y = pdfDrawWrapped(doc, text, margin, y, maxW, 4.4) + 1.5;
      doc.setTextColor(17, 17, 17);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
    }

    function addPara(text) {
      ensureSpace(16);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(17, 17, 17);
      y = pdfDrawWrapped(doc, text, margin, y, maxW, 4.2) + 2;
    }

    function addBullets(items) {
      items.forEach(function (it) {
        ensureSpace(14);
        y = pdfDrawWrapped(doc, '- ' + it, margin, y, maxW, 4.2) + 1.2;
      });
      y += 2;
    }

    function addLinkLabel(label, url) {
      if (!url) return;
      ensureSpace(14);
      var safe = pdfSafe(label || url);
      var prefix = '> ';
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(17, 17, 17);
      doc.text(prefix, margin, y);
      var px = margin + doc.getTextWidth(prefix);
      doc.setTextColor(blue[0], blue[1], blue[2]);
      var tw = doc.getTextWidth(safe);
      doc.text(safe, px, y);
      doc.setDrawColor(blue[0], blue[1], blue[2]);
      doc.setLineWidth(0.25);
      doc.line(px, y + 0.7, px + tw, y + 0.7);
      pdfAddLink(doc, px, y - 3.5, Math.max(tw, 8), 5, url);
      doc.setTextColor(17, 17, 17);
      y += 5.5;
    }

    /** Línea con prefijo negro + etiqueta azul clickeable (+ sufijo opcional). */
    function addInlineLinkLine(before, label, url, after) {
      ensureSpace(14);
      var beforeSafe = pdfSafe(before || '');
      var labelSafe = pdfSafe(label || '');
      var afterSafe = pdfSafe(after || '');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(17, 17, 17);
      var x = margin;
      if (beforeSafe) {
        doc.text(beforeSafe, x, y);
        x += doc.getTextWidth(beforeSafe);
      }
      doc.setTextColor(blue[0], blue[1], blue[2]);
      var tw = doc.getTextWidth(labelSafe);
      doc.text(labelSafe, x, y);
      doc.setDrawColor(blue[0], blue[1], blue[2]);
      doc.setLineWidth(0.25);
      doc.line(x, y + 0.7, x + tw, y + 0.7);
      pdfAddLink(doc, x, y - 3.5, Math.max(tw, 8), 5, url);
      if (afterSafe) {
        doc.setTextColor(17, 17, 17);
        doc.text(afterSafe, x + tw, y);
      }
      doc.setTextColor(17, 17, 17);
      y += 5.5;
    }

    // ——— Página 2: Condiciones comerciales (layout HTML de referencia) ———
    newLegalPage('Pagina 2');
    addCenterTitle('CONDICIONES COMERCIALES');
    addCenterTitle(bannerTitle);
    addPara('En ' + companyName + ' trabajamos para brindarle una experiencia comercial segura, transparente y eficiente. A continuación, compartimos nuestras condiciones comerciales vigentes:');
    addPara(companyName + ' es autorretenedor, por lo tanto, no debe realizarse ningún tipo de retención en los pagos.');

    addSub('Términos de Cotización');
    addBullets([
      'Cotizaciones en dólares: vigencia de 8 días.',
      'Cotizaciones en pesos colombianos: válidas solo el día de emisión.',
      'Los precios pueden cambiar sin previo aviso y dependen de la disponibilidad en inventario.',
      'Todas las facturas se emiten en pesos colombianos, indexadas al dólar con la TRM del día de facturación.',
      'El pago debe realizarse conforme a los términos indicados en la factura.'
    ]);

    addSub('Clientes Nuevos');
    addPara('Para registrarse como distribuidor, por favor diligencie el formulario en el siguiente enlace:');
    addLinkLabel('Inscripción como Distribuidor', urls.distribuidor);
    addSub('Documentos requeridos:');
    addBullets([
      'Certificado de Cámara de Comercio (máximo 30 días)',
      'RUT',
      'Cédula del representante legal'
    ]);

    addCenterTitle('DISPONIBILIDAD DE INVENTARIO');
    addPara(
      companyName + ' procura tener a disposición un inventario óptimo que satisfaga la demanda y proyección del mercado, basado en un adecuado forecast en las referencias de una permanente rotación; los productos que no estén disponibles en el inventario físico de ' +
      companyName +
      ' contarán con un tiempo estimado de entrega de 20 días, sobre orden de compra y anticipo, el cual no tendrá retorno en ninguno de los casos ajenos a la responsabilidad de ' +
      companyName +
      '. Los tiempos estimados son programados de acuerdo con las políticas de entregas por parte del fabricante; no obstante, pueden presentarse retrasos por parte de los mismos. ' +
      companyName +
      ' se encargará del debido seguimiento de las órdenes de compra requeridas y notificará toda novedad que pueda presentarse en estas, así como los diferentes procedimientos alternos, en pro de la prestación de un buen servicio. Para negociaciones puntuales es normal la exigencia de pago de anticipos mínimo del 30%. El incumplimiento por parte del distribuidor frente a la confirmación del pedido tendrá una multa del 15% sobre el valor total de la negociación.'
    );

    addCenterTitle('POLÍTICA DE PRODUCTOS BAJO PEDIDO');
    addPara('Con el fin de garantizar una gestión eficiente y servicio personalizado, aplicamos las siguientes condiciones para productos solicitados exclusivamente bajo pedido:');
    addSub('* Venta al Contado');
    addBullets([
      'Requiere anticipo del 30%, calculado al tipo de cambio del día.',
      'El pago del anticipo implica aceptación total de esta política.',
      'Se confirma y gestiona el pedido al recibir el anticipo.',
      'El saldo del 70% se paga al llegar el producto, con proforma actualizada a la TRM del día de llegada.',
      'La entrega se realiza únicamente con el pago completo.'
    ]);

    // ——— Página 3: continúa con Venta a Crédito (sin título falso de sección) ———
    newLegalPage('Pagina 3');
    addSub('>> Venta a Credito');
    addBullets([
      'El pedido se confirma con una Orden de Compra (OC), sin necesidad de consignar el anticipo.',
      'El anticipo del 30% será reservado del cupo de crédito disponible.',
      'El saldo del 70% se facturará al momento de llegada, según disponibilidad del cupo. Si no hay cupo, el valor deberá ser cancelado antes de la entrega.',
      'La entrega se realiza únicamente con el pago completo.'
    ]);
    addSub('! Condiciones Generales');
    addBullets([
      'El tiempo estimado de llegada será informado al confirmar el pedido y puede variar por temas logísticos o aduaneros.',
      'No se aceptan cancelaciones una vez confirmado el pedido.',
      'En caso de cancelación, el cliente deberá pagar el valor del anticipo como compensación por la gestión y logística.',
      companyName + ' determinará si el producto es o no de rotación, lo cual puede afectar la devolución del anticipo en caso de no retiro.'
    ]);

    addCenterTitle('FACTURACIÓN, TÉRMINOS Y FORMAS DE PAGO');
    addBullets([
      'Descuento Financiero: 1% para clientes a crédito que paguen dentro de los 5 días hábiles posteriores a la factura.',
      'Para garantizar la recepción correcta de facturas electrónicas, su correo debe coincidir con el registrado en el RUT.',
      'Por favor verifique y actualice su correo aquí:'
    ]);
    addLinkLabel('Actualización de Datos', urls.actualizacionDatos);
    addBullets([
      'Verifique su correo en el RUT.',
      'Actualícelo en nuestro portal.',
      'Asegure la correcta recepción de documentos fiscales.'
    ]);

    addCenterTitle(companyName.toUpperCase() + ' BRINDA DIFERENTES MODALIDADES DE PAGO:');
    addPara('Brindamos opciones flexibles para su comodidad:');
    addInlineLinkLine('- PSE: ', 'Pagos en Línea', urls.pse, '');
    addBullets([
      'Crédito con Aseguradora: sujeto a estudio ($103.000, reembolsable en la primera compra si es aprobado).',
      'Crédito Covifactura: sujeto a estudio y aprobación.'
    ].concat(isValtech ? [] : [
      'Factoring Bancolombia: aplica para clientes con cupo aprobado.',
      'Tarjeta de Crédito: disponible para su conveniencia.'
    ]));
    addPara('Créditos a 30 días. Pedidos mayores a USD 25.000: crédito hasta 45 días. Pasados los 30 días, se aplicarán intereses de mora según ley.');

    addCenterTitle('ENTREGAS');
    addBullets([
      'Sede Cota: lunes a viernes, 8:00 a.m. - 4:00 p.m.',
      'Sede Unilago: lunes a viernes, 9:00 a.m. - 6:00 p.m. / sábados, 9:00 a.m. - 1:00 p.m.'
    ]);
    addSub('[ ] Para recoger mercancia es necesario:');
    addBullets([
      'Sello de la empresa y/o carta membretada de autorización.',
      'Datos de la persona que retira (nombre, cédula, placas del vehículo).'
    ]);

    // ——— Página 4: continúa con Transporte ———
    newLegalPage('Pagina 4');
    addSub('# Transporte:');
    addBullets([
      'Contamos con convenio con TCC.',
      'Pedidos > $1.500.000: tarifa del 1,85% sobre el valor del pedido (antes de IVA) + IVA del flete.',
      'Pedidos < $1.500.000: $23.000 + IVA.'
    ]);

    addCenterTitle('ENTREGA A USUARIO FINAL');
    addPara(
      'La entrega a Usuario final solo podrá realizarse posterior a enviar autorización formal (formato establecido por ' +
      companyShort +
      ') por parte de ustedes como distribuidores y aplica para facturaciones realizadas por forma de pago Efectivo; casos excepcionales deberán ser aprobados por la Gerencia de la compañía de acuerdo con las políticas internas vigentes.'
    );

    addCenterTitle('DEVOLUCIONES DE PRODUCTO');
    addPara('La mercancía con carácter de Préstamo o Demo debe ser devuelta en los plazos establecidos en la solicitud; de lo contrario será facturada al cliente.');
    addPara('No se aceptan devolución de mercancía; en casos puntuales tendrán previa autorización de gerencia y un cobro del 10% que será facturado a nuestro distribuidor.');
    addPara('Para los casos en que son aprobadas la devolución de mercancía es importante que esté bajo las siguientes condiciones:');
    addBullets([
      'El producto debe estar en su empaque original y con los accesorios completos, como bolsas, medios de información, etc. Junto a copia de la factura y ticket de aprobación de la devolución.',
      'Solo se aceptarán devoluciones de productos que se encuentren vigentes (versiones actuales).',
      'No se aceptarán en devolución productos que hayan sido despachados bajo pedido especial.',
      'La devolución de los productos debe hacerse en reempaque para evitar los daños en el empaque original al pegar cinta o guías de transportadora.',
      'Los productos por daños en el transporte no se tienen en cuenta para devolución; se debe hacer el respectivo trámite con la transportadora, por lo cual se pide validar el estado del producto cuando sea entregado y dejar la nota en guía de recibido.'
    ]);

    addCenterTitle('DEVOLUCIONES DE DINERO');
    addLinkLabel(urls.devolucionDinero, urls.devolucionDinero);

    addCenterTitle('NORMAS Y POLITICAS DE GARANTIAS');
    if (isValtech) {
      addPara(
        'Todos los Productos comercializados por ' + companyName +
        ' cuentan con el respaldo y garantía de sus fabricantes y de sí misma. Para el detalle de políticas de garantía, remítase al enlace:'
      );
      addLinkLabel(urls.garantia, urls.garantia);
    } else {
      addPara(
        'Todos los Productos comercializados por ' + companyName +
        ' cuentan con el respaldo y garantía sea de sus fabricantes y de sí misma; algunos de ellos tienen centro de servicio u otras marcas es ' +
        companyShort +
        ' quien velará por brindar este servicio de acuerdo con las políticas internas de garantías. Las garantías de las marcas ACCUBANKER, BIXOLON, DATALOGIC, ELO, HONEYWELL, ZEBRA, son directamente con centro de Servicio; por favor remítase al enlace:'
      );
      addLinkLabel(urls.garantia, urls.garantia);
      addPara('para ver el detalle de cada uno de ellos.');
    }

    addCenterTitle('MATERIAL DE MERCADEO PARA DISTRIBUIDORES');
    addPara(
      companyShort +
      ' proporciona imágenes, logos, fichas técnicas y catálogos como herramientas para uso de la comercialización de los productos, los cuales podrán acceder en el siguiente link:'
    );
    addLinkLabel(urls.mercadeo, urls.mercadeo);
    addPara('Agradecemos su confianza en ' + companyName + '. Estas políticas están diseñadas para proteger sus intereses y asegurar una relación comercial fluida, clara y beneficiosa para ambas partes.');
  }

  /**
   * PDF nativo con texto seleccionable/copiable (no imagen).
   * Requiere jsPDF + autotable cargados en la pagina.
   * @param {object|null} logoData  { dataUrl, w, h } del logo de la empresa elegida
   */
  function buildSelectablePdfDoc(quote, extras, logoData) {
    var JsPDF = getJsPdfCtor();
    if (!JsPDF) return null;
    extras = extras || {};
    quote = enrichQuote(quote || {});
    var maps = nameMapsCache || { productos: {}, referencias: {} };
    var empresa = resolveQuoteEmpresa(quote, extras);
    var isValtech = isValtechEmpresa(empresa);
    var sender = resolveSender(empresa);
    var lines = buildLines(quote || {}, maps);
    var liq = buildFleteBlock(quote || {});
    var pdfCurrency = String(extras.currency || 'COP').toUpperCase();
    var isUsd = pdfCurrency === 'USD';
    var cliente = String((quote && quote.nombre) || extras.cliente || 'Cliente').trim();
    var nitCliente = String((quote && (quote.nit || quote.client_nit)) || extras.nit || '').replace(/[\s.]/g, '').trim();
    var telefono = String((quote && (quote.telefono || quote.client_telefono)) || extras.telefono || '').trim();
    var direccion = String((quote && (quote.direccion || quote.client_direccion)) || extras.direccion || '').trim();
    var vendedor = String(extras.vendedor || (quote && (quote.seller_name || quote.asesor_nombre)) || '').trim();
    var num = quoteNumber(quote, extras);
    if ((!telefono || !direccion) && nitCliente) {
      var contactHit = lookupClientContactCache(nitCliente);
      if (!telefono && contactHit.telefono) telefono = contactHit.telefono;
      if (!direccion && contactHit.direccion) direccion = contactHit.direccion;
    }
    var fecha = resolveQuoteDate(quote, extras);
    var companyLegal = isValtech ? 'VALTECH MAYORISTA S.A.S.' : 'IZC MAYORISTA S.A.S.';

    var doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    var margin = 12;
    var pageW = doc.internal.pageSize.getWidth();
    var y = pdfDrawBrandHeader(doc, logoData || null, sender.brand, '', num, fecha, margin);

    doc.setTextColor(47, 124, 192);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(pdfSafe(sender.enviadaPorLabel || 'ENVIADA POR'), margin, y);
    doc.text('SOLICITADA POR', pageW / 2 + 2, y);
    y += 5;
    doc.setTextColor(17, 17, 17);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    var leftX = margin;
    var rightX = pageW / 2 + 2;
    var leftMax = pageW / 2 - margin - 4;
    var rightMax = pageW / 2 - margin - 4;
    var yLeft = y;
    var yRight = y;
    yLeft = pdfDrawWrapped(doc, sender.brand, leftX, yLeft, leftMax, 4);
    yLeft = pdfDrawWrapped(doc, 'NIT: ' + sender.nit, leftX, yLeft, leftMax, 4);
    if (sender.web) yLeft = pdfDrawWrapped(doc, 'Web: ' + sender.web, leftX, yLeft, leftMax, 4);
    yLeft = pdfDrawWrapped(doc, 'Dir: ' + sender.address, leftX, yLeft, leftMax, 4);
    yLeft = pdfDrawWrapped(doc, 'Vendedor: ' + (vendedor || '—'), leftX, yLeft, leftMax, 4);

    yRight = pdfDrawWrapped(doc, 'Cliente: ' + cliente, rightX, yRight, rightMax, 4);
    if (nitCliente) yRight = pdfDrawWrapped(doc, 'NIT: ' + nitCliente, rightX, yRight, rightMax, 4);
    yRight = pdfDrawWrapped(doc, 'Negociacion #' + (num || '—'), rightX, yRight, rightMax, 4);
    yRight = pdfDrawWrapped(doc, 'Telefono: ' + (telefono || '—'), rightX, yRight, rightMax, 4);
    yRight = pdfDrawWrapped(doc, 'Direccion: ' + (direccion || '—'), rightX, yRight, rightMax, 4);
    y = Math.max(yLeft, yRight) + 6;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(22, 83, 160);
    doc.setFontSize(10);
    doc.text(pdfSafe(isUsd ? 'Valores en dolares (USD)' : 'Valores en pesos (COP)'), margin, y);
    y += 3;
    doc.setTextColor(17, 17, 17);

    var head;
    var body = [];
    var fichaLinks = [];
    function fichaLabelForSku(sku, unitUsd) {
      var s = String(sku || '').trim();
      if (!s || s === '-' || s === '\u2014' || !catalogHasSku(s)) {
        return { text: 'Sin ficha', url: '' };
      }
      var url = productFichaPageUrl(s, unitUsd);
      if (!url) return { text: 'Sin ficha', url: '' };
      return { text: 'Ver ficha', url: url };
    }
    if (isUsd) {
      head = [['N', 'Ficha Tecnica', 'SKU', 'REF', 'DESCRIPCION', 'CANT', 'P. unit.', '+ IVA', 'Total']];
      lines.forEach(function (row) {
        var sinIva = row.ivaExempt === true || !(Number(row.precioIva) > 0);
        var unitUsdIva = sinIva ? 0 : (Number(row.precioUsdIva) > 0 ? Number(row.precioUsdIva) : row.precioUsd * (1 + IVA));
        var totalUsd = Number(row.totalUsd);
        if (!isFinite(totalUsd) || totalUsd < 0) totalUsd = (sinIva ? row.precioUsd : unitUsdIva) * row.qty;
        var fichaUsd = fichaLabelForSku(row.sku, row.precioUsd);
        if (fichaUsd.url) fichaLinks.push({ row: body.length, url: fichaUsd.url });
        body.push([
          String(row.n),
          fichaUsd.text,
          pdfSafe(row.sku || ''),
          pdfSafe(row.referencia || '—'),
          pdfSafe(row.descripcion || ''),
          String(row.qty),
          pdfSafe(formatUsdAmount(row.precioUsd)),
          pdfSafe(formatUsdAmount(unitUsdIva)),
          pdfSafe(formatUsdAmount(totalUsd))
        ]);
      });
      body.push([
        String(lines.length + 1), '—', '—', '—', pdfSafe(liq.fleteLabel), '1',
        pdfSafe(formatUsdAmount(liq.fleteAntesUsd)),
        pdfSafe(formatUsdAmount(liq.fleteAntesUsd + liq.fleteIvaUsd)),
        pdfSafe(formatUsdAmount(liq.fleteAntesUsd + liq.fleteIvaUsd))
      ]);
    } else {
      head = [['N', 'Ficha Tecnica', 'SKU', 'REF', 'DESCRIPCION', 'CANT', 'P. unit.', 'P. unit.', 'IVA', 'Total']];
      lines.forEach(function (row) {
        var fichaCop = fichaLabelForSku(row.sku, row.precioUsd);
        if (fichaCop.url) fichaLinks.push({ row: body.length, url: fichaCop.url });
        body.push([
          String(row.n),
          fichaCop.text,
          pdfSafe(row.sku || ''),
          pdfSafe(row.referencia || '—'),
          pdfSafe(row.descripcion || ''),
          String(row.qty),
          pdfSafe(formatUsdAmount(row.precioUsd)),
          pdfSafe(formatPesosAmount(row.precio)),
          pdfSafe(formatPesosAmount(row.precioIva)),
          pdfSafe(formatPesosAmount(row.total))
        ]);
      });
      body.push([
        String(lines.length + 1), '—', '—', '—', pdfSafe(liq.fleteLabel), '1',
        pdfSafe(formatUsdAmount(liq.fleteAntesUsd)),
        pdfSafe(formatPesosAmount(liq.fleteAntes)),
        pdfSafe(formatPesosAmount(liq.fleteIva)),
        pdfSafe(formatPesosAmount(liq.fleteAntes + liq.fleteIva))
      ]);
    }

    if (typeof doc.autoTable !== 'function') {
      return null;
    }

    doc.autoTable({
      startY: y,
      head: head,
      body: body,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 7,
        cellPadding: 1.2,
        overflow: 'linebreak',
        valign: 'middle'
      },
      headStyles: {
        fillColor: [236, 236, 236],
        textColor: [17, 17, 17],
        fontStyle: 'bold',
        halign: 'center'
      },
      columnStyles: isUsd
        ? {
            0: { cellWidth: 7,halign: 'center' },
            1: { cellWidth: 16,halign: 'center' },
            5: {halign: 'center' },
            6: {halign: 'right' },
            7: {halign: 'right' },
            8: {halign: 'right' }
          }
        : {
            0: { cellWidth: 7,halign: 'center' },
            1: { cellWidth: 15,halign: 'center' },
            5: {halign: 'center' },
            6: {halign: 'right' },
            7: {halign: 'right' },
            8: {halign: 'right' },
            9: {halign: 'right' }
          },
      margin: { left: margin, right: margin },
      didParseCell: function (data) {
        if (data.section !== 'body' || data.column.index !== 1) return;
        var txt = String(data.cell.raw != null ? data.cell.raw : (data.cell.text || ''));
        if (txt.indexOf('Sin ficha') !== -1) {
          data.cell.styles.textColor = [136, 136, 136];
        } else if (txt.indexOf('Ver ficha') !== -1) {
          data.cell.styles.textColor = [47, 124, 192];
        }
      },
      didDrawCell: function (data) {
        if (data.section !== 'body' || data.column.index !== 1) return;
        var hit = null;
        for (var li = 0; li < fichaLinks.length; li++) {
          if (fichaLinks[li].row === data.row.index) { hit = fichaLinks[li]; break; }
        }
        if (!hit || !hit.url) return;
        pdfAddLink(doc, data.cell.x, data.cell.y, data.cell.width, data.cell.height, hit.url);
      }
    });

    y = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 6 : y + 40;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    var totalsX = pageW - margin;
    function totalLine(label, value, bold) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      if (bold) doc.setTextColor(22, 83, 160);
      else doc.setTextColor(17, 17, 17);
      doc.text(pdfSafe(label), totalsX - 70, y, { align: 'left' });
      doc.text(pdfSafe(value), totalsX, y, { align: 'right' });
      y += 5;
    }
    if (isUsd) {
      var subUsd = 0;
      lines.forEach(function (row) {
        var sinIva = row.ivaExempt === true || !(Number(row.precioIva) > 0);
        var unitUsdIva = sinIva ? 0 : (Number(row.precioUsdIva) > 0 ? Number(row.precioUsdIva) : row.precioUsd * (1 + IVA));
        var totalUsd = Number(row.totalUsd);
        if (!isFinite(totalUsd) || totalUsd < 0) totalUsd = (sinIva ? row.precioUsd : unitUsdIva) * row.qty;
        subUsd += totalUsd;
      });
      totalLine('Subtotal productos (USD)', formatUsd(subUsd), false);
      totalLine('Flete', formatUsd(liq.fleteAntesUsd), false);
      if (liq.fleteIva > 0.005) {
        totalLine('IVA flete (19 %)', formatUsd(liq.fleteIvaUsd), false);
      }
      totalLine('TOTAL A PAGAR', formatUsd(subUsd + liq.fleteAntesUsd + liq.fleteIvaUsd), true);
    } else {
      totalLine('Subtotal productos (COP + IVA)', formatPesos(liq.subtotal), false);
      totalLine('Flete', formatPesos(liq.fleteAntes), false);
      if (liq.fleteIva > 0.005) {
        totalLine('IVA flete (19 %)', formatPesos(liq.fleteIva), false);
      }
      totalLine('TOTAL A PAGAR', formatPesos(liq.totalPagar), true);
    }
    doc.setTextColor(17, 17, 17);

    appendLegalPagesText(doc, isValtech, companyLegal, logoData || null, num, fecha, sender.brand);
    return doc;
  }

  function pdfBlobFromDataUri(dataUri) {
    var parts = String(dataUri || '').split(',');
    if (parts.length < 2) return null;
    try {
      var bin = atob(parts[1] || '');
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: 'application/pdf' });
    } catch (eB) {
      return null;
    }
  }

  function absUrl(url) {
    try {
      return new URL(String(url || ''), window.location.href).href;
    } catch (eU) {
      return String(url || '');
    }
  }

  /** Guarda bytes PDF reales con el nombre Cotizacion #N.pdf (nunca UUID de blob:). */
  function triggerNamedPdfDownload(filename, blob) {
    var name = String(filename || 'Cotizacion.pdf');
    if (!blob) return false;
    var file = blob;
    try {
      file = new File([blob], name, { type: 'application/pdf' });
    } catch (eFile) {
      file = blob;
    }
    try {
      if (window.navigator && typeof navigator.msSaveOrOpenBlob === 'function') {
        navigator.msSaveOrOpenBlob(file, name);
        return true;
      }
    } catch (eMs) { /* ignore */ }
    var url = '';
    try {
      url = URL.createObjectURL(file);
    } catch (eUrl) {
      return false;
    }
    try {
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { a.remove(); } catch (eRm) { /* ignore */ }
        try { URL.revokeObjectURL(url); } catch (eRev) { /* ignore */ }
      }, 90000);
      return true;
    } catch (eA) {
      try { URL.revokeObjectURL(url); } catch (eRev2) { /* ignore */ }
      return false;
    }
  }

  /** Guarda bytes PDF reales (nunca print → Save as PDF del viewer). */
  function savePdfBytes(filename, blob, downloadUrl) {
    var name = String(filename || 'Cotizacion.pdf');
    function pickerSave(b) {
      if (!b || !window.showSaveFilePicker || !window.isSecureContext) {
        return Promise.resolve(false);
      }
      return window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
      }).then(function (handle) {
        return handle.createWritable().then(function (writable) {
          return writable.write(b).then(function () {
            return writable.close();
          });
        }).then(function () { return true; });
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return true;
        return false;
      });
    }

    return pickerSave(blob).then(function (ok) {
      if (ok) return true;
      // Preferir blob+nombre (evita “descarga no segura” de attachment HTTP).
      if (blob && triggerNamedPdfDownload(name, blob)) return true;
      // Solo en HTTPS el attachment del servidor suele funcionar bien.
      if (downloadUrl && window.isSecureContext && /^https:/i.test(String(window.location.protocol))) {
        try {
          var a = document.createElement('a');
          a.href = absUrl(downloadUrl);
          a.download = name;
          a.rel = 'noopener';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            try { a.remove(); } catch (eRm) { /* ignore */ }
          }, 1500);
          return true;
        } catch (eA) { /* ignore */ }
      }
      return false;
    });
  }

  function navigateWindowToPdf(w, pdfUrl) {
    if (!w || !pdfUrl) return false;
    try {
      if (w.closed) return false;
    } catch (eClosed) {
      return false;
    }
    try {
      w.location.href = pdfUrl;
      try { w.focus(); } catch (eF) { /* ignore */ }
      return true;
    } catch (eNav) {
      return false;
    }
  }

  /**
   * Vista previa del PDF + botón Descargar con nombre Cotizacion #N.pdf.
   * Preferir URL HTTP del servidor (Content-Disposition → nombre en el visor).
   * Si solo hay blob:, el botón Descargar igual guarda con el consecutivo.
   */
  function buildPdfLauncherHtml(filename, pdfUrl) {
    var name = String(filename || 'Cotizacion.pdf');
    var url = String(pdfUrl || '');
    var nameEsc = escapeHtml(name);
    var urlEsc = escapeHtml(url);
    var isBlob = /^blob:/i.test(url);
    var hint = isBlob
      ? 'Use el botón <b>Descargar PDF</b> para guardar como <b>' + nameEsc + '</b> (no la flecha del visor).'
      : 'Puede usar <b>Descargar PDF</b> o la flecha ↓ del visor. El archivo se llamará <b>' + nameEsc + '</b>.';
    return (
      '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + nameEsc + '</title>' +
      '<style>' +
      'html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#1a1a1a;font-family:Segoe UI,Arial,sans-serif;}' +
      'body{display:flex;flex-direction:column;}' +
      '.bar{flex-shrink:0;display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:10px 14px;background:#111;color:#eee;border-bottom:1px solid #333;}' +
      '.bar .title{font-weight:700;font-size:14px;margin-right:4px;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.bar .hint{flex:1 1 180px;font-size:12px;color:#bbb;line-height:1.35;min-width:0;}' +
      '.bar .dl{flex-shrink:0;appearance:none;border:0;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:700;cursor:pointer;background:#c45c26;color:#fff;}' +
      '.bar .dl:hover{filter:brightness(1.08);}' +
      '.bar .dl:disabled{opacity:.6;cursor:wait;}' +
      '#frameWrap{flex:1;position:relative;min-height:0;}' +
      '#pdfFrame{position:absolute;inset:0;width:100%;height:100%;border:0;background:#525659;}' +
      '@media (max-width:720px){.bar .title{max-width:100%;}}' +
      '</style></head><body>' +
      '<div class="bar">' +
        '<div class="title" title="' + nameEsc + '">' + nameEsc + '</div>' +
        '<button type="button" class="dl" id="izcPdfDownloadBtn">Descargar PDF</button>' +
        '<div class="hint">' + hint + '</div>' +
      '</div>' +
      '<div id="frameWrap"><iframe id="pdfFrame" src="' + urlEsc + '" title="' + nameEsc + '"></iframe></div>' +
      '<script>(function(){' +
        'var btn=document.getElementById("izcPdfDownloadBtn");' +
        'if(!btn)return;' +
        'btn.addEventListener("click",function(){' +
          'btn.disabled=true;' +
          'var done=false;' +
          'try{' +
            'if(window.opener&&!window.opener.closed&&typeof window.opener.__IZC_saveCotizacionPdf==="function"){' +
              'var r=window.opener.__IZC_saveCotizacionPdf();' +
              'if(r&&typeof r.then==="function"){r.then(function(){btn.disabled=false;}).catch(function(){btn.disabled=false;});done=true;}' +
              'else{done=true;setTimeout(function(){btn.disabled=false;},800);}' +
            '}' +
          '}catch(e){}' +
          'if(!done){' +
            'try{' +
              'var a=document.createElement("a");' +
              'a.href=' + JSON.stringify(url) + ';' +
              'a.download=' + JSON.stringify(name) + ';' +
              'a.rel="noopener";' +
              'document.body.appendChild(a);a.click();a.remove();' +
            '}catch(e2){}' +
            'setTimeout(function(){btn.disabled=false;},800);' +
          '}' +
        '});' +
      '})();<\/script>' +
      '</body></html>'
    );
  }

  function stashPdfBytes(filename, dataUri, downloadUrl, blobOverride) {
    var blob = blobOverride || null;
    if (!blob) {
      try {
        blob = pdfBlobFromDataUri(dataUri);
      } catch (eB) {
        blob = null;
      }
    }
    var name = String(filename || 'Cotizacion.pdf');
    try {
      window.__IZC_PDF_SAVE = {
        filename: name,
        blob: blob,
        dataUri: dataUri || '',
        downloadUrl: downloadUrl ? String(downloadUrl) : '',
        at: Date.now()
      };
    } catch (eStash) { /* ignore */ }

    window.__IZC_saveCotizacionPdf = function () {
      var pack = window.__IZC_PDF_SAVE || {};
      var fname = String(pack.filename || name || 'Cotizacion.pdf');
      var blobLocal = pack.blob || null;

      function ensureBlob() {
        if (blobLocal) return Promise.resolve(blobLocal);
        if (pack.dataUri) {
          try {
            blobLocal = pdfBlobFromDataUri(pack.dataUri);
          } catch (e2) {
            blobLocal = null;
          }
          if (blobLocal) return Promise.resolve(blobLocal);
        }
        var existing = '';
        if (pack.downloadUrl) {
          existing = absUrl(String(pack.downloadUrl).replace(/&?dl=1/, '').replace(/\?&/, '?').replace(/\?$/, ''));
        }
        if (!existing) return Promise.resolve(null);
        return fetch(existing, { credentials: 'same-origin' })
          .then(function (res) {
            if (!res.ok) throw new Error('fetch pdf');
            return res.blob();
          })
          .then(function (b) {
            blobLocal = b;
            try { window.__IZC_PDF_SAVE.blob = b; } catch (eUp) { /* ignore */ }
            return b;
          })
          .catch(function () {
            return null;
          });
      }

      return ensureBlob().then(function (b) {
        return savePdfBytes(fname, b, pack.downloadUrl || '');
      }).then(function (ok) {
        return { ok: !!ok, filename: fname };
      });
    };

    return blob;
  }

  function dataUriFromPdfBlob(blob) {
    if (!blob) return Promise.resolve('');
    return new Promise(function (resolve) {
      try {
        var reader = new FileReader();
        reader.onload = function () {
          resolve(String(reader.result || ''));
        };
        reader.onerror = function () {
          resolve('');
        };
        reader.readAsDataURL(blob);
      } catch (e) {
        resolve('');
      }
    });
  }

  function resolvePdfUrlsFromResponse(data, filename) {
    var viewUrl = (data && data.ok && data.view_url) ? String(data.view_url) : '';
    var downloadUrl = (data && data.ok && data.download_url)
      ? String(data.download_url)
      : (viewUrl ? (viewUrl + (viewUrl.indexOf('?') >= 0 ? '&' : '?') + 'dl=1') : '');
    return {
      viewUrl: viewUrl,
      downloadUrl: downloadUrl,
      filename: (data && data.filename) || filename
    };
  }

  function resolvePdfUrl(viewUrl, dataUri, blob) {
    var pdfUrl = '';
    var blobUrl = '';
    if (viewUrl) {
      pdfUrl = absUrl(viewUrl);
    } else if (blob) {
      try {
        blobUrl = URL.createObjectURL(blob);
        pdfUrl = blobUrl;
      } catch (eObj) {
        pdfUrl = '';
      }
    } else if (dataUri) {
      var b2 = pdfBlobFromDataUri(dataUri);
      if (b2) {
        try {
          blobUrl = URL.createObjectURL(b2);
          pdfUrl = blobUrl;
        } catch (eObj2) {
          pdfUrl = '';
        }
      }
      if (!pdfUrl && /^data:application\/pdf/i.test(String(dataUri))) {
        pdfUrl = String(dataUri);
      }
    }
    return { pdfUrl: pdfUrl, blobUrl: blobUrl };
  }

  function openPdfLauncher(targetWin, filename, pdfUrl) {
    if (!pdfUrl) return false;
    var url = String(pdfUrl);
    var okScheme = /^https?:\/\//i.test(url) || /^blob:/i.test(url);
    if (!okScheme) return false;
    var html = buildPdfLauncherHtml(filename, url);
    var w = targetWin || null;
    try {
      if (w && w.closed) w = null;
    } catch (eC) {
      w = null;
    }
    if (w && writeHtmlToWindow(w, html)) return true;
    try {
      var wNew = window.open('', '_blank');
      if (wNew && writeHtmlToWindow(wNew, html)) return true;
    } catch (eOpen) { /* ignore */ }
    try {
      if (w) {
        w.location.href = url;
        try { w.focus(); } catch (eF) { /* ignore */ }
        return true;
      }
      window.open(url, '_blank');
      return true;
    } catch (eNav) {
      return false;
    }
  }

  function uploadPdfTemp(doc, filename) {
    var blob = null;
    try {
      blob = doc.output('blob');
    } catch (eBlob) {
      blob = null;
    }
    var dataUriPromise = blob
      ? dataUriFromPdfBlob(blob)
      : Promise.resolve((function () {
          try { return doc.output('datauristring'); } catch (eOut) { return ''; }
        })());

    return dataUriPromise.then(function (dataUri) {
      if (!blob && dataUri) {
        try { blob = pdfBlobFromDataUri(dataUri); } catch (eB2) { blob = null; }
      }
      if (!blob && !dataUri) {
        return { dataUri: '', viewUrl: '', downloadUrl: '', filename: filename, blob: null };
      }

      var endpoint = absUrl('api/cotizacion_pdf_tmp.php');

      function parseJsonSafe(res) {
        return res.text().then(function (text) {
          try {
            return JSON.parse(text);
          } catch (eJ) {
            return null;
          }
        });
      }

      var multipart = Promise.resolve(null);
      if (blob) {
        try {
          var fd = new FormData();
          var fileObj = blob;
          try {
            fileObj = new File([blob], filename, { type: 'application/pdf' });
          } catch (eF) {
            fileObj = blob;
          }
          fd.append('file', fileObj, filename);
          fd.append('filename', filename);
          multipart = fetch(endpoint, {
            method: 'POST',
            credentials: 'same-origin',
            body: fd
          }).then(parseJsonSafe).catch(function () { return null; });
        } catch (eFd) {
          multipart = Promise.resolve(null);
        }
      }

      return multipart.then(function (data) {
        var urls = resolvePdfUrlsFromResponse(data, filename);
        if (urls.viewUrl) {
          return {
            dataUri: dataUri,
            viewUrl: urls.viewUrl,
            downloadUrl: urls.downloadUrl,
            filename: urls.filename,
            blob: blob
          };
        }
        var base64 = String(dataUri || '').replace(/^data:application\/pdf;base64,/i, '');
        if (!base64) {
          return { dataUri: dataUri, viewUrl: '', downloadUrl: '', filename: filename, blob: blob };
        }
        return fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ pdf_base64: base64, filename: filename })
        }).then(parseJsonSafe).then(function (data2) {
          var urls2 = resolvePdfUrlsFromResponse(data2, filename);
          return {
            dataUri: dataUri,
            viewUrl: urls2.viewUrl,
            downloadUrl: urls2.downloadUrl,
            filename: urls2.filename || filename,
            blob: blob
          };
        }).catch(function () {
          return { dataUri: dataUri, viewUrl: '', downloadUrl: '', filename: filename, blob: blob };
        });
      });
    });
  }

  function showPdfPrepError(w, filename, detail) {
    var nameEsc = escapeHtml(filename || 'Cotizacion.pdf');
    var detailEsc = escapeHtml(detail || 'No se pudo publicar el PDF en el servidor.');
    var html =
      '<!doctype html><html><head><meta charset="utf-8"><title>' + nameEsc + '</title></head>' +
      '<body style="font-family:Segoe UI,Arial,sans-serif;padding:28px;color:#333;max-width:520px">' +
      '<h2 style="margin:0 0 12px;font-size:18px;">No se pudo preparar el PDF</h2>' +
      '<p style="margin:0 0 10px;line-height:1.45;">' + detailEsc + '</p>' +
      '<p style="margin:0;color:#666;font-size:13px;line-height:1.4;">Cierre esta pestaña, genere de nuevo la cotización e intente otra vez. ' +
      'El archivo debe quedar como <b>' + nameEsc + '</b>.</p>' +
      '</body></html>';
    if (w) {
      try {
        writeHtmlToWindow(w, html);
        return true;
      } catch (eW) { /* ignore */ }
    }
    return false;
  }

  function deliverPdfDoc(doc, quote, extras) {
    if (!doc) return Promise.resolve(false);
    var num = quoteNumber(quote, extras) || 'cotizacion';
    var safeNum = String(num).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'cotizacion';
    var filename = 'Cotizacion #' + safeNum + '.pdf';
    extras = extras || {};

    var w = null;
    try {
      w = extras.targetWindow && !extras.targetWindow.closed ? extras.targetWindow : null;
    } catch (eTw) {
      w = null;
    }

    if (w) {
      try {
        writeHtmlToWindow(
          w,
          '<!doctype html><html><head><meta charset="utf-8"><title>Preparando PDF…</title></head>' +
          '<body style="font-family:Segoe UI,Arial,sans-serif;padding:28px;color:#333">' +
          '<p>Preparando PDF…</p></body></html>'
        );
      } catch (ePrep) { /* ignore */ }
    }

    return uploadPdfTemp(doc, filename).then(function (pack) {
      var dataUri = pack && pack.dataUri ? pack.dataUri : '';
      var viewUrl = pack && pack.viewUrl ? absUrl(pack.viewUrl) : '';
      var downloadUrl = pack && pack.downloadUrl ? absUrl(pack.downloadUrl) : '';
      var blob = (pack && pack.blob) || null;
      if (!blob && dataUri) {
        try { blob = pdfBlobFromDataUri(dataUri); } catch (eBlob) { blob = null; }
      }

      // Sin URL HTTP: vista local + botón Descargar (NO auto-descarga: Chrome la bloquea en HTTP).
      if (!viewUrl) {
        if (!blob && !dataUri) {
          showPdfPrepError(w, filename, 'No se pudo generar el PDF en el navegador.');
          return false;
        }
        stashPdfBytes(filename, dataUri, '', blob);
        var resolved = resolvePdfUrl('', dataUri, blob);
        if (resolved.pdfUrl && openPdfLauncher(w, filename, resolved.pdfUrl)) return true;
        try { savePdfBytes(filename, blob, ''); } catch (eSave) { /* ignore */ }
        if (w) {
          showPdfPrepError(
            w,
            filename,
            'Use Descargas del navegador. El archivo debe llamarse ' + filename + '.'
          );
        }
        return true;
      }
      if (!downloadUrl) {
        downloadUrl = viewUrl + (viewUrl.indexOf('?') >= 0 ? '&' : '?') + 'dl=1';
      }
      stashPdfBytes(filename, dataUri, downloadUrl, blob);
      // Vista por URL del servidor → el visor muestra Cotizacion #N.pdf (no UUID).
      // No auto-descargar: en HTTP Chrome marca “descarga no segura”.
      if (openPdfLauncher(w, filename, viewUrl)) return true;
      try {
        savePdfBytes(filename, blob, downloadUrl);
        return true;
      } catch (eDl) {
        showPdfPrepError(w, filename, 'No se pudo abrir ni descargar el PDF. Permita ventanas emergentes e intente de nuevo.');
        return false;
      }
    }).catch(function () {
      var blobFb = null;
      try { blobFb = doc.output('blob'); } catch (eB0) { blobFb = null; }
      var cont = function (dataUriFb2, blobFb2) {
        if (blobFb2 || dataUriFb2) {
          stashPdfBytes(filename, dataUriFb2, '', blobFb2);
          var resolvedFb = resolvePdfUrl('', dataUriFb2, blobFb2);
          if (resolvedFb.pdfUrl && openPdfLauncher(w, filename, resolvedFb.pdfUrl)) return true;
          try { savePdfBytes(filename, blobFb2, ''); } catch (eS2) { /* ignore */ }
          return true;
        }
        showPdfPrepError(w, filename, 'Error de red al subir el PDF temporal.');
        return false;
      };
      if (blobFb) {
        return dataUriFromPdfBlob(blobFb).then(function (du) {
          return cont(du, blobFb);
        });
      }
      var dataUriFb = '';
      try { dataUriFb = doc.output('datauristring'); } catch (eOut) { dataUriFb = ''; }
      try { blobFb = dataUriFb ? pdfBlobFromDataUri(dataUriFb) : null; } catch (eB2) { blobFb = null; }
      return cont(dataUriFb, blobFb);
    });
  }

  function openSelectablePdf(quote, extras) {
    extras = extras || {};
    var empresa = resolveQuoteEmpresa(quote || {}, extras);
    var sender = resolveSender(empresa);
    return loadLogoDataUrl(sender.logo).then(function (logoData) {
      var doc = buildSelectablePdfDoc(quote, extras, logoData);
      if (!doc) return false;
      return deliverPdfDoc(doc, quote, extras);
    }).catch(function () {
      var docFb = buildSelectablePdfDoc(quote, extras, null);
      if (!docFb) return false;
      return deliverPdfDoc(docFb, quote, extras);
    });
  }

  function writeHtmlToWindow(w, html) {
    if (!w) return false;
    try {
      if (w.closed) return false;
    } catch (eClosed) {
      return false;
    }
    // 1) document.write (rápido)
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
      try { w.focus(); } catch (eFocus) { /* ignore */ }
      return true;
    } catch (eWrite) { /* seguir con blob */ }
    // 2) blob URL (evita bloqueos de about:blank / origen opaco)
    try {
      var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      w.location.href = url;
      setTimeout(function () {
        try { URL.revokeObjectURL(url); } catch (eRev) { /* ignore */ }
      }, 120000);
      try { w.focus(); } catch (eFocus2) { /* ignore */ }
      return true;
    } catch (eBlob) {
      return false;
    }
  }

  function openCotizacionPdf(quote, extras) {
    extras = extras || {};
    var openHtmlFallback = function (q) {
      var html = buildPdfHtml(q, extras);
      var w = extras.targetWindow || null;
      if (w) {
        try {
          if (w.closed) w = null;
        } catch (eClosed) {
          w = null;
        }
      }
      if (w && writeHtmlToWindow(w, html)) {
        return true;
      }
      w = null;
      try {
        w = window.open('', '_blank');
      } catch (eOpen) {
        w = null;
      }
      if (!w) {
        alert('Permite ventanas emergentes para descargar el PDF.');
        return false;
      }
      if (!writeHtmlToWindow(w, html)) {
        alert('No se pudo escribir el PDF en la ventana. Prueba de nuevo o permite pop-ups.');
        return false;
      }
      return true;
    };

    var run = function () {
      var q = enrichQuote(quote || {});
      // Preferir PDF nativo con texto seleccionable/copiable (no rasterizado).
      if (getJsPdfCtor()) {
        return openSelectablePdf(q, extras).then(function (ok) {
          if (ok) return true;
          return openHtmlFallback(q);
        }).catch(function (ePdf) {
          try { console.warn('PDF texto falló, usando vista HTML', ePdf); } catch (eW) { /* ignore */ }
          return openHtmlFallback(q);
        });
      }
      return Promise.resolve(openHtmlFallback(q));
    };

    var nitForContact = String(
      (quote && (quote.nit || quote.client_nit)) || extras.nit || ''
    ).replace(/[\s.]/g, '').trim();

    var mapsReady = Promise.all([
      loadProductNameMaps(),
      loadLpPriceMaps(),
      loadCatalogSkuSet(),
      loadDefaultTrm(),
      resolveClientContactForPdf(nitForContact)
    ]).then(function (parts) {
      var contact = parts[4] || { telefono: '', direccion: '' };
      if (!extras.telefono && contact.telefono) extras.telefono = contact.telefono;
      if (!extras.direccion && contact.direccion) extras.direccion = contact.direccion;
      return true;
    }).catch(function () {
      return false;
    });

    // Si los mapas ya están en memoria y la cotización trae TRM + contacto, escribir ya.
    var quoteTrm = Number(quote && quote.trm);
    var trmReady = (isFinite(quoteTrm) && quoteTrm > 0) || defaultTrmCache > 0;
    var contactReady = !nitForContact || !!clientContactByNitCache[normalizeNitKey(nitForContact)];
    if (nameMapsCache && lpPriceMapsCache && catalogSkuSetCache && trmReady && contactReady) {
      return resolveClientContactForPdf(nitForContact).then(function (contact) {
        if (!extras.telefono && contact.telefono) extras.telefono = contact.telefono;
        if (!extras.direccion && contact.direccion) extras.direccion = contact.direccion;
        return run();
      }).catch(function () {
        return run();
      });
    }

    return mapsReady.then(function () {
      return run();
    }).catch(function () {
      return run();
    });
  }

  global.IZCCotizacionPdf = {
    open: function (quote, extras) {
      var p = openCotizacionPdf(quote, extras);
      if (p && typeof p.then === 'function') {
        return p.then(function (ok) {
          if (ok === false) {
            try {
              alert('No se pudo descargar el PDF. Recarga la página e inténtalo de nuevo.');
            } catch (eAlert) { /* ignore */ }
          }
          return !!ok;
        }).catch(function () {
          return false;
        });
      }
      return Promise.resolve(!!p);
    },
    buildHtml: function (quote, extras) {
      return buildPdfHtml(enrichQuote(quote || {}), extras || {});
    },
    loadNameMaps: loadProductNameMaps,
    loadLpPriceMaps: loadLpPriceMaps,
    loadDefaultTrm: loadDefaultTrm,
    preload: function () {
      return Promise.all([
        loadProductNameMaps(),
        loadLpPriceMaps(),
        loadCatalogSkuSet(),
        loadDefaultTrm(),
        loadClientContactMaps(),
        loadLogoDataUrl(IZC_SENDER.logo),
        loadLogoDataUrl(VALTECH_SENDER.logo)
      ]);
    },
    enrichQuote: enrichQuote,
    resolveProductName: resolveProductName,
    resolveLineDisplay: resolveLineDisplay,
    resolveReferencia: resolveReferencia,
    isValtech: isValtechEmpresa,
    resolveSender: resolveSender,
    quoteNumber: quoteNumber,
    isLikelyBitrixDealId: isLikelyBitrixDealId
  };

  function watchDefaultTrm() {
    if (window.__IZC_PDF_TRM_WATCH__) return;
    if (!window.IZCLiveSync || typeof IZCLiveSync.on !== 'function') return;
    window.__IZC_PDF_TRM_WATCH__ = true;
    IZCLiveSync.on(function (msg) {
      var t = msg && msg.type;
      if (t === IZCLiveSync.TYPES.TRM || t === IZCLiveSync.TYPES.ALL) {
        loadDefaultTrm(true);
      }
    });
  }
  watchDefaultTrm();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchDefaultTrm);
  } else {
    watchDefaultTrm();
  }
})(window);
