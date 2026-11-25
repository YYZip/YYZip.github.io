// 事件绑定模块，统一管理所有交互事件
const Events = {
  bindAll(navigation) {
    this.bindNavigationEvents(navigation);
    this.bindGlobalLinkEvents(navigation);
    this.bindTitleFilterEvents(navigation);
    this.bindHistoryEvents(navigation);

    this.bindBackToTopEvents();
    this.bindPageTocToggleEvents();
    this.bindScrollEvents();
    this.bindHeadingAnchorEvents();
    this.bindTooltipClampEvents();

    this.bindInternalLinkHoverEvents(navigation);
  },

  // 侧边栏导航点击事件（分类展开/页面跳转）
  bindNavigationEvents(navigation) {
    const navElement = document.getElementById('navigation');
    if (!navElement) return;

    Utils.safeAddEventListener(navElement, 'click', (e) => {
      const categoryTitle = e.target.closest('.category-title');
      if (categoryTitle) {
        Sidebar?.toggleCategory?.(categoryTitle);
        return;
      }

      const pageLink = e.target.closest('.page-link');
      if (pageLink) {
        e.preventDefault();
        const pageId = pageLink.getAttribute('data-page');
        const file = pageLink.getAttribute('data-file');
        navigation.loadPage(pageId, file);
      }
    });
  },

  // 全局链接处理（锚点跳转/内链拦截）
  bindGlobalLinkEvents(navigation) {
    document.addEventListener('click', async (e) => {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      if (href.startsWith('#')) {
        e.preventDefault();
        const targetId = href.substring(1);
        const targetElement = document.getElementById(targetId);
        const mainContainer = document.getElementById('mainContainer');
        if (targetElement && mainContainer) {
          const elementTop = targetElement.getBoundingClientRect().top -
                            mainContainer.getBoundingClientRect().top +
                            mainContainer.scrollTop;
          Utils.scrollTo(mainContainer, elementTop - 20);
          window.history.pushState(null, null, href);
        }
        return;
      }

      const url = new URL(href, window.location.origin);
      const pageId = url.searchParams.get('page');
      const hash = url.hash;

      if (url.origin !== window.location.origin || !pageId) return;

      e.preventDefault();
      const result = await PageFinder?.findPageInCategories?.(navigation.navigationData?.categories, pageId);
      if (result) {
        navigation.loadPage(pageId, result.page?.file, false, hash);
      }
    });
  },

  bindTitleFilterEvents(navigation) {
    const titleFilter = document.getElementById('titleFilter');
    if (!titleFilter) return;

    Utils.safeAddEventListener(titleFilter, 'input', Utils.debounce((e) => {
      Sidebar?.filterTitles?.(e.target.value, navigation.navigationData?.categories, (pageId) => navigation.getPageCategoryPath?.(pageId));
    }, 150));
  },

  bindHistoryEvents(navigation) {
    window.addEventListener('popstate', () => {
      navigation.handleUrlParams?.();
    });
  },

  // 悬浮提示（注释/脚注/内链预览）水平夹紧到视口内，避免窄屏下溢出；
  // 同时通过 --arrow-x 让小三角始终指向触发它的正文。
  // 先清除上次的偏移再从自然居中位置测量，保证连续多次悬浮位置一致
  _clampTooltip(host, tooltip) {
    tooltip.style.left = '';
    tooltip.style.removeProperty('--arrow-x');
    const rect = tooltip.getBoundingClientRect();
    if (rect.width === 0) return;
    const margin = 8;
    const vw = document.documentElement.clientWidth;
    let shift = 0;
    if (rect.left < margin) shift = margin - rect.left;
    else if (rect.right > vw - margin) shift = (vw - margin) - rect.right;
    if (shift !== 0) {
      tooltip.style.left = `calc(50% + ${shift}px)`;
      if (host) {
        const hostRect = host.getBoundingClientRect();
        const arrowX = Math.min(rect.width - 12, Math.max(12, hostRect.left + hostRect.width / 2 - rect.left));
        tooltip.style.setProperty('--arrow-x', `${arrowX}px`);
      }
    }
  },

  bindTooltipClampEvents() {
    document.addEventListener('mouseover', (e) => {
      const host = e.target.closest('.note, .footnote-container');
      if (!host) return;
      requestAnimationFrame(() => {
        const tip = host.querySelector('.note-tooltip, .footnote-tooltip');
        if (tip) this._clampTooltip(host, tip);
      });
    });
  },

  _closePageToc: null,
  _scrollHandler: null,

  bindBackToTopEvents() {
    const backToTopBtn = document.getElementById('backToTop');
    if (!backToTopBtn) return;

    backToTopBtn.addEventListener('click', () => {
      Utils.scrollTo(document.getElementById('mainContainer'), 0);
    });
  },

  bindPageTocToggleEvents() {
    const pageTocToggle = document.getElementById('pageTocToggle');
    const pageToc = document.getElementById('pageToc');
    if (!pageTocToggle || !pageToc) return;

    pageTocToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      pageToc.classList.toggle('visible');
    });

    if (this._closePageToc) {
      document.removeEventListener('click', this._closePageToc);
    }

    this._closePageToc = (e) => {
      if (!pageToc.contains(e.target) && !pageTocToggle.contains(e.target)) {
        pageToc.classList.remove('visible');
      }
    };
    document.addEventListener('click', this._closePageToc);
  },

  bindScrollEvents() {
    const mainContainer = document.getElementById('mainContainer');
    if (!mainContainer) return;

    if (this._scrollHandler) {
      mainContainer.removeEventListener('scroll', this._scrollHandler);
    }

    let ticking = false;
    this._scrollHandler = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        this.handleScroll();
        ticking = false;
      });
    };

    mainContainer.addEventListener('scroll', this._scrollHandler);
  },

  handleScroll() {
    const mainContainer = document.getElementById('mainContainer');
    const backToTopBtn = document.getElementById('backToTop');
    if (!mainContainer || !backToTopBtn) return;

    backToTopBtn.classList.toggle('visible', mainContainer.scrollTop > 300);
    PageUI?.updateTocHighlight?.();
  },

  // 标题锚点点击复制事件；返回是否实际触发复制（触屏时据此抑制随后的合成 click）
  bindHeadingAnchorEvents() {
    const handleHeadingClick = (e) => {
      let target = e.target;
      let clientX = e.clientX;
      let clientY = e.clientY;

      if (e.touches?.[0]) {
        target = e.touches[0].target;
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if (e.changedTouches?.[0]) {
        target = e.changedTouches[0].target;
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      }

      const heading = target.closest('.heading-with-anchor');
      if (!heading) return false;

      let clickX = 0;
      if (e.offsetX !== undefined) {
        clickX = e.offsetX;
      } else if (clientX !== undefined) {
        const rect = heading.getBoundingClientRect();
        clickX = clientX - rect.left;
      }

      const paddingLeft = 24;

      if (clickX > paddingLeft) return false;

      e.preventDefault();
      const url = new URL(window.location.href);
      url.hash = heading.id;

      this.copyToClipboard(url.toString(), heading);
      return true;
    };

    let suppressClick = false;
    const wrappedHandler = (e) => {
      if (e.type === 'touchstart') {
        suppressClick = handleHeadingClick(e);
        return;
      }
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      handleHeadingClick(e);
    };

    document.addEventListener('click', wrappedHandler);
    document.addEventListener('touchstart', wrappedHandler, { passive: false });
  },

  copyToClipboard(text, element) {
    const execSuccess = this.execCopy(text);
    if (execSuccess) {
      this.showCopySuccessTooltip(element);
      return;
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => this.showCopySuccessTooltip(element))
        .catch(err => console.error('复制失败:', err));
    }
  },

  execCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;

    textarea.style.cssText = `
      position: fixed;
      left: -9999px;
      top: -9999px;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
      z-index: -9999;
    `;

    document.body.appendChild(textarea);

    try {
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      const success = document.execCommand('copy');
      return success;
    } catch (err) {
      console.error('execCommand 复制失败:', err);
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  },

  showCopySuccessTooltip(element) {
    const existingTooltip = element.querySelector('.copy-tooltip');
    if (existingTooltip) return;

    const tooltip = document.createElement('div');
    tooltip.className = 'copy-tooltip';
    tooltip.textContent = '复制成功！';
    tooltip.style.cssText = `
      position: absolute;
      left: 50%;
      top: -30px;
      transform: translateX(-50%);
      background: #333;
      color: #fff;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 14px;
      z-index: 1000;
      transition: opacity 0.3s;
      pointer-events: none;
      opacity: 0;
    `;

    element.style.position = 'relative';
    element.appendChild(tooltip);

    requestAnimationFrame(() => {
      tooltip.style.opacity = '1';
      setTimeout(() => {
        tooltip.style.opacity = '0';
        setTimeout(() => tooltip.remove(), 300);
      }, 400);
    });
  },

  // 内链悬停预览事件，带LRU缓存
  bindInternalLinkHoverEvents(navigation) {
    let hoverTimeout = null;
    let currentLink = null;

    const internalLinkCache = {
      map: new Map(),
      maxSize: 50,

      get(key) {
        const value = this.map.get(key);
        if (value) {
          this.map.delete(key);
          this.map.set(key, value);
        }
        return value;
      },

      set(key, value) {
        if (this.map.has(key)) {
          this.map.delete(key);
        }
        if (this.map.size >= this.maxSize) {
          const firstKey = this.map.keys().next().value;
          this.map.delete(firstKey);
        }
        this.map.set(key, value);
      }
    };

    document.addEventListener('mouseover', async (e) => {
      const link = e.target.closest('a[data-internal-link]');
      if (!link) return;
      if (currentLink === link) return;

      currentLink = link;
      const pageId = link.getAttribute('data-internal-link');
      if (!pageId) return;

      const anchor = link.getAttribute('data-internal-anchor');

      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
      }

      hoverTimeout = setTimeout(async () => {
        await this.showInternalLinkPreview(link, pageId, anchor, navigation, internalLinkCache);
      }, 300);
    });

    document.addEventListener('mouseout', (e) => {
      const link = e.target.closest('a[data-internal-link]');
      if (!link || currentLink !== link) return;

      const relatedTarget = e.relatedTarget;
      if (link.contains(relatedTarget)) return;

      currentLink = null;

      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
      }

      this.hideInternalLinkPreview(link);
    });

    // 触屏：首次轻触显示预览，再触同一链接跳转；轻触其他位置关闭
    let touchActiveLink = null;
    document.addEventListener('touchstart', (e) => {
      const link = e.target.closest('a[data-internal-link]');
      if (link) {
        if (touchActiveLink === link) {
          touchActiveLink = null;
          return;
        }
        touchActiveLink = link;
        e.preventDefault();
        const pageId = link.getAttribute('data-internal-link');
        if (!pageId) return;
        const anchor = link.getAttribute('data-internal-anchor');
        currentLink = link;
        this.showInternalLinkPreview(link, pageId, anchor, navigation, internalLinkCache);
      } else if (touchActiveLink) {
        touchActiveLink = null;
        if (currentLink) {
          this.hideInternalLinkPreview(currentLink);
          currentLink = null;
        }
      }
    }, { passive: false });
  },

  async showInternalLinkPreview(link, pageId, anchor, navigation, cache) {
    this.hideInternalLinkPreview(link);

    const preview = document.createElement('div');
    preview.className = 'internal-link-preview';
    preview.innerHTML = '<div class="internal-link-preview-content internal-link-preview-loading">加载中...</div>';
    link.appendChild(preview);

    requestAnimationFrame(() => {
      preview.classList.add('visible');
      this._clampTooltip(link, preview);
    });

    try {
      const cacheKey = anchor ? `${pageId}#${anchor}` : pageId;
      let previewData = cache.get(cacheKey);

      if (!previewData) {
        const result = await PageFinder?.findPageInCategories?.(navigation.navigationData?.categories, pageId);
        if (!result) {
          preview.innerHTML = '<div class="internal-link-preview-content internal-link-preview-error">页面不存在</div>';
          this._clampTooltip(link, preview);
          return;
        }

        const response = await fetch(`data/pages/${result.page.file}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const content = await response.text();

        previewData = this.parsePagePreview(content, result.page.name, anchor);
        cache.set(cacheKey, previewData);
      }

      preview.innerHTML = `
        <div class="internal-link-preview-title">${Utils.escapeHtml(previewData.title)}</div>
        <div class="internal-link-preview-content">${Utils.escapeHtml(previewData.excerpt)}</div>
      `;
      // 内容替换后宽度变化，重新夹紧
      this._clampTooltip(link, preview);
    } catch (error) {
      console.error('加载内链预览失败:', error);
      preview.innerHTML = '<div class="internal-link-preview-content internal-link-preview-error">加载失败</div>';
      this._clampTooltip(link, preview);
    }
  },

  hideInternalLinkPreview(link) {
    const preview = link.querySelector('.internal-link-preview');
    if (preview) {
      preview.classList.remove('visible');
      setTimeout(() => {
        if (preview.parentNode === link) {
          link.removeChild(preview);
        }
      }, 300);
    }
  },

  parsePagePreview(markdown, defaultTitle, targetAnchor = null) {
    let title = defaultTitle;
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }

    let startFromLine = 0;
    let targetHeadingLevel = 0;
    if (targetAnchor) {
      const anchorMatch = targetAnchor.match(/^sub(\d+(?:\.\d+)*)$/);
      if (anchorMatch) {
        const result = this.findHeadingByAnchor(markdown, anchorMatch[1].split('.').map(Number));
        if (result) {
          startFromLine = result.lineIndex;
          title = result.title;
          targetHeadingLevel = anchorMatch[1].split('.').length + 1;
        }
      }
    }

    let excerpt = '';
    const lines = markdown.split(/\r?\n/);

    for (let i = startFromLine + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith('```')) {
        while (i + 1 < lines.length && !lines[i + 1].trim().startsWith('```')) {
          i++;
        }
        i++;
        continue;
      }

      if (trimmed.startsWith('#')) {
        const headingLevel = trimmed.match(/^#+/)[0].length;
        if (headingLevel <= targetHeadingLevel) {
          break;
        }
        continue;
      }

      if (trimmed.startsWith('---') || trimmed.startsWith('***')) {
        continue;
      }

      if (trimmed.startsWith('|')) {
        continue;
      }

      const cleanLine = trimmed
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        .replace(/!\[(.+?)\]\(.+?\)/g, '')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/==(.+?)==/g, '$1');

      if (excerpt) {
        excerpt += ' ';
      }
      excerpt += cleanLine;

      if (excerpt.length >= 150) {
        break;
      }
    }

    if (!excerpt) {
      const contentFromAnchor = lines.slice(startFromLine + 1).join('\n');
      excerpt = contentFromAnchor
        .replace(/#+\s+/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/[\*\`_~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
    }

    if (excerpt.length > 150) {
      excerpt = excerpt.slice(0, 150) + '...';
    }

    return { title, excerpt };
  },

  findHeadingByAnchor(markdown, anchorParts) {
    const lines = markdown.split(/\r?\n/);
    const targetLevel = anchorParts.length + 1;
    let counters = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^\s*(#{2,6})\s*(.*)$/);
      if (!match) continue;

      const level = match[1].length;
      const title = match[2].trim();

      if (level > targetLevel) continue;

      counters[level]++;
      for (let j = level + 1; j <= 6; j++) {
        counters[j] = 0;
      }

      let matchAnchor = true;
      for (let j = 0; j < anchorParts.length; j++) {
        const checkLevel = j + 2;
        if (counters[checkLevel] !== anchorParts[j]) {
          matchAnchor = false;
          break;
        }
      }

      if (matchAnchor && level === targetLevel) {
        return { lineIndex: i, title };
      }
    }

    return null;
  }
};

window.Events = Events;