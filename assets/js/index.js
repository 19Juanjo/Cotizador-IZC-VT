/* Logica de la pagina de inicio. */
document.addEventListener('DOMContentLoaded', function () {

  // Menu desplegable del filtro de categorías en el buscador
  var catSelect = document.querySelector('.cat-select');
  if (catSelect) {
    var catBtn = document.getElementById('catSelectBtn');
    var catLabel = document.getElementById('catSelectLabel');
    var catPanel = document.getElementById('catSelectPanel');

    if (catBtn) {
      catBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        catSelect.classList.toggle('open');
      });
    }

    document.addEventListener('click', function (e) {
      if (!catSelect.contains(e.target)) {
        catSelect.classList.remove('open');
      }
    });

    if (catPanel && catLabel) {
      catPanel.querySelectorAll('.cat-link').forEach(function (link) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          catLabel.textContent = link.textContent.trim();
          catSelect.classList.remove('open');
        });
      });
    }
  }

  // Comportamiento del menú Flyout de "Nuestros Productos"
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
        // Asegura un panel visible al abrir en celular
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

});
