(function() {
  'use strict';
  // ===== InkRuntime 模块 3：存档（存取、面板渲染、读档恢复） =====
  const InkRuntime = window.InkRuntime = window.InkRuntime || {};

  const MAX_SAVES_PER_STORY = 50; // 每个故事存档上限，超过 LRU 淘汰最旧的

  // 内存缓存：_saveMetaCache[storyFile] = { ids, dirty }；_saveDataCache = Map(`storyFile_id` -> saveData)
  InkRuntime._saveMetaCache = InkRuntime._saveMetaCache || new Map();
  InkRuntime._saveDataCache = InkRuntime._saveDataCache || new Map();

  InkRuntime.getSaveIds = function(storyFile) {
    // 1) 内存命中
    let meta = this._saveMetaCache.get(storyFile);
    if (meta && meta.ids) return meta.ids.slice();
    // 2) 从 localStorage 读，并缓存
    let ids = [];
    try {
      const str = localStorage.getItem(`ink_saves_${storyFile}`);
      if (str) ids = JSON.parse(str) || [];
      if (!Array.isArray(ids)) ids = [];
    } catch (e) { ids = []; }
    this._saveMetaCache.set(storyFile, { ids, dirty: false });
    return ids.slice();
  };

  InkRuntime.setSaveIds = function(storyFile, ids) {
    const safeIds = Array.isArray(ids) ? ids.slice() : [];
    try {
      localStorage.setItem(`ink_saves_${storyFile}`, JSON.stringify(safeIds));
    } catch (e) { /* 存储满 */ }
    this._saveMetaCache.set(storyFile, { ids: safeIds, dirty: false });
  };

  InkRuntime.getSaveData = function(storyFile, id) {
    const key = `${storyFile}_${id}`;
    if (this._saveDataCache.has(key)) {
      const cached = this._saveDataCache.get(key);
      return cached === undefined ? null : cached;
    }
    let data = null;
    try {
      const str = localStorage.getItem(`ink_save_${storyFile}_${id}`);
      if (str) data = JSON.parse(str) || null;
    } catch (e) { data = null; }
    this._saveDataCache.set(key, data === null ? undefined : data);
    return data;
  };

  InkRuntime._setSaveDataCached = function(storyFile, id, data) {
    const key = `${storyFile}_${id}`;
    try {
      localStorage.setItem(`ink_save_${storyFile}_${id}`, JSON.stringify(data));
      this._saveDataCache.set(key, data);
    } catch (e) {
      // 存储失败也同步更新内存状态（至少本次会话一致）
      this._saveDataCache.set(key, data);
    }
  };

  InkRuntime._deleteSaveDataCached = function(storyFile, id) {
    const key = `${storyFile}_${id}`;
    localStorage.removeItem(`ink_save_${storyFile}_${id}`);
    this._saveDataCache.delete(key);
  };

  InkRuntime._buildSaveData = function(story, storyData, name) {
    return {
      state: story.state.ToJson(),
      renderLog: storyData?.renderLog || [],
      segmentLog: storyData?.segmentLog || [],
      singleSentenceMode: !!storyData?.singleSentenceMode,
      pendingInput: storyData?.pendingInput || null,
      timestamp: Date.now(),
      name: name || ''
    };
  };

  // LRU 淘汰：如果 ids 超过上限，删 timestamp 最小的
  InkRuntime._evictSavesIfNeeded = function(storyFile, ids) {
    if (!ids || ids.length <= MAX_SAVES_PER_STORY) return ids;
    // 收集 (id, timestamp) 并按时间升序
    const withTime = [];
    for (let i = 0, len = ids.length; i < len; i++) {
      const id = ids[i];
      const d = this.getSaveData(storyFile, id);
      withTime.push({ id, ts: d ? d.timestamp || 0 : 0 });
    }
    withTime.sort((a, b) => a.ts - b.ts);
    const toRemove = withTime.slice(0, withTime.length - MAX_SAVES_PER_STORY);
    const removeSet = new Set(toRemove.map(x => x.id));
    for (let i = 0, len = toRemove.length; i < len; i++) {
      this._deleteSaveDataCached(storyFile, toRemove[i].id);
    }
    return ids.filter(id => !removeSet.has(id));
  };

  InkRuntime.createSave = function(storyFile, story, storyData) {
    const ids = this.getSaveIds(storyFile);
    let maxId = 0;
    for (let i = 0, len = ids.length; i < len; i++) {
      if (ids[i] > maxId) maxId = ids[i];
    }
    const newId = maxId + 1;
    const saveData = this._buildSaveData(story, storyData, '');
    this._setSaveDataCached(storyFile, newId, saveData);
    ids.push(newId);
    const pruned = this._evictSavesIfNeeded(storyFile, ids);
    this.setSaveIds(storyFile, pruned);
    return newId;
  };

  InkRuntime.overwriteSave = function(storyFile, id, story, storyData) {
    const existing = this.getSaveData(storyFile, id);
    const saveData = this._buildSaveData(story, storyData, existing?.name || '');
    this._setSaveDataCached(storyFile, id, saveData);
  };

  InkRuntime.renameSave = function(storyFile, id) {
    const data = this.getSaveData(storyFile, id);
    if (!data) return;
    const name = prompt('输入存档名称：', data.name || '');
    if (name !== null) {
      data.name = name.trim();
      this._setSaveDataCached(storyFile, id, data);
    }
  };

  InkRuntime.deleteSave = function(storyFile, id) {
    this._deleteSaveDataCached(storyFile, id);
    const ids = this.getSaveIds(storyFile).filter(i => i !== id);
    this.setSaveIds(storyFile, ids);
  };

  InkRuntime.renderSavePanel = function(panel, container) {
    const storyData = this.stories.get(container);
    if (!storyData) return;
    const { story, json, storyFile } = storyData;
    const ids = this.getSaveIds(storyFile);
    const self = this;
    // 只绑定一次委托事件监听器（用 dataset 做幂等标记），避免反复刷新时堆积
    if (!panel.dataset.saveDelegated) {
      panel.dataset.saveDelegated = '1';
      panel.addEventListener('click', (e) => {
        const btn = e.target.closest('.ink-save-action-btn');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);
        if (action === 'load') {
          self.loadStoryFromSave(container, storyFile, json, id);
        } else if (action === 'overwrite') {
          self.overwriteSave(storyFile, id, story, storyData);
          self.renderSavePanel(panel, container);
        } else if (action === 'rename') {
          self.renameSave(storyFile, id);
          self.renderSavePanel(panel, container);
        } else if (action === 'delete') {
          self.deleteSave(storyFile, id);
          self.renderSavePanel(panel, container);
        }
      });
    }

    if (ids.length === 0) {
      panel.innerHTML = `
        <div class="ink-save-empty">暂无存档</div>
        <button class="ink-save-new-btn">
          <i class="fa-solid fa-plus"></i> 新建存档
        </button>
      `;
    } else {
      const listItems = [];
      for (let i = 0, len = ids.length; i < len; i++) {
        const id = ids[i];
        const data = this.getSaveData(storyFile, id);
        if (!data) continue;
        const nameHtml = data.name
          ? `<span class="ink-save-item-name">${this.escapeHtml(data.name)}</span>`
          : '';
        listItems.push(`
          <div class="ink-save-item">
            <div class="ink-save-item-info">
              <span class="ink-save-item-id">#${id}</span>
              ${nameHtml}
              <span class="ink-save-item-time">${this.formatTimestamp(data.timestamp)}</span>
            </div>
            <div class="ink-save-item-actions">
              <button class="ink-save-action-btn" data-action="load" data-id="${id}" title="读取"><i class="fa-solid fa-folder-open"></i></button>
              <button class="ink-save-action-btn" data-action="overwrite" data-id="${id}" title="覆盖"><i class="fa-solid fa-floppy-disk"></i></button>
              <button class="ink-save-action-btn" data-action="rename" data-id="${id}" title="重命名"><i class="fa-solid fa-pen"></i></button>
              <button class="ink-save-action-btn delete" data-action="delete" data-id="${id}" title="删除"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        `);
      }
      panel.innerHTML = `
        <div class="ink-save-list">${listItems.join('')}</div>
        <button class="ink-save-new-btn"><i class="fa-solid fa-plus"></i> 新建存档</button>
      `;
    }

    const refreshPanel = () => this.renderSavePanel(panel, container);

    // 新建存档按钮：每次 innerHTML 替换后元素是新的，所以每次都重新绑定
    panel.querySelector('.ink-save-new-btn').addEventListener('click', () => {
      this.createSave(storyFile, story, storyData);
      refreshPanel();
    });
  };

  InkRuntime.loadStoryFromSave = async function(container, storyFile, json, id) {
    try {
      const saveData = this.getSaveData(storyFile, id);
      if (!saveData) return;

      const story = new inkjs.Story(json);
      this.bindExternalFunctions(story);
      story.state.LoadJson(saveData.state);

      const storyData = this._createStoryData(story, container, json, storyFile, {
        renderLog: saveData.renderLog || [],
        segmentLog: saveData.segmentLog || [],
        restoreLog: saveData.segmentLog || [],
        singleSentenceMode: !!saveData.singleSentenceMode,
        pendingInput: saveData.pendingInput || null
      });
      this.stories.set(container, storyData);
      this.renderStory(container);
    } catch (error) {
      console.error('读档失败:', error);
    }
  };
})();
