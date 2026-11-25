const Utils = {
  debounce(func, wait) {
    let timeout;
    return function() {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, arguments), wait);
    };
  },

  safeAddEventListener(element, event, handler) {
    if (!element) return;

    const key = `__${event}Handler`;
    if (element[key]) {
      element.removeEventListener(event, element[key]);
    }

    element[key] = handler;
    element.addEventListener(event, handler);
  },

  // 判断是否为移动端（屏幕宽度 < 768px）
  isMobile() {
    return window.innerWidth < 768;
  },

  // 调整颜色亮度（正数变亮，负数变暗）
  adjustBrightness(color, percent) {
    let hex = color.replace('#', '');
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    const num = parseInt(hex, 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (G<255?G<1?0:G:255)*0x100 + (B<255?B<1?0:B:255)).toString(16).slice(1);
  },

  hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) {
      h = h.split('').map(c => c + c).join('');
    }
    const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0, 0, 0';
  },

  escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  scrollTo(element, targetTop, duration = 400) {
    if (!element) return;

    const startTop = element.scrollTop;
    const diff = targetTop - startTop;

    if (Math.abs(diff) < 1) {
      element.scrollTop = targetTop;
      return;
    }

    const startTime = performance.now();

    const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = easeOutQuart(progress);

      element.scrollTop = startTop + diff * easeProgress;

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }
};

const HomeDetector = {
  STORAGE_KEY: 'homeInfo',
  DEFAULT_HOME: { file: 'home.md', name: '首页' },
  cachedNavigation: null,

  async getNavigationData() {
    try {
      const response = await fetch('data/navigation.json');
      if (!response.ok) {
        throw new Error(`获取navigation.json失败: ${response.status} ${response.statusText}`);
      }
      this.cachedNavigation = await response.json();
      return this.cachedNavigation;
    } catch (error) {
      console.error('获取导航数据失败:', error);
      return null;
    }
  },

  async getHomeInfo(forceRefresh = false) {
    try {
      if (forceRefresh || !this.cachedNavigation || !this.cachedNavigation.home) {
        await this.getNavigationData();
      }

      if (this.cachedNavigation && this.cachedNavigation.home) {
        return this.cachedNavigation.home;
      }

      const homeInfo = localStorage.getItem(this.STORAGE_KEY);
      if (homeInfo) {
        return JSON.parse(homeInfo);
      }
    } catch (error) {
      console.error('获取首页信息失败:', error);
    }
    return { ...this.DEFAULT_HOME };
  },

  async getHomeFile(forceRefresh = false) {
    const homeInfo = await this.getHomeInfo(forceRefresh);
    return homeInfo.file;
  },

  async getHomeName(forceRefresh = false) {
    const homeInfo = await this.getHomeInfo(forceRefresh);
    return homeInfo.name;
  }
};

const PageUtils = {
  collectAllPages(items) {
    const pages = [];

    const collectFromItem = (item) => {
      if (!item) return;
      if (item.file) {
        pages.push(item);
      }
      if (item.children) {
        item.children.forEach(collectFromItem);
      }
      if (item.pages) {
        item.pages.forEach(collectFromItem);
      }
      if (item.content) {
        item.content.forEach(contentItem => {
          if (contentItem.type === 'page' && contentItem.data) {
            pages.push(contentItem.data);
          } else if (contentItem.type === 'category' && contentItem.data) {
            collectFromItem(contentItem.data);
          }
        });
      }
    };

    items.forEach(collectFromItem);
    return pages;
  }
};

window.Utils = Utils;
window.HomeDetector = HomeDetector;
window.PageUtils = PageUtils;