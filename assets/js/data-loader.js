/* Carga unificada de JSON/data.js del catalogo y precios. */
(function () {
  'use strict';

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
    });
  }

  window.IZCData = {
    loadJson: loadJson,
    dataScriptPath: dataScriptPath
  };
})();
