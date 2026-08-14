/* Inicializa el catalogo Imou. */
document.addEventListener('DOMContentLoaded', function () {

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

  const track = document.getElementById('brandsTrack');
  const prevBtn = document.getElementById('prevBrand');
  const nextBtn = document.getElementById('nextBrand');

  if (track && prevBtn && nextBtn) {
    let currentSlide = 0;
    const columns = track.querySelectorAll('.brand-column');
    const maxSlide = Math.max(0, columns.length - 2);
    const wrapper = track.parentElement || track;
    let isDragging = false;
    let hasDragged = false;
    let startX = 0;
    let baseX = 0;
    let currentX = 0;
    let pointerId = null;

    function stepWidth() {
      var col = columns[0];
      return col ? col.getBoundingClientRect().width : 0;
    }

    function syncWrapperHeight() {
      var left = columns[currentSlide];
      var right = columns[currentSlide + 1];
      var maxH = 0;
      [left, right].forEach(function (col) {
        if (!col) return;
        maxH = Math.max(maxH, col.offsetHeight || 0);
      });
      if (maxH > 0) {
        wrapper.style.height = maxH + 'px';
      }
    }

    function updateCarousel() {
      var step = stepWidth();
      baseX = -(currentSlide * step);
      currentX = baseX;
      track.style.transition = 'transform 0.4s ease-in-out';
      track.style.transform = 'translateX(' + baseX + 'px)';
      syncWrapperHeight();
    }

    function goNext() {
      currentSlide = currentSlide < maxSlide ? currentSlide + 1 : 0;
      updateCarousel();
    }

    function goPrev() {
      currentSlide = currentSlide > 0 ? currentSlide - 1 : maxSlide;
      updateCarousel();
    }

    nextBtn.addEventListener('click', goNext);
    prevBtn.addEventListener('click', goPrev);
    window.addEventListener('resize', updateCarousel);

    var DRAG_THRESHOLD = 40;

    track.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function (e) {
        if (hasDragged) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
    });

    function onPointerDown(e) {
      if (e.target.closest && e.target.closest('.arrow-btn')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      isDragging = true;
      hasDragged = false;
      startX = e.clientX;
      baseX = -(currentSlide * stepWidth());
      currentX = baseX;
      pointerId = e.pointerId;
    }

    function onPointerMove(e) {
      if (!isDragging || (pointerId != null && e.pointerId !== pointerId)) return;
      var diff = e.clientX - startX;

      if (!hasDragged && Math.abs(diff) > DRAG_THRESHOLD) {
        hasDragged = true;
        track.style.transition = 'none';
        try { wrapper.setPointerCapture(e.pointerId); } catch (_) {}
      }

      if (!hasDragged) return;
      currentX = baseX + diff;
      track.style.transform = 'translateX(' + currentX + 'px)';
    }

    function onPointerUp(e) {
      if (!isDragging || (pointerId != null && e.pointerId !== pointerId)) return;
      isDragging = false;
      pointerId = null;
      var movedBy = currentX - baseX;

      if (hasDragged) {
        if (movedBy < -DRAG_THRESHOLD) {
          goNext();
        } else if (movedBy > DRAG_THRESHOLD) {
          goPrev();
        } else {
          updateCarousel();
        }
        setTimeout(function () { hasDragged = false; }, 0);
        return;
      }

      updateCarousel();
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var link = el && el.closest ? el.closest('a') : null;
      if (link && track.contains(link) && link.href) {
        window.location.href = link.href;
      }
    }

    wrapper.style.touchAction = 'pan-y';
    wrapper.style.cursor = 'grab';
    wrapper.addEventListener('pointerdown', onPointerDown);
    wrapper.addEventListener('pointermove', onPointerMove);
    wrapper.addEventListener('pointerup', onPointerUp);
    wrapper.addEventListener('pointercancel', onPointerUp);
    updateCarousel();
  }

  // Wishlist: manejado por wishlist.js

  document.querySelectorAll('.flyout').forEach(function (flyout) {
    const cats = flyout.querySelectorAll('.flyout-cat');
    const panels = flyout.querySelectorAll('.flyout-panel-content');

    function activatePanel(panelId) {
      cats.forEach(function (c) {
        c.classList.toggle('active', c.dataset.panel === panelId);
      });

      panels.forEach(function (p) {
        p.classList.toggle('active', p.dataset.panel === panelId);
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

  const pageBtns = document.querySelectorAll('.page-btn[data-page]');
  const prevPageBtn = document.querySelector('.prev-page');
  const nextPageBtn = document.querySelector('.next-page');
  const perPageSelect = document.getElementById('perPageSelect');
  const itemCountDisplay = document.getElementById('itemCountDisplay');
  const catFilterBtns = document.querySelectorAll('.cat-filter-btn');
  const sortSelect = document.getElementById('sortSelect');
  const noProductsMsg = document.getElementById('noProductsMessage');

  const TOTAL_PAGES = 2;
  const PAGE2_SKUS = { '16621': true, '16622': true };

  let currentActivePage = 1;
  let currentCategory = 'all';
  let itemsPerPage = 32;

  function getProductCards() {
    return document.querySelectorAll('#productGrid .product-card');
  }

  function ensureCardPages() {
    getProductCards().forEach(function (card) {
      var sku = card.getAttribute('data-sku') || '';
      var cat = card.getAttribute('data-category') || '';
      var title = '';
      var titleEl = card.querySelector('.product-title');
      if (titleEl) title = titleEl.textContent || '';

      var isMemoria = PAGE2_SKUS[sku] || cat === 'memorias' || /memoria|micro\s*sd/i.test(title);
      if (isMemoria) {
        card.setAttribute('data-category', 'memorias');
        card.setAttribute('data-page', '2');
      } else if (!card.getAttribute('data-page')) {
        card.setAttribute('data-page', '1');
      }
    });
  }

  function getCardsForCategory(categoria) {
    return Array.from(getProductCards()).filter(card => {
      const cardCat = card.getAttribute('data-category');
      return categoria === 'all' || cardCat === categoria;
    });
  }

  function updatePaginationButtons() {
    pageBtns.forEach(btn => {
      const pageNum = parseInt(btn.getAttribute('data-page'), 10);
      btn.classList.toggle('active', pageNum === currentActivePage);
    });

    if (prevPageBtn) {
      prevPageBtn.disabled = currentActivePage === 1;
    }

    if (nextPageBtn) {
      nextPageBtn.disabled = currentActivePage === TOTAL_PAGES;
    }
  }

  function cambiarPagina(pagina) {
    ensureCardPages();
    currentActivePage = pagina;
    const productCards = getProductCards();
    const cards = getCardsForCategory(currentCategory);
    let visibles = 0;

    if (currentCategory === 'memorias') {
      productCards.forEach(card => {
        const cardCat = card.getAttribute('data-category');
        if (cardCat === 'memorias') {
          card.style.display = 'flex';
          visibles++;
        } else {
          card.style.display = 'none';
        }
      });
      currentActivePage = 2;
    } else if (currentCategory !== 'all') {
      productCards.forEach(card => {
        const cardCat = card.getAttribute('data-category');
        if (cardCat === currentCategory) {
          card.style.display = 'flex';
          visibles++;
        } else {
          card.style.display = 'none';
        }
      });
      currentActivePage = 1;
    } else if (itemsPerPage >= 34) {
      cards.forEach(card => {
        card.style.display = 'flex';
        visibles++;
      });
      currentActivePage = 1;
    } else {
      productCards.forEach(card => {
        const cardPage = parseInt(card.getAttribute('data-page'), 10);
        const cardCat = card.getAttribute('data-category');
        const matchCategory = currentCategory === 'all' || cardCat === currentCategory;
        const matchPage = cardPage === pagina;

        if (matchCategory && matchPage) {
          card.style.display = 'flex';
          visibles++;
        } else {
          card.style.display = 'none';
        }
      });
    }

    if (itemCountDisplay) {
      if (currentCategory === 'all' && itemsPerPage < 34) {
        itemCountDisplay.textContent = `${visibles} artículos`;
      } else {
        itemCountDisplay.textContent = `${cards.length} artículos`;
      }
    }

    if (noProductsMsg) {
      noProductsMsg.style.display = visibles === 0 ? 'block' : 'none';
    }

    updatePaginationButtons();
  }

  pageBtns.forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      currentCategory = 'all';

      catFilterBtns.forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-category') === 'all');
      });

      if (sortSelect) {
        sortSelect.value = 'all';
      }

      cambiarPagina(parseInt(this.getAttribute('data-page'), 10));
    });
  });

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', function () {
      if (currentActivePage > 1) {
        currentCategory = 'all';
        if (sortSelect) sortSelect.value = 'all';
        catFilterBtns.forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-category') === 'all');
        });
        cambiarPagina(currentActivePage - 1);
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', function () {
      if (currentActivePage < TOTAL_PAGES) {
        currentCategory = 'all';
        if (sortSelect) sortSelect.value = 'all';
        catFilterBtns.forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-category') === 'all');
        });
        cambiarPagina(currentActivePage + 1);
      }
    });
  }

  function filtrarCategorias(categoria) {
    currentCategory = categoria;

    catFilterBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-category') === categoria);
    });

    if (sortSelect && sortSelect.value !== categoria) {
      sortSelect.value = categoria;
    }

    if (categoria === 'memorias') {
      itemsPerPage = 32;
      if (perPageSelect) perPageSelect.value = '32';
      cambiarPagina(2);
      return;
    }

    cambiarPagina(1);
  }

  catFilterBtns.forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      filtrarCategorias(this.getAttribute('data-category'));
    });
  });

  if (sortSelect) {
    sortSelect.addEventListener('change', function () {
      filtrarCategorias(this.value);
    });
  }

  if (perPageSelect) {
    perPageSelect.addEventListener('change', function () {
      itemsPerPage = parseInt(this.value, 10);

      if (itemsPerPage >= 34) {
        currentCategory = 'all';
        catFilterBtns.forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-category') === 'all');
        });
        if (sortSelect) sortSelect.value = 'all';
      }

      cambiarPagina(itemsPerPage >= 34 ? 1 : currentActivePage);
    });
  }

  document.addEventListener('izc:brand-products-rendered', function () {
    ensureCardPages();
    cambiarPagina(currentActivePage || 1);
  });

  cambiarPagina(1);

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
