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
      var fSana = document.getElementById('am-sana');
      var fSoat = document.getElementById('am-soat');
      var fMazmun = document.getElementById('am-mazmun');
      var fNatija = document.getElementById('am-natija');
      if (fSana) fSana.value = btn.getAttribute('data-am-fill-date') || '';
      if (fSoat) fSoat.value = btn.getAttribute('data-am-fill-soat') || '6';
      if (fMazmun) fMazmun.value = btn.getAttribute('data-am-fill-mazmun') || '';
      if (fNatija) fNatija.value = btn.getAttribute('data-am-fill-natija') || '';
      if (fMazmun) fMazmun.focus();
    });
  });

  var resetBtn = document.getElementById('am-reset-form');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      var fSana = document.getElementById('am-sana');
      var fMazmun = document.getElementById('am-mazmun');
      var fNatija = document.getElementById('am-natija');
      if (fSana && fSana.dataset.defaultDate) fSana.value = fSana.dataset.defaultDate;
      if (fMazmun) fMazmun.value = '';
      if (fNatija) fNatija.value = '';
      if (fMazmun) fMazmun.focus();
    });
  }

  var filterInput = document.getElementById('am-student-filter');
  var studentTable = document.getElementById('am-student-table');
  if (filterInput && studentTable) {
    var rows = Array.prototype.slice.call(studentTable.querySelectorAll('tbody tr'));
    filterInput.addEventListener('input', function () {
      var q = filterInput.value.trim().toLowerCase();
      rows.forEach(function (row) {
        row.hidden = Boolean(q && row.textContent.toLowerCase().indexOf(q) === -1);
      });
    });
  }
})();
