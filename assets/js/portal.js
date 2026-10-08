/* Videos instructivos del portal (lista + reproductor emergente). */
(function () {
  'use strict';

  var VIDEOS = [
    {
      id: 'gizc',
      title: 'Guía IZC',
      description: 'Cómo usar la plataforma IZC: ingresar, buscar y armar una cotización.',
      src: 'assets/videos/GIZC.mp4'
    },
    {
      id: 'gvaltech',
      title: 'Guía VALTECH',
      description: 'Cómo usar la plataforma VALTECH: ingresar, buscar y armar una cotización.',
      src: 'assets/videos/GVALTECH.mp4'
    }
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function openModal(el) {
    if (!el) return;
    el.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal(el) {
    if (!el) return;
    el.hidden = true;
    if ($('portalListModal').hidden && $('portalPlayerModal').hidden) {
      document.body.style.overflow = '';
    }
  }

  function stopPlayer() {
    var video = $('portalPlayerVideo');
    if (!video) return;
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch (e) { /* ignore */ }
  }

  function buildList() {
    var host = $('portalVideoList');
    if (!host) return;
    host.innerHTML = VIDEOS.map(function (item) {
      return (
        '<article class="portal-video-card" data-video-id="' + item.id + '">' +
          '<div class="portal-video-preview" aria-hidden="true">' +
            '<video muted playsinline preload="metadata" src="' + escapeHtml(item.src) + '#t=0.5"></video>' +
          '</div>' +
          '<div>' +
            '<h3>' + escapeHtml(item.title) + '</h3>' +
            '<p>' + escapeHtml(item.description) + '</p>' +
          '</div>' +
          '<button type="button" class="portal-video-ver" data-open-video="' + item.id + '">Ver</button>' +
        '</article>'
      );
    }).join('');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function findVideo(id) {
    for (var i = 0; i < VIDEOS.length; i++) {
      if (VIDEOS[i].id === id) return VIDEOS[i];
    }
    return null;
  }

  function openPlayer(id) {
    var item = findVideo(id);
    if (!item) return;
    var modal = $('portalPlayerModal');
    var video = $('portalPlayerVideo');
    var caption = $('portalPlayerCaption');
    if (!modal || !video) return;

    if (caption) caption.textContent = item.title + ' — ' + item.description;
    stopPlayer();
    video.src = item.src;
    video.load();
    openModal(modal);
    var playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(function () { /* autoplay bloqueado: el usuario puede dar play */ });
    }
  }

  function bind() {
    var openBtn = $('portalOpenVideos');
    var listModal = $('portalListModal');
    var playerModal = $('portalPlayerModal');
    if (!openBtn || !listModal || !playerModal) return;

    buildList();

    openBtn.addEventListener('click', function () {
      openModal(listModal);
    });

    // Solo la X cierra cada ventana (no el fondo ni Escape).
    listModal.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t) return;
      if (t.classList && t.classList.contains('portal-modal-close')) {
        closeModal(listModal);
        return;
      }
      var btn = t.closest ? t.closest('[data-open-video]') : null;
      if (btn) {
        openPlayer(btn.getAttribute('data-open-video'));
      }
    });

    playerModal.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t) return;
      if (t.classList && t.classList.contains('portal-modal-close')) {
        stopPlayer();
        closeModal(playerModal);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
