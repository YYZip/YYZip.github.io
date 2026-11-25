// 富文本处理模块，解析自定义语法
// 支持: {zhuyin}注音, {blackout}黑幕, {note}注释, {tabs}标签页, {table}表格, :star: 图标短代码等

// 常用图标短代码别名；未收录的名称直接透传为 fa-名称
const FA_SHORTCODE_MAP = {
  'white_check_mark': 'check', x: 'xmark', times: 'xmark', cross: 'xmark',
  warning: 'triangle-exclamation', question: 'circle-question', info: 'circle-info',
  smile: 'face-smile', smiley: 'face-smile', laugh: 'face-laugh-squint',
  wink: 'face-smile-wink', cry: 'face-sad-cry', sob: 'face-sad-tear',
  angry: 'face-angry', surprised: 'face-surprise', thinking: 'face-thinking',
  tada: 'champagne-glasses', zap: 'bolt', boom: 'bomb',
  bulb: 'lightbulb', memo: 'note-sticky', mag: 'magnifying-glass', coffee: 'mug-hot',
  thumbsup: 'thumbs-up', thumbsdown: 'thumbs-down', point_right: 'hand-point-right',
};

// 单参数标记 {标记|内容} 的统一替换模板（sup/sub/right/center/fa）
const SIMPLE_TAG_TEMPLATES = [
  { re: /\{sup\|([^{}]+)\}/g, to: '<sup>$1</sup>' },
  { re: /\{sub\|([^{}]+)\}/g, to: '<sub>$1</sub>' },
  { re: /\{right\|([^{}]+)\}/g, to: '<p style="text-align:right">$1</p>' },
  { re: /\{center\|([^{}]+)\}/g, to: '<p style="text-align:center">$1</p>' },
  { re: /\{fa\|([^{}]+)\}/g, to: '<i class="fa-solid fa-$1"></i>' }
];

