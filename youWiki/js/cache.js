// 页面缓存管理，本地开发环境禁用缓存
const Cache = {
  prefix: 'youWiki_',

  // Ink 相关的 localStorage 前缀（不含用户存档 ink_save_* / ink_saves_*）
  inkPrefixes: [
    'youwiki_ink_compiled_v1_',
    'youwiki_ink_text_v1_',
    'youwiki_ink_cfg_',      // ink 配置（通用/按故事）
    'youwiki_checkpoint_',   // 决策点自动进度
    'youwiki_state_'         // 离开页面时的阅读进度
  ],

  isLocalServer() {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  },

  _getKey(pageId) {
    return this.prefix + pageId;
  },

  _forEachCacheKey(callback) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(this.prefix) && key !== this._getKey('lastCacheTime')) {
        keys.push(key);
        continue;
      }
      if (this.inkPrefixes.some(p => key.startsWith(p))) {
        keys.push(key);
      }
    }
    keys.forEach(callback);
  },

  // 清理 InkRuntime 内存缓存（刷新缓存后页面会重新加载故事）
  _clearInkRuntimeMemoryCaches() {
    const IR = window.InkRuntime;
    if (!IR) return;
    try { if (IR._compiledCache && typeof IR._compiledCache.clear === 'function') IR._compiledCache.clear(); } catch (e) {}
    try { if (IR._inkTextCache && typeof IR._inkTextCache.clear === 'function') IR._inkTextCache.clear(); } catch (e) {}
    try { if (IR._inkCfgFiles && typeof IR._inkCfgFiles.clear === 'function') IR._inkCfgFiles.clear(); } catch (e) {}
    try { if (IR._inkCfgPromises && typeof IR._inkCfgPromises.clear === 'function') IR._inkCfgPromises.clear(); } catch (e) {}
  },

  cachePage(pageId, content) {
    if (this.isLocalServer()) return;
    try {
      localStorage.setItem(this._getKey(pageId), content);
      this.updateCacheStatus();
    } catch (error) {
      console.error('缓存页面失败:', error);
    }
  },

  // 获取缓存的页面内容，本地环境返回null
  getCachedPage(pageId) {
    if (this.isLocalServer()) return null;
    return localStorage.getItem(this._getKey(pageId)) || null;
  },

  async cacheAllPages(pages) {
    const concurrency = 5;
    let successCount = 0;

    for (let i = 0; i < pages.length; i += concurrency) {
      const batch = pages.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(async page => {
        try {
          const response = await fetch(`data/pages/${page.file}`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const content = await response.text();
          this.cachePage(page.id, content);
          return true;
        } catch {
          return false;
        }
      }));
      successCount += results.filter(Boolean).length;
    }

    localStorage.setItem(this._getKey('lastCacheTime'), new Date().toLocaleString());
    this.updateCacheStatus();

    return { total: pages.length, success: successCount };
  },

  // 清除所有缓存（含 ink 编译/纯文本/配置 缓存与搜索内存索引，同时清理 InkRuntime 内存缓存）
  clearCache() {
    this._forEachCacheKey(key => localStorage.removeItem(key));
    localStorage.removeItem(this._getKey('lastCacheTime'));
    this._clearInkRuntimeMemoryCaches();
    Search?.resetCache?.();
    this.updateCacheStatus();
  },

  updateCacheStatus() {
    const cacheStatus = document.getElementById('cacheStatus');
    const lastCacheTime = document.getElementById('lastCacheTime');

    if (cacheStatus) {
      cacheStatus.textContent = `已缓存 ${this.getCachedPagesCount()} 页`;
    }

    if (lastCacheTime) {
      lastCacheTime.textContent = localStorage.getItem(this._getKey('lastCacheTime')) || '-';
    }
  },

  getCachedPagesCount() {
    let count = 0;
    this._forEachCacheKey(key => {
      // 只统计页面缓存键，ink 等辅助缓存不计入「已缓存 N 页」
      if (key.startsWith(this.prefix)) count++;
    });
    return count;
  },

  handleStorageChange(event) {
    if (event.key?.startsWith(this.prefix)) {
      this.updateCacheStatus();
    }
  },

  // 刷新缓存：先清理旧缓存（含 ink），再批量拉取页面
  async refreshCache() {
    try {
      this.clearCache();

      const response = await fetch('data/navigation.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const navigation = await response.json();

      const allPages = PageUtils?.collectAllPages?.(navigation.categories) || [];
      const homeFile = await HomeDetector?.getHomeFile?.() || 'home.md';

      allPages.push({ id: 'home', file: homeFile });
      const result = await this.cacheAllPages(allPages);

      alert(`缓存完成！共 ${result.total} 页，成功 ${result.success} 页；ink 相关缓存已同步更新`);

      if (window.Navigation?.currentPage) {
        const { id, file } = Navigation.currentPage;
        Navigation.loadPage(id, file);
      }
    } catch (error) {
      console.error('刷新缓存失败:', error);
      alert('刷新缓存失败，请稍后重试');
    }
  },

  init() {
    if (this.isLocalServer()) {
      document.querySelector('.cache-info')?.style.setProperty('display', 'none');
      return;
    }

    this.updateCacheStatus();
    window.addEventListener('storage', e => this.handleStorageChange(e));

    const refreshCacheBtn = document.getElementById('refreshCache');
    if (refreshCacheBtn && !refreshCacheBtn._cacheEventBound) {
      refreshCacheBtn._cacheEventBound = true;
      refreshCacheBtn.addEventListener('click', async () => {
        refreshCacheBtn.disabled = true;
        refreshCacheBtn.textContent = '刷新中...';
        await this.refreshCache();
        refreshCacheBtn.disabled = false;
        refreshCacheBtn.textContent = '刷新缓存';
        this.updateCacheStatus();
      });
    }
  }
};

window.Cache = Cache;
