// 页面查找模块，在导航树中搜索页面和分类
const PageFinder = {
  async findPageInCategories(categories, pageId) {
    if (pageId === 'home') {
      let homeFile, homeName;
      try {
        homeFile = await HomeDetector?.getHomeFile?.() || 'home.md';
        homeName = await HomeDetector?.getHomeName?.() || '首页';
      } catch (error) {
        console.error('获取首页信息失败:', error);
        homeFile = 'home.md';
        homeName = '首页';
      }

      return {
        page: {
          id: 'home',
          name: homeName,
          file: homeFile
        },
        parentCategory: {
          id: 'home',
          name: homeName,
          pages: [{
            id: 'home',
            name: homeName,
            file: homeFile
          }]
        }
      };
    }

    for (const category of categories) {
      if (category.file && category.id === pageId) {
        return {
          page: {
            id: category.id,
            name: category.name,
            file: category.file
          },
          parentCategory: category
        };
      }
      if (category.pages) {
        const page = category.pages.find(p => p.id === pageId);
        if (page) {
          return {
            page: page,
            parentCategory: category
          };
        }
      }
      if (category.content) {
        for (const item of category.content) {
          if (item.type === 'page' && item.data.id === pageId) {
            return {
              page: item.data,
              parentCategory: category
            };
          } else if (item.type === 'category' && item.data) {
            const found = await this.findPageInCategories([item.data], pageId);
            if (found) return found;
          }
        }
      }
      if (category.children && category.children.length) {
        const found = await this.findPageInCategories(category.children, pageId);
        if (found) return found;
      }
    }
    return null;
  },

  findCategoryById(categories, categoryId) {
    for (const category of categories) {
      if (category.id === categoryId) return category;
      if (category.children && category.children.length) {
        const found = this.findCategoryById(category.children, categoryId);
        if (found) return found;
      }
    }
    return null;
  },

  findCategoryPath(categories, pageId, path = []) {
    if (pageId === 'home') {
      return ['home'];
    }

    for (const category of categories) {
      if (category.file && category.id === pageId) {
        return [...path, category.id];
      }
      if (category.pages && category.pages.some(p => p.id === pageId)) {
        return [...path, category.id];
      }
      if (category.content) {
        for (const item of category.content) {
          if (item.type === 'page' && item.data.id === pageId) {
            return [...path, category.id];
          } else if (item.type === 'category' && item.data) {
            const result = this.findCategoryPath([item.data], pageId, [...path, category.id]);
            if (result) return result;
          }
        }
      }
      if (category.children && category.children.length) {
        const result = this.findCategoryPath(category.children, pageId, [...path, category.id]);
        if (result) return result;
      }
    }
    return null;
  },

  findTopCategoryByPageId(categories, pageId) {
    for (const category of categories) {
      if (category.file && category.id === pageId) {
        return category;
      }
      if (category.pages && category.pages.some(p => p.id === pageId)) {
        return category;
      }
      if (category.content) {
        for (const item of category.content) {
          if (item.type === 'page' && item.data.id === pageId) {
            return category;
          } else if (item.type === 'category' && item.data) {
            if (item.data.pages && item.data.pages.some(p => p.id === pageId)) {
              return category;
            }
            if (item.data.content) {
              for (const subItem of item.data.content) {
                if (subItem.type === 'page' && subItem.data.id === pageId) {
                  return category;
                }
              }
            }
          }
        }
      }
      if (category.children && category.children.length) {
        const foundInChildren = this.findTopCategoryByPageId(category.children, pageId);
        if (foundInChildren) {
          return category;
        }
      }
    }
    return null;
  }
};

window.PageFinder = PageFinder;