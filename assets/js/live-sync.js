/* Sincronización en vivo entre pestañas/páginas IZC (sin recargar). */
(function (global) {
  'use strict';

  var CHANNEL = 'izc_live_sync_v1';
  var STORAGE_KEY = 'izc_live_sync_ping';
  var listeners = [];
  var bc = null;

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(CHANNEL);
    }
  } catch (e) {
    bc = null;
  }

  var TYPES = {
    ALL: 'all',
    QUOTES: 'quotes',
    CLIENTS: 'clients',
    USERS: 'users',
    TRM: 'trm',
    ASESORES: 'asesores',
    PRICES: 'prices'
  };

  function notifyLocal(msg) {
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](msg);
      } catch (err) { /* ignore */ }
    }
  }

  function emit(type, detail) {
    var msg = {
      type: String(type || TYPES.ALL),
      at: Date.now(),
      detail: detail || null,
      path: String((global.location && location.pathname) || '')
    };
    notifyLocal(msg);
    try {
      if (bc) bc.postMessage(msg);
    } catch (e1) { /* ignore */ }
    try {
      if (global.localStorage) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(msg));
      }
    } catch (e2) { /* ignore */ }
    return msg;
  }

  function on(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function off() {
      listeners = listeners.filter(function (x) { return x !== fn; });
    };
  }

  if (bc) {
    bc.onmessage = function (ev) {
      if (ev && ev.data) notifyLocal(ev.data);
    };
  }

  global.addEventListener('storage', function (ev) {
    if (!ev || ev.key !== STORAGE_KEY || !ev.newValue) return;
    try {
      notifyLocal(JSON.parse(ev.newValue));
    } catch (e) { /* ignore */ }
  });

  function matches(msg, wanted) {
    if (!wanted || !wanted.length) return true;
    var t = String((msg && msg.type) || TYPES.ALL);
    if (t === TYPES.ALL) return true;
    for (var i = 0; i < wanted.length; i++) {
      if (wanted[i] === t || wanted[i] === TYPES.ALL) return true;
    }
    return false;
  }

  /**
   * Poll + eventos. `fn` puede devolver Promise.
   * opts.types: array de TYPES que disparan refresh inmediato.
   */
  function startPoll(fn, ms, opts) {
    opts = opts || {};
    ms = Math.max(3000, Number(ms) || 10000);
    var wanted = opts.types || null;
    var busy = false;
    var timer = null;

    function tick(reason, msg) {
      if (global.document && document.hidden && reason !== 'event') return;
      if (busy) return;
      if (typeof fn !== 'function') return;
      busy = true;
      Promise.resolve()
        .then(function () { return fn(reason || 'interval', msg || null); })
        .catch(function () { /* ignore */ })
        .finally(function () { busy = false; });
    }

    timer = global.setInterval(function () {
      tick('interval');
    }, ms);

    if (global.document) {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) tick('visible');
      });
    }
    global.addEventListener('focus', function () {
      tick('focus');
    });

    var off = on(function (msg) {
      if (!matches(msg, wanted)) return;
      tick('event', msg);
    });

    return function stop() {
      if (timer) global.clearInterval(timer);
      timer = null;
      off();
    };
  }

  global.IZCLiveSync = {
    TYPES: TYPES,
    emit: emit,
    on: on,
    startPoll: startPoll
  };
})(window);
