/* Cotizador del asesor: precios por LP (precios_lp_asesor.json) + finish_quote_asesor. */
(function () {
  'use strict';

  var IVA = 0.19;
  // UVT 2026: AIO ≤ umbral → sin IVA; otros ≤ umbral → con IVA; otros > umbral → exento.
  var UVT_2026 = 52374;
  var UVT_EXENTO_MAX = UVT_2026 * 50; // $2.618.700
  var STORAGE_PREFIX = 'izc_cotizador_asesor_items_';
  var DEFAULT_TRM = 3204;
  var DEFAULT_LP = 'interna';
  var API_ORIGIN = 'http://127.0.0.1:8080';

  function isAioEquipment(name, sku) {
    var s = (String(name || '') + ' ' + String(sku || '')).toUpperCase();
    if (!s.trim()) return false;
    if (/RIBBON|CINTA|TONER|CARTUCHO|CABLE|ROLLO|ETIQUETA|LABEL|LECTOR|SCANNER|ESCANER|ESCÁNER|HUELLA/.test(s)) {
      return false;
    }
    return /\bAIO\b/.test(s) || /ALL\s*[- ]?\s*IN\s*[- ]?\s*ONE/.test(s) || /TODO\s*EN\s*UNO/.test(s);
  }

  function isSatVerificadorPrecios(name, sku) {
    var s = (String(name || '') + ' ' + String(sku || '')).toUpperCase();
    if (!s.trim()) return false;
    if (!/SAT/.test(s)) return false;
    return /VERIFICADOR\s+(DE\s+)?PRECIOS/.test(s);
  }

  function isUvtExemptEligibleEquipment(name, sku) {
    return isAioEquipment(name, sku) || isSatVerificadorPrecios(name, sku);
  }

  function exceedsUvtThreshold(unitCopSinIva) {
    var u = Number(unitCopSinIva);
    return isFinite(u) && u > UVT_EXENTO_MAX;
  }

  /** Solo AIO / verificador SAT con unitario ≤ umbral UVT quedan sin IVA. */
  function isIvaExemptUnit(unitCopSinIva, name, sku) {
    var u = Number(unitCopSinIva);
    if (!isFinite(u) || u <= 0) return false;
    if (!isUvtExemptEligibleEquipment(name, sku)) return false;
    return !exceedsUvtThreshold(u);
  }

  function isLocalHost() {
    var h = location.hostname;
    return h === '127.0.0.1' || h === 'localhost';
  }

  function apiEndpoints() {
    // En hosting público NUNCA llamar a 127.0.0.1 (falla / Mixed Content en HTTPS).
    if (window.IZCAuth && typeof IZCAuth.apiEndpoints === 'function') {
      return IZCAuth.apiEndpoints();
    }
    var path = String(location.pathname || '/');
    var i = path.lastIndexOf('/');
    var base = i < 0 ? '/' : path.slice(0, i + 1);
    if (isLocalHost()) {
      return [API_ORIGIN + '/api/auth', base + 'api/auth', base + 'api/auth.php'];
    }
    return [base + 'api/auth.php', base + 'api/auth'];
  }
  var PRECIOS_PATH = 'assets/files/precios_lp_asesor.json';
  var PRODUCTOS_PATH = 'assets/files/productos.json';
  var REFERENCIAS_PATH = 'assets/files/referencias.json';
  var FLETES_PATH = 'assets/files/fletes.json';
  var ESTELAR_FLETE_PATH = 'assets/files/estelar_flete.json';
  var INVENTARIO_PATH = 'assets/files/inventario.json';
  var INV_BODEGAS = ['AR', 'CT', 'UN', 'RC'];
  // Envíos nacionales:
  //   ≥ $1.500.000 → 1,85% del valor del pedido (sin IVA) + IVA del flete.
  //   < $1.500.000 → $23.000 + IVA y despacho TCC.
  var FLETE_MIN_ANTES_IVA = 23000;
  var FLETE_PEDIDO_UMBRAL = 1500000;
  var FLETE_TCC_RATE = 0.0185;

  var LP_OPTIONS = [
    { id: 'web', label: 'Web' },
    { id: 'interna', label: 'Interna' },
    { id: 'volumen', label: 'Volumen' },
    { id: 'drm', label: 'Drm' },
    { id: 'franquicia', label: 'Franquicia' },
    { id: 'master', label: 'Master' },
    { id: 'ups', label: 'UPS' },
    { id: 'pv', label: 'PV' },
    { id: 'etiquetado', label: 'Etiquetado' },
    { id: 'contadoras', label: 'Contadoras' },
    { id: 'lp_promos', label: 'LP Promos' }
  ];
  var ZEBRA_LP_IDS = ['web', 'interna', 'volumen'];
  var LP_ALIASES = {
    'lp web': 'web',
    lp_web: 'web',
    'lp interna': 'interna',
    lp_interna: 'interna',
    'lp volumen': 'volumen',
    lp_volumen: 'volumen',
    franquicias: 'franquicia',
    promos: 'lp_promos',
    'lista promos': 'lp_promos',
    clientes: 'web'
  };

  var FLETE_OPTIONS = [
    { id: '0.0176', label: 'TransArm 1,76 %', rate: 0.0176, gratis: false },
    { id: 'estelar', label: 'Estelar', rate: 0.0176, gratis: false },
    { id: '0.0185', label: 'Envío nacional 1,85 %', rate: 0.0185, gratis: false, tccOnlyUnder: true },
    { id: '0.035', label: 'Especial 3,5%', rate: 0.035, gratis: false },
    { id: 'gratis', label: 'Gratis', rate: 0, gratis: true }
  ];

  var CIUDAD_OPTIONS = [
    'Acacías',
    'Acevedo',
    'Agrado',
    'Agua de Dios',
    'Aguachica',
    'Aguazul',
    'Aipe',
    'Albania',
    'Alcalá',
    'Altamira',
    'Alvarado',
    'Amaime',
    'Anapoima',
    'Andalucía',
    'Anserma',
    'Apartadó',
    'Apulo',
    'Armenia',
    'Armero - Guayabal',
    'Barbosa',
    'Barichara',
    'Barrancabermeja',
    'Barranquilla',
    'Bello',
    'Bogotá',
    'Bosconia',
    'Bruselas',
    'Bucaramanga',
    'Buenavista (Córdoba)',
    'Buenavista (Sucre)',
    'Buga',
    'Bugalagrande',
    'Caicedonia',
    'Cajicá',
    'Calarcá',
    'Caldas',
    'Cali',
    'Campoalegre',
    'Candelaria (Valle)',
    'Carepa',
    'Cartagena',
    'Cartagena del Chairá',
    'Cartago',
    'Caucasia',
    'Cereté',
    'Chaparral',
    'Charalá',
    'Chigorodó',
    'Chinchiná',
    'Chinú',
    'Chiquinquirá',
    'Chía',
    'Ciénaga de Oro',
    'Ciénaga Magdalena',
    'Circasia',
    'Cogua',
    'Copacabana',
    'Corozal',
    'Cota',
    'Cotorra',
    'Coveñas',
    'Cumaral',
    'Curillo',
    'Curití',
    'Dosquebradas',
    'Duitama',
    'El Copey',
    'El Doncello',
    'El Paujíl',
    'El Pital',
    'El Santuario',
    'Envigado',
    'Espinal',
    'Facatativá',
    'Flandes',
    'Florencia',
    'Floridablanca',
    'Fresno',
    'Fundación',
    'Funza',
    'Fusagasugá',
    'Gachancipá',
    'Garzón',
    'Gigante',
    'Girardot',
    'Girardota',
    'Girón',
    'Granada (Meta)',
    'Guacarí',
    'Guadalupe Huila',
    'Guamal',
    'Guamo',
    'Guarne',
    'Hobo',
    'Honda',
    'Ibagué',
    'Ipiales',
    'Isnos',
    'Itagüí',
    'Jamundí',
    'La Apartada',
    'La Argentina',
    'La Dorada',
    'La Estrella',
    'La Mesa',
    'La Montañita',
    'La Plata',
    'La Tebaida',
    'La Unión Valle',
    'La Victoria',
    'La Virginia',
    'Lebrija',
    'Lérida',
    'Líbano',
    'Lorica',
    'Los Palmitos',
    'Madrid',
    'Magangué',
    'Malambo',
    'Manizales',
    'Maní',
    'Marinilla',
    'Mariquita',
    'Medellín',
    'Melgar',
    'Mocoa',
    'Moniquirá',
    'Montelíbano',
    'Montenegro',
    'Montería',
    'Monterrey',
    'Morelia',
    'Morroa',
    'Mosquera',
    'Nátaga',
    'Necoclí',
    'Neiva',
    'Nobsa',
    'Obando',
    'Oiba',
    'Oporapa',
    'Orito',
    'Orocué',
    'Paicol',
    'Paipa',
    'Palermo',
    'Palestina',
    'Palmira',
    'Pasto',
    'Paz de Ariporo',
    'Pereira',
    'Piedecuesta',
    'Pitalito',
    'Planeta Rica',
    'Popayán',
    'Pore',
    'Pueblo Nuevo',
    'Puente Nacional',
    'Puerto Asís',
    'Puerto Bogotá',
    'Puerto Boyacá',
    'Puerto Caicedo',
    'Puerto Colombia',
    'Puerto Gaitán',
    'Puerto López',
    'Puerto Rico (Caquetá)',
    'Puerto Salgar',
    'Puerto Tejada',
    'Purificación',
    'Quimbaya',
    'Restrepo',
    'Ricaurte (Cundinamarca)',
    'Rionegro',
    'Riosucio',
    'Rivera',
    'Roldanillo',
    'Sabaneta',
    'Sahagún',
    'Saladoblanco',
    'Saldaña',
    'Sampués',
    'San Adolfo',
    'San Agustín',
    'San Antero',
    'San Gil',
    'San José del Fragua',
    'San Luis de Palenque',
    'San Marcos',
    'San Martín - Meta',
    'San Pedro Sucre',
    'San Pelayo',
    'San Vicente del Caguán',
    'Santa Marta',
    'Santa Rosa de Cabal',
    'Santander de Quilichao',
    'Santiago de Tolú',
    'Sevilla',
    'Sibaté',
    'Silvania',
    'Sincelejo',
    'Soacha',
    'Socorro',
    'Sogamoso',
    'Soledad',
    'Sopó',
    'Suaza',
    'Supía',
    'Tarqui',
    'Tauramena',
    'Tenjo',
    'Teruel',
    'Tesalia',
    'Timaná',
    'Tocaima',
    'Tocancipá',
    'Tolú Viejo',
    'Toro',
    'Trinidad',
    'Tuluá',
    'Tunja',
    'Turbaco',
    'Turbo',
    'Ubaté',
    'Valledupar',
    'Valparaíso (Caquetá)',
    'Vélez',
    'Venadillo',
    'Villagarzón',
    'Villamaría',
    'Villanueva (Casanare)',
    'Villanueva - Santander',
    'Villavicencio',
    'Viterbo',
    'Yaguará',
    'Yopal',
    'Yumbo',
    'Zarzal',
    'Zipaquirá',
    'Cúcuta',
    'Los Patios',
    'Ocaña',
    'Pamplona',
    'Villa del Rosario'
  ];

  function foldCityName(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fillCiudadesDatalist() {
    var list = document.getElementById('cotizadorCiudadesList');
    if (!list) return;
    var names = [];
    var seen = {};
    function addName(name) {
      var n = String(name || '').trim();
      if (!n) return;
      var key = foldCityName(n);
      if (!key || seen[key]) return;
      seen[key] = true;
      names.push(n);
    }
    if (estelarFleteData && Array.isArray(estelarFleteData.ciudades)) {
      estelarFleteData.ciudades.forEach(function (c) { addName(c && c.name); });
    }
    CIUDAD_OPTIONS.forEach(addName);
    list.innerHTML = names.map(function (name) {
      return '<option value="' + String(name).replace(/"/g, '&quot;') + '"></option>';
    }).join('');
  }

  var priceMapsByLp = null;
  var priceMap = null;
  var lastLpStamp = null;
  var PRECIOS_POLL_MS = 120000;
  var productMap = null;
  var referenciaMap = null;
  var createdProductsMap = null; // SKU -> producto manual compartido (catálogo "M")
  var fletesMap = null;
  var estelarFleteData = null;
  var estelarCityIndex = {};
  var estelarProductos = {};
  var estelarExcept = {};
  var estelarSatPrecio = {};
  var inventarioMap = null;
  var inventarioLoadPromise = null;
  var backgroundLoadsStarted = false;
  var searchCatalog = null;
  var suggestActiveIdx = -1;
  var pendingSelectedSku = '';
  var items = [];
  var fleteOverride = null; // null = calcular; número = flete antes de IVA manual
  var previewTimer = null;
  var messageTimer = null;
  var finishing = false;
  var clientContext = { nit: '', nombre: '', quoteId: '', bitrixDealId: '', duplicatedFrom: '', recotizar: false };
  var selectedLp = DEFAULT_LP;

  function normalizeNit(value) {
    if (window.IZCAuth && typeof IZCAuth.normalizeNit === 'function') {
      return IZCAuth.normalizeNit(value);
    }
    return String(value == null ? '' : value).replace(/[\s.]/g, '').replace(/-\d$/, '').trim();
  }

  function isAsesor() {
    return !!(window.IZCAuth && IZCAuth.isAsesor && IZCAuth.isAsesor());
  }

  function isAdmin() {
    return !!(window.IZCAuth && IZCAuth.isAdmin && IZCAuth.isAdmin());
  }

  function isZkteco() {
    if (window.IZCAuth && typeof IZCAuth.isZkteco === 'function' && IZCAuth.isZkteco()) return true;
    var role = window.IZCAuth && typeof IZCAuth.getSessionRole === 'function'
      ? String(IZCAuth.getSessionRole() || '').toLowerCase()
      : '';
    if (role === 'zkteco' || role === 'zebra') return true;
    var nit = '';
    if (window.IZCAuth && typeof IZCAuth.getSessionNit === 'function') {
      nit = String(IZCAuth.getSessionNit() || '').replace(/[\s.]/g, '').toUpperCase();
    }
    return nit === 'ZKTECO';
  }

  function isSatCotizador() {
    try {
      if (document.body && document.body.classList.contains('is-sat-cotizador')) return true;
    } catch (eB) { /* ignore */ }
    return /cotizador-sat\.html$/i.test(String(location.pathname || ''));
  }

  function isSat() {
    if (window.IZCAuth && typeof IZCAuth.isSat === 'function' && IZCAuth.isSat()) return true;
    var role = window.IZCAuth && typeof IZCAuth.getSessionRole === 'function'
      ? String(IZCAuth.getSessionRole() || '').toLowerCase()
      : '';
    if (role === 'sat') return true;
    var nit = '';
    if (window.IZCAuth && typeof IZCAuth.getSessionNit === 'function') {
      nit = String(IZCAuth.getSessionNit() || '').replace(/[\s.]/g, '').toUpperCase();
    }
    return nit === 'SAT' || nit === 'ADMINSAT';
  }

  function isGp() {
    if (window.IZCAuth && typeof IZCAuth.isGp === 'function' && IZCAuth.isGp()) return true;
    var role = window.IZCAuth && typeof IZCAuth.getSessionRole === 'function'
      ? String(IZCAuth.getSessionRole() || '').toLowerCase()
      : '';
    if (role === 'gp') return true;
    var nit = '';
    if (window.IZCAuth && typeof IZCAuth.getSessionNit === 'function') {
      nit = String(IZCAuth.getSessionNit() || '').replace(/[\s.]/g, '').toUpperCase();
    }
    return /^GP\d{1,4}$/i.test(nit);
  }

  function isStaff() {
    if (isSatCotizador()) return isSat() || isGp() || isAdmin();
    return isAsesor() || isAdmin() || isZkteco();
  }

  function getAsesorCodigo() {
    if (isSatCotizador() && isGp()) {
      if (window.IZCAuth && IZCAuth.getSessionNit) {
        return String(IZCAuth.getSessionNit() || '').trim().toUpperCase().replace(/[\s.]/g, '');
      }
      return '';
    }
    if (isSatCotizador() && (isSat() || isAdmin())) return 'SAT';
    if (isZkteco()) return 'ZKTECO';
    if (isAdmin()) {
      var fromQuery = '';
      try {
        fromQuery = String(new URLSearchParams(window.location.search).get('asesor')
          || new URLSearchParams(window.location.search).get('codigo')
          || '').trim().toUpperCase();
      } catch (eQ) { /* ignore */ }
      if (fromQuery) return fromQuery;
      var fromCtx = String((clientContext && clientContext.seller_codigo) || '').trim().toUpperCase();
      if (fromCtx) return fromCtx;
      return '';
    }
    if (window.IZCAuth && IZCAuth.getSessionNit) {
      return String(IZCAuth.getSessionNit() || '').trim().toUpperCase();
    }
    return '';
  }

  function quoteSourceForSave() {
    if (isSatCotizador() && isGp()) return 'gp';
    if (isSatCotizador()) return 'sat';
    if (isZkteco()) return 'zkteco';
    return 'asesor';
  }

  function isSatCatalogItem(name, sku, referencia) {
    if (window.IZCCatalogScope && typeof IZCCatalogScope.isSatText === 'function') {
      return IZCCatalogScope.isSatText(name, sku, referencia);
    }
    if (window.IZCCatalogScope && typeof IZCCatalogScope.isSatProduct === 'function') {
      return IZCCatalogScope.isSatProduct({ name: name, sku: sku, referencia: referencia });
    }
    var blob = [name, sku, referencia].join(' ').toUpperCase();
    blob = blob.replace(/\bSATA[A-Z0-9]*/g, ' ');
    return /(?:^|[^A-Z0-9])SAT(?:[^A-Z0-9]|$)/.test(blob);
  }

  function satColCounts(showCiudades) {
    // Sin columnas IZC (4): 27→23 / 26→22; spacer 19→15 / 18→14
    return showCiudades
      ? { empty: 23, spacer: 15 }
      : { empty: 22, spacer: 14 };
  }

  function canEditTrm() {
    return isAdmin();
  }

  function applyTrmEditLock() {
    var input = document.getElementById('cotizadorTrm');
    if (!input) return;
    if (canEditTrm()) {
      input.removeAttribute('readonly');
      input.removeAttribute('aria-readonly');
      input.classList.remove('is-readonly');
      input.title = 'TRM del día (editable por administrador)';
    } else {
      input.setAttribute('readonly', 'readonly');
      input.setAttribute('aria-readonly', 'true');
      input.classList.add('is-readonly');
      input.title = 'Solo el administrador puede modificar la TRM';
    }
  }

  var IZC_EMPRESA = 'IZC MAYORISTA S.A.S.';
  var VALTECH_EMPRESA = 'VALTECH MAYORISTA S.A.S.';

  function applyZktecoCotizadorUi() {
    if (!isZkteco()) return;
    var title = document.getElementById('cotizadorTitle');
    if (title) title.textContent = 'Cotizador ZKTECO';
    try { document.title = 'Cotizador ZKTECO - IZC MAYORISTA'; } catch (eT) { /* ignore */ }
    var sel = document.getElementById('cotizadorEmpresa');
    if (sel) {
      sel.innerHTML = '<option value="' + IZC_EMPRESA + '" selected>' + IZC_EMPRESA + '</option>';
      sel.value = IZC_EMPRESA;
      sel.disabled = true;
      sel.setAttribute('aria-readonly', 'true');
    }
    try { document.body.classList.add('is-zkteco-cotizador'); } catch (eB) { /* ignore */ }
    var clientCard = document.getElementById('cotizadorClientCard');
    if (clientCard) {
      clientCard.hidden = true;
      clientCard.style.display = 'none';
    }
    var fechaWrap = document.querySelector('.cotizador-fecha-cierre');
    if (fechaWrap) {
      fechaWrap.hidden = true;
      fechaWrap.style.display = 'none';
    }
    var fechaEl = document.getElementById('cotizadorFechaCierreVenta');
    if (fechaEl) fechaEl.value = '';
    var skuEl = document.getElementById('cotizadorSku');
    if (skuEl) {
      skuEl.placeholder = 'Ej: 4031, scanner, TT 70X50';
    }
    selectedLp = DEFAULT_LP;
    if (typeof syncLegalBrand === 'function') syncLegalBrand();
  }

  function applySatCotizadorUi() {
    if (!isSatCotizador()) return;
    var gp = isGp();
    var titleText = gp ? 'Cotizador GP' : 'Cotizador Admin SAT';
    var title = document.getElementById('cotizadorTitle');
    if (title) title.textContent = titleText;
    try { document.title = titleText + ' - VALTECH Mayorista'; } catch (eT) { /* ignore */ }
    var nav = document.getElementById('cotizadorSatNavLink');
    if (nav) nav.textContent = titleText;
    var foot = document.getElementById('cotizadorSatFooterLabel');
    if (foot) foot.textContent = titleText;
    var panelLink = document.getElementById('cotizadorSatPanelLink');
    if (panelLink) {
      panelLink.href = gp ? 'panel-gp.html' : 'panel-sat.html';
      panelLink.textContent = gp ? 'Volver al panel GP' : 'Volver al panel Admin SAT';
    }
    var sel = document.getElementById('cotizadorEmpresa');
    if (sel) {
      sel.innerHTML = '<option value="' + VALTECH_EMPRESA + '" selected>' + VALTECH_EMPRESA + '</option>';
      sel.value = VALTECH_EMPRESA;
      sel.disabled = true;
      sel.setAttribute('aria-readonly', 'true');
    }
    try { document.body.classList.add('is-sat-cotizador'); } catch (eB) { /* ignore */ }
    var skuEl = document.getElementById('cotizadorSku');
    if (skuEl) {
      skuEl.placeholder = 'Ej: 4031, scanner, KT21';
      var skuLabel = document.querySelector('label[for="cotizadorSku"]');
      if (skuLabel) skuLabel.textContent = 'Buscar producto SAT (código, nombre o referencia)';
    }
    selectedLp = DEFAULT_LP;
    if (typeof syncLegalBrand === 'function') syncLegalBrand();
    setupGpVendedorSelect(gp);
  }

  var gpVendedoresLoaded = false;
  var gpVendedoresPromise = null;

  function getSelectedVendedorCodigo() {
    var sel = document.getElementById('cotizadorVendedorSelect');
    if (!sel || sel.hidden) return '';
    return String(sel.value || '').trim().toUpperCase();
  }

  function setupGpVendedorSelect(show) {
    var field = document.getElementById('cotizadorVendedorField');
    var sel = document.getElementById('cotizadorVendedorSelect');
    if (!field || !sel) return;
    if (!show) {
      field.hidden = true;
      sel.value = '';
      return;
    }
    field.hidden = false;
    if (gpVendedoresLoaded) return;
    if (gpVendedoresPromise) return;
    gpVendedoresPromise = postApi({
      action: 'list_vendedores_gp',
      gp_codigo: getAsesorCodigo() || '',
      nit: getAsesorCodigo() || ''
    }).then(function (data) {
      gpVendedoresPromise = null;
      if (!data || !data.ok || !Array.isArray(data.vendedores)) return;
      var current = String(sel.value || '');
      var html = '<option value="">Sin asignar</option>';
      data.vendedores.forEach(function (v) {
        if (!v || !v.codigo) return;
        var code = String(v.codigo).toUpperCase();
        var name = String(v.nombre || '').trim();
        var label = name && name.toUpperCase() !== code ? (code + ' — ' + name) : code;
        html += '<option value="' + code.replace(/"/g, '') + '">' + label.replace(/</g, '&lt;') + '</option>';
      });
      sel.innerHTML = html;
      if (current) sel.value = current;
      gpVendedoresLoaded = true;
    }).catch(function () {
      gpVendedoresPromise = null;
    });
  }

  function setupAdminCotizadorUi() {
    if (isSatCotizador()) return Promise.resolve();
    if (!isAdmin()) return Promise.resolve();
    var title = document.getElementById('cotizadorTitle');
    if (title) title.textContent = 'Cotizador (admin)';
    try {
      var logo = document.querySelector('a.logo[href="asesor.html"]');
      if (logo) logo.setAttribute('href', 'admin.html');
    } catch (eLogo) { /* ignore */ }
    return Promise.resolve();
  }

  var nitToSellerCache = null;
  var nitToSellerPromise = null;

  function loadNitToSellerMap() {
    if (nitToSellerCache) return Promise.resolve(nitToSellerCache);
    if (nitToSellerPromise) return nitToSellerPromise;
    nitToSellerPromise = fetch('data/asesor_clientes_index.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (data) {
        var map = {};
        var by = (data && data.by_codigo) || {};
        Object.keys(by).forEach(function (code) {
          var block = by[code];
          var list = (block && block.clientes) || [];
          list.forEach(function (c) {
            if (!c) return;
            var nit = String(c.nit || '').replace(/\D+/g, '');
            if (nit && !map[nit]) map[nit] = String(code).toUpperCase();
          });
        });
        nitToSellerCache = map;
        return map;
      })
      .catch(function () {
        nitToSellerPromise = null;
        nitToSellerCache = {};
        return nitToSellerCache;
      });
    return nitToSellerPromise;
  }

  function resolveSellerCodigoForNit(nit) {
    var n = String(nit || '').replace(/\D+/g, '');
    if (!n) return Promise.resolve('');
    return loadNitToSellerMap().then(function (map) {
      return String((map && map[n]) || '').trim().toUpperCase();
    });
  }

  function queryParam(name) {
    try {
      return String(new URLSearchParams(window.location.search).get(name) || '').trim();
    } catch (e) {
      return '';
    }
  }

  function cotizarSessionKey(codigo) {
    var code = String(codigo || getAsesorCodigo() || '').trim().toUpperCase();
    return code ? ('izc_asesor_cotizar_' + code) : 'izc_asesor_cotizar';
  }

  function clearForeignCotizarSessions() {
    var codigo = String(getAsesorCodigo() || '').trim().toUpperCase();
    try {
      if (!window.sessionStorage) return;
      // Clave legacy compartida (contaminaba entre asesores).
      sessionStorage.removeItem('izc_asesor_cotizar');
      if (!codigo) return;
      // Quitar seeds de otros asesores.
      for (var i = sessionStorage.length - 1; i >= 0; i--) {
        var k = sessionStorage.key(i);
        if (!k || k.indexOf('izc_asesor_cotizar_') !== 0) continue;
        if (k !== cotizarSessionKey(codigo)) sessionStorage.removeItem(k);
      }
    } catch (e) { /* ignore */ }
  }

  function readStoredCotizarPayload() {
    clearForeignCotizarSessions();
    var codigo = String(getAsesorCodigo() || '').trim().toUpperCase();
    if (!codigo || !window.sessionStorage) return null;
    try {
      var raw = sessionStorage.getItem(cotizarSessionKey(codigo));
      if (!raw) return null;
      var stored = JSON.parse(raw);
      if (!stored || typeof stored !== 'object') return null;
      var owner = String(stored.asesor_codigo || '').trim().toUpperCase();
      if (owner && owner !== codigo) {
        sessionStorage.removeItem(cotizarSessionKey(codigo));
        return null;
      }
      return stored;
    } catch (e) {
      return null;
    }
  }

  function resolveClientContext() {
    var nit = normalizeNit(queryParam('nit'));
    var nombre = queryParam('nombre');
    var quoteId = queryParam('quote_id') || queryParam('id');
    var recotizar = queryParam('recotizar') === '1';
    var duplicatedFrom = queryParam('duplicated_from') || queryParam('recotizado_desde') || '';
    var hasUrlContext = !!(nit || quoteId || recotizar || duplicatedFrom);
    try {
      var stored = readStoredCotizarPayload();
      if (stored) {
        // Sin contexto en URL: no heredar recotización/borrador de otra sesión.
        if (hasUrlContext) {
          if (!nit) nit = normalizeNit(stored.nit);
          if (!nombre) nombre = String(stored.nombre || '').trim();
          if (!quoteId) quoteId = String(stored.quote_id || stored.id || '').trim();
          if (!duplicatedFrom) {
            duplicatedFrom = String(stored.duplicated_from || stored.recotizado_desde || '').trim();
          }
          if (!recotizar) recotizar = !!stored.recotizar;
        } else if (stored.recotizar || stored.duplicated_from || stored.recotizado_desde) {
          // Entrada limpia al cotizador: descartar seed de recotizar ajeno/previo.
          try { sessionStorage.removeItem(cotizarSessionKey()); } catch (e0) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }
    try {
      if (nombre) nombre = decodeURIComponent(nombre.replace(/\+/g, ' '));
    } catch (e2) { /* keep as-is */ }
    if (recotizar) quoteId = '';
    clientContext = {
      nit: nit,
      nombre: String(nombre || '').trim(),
      quoteId: String(quoteId || '').trim(),
      bitrixDealId: '',
      duplicatedFrom: duplicatedFrom,
      recotizar: recotizar
    };
    return clientContext;
  }

  function paintClientCard() {
    var nombreEl = document.getElementById('cotizadorClientNombreInput');
    var nitEl = document.getElementById('cotizadorClientNitInput');
    if (nombreEl && document.activeElement !== nombreEl) {
      nombreEl.value = clientContext.nombre || '';
    }
    if (nitEl && document.activeElement !== nitEl) {
      nitEl.value = clientContext.nit || '';
    }
  }

  function dataPath(relative) {
    var rel = String(relative || '').replace(/^\//, '');
    if (window.IZCAuth && typeof IZCAuth.siteBasePath === 'function') {
      return IZCAuth.siteBasePath() + rel;
    }
    var path = String(location.pathname || '/');
    var i = path.lastIndexOf('/');
    var base = i < 0 ? '/' : path.slice(0, i + 1);
    return base + rel;
  }

  var clientLookupTimer = null;
  var clientLookupSeq = 0;
  var nitNombresCache = null;
  var nitNombresSearchList = null;
  var nitNombresPromise = null;

  function nitVariants(nit) {
    var n = normalizeNit(nit);
    var out = [];
    if (!n) return out;
    out.push(n);
    var digits = String(n).replace(/\D+/g, '');
    if (digits && out.indexOf(digits) === -1) out.push(digits);
    if (digits) {
      var noZeros = digits.replace(/^0+/, '');
      if (noZeros && out.indexOf(noZeros) === -1) out.push(noZeros);
    }
    return out;
  }

  function loadNitNombresMap() {
    if (nitNombresCache) return Promise.resolve(nitNombresCache);
    if (nitNombresPromise) return nitNombresPromise;
    nitNombresPromise = fetch(dataPath('data/nit_nombres.json'), { cache: 'default' })
      .then(function (r) {
        if (!r.ok) throw new Error('sin nombres');
        return r.json();
      })
      .then(function (data) {
        var map = {};
        var list = [];
        if (Array.isArray(data)) {
          data.forEach(function (row) {
            if (!row || typeof row !== 'object') return;
            var key = normalizeNit(row.nit);
            var nombre = String(row.nombre || '').trim();
            if (!key || !nombre || nombre === key) return;
            nitVariants(key).forEach(function (v) { map[v] = nombre; });
            if (key.toUpperCase() !== 'ZKTECO') {
              list.push({ nit: key, nombre: nombre, telefono: '' });
            }
          });
        } else if (data && typeof data === 'object') {
          Object.keys(data).forEach(function (key) {
            var k = normalizeNit(key);
            var nombre = String(data[key] || '').trim();
            if (!k || !nombre || nombre === k) return;
            nitVariants(k).forEach(function (v) { map[v] = nombre; });
            if (k.toUpperCase() !== 'ZKTECO') {
              list.push({ nit: k, nombre: nombre, telefono: '' });
            }
          });
        }
        nitNombresCache = map;
        nitNombresSearchList = list;
        return map;
      })
      .catch(function () {
        nitNombresCache = {};
        nitNombresSearchList = [];
        return nitNombresCache;
      });
    return nitNombresPromise;
  }

  function loadNitNombresSearchList() {
    return loadNitNombresMap().then(function () {
      return nitNombresSearchList || [];
    });
  }

  function enrichNombreFromNitMap(nit, nombre) {
    var n = String(nombre || '').trim();
    var key = normalizeNit(nit);
    if (n && n !== key) return n;
    var map = nitNombresCache;
    if (!map) return n;
    var vars = nitVariants(key);
    for (var i = 0; i < vars.length; i++) {
      if (map[vars[i]]) return map[vars[i]];
    }
    return n;
  }

  function nitMatchesVariant(a, b) {
    var va = nitVariants(a);
    var vb = nitVariants(b);
    for (var i = 0; i < va.length; i++) {
      for (var j = 0; j < vb.length; j++) {
        if (va[i] === vb[j]) return true;
      }
    }
    return false;
  }

  function lookupClienteInLocalSources(rawNit) {
    var nit = normalizeNit(rawNit);
    if (!nit || nit.length < 6) return Promise.resolve(null);
    return Promise.all([
      loadAsesorClientes().catch(function () { return []; }),
      loadNitNombresMap().catch(function () { return {}; })
    ]).then(function () {
      var list = asesorClientesCache || [];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (!c || !nitMatchesVariant(c.nit, nit)) continue;
        var nombre = enrichNombreFromNitMap(c.nit, c.nombre);
        if (!nombre || nombre === c.nit) continue;
        return { nit: normalizeNit(c.nit), nombre: nombre, telefono: String(c.telefono || '').trim(), source: 'asesor' };
      }
      var map = nitNombresCache || {};
      var vars = nitVariants(nit);
      for (var v = 0; v < vars.length; v++) {
        var fromMap = String(map[vars[v]] || '').trim();
        if (fromMap && fromMap !== vars[v] && fromMap !== nit) {
          return { nit: nit, nombre: fromMap, telefono: '', source: 'index' };
        }
      }
      return null;
    });
  }

  function lookupClienteNombreByNit(rawNit) {
    var nit = normalizeNit(rawNit);
    if (!nit || nit.length < 6) return Promise.resolve(null);
    if (nit.toUpperCase() === 'ZKTECO') return Promise.resolve(null);
    var seq = ++clientLookupSeq;

    function normalizeHit(hit) {
      if (seq !== clientLookupSeq || !hit) return null;
      var nombre = String(hit.nombre || '').trim();
      if (!nombre || nombre === nit) return null;
      return {
        nit: normalizeNit(hit.nit || nit),
        nombre: nombre,
        telefono: String(hit.telefono || '').trim()
      };
    }

    var localPromise = lookupClienteInLocalSources(nit).then(normalizeHit);

    var apiAsesorPromise = Promise.resolve(null);
    if (isStaff() && getAsesorCodigo()) {
      apiAsesorPromise = postApi({
        action: 'lookup_cliente_asesor',
        asesor_codigo: getAsesorCodigo(),
        client_nit: nit
      }).then(function (data) {
        if (seq !== clientLookupSeq) return null;
        if (!data || !data.ok) return null;
        if (/acci[oó]n no v[aá]lida/i.test(String(data.error || ''))) return null;
        var nombre = String(data.nombre || '').trim();
        if (!nombre || nombre === nit) return null;
        return {
          nit: normalizeNit(data.nit || nit),
          nombre: nombre,
          telefono: String(data.telefono || '').trim()
        };
      }).catch(function () {
        return null;
      });
    }

    var apiIndexPromise = !isStaff() ? Promise.resolve(null) : postApi({
      action: 'lookup_nit_nombre',
      client_nit: nit,
      nit: nit
    }).then(function (data) {
      if (seq !== clientLookupSeq) return null;
      if (!data || !data.ok) return null;
      if (/acci[oó]n no v[aá]lida/i.test(String(data.error || ''))) return null;
      var nombre = String(data.nombre || '').trim();
      if (!nombre || nombre === nit) return null;
      return {
        nit: normalizeNit(data.nit || nit),
        nombre: nombre,
        telefono: String(data.telefono || '').trim()
      };
    }).catch(function () {
      return null;
    });

    return Promise.all([localPromise, apiAsesorPromise, apiIndexPromise]).then(function (results) {
      return results[1] || results[2] || results[0] || null;
    });
  }

  function applyClienteLookupFromNitInput(opts) {
    opts = opts || {};
    var nitEl = document.getElementById('cotizadorClientNitInput');
    var nombreEl = document.getElementById('cotizadorClientNombreInput');
    if (!nitEl) return;
    var nit = normalizeNit(nitEl.value);
    if (!nit || nit.length < 6) return;
    lookupClienteNombreByNit(nit).then(function (hit) {
      if (!hit) {
        if (opts.announce !== false) {
          setMessage('Cliente no encontrado, Verifica el NIT', 'error');
        }
        return;
      }
      // Evitar pisar si el usuario cambió el NIT mientras llegaba la respuesta.
      if (normalizeNit(nitEl.value) !== nit) return;
      applyingClientPick = true;
      clientContext.nit = hit.nit || nit;
      clientContext.nombre = hit.nombre;
      if (nombreEl) {
        nombreEl.value = hit.nombre;
      }
      hideClientNombreSuggestions();
      syncClientFromInputs();
      applyingClientPick = false;
      if (opts.announce !== false) {
        setMessage('Cliente: ' + hit.nombre, 'ok');
      }
    });
  }

  var asesorClientesCache = null;
  var asesorClientesPromise = null;
  var clientNombreSuggestIdx = -1;
  var clientNombreSuggestTimer = null;
  var clientNombreLookupSeq = 0;
  var applyingClientPick = false;

  function normalizeSearchText(s) {
    var t = String(s || '').toLowerCase();
    try {
      if (typeof t.normalize === 'function') {
        t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      }
    } catch (e) { /* ignore */ }
    return t.replace(/\s+/g, ' ').trim();
  }

  function loadAsesorClientes() {
    if (asesorClientesCache) return Promise.resolve(asesorClientesCache);
    if (asesorClientesPromise) return asesorClientesPromise;
    if (!isStaff() || !getAsesorCodigo()) {
      asesorClientesCache = [];
      return Promise.resolve(asesorClientesCache);
    }
    asesorClientesPromise = loadNitNombresMap().then(function () {
      var code = getAsesorCodigo();
      var payload = {
        asesor_codigo: code,
        nit: code,
        fast: 1
      };
      if (isSatCotizador() && isGp()) {
        payload.action = 'list_clientes_gp';
        payload.gp_codigo = code;
      } else if (isSatCotizador()) {
        // Admin SAT: sin cartera de asesor; solo mapa local / búsqueda libre.
        asesorClientesCache = [];
        return [];
      } else {
        payload.action = 'list_clientes_asesor';
      }
      return postApi(payload);
    }).then(function (data) {
      var list = [];
      var seen = {};
      if (data && data.ok && Array.isArray(data.clientes)) {
        data.clientes.forEach(function (c) {
          if (!c) return;
          var nit = normalizeNit(c.nit);
          if (!nit || seen[nit]) return;
          if (nit.toUpperCase() === 'ZKTECO') return;
          var nombre = enrichNombreFromNitMap(nit, c.nombre);
          if (!nombre || nombre === nit) return;
          seen[nit] = true;
          list.push({
            nit: nit,
            nombre: nombre,
            telefono: String(c.telefono || '').trim()
          });
        });
      }
      asesorClientesCache = list;
      return list;
    }).catch(function () {
      asesorClientesPromise = null;
      return asesorClientesCache || [];
    });
    return asesorClientesPromise;
  }

  function collectClientSearchPool() {
    var merged = [];
    var seen = {};
    // Solo mis clientes del asesor (nunca el catálogo global nit_nombres).
    (asesorClientesCache || []).forEach(function (c) {
      if (!c) return;
      var nit = normalizeNit(c.nit);
      if (!nit || seen[nit]) return;
      if (nit.toUpperCase() === 'ZKTECO') return;
      var nombre = enrichNombreFromNitMap(nit, c.nombre);
      if (!nombre || nombre === nit) return;
      seen[nit] = true;
      merged.push({
        nit: nit,
        nombre: nombre,
        telefono: String(c.telefono || '').trim()
      });
    });
    return merged;
  }

  function scoreClientesByNombre(list, q, limit) {
    limit = limit || 8;
    var needle = normalizeSearchText(q);
    if (needle.length < 2) return [];
    var needleDigits = needle.replace(/\D+/g, '');
    var scored = [];
    (list || []).forEach(function (row) {
      if (!row) return;
      var nombreNorm = normalizeSearchText(row.nombre);
      var nitNorm = normalizeSearchText(row.nit);
      var idx = nombreNorm ? nombreNorm.indexOf(needle) : -1;
      if (idx < 0 && needleDigits.length >= 3) {
        idx = nitNorm.indexOf(needleDigits);
      }
      if (idx < 0) return;
      scored.push({
        c: row,
        score: idx === 0 ? 0 : 1,
        len: nombreNorm ? nombreNorm.length : nitNorm.length
      });
    });
    scored.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return a.len - b.len;
    });
    return scored.slice(0, limit).map(function (x) { return x.c; });
  }

  function searchClientesByNombre(q, limit) {
    limit = limit || 8;
    var needle = normalizeSearchText(q);
    if (needle.length < 2) return Promise.resolve([]);

    var localHits = scoreClientesByNombre(collectClientSearchPool(), q, limit);
    loadNitNombresMap();
    if (isStaff() && getAsesorCodigo()) loadAsesorClientes();

    var apiPromise = Promise.resolve([]);
    if (isStaff() && getAsesorCodigo() && !(isSatCotizador() && isSat() && !isGp())) {
      var searchPayload = {
        action: 'search_clientes_nombre',
        q: q,
        limit: limit,
        asesor_codigo: getAsesorCodigo(),
        nit_asesor: getAsesorCodigo(),
        fast: 1
      };
      if (isSatCotizador() && isGp()) {
        searchPayload.gp_codigo = getAsesorCodigo();
      }
      apiPromise = postApi(searchPayload).then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.clientes)) return [];
        return data.clientes.filter(function (c) {
          return c && normalizeNit(c.nit) && String(c.nombre || '').trim();
        }).map(function (c) {
          return {
            nit: normalizeNit(c.nit),
            nombre: String(c.nombre || '').trim(),
            telefono: String(c.telefono || '').trim()
          };
        });
      }).catch(function () {
        return [];
      });
    }

    var remote = Promise.all([
      loadAsesorClientes().catch(function () { return []; }),
      apiPromise
    ]).then(function (parts) {
      var seen = {};
      var merged = [];
      (parts[1] || []).concat(parts[0] || []).forEach(function (c) {
        if (!c) return;
        var nit = normalizeNit(c.nit);
        if (!nit || seen[nit] || nit.toUpperCase() === 'ZKTECO') return;
        var nombre = enrichNombreFromNitMap(nit, c.nombre);
        if (!nombre || nombre === nit) return;
        seen[nit] = true;
        merged.push({
          nit: nit,
          nombre: nombre,
          telefono: String(c.telefono || '').trim()
        });
      });
      var scored = scoreClientesByNombre(merged, q, limit);
      return scored.length ? scored : localHits;
    });

    if (localHits.length) {
      return remote.then(function (later) {
        return (later && later.length) ? later : localHits;
      });
    }
    return Promise.race([
      remote,
      new Promise(function (resolve) {
        setTimeout(function () {
          resolve(scoreClientesByNombre(collectClientSearchPool(), q, limit));
        }, 700);
      })
    ]).then(function (hits) {
      if (hits && hits.length) return hits;
      return remote;
    });
  }

  function hideClientNombreSuggestions() {
    var list = document.getElementById('cotizadorClientNombreSuggest');
    if (list) {
      list.innerHTML = '';
      list.hidden = true;
    }
    clientNombreSuggestIdx = -1;
  }

  function paintClientNombreSuggestActive(list) {
    if (!list) return;
    var buttons = list.querySelectorAll('.cotizador-client-suggest-item');
    for (var i = 0; i < buttons.length; i++) {
      if (i === clientNombreSuggestIdx) buttons[i].classList.add('is-active');
      else buttons[i].classList.remove('is-active');
    }
  }

  function renderClientNombreSuggestions(matches) {
    var list = document.getElementById('cotizadorClientNombreSuggest');
    if (!list) return;
    if (!matches || !matches.length) {
      hideClientNombreSuggestions();
      return;
    }
    clientNombreSuggestIdx = -1;
    list.innerHTML = matches.map(function (m) {
      return (
        '<li role="option">' +
          '<button type="button" class="cotizador-client-suggest-item" data-nit="' + escapeHtml(m.nit) + '" data-nombre="' + escapeHtml(m.nombre) + '">' +
            '<span class="cotizador-client-suggest-name">' + escapeHtml(m.nombre) + '</span>' +
            '<span class="cotizador-client-suggest-nit">NIT ' + escapeHtml(m.nit) + '</span>' +
          '</button>' +
        '</li>'
      );
    }).join('');
    list.hidden = false;
  }

  function renderClientNombreEmpty(q) {
    var list = document.getElementById('cotizadorClientNombreSuggest');
    if (!list) return;
    clientNombreSuggestIdx = -1;
    list.innerHTML =
      '<li class="cotizador-client-suggest-empty">Sin coincidencias para «' +
      escapeHtml(q) +
      '»</li>';
    list.hidden = false;
  }

  function selectClienteSuggestion(nit, nombre) {
    var nitEl = document.getElementById('cotizadorClientNitInput');
    var nombreEl = document.getElementById('cotizadorClientNombreInput');
    applyingClientPick = true;
    clientContext.nit = normalizeNit(nit);
    clientContext.nombre = String(nombre || '').trim();
    if (nombreEl) nombreEl.value = clientContext.nombre;
    if (nitEl) nitEl.value = clientContext.nit;
    hideClientNombreSuggestions();
    syncClientFromInputs();
    applyingClientPick = false;
    setMessage('Cliente: ' + clientContext.nombre + ' · NIT ' + clientContext.nit, 'ok');
  }

  function updateClientNombreSuggestions() {
    if (applyingClientPick) return;
    var nombreEl = document.getElementById('cotizadorClientNombreInput');
    if (!nombreEl) return;
    var q = String(nombreEl.value || '').trim();
    var seq = ++clientNombreLookupSeq;
    if (q.length < 2) {
      hideClientNombreSuggestions();
      return;
    }
    var localHits = scoreClientesByNombre(collectClientSearchPool(), q, 8);
    if (localHits.length) renderClientNombreSuggestions(localHits);
    searchClientesByNombre(q, 8).then(function (matches) {
      if (seq !== clientNombreLookupSeq) return;
      if (document.activeElement !== nombreEl) return;
      if (matches && matches.length) {
        renderClientNombreSuggestions(matches);
        return;
      }
      if (localHits.length) return;
      renderClientNombreEmpty(q);
      setMessage('Cliente no encontrado, Verifica el nombre', 'error');
    });
  }

  function applyClienteLookupFromNombreInput(opts) {
    opts = opts || {};
    if (applyingClientPick) return;
    var nombreEl = document.getElementById('cotizadorClientNombreInput');
    if (!nombreEl) return;
    var q = String(nombreEl.value || '').trim();
    if (q.length < 2) return;
    var seq = ++clientNombreLookupSeq;
    searchClientesByNombre(q, 8).then(function (matches) {
      if (seq !== clientNombreLookupSeq) return;
      if (String(nombreEl.value || '').trim() !== q) return;
      if (!matches.length) {
        hideClientNombreSuggestions();
        if (opts.announce !== false) {
          setMessage('Cliente no encontrado, Verifica el nombre', 'error');
        }
        return;
      }
      var exact = normalizeSearchText(q);
      var hit = null;
      for (var i = 0; i < matches.length; i++) {
        if (normalizeSearchText(matches[i].nombre) === exact) {
          hit = matches[i];
          break;
        }
      }
      if (!hit && matches.length === 1) hit = matches[0];
      if (!hit) {
        if (opts.showSuggest !== false) renderClientNombreSuggestions(matches);
        return;
      }
      selectClienteSuggestion(hit.nit, hit.nombre);
    });
  }

  function syncClientFromInputs() {
    var nombreEl = document.getElementById('cotizadorClientNombreInput');
    var nitEl = document.getElementById('cotizadorClientNitInput');
    var prevKey = itemsStorageKey();
    if (nombreEl) clientContext.nombre = String(nombreEl.value || '').trim();
    if (nitEl) {
      clientContext.nit = normalizeNit(nitEl.value);
    }
    // Si cambia el NIT y no hay quote_id, el borrador usa otra clave.
    if (!clientContext.quoteId && prevKey && prevKey !== itemsStorageKey()) {
      writeItems(items);
    }
    if (isAdmin() && clientContext.nit && typeof resolveSellerCodigoForNit === 'function') {
      resolveSellerCodigoForNit(clientContext.nit).then(function (code) {
        if (code) clientContext.seller_codigo = code;
      });
    }
  }

  function itemsStorageKey() {
    var codigo = getAsesorCodigo();
    var quoteId = clientContext.quoteId || clientContext.nit;
    if (!quoteId && isZkteco()) quoteId = 'draft';
    if (!codigo || !quoteId) return '';
    return STORAGE_PREFIX + codigo + '_' + quoteId;
  }

  function fleteStorageKey() {
    var codigo = getAsesorCodigo();
    var quoteId = clientContext.quoteId || clientContext.nit;
    if (!quoteId && isZkteco()) quoteId = 'draft';
    if (!codigo || !quoteId) return '';
    return 'izc_cotizador_asesor_flete_' + codigo + '_' + quoteId;
  }

  function readFleteOverride() {
    var key = fleteStorageKey();
    if (!key) return null;
    try {
      var raw = localStorage.getItem(key);
      if (raw == null || raw === '') return null;
      var n = Number(raw);
      return isFinite(n) && n >= 0 ? n : null;
    } catch (e) {
      return null;
    }
  }

  function writeFleteOverride(value) {
    fleteOverride = value;
    var key = fleteStorageKey();
    if (!key) return;
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch (e) { /* ignore */ }
  }

  function setMessage(text, type) {
    var el = document.getElementById('cotizadorMessage');
    if (!el) return;
    if (window.IZCAuth && typeof IZCAuth.setFlashMessage === 'function') {
      IZCAuth.setFlashMessage(el, text, type, 'cotizador-message');
      return;
    }
    window.clearTimeout(messageTimer);
    messageTimer = null;
    el.textContent = text || '';
    el.className = 'cotizador-message' + (type ? ' is-' + type : '');
    if (text) {
      messageTimer = window.setTimeout(function () {
        if (el.textContent === text) {
          el.textContent = '';
          el.className = 'cotizador-message';
        }
        messageTimer = null;
      }, 7000);
    }
  }

  function excelRoundDown(value, digits) {
    var v = Number(value);
    if (!isFinite(v)) return 0;
    digits = digits || 0;
    var sign = v < 0 ? -1 : 1;
    var factor = Math.pow(10, digits);
    var scaled = Math.abs(v) * factor;
    // Quitar basura flotante justo por debajo/arriba de un entero
    var nearest = Math.round(scaled);
    if (Math.abs(scaled - nearest) < 1e-7) scaled = nearest;
    return sign * Math.floor(scaled) / factor;
  }

  function roundDown2(value) {
    return excelRoundDown(value, 2);
  }

  function roundDown0(value) {
    return excelRoundDown(value, 0);
  }

  /** ROUNDDOWN(I * 1.19, 0) como en Excel. */
  function copConIvaFromSinIva(copSinIva) {
    var i = Number(copSinIva);
    if (!isFinite(i) || i <= 0) return 0;
    return roundDown0(i * 1.19);
  }

  /** SAT columna G: =F*1,19 con redondeo normal (no ROUNDDOWN). */
  function satCopConIvaFromSinIva(copSinIva) {
    var i = Number(copSinIva);
    if (!isFinite(i) || i <= 0) return 0;
    return Math.round(i * 119 / 100);
  }

  function formatUSD(value) {
    // Excel H: "USD "#.##0,00 → 2 decimales (ROUNDDOWN)
    var n = roundDown2(value);
    if (!isFinite(n)) n = 0;
    return 'USD ' + n.toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /** Excel I/J: \$#.##0 (sin decimales, redondeo de visualización). */
  function formatCOPInt(value) {
    var n = Math.round(Number(value));
    if (!isFinite(n)) n = 0;
    return '$' + n.toLocaleString('es-CO');
  }

  /** Totales / Total COP: \$#.##0,00 */
  function formatCOP(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    return '$' + n.toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatCOPDec(value) {
    return formatCOP(value);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeSku(value) {
    // Asesor: permite códigos manuales (letras/números); limpia espacios.
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[^A-Z0-9\-_./]/g, '');
  }

  function isManualItem(item) {
    if (!item) return false;
    if (item.custom || item.manual || item.created_by) return true;
    if (isCreatedProductSku(item.sku)) return true;
    return !lookupPriceStrict(item.sku, getItemLp(item));
  }

  function lookupZktecoOverlay(sku) {
    return window.IZCZktecoOverlay && typeof IZCZktecoOverlay.get === 'function'
      ? IZCZktecoOverlay.get(sku)
      : null;
  }

  function loadZktecoOverlay() {
    if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.load === 'function') {
      return IZCZktecoOverlay.load().then(function () {
        searchCatalog = null;
      });
    }
    return Promise.resolve();
  }

  function lookupCreatedProduct(sku) {
    var ov = lookupZktecoOverlay(sku);
    if (ov) {
      return String(ov.source || '').toLowerCase() === 'created' ? ov : null;
    }
    if (!createdProductsMap || !sku) return null;
    var key = normalizeSku(sku);
    if (key && Object.prototype.hasOwnProperty.call(createdProductsMap, key)) {
      return createdProductsMap[key];
    }
    var noZeros = String(sku).replace(/^0+/, '');
    if (noZeros && Object.prototype.hasOwnProperty.call(createdProductsMap, noZeros)) {
      return createdProductsMap[noZeros];
    }
    return null;
  }

  function isCreatedProductSku(sku) {
    return !!lookupCreatedProduct(sku);
  }

  function getTrm() {
    var input = document.getElementById('cotizadorTrm');
    var n = input ? Number(input.value) : DEFAULT_TRM;
    if (!isFinite(n) || n <= 0) n = DEFAULT_TRM;
    return n;
  }

  function setTrmValue(value) {
    var input = document.getElementById('cotizadorTrm');
    var n = Number(value);
    if (!input || !isFinite(n) || n <= 0) return;
    input.value = String(n);
    try { window.__IZC_TRM__ = n; } catch (eTrm) { /* ignore */ }
  }

  function persistServerTrm(value) {
    if (!canEditTrm()) return Promise.resolve(false);
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return Promise.resolve(false);
    var nit = '';
    var nombre = '';
    try {
      if (window.IZCAuth && IZCAuth.getSessionNit) nit = IZCAuth.getSessionNit() || '';
      if (window.IZCAuth && IZCAuth.getSessionNombre) nombre = IZCAuth.getSessionNombre() || '';
    } catch (eSess) { /* ignore */ }
    return postApi({
      action: 'set_trm',
      admin_nit: nit,
      admin_nombre: nombre,
      value: n
    }).then(function (data) {
      if (!data || !data.ok) {
        setMessage((data && data.error) || 'No se pudo guardar la TRM en el servidor.', 'error');
        return false;
      }
      setTrmValue(data.value);
      if (window.IZCLiveSync) IZCLiveSync.emit(IZCLiveSync.TYPES.TRM, { value: data.value });
      if (window.IZCPrices && typeof IZCPrices.reloadTrm === 'function') IZCPrices.reloadTrm();
      setMessage('TRM actualizada en todos los cotizadores.', 'ok');
      return true;
    }).catch(function () {
      setMessage('No se pudo guardar la TRM. Revisa el servidor local.', 'error');
      return false;
    });
  }

  function postApi(payload) {
    if (isZkteco()) {
      payload = Object.assign({ zkteco_user: 'ZKTECO' }, payload || {});
    }
    if (window.IZCAuth && typeof IZCAuth.postAuth === 'function') {
      return IZCAuth.postAuth(payload);
    }
    var body = JSON.stringify(payload);
    var endpoints = apiEndpoints();

    function tryOne(i) {
      if (i >= endpoints.length) {
        return Promise.reject(new Error('sin api'));
      }
      return fetch(endpoints[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        cache: 'no-store'
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try {
            data = JSON.parse(text);
          } catch (e) {
            throw new Error('API no JSON (HTTP ' + res.status + ')');
          }
          if (!data || typeof data !== 'object') throw new Error('Respuesta inválida');
          data._http = res.status;
          return data;
        });
      }).catch(function (err) {
        if (i + 1 >= endpoints.length) throw err;
        return tryOne(i + 1);
      });
    }

    return tryOne(0);
  }

  /** Sync Bitrix en segundo plano; resuelve con deal_id si llega. */
  function fireSyncBitrixQuote(quoteId) {
    if (isZkteco()) return Promise.resolve('');
    var qid = String(quoteId || '').trim();
    if (!qid) return Promise.resolve('');
    var payload = {
      action: 'sync_bitrix_quote',
      quote_id: qid,
      asesor_codigo: getAsesorCodigo(),
      nit_asesor: getAsesorCodigo()
    };
    return postApi(payload).then(function (data) {
      if (!data || !data.ok) return '';
      var dealId = '';
      if (data.bitrix && data.bitrix.deal_id) dealId = String(data.bitrix.deal_id).trim();
      if (!dealId && data.deal_id) dealId = String(data.deal_id).trim();
      return dealId;
    }).catch(function () {
      return '';
    });
  }

  /** Reserva el N° Bitrix al abrir el cotizador para que al terminar el PDF salga en ~2s. */
  function reserveBitrixDealEarly() {
    if (isZkteco() || isSatCotizador()) return Promise.resolve('');
    if (!isStaff() || !getAsesorCodigo()) return Promise.resolve('');
    var nit = String(clientContext.nit || '').trim();
    if (!nit) return Promise.resolve('');
    var existing = String(clientContext.bitrixDealId || '').trim();
    if (existing && /^\d+$/.test(existing) && existing.length <= 12 && !/^20\d{6,}/.test(existing)) {
      return Promise.resolve(existing);
    }
    return postApi({
      action: 'reserve_bitrix_deal_asesor',
      asesor_codigo: getAsesorCodigo(),
      nit_asesor: getAsesorCodigo(),
      client_nit: nit,
      nit: nit,
      nombre: clientContext.nombre || '',
      empresa: (typeof getEmpresa === 'function') ? getEmpresa() : '',
      quote_source: quoteSourceForSave(),
      quote_id: clientContext.quoteId || '',
      bitrix_deal_id: existing || ''
    }).then(function (data) {
      var dealId = data && data.ok ? String(data.deal_id || '').trim() : '';
      if (dealId && /^\d+$/.test(dealId) && dealId.length <= 12 && !/^20\d{6,}/.test(dealId)) {
        clientContext.bitrixDealId = dealId;
        return dealId;
      }
      return '';
    }).catch(function () {
      return '';
    });
  }

  function fetchServerTrm() {
    return postApi({ action: 'get_trm' }).then(function (data) {
      if (data && data.ok && data.value != null) {
        setTrmValue(data.value);
        return Number(data.value);
      }
      return Number(document.getElementById('cotizadorTrm') && document.getElementById('cotizadorTrm').value) || 0;
    }).catch(function () {
      return Number(document.getElementById('cotizadorTrm') && document.getElementById('cotizadorTrm').value) || 0;
    });
  }

  function resolveEntry(entry) {
    if (entry == null) return null;
    if (typeof entry === 'number' && isFinite(entry) && entry > 0) {
      // Números enormes sueltos suelen ser COP mal etiquetados como USD (p.ej. Ruijie).
      if (entry >= 5000) return { amount: entry, currency: 'COP' };
      return { amount: entry, currency: 'USD' };
    }
    if (typeof entry === 'object') {
      var amount = entry.amount != null ? entry.amount : entry.v;
      var currency = entry.currency || entry.c || 'USD';
      if (amount != null && isFinite(Number(amount)) && Number(amount) > 0) {
        var amt = Number(amount);
        var cur = String(currency).toUpperCase();
        // Si dice USD pero el monto es típico de pesos, tratarlo como COP.
        if (cur === 'USD' && amt >= 5000) cur = 'COP';
        var pesos = entry.pesos != null ? Number(entry.pesos)
          : (entry.listPesos != null ? Number(entry.listPesos)
            : (entry.listCop != null ? Number(entry.listCop) : NaN));
        // Bandera 0 / 0.10 en columna USD: el precio real está en PESOS.
        if (cur === 'USD' && amt <= 0.10) {
          if (isFinite(pesos) && pesos > 0) return { amount: pesos, currency: 'COP' };
          return null;
        }
        var out = { amount: amt, currency: cur };
        if (isFinite(pesos) && pesos > 0) {
          out.pesos = pesos;
          // Conservar USD de lista aparte para no perderlo al liquidar por PESOS.
          if (cur === 'USD') out.usdList = amt;
        }
        return out;
      }
    }
    return null;
  }

  function getSelectedLp() {
    return selectedLp || DEFAULT_LP;
  }

  function getDefaultFleteId() {
    return '0.0185';
  }

  function normalizeLpId(lpId) {
    var v = String(lpId || '').trim().toLowerCase();
    if (!v) return DEFAULT_LP;
    if (LP_ALIASES[v]) v = LP_ALIASES[v];
    v = v.replace(/^lp[_\s-]+/, '');
    if (LP_ALIASES[v]) v = LP_ALIASES[v];
    for (var i = 0; i < LP_OPTIONS.length; i++) {
      if (LP_OPTIONS[i].id === v) return v;
      if (String(LP_OPTIONS[i].label || '').toLowerCase() === v) return LP_OPTIONS[i].id;
    }
    return DEFAULT_LP;
  }

  function lpLabel(lpId) {
    var id = normalizeLpId(lpId);
    for (var i = 0; i < LP_OPTIONS.length; i++) {
      if (LP_OPTIONS[i].id === id) return LP_OPTIONS[i].label;
    }
    return id;
  }

  function isZebraProduct(sku, name) {
    var n = String(name || lookupName(sku) || '').toLowerCase();
    if (n.indexOf('zebra') >= 0) return true;
    var s = String(sku || '').trim();
    if (!s || !priceMapsByLp) return false;
    var hasZebraLp = false;
    for (var i = 0; i < ZEBRA_LP_IDS.length; i++) {
      if (lookupPriceStrict(s, ZEBRA_LP_IDS[i])) {
        hasZebraLp = true;
        break;
      }
    }
    if (!hasZebraLp) return false;
    // Zebra puro: no tiene precio en listas especializadas IZC.
    var specialty = ['drm', 'franquicia', 'master', 'ups', 'pv', 'etiquetado', 'contadoras', 'lp_promos'];
    for (var j = 0; j < specialty.length; j++) {
      if (lookupPriceStrict(s, specialty[j])) return false;
    }
    return true;
  }

  function lpOptionsForSku(sku, name) {
    if (!isZebraProduct(sku, name)) return LP_OPTIONS.slice();
    var out = [];
    var seen = {};
    ZEBRA_LP_IDS.forEach(function (id) {
      for (var i = 0; i < LP_OPTIONS.length; i++) {
        if (LP_OPTIONS[i].id === id) {
          out.push(LP_OPTIONS[i]);
          seen[id] = true;
        }
      }
    });
    // Otras LP solo si ese SKU tiene precio en esa lista (p.ej. desde IZC).
    LP_OPTIONS.forEach(function (opt) {
      if (seen[opt.id]) return;
      if (lookupPriceStrict(sku, opt.id)) {
        out.push(opt);
        seen[opt.id] = true;
      }
    });
    return out.length ? out : LP_OPTIONS.slice(0, 3);
  }

  function getItemLp(item) {
    if (item && item.lp) return normalizeLpId(item.lp);
    return getSelectedLp();
  }

  function resolveFleteSelection(rawId) {
    var raw = String(rawId == null ? '' : rawId).trim();
    for (var i = 0; i < FLETE_OPTIONS.length; i++) {
      if (FLETE_OPTIONS[i].id === raw) {
        return {
          id: FLETE_OPTIONS[i].id,
          label: FLETE_OPTIONS[i].label,
          rate: FLETE_OPTIONS[i].rate,
          gratis: !!FLETE_OPTIONS[i].gratis,
          tccOnlyUnder: !!FLETE_OPTIONS[i].tccOnlyUnder
        };
      }
    }
    if (raw === 'gratis' || /gratis/i.test(raw)) {
      return { id: 'gratis', label: 'Gratis', rate: 0, gratis: true, tccOnlyUnder: false };
    }
    var rate = Number(raw);
    if (!isFinite(rate) || rate < 0) rate = 0.0185;
    var label = 'Flete ' + (rate * 100).toFixed(2).replace('.', ',') + ' %';
    return { id: String(rate), label: label, rate: rate, gratis: false, tccOnlyUnder: Math.abs(rate - FLETE_TCC_RATE) < 1e-9 };
  }

  function getItemFlete(item) {
    if (item && item.flete != null && item.flete !== '') {
      return resolveFleteSelection(item.flete);
    }
    return getFleteSelection();
  }

  function applyLpMap(lpId) {
    selectedLp = normalizeLpId(lpId || DEFAULT_LP);
    if (priceMapsByLp && priceMapsByLp[selectedLp]) {
      priceMap = priceMapsByLp[selectedLp];
    } else {
      // Nunca saltar a otra LP (evita mostrar Volumen al pedir Interna).
      priceMap = null;
    }
  }

  /** Aplica la LP elegida a TODAS las líneas. Conserva precios editados a mano. */
  function applySelectedLpToAllItems(lpId) {
    var lp = normalizeLpId(lpId || DEFAULT_LP);
    applyLpMap(lp);
    if (!items.length) return { updated: 0, missing: 0 };
    var updated = 0;
    var missing = 0;
    var kept = 0;
    var list = items.map(function (it) {
      if (!it || typeof it !== 'object') return it;
      var copy = Object.assign({}, it, { lp: lp });
      if (copy.priceModified || copy.usdOverride != null || copy.copOverride != null || copy.copIvaOverride != null) {
        kept += 1;
      } else {
        copy = clearPriceOverrides(copy);
      }
      updated += 1;
      if (!lookupPriceStrict(copy.sku, lp)) missing += 1;
      return copy;
    });
    writeItems(list);
    return { updated: updated, missing: missing, kept: kept, lp: lp };
  }

  function lookupPriceStrict(sku, lpId) {
    var lp = normalizeLpId(lpId || DEFAULT_LP);
    if (!priceMapsByLp || !sku) return null;
    var map = priceMapsByLp[lp];
    if (!map || typeof map !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(map, sku)) {
      return resolveEntry(map[sku]);
    }
    var noZeros = String(sku).replace(/^0+/, '');
    if (noZeros && noZeros !== String(sku) && Object.prototype.hasOwnProperty.call(map, noZeros)) {
      return resolveEntry(map[noZeros]);
    }
    return null;
  }

  function lookupPrice(sku, lpId) {
    if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.price === 'function') {
      var overlayPrice = IZCZktecoOverlay.price(sku);
      if (overlayPrice) return forceEtiquetaCop(overlayPrice, sku);
    }
    var lp = normalizeLpId(lpId || getSelectedLp());
    var entry = lookupPriceStrict(sku, lp);
    // LISTA PROMOS en Excel a menudo guarda bandera 0/0.1/1 en vez del precio.
    // El cotizador Excel usa Interna como referencia → mismo fallback aquí.
    if (lp === 'lp_promos') {
      var amt = entry && entry.amount != null ? Number(entry.amount) : NaN;
      if (!entry || !isFinite(amt) || amt <= 2) {
        return forceEtiquetaCop(
          lookupPriceStrict(sku, 'interna') ||
          lookupPriceStrict(sku, 'volumen') ||
          lookupPriceStrict(sku, 'web') ||
          entry,
          sku
        );
      }
    }
    if (entry) return forceEtiquetaCop(entry, sku);
    // Precio del catálogo manual compartido (productos creados por asesores).
    var created = lookupCreatedProduct(sku);
    if (created) {
      var usd = Number(created.unitario_usd || created.unitarioUsd || created.usd || 0);
      var cop = Number(created.unitario_cop || created.unitarioCop || created.cop || 0);
      if (isFinite(usd) && usd > 0) return { amount: usd, currency: 'USD', pesos: cop > 0 ? cop : null };
      if (isFinite(cop) && cop > 0) return { amount: cop, currency: 'COP' };
    }
    return null;
  }

  /** Etiquetas: precio siempre en COP (columna PESOS), nunca USD. */
  function isEtiquetaName(name) {
    var n = normalizeSearchText(name);
    if (!n) return false;
    if (/(impresora|printer|aplicador|dispensador|software|reloj|demo|aio|lector|scanner|escaner)/.test(n)) {
      return false;
    }
    return n.indexOf('etiqueta') >= 0;
  }

  function forceEtiquetaCop(entry, sku) {
    if (!entry) return entry;
    var name = lookupName(sku) || lookupReferencia(sku) || '';
    if (!isEtiquetaName(name)) return entry;
    var pesos = entry.pesos != null ? Number(entry.pesos)
      : (entry.listPesos != null ? Number(entry.listPesos) : NaN);
    if ((!isFinite(pesos) || pesos <= 0) && String(entry.currency || '').toUpperCase() === 'COP') {
      pesos = Number(entry.amount);
    }
    if (!isFinite(pesos) || pesos <= 0) return entry;
    return { amount: pesos, currency: 'COP' };
  }

  function lookupName(sku) {
    if (!sku) return null;
    var ov = lookupZktecoOverlay(sku);
    if (ov && (ov.name || ov.nombre)) {
      var fromOv = normalizeProductLabel(ov.name || ov.nombre, sku);
      if (fromOv) return fromOv;
      if (ov.name) return String(ov.name).trim();
    }
    if (productMap && Object.prototype.hasOwnProperty.call(productMap, sku)) {
      var fromMap = normalizeProductLabel(productMap[sku], sku);
      if (fromMap) return fromMap;
    }
    var noZeros = String(sku).replace(/^0+/, '');
    if (noZeros && productMap && Object.prototype.hasOwnProperty.call(productMap, noZeros)) {
      var fromNz = normalizeProductLabel(productMap[noZeros], sku);
      if (fromNz) return fromNz;
    }
    var created = lookupCreatedProduct(sku);
    if (created) {
      var createdName = normalizeProductLabel(created.name || created.nombre || '', sku);
      if (createdName) return createdName;
      if (created.name) return String(created.name).trim();
    }
    var ref = lookupReferencia(sku);
    if (ref) return nameFromReferencia(sku, ref);
    return null;
  }

  function isPlaceholderProductName(name, sku) {
    var n = String(name || '').trim();
    if (!n || n === '—' || n === '-' || n === '–') return true;
    if (/^producto\s+\d/i.test(n)) return false;
    var s = String(sku || '').trim();
    if (s && n.toUpperCase() === s.toUpperCase()) return true;
    if (s && n === s + '—') return true;
    return false;
  }

  function normalizeProductLabel(name, sku) {
    var n = String(name || '').trim();
    if (isPlaceholderProductName(n, sku)) return '';
    return n;
  }

  function nameFromReferencia(sku, ref) {
    var s = String(sku || '').trim();
    var r = String(ref || '').trim();
    if (!r) return s || '';
    if (s && r.toUpperCase().indexOf(s.toUpperCase()) === 0) return r;
    return s ? (s + '-' + r) : r;
  }

  function lookupReferencia(sku) {
    if (!sku) return '';
    var ov = lookupZktecoOverlay(sku);
    if (ov && ov.referencia) return String(ov.referencia || '');
    if (referenciaMap && Object.prototype.hasOwnProperty.call(referenciaMap, sku)) {
      var r = String(referenciaMap[sku] || '');
      if (r) return r;
    }
    var noZeros = String(sku).replace(/^0+/, '');
    if (noZeros && referenciaMap && Object.prototype.hasOwnProperty.call(referenciaMap, noZeros)) {
      var r2 = String(referenciaMap[noZeros] || '');
      if (r2) return r2;
    }
    var created = lookupCreatedProduct(sku);
    if (created && created.referencia) return String(created.referencia || '');
    return '';
  }

  function normalizeSearchText(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s\-_./]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function queryTokens(query) {
    var n = normalizeSearchText(query);
    if (!n) return [];
    return n.split(' ').filter(function (t) {
      return t.length >= 1;
    });
  }

  function rebuildSearchCatalog() {
    var bySku = {};
    function ensure(sku) {
      var key = String(sku || '').trim();
      if (!key) return null;
      if (!bySku[key]) {
        bySku[key] = {
          sku: key,
          name: '',
          referencia: ''
        };
      }
      return bySku[key];
    }

    if (productMap) {
      Object.keys(productMap).forEach(function (sku) {
        var row = ensure(sku);
        if (row) row.name = String(productMap[sku] || '');
      });
    }
    if (referenciaMap) {
      Object.keys(referenciaMap).forEach(function (sku) {
        var row = ensure(sku);
        if (row) row.referencia = String(referenciaMap[sku] || '');
      });
    }
    if (createdProductsMap) {
      Object.keys(createdProductsMap).forEach(function (sku) {
        if (lookupZktecoOverlay(sku)) return;
        var created = createdProductsMap[sku];
        if (!created) return;
        var row = ensure(sku);
        if (!row) return;
        row.manual = true;
        if (created.name && (!row.name || isPlaceholderProductName(row.name, sku))) {
          row.name = String(created.name || '');
        }
        if (created.referencia && !row.referencia) {
          row.referencia = String(created.referencia || '');
        }
      });
    }
    if (window.IZCZktecoOverlay && typeof IZCZktecoOverlay.forEach === 'function') {
      IZCZktecoOverlay.forEach(function (ov) {
        if (!ov) return;
        var row = ensure(ov.sku);
        if (!row) return;
        if (ov.name) row.name = String(ov.name || '');
        if (ov.referencia) row.referencia = String(ov.referencia || '');
        if (String(ov.source || '').toLowerCase() === 'created') row.manual = true;
      });
    }

    searchCatalog = Object.keys(bySku).map(function (sku) {
      var row = bySku[sku];
      if (!row.name || isPlaceholderProductName(row.name, sku)) {
        row.name = lookupName(sku) || nameFromReferencia(sku, row.referencia) || row.name || '';
      }
      if (!row.referencia) row.referencia = lookupReferencia(sku) || '';
      if (isCreatedProductSku(sku) && !lookupPriceStrict(sku, DEFAULT_LP)) {
        row.manual = true;
      }
      row.haystack = normalizeSearchText(
        row.sku + ' ' + row.name + ' ' + row.referencia
      );
      return row;
    }).filter(function (row) {
      if (isDemoCatalogItem(row.name, row.sku, row.referencia)) return false;
      // Cotizador SAT: solo marca SAT. Cotizador asesor/admin IZC: IZC + SAT.
      if (isSatCotizador()) return isSatCatalogItem(row.name, row.sku, row.referencia);
      return true;
    });
  }

  function isDemoCatalogItem(name, sku, referencia) {
    if (window.IZCCatalogScope && typeof IZCCatalogScope.isDemoText === 'function') {
      return IZCCatalogScope.isDemoText(name, sku, referencia);
    }
    if (window.IZCCatalogScope && typeof IZCCatalogScope.isDemoProduct === 'function') {
      return IZCCatalogScope.isDemoProduct({ name: name, sku: sku, referencia: referencia });
    }
    var blob = [name, sku, referencia].join(' ').toUpperCase();
    return /(?:^|[^A-Z0-9])DEMO(?:[^A-Z0-9]|$)/.test(blob);
  }

  function ensureSearchCatalog() {
    if (!searchCatalog) rebuildSearchCatalog();
    return searchCatalog || [];
  }

  function searchProducts(query, limit) {
    var tokens = queryTokens(query);
    if (!tokens.length) return [];
    var max = Math.max(1, Math.min(Number(limit) || 12, 30));
    var catalog = ensureSearchCatalog();
    var exactSku = normalizeSku(query);
    var results = [];

    for (var i = 0; i < catalog.length; i++) {
      var row = catalog[i];
      var hay = row.haystack;
      var allMatch = true;
      var score = 0;
      for (var t = 0; t < tokens.length; t++) {
        var token = tokens[t];
        var pos = hay.indexOf(token);
        if (pos < 0) {
          allMatch = false;
          break;
        }
        score += 20;
        if (pos === 0) score += 8;
      }
      if (!allMatch) continue;

      var skuNorm = normalizeSearchText(row.sku);
      if (exactSku && normalizeSku(row.sku) === exactSku) score += 1000;
      else if (skuNorm === tokens.join('')) score += 400;
      else if (skuNorm.indexOf(tokens[0]) === 0) score += 120;
      if (normalizeSearchText(row.referencia).indexOf(tokens.join(' ')) === 0) score += 80;
      if (normalizeSearchText(row.name).indexOf(tokens[0]) === 0) score += 40;
      // Preferir ítems con precio en LP por defecto.
      if (lookupPrice(row.sku, DEFAULT_LP)) score += 15;

      results.push({
        sku: row.sku,
        name: row.name || ('Producto ' + row.sku),
        referencia: row.referencia || '',
        manual: !!row.manual || isCreatedProductSku(row.sku),
        score: score
      });
    }

    results.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.sku).localeCompare(String(b.sku));
    });
    return results.slice(0, max);
  }

  function hideSkuSuggestions() {
    var list = document.getElementById('cotizadorSkuSuggest');
    if (list) {
      list.innerHTML = '';
      list.hidden = true;
    }
    suggestActiveIdx = -1;
  }

  function paintSuggestActive(list) {
    if (!list) return;
    var buttons = list.querySelectorAll('.cotizador-sku-suggest-item');
    for (var i = 0; i < buttons.length; i++) {
      if (i === suggestActiveIdx) buttons[i].classList.add('is-active');
      else buttons[i].classList.remove('is-active');
    }
  }

  function inventarioSuggestHtml(sku) {
    var data = lookupInventario(sku);
    var total = isSatCotizador()
      ? INV_BODEGAS.reduce(function (sum, b) { return sum + (Number(data.valtech[b]) || 0); }, 0)
      : (data.total || 0);
    if (total <= 0) {
      return '<span class="cotizador-sku-suggest-stock is-agotado">Agotado</span>';
    }
    var vtParts = INV_BODEGAS.map(function (b) {
      return b + ':' + (data.valtech[b] || 0);
    }).join(' ');
    if (isSatCotizador()) {
      return (
        '<span class="cotizador-sku-suggest-stock">' +
          '<span class="cotizador-sku-suggest-stock-line">VT ' + escapeHtml(vtParts) + '</span>' +
          '<span class="cotizador-sku-suggest-stock-line is-total">Total ' + escapeHtml(String(total)) + '</span>' +
        '</span>'
      );
    }
    var izcParts = INV_BODEGAS.map(function (b) {
      return b + ':' + (data.izc[b] || 0);
    }).join(' ');
    return (
      '<span class="cotizador-sku-suggest-stock">' +
        '<span class="cotizador-sku-suggest-stock-line">IZC ' + escapeHtml(izcParts) + '</span>' +
        '<span class="cotizador-sku-suggest-stock-line">VT ' + escapeHtml(vtParts) + '</span>' +
        '<span class="cotizador-sku-suggest-stock-line is-total">Total ' + escapeHtml(String(total)) + '</span>' +
      '</span>'
    );
  }

  function renderSkuSuggestions(matches) {
    var list = document.getElementById('cotizadorSkuSuggest');
    if (!list) return;
    if (!matches || !matches.length) {
      hideSkuSuggestions();
      return;
    }
    suggestActiveIdx = -1;
    list.innerHTML = matches.map(function (m, idx) {
      var refLine = m.referencia
        ? '<span class="cotizador-sku-suggest-ref">' + escapeHtml(m.referencia) + '</span>'
        : '';
      var manualTag = m.manual
        ? ' <span class="cotizador-manual-tag" title="Producto creado manualmente">M</span>'
        : '';
      return (
        '<li role="option">' +
          '<button type="button" class="cotizador-sku-suggest-item" data-sku="' + escapeHtml(m.sku) + '" data-idx="' + idx + '">' +
            '<span class="cotizador-sku-suggest-main">' +
              '<span class="cotizador-sku-suggest-code">' + escapeHtml(m.sku) + '</span>' +
              '<span class="cotizador-sku-suggest-name">' + escapeHtml(m.name) + manualTag + '</span>' +
              refLine +
            '</span>' +
            inventarioSuggestHtml(m.sku) +
          '</button>' +
        '</li>'
      );
    }).join('');
    list.hidden = false;
  }

  function selectSkuSuggestion(sku, opts) {
    opts = opts || {};
    var input = document.getElementById('cotizadorSku');
    var qtyInput = document.getElementById('cotizadorQty');
    var chosen = normalizeSku(sku);
    pendingSelectedSku = chosen;
    if (input) {
      input.value = chosen;
    }
    hideSkuSuggestions();
    updateSkuPreview();

    // Click / Enter en sugerencia: agregar de una vez a la cotización.
    if (opts.add !== false) {
      if (!isStaff()) {
        window.location.href = 'login.html';
        return;
      }
      var qty = qtyInput ? qtyInput.value : 1;
      var before = items.length;
      addItem(chosen, qty);
      if (items.length > before) {
        if (input) input.value = '';
        if (qtyInput) qtyInput.value = '1';
        pendingSelectedSku = '';
        updateSkuPreview();
        if (input) input.focus();
      }
      return;
    }
    if (input) input.focus();
  }

  function resolveSkuFromInput(raw) {
    var text = String(raw || '').trim();
    if (!text) return '';

    if (pendingSelectedSku) {
      var chosen = pendingSelectedSku;
      pendingSelectedSku = '';
      return chosen;
    }

    var exact = normalizeSku(text);
    if (exact && (lookupName(exact) || lookupPrice(exact) || lookupReferencia(exact))) {
      if (isDemoCatalogItem(lookupName(exact) || '', exact, lookupReferencia(exact) || '')) {
        return '';
      }
      return exact;
    }

    var matches = searchProducts(text, 8);
    if (matches.length === 1) return normalizeSku(matches[0].sku);
    if (matches.length > 1) {
      // Si el texto es código exacto de alguno, úsalo.
      for (var i = 0; i < matches.length; i++) {
        if (normalizeSku(matches[i].sku) === exact) return exact;
      }
      return '';
    }
    return exact;
  }

  function updateSkuPreview() {
    var input = document.getElementById('cotizadorSku');
    var preview = document.getElementById('cotizadorSkuName');
    if (!input || !preview) return;

    var raw = String(input.value || '').trim();
    if (!raw) {
      preview.textContent = '';
      preview.className = 'cotizador-sku-name is-empty';
      hideSkuSuggestions();
      pendingSelectedSku = '';
      paintInventario('');
      return;
    }

    // Si el usuario sigue escribiendo, invalidar selección previa salvo que coincida.
    if (pendingSelectedSku && normalizeSku(raw) !== pendingSelectedSku) {
      pendingSelectedSku = '';
    }

    var exactSku = normalizeSku(raw);
    var exactName = exactSku ? lookupName(exactSku) : null;
    var exactPrice = exactSku ? lookupPrice(exactSku) : null;
    var exactRef = exactSku ? (lookupReferencia(exactSku) || '') : '';

    function showWrongBrand(msg) {
      hideSkuSuggestions();
      preview.textContent = msg;
      preview.className = 'cotizador-sku-name is-error';
      paintInventario('');
      setMessage('', '');
    }

    // Producto conocido de la otra marca: no mostrar nombre, solo aviso rojo.
    if (exactSku && (exactName || exactPrice || exactRef)) {
      if (isSatCotizador() && !isSatCatalogItem(exactName || '', exactSku, exactRef)) {
        showWrongBrand('Este producto no hace parte de la marca SAT');
        return;
      }
    }

    if (exactSku && isDemoCatalogItem(exactName || '', exactSku, exactRef)) {
      hideSkuSuggestions();
      preview.textContent = 'Producto demo — no disponible para cotizar.';
      preview.className = 'cotizador-sku-name is-warn';
      paintInventario('');
      return;
    }
    var matches = searchProducts(raw, 12);

    if (exactName && exactPrice && matches.length <= 1) {
      hideSkuSuggestions();
      preview.textContent = exactName;
      preview.className = 'cotizador-sku-name';
      paintInventario(exactSku);
      return;
    }
    if (exactName && !exactPrice && matches.length <= 1) {
      hideSkuSuggestions();
      preview.textContent = exactName + ' — sin precio en LP ' + lpLabel(getSelectedLp()) + ' (podrás editarlo al agregar).';
      preview.className = 'cotizador-sku-name is-warn';
      paintInventario(exactSku);
      return;
    }

    if (matches.length) {
      renderSkuSuggestions(matches);
      if (matches.length === 1) {
        var only = matches[0];
        if (isSatCotizador() && !isSatCatalogItem(only.name, only.sku, only.referencia)) {
          showWrongBrand('Este producto no hace parte de la marca SAT');
          return;
        }
        preview.textContent = only.sku + ' — ' + only.name;
        preview.className = 'cotizador-sku-name';
        paintInventario(only.sku);
      } else {
        preview.textContent = matches.length + ' productos encontrados. Elige uno de la lista.';
        preview.className = 'cotizador-sku-name';
        paintInventario(pendingSelectedSku || '');
      }
      return;
    }

    hideSkuSuggestions();
    preview.textContent = 'Sin coincidencias — se agregará como producto manual (edita nombre y precio en la tabla).';
    preview.className = 'cotizador-sku-name is-warn';
    paintInventario(exactSku);
  }

  function unitsFromEntry(entry, trm) {
    if (entry == null) return null;
    // Acepta número directo (override del asesor) o { amount, currency }
    if (typeof entry === 'number') {
      if (!isFinite(entry) || entry <= 0) return null;
      entry = { amount: entry, currency: 'USD' };
    }
    var amount = entry.amount != null ? Number(entry.amount) : NaN;
    if (!isFinite(amount) || amount <= 0) return null;

    var rate = Number(trm);
    if (!isFinite(rate) || rate <= 0) rate = DEFAULT_TRM;

    var currency = entry.currency === 'COP' ? 'COP' : 'USD';
    var usd;
    var cop;
    var listPesos = entry.pesos != null ? Number(entry.pesos)
      : (entry.listPesos != null ? Number(entry.listPesos)
        : (entry.listCop != null ? Number(entry.listCop) : NaN));
    var listUsd = entry.usdList != null ? Number(entry.usdList)
      : (entry.usdAmount != null ? Number(entry.usdAmount) : NaN);
    if (currency === 'USD' && amount <= 0.10 && isFinite(listPesos) && listPesos > 0) {
      currency = 'COP';
      amount = listPesos;
    }
    if (isFinite(listUsd) && listUsd > 0 && listUsd <= 0.10) listUsd = NaN;

    // 1) Forzado manual (edición COP / COP+IVA)
    if (entry.forceCop != null && isFinite(Number(entry.forceCop))) {
      cop = Number(entry.forceCop);
      usd = isFinite(listUsd) && listUsd > 0 ? roundDown2(listUsd) : roundDown2(cop / rate);
    } else if (currency === 'COP') {
      cop = Math.round(isFinite(listPesos) && listPesos > 0 ? listPesos : amount);
      usd = roundDown2(cop / rate);
    } else if (isFinite(listUsd) && listUsd > 0) {
      usd = roundDown2(listUsd);
      cop = Math.round(usd * rate);
    } else if (isFinite(listPesos) && listPesos > 0) {
      cop = Math.round(listPesos);
      if (currency === 'USD' && isFinite(amount) && amount > 0 && amount < 5000) {
        usd = roundDown2(amount);
        cop = Math.round(usd * rate);
      } else {
        usd = roundDown2(cop / rate);
      }
    } else if (currency === 'COP') {
      cop = Math.round(amount);
      usd = roundDown2(cop / rate);
    } else {
      usd = roundDown2(amount);
      cop = Math.round(usd * rate);
    }
    var copIva = entry.forceCopIva != null && isFinite(Number(entry.forceCopIva))
      ? Number(entry.forceCopIva)
      : copConIvaFromSinIva(cop);
    return {
      currency: currency,
      usd: usd,
      cop: cop,
      usdIva: usd * (1 + IVA),
      copIva: copIva,
      totalCopExcel: copIva
    };
  }

  function formatTotalIva(row) {
    if (!row || !row.ok) return '—';
    if (row.currency === 'COP') return formatCOP(row.totalCopIva);
    return formatUSD(row.totalUsdIva);
  }

  function hasLocalDraft() {
    var key = itemsStorageKey();
    if (!key) return false;
    try {
      return localStorage.getItem(key) != null;
    } catch (e) {
      return false;
    }
  }

  function readItems() {
    var key = itemsStorageKey();
    if (!key) return [];
    try {
      var raw = localStorage.getItem(key);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.map(function (it) {
        if (!it || typeof it !== 'object') return it;
        var copy = Object.assign({}, it);
        if (!copy.lp) copy.lp = getSelectedLp();
        if (copy.flete == null || copy.flete === '') copy.flete = getFleteSelection().id;
        if (copy.ciudad == null) copy.ciudad = '';
        return copy;
      });
    } catch (e) {
      return [];
    }
  }

  function writeItems(list) {
    var key = itemsStorageKey();
    items = list;
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  function priceOverridesFromSavedItem(it) {
    if (!it || typeof it !== 'object') return {};

    // Solo conservar precio guardado si el asesor lo modificó a mano.
    // Si no, se re-preciará desde la LP actual (columna PESOS), evitando
    // cotizaciones viejas con COP = USD×TRM (p.ej. 102129 en vez de 107800).
    var src = String(it.priceEditSource || '').toLowerCase();
    var modified = !!(it.priceModified || it.edited);
    if (!modified) return {};

    if (src === 'usd') {
      var uUsd = Number(it.usdOverride != null ? it.usdOverride : (it.unitarioUsd != null ? it.unitarioUsd : it.usd));
      if (isFinite(uUsd) && uUsd > 0) {
        return { usdOverride: uUsd, priceEditSource: 'usd', priceModified: true };
      }
    }
    if (src === 'cop') {
      var uCop = Number(it.copOverride != null ? it.copOverride : (it.unitarioCop != null ? it.unitarioCop : (it.copSinIva != null ? it.copSinIva : it.cop)));
      if (isFinite(uCop) && uCop > 0) {
        return { copOverride: uCop, priceEditSource: 'cop', priceModified: true };
      }
    }
    if (src === 'copiva') {
      var uCopIva = Number(it.copIvaOverride != null ? it.copIvaOverride : it.copIva);
      if (isFinite(uCopIva) && uCopIva > 0) {
        return { copIvaOverride: uCopIva, priceEditSource: 'copIva', priceModified: true };
      }
    }

    if (it.copOverride != null && Number(it.copOverride) > 0) {
      return { copOverride: Number(it.copOverride), priceEditSource: src || 'cop', priceModified: true };
    }
    if (it.copIvaOverride != null && Number(it.copIvaOverride) > 0) {
      return { copIvaOverride: Number(it.copIvaOverride), priceEditSource: 'copIva', priceModified: true };
    }
    if (it.usdOverride != null && Number(it.usdOverride) > 0) {
      return { usdOverride: Number(it.usdOverride), priceEditSource: src || 'usd', priceModified: true };
    }

    var usd = Number(it.unitarioUsd != null ? it.unitarioUsd : it.usd);
    var cop = Number(it.unitarioCop != null ? it.unitarioCop : (it.copSinIva != null ? it.copSinIva : it.cop));
    if (src === 'usd' && isFinite(usd) && usd > 0) return { usdOverride: usd, priceEditSource: 'usd', priceModified: true };
    if (isFinite(cop) && cop > 0) return { copOverride: cop, priceEditSource: 'cop', priceModified: true };
    if (isFinite(usd) && usd > 0) return { usdOverride: usd, priceEditSource: 'usd', priceModified: true };
    return {};
  }

  /** Si el USD es el de lista, adjuntar PESOS para no liquidar como USD×TRM. */
  function attachListPesos(entry, sku, lpId) {
    if (!entry || typeof entry !== 'object') return entry;
    if (entry.pesos != null && isFinite(Number(entry.pesos)) && Number(entry.pesos) > 0) {
      if (entry.usdList == null && String(entry.currency || '').toUpperCase() === 'USD') {
        entry.usdList = Number(entry.amount);
      }
      return entry;
    }
    if (String(entry.currency || '').toUpperCase() === 'COP') return entry;
    var listed = lookupPriceStrict(sku, lpId);
    if (!listed || listed.pesos == null) return entry;
    var listPesos = Number(listed.pesos);
    if (!isFinite(listPesos) || listPesos <= 0) return entry;
    var listUsd = Number(listed.usdList != null ? listed.usdList : listed.amount);
    var entryUsd = Number(entry.amount);
    if (!isFinite(listUsd) || !isFinite(entryUsd)) return entry;
    // Si el USD editado sigue siendo el de lista (±1 centavo), usar PESOS.
    // Si el asesor cambió el USD, no adjuntar (COP = USD×TRM a propósito).
    if (Math.abs(roundDown2(listUsd) - roundDown2(entryUsd)) > 0.015) return entry;
    entry.pesos = listPesos;
    entry.usdList = listUsd;
    return entry;
  }

  function normalizeSeedItems(rawItems) {
    var out = [];
    var defaultLp = getSelectedLp();
    var defaultFlete = getFleteSelection().id;
    (Array.isArray(rawItems) ? rawItems : []).forEach(function (it) {
      if (!it) return;
      var sku = normalizeSku(it.sku || it.codigo || it.code);
      if (!sku) return;
      var qty = Math.max(1, Math.floor(Number(it.qty != null ? it.qty : it.cantidad) || 1));
      var lp = normalizeLpId(it.lp || defaultLp);
      var flete = resolveFleteSelection(it.flete != null ? it.flete : (it.flete_rate != null ? it.flete_rate : defaultFlete)).id;
      // Cada línea se conserva aparte (permite el mismo SKU varias veces).
      var row = { sku: sku, qty: qty, lp: lp, flete: flete };
      if (it.ciudad != null && String(it.ciudad).trim()) row.ciudad = String(it.ciudad).trim();
      Object.assign(row, priceOverridesFromSavedItem(it));
      if (it.name) row.name = String(it.name);
      if (it.referencia != null && it.referencia !== '') row.referencia = String(it.referencia);
      out.push(row);
    });
    return out;
  }

  function readSessionSeed() {
    try {
      var stored = readStoredCotizarPayload();
      if (!stored) return { items: [], trm: null, empresa: '', fecha_cierre: '' };
      var storedNit = normalizeNit(stored.nit);
      var storedQuote = String(stored.quote_id || stored.id || '').trim();
      var storedDup = String(stored.duplicated_from || stored.recotizado_desde || '').trim();
      var storedRecotizar = !!stored.recotizar || !!clientContext.recotizar;
      // Solo usar seed si coincide con el contexto actual.
      if (clientContext.nit && storedNit && storedNit !== clientContext.nit) {
        return { items: [], trm: null, empresa: '', fecha_cierre: '' };
      }
      if (storedRecotizar || clientContext.recotizar) {
        if (!clientContext.recotizar && !clientContext.duplicatedFrom) {
          return { items: [], trm: null, empresa: '', fecha_cierre: '' };
        }
        if (clientContext.duplicatedFrom && storedDup && storedDup !== clientContext.duplicatedFrom) {
          return { items: [], trm: null, empresa: '', fecha_cierre: '' };
        }
        return {
          items: normalizeSeedItems(stored.items),
          trm: stored.trm != null ? Number(stored.trm) : null,
          empresa: String(stored.empresa || '').trim(),
          fecha_cierre: toFechaCierreInputValue(stored.fecha_cierre)
        };
      }
      if (clientContext.quoteId && storedQuote && storedQuote !== clientContext.quoteId) {
        return { items: [], trm: null, empresa: '', fecha_cierre: '' };
      }
      // Cotizador abierto sin cliente/quote: no rehidratar ítems viejos.
      if (!clientContext.nit && !clientContext.quoteId) {
        return { items: [], trm: null, empresa: '', fecha_cierre: '' };
      }
      return {
        items: normalizeSeedItems(stored.items),
        trm: stored.trm != null ? Number(stored.trm) : null,
        empresa: String(stored.empresa || '').trim(),
        fecha_cierre: toFechaCierreInputValue(stored.fecha_cierre)
      };
    } catch (e) {
      return { items: [], trm: null, empresa: '', fecha_cierre: '' };
    }
  }

  function fetchQuoteItemsFromApi() {
    var codigo = getAsesorCodigo();
    var quoteId = clientContext.quoteId;
    var nit = clientContext.nit;
    if (!codigo) return Promise.resolve([]);

    // Recotizar: cargar ítems de la cotización origen (duplicated_from).
    if (!quoteId && clientContext.recotizar && clientContext.duplicatedFrom) {
      quoteId = clientContext.duplicatedFrom;
    }

    if (quoteId) {
      return postApi({
        action: 'get_quote_asesor',
        asesor_codigo: codigo,
        quote_id: quoteId,
        enrich_bitrix: 0
      }).then(function (data) {
        if (!data || !data.ok || !data.quote) return [];
        var found = data.quote;
        if (!clientContext.nombre && found.nombre) {
          clientContext.nombre = String(found.nombre || '').trim();
          paintClientCard();
        }
        if (!clientContext.recotizar && found.id) {
          clientContext.quoteId = String(found.id);
        }
        if (found.fecha_cierre) setFechaCierreVenta(found.fecha_cierre);
        if (found.empresa && !isZkteco()) {
          var empresaSel = document.getElementById('cotizadorEmpresa');
          if (empresaSel && !empresaSel.value) {
            empresaSel.value = String(found.empresa || '').trim();
            if (typeof syncLegalBrand === 'function') syncLegalBrand();
          }
        }
        return normalizeSeedItems(found.items);
      }).catch(function () {
        return [];
      });
    }

    if (!nit || clientContext.recotizar) return Promise.resolve([]);
    return postApi({
      action: 'list_quotes_asesor',
      asesor_codigo: codigo,
      filtro: 'nuevas',
      fast: 1,
      list_only: 1
    }).then(function (data) {
      if (!data || !data.ok || !Array.isArray(data.quotes)) return [];
      var found = null;
      var want = normalizeNit(nit);
      data.quotes.forEach(function (q) {
        if (!q || !q.id) return;
        var qNit = normalizeNit(q.nit);
        if (qNit !== want) return;
        if (!found || String(q.created_at || '') > String(found.created_at || '')) found = q;
      });
      if (!found) return [];
      if (found.id) {
        clientContext.quoteId = String(found.id);
        if (!clientContext.nombre && found.nombre) {
          clientContext.nombre = String(found.nombre || '').trim();
          paintClientCard();
        }
      }
      return fetchQuoteItemsFromApi();
    }).catch(function () {
      return [];
    });
  }

  function applySeedItems(seedItems, sourceLabel) {
    if (!seedItems || !seedItems.length) return false;
    writeItems(seedItems);
    setMessage(
      'Se cargaron ' + seedItems.length + ' producto(s) de la cotización del cliente' +
        (sourceLabel ? ' (' + sourceLabel + ')' : '') + '.',
      'ok'
    );
    return true;
  }

  var jsonCache = {};

  function loadJson(path, forceReload) {
    if (!forceReload && jsonCache[path]) {
      return Promise.resolve(jsonCache[path]);
    }
    if (window.IZCData && typeof IZCData.loadJson === 'function') {
      return IZCData.loadJson(path, { cache: 'default', forceReload: !!forceReload }).then(function (data) {
        jsonCache[path] = data;
        return data;
      });
    }
    var url = path;
    if (forceReload) url += ((path.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now());
    return fetch(url, { cache: forceReload ? 'no-store' : 'default' }).then(function (r) {
      if (!r.ok) throw new Error('sin datos');
      return r.json();
    }).then(function (data) {
      jsonCache[path] = data;
      return data;
    });
  }

  function loadPrices(forceReload) {
    return loadJson(PRECIOS_PATH, !!forceReload).then(function (data) {
      var stamp = data && data.stamp != null ? String(data.stamp) : '';
      if (forceReload && stamp && stamp === lastLpStamp && priceMapsByLp) {
        return priceMap;
      }
      if (stamp) lastLpStamp = stamp;

      if (data && data.by_list && typeof data.by_list === 'object') {
        priceMapsByLp = data.by_list;
        fillLpSelect(data.lists);
        applyLpMap(getSelectedLp());
        searchCatalog = null;
        return priceMap;
      }
      // fallback: mapa plano (lista clientes)
      priceMapsByLp = { clientes: data && typeof data === 'object' ? data : {} };
      applyLpMap('clientes');
      searchCatalog = null;
      return priceMap;
    }).catch(function () {
      if (!forceReload) {
        priceMapsByLp = null;
        priceMap = null;
        searchCatalog = null;
      }
      return priceMap;
    });
  }

  function startPricesAutoRefresh() {
    if (window.__IZC_LP_PRICES_WATCHING__) return;
    window.__IZC_LP_PRICES_WATCHING__ = true;
    setInterval(function () {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      var prev = lastLpStamp;
      loadPrices(false).then(function () {
        if (lastLpStamp && lastLpStamp !== prev) {
          render();
        }
      });
    }, PRECIOS_POLL_MS);
  }

  function ensureInventarioLoaded() {
    if (inventarioMap) return Promise.resolve(inventarioMap);
    if (inventarioLoadPromise) return inventarioLoadPromise;
    inventarioLoadPromise = loadInventario().then(function (map) {
      if (items.length) render();
      return map;
    }).catch(function () {
      inventarioLoadPromise = null;
      return inventarioMap || {};
    });
    return inventarioLoadPromise;
  }

  function startBackgroundLoads() {
    if (backgroundLoadsStarted) return;
    backgroundLoadsStarted = true;
    loadReferencias().catch(function () { /* ignore */ });
    loadFletes().catch(function () { /* ignore */ });
    loadEstelarFlete().catch(function () { /* ignore */ });
    ensureInventarioLoaded().catch(function () { /* ignore */ });
  }

  function ensureClientSearchData() {
    return loadNitNombresMap().catch(function () { return {}; });
  }

  function bootCotizadorCore() {
    render();
    // Reservar N° Bitrix en paralelo mientras carga el cotizador.
    try { reserveBitrixDealEarly(); } catch (eReserve) { /* ignore */ }
    return Promise.all([
      loadPrices(),
      loadProducts().then(function () { return loadCreatedProducts(); }),
      loadZktecoOverlay(),
      reloadUserData(),
      fetchServerTrm(),
      loadEstelarFlete().catch(function () { return null; })
    ]).then(function () {
      render();
      updateSkuPreview();
      startTrmAutoRefresh();
      startPricesAutoRefresh();
      startBackgroundLoads();
      try { reserveBitrixDealEarly(); } catch (eReserve2) { /* ignore */ }
    }).catch(function () {
      render();
      startBackgroundLoads();
    });
  }

  function startTrmAutoRefresh() {
    if (window.__IZC_TRM_WATCHING__) return;
    window.__IZC_TRM_WATCHING__ = true;
    var refresh = function () {
      var input = document.getElementById('cotizadorTrm');
      if (input && document.activeElement === input) return;
      var prev = getTrm();
      fetchServerTrm().then(function (next) {
        if (Number(next) !== Number(prev)) render();
      });
    };
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refresh();
    });
    window.addEventListener('focus', refresh);
    setInterval(refresh, 20 * 1000);
    if (window.IZCLiveSync && typeof IZCLiveSync.on === 'function') {
      IZCLiveSync.on(function (msg) {
        var t = msg && msg.type;
        if (t === IZCLiveSync.TYPES.TRM || t === IZCLiveSync.TYPES.ALL) refresh();
      });
    }
  }

  function fillLpSelect(lists) {
    // Selector global eliminado: la LP se elige por producto en la tabla.
    if (Array.isArray(lists) && lists.length) {
      var ids = lists.map(function (meta) { return meta && meta.id ? normalizeLpId(meta.id) : ''; });
      if (ids.indexOf(normalizeLpId(selectedLp)) < 0 && ids.indexOf(DEFAULT_LP) >= 0) {
        selectedLp = DEFAULT_LP;
      }
    }
    applyLpMap(getSelectedLp());
  }

  function loadProducts() {
    return loadJson(PRODUCTOS_PATH).then(function (data) {
      productMap = data && typeof data === 'object' ? data : {};
      searchCatalog = null;
      return productMap;
    }).catch(function () {
      productMap = {};
      searchCatalog = null;
      return productMap;
    });
  }

  function applyCreatedProducts(products) {
    var map = {};
    (Array.isArray(products) ? products : []).forEach(function (p) {
      if (!p) return;
      var sku = normalizeSku(p.sku || p.codigo || '');
      if (!sku) return;
      map[sku] = {
        sku: sku,
        name: String(p.name || p.nombre || '').trim(),
        referencia: String(p.referencia || '').trim(),
        unitario_usd: Number(p.unitario_usd || p.unitarioUsd || p.usd || 0),
        unitario_cop: Number(p.unitario_cop || p.unitarioCop || p.cop || 0),
        seller_codigo: String(p.seller_codigo || '').trim(),
        seller_name: String(p.seller_name || '').trim(),
        created_at: String(p.created_at || '')
      };
      if (!productMap) productMap = {};
      if (map[sku].name && (!productMap[sku] || isPlaceholderProductName(productMap[sku], sku))) {
        productMap[sku] = map[sku].name;
      }
      if (!referenciaMap) referenciaMap = {};
      if (map[sku].referencia && !referenciaMap[sku]) {
        referenciaMap[sku] = map[sku].referencia;
      }
    });
    createdProductsMap = map;
    searchCatalog = null;
    return map;
  }

  function loadCreatedProducts() {
    var codigo = getAsesorCodigo();
    if (!codigo) {
      createdProductsMap = createdProductsMap || {};
      return Promise.resolve(createdProductsMap);
    }
    return postApi({
      action: 'get_productos_creados',
      asesor_codigo: codigo,
      nit_asesor: codigo
    }).then(function (data) {
      if (!data || !data.ok) {
        createdProductsMap = createdProductsMap || {};
        return createdProductsMap;
      }
      return applyCreatedProducts(data.products || []);
    }).catch(function () {
      createdProductsMap = createdProductsMap || {};
      return createdProductsMap;
    });
  }

  function loadReferencias() {
    return loadJson(REFERENCIAS_PATH).then(function (data) {
      referenciaMap = data && typeof data === 'object' ? data : {};
      searchCatalog = null;
      return referenciaMap;
    }).catch(function () {
      referenciaMap = {};
      searchCatalog = null;
      return referenciaMap;
    });
  }

  function clearPriceOverrides(item) {
    var copy = Object.assign({}, item || {});
    delete copy.usdOverride;
    delete copy.copOverride;
    delete copy.copIvaOverride;
    delete copy.priceEditSource;
    delete copy.priceModified;
    return copy;
  }

  function lineCalc(item, trm) {
    var entry = null;
    var itemLp = getItemLp(item);
    var itemFlete = getItemFlete(item);
    var usdOverride = item && item.usdOverride != null ? Number(item.usdOverride) : NaN;
    var copOverride = item && item.copOverride != null ? Number(item.copOverride) : NaN;
    var copIvaOverride = item && item.copIvaOverride != null ? Number(item.copIvaOverride) : NaN;
    var editSource = String((item && item.priceEditSource) || '').toLowerCase();
    var priceModified = !!(item && item.priceModified);
    var edited = priceModified
      || (isFinite(usdOverride) && usdOverride > 0)
      || (isFinite(copOverride) && copOverride > 0)
      || (isFinite(copIvaOverride) && copIvaOverride > 0);

    // Sin edición manual del asesor → siempre precio vigente de la LP.
    // Si hay override/edición, NUNCA pisar con la lista.
    var listed = lookupPrice(item.sku, itemLp);
    if (!edited && listed) {
      entry = listed;
    } else if (editSource === 'usd' && isFinite(usdOverride) && usdOverride > 0) {
      // Edición en USD → COP = USD × TRM (mismo valor que se ve en pantalla).
      entry = { amount: usdOverride, currency: 'USD' };
    } else if (editSource === 'cop' && isFinite(copOverride) && copOverride > 0) {
      // Edición unitaria/P.V. en COP → USD = COP / TRM.
      entry = { amount: copOverride, currency: 'COP' };
    } else if ((editSource === 'copiva' || (!editSource && isFinite(copIvaOverride) && copIvaOverride > 0))
      && isFinite(copIvaOverride) && copIvaOverride > 0) {
      // Respetar el COP+IVA que escribió el asesor (no recalcular con ROUNDDOWN).
      var copFromIva = copIvaOverride / (1 + IVA);
      var usdFromIva = roundDown2(copFromIva / trm);
      entry = { amount: usdFromIva, currency: 'USD', forceCopIva: copIvaOverride, forceCop: copFromIva };
    } else if (isFinite(copOverride) && copOverride > 0) {
      entry = { amount: copOverride, currency: 'COP' };
    } else if (isFinite(usdOverride) && usdOverride > 0) {
      entry = { amount: usdOverride, currency: 'USD' };
    } else {
      entry = listed;
    }
    var units = unitsFromEntry(entry, trm);
    var manual = isManualItem(item);
    var storedName = normalizeProductLabel(item && item.name, item.sku);
    var nombre = storedName || lookupName(item.sku) || (manual ? ('Producto ' + item.sku) : '—');
    var referencia = (item && item.referencia != null && item.referencia !== '')
      ? String(item.referencia)
      : (lookupReferencia(item.sku) || (manual ? '' : '—'));
    if (!units) {
      return {
        ok: false,
        sku: item.sku,
        name: nombre,
        referencia: referencia || '—',
        qty: item.qty,
        manual: manual,
        lp: itemLp,
        flete: itemFlete,
        ciudad: String((item && item.ciudad) || '').trim(),
        usd: 0,
        copSinIva: 0,
        copConIva: 0,
        totalSinFlete: 0,
        fleteAntesIva: 0,
        totalConFlete: 0,
        estelarFibra: false,
        ivaExempt: false,
        edited: edited
      };
    }
    // Si el asesor forzó COP+IVA manual, no recalcular exención UVT.
    var forcedIva = isFinite(copIvaOverride) && copIvaOverride > 0;
    var satTotales = isSatExcelUnitPriceSku(item.sku);
    if (satTotales && !forcedIva) {
      units.copIva = satCopConIvaFromSinIva(units.cop);
      units.usdIva = units.usd * (1 + IVA);
    }
    var lineBaseSinIva = units.cop * item.qty;
    var exempt = !forcedIva && isIvaExemptUnit(units.cop, nombre, item.sku, lineBaseSinIva);
    var payableCop = exempt ? units.cop : units.copIva;
    var payableUsd = exempt ? units.usd : units.usdIva;
    var totalSinFlete = payableCop * item.qty;
    var fleteAntesIva = 0;
    var estelarFibra = isEstelarFlete(itemFlete) && isEstelarKgProduct(item.sku);
    if (estelarFibra) {
      fleteAntesIva = calcEstelarFibraLineFlete(item, units.cop, item.qty).fleteAntesIva;
    } else if (itemFlete && !itemFlete.gratis) {
      fleteAntesIva = lookupFleteConIva(item.sku, totalSinFlete, itemFlete.rate) / 1.19;
    }
    var totalConFlete = totalSinFlete + fleteAntesIva * (1 + IVA);
    return {
      ok: true,
      sku: item.sku,
      name: nombre,
      referencia: referencia || '—',
      qty: item.qty,
      manual: manual,
      lp: itemLp,
      flete: itemFlete,
      ciudad: String((item && item.ciudad) || '').trim(),
      currency: units.currency,
      usd: units.usd,
      copSinIva: units.cop,
      copConIva: payableCop,
      cop: units.cop,
      usdIva: payableUsd,
      copIva: payableCop,
      totalUsdIva: payableUsd * item.qty,
      totalCopIva: payableCop * item.qty,
      totalUsd: units.usd * item.qty,
      ivaExempt: exempt,
      totalCop: units.cop * item.qty,
      totalCopExcel: totalSinFlete,
      totalSinFlete: totalSinFlete,
      fleteAntesIva: fleteAntesIva,
      totalConFlete: totalConFlete,
      estelarFibra: estelarFibra,
      edited: edited
    };
  }

  function parseLocaleNumber(raw) {
    var s = String(raw == null ? '' : raw)
      .replace(/USD|COP|\$/gi, '')
      .replace(/\s/g, '')
      .trim();
    if (!s) return NaN;
    s = s.replace(/[^\d.,\-]/g, '');
    if (!s || s === '-' || s === '.' || s === ',') return NaN;

    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');

    if (lastComma >= 0 && lastDot >= 0) {
      // El separador que aparece al final es el decimal.
      if (lastComma > lastDot) {
        // 1.234.567,89 (es-CO)
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        // 1,234,567.89 (en-US)
        s = s.replace(/,/g, '');
      }
    } else if (lastComma >= 0) {
      // Solo comas: una coma con 1–3 decimales → decimal; si no, miles.
      var afterComma = s.slice(lastComma + 1);
      var commaCount = (s.match(/,/g) || []).length;
      if (commaCount === 1 && /^\d{1,3}$/.test(afterComma)) {
        s = s.replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (lastDot >= 0) {
      // Solo puntos: varios → miles (3.612.655); uno con 1–3 decimales → decimal.
      var dotCount = (s.match(/\./g) || []).length;
      if (dotCount > 1) {
        s = s.replace(/\./g, '');
      } else {
        var afterDot = s.slice(lastDot + 1);
        if (!/^\d{1,3}$/.test(afterDot)) {
          s = s.replace(/\./g, '');
        }
      }
    }

    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function formatInputUsd(value) {
    var n = roundDown2(value);
    if (!isFinite(n)) n = 0;
    return n.toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatInputCop(value, asInt) {
    var n = Number(value);
    if (!isFinite(n)) n = 0;
    if (asInt) {
      return Math.round(n).toLocaleString('es-CO');
    }
    return n.toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function priceInputHtml(idx, field, displayValue) {
    return (
      '<input type="text" inputmode="decimal" class="cotizador-price-input" ' +
      'data-idx="' + idx + '" data-field="' + field + '" ' +
      'value="' + escapeHtml(displayValue) + '" aria-label="Editar precio">'
    );
  }

  function nameInputHtml(idx, value) {
    return (
      '<input type="text" class="cotizador-meta-input cotizador-name-input" ' +
      'data-idx="' + idx + '" data-field="name" ' +
      'value="' + escapeHtml(value || '') + '" aria-label="Descripción del producto">'
    );
  }

  function refInputHtml(idx, value) {
    var display = value === '—' ? '' : (value || '');
    return (
      '<input type="text" class="cotizador-meta-input cotizador-ref-input" ' +
      'data-idx="' + idx + '" data-field="referencia" ' +
      'value="' + escapeHtml(display) + '" aria-label="Referencia">'
    );
  }

  function skuInputHtml(idx, value) {
    return (
      '<input type="text" class="cotizador-meta-input cotizador-sku-input" ' +
      'data-idx="' + idx + '" data-field="sku" ' +
      'value="' + escapeHtml(value || '') + '" aria-label="Código / SKU">'
    );
  }

  function ciudadInputHtml(idx, value) {
    return (
      '<input type="text" class="cotizador-meta-input cotizador-ciudad-input cotizador-line-select" ' +
      'list="cotizadorCiudadesList" data-idx="' + idx + '" data-field="ciudad" ' +
      'value="' + escapeHtml(value || '') + '" placeholder="Ciudad" aria-label="Ciudad" autocomplete="off">'
    );
  }

  function getEmpresa() {
    if (isSatCotizador()) return VALTECH_EMPRESA;
    if (isZkteco()) return IZC_EMPRESA;
    var sel = document.getElementById('cotizadorEmpresa');
    return sel ? String(sel.value || '').trim() : VALTECH_EMPRESA;
  }

  function toFechaCierreInputValue(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    var m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    var d = new Date(raw);
    if (!isNaN(d.getTime())) {
      var yyyy = d.getFullYear();
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      return yyyy + '-' + mm + '-' + dd;
    }
    return '';
  }

  function getFechaCierreVenta() {
    if (isZkteco()) return '';
    var el = document.getElementById('cotizadorFechaCierreVenta');
    return el ? toFechaCierreInputValue(el.value) : '';
  }

  function setFechaCierreVenta(value) {
    var el = document.getElementById('cotizadorFechaCierreVenta');
    if (!el) return;
    var next = toFechaCierreInputValue(value);
    if (el.value !== next) el.value = next;
  }

  function syncLegalBrand() {
    var brand = document.getElementById('cotizadorLegalBrand');
    if (!brand) return;
    var empresa = getEmpresa() || (isZkteco() ? IZC_EMPRESA : VALTECH_EMPRESA);
    brand.textContent = empresa + ' - Documento generado electrónicamente';
  }

  function getFleteSelection() {
    return resolveFleteSelection(getDefaultFleteId());
  }

  function lpSelectHtml(idx, selectedLpId, sku, name) {
    var current = normalizeLpId(selectedLpId);
    var options = lpOptionsForSku(sku, name);
    var hasCurrent = options.some(function (opt) { return opt.id === current; });
    if (!hasCurrent) {
      options = LP_OPTIONS.slice();
    }
    var opts = options.map(function (opt) {
      return (
        '<option value="' + escapeHtml(opt.id) + '"' +
        (opt.id === current ? ' selected' : '') + '>' +
        escapeHtml(opt.label) +
        '</option>'
      );
    }).join('');
    return (
      '<select class="cotizador-line-select cotizador-lp-select" data-idx="' + idx + '" ' +
      'data-field="lp" aria-label="Lista de precios">' + opts + '</select>'
    );
  }

  function fleteSelectHtml(idx, selectedFleteId) {
    var current = resolveFleteSelection(selectedFleteId).id;
    var opts = FLETE_OPTIONS.map(function (opt) {
      return (
        '<option value="' + escapeHtml(opt.id) + '"' +
        (opt.id === current ? ' selected' : '') + '>' +
        escapeHtml(opt.label) +
        '</option>'
      );
    }).join('');
    return (
      '<select class="cotizador-line-select cotizador-flete-select" data-idx="' + idx + '" ' +
      'data-field="flete" aria-label="Flete">' + opts + '</select>'
    );
  }

  function normalizeEstelarSku(sku) {
    var s = String(sku == null ? '' : sku).trim();
    if (!s) return '';
    if (/^\d+\.0+$/.test(s)) s = s.split('.', 1)[0];
    return s.replace(/^0+(?=\d)/, '');
  }

  function isEstelarFlete(fleteSel) {
    if (!fleteSel || fleteSel.gratis) return false;
    if (String(fleteSel.id || '') === 'estelar') return true;
    return /estelar/i.test(String(fleteSel.label || ''));
  }

  function isSatExcelUnitPriceSku(sku) {
    var id = normalizeEstelarSku(sku);
    return !!(id && estelarSatPrecio[id]);
  }

  function isEstelarKgProduct(sku) {
    var id = normalizeEstelarSku(sku);
    return !!(id && estelarProductos[id]);
  }

  function lookupEstelarKilo(ciudad) {
    var key = foldCityName(ciudad);
    if (!key) return 0;
    var exact = Number(estelarCityIndex[key]);
    if (isFinite(exact) && exact > 0) return exact;
    var matches = [];
    Object.keys(estelarCityIndex).forEach(function (k) {
      if (k.indexOf(key) === 0 || key.indexOf(k) === 0) matches.push(k);
    });
    if (matches.length !== 1) return 0;
    var rate = Number(estelarCityIndex[matches[0]]);
    return isFinite(rate) && rate > 0 ? rate : 0;
  }

  function calcEstelarFibraLineFlete(item, copSinIvaUnit, qty) {
    var sku = normalizeEstelarSku(item && item.sku);
    var prod = estelarProductos[sku] || null;
    var kgUnit = prod && Number(prod.kg) > 0 ? Number(prod.kg) : 0;
    var kilo = lookupEstelarKilo(item && item.ciudad);
    var q = Number(qty) || 0;
    var copUnit = Number(copSinIvaUnit);
    if (!isFinite(copUnit) || !(copUnit > 0)) {
      copUnit = prod && Number(prod.cop_uni) > 0 ? Number(prod.cop_uni) : 0;
    }
    var rateValor = estelarFleteData && Number(estelarFleteData.valor_sobre_producto) > 0
      ? Number(estelarFleteData.valor_sobre_producto)
      : 0.005;
    if (!(kilo > 0) || !(kgUnit > 0) || !(q > 0)) {
      return { fleteAntesIva: 0, fletePeso: 0, fleteValor: 0, kg: kgUnit * q, valorKilo: kilo || 0 };
    }
    var fletePeso = kgUnit * q * kilo;
    var fleteValor = copUnit * q * rateValor;
    return {
      fleteAntesIva: fletePeso + fleteValor,
      fletePeso: fletePeso,
      fleteValor: fleteValor,
      kg: kgUnit * q,
      valorKilo: kilo
    };
  }

  function lookupFleteConIva(sku, lineTotalCopConIva, rate) {
    if (fletesMap && sku) {
      if (Object.prototype.hasOwnProperty.call(fletesMap, sku)) {
        var v = Number(fletesMap[sku]);
        if (isFinite(v) && v > 0) return v;
      }
      var noZeros = String(sku).replace(/^0+/, '');
      if (noZeros && Object.prototype.hasOwnProperty.call(fletesMap, noZeros)) {
        var v2 = Number(fletesMap[noZeros]);
        if (isFinite(v2) && v2 > 0) return v2;
      }
    }
    return Number(lineTotalCopConIva || 0) * Number(rate || 0);
  }

  function isNacional185Flete(fleteSel) {
    if (!fleteSel || fleteSel.gratis) return false;
    var rate = Number(fleteSel.rate) || 0;
    if (fleteSel.id === '0.0185' || !!fleteSel.tccOnlyUnder) return true;
    if (Math.abs(rate - FLETE_TCC_RATE) < 1e-9) return true;
    var lab = String(fleteSel.label || '');
    return /\bTCC\b/i.test(lab) || /1\s*[,.]\s*85\s*%/i.test(lab) || /env[ií]o\s*nacional/i.test(lab);
  }

  /**
   * Flete del pedido.
   * Envío nacional 1,85 %:
   *   - pedido < $1.500.000 (COP sin IVA) → $23.000 + IVA (TCC)
   *   - pedido ≥ $1.500.000 → 1,85 % del valor de mercancía sin IVA + IVA del flete
   * Otros %: tarifa sobre total con IVA / 1,19 como base + IVA (comportamiento Excel).
   * @returns {{ monto: number, aplicaIva: boolean }}
   */
  function calcOrderFlete(totalPedidoCopConIva, fleteSel, totalPedidoCopSinIva) {
    if (!fleteSel || fleteSel.gratis) return { monto: 0, aplicaIva: false };
    var totalConIva = Number(totalPedidoCopConIva) || 0;
    var totalSinIva = Number(totalPedidoCopSinIva);
    if (!isFinite(totalSinIva) || totalSinIva < 0) {
      // Fallback: descontar IVA del total pagable si no llega la base sin IVA.
      totalSinIva = totalConIva > 0 ? totalConIva / (1 + IVA) : 0;
    }
    var rate = Number(fleteSel.rate) || 0;
    if (isNacional185Flete(fleteSel)) {
      if (!(totalSinIva > 0)) return { monto: 0, aplicaIva: false };
      if (totalSinIva < FLETE_PEDIDO_UMBRAL) {
        return { monto: FLETE_MIN_ANTES_IVA, aplicaIva: true };
      }
      return { monto: totalSinIva * FLETE_TCC_RATE, aplicaIva: true };
    }
    if (!(totalConIva > 0)) return { monto: 0, aplicaIva: false };
    if (!(rate > 0)) return { monto: 0, aplicaIva: false };
    return { monto: (totalConIva * rate) / (1 + IVA), aplicaIva: true };
  }

  function calcOrderFleteAntesIva(totalPedidoCopConIva, fleteSel, totalPedidoCopSinIva) {
    return calcOrderFlete(totalPedidoCopConIva, fleteSel, totalPedidoCopSinIva).monto;
  }

  function fleteLabelForTotals(fleteSel, totalPedidoCopSinIva) {
    if (!fleteSel) return '';
    if (fleteSel.gratis) return 'Gratis';
    var total = Number(totalPedidoCopSinIva) || 0;
    if (isNacional185Flete(fleteSel)) {
      if (total >= FLETE_PEDIDO_UMBRAL) return '1,85 %';
      return 'TCC';
    }
    return fleteSel.label || '';
  }

  function fleteFactorConIva(aplicaIva) {
    return aplicaIva ? (1 + IVA) : 1;
  }

  function loadFletes() {
    return loadJson(FLETES_PATH).then(function (data) {
      fletesMap = data && typeof data === 'object' ? data : {};
      return fletesMap;
    }).catch(function () {
      fletesMap = {};
      return fletesMap;
    });
  }

  function applyEstelarFleteData(data) {
    estelarFleteData = data && typeof data === 'object' ? data : null;
    estelarCityIndex = {};
    estelarProductos = {};
    estelarExcept = {};
    estelarSatPrecio = {};
    if (!estelarFleteData) {
      fillCiudadesDatalist();
      return;
    }
    var exceptList = Array.isArray(estelarFleteData.except_skus) ? estelarFleteData.except_skus : [];
    exceptList.forEach(function (sku) {
      var id = normalizeEstelarSku(sku);
      if (id) estelarExcept[id] = true;
    });
    var satList = Array.isArray(estelarFleteData.sat_precio_skus) && estelarFleteData.sat_precio_skus.length
      ? estelarFleteData.sat_precio_skus
      : exceptList;
    satList.forEach(function (sku) {
      var id = normalizeEstelarSku(sku);
      if (id) estelarSatPrecio[id] = true;
    });
    var productos = estelarFleteData.productos && typeof estelarFleteData.productos === 'object'
      ? estelarFleteData.productos
      : {};
    Object.keys(productos).forEach(function (sku) {
      var id = normalizeEstelarSku(sku);
      if (id) estelarProductos[id] = productos[sku];
    });
    var ciudades = Array.isArray(estelarFleteData.ciudades) ? estelarFleteData.ciudades : [];
    ciudades.forEach(function (c) {
      var key = foldCityName(c && c.name);
      var rate = Number(c && c.valor_kilo);
      if (!key || !(rate > 0)) return;
      estelarCityIndex[key] = rate;
    });
    fillCiudadesDatalist();
  }

  var estelarLoadPromise = null;

  function loadEstelarFlete() {
    if (estelarLoadPromise) return estelarLoadPromise;
    estelarLoadPromise = loadJson(ESTELAR_FLETE_PATH, true).then(function (data) {
      applyEstelarFleteData(data);
      if (items.length) render();
      return estelarFleteData;
    }).catch(function () {
      estelarLoadPromise = null;
      applyEstelarFleteData(null);
      return null;
    });
    return estelarLoadPromise;
  }

  function emptyInventario() {
    return {
      izc: { AR: 0, CT: 0, UN: 0, RC: 0 },
      valtech: { AR: 0, CT: 0, UN: 0, RC: 0 },
      total: 0
    };
  }

  function lookupInventario(sku) {
    var empty = emptyInventario();
    if (!inventarioMap || typeof inventarioMap !== 'object') return empty;
    var raw = String(sku == null ? '' : sku).trim();
    var key = normalizeSku(raw);
    if (!key && !raw) return empty;
    var candidates = [key, raw, raw.replace(/^0+/, ''), key.replace(/^0+/, '')];
    var row = null;
    for (var i = 0; i < candidates.length; i++) {
      var k = candidates[i];
      if (!k) continue;
      if (inventarioMap[k]) {
        row = inventarioMap[k];
        break;
      }
    }
    if (!row || typeof row !== 'object') return empty;
    var izc = row.izc || {};
    var val = row.valtech || {};
    var out = emptyInventario();
    var total = 0;
    INV_BODEGAS.forEach(function (b) {
      var a = Math.max(0, Number(izc[b]) || 0);
      var v = Math.max(0, Number(val[b]) || 0);
      out.izc[b] = a;
      out.valtech[b] = v;
      total += a + v;
    });
    if (row.total != null && isFinite(Number(row.total))) {
      out.total = Math.max(0, Number(row.total) || 0);
    } else {
      out.total = total;
    }
    return out;
  }

  function paintInventario(sku) {
    var row = document.getElementById('cotizadorInventarioRow');
    if (!row) return;
    var data = lookupInventario(sku);
    row.querySelectorAll('[data-inv]').forEach(function (cell) {
      var key = cell.getAttribute('data-inv') || '';
      var n = 0;
      if (key === 'total') n = data.total;
      else if (key.indexOf('izc.') === 0) n = data.izc[key.slice(4)] || 0;
      else if (key.indexOf('valtech.') === 0) n = data.valtech[key.slice(8)] || 0;
      cell.textContent = String(n);
      cell.classList.toggle('has-stock', n > 0);
    });
  }

  function inventarioCellsHtml(sku) {
    var data = lookupInventario(sku);
    var html = '';
    if (!isSatCotizador()) {
      INV_BODEGAS.forEach(function (b) {
        var nIzc = data.izc[b] || 0;
        html +=
          '<td class="cotizador-inv-cell' + (nIzc > 0 ? ' has-stock' : '') + '" title="IZC ' + b + '">' +
            nIzc +
          '</td>';
      });
    }
    var vtTotal = 0;
    INV_BODEGAS.forEach(function (b) {
      var n = data.valtech[b] || 0;
      vtTotal += n;
      html +=
        '<td class="cotizador-inv-cell' + (n > 0 ? ' has-stock' : '') + '" title="VALTECH ' + b + '">' +
          n +
        '</td>';
    });
    var total = isSatCotizador() ? vtTotal : data.total;
    html +=
      '<td class="cotizador-inv-cell cotizador-inv-total-cell' + (total > 0 ? ' has-stock' : '') + '" title="Total">' +
        total +
      '</td>';
    return html;
  }

  function loadInventario() {
    return loadJson(INVENTARIO_PATH).then(function (data) {
      if (data && data.by_sku && typeof data.by_sku === 'object') {
        inventarioMap = data.by_sku;
      } else if (data && typeof data === 'object' && !Array.isArray(data)) {
        // Compat: archivo plano { "5621": {...} } sin by_sku
        inventarioMap = data.bodegas || data.wh_codes || data.stamp
          ? {}
          : data;
      } else {
        inventarioMap = {};
      }
      return inventarioMap;
    }).catch(function () {
      inventarioMap = {};
      return inventarioMap;
    });
  }

  function computeTotals(rows) {
    var qty = 0;
    var totalUsd = 0;
    var totalCop = 0;
    var totalUsdIva = 0;
    var totalCopIva = 0;
    var totalSinFlete = 0;
    var sumFleteAntesIva = 0;
    var sumTotalConFlete = 0;
    var sumFleteConIva = 0;
    var hasUsd = false;
    var hasCop = false;
    var anyPaidFlete = false;
    var trm = getTrm();
    var fleteLabels = {};

    rows.forEach(function (row) {
      if (!row.ok) return;
      qty += row.qty;
      totalUsd += row.totalUsd;
      totalCop += row.totalCop;
      totalUsdIva += row.totalUsdIva;
      totalCopIva += row.totalCopIva;
      totalSinFlete += Number(row.totalSinFlete != null ? row.totalSinFlete : row.totalCopExcel) || 0;
      sumFleteAntesIva += Number(row.fleteAntesIva) || 0;
      sumTotalConFlete += Number(row.totalConFlete) || 0;
      var lineFlete = row.flete || getFleteSelection();
      if (lineFlete && lineFlete.label) fleteLabels[lineFlete.label] = true;
      if (lineFlete && !lineFlete.gratis) {
        anyPaidFlete = true;
        if (row.estelarFibra) {
          sumFleteConIva += (Number(row.fleteAntesIva) || 0) * (1 + IVA);
        } else {
          sumFleteConIva += lookupFleteConIva(row.sku, row.totalCopExcel, lineFlete.rate);
        }
      }
      if (row.currency === 'COP') hasCop = true;
      else hasUsd = true;
    });

    // Minitarjetas: flete a nivel de PEDIDO (regla TCC / transportadora).
    // Si el asesor edita el flete global, se respeta.
    var mixedLabels = Object.keys(fleteLabels);
    var fleteSummary;
    if (mixedLabels.length === 1) {
      var firstOk = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].ok) { firstOk = rows[i]; break; }
      }
      fleteSummary = firstOk && firstOk.flete ? firstOk.flete : getFleteSelection();
    } else {
      fleteSummary = {
        id: 'mixed',
        label: mixedLabels.length ? mixedLabels.join(' / ') : getFleteSelection().label,
        rate: 0,
        gratis: !anyPaidFlete
      };
    }

    var fleteAntesIva = 0;
    var fleteIva = 0;
    var fleteAplicaIva = true;
    var totalConFlete = 0;
    var anyLineFleteOverride = items.some(function (it) {
      return it && it.fleteAntesOverride != null && isFinite(Number(it.fleteAntesOverride));
    });
    var anyEstelarFibra = rows.some(function (row) { return row && row.ok && row.estelarFibra; });
    if (anyLineFleteOverride) {
      fleteAntesIva = 0;
      for (var li = 0; li < items.length; li++) {
        var itL = items[li];
        var rowL = rows[li];
        if (!rowL || !rowL.ok) continue;
        if (itL && itL.fleteAntesOverride != null && isFinite(Number(itL.fleteAntesOverride))) {
          fleteAntesIva += Number(itL.fleteAntesOverride);
        } else {
          fleteAntesIva += Number(rowL.fleteAntesIva) || 0;
        }
      }
      fleteAplicaIva = true;
      fleteIva = fleteAntesIva * IVA;
      totalConFlete = totalSinFlete + fleteAntesIva + fleteIva;
    } else if (fleteOverride != null && isFinite(fleteOverride) && fleteOverride >= 0) {
      fleteAntesIva = Number(fleteOverride);
      // Override manual: el monto es antes de IVA; siempre se suma IVA del flete.
      fleteAplicaIva = true;
      fleteIva = fleteAntesIva * IVA;
      totalConFlete = totalSinFlete + fleteAntesIva + fleteIva;
    } else if (anyEstelarFibra) {
      // Fibra Estelar: flete por línea (kg × COP/kg + 0,5 % del COP UNI). No redistribuir 1,76 %.
      fleteAntesIva = sumFleteAntesIva;
      fleteAplicaIva = true;
      fleteIva = fleteAntesIva * IVA;
      totalConFlete = sumTotalConFlete;
    } else if (fleteSummary && fleteSummary.id !== 'mixed' && !fleteSummary.gratis) {
      var fleteCalc = calcOrderFlete(totalSinFlete, fleteSummary, totalCop);
      fleteAntesIva = fleteCalc.monto;
      fleteAplicaIva = !!fleteCalc.aplicaIva;
      fleteIva = fleteAplicaIva ? fleteAntesIva * IVA : 0;
      totalConFlete = totalSinFlete + fleteAntesIva + fleteIva;
    } else if (fleteSummary && fleteSummary.gratis) {
      fleteAntesIva = 0;
      fleteIva = 0;
      fleteAplicaIva = false;
      totalConFlete = totalSinFlete;
    } else {
      fleteAntesIva = sumFleteAntesIva;
      fleteAplicaIva = true;
      fleteIva = fleteAntesIva * IVA;
      totalConFlete = sumTotalConFlete;
    }

    // Etiqueta: TCC solo si pedido (sin IVA) < $1.500.000; si es mayor, "1,85 %".
    if (fleteSummary && fleteSummary.id !== 'mixed') {
      fleteSummary = Object.assign({}, fleteSummary, {
        label: fleteLabelForTotals(fleteSummary, totalCop)
      });
    }

    return {
      qty: qty,
      usd: totalUsd,
      cop: totalCop,
      usdIva: totalUsdIva,
      copIva: totalCopIva,
      hasUsd: hasUsd,
      hasCop: hasCop,
      flete: fleteSummary,
      totalSinFlete: totalSinFlete,
      fleteAntesIva: fleteAntesIva,
      fleteIva: fleteIva,
      fleteAplicaIva: fleteAplicaIva,
      totalConFlete: totalConFlete,
      // Tarjeta USD = suma de la columna P.V. USD
      usdEquiv: totalUsd,
      sumFleteConIva: sumFleteConIva,
      trm: trm
    };
  }

  function applyOrderFleteToRows(rows, totals) {
    if (!rows || !rows.length || !totals) return rows;

    // Si alguna línea tiene flete manual, respetar overrides por fila.
    var anyLineFlete = items.some(function (it) {
      return it && it.fleteAntesOverride != null && isFinite(Number(it.fleteAntesOverride));
    });
    if (anyLineFlete) {
      for (var r = 0; r < rows.length; r++) {
        if (!rows[r].ok) continue;
        var ov = items[r] && items[r].fleteAntesOverride != null
          ? Number(items[r].fleteAntesOverride)
          : NaN;
        if (isFinite(ov) && ov >= 0) {
          var factorManual = totals.fleteAplicaIva === false ? 1 : (1 + IVA);
          rows[r].fleteAntesIva = ov;
          rows[r].totalConFlete = (Number(rows[r].totalSinFlete) || 0) + ov * factorManual;
        }
      }
      return rows;
    }

    if (fleteOverride != null && isFinite(fleteOverride) && fleteOverride >= 0) {
      // Con override manual global, repartir proporcional al total sin flete.
      var orderFleteG = Number(fleteOverride) || 0;
      var orderTotalG = Number(totals.totalSinFlete) || 0;
      var factorG = totals.fleteAplicaIva === false ? 1 : (1 + IVA);
      var assignedG = 0;
      var lastOkG = -1;
      for (var g = 0; g < rows.length; g++) {
        if (!rows[g].ok) continue;
        lastOkG = g;
        var shareG = 0;
        if (orderTotalG > 0 && orderFleteG > 0) {
          shareG = orderFleteG * ((Number(rows[g].totalSinFlete) || 0) / orderTotalG);
        }
        rows[g].fleteAntesIva = shareG;
        rows[g].totalConFlete = (Number(rows[g].totalSinFlete) || 0) + shareG * factorG;
        assignedG += shareG;
      }
      if (lastOkG >= 0 && orderFleteG > 0) {
        var diffG = orderFleteG - assignedG;
        rows[lastOkG].fleteAntesIva = (Number(rows[lastOkG].fleteAntesIva) || 0) + diffG;
        rows[lastOkG].totalConFlete =
          (Number(rows[lastOkG].totalSinFlete) || 0) + rows[lastOkG].fleteAntesIva * factorG;
      }
      return rows;
    }
    var anyEstelarFibraRows = rows.some(function (row) { return row && row.ok && row.estelarFibra; });
    if (anyEstelarFibraRows) return rows;
    if (!totals.flete || totals.flete.gratis || totals.flete.id === 'mixed') return rows;
    var orderFlete = Number(totals.fleteAntesIva) || 0;
    var orderTotal = Number(totals.totalSinFlete) || 0;
    var factor = totals.fleteAplicaIva === false ? 1 : (1 + IVA);
    var assigned = 0;
    var lastOk = -1;
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].ok) continue;
      lastOk = i;
      var share = 0;
      if (orderTotal > 0 && orderFlete > 0) {
        share = orderFlete * ((Number(rows[i].totalSinFlete) || 0) / orderTotal);
      }
      rows[i].fleteAntesIva = share;
      rows[i].totalConFlete = (Number(rows[i].totalSinFlete) || 0) + share * factor;
      assigned += share;
    }
    // Ajuste de redondeo en la última línea OK.
    if (lastOk >= 0 && orderFlete > 0) {
      var diff = orderFlete - assigned;
      rows[lastOk].fleteAntesIva = (Number(rows[lastOk].fleteAntesIva) || 0) + diff;
      rows[lastOk].totalConFlete =
        (Number(rows[lastOk].totalSinFlete) || 0) + rows[lastOk].fleteAntesIva * factor;
    }
    return rows;
  }

  function quoteNeedsCiudadColumn() {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      if (isSatExcelUnitPriceSku(it.sku)) return true;
      if (isEstelarFlete(getItemFlete(it))) return true;
    }
    return false;
  }

  function syncCiudadesColumn() {
    var show = quoteNeedsCiudadColumn();
    var table = document.querySelector('.cotizador-table-asesor');
    if (table) table.classList.toggle('is-ciudades-on', show);
    var spacer = document.querySelector('.cotizador-totals-spacer');
    if (spacer) {
      var cols = isSatCotizador() ? satColCounts(show) : { spacer: show ? 19 : 18 };
      spacer.setAttribute('colspan', String(cols.spacer));
    }
    return show;
  }

  function render() {
    var body = document.getElementById('cotizadorBody');
    if (!body) return;
    var showCiudades = syncCiudadesColumn();
    var trm = getTrm();
    var rows = items.map(function (item) { return lineCalc(item, trm); });
    var totals = computeTotals(rows);
    rows = applyOrderFleteToRows(rows, totals);

    if (!rows.length) {
      var emptyCols = isSatCotizador()
        ? satColCounts(showCiudades).empty
        : (showCiudades ? 27 : 26);
      body.innerHTML = '<tr class="cotizador-empty-row"><td colspan="' + emptyCols + '">Aún no hay productos en la cotización.</td></tr>';
    } else {
      body.innerHTML = rows.map(function (row, idx) {
        var num = idx + 1;
        var nameCell = nameInputHtml(idx, row.name === '—' ? '' : row.name);
        var refCell = refInputHtml(idx, row.referencia);
        var qty = Math.max(1, Number(row.qty) || 1);
        // Prc. Unitario = 1 und. P.V.* = unitario × cantidad.
        var unitUsd = row.ok ? Number(row.usd) || 0 : 0;
        var unitCop = row.ok ? Number(row.copSinIva != null ? row.copSinIva : row.cop) || 0 : 0;
        var unitCopIva = row.ok ? Number(row.copIva != null ? row.copIva : row.copConIva) || 0 : 0;
        var unitUsdIva = row.ok ? Number(row.usdIva) || 0 : 0;
        var lineUsd = unitUsd * qty;
        var lineCop = unitCop * qty;
        var lineCopIva = unitCopIva * qty;
        var lineUsdIva = unitUsdIva * qty;
        var unitUsdDisplay = row.ok ? formatInputUsd(unitUsd) : '';
        var unitCopDisplay = row.ok ? formatInputCop(unitCop, false) : '';
        var priceUsd = formatInputUsd(row.ok ? lineUsd : 0);
        var priceCopSin = formatInputCop(row.ok ? lineCop : 0, false);
        var priceCopCon = formatInputCop(row.ok ? lineCopIva : 0, true);
        var priceUsdIva = formatInputUsd(row.ok ? lineUsdIva : 0);
        var totalSinDisplay = formatInputCop(row.ok ? row.totalSinFlete : 0, true);
        var fleteAntesDisplay = formatInputCop(row.ok ? row.fleteAntesIva : 0, false);
        var totalConDisplay = formatInputCop(row.ok ? row.totalConFlete : 0, false);
        var fleteId = row.flete ? row.flete.id : getFleteSelection().id;
        return (
          '<tr' + (row.manual ? ' class="is-manual-item"' : '') + '>' +
            '<td class="cotizador-num-cell">' + num + '</td>' +
            inventarioCellsHtml(row.sku) +
            '<td class="cotizador-line-select-cell">' + lpSelectHtml(idx, row.lp, row.sku, row.name) + '</td>' +
            '<td class="cotizador-line-select-cell">' + fleteSelectHtml(idx, fleteId) + '</td>' +
            '<td class="cotizador-line-select-cell cotizador-ciudad-cell">' + ciudadInputHtml(idx, row.ciudad) + '</td>' +
            '<td class="cotizador-sku-cell">' +
              skuInputHtml(idx, row.sku) +
              (row.manual ? ' <span class="cotizador-manual-tag" title="Producto manual">M</span>' : '') +
            '</td>' +
            '<td class="cotizador-name-cell">' + nameCell + '</td>' +
            '<td class="cotizador-ref-cell">' + refCell + '</td>' +
            '<td class="cotizador-qty-cell">' + qtyInputHtml(idx, qty) + '</td>' +
            '<td class="cotizador-price-cell cotizador-unit-price-cell">' +
              priceInputHtml(idx, 'unitarioUsd', unitUsdDisplay) +
            '</td>' +
            '<td class="cotizador-price-cell cotizador-unit-price-cell">' +
              priceInputHtml(idx, 'unitarioCop', unitCopDisplay) +
            '</td>' +
            '<td class="cotizador-price-cell">' + priceInputHtml(idx, 'usd', priceUsd) + '</td>' +
            '<td class="cotizador-price-cell">' + priceInputHtml(idx, 'copSinIva', priceCopSin) + '</td>' +
            '<td class="cotizador-price-cell">' + priceInputHtml(idx, 'copConIva', priceCopCon) + '</td>' +
            '<td class="cotizador-price-cell">' + priceInputHtml(idx, 'usdIva', priceUsdIva) + '</td>' +
            '<td class="cotizador-price-cell">' + priceInputHtml(idx, 'totalSinFlete', totalSinDisplay) + '</td>' +
            '<td class="cotizador-price-cell">' + priceInputHtml(idx, 'fleteAntesIva', fleteAntesDisplay) + '</td>' +
            '<td class="cotizador-price-cell">' + priceInputHtml(idx, 'totalConFlete', totalConDisplay) + '</td>' +
            '<td><button type="button" class="cotizador-remove" data-idx="' + idx + '">Quitar</button></td>' +
          '</tr>'
        );
      }).join('');
    }

    var elPvCop = document.getElementById('totalPvCop');
    var elPvCopIva = document.getElementById('totalPvCopIva');
    var elPvUsdIva = document.getElementById('totalPvUsdIva');
    var elSin = document.getElementById('totalSinFlete');
    var elFlete = document.getElementById('fleteAntesIva');
    var elCon = document.getElementById('totalConFlete');
    var elUsdEq = document.getElementById('totalUsdEquiv');
    if (elPvCop) elPvCop.textContent = formatCOP(totals.cop);
    if (elPvCopIva) elPvCopIva.textContent = formatCOP(totals.totalSinFlete);
    if (elPvUsdIva) elPvUsdIva.textContent = formatUSD(totals.usdIva);
    if (elSin) elSin.textContent = formatCOP(totals.totalSinFlete);
    var elFleteLabel = document.getElementById('fleteAntesIvaLabel');
    if (elFleteLabel) {
      elFleteLabel.innerHTML = totals.fleteAplicaIva === false
        ? 'Flete<br>1,85 %'
        : 'Flete<br>antes de IVA';
    }
    if (elFlete && document.activeElement !== elFlete) {
      elFlete.value = formatInputCop(totals.fleteAntesIva, false);
    }
    if (elCon) {
      if (elCon.tagName === 'INPUT') {
        if (document.activeElement !== elCon) {
          elCon.value = formatInputCop(totals.totalConFlete, false);
        }
      } else {
        elCon.textContent = formatCOPDec(totals.totalConFlete);
      }
    }
    if (elUsdEq) elUsdEq.textContent = formatUSD(totals.usdEquiv);

    var anyPriced = rows.some(function (r) { return r.ok; });
    var finishBtn = document.getElementById('cotizadorFinish');
    if (finishBtn) finishBtn.disabled = !anyPriced || finishing;
  }

  function addItem(sku, qty) {
    var resolved = resolveSkuFromInput(sku);
    if (!resolved) {
      var ambiguous = searchProducts(String(sku || ''), 8);
      if (ambiguous.length > 1) {
        setMessage('Hay varias coincidencias. Elige un producto de la lista.', 'error');
        renderSkuSuggestions(ambiguous);
        return;
      }
      setMessage('Ingresa un código o busca por nombre/referencia.', 'error');
      return;
    }
    sku = normalizeSku(resolved);
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    if (!sku) {
      setMessage('Ingresa un código de producto.', 'error');
      return;
    }
    if (isSatCotizador()) {
      var nameChk = lookupName(sku) || '';
      var refChk = lookupReferencia(sku) || '';
      if (!isSatCatalogItem(nameChk, sku, refChk)) {
        setMessage('Este producto no hace parte de la marca SAT', 'error');
        return;
      }
    }

    var lp = getSelectedLp();
    var fleteId = getFleteSelection().id;
    var listedPriceLp = lookupPriceStrict(sku, lp);
    var created = lookupCreatedProduct(sku);
    var listedName = lookupName(sku);
    var listedRef = lookupReferencia(sku);
    var manual = !listedPriceLp || !!created;

    var list = items.slice();
    var lastCiudad = '';
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i] && String(list[i].ciudad || '').trim()) {
        lastCiudad = String(list[i].ciudad).trim();
        break;
      }
    }
    var row = { sku: sku, qty: qty, lp: lp, flete: fleteId };
    if (lastCiudad) row.ciudad = lastCiudad;
    if (manual) {
      row.custom = true;
      row.manual = true;
      row.created_by = (created && created.seller_codigo) || getAsesorCodigo();
      row.created_at = new Date().toISOString();
      row.name = (created && created.name) || listedName || ('Producto ' + sku);
      row.referencia = (created && created.referencia) || listedRef || '';
      if (created) {
        var createdUsd = Number(created.unitario_usd || created.unitarioUsd || created.usd || 0);
        var createdCop = Number(created.unitario_cop || created.unitarioCop || created.cop || 0);
        if (isFinite(createdUsd) && createdUsd > 0) {
          row.usdOverride = createdUsd;
          row.priceEditSource = 'usd';
          row.priceModified = true;
        } else if (isFinite(createdCop) && createdCop > 0) {
          row.copOverride = createdCop;
          row.priceEditSource = 'cop';
          row.priceModified = true;
        }
      }
    }
    list.push(row);
    writeItems(list);
    hideSkuSuggestions();
    pendingSelectedSku = '';

    if (manual) {
      setMessage(
        'Producto manual agregado (' + sku + '). Edita descripción y precio en la tabla.',
        'ok'
      );
    } else {
      setMessage(
        listedName ? 'Producto agregado: ' + listedName : 'Producto ' + sku + ' agregado.',
        'ok'
      );
    }
    render();
  }

  function updateItemLp(idx, lpId) {
    var list = items.slice();
    if (idx < 0 || idx >= list.length) return;
    var lp = normalizeLpId(lpId);
    var prev = list[idx] || {};
    var keepManual = !!(prev.priceModified || prev.usdOverride != null || prev.copOverride != null || prev.copIvaOverride != null);
    var copy = Object.assign({}, prev, { lp: lp });
    if (!keepManual) {
      copy = clearPriceOverrides(copy);
    }
    var listed = lookupPrice(copy.sku, lp);
    list[idx] = copy;
    writeItems(list);
    if (keepManual) {
      setMessage('LP ' + lpLabel(lp) + ' aplicada. Se conservó el precio que editaste.', 'ok');
    } else if (listed) {
      setMessage('LP ' + lpLabel(lp) + ' aplicada. Precio de lista actualizado.', 'ok');
    } else {
      setMessage(
        'LP ' + lpLabel(lp) + ' sin precio para este producto. Edita el precio manualmente o elige otra LP.',
        'error'
      );
    }
    render();
  }

  function updateItemFlete(idx, fleteId) {
    var list = items.slice();
    if (idx < 0 || idx >= list.length) return;
    var flete = resolveFleteSelection(fleteId);
    list[idx] = Object.assign({}, list[idx], { flete: flete.id });
    writeFleteOverride(null);
    writeItems(list);
    if (isEstelarFlete(flete) && isEstelarKgProduct(list[idx].sku) && !String(list[idx].ciudad || '').trim()) {
      setMessage('Estelar en fibra óptica: elige la ciudad de destino para calcular el flete por kilo.', 'ok');
    } else {
      setMessage('Flete actualizado en la línea: ' + flete.label, 'ok');
    }
    render();
  }

  function removeItem(idx) {
    var list = items.slice();
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    writeItems(list);
    setMessage('Producto quitado.', 'ok');
    render();
  }

  function updateItemMeta(idx, field, rawValue) {
    var list = items.slice();
    if (idx < 0 || idx >= list.length) return;
    var value = String(rawValue || '').trim();
    var markManual = {
      custom: true,
      manual: true,
      created_by: (list[idx] && list[idx].created_by) || getAsesorCodigo(),
      created_at: (list[idx] && list[idx].created_at) || new Date().toISOString()
    };
    if (field === 'name') {
      if (!value) {
        setMessage('La descripción no puede quedar vacía.', 'error');
        render();
        return;
      }
      list[idx] = Object.assign({}, list[idx], markManual, { name: value });
    } else if (field === 'referencia') {
      list[idx] = Object.assign({}, list[idx], markManual, { referencia: value });
    } else if (field === 'sku') {
      var sku = normalizeSku(value);
      if (!sku) {
        setMessage('Código inválido.', 'error');
        render();
        return;
      }
      var next = Object.assign({}, list[idx], markManual, { sku: sku });
      // Si hay precio de lista para el nuevo SKU y no hay override, dejar que recargue LP.
      if (!next.priceModified) {
        next = clearPriceOverrides(next);
      }
      list[idx] = next;
    } else if (field === 'ciudad') {
      list[idx] = Object.assign({}, list[idx], { ciudad: value });
      writeItems(list);
      var itemFlete = getItemFlete(list[idx]);
      if (isEstelarFlete(itemFlete) && isEstelarKgProduct(list[idx].sku) && !value) {
        setMessage('Estelar en fibra óptica: elige la ciudad de destino para calcular el flete por kilo.', 'ok');
      } else {
        setMessage('Dato actualizado.', 'ok');
      }
      render();
      return;
    } else {
      return;
    }
    writeItems(list);
    setMessage('Dato actualizado.', 'ok');
    render();
  }

  function updateItemQty(idx, qty) {
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    var list = items.slice();
    if (idx < 0 || idx >= list.length) return;
    if (list[idx].qty === qty) return;
    list[idx].qty = qty;
    writeItems(list);
    render();
  }

  function updateItemPrice(idx, field, rawValue) {
    var list = items.slice();
    if (idx < 0 || idx >= list.length) return;
    var trm = getTrm();
    if (!isFinite(trm) || trm <= 0) trm = DEFAULT_TRM;
    var qty = Math.max(1, Math.floor(Number(list[idx].qty) || 1));
    var n = parseLocaleNumber(rawValue);
    if (!isFinite(n) || n < 0) {
      setMessage('Valor inválido.', 'error');
      render();
      return;
    }

    // Flete por línea / total con flete: no cambian el precio unitario.
    if (field === 'fleteAntesIva') {
      list[idx] = Object.assign({}, list[idx], {
        fleteAntesOverride: n,
        fleteEditManual: true
      });
      // Al editar flete de línea, el total global de flete debe seguir la suma de líneas.
      writeFleteOverride(null);
      writeItems(list);
      setMessage('Flete de línea actualizado.', 'ok');
      render();
      return;
    }
    if (field === 'totalConFlete') {
      var rowNow = lineCalc(list[idx], trm);
      var totalSin = Number(rowNow.totalSinFlete) || 0;
      var aplicaIva = true;
      var factor = aplicaIva ? (1 + IVA) : 1;
      var fleteAntes = Math.max(0, (n - totalSin) / factor);
      list[idx] = Object.assign({}, list[idx], {
        fleteAntesOverride: fleteAntes,
        fleteEditManual: true
      });
      writeFleteOverride(null);
      writeItems(list);
      setMessage('Total con flete actualizado.', 'ok');
      render();
      return;
    }

    if (n <= 0) {
      setMessage('Precio inválido.', 'error');
      render();
      return;
    }

    // P.V.* / totales de línea = × cantidad; Prc. Unitario = 1 und.
    var lineAmount = n;
    var unitAmount = (field === 'unitarioUsd' || field === 'unitarioCop')
      ? lineAmount
      : (lineAmount / qty);
    var next = clearPriceOverrides(list[idx]);
    // Conservar override de flete de línea si existía.
    if (list[idx].fleteAntesOverride != null) {
      next.fleteAntesOverride = list[idx].fleteAntesOverride;
      next.fleteEditManual = !!list[idx].fleteEditManual;
    }

    if (field === 'unitarioUsd' || field === 'usd') {
      var usd = roundDown2(unitAmount);
      if (!isFinite(usd) || usd <= 0) {
        setMessage('Precio inválido.', 'error');
        render();
        return;
      }
      next.usdOverride = usd;
      next.priceEditSource = 'usd';
      delete next.copOverride;
      delete next.copIvaOverride;
    } else if (field === 'usdIva') {
      var unitUsdIva = unitAmount;
      var usdSin = roundDown2(unitUsdIva / (1 + IVA));
      if (!isFinite(usdSin) || usdSin <= 0) {
        setMessage('Precio inválido.', 'error');
        render();
        return;
      }
      next.usdOverride = usdSin;
      next.priceEditSource = 'usd';
      delete next.copOverride;
      delete next.copIvaOverride;
    } else if (field === 'unitarioCop' || field === 'copSinIva') {
      var cop = unitAmount;
      var usdFromCop = roundDown2(cop / trm);
      if (!isFinite(usdFromCop) || usdFromCop <= 0 || !isFinite(cop) || cop <= 0) {
        setMessage('Precio inválido.', 'error');
        render();
        return;
      }
      next.copOverride = cop;
      next.priceEditSource = 'cop';
      delete next.usdOverride;
      delete next.copIvaOverride;
    } else if (field === 'copConIva' || field === 'totalSinFlete') {
      var unitCopIva = unitAmount;
      var usdFromIva = roundDown2((unitCopIva / (1 + IVA)) / trm);
      if (!isFinite(usdFromIva) || usdFromIva <= 0 || !isFinite(unitCopIva) || unitCopIva <= 0) {
        setMessage('Precio inválido.', 'error');
        render();
        return;
      }
      next.copIvaOverride = unitCopIva;
      next.priceEditSource = 'copIva';
      delete next.usdOverride;
      delete next.copOverride;
    } else {
      render();
      return;
    }

    list[idx] = next;
    list[idx].priceModified = true;
    writeItems(list);
    setMessage('Precio actualizado.', 'ok');
    render();
  }

  function qtyInputHtml(idx, qty) {
    return (
      '<input type="number" class="cotizador-qty-input" data-idx="' + idx + '" ' +
      'min="1" step="1" value="' + qty + '" aria-label="Cantidad">'
    );
  }

  function buildQuotePayload() {
    syncClientFromInputs();
    var trm = getTrm();
    var rows = [];
    var payloadItems = [];
    items.forEach(function (item) {
      var row = lineCalc(item, trm);
      if (!row.ok) return;
      rows.push(row);
      var entry = {
        sku: row.sku,
        name: row.name,
        referencia: row.referencia,
        qty: row.qty,
        lp: row.lp,
        flete: row.flete ? row.flete.label : '',
        flete_rate: row.flete ? row.flete.rate : 0,
        ciudad: row.ciudad || item.ciudad || '',
        currency: row.currency,
        custom: !!(item.custom || row.manual),
        usd: row.usd,
        cop: row.cop,
        copSinIva: row.copSinIva != null ? row.copSinIva : row.cop,
        unitarioCop: row.copSinIva != null ? row.copSinIva : row.cop,
        unitarioUsd: row.usd,
        usdIva: row.usdIva,
        copIva: row.copIva,
        totalUsd: row.totalUsd,
        totalCop: row.totalCop,
        totalUsdIva: row.totalUsdIva,
        totalCopIva: row.totalCopIva,
        totalSinFlete: row.totalSinFlete,
        fleteAntesIva: row.fleteAntesIva,
        totalConFlete: row.totalConFlete,
        ivaExempt: !!row.ivaExempt
      };
      if (item.custom || row.manual) {
        entry.custom = true;
        entry.manual = true;
        entry.created_by = item.created_by || getAsesorCodigo();
        entry.created_at = item.created_at || new Date().toISOString();
      }
      if (item.priceEditSource) entry.priceEditSource = item.priceEditSource;
      if (item.usdOverride != null && isFinite(Number(item.usdOverride)) && Number(item.usdOverride) > 0) {
        entry.usdOverride = Number(item.usdOverride);
      }
      if (item.copOverride != null && isFinite(Number(item.copOverride)) && Number(item.copOverride) > 0) {
        entry.copOverride = Number(item.copOverride);
      }
      if (item.copIvaOverride != null && isFinite(Number(item.copIvaOverride)) && Number(item.copIvaOverride) > 0) {
        entry.copIvaOverride = Number(item.copIvaOverride);
      }
      if (row.edited) entry.priceModified = true;
      // usdList/listPesos solo si NO hubo edición manual (si no, el PDF/panel pisa el precio del asesor).
      if (!(row.edited || item.priceModified)) {
        var listedForPesos = lookupPrice(row.sku, row.lp);
        if (listedForPesos) {
          var listPesos = listedForPesos.pesos != null ? Math.round(Number(listedForPesos.pesos)) : NaN;
          if ((!isFinite(listPesos) || listPesos <= 0) && String(listedForPesos.currency || '').toUpperCase() === 'COP') {
            listPesos = Math.round(Number(listedForPesos.amount));
          }
          var rowCop = Math.round(Number(row.copSinIva != null ? row.copSinIva : row.cop));
          if (isFinite(listPesos) && listPesos > 0 && isFinite(rowCop) && Math.abs(rowCop - listPesos) <= 1) {
            entry.listPesos = listPesos;
          }
          var listUsdAmt = listedForPesos.usdList != null ? Number(listedForPesos.usdList)
            : (String(listedForPesos.currency || '').toUpperCase() === 'USD' ? Number(listedForPesos.amount) : NaN);
          if (isFinite(listUsdAmt) && listUsdAmt > 0.10) {
            entry.usdList = listUsdAmt;
          }
        }
      } else {
        // Dejar constancia del USD realmente liquidado (el que el asesor puso).
        entry.usdList = row.usd;
      }
      payloadItems.push(entry);
    });
    if (!rows.length) return null;

    var totals = computeTotals(rows);
    var sellerCode = getAsesorCodigo();
    var payload = {
      action: isSatCotizador() ? 'save_quote' : 'finish_quote_asesor',
      asesor_codigo: sellerCode,
      nit_asesor: sellerCode,
      gp_codigo: isSatCotizador() && isGp() ? sellerCode : '',
      seller_codigo: isSatCotizador() ? sellerCode : '',
      quote_id: clientContext.quoteId,
      client_nit: isZkteco() ? '' : clientContext.nit,
      client_nombre: isZkteco() ? '' : clientContext.nombre,
      nit: isSatCotizador()
        ? (isGp() ? sellerCode : 'SAT')
        : (isZkteco() ? '' : clientContext.nit),
      nombre: isZkteco()
        ? ''
        : (isSatCotizador()
          ? (clientContext.nombre || (isGp() ? sellerCode : 'Admin SAT'))
          : clientContext.nombre),
      quote_source: quoteSourceForSave(),
      lp: getSelectedLp(),
      empresa: getEmpresa(),
      fecha_cierre: getFechaCierreVenta(),
      fecha_cierre_cliente: getFechaCierreVenta(),
      flete: totals.flete ? totals.flete.label : '',
      flete_rate: totals.flete ? totals.flete.rate : 0,
      trm: trm,
      items: payloadItems,
      totals: {
        qty: totals.qty,
        usd: totals.usd,
        cop: totals.cop,
        usdIva: totals.usdIva,
        copIva: totals.copIva,
        hasUsd: totals.hasUsd,
        hasCop: totals.hasCop,
        totalSinFlete: totals.totalSinFlete,
        fleteAntesIva: totals.fleteAntesIva,
        fleteIva: totals.fleteIva != null ? totals.fleteIva : 0,
        fleteAplicaIva: totals.fleteAplicaIva !== false,
        totalConFlete: totals.totalConFlete,
        usdEquiv: totals.usdEquiv,
        empresa: getEmpresa(),
        lp: getSelectedLp(),
        flete: totals.flete ? totals.flete.label : '',
        flete_rate: totals.flete ? totals.flete.rate : 0
      }
    };
    if (clientContext.duplicatedFrom || clientContext.recotizar) {
      if (clientContext.duplicatedFrom) {
        payload.duplicated_from = clientContext.duplicatedFrom;
        payload.recotizado_desde = clientContext.duplicatedFrom;
      }
      payload.is_duplicated = true;
      payload.recotizar = true;
    }
    if (isSatCotizador() && isGp()) {
      var vendedorCode = getSelectedVendedorCodigo();
      if (vendedorCode) {
        payload.assigned_vendedor = vendedorCode;
        payload.vendedor_codigo = vendedorCode;
      }
    }
    return payload;
  }

  function finishQuote() {
    if (finishing) return;
    try { syncClientFromInputs(); } catch (eSyncCli) { /* ignore */ }
    var payload = buildQuotePayload();
    if (!payload) {
      setMessage('Agrega al menos un producto con precio para terminar.', 'error');
      return;
    }
    if (!isStaff()) {
      setMessage(isSatCotizador()
        ? 'Debes iniciar sesión como Gerente de Producto o Admin SAT.'
        : 'Debes iniciar sesión como asesor.', 'error');
      return;
    }
    if (isSatCotizador()) {
      if (!payload.fecha_cierre_cliente || !/^\d{4}-\d{2}-\d{2}$/.test(payload.fecha_cierre_cliente)) {
        setMessage('Indica la fecha de cierre de venta.', 'error');
        var fechaEl = document.getElementById('cotizadorFechaCierreVenta');
        if (fechaEl) fechaEl.focus();
        return;
      }
      if (!payload.client_nit) {
        setMessage('Indica el NIT del cliente.', 'error');
        var nitEl = document.getElementById('cotizadorClientNitInput');
        if (nitEl) nitEl.focus();
        return;
      }
    } else if (!isZkteco()) {
      if (!payload.client_nit) {
        setMessage('Falta el NIT del cliente. Vuelve al panel y pulsa Cotizar.', 'error');
        return;
      }
      if (String(payload.client_nit).replace(/[\s.]/g, '').toUpperCase() === 'ZKTECO') {
        setMessage('Elige un cliente real. ZKTeco no es un cliente.', 'error');
        return;
      }
    }
    if (!isSatCotizador() && !payload.asesor_codigo && isAdmin() && typeof resolveSellerCodigoForNit === 'function') {
      resolveSellerCodigoForNit(payload.client_nit).then(function (code) {
        if (!code) {
          setMessage('Ese cliente no tiene vendedor asignado. Asígnalo en el panel admin.', 'error');
          return;
        }
        clientContext.seller_codigo = code;
        finishQuote();
      });
      return;
    }
    if (!payload.asesor_codigo) {
      setMessage(isSatCotizador()
        ? 'Debes iniciar sesión como Gerente de Producto o Admin SAT.'
        : 'Debes iniciar sesión como asesor.', 'error');
      return;
    }

    function isOkDealId(dealId) {
      dealId = String(dealId || '').trim();
      if (!dealId) return false;
      if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.isLikelyBitrixDealId === 'function') {
        return IZCCotizacionPdf.isLikelyBitrixDealId(dealId);
      }
      return /^\d+$/.test(dealId) && dealId.length <= 12 && !/^20\d{6,}/.test(dealId);
    }

    function waitMs(ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, Math.max(0, ms || 0));
      });
    }

    var finishStartedAt = Date.now();
    var TARGET_PDF_MS = 2000;

    var pdfWin = null;
    try {
      if (!isZkteco()) pdfWin = window.open('about:blank', '_blank');
      if (pdfWin && pdfWin.document) {
        pdfWin.document.open();
        pdfWin.document.write(
          '<!doctype html><html><head><meta charset="utf-8"><title>Generando cotización…</title></head>' +
          '<body style="font-family:sans-serif;padding:24px;color:#333">' +
          '<p><strong>Generando PDF…</strong></p>' +
          '<p style="color:#666">Listo en unos 2 segundos.</p>' +
          '</body></html>'
        );
        pdfWin.document.close();
      }
    } catch (eOpen) {
      pdfWin = null;
    }

    var dealHint = '';
    if (isOkDealId(clientContext.bitrixDealId)) {
      dealHint = String(clientContext.bitrixDealId).trim();
      payload.bitrix_deal_id = dealHint;
    }

    var pdfQuoteBase = {
      id: payload.quote_id || '',
      nit: payload.client_nit,
      nombre: payload.nombre,
      trm: payload.trm,
      empresa: payload.empresa,
      flete: payload.flete || '',
      items: payload.items,
      totals: payload.totals,
      seller_name: (window.IZCAuth && IZCAuth.getSessionNombre) ? IZCAuth.getSessionNombre() : '',
      bitrix_deal_id: dealHint
    };
    var sellerName = pdfQuoteBase.seller_name;

    function openPdfWithDeal(dealId) {
      if (!window.IZCCotizacionPdf || typeof IZCCotizacionPdf.open !== 'function') {
        return Promise.resolve(false);
      }
      var num = isOkDealId(dealId) ? String(dealId).trim() : '';
      var q = Object.assign({}, pdfQuoteBase, {
        bitrix_deal_id: num || pdfQuoteBase.bitrix_deal_id || ''
      });
      var extras = {
        empresa: payload.empresa,
        vendedor: sellerName,
        targetWindow: pdfWin,
        autoPrint: false,
        // Al ir al panel se recarga la página: embeber PDF para que la pestaña no se rompa.
        surviveParentUnload: true
      };
      if (num) {
        extras.numero = num;
      } else {
        // Abrir PDF aunque Bitrix no haya respondido aún.
        extras.numeroPendiente = String(pdfQuoteBase.id || 'Pendiente');
      }
      var opened = IZCCotizacionPdf.open(q, extras);
      if (opened && typeof opened.then === 'function') return opened;
      return Promise.resolve(!!opened);
    }

    function closePdfPlaceholder() {
      try {
        if (pdfWin && !pdfWin.closed) pdfWin.close();
      } catch (eClose) { /* ignore */ }
    }

    finishing = true;
    render();
    setMessage('Generando PDF…', '');

    postApi(payload).then(function (data) {
      finishing = false;
      if (!data || !data.ok) {
        closePdfPlaceholder();
        var err = (data && data.error) || 'No se pudo terminar la cotización.';
        if (/acción no válida|accion no valida/i.test(err)) {
          err += isLocalHost()
            ? ' Reinicia el servidor con tools\\ABRIR.bat.'
            : ' Revisa que api/auth.php esté actualizado en el hosting.';
        }
        setMessage(err, 'error');
        render();
        return null;
      }

      var savedQuoteId = data.quote_id || payload.quote_id || '';
      pdfQuoteBase.id = savedQuoteId || pdfQuoteBase.id;
      var dealId = String(
        (data.bitrix && data.bitrix.deal_id) ||
        data.bitrix_deal_id ||
        dealHint ||
        ''
      ).trim();
      var afterTab = (clientContext.duplicatedFrom || clientContext.recotizar || data.is_duplicated)
        ? 'duplicadas'
        : 'quotes';

      // Completar productos en Bitrix en segundo plano (no bloquea el PDF).
      if (savedQuoteId) {
        try { fireSyncBitrixQuote(savedQuoteId); } catch (eSync) { /* ignore */ }
      }

      function goToPanel(msg, kind) {
        writeItems([]);
        writeFleteOverride(null);
        try {
          if (window.sessionStorage) {
            sessionStorage.removeItem('izc_asesor_cotizar');
            sessionStorage.removeItem(cotizarSessionKey());
            sessionStorage.setItem('izc_asesor_panel_quotes_dirty', '1');
          }
        } catch (e) { /* ignore */ }
        setMessage(msg || data.message || 'Cotizacion guardada', kind || 'ok');
        render();
        window.setTimeout(function () {
          if (isSatCotizador()) {
            window.location.href = isGp() ? 'panel-gp.html' : 'panel-sat.html';
            return;
          }
          window.location.href = isZkteco()
            ? 'panel-zkteco.html?tab=historial'
            : ('asesor.html?tab=' + afterTab);
        }, 400);
      }

      var elapsed = Date.now() - finishStartedAt;
      // Máximo ~2s de espera total: si ya pasó, abre ya; si no, completa hasta 2s.
      var pad = Math.max(0, Math.min(TARGET_PDF_MS, TARGET_PDF_MS - elapsed));

      return waitMs(isZkteco() ? 0 : pad).then(function () {
        if (isZkteco()) {
          closePdfPlaceholder();
          goToPanel('Cotización guardada.', 'ok');
          return;
        }
        if (isOkDealId(dealId)) {
          try { clientContext.bitrixDealId = String(dealId).trim(); } catch (eCtx) { /* ignore */ }
        }
        // Esperar a que el PDF termine (logo/jsPDF) ANTES de navegar al panel.
        return openPdfWithDeal(dealId).then(function (ok) {
          return waitMs(ok ? 400 : 0).then(function () {
            if (ok) {
              goToPanel(
                isOkDealId(dealId)
                  ? (data.message || 'Cotizacion guardada. PDF abierto en otra pestaña.')
                  : 'Cotización guardada. PDF abierto (N° Bitrix pendiente de sincronizar).',
                isOkDealId(dealId) ? 'ok' : 'warn'
              );
              return;
            }
            closePdfPlaceholder();
            if (isSatCotizador()) {
              goToPanel('Cotización guardada.', 'ok');
              return;
            }
            goToPanel(
              'Cotización guardada, pero no se pudo abrir el PDF. Ábrela en Historial y genera el PDF.',
              'error'
            );
          });
        }).catch(function () {
          closePdfPlaceholder();
          goToPanel(
            'Cotización guardada, pero no se pudo abrir el PDF. Ábrela en Historial y genera el PDF.',
            'error'
          );
        });
      });
    }).catch(function (err) {
      finishing = false;
      closePdfPlaceholder();
      var detail = (err && err.message) ? String(err.message) : '';
      setMessage(
        isLocalHost()
          ? ('No se pudo guardar. Abre tools\\ABRIR.bat. ' + detail).trim()
          : ('No se pudo guardar en el servidor. ' + detail).trim(),
        'error'
      );
      render();
    });
  }

  function applyGate() {
    var gate = document.getElementById('cotizadorGate');
    var panel = document.getElementById('cotizadorPanel');
    var ok = isStaff();
    if (gate) {
      if (!ok) {
        gate.innerHTML = isSatCotizador()
          ? 'Debes iniciar sesión como Gerente de Producto o Admin SAT. <a href="login.html">Iniciar sesión</a>'
          : 'Debes iniciar sesión como asesor, administrador o ZKTeco. <a href="login.html">Iniciar sesión</a>';
      }
      gate.hidden = ok;
    }
    if (panel) panel.hidden = !ok;
    if (ok) {
      applyZktecoCotizadorUi();
      applySatCotizadorUi();
    }
    return ok;
  }

  function updateFleteAntesIva(rawValue) {
    var n = parseLocaleNumber(rawValue);
    if (!isFinite(n) || n < 0) {
      setMessage('Flete inválido.', 'error');
      render();
      return;
    }
    // Flete global: limpia overrides por línea para que todo recalcule coherente.
    items = items.map(function (it) {
      if (!it) return it;
      var copy = Object.assign({}, it);
      delete copy.fleteAntesOverride;
      delete copy.fleteEditManual;
      return copy;
    });
    writeItems(items);
    writeFleteOverride(n);
    setMessage('Flete actualizado. Se recalcularon los totales.', 'ok');
    render();
  }

  function reloadUserData() {
    fleteOverride = readFleteOverride();
    var seed = readSessionSeed();

    function applyEmpresaFromSeed(empresa) {
      if (isSatCotizador()) {
        applySatCotizadorUi();
        return;
      }
      if (isZkteco()) {
        applyZktecoCotizadorUi();
        return;
      }
      var emp = String(empresa || '').trim();
      if (!emp) return;
      var empresaSel = document.getElementById('cotizadorEmpresa');
      if (empresaSel) {
        empresaSel.value = emp;
        if (typeof syncLegalBrand === 'function') syncLegalBrand();
      }
    }

    function applyFechaCierreFromSeed(fecha) {
      if (fecha) setFechaCierreVenta(fecha);
    }

    // Recotizar: no dejar que un borrador vacío del NIT pise los ítems de la cotización origen.
    if (clientContext.recotizar) {
      if (seed.items.length) {
        applyEmpresaFromSeed(seed.empresa);
        applyFechaCierreFromSeed(seed.fecha_cierre);
        if (seed.trm != null && isFinite(seed.trm) && seed.trm > 0 && typeof setTrmValue === 'function') {
          setTrmValue(seed.trm);
        }
        applySeedItems(seed.items, 'recotizar');
        render();
        return Promise.resolve();
      }
      items = [];
      render();
      if (!clientContext.duplicatedFrom && !clientContext.nit) return Promise.resolve();
      return fetchQuoteItemsFromApi().then(function (apiItems) {
        if (applySeedItems(apiItems, 'recotizar')) render();
      });
    }

    // Si el asesor ya editó esta cotización, respetar su borrador local.
    if (hasLocalDraft()) {
      var draftItems = readItems();
      // Borrador vacío: preferir seed de sesión si trae productos.
      if ((!draftItems || !draftItems.length) && seed.items.length) {
        applyEmpresaFromSeed(seed.empresa);
        applyFechaCierreFromSeed(seed.fecha_cierre);
        applySeedItems(seed.items);
        render();
        return Promise.resolve();
      }
      applyFechaCierreFromSeed(seed.fecha_cierre);
      items = draftItems;
      render();
      return Promise.resolve();
    }

    if (seed.items.length) {
      applyEmpresaFromSeed(seed.empresa);
      applyFechaCierreFromSeed(seed.fecha_cierre);
      applySeedItems(seed.items);
      render();
      return Promise.resolve();
    }

    applyFechaCierreFromSeed(seed.fecha_cierre);
    items = [];
    render();
    if (!clientContext.quoteId && !clientContext.nit) return Promise.resolve();

    return fetchQuoteItemsFromApi().then(function (apiItems) {
      // Tras resolver quote_id desde el NIT, puede existir borrador del asesor.
      if (hasLocalDraft()) {
        var again = readItems();
        if (again && again.length) {
          items = again;
          render();
          return;
        }
      }
      if (applySeedItems(apiItems, 'servidor')) render();
    });
  }

  function bind() {
    fillCiudadesDatalist();
    var form = document.getElementById('cotizadorAddForm');
    var skuInput = document.getElementById('cotizadorSku');
    var finishBtn = document.getElementById('cotizadorFinish');
    var body = document.getElementById('cotizadorBody');
    var empresaSel = document.getElementById('cotizadorEmpresa');
    // LP global eliminada: por defecto Interna; cada fila elige su LP en la tabla.
    selectedLp = DEFAULT_LP;
    if (empresaSel) {
      empresaSel.addEventListener('change', syncLegalBrand);
      syncLegalBrand();
    }

    var fechaCierreEl = document.getElementById('cotizadorFechaCierreVenta');
    if (fechaCierreEl) {
      fechaCierreEl.addEventListener('change', function () {
        var fecha = getFechaCierreVenta();
        var quoteId = String(clientContext.quoteId || '').trim();
        var codigo = getAsesorCodigo();
        // Si ya hay cotización, sincronizar al instante con el panel.
        if (quoteId && codigo) {
          postApi({
            action: 'set_quote_fecha_cierre',
            asesor_codigo: codigo,
            quote_id: quoteId,
            fecha_cierre: fecha
          }).then(function (data) {
            if (!data || !data.ok) {
              setMessage((data && data.error) || 'No se pudo guardar la fecha de cierre venta.', 'error');
              return;
            }
            try {
              if (window.sessionStorage) sessionStorage.setItem('izc_asesor_panel_quotes_dirty', '1');
            } catch (eDirty) { /* ignore */ }
            setMessage(data.message || 'Fecha cierre venta guardada.', 'ok');
          }).catch(function () {
            setMessage('No se pudo guardar la fecha de cierre venta.', 'error');
          });
        }
      });
    }

    if (skuInput) {
      skuInput.addEventListener('focus', function () {
        ensureInventarioLoaded();
      });
      skuInput.addEventListener('input', function () {
        window.clearTimeout(previewTimer);
        previewTimer = window.setTimeout(updateSkuPreview, 120);
      });
      skuInput.addEventListener('keydown', function (e) {
        var list = document.getElementById('cotizadorSkuSuggest');
        var open = list && !list.hidden;
        var buttons = open ? list.querySelectorAll('.cotizador-sku-suggest-item') : [];
        if (e.key === 'ArrowDown' && open && buttons.length) {
          e.preventDefault();
          suggestActiveIdx = Math.min(buttons.length - 1, suggestActiveIdx + 1);
          paintSuggestActive(list);
          return;
        }
        if (e.key === 'ArrowUp' && open && buttons.length) {
          e.preventDefault();
          suggestActiveIdx = Math.max(0, suggestActiveIdx - 1);
          paintSuggestActive(list);
          return;
        }
        if (e.key === 'Enter' && open && suggestActiveIdx >= 0 && buttons[suggestActiveIdx]) {
          e.preventDefault();
          selectSkuSuggestion(buttons[suggestActiveIdx].getAttribute('data-sku'), { add: true });
          return;
        }
        if (e.key === 'Escape') {
          hideSkuSuggestions();
        }
      });
      skuInput.addEventListener('blur', function () {
        window.setTimeout(hideSkuSuggestions, 180);
      });
    }

    var suggestList = document.getElementById('cotizadorSkuSuggest');
    if (suggestList) {
      suggestList.addEventListener('mousedown', function (e) {
        var btn = e.target.closest('.cotizador-sku-suggest-item');
        if (!btn) return;
        e.preventDefault();
        selectSkuSuggestion(btn.getAttribute('data-sku'), { add: true });
      });
    }

    var clientNitInput = document.getElementById('cotizadorClientNitInput');
    var clientNombreInput = document.getElementById('cotizadorClientNombreInput');
    function primeClientSearchData() {
      ensureClientSearchData();
      if (isStaff() && getAsesorCodigo()) loadAsesorClientes();
    }
    function onClientFieldsChange() {
      syncClientFromInputs();
    }
    if (clientNitInput) {
      clientNitInput.addEventListener('focus', primeClientSearchData);
      clientNitInput.addEventListener('input', function () {
        syncClientFromInputs();
        window.clearTimeout(clientLookupTimer);
        clientLookupTimer = window.setTimeout(function () {
          applyClienteLookupFromNitInput({ fromNit: true, announce: false });
          var digits = String(clientNitInput.value || '').replace(/\D+/g, '');
          if (digits.length >= 3) {
            searchClientesByNombre(digits, 8).then(function (matches) {
              if (document.activeElement !== clientNitInput) return;
              if (normalizeNit(clientNitInput.value) !== normalizeNit(digits)) return;
              renderClientNombreSuggestions(matches);
            });
          } else {
            hideClientNombreSuggestions();
          }
        }, 350);
      });
      clientNitInput.addEventListener('change', function () {
        onClientFieldsChange();
        applyClienteLookupFromNitInput({ fromNit: true, force: true });
      });
      clientNitInput.addEventListener('blur', function () {
        onClientFieldsChange();
        applyClienteLookupFromNitInput({ fromNit: true, force: true });
      });
    }
    if (clientNombreInput) {
      clientNombreInput.addEventListener('focus', primeClientSearchData);
      clientNombreInput.addEventListener('input', function () {
        if (applyingClientPick) return;
        syncClientFromInputs();
        window.clearTimeout(clientNombreSuggestTimer);
        clientNombreSuggestTimer = window.setTimeout(updateClientNombreSuggestions, 220);
      });
      clientNombreInput.addEventListener('keydown', function (e) {
        var list = document.getElementById('cotizadorClientNombreSuggest');
        var open = list && !list.hidden;
        var buttons = open ? list.querySelectorAll('.cotizador-client-suggest-item') : [];
        if (e.key === 'ArrowDown' && open && buttons.length) {
          e.preventDefault();
          clientNombreSuggestIdx = Math.min(buttons.length - 1, clientNombreSuggestIdx + 1);
          paintClientNombreSuggestActive(list);
          return;
        }
        if (e.key === 'ArrowUp' && open && buttons.length) {
          e.preventDefault();
          clientNombreSuggestIdx = Math.max(0, clientNombreSuggestIdx - 1);
          paintClientNombreSuggestActive(list);
          return;
        }
        if (e.key === 'Enter' && open && clientNombreSuggestIdx >= 0 && buttons[clientNombreSuggestIdx]) {
          e.preventDefault();
          var btn = buttons[clientNombreSuggestIdx];
          selectClienteSuggestion(btn.getAttribute('data-nit'), btn.getAttribute('data-nombre'));
          return;
        }
        if (e.key === 'Escape') {
          hideClientNombreSuggestions();
        }
      });
      clientNombreInput.addEventListener('change', function () {
        onClientFieldsChange();
        applyClienteLookupFromNombreInput({ force: true });
      });
      clientNombreInput.addEventListener('blur', function () {
        onClientFieldsChange();
        window.setTimeout(function () {
          applyClienteLookupFromNombreInput({ force: true, showSuggest: false });
          hideClientNombreSuggestions();
        }, 180);
      });
    }

    var clientNombreSuggest = document.getElementById('cotizadorClientNombreSuggest');
    if (clientNombreSuggest) {
      clientNombreSuggest.addEventListener('mousedown', function (e) {
        var btn = e.target.closest('.cotizador-client-suggest-item');
        if (!btn) return;
        e.preventDefault();
        selectClienteSuggestion(btn.getAttribute('data-nit'), btn.getAttribute('data-nombre'));
      });
    }

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!isStaff()) {
          window.location.href = 'login.html';
          return;
        }
        var sku = document.getElementById('cotizadorSku');
        var qty = document.getElementById('cotizadorQty');
        var before = items.length;
        var beforeQty = items.reduce(function (acc, it) { return acc + (it.qty || 0); }, 0);
        addItem(sku ? sku.value : '', qty ? qty.value : 1);
        var afterQty = items.reduce(function (acc, it) { return acc + (it.qty || 0); }, 0);
        if (afterQty > beforeQty || items.length !== before) {
          if (sku) sku.value = '';
          if (qty) qty.value = '1';
          hideSkuSuggestions();
          pendingSelectedSku = '';
          updateSkuPreview();
          if (sku) sku.focus();
        }
      });
    }

    var fleteInput = document.getElementById('fleteAntesIva');
    if (fleteInput) {
      fleteInput.addEventListener('change', function () {
        updateFleteAntesIva(fleteInput.value);
      });
      fleteInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        fleteInput.blur();
      });
    }

    var totalConInput = document.getElementById('totalConFlete');
    if (totalConInput && totalConInput.tagName === 'INPUT') {
      totalConInput.addEventListener('change', function () {
        var n = parseLocaleNumber(totalConInput.value);
        if (!isFinite(n) || n < 0) {
          setMessage('Total inválido.', 'error');
          render();
          return;
        }
        var trm = getTrm();
        var rows = items.map(function (item) { return lineCalc(item, trm); });
        var totals = computeTotals(rows);
        var totalSin = Number(totals.totalSinFlete) || 0;
        var aplicaIva = totals.fleteAplicaIva !== false;
        var factor = aplicaIva ? (1 + IVA) : 1;
        var fleteAntes = Math.max(0, (n - totalSin) / factor);
        items = items.map(function (it) {
          if (!it) return it;
          var copy = Object.assign({}, it);
          delete copy.fleteAntesOverride;
          delete copy.fleteEditManual;
          return copy;
        });
        writeItems(items);
        writeFleteOverride(fleteAntes);
        setMessage('Total con flete actualizado. Se recalculó el flete.', 'ok');
        render();
      });
      totalConInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        totalConInput.blur();
      });
    }

    var trmInput = document.getElementById('cotizadorTrm');
    if (trmInput) {
      applyTrmEditLock();
      trmInput.addEventListener('change', function () {
        if (!canEditTrm()) {
          applyTrmEditLock();
          return;
        }
        var v = Number(trmInput.value);
        if (!isFinite(v) || v <= 0) {
          setMessage('TRM inválida.', 'error');
          render();
          return;
        }
        setTrmValue(v);
        render();
        persistServerTrm(v);
      });
      trmInput.addEventListener('keydown', function (e) {
        if (!canEditTrm()) {
          if (e.key === 'Tab') return;
          e.preventDefault();
          return;
        }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        trmInput.blur();
      });
      trmInput.addEventListener('wheel', function (e) {
        if (!canEditTrm()) e.preventDefault();
      }, { passive: false });
    }

    var removeModal = document.getElementById('cotizadorRemoveModal');
    var removeModalText = document.getElementById('cotizadorRemoveText');
    var removeConfirmBtn = document.getElementById('cotizadorRemoveConfirm');
    var pendingRemoveIdx = -1;

    function closeRemoveModal() {
      if (removeModal) removeModal.hidden = true;
      pendingRemoveIdx = -1;
    }

    function openRemoveModal(idx) {
      pendingRemoveIdx = idx;
      var item = items[idx];
      var name = item
        ? (item.name || lookupName(item.sku) || item.sku)
        : '';
      if (removeModalText) {
        removeModalText.textContent = name
          ? '¿Quieres quitar "' + name + '" de la cotización?'
          : '¿Quieres quitar este producto de la cotización?';
      }
      if (removeModal) removeModal.hidden = false;
      if (removeConfirmBtn) removeConfirmBtn.focus();
    }

    if (removeModal) {
      removeModal.addEventListener('click', function (e) {
        if (e.target.closest('[data-modal-close]')) closeRemoveModal();
      });
    }

    if (removeConfirmBtn) {
      removeConfirmBtn.addEventListener('click', function () {
        var idx = pendingRemoveIdx;
        closeRemoveModal();
        if (idx >= 0) removeItem(idx);
      });
    }

    if (finishBtn) {
      finishBtn.addEventListener('click', function () {
        finishQuote();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (removeModal && !removeModal.hidden) closeRemoveModal();
    });

    if (body) {
      body.addEventListener('click', function (e) {
        var btn = e.target.closest('.cotizador-remove');
        if (!btn) return;
        openRemoveModal(Number(btn.getAttribute('data-idx')));
      });

      body.addEventListener('change', function (e) {
        var lineSelect = e.target.closest('.cotizador-line-select');
        if (lineSelect) {
          var lineIdx = Number(lineSelect.getAttribute('data-idx'));
          var lineField = lineSelect.getAttribute('data-field');
          if (lineField === 'lp') updateItemLp(lineIdx, lineSelect.value);
          else if (lineField === 'flete') updateItemFlete(lineIdx, lineSelect.value);
          else if (lineField === 'ciudad') updateItemMeta(lineIdx, 'ciudad', lineSelect.value);
          return;
        }
        var qtyInput = e.target.closest('.cotizador-qty-input');
        if (qtyInput) {
          updateItemQty(Number(qtyInput.getAttribute('data-idx')), qtyInput.value);
          return;
        }
        var metaInput = e.target.closest('.cotizador-meta-input');
        if (metaInput) {
          updateItemMeta(
            Number(metaInput.getAttribute('data-idx')),
            metaInput.getAttribute('data-field'),
            metaInput.value
          );
          return;
        }
        var priceInput = e.target.closest('.cotizador-price-input');
        if (priceInput) {
          updateItemPrice(
            Number(priceInput.getAttribute('data-idx')),
            priceInput.getAttribute('data-field'),
            priceInput.value
          );
        }
      });

      body.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var input = e.target.closest('.cotizador-qty-input, .cotizador-price-input, .cotizador-meta-input');
        if (!input) return;
        e.preventDefault();
        input.blur();
      });
    }

    document.addEventListener('izc:auth-changed', function () {
      clearForeignCotizarSessions();
      items = [];
      try { writeItems([]); } catch (eW) { /* ignore */ }
      resolveClientContext();
      paintClientCard();
      applyTrmEditLock();
      applyZktecoCotizadorUi();
      applySatCotizadorUi();
      if (!applyGate()) {
        render();
        return;
      }
      bootCotizadorCore();
    });
  }

  function init() {
    clearForeignCotizarSessions();
    resolveClientContext();
    paintClientCard();
    bind();
    // Precargar datos del PDF para que al terminar salga al instante.
    if (window.IZCCotizacionPdf && typeof IZCCotizacionPdf.preload === 'function') {
      IZCCotizacionPdf.preload().catch(function () { /* ignore */ });
    }
    setupAdminCotizadorUi().then(function () {
      applyZktecoCotizadorUi();
      applySatCotizadorUi();
      applyTrmEditLock();
      if (!applyGate()) return;
      // Entrada sin cliente/quote/recotizar: cotizador limpio.
      if (!clientContext.nit && !clientContext.quoteId && !clientContext.recotizar) {
        items = [];
        try { writeItems([]); } catch (e0) { /* ignore */ }
      }
      bootCotizadorCore();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
