(function () {
  'use strict';

  // ===== 常量 =====
  var GLYPH_POOL = '氢氦锂铍硼碳氮氧氟氖钠镁铝硅磷硫氯氩钾钙钪钛钒铬锰铁钴镍铜锌镓锗砷硒溴氪铷锶钇锆铌钼锝钌铑钯银镉铟锡锑碲碘氙铯钡镧铈镨钕钷钐铕钆铽镝钬铒铥镱镥铪钽钨铼锇铱铂金汞铊铅铋钋砹氡钫镭锕钍镤铀镎钚镅锔锫锎锿镄钔锘铹镆';
  var RAIN_HIRAGANA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
  var RAIN_KATAKANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
  var RAIN_KANJI = '夢幻影霧雨雪風雲霜露光闇夜朝夕刻時空星月花鳥山水海森火炎土石心魂記憶物語終始永遠無常';
  var RAIN_BAND_START = 10;
  var RAIN_BAND_END = 86;
  var GLYPH_SLOT_COUNT = 3;
  var TRAIL_DOT_COUNT = 8;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ===== 状态 =====
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mobileQuery = window.matchMedia('(max-width: 720px)');
  var currentTheme = null;          // 'custom' | 'other'
  var layerRoot = null;

  var threadEl = null;
  var threadPathEl = null;
  var trailEl = null;
  var trailDots = [];
  var trailStarted = false;
  var trailScheduled = false;
  var pointerX, pointerY, headX, headY;
  var scrollScheduled = false;

  // 监听去重标志（跨主题切换保留）
  var scrollBound = false;
  var visibilityBound = false;
  var trailMoveBound = false;
  var layoutObserverBound = false;
  var layoutScheduled = false;
  var layoutObserver = null;
  var layoutResizeObserver = null;

  // ===== 工具函数 =====
  function pickChar(pool) { return pool.charAt(Math.floor(Math.random() * pool.length)); }

  function randomRainChar() {
    var roll = Math.random() * 9;
    if (roll < 5) return pickChar(RAIN_HIRAGANA);
    if (roll < 6) return pickChar(RAIN_KATAKANA);
    return pickChar(RAIN_KANJI);
  }

  function randomGlyphRun(length) {
    var out = '';
    for (var i = 0; i < length; i++) out += randomRainChar();
    return out;
  }

  function isCustomActive() {
    return document.body.classList.contains('theme-custom');
  }

  function isMobile() { return mobileQuery.matches; }

  function ensureLayerRoot() {
    if (layerRoot && layerRoot.parentNode) return;
    layerRoot = document.createElement('div');
    layerRoot.id = 'elecide-overlay-root';
    document.body.appendChild(layerRoot);
  }

  function clearLayerDOM() {
    if (layerRoot && layerRoot.parentNode) {
      layerRoot.parentNode.removeChild(layerRoot);
    }
    layerRoot = null;
    trailDots = [];
    trailStarted = false;
    trailScheduled = false;
    trailEl = null;
    threadEl = null;
    threadPathEl = null;
  }

  function destroyLayers() {
    clearLayerDOM();

    if (trailMoveBound) {
      window.removeEventListener('mousemove', onPointerMove);
      trailMoveBound = false;
    }
    if (layoutObserver) {
      layoutObserver.disconnect();
      layoutObserver = null;
    }
    if (layoutResizeObserver) {
      layoutResizeObserver.disconnect();
      layoutResizeObserver = null;
    }
    layoutObserverBound = false;
  }

  // ===== 红雨 =====
  function buildRain() {
    var el = document.createElement('div');
    el.className = 'elecide-rain elecide-layer';
    el.id = 'elecide-rain';

    var columnCount = isMobile() ? 3 : 5;
    var bandWidth = (RAIN_BAND_END - RAIN_BAND_START) / columnCount;

    for (var c = 0; c < columnCount; c++) {
      var col = document.createElement('div');
      col.className = 'elecide-rain-col';

      var left = RAIN_BAND_START + bandWidth * c + Math.random() * bandWidth * 0.85;
      var duration = 26 + Math.random() * 22;
      var fontSize = 13 + Math.random() * 8;

      col.style.left = left + 'vw';
      col.style.opacity = (0.04 + Math.random() * 0.025).toFixed(3);
      col.style.setProperty('--dur', duration.toFixed(2) + 's');
      col.style.setProperty('--delay', (-Math.random() * duration).toFixed(2) + 's');
      col.style.setProperty('--fs', fontSize.toFixed(1) + 'px');

      var track = document.createElement('div');
      track.className = 'elecide-rain-track';

      var stripText = randomGlyphRun(64);
      for (var k = 0; k < 2; k++) {
        var strip = document.createElement('span');
        strip.className = 'elecide-rain-strip';
        strip.textContent = stripText;
        track.appendChild(strip);
      }

      col.appendChild(track);
      el.appendChild(col);
    }

    layerRoot.appendChild(el);
  }

  // ===== 左右悬浮汉字 =====
  function randomGlyphSize() {
    return isMobile() ? 24 + Math.random() * 14 : 40 + Math.random() * 32;
  }
  function randomGlyphMotion(inwardSign) {
    var distance = isMobile() ? 3 + Math.random() * 9 : 6 + Math.random() * 30;
    return {
      dx: (inwardSign * distance).toFixed(1) + 'px',
      dy: (-(10 + Math.random() * 38)).toFixed(1) + 'px',
      rot: (Math.random() * 18 - 9).toFixed(1) + 'deg',
      rotEnd: (Math.random() * 22 - 11).toFixed(1) + 'deg'
    };
  }
  function placeFloatGlyph(glyph, slotIndex, inwardSign) {
    var slotHeight = 100 / GLYPH_SLOT_COUNT;
    glyph.style.top = (slotIndex * slotHeight + Math.random() * (slotHeight - 16)).toFixed(2) + 'vh';
    glyph.textContent = pickChar(GLYPH_POOL);
    var motion = randomGlyphMotion(inwardSign);
    glyph.style.setProperty('--dx', motion.dx);
    glyph.style.setProperty('--dy', motion.dy);
    glyph.style.setProperty('--rot', motion.rot);
    glyph.style.setProperty('--rot-end', motion.rotEnd);
  }
  function createFloatGlyph(layerEl, slotIndex, inwardSign) {
    var glyph = document.createElement('span');
    glyph.className = 'elecide-float-glyph';
    glyph.dataset.slot = slotIndex;
    glyph.dataset.inward = inwardSign;
    glyph.style.fontSize = randomGlyphSize().toFixed(1) + 'px';
    glyph.style.setProperty('--dur', (11 + Math.random() * 9).toFixed(2) + 's');
    glyph.style.setProperty('--peak', (0.07 + Math.random() * 0.07).toFixed(3));
    glyph.style.animationDelay = (-Math.random() * 18).toFixed(2) + 's';
    placeFloatGlyph(glyph, slotIndex, inwardSign);
    glyph.addEventListener('animationiteration', function () {
      placeFloatGlyph(this, Number(this.dataset.slot), Number(this.dataset.inward));
    });
    layerEl.appendChild(glyph);
  }
  function buildGlyphs() {
    var left = document.createElement('div');
    left.className = 'elecide-glyph-layer elecide-glyph-layer--left elecide-layer';
    for (var s = 0; s < GLYPH_SLOT_COUNT; s++) createFloatGlyph(left, s, 1);
    layerRoot.appendChild(left);

    var right = document.createElement('div');
    right.className = 'elecide-glyph-layer elecide-glyph-layer--right elecide-layer';
    for (var t = 0; t < GLYPH_SLOT_COUNT; t++) createFloatGlyph(right, t, -1);
    layerRoot.appendChild(right);
  }

  // ===== 左侧红线 thread =====
  function buildThread() {
    var wrap = document.createElementNS(SVG_NS, 'svg');
    wrap.setAttribute('class', 'elecide-thread elecide-layer');
    wrap.setAttribute('id', 'elecide-thread');
    wrap.setAttribute('viewBox', '0 0 100 1000');
    wrap.setAttribute('preserveAspectRatio', 'none');

    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'elecide-thread__path');
    path.setAttribute('id', 'elecide-thread-path');
    path.setAttribute('d', 'M50 0 L50 1000');

    wrap.appendChild(path);
    layerRoot.appendChild(wrap);

    threadEl = wrap;
    threadPathEl = path;

    var points = [[50, 0]];
    var y = 0;
    while (y < 1000) {
      y += 55 + Math.random() * 110;
      if (y > 1000) y = 1000;
      points.push([10 + Math.random() * 80, y]);
    }
    var d = points.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    }).join(' ');
    path.setAttribute('d', d);
  }

  // ===== 滚动进度（自动识别滚动容器） =====
  function getScrollProgress() {
    var scroller = document.getElementById('mainContainer');
    if (scroller) {
      var cs = window.getComputedStyle(scroller);
      var innerScroll = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
                        scroller.scrollHeight > scroller.clientHeight + 1;
      if (innerScroll) {
        var max = scroller.scrollHeight - scroller.clientHeight;
        return max > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / max)) : 1;
      }
    }
    var doc = document.scrollingElement || document.documentElement;
    var maxDoc = doc.scrollHeight - doc.clientHeight;
    return maxDoc > 0 ? Math.min(1, Math.max(0, doc.scrollTop / maxDoc)) : 1;
  }

  function updateThreadReveal() {
    if (!threadEl) return;
    var progress = getScrollProgress();
    threadEl.style.clipPath = 'inset(0 0 ' + ((1 - progress) * 100).toFixed(2) + '% 0)';
  }

  function scheduleLayoutRefresh() {
    if (layoutScheduled) return;
    layoutScheduled = true;
    window.requestAnimationFrame(function () {
      layoutScheduled = false;
      if (isCustomActive()) updateThreadReveal();
    });
  }

  // ===== 颗粒噪点 =====
  function buildGrain() {
    var el = document.createElement('div');
    el.className = 'elecide-grain elecide-layer';
    layerRoot.appendChild(el);
  }

  // ===== 扫描线 =====
  function buildScanlines() {
    var el = document.createElement('div');
    el.className = 'elecide-scanlines elecide-layer';
    el.id = 'elecide-scanlines';

    var svgHeight = 1100;
    var svgWidth = 4;
    var rects = [];
    var y = 0;
    while (y < svgHeight) {
      var lineHeight = Math.random() < 0.18 ? 2 : 1;
      var opacity = (0.015 + Math.random() * 0.06).toFixed(3);
      rects.push(
        '<rect x="0" y="' + y +
        '" width="' + svgWidth +
        '" height="' + lineHeight +
        '" fill="rgba(255,255,255,' + opacity + ')"/>'
      );
      y += lineHeight + Math.random() * 5.5 + (Math.random() < 0.04 ? Math.random() * 14 : 0);
    }
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + svgWidth +
      '" height="' + svgHeight + '">' + rects.join('') + '</svg>';
    el.style.backgroundImage =
      'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
    el.style.backgroundSize = svgWidth + 'px ' + svgHeight + 'px';
    el.style.backgroundPosition = '0 ' + Math.floor(Math.random() * svgHeight) + 'px';
    el.style.opacity = (0.55 + Math.random() * 0.25).toFixed(2);

    layerRoot.appendChild(el);
  }

  // ===== CRT / 暗角 =====
  function buildCrt() {
    var el = document.createElement('div');
    el.className = 'elecide-crt elecide-layer';
    layerRoot.appendChild(el);
  }
  function buildVignette() {
    var el = document.createElement('div');
    el.className = 'elecide-vignette elecide-layer';
    layerRoot.appendChild(el);
  }

  // ===== 鼠标拖尾 =====
  function onPointerMove(e) {
    pointerX = e.clientX;
    pointerY = e.clientY;
    if (!trailStarted) {
      trailStarted = true;
      headX = pointerX; headY = pointerY;
      trailDots.forEach(function (d) { d.x = pointerX; d.y = pointerY; });
    }
    scheduleTrailTick();
  }

  function initTrail() {
    if (prefersReducedMotion) return;
    trailEl = document.createElement('div');
    trailEl.className = 'elecide-trail elecide-layer';
    trailEl.id = 'elecide-trail';
    layerRoot.appendChild(trailEl);

    pointerX = window.innerWidth / 2;
    pointerY = window.innerHeight / 2;
    headX = pointerX;
    headY = pointerY;

    for (var i = 0; i < TRAIL_DOT_COUNT; i++) {
      var dotEl = document.createElement('div');
      dotEl.className = 'elecide-trail__dot';
      var size = 9 - i * 0.72;
      dotEl.style.width = size + 'px';
      dotEl.style.height = size + 'px';
      dotEl.style.opacity = (0.85 - i * 0.085).toFixed(3);
      dotEl.style.transform = 'translate3d(-100px,-100px,0) translate(-50%,-50%)';
      trailEl.appendChild(dotEl);
      trailDots.push({ el: dotEl, x: -100, y: -100 });
    }

    if (!trailMoveBound) {
      window.addEventListener('mousemove', onPointerMove, { passive: true });
      trailMoveBound = true;
    }
  }

  function scheduleTrailTick() {
    if (prefersReducedMotion || trailScheduled) return;
    trailScheduled = true;
    window.requestAnimationFrame(trailTick);
  }
  function trailTick() {
    var isMoving = Math.abs(pointerX - headX) + Math.abs(pointerY - headY) > 0.2;
    headX += (pointerX - headX) * 0.22;
    headY += (pointerY - headY) * 0.22;
    var cursorX = headX, cursorY = headY;
    for (var i = 0; i < trailDots.length; i++) {
      var d = trailDots[i];
      var dx = cursorX - d.x, dy = cursorY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.2) isMoving = true;
      d.x += dx * 0.42;
      d.y += dy * 0.42;
      d.el.style.transform =
        'translate3d(' + d.x.toFixed(1) + 'px,' + d.y.toFixed(1) + 'px,0) translate(-50%,-50%)';
      cursorX = d.x; cursorY = d.y;
    }
    if (isMoving) window.requestAnimationFrame(trailTick);
    else trailScheduled = false;
  }

  // ===== 滚动监听 =====
  function onScrollTick() {
    updateThreadReveal();
    scrollScheduled = false;
  }

  function initScroll() {
    if (scrollBound) return;
    var handler = function () {
      if (scrollScheduled) return;
      scrollScheduled = true;
      window.requestAnimationFrame(onScrollTick);
    };
    window.addEventListener('scroll', handler, { passive: true });
    var scroller = document.getElementById('mainContainer');
    if (scroller) scroller.addEventListener('scroll', handler, { passive: true });
    scrollBound = true;
  }

  // ===== 可见性 =====
  function initVisibility() {
    if (visibilityBound) return;
    document.addEventListener('visibilitychange', function () {
      document.body.classList.toggle('is-paused', document.hidden && isCustomActive());
    });
    visibilityBound = true;
  }

  // ===== 布局变化监听 =====
  function initLayoutObservers() {
    if (layoutObserverBound) return;
    layoutObserverBound = true;

    window.addEventListener('load', scheduleLayoutRefresh, { passive: true });

    if (typeof MutationObserver !== 'undefined') {
      layoutObserver = new MutationObserver(scheduleLayoutRefresh);
      var target = document.getElementById('mainContainer') || document.body;
      layoutObserver.observe(target, { childList: true, subtree: true });
    }

    if (typeof ResizeObserver !== 'undefined') {
      layoutResizeObserver = new ResizeObserver(scheduleLayoutRefresh);
      var scroller = document.getElementById('mainContainer');
      if (scroller) {
        layoutResizeObserver.observe(scroller);
        for (var i = 0; i < scroller.children.length; i++) {
          layoutResizeObserver.observe(scroller.children[i]);
        }
      }
      layoutResizeObserver.observe(document.body);
      var doc = document.scrollingElement || document.documentElement;
      if (doc) layoutResizeObserver.observe(doc);
    }

    var delays = [0, 80, 320, 800];
    for (var d = 0; d < delays.length; d++) {
      window.setTimeout(scheduleLayoutRefresh, delays[d]);
    }
  }

  // ===== Resize =====
  var resizeTimer = null;
  function onResize() {
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      if (!isCustomActive()) return;
      if (layerRoot) {
        clearLayerDOM();
        buildAllLayers();
        updateThreadReveal();
        scheduleLayoutRefresh();
      }
    }, 200);
  }

  // ===== 构建所有叠加层 =====
  function buildAllLayers() {
    ensureLayerRoot();
    buildRain();
    buildGlyphs();
    buildThread();
    buildGrain();
    buildScanlines();
    buildCrt();
    buildVignette();
    initTrail();
  }

  // ===== 主题切换 =====
  function syncWithTheme() {
    var nowCustom = isCustomActive();
    if (nowCustom && currentTheme !== 'custom') {
      buildAllLayers();
      initScroll();
      initVisibility();
      initLayoutObservers();
      scheduleLayoutRefresh();
    } else if (!nowCustom && currentTheme === 'custom') {
      destroyLayers();
    }
    currentTheme = nowCustom ? 'custom' : 'other';
  }

  var classObserver = new MutationObserver(function () { syncWithTheme(); });

  function boot() {
    classObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    syncWithTheme();
    window.addEventListener('resize', onResize, { passive: true });
  }

  // 覆盖main.js写的light主题
  try {
    var stored = localStorage.getItem('youTheme');
    if (!stored || (stored !== 'light' && stored !== 'dark' && stored !== 'custom')) {
      localStorage.setItem('youTheme', 'custom');
    }
  } catch (e) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();