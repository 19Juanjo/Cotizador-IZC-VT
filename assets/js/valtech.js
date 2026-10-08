/* Interacciones de la tienda VALTECH (búsqueda local sobre el catálogo SAT). */
(function () {
  function applySearch() {
    var input = document.getElementById('vtSearch');
    var grid = document.getElementById('productGrid');
    if (!input || !grid) return;
    var q = String(input.value || '').trim().toLowerCase();
    var cards = grid.querySelectorAll('.product-card');
    var visible = 0;
    cards.forEach(function (card) {
      if (card.style.display === 'none' && !q) {
        // leave category-hidden cards alone when clearing search without category context
      }
      if (!q) {
        if (card.getAttribute('data-vt-hidden') === '1') {
          card.style.display = 'none';
          return;
        }
        card.style.display = '';
        visible += 1;
        return;
      }
      var title = (card.querySelector('.product-title') && card.querySelector('.product-title').textContent) || '';
      var sku = (card.querySelector('.sku') && card.querySelector('.sku').textContent) || card.getAttribute('data-sku') || '';
      var show = (title + ' ' + sku).toLowerCase().indexOf(q) !== -1;
      card.style.display = show ? '' : 'none';
      if (show) visible += 1;
    });
    var count = document.getElementById('itemCountDisplay');
    if (count && q) count.textContent = visible + ' artículos';
    var empty = document.getElementById('noProductsMessage');
    if (empty) empty.style.display = cards.length && visible === 0 ? 'block' : 'none';
  }

  function bindSearch() {
    var input = document.getElementById('vtSearch');
    if (!input) return;
    input.addEventListener('input', applySearch);
    input.addEventListener('search', applySearch);
    document.addEventListener('izc:brand-products-rendered', function () {
      applySearch();
    });
  }

  function start() {
    bindSearch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
