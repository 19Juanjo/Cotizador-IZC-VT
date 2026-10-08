/* Utilidades compartidas: USD con ROUNDDOWN a 2 decimales. */
(function () {
  'use strict';

  if (window.IZCMoney) return;

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

  function roundUsd(value) {
    return excelRoundDown(value, 2);
  }

  function roundCop(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.round(n);
  }

  /**
   * USD y COP siempre se convierten con la TRM.
   * prefer: 'usd' | 'cop' | '' (auto).
   */
  function alignUsdCop(usd, cop, trm, prefer) {
    var rate = Number(trm);
    var u = Number(usd);
    var c = Number(cop);
    if (!isFinite(u) || u <= 0) u = NaN;
    if (!isFinite(c) || c <= 0) c = NaN;
    if (!isFinite(rate) || rate <= 0) rate = 0;

    var pref = String(prefer || '').toLowerCase();
    if (isFinite(u) && u >= 5000) {
      if (!isFinite(c)) c = u;
      else if (Math.abs(u - c) / Math.max(u, c) <= 0.05) c = Math.max(u, c);
      u = NaN;
      pref = 'cop';
    }

    var useCop = pref === 'cop' || (!isFinite(u) && isFinite(c));
    if (useCop && isFinite(c)) {
      c = roundCop(c);
      u = rate > 0 ? roundUsd(c / rate) : 0;
      return { usd: u, cop: c };
    }
    if (isFinite(u)) {
      u = roundUsd(u);
      c = rate > 0 ? roundCop(u * rate) : (isFinite(c) ? roundCop(c) : 0);
      return { usd: u, cop: c };
    }
    if (isFinite(c)) {
      c = roundCop(c);
      u = rate > 0 ? roundUsd(c / rate) : 0;
      return { usd: u, cop: c };
    }
    return { usd: 0, cop: 0 };
  }

  function formatUsd(value, opts) {
    opts = opts || {};
    var n = roundUsd(value);
    var prefix = opts.prefix != null ? opts.prefix : '$ ';
    var locale = opts.locale || 'en-US';
    return prefix + n.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatUsdLabel(value) {
    return 'USD ' + roundUsd(value).toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatUsdInput(value) {
    return roundUsd(value).toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  window.IZCMoney = {
    excelRoundDown: excelRoundDown,
    roundUsd: roundUsd,
    roundCop: roundCop,
    alignUsdCop: alignUsdCop,
    formatUsd: formatUsd,
    formatUsdLabel: formatUsdLabel,
    formatUsdInput: formatUsdInput
  };
})();
