/* Logica de la pagina de marcas. */
document.addEventListener('DOMContentLoaded', function () {

  // ==========================================
  // 1. MENÚ FLYOUT
  // ==========================================
  var flyoutItems = document.querySelectorAll('.nav-item.has-flyout');

  function closeAllFlyouts() {
    flyoutItems.forEach(function (item) {
      item.classList.remove('open', 'is-open');
    });
  }

  flyoutItems.forEach(function (item) {
    var trigger = item.querySelector(':scope > a');
    var flyout = item.querySelector('.flyout');
    if (!trigger || !flyout) return;

    var cats = flyout.querySelectorAll('.flyout-cat');
    var panels = flyout.querySelectorAll('.flyout-panel-content');

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

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var willOpen = !item.classList.contains('open') && !item.classList.contains('is-open');
      closeAllFlyouts();
      if (willOpen) {
        item.classList.add('open', 'is-open');
        var active = flyout.querySelector('.flyout-cat.active');
        var first = active || cats[0];
        if (first) activatePanel(first.dataset.panel);
      }
    });

    cats.forEach(function (cat) {
      cat.addEventListener('mouseenter', function () {
        activatePanel(this.dataset.panel);
      });

      cat.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        activatePanel(this.dataset.panel);
      });
    });
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav-item.has-flyout')) {
      closeAllFlyouts();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAllFlyouts();
  });

  // ==========================================
  // 3. CARRUSEL DE MARCAS (Pointer/Touch + Flechas)
  // ==========================================
  var track = document.getElementById('brandsTrack');
  var prevBtn = document.getElementById('prevBrandBtn');
  var nextBtn = document.getElementById('nextBrandBtn');
  var cards = track ? track.querySelectorAll('.brand-card') : [];

  if (track && cards.length) {
    var currentIndex = 0;
    var isDragging = false;
    var hasDragged = false;
    var startX = 0;
    var baseTranslate = 0;
    var currentTranslate = 0;
    var activePointerId = null;
    var dragTarget = track.parentElement || track;
    var DRAG_THRESHOLD = 40;

    function getCardStepWidth() {
      return cards[0].offsetWidth + 15;
    }

    function getVisibleCards() {
      var containerWidth = (track.parentElement || track).offsetWidth;
      return Math.max(1, Math.round(containerWidth / getCardStepWidth()));
    }

    function getMaxIndex() {
      return Math.max(0, cards.length - getVisibleCards());
    }

    function updateCarousel() {
      var maxIndex = getMaxIndex();
      if (currentIndex > maxIndex) currentIndex = maxIndex;
      if (currentIndex < 0) currentIndex = 0;

      baseTranslate = -(currentIndex * getCardStepWidth());
      currentTranslate = baseTranslate;
      track.style.transition = 'transform 0.35s ease-out';
      track.style.transform = 'translateX(' + currentTranslate + 'px)';
    }

    function goNext() {
      currentIndex = currentIndex < getMaxIndex() ? currentIndex + 1 : 0;
      updateCarousel();
    }

    function goPrev() {
      currentIndex = currentIndex > 0 ? currentIndex - 1 : getMaxIndex();
      updateCarousel();
    }

    if (nextBtn) nextBtn.addEventListener('click', goNext);
    if (prevBtn) prevBtn.addEventListener('click', goPrev);

    track.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function (e) {
        if (hasDragged) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
    });

    function onPointerDown(e) {
      if (e.target.closest && e.target.closest('.carousel-btn')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      isDragging = true;
      hasDragged = false;
      activePointerId = e.pointerId;
      startX = e.clientX;
      baseTranslate = -(currentIndex * getCardStepWidth());
      currentTranslate = baseTranslate;
    }

    function onPointerMove(e) {
      if (!isDragging || e.pointerId !== activePointerId) return;
      var diff = e.clientX - startX;

      // Solo empieza arrastre real al pasar el umbral (el tap debe abrir la marca)
      if (!hasDragged && Math.abs(diff) > DRAG_THRESHOLD) {
        hasDragged = true;
        track.style.transition = 'none';
        try {
          dragTarget.setPointerCapture(e.pointerId);
        } catch (_) {}
      }

      if (!hasDragged) return;
      currentTranslate = baseTranslate + diff;
      track.style.transform = 'translateX(' + currentTranslate + 'px)';
    }

    function onPointerUp(e) {
      if (!isDragging || (activePointerId != null && e.pointerId !== activePointerId)) return;
      isDragging = false;
      activePointerId = null;
      var movedBy = currentTranslate - baseTranslate;

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

      // Tap / clic: ir a la página de la marca
      updateCarousel();
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var link = el && el.closest ? el.closest('a') : null;
      if (link && track.contains(link) && link.href) {
        window.location.href = link.href;
      }
    }

    dragTarget.style.touchAction = 'pan-y';
    dragTarget.addEventListener('pointerdown', onPointerDown);
    dragTarget.addEventListener('pointermove', onPointerMove);
    dragTarget.addEventListener('pointerup', onPointerUp);
    dragTarget.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', updateCarousel);
    updateCarousel();
  }
});
