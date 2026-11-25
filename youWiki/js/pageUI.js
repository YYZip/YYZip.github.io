// 页面UI模块，处理目录生成、字数统计、上一页/下一页导航
const PageUI = {
  _cache: {
    pageTocEl: null,
    contentEl: null,
    mainContainer: null,
    tocList: null,
    tocLinks: null,
    headings: null
  },
  _scrollTimer: null,
  _handleTocClick: null,

  _boundHandler: null,

  _initCache() {
    this._cache.pageTocEl = document.getElementById('pageToc');
    this._cache.contentEl = document.getElementById('content');
    this._cache.mainContainer = document.getElementById('mainContainer');
    this._cache.tocList = this._cache.pageTocEl?.querySelector('ul');
  },

  _hasNumberPrefix(text) {
    const patterns = [
      /^\s*(?:\([一二三四五六七八九十百千]+\)|\(\d+\)|（[一二三四五六七八九十百千]+）|（\d+）)/,
      /^\s*(?:[一二三四五六七八九十百千]+|\d+)\s*[.:：、。,，\-]/
    ];
    return patterns.some(pattern => pattern.test(text));
  },

  _generateNumbering(level, counters) {
    if (level < 2) return '';

    counters[level]++;
    for (let i = level + 1; i <= 6; i++) {
      counters[i] = 0;
    }

    const parts = [];
    for (let i = 2; i <= level; i++) {
      parts.push(counters[i]);
    }
    return parts.join('.');
  },

  generateToc() {
    this._initCache();
    const { pageTocEl, contentEl, tocList } = this._cache;

    if (!pageTocEl || !contentEl || !tocList) return;

    this._cache.headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (this._cache.headings.length === 0) {
      tocList.innerHTML = '<li class="toc-empty">无目录</li>';
      this._cache.tocLinks = null;
      return;
    }

    const counters = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const fragment = document.createDocumentFragment();

    this._cache.headings.forEach(heading => {
      const level = parseInt(heading.tagName[1], 10);
      const text = heading.textContent.trim();
      const id = heading.id;

      const numbering = this._generateNumbering(level, counters);
      const hasPrefix = this._hasNumberPrefix(text);
      const indent = (level - 1) * 10;

      const li = document.createElement('li');
      li.style.paddingLeft = `${indent}px`;

      if (id) {
        const link = document.createElement('a');
        link.href = `#${id}`;
        link.className = 'toc-link';
        link.dataset.targetId = id;

        if (level >= 2 && !hasPrefix && numbering) {
          const numSpan = document.createElement('span');
          numSpan.className = 'toc-number';
          numSpan.textContent = numbering;
          link.appendChild(numSpan);
        }

        link.appendChild(document.createTextNode(text));
        li.appendChild(link);
      } else {
        li.textContent = text;
      }

      fragment.appendChild(li);
    });

    tocList.innerHTML = '';
    tocList.appendChild(fragment);

    this._cache.tocLinks = pageTocEl.querySelectorAll('.toc-link');

    this._bindTocLinks();
  },

  _bindTocLinks() {
    const { pageTocEl, mainContainer } = this._cache;
    if (!pageTocEl || !mainContainer) return;

    pageTocEl.removeEventListener('click', this._handleTocClick);

    this._handleTocClick = (e) => {
      const link = e.target.closest('.toc-link');
      if (!link) return;

      e.preventDefault();
      const id = link.dataset.targetId;
      const element = document.getElementById(id);

      if (element) {
        const elementTop = element.getBoundingClientRect().top -
                          mainContainer.getBoundingClientRect().top +
                          mainContainer.scrollTop;
        Utils.scrollTo(mainContainer, elementTop - 20);

        if (window.innerWidth < 768) {
          pageTocEl.classList.remove('visible');
        }
      }
    };

    pageTocEl.addEventListener('click', this._handleTocClick);
  },

  // 根据滚动位置更新目录高亮（使用 requestAnimationFrame 节流）
  updateTocHighlight() {
    if (this._scrollTimer) return;

    this._scrollTimer = requestAnimationFrame(() => {
      this._doUpdateHighlight();
      this._scrollTimer = null;
    });
  },

  _doUpdateHighlight() {
    const { mainContainer, tocLinks, headings } = this._cache;

    if (!mainContainer || !tocLinks || tocLinks.length === 0) return;
    if (!headings || headings.length === 0) return;

    const containerRect = mainContainer.getBoundingClientRect();
    const containerTop = containerRect.top;
    const offset = 100;

    let currentHeading = null;

    for (let i = headings.length - 1; i >= 0; i--) {
      const heading = headings[i];
      const headingRect = heading.getBoundingClientRect();
      const headingOffset = headingRect.top - containerTop;

      if (headingOffset <= offset) {
        currentHeading = heading;
        break;
      }
    }

    tocLinks.forEach(link => {
      link.classList.remove('font-bold');
      if (currentHeading && link.dataset.targetId === currentHeading.id) {
        link.classList.add('font-bold');
      }
    });
  },

  // 更新页面底部的上一页/下一页导航
  updatePageNavigation(currentPage, categories, onLoadPage) {
    const pageNavEl = document.getElementById('pageNavigation');
    if (!pageNavEl) return;

    // 首页或页面不在导航树中时不显示翻页，并清掉上一个页面残留的导航
    if (!currentPage || currentPage.id === 'home') {
      pageNavEl.innerHTML = '';
      return;
    }

    const topCategory = PageFinder.findTopCategoryByPageId(categories, currentPage.id);
    if (!topCategory) return;

    const pages = this._getPagesFromCategory(topCategory);
    if (!pages || pages.length === 0) return;

    const pageIndex = pages.findIndex(p => p.id === currentPage.id);
    if (pageIndex === -1) return;

    const html = this._buildNavigationHTML(pages, pageIndex);
    pageNavEl.innerHTML = html;

    this._bindNavigationEvents(pageNavEl, onLoadPage);
  },

  _getPagesFromCategory(topCategory) {
    return PageUtils.collectAllPages([topCategory]);
  },

  _buildNavigationHTML(pages, currentIndex) {
    let html = '';

    if (currentIndex > 0) {
      const prevPage = pages[currentIndex - 1];
      html += `
        <a href="#" class="prev-page nav-prev" data-page="${prevPage.id}" data-file="${prevPage.file}">
          <i class="fa-solid fa-arrow-left"></i>
          <span>${prevPage.name}</span>
        </a>
      `;
    } else {
      html += '<div></div>';
    }

    if (currentIndex < pages.length - 1) {
      const nextPage = pages[currentIndex + 1];
      html += `
        <a href="#" class="next-page nav-next" data-page="${nextPage.id}" data-file="${nextPage.file}">
          <span>${nextPage.name}</span>
          <i class="fa-solid fa-arrow-right"></i>
        </a>
      `;
    } else {
      html += '<div></div>';
    }

    return html;
  },

  _bindNavigationEvents(pageNavEl, onLoadPage) {
    if (this._boundHandler) {
      pageNavEl.removeEventListener('click', this._boundHandler);
    }

    this._boundHandler = (e) => {
      const link = e.target.closest('.prev-page, .next-page');
      if (!link) return;

      e.preventDefault();
      const pageId = link.getAttribute('data-page');
      const file = link.getAttribute('data-file');

      if (onLoadPage && pageId) {
        onLoadPage(pageId, file);
      }
    };

    pageNavEl.addEventListener('click', this._boundHandler);
  },

  // 统计中英文字数（纯文本，不含任何 ink）
  _countWordsFromText(text) {
    const cleanedText = text.replace(/\s+/g, ' ').trim();
    let chineseChars = 0;
    let englishWords = 0;
    const chineseMatches = cleanedText.match(/[\u4e00-\u9fa5]/g);
    if (chineseMatches) chineseChars = chineseMatches.length;
    const englishMatches = cleanedText.match(/\b[a-zA-Z]+\b/g);
    if (englishMatches) englishWords = englishMatches.length;
    return { chineseChars, englishWords, totalWords: chineseChars + englishWords };
  },

  // 统计页面字数（中文+英文），包含引用的 ink 文件内容
  async countWords() {
    this._initCache();
    const { contentEl } = this._cache;

    if (!contentEl) return 0;

    // 本次统计的令牌：异步 ink 文本返回前若又触发了新的统计（翻页），放弃回写旧结果
    const wordCountToken = this._wordCountToken = (this._wordCountToken || 0) + 1;

    const contentClone = contentEl.cloneNode(true);

    const headings = contentClone.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(heading => heading.remove());

    const footnotes = contentClone.querySelectorAll('.footnotes, .footnote-ref, .footnote-container');
    footnotes.forEach(footnote => footnote.remove());

    const text = contentClone.textContent || '';
    const baseCount = this._countWordsFromText(text);

    // 先立即显示基础字数，避免等待异步 ink 加载
    this._displayWordCount(baseCount.totalWords);

    // 再异步加载并计入引用的 ink 内容
    let inkCount = { chineseChars: 0, englishWords: 0, totalWords: 0 };
    try {
      const storyFiles = [];
      contentClone.querySelectorAll('[data-ink-story]').forEach(c => {
        let f = c.getAttribute('data-ink-story');
        if (!f) return;
        if (!f.toLowerCase().endsWith('.ink')) f += '.ink';
        if (!storyFiles.includes(f)) storyFiles.push(f);
      });

      if (storyFiles.length > 0 && window.InkRuntime?.loadInkPlainText) {
        const texts = await Promise.all(storyFiles.map(f => InkRuntime.loadInkPlainText(f)));
        const inkText = texts.filter(Boolean).join('\n\n');
        inkCount = this._countWordsFromText(inkText);
      }
    } catch (e) {
      console.warn('字数统计：加载 ink 内容失败', e);
    }

    if (inkCount.totalWords > 0) {
      const total = {
        chineseChars: baseCount.chineseChars + inkCount.chineseChars,
        englishWords: baseCount.englishWords + inkCount.englishWords,
        totalWords: baseCount.totalWords + inkCount.totalWords
      };
      if (wordCountToken === this._wordCountToken) {
        this._displayWordCount(total.totalWords);
      }
      return total.totalWords;
    }

    return baseCount.totalWords;
  },

  _displayWordCount(totalWords) {
    let wordCountEl = document.getElementById('wordCount');

    if (!wordCountEl) {
      wordCountEl = document.createElement('div');
      wordCountEl.id = 'wordCount';
      wordCountEl.className = 'word-count';

      const contentEl = document.getElementById('content');
      if (contentEl) {
        contentEl.insertBefore(wordCountEl, contentEl.firstChild);
      }
    }

    wordCountEl.innerHTML = '<div class="word-count-content"><span class="word-count-icon"><i class="fa-solid fa-file-lines"></i></span><span class="word-count-text">本页共 ' + totalWords + ' 字</span></div>';
  }
};

window.PageUI = PageUI;