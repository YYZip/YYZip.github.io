// 侧边栏模块，渲染导航菜单和移动端菜单切换
const Sidebar = {
  async render(categories) {
    const navigationEl = document.getElementById('navigation');
    if (!navigationEl || !categories) return;

    const renderCategory = (category, level = 0) => {
      let html = '';
      const indent = level * 20;

      if (category.file) {
        html += `
          <li>
            <a href="#" class="page-link" data-page="${category.id}" data-file="${category.file}" style="padding-left: ${indent}px;">
              ${category.name}
            </a>
          </li>
        `;
        return html;
      }

      const categoryId = category.id || `category-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      html += `
        <li>
          <div class="category-title" data-category="${categoryId}" style="padding-left: ${indent}px;">
            ${category.name}
            <i class="fa-solid fa-chevron-right"></i>
          </div>
          <ul class="category-content collapsed" id="category-${categoryId}">
      `;

      if (category.content && category.content.length) {
        category.content.forEach(item => {
          if (item.type === 'category' && item.data) {
            html += renderCategory(item.data, level + 1);
          } else if (item.type === 'page' && item.data) {
            html += `
              <li>
                <a href="#" class="page-link" data-page="${item.data.id}" data-file="${item.data.file}" style="padding-left: ${indent + 5}px;">
                  ${item.data.name}
                </a>
              </li>
            `;
          }
        });
      } else {
        if (category.children && category.children.length) {
          category.children.forEach(child => {
            html += renderCategory(child, level + 1);
          });
        }

        if (category.pages && category.pages.length) {
          category.pages.forEach(page => {
            html += `
              <li>
                <a href="#" class="page-link" data-page="${page.id}" data-file="${page.file}" style="padding-left: ${indent + 5}px;">
                  ${page.name}
                </a>
              </li>
            `;
          });
        }
      }

      html += `</ul></li>`;
      return html;
    };

    let homeInfo;
    try {
      homeInfo = await HomeDetector?.getHomeInfo?.() || { file: 'home.md', name: '首页' };
    } catch (error) {
      console.error('获取首页信息失败:', error);
      homeInfo = { file: 'home.md', name: '首页' };
    }

    let html = '';

    html += `
      <li>
        <a href="#" class="page-link" data-page="home" data-file="${homeInfo.file}" style="padding-left: 5px;">
          ${homeInfo.name}
        </a>
      </li>
    `;

    categories.forEach(category => {
      html += renderCategory(category, 0);
    });

    const fragment = document.createDocumentFragment();
    const ul = document.createElement('ul');
    ul.innerHTML = html;
    fragment.appendChild(ul);
    navigationEl.innerHTML = '';
    navigationEl.appendChild(fragment);
  },

  toggleCategory(titleEl) {
    const categoryId = titleEl.getAttribute('data-category');
    const contentEl = document.getElementById(`category-${categoryId}`);
    const icon = titleEl.querySelector('i');

    if (contentEl) {
      contentEl.classList.toggle('collapsed');

      if (icon) {
        if (contentEl.classList.contains('collapsed')) {
          icon.classList.remove('fa-chevron-down');
          icon.classList.add('fa-chevron-right');
        } else {
          icon.classList.remove('fa-chevron-right');
          icon.classList.add('fa-chevron-down');
        }
      }
    }
  },

  collapseAllCategories() {
    document.querySelectorAll('.category-title').forEach(title => {
      const categoryId = title.getAttribute('data-category');
      const contentEl = document.getElementById(`category-${categoryId}`);
      if (contentEl && !contentEl.classList.contains('collapsed')) {
        this.toggleCategory(title);
      }
    });
  },

  expandAllAncestors(link) {
    let parentUl = link.closest('ul');
    while (parentUl && parentUl.id && parentUl.id.startsWith('category-')) {
      const categoryId = parentUl.id.replace('category-', '');
      const titleEl = document.querySelector(`.category-title[data-category="${categoryId}"]`);
      if (titleEl) {
        if (parentUl.classList.contains('collapsed')) {
          this.toggleCategory(titleEl);
        }
      }
      parentUl = parentUl.parentElement?.closest('ul');
    }
  },

  highlightCurrentPage(pageId) {
    document.querySelectorAll('.page-link').forEach(link => {
      link.classList.remove('active');
    });

    const currentLink = document.querySelector(`.page-link[data-page="${pageId}"]`);
    if (currentLink) {
      currentLink.classList.add('active');
      this.expandAllAncestors(currentLink);
    }
  },

  async filterTitles(filter, categories, getPageCategoryPath) {
    if (!filter) {
      document.querySelectorAll('.page-link').forEach(link => {
        link.style.display = '';
      });
      return;
    }

    filter = filter.toLowerCase();

    const collectPages = async (cats, includeHome = true) => {
      let pages = [];
      if (includeHome) {
        let homeInfo;
        try {
          homeInfo = await HomeDetector?.getHomeInfo?.() || { file: 'home.md', name: '首页' };
        } catch (error) {
          console.error('获取首页信息失败:', error);
          homeInfo = { file: 'home.md', name: '首页' };
        }
        pages.push({ id: 'home', name: homeInfo.name, file: homeInfo.file });
      }
      for (const category of cats) {
        if (category.pages) {
          pages = pages.concat(category.pages);
        }
        if (category.children) {
          pages = pages.concat(await collectPages(category.children, false));
        }
        if (category.content) {
          for (const item of category.content) {
            if (item.type === 'page' && item.data) {
              pages.push(item.data);
            } else if (item.type === 'category' && item.data) {
              pages = pages.concat(await collectPages([item.data], false));
            }
          }
        }
        if (category.file && category.id) {
          pages.push({ id: category.id, name: category.name, file: category.file });
        }
      }
      return pages;
    };

    const allPages = await collectPages(categories);
    const pageById = new Map(allPages.map(p => [p.id, p]));

    const matchedPageIds = new Set();
    const pageLinks = document.querySelectorAll('.page-link');

    pageLinks.forEach(link => {
      const pageId = link.getAttribute('data-page');
      const page = pageById.get(pageId);

      if (page) {
        const nameMatch = page.name.toLowerCase().includes(filter);
        if (nameMatch) {
          matchedPageIds.add(pageId);
        }
      }
    });

    this.collapseAllCategories();

    matchedPageIds.forEach(pageId => {
      if (pageId !== 'home') {
        const pathIds = getPageCategoryPath(pageId);
        pathIds.forEach(categoryId => {
          const titleEl = document.querySelector(`.category-title[data-category="${categoryId}"]`);
          const contentEl = document.getElementById(`category-${categoryId}`);
          if (titleEl && contentEl && contentEl.classList.contains('collapsed')) {
            this.toggleCategory(titleEl);
          }
        });
      }
    });

    pageLinks.forEach(link => {
      const pageId = link.getAttribute('data-page');
      if (matchedPageIds.has(pageId)) {
        link.style.display = '';
      } else {
        link.style.display = 'none';
      }
    });
  },

  // 移动端菜单元素引用，由 initSidebarToggle 填充
  _menuBtn: null,
  _sidebarEl: null,
  _overlayEl: null,

  _getToggleEls() {
    return {
      menuBtn: this._menuBtn || document.getElementById('menuToggle'),
      sidebar: this._sidebarEl || document.getElementById('sidebar'),
      overlay: this._overlayEl || document.getElementById('sidebarOverlay')
    };
  },

  _setMenuIcon(menuBtn, isOpen) {
    const icon = menuBtn?.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-times', isOpen);
      icon.classList.toggle('fa-bars', !isOpen);
    }
  },

  openSidebar() {
    const { sidebar, overlay, menuBtn } = this._getToggleEls();
    if (!sidebar || !overlay || !Utils.isMobile()) return;

    sidebar.classList.add('show');
    overlay.classList.add('show');
    document.body.classList.add('sidebar-open');
    this._setMenuIcon(menuBtn, true);
  },

  closeSidebar() {
    const { sidebar, overlay, menuBtn } = this._getToggleEls();
    if (!sidebar) return;

    sidebar.classList.remove('show');
    if (overlay) overlay.classList.remove('show');
    document.body.classList.remove('sidebar-open');
    this._setMenuIcon(menuBtn, false);
  },

  toggleSidebar() {
    const { sidebar } = this._getToggleEls();
    if (!sidebar || !Utils.isMobile()) {
      this.closeSidebar();
      return;
    }
    if (sidebar.classList.contains('show')) {
      this.closeSidebar();
    } else {
      this.openSidebar();
    }
  },

  initSidebarToggle() {
    const menuBtn = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (!menuBtn || !sidebar || !overlay) return;

    this._menuBtn = menuBtn;
    this._sidebarEl = sidebar;
    this._overlayEl = overlay;

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSidebar();
    });

    overlay.addEventListener('click', () => {
      this.closeSidebar();
    });

    sidebar.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    window.addEventListener('resize', Utils.debounce(() => {
      this.closeSidebar();
    }, 250));

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('show')) {
        this.closeSidebar();
      }
    });

    if (Utils.isMobile()) {
      this.closeSidebar();
    } else {
      sidebar.classList.remove('show');
      overlay.classList.remove('show');
    }
  }
};

window.Sidebar = Sidebar;