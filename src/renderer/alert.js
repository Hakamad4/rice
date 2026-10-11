// Janelinha "a reunião vai começar". Só textContent; as ações vão por IPC (o main valida a origem).
(function () {
  const $ = (id) => document.getElementById(id);
  const t = (key) => window.RiceI18n.t(key);
  let hasLink = false;
  const paint = () => {
    window.RiceI18n.applyDom();
    $('join').textContent = hasLink ? t('alert.join-record') : t('alert.record');
  };
  window.RiceI18n.setLanguage(window.alertApi.uiLanguage);
  window.alertApi.onLanguage((language) => {
    window.RiceI18n.setLanguage(language);
    paint();
  });
  window.alertApi.onData((d) => {
    $('title').textContent = d.title;
    $('title').title = d.title;
    $('time').textContent = d.time;
    if (d.color) $('bar').style.background = d.color;
    hasLink = Boolean(d.hasLink);
    paint();
    $('record').hidden = !d.hasLink;
  });
  const act = (action) => (e) => {
    e.stopPropagation();
    window.alertApi.act(action);
  };
  $('join').onclick = act('join');
  $('record').onclick = act('record');
  $('close').onclick = act('close');
  $('card').onclick = act('join');
})();
