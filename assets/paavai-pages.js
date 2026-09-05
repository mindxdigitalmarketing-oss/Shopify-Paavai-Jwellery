/* ==========================================================================
   PAAVAI — behaviour for the storefront pages added alongside theme.js
   ========================================================================== */
(function () {
  'use strict';

  /**
   * Collection sort: submit on change.
   *
   * The form ships with a visible Apply button so it works with no
   * JavaScript at all. When this runs, the button is redundant — hide it and
   * submit on change instead, which is what shoppers expect from a sort menu.
   */
  function initSort() {
    var forms = document.querySelectorAll('[data-collection-sort]');

    Array.prototype.forEach.call(forms, function (form) {
      if (form.dataset.pvSortReady === 'true') return;
      form.dataset.pvSortReady = 'true';

      var select = form.querySelector('select[name="sort_by"]');
      var apply = form.querySelector('[data-sort-apply]');
      if (!select) return;

      if (apply) apply.hidden = true;

      select.addEventListener('change', function () {
        form.submit();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSort);
  } else {
    initSort();
  }
})();
