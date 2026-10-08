/* Autenticacion en el cliente: sesion, login, proteccion de paginas. */
/* Sesión NIT/contraseña.
 * - En PC local (127.0.0.1): usa el servidor y data/usuarios.json
 * - En GitHub Pages / celular: usa almacenamiento del navegador (localStorage)
 */
(function () {
  'use strict';

  var SESSION_KEY = 'izc_session_nit';
  var SESSION_NAME_KEY = 'izc_session_nombre';
  var SESSION_ROLE_KEY = 'izc_session_role';
  var USERS_KEY = 'izc_users';
  // Tras normalizeNit el DV (-X) ya no forma parte del valor.
  var NIT_RE = /^\d{6,15}$/;
  var ASESOR_RE = /^V\d{1,4}$/i;
  var GP_RE = /^GP\d{1,4}$/i;
  var LOCAL_ORIGIN = 'http://127.0.0.1:8080';
  // NITs con acceso a la página de administrador
  var ADMIN_NITS = ['Admin IZC', 'AdminIZC', '03166122778', '3166122778'];
  var sessionReadyResolve = function () {};
  var sessionReadyPromise = new Promise(function (resolve) {
    sessionReadyResolve = resolve;
  });
  var sessionReadySettled = false;

  function markSessionReady() {
    if (sessionReadySettled) return;
    sessionReadySettled = true;
    try { sessionReadyResolve(); } catch (e) { /* ignore */ }
  }

  function normalizeLoginId(id) {
    var raw = String(id || '').replace(/[\s.]/g, '').trim();
    var m = raw.match(/^v(\d{1,4})$/i);
    if (m) return 'V' + String(parseInt(m[1], 10));
    var gm = raw.match(/^gp(\d{1,4})$/i);
    if (gm) return 'GP' + String(parseInt(gm[1], 10));
    // NIT cliente: quitar dígito de verificación
    return raw.replace(/-\d$/, '');
  }

  /** Normaliza NIT: quita espacios/puntos y el dígito de verificación (-X). */
  function normalizeNit(nit) {
    var s = String(nit || '').replace(/[\s.]/g, '').trim();
    // 900639921-7 -> 900639921
    return s.replace(/-\d$/, '');
  }

  function getSessionRole() {
    try { return localStorage.getItem(SESSION_ROLE_KEY) || ''; } catch (e) { return ''; }
  }

  function setSessionRole(role) {
    try {
      if (role) localStorage.setItem(SESSION_ROLE_KEY, String(role));
      else localStorage.removeItem(SESSION_ROLE_KEY);
    } catch (e) { /* ignore */ }
  }

  function siteBasePath() {
    // /IZC/login.html -> /IZC/   |   /login.html -> /
    var path = String(location.pathname || '/');
    var i = path.lastIndexOf('/');
    if (i < 0) return '/';
    return path.slice(0, i + 1);
  }

  function isDevHost() {
    var h = location.hostname;
    return h === '127.0.0.1' || h === 'localhost';
  }

  function forceLocalServer() {
    if (location.protocol !== 'file:') return false;
    var name = (location.pathname.split('/').pop() || 'index.html');
    location.replace(LOCAL_ORIGIN + '/' + name + location.search + location.hash);
    return true;
  }

  function getSessionNit() {
    try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; }
  }

  function getSessionNombre() {
    try { return localStorage.getItem(SESSION_NAME_KEY) || ''; } catch (e) { return ''; }
  }

  function setSessionNombre(nombre) {
    try {
      if (nombre) localStorage.setItem(SESSION_NAME_KEY, String(nombre));
      else localStorage.removeItem(SESSION_NAME_KEY);
    } catch (e) { /* ignore */ }
  }

  function pushBridgeSession(nit, nombre) {
    if (!isDevHost()) return Promise.resolve();
    return postAuthFile({
      action: 'set_bridge_session',
      nit: nit || '',
      nombre: nombre || ''
    }).catch(function () { /* servidor apagado */ });
  }

  function setSessionNit(nit, nombre, opts) {
    opts = opts || {};
    if (nit) {
      if (isZktecoLogin(nit)) nit = 'ZKTECO';
      else if (isSatLogin(nit)) nit = 'SAT';
      else if (isAdminNit(nit)) nit = 'Admin IZC';
      else if (ASESOR_RE.test(String(nit))) nit = normalizeLoginId(nit);
      else if (GP_RE.test(String(nit))) {
        nit = String(nit).toUpperCase().replace(/[\s.]/g, '');
        var gm = nit.match(/^GP(\d{1,4})$/i);
        if (gm) nit = 'GP' + String(parseInt(gm[1], 10));
      }
      else nit = normalizeNit(nit);
    }
    try {
      if (nit) localStorage.setItem(SESSION_KEY, String(nit));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
    if (arguments.length > 1) setSessionNombre(nombre || '');
    else if (!nit) setSessionNombre('');
    if (Object.prototype.hasOwnProperty.call(opts, 'role')) {
      setSessionRole(opts.role || '');
    } else if (!nit) {
      setSessionRole('');
    }
    if (!opts.skipUi) {
      renderHeaderAuth();
      applyGuestMode();
    }
    if (!opts.skipBridge) {
      pushBridgeSession(nit || '', arguments.length > 1 ? (nombre || '') : getSessionNombre());
    }
    if (!opts.skipUi) {
      try {
        document.dispatchEvent(new CustomEvent('izc:auth-changed', {
          detail: {
            nit: nit || '',
            nombre: getSessionNombre(),
            role: getSessionRole(),
            loggedIn: !!nit
          }
        }));
      } catch (e) { /* ignore */ }
    }
  }

  function migrateLegacyZebraSession() {
    try {
      var nit = String(localStorage.getItem(SESSION_KEY) || '').replace(/[\s.]/g, '').toUpperCase();
      var role = String(localStorage.getItem(SESSION_ROLE_KEY) || '').toLowerCase();
      if (nit === 'ZEBRA' || role === 'zebra') {
        localStorage.setItem(SESSION_KEY, 'ZKTECO');
        localStorage.setItem(SESSION_NAME_KEY, 'ZKTeco');
        localStorage.setItem(SESSION_ROLE_KEY, 'zkteco');
      }
      // Sesiones viejas de asesor: código V# sin role guardado.
      nit = String(localStorage.getItem(SESSION_KEY) || '').replace(/[\s.]/g, '').toUpperCase();
      role = String(localStorage.getItem(SESSION_ROLE_KEY) || '').toLowerCase();
      if (!role && /^V\d{1,4}$/.test(nit)) {
        localStorage.setItem(SESSION_ROLE_KEY, 'asesor');
      }
    } catch (e) { /* ignore */ }
  }
  migrateLegacyZebraSession();

  function logout(opts) {
    opts = opts || {};
    try {
      document.documentElement.classList.add('is-logging-out');
      if (!document.getElementById('izcLogoutCover')) {
        var cover = document.createElement('style');
        cover.id = 'izcLogoutCover';
        cover.textContent =
          'html.is-logging-out,html.is-logging-out body{visibility:hidden!important}' +
          'html.is-logging-out{background:#111111!important}';
        (document.head || document.documentElement).appendChild(cover);
      }
    } catch (eHide) { /* ignore */ }
    try {
      if (window.sessionStorage) {
        sessionStorage.removeItem('izc_asesor_cotizar');
        for (var i = sessionStorage.length - 1; i >= 0; i--) {
          var k = sessionStorage.key(i);
          if (k && k.indexOf('izc_asesor_cotizar_') === 0) sessionStorage.removeItem(k);
        }
        // Evita que pullBridgeSession restaure la sesión en la navegación siguiente.
        sessionStorage.setItem('izc_logout_at', String(Date.now()));
      }
    } catch (eClear) { /* ignore */ }
    // Limpiar local y bridge; sin skipBridge la sesión local se reabría sola en PC.
    setSessionNit('', '', { role: '', skipBridge: true, skipUi: true });
    var dest = opts.redirect || 'login.html';
    var gone = false;
    function go() {
      if (gone) return;
      gone = true;
      window.location.replace(dest);
    }
    if (isDevHost()) {
      pushBridgeSession('', '').then(go).catch(go);
      setTimeout(go, 900);
      return;
    }
    go();
  }

  try {
    window.addEventListener('pageshow', function () {
      document.documentElement.classList.remove('is-logging-out');
      var cover = document.getElementById('izcLogoutCover');
      if (cover && cover.parentNode) cover.parentNode.removeChild(cover);
    });
  } catch (ePageShow) { /* ignore */ }

  function isLoggedIn() {
    return !!getSessionNit();
  }

  function isZktecoLogin(id) {
    return String(id || '').replace(/[\s.]/g, '').toUpperCase() === 'ZKTECO';
  }

  function isSatLogin(id) {
    var s = String(id || '').replace(/[\s.]/g, '').toUpperCase();
    return s === 'SAT' || s === 'ADMINSAT';
  }

  function isZkteco() {
    var role = getSessionRole();
    if (role === 'zkteco' || role === 'zebra') return true;
    return isZktecoLogin(getSessionNit());
  }

  function isSat() {
    if (getSessionRole() === 'sat') return true;
    return isSatLogin(getSessionNit());
  }

  function isZebraLogin(id) {
    return isZktecoLogin(id);
  }

  function isZebra() {
    return isZkteco();
  }

  function isAdmin() {
    if (String(getSessionRole() || '').toLowerCase() === 'admin') return true;
    return isAdminNit(getSessionNit());
  }

  function isAdminNit(nit) {
    var alias = String(nit || '').replace(/[\s._-]/g, '').toUpperCase();
    if (alias === 'ADMINIZC' || alias === 'ADMIN' || alias === 'IZCADMIN') return true;
    var n = normalizeNit(nit);
    if (!n) return false;
    if (n.toUpperCase() === 'ADMINIZC') return true;
    if (ADMIN_NITS.indexOf(n) !== -1) return true;
    var core = n.replace(/^0+/, '');
    if (!core) return false;
    for (var i = 0; i < ADMIN_NITS.length; i++) {
      var a = normalizeNit(ADMIN_NITS[i]).replace(/^0+/, '');
      if (a && a === core) return true;
    }
    return false;
  }

  function isAsesor() {
    if (getSessionRole() === 'asesor') return true;
    return ASESOR_RE.test(String(getSessionNit() || ''));
  }

  function isGp() {
    try {
      var role = String(localStorage.getItem('izc_session_role') || '').toLowerCase();
      if (role === 'gp') return true;
    } catch (e) { /* ignore */ }
    return GP_RE.test(String(getSessionNit() || ''));
  }

  function isGpCodigo(codigo) {
    return GP_RE.test(String(codigo || ''));
  }

  function isAsesorCodigo(codigo) {
    return !!normalizeLoginId(codigo).match(/^V\d{1,4}$/);
  }

  function isInternalStaffUser(user) {
    if (!user) return false;
    var role = String(user.role || '').toLowerCase();
    if (role === 'admin' || role === 'zkteco' || role === 'zebra' || role === 'asesor' || role === 'sat') return true;
    if (isAdminNit(user.nit) || isZktecoLogin(user.nit) || isSatLogin(user.nit)) return true;
    return isAsesorCodigo(user.nit);
  }

  function publicUserView(user) {
    var contactoNombre = user && (user.contacto_nombre || user.nombre_contacto)
      ? String(user.contacto_nombre || user.nombre_contacto)
      : '';
    var contactoTel = user && (user.contacto_telefono || user.telefono_contacto || user.telefono)
      ? String(user.contacto_telefono || user.telefono_contacto || user.telefono)
      : '';
    return {
      nit: user && user.nit ? String(user.nit) : '',
      nombre: user && user.nombre ? String(user.nombre) : '',
      contacto_nombre: contactoNombre,
      contacto_telefono: contactoTel,
      telefono: contactoTel,
      created_at: user && user.created_at ? String(user.created_at) : '',
      origen: user && user.origen ? String(user.origen) : 'portal',
      role: user && user.role ? String(user.role) : '',
      vendedor_codigo: user && user.vendedor_codigo ? String(user.vendedor_codigo) : '',
      vendedor_nombre: user && user.vendedor_nombre ? String(user.vendedor_nombre) : '',
      vendedor: user && user.vendedor ? String(user.vendedor) : ''
    };
  }

  function listUsersForAdmin() {
    if (!isAdmin()) {
      return Promise.resolve({ ok: false, error: 'No autorizado.' });
    }

    function clientsOnly(users) {
      return (users || []).filter(function (u) {
        return !isInternalStaffUser(u);
      });
    }

    function fromLocal() {
      return {
        ok: true,
        users: clientsOnly(readUsersLocal().map(publicUserView)),
        source: 'navegador'
      };
    }

    function mergePublic(serverUsers, localUsers) {
      // Preferir respuesta del servidor (incluye clientes de asesores + vendedor).
      return mergeUsers(serverUsers.map(publicUserView), localUsers.map(publicUserView));
    }

    // Empuja al archivo las cuentas que solo están en el navegador
    function syncLocalToFile(serverUsers) {
      var local = readUsersLocal();
      var missing = local.filter(function (u) {
        if (!u || !u.nit || !u.password_hash) return false;
        if (String(u.password_hash).indexOf('pbkdf2$') !== 0) return false;
        return !findUser(serverUsers, u.nit);
      });
      if (!missing.length) {
        return Promise.resolve(serverUsers);
      }

      var chain = Promise.resolve();
      missing.forEach(function (u) {
        chain = chain.then(function () {
          return postAuthFile({
            action: 'upsert',
            admin_nit: getSessionNit(),
            nit: normalizeNit(u.nit),
            nombre: u.nombre || '',
            password_hash: u.password_hash,
            created_at: u.created_at || ''
          }).catch(function () { return null; });
        });
      });

      return chain.then(function () {
        return postAuthFile({ action: 'list', admin_nit: getSessionNit() })
          .then(function (data) {
            return (data && data.ok && Array.isArray(data.users)) ? data.users : serverUsers;
          })
          .catch(function () { return serverUsers; });
      });
    }

    return postAuthFile({ action: 'list', admin_nit: getSessionNit() })
      .then(function (data) {
        if (!data.ok) return fromLocal();
        var serverUsers = Array.isArray(data.users) ? data.users : [];
        return syncLocalToFile(serverUsers).then(function (finalServer) {
          var users = clientsOnly(mergePublic(finalServer, readUsersLocal()));
          return { ok: true, users: users, source: 'servidor' };
        });
      })
      .catch(function () {
        return fromLocal();
      });
  }

  function deleteUserForAdmin(nit, opts) {
    nit = normalizeNit(nit);
    opts = opts || {};
    if (!isAdmin()) {
      return Promise.resolve({ ok: false, error: 'No autorizado.' });
    }
    if (!nit) {
      return Promise.resolve({ ok: false, error: 'NIT inválido.' });
    }
    if (nit === normalizeNit(getSessionNit())) {
      return Promise.resolve({ ok: false, error: 'No puedes eliminar tu propia cuenta de administrador.' });
    }
    if (isZktecoLogin(nit) || isAsesorCodigo(nit)) {
      return Promise.resolve({ ok: false, error: 'Esa cuenta no es un cliente.' });
    }

    function deleteLocalOnly() {
      var before = readUsersLocal();
      var after = before.filter(function (u) {
        return normalizeNit(u.nit) !== nit;
      });
      writeUsersLocal(after);
      return after.length !== before.length;
    }

    var payload = {
      action: 'delete',
      nit: nit,
      admin_nit: getSessionNit(),
      origen: opts.origen || '',
      vendedor_codigo: opts.vendedor_codigo || ''
    };

    return postAuthFile(payload)
      .then(function (data) {
        var removedLocal = deleteLocalOnly();
        if (data.ok) {
          return {
            ok: true,
            message: data.message || 'Cliente eliminado.',
            source: 'servidor',
            nit: nit
          };
        }
        if (removedLocal) {
          return {
            ok: false,
            error: data.error || 'Se quitó del navegador, pero no de usuarios.json. Ejecuta tools\\ABRIR.bat o usa http://127.0.0.1:8081/admin.html'
          };
        }
        return data;
      })
      .catch(function () {
        if (deleteLocalOnly()) {
          return {
            ok: false,
            error: 'Se quitó del navegador, pero no de usuarios.json. Usa tools\\ABRIR.bat (http://127.0.0.1:8081).'
          };
        }
        return {
          ok: false,
          error: 'No se pudo actualizar usuarios.json. Abre el sitio con tools\\ABRIR.bat (http://127.0.0.1:8081/admin.html).'
        };
      });
  }

  function ensureConfirmModal() {
    var existing = document.getElementById('izcConfirmModal');
    if (existing) return existing;
    var modal = document.createElement('div');
    modal.id = 'izcConfirmModal';
    modal.className = 'izc-confirm-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'presentation');
    modal.innerHTML =
      '<div class="izc-confirm-backdrop" data-izc-confirm-cancel></div>' +
      '<div class="izc-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="izcConfirmTitle">' +
        '<h3 id="izcConfirmTitle">Confirmar</h3>' +
        '<p id="izcConfirmMessage"></p>' +
        '<div class="izc-confirm-actions">' +
          '<button type="button" class="izc-confirm-cancel" id="izcConfirmCancel" data-izc-confirm-cancel>Cancelar</button>' +
          '<button type="button" class="izc-confirm-ok" id="izcConfirmOk">Aceptar</button>' +
        '</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(modal);
    return modal;
  }

  /**
   * Modal Sí/No propio de la página (reemplazo de window.confirm).
   * @returns {Promise<boolean>}
   */
  function confirmDialog(opts) {
    opts = opts || {};
    var title = String(opts.title || 'Confirmar');
    var message = String(opts.message || opts.text || '¿Continuar?');
    var confirmText = String(opts.confirmText || opts.okText || 'Aceptar');
    var cancelText = String(opts.cancelText || 'Cancelar');
    var danger = opts.danger !== false && (
      opts.danger === true ||
      /eliminar|borrar|quitar|reemplaz/i.test(title + ' ' + message + ' ' + confirmText)
    );

    return new Promise(function (resolve) {
      var modal = ensureConfirmModal();
      var titleEl = document.getElementById('izcConfirmTitle');
      var msgEl = document.getElementById('izcConfirmMessage');
      var okBtn = document.getElementById('izcConfirmOk');
      var cancelBtn = document.getElementById('izcConfirmCancel');
      if (titleEl) titleEl.textContent = title;
      if (msgEl) {
        msgEl.textContent = '';
        String(message).split(/\n+/).forEach(function (line, i) {
          if (i > 0) msgEl.appendChild(document.createElement('br'));
          msgEl.appendChild(document.createTextNode(line));
        });
      }
      if (okBtn) {
        okBtn.textContent = confirmText;
        okBtn.className = 'izc-confirm-ok' + (danger ? ' is-danger' : '');
      }
      if (cancelBtn) cancelBtn.textContent = cancelText;

      var settled = false;
      function finish(ok) {
        if (settled) return;
        settled = true;
        modal.hidden = true;
        document.removeEventListener('keydown', onKey);
        modal.removeEventListener('click', onClick);
        resolve(!!ok);
      }
      function onKey(ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          finish(false);
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          finish(true);
        }
      }
      function onClick(ev) {
        var t = ev.target;
        if (!t) return;
        if (t.id === 'izcConfirmOk' || (t.closest && t.closest('#izcConfirmOk'))) {
          finish(true);
          return;
        }
        if (t.getAttribute && t.getAttribute('data-izc-confirm-cancel') != null) {
          finish(false);
          return;
        }
        if (t.id === 'izcConfirmCancel' || (t.closest && t.closest('#izcConfirmCancel'))) {
          finish(false);
        }
      }

      modal.hidden = false;
      document.addEventListener('keydown', onKey);
      modal.addEventListener('click', onClick);
      window.setTimeout(function () {
        try { if (okBtn) okBtn.focus(); } catch (e) { /* ignore */ }
      }, 30);
    });
  }

  function requireLogin(message) {
    if (isLoggedIn()) return true;
    var text = message || 'Para continuar debes iniciar sesión con tu NIT.';
    confirmDialog({
      title: 'Iniciar sesión',
      message: text + '\n\n¿Ir a iniciar sesión?',
      confirmText: 'Ir a iniciar sesión',
      cancelText: 'Cancelar',
      danger: false
    }).then(function (ok) {
      if (ok) window.location.href = 'login.html';
    });
    return false;
  }

  function isValtechStore() {
    if (document.body && document.body.getAttribute('data-store') === 'valtech') return true;
    var path = String(location.pathname || '').toLowerCase();
    return /valtech\.html$|cotizador-valtech\.html$|perfil-valtech\.html$|panel-sat\.html$|cotizador-sat\.html$|panel-gp\.html$/.test(path);
  }

  function ensureProfileButton() {
    // Login / registro: no mostrar perfil ni favoritos; solo Iniciar sesión / Registrarse.
    if (document.body && document.body.classList.contains('login-empresa-body')) {
      var profileAuth = document.getElementById('headerProfile');
      if (profileAuth && profileAuth.parentNode) profileAuth.parentNode.removeChild(profileAuth);
      var heartAuth = document.getElementById('headerWishlist');
      if (heartAuth && heartAuth.parentNode) heartAuth.parentNode.removeChild(heartAuth);
      return;
    }
    var heart = document.getElementById('headerWishlist');
    var host = heart && heart.parentNode
      ? heart.parentNode
      : document.querySelector('.vt-top-actions') || document.querySelector('.main-header-inner');
    if (!host) return;

    var valtech = isValtechStore();
    var link = document.getElementById('headerProfile');
    if (!link) {
      link = document.createElement('a');
      link.id = 'headerProfile';
      link.className = 'header-profile' + (valtech ? ' is-valtech' : '');
      link.title = 'Mi perfil';
      link.setAttribute('aria-label', 'Mi perfil');
      if (valtech) {
        link.innerHTML =
          '<span class="header-profile-vt" aria-hidden="true">' +
            '<svg viewBox="0 0 40 40" width="28" height="28" focusable="false">' +
              '<circle cx="20" cy="20" r="20" fill="#2f9e44"/>' +
              '<circle cx="20" cy="15" r="7" fill="#f3f4f6"/>' +
              '<path d="M7 34c2.5-7.5 8.5-11 13-11s10.5 3.5 13 11" fill="#f3f4f6"/>' +
            '</svg>' +
          '</span>';
      } else {
        link.innerHTML = '<img src="assets/logo/perfil.png" alt="" class="header-profile-img" width="28" height="28">';
      }

      if (heart && heart.parentNode === host) {
        heart.insertAdjacentElement('afterend', link);
      } else {
        host.appendChild(link);
      }
    } else if (valtech && !link.classList.contains('is-valtech')) {
      link.classList.add('is-valtech');
      link.innerHTML =
        '<span class="header-profile-vt" aria-hidden="true">' +
          '<svg viewBox="0 0 40 40" width="28" height="28" focusable="false">' +
            '<circle cx="20" cy="20" r="20" fill="#2f9e44"/>' +
            '<circle cx="20" cy="15" r="7" fill="#f3f4f6"/>' +
            '<path d="M7 34c2.5-7.5 8.5-11 13-11s10.5 3.5 13 11" fill="#f3f4f6"/>' +
          '</svg>' +
        '</span>';
    }

    // Admin/asesor: paneles propios. Cliente: perfil IZC o VALTECH según tienda.
    if (isAdmin()) {
      link.href = 'admin.html';
    } else if (isGp()) {
      link.href = 'panel-gp.html';
    } else if (isSat()) {
      link.href = 'panel-sat.html';
    } else if (isZkteco()) {
      link.href = 'panel-zkteco.html';
    } else if (isAsesor()) {
      link.href = 'asesor.html';
    } else {
      link.href = valtech ? 'perfil-valtech.html' : 'perfil.html';
    }
  }

  function ensureCambiarEmpresaNav() {
    var existing = document.getElementById('navCambiarEmpresa');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function ensureCotizadorNavLink() {
    var href = 'cotizador.html';
    if (isAsesor() || isAdmin() || isZkteco()) {
      href = 'cotizador-asesor.html';
    } else if (isSat() || isGp()) {
      href = 'cotizador-sat.html';
    } else if (isValtechStore()) {
      href = 'cotizador-valtech.html';
    }
    document.querySelectorAll(
      'a[href="cotizador.html"], a[href="cotizador-valtech.html"], a[href="cotizador-asesor.html"], a[href="cotizador-sat.html"], ' +
      'a[href="./cotizador.html"], a[href="./cotizador-valtech.html"]'
    ).forEach(function (a) {
      if (a.getAttribute('href') !== href) a.setAttribute('href', href);
    });
  }

  function bindStaffCotizadorClickGuard() {
    if (window.__IZC_STAFF_COTIZADOR_GUARD__) return;
    window.__IZC_STAFF_COTIZADOR_GUARD__ = true;
    document.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
      if (!a) return;
      var raw = String(a.getAttribute('href') || '');
      if (!/(?:^|\/)cotizador(?:-valtech)?\.html(?:[?#]|$)/i.test(raw)) return;
      var dest = '';
      if (isSat() || isGp()) dest = 'cotizador-sat.html';
      else if (isAsesor() || isAdmin() || isZkteco()) dest = 'cotizador-asesor.html';
      if (!dest) {
        try {
          var role = String(localStorage.getItem(SESSION_ROLE_KEY) || '').toLowerCase();
          var nit = String(localStorage.getItem(SESSION_KEY) || '').replace(/[\s.]/g, '').toUpperCase();
          if (role === 'sat' || role === 'gp' || /^GP\d{1,4}$/.test(nit) || nit === 'SAT') dest = 'cotizador-sat.html';
          else if (
            role === 'asesor' || role === 'admin' || role === 'zkteco' || role === 'zebra' ||
            /^V\d{1,4}$/.test(nit) || nit === 'ZKTECO'
          ) dest = 'cotizador-asesor.html';
        } catch (e) { /* ignore */ }
      }
      if (!dest) return;
      ev.preventDefault();
      ev.stopPropagation();
      var q = '';
      var qi = raw.indexOf('?');
      if (qi >= 0) q = raw.slice(qi);
      location.href = dest + q;
    }, true);
  }

  /** Quita "Mi panel" del nav (el panel se abre con el ícono de perfil). */
  function ensureStaffPanelNav() {
    try {
      var drop = document.getElementById('navMiPanel');
      if (drop && drop.parentNode) drop.parentNode.removeChild(drop);
      document.querySelectorAll('nav.main-nav a, nav.vt-nav a').forEach(function (a) {
        var href = String(a.getAttribute('href') || '');
        var label = String(a.textContent || '').replace(/\s+/g, ' ').trim();
        var isPanelHref = /^(asesor|admin|panel-zkteco|panel-sat|panel-gp)\.html/i.test(href);
        var isPanelLabel = /^(mi\s*panel|admin|panel\s*zkteco|panel\s*sat|panel\s*gp)$/i.test(label);
        if (!isPanelHref && !isPanelLabel) return;
        var li = a.parentNode;
        if (li && li.parentNode && li.classList && li.classList.contains('nav-item')) {
          li.parentNode.removeChild(li);
        } else if (a.parentNode) {
          a.parentNode.removeChild(a);
        }
      });
    } catch (e) { /* ignore */ }
  }

  /**
   * Asesor/admin/ZK en cotizador de cliente → cotizador-asesor.
   * SAT/GP → cotizador-sat.
   */
  function redirectStaffFromClientCotizador() {
    var path = String(location.pathname || '').toLowerCase();
    var isClientCotizador =
      /cotizador\.html$/i.test(path) ||
      /cotizador-valtech\.html$/i.test(path);
    if (!isClientCotizador) return false;

    var dest = '';
    if (isSat() || isGp()) dest = 'cotizador-sat.html';
    else if (isAsesor() || isAdmin() || isZkteco()) dest = 'cotizador-asesor.html';

    // Fallback por nit/rol en localStorage (auth.js cacheado viejo).
    if (!dest) {
      try {
        var role = String(localStorage.getItem(SESSION_ROLE_KEY) || '').toLowerCase();
        var nit = String(localStorage.getItem(SESSION_KEY) || '').replace(/[\s.]/g, '').toUpperCase();
        if (role === 'sat' || role === 'gp' || /^GP\d{1,4}$/.test(nit)) dest = 'cotizador-sat.html';
        else if (
          role === 'asesor' || role === 'admin' || role === 'zkteco' || role === 'zebra' ||
          /^V\d{1,4}$/.test(nit) || nit === 'ZKTECO'
        ) {
          dest = 'cotizador-asesor.html';
        }
      } catch (e) { /* ignore */ }
    }
    if (!dest) return false;
    location.replace(dest + (location.search || ''));
    return true;
  }

  function applyGuestMode() {
    if (redirectStaffFromClientCotizador()) return;
    var logged = isLoggedIn();
    if (!document.body) return;
    document.body.classList.toggle('is-logged-in', logged);
    document.body.classList.toggle('is-guest', !logged);
    ensureProfileButton();
    ensureCambiarEmpresaNav();
    ensureCotizadorNavLink();
    ensureStaffPanelNav();
    bindStaffCotizadorClickGuard();
  }

  function isCommerceAction(el) {
    if (!el || !el.closest) return null;
    return el.closest([
      '.wishlist-btn',
      '#productWishlistBtn',
      '#headerWishlist',
      'a.btn-download',
      'a[href*="lista-precios"]',
      'a[href*="precios.json"]',
      '[data-requires-login]'
    ].join(','));
  }

  function bindGuestGuards() {
    document.addEventListener('click', function (event) {
      if (isLoggedIn()) return;
      var target = isCommerceAction(event.target);
      if (!target) return;

      if (target.id === 'headerWishlist' || (target.getAttribute && /favoritos(-valtech)?\.html/.test(target.getAttribute('href') || ''))) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      var msg = 'Para continuar debes iniciar sesión con tu NIT.';
      if ((target.classList && target.classList.contains('wishlist-btn')) || target.id === 'productWishlistBtn') {
        msg = 'Para agregar favoritos debes iniciar sesión con tu NIT.';
      } else if (
        (target.classList && target.classList.contains('btn-download')) ||
        (target.getAttribute && /lista-precios|precios/i.test(String(target.getAttribute('href') || '') + ' ' + String(target.getAttribute('download') || '')))
      ) {
        msg = 'Para descargar la lista de precios debes iniciar sesión con tu NIT.';
      }
      requireLogin(msg);
    }, true);
  }

  function readUsersLocal() {
    try {
      var raw = localStorage.getItem(USERS_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function writeUsersLocal(users) {
    try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); } catch (e) { /* ignore */ }
  }

  function findUser(users, nit) {
    var n = String(normalizeNit(nit) || '').toUpperCase();
    for (var i = 0; i < users.length; i++) {
      if (String(normalizeNit(users[i].nit) || '').toUpperCase() === n) return users[i];
    }
    return null;
  }

  function whenSessionReady() {
    return sessionReadyPromise;
  }

  function fetchRemoteUsers() {
    var urls = ['data/usuarios.json'];
    if (isDevHost()) {
      urls.unshift(LOCAL_ORIGIN + '/data/usuarios.json');
    }

    function tryUrl(i) {
      if (i >= urls.length) return Promise.resolve([]);
      return fetch(urls[i] + '?v=' + Date.now(), { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) throw new Error('no ok');
          return res.json().then(function (list) {
            return Array.isArray(list) ? list : [];
          });
        })
        .catch(function () { return tryUrl(i + 1); });
    }

    return tryUrl(0);
  }

  function mergeUsers(local, remote) {
    var map = {};
    (remote || []).forEach(function (u) {
      if (u && u.nit) map[normalizeNit(u.nit)] = u;
    });
    (local || []).forEach(function (u) {
      if (u && u.nit) map[normalizeNit(u.nit)] = u;
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      var ta = String((a && a.created_at) || '');
      var tb = String((b && b.created_at) || '');
      if (ta !== tb) return tb.localeCompare(ta); // mas reciente arriba
      return String((a && a.nit) || '').localeCompare(String((b && b.nit) || ''));
    });
  }

  function cacheUserLocally(user) {
    if (!user || !user.nit) return;
    var users = readUsersLocal().filter(function (u) {
      return normalizeNit(u.nit) !== normalizeNit(user.nit);
    });
    users.push({
      nit: user.nit,
      nombre: user.nombre || '',
      password_hash: user.password_hash || '',
      created_at: user.created_at || new Date().toISOString()
    });
    writeUsersLocal(users);
  }

  function bufferToBase64(buf) {
    var bytes = new Uint8Array(buf);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToBuffer(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function hashPassword(password) {
    if (!window.crypto || !crypto.subtle) {
      return Promise.reject(new Error('Este navegador no soporta cifrado de contraseñas.'));
    }
    var iterations = 100000;
    var salt = crypto.getRandomValues(new Uint8Array(16));
    return crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    ).then(function (keyMaterial) {
      return crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
        keyMaterial,
        256
      );
    }).then(function (bits) {
      return 'pbkdf2$' + iterations + '$' + bufferToBase64(salt) + '$' + bufferToBase64(bits);
    });
  }

  function verifyPassword(password, user) {
    var stored = String((user && (user.password_hash || user.password)) || '');
    if (!stored) return Promise.resolve(false);

    if (stored.indexOf('pbkdf2$') !== 0) {
      return Promise.resolve(stored === password);
    }

    if (!window.crypto || !crypto.subtle) {
      return Promise.resolve(false);
    }

    var parts = stored.split('$');
    if (parts.length !== 4) return Promise.resolve(false);
    var iterations = parseInt(parts[1], 10);
    var salt = base64ToBuffer(parts[2]);
    var expected = new Uint8Array(base64ToBuffer(parts[3]));

    return crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    ).then(function (keyMaterial) {
      return crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
        keyMaterial,
        expected.length * 8
      );
    }).then(function (bits) {
      var actual = new Uint8Array(bits);
      if (actual.length !== expected.length) return false;
      var ok = true;
      for (var i = 0; i < actual.length; i++) {
        if (actual[i] !== expected[i]) ok = false;
      }
      return ok;
    }).catch(function () {
      return false;
    });
  }

  function apiEndpoints() {
    var base = siteBasePath();
    var list = [];
    if (isDevHost()) {
      // Servidor local que escribe data/usuarios.json
      list.push(LOCAL_ORIGIN + '/api/auth');
      list.push(base + 'api/auth.php');
    } else {
      // WAMP / hosting: solo PHP (evitar /api/auth sin extensión → HTML).
      list.push(base + 'api/auth.php');
    }
    return list;
  }

  /** Solo login/registro/TRM: endpoint liviano (sin Bitrix / monolito). */
  function sessionApiEndpoints() {
    var base = siteBasePath();
    var list = [];
    if (isDevHost()) {
      list.push(LOCAL_ORIGIN + '/api/auth');
      list.push(base + 'api/auth_session.php');
      list.push(base + 'api/auth.php');
    } else {
      list.push(base + 'api/auth_session.php');
      list.push(base + 'api/auth.php');
    }
    return list;
  }

  var localApiOkUntil = 0;

  function pingLocalApi() {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    if (ctrl) {
      timer = setTimeout(function () {
        try { ctrl.abort(); } catch (e) { /* ignore */ }
      }, 1200);
    }
    return fetch(LOCAL_ORIGIN + '/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_trm' }),
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.json().then(function (data) {
        return !!(data && data.ok);
      });
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function wakeLocalApiOnce() {
    try {
      if (sessionStorage.getItem('izc_wake_tried') === '1') {
        return Promise.resolve(false);
      }
      sessionStorage.setItem('izc_wake_tried', '1');
    } catch (e) { /* ignore */ }

    try {
      var frame = document.createElement('iframe');
      frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
      frame.src = 'izc:ensure';
      document.documentElement.appendChild(frame);
      setTimeout(function () {
        try { frame.remove(); } catch (e2) { /* ignore */ }
      }, 800);
    } catch (e) { /* ignore */ }

    return new Promise(function (resolve) {
      var attempts = 0;
      function tick() {
        attempts += 1;
        pingLocalApi().then(function (ok) {
          if (ok) {
            resolve(true);
            return;
          }
          if (attempts >= 3) {
            resolve(false);
            return;
          }
          setTimeout(tick, 350);
        }).catch(function () {
          if (attempts >= 3) {
            resolve(false);
            return;
          }
          setTimeout(tick, 350);
        });
      }
      setTimeout(tick, 250);
    });
  }

  function ensureLocalApi() {
    if (!isDevHost()) return Promise.resolve(true);
    if (Date.now() < localApiOkUntil) return Promise.resolve(true);
    return pingLocalApi().catch(function () { return false; }).then(function (ok) {
      if (ok) {
        localApiOkUntil = Date.now() + 60000;
        return true;
      }
      return wakeLocalApiOnce().then(function (woke) {
        if (woke) localApiOkUntil = Date.now() + 60000;
        return woke;
      });
    });
  }

  function pullBridgeSession() {
    if (!isDevHost()) return Promise.resolve();
    try {
      var logoutAt = Number(sessionStorage.getItem('izc_logout_at') || 0);
      if (logoutAt && (Date.now() - logoutAt) < 8000) {
        return pushBridgeSession('', '').then(function () {
          try { sessionStorage.removeItem('izc_logout_at'); } catch (e0) { /* ignore */ }
        });
      }
    } catch (eLogoutGuard) { /* ignore */ }
    return postAuthFile({ action: 'get_bridge_session' }).then(function (data) {
      if (!data || !data.ok) return;
      var remoteNit = normalizeNit(data.nit);
      var localNit = normalizeNit(getSessionNit());
      if (remoteNit && remoteNit !== localNit) {
        setSessionNit(remoteNit, data.nombre || '', { skipBridge: true });
        return;
      }
      if (!remoteNit && localNit) {
        pushBridgeSession(localNit, getSessionNombre());
      }
    }).catch(function () { /* ignore */ });
  }

  function isAbortError(err) {
    if (!err) return false;
    if (err.name === 'AbortError' || err.code === 20) return true;
    var m = String(err.message || err || '');
    return /abort/i.test(m) && /signal|without reason|The user aborted|aborted/i.test(m);
  }

  function isWriteAction(payload) {
    var a = String((payload && payload.action) || '').toLowerCase();
    return /finish_quote|save_quote|sync_bitrix|reserve_bitrix|set_quote|delete_quote|import_admin|upsert|register_cliente/.test(a);
  }

  function timeoutForPayload(payload, timeoutMs) {
    var wait = Number(timeoutMs);
    if (wait > 0) return wait;
    return isWriteAction(payload) ? 180000 : 20000;
  }

  function postToEndpoints(payload, endpoints, timeoutMs) {
    var body = JSON.stringify(payload);
    var lastErr = null;
    var waitMs = timeoutForPayload(payload, timeoutMs);
    var write = isWriteAction(payload);

    function tryOne(i, retried) {
      if (i >= endpoints.length) {
        var fail = lastErr || new Error('sin api');
        if (isAbortError(fail)) {
          return Promise.reject(new Error('El servidor tardó demasiado. Intenta guardar de nuevo.'));
        }
        return Promise.reject(fail);
      }
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = null;
      if (ctrl) {
        timer = setTimeout(function () {
          try { ctrl.abort(); } catch (e) { /* ignore */ }
        }, retried ? Math.max(waitMs, 90000) : waitMs);
      }
      return fetch(endpoints[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (res) {
        return res.text().then(function (text) {
          var data;
          try {
            data = JSON.parse(text);
          } catch (e) {
            throw new Error('API no JSON en ' + endpoints[i] + ' (HTTP ' + res.status + ')');
          }
          if (!data || typeof data !== 'object') throw new Error('Respuesta inválida');
          data._http = res.status;
          return data;
        });
      }).catch(function (err) {
        lastErr = err;
        if (isAbortError(err) && !retried) {
          return tryOne(i, true);
        }
        if (isAbortError(err) && write) {
          return Promise.reject(new Error('El servidor tardó demasiado. Intenta guardar de nuevo.'));
        }
        return tryOne(i + 1);
      }).finally(function () {
        if (timer) clearTimeout(timer);
      });
    }

    return tryOne(0, false);
  }

  function postAuth(payload, timeoutMs) {
    return postToEndpoints(payload, apiEndpoints(), timeoutMs);
  }

  // Igual que postAuth, pero solo endpoints que pueden escribir el archivo
  function postAuthFile(payload, timeoutMs) {
    var wait = Number(timeoutMs) > 0 ? Number(timeoutMs) : timeoutForPayload(payload, 0);
    return postToEndpoints(payload, apiEndpoints(), wait).then(function (data) {
      if (data && data._http >= 400 && !data.error && !data.ok) {
        throw new Error('http ' + data._http);
      }
      return data;
    });
  }

  function postAuthSession(payload) {
    return postToEndpoints(payload, sessionApiEndpoints()).then(function (data) {
      if (data && data._http >= 400 && !data.error && !data.ok) {
        throw new Error('http ' + data._http);
      }
      if (data && data.ok && isDevHost()) {
        localApiOkUntil = Date.now() + 60000;
      }
      return data;
    });
  }

  function registerLocal(nit, password, nombre, extras) {
    extras = extras || {};
    var contactoNombre = String(extras.contacto_nombre || '').trim();
    var contactoTel = String(extras.contacto_telefono || '').trim();
    return fetchRemoteUsers().then(function (remote) {
      var users = mergeUsers(readUsersLocal(), remote);
      if (findUser(users, nit)) {
        return { ok: false, error: 'Este NIT ya está registrado.' };
      }
      return hashPassword(password).then(function (passwordHash) {
        var local = readUsersLocal();
        local.push({
          nit: nit,
          nombre: nombre,
          contacto_nombre: contactoNombre,
          contacto_telefono: contactoTel,
          telefono: contactoTel,
          password_hash: passwordHash,
          created_at: new Date().toISOString()
        });
        writeUsersLocal(local);
        setSessionNit('', '');
        return {
          ok: true,
          nit: nit,
          nombre: nombre,
          contacto_nombre: contactoNombre,
          contacto_telefono: contactoTel,
          message: 'Registro exitoso. Ahora inicia sesión.'
        };
      });
    });
  }

  function loginLocal(nit, password) {
    return fetchRemoteUsers().then(function (remote) {
      var user = findUser(mergeUsers(readUsersLocal(), remote), nit);
      if (!user) {
        return {
          ok: false,
          error: 'NIT no registrado en este sitio. Regístrate aquí.'
        };
      }
      return verifyPassword(password, user).then(function (ok) {
        if (!ok) return { ok: false, error: 'NIT o contraseña incorrectos.' };
        cacheUserLocally(user);
        setSessionNit(user.nit, user.nombre || '');
        return { ok: true, nit: user.nit, nombre: user.nombre || '', message: 'Sesión iniciada.' };
      });
    });
  }

  function validateRegister(nit, password, nombre, extras) {
    extras = extras || {};
    var contactoNombre = String(extras.contacto_nombre || '').trim();
    var contactoTel = String(extras.contacto_telefono || '').replace(/[\s().-]/g, '');
    if (!nombre || nombre.length < 2) {
      return { ok: false, error: 'Ingresa el nombre de la empresa (mínimo 2 caracteres).' };
    }
    if (!nit || !NIT_RE.test(nit)) {
      return { ok: false, error: 'NIT inválido. Usa solo números (sin dígito de verificación).' };
    }
    if (!contactoTel || contactoTel.length < 7) {
      return { ok: false, error: 'Ingresa un número de contacto válido.' };
    }
    if (!contactoNombre || contactoNombre.length < 2) {
      return { ok: false, error: 'Ingresa el nombre del contacto (mínimo 2 caracteres).' };
    }
    if (password.length < 4) {
      return { ok: false, error: 'La contraseña debe tener al menos 4 caracteres.' };
    }
    return null;
  }

  function syncRegisterToServer(nit, password, nombre, extras) {
    extras = extras || {};
    return postAuthSession({
      action: 'register',
      nit: nit,
      password: password,
      nombre: nombre,
      contacto_nombre: extras.contacto_nombre || '',
      contacto_telefono: extras.contacto_telefono || ''
    }).then(function (data) {
      return { synced: !!(data && data.ok) };
    }).catch(function () {
      return { synced: false };
    });
  }

  function register(nit, password, nombre, extras) {
    extras = extras || {};
    nit = normalizeNit(nit);
    password = String(password || '');
    nombre = String(nombre || '').trim();
    var contactoNombre = String(extras.contacto_nombre || '').trim();
    var contactoTel = String(extras.contacto_telefono || '').trim();
    extras = { contacto_nombre: contactoNombre, contacto_telefono: contactoTel };

    var invalid = validateRegister(nit, password, nombre, extras);
    if (invalid) return Promise.resolve(invalid);

    function okResult(message) {
      // No re-hashear en el cliente: el servidor ya guardó el hash.
      try {
        var users = readUsersLocal().filter(function (u) {
          return normalizeNit(u.nit) !== nit;
        });
        writeUsersLocal(users);
      } catch (e) { /* ignore */ }
      setSessionNit('', '');
      return {
        ok: true,
        nit: nit,
        nombre: nombre,
        contacto_nombre: contactoNombre,
        contacto_telefono: contactoTel,
        message: message || 'Registro exitoso. Ahora inicia sesión.'
      };
    }

    function registerLocalThenSync() {
      return registerLocal(nit, password, nombre, extras).then(function (data) {
        if (!data || !data.ok) {
          if (isDevHost()) {
            return {
              ok: false,
              error: 'No se pudo registrar. Ejecuta tools\\ABRIR.bat e intenta de nuevo.'
            };
          }
          return data || { ok: false, error: 'No se pudo registrar.' };
        }
        return syncRegisterToServer(nit, password, nombre, extras).then(function (sync) {
          return {
            ok: true,
            nit: nit,
            nombre: nombre,
            contacto_nombre: contactoNombre,
            contacto_telefono: contactoTel,
            message: sync.synced
              ? 'Registro exitoso. Guardado en usuarios.json. Ahora inicia sesión.'
              : 'Registro exitoso. Ahora inicia sesión.'
          };
        });
      });
    }

    function tryRegister() {
      return postAuthSession({
        action: 'register',
        nit: nit,
        password: password,
        nombre: nombre,
        contacto_nombre: contactoNombre,
        contacto_telefono: contactoTel
      })
        .then(function (data) {
          if (data && data.ok) {
            return okResult('Registro exitoso. Guardado en usuarios.json. Ahora inicia sesión.');
          }
          if (data && data.error) return data;
          return registerLocalThenSync();
        })
        .catch(function () {
          return registerLocalThenSync();
        });
    }

    // En hosting no hace falta “despertar” API local; en PC usa caché de ping.
    if (!isDevHost()) return tryRegister();
    return ensureLocalApi().then(function () { return tryRegister(); });
  }

  function login(nit, password) {
    nit = normalizeLoginId(nit);
    password = String(password || '');
    if (isZktecoLogin(nit)) nit = 'ZKTECO';

    if (!nit || !password) {
      return Promise.resolve({ ok: false, error: 'Ingresa usuario y contraseña.' });
    }

    function applyLoginSession(data) {
      var role = data.role || (isAdminNit(data.nit || nit) ? 'admin' : (isZktecoLogin(data.nit || nit) ? 'zkteco' : (isSatLogin(data.nit || nit) ? 'sat' : (isGpCodigo(data.nit || nit) ? 'gp' : (isAsesorCodigo(data.nit || nit) ? 'asesor' : 'cliente')))));
      setSessionNit(data.nit || nit, data.nombre || '', { role: role });
      data.role = role;
      return data;
    }

    function tryLogin() {
      // Siempre intentar API liviana (auth_session.php) primero.
      // Asesores viven en data/asesores.json vía PHP; no existen en loginLocal.
      return postAuthSession({ action: 'login', nit: nit, password: password })
        .then(function (data) {
          if (data.ok) return applyLoginSession(data);
          if (isAsesorCodigo(nit) || isZktecoLogin(nit) || isGpCodigo(nit) || isSatLogin(nit)) return data;
          // Fallback local solo en PC (usuarios en localStorage / usuarios.json)
          if (!isDevHost()) return data;
          return loginLocal(nit, password).then(function (localData) {
            if (localData && localData.ok) return applyLoginSession(localData);
            return data && data.error ? data : localData;
          });
        })
        .catch(function () {
          if (isAsesorCodigo(nit) || isZktecoLogin(nit) || isGpCodigo(nit) || isSatLogin(nit)) {
            return {
              ok: false,
              error: isDevHost()
                ? 'No se pudo conectar con el servidor. Abre tools\\ABRIR.bat e inténtalo de nuevo.'
                : 'No se pudo conectar con el servidor (api/auth.php). Revisa que api/ y data/asesores.json estén publicados.'
            };
          }
          if (!isDevHost()) {
            return {
              ok: false,
              error: 'No se pudo conectar con el servidor (api/auth.php).'
            };
          }
          return loginLocal(nit, password).then(function (localData) {
            if (localData && localData.ok) return applyLoginSession(localData);
            return localData;
          });
        });
    }

    if (!isDevHost()) return tryLogin();
    return ensureLocalApi().then(function () { return tryLogin(); });
  }

  function ensureZktecoHeaderLogo(header) {
    header = header || document.querySelector('.main-header-inner');
    if (!header) return;
    var izcLogo = header.querySelector('a.logo:not(.logo-zkteco)');
    var wrap = document.getElementById('headerLogos');
    var zLogo = document.getElementById('headerZktecoLogo');

    if (!isZkteco()) {
      if (zLogo && zLogo.parentNode) zLogo.parentNode.removeChild(zLogo);
      if (wrap && izcLogo && wrap.contains(izcLogo) && wrap.parentNode) {
        wrap.parentNode.insertBefore(izcLogo, wrap);
        wrap.parentNode.removeChild(wrap);
      }
      return;
    }
    if (!izcLogo) return;

    var base = siteBasePath();
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'headerLogos';
      wrap.className = 'header-logos';
      izcLogo.parentNode.insertBefore(wrap, izcLogo);
      wrap.appendChild(izcLogo);
    }
    if (!zLogo) {
      zLogo = document.createElement('a');
      zLogo.id = 'headerZktecoLogo';
      zLogo.className = 'logo logo-zkteco';
      zLogo.href = base + 'panel-zkteco.html';
      zLogo.title = 'ZKTeco';
      zLogo.innerHTML =
        '<img src="' + base + 'assets/logo/logozkteco.png" alt="ZKTeco" class="logo-img logo-img-zkteco">';
      wrap.insertBefore(zLogo, izcLogo);
    }
  }

  function ensureZktecoThemeCss() {
    if (document.getElementById('zktecoAdminTheme')) return;
    if (document.querySelector('link[href*="zkteco-admin.css"]')) return;
    var link = document.createElement('link');
    link.id = 'zktecoAdminTheme';
    link.rel = 'stylesheet';
    link.href = siteBasePath() + 'assets/css/zkteco-admin.css?v=10';
    (document.head || document.documentElement).appendChild(link);
  }

  function applyZktecoChrome() {
    var on = false;
    try { on = isZkteco(); } catch (eOn) { on = false; }
    var body = document.body;
    if (body && body.classList.contains('valtech-body')) on = false;
    try {
      if (on) {
        document.documentElement.classList.add('is-zkteco-admin');
        if (body) body.classList.add('is-zkteco-admin');
        ensureZktecoThemeCss();
      } else {
        document.documentElement.classList.remove('is-zkteco-admin');
        if (body && !body.classList.contains('is-zkteco-cotizador')) {
          body.classList.remove('is-zkteco-admin');
        }
      }
    } catch (eChrome) { /* ignore */ }
  }

  function renderHeaderAuth() {
    applyZktecoChrome();
    var topBar = document.querySelector('.top-bar-inner');
    var header = document.querySelector('.main-header-inner');
    var vtActions = document.querySelector('.vt-top-actions');
    var nit = getSessionNit();

    // Slot NIT en la barra azul (izquierda)
    var topSlot = document.getElementById('headerAuthNit');
    if (topBar) {
      if (!topSlot) {
        topSlot = document.createElement('div');
        topSlot.id = 'headerAuthNit';
        topSlot.className = 'header-auth-top';
        topBar.insertBefore(topSlot, topBar.firstChild);
      }
      if (nit) {
        var topLabel = 'NIT ' + nit;
        if (isAdmin()) topLabel = 'Administrador';
        else if (isGp()) topLabel = String(getSessionNit() || 'GP');
        else if (isSat()) topLabel = 'Administrador SAT';
        else if (isZkteco()) topLabel = 'Admin ZKTECO';
        else if (isAsesor()) topLabel = 'Asesor ' + nit;
        topSlot.innerHTML =
          '<span class="header-auth-nit">' +
          escapeHtml(topLabel) +
          '</span>';
        topSlot.hidden = false;
      } else {
        topSlot.innerHTML = '';
        topSlot.hidden = true;
      }
    }

    // Contenedor del header: IZC (.main-header-inner) o VALTECH (.vt-top-actions / .vt-top-inner)
    var host = header || vtActions || document.querySelector('.vt-top-inner');
    if (!host) return;

    ensureZktecoHeaderLogo(header);

    var slot = document.getElementById('headerAuth');
    if (slot && slot.parentNode !== host) {
      slot.parentNode.removeChild(slot);
      slot = null;
    }
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'headerAuth';
      slot.className = 'header-auth' + (vtActions || document.body.getAttribute('data-store') === 'valtech' ? ' is-valtech' : '');
      var search = host.querySelector('.search-bar');
      var wishlist = document.getElementById('headerWishlist');
      if (search) {
        search.insertAdjacentElement('afterend', slot);
      } else if (wishlist && wishlist.parentNode === host) {
        wishlist.insertAdjacentElement('beforebegin', slot);
      } else if (vtActions) {
        vtActions.insertBefore(slot, vtActions.firstChild);
      } else {
        host.appendChild(slot);
      }
    }

    if (nit) {
      slot.innerHTML = '';
      slot.hidden = true;
    } else {
      slot.hidden = false;
      slot.classList.toggle('is-valtech', !!(vtActions || document.body.getAttribute('data-store') === 'valtech'));
      slot.innerHTML =
        '<a class="header-auth-link" href="login.html">Iniciar sesión</a>' +
        '<a class="header-auth-link" href="registro.html">Registrarse</a>';
    }

    // En páginas de login/registro siempre mostrar ambos botones de acceso.
    if (document.body && document.body.classList.contains('login-empresa-body')) {
      slot.hidden = false;
      slot.classList.add('login-header-auth');
      slot.innerHTML =
        '<a class="header-auth-link' + (/login\.html$/i.test(location.pathname) ? ' is-active' : '') + '" href="login.html">Iniciar sesión</a>' +
        '<a class="header-auth-link' + (/registro\.html$|registro-gp\.html$/i.test(location.pathname) ? ' is-active' : '') + '" href="registro.html">Registrarse</a>';
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function clearAuthForm(form, opts) {
    if (!form) return;
    opts = opts || {};
    var selector = opts.fields || 'input[name="nit"], input[name="password"], input[name="nombre"], input[name="contacto_nombre"], input[name="contacto_telefono"]';
    var fields = form.querySelectorAll(selector);
    for (var i = 0; i < fields.length; i++) {
      fields[i].value = '';
    }
    if (!opts.keepMessage) {
      var msg = document.getElementById('authMessage');
      setMessage(msg, '', '');
    }
  }

  function bindAuthForms() {
    var loginForm = document.getElementById('loginForm');
    if (loginForm) {
      clearAuthForm(loginForm);
      // El navegador a veces rellena después del load; limpiar otra vez
      setTimeout(function () { clearAuthForm(loginForm); }, 50);
      setTimeout(function () { clearAuthForm(loginForm); }, 300);
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        submitAuthForm(loginForm, 'login');
      });
    }
    var regForm = document.getElementById('registroForm');
    if (regForm) {
      // No limpiar registro: el usuario está llenando el formulario
      regForm.setAttribute('novalidate', 'novalidate');
      regForm.addEventListener('submit', function (e) {
        e.preventDefault();
        e.stopPropagation();
        submitAuthForm(regForm, 'register');
      });
    }
    var regGpForm = document.getElementById('registroGpForm');
    if (regGpForm) {
      regGpForm.setAttribute('novalidate', 'novalidate');
      regGpForm.addEventListener('submit', function (e) {
        e.preventDefault();
        e.stopPropagation();
        submitAuthForm(regGpForm, 'register_gp');
      });
    }
  }

  function submitAuthForm(form, mode) {
    var msg = document.getElementById('authMessage');
    var nitInput = form.querySelector('[name="nit"]');
    var passInput = form.querySelector('[name="password"]');
    var nombreInput = form.querySelector('[name="nombre"]');
    var contactoNombreInput = form.querySelector('[name="contacto_nombre"]');
    var contactoTelInput = form.querySelector('[name="contacto_telefono"]');
    var btn = form.querySelector('button[type="submit"]');
    var nit = nitInput ? nitInput.value.trim() : '';
    var password = passInput ? passInput.value : '';
    var nombre = nombreInput ? nombreInput.value.trim() : '';
    var contactoNombre = contactoNombreInput ? contactoNombreInput.value.trim() : '';
    var contactoTel = contactoTelInput ? contactoTelInput.value.trim() : '';
    var gpInput = form.querySelector('[name="gp"]');
    var gpCodigo = gpInput ? gpInput.value.trim() : '';

    setMessage(msg, '', '');

    if (mode === 'register') {
      if (!nombre || nombre.length < 2) {
        setMessage(msg, 'Ingresa el nombre de la empresa (mínimo 2 caracteres).', 'error');
        if (nombreInput) nombreInput.focus();
        return;
      }
      if (!nit) {
        setMessage(msg, 'Ingresa el NIT.', 'error');
        if (nitInput) nitInput.focus();
        return;
      }
      if (!contactoTel || contactoTel.replace(/[\s().-]/g, '').length < 7) {
        setMessage(msg, 'Ingresa un número de contacto válido.', 'error');
        if (contactoTelInput) contactoTelInput.focus();
        return;
      }
      if (!contactoNombre || contactoNombre.length < 2) {
        setMessage(msg, 'Ingresa el nombre del contacto (mínimo 2 caracteres).', 'error');
        if (contactoNombreInput) contactoNombreInput.focus();
        return;
      }
      if (!password || password.length < 4) {
        setMessage(msg, 'La contraseña debe tener al menos 4 caracteres.', 'error');
        if (passInput) passInput.focus();
        return;
      }
    } else if (mode !== 'register_gp' && (!nit || !password)) {
      setMessage(msg, 'Ingresa usuario y contraseña.', 'error');
      return;
    }

    if (mode === 'register_gp') {
      var gpCode = normalizeLoginId(gpCodigo || nit);
      if (!isGpCodigo(gpCode)) {
        setMessage(msg, 'Codigo GP invalido. Usa GP1, GP23, etc.', 'error');
        if (gpInput) gpInput.focus();
        else if (nitInput) nitInput.focus();
        return;
      }
      if (!nombre || nombre.length < 2) {
        setMessage(msg, 'Ingresa tu nombre (minimo 2 caracteres).', 'error');
        if (nombreInput) nombreInput.focus();
        return;
      }
      var nombreNorm = String(nombre).trim().toUpperCase().replace(/[\s.]/g, '');
      if (/^GP\d{1,4}$/.test(nombreNorm) || nombreNorm === String(gpCode || '').toUpperCase().replace(/[\s.]/g, '')) {
        setMessage(msg, 'En Nombre escribe tu nombre completo, no el codigo GP.', 'error');
        if (nombreInput) nombreInput.focus();
        return;
      }
      if (!password || password.length < 4) {
        setMessage(msg, 'La contraseña debe tener al menos 4 caracteres.', 'error');
        if (passInput) passInput.focus();
        return;
      }
      nit = gpCode;
    } else if (mode === 'login') {

      var loginId = normalizeLoginId(nit);
      var isAsesorLogin = isAsesorCodigo(loginId);
      var isGpUser = isGpCodigo(loginId);
      var isAdminLogin = isAdminNit(loginId);
      var isZktecoUser = isZktecoLogin(loginId);
      var isSatUser = isSatLogin(loginId);
      // Asesor/admin/zkteco/sat: entran directo, sin elegir IZC/VALTECH.
      // Cliente (NIT): debe elegir empresa en el formulario.
      if (!isAsesorLogin && !isAdminLogin && !isZktecoUser && !isSatUser && !isGpUser) {
        var empresaInput = form.querySelector('[name="empresa"]');
        var empresa = empresaInput ? String(empresaInput.value || '').trim().toLowerCase() : '';
        if (!empresa) {
          try {
            empresa = String(localStorage.getItem('izc_empresa_pref') || '').trim().toLowerCase();
          } catch (e) { /* ignore */ }
        }
        if (empresa !== 'izc' && empresa !== 'valtech') {
          setMessage(msg, 'Elige IZC o VALTECH para continuar.', 'error');
          var stepEmpresa = document.getElementById('loginStepEmpresa');
          if (stepEmpresa) stepEmpresa.hidden = false;
          return;
        }
        try {
          localStorage.setItem('izc_empresa_pref', empresa);
        } catch (e2) { /* ignore */ }
        if (empresaInput) empresaInput.value = empresa;
      }
    }

    if (btn) btn.disabled = true;

    var action;
    if (mode === 'register_gp') {
      action = registerGp(nit, password, nombre);
    } else if (mode === 'register') {
      action = register(nit, password, nombre, {
        contacto_nombre: contactoNombre,
        contacto_telefono: contactoTel
      });
    } else {
      action = login(nit, password);
    }
    action.then(function (data) {
      if (!data) {
        setMessage(msg, 'No se pudo completar la operación.', 'error');
        return;
      }
      if (data.ok) {
        try {
          if (window.IZCLiveSync) {
            IZCLiveSync.emit(mode === 'register' ? IZCLiveSync.TYPES.USERS : IZCLiveSync.TYPES.ALL);
          }
        } catch (eSync) { /* ignore */ }
        setMessage(msg, data.message || 'Listo.', 'ok');
        var dest = 'marcas.html';
        if (mode === 'register_gp' || mode === 'register') {
          dest = 'login.html';
        } else if (isAdminNit(data.nit || nit) || data.role === 'admin') {
          dest = 'admin.html';
        } else if (data.role === 'gp' || isGpCodigo(data.nit || nit)) {
          dest = 'panel-gp.html';
        } else if (data.role === 'sat' || isSatLogin(data.nit || nit)) {
          dest = 'panel-sat.html';
        } else if (data.role === 'zkteco' || data.role === 'zebra' || isZktecoLogin(data.nit || nit)) {
          dest = 'panel-zkteco.html';
        } else if (data.role === 'asesor' || isAsesorCodigo(data.nit || nit)) {
          dest = 'asesor.html';
        } else {
          var emp = '';
          try {
            emp = String(localStorage.getItem('izc_empresa_pref') || '').trim().toLowerCase();
          } catch (e3) { /* ignore */ }
          dest = emp === 'valtech' ? 'valtech.html' : 'marcas.html';
        }
        window.location.replace(dest);
        return;
      }
      setMessage(msg, data.error || 'No se pudo completar la operación.', 'error');
    }).catch(function (err) {
      setMessage(msg, 'Ocurrió un error inesperado.', 'error');
      console.error(err);
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  var flashTimers = {};

  /** Muestra un aviso y lo limpia solo a los 7s (si no cambió). */
  function setFlashMessage(el, text, type, baseClass) {
    if (!el) return;
    var base = baseClass || 'auth-message';
    var key = el.id || base;
    if (flashTimers[key]) {
      clearTimeout(flashTimers[key]);
      flashTimers[key] = null;
    }
    var clean = text == null ? '' : String(text);
    el.textContent = clean;
    el.className = base + (type ? ' is-' + type : '');
    if (!clean) return;
    flashTimers[key] = setTimeout(function () {
      flashTimers[key] = null;
      if (!el) return;
      if (el.textContent === clean) {
        el.textContent = '';
        el.className = base;
      }
    }, 7000);
  }

  function setMessage(el, text, type) {
    setFlashMessage(el, text, type, 'auth-message');
  }


  function registerGp(codigo, password, nombre) {
    var code = String(codigo || '').trim().toUpperCase().replace(/[\s.]/g, '');
    var pass = String(password || '');
    var name = String(nombre || '').trim();
    // Solo crea/actualiza la cuenta; el inicio de sesion es en login.html.
    return postAuthFile({
      action: 'register_gp',
      codigo: code,
      gp: code,
      nit: code,
      password: pass,
      nombre: name
    });
  }

  window.IZCAuth = {
    getSessionNit: getSessionNit,
    getSessionNombre: getSessionNombre,
    getSessionRole: getSessionRole,
    setSessionNit: setSessionNit,
    isLoggedIn: isLoggedIn,
    isAdmin: isAdmin,
    isAdminNit: isAdminNit,
    isZkteco: isZkteco,
    isZktecoLogin: isZktecoLogin,
    isSat: isSat,
    isSatLogin: isSatLogin,
    isGp: isGp,
    isGpCodigo: isGpCodigo,
    isZebra: isZebra,
    isZebraLogin: isZebraLogin,
    isAsesor: isAsesor,
    isAsesorCodigo: isAsesorCodigo,
    isInternalStaffUser: isInternalStaffUser,
    requireLogin: requireLogin,
    confirm: confirmDialog,
    login: login,
    register: register,
    registerGp: registerGp,
    logout: logout,
    getUsers: readUsersLocal,
    setFlashMessage: setFlashMessage,
    listUsersForAdmin: listUsersForAdmin,
    deleteUserForAdmin: deleteUserForAdmin,
    normalizeNit: normalizeNit,
    applyGuestMode: applyGuestMode,
    ensureLocalApi: ensureLocalApi,
    whenSessionReady: whenSessionReady,
    siteBasePath: siteBasePath,
    apiEndpoints: apiEndpoints,
    postAuth: postAuth,
    postAuthFile: postAuthFile
  };

  function init() {
    if (forceLocalServer()) {
      markSessionReady();
      return;
    }
    applyGuestMode();
    renderHeaderAuth();
    bindAuthForms();
    bindGuestGuards();
    document.addEventListener('izc:auth-changed', applyGuestMode);
    if (isDevHost()) {
      // No bloquear la UI: marcar listo ya y sincronizar bridge en segundo plano.
      markSessionReady();
      ensureLocalApi()
        .then(function () { return pullBridgeSession(); })
        .catch(function () { /* ignore */ });
    } else {
      markSessionReady();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
