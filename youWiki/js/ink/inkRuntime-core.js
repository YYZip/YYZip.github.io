(function() {
  'use strict';
  // ===== InkRuntime 模块 1：核心（状态、配置、生命周期、工厂、公共工具、文本预处理、故事加载） =====
  const InkRuntime = window.InkRuntime = window.InkRuntime || {};

  // ===== 常量 / 模块级正则 =====
  const CACHE_VERSION = 2;
  const COMPILED_MAX_LOCAL = 2 * 1024 * 1024;
  const RENDER_LOG_MAX = 5000;
  const LS_CFG_PREFIX = 'youwiki_ink_cfg_';
  const LS_COMPILED_PREFIX = 'youwiki_ink_compiled_v1_';
  const LS_CHECKPOINT_PREFIX = 'youwiki_checkpoint_';
  const LS_STATE_PREFIX = 'youwiki_state_';
  InkRuntime.LS_CHECKPOINT_PREFIX = LS_CHECKPOINT_PREFIX;
  InkRuntime.LS_STATE_PREFIX = LS_STATE_PREFIX;

  const RE_VAR_DECL = /^\s*VAR\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/gm;
  const RE_INPUT_TAG = /^\s*#\s*INPUT\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\||\|\||\^|\^\^|$)/gim;
  const RE_TUNNEL_ASSIGN = /^\s*~\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/gm;
  const RE_TAG_LINE = /^(\s*#\s*[A-Za-z_][A-Za-z0-9_]*\s*:)(.*)$/gm;
  const RE_BOM = /^\uFEFF/;

  InkRuntime.stories = InkRuntime.stories || new Map();
  InkRuntime.stateCache = InkRuntime.stateCache || new Map();
  InkRuntime._inkTextCache = InkRuntime._inkTextCache || new Map();
  InkRuntime._compiledCache = InkRuntime._compiledCache || new Map();    // storyFile -> {json, ts}
  InkRuntime._loadStoryPromises = InkRuntime._loadStoryPromises || new Map(); // storyFile -> Promise（去重并发加载）
  InkRuntime._inkCfgFiles = InkRuntime._inkCfgFiles || new Map();        // 'common'/'storyFile' -> 配置（null 表示不存在）
  InkRuntime._inkCfgPromises = InkRuntime._inkCfgPromises || new Map();  // 去重并发请求

  let _mainContainerEl = null;
  InkRuntime._getMainContainer = function() {
    if (_mainContainerEl === null) {
      _mainContainerEl = document.getElementById('mainContainer');
    }
    if (_mainContainerEl === null) return null;
    if (!document.body.contains(_mainContainerEl)) _mainContainerEl = document.getElementById('mainContainer');
    return _mainContainerEl;
  };

  // --- HTML 转义 ---
  const _HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const _RE_HTML_ESCAPE = /[&<>"']/g;
  InkRuntime.escapeHtml = function(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(_RE_HTML_ESCAPE, (c) => _HTML_ESCAPE_MAP[c] || c);
  };

  // --- ink 配置：data/ink/ink.json 为通用配置，data/ink/<故事名>.json 按故事覆盖 ---
  InkRuntime._fetchInkCfgFile = function(key) {
    if (this._inkCfgFiles.has(key)) return Promise.resolve(this._inkCfgFiles.get(key));
    let pending = this._inkCfgPromises.get(key);
    if (pending) return pending;
    const isLocal = Cache && typeof Cache.isLocalServer === 'function' && Cache.isLocalServer();
    const lsKey = LS_CFG_PREFIX + key;
    if (!isLocal) {
      try {
        const raw = localStorage.getItem(lsKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.v === CACHE_VERSION) {
            this._inkCfgFiles.set(key, parsed.cfg || null);
            return Promise.resolve(parsed.cfg || null);
          }
        }
      } catch (e) { /* 解析失败或隐私模式，走网络 */ }
    }
    pending = (async () => {
      let cfg = null;
      const file = key === 'common' ? 'ink.json' : key.replace(/\.ink$/i, '') + '.json';
      try {
        const res = await fetch('data/ink/' + file, isLocal ? { cache: 'no-store' } : undefined);
        if (res && res.ok) cfg = await res.json();
      } catch (e) { console.warn('InkRuntime: 读取配置失败:', file, e); }
      if (!cfg && key === 'common') {
        // 兼容旧版：data/ink/ink.json 缺失时回退 config.json 的 ink 段
        try {
          const res = await fetch('config.json', isLocal ? { cache: 'no-store' } : undefined);
          if (res && res.ok) {
            const full = await res.json();
            cfg = (full && full.ink) || null;
          }
        } catch (e) {}
      }
      if (!isLocal) {
        try { localStorage.setItem(lsKey, JSON.stringify({ v: CACHE_VERSION, cfg })); } catch (e) { /* 存储满或隐私模式 */ }
      }
      this._inkCfgFiles.set(key, cfg);
      this._inkCfgPromises.delete(key);
      return cfg;
    })();
    this._inkCfgPromises.set(key, pending);
    return pending;
  };

  // 合并通用与独立配置：延迟直接覆盖；speakerPatterns 按 speaker 同名覆盖；styles/map 按键合并
  InkRuntime._mergeInkCfg = function(base, override) {
    const merged = {};
    if (base && base.textAnimationDelay !== undefined) merged.textAnimationDelay = base.textAnimationDelay;
    if (override && override.textAnimationDelay !== undefined) merged.textAnimationDelay = override.textAnimationDelay;
    if ((base && base.speakerPatterns) || (override && override.speakerPatterns)) {
      const bySpeaker = new Map();
      for (const p of (base && base.speakerPatterns) || []) if (p && p.speaker) bySpeaker.set(p.speaker, p);
      for (const p of (override && override.speakerPatterns) || []) if (p && p.speaker) bySpeaker.set(p.speaker, p);
      merged.speakerPatterns = Array.from(bySpeaker.values());
    }
    if ((base && base.speakerStyles) || (override && override.speakerStyles)) {
      merged.speakerStyles = Object.assign({}, base && base.speakerStyles, override && override.speakerStyles);
    }
    if ((base && base.variableSpeakerMap) || (override && override.variableSpeakerMap)) {
      merged.variableSpeakerMap = Object.assign({}, base && base.variableSpeakerMap, override && override.variableSpeakerMap);
    }
    return merged;
  };

  InkRuntime.getStoryInkConfig = async function(storyFile) {
    await Promise.all([this._fetchInkCfgFile('common'), this._fetchInkCfgFile(storyFile)]);
    const merged = this._mergeInkCfg(this._inkCfgFiles.get('common'), this._inkCfgFiles.get(storyFile));
    const stepVal = Number(merged.textAnimationDelay);
    const stepDelay = (typeof stepVal === 'number' && !isNaN(stepVal) && stepVal >= 0) ? stepVal : 200;
    return {
      inkCfg: merged,
      speakerStyles: merged.speakerStyles || null,
      variableSpeakerMap: merged.variableSpeakerMap || null,
      speakerPatternMap: this._buildSpeakerPatternMap(merged.speakerPatterns),
      stepDelay
    };
  };

  // speakerPatterns: [{speaker:'xxx', ...}, {speaker:'*', ...}, {default:true, ...统一配置}] 
  // -> { map('xxx'->cfg, '*'->fallback), base(统一配置，字段级被子规则覆盖) }
  InkRuntime._buildSpeakerPatternMap = function(patterns) {
    if (!patterns || !Array.isArray(patterns) || patterns.length === 0) return null;
    const map = new Map();
    let base = null;
    for (const p of patterns) {
      if (!p || !p.speaker) continue;
      if (p.default === true) {
        if (!base) base = p;
        continue;
      }
      if (!map.has(p.speaker)) map.set(p.speaker, p);
    }
    if (!base && map.size === 0) return null;
    return { map, base: base || null };
  };

  InkRuntime.init = async function() {
    this.destroy();
    const containers = document.querySelectorAll('[data-ink-story]');
    if (containers.length === 0) return;
    const tasks = [];
    for (const container of containers) {
      const storyFile = container.getAttribute('data-ink-story');
      if (!storyFile) continue;
      tasks.push(this.loadStory(container, storyFile));
    }
    await Promise.all(tasks);
  };

  InkRuntime.destroy = function() {
    if (typeof this._cancelScrollAnim === 'function') this._cancelScrollAnim();

    for (const [, data] of this.stories) {
      const payload = {
        state: data.story.state.ToJson(),
        renderLog: (data.renderLog || []).slice(-RENDER_LOG_MAX),
        segmentLog: (data.segmentLog || []).slice(-RENDER_LOG_MAX),
        singleSentenceMode: !!data.singleSentenceMode,
        pendingInput: data.pendingInput || null
      };
      try {
        localStorage.setItem(LS_STATE_PREFIX + data.storyFile, JSON.stringify({ v: CACHE_VERSION, ...payload }));
      } catch (e) { /* 存储满或隐私模式 */ }
      this.stateCache.set(data.storyFile, payload);
    }
    this.stories.clear();
  };

  // --- 公共工具 ---
  InkRuntime._applyStyleDef = function(styleDef, el) {
    if (!el || !styleDef) return;
    if (typeof styleDef === 'string') {
      const classes = styleDef.split(/\s+/);
      for (let i = 0, len = classes.length; i < len; i++) {
        const cls = classes[i];
        if (cls) el.classList.add(cls);
      }
    } else if (typeof styleDef === 'object') {
      const keys = Object.keys(styleDef);
      for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i];
        const val = styleDef[key];
        if (val === null || val === undefined || val === '') continue;
        try { el.style[key] = String(val); } catch (e) {}
      }
    }
  };

  InkRuntime.formatTimestamp = function(timestamp) {
    const date = new Date(timestamp);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  };

  InkRuntime.isAnimationEnabled = function() {
    return window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  };

  InkRuntime.showAfter = function(delay, element) {
    if (this.isAnimationEnabled()) {
      setTimeout(() => element.classList.add('show'), delay);
    } else {
      element.classList.add('show');
    }
  };

  InkRuntime.removeAll = function(parent, selector) {
    const allElements = parent.querySelectorAll(selector);
    for (let i = allElements.length - 1; i >= 0; i--) {
      const el = allElements[i];
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  };

  InkRuntime.flashButton = function(btn, isError) {
    const cls = isError ? 'error' : 'flash';
    btn.classList.add(cls);
    setTimeout(() => btn.classList.remove(cls), 1000);
  };

  // --- Ink 文本预处理：变量注入、管道符转义 ---
  InkRuntime._injectVarDeclarations = function(inkText) {
    if (!inkText) return inkText;
    const declared = new Set();

    RE_VAR_DECL.lastIndex = 0;
    let m;
    while ((m = RE_VAR_DECL.exec(inkText)) !== null) declared.add(m[1]);

    RE_INPUT_TAG.lastIndex = 0;
    while ((m = RE_INPUT_TAG.exec(inkText)) !== null) {
      if (!declared.has(m[1])) declared.add(m[1] + '§INPUT');
    }

    RE_TUNNEL_ASSIGN.lastIndex = 0;
    while ((m = RE_TUNNEL_ASSIGN.exec(inkText)) !== null) {
      if (!declared.has(m[1])) declared.add(m[1] + '§TUNNEL');
    }

    const toInject = [];
    for (const entry of declared) {
      const sepIdx = entry.indexOf('§');
      if (sepIdx === -1) continue;
      const name = entry.slice(0, sepIdx);
      const kind = entry.slice(sepIdx + 1);
      if (!name || declared.has(name)) continue;
      const init = kind === 'INPUT' ? '""' : '0';
      toInject.push(`VAR ${name} = ${init}`);
      declared.add(name);
    }

    if (toInject.length === 0) return inkText;

    const header = '// ↓ youWiki 自动注入变量声明（无需手动 VAR）↓\n'
      + toInject.join('\n')
      + '\n// ↑ 自动注入结束 ↑\n\n';

    return header + inkText.replace(RE_BOM, '');
  };

  InkRuntime._escapePipeInTags = function(inkText) {
    if (!inkText) return inkText;
    RE_TAG_LINE.lastIndex = 0;
    return inkText.replace(RE_TAG_LINE, (match, prefix, rest) => {
      const escaped = rest
        .replace(/\|\|/g, '^^')
        .replace(/\|/g, '^');
      return prefix + escaped;
    });
  };

  // ink 把 // 视为注释，标签里的 URL（如 https://...）会在编译时被截断；
  // 编译前用占位符保护标签行内的 //，编译后由 _restoreProtectedSlashes 还原
  const SLASH_PROTECT = '\u0001\u0001';
  InkRuntime._protectSlashInTags = function(inkText) {
    if (!inkText) return inkText;
    RE_TAG_LINE.lastIndex = 0;
    return inkText.replace(RE_TAG_LINE, (match, prefix, rest) => {
      return prefix + rest.replace(/\/\//g, SLASH_PROTECT);
    });
  };

  InkRuntime._restoreProtectedSlashes = function(node) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (typeof node[i] === 'string') node[i] = node[i].replace(/\u0001\u0001/g, '//');
        else this._restoreProtectedSlashes(node[i]);
      }
    } else if (node && typeof node === 'object') {
      for (const k in node) {
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        const v = node[k];
        if (typeof v === 'string') node[k] = v.replace(/\u0001\u0001/g, '//');
        else this._restoreProtectedSlashes(v);
      }
    }
  };

  // --- 编译缓存：读 / 写 ---
  InkRuntime._getCachedCompiled = function(storyFile) {
    if (this._compiledCache.has(storyFile)) return this._compiledCache.get(storyFile);
    const isLocal = Cache && typeof Cache.isLocalServer === 'function' && Cache.isLocalServer();
    if (isLocal) return null;
    try {
      const raw = localStorage.getItem(LS_COMPILED_PREFIX + storyFile);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== CACHE_VERSION) return null;
      this._compiledCache.set(storyFile, parsed.json);
      return parsed.json;
    } catch (e) { return null; }
  };

  InkRuntime._setCachedCompiled = function(storyFile, json) {
    this._compiledCache.set(storyFile, json);
    const isLocal = Cache && typeof Cache.isLocalServer === 'function' && Cache.isLocalServer();
    if (isLocal) return;
    try {
      const toStore = JSON.stringify({ v: CACHE_VERSION, json });
      if (toStore.length > COMPILED_MAX_LOCAL) return; // 太大就放弃本地存
      localStorage.setItem(LS_COMPILED_PREFIX + storyFile, toStore);
    } catch (e) { /* localStorage 满或隐私模式 */ }
  };

  // --- storyData ---
  InkRuntime._createStoryData = function(story, container, json, storyFile, overrides) {
    const o = overrides || {};
    const renderLog = (o.renderLog !== undefined ? o.renderLog : []).slice(-RENDER_LOG_MAX);
    const segmentLog = (o.segmentLog !== undefined ? o.segmentLog : []).slice(-RENDER_LOG_MAX);
    return {
      story: story,
      container: container,
      json: json,
      storyFile: storyFile,
      renderLog: renderLog,
      segmentLog: segmentLog,
      restoreLog: o.restoreLog !== undefined ? (o.restoreLog ? o.restoreLog.slice(-RENDER_LOG_MAX) : null) : null,
      pendingImages: 0,
      singleSentenceMode: !!o.singleSentenceMode,
      pendingInput: o.pendingInput !== undefined ? o.pendingInput : null
    };
  };

  InkRuntime._pushRenderLog = function(storyData, entry) {
    if (!storyData) return;
    storyData.renderLog.push(entry);
    storyData.segmentLog.push(entry);
    if (storyData.renderLog.length > RENDER_LOG_MAX) storyData.renderLog.splice(0, storyData.renderLog.length - RENDER_LOG_MAX);
    if (storyData.segmentLog.length > RENDER_LOG_MAX) storyData.segmentLog.splice(0, storyData.segmentLog.length - RENDER_LOG_MAX);
  };

  // --- Checkpoint---
  InkRuntime._saveCheckpoint = function(storyFile, story, storyData) {
    if (!storyFile || !story || !storyData) return;
    try {
      const payload = {
        v: CACHE_VERSION,
        state: story.state.ToJson(),
        renderLog: (storyData.renderLog || []).slice(-RENDER_LOG_MAX),
        segmentLog: (storyData.segmentLog || []).slice(-RENDER_LOG_MAX),
        singleSentenceMode: !!storyData.singleSentenceMode
      };
      localStorage.setItem(LS_CHECKPOINT_PREFIX + storyFile, JSON.stringify(payload));
    } catch (e) { /* 存储满或隐私模式，静默忽略 */ }
  };

  InkRuntime._clearPersistedState = function(storyFile) {
    if (!storyFile) return;
    try { localStorage.removeItem(LS_CHECKPOINT_PREFIX + storyFile); } catch (e) {}
    try { localStorage.removeItem(LS_STATE_PREFIX + storyFile); } catch (e) {}
  };

  // --- 故事加载 ---
  InkRuntime.loadStory = async function(container, storyFile) {
    try {
      if (!storyFile.toLowerCase().endsWith('.ink')) {
        storyFile = storyFile + '.ink';
        container.setAttribute('data-ink-story', storyFile);
      }

      let pending = this._loadStoryPromises.get(storyFile);
      if (!pending) {
        pending = this._doLoadStoryOnce(storyFile);
        this._loadStoryPromises.set(storyFile, pending);
        // catch 兜底：加载失败时 finally 派生的 promise 也要有人接住，避免 unhandledrejection
        pending.catch(() => {}).finally(() => this._loadStoryPromises.delete(storyFile));
      }
      const { json, inkText } = await pending;

      const story = new inkjs.Story(json);
      this.bindExternalFunctions(story);

      const memoryWasEmpty = !this.stateCache.has(storyFile);

      let cached = this.stateCache.get(storyFile);
      if (!cached) {
        try {
          const raw = localStorage.getItem(LS_STATE_PREFIX + storyFile);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.v === CACHE_VERSION) cached = parsed;
          }
        } catch (e) { cached = null; }
      }

      if (memoryWasEmpty) {
        try {
          const rawCk = localStorage.getItem(LS_CHECKPOINT_PREFIX + storyFile);
          if (rawCk) {
            const ck = JSON.parse(rawCk);
            if (ck && ck.v === CACHE_VERSION) {
              cached = {
                state: ck.state,
                renderLog: ck.renderLog || [],
                segmentLog: ck.segmentLog || [],
                singleSentenceMode: !!ck.singleSentenceMode,
                pendingInput: null
              };
            }
          }
        } catch (e) { /* checkpoint 解析失败，退回 destroy save */ }
      }

      if (cached) {
        try { story.state.LoadJson(cached.state); } catch (e) { console.warn('恢复 ink state 失败:', e); cached = null; }
        this.stateCache.delete(storyFile);
      }

      const storyData = this._createStoryData(story, container, json, storyFile, cached ? {
        renderLog: cached.renderLog || [],
        segmentLog: cached.segmentLog || [],
        restoreLog: cached.segmentLog || [],
        singleSentenceMode: !!cached.singleSentenceMode,
        pendingInput: cached.pendingInput || null
      } : null);

      this.stories.set(container, storyData);
      this.renderStory(container);
    } catch (error) {
      console.error('InkRuntime: 加载故事失败:', error);
      const message = error && error.message ? error.message : String(error);
      const stack = error && error.stack ? String(error.stack).replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
      const detail = stack
        ? `<p style="margin-top:0.5rem; font-size:0.8125rem; color: var(--color-muted); text-align:left; white-space:pre-wrap; max-width:100%; overflow:auto;">${stack}</p>`
        : '';
      container.innerHTML = `
        <div class="ink-error">
          <i class="fa-solid fa-exclamation-triangle"></i>
          <p>加载故事文件失败: ${this.escapeHtml(message)}</p>
          ${detail}
        </div>
      `;
    }
  };

  InkRuntime._doLoadStoryOnce = async function(storyFile) {
    const cachedJson = this._getCachedCompiled(storyFile);
    if (cachedJson) return { json: cachedJson, inkText: null };

    const isLocal = Cache && typeof Cache.isLocalServer === 'function' && Cache.isLocalServer();
    const fetchOpts = isLocal ? { cache: 'no-store' } : undefined;
    const response = await fetch(`data/ink/${storyFile}`, fetchOpts);
    if (!response.ok) throw new Error(`加载故事文件失败: ${response.status}`);

    const inkText = await response.text();
    const processedText = this._protectSlashInTags(this._escapePipeInTags(this._injectVarDeclarations(inkText)));
    const compiler = new inkjs.Compiler(processedText);
    const compiledStory = compiler.Compile();
    const json = JSON.parse(compiledStory.ToJson());
    this._restoreProtectedSlashes(json);

    this._setCachedCompiled(storyFile, json);
    return { json, inkText };
  };
})();
