// 全文搜索模块，支持 Ctrl+K 打开搜索框
const Search = {
  navigationData: null,
  cachedPages: {},
  _allCached: false,
  searchState: {
    query: '',
    results: []
  },

  async init() {
    try {
      if (Navigation?.navigationData) {
        this.navigationData = Navigation.navigationData;
      } else {
        const response = await fetch('data/navigation.json');
        this.navigationData = await response.json();
      }

      if (!this._eventsBound) {
        this._eventsBound = true;
        this.bindEvents();
      }
    } catch (error) {
      console.error('初始化搜索模块失败:', error);
    }
  },

  bindEvents() {
    const searchModal = document.getElementById('searchModal');
    const fullTextSearch = document.getElementById('fullTextSearch');
    const closeSearchModal = document.getElementById('closeSearchModal');
    const searchButton = document.getElementById('searchButton');

    if (searchButton) {
      searchButton.addEventListener('click', () => this.openSearchModal());
    }

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.openSearchModal();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchModal && searchModal.classList.contains('show')) {
        this.closeSearchModal();
      }
    });

    if (closeSearchModal) {
      closeSearchModal.addEventListener('click', () => {
        this.closeSearchModal();
      });
    }

    if (searchModal) {
      searchModal.addEventListener('click', (e) => {
        if (e.target === searchModal) {
          this.closeSearchModal();
        }
      });
    }

    if (fullTextSearch) {
      fullTextSearch.addEventListener('input', Utils.debounce((e) => {
        this.performSearch(e.target.value);
      }, 200));

      fullTextSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.performSearch(e.target.value);
        }
      });
    }
  },

  openSearchModal() {
    const searchModal = document.getElementById('searchModal');
    const fullTextSearch = document.getElementById('fullTextSearch');

    if (searchModal) {
      searchModal.classList.add('show');

      if (this.searchState.query && this.searchState.results.length > 0) {
        this.showSearchResults(this.searchState.results, this.searchState.query);
        if (fullTextSearch) {
          fullTextSearch.value = this.searchState.query;
        }
      } else {
        this.showSearchMessage('请输入搜索关键词');
      }

      if (fullTextSearch) {
        setTimeout(() => {
          fullTextSearch.focus();
        }, 100);
      }
    }
  },

  closeSearchModal() {
    const searchModal = document.getElementById('searchModal');
    if (searchModal) {
      searchModal.classList.remove('show');
    }
  },

  async performSearch(rawQuery) {
    const query = (rawQuery || '').trim();
    if (query === '') {
      this.showSearchMessage('请输入搜索关键词');
      this.searchState = {
        query: '',
        results: []
      };
      return;
    }

    try {
      this.showSearchLoading();
      await this.ensurePagesCached();
      const results = this.searchInCachedPages(query.toLowerCase());

      this.searchState = {
        query,
        results
      };

      this.showSearchResults(results, query);
    } catch (error) {
      console.error('搜索失败:', error);
      this.showSearchMessage('搜索失败，请稍后重试');
    }
  },

  // 重置搜索缓存（页面缓存被清空时由 Cache 调用）
  resetCache() {
    this.cachedPages = {};
    this._allCached = false;
  },

  async ensurePagesCached() {
    if (this._allCached) return;

    const allPages = PageUtils.collectAllPages(this.navigationData.categories);

    let homeInfo;
    try {
      homeInfo = await HomeDetector?.getHomeInfo?.() || { file: 'home.md', name: '首页' };
    } catch (error) {
      console.error('获取首页信息失败:', error);
      homeInfo = { file: 'home.md', name: '首页' };
    }
    allPages.unshift({
      id: 'home',
      name: homeInfo.name,
      file: homeInfo.file
    });

    const pagesToCache = [];

    for (const page of allPages) {
      if (!this.cachedPages[page.id]) {
        const cachedContent = Cache.getCachedPage(page.id);

        if (cachedContent) {
          const plainContent = await this.toPlainTextWithInk(cachedContent);
          this.cachedPages[page.id] = {
            ...page,
            content: cachedContent,
            plainContent
          };
        } else {
          pagesToCache.push(page);
        }
      }
    }

    if (pagesToCache.length > 0) {
      const cachePromises = pagesToCache.map(async (page) => {
        try {
          const response = await fetch(`data/pages/${page.file}`);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          const content = await response.text();

          Cache.cachePage(page.id, content);

          const plainContent = await this.toPlainTextWithInk(content);
          this.cachedPages[page.id] = {
            ...page,
            content,
            plainContent
          };

          return true;
        } catch (error) {
          console.error(`搜索模块：缓存页面 ${page.id} (${page.file}) 失败:`, error);
          return false;
        }
      });

      // 全部成功才标记完成，拉取失败的页面下次搜索时重试
      const results = await Promise.all(cachePromises);
      this._allCached = results.every(Boolean);
    } else {
      this._allCached = true;
    }
  },

  toPlainText(content) {
    try {
      let html = MarkdownParser.toHtml(content);
      html = RichText.process(html);
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      let plainText = tempDiv.textContent || tempDiv.innerText || '';
      plainText = plainText.replace(/\s+/g, ' ').trim();
      return plainText;
    } catch (error) {
      console.error('转换为纯文本失败:', error);
      return content;
    }
  },

  // 转换 Markdown 为纯文本，并附加所引用 ink 文件的文本内容
  async toPlainTextWithInk(content) {
    const baseText = this.toPlainText(content);
    if (!window.InkRuntime) return baseText;
    try {
      const refs = InkRuntime.extractInkRefs(content);
      if (refs.length === 0) return baseText;
      const inkParts = await Promise.all(refs.map(f => InkRuntime.loadInkPlainText(f)));
      const inkText = inkParts.filter(Boolean).join('\n\n');
      if (!inkText) return baseText;
      return (baseText + '\n\n' + inkText).replace(/\s+/g, ' ').trim();
    } catch (e) {
      console.warn('搜索模块：加载 ink 内容失败', e);
      return baseText;
    }
  },

  searchInCachedPages(query) {
    const results = [];

    for (const pageId in this.cachedPages) {
      const page = this.cachedPages[pageId];
      const plainContent = page.plainContent || this.toPlainText(page.content);
      const lowerContent = plainContent.toLowerCase();

      const matchCount = query ? lowerContent.split(query).length - 1 : 0;
      if (matchCount > 0) {
        results.push({
          id: page.id,
          title: page.name,
          file: page.file,
          summary: this.extractSummary(plainContent, query),
          matchCount,
          categoryPath: this.getPageCategoryPath(page.id)
        });
      }
    }

    results.sort((a, b) => b.matchCount - a.matchCount);

    return results;
  },

  extractSummary(plainContent, query) {
    const lowerContent = plainContent.toLowerCase();
    const plainIndex = lowerContent.indexOf(query);

    if (plainIndex === -1) {
      return plainContent.substring(0, 200) + (plainContent.length > 200 ? '...' : '');
    }

    const start = Math.max(0, plainIndex - 100);
    const end = Math.min(plainContent.length, plainIndex + query.length + 100);

    let summary = plainContent.substring(start, end);

    if (start > 0) {
      summary = '...' + summary;
    }

    if (end < plainContent.length) {
      summary = summary + '...';
    }

    return summary;
  },

  getPageCategoryPath(pageId) {
    if (pageId === 'home') {
      return '首页';
    }
    const pathArray = PageFinder.findCategoryPath(this.navigationData.categories, pageId);
    const namePathArray = pathArray ? pathArray.map(categoryId => {
      const category = PageFinder.findCategoryById(this.navigationData.categories, categoryId);
      return category ? category.name : categoryId;
    }) : [];
    return namePathArray.length > 0 ? namePathArray.join(' / ') : '';
  },

  showSearchLoading() {
    const searchResults = document.getElementById('searchResults');
    if (searchResults) {
      searchResults.innerHTML = `
        <div class="search-loading">
          <i class="fa-solid fa-spinner fa-spin search-spinner"></i>
          <p style="margin-top: 4px;">搜索中...</p>
        </div>
      `;
    }
  },

  showSearchMessage(message) {
    const searchResults = document.getElementById('searchResults');
    if (searchResults) {
      searchResults.innerHTML = `
        <div class="search-message">
          <p>${message}</p>
        </div>
      `;
    }
  },

  // 转义后按大小写不敏感高亮关键词（先转义再高亮，避免摘要中的 <> 破坏结构）
  _highlight(text, query) {
    const raw = String(text == null ? '' : text);
    const q = query ? String(query).toLowerCase() : '';
    if (!q) return Utils.escapeHtml(raw);

    const lower = raw.toLowerCase();
    let out = '';
    let i = 0;
    for (;;) {
      const idx = lower.indexOf(q, i);
      if (idx === -1) {
        out += Utils.escapeHtml(raw.slice(i));
        break;
      }
      out += Utils.escapeHtml(raw.slice(i, idx)) +
        '<mark>' + Utils.escapeHtml(raw.slice(idx, idx + q.length)) + '</mark>';
      i = idx + q.length;
    }
    return out;
  },

  showSearchResults(results, query) {
    const searchResults = document.getElementById('searchResults');
    if (!searchResults) return;

    if (results.length === 0) {
      this.showSearchMessage('没有找到匹配的结果');
      return;
    }

    let html = `
      <div class="search-result-count">
        找到 ${results.length} 个匹配结果
      </div>
    `;

    results.forEach(result => {
      const highlightedTitle = this._highlight(result.title, query);
      const highlightedSummary = this._highlight(result.summary, query);

      html += `
        <div class="search-result-item">
          <div class="search-result-meta">
            <span class="search-result-category" title="分类路径">${Utils.escapeHtml(result.categoryPath)}</span>
            <span class="search-result-match">${result.matchCount} 处匹配</span>
          </div>
          <h3 class="search-result-title">
            <a href="#" class="search-result-link" data-page="${Utils.escapeHtml(result.id)}" data-file="${Utils.escapeHtml(result.file)}">
              ${highlightedTitle}
            </a>
          </h3>
          <p class="search-result-summary">${highlightedSummary}</p>
        </div>
      `;
    });

    searchResults.innerHTML = html;

    searchResults.querySelectorAll('.search-result-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const pageId = link.getAttribute('data-page');
        const file = link.getAttribute('data-file');

        this.closeSearchModal();
        Navigation.loadPage(pageId, file);
      });
    });
  }
};

window.Search = Search;