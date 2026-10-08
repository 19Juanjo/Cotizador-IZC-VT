/* Favoritos compartidos (localStorage) usados en todo el sitio. */
(function () {
  'use strict';

  var LEGACY_KEY = 'izc_wishlist_skus';
  var EMPTY_IZC = '\u2661';
  var FULL_IZC = '\u2665';
  // VALTECH usa estrella (distinto del corazón IZC).
  var EMPTY_VT = '\u2606';
  var FULL_VT = '\u2605';

  function isValtechStore() {
    if (document.body && document.body.getAttribute('data-store') === 'valtech') return true;
    var path = String(location.pathname || '').toLowerCase();
    return /valtech\.html$|cotizador-valtech\.html$|perfil-valtech\.html$|favoritos-valtech\.html$/.test(path);
  }

  function EMPTY() {
    return isValtechStore() ? EMPTY_VT : EMPTY_IZC;
  }

  function FULL() {
    return isValtechStore() ? FULL_VT : FULL_IZC;
  }

  function favoritesPageHref() {
    return isValtechStore() ? 'favoritos-valtech.html' : 'favoritos.html';
  }

  function currentNit() {
    if (window.IZCAuth && typeof window.IZCAuth.getSessionNit === 'function') {
      return String(window.IZCAuth.getSessionNit() || '').trim();
    }
    try {
      return localStorage.getItem('izc_session_nit') || '';
    } catch (e) {
      return '';
    }
  }

  function isLoggedIn() {
    if (window.IZCAuth && typeof window.IZCAuth.isLoggedIn === 'function') {
      return !!window.IZCAuth.isLoggedIn();
    }
    return !!currentNit();
  }

  function storageAccountId() {
    var nit = currentNit();
    if (window.IZCAuth && typeof window.IZCAuth.normalizeNit === 'function') {
      nit = IZCAuth.normalizeNit(nit);
    } else {
      nit = String(nit || '').replace(/[\s.]/g, '').replace(/-\d$/, '');
    }
    nit = String(nit || '').trim();
    var digits = nit.replace(/[^\d]/g, '');
    if (digits) return digits;
    var token = nit.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (token) return token;
    var role = '';
    try { role = localStorage.getItem('izc_session_role') || ''; } catch (eRole) { role = ''; }
    if (role === 'zkteco' || role === 'zebra') return 'ZKTECO';
    return '';
  }

  function storageKey() {
    var id = storageAccountId();
    if (!id) return '';
    var prefix = isValtechStore() ? 'valtech_wishlist_skus__' : 'izc_wishlist_skus__';
    return prefix + id;
  }

  function migrateLegacyIfNeeded(key) {
    try {
      if (!key || localStorage.getItem(key)) return;
      // Solo migrar legado a la lista IZC (no a VALTECH).
      if (key.indexOf('izc_wishlist_skus__') !== 0) return;
      var legacy = localStorage.getItem(LEGACY_KEY);
      if (!legacy) return;
      localStorage.setItem(key, legacy);
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) { /* ignore */ }
  }

  function readSkus() {
    var key = storageKey();
    if (!key) return [];
    migrateLegacyIfNeeded(key);
    try {
      var raw = localStorage.getItem(key);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.map(String).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function writeSkus(skus) {
    var key = storageKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(skus));
    document.dispatchEvent(new CustomEvent('izc:wishlist-changed', {
      detail: { skus: skus, nit: currentNit() }
    }));
  }

  function requireLogin() {
    if (isLoggedIn()) return true;
    if (window.IZCAuth && typeof IZCAuth.confirm === 'function') {
      IZCAuth.confirm({
        title: 'Iniciar sesión',
        message: 'Para guardar favoritos debes iniciar sesión con tu NIT.\n\n¿Ir a iniciar sesión?',
        confirmText: 'Ir a iniciar sesión',
        cancelText: 'Cancelar',
        danger: false
      }).then(function (ok) {
        if (ok) window.location.href = 'login.html';
      });
      return false;
    }
    window.location.href = 'login.html';
    return false;
  }

  function getAll() {
    return readSkus();
  }

  function has(sku) {
    return readSkus().indexOf(String(sku)) !== -1;
  }

  function count() {
    return readSkus().length;
  }

  function add(sku) {
    if (!requireLogin()) return false;
    sku = String(sku || '').trim();
    if (!sku || !storageKey()) return false;
    var skus = readSkus();
    if (skus.indexOf(sku) !== -1) return true;
    skus.push(sku);
    writeSkus(skus);
    return true;
  }

  function remove(sku) {
    if (!isLoggedIn()) return false;
    sku = String(sku || '');
    var skus = readSkus().filter(function (item) {
      return item !== sku;
    });
    writeSkus(skus);
    return true;
  }

  function toggle(sku) {
    if (!requireLogin()) return false;
    if (has(sku)) {
      remove(sku);
      return false;
    }
    add(sku);
    return true;
  }

  function skuFromCard(card) {
    if (!card) return '';
    var fromData = card.getAttribute('data-sku');
    if (fromData && String(fromData).trim()) return String(fromData).trim();
    var skuEl = card.querySelector('.sku');
    if (!skuEl) return '';
    return String(skuEl.textContent || '').replace(/^\s*sku\s*#?\s*:?\s*/i, '').trim();
  }

  function paintButton(btn, liked) {
    if (!btn) return;
    btn.textContent = liked ? FULL() : EMPTY();
    btn.classList.toggle('is-liked', !!liked);
    if (isValtechStore()) {
      btn.style.setProperty('color', liked ? '#2f9e44' : '#6b7280', 'important');
    } else {
      btn.style.setProperty('color', liked ? '#e60000' : '#888', 'important');
    }
    btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
    btn.title = liked ? 'Quitar de favoritos' : 'Agregar a favoritos';
  }

  function syncCardButtons(root) {
    var scope = root || document;
    scope.querySelectorAll('.product-card').forEach(function (card) {
      var sku = skuFromCard(card);
      var btn = card.querySelector('.wishlist-btn');
      if (!sku || !btn) return;
      paintButton(btn, isLoggedIn() && has(sku));
    });
  }

  function updateHeaderBadge() {
    var link = document.getElementById('headerWishlist');
    var total = isLoggedIn() ? count() : 0;
    if (link) {
      link.href = favoritesPageHref();
      link.classList.toggle('is-valtech', isValtechStore());
      var icon = link.querySelector('.header-wishlist-icon');
      if (icon) icon.textContent = total > 0 ? FULL() : EMPTY();
      link.setAttribute(
        'aria-label',
        total ? 'Mis favoritos (' + total + ')' : (isLoggedIn() ? 'Mis favoritos' : 'Favoritos (inicia sesión)')
      );
      link.classList.toggle('has-items', total > 0);
    }
  }

  function refreshAll() {
    updateHeaderBadge();
    syncCardButtons(document);
    document.dispatchEvent(new CustomEvent('izc:wishlist-changed', {
      detail: { skus: readSkus(), nit: currentNit() }
    }));
  }

  function ensureHeaderButton() {
    if (document.getElementById('headerWishlist')) return;
    var form = document.getElementById('searchForm');
    if (!form || !form.parentNode) return;

    var link = document.createElement('a');
    link.href = favoritesPageHref();
    link.className = 'header-wishlist' + (isValtechStore() ? ' is-valtech' : '');
    link.id = 'headerWishlist';
    link.title = 'Mis favoritos';
    link.setAttribute('aria-label', 'Mis favoritos');
    link.innerHTML =
      '<span class="header-wishlist-icon" aria-hidden="true">' + EMPTY() + '</span>';

    form.insertAdjacentElement('afterend', link);
  }

  function onWishlistClick(event) {
    var btn = event.target.closest('.wishlist-btn');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();

    var card = btn.closest('.product-card');
    var sku = skuFromCard(card);
    if (!sku) return;

    if (!requireLogin()) return;

    var liked = toggle(sku);
    paintButton(btn, liked);
    updateHeaderBadge();
  }

  function boot() {
    ensureHeaderButton();
    updateHeaderBadge();
    syncCardButtons(document);

    document.addEventListener('click', onWishlistClick);
    document.addEventListener('izc:wishlist-changed', function () {
      updateHeaderBadge();
      syncCardButtons(document);
    });
    document.addEventListener('izc:auth-changed', refreshAll);

    var observer = new MutationObserver(function (mutations) {
      var needsSync = mutations.some(function (m) {
        return Array.prototype.some.call(m.addedNodes, function (node) {
          return node.nodeType === 1 && (
            (node.classList && node.classList.contains('product-card')) ||
            (node.querySelector && node.querySelector('.product-card'))
          );
        });
      });
      if (needsSync) syncCardButtons(document);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.IZCWishlist = {
    getAll: getAll,
    has: has,
    count: count,
    add: add,
    remove: remove,
    toggle: toggle,
    syncCardButtons: syncCardButtons,
    updateHeaderBadge: updateHeaderBadge,
    refreshAll: refreshAll,
    isLoggedIn: isLoggedIn,
    currentNit: currentNit,
    isValtechStore: isValtechStore,
    favoritesPageHref: favoritesPageHref,
    get EMPTY() { return EMPTY(); },
    get FULL() { return FULL(); }
  };
})();