// 自定义语法的必要特征：花括号标记或 :图标: 短代码；都不存在时可整轮跳过
const RE_MAYBE_CUSTOM = /\{|:[a-z][a-z0-9_+-]*:/;

// 标签页组计数器，用于生成互不冲突的 radio name/id
let tabGroupCounter = 0;

const RichText = {
  // markdownParser 的转义占位符按字面还原（& < > 用实体保证显示）
  restoreEscaped(html) {
    return html.replace(/\[\[ESCAPED_(\d+)\]\]/g, (match, code) => {
      const c = String.fromCharCode(Number(code));
      if (c === '&') return '&amp;';
      if (c === '<') return '&lt;';
      if (c === '>') return '&gt;';
      return c;
    });
  },

  // 图标短代码：:star: → fa 图标（名称需以字母开头，避免误匹配 12:30 这类时间文本）
  processShortcode(html) {
    return html.replace(/:([a-z][a-z0-9_+-]*):/g, (match, name) => {
      const fa = FA_SHORTCODE_MAP[name] || name;
      return `<i class="fa-solid fa-${fa}"></i>`;
    });
  },

  // 依次处理所有自定义语法；反复处理直到稳定（每轮正则只匹配不含 {} 的最内层），支持语法互相嵌套
  process(html) {
    const codeBlocks = [];
    let tempHtml = html;

    tempHtml = tempHtml.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (match, attrs, code) => {
      const index = codeBlocks.length;
      codeBlocks.push({ type: 'block', attrs, content: code });
      return `[[CODE_${index}]]`;
    });

    tempHtml = tempHtml.replace(/<code>([\s\S]*?)<\/code>/g, (match, code) => {
      const index = codeBlocks.length;
      codeBlocks.push({ type: 'inline', content: code });
      return `[[CODE_${index}]]`;
    });

    const processors = [
      'processZhuyin', 'processBlackout', 'processNote', 'processTabs',
      'processSimpleTags', 'processShortcode', 'processTable', 'processInk'
    ];
    let prev = null;
    for (let i = 0; i < 10 && tempHtml !== prev; i++) {
      prev = tempHtml;
      if (!RE_MAYBE_CUSTOM.test(tempHtml)) break;
      for (const name of processors) {
        tempHtml = this[name](tempHtml);
      }
    }

    tempHtml = this.restoreEscaped(tempHtml);

    tempHtml = tempHtml.replace(/\[\[CODE_(\d+)\]\]/g, (match, index) => {
      const code = codeBlocks[index];
      if (!code) return match;
      if (code.type === 'block') {
        return `<pre><code${code.attrs || ''}>${this.restoreEscaped(code.content)}</code></pre>`;
      } else {
        return `<code>${this.restoreEscaped(code.content)}</code>`;
      }
    });

    return tempHtml;
  },

  // 注音语法: {zhuyin|文字|拼音} → <ruby>
  processZhuyin(html) {
    const zhuyinRegex = /\{zhuyin\|([^{}]+)\|([^{}]+)\}/g;
    return html.replace(zhuyinRegex, (match, text, pinyin) => {
      return `<ruby>${text}<rp>（</rp><rt>${pinyin}</rt><rp>）</rp></ruby>`;
    });
  },

  // 黑幕语法: {blackout|文字} 或 {blackout|文字|提示} → <span class="blackout">
  processBlackout(html) {
    const blackoutWithTitleRegex = /\{blackout\|([^{}]+)\|([^{}]+)\}/g;
    const blackoutWithoutTitleRegex = /\{blackout\|([^{}]+)\}/g;

    html = html.replace(blackoutWithTitleRegex, (match, text, title) => {
      return `<span class="blackout" title="${title.replace(/"/g, '&quot;')}">${text}</span>`;
    });

    html = html.replace(blackoutWithoutTitleRegex, (match, text) => {
      return `<span class="blackout">${text}</span>`;
    });

    return html;
  },

  // 注释语法: {note|文字|注释内容} → <span class="note">文字<span class="note-tooltip">注释内容</span></span>
  // 提示框为真实元素（与 .footnote-tooltip 同构），箭头可跟随提示框移动，注释内容支持富文本
  processNote(html) {
    const noteRegex = /\{note\|([^{}]+)\|([^{}]+)\}/g;
    return html.replace(noteRegex, (match, text, note) => {
      return `<span class="note">${text}<span class="note-tooltip">${note}</span></span>`;
    });
  },

  // 标签页语法: {tabs}{tab|标题}内容{/tab}{/tabs}
  processTabs(html) {
    const tabsRegex = /\{tabs\}([\s\S]*?)\{\/tabs\}/g;

    return html.replace(tabsRegex, (match, content) => {
      const tabRegex = /\{tab\|([^{}]+)\}([\s\S]*?)\{\/tab\}/g;
      let tabs = [];
      let tabMatch;

      while ((tabMatch = tabRegex.exec(content)) !== null) {
        tabs.push({
          title: tabMatch[1],
          content: tabMatch[2].trim()
        });
      }

      if (tabs.length === 0) {
        return content;
      }

      // radio 按组隔离：同页多个标签页组共用 name 会互相抢占勾选、共用 id 会让 label 指错目标
      const groupId = ++tabGroupCounter;
      let tabsHtml = '<div class="tabs">';

      tabs.forEach((tab, index) => {
        const isActive = index === 0 ? 'checked' : '';

        tabsHtml += `
          <input type="radio" name="tabs-${groupId}" id="tab-${groupId}-${index}" class="tab-input" ${isActive}>
          <label for="tab-${groupId}-${index}" class="tab-label">${tab.title}</label>
          <div class="tab-content"><p>${tab.content}</p></div>
        `;
      });

      tabsHtml += '</div>';

      return tabsHtml;
    });
  },

  // 表格语法: {table}或{table|row} → <table>
  processTable(html) {
    const tableRegex = /\{table(?:\|([^}]+))?\}([\s\S]*?)\{\/table\}/g;

    return html.replace(tableRegex, (match, param, content) => {
      const lines = content.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (lines.length === 0) return '';

      const rows = lines.map(line => {
        let rowData = line;
        if (rowData.startsWith('|')) {
          rowData = rowData.substring(1);
        }
        if (rowData.endsWith('|')) {
          rowData = rowData.substring(0, rowData.length - 1);
        }
        return rowData.split('|').map(cell => cell.trim());
      });

      let isRowHeader = false;
      let customClasses = [];

      if (param) {
        const params = param.trim().split(/\s+/);
        params.forEach(p => {
          if (/^row(header)?$/i.test(p)) {
            isRowHeader = true;
          } else {
            customClasses.push(p);
          }
        });
      }

      let tableClass = 'youtable';
      if (isRowHeader) {
        tableClass += ' rowtable';
      }
      if (customClasses.length > 0) {
        tableClass += ' ' + customClasses.join(' ');
      }
      let tableHtml = `<table class="${tableClass}">`;

      if (isRowHeader) {
        tableHtml += '<tbody>';
        rows.forEach(row => {
          if (row.length === 0) return;
          tableHtml += '<tr>';
          row.forEach((cell, index) => {
            if (index === 0) {
              tableHtml += `<th scope="row">${cell}</th>`;
            } else {
              tableHtml += `<td>${cell}</td>`;
            }
          });
          tableHtml += '</tr>';
        });
        tableHtml += '</tbody>';
      } else {
        if (rows.length > 0) {
          tableHtml += '<thead><tr>';
          rows[0].forEach(cell => {
            tableHtml += `<th>${cell}</th>`;
          });
          tableHtml += '</tr></thead>';
        }
        if (rows.length > 1) {
          tableHtml += '<tbody>';
          for (let i = 1; i < rows.length; i++) {
            tableHtml += '<tr>';
            rows[i].forEach(cell => {
              tableHtml += `<td>${cell}</td>`;
            });
            tableHtml += '</tr>';
          }
          tableHtml += '</tbody>';
        }
      }

      tableHtml += '</table>';
      return tableHtml;
    });
  },

  // 单参数标记统一处理（sup/sub/right/center/fa）
  processSimpleTags(html) {
    for (const t of SIMPLE_TAG_TEMPLATES) {
      html = html.replace(t.re, t.to);
    }
    return html;
  },

  processInk(html) {
    const inkRegex = /\{ink\|([^{}]+)\}/g;
    return html.replace(inkRegex, (match, filename) => {
      const name = filename.trim();
      let storyFile = name;
      if (!name.toLowerCase().endsWith('.ink')) {
        storyFile = name + '.ink';
      }
      return `<div class="ink-container" data-ink-story="${storyFile}"></div>`;
    });
  }
};

window.RichText = RichText;