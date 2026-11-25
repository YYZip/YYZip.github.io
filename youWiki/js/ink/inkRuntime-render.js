(function() {
  'use strict';
  // ===== InkRuntime 模块 2：渲染（标签解析、段落构建、推进循环、Continue、选项、输入、滚动、日志重放） =====
  const InkRuntime = window.InkRuntime = window.InkRuntime || {};

  // ===== 模块级正则（parseTag / buildParagraph 热路径反复使用，提升到外层避免重编译） =====
  const RE_IMAGE_SIZE_SEP = /[\|\^]/;
  const RE_PIPE_NORM_DOUBLE = /\|\|/g;
  const RE_PIPE_NORM_SINGLE = /\|/g;
  const RE_SPEAKER_LINE = /^<\s*([^>]+?)\s*>(.*)$/s;
  const RE_SPEAKER_SAFE = /[^\w\u4e00-\u9fa5-]+/g;
  const RE_SPEAKER_EDGE = /^_+|_+$/g;
  // INPUT 标签值支持的四种分隔符
  const INPUT_SEPS = ['||', '^^', '|', '^'];

  // 滚动动画 rAF 句柄（destroy/re-render 时可取消，避免泄漏）
  let _scrollAnimRafId = 0;
  InkRuntime._cancelScrollAnim = function() {
    if (_scrollAnimRafId) {
      cancelAnimationFrame(_scrollAnimRafId);
      _scrollAnimRafId = 0;
    }
  };

  // --- 标签解析：IMAGE / INPUT / CLASS 等 ---
  InkRuntime.parseTag = function(tag) {
    let tagStr = String(tag || '').trim();
    if (tagStr.length > 0 && tagStr.charCodeAt(0) === 35 /* # */) tagStr = tagStr.slice(1).trim();
    if (!tagStr) return null;

    const colonIdx = tagStr.indexOf(':');
    const property = (colonIdx === -1 ? tagStr : tagStr.slice(0, colonIdx)).trim();
    const value = (colonIdx === -1 ? '' : tagStr.slice(colonIdx + 1)).trim();
    if (!property) return null;

    const result = { property, value };
    const prop = property.toUpperCase();

    if (prop === 'IMAGE') {
      const toCssSize = (v) => {
        if (v === null || v === undefined) return null;
        const t = String(v).trim();
        if (!t) return null;
        return isNaN(t) ? t : t + 'px';
      };
      if (RE_IMAGE_SIZE_SEP.test(value)) {
        const norm = value.replace(RE_PIPE_NORM_DOUBLE, '^^').replace(RE_PIPE_NORM_SINGLE, '^');
        const parts = norm.split('^');
        while (parts.length < 3) parts.push(null);
        result.image = {
          src: String(parts[0] || '').trim(),
          width: (parts[1] === '' || parts[1] === null) ? null : toCssSize(parts[1]),
          height: (parts[2] === '' || parts[2] === null) ? null : toCssSize(parts[2])
        };
        return result;
      }
      const parts = value.split(/\s+/);
      const src = parts[0];
      let width = null, height = null;
      for (let i = 1, len = parts.length; i < len; i++) {
        const part = parts[i].toLowerCase();
        if (part.startsWith('width=')) width = toCssSize(part.slice(6));
        else if (part.startsWith('height=')) height = toCssSize(part.slice(7));
        else if (part.startsWith('w=')) width = toCssSize(part.slice(2));
        else if (part.startsWith('h=')) height = toCssSize(part.slice(2));
      }
      result.image = { src, width, height };
    }

    if (prop === 'INPUT') {
      let variable = value;
      let defaultValue = null;
      for (let i = 0, len = INPUT_SEPS.length; i < len; i++) {
        const sep = INPUT_SEPS[i];
        const idx = value.indexOf(sep);
        if (idx !== -1) {
          variable = value.slice(0, idx).trim();
          defaultValue = value.slice(idx + sep.length).trim();
          break;
        }
      }
      result.input = { variable: variable.trim(), defaultValue };
    }

    return result;
  };

  // --- 段落构建：说话人解析、样式应用 ---
  // 颜色/背景色支持三态管道格式 "lightValue|darkValue|customValue"（留空表示该主题用默认色）
  InkRuntime._parseTripleValue = function(raw) {
    if (raw === null || raw === undefined) return [null, null, null];
    const str = String(raw);
    if (str.indexOf('|') === -1 && str.indexOf('^') === -1) {
      const v = str.trim() || null;
      return [v, v, v]; // 只写一个值：所有主题共用
    }
    const norm = str.replace(/\|\|/g, '^^').replace(/\|/g, '^');
    const parts = norm.split('^');
    while (parts.length < 3) parts.push(null);
    return parts.slice(0, 3).map(x => {
      if (x === null || x === undefined) return null;
      const s = String(x).trim();
      return s === '' ? null : s;
    });
  };

  // 三态颜色设值时的基础变量映射：light 值同时写入基础变量，供 CSS 回退链（内容→段落→主题）使用
  const STYLE_BASE_MAP = {
    '--ink-cl': '--ink-c',
    '--ink-bgl': '--ink-bg',
    '--ink-ncl': '--ink-nc',
    '--ink-ccl': '--ink-cc'
  };

  // 三态值（"亮|暗|自定义"，单值则三主题共用）写入一组 CSS 变量
  InkRuntime._setTripleVar = function(el, group, raw) {
    if (!group || raw === null || raw === undefined || raw === '') return;
    const [l, d, c] = this._parseTripleValue(raw);
    if (l !== null && group.l) {
      el.style.setProperty(group.l, l);
      const baseVar = STYLE_BASE_MAP[group.l];
      if (baseVar) el.style.setProperty(baseVar, l);
    }
    if (d !== null && group.d) el.style.setProperty(group.d, d);
    if (c !== null && group.c) el.style.setProperty(group.c, c);
  };

  // 旧版 light 子对象语义：只覆盖亮色变量，不触碰暗色/自定义
  InkRuntime._setLightVar = function(el, group, raw) {
    if (!group || !group.l || raw === null || raw === undefined || raw === '') return;
    el.style.setProperty(group.l, String(raw));
    const baseVar = STYLE_BASE_MAP[group.l];
    if (baseVar) el.style.setProperty(baseVar, String(raw));
  };

  InkRuntime._applySpeakerStyle = function(styleDef, el, vars) {
    if (!styleDef || !el) return;
    if (typeof styleDef === 'string') { this._applyStyleDef(styleDef, el); return; }
    if (typeof styleDef !== 'object') return;

    const rest = {};
    let hasRest = false;
    for (const k in styleDef) {
      if (!Object.prototype.hasOwnProperty.call(styleDef, k)) continue;
      if (k === 'light') continue;
      const raw = styleDef[k];
      if (raw === null || raw === undefined || raw === '') continue;

      if (k === 'color' && vars && vars.color) {
        this._setTripleVar(el, vars.color, raw);
        continue;
      }
      if (k === 'backgroundColor' && vars && vars.bg) {
        this._setTripleVar(el, vars.bg, raw);
        continue;
      }
      rest[k] = raw;
      hasRest = true;
    }
    if (hasRest) this._applyStyleDef(rest, el);

    const light = styleDef.light;
    if (light && typeof light === 'object') {
      this._setLightVar(el, vars.color, light.color);
      this._setLightVar(el, vars.bg, light.backgroundColor);
    }
  };

  InkRuntime.buildParagraph = function(rawText, speakerStyles, variableSpeakerMap, variablesState, extraCfg) {
    const p = document.createElement('p');
    p.className = 'ink-paragraph';

    const normalized = String(rawText || '')
      .replace(/\u3000/g, ' ')
      .replace(/^\s+|\s+$/g, '');

    const speakerPatternMap = extraCfg && extraCfg.speakerPatternMap ? extraCfg.speakerPatternMap : null;

    const speakerMatch = normalized.match(RE_SPEAKER_LINE);

    if (!speakerMatch) {
      p.textContent = rawText;
      return p;
    }

    const speaker = speakerMatch[1].trim();
    const content = speakerMatch[2].trim();
    if (!speaker) {
      p.textContent = rawText;
      return p;
    }

    const safeSpeaker = speaker.replace(RE_SPEAKER_SAFE, '_').replace(RE_SPEAKER_EDGE, '');
    p.classList.add('ink-speaker');
    if (safeSpeaker) p.classList.add('ink-speaker-' + safeSpeaker);
    p.dataset.speaker = speaker;

    // 说话人配置匹配：精确名 → 通配符 * → 统一配置（default: true，字段级被子规则覆盖）
    const patternMaps = speakerPatternMap || null;
    const pm = patternMaps ? patternMaps.map : null;
    const basePattern = patternMaps ? patternMaps.base : null;
    let displayCfg = pm ? (pm.get(speaker) || pm.get('*') || null) : null;

    let templateKey = null;
    let styleDef = speakerStyles ? speakerStyles[speaker] : null;
    if (!styleDef && variableSpeakerMap && variablesState) {
      const varNames = Object.keys(variableSpeakerMap);
      for (let i = 0, len = varNames.length; i < len; i++) {
        const varName = varNames[i];
        try {
          const varValue = variablesState[varName];
          if (varValue !== null && varValue !== undefined && String(varValue) === speaker) {
            templateKey = variableSpeakerMap[varName];
            if (templateKey) {
              styleDef = speakerStyles ? speakerStyles[templateKey] : null;
              if (styleDef) {
                const safeTemplate = String(templateKey).replace(RE_SPEAKER_SAFE, '_').replace(RE_SPEAKER_EDGE, '');
                if (safeTemplate) p.classList.add('ink-speaker-' + safeTemplate);
              }
            }
            break;
          }
        } catch (e) {}
      }
    }

    // 变量说话人（如玩家自定义名）继承其样式模板在 speakerPatterns 中的显示配置（头像/对齐等），
    // 优先级：精确同名规则 > 模板规则 > 通配符 *
    if (templateKey && pm && pm.get(templateKey)) {
      displayCfg = pm.get(templateKey);
    }

    // speakerStyles 支持 * 通配：精确名与变量模板都未命中时作为兜底样式
    if (!styleDef && speakerStyles) styleDef = speakerStyles['*'] || null;

    // 统一配置：字段级合并，被命中规则的显式设置覆盖
    if (basePattern) {
      displayCfg = displayCfg ? Object.assign({}, basePattern, displayCfg) : basePattern;
    }

    let paraStyleDef = null;
    let inlineNameStyle = null;
    let inlineContentStyle = null;
    if (styleDef && typeof styleDef === 'object') {
      // name/content 子块只作用于对应部分，其余顶层键作用于整段
      if (styleDef.name && typeof styleDef.name === 'object') inlineNameStyle = styleDef.name;
      if (styleDef.content && typeof styleDef.content === 'object') inlineContentStyle = styleDef.content;

      const topColor = styleDef.color;
      const topBg = styleDef.backgroundColor;
      const RESERVED = { name: true, content: true, light: true, color: true, backgroundColor: true };
      const keys = Object.keys(styleDef);
      for (let i = 0, len = keys.length; i < len; i++) {
        const k = keys[i];
        if (RESERVED[k]) continue;
        const raw = styleDef[k];
        if (raw === null || raw === undefined || raw === '') continue;
        if (!paraStyleDef) paraStyleDef = {};
        paraStyleDef[k] = raw;
      }
      if (topColor !== undefined && topColor !== null && topColor !== '') {
        if (!paraStyleDef) paraStyleDef = {};
        paraStyleDef.color = topColor;
      }
      if (topBg !== undefined && topBg !== null && topBg !== '') {
        if (!paraStyleDef) paraStyleDef = {};
        paraStyleDef.backgroundColor = topBg;
      }

      // 子块未显式设置 color 时继承顶层 color
      if (inlineNameStyle && typeof inlineNameStyle === 'object') {
        if (topColor !== undefined && topColor !== null && topColor !== ''
            && (inlineNameStyle.color === undefined || inlineNameStyle.color === null || inlineNameStyle.color === '')) {
          inlineNameStyle = Object.assign({}, inlineNameStyle, { color: topColor });
        }
      }
      if (inlineContentStyle && typeof inlineContentStyle === 'object') {
        if (topColor !== undefined && topColor !== null && topColor !== ''
            && (inlineContentStyle.color === undefined || inlineContentStyle.color === null || inlineContentStyle.color === '')) {
          inlineContentStyle = Object.assign({}, inlineContentStyle, { color: topColor });
        }
      }
    }

    const hideSpeaker = displayCfg ? !!displayCfg.hideSpeaker : false;

    // 聊天记录布局（speakerPatterns 显示层配置）：avatar 头像 / align 文本对齐 /
    // avatarAlign 头像位置（与文本对齐解耦，未设置时跟随 align） / nameLayout 名称独占一行 / lastLineAlign 末行对齐
    const avatarUrl = (displayCfg && displayCfg.avatar) ? String(displayCfg.avatar).trim() : '';
    const alignValue = (displayCfg && typeof displayCfg.align === 'string') ? displayCfg.align.trim().toLowerCase() : '';
    const avatarAlign = (displayCfg && typeof displayCfg.avatarAlign === 'string') ? displayCfg.avatarAlign.trim().toLowerCase() : '';
    if (avatarUrl) p.classList.add('ink-has-avatar');
    if (alignValue === 'center') p.classList.add('ink-text-center');
    else if (alignValue === 'right') p.classList.add('ink-text-right');
    if (avatarUrl) {
      const avatarPos = avatarAlign || alignValue;
      if (avatarPos === 'right') p.classList.add('ink-avatar-right');
      else if (avatarPos === 'center') p.classList.add('ink-avatar-center');
    }
    // 未单独配置头像位置时保留 align 的旧类名，兼容依赖它们的自定义 CSS
    if (!avatarAlign && (alignValue === 'center' || alignValue === 'right')) {
      p.classList.add('ink-align-' + alignValue);
    }
    const nameLayout = (displayCfg && typeof displayCfg.nameLayout === 'string') ? displayCfg.nameLayout.trim().toLowerCase() : '';
    if (nameLayout === 'block') p.classList.add('ink-name-block');
    const lastLineAlign = (displayCfg && typeof displayCfg.lastLineAlign === 'string') ? displayCfg.lastLineAlign.trim().toLowerCase() : '';
    if (lastLineAlign === 'left') p.classList.add('ink-last-left');
    if (displayCfg && displayCfg.noIndent) p.classList.add('ink-no-indent');

    let nameEl = null;
    if (!hideSpeaker) {
      nameEl = document.createElement('span');
      nameEl.className = 'ink-speaker-name';
      const prefix = (displayCfg && displayCfg.prefix !== undefined && displayCfg.prefix !== null) ? displayCfg.prefix : '<';
      const suffix = (displayCfg && displayCfg.suffix !== undefined && displayCfg.suffix !== null) ? displayCfg.suffix : '>';
      nameEl.textContent = prefix + speaker + suffix;
      if (inlineNameStyle) this._applySpeakerStyle(inlineNameStyle, nameEl, {
        color: { l: '--ink-ncl', d: '--ink-ncd', c: '--ink-ncc' },
        bg:    { l: null,          d: null,          c: null }
      });
    }

    const contentEl = document.createElement('span');
    contentEl.className = 'ink-speaker-content';
    let contentText = content;
    if (displayCfg) {
      if (displayCfg.contentPrefix !== undefined && displayCfg.contentPrefix !== null) {
        contentText = String(displayCfg.contentPrefix) + contentText;
      }
      if (displayCfg.contentSuffix !== undefined && displayCfg.contentSuffix !== null) {
        contentText = contentText + String(displayCfg.contentSuffix);
      }
    }
    contentEl.textContent = contentText;
    if (inlineContentStyle) this._applySpeakerStyle(inlineContentStyle, contentEl, {
      color: { l: '--ink-ccl', d: '--ink-ccd', c: '--ink-ccc' },
      bg:    { l: null,         d: null,         c: null }
    });

    if (avatarUrl) {
      const avatarEl = document.createElement('img');
      avatarEl.className = 'ink-avatar';
      avatarEl.src = avatarUrl;
      avatarEl.alt = '';
      avatarEl.draggable = false;
      if (displayCfg.avatarSize) {
        avatarEl.style.width = String(displayCfg.avatarSize);
        avatarEl.style.height = String(displayCfg.avatarSize);
      }
      p.appendChild(avatarEl);
      // 名称与内容包进同一列，避免 flex 布局把两者并排
      const bodyEl = document.createElement('span');
      bodyEl.className = 'ink-speaker-body';
      if (nameEl) bodyEl.appendChild(nameEl);
      bodyEl.appendChild(contentEl);
      p.appendChild(bodyEl);
    } else {
      if (nameEl) p.appendChild(nameEl);
      p.appendChild(contentEl);
    }

    if (paraStyleDef) this._applySpeakerStyle(paraStyleDef, p, {
      color: { l: '--ink-cl',  d: '--ink-cd',  c: '--ink-cc2' },
      bg:    { l: '--ink-bgl', d: '--ink-bgd', c: '--ink-bgc' }
    });
    return p;
  };

  // --- 渲染日志重放（存档恢复用） ---
  InkRuntime.replayLog = function(log, contentEl, speakerStyles, variableSpeakerMap, variablesState, storyData, extraCfg) {
    if (!log || log.length === 0) return;
    const frag = document.createDocumentFragment();
    for (let i = 0, len = log.length; i < len; i++) {
      const entry = log[i];
      if (entry.type === 'text') {
        const p = this.buildParagraph(entry.text, speakerStyles, variableSpeakerMap, variablesState, extraCfg);
        if (entry.classes && entry.classes.length > 0) {
          for (let j = 0, jlen = entry.classes.length; j < jlen; j++) p.classList.add(entry.classes[j]);
        }
        p.classList.add('show');
        frag.appendChild(p);
      } else if (entry.type === 'image') {
        const imageElement = document.createElement('img');
        imageElement.src = entry.src;
        if (entry.width) imageElement.style.width = entry.width;
        if (entry.height) imageElement.style.height = entry.height;
        imageElement.classList.add('ink-image', 'show');
        if (storyData) {
          storyData.pendingImages++;
          imageElement.onload = () => { storyData.pendingImages--; };
          imageElement.onerror = () => { storyData.pendingImages--; };
        }
        frag.appendChild(imageElement);
      }
    }
    contentEl.appendChild(frag);
  };

  // --- 滚动与定位：使用缓存的 mainContainer + 可取消 rAF ---
  InkRuntime.getContentBottomY = function(el) {
    const mainContainer = this._getMainContainer();
    if (!mainContainer) return 0;
    if (!el || !el.lastElementChild) return mainContainer.scrollTop || 0;
    const mainRect = mainContainer.getBoundingClientRect();
    const lastRect = el.lastElementChild.getBoundingClientRect();
    return mainContainer.scrollTop + (lastRect.bottom - mainRect.top);
  };

  InkRuntime.scrollToNewContent = function(newContentStartY, contentEl, choicesEl) {
    const mainContainer = this._getMainContainer();
    if (!mainContainer) return;

    const clientHeight = mainContainer.clientHeight;
    const maxScroll = mainContainer.scrollHeight - clientHeight;

    if (mainContainer.scrollTop > maxScroll) {
      mainContainer.scrollTop = maxScroll;
      return;
    }

    if (!this.isAnimationEnabled()) return;

    const endEl = choicesEl.lastElementChild ? choicesEl : contentEl;
    const newContentEndY = this.getContentBottomY(endEl);
    const margin = 20;

    let target = Math.min(
      newContentStartY,
      Math.max(0, newContentEndY - clientHeight + margin)
    );
    target = Math.min(target, maxScroll);

    if (target <= mainContainer.scrollTop) return;

    // 取消前一次未完成的滚动动画，避免抖动/竞争
    this._cancelScrollAnim();

    const start = mainContainer.scrollTop;
    const dist = target - start;
    const duration = Math.min(300 + 300 * dist / 100, 800);
    let startTime = null;

    const step = (time) => {
      if (startTime === null) startTime = time;
      const t = Math.min((time - startTime) / duration, 1);
      const lerp = 3 * t * t - 2 * t * t * t;
      mainContainer.scrollTop = (1 - lerp) * start + lerp * target;
      if (t < 1) {
        _scrollAnimRafId = requestAnimationFrame(step);
      } else {
        _scrollAnimRafId = 0;
      }
    };
    _scrollAnimRafId = requestAnimationFrame(step);
  };

  // --- 输入框：创建、空值处理、提交确认 ---
  InkRuntime._createInputBox = function(promptText) {
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'ink-input-wrapper';

    const inputLabel = document.createElement('label');
    inputLabel.className = 'ink-input-label';
    inputLabel.textContent = promptText || '请输入：';

    const inputField = document.createElement('input');
    inputField.type = 'text';
    inputField.className = 'ink-input-field';
    inputField.maxLength = 20;

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'ink-input-submit ink-ctrl-btn';
    submitBtn.textContent = '确定';

    inputWrapper.appendChild(inputLabel);
    inputWrapper.appendChild(inputField);
    inputWrapper.appendChild(submitBtn);
    return { inputWrapper, inputField, submitBtn };
  };

  InkRuntime._resolveEmptyInput = function(value, story, variable, defaultValue) {
    if (value) return value;
    if (defaultValue !== null && defaultValue !== undefined && defaultValue !== '') {
      return defaultValue;
    }
    try {
      const existing = story.variablesState[variable];
      if (existing !== null && existing !== undefined) return String(existing);
    } catch (e) {}
    return value;
  };

  InkRuntime._finalizeInputSubmission = function(story, storyData, variable, promptText, value, inputField, submitBtn, inputWrapper) {
    submitBtn.style.display = 'none';
    submitBtn.disabled = true;
    inputField.disabled = true;
    try {
      story.variablesState[variable] = value;
    } catch (e) {
      console.warn('设置 ink 变量失败:', variable, e);
    }
    if (storyData) {
      storyData.pendingInput = null;
      const entry = { type: 'text', text: promptText, classes: [] };
      this._pushRenderLog(storyData, entry);
    }
    inputWrapper.classList.add('ink-input-submitted');
  };

  // --- 选项/继续按钮渲染 ---
  InkRuntime._renderChoices = function(choicesEl, story, storyData, delay, stepDelay, onAdvance) {
    let d = delay;
    const choiceCount = story.currentChoices.length;
    if (choiceCount > 0) {
      const frag = document.createDocumentFragment();
      const delayedNodes = [];
      for (let index = 0; index < choiceCount; index++) {
        const choice = story.currentChoices[index];
        const customClasses = [];
        let isClickable = true;
        for (let ci = 0, clen = choice.tags.length; ci < clen; ci++) {
          const ct = choice.tags[ci];
          const ctUp = ct.toUpperCase();
          if (ctUp === 'UNCLICKABLE') { isClickable = false; continue; }
          const p = this.parseTag(ct);
          if (p && p.property && p.property.toUpperCase() === 'CLASS') customClasses.push(p.value);
        }
        const cp = document.createElement('p');
        cp.classList.add('ink-choice');
        for (let ci = 0, clen = customClasses.length; ci < clen; ci++) cp.classList.add(customClasses[ci]);
        cp.innerHTML = isClickable
          ? `<a href="#">${choice.text}</a>`
          : `<span class="unclickable">${choice.text}</span>`;
        frag.appendChild(cp);
        delayedNodes.push({ node: cp, delay: d, clickable: isClickable, index });
        d += stepDelay;
      }
      choicesEl.appendChild(frag);

      for (let i = 0, len = delayedNodes.length; i < len; i++) {
        const item = delayedNodes[i];
        this.showAfter(item.delay, item.node);
        if (item.clickable) {
          const choiceIdx = item.index;
          item.node.querySelector('a').addEventListener('click', (e) => {
            e.preventDefault();
            this.removeAll(choicesEl, '.ink-choice');
            if (storyData) storyData.segmentLog = [];
            story.ChooseChoiceIndex(choiceIdx);
            // 做出选项后立刻保存 checkpoint，刷新后回到此决策点之后
            if (storyData && storyData.storyFile) this._saveCheckpoint(storyData.storyFile, story, storyData);
            onAdvance();
          });
        }
      }
    } else if (story.canContinue) {
      const cp = document.createElement('p');
      cp.className = 'ink-choice';
      cp.innerHTML = '<a href="#">继续阅读 ▼</a>';
      choicesEl.appendChild(cp);
      this.showAfter(d, cp);
      cp.querySelector('a').addEventListener('click', (e) => {
        e.preventDefault();
        this.removeAll(choicesEl, '.ink-choice');
        onAdvance();
      });
    }
    return d;
  };

  // --- 核心故事推进循环（合并原先三处 while 模式） ---
  InkRuntime._advanceStory = function(params) {
    const {
      story, contentEl, choicesEl, storyData,
      initialDelay, scheduleScroll,
      speakerStyles, variableSpeakerMap, variablesState, stepDelay,
      speakerPatternMap,
      onInputEncountered
    } = params;

    let delay = initialDelay;
    let stoppedForInput = false;
    let displayedAnything = false;

    while (story.canContinue) {
      const result = this.continueOnce({
        story, contentEl, choicesEl, storyData,
        delay, scheduleScroll, stepDelay,
        speakerStyles, variableSpeakerMap, variablesState,
        speakerPatternMap,
        onInputEncountered
      });
      if (!result) break;
      delay = result.delay;
      if (result.shouldStop) {
        if (result.isInput) stoppedForInput = true;
        break;
      }
      if (result.displayed) {
        displayedAnything = true;
        if (storyData && storyData.singleSentenceMode) break;
      }
    }
    return { delay, stoppedForInput, displayedAnything };
  };

  // --- 单次 Continue 处理：标签、文本、图片、INPUT 等 ---
  InkRuntime.continueOnce = function(params) {
    const {
      story, contentEl, choicesEl, storyData,
      delay, scheduleScroll, stepDelay,
      speakerStyles, variableSpeakerMap, variablesState,
      speakerPatternMap,
      onInputEncountered
    } = params;
    const self = this;

    const text = story.Continue();
    const tags = story.currentTags;

    let shouldRestart = false;
    let shouldClear = false;
    const customClasses = [];
    let tagDelay = delay;
    let hasImage = false;

    for (let ti = 0, tlen = tags.length; ti < tlen; ti++) {
      const tag = tags[ti];
      if (tag === 'CLEAR') { shouldClear = true; continue; }
      if (tag === 'RESTART') { shouldRestart = true; continue; }

      const parsed = this.parseTag(tag);
      if (!parsed || !parsed.property) continue;
      const property = parsed.property.toUpperCase();

      if (property === 'IMAGE' && parsed.image) {
        const { src, width, height } = parsed.image;
        const imageElement = document.createElement('img');
        imageElement.src = src;
        if (width) imageElement.style.width = width;
        if (height) imageElement.style.height = height;
        imageElement.classList.add('ink-image');

        if (storyData) {
          storyData.pendingImages++;
          imageElement.onload = () => { storyData.pendingImages--; scheduleScroll && scheduleScroll(); };
          imageElement.onerror = () => { storyData.pendingImages--; scheduleScroll && scheduleScroll(); };
          const entry = { type: 'image', src, width, height };
          self._pushRenderLog(storyData, entry);
        }
        contentEl.appendChild(imageElement);
        self.showAfter(tagDelay, imageElement);
        tagDelay += stepDelay;
        hasImage = true;
        continue;
      }

      if (property === 'CLASS') { customClasses.push(parsed.value); continue; }
      if (property === 'LINK') { window.location.href = parsed.value; continue; }
      if (property === 'LINKOPEN') { window.open(parsed.value); continue; }

      if (property === 'INPUT' && parsed.input) {
        const { variable, defaultValue } = parsed.input;
        const promptText = text.trim();

        if (storyData) {
          storyData.pendingInput = { variable, defaultValue: defaultValue || null, promptText };
        }

        const { inputWrapper, inputField, submitBtn } = self._createInputBox(promptText);
        contentEl.appendChild(inputWrapper);
        self.showAfter(tagDelay, inputWrapper);
        const inputShownDelay = tagDelay + stepDelay;

        setTimeout(() => inputField.focus(), Math.max(inputShownDelay - 50, 0));

        const submitHandler = () => {
          if (submitBtn.disabled) return;
          const raw = inputField.value.trim();
          const value = self._resolveEmptyInput(raw, story, variable, defaultValue);
          self._finalizeInputSubmission(story, storyData, variable, promptText, value, inputField, submitBtn, inputWrapper);
          // 输入提交后立刻保存 checkpoint，刷新后回到此决策点之后
          if (storyData && storyData.storyFile) self._saveCheckpoint(storyData.storyFile, story, storyData);
          if (onInputEncountered) onInputEncountered.afterSubmit();
        };

        submitBtn.addEventListener('click', submitHandler);
        inputField.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); submitHandler(); }
        });

        return { delay: inputShownDelay, displayed: false, shouldStop: true, isInput: true };
      }
    }

    if (shouldRestart) {
      story.ResetState();
      contentEl.innerHTML = '';
      if (storyData) {
        storyData.renderLog = [];
        storyData.segmentLog = [];
        // 脚本内 # RESTART 标签也清掉持久化进度 + checkpoint，刷新从故事头开始
        if (storyData.storyFile) self._clearPersistedState(storyData.storyFile);
      }
      return null;
    }

    if (shouldClear) {
      contentEl.innerHTML = '';
      if (storyData) {
        storyData.renderLog = [];
        storyData.segmentLog = [];
      }
    }

    const cleanText = text.trim();
    if (cleanText.length === 0) {
      return { delay: tagDelay, displayed: hasImage };
    }

    const paragraph = self.buildParagraph(cleanText, speakerStyles, variableSpeakerMap, variablesState, { speakerPatternMap });
    for (let i = 0, len = customClasses.length; i < len; i++) paragraph.classList.add(customClasses[i]);
    contentEl.appendChild(paragraph);

    if (storyData) {
      const entry = { type: 'text', text: cleanText, classes: customClasses.slice() };
      self._pushRenderLog(storyData, entry);
    }

    self.showAfter(tagDelay, paragraph);
    return { delay: tagDelay + stepDelay, displayed: true };
  };

  // --- 渲染主入口：构建 UI、绑定控件事件、驱动渲染循环 ---
  InkRuntime.renderStory = async function(container) {
    const self = this;
    const storyData = this.stories.get(container);
    if (!storyData) return;

    // 重渲染前取消旧动画，避免泄漏
    this._cancelScrollAnim();

    const { story, json, storyFile } = storyData;
    // 按故事合并通用配置与独立配置（data/ink/ink.json + <故事名>.json）
    const { speakerStyles, variableSpeakerMap, stepDelay, speakerPatternMap } = await this.getStoryInkConfig(storyFile);
    const variablesState = story.variablesState;

    container.innerHTML = `
      <div class="ink-story-content"></div>
      <div class="ink-choices"></div>
      <div class="ink-controls">
        <button class="ink-ctrl-btn ink-quick-save" title="快速存档"><i class="fa-solid fa-bookmark"></i></button>
        <button class="ink-ctrl-btn ink-quick-load" title="快速读档"><i class="fa-solid fa-book-bookmark"></i></button>
        <button class="ink-ctrl-btn ink-save-toggle" title="存档管理"><i class="fa-solid fa-folder"></i></button>
        <button class="ink-ctrl-btn ink-single-toggle ${storyData.singleSentenceMode ? 'active' : ''}" title="单句模式"><i class="fa-solid fa-align-left"></i></button>
        <button class="ink-ctrl-btn ink-restart-btn" title="重新开始"><i class="fa-solid fa-rotate-right"></i></button>
      </div>
      <div class="ink-save-panel"></div>
    `;

    const contentEl = container.querySelector('.ink-story-content');
    const choicesEl = container.querySelector('.ink-choices');
    const restartBtn = container.querySelector('.ink-restart-btn');
    const saveToggle = container.querySelector('.ink-save-toggle');
    const savePanel = container.querySelector('.ink-save-panel');
    const quickSaveBtn = container.querySelector('.ink-quick-save');
    const quickLoadBtn = container.querySelector('.ink-quick-load');
    const singleToggle = container.querySelector('.ink-single-toggle');

    if (storyData.restoreLog && storyData.restoreLog.length > 0) {
      this.replayLog(storyData.restoreLog, contentEl, speakerStyles, variableSpeakerMap, variablesState, storyData, { speakerPatternMap });
      storyData.restoreLog = null;
    }

    const refreshSavePanelIfOpen = () => {
      if (savePanel.classList.contains('open')) {
        this.renderSavePanel(savePanel, container);
      }
    };

    const render = (baseDelay) => {
      const newContentStartY = this.getContentBottomY(contentEl);
      choicesEl.innerHTML = '';

      const scheduleScroll = () => {
        if (!storyData || storyData.pendingImages > 0) return;
        this.scrollToNewContent(newContentStartY, contentEl, choicesEl);
      };

      const startDelay = typeof baseDelay === 'number' ? baseDelay : 0;
      const advance = this._advanceStory({
        story, contentEl, choicesEl, storyData,
        initialDelay: startDelay, scheduleScroll,
        speakerStyles, variableSpeakerMap, variablesState, stepDelay,
        speakerPatternMap,
        onInputEncountered: {
          afterSubmit: () => {
            scheduleScroll();
            const postAdvance = this._advanceStory({
              story, contentEl, choicesEl, storyData,
              initialDelay: 0, scheduleScroll,
              speakerStyles, variableSpeakerMap, variablesState, stepDelay,
              speakerPatternMap,
              onInputEncountered: null
            });
            if (postAdvance.stoppedForInput) return;
            if (story.currentChoices.length > 0 || story.canContinue) {
              this._renderChoices(choicesEl, story, storyData, postAdvance.delay, stepDelay, render);
            }
            scheduleScroll();
          }
        }
      });

      if (advance.stoppedForInput) {
        this.scrollToNewContent(newContentStartY, contentEl, choicesEl);
        return;
      }

      this._renderChoices(choicesEl, story, storyData, advance.delay, stepDelay, render);
      this.scrollToNewContent(newContentStartY, contentEl, choicesEl);
    };

    restartBtn.addEventListener('click', () => {
      const currentSingleMode = storyData.singleSentenceMode;
      // 清除持久化进度与 checkpoint，保证刷新后从故事头开始
      self._clearPersistedState(storyFile);
      const newStory = new inkjs.Story(json);
      this.bindExternalFunctions(newStory);
      const newData = this._createStoryData(newStory, container, json, storyFile, {
        singleSentenceMode: currentSingleMode
      });
      this.stories.set(container, newData);
      this.renderStory(container);
    });

    saveToggle.addEventListener('click', () => {
      savePanel.classList.toggle('open');
      saveToggle.classList.toggle('active');
      this.renderSavePanel(savePanel, container);
    });

    quickSaveBtn.addEventListener('click', () => {
      this.createSave(storyFile, story, storyData);
      this.flashButton(quickSaveBtn);
      refreshSavePanelIfOpen();
    });

    quickLoadBtn.addEventListener('click', () => {
      const ids = this.getSaveIds(storyFile);
      if (ids.length === 0) {
        this.flashButton(quickLoadBtn, true);
        return;
      }
      // 取最新的存档（按 timestamp）
      let latestId = null;
      let latestTime = 0;
      for (let i = 0, len = ids.length; i < len; i++) {
        const id = ids[i];
        const data = this.getSaveData(storyFile, id);
        if (data && data.timestamp > latestTime) {
          latestTime = data.timestamp;
          latestId = id;
        }
      }
      if (latestId) this.loadStoryFromSave(container, storyFile, json, latestId);
    });

    singleToggle.addEventListener('click', () => {
      storyData.singleSentenceMode = !storyData.singleSentenceMode;
      singleToggle.classList.toggle('active', storyData.singleSentenceMode);
      // 关闭单句时若存在待输入框，不应 render() 推进故事（会跳过输入）
      if (!storyData.singleSentenceMode && !storyData.pendingInput && story.canContinue) {
        this.removeAll(choicesEl, '.ink-choice');
        render();
      }
    });

    if (storyData.pendingInput) {
      const pi = storyData.pendingInput;
      const { inputWrapper, inputField, submitBtn } = this._createInputBox(pi.promptText);
      contentEl.appendChild(inputWrapper);
      inputWrapper.classList.add('show');
      setTimeout(() => inputField.focus(), 0);

      const restoreSubmit = () => {
        if (submitBtn.disabled) return;
        const raw = inputField.value.trim();
        const value = this._resolveEmptyInput(raw, story, pi.variable, pi.defaultValue);
        this._finalizeInputSubmission(story, storyData, pi.variable, pi.promptText, value, inputField, submitBtn, inputWrapper);
        render();
      };
      submitBtn.addEventListener('click', restoreSubmit);
      inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); restoreSubmit(); }
      });
    } else {
      render();
    }
  };
})();
