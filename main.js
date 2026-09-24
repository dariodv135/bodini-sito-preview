/* ==========================================================================
   main.js : shared behaviour of the Bodini site (v2, multi page)
   --------------------------------------------------------------------------
   Exposes window.BodiniSite = { init(root), refresh(), version }.
   - init(root) is idempotent: every module looks for its elements inside `root`
     (default: document) and skips the ones already marked data-init-<module>="1".
   - Every module is guarded: if its elements are missing it returns at once.
   - refresh() re-measures the hero canvas, re-runs the steps line and re-observes
     the reveal elements: the preview bundler calls it when it shows a page that was
     hidden while init ran.
   Modules: initHeader, initNavActive, initHeadline, initWater, initRipple,
            initReveal, initSegmented, initSteps, initSubnav, initFaq, initBooking,
            initContactForm.
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  // Mark the document as scripted as early as possible: the reveal rules only hide
  // content under html.js, so without this class everything stays readable
  doc.documentElement.classList.add('js');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, ctx) { return (ctx || doc).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); };
  var PH_HTML = function (name) { return '<mark class="ph" title="Dato da inserire">[' + name + ']</mark>'; };
  // One marker PER MODULE (data-init-<key>): a single shared data-init would let the
  // first module that touches an element lock every other module out of it. That is what
  // used to happen to the booking widget and the contact form, which also carry .reveal.
  var claim = function (el, key) {
    var a = 'data-init-' + key;
    if (!el || el.getAttribute(a) === '1') return false;
    el.setAttribute(a, '1');
    return true;
  };

  // Shared state for refresh()
  var waters = [];        // { resize, play }
  var stepsUpdaters = []; // functions
  var subnavUpdaters = []; // functions (percorsi sticky chips)
  var revealIO = null;    // the one IntersectionObserver of the reveal system
  var revealNet = false;  // safety-net sweep installed once per page
  var revealReady = false;

  /* ------------------------------------------------------------------
     Header + mobile navigation + mobile CTA bar
     ------------------------------------------------------------------ */
  function initHeader(root) {
    $$('.header', root).forEach(function (header) {
      if (!claim(header, 'header')) return;
      var toggle = $('.nav-toggle', header);
      var nav = $('.nav', header);
      var ticking = false;
      var onScroll = function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          header.classList.toggle('is-scrolled', window.scrollY > 24);
          ticking = false;
        });
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      if (toggle && nav) {
        // restoreFocus defaults to true: closing hides the panel, so a focused link would
        // disappear from the accessibility tree (WCAG 2.4.3). After a link activation we
        // let the browser move on to the target page instead.
        var setOpen = function (open, restoreFocus) {
          if (!open && restoreFocus !== false && nav.contains(doc.activeElement)) toggle.focus();
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
          toggle.setAttribute('aria-label', open ? 'Chiudi il menu' : 'Apri il menu');
          nav.classList.toggle('is-open', open);
          header.classList.toggle('is-open', open);
        };
        toggle.addEventListener('click', function () { setOpen(toggle.getAttribute('aria-expanded') !== 'true'); });
        $$('a', nav).forEach(function (a) { a.addEventListener('click', function () { setOpen(false, false); }); });
        doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
      }
    });

    // Mobile bottom bar: hidden while the hero (which already shows the same coral pill)
    // or the booking widget is on screen. One CTA at a time, coral budget intact.
    $$('.cta-bar', root).forEach(function (bar) {
      if (!claim(bar, 'ctabar')) return;
      if (!('IntersectionObserver' in window)) return;
      var heroEl = $('.hero', root);
      var book = $('.widget', root);
      var heroSeen = false, bookSeen = false;
      var sync = function () { bar.classList.toggle('is-hidden', heroSeen || bookSeen); };
      // Seed the state before the first observer callback, so the bar never flashes in
      if (heroEl) {
        var hr = heroEl.getBoundingClientRect();
        heroSeen = hr.bottom > 0 && hr.top < (window.innerHeight || doc.documentElement.clientHeight) * 0.65;
      }
      sync();
      if (heroEl) new IntersectionObserver(function (en) { heroSeen = en[0].isIntersecting; sync(); }, { threshold: 0.35 }).observe(heroEl);
      if (book) new IntersectionObserver(function (en) { bookSeen = en[0].isIntersecting; sync(); }, { threshold: 0.15 }).observe(book);
    });
  }

  /* ------------------------------------------------------------------
     Active nav item: if no link carries aria-current, derive it from the pathname
     ------------------------------------------------------------------ */
  function initNavActive(root) {
    $$('.nav__list', root).forEach(function (list) {
      if (!claim(list, 'nav')) return;
      var links = $$('a', list);
      if (!links.length) return;
      if (links.some(function (a) { return a.getAttribute('aria-current') === 'page'; })) return;
      var file = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
      links.forEach(function (a) {
        var href = (a.getAttribute('href') || '').split('#')[0].split('?')[0].split('/').pop().toLowerCase();
        if (href && href === file) a.setAttribute('aria-current', 'page');
      });
    });
  }

  /* ------------------------------------------------------------------
     Hero: word-by-word headline reveal
     ------------------------------------------------------------------ */
  function initHeadline(root) {
    $$('.hero', root).forEach(function (hero) {
      var h1 = $('h1', hero);
      if (!h1 || !claim(h1, 'headline')) return;
      var words = h1.textContent.trim().split(/\s+/);
      h1.textContent = '';
      words.forEach(function (w, i) {
        var span = doc.createElement('span');
        span.className = 'w';
        span.textContent = w;
        span.style.transitionDelay = (i * 40) + 'ms';
        h1.appendChild(span);
        if (i < words.length - 1) h1.appendChild(doc.createTextNode(' '));
      });
      var reveal = function () { hero.classList.add('is-in'); };
      if (doc.fonts && doc.fonts.ready) {
        var done = false;
        doc.fonts.ready.then(function () { if (!done) { done = true; reveal(); } });
        setTimeout(function () { if (!done) { done = true; reveal(); } }, 400);
      } else {
        setTimeout(reveal, 80);
      }
    });
  }

  /* ------------------------------------------------------------------
     Hero: living water surface (canvas 2D)
     ------------------------------------------------------------------ */
  function initWater(root) {
    $$('.hero', root).forEach(function (hero) {
      var canvas = $('.hero__canvas', hero);
      if (!canvas || !canvas.getContext || !claim(canvas, 'water')) return;
      var ctx = canvas.getContext('2d');
      if (!ctx) return;

      // DPR cap: 1.5 keeps phones cool without softening the crests
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var W = 0, H = 0, raf = 0, running = false, visible = true, start = performance.now();
      var caustic = doc.createElement('canvas');
      var cctx = caustic.getContext('2d');
      if (!cctx) return;
      var CS = 0.25; // caustics are rendered at quarter resolution then upscaled

      // Wave layers: amplitude, wavelength, speed, vertical position (0..1 of the shore
      // line), colour. The shore line is the top of the SVG separator, not the bottom of
      // the hero: anchored to H the two deepest layers were hidden behind that separator.
      var waveEl = hero.querySelector('.wave');
      var content = hero.querySelector('.hero__content');
      var shore = 0;
      // Right edge of the text column as a fraction of the width (measured on resize):
      // the bright caustics live beyond it, and the canvas is masked to 55% before it.
      var textEdge = 0.66;
      var layers = [
        // A far, almost transparent ripple above the fold
        { a: 8, k: 0.006, s: 0.0003, y: 0.68, c: 'rgba(169,220,243,0.085)' },
        { a: 12, k: 0.0045, s: 0.00045, y: 0.80, c: 'rgba(169,220,243,0.14)' },
        { a: 16, k: 0.0032, s: -0.00032, y: 0.86, c: 'rgba(44,143,203,0.22)' },
        { a: 20, k: 0.0024, s: 0.00026, y: 0.92, c: 'rgba(169,220,243,0.22)' },
        { a: 24, k: 0.0018, s: -0.0002, y: 0.98, c: 'rgba(20,92,142,0.55)' }
      ];
      var blobs = [];
      for (var i = 0; i < 12; i++) {
        // Nine bright caustics stay in the lagoon on the right of the text column; three
        // roam the whole width at a third of the intensity, so the light crosses the words
        var wide = i < 3;
        blobs.push({ x: Math.random(), wide: wide, y: 0.2 + Math.random() * 0.55, r: 0.15 + Math.random() * 0.225, sx: (Math.random() - 0.5) * 0.00004, sy: (Math.random() - 0.5) * 0.00003, p: Math.random() * Math.PI * 2 });
      }
      var lastW = 0, lastH = 0;

      function resize() {
        W = hero.clientWidth; H = hero.clientHeight;
        if (!W || !H) return; // hidden container (display:none): nothing to measure yet
        shore = H - (waveEl ? waveEl.offsetHeight : 0);
        if (content && W) {
          textEdge = Math.min(0.95, Math.max(0.3, (content.getBoundingClientRect().right - hero.getBoundingClientRect().left) / W));
        }
        lastW = W; lastH = H;
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        caustic.width = Math.max(2, Math.round(W * CS)); caustic.height = Math.max(2, Math.round(H * CS));
        draw(performance.now());
      }

      function waveY(layer, x, t) {
        return shore * layer.y
          + Math.sin(x * layer.k + t * layer.s) * layer.a
          + Math.sin(x * layer.k * 2.3 + t * layer.s * 1.7 + 1.3) * layer.a * 0.35
          + Math.cos(x * layer.k * 0.6 - t * layer.s * 0.8) * layer.a * 0.5;
      }

      function drawCaustics(t) {
        var cw = caustic.width, ch = caustic.height;
        cctx.setTransform(1, 0, 0, 1, 0, 0);
        cctx.clearRect(0, 0, cw, ch);
        cctx.globalCompositeOperation = 'lighter';
        // Static sunlight pocket, top right: a wide turquoise glow that reads as shallow
        // water lit from above. Same 'lighter' pass as the caustics.
        var gx = 0.84 * cw, gy = 0.26 * ch, gr = 0.62 * cw;
        var glow = cctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        glow.addColorStop(0, 'rgba(169,220,243,0.34)');
        glow.addColorStop(0.45, 'rgba(44,143,203,0.20)');
        glow.addColorStop(1, 'rgba(44,143,203,0)');
        cctx.fillStyle = glow;
        cctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
        // the bright band starts just past the text column, never left of 62%
        var bandMin = Math.min(0.72, Math.max(0.62, textEdge + 0.03));
        for (var i = 0; i < blobs.length; i++) {
          var b = blobs[i];
          var minX = b.wide ? 0 : bandMin, span = b.wide ? 1 : 1 - bandMin;
          var bx = minX + ((((b.x + Math.sin(t * 0.00012 + b.p) * 0.06 + t * b.sx) - minX) % span) + span) % span;
          var by = b.y + Math.cos(t * 0.0001 + b.p * 1.7) * 0.05 + Math.sin(t * b.sy * 40) * 0.02;
          var r = b.r * Math.max(cw, ch) * (0.85 + 0.15 * Math.sin(t * 0.0003 + b.p));
          var g = cctx.createRadialGradient(bx * cw, by * ch, 0, bx * cw, by * ch, r);
          if (b.wide) {
            g.addColorStop(0, 'rgba(242,247,250,0.21)');
            g.addColorStop(0.5, 'rgba(169,220,243,0.08)');
          } else {
            g.addColorStop(0, 'rgba(242,247,250,0.60)');
            g.addColorStop(0.5, 'rgba(169,220,243,0.22)');
          }
          g.addColorStop(1, 'rgba(44,143,203,0)');
          cctx.fillStyle = g;
          // Only the square the gradient actually covers
          cctx.fillRect(bx * cw - r, by * ch - r, r * 2, r * 2);
        }
        // Two masks (destination-in keeps alpha = dst x mask), so the light is bounded where
        // text sits: 55% left of the text column edge, and fading out under the header band.
        cctx.globalCompositeOperation = 'destination-in';
        var mx = cctx.createLinearGradient(0, 0, cw, 0);
        mx.addColorStop(0, 'rgba(0,0,0,0.55)');
        mx.addColorStop(Math.min(0.98, textEdge), 'rgba(0,0,0,0.55)');
        mx.addColorStop(Math.min(1, textEdge + 0.1), 'rgba(0,0,0,1)');
        cctx.fillStyle = mx;
        cctx.fillRect(0, 0, cw, ch);
        // 220 CSS px (header band plus a hand) expressed in the quarter-resolution canvas
        var topFade = Math.max(1, Math.min(ch, 220 * CS));
        var my = cctx.createLinearGradient(0, 0, 0, topFade);
        my.addColorStop(0, 'rgba(0,0,0,0)');
        my.addColorStop(1, 'rgba(0,0,0,1)');
        cctx.fillStyle = my;
        cctx.fillRect(0, 0, cw, ch);
        cctx.globalCompositeOperation = 'source-over';
      }

      function draw(now) {
        if (!W || !H) return;
        var t = now - start;
        ctx.clearRect(0, 0, W, H);
        // Caustics: a single lighter pass keeps the light readable without a milky double exposure
        drawCaustics(t);
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.drawImage(caustic, 0, 0, caustic.width, caustic.height, 0, 0, W, H);
        ctx.restore();
        // wave layers, from back to front
        var step = 8;
        for (var l = 0; l < layers.length; l++) {
          var layer = layers[l];
          ctx.beginPath();
          ctx.moveTo(0, H);
          for (var x = 0; x <= W + step; x += step) ctx.lineTo(x, waveY(layer, x, t));
          ctx.lineTo(W + step, H);
          ctx.closePath();
          ctx.fillStyle = layer.c;
          ctx.fill();
          // light reflection on the crest
          ctx.beginPath();
          for (var x2 = 0; x2 <= W + step; x2 += step) {
            var y2 = waveY(layer, x2, t) - 1.5;
            if (x2 === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
          }
          ctx.strokeStyle = 'rgba(242,247,250,' + (0.08 + 0.08 * (layers.length - l) / layers.length) + ')';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        // sparkles: anchored highlights that breathe in place
        for (var s = 0; s < 18; s++) {
          var sx = ((s * 137.5) % (W + 40)) - 20 + Math.sin(t * 0.0004 + s) * 12;
          var sl = layers[1 + (s % 2)];
          var sy = waveY(sl, sx, t) - 2;
          var alpha = 0.18 + 0.18 * Math.sin(t * 0.002 + s);
          if (alpha <= 0) continue;
          ctx.fillStyle = 'rgba(242,247,250,' + alpha.toFixed(3) + ')';
          ctx.beginPath();
          ctx.ellipse(sx, sy, 9 + (s % 4) * 3, 1.3, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      function loop(now) {
        if (!running) return;
        draw(now);
        raf = requestAnimationFrame(loop);
      }
      function play() {
        if (reduceMotion || running || doc.hidden || !visible) return;
        running = true; raf = requestAnimationFrame(loop);
      }
      function pause() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

      resize();
      // Debounced: mobile browsers fire resize while the address bar slides away
      var rT = 0;
      window.addEventListener('resize', function () {
        clearTimeout(rT);
        // 4px of slack so the mobile address bar sliding away does not retrigger a resize
        rT = setTimeout(function () {
          if (hero.clientWidth !== lastW || Math.abs(hero.clientHeight - lastH) > 4) resize();
        }, 150);
      });
      doc.addEventListener('visibilitychange', function () { if (doc.hidden) pause(); else play(); });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
          if (visible) play(); else pause();
        }, { threshold: 0 }).observe(hero);
      }
      play();
      waters.push({ resize: resize, play: play });
    });
  }

  /* ------------------------------------------------------------------
     Ripple on the hero CTA
     ------------------------------------------------------------------ */
  function initRipple(root) {
    $$('.hero .btn--primary', root).forEach(function (btn) {
      if (!claim(btn, 'ripple')) return;
      btn.addEventListener('click', function (e) {
        if (reduceMotion) return;
        var rect = btn.getBoundingClientRect();
        var size = Math.max(rect.width, rect.height) * 2.2;
        var r = doc.createElement('span');
        r.className = 'ripple';
        r.style.width = r.style.height = size + 'px';
        r.style.left = (e.clientX - rect.left - size / 2) + 'px';
        r.style.top = (e.clientY - rect.top - size / 2) + 'px';
        btn.appendChild(r);
        setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 850);
      });
    });
  }

  /* ------------------------------------------------------------------
     Scroll reveal (one observer for the whole document)
     ------------------------------------------------------------------ */
  function initReveal(root) {
    var items = $$('.reveal', root).filter(function (el) { return el.getAttribute('data-init-reveal') !== '1'; });
    if (!items.length) { revealReady = true; return; }
    if (!('IntersectionObserver' in window) || reduceMotion) {
      items.forEach(function (el) { el.setAttribute('data-init-reveal', '1'); el.classList.add('in-view'); });
      revealReady = true;
      return;
    }
    if (!revealIO) {
      revealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            revealIO.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    }
    revealReady = true;
    items.forEach(function (el) { el.setAttribute('data-init-reveal', '1'); revealIO.observe(el); });
    // Safety net: some embedded/emulated viewports never deliver IntersectionObserver
    // callbacks. Anything already inside the viewport gets revealed after a short delay
    // and on every scroll (throttled), so no text can stay invisible.
    if (!revealNet) {
      revealNet = true;
      var sweep = function () {
        var vh = window.innerHeight || doc.documentElement.clientHeight;
        $$('.reveal[data-init-reveal="1"]:not(.in-view)').forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.bottom > 0 && r.top < vh * 0.92) { el.classList.add('in-view'); if (revealIO) revealIO.unobserve(el); }
        });
      };
      var ticking = false;
      var onScroll = function () { if (ticking) return; ticking = true; requestAnimationFrame(function () { ticking = false; sweep(); }); };
      setTimeout(sweep, 1200);
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
    }
  }

  /* ------------------------------------------------------------------
     "In studio / Online" segmented control
     ------------------------------------------------------------------ */
  function initSegmented(root) {
    $$('.segmented', root).forEach(function (group) {
      if (!claim(group, 'segmented')) return;
      var buttons = $$('button', group);
      // Panels are looked up from the nearest section, so ids only need to be unique there
      var scope = group.closest('section, article, main') || root || doc;
      var panelFor = function (b) {
        var id = b.getAttribute('aria-controls');
        return id ? (scope.querySelector('#' + id) || doc.getElementById(id)) : null;
      };
      buttons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          buttons.forEach(function (b) {
            var active = b === btn;
            b.setAttribute('aria-pressed', active ? 'true' : 'false');
            var panel = panelFor(b);
            if (panel) {
              if (active) {
                panel.hidden = false;
                // restart the fade animation
                panel.style.animation = 'none';
                void panel.offsetWidth;
                panel.style.animation = '';
              } else {
                panel.hidden = true;
              }
            }
          });
        });
      });
    });
  }

  /* ------------------------------------------------------------------
     "Come funziona": SVG line drawn by scroll progress
     ------------------------------------------------------------------ */
  function initSteps(root) {
    $$('.steps', root).forEach(function (wrap) {
      if (!claim(wrap, 'steps')) return;
      var paths = $$('.steps__line .draw', wrap);
      var steps = $$('.step', wrap);
      if (!paths.length) return;
      if (reduceMotion) {
        paths.forEach(function (p) { p.style.strokeDashoffset = '0'; });
        steps.forEach(function (s) { s.classList.add('is-active'); });
        return;
      }
      var ticking = false;
      var update = function () {
        ticking = false;
        var rect = wrap.getBoundingClientRect();
        var vh = window.innerHeight || doc.documentElement.clientHeight;
        var startY = vh * 0.85;               // line starts drawing when the block enters here
        var span = Math.max(rect.height, 1) + vh * 0.35;
        var progress = Math.min(1, Math.max(0, (startY - rect.top) / span));
        paths.forEach(function (p) { p.style.strokeDashoffset = String(1 - progress); });
        steps.forEach(function (s, i) { s.classList.toggle('is-active', progress >= (i + 0.2) / steps.length); });
      };
      var onScroll = function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      update();
      stepsUpdaters.push(update);
    });
  }

  /* ------------------------------------------------------------------
     Sticky chip sub navigation (percorsi.html): marks the sheet on screen with
     aria-current="location" and keeps that chip visible in the scrollable strip
     ------------------------------------------------------------------ */
  function initSubnav(root) {
    $$('.subnav', root).forEach(function (nav) {
      if (!claim(nav, 'subnav')) return;
      var list = $('.subnav__list', nav);
      var pairs = [];
      $$('a[href^="#"]', nav).forEach(function (a) {
        var target = doc.getElementById(a.getAttribute('href').slice(1));
        if (target) pairs.push({ a: a, t: target });
      });
      if (!pairs.length) return;
      var current = null;
      var setCurrent = function (p) {
        if (p === current) return;
        current = p;
        pairs.forEach(function (x) {
          if (x === p) x.a.setAttribute('aria-current', 'location');
          else x.a.removeAttribute('aria-current');
        });
        // On a phone the strip scrolls: bring the active chip towards the middle
        if (p && list && list.scrollWidth > list.clientWidth + 4) {
          var left = p.a.offsetLeft - (list.clientWidth - p.a.offsetWidth) / 2;
          try { list.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? 'auto' : 'smooth' }); }
          catch (e) { list.scrollLeft = Math.max(0, left); }
        }
      };
      var ticking = false;
      var update = function () {
        ticking = false;
        var line = nav.getBoundingClientRect().bottom + 48;
        var active = null;
        for (var i = 0; i < pairs.length; i++) {
          var r = pairs[i].t.getBoundingClientRect();
          if (r.top <= line && r.bottom > line) { active = pairs[i]; break; }
        }
        if (active) { setCurrent(active); return; }
        // Above the first sheet or below the last one: no chip is current.
        // In the gaps between two sheets the previous chip is kept.
        var first = pairs[0].t.getBoundingClientRect();
        var last = pairs[pairs.length - 1].t.getBoundingClientRect();
        if (first.top > line || last.bottom <= line) setCurrent(null);
      };
      var onScroll = function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      update();
      subnavUpdaters.push(update);
    });
  }

  /* ------------------------------------------------------------------
     FAQ: animated <details>
     ------------------------------------------------------------------ */
  function initFaq(root) {
    $$('details.faq', root).forEach(function (d) {
      var summary = $('summary', d);
      var body = $('.faq__body', d);
      if (!summary || !body || !claim(d, 'faq')) return;
      if (d.open) d.classList.add('is-open');
      summary.addEventListener('click', function (e) {
        e.preventDefault();
        var clearPending = function () {
          if (d._finish) { body.removeEventListener('transitionend', d._finish); d._finish = null; }
          if (d._closeTimer) { clearTimeout(d._closeTimer); d._closeTimer = 0; }
        };
        if (d.classList.contains('is-open')) {
          clearPending();
          d.classList.remove('is-open');
          var finish = function () {
            // a reopen may have happened while the closing transition was running
            if (d.classList.contains('is-open')) { clearPending(); return; }
            clearPending();
            d.open = false;
          };
          d._finish = finish;
          body.addEventListener('transitionend', finish);
          d._closeTimer = setTimeout(finish, 500);
        } else {
          clearPending();
          d.open = true;
          requestAnimationFrame(function () { requestAnimationFrame(function () { d.classList.add('is-open'); }); });
        }
      });
    });
  }

  /* ------------------------------------------------------------------
     Booking widget (demo of the Cal.com flow). All lookups are scoped to the widget.
     ------------------------------------------------------------------ */
  function initBooking(root) {
    $$('.widget', root).forEach(function (widget) {
      if (!claim(widget, 'booking')) return;
      var panels = $$('.widget__panel', widget);
      var stepItems = $$('.widget__steps li', widget);
      var daysEl = $('.days', widget);
      var slotsEl = $('.slots', widget);
      var state = { day: null, slot: null };
      var fmtDay = new Intl.DateTimeFormat('it-IT', { weekday: 'short' });
      var fmtMonth = new Intl.DateTimeFormat('it-IT', { month: 'short' });
      var fmtLong = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
      // The summary may sit outside the widget (aside): look it up in the nearest section
      var scope = widget.closest('section, main') || root || doc;
      // Elements are matched by data attribute first, then by the v1 ids (f-name, err-name, s-when ...)
      var field = function (name) { return $('[data-field="' + name + '"]', widget) || $('#f-' + name, widget); };
      var err = function (name) { return $('[data-err="' + name + '"]', widget) || $('#err-' + name, widget); };
      var out = function (name) { return $('[data-summary="' + name + '"]', scope) || $('#s-' + name, scope); };
      var errStep2 = err('step2');

      // Timezone note
      var tz = $('[data-tz]', widget) || $('#tz', widget);
      try {
        var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz && zone) tz.textContent = zone;
      } catch (e) { /* keep placeholder */ }

      function goTo(n) {
        panels.forEach(function (p) { p.hidden = String(p.getAttribute('data-panel')) !== String(n); });
        stepItems.forEach(function (li) {
          var s = Number(li.getAttribute('data-step'));
          if (s === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
          li.classList.toggle('is-done', s < n);
        });
        var panel = $('[data-panel="' + n + '"]', widget);
        var heading = panel && $('h3', panel);
        if (heading) heading.focus({ preventScroll: true });
        var top = widget.getBoundingClientRect().top;
        // Measure the header itself instead of converting the token: --header-h is in rem and
        // parseFloat would drop the unit, so an enlarged root font size would still hide the
        // step title behind the fixed header.
        var headerEl = doc.querySelector('.header');
        var hh = headerEl ? headerEl.getBoundingClientRect().height : 72;
        if (top < hh) window.scrollTo({ top: window.scrollY + top - (hh + 18), behavior: reduceMotion ? 'auto' : 'smooth' });
      }

      function selected(name) { return $('input[name="' + name + '"]:checked', widget); }

      function updateSummary() {
        var svc = selected('service');
        var mode = selected('mode');
        var sService = out('service'), sMode = out('mode'), sWhen = out('when'), sBal = out('balance');
        if (sService && svc) sService.textContent = svc.getAttribute('data-label');
        if (sMode && mode) sMode.textContent = mode.getAttribute('data-label') + (mode.value === 'online' ? ' (Google Meet)' : '');
        if (sBal) sBal.innerHTML = PH_HTML('SALDO') + (mode && mode.value === 'online' ? ' con bonifico dopo la visita' : ' in studio al termine della visita');
        if (sWhen) {
          if (state.day && state.slot) sWhen.textContent = capitalize(fmtLong.format(state.day)) + ', ore ' + state.slot;
          else sWhen.innerHTML = '<span class="muted">Da scegliere</span>';
        }
      }
      function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

      // Deterministic pseudo-random availability, so the demo feels real but stable
      function seeded(n) { var x = Math.sin(n * 9301 + 49297) * 233280; return x - Math.floor(x); }
      function slotsFor(date) {
        var dow = date.getDay();
        if (dow === 0) return [];
        var base = dow === 6 ? ['9:00', '9:45', '10:30', '11:15', '12:00'] : ['9:00', '9:45', '10:30', '11:15', '12:00', '14:30', '15:15', '16:00', '16:45', '17:30', '18:15'];
        var key = date.getDate() + date.getMonth() * 31;
        return base.filter(function (s, i) { return seeded(key + i) > 0.35; });
      }

      function renderDays() {
        if (!daysEl) return;
        daysEl.innerHTML = '';
        var today = new Date(); today.setHours(0, 0, 0, 0);
        for (var i = 1; i <= 14; i++) {
          var d = new Date(today); d.setDate(today.getDate() + i);
          var btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = 'day';
          btn.setAttribute('aria-pressed', 'false');
          var sunday = d.getDay() === 0;
          btn.innerHTML = '<span class="d">' + fmtDay.format(d).replace('.', '') + '</span><span class="dn">' + d.getDate() + '</span><span class="m">' + fmtMonth.format(d).replace('.', '') + '</span>';
          btn.setAttribute('aria-label', capitalize(fmtLong.format(d)) + (sunday ? ', non disponibile' : ''));
          if (sunday) btn.disabled = true;
          (function (date, el) {
            el.addEventListener('click', function () {
              state.day = date; state.slot = null;
              $$('.day', daysEl).forEach(function (b) { b.setAttribute('aria-pressed', b === el ? 'true' : 'false'); });
              renderSlots();
              updateSummary();
              if (errStep2) errStep2.textContent = '';
            });
          })(d, btn);
          daysEl.appendChild(btn);
        }
      }

      // Screen readers get told what happened to the slot list, not just sighted users
      function announceSlots(list) {
        var st = $('[data-slots-status]', widget) || $('#slots-status', widget);
        if (!st) return;
        if (!state.day) { st.textContent = ''; return; }
        var when = capitalize(fmtLong.format(state.day));
        st.textContent = list.length ? list.length + ' orari disponibili per ' + when : 'Nessun orario disponibile per ' + when;
      }

      function renderSlots() {
        if (!slotsEl) return;
        slotsEl.innerHTML = '';
        if (!state.day) {
          slotsEl.innerHTML = '<p class="slots__empty">Scegli prima un giorno.</p>';
          announceSlots([]);
          return;
        }
        var list = slotsFor(state.day);
        if (!list.length) {
          slotsEl.innerHTML = '<p class="slots__empty">Nessuna disponibilità in questo giorno. Prova il giorno successivo.</p>';
          announceSlots(list);
          return;
        }
        announceSlots(list);
        list.forEach(function (s) {
          var b = doc.createElement('button');
          b.type = 'button'; b.className = 'slot'; b.textContent = s;
          b.setAttribute('aria-pressed', 'false');
          b.addEventListener('click', function () {
            state.slot = s;
            $$('.slot', slotsEl).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
            updateSummary();
            if (errStep2) errStep2.textContent = '';
          });
          slotsEl.appendChild(b);
        });
      }

      // Navigation buttons
      $$('[data-next]', widget).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var target = Number(btn.getAttribute('data-next'));
          if (target === 3 && !(state.day && state.slot)) {
            if (errStep2) errStep2.textContent = 'Scegli un giorno e un orario per continuare.';
            return;
          }
          goTo(target);
        });
      });
      $$('[data-prev]', widget).forEach(function (btn) {
        btn.addEventListener('click', function () { goTo(Number(btn.getAttribute('data-prev'))); });
      });
      $$('input[name="service"], input[name="mode"]', widget).forEach(function (input) {
        input.addEventListener('change', updateSummary);
      });

      // Step 3: validation + confirmation
      var form = $('form.widget__panel', widget);
      var consentIds = ['privacy', 'consenso', 'condizioni'];
      var consentBox = function (k) { return $('[data-consent="' + k + '"]', widget) || $('#c-' + k, widget); };
      if (form) {
        var setErr = function (input, msgEl, msg) {
          if (msgEl) msgEl.textContent = msg || '';
          if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        };
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var name = field('name'), email = field('email');
          var ok = true, first = null;
          if (name) {
            if (!name.value.trim()) { setErr(name, err('name'), 'Serve questo dato per completare la prenotazione.'); ok = false; first = first || name; }
            else setErr(name, err('name'), '');
          }
          var ev = email ? email.value.trim() : '';
          if (email) {
            if (!ev) { setErr(email, err('email'), 'Serve questo dato per completare la prenotazione.'); ok = false; first = first || email; }
            else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ev)) { setErr(email, err('email'), 'Controlla l\'indirizzo email, sembra incompleto.'); ok = false; first = first || email; }
            else setErr(email, err('email'), '');
          }
          var boxes = consentIds.map(consentBox).filter(Boolean);
          var missing = boxes.filter(function (b) { return !b.checked; });
          boxes.forEach(function (b) { b.setAttribute('aria-invalid', missing.indexOf(b) > -1 ? 'true' : 'false'); });
          var errC = err('consent');
          // Only these three boxes are required. The fourth one (#c-note-salute, art. 9.2 a
          // GDPR for the free-text note) is optional and stays out of consentIds on purpose.
          if (missing.length) { if (errC) errC.textContent = 'Per prenotare una visita medica servono le tre conferme obbligatorie: spunta le caselle mancanti.'; ok = false; first = first || missing[0]; }
          else if (errC) errC.textContent = '';
          if (!ok) { if (first) first.focus(); return; }
          var doneEmail = $('[data-done-email]', widget) || $('#done-email', widget);
          if (doneEmail) {
            // the typed address replaces the placeholder mark; the mark comes back if it is empty
            if (ev) doneEmail.textContent = ev; else doneEmail.innerHTML = PH_HTML('EMAIL PAZIENTE');
          }
          goTo(4);
        });
        ['name', 'email'].forEach(function (k) {
          var el = field(k);
          if (el) el.addEventListener('input', function () { el.setAttribute('aria-invalid', 'false'); var m = err(k); if (m) m.textContent = ''; });
        });
        consentIds.forEach(function (k) {
          var el = consentBox(k);
          if (el) el.addEventListener('change', function () {
            if (el.checked) el.setAttribute('aria-invalid', 'false');
            var still = consentIds.map(consentBox).filter(function (b) { return b && !b.checked; });
            var errC = err('consent');
            if (!still.length && errC) errC.textContent = '';
          });
        });
      }
      var reset = $('[data-reset]', widget) || $('#done-reset', widget);
      if (reset) {
        reset.addEventListener('click', function () {
          state.day = null; state.slot = null;
          if (form) form.reset();
          ['name', 'email', 'consent', 'step2'].forEach(function (k) { var m = err(k); if (m) m.textContent = ''; });
          ['name', 'email'].forEach(function (k) { var el = field(k); if (el) el.setAttribute('aria-invalid', 'false'); });
          consentIds.forEach(function (k) { var el = consentBox(k); if (el) el.setAttribute('aria-invalid', 'false'); });
          var de = $('[data-done-email]', widget) || $('#done-email', widget);
          if (de) de.innerHTML = PH_HTML('EMAIL PAZIENTE');
          if (daysEl) $$('.day', daysEl).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
          renderSlots();
          updateSummary();
          goTo(1);
          window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        });
      }

      renderDays();
      renderSlots();
      updateSummary();
    });
  }

  /* ------------------------------------------------------------------
     Contact form (demo): validates, shows a confirmation, never sends.
     Markup: <form class="form form--contact" novalidate data-demo="contact">
       .field > input/textarea/select with [required] and a sibling .field__err
       (matched by data-err="<name>" or id err-<name>), .consent checkbox [required],
       .form__status[aria-live], .form__done[hidden] with an h3 to focus.
     ------------------------------------------------------------------ */
  function initContactForm(root) {
    $$('form[data-demo="contact"], form.form--contact', root).forEach(function (form) {
      if (!claim(form, 'contact')) return;
      var status = $('.form__status', form);
      var done = $('.form__done', form);
      var body = $('.form__body', form);
      var errFor = function (ctrl) {
        var name = ctrl.getAttribute('name') || ctrl.id;
        return $('[data-err="' + name + '"]', form) || (ctrl.id ? $('#err-' + ctrl.id.replace(/^f-/, ''), form) : null) || (ctrl.closest('.field') && $('.field__err', ctrl.closest('.field')));
      };
      var setErr = function (ctrl, msg) {
        var m = errFor(ctrl);
        if (m) m.textContent = msg || '';
        ctrl.setAttribute('aria-invalid', msg ? 'true' : 'false');
      };
      var controls = $$('input, textarea, select', form);
      controls.forEach(function (c) {
        var ev = c.type === 'checkbox' || c.tagName === 'SELECT' ? 'change' : 'input';
        c.addEventListener(ev, function () { setErr(c, ''); if (status) status.textContent = ''; });
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var first = null;
        controls.forEach(function (c) {
          if (!c.required) return;
          var msg = '';
          if (c.type === 'checkbox') {
            if (!c.checked) msg = 'Per ricevere una risposta serve il consenso al trattamento dei dati.';
          } else if (!c.value.trim()) {
            msg = 'Serve questo dato per inviare il messaggio.';
          } else if (c.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.value.trim())) {
            msg = 'Controlla l\'indirizzo email, sembra incompleto.';
          }
          setErr(c, msg);
          if (msg && !first) first = c;
        });
        if (first) {
          if (status) status.textContent = 'Controlla i campi segnalati e riprova.';
          first.focus();
          return;
        }
        if (status) status.textContent = '';
        // Demo: nothing leaves the browser. Show the confirmation in place of the fields.
        if (body) body.hidden = true;
        if (done) {
          done.hidden = false;
          var h = $('h3, h2', done);
          if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
        }
      });
      var again = $('[data-form-reset]', form);
      if (again) again.addEventListener('click', function () {
        form.reset();
        controls.forEach(function (c) { setErr(c, ''); });
        if (done) done.hidden = true;
        if (body) { body.hidden = false; var f = $('input, textarea, select', body); if (f) f.focus(); }
      });
    });
  }

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */
  var MODULES = [initHeader, initNavActive, initHeadline, initWater, initRipple, initReveal, initSegmented, initSteps, initSubnav, initFaq, initBooking, initContactForm];

  function init(root) {
    root = root || doc;
    // Safety net: the page must never stay hidden behind the reveal rules. The hero branch
    // depends on document.fonts, so it always runs; the .reveal branch fires only if the
    // observer never started, otherwise it would cancel the scroll choreography.
    setTimeout(function () {
      $$('.hero', root).forEach(function (h) { h.classList.add('is-in'); });
      if (revealReady) return;
      $$('.reveal', root).forEach(function (el) { el.classList.add('in-view'); });
    }, 2500);
    // One failing module must not take the others down with it
    MODULES.forEach(function (f) {
      try { f(root); } catch (e) { if (window.console && window.console.error) window.console.error(e); }
    });
  }

  // For the preview bundler: a page shown after init has zero-size heroes and reveal
  // targets that never intersected. Re-measure and re-observe.
  function refresh() {
    waters.forEach(function (w) { try { w.resize(); w.play(); } catch (e) { /* noop */ } });
    stepsUpdaters.forEach(function (u) { try { u(); } catch (e) { /* noop */ } });
    subnavUpdaters.forEach(function (u) { try { u(); } catch (e) { /* noop */ } });
    if (revealIO) {
      $$('.reveal[data-init-reveal="1"]:not(.in-view)').forEach(function (el) { revealIO.unobserve(el); revealIO.observe(el); });
    }
    // Late safety net for a page shown after the first one already elapsed
    setTimeout(function () {
      $$('.hero').forEach(function (h) { h.classList.add('is-in'); });
      $$('.reveal:not(.in-view)').forEach(function (el) {
        var r = el.getBoundingClientRect();
        var vh = window.innerHeight || doc.documentElement.clientHeight;
        if (r.bottom > 0 && r.top < vh) el.classList.add('in-view');
      });
    }, 1200);
  }

  window.BodiniSite = { init: init, refresh: refresh, version: '2.0.0' };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { init(doc); });
  else init(doc);
})();
