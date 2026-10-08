/* Aplica el tema ZKTECO antes del primer paint para evitar el flash azul. */
(function () {
  'use strict';
  try {
    var role = '';
    var nit = '';
    try {
      role = localStorage.getItem('izc_session_role') || '';
      nit = String(localStorage.getItem('izc_session_nit') || '').replace(/[\s.]/g, '').toUpperCase();
    } catch (eLs) { return; }
    if (role !== 'zkteco' && role !== 'zebra' && nit !== 'ZKTECO') return;

    document.documentElement.classList.add('is-zkteco-admin');

    if (!document.getElementById('zktecoBootCss')) {
      var style = document.createElement('style');
      style.id = 'zktecoBootCss';
      style.textContent =
        'html.is-zkteco-admin{--blue-deep:#111111;--blue-mid:#6ea82c;--blue-bright:#8cc63f;--ink:#1a1a1a}' +
        'html.is-zkteco-admin .top-bar,html.is-zkteco-admin nav.main-nav{background:#111111!important;color:#fff!important}' +
        'html.is-zkteco-admin .top-bar a,html.is-zkteco-admin nav.main-nav .nav-item>a{color:#fff!important}' +
        'html.is-zkteco-admin .main-header{border-bottom:3px solid #8cc63f}' +
        'html.is-zkteco-admin .search-bar button{background:#8cc63f!important;color:#111111!important}' +
        'html.is-zkteco-admin .nav-item.active>a,html.is-zkteco-admin .nav-item:hover>a{background:#8cc63f!important;color:#111111!important}' +
        'html.is-zkteco-admin .search-type-tags a{color:#111111!important;background:#fff!important;border-color:#c5c5c5!important}' +
        'html.is-zkteco-admin .search-type-tags a:hover,html.is-zkteco-admin .search-type-tags a.active{background:#8cc63f!important;color:#111111!important;border-color:#6ea82c!important}' +
        'html.is-zkteco-admin .quote-cart-fab,html.is-zkteco-admin .quote-cart-add,html.is-zkteco-admin .quote-cart-go,' +
        'html.is-zkteco-admin .featured-brands-box .featured-header,html.is-zkteco-admin .featured-header{background:#111111!important;color:#fff!important}' +
        'html.is-zkteco-admin .quote-cart-fab{box-shadow:0 10px 24px rgba(17,17,17,.28)!important}' +
        'html.is-zkteco-admin .quote-cart-fab:hover,html.is-zkteco-admin .quote-cart-add:hover,html.is-zkteco-admin .quote-cart-go:hover:not(:disabled){background:#8cc63f!important;color:#111111!important}' +
        'html.is-zkteco-admin .hero-banner{background:linear-gradient(115deg,#111111 0%,#2a2a2a 52%,#6ea82c 100%)!important}' +
        'html.is-zkteco-admin .solutions-title{background:#111111!important}' +
        'html.is-zkteco-admin .header-logos{display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important;gap:18px;width:auto!important}' +
        'html.is-zkteco-admin .header-logos .logo{width:auto!important;padding-right:0!important}' +
        'html.is-zkteco-admin .header-logos .logo-img{height:72px!important;max-height:72px!important;width:auto!important;object-fit:contain}' +
        'html.is-zkteco-admin a.header-wishlist,html.is-zkteco-admin a.header-wishlist .header-wishlist-icon{color:#e60000!important}' +
        'html.is-zkteco-admin .wishlist-btn.is-liked,html.is-zkteco-admin .wishlist-btn[aria-pressed="true"]{color:#e60000!important}';
      (document.head || document.documentElement).appendChild(style);
    }

    function appendThemeCss() {
      if (!document.head) return;
      var href = (function () {
        var path = String(location.pathname || '/');
        var i = path.lastIndexOf('/');
        return (i < 0 ? '/' : path.slice(0, i + 1)) + 'assets/css/zkteco-admin.css?v=13';
      })();
      var existing = document.querySelector('link[href*="zkteco-admin.css"]');
      if (existing) {
        document.head.appendChild(existing);
        return;
      }
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }

    function placeThemeCss() {
      appendThemeCss();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', placeThemeCss);
    } else {
      placeThemeCss();
    }
  } catch (eBoot) { /* ignore */ }
})();
