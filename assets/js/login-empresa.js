/* Login: credenciales primero; IZC/VALTECH solo si el usuario es NIT de cliente.
   Compatible con HTML viejo (credenciales en #loginStepCredenciales[hidden]). */
(function () {
  var PREF_KEY = 'izc_empresa_pref';
  var ASESOR_RE = /^V\d{1,4}$/i;
  var NIT_START_RE = /^\d{3,15}$/;

  function setPref(empresa) {
    try {
      localStorage.setItem(PREF_KEY, empresa);
    } catch (e) { /* ignore */ }
  }

  function getPref() {
    try {
      return String(localStorage.getItem(PREF_KEY) || '').trim().toLowerCase();
    } catch (e) {
      return '';
    }
  }

  function normalizeLoginId(id) {
    var raw = String(id || '').replace(/[\s.]/g, '').trim();
    var m = raw.match(/^v(\d{1,4})$/i);
    if (m) return 'V' + String(parseInt(m[1], 10));
    return raw.replace(/-\d$/, '');
  }

  function looksLikeAsesor(raw) {
    return ASESOR_RE.test(normalizeLoginId(raw));
  }

  function looksLikeNit(raw) {
    var id = normalizeLoginId(raw);
    if (!id || looksLikeAsesor(id)) return false;
    return NIT_START_RE.test(id);
  }

  function ensureCredentialsVisible() {
    var cred = document.getElementById('loginStepCredenciales');
    if (cred) {
      cred.hidden = false;
      var selected = document.getElementById('loginEmpresaSelected');
      if (selected) selected.hidden = true;
      var changeBtn = document.getElementById('loginEmpresaChange');
      if (changeBtn) changeBtn.hidden = true;
    }
    var form = document.getElementById('loginForm');
    if (form) form.hidden = false;
  }

  function setEmpresa(empresa) {
    var hidden = document.getElementById('loginEmpresa');
    var body = document.body;
    if (hidden) hidden.value = empresa || '';
    if (empresa === 'izc' || empresa === 'valtech') setPref(empresa);

    document.querySelectorAll('.empresa-choice-btn[data-empresa]').forEach(function (btn) {
      var active = btn.getAttribute('data-empresa') === empresa;
      btn.classList.toggle('is-selected', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    if (body) {
      body.classList.toggle('is-empresa-izc', empresa === 'izc');
      body.classList.toggle('is-empresa-valtech', empresa === 'valtech');
      if (!empresa) body.classList.remove('is-empresa-izc', 'is-empresa-valtech');
    }
  }

  function showEmpresaPick(show) {
    var step = document.getElementById('loginStepEmpresa');
    var lead = document.getElementById('loginLead');
    if (step) step.hidden = !show;
    if (lead) {
      lead.textContent = show
        ? 'Cliente detectado: elige IZC o VALTECH y entra'
        : 'Ingresa tu NIT o código de vendedor y tu contraseña';
    }
    if (!show) setEmpresa('');
  }

  function isAdminUsuario(raw) {
    if (window.IZCAuth && typeof IZCAuth.isAdminNit === 'function') {
      return IZCAuth.isAdminNit(raw);
    }
    return false;
  }

  function looksLikeZkteco(raw) {
    if (window.IZCAuth && typeof IZCAuth.isZktecoLogin === 'function') {
      return IZCAuth.isZktecoLogin(raw);
    }
    return String(raw || '').replace(/[\s.]/g, '').toUpperCase() === 'ZKTECO';
  }

  function looksLikeSat(raw) {
    if (window.IZCAuth && typeof IZCAuth.isSatLogin === 'function') {
      return IZCAuth.isSatLogin(raw);
    }
    var s = String(raw || '').replace(/[\s.]/g, '').toUpperCase();
    return s === 'SAT' || s === 'ADMINSAT';
  }

  function syncFromUsuario() {
    var nitInput = document.getElementById('loginNit');
    var raw = nitInput ? nitInput.value : '';
    if (looksLikeAsesor(raw) || isAdminUsuario(raw) || looksLikeZkteco(raw) || looksLikeSat(raw)) {
      showEmpresaPick(false);
      return;
    }
    if (looksLikeNit(raw)) {
      showEmpresaPick(true);
      var pref = getPref();
      if (pref === 'izc' || pref === 'valtech') setEmpresa(pref);
      return;
    }
    showEmpresaPick(false);
  }

  function ensureLoginCss() {
    if (document.querySelector('link[href*="login.css"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/css/login.css?v=11';
    document.head.appendChild(link);
  }

  function ensureLoginBg() {
    if (document.querySelector('.login-bg')) return;
    var bg = document.createElement('div');
    bg.className = 'login-bg';
    bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML =
      '<span class="login-bg-orb login-bg-orb--a"></span>' +
      '<span class="login-bg-orb login-bg-orb--b"></span>' +
      '<span class="login-bg-orb login-bg-orb--c"></span>' +
      '<span class="login-bg-orb login-bg-orb--d"></span>' +
      '<span class="login-bg-grid"></span>' +
      '<span class="login-bg-sheen"></span>' +
      '<span class="login-bg-dust">' +
      '<span></span><span></span><span></span><span></span><span></span>' +
      '<span></span><span></span><span></span><span></span><span></span>' +
      '</span>';
    document.body.insertBefore(bg, document.body.firstChild);
  }

  function bind() {
    ensureLoginCss();
    ensureLoginBg();
    ensureCredentialsVisible();
    if (document.body) document.body.classList.add('login-force-motion');

    var nitInput = document.getElementById('loginNit');
    if (nitInput) {
      nitInput.addEventListener('input', syncFromUsuario);
      nitInput.addEventListener('blur', syncFromUsuario);
    }

    document.querySelectorAll('.empresa-choice-btn[data-empresa]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setEmpresa(btn.getAttribute('data-empresa') || '');
      });
    });

    var changeBtn = document.getElementById('loginEmpresaChange');
    if (changeBtn) {
      changeBtn.addEventListener('click', function () {
        showEmpresaPick(true);
      });
    }

    showEmpresaPick(false);
    window.setTimeout(function () {
      if (nitInput) nitInput.focus();
    }, 40);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.IZCLoginEmpresa = {
    getPref: getPref,
    setPref: setPref,
    looksLikeAsesor: looksLikeAsesor,
    looksLikeNit: looksLikeNit
  };
})();
