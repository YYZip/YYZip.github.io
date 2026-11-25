(function() {
  'use strict';
  // ===== InkRuntime 模块 5：入口（外部函数绑定 + 最终挂载到 window） =====
  // 加载顺序：core -> text -> save -> render -> 本文件
  const InkRuntime = window.InkRuntime = window.InkRuntime || {};

  // 种子默认上限：int32 安全范围
  const MAX_SEED = 2147483647;

  // --- RANDOM / FLOAT_RANDOM / SEED_RANDOM 的基础浮点随机 [0,1) ---
  InkRuntime._stateNextFloat = function(story) {
    const s = (story && story.state) ? story.state : null;

    // 无 state 时退化为原生 Math.random
    if (!s) return Math.random();

    // 懒初始化种子与步数
    let seed = s.__seed__;
    if (typeof seed !== 'number' || isNaN(seed)) {
      seed = (Math.random() * MAX_SEED) | 0;
      s.__seed__ = seed;
    }
    let step = s.__step__;
    if (typeof step !== 'number' || isNaN(step)) {
      step = 0;
      s.__step__ = 0;
    }

    // xorShift32 变体混合
    let x = ((Math.abs(seed | 0) + (Math.abs(step | 0)) * 16807) | 0);
    x = (x + 0x6D2B79F5) | 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const f = ((t ^ (t >>> 14)) >>> 0) / 4294967296;

    s.__step__ = (step | 0) + 1;
    return f;
  };

  InkRuntime.bindExternalFunctions = function(story) {
    if (!story || typeof story.BindExternalFunction !== 'function') return;
    const self = this;
    try {
      const nextFloat = () => self._stateNextFloat(story);
      story.BindExternalFunction('RANDOM', (min, max) => {
        const lo = Number(min), hi = Number(max);
        if (isNaN(lo) || isNaN(hi)) return 0;
        const lower = lo < hi ? lo : hi;
        const upper = lo < hi ? hi : lo;
        return Math.floor(lower + nextFloat() * (upper - lower + 1));
      });
      story.BindExternalFunction('FLOAT_RANDOM', (min, max) => {
        const lo = Number(min), hi = Number(max);
        if (isNaN(lo) || isNaN(hi)) return 0;
        const lower = lo < hi ? lo : hi;
        const upper = lo < hi ? hi : lo;
        return lower + nextFloat() * (upper - lower);
      });
      story.BindExternalFunction('SEED_RANDOM', (seed) => {
        if (!story || !story.state) return;
        const n = Math.abs(Math.floor(Number(seed) || 0));
        story.state.__seed__ = n > MAX_SEED ? (n | 0) : n;
        story.state.__step__ = 0;
      });
    } catch (e) {
      console.warn('绑定 ink 外部函数失败:', e);
    }
  }
})();
