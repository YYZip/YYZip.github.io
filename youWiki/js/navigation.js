// 导航模块，管理页面加载、URL路由和侧边栏状态
const Navigation = {
  navigationData: null,
  currentPage: null,

  async init() {
    try {
      const response = await fetch('data/navigation.json');
      if (!response.ok) {
        throw new Error(`获取navigation.json失败: ${response.status} ${response.statusText}`);
      }
      this.navigationData = await response.json();

      if (typeof HomeDetector !== 'undefined') {
        HomeDetector.cachedNavigation = this.navigationData;
      }

      await this.renderSidebar();

      this.bindEvents();

      await this.handleUrlParams();
    } catch (error) {
      console.error('初始化导航模块失败:', error);
      this.showError('初始化导航模块失败，请刷新页面重试');
    }
  },

  async renderSidebar() {
    try {
      if (!this.navigationData || !this.navigationData.categories) {
        throw new Error('导航数据未初始化');
      }
      await Sidebar.render(this.navigationData.categories);
    } catch (error) {
      console.error('渲染侧边栏失败:', error);
    }
  },

  bindEvents() {
    try {
      Events.bindAll(this);
    } catch (error) {
      console.error('绑定事件失败:', error);
    }
  },

  // 加载指定页面（优先从缓存读取）
  async loadPage(pageId, file, fromHistory = false, hash = '') {
    let loadingTimeout = null;
    try {
      InkRuntime?.destroy?.();

      const contentEl = document.getElementById('content');
      if (!contentEl) {
        throw new Error('内容容器未找到');
      }

      loadingTimeout = setTimeout(() => {
        contentEl.innerHTML = '<div class="loading-state"><i class="fa-solid fa-spinner fa-spin loading-spinner"></i><p class="mt-4">加载中...</p></div>';
      }, 300);

      let content = Cache.getCachedPage(pageId);

      if (!content) {
        const response = await fetch(`data/pages/${file}`);
        if (!response.ok) {
          throw new Error(`获取页面失败: ${response.status} ${response.statusText}`);
        }
        content = await response.text();

        Cache.cachePage(pageId, content);
      }

      if (loadingTimeout) {
        clearTimeout(loadingTimeout);
        loadingTimeout = null;
      }

      this.renderPage(content, pageId, file, hash);

      if (!fromHistory) {
        const newUrl = `?page=${pageId}${hash}`;
        history.pushState(null, null, newUrl);
      }

      await this.updateCurrentPageInfo(pageId, file);

      this.updatePageNavigation();

      this.highlightCurrentPage(pageId);

      const mainContainer = document.getElementById('mainContainer');
      if (mainContainer && !hash && !window.location.hash) {
        Utils.scrollTo(mainContainer, 0);
      }

      this.closeMobileMenu();
    } catch (error) {
      if (loadingTimeout) {
        clearTimeout(loadingTimeout);
        loadingTimeout = null;
      }

      console.error('加载页面失败:', error);
      const contentEl = document.getElementById('content');
      if (contentEl) {
        contentEl.innerHTML = `<div class="error-state"><i class="fa-solid fa-exclamation-triangle error-icon"></i><p class="mt-4">加载页面失败: ${error.message}</p></div>`;
      }
    }
  },

  closeMobileMenu() {
    try {
      Sidebar?.closeSidebar?.();
    } catch (error) {
      console.error('关闭移动端菜单失败:', error);
    }
  },

  renderPage(markdown, pageId, file, hash = '') {
    try {
      const contentEl = document.getElementById('content');
      if (!contentEl) return;

      let html = MarkdownParser.toHtml(markdown);
      html = RichText.process(html);

      contentEl.innerHTML = html;

      const h1Element = contentEl.querySelector('h1');
      if (h1Element) {
        document.title = h1Element.textContent;
      }

      PageUI?.generateToc?.();

      PageUI?.countWords?.();

      InkRuntime?.init?.().catch(err => console.error('InkRuntime init error:', err));

      setTimeout(() => {
        this.handleUrlHash(hash);
      }, 50);
    } catch (error) {
      console.error('渲染页面内容失败:', error);
      const contentEl = document.getElementById('content');
      if (contentEl) {
        contentEl.innerHTML = `<div class="error-state"><i class="fa-solid fa-exclamation-triangle error-icon"></i><p class="mt-4">渲染页面失败: ${error.message}</p></div>`;
      }
    }
  },

  handleUrlHash(hash = '') {
    try {
      const targetHash = hash || window.location.hash;
      if (targetHash) {
        const targetId = targetHash.substring(1);
        const targetElement = document.getElementById(targetId);
        const mainContainer = document.getElementById('mainContainer');
        if (targetElement && mainContainer) {
          const elementTop = targetElement.getBoundingClientRect().top -
                            mainContainer.getBoundingClientRect().top +
                            mainContainer.scrollTop;
          Utils.scrollTo(mainContainer, elementTop - 20);
        }
      }
    } catch (error) {
      console.error('处理URL片段失败:', error);
    }
  },

  async updateCurrentPageInfo(pageId, file) {
    try {
      if (!this.navigationData || !this.navigationData.categories) {
        throw new Error('导航数据未初始化');
      }
      const result = await PageFinder.findPageInCategories(this.navigationData.categories, pageId);
      if (result) {
        this.currentPage = {
          id: pageId,
          name: result.page.name,
          file: file,
          category: result.parentCategory.id,
          categoryName: result.parentCategory.name
        };
      } else {
        this.currentPage = null;
      }
    } catch (error) {
      console.error('更新当前页面信息失败:', error);
      this.currentPage = null;
    }
  },

  updatePageNavigation() {
    try {
      if (!this.navigationData || !this.navigationData.categories) {
        throw new Error('导航数据未初始化');
      }
      PageUI?.updatePageNavigation?.(this.currentPage, this.navigationData.categories, (pageId, file) => {
        this.loadPage(pageId, file);
      });
    } catch (error) {
      console.error('更新页面导航失败:', error);
    }
  },

  highlightCurrentPage(pageId) {
    try {
      Sidebar.highlightCurrentPage(pageId);
    } catch (error) {
      console.error('高亮当前页面链接失败:', error);
    }
  },

  getPageCategoryPath(pageId) {
    try {
      if (!this.navigationData || !this.navigationData.categories) {
        throw new Error('导航数据未初始化');
      }
      return PageFinder.findCategoryPath(this.navigationData.categories, pageId) || [];
    } catch (error) {
      console.error('获取页面分类路径失败:', error);
      return [];
    }
  },

  async handleUrlParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      const pageId = params.get('page');

      if (pageId) {
        if (!this.navigationData || !this.navigationData.categories) {
          throw new Error('导航数据未初始化');
        }
        const result = await PageFinder.findPageInCategories(this.navigationData.categories, pageId);
        if (result) {
          await this.loadPage(pageId, result.page.file, true);
        } else {
          console.error('未找到页面:', pageId);
          await this.loadHomePage();
        }
      } else {
        await this.loadHomePage();
      }
    } catch (error) {
      console.error('处理URL参数失败:', error);
      await this.loadHomePage();
    }
  },

  async loadHomePage() {
    try {
      const homeFile = await HomeDetector?.getHomeFile?.() || 'home.md';
      await this.loadPage('home', homeFile);
    } catch (error) {
      console.error('加载首页失败:', error);
      const contentEl = document.getElementById('content');
      if (contentEl) {
        contentEl.innerHTML = `<div class="error-state"><i class="fa-solid fa-exclamation-triangle error-icon"></i><p class="mt-4">加载首页失败: ${error.message}</p></div>`;
      }
    }
  },

  showError(message) {
    console.error(message);
    const contentEl = document.getElementById('content');
    if (contentEl) {
      contentEl.innerHTML = `<div class="error-state"><i class="fa-solid fa-exclamation-triangle error-icon"></i><p class="mt-4">${message}</p></div>`;
    }
  }
};

window.Navigation = Navigation;