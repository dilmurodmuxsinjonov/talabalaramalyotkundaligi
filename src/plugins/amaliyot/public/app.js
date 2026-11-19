/* global document */
// Amaliyot kundaligi plagini mijoz tomoni yordamchilari (CSP-mos, inline skriptsiz)
(function () {
  var korxonaSelect = document.getElementById('am-korxona-select');
  var korxonaWrap = document.getElementById('am-korxona-yangi-wrap');
  if (korxonaSelect && korxonaWrap) {
    var syncKorxona = function () {
      korxonaWrap.hidden = Boolean(korxonaSelect.value);
    };
    korxonaSelect.addEventListener('change', syncKorxona);
    syncKorxona();
  }

  var editButtons = document.querySelectorAll('[data-am-fill-date]');
  editButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var sana = btn.getAttribute('data-am-fill-date') || '';
      var soat = btn.getAttribute('data-am-fill-soat') || '6';
      var mazmun = btn.getAttribute('data-am-fill-mazmun') || '';
      var natija = btn.getAttribute('data-am-fill-natija') || '';

      var fSana = document.getElementById('am-sana');
      var fSoat = document.getElementById('am-soat');
      var fMazmun = document.getElementById('am-mazmun');
      var fNatija = document.getElementById('am-natija');
      if (fSana) fSana.value = sana;
      if (fSoat) fSoat.value = soat;
      if (fMazmun) fMazmun.value = mazmun;
      if (fNatija) fNatija.value = natija;
      if (fMazmun) fMazmun.focus();
    });
  });
})();
