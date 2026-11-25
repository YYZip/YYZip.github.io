const VALID_THEMES = ['light', 'dark', 'custom'];

const youWiki = {
  config: null,
  tickerTexts: [],

  async init() {
    try {
      await this.loadConfig();
      Cache.init?.();
      await Navigation.init?.();
      await Search.init?.();
      this.initTicker();
      this.initThemeSelector();
      Sidebar?.initSidebarToggle?.();
    } catch (error) {
      console.error('初始化应用失败:', error);
    }
  },

  async loadConfig() {
    try {
      const response = await fetch('config.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      this.config = await response.json();

      if (this.config?.tickerTexts?.length > 0) {
        this.tickerTexts = this.config.tickerTexts;
      }

      this.updatePageTitle();
      this.updateCopyright();
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  },

  updatePageTitle() {
    if (this.config?.title) {
      document.title = this.config.title;
      const sidebarTitle = document.querySelector('.sidebar-title');
      if (sidebarTitle) {
        sidebarTitle.textContent = this.config.title;
      }
    }
  },

  updateCopyright() {
    const copyrightElement = document.getElementById('copyright');
    if (copyrightElement) {
      const author = this.config?.author || 'YOU';
      copyrightElement.innerHTML = `${author} · Powered by <a href="https://github.com/yyzip/YOU-WIKI" target="_blank">youWiki</a> 2026`;
    }
  },

  initThemeSelector() {
    let savedTheme = null;
    try { savedTheme = localStorage.getItem('youTheme'); } catch (e) { savedTheme = null; }
    if (VALID_THEMES.indexOf(savedTheme) === -1) savedTheme = 'light';
    this.applyTheme(savedTheme, { persist: false, userInitiated: false });

    const themeButtons = {
      light: document.getElementById('themeLight'),
      dark: document.getElementById('themeDark'),
      custom: document.getElementById('themeCustom')
    };

    const updateThemeButtons = (theme) => {
      Object.values(themeButtons).forEach(btn => {
        btn?.classList.remove('active');
      });
      themeButtons[theme]?.classList.add('active');
    };

    updateThemeButtons(savedTheme);

    Object.entries(themeButtons).forEach(([theme, btn]) => {
      if (!btn) return;
      btn.addEventListener('click', async () => {
        await this.applyTheme(theme, { persist: true, userInitiated: true });
        updateThemeButtons(theme);
      });
    });
  },

  async applyTheme(theme, options) {
    if (VALID_THEMES.indexOf(theme) === -1) theme = 'light';
    const opts = options || {};
    const persist = opts.persist !== false;

    requestAnimationFrame(() => {
      const body = document.body;
      body.classList.remove('theme-light', 'theme-dark', 'theme-custom');

      const customProps = [
        '--color-custom-bg', '--color-custom-bg-light', '--color-custom-bg-lighter',
        '--color-custom-bg-hover', '--color-custom-text', '--color-custom-text-light',
        '--color-custom-text-secondary', '--color-custom-primary', '--color-custom-primary-dark',
        '--color-custom-border', '--color-custom-border-hover', '--color-copyright-bg-custom',
        '--color-custom-overlay-bg', '--color-custom-shadow-bg', '--color-shadow-custom'
      ];
      customProps.forEach(prop => body.style.removeProperty(prop));
      body.style.removeProperty('font-family');

      const themeClassMap = {
        dark: 'theme-dark',
        custom: 'theme-custom',
        light: 'theme-light'
      };

      body.classList.add(themeClassMap[theme] || 'theme-light');

      if (theme === 'custom' && this.config?.theme) {
        const { background, text, primary, secondary, font } = this.config.theme;
        if (background) {
          body.style.setProperty('--color-custom-bg', background);
          body.style.setProperty('--color-custom-bg-light', Utils.adjustBrightness(background, 10));
          body.style.setProperty('--color-custom-bg-lighter', Utils.adjustBrightness(background, 20));
          body.style.setProperty('--color-custom-bg-hover', Utils.adjustBrightness(background, 30));
          body.style.setProperty('--color-copyright-bg-custom', Utils.adjustBrightness(background, -10));
        }
        if (text) {
          body.style.setProperty('--color-custom-text', text);
          body.style.setProperty('--color-custom-text-light', Utils.adjustBrightness(text, -10));
          body.style.setProperty('--color-custom-text-secondary', Utils.adjustBrightness(text, -20));
        }
        if (primary) {
          body.style.setProperty('--color-custom-primary', primary);
          body.style.setProperty('--color-custom-primary-dark', Utils.adjustBrightness(primary, -10));
          const primaryRGB = Utils.hexToRgb(primary);
          body.style.setProperty('--color-custom-overlay-bg', primaryRGB);
        }
        if (secondary) {
          body.style.setProperty('--color-custom-border', secondary);
          body.style.setProperty('--color-custom-border-hover', Utils.adjustBrightness(secondary, 10));
          const secondaryRGB = Utils.hexToRgb(secondary);
          body.style.setProperty('--color-custom-shadow-bg', secondaryRGB);
          body.style.setProperty('--color-shadow-custom', `rgba(${secondaryRGB}, var(--opacity-focus))`);
        }
        if (font) {
          body.style.fontFamily = font;
        }
      }

      if (persist) {
        try { localStorage.setItem('youTheme', theme); } catch (e) {}
      }
    });
  },

  initTicker() {
    const ticker = document.getElementById('ticker');
    if (!ticker || this.tickerTexts.length === 0) return;

    ticker.innerHTML = '';

    const tickerContent = document.createElement('div');
    tickerContent.className = 'ticker-content';

    const spaceSeparator = '\u00A0'.repeat(15);

    let content = '';
    let singleDuration = 0;

    const shuffledTexts = [...this.tickerTexts];
    for (let i = shuffledTexts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledTexts[i], shuffledTexts[j]] = [shuffledTexts[j], shuffledTexts[i]];
    }

    for (const text of shuffledTexts) {
      content += text + spaceSeparator;
      singleDuration += text.length * 0.2 + 1;
    }

    tickerContent.innerHTML = content;
    ticker.appendChild(tickerContent);

    const clone = tickerContent.cloneNode(true);
    ticker.appendChild(clone);

    const totalDuration = singleDuration * 2;
    const animationStyle = `ticker ${totalDuration}s linear infinite`;
    tickerContent.style.animation = animationStyle;
    clone.style.animation = animationStyle;
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await youWiki.init();
  } catch (error) {
    console.error('启动应用失败:', error);
  }
});

window.youWiki = youWiki;