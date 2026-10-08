/* Pantalla post-login: el cliente elige IZC o VALTECH. */
(function () {
  var PREF_KEY = 'izc_empresa_pref';

  function setPref(empresa) {
    try {
      localStorage.setItem(PREF_KEY, empresa);
    } catch (e) { /* ignore */ }
  }

  function requireCliente() {
    if (!window.IZCAuth || !IZCAuth.isLoggedIn || !IZCAuth.isLoggedIn()) {
      window.location.replace('login.html');
      return false;
    }
    if (IZCAuth.isAdmin && IZCAuth.isAdmin()) {
      window.location.replace('admin.html');
      return false;
    }
    if (IZCAuth.isAsesor && IZCAuth.isAsesor()) {
      window.location.replace('asesor.html');
      return false;
    }
    return true;
  }

  function bindChoices() {
    document.querySelectorAll('.empresa-choice-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var empresa = btn.getAttribute('data-empresa') || '';
        if (empresa) setPref(empresa);
      });
    });
    var perfilLink = document.getElementById('elegirEmpresaPerfilLink');
    if (perfilLink) {
      var pref = '';
      try {
        pref = String(localStorage.getItem(PREF_KEY) || '').trim().toLowerCase();
      } catch (e) { /* ignore */ }
      perfilLink.href = pref === 'valtech' ? 'perfil-valtech.html' : 'perfil.html';
    }
  }

  function start() {
    if (!requireCliente()) return;
    bindChoices();
  }

  if (window.IZCAuth && typeof IZCAuth.whenSessionReady === 'function') {
    IZCAuth.whenSessionReady().then(start, start);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
