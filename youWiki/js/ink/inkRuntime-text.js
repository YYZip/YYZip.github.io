(function() {
  'use strict';
  // ===== InkRuntime 模块 4：纯文本提取（搜索、字数统计、引用解析） =====
  const InkRuntime = window.InkRuntime = window.InkRuntime || {};

  // ===== 模块级正则（提升到外层，避免每次 extractInkPlainText 调用重新编译） =====
  const RE_BOM = /^\uFEFF/;
  const RE_LINE_COMMENT = /^\s*\/\/.*$/gm;
  const RE_DIRECTIVE_LINE = /^\s*#\s*(VAR|CONST|INCLUDE|IMPORT|DEFINE|LIST|EXTERNAL)\b.*$/gim;
  const RE_TAG_WITH_PIPE_DEFAULT = /^\s*#\s*[A-Za-z_][A-Za-z0-9_]*\s*:[^\n]*$/gm;
  const RE_PIPE_DEFAULT_CAPTURE = /[|^]([^|^\n]+)$/;
  const RE_KNOT_HEADER = /^\s*=+\s*[A-Za-z_][A-Za-z0-9_]*.*$/gm;
  const RE_DIVERT = /^\s*->.*$/gm;
  const RE_TUNNEL_RETURN = /^\s*<-.*$/gm;
  const RE_TUNNEL_ASSIGN = /^\s*~.*$/gm;
  const RE_CHOICE_PREFIX = /^\s*([*+\-])+\s*/gm;
  const RE_BRACKETED_ALT = /^\s*\[[^\]]*\]\s*/gm;
  const RE_COND_BLOCK = /\{[^{}]*\s*:\s*[^{}]*\}/g;
  const RE_COND_OPEN_LEFT = /\{[^{}]*\s*:\s*/g;
  const RE_COND_CLOSE = /\}/g;
  const RE_ELSE_LINE_START = /^\s*-\s*else\b.*$/gim;
  const RE_ELSE_IN_LINE = /(^|\s)-\s*else\b.*$/gim;
  const RE_ELSE_KEYWORD = /\belse\s*:?/g;
  const RE_SPEAKER_ANGLE = /<([^>]+)>/g;
  const RE_FUNC_CALL = /\{([^{}]+)\}/g;
  const RE_FUNC_CALL_PREFIX = /^[A-Z_][A-Z0-9_]*\s*\(/;
  const RE_LBRACE_RBRACE = /[{}]/g;
  const RE_ANGLE_BRACKETS = /[<>]/g;
  const RE_BRACKETED = /\[([^\]]*)\]/g;
  const RE_SPACES_TABS = /[ \t]+/g;
  const RE_NEWLINE_INDENT = /\n[ \t]+/g;
  const RE_MULTI_NEWLINES = /\n{3,}/g;

  // 引用解析正则
  const RE_MD_INK_REF = /\{ink\|([^{}]+)\}/g;
  const RE_HTML_INK_REF = /data-ink-story="([^"]+)"/g;

  // 纯文本缓存持久化（大小受限）
  const PLAIN_CACHE_LS_PREFIX = 'youwiki_ink_text_v1_';
  const PLAIN_CACHE_MAX_LOCAL = 500 * 1024; // 单文件不超过 500KB 才存本地

  InkRuntime.extractInkPlainText = function(inkText) {
    if (!inkText) return '';
    let text = inkText.replace(RE_BOM, '');

    text = text.replace(RE_LINE_COMMENT, '');
    text = text.replace(RE_DIRECTIVE_LINE, '');

    text = text.replace(RE_TAG_WITH_PIPE_DEFAULT, (line) => {
      const pipeMatch = line.match(RE_PIPE_DEFAULT_CAPTURE);
      if (pipeMatch) return ' ' + pipeMatch[1].trim() + ' ';
      return '';
    });

    text = text.replace(RE_KNOT_HEADER, '');
    text = text.replace(RE_DIVERT, '');
    text = text.replace(RE_TUNNEL_RETURN, '');
    text = text.replace(RE_TUNNEL_ASSIGN, '');
    text = text.replace(RE_CHOICE_PREFIX, '');
    text = text.replace(RE_BRACKETED_ALT, '');

    let prev;
    do {
      prev = text;
      text = text.replace(RE_COND_BLOCK, (block) => {
        const colonIdx = block.indexOf(':');
        if (colonIdx === -1) return '';
        const inner = block.slice(colonIdx + 1, -1);
        return ' ' + inner + ' ';
      });
    } while (text !== prev);

    text = text.replace(RE_COND_OPEN_LEFT, ' ');
    text = text.replace(RE_COND_CLOSE, ' ');

    text = text.replace(RE_ELSE_LINE_START, ' ');
    text = text.replace(RE_ELSE_IN_LINE, '$1 ');
    text = text.replace(RE_ELSE_KEYWORD, ' ');

    text = text.replace(RE_SPEAKER_ANGLE, (match, speaker) => {
      const s = speaker.trim();
      if (!s) return '';
      const cleanSpeaker = s.replace(RE_LBRACE_RBRACE, '');
      return cleanSpeaker + '：';
    });

    do {
      prev = text;
      text = text.replace(RE_FUNC_CALL, (match, inner) => {
        if (RE_FUNC_CALL_PREFIX.test(inner.trim())) return '';
        return inner;
      });
    } while (text !== prev);

    text = text.replace(RE_LBRACE_RBRACE, '');
    text = text.replace(RE_ANGLE_BRACKETS, '');
    text = text.replace(RE_BRACKETED, '$1');
    text = text.replace(RE_SPACES_TABS, ' ');
    text = text.replace(RE_NEWLINE_INDENT, '\n');
    text = text.replace(RE_MULTI_NEWLINES, '\n\n');

    return text.trim();
  };

  InkRuntime.extractInkRefs = function(content) {
    if (!content) return [];
    const refs = new Set();
    RE_MD_INK_REF.lastIndex = 0;
    let m;
    while ((m = RE_MD_INK_REF.exec(content)) !== null) {
      let name = m[1].trim();
      if (!name.toLowerCase().endsWith('.ink')) name += '.ink';
      refs.add(name);
    }
    RE_HTML_INK_REF.lastIndex = 0;
    while ((m = RE_HTML_INK_REF.exec(content)) !== null) {
      let name = m[1].trim();
      if (!name.toLowerCase().endsWith('.ink')) name += '.ink';
      refs.add(name);
    }
    return Array.from(refs);
  };

  InkRuntime.loadInkPlainText = async function(storyFile) {
    if (!storyFile) return '';
    let file = storyFile;
    if (!file.toLowerCase().endsWith('.ink')) file += '.ink';

    const isLocal = Cache && typeof Cache.isLocalServer === 'function' && Cache.isLocalServer();

    // 1) 内存缓存最快
    if (this._inkTextCache.has(file)) return this._inkTextCache.get(file);

    // 2) 本地持久化缓存（本地模式直接跳过，保证改完立刻生效）
    if (!isLocal) {
      try {
        const cachedStr = localStorage.getItem(PLAIN_CACHE_LS_PREFIX + file);
        if (cachedStr !== null && cachedStr !== undefined) {
          const cached = JSON.parse(cachedStr);
          if (cached && cached.v === 1 && typeof cached.plain === 'string') {
            this._inkTextCache.set(file, cached.plain);
            return cached.plain;
          }
        }
      } catch (e) { /* 解析失败或隐私模式，忽略 */ }
    }

    // 3) 远程加载 + 解析（本地模式强制 no-store 绕过 HTTP 缓存）
    try {
      const fetchOpts = isLocal ? { cache: 'no-store' } : undefined;
      const res = await fetch(`data/ink/${file}`, fetchOpts);
      if (!res.ok) return '';
      const inkText = await res.text();
      const plain = this.extractInkPlainText(inkText);
      this._inkTextCache.set(file, plain);

      // 写入本地缓存（本地模式不写，且大小需符合限制）
      if (!isLocal) {
        try {
          const toStore = JSON.stringify({ v: 1, plain });
          if (toStore.length <= PLAIN_CACHE_MAX_LOCAL) {
            localStorage.setItem(PLAIN_CACHE_LS_PREFIX + file, toStore);
          }
        } catch (e) { /* 空间满 */ }
      }

      return plain;
    } catch (e) {
      console.warn('InkRuntime: 加载 ink 文本失败:', file, e);
      this._inkTextCache.set(file, '');
      return '';
    }
  };
})();
