/* Carrusel marcas: 4 columnas, 2 visibles, avanza de a 1 (SAT al final). */
(function () {
  'use strict';

  var DRAG_THRESHOLD = 10;

  function initFeaturedBrandsCarousel(root) {
    var box = root || document.querySelector('.featured-brands-box');
    if (!box || box.getAttribute('data-brands-carousel') === '1') return;
    var track = box.querySelector('#brandsTrack') || box.querySelector('.brands-carousel-track');
    var prevBtn = box.querySelector('#prevBrand') || box.querySelector('.arrow-btn.prev');
    var nextBtn = box.querySelector('#nextBrand') || box.querySelector('.arrow-btn.next');
    if (!track || !prevBtn || !nextBtn) return;

    box.setAttribute('data-brands-carousel', '1');
    var wrapper = track.parentElement || track;
    var currentSlide = 0;
    // 2 visibles: [datalogic|imou] → [imou|zkteco] → [zkteco|sat]
    var visible = 2;
    var isDragging = false;
    var hasDragged = false;
    var startX = 0;
    var baseX = 0;
    var pointerId = null;

    function columns() {
      return Array.prototype.filter.call(track.querySelectorAll('.brand-column'), function (col) {
        if (col.hasAttribute('hidden')) return false;
        var st = window.getComputedStyle(col);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        return true;
      });
    }

    function maxSlide() {
      return Math.max(0, columns().length - visible);
    }

    function stepWidth() {
      var cols = columns();
      if (!cols.length) return 0;
      var rect = cols[0].getBoundingClientRect();
      var gap = 0;
      try { gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || '0') || 0; } catch (e) {}
      return Math.max(1, rect.width + gap);
    }

    function syncHeight() {
      var wrap = track.parentElement;
      var cols = columns();
      if (!wrap || !cols.length) return;
      var maxH = 0;
      cols.forEach(function (col) {
        maxH = Math.max(maxH, col.scrollHeight || col.offsetHeight || 0);
      });
      if (maxH > 0) wrap.style.minHeight = maxH + 'px';
    }

    function update() {
      var max = maxSlide();
      if (currentSlide > max) currentSlide = max;
      if (currentSlide < 0) currentSlide = 0;
      var x = -(currentSlide * stepWidth());
      baseX = x;
      track.style.transition = 'transform 0.35s ease';
      track.style.transform = 'translateX(' + x + 'px)';
      syncHeight();
      var multi = max > 0;
      // Con varias páginas las flechas siempre activas (ciclo). Sin SAT (cliente) quedan deshabilitadas.
      prevBtn.disabled = !multi;
      nextBtn.disabled = !multi;
      prevBtn.style.opacity = multi ? '1' : '0.35';
      nextBtn.style.opacity = multi ? '1' : '0.35';
      prevBtn.setAttribute('aria-disabled', multi ? 'false' : 'true');
      nextBtn.setAttribute('aria-disabled', multi ? 'false' : 'true');
    }

    function goNext() {
      var max = maxSlide();
      if (max === 0) return;
      currentSlide = currentSlide < max ? currentSlide + 1 : 0;
      update();
    }

    function goPrev() {
      var max = maxSlide();
      if (max === 0) return;
      currentSlide = currentSlide > 0 ? currentSlide - 1 : max;
      update();
    }

    prevBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      goPrev();
    });
    nextBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      goNext();
    });

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
      pointerId = e.pointerId;
      track.style.transition = 'none';
    }

    function onPointerMove(e) {
      if (!isDragging || (pointerId != null && e.pointerId !== pointerId)) return;
      var dx = e.clientX - startX;
      if (!hasDragged && Math.abs(dx) > DRAG_THRESHOLD) {
        hasDragged = true;
        try { wrapper.setPointerCapture(pointerId); } catch (err) {}
      }
      if (!hasDragged) return;
      track.style.transform = 'translateX(' + (baseX + dx) + 'px)';
    }

    function onPointerUp(e) {
      if (!isDragging || (pointerId != null && e.pointerId !== pointerId)) return;
      isDragging = false;
      var dx = e.clientX - startX;
      var step = stepWidth();
      var dragged = hasDragged;
      try { wrapper.releasePointerCapture(pointerId); } catch (err) {}
      pointerId = null;

      if (dragged) {
        if (Math.abs(dx) > step * 0.22) {
          if (dx < 0) goNext();
          else goPrev();
        } else {
          update();
        }
        setTimeout(function () { hasDragged = false; }, 0);
        return;
      }

      update();
      // setPointerCapture / drag previos cancelan el click nativo: navegar a mano.
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var link = el && el.closest ? el.closest('a[href]') : null;
      if (link && track.contains(link) && link.href) {
        window.location.href = link.href;
      }
      hasDragged = false;
    }

    wrapper.style.touchAction = 'pan-y';
    wrapper.addEventListener('pointerdown', onPointerDown);
    wrapper.addEventListener('pointermove', onPointerMove);
    wrapper.addEventListener('pointerup', onPointerUp);
    wrapper.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', update);
    document.addEventListener('izc:auth-changed', function () {
      currentSlide = 0;
      window.setTimeout(update, 30);
    });
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () {
        window.setTimeout(update, 20);
      });
      mo.observe(track, { attributes: true, subtree: true, attributeFilter: ['hidden', 'class', 'style'] });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    update();
    window.setTimeout(update, 50);
    window.setTimeout(update, 300);
  }

  function boot() {
    document.querySelectorAll('.featured-brands-box').forEach(initFeaturedBrandsCarousel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.IZCFeaturedBrands = { init: initFeaturedBrandsCarousel };
})();
