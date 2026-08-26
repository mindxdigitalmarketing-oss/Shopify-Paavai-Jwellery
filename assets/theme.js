/* ==========================================================================
   PAAVAI JEWELLERY — theme.js
   Vanilla JS: AJAX cart, cart drawer, mobile nav, product gallery,
   variant selection with dynamic pricing.
   No external dependencies. Safe to defer-load.
   ========================================================================== */

(function () {
  'use strict';

  var routes = {
    cartAdd: '/cart/add.js',
    cartChange: '/cart/change.js',
    cartUpdate: '/cart/update.js',
    cartGet: '/cart.js',
    checkout: '/checkout'
  };

  var moneyFormat = window.Shopify && window.Shopify.money_format ? window.Shopify.money_format : '₹{{amount}}';

  /* ---------------------------------------------------------------------
     Utilities
  --------------------------------------------------------------------- */
  function qs(selector, context) { return (context || document).querySelector(selector); }
  function qsa(selector, context) { return Array.prototype.slice.call((context || document).querySelectorAll(selector)); }

  function formatMoney(cents) {
    if (typeof cents !== 'number') { cents = parseInt(cents, 10) || 0; }
    var value = (cents / 100).toFixed(2);
    var parts = value.split('.');
    var intPart = parts[0];
    var lastThree = intPart.substring(intPart.length - 3);
    var otherNumbers = intPart.substring(0, intPart.length - 3);
    if (otherNumbers !== '') { lastThree = ',' + lastThree; }
    var formattedInt = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
    var formatted = formattedInt + '.' + parts[1];
    return moneyFormat.replace(/\{\{\s*amount\s*\}\}/, formatted);
  }

  function fetchJSON(url, options) {
    options = options || {};
    options.headers = Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, options.headers || {});
    return fetch(url, options).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () { return {}; }).then(function (errBody) {
          var err = new Error(errBody.description || 'Cart request failed');
          err.body = errBody;
          throw err;
        });
      }
      return response.json();
    });
  }

  function showToast(message) {
    var existing = qs('.cart-toast');
    if (existing) { existing.remove(); }
    var toast = document.createElement('div');
    toast.className = 'cart-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add('is-visible'); });
    setTimeout(function () {
      toast.classList.remove('is-visible');
      setTimeout(function () { toast.remove(); }, 300);
    }, 2600);
  }

  /* ---------------------------------------------------------------------
     Mobile navigation
  --------------------------------------------------------------------- */
  var MobileNav = {
    init: function () {
      var toggle = qs('.header__menu-toggle');
      var nav = qs('#MobileNav');
      var overlay = qs('[data-drawer-overlay]');
      if (!toggle || !nav) { return; }

      toggle.addEventListener('click', function () {
        var isOpen = nav.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        nav.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        if (overlay) { overlay.hidden = !isOpen; overlay.classList.toggle('is-visible', isOpen); }
        document.body.style.overflow = isOpen ? 'hidden' : '';
      });

      if (overlay) {
        overlay.addEventListener('click', function () {
          if (nav.classList.contains('is-open')) {
            nav.classList.remove('is-open');
            toggle.setAttribute('aria-expanded', 'false');
            nav.setAttribute('aria-hidden', 'true');
            overlay.hidden = true;
            overlay.classList.remove('is-visible');
            document.body.style.overflow = '';
          }
        });
      }
    }
  };

  /* ---------------------------------------------------------------------
     Cart Drawer
  --------------------------------------------------------------------- */
  var CartDrawer = {
    drawer: null,
    overlay: null,
    freeShippingEnabled: false,
    freeShippingThreshold: 0,

    init: function () {
      this.drawer = qs('#CartDrawer');
      this.overlay = qs('[data-drawer-overlay]');
      if (!this.drawer) { return; }

      this.freeShippingEnabled = this.drawer.getAttribute('data-free-shipping-enabled') === 'true';
      this.freeShippingThreshold = parseInt(this.drawer.getAttribute('data-free-shipping-threshold'), 10) || 0;

      qsa('[data-cart-drawer-toggle]').forEach(function (btn) {
        btn.addEventListener('click', this.open.bind(this));
      }, this);

      qsa('[data-cart-drawer-close]').forEach(function (btn) {
        btn.addEventListener('click', this.close.bind(this));
      }, this);

      if (this.overlay) {
        this.overlay.addEventListener('click', this.close.bind(this));
      }

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { this.close(); }
      }.bind(this));

      this.drawer.addEventListener('click', this.handleDrawerClick.bind(this));
      this.drawer.addEventListener('change', this.handleQuantityInput.bind(this));

      document.addEventListener('cart:updated', function (e) {
        this.render(e.detail.cart);
      }.bind(this));
    },

    open: function () {
      this.drawer.classList.add('is-open');
      this.drawer.setAttribute('aria-hidden', 'false');
      if (this.overlay) { this.overlay.hidden = false; this.overlay.classList.add('is-visible'); }
      document.body.style.overflow = 'hidden';
    },

    close: function () {
      if (!this.drawer.classList.contains('is-open')) { return; }
      this.drawer.classList.remove('is-open');
      this.drawer.setAttribute('aria-hidden', 'true');
      if (this.overlay && !qs('.mobile-nav.is-open')) {
        this.overlay.hidden = true;
        this.overlay.classList.remove('is-visible');
      }
      document.body.style.overflow = '';
    },

    handleDrawerClick: function (e) {
      var removeBtn = e.target.closest('[data-cart-remove]');
      var minusBtn = e.target.closest('[data-cart-qty-minus]');
      var plusBtn = e.target.closest('[data-cart-qty-plus]');
      var checkoutBtn = e.target.closest('[data-checkout-btn]');

      if (removeBtn) {
        this.updateLine(removeBtn.getAttribute('data-line'), 0);
      } else if (minusBtn) {
        var item = minusBtn.closest('[data-cart-item]');
        var input = qs('[data-cart-qty-input]', item);
        var newQty = Math.max(0, parseInt(input.value, 10) - 1);
        this.updateLine(minusBtn.getAttribute('data-line'), newQty);
      } else if (plusBtn) {
        var item2 = plusBtn.closest('[data-cart-item]');
        var input2 = qs('[data-cart-qty-input]', item2);
        var newQty2 = parseInt(input2.value, 10) + 1;
        this.updateLine(plusBtn.getAttribute('data-line'), newQty2);
      } else if (checkoutBtn) {
        window.location.href = routes.checkout;
      }
    },

    handleQuantityInput: function (e) {
      var input = e.target.closest('[data-cart-qty-input]');
      if (!input) { return; }
      var qty = Math.max(0, parseInt(input.value, 10) || 0);
      this.updateLine(input.getAttribute('data-line'), qty);
    },

    updateLine: function (line, quantity) {
      var self = this;
      fetchJSON(routes.cartChange, {
        method: 'POST',
        body: JSON.stringify({ line: parseInt(line, 10), quantity: quantity })
      }).then(function (cart) {
        self.render(cart);
        Cart.updateCountBubble(cart.item_count);
      }).catch(function (err) {
        console.error('Cart update failed', err);
        showToast('Could not update your bag. Please try again.');
      });
    },

    updateShippingBar: function (cart) {
      if (!this.freeShippingEnabled) { return; }
      var bar = qs('[data-shipping-bar]', this.drawer);
      if (!bar) { return; }

      if (cart.item_count === 0) { bar.hidden = true; return; }
      bar.hidden = false;

      var msgEl = qs('[data-shipping-bar-msg]', bar);
      var fillEl = qs('[data-shipping-bar-fill]', bar);
      var threshold = this.freeShippingThreshold;
      var remaining = threshold - cart.total_price;

      if (remaining <= 0) {
        if (msgEl) { msgEl.innerHTML = '&#10022; You&rsquo;ve unlocked Free Insured Delivery'; }
        if (fillEl) { fillEl.style.width = '100%'; }
      } else {
        var percent = threshold > 0 ? Math.min(100, Math.round((cart.total_price / threshold) * 100)) : 0;
        if (msgEl) { msgEl.innerHTML = 'Add <strong>' + formatMoney(remaining) + '</strong> more for Free Insured Delivery'; }
        if (fillEl) { fillEl.style.width = percent + '%'; }
      }
    },

    render: function (cart) {
      var countEls = qsa('[data-cart-drawer-count]');
      countEls.forEach(function (el) { el.textContent = '(' + cart.item_count + ')'; });

      this.updateShippingBar(cart);

      var body = qs('[data-cart-drawer-body]', this.drawer);
      var footer = qs('[data-cart-drawer-footer]', this.drawer);
      if (!body) { return; }

      if (cart.item_count === 0) {
        body.innerHTML = '<div class="cart-drawer__empty" data-cart-drawer-empty>' +
          '<p>Your bag is empty.</p>' +
          '<a href="/collections/all" class="btn btn--outline-maroon" data-cart-drawer-close>Continue Shopping</a>' +
          '</div>';
        if (footer) { footer.hidden = true; }
        var closeLink = qs('[data-cart-drawer-close]', body);
        if (closeLink) { closeLink.addEventListener('click', this.close.bind(this)); }
        return;
      }

      if (footer) { footer.hidden = false; }

      var list = document.createElement('ul');
      list.className = 'cart-drawer__items';
      list.setAttribute('data-cart-drawer-items', '');

      cart.items.forEach(function (item, index) {
        var line = index + 1;
        var li = document.createElement('li');
        li.className = 'cart-drawer__item';
        li.setAttribute('data-cart-item', '');
        li.setAttribute('data-line', line);
        li.setAttribute('data-variant-id', item.variant_id);

        var variantHtml = (item.variant_title && item.variant_title !== 'Default Title')
          ? '<p class="cart-drawer__item-variant">' + item.variant_title + '</p>' : '';

        li.innerHTML =
          '<a href="' + item.url + '" class="cart-drawer__item-media">' +
            '<img src="' + (item.image ? item.image.replace(/(\.[a-zA-Z]{3,4})(\?|$)/, '_200x200$1$2') : '') + '" alt="' + escapeHtml(item.product_title) + '" width="90" height="90" loading="lazy">' +
          '</a>' +
          '<div class="cart-drawer__item-details">' +
            '<a href="' + item.url + '" class="cart-drawer__item-title">' + escapeHtml(item.product_title) + '</a>' +
            variantHtml +
            '<p class="cart-drawer__item-price">' + formatMoney(item.final_price) + '</p>' +
            '<div class="cart-drawer__item-qty">' +
              '<button type="button" class="quantity-stepper__btn" data-cart-qty-minus data-line="' + line + '" aria-label="Decrease quantity">&minus;</button>' +
              '<input type="number" class="cart-drawer__qty-input" min="0" value="' + item.quantity + '" data-cart-qty-input data-line="' + line + '" aria-label="Quantity">' +
              '<button type="button" class="quantity-stepper__btn" data-cart-qty-plus data-line="' + line + '" aria-label="Increase quantity">+</button>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="cart-drawer__item-remove" data-cart-remove data-line="' + line + '" aria-label="Remove ' + escapeHtml(item.product_title) + '">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>' +
          '</button>';

        list.appendChild(li);
      });

      body.innerHTML = '';
      body.appendChild(list);

      var subtotalEl = qs('[data-cart-drawer-subtotal]', this.drawer);
      if (subtotalEl) { subtotalEl.textContent = formatMoney(cart.total_price); }
    }
  };

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  /* ---------------------------------------------------------------------
     Cart (add to cart, count bubble)
  --------------------------------------------------------------------- */
  var Cart = {
    init: function () {
      document.addEventListener('submit', this.handleFormSubmit.bind(this));
    },

    handleFormSubmit: function (e) {
      var form = e.target.closest('form[action*="/cart/add"], form.product-form, form.product-card__form');
      if (!form) { return; }
      e.preventDefault();

      var submitBtn = qs('[type="submit"]', form);
      var originalText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Adding&hellip;';
      }

      var formData = new FormData(form);
      var body = {};
      formData.forEach(function (value, key) { body[key] = value; });

      fetchJSON(routes.cartAdd, {
        method: 'POST',
        body: JSON.stringify(body)
      }).then(function () {
        return fetchJSON(routes.cartGet);
      }).then(function (cart) {
        Cart.updateCountBubble(cart.item_count);
        document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart: cart } }));
        showToast('Added to your bag');
        if (CartDrawer.drawer) { CartDrawer.open(); }
      }).catch(function (err) {
        console.error('Add to cart failed', err);
        showToast((err.body && err.body.description) || 'Could not add item to your bag.');
      }).finally(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      });
    },

    updateCountBubble: function (count) {
      qsa('[data-cart-count]').forEach(function (el) {
        el.textContent = count;
        el.setAttribute('data-cart-count', count);
      });
    }
  };

  /* ---------------------------------------------------------------------
     Live Search (Shopify predictive search)
  --------------------------------------------------------------------- */
  var LiveSearch = {
    init: function () {
      this.overlay = qs('[data-search-overlay]');
      this.toggleBtns = qsa('[data-search-toggle]');
      if (!this.overlay || !this.toggleBtns.length) { return; }

      this.input = qs('[data-search-input]', this.overlay);
      this.results = qs('[data-search-results]', this.overlay);
      this.closeBtn = qs('[data-search-close]', this.overlay);
      this.debounceTimer = null;
      this.currentRequest = 0;

      this.toggleBtns.forEach(function (btn) {
        btn.addEventListener('click', this.open.bind(this));
      }, this);

      if (this.closeBtn) { this.closeBtn.addEventListener('click', this.close.bind(this)); }

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && this.overlay.classList.contains('is-open')) { this.close(); }
      }.bind(this));

      if (this.input) {
        this.input.addEventListener('input', function () {
          var term = this.input.value.trim();
          window.clearTimeout(this.debounceTimer);
          if (term.length < 2) {
            this.results.innerHTML = '';
            return;
          }
          this.debounceTimer = window.setTimeout(function () {
            this.fetchResults(term);
          }.bind(this), 260);
        }.bind(this));
      }
    },

    open: function (e) {
      if (e) { e.preventDefault(); }
      if (CartDrawer.drawer && CartDrawer.drawer.classList.contains('is-open')) { CartDrawer.close(); }
      var mobileNav = qs('.mobile-nav.is-open');
      if (mobileNav) { mobileNav.classList.remove('is-open'); }
      this.overlay.hidden = false;
      requestAnimationFrame(function () {
        this.overlay.classList.add('is-open');
        this.overlay.setAttribute('aria-hidden', 'false');
      }.bind(this));
      this.toggleBtns.forEach(function (btn) { btn.setAttribute('aria-expanded', 'true'); });
      if (this.input) { this.input.focus(); }
    },

    close: function () {
      this.overlay.classList.remove('is-open');
      this.overlay.setAttribute('aria-hidden', 'true');
      this.toggleBtns.forEach(function (btn) { btn.setAttribute('aria-expanded', 'false'); });
      window.setTimeout(function () { this.overlay.hidden = true; }.bind(this), 300);
    },

    fetchResults: function (term) {
      var requestId = ++this.currentRequest;
      this.results.innerHTML = '<p class="search-overlay__status">Searching&hellip;</p>';

      var url = '/search/suggest.json?q=' + encodeURIComponent(term) +
        '&resources[type]=product&resources[limit]=6&resources[options][unavailable_products]=last';

      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (requestId !== this.currentRequest) { return; }
          var products = (data.resources && data.resources.results && data.resources.results.products) || [];
          this.renderResults(term, products);
        }.bind(this))
        .catch(function () {
          if (requestId !== this.currentRequest) { return; }
          this.results.innerHTML = '<p class="search-overlay__status">Something went wrong. Try pressing Enter to see full results.</p>';
        }.bind(this));
    },

    renderResults: function (term, products) {
      if (!products.length) {
        this.results.innerHTML = '<p class="search-overlay__status">No products found for &ldquo;' + escapeHtml(term) + '&rdquo;.</p>';
        return;
      }

      var html = '<div class="search-results__grid">';
      products.forEach(function (product) {
        var imgSrc = product.image || product.featured_image || '';
        html += '<a href="' + product.url + '" class="search-result-card">' +
          '<span class="search-result-card__img">' + (imgSrc ? '<img src="' + imgSrc + '" alt="" loading="lazy">' : '') + '</span>' +
          '<span class="search-result-card__text">' +
            '<span class="search-result-card__title">' + escapeHtml(product.title) + '</span>' +
            '<span class="search-result-card__price">' + (product.price || '') + '</span>' +
          '</span>' +
        '</a>';
      });
      html += '</div>';
      html += '<a href="/search?q=' + encodeURIComponent(term) + '&type=product" class="search-overlay__viewall">View all results for &ldquo;' + escapeHtml(term) + '&rdquo; <span aria-hidden="true">&rarr;</span></a>';
      this.results.innerHTML = html;
    }
  };

  /* ---------------------------------------------------------------------
     Sticky Header (glassmorphism on scroll)
  --------------------------------------------------------------------- */
  var StickyHeader = {
    init: function () {
      var header = qs('#SiteHeader');
      if (!header) { return; }

      var ticking = false;
      function update() {
        header.classList.toggle('is-scrolled', window.scrollY > 24);
        ticking = false;
      }
      window.addEventListener('scroll', function () {
        if (!ticking) {
          window.requestAnimationFrame(update);
          ticking = true;
        }
      }, { passive: true });
      update();
    }
  };

  /* ---------------------------------------------------------------------
     Featured Collection Carousel
  --------------------------------------------------------------------- */
  var FeaturedCarousel = {
    init: function () {
      qsa('[data-featured-carousel]').forEach(function (root) {
        var track = qs('[data-carousel-track]', root);
        var prev = qs('[data-carousel-prev]', root);
        var next = qs('[data-carousel-next]', root);
        if (!track) { return; }

        function step() {
          var slide = qs('[data-carousel-track] > *', root);
          return slide ? slide.getBoundingClientRect().width + 20 : track.clientWidth * 0.8;
        }

        if (prev) {
          prev.addEventListener('click', function () {
            track.scrollBy({ left: -step(), behavior: 'smooth' });
          });
        }
        if (next) {
          next.addEventListener('click', function () {
            track.scrollBy({ left: step(), behavior: 'smooth' });
          });
        }
      });
    }
  };

  /* ---------------------------------------------------------------------
     Product Gallery
  --------------------------------------------------------------------- */
  var ProductGallery = {
    init: function () {
      var gallery = qs('[data-product-gallery]');
      if (!gallery) { return; }

      this.gallery = gallery;
      this.images = qsa('[data-gallery-main-image]', gallery);
      this.thumbs = qsa('[data-gallery-thumb]', gallery);
      this.current = 0;

      qsa('[data-gallery-thumb]', gallery).forEach(function (thumb) {
        thumb.addEventListener('click', function () {
          this.show(parseInt(thumb.getAttribute('data-index'), 10));
        }.bind(this));
      }, this);

      var prev = qs('[data-gallery-prev]', gallery);
      var next = qs('[data-gallery-next]', gallery);
      if (prev) { prev.addEventListener('click', function () { this.show(this.current - 1); }.bind(this)); }
      if (next) { next.addEventListener('click', function () { this.show(this.current + 1); }.bind(this)); }

      this.initZoom();
    },

    initZoom: function () {
      var main = qs('.product-gallery__main', this.gallery);
      if (!main || window.matchMedia('(hover: none)').matches) { return; }

      main.addEventListener('mouseenter', function () { main.classList.add('is-zoomed'); });
      main.addEventListener('mouseleave', function () {
        main.classList.remove('is-zoomed');
        main.style.setProperty('--zoom-x', '50%');
        main.style.setProperty('--zoom-y', '50%');
      });
      main.addEventListener('mousemove', function (e) {
        var rect = main.getBoundingClientRect();
        var x = ((e.clientX - rect.left) / rect.width) * 100;
        var y = ((e.clientY - rect.top) / rect.height) * 100;
        main.style.setProperty('--zoom-x', x + '%');
        main.style.setProperty('--zoom-y', y + '%');
      });
    },

    show: function (index) {
      if (!this.images.length) { return; }
      var total = this.images.length;
      this.current = ((index % total) + total) % total;

      this.images.forEach(function (img, i) {
        img.classList.toggle('is-active', i === this.current);
      }, this);

      this.thumbs.forEach(function (thumb, i) {
        thumb.classList.toggle('is-active', i === this.current);
        thumb.setAttribute('aria-selected', i === this.current ? 'true' : 'false');
      }, this);
    }
  };

  /* ---------------------------------------------------------------------
     Product Variant Selection (dynamic pricing)
  --------------------------------------------------------------------- */
  var ProductVariants = {
    init: function () {
      var jsonEl = qs('[data-product-json]');
      var form = qs('#ProductForm');
      if (!jsonEl || !form) { return; }

      try {
        this.product = JSON.parse(jsonEl.textContent);
      } catch (e) {
        console.error('Could not parse product JSON', e);
        return;
      }

      this.form = form;
      this.selections = this.product.options.map(function (_, i) {
        var input = qs('.product-form__option[data-option-index="' + i + '"] .swatch-btn.is-selected');
        return input ? input.getAttribute('data-value') : this.product.options[i];
      }, this);

      qsa('[data-option-value]', form).forEach(function (btn) {
        btn.addEventListener('click', this.handleOptionClick.bind(this));
      }, this);

      var quantityInput = qs('[data-quantity-input]', form);
      var minusBtn = qs('[data-quantity-minus]', form);
      var plusBtn = qs('[data-quantity-plus]', form);
      if (minusBtn && quantityInput) {
        minusBtn.addEventListener('click', function () {
          quantityInput.value = Math.max(1, parseInt(quantityInput.value, 10) - 1);
        });
      }
      if (plusBtn && quantityInput) {
        plusBtn.addEventListener('click', function () {
          quantityInput.value = parseInt(quantityInput.value, 10) + 1;
        });
      }

      var buyNow = qs('[data-buy-now-btn]', form);
      if (buyNow) {
        buyNow.addEventListener('click', function () {
          var variantId = qs('[data-selected-variant-id]', form).value;
          var qty = quantityInput ? quantityInput.value : 1;
          window.location.href = '/cart/' + variantId + ':' + qty + '?checkout';
        });
      }
    },

    handleOptionClick: function (e) {
      var btn = e.target.closest('[data-option-value]');
      var optionIndex = parseInt(btn.getAttribute('data-option-index'), 10);
      var value = btn.getAttribute('data-value');
      this.selections[optionIndex] = value;

      qsa('.product-form__option[data-option-index="' + optionIndex + '"] .swatch-btn').forEach(function (el) {
        var isSelected = el.getAttribute('data-value') === value;
        el.classList.toggle('is-selected', isSelected);
        el.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      });

      var selectedValueLabel = qs('.product-form__option[data-option-index="' + optionIndex + '"] [data-option-selected-value]');
      if (selectedValueLabel) { selectedValueLabel.textContent = value; }

      this.updateVariant();
    },

    findVariant: function () {
      var selections = this.selections;
      return this.product.variants.find(function (variant) {
        return variant.options.every(function (opt, i) { return opt === selections[i]; });
      });
    },

    updateVariant: function () {
      var variant = this.findVariant();
      var priceEl = qs('[data-product-price]');
      var compareEl = qs('[data-compare-price]');
      var saveBadge = qs('[data-save-badge]');
      var addBtn = qs('[data-add-to-cart-btn]');
      var addText = qs('[data-add-to-cart-text]');
      var addPrice = qs('[data-add-to-cart-price]');
      var skuEl = qs('[data-variant-sku]');
      var weightEl = qs('[data-variant-weight]');
      var idInput = qs('[data-selected-variant-id]');

      if (!variant) {
        if (addBtn) { addBtn.disabled = true; }
        if (addText) { addText.textContent = 'Unavailable'; }
        return;
      }

      if (idInput) { idInput.value = variant.id; }
      if (priceEl) { priceEl.textContent = formatMoney(variant.price); }

      if (variant.compare_at_price && variant.compare_at_price > variant.price) {
        if (compareEl) { compareEl.textContent = formatMoney(variant.compare_at_price); compareEl.style.display = ''; }
        if (saveBadge) {
          var pct = Math.round(((variant.compare_at_price - variant.price) / variant.compare_at_price) * 100);
          saveBadge.textContent = 'Save ' + pct + '%';
          saveBadge.style.display = '';
        }
      } else {
        if (compareEl) { compareEl.style.display = 'none'; }
        if (saveBadge) { saveBadge.style.display = 'none'; }
      }

      if (skuEl) { skuEl.textContent = variant.sku || ''; }
      if (weightEl && variant.weight) {
        weightEl.textContent = 'Gross Weight: ' + (variant.weight / 1000).toFixed(2) + ' kg';
      }

      if (addBtn) {
        addBtn.disabled = !variant.available;
        if (addText) {
          addText.innerHTML = variant.available
            ? 'Add to Cart &mdash; <span data-add-to-cart-price>' + formatMoney(variant.price) + '</span>'
            : 'Sold Out';
        }
      }
    }
  };

  /* ---------------------------------------------------------------------
     Quick View modal — populated from Shopify's /products/{handle}.js
     endpoint so it always reflects real, live product/variant data.
     Add-to-cart inside the modal is handled by the existing Cart module
     (the injected form carries the .product-form class it listens for).
  --------------------------------------------------------------------- */
  var QuickView = {
    init: function () {
      this.modal = qs('[data-quick-view-modal]');
      if (!this.modal) { return; }
      this.body = qs('[data-quick-view-body]', this.modal);

      document.addEventListener('click', function (e) {
        var trigger = e.target.closest('[data-quick-view-btn]');
        if (trigger) {
          e.preventDefault();
          this.open(trigger.getAttribute('data-product-url'));
          return;
        }
        var closeTarget = e.target.closest('[data-quick-view-close]');
        if (closeTarget) { this.close(); }
      }.bind(this));

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !this.modal.hidden) { this.close(); }
      }.bind(this));

      document.addEventListener('cart:updated', function () {
        if (!this.modal.hidden) { this.close(); }
      }.bind(this));
    },

    open: function (url) {
      this.body.innerHTML = '<p class="quick-view-modal__loading">Loading&hellip;</p>';
      this.modal.hidden = false;
      requestAnimationFrame(function () {
        this.modal.classList.add('is-open');
        this.modal.setAttribute('aria-hidden', 'false');
      }.bind(this));
      document.body.style.overflow = 'hidden';

      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (product) { this.render(product); }.bind(this))
        .catch(function () {
          this.body.innerHTML = '<p class="quick-view-modal__loading">Could not load this product. <a href="' +
            url.replace(/\.js$/, '') + '">View full details</a>.</p>';
        }.bind(this));
    },

    close: function () {
      this.modal.classList.remove('is-open');
      this.modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      window.setTimeout(function () {
        this.modal.hidden = true;
        this.body.innerHTML = '';
      }.bind(this), 300);
    },

    render: function (product) {
      var variant = product.variants[0];
      var hasRealOptions = !(product.options.length === 1 && product.options[0] === 'Title');
      var optionsHtml = '';

      if (hasRealOptions) {
        product.options.forEach(function (optionName, i) {
          var values = [];
          product.variants.forEach(function (v) {
            var val = v.options[i];
            if (values.indexOf(val) === -1) { values.push(val); }
          });
          optionsHtml += '<div class="product-form__option" data-qv-option-index="' + i + '">' +
            '<label class="product-form__option-label">' + escapeHtml(optionName) + ': <span data-qv-option-selected>' + escapeHtml(values[0]) + '</span></label>' +
            '<div class="product-form__swatches" role="radiogroup" aria-label="' + escapeHtml(optionName) + '">' +
            values.map(function (v, vi) {
              return '<button type="button" class="swatch-btn' + (vi === 0 ? ' is-selected' : '') + '" data-qv-option-value data-qv-option-index="' + i + '" data-value="' + escapeHtml(v) + '">' + escapeHtml(v) + '</button>';
            }).join('') +
            '</div></div>';
        });
      }

      var imgSrc = product.featured_image || (product.images && product.images[0]) || '';
      if (imgSrc) { imgSrc = imgSrc.replace(/(\.[a-zA-Z]{3,4})(\?|$)/, '_800x$1$2'); }

      this.body.innerHTML =
        '<div class="quick-view-modal__media">' +
          (imgSrc ? '<img src="' + imgSrc + '" alt="' + escapeHtml(product.title) + '">' : '') +
        '</div>' +
        '<div class="quick-view-modal__info">' +
          '<h2 class="quick-view-modal__title">' + escapeHtml(product.title) + '</h2>' +
          '<span class="price price--large" data-qv-price>' + formatMoney(variant.price) + '</span>' +
          '<form class="product-form quick-view-form" data-qv-form>' +
            '<input type="hidden" name="id" value="' + variant.id + '" data-qv-variant-id>' +
            optionsHtml +
            '<div class="product-form__buttons">' +
              '<button type="submit" name="add" class="btn btn--maroon btn--full btn--large" data-qv-add-btn' + (variant.available ? '' : ' disabled') + '>' +
                '<span data-qv-add-text>' + (variant.available ? 'Add to Cart &mdash; ' + formatMoney(variant.price) : 'Sold Out') + '</span>' +
              '</button>' +
            '</div>' +
          '</form>' +
          '<a href="' + product.url + '" class="quick-view-modal__viewfull">View Full Details <span aria-hidden="true">&rarr;</span></a>' +
        '</div>';

      this._product = product;
      this._selections = product.options.map(function (_, i) { return variant.options[i]; });

      qsa('[data-qv-option-value]', this.body).forEach(function (btn) {
        btn.addEventListener('click', this.handleOptionClick.bind(this));
      }, this);
    },

    handleOptionClick: function (e) {
      var btn = e.target.closest('[data-qv-option-value]');
      var idx = parseInt(btn.getAttribute('data-qv-option-index'), 10);
      var value = btn.getAttribute('data-value');
      this._selections[idx] = value;

      qsa('[data-qv-option-index="' + idx + '"] .swatch-btn', this.body).forEach(function (el) {
        var isSelected = el.getAttribute('data-value') === value;
        el.classList.toggle('is-selected', isSelected);
      });
      var label = qs('[data-qv-option-index="' + idx + '"] [data-qv-option-selected]', this.body);
      if (label) { label.textContent = value; }

      var selections = this._selections;
      var variant = this._product.variants.find(function (v) {
        return v.options.every(function (opt, i) { return opt === selections[i]; });
      });

      var priceEl = qs('[data-qv-price]', this.body);
      var idInput = qs('[data-qv-variant-id]', this.body);
      var addBtn = qs('[data-qv-add-btn]', this.body);
      var addText = qs('[data-qv-add-text]', this.body);

      if (!variant) {
        if (addBtn) { addBtn.disabled = true; }
        if (addText) { addText.textContent = 'Unavailable'; }
        return;
      }

      if (idInput) { idInput.value = variant.id; }
      if (priceEl) { priceEl.textContent = formatMoney(variant.price); }
      if (addBtn) { addBtn.disabled = !variant.available; }
      if (addText) {
        addText.innerHTML = variant.available
          ? 'Add to Cart &mdash; ' + formatMoney(variant.price)
          : 'Sold Out';
      }
    }
  };

  /* ---------------------------------------------------------------------
     Init on DOM ready
  --------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    MobileNav.init();
    StickyHeader.init();
    LiveSearch.init();
    CartDrawer.init();
    Cart.init();
    FeaturedCarousel.init();
    ProductGallery.init();
    ProductVariants.init();
    QuickView.init();
  });

  window.PaavaiTheme = {
    Cart: Cart,
    CartDrawer: CartDrawer,
    FeaturedCarousel: FeaturedCarousel,
    LiveSearch: LiveSearch,
    QuickView: QuickView,
    formatMoney: formatMoney
  };
})();
