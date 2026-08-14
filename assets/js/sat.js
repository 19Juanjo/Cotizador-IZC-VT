/* Inicializa el catalogo SAT. */
document.addEventListener('DOMContentLoaded', function () {

  // 1. Colapsables del Filtro Lateral
  const filterHeaders = document.querySelectorAll('.filter-header');

  filterHeaders.forEach(header => {
    header.addEventListener('click', function () {
      const list = this.nextElementSibling;
      const arrow = this.querySelector('.arrow');
      
      if (!list) return;

      if (list.style.display === 'none') {
        list.style.display = 'block';
        if (arrow) arrow.textContent = '▲';
      } else {
        list.style.display = 'none';
        if (arrow) arrow.textContent = '▼';
      }
    });
  });

  // Wishlist: manejado por wishlist.js

  // 5. Menú Flyout (Categorías y Paneles)
  const flyouts = document.querySelectorAll('.flyout');

  flyouts.forEach(function (flyout) {
    const cats = flyout.querySelectorAll('.flyout-cat');
    const panels = flyout.querySelectorAll('.flyout-panel-content');

    function activatePanel(panelId) {
      cats.forEach(function (c) {
        if (c.dataset.panel === panelId) {
          c.classList.add('active');
        } else {
          c.classList.remove('active');
        }
      });

      panels.forEach(function (p) {
        if (p.dataset.panel === panelId) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });
    }

    cats.forEach(function (cat) {
      cat.addEventListener('mouseenter', function () {
        activatePanel(this.dataset.panel);
      });

      cat.addEventListener('click', function (e) {
        e.preventDefault();
        activatePanel(this.dataset.panel);
      });
    });
  });

  // ==========================================
  // 6. FILTRADO DINÁMICO DE CATEGORÍAS TOPAZ
  // ==========================================
  const catFilterBtns = document.querySelectorAll('.cat-filter-btn');
  const sortSelect = document.getElementById('sortSelect');
  const productCards = document.querySelectorAll('#productGrid .product-card');
  const itemCountDisplay = document.getElementById('itemCountDisplay');
  const noProductsMsg = document.getElementById('noProductsMessage');

  function filtrarCategorias(categoria) {
    let visibles = 0;

    productCards.forEach(card => {
      const catTarjeta = card.getAttribute('data-category');

      if (categoria === 'all' || catTarjeta === categoria) {
        card.style.display = 'flex';
        visibles++;
      } else {
        card.style.display = 'none';
      }
    });

    // Actualizar visualización del contador
    if (itemCountDisplay) {
      itemCountDisplay.textContent = `${visibles} artículos`;
    }

    // Mostrar mensaje si no hay resultados
    if (noProductsMsg) {
      noProductsMsg.style.display = visibles === 0 ? 'block' : 'none';
    }

    // Sincronizar el select de la barra superior si existe
    if (sortSelect && sortSelect.value !== categoria) {
      sortSelect.value = categoria;
    }

    // Sincronizar clases active en la barra lateral
    catFilterBtns.forEach(btn => {
      if (btn.getAttribute('data-category') === categoria) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Eventos de la barra lateral (Botones de categorías)
  catFilterBtns.forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      const cat = this.getAttribute('data-category');
      filtrarCategorias(cat);
    });
  });

  // Evento del selector en la toolbar superior
  if (sortSelect) {
    sortSelect.addEventListener('change', function () {
      filtrarCategorias(this.value);
    });
  }

  // Precios USD: intenta precios.php (XAMPP); si no es JSON valido usa precios.json (GitHub Pages)
  async function cargarPreciosUSD() {
    try {
      let mapaPrecios = null;

      // 1) precios.json (http o file:// via IZCData)
      try {
        if (window.IZCData && typeof window.IZCData.loadJson === 'function') {
          const data = await window.IZCData.loadJson('assets/files/precios.json', { cache: 'no-store' });
          if (data && !data.error) mapaPrecios = data;
        } else {
          const jsonRes = await fetch('assets/files/precios.json', { cache: 'no-store' });
          if (jsonRes.ok) {
            const data = await jsonRes.json();
            if (data && !data.error) mapaPrecios = data;
          }
        }
      } catch (_) {}

      // 2) precios.php solo con servidor (XAMPP); no en file://
      if (!mapaPrecios && location.protocol !== 'file:') {
        try {
          const phpRes = await fetch('assets/files/precios.php', { cache: 'no-store' });
          if (phpRes.ok) {
            const text = await phpRes.text();
            if (text.trim().startsWith('{')) {
              const data = JSON.parse(text);
              if (data && !data.error) mapaPrecios = data;
            }
          }
        } catch (_) {}
      }

      if (!mapaPrecios) return;

      if (window.IZCPrices && typeof window.IZCPrices.apply === 'function') {
        window.IZCPrices.apply();
        return;
      }

      function formatEntry(entry) {
        if (entry == null) return null;
        if (typeof entry === 'object' && entry.currency === 'COP') {
          return '$ ' + Math.round(Number(entry.amount)).toLocaleString('es-CO') + ' COP';
        }
        var amount = typeof entry === 'object' ? entry.amount : entry;
        if (amount == null) return null;
        return '$ ' + Number(amount).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      }

      document.querySelectorAll('.product-card, .product-carddatalogic').forEach(tarjeta => {
        const skuElem = tarjeta.querySelector('.sku');
        const priceElem = tarjeta.querySelector('.price');
        if (!skuElem || !priceElem) return;

        const skuTexto = skuElem.textContent.replace(/\D/g, '').trim();
        if (!skuTexto) return;

        let entry = mapaPrecios[skuTexto];
        if (entry == null) {
          const skuSinCeros = skuTexto.replace(/^0+/, '');
          entry = mapaPrecios[skuSinCeros];
        }

        const text = formatEntry(entry);
        if (text) priceElem.textContent = text;
      });
    } catch (error) {
      console.error('Error al actualizar precios:', error);
    }
  }

  cargarPreciosUSD();

});
