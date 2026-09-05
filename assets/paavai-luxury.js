/* ==========================================================================
   PAAVAI — interactivity for the redesigned pages
   --------------------------------------------------------------------------
   Portal tabs, appointment scheduler, booking confirmation, address forms,
   and the wishlist grid.

   The brief asked for React. This is a Liquid theme, so there is no React
   runtime — this is the same behaviour in plain JS. Every module below
   PROGRESSIVELY ENHANCES markup that already works without it: tabs are
   real anchors to real panels, forms are real form posts, and the address
   editors are visible by default and merely collapsed here. If this file
   fails to load, the pages still function.
   ========================================================================== */

(function () {
  'use strict';

  var STORAGE_WISHLIST = 'paavai:wishlist';
  var STORAGE_BOOKING = 'paavai:lastBooking';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /* ======================================================================
     1. CUSTOMER PORTAL TABS
     Anchors to real panels, so #orders / #profile deep-link and the
     browser Back button behaves. Both panels exist in the DOM; we only
     toggle `hidden`.
     ====================================================================== */
  function initPortalTabs() {
    var tabs = $$('[data-portal-tab]');
    if (!tabs.length) return;

    var panels = $$('[data-portal-panel]');

    function show(name, focusPanel) {
      tabs.forEach(function (t) {
        var on = t.dataset.portalTab === name;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach(function (p) {
        p.hidden = p.dataset.portalPanel !== name;
      });
      if (focusPanel) {
        var panel = panels.filter(function (p) { return p.dataset.portalPanel === name; })[0];
        // Move focus so keyboard and screen reader users land in the new panel.
        if (panel) { panel.setAttribute('tabindex', '-1'); panel.focus(); }
      }
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (e) {
        e.preventDefault();
        var name = tab.dataset.portalTab;
        show(name, true);
        if (history.replaceState) history.replaceState(null, '', '#' + name);
      });
    });

    // Arrow-key navigation between tabs, per the tablist pattern.
    tabs.forEach(function (tab, i) {
      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (!next) return;
        e.preventDefault();
        next.focus();
        show(next.dataset.portalTab, false);
      });
    });

    var initial = (window.location.hash || '').replace('#', '');
    show(initial === 'profile' ? 'profile' : 'orders', false);
  }

  /* ======================================================================
     2. APPOINTMENT SCHEDULER
     ====================================================================== */
  function initBookingForm() {
    var dateInput = $('[data-booking-date]');
    if (!dateInput) return;

    // Earliest bookable day is tomorrow. Computed here rather than in
    // Liquid because the shopper's timezone is a browser fact, and a
    // server-rendered date would go stale on a cached page.
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateInput.min = toISO(tomorrow);

    var horizon = new Date();
    horizon.setDate(horizon.getDate() + 90);
    dateInput.max = toISO(horizon);

    // We are closed on Sundays. Nudge rather than block: the native date
    // picker gives us no way to grey out single weekdays, so silently
    // rejecting a Sunday would look broken.
    var notice = document.createElement('p');
    notice.className = 'form-field__hint form-field__hint--warn';
    notice.hidden = true;
    notice.textContent = 'We are closed on Sundays — please pick another day.';
    dateInput.parentNode.appendChild(notice);

    dateInput.addEventListener('change', function () {
      if (!dateInput.value) { notice.hidden = true; return; }
      // Parse as local, not UTC: new Date('2026-09-06') is midnight UTC and
      // can land on the previous day west of Greenwich.
      var parts = dateInput.value.split('-');
      var picked = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      notice.hidden = picked.getDay() !== 0;
    });

    // Stash the chosen values so the confirmation can show them after the
    // redirect — Shopify's contact form posts and redirects, which drops
    // the body before any page can read it.
    var form = dateInput.form;
    if (form) {
      form.addEventListener('submit', function () {
        var typeEl = $$('[data-booking-type]').filter(function (r) { return r.checked; })[0];
        try {
          sessionStorage.setItem(STORAGE_BOOKING, JSON.stringify({
            date: dateInput.value || '',
            time: ($('[data-booking-time]') || {}).value || '',
            type: typeEl ? typeEl.getAttribute('data-booking-type-label') : ''
          }));
        } catch (e) { /* storage unavailable; the modal degrades below */ }
      });
    }
  }

  function toISO(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function prettyDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    try {
      return d.toLocaleDateString('en-IN', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
    } catch (e) { return iso; }
  }

  /* ======================================================================
     3. BOOKING CONFIRMATION MODAL
     Rendered by Liquid only on a genuine successful post; this fills in
     the summary and manages focus.
     ====================================================================== */
  function initBookingModal() {
    var modal = $('[data-booking-modal]');
    if (!modal) return;

    var summary = $('[data-booking-summary]', modal);
    var stored = null;
    try { stored = JSON.parse(sessionStorage.getItem(STORAGE_BOOKING) || 'null'); } catch (e) {}

    // Only reveal the summary if we actually captured something. An empty
    // card claiming an appointment would be worse than no card.
    if (summary && stored && (stored.date || stored.time || stored.type)) {
      setText('[data-summary-date]', prettyDate(stored.date) || 'Any date', summary);
      setText('[data-summary-time]', stored.time || 'Any time', summary);
      setText('[data-summary-type]', stored.type || 'In-store visit', summary);
      summary.hidden = false;
    }
    try { sessionStorage.removeItem(STORAGE_BOOKING); } catch (e) {}

    var lastFocus = document.activeElement;
    var panel = $('.pv-modal__panel', modal);
    if (panel) { panel.setAttribute('tabindex', '-1'); panel.focus(); }

    function close() {
      modal.classList.remove('is-open');
      modal.setAttribute('hidden', '');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      // Drop ?contact_posted=true so a refresh does not re-open the modal.
      if (history.replaceState) {
        history.replaceState(null, '', window.location.pathname + window.location.hash);
      }
    }

    $$('[data-booking-close]', modal).forEach(function (el) {
      el.addEventListener('click', close);
    });

    document.addEventListener('keydown', function onEsc(e) {
      if (e.key !== 'Escape' || !modal.classList.contains('is-open')) return;
      close();
      document.removeEventListener('keydown', onEsc);
    });

    // Trap focus inside the dialog while it is open.
    modal.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = $$('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])', modal)
        .filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function setText(sel, value, root) {
    var el = $(sel, root);
    if (el) el.textContent = value;
  }

  /* ======================================================================
     4. ADDRESS FORMS
     Forms are visible in the markup and collapsed here, so the page works
     with no JS at all.
     ====================================================================== */
  function initAddressForms() {
    var wraps = $$('[data-address-form]');
    if (!wraps.length) return;

    wraps.forEach(function (w) { w.hidden = true; });

    function toggle(id, open) {
      var wrap = $('[data-address-form="' + id + '"]');
      var btn = $('[data-address-toggle="' + id + '"]');
      if (!wrap) return;
      wrap.hidden = !open;
      if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        var first = $('input, select', wrap);
        if (first) first.focus();
      } else if (btn) {
        btn.focus();
      }
    }

    $$('[data-address-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.addressToggle;
        var wrap = $('[data-address-form="' + id + '"]');
        toggle(id, wrap ? wrap.hidden : true);
      });
    });

    $$('[data-address-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function () { toggle(btn.dataset.addressCancel, false); });
    });

    // Country/province linkage. Shopify ships Shopify.CountryProvinceSelector
    // in its own bundle; when that is unavailable, hide the province field
    // rather than leaving an empty select the shopper cannot use.
    $$('[data-address-country]').forEach(function (country) {
      var scope = country.closest('form');
      if (!scope) return;
      var province = $('[data-address-province]', scope);
      var wrap = $('[data-address-province-wrap]', scope);
      if (!province || !wrap) return;

      if (window.Shopify && typeof window.Shopify.CountryProvinceSelector === 'function') {
        country.id = country.id || 'pv-country-' + Math.random().toString(36).slice(2, 8);
        province.id = province.id || 'pv-province-' + Math.random().toString(36).slice(2, 8);
        wrap.id = wrap.id || 'pv-province-wrap-' + Math.random().toString(36).slice(2, 8);
        new window.Shopify.CountryProvinceSelector(country.id, province.id, { hideElement: wrap.id });
      } else {
        wrap.hidden = true;
      }
    });
  }

  /* ======================================================================
     5. AUTH PANEL TOGGLE (sign in / recover)
     ====================================================================== */
  function initAuthPanels() {
    var panels = $$('[data-auth-panel]');
    if (panels.length < 2) return;

    function show(name) {
      panels.forEach(function (p) { p.hidden = p.dataset.authPanel !== name; });
    }

    $$('[data-auth-show]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        show(link.dataset.authShow);
      });
    });

    show(window.location.hash === '#recover' ? 'recover' : 'login');
  }

  /* ======================================================================
     6. WISHLIST GRID
     theme.js stores saved product handles in localStorage. This renders
     them on the profile tab by fetching each product's JSON.
     ====================================================================== */
  function initWishlistGrid() {
    var grid = $('[data-wishlist-grid]');
    if (!grid) return;

    var handles = [];
    try {
      handles = JSON.parse(localStorage.getItem(STORAGE_WISHLIST) || '[]');
    } catch (e) { handles = []; }

    if (!Array.isArray(handles) || !handles.length) return;

    var empty = $('[data-wishlist-empty]', grid);

    Promise.all(handles.slice(0, 12).map(function (handle) {
      return fetch('/products/' + encodeURIComponent(handle) + '.js')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    })).then(function (items) {
      var found = items.filter(Boolean);
      // Every saved handle 404'd — the products were deleted or renamed.
      // Leave the empty message rather than showing a blank grid.
      if (!found.length) return;
      if (empty) empty.remove();

      found.forEach(function (p) {
        var a = document.createElement('a');
        a.className = 'wishlist-item';
        a.href = '/products/' + p.handle;

        var media = document.createElement('span');
        media.className = 'wishlist-item__media';
        if (p.featured_image) {
          var img = document.createElement('img');
          img.src = p.featured_image;
          img.alt = '';
          img.loading = 'lazy';
          media.appendChild(img);
        } else {
          media.classList.add('wishlist-item__media--empty');
        }

        var title = document.createElement('span');
        title.className = 'wishlist-item__title';
        title.textContent = p.title;

        var price = document.createElement('span');
        price.className = 'wishlist-item__price';
        price.textContent = formatINR(p.price);

        a.appendChild(media);
        a.appendChild(title);
        a.appendChild(price);
        grid.appendChild(a);
      });
    });
  }

  function formatINR(paise) {
    var rupees = Math.round(paise / 100);
    try { return '₹' + rupees.toLocaleString('en-IN'); }
    catch (e) { return '₹' + rupees; }
  }

  /* ====================================================================== */
  function init() {
    initPortalTabs();
    initBookingForm();
    initBookingModal();
    initAddressForms();
    initAuthPanels();
    initWishlistGrid();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
