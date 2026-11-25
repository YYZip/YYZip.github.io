// Markdown 转 HTML 解析器
// 支持: 标题、列表、代码块、表格、引用、链接、图片、脚注等

// 代码内容转义（已有 HTML 实体保持原样，避免二次转义）
const escapeCodeText = (s) => String(s)
  .replace(/&(?![a-zA-Z][a-zA-Z0-9]*;|#[0-9]+;|#[xX][0-9a-fA-F]+;)/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
// 属性值转义（alt/title 等；& 已在上游统一转义，避免二次转义）
const escapeAttr = (s) => String(s).replace(/"/g, '&quot;');

const MarkdownParser = {
  toHtml(markdown) {
    let codeBlocks = [];

    // 处理顶层围栏代码块（``` 需顶格）。
    // 缩进的围栏（列表项内）由下方块级扫描器按列表上下文处理
    markdown = markdown.replace(/^```([^\n]*)\n([\s\S]*?)\n?[ \t]{0,3}```[ \t]*(?=\n|$)/gm, (match, info, code) => {
      const index = codeBlocks.length;
      codeBlocks.push(`<pre><code>${escapeCodeText(code.replace(/\r$/, ''))}</code></pre>`);
      return `[[CODE_BLOCK_${index}]]`;
    });

    // --- 块级扫描：列表（GFM 对齐）+ 缩进代码 + 项内代码块 ---
    // 以“内容列”（标记缩进 + 标记宽度）为基准递归解析列表：
    // - 任意层嵌套（子列表缩进 ≥ 父项内容列即可）
    // - 列表项内代码块：相对内容列再缩进 4 格的行，或与内容列对齐的围栏
    // - 空行后的缩进续行保持列表；顶格标题/分割线/引用/表格/围栏终止列表
    // - 顶层 4 空格缩进仍为缩进代码块（列表标记需在 0-3 缩进内才开始列表）
    const rawLines = markdown.split('\n').map(l => l.replace(/\r/g, '').replace(/\t/g, '    '));
    const leadingSpaces = (line) => {
      const m = line.match(/^ */);
      return m ? m[0].length : 0;
    };
    const parseMarker = (line) => {
      const m = line.match(/^(\s*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/);
      if (!m) return null;
      const marker = m[2];
      return {
        indent: m[1].length,
        type: /\d/.test(marker) ? 'ol' : 'ul',
        markerLen: marker.length + m[3].length,
        content: m[4],
        start: /\d/.test(marker) ? parseInt(marker, 10) : 0
      };
    };
    // 顶格块级内容（标题/分割线/引用/自定义表格/代码块占位/围栏）会中断列表
    const isInterrupt = (line) => {
      if (line.trim() === '') return false;
      if (/^ {0,3}#{1,6}\s/.test(line)) return true;
      if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
      if (/^ {0,3}>/.test(line)) return true;
      if (/^ {0,3}\{\/?table/.test(line)) return true;
      if (/^ {0,3}\[\[CODE_BLOCK_\d+\]\]$/.test(line)) return true;
      if (/^ {0,3}```/.test(line)) return true;
      return false;
    };
    // 从 lines[i] 收集一个围栏代码块（起始行缩进 ≥ minIndent），返回 { line: 占位符, next }
    const collectFenceBlock = (lines, i, minIndent) => {
      const openM = lines[i].match(/^(\s*)```([^\n]*)$/);
      const indent = openM[1].length;
      const dedent = new RegExp('^ {1,' + indent + '}');
      const content = [];
      let j = i + 1;
      while (j < lines.length) {
        const closeM = lines[j].match(/^(\s*)```[ \t]*$/);
        if (closeM && closeM[1].length >= minIndent) { j++; break; }
        content.push(lines[j].replace(dedent, ''));
        j++;
      }
      const index = codeBlocks.length;
      codeBlocks.push(`<pre><code>${escapeCodeText(content.join('\n'))}</code></pre>`);
      return { line: `[[CODE_BLOCK_${index}]]`, next: j };
    };

    // 递归解析一个列表块，返回 { html, next }
    const parseListBlock = (lines, start) => {
      const first = parseMarker(lines[start]);
      const baseIndent = first.indent;
      const contentCol = baseIndent + first.markerLen;
      const openTag = (mk) => {
        if (mk.type === 'ol') return `<ol${mk.start > 1 ? ` start="${mk.start}"` : ''}>`;
        return /^\[(x| )\]\s+/i.test(mk.content) ? '<ul class="task-list">' : '<ul>';
      };
      let html = openTag(first);
      let type = first.type;
      let liOpen = false;
      let lastWasBlock = false;
      const closeLi = () => { if (liOpen) { html += '</li>'; liOpen = false; } };
      const openItem = (mk) => {
        let content = mk.content;
        let completed = false;
        if (type === 'ul') {
          const taskM = content.match(/^\[(x| )\]\s+(.*)$/i);
          if (taskM) {
            completed = taskM[1].toLowerCase() === 'x';
            content = `<span class="task-item"><i class="fa-solid ${completed ? 'fa-check-square' : 'fa-square'}" aria-hidden="true"></i> ${taskM[2]}</span>`;
          }
        }
        html += `<li${completed ? ' class="completed"' : ''}>${content}`;
        liOpen = true;
      };

      let i = start;
      while (i < lines.length) {
        const line = lines[i];
        const m = parseMarker(line);

        // 同级列表项（类型不同则关闭当前列表重新打开）
        if (m && m.indent === baseIndent) {
          if (m.type !== type) {
            closeLi();
            html += type === 'ul' ? '</ul>' : '</ol>';
            html += openTag(m);
            type = m.type;
          } else {
            closeLi();
          }
          openItem(m);
          lastWasBlock = false;
          i++;
          continue;
        }

        if (m && m.indent < contentCol) break;

        if (line.trim() === '') {
          let k = i + 1;
          while (k < lines.length && lines[k].trim() === '') k++;
          if (k >= lines.length) break;
          const nk = lines[k];
          const nkIndent = leadingSpaces(nk);
          const nkMarker = parseMarker(nk);
          const continues = nkIndent >= contentCol || (nkMarker && nkMarker.indent >= baseIndent && !isInterrupt(nk));
          if (continues) {
            html += '\n';
            i = k;
            continue;
          }
          break;
        }

        const ind = leadingSpaces(line);

        // 顶格块级内容终止列表
        if (isInterrupt(line) && ind < contentCol) break;

        // 更深缩进的标记行 → 嵌套列表（递归，在当前列表项内展开）
        if (m && ind >= contentCol) {
          const sub = parseListBlock(lines, i);
          html += sub.html;
          lastWasBlock = true;
          i = sub.next;
          continue;
        }

        // 列表项内引用（缩进 ≥ 内容列）：剥一层引用标记后按引用块递归渲染
        if (/^\s*>/.test(line) && ind >= contentCol) {
          const qLines = [];
          let j = i;
          while (j < lines.length && /^\s*>/.test(lines[j]) && leadingSpaces(lines[j]) >= contentCol) {
            qLines.push(lines[j].replace(/^ {0,3}> ?/, '').trim());
            j++;
          }
          html += renderBlocks(qLines, true).join('');
          lastWasBlock = true;
          i = j;
          continue;
        }

        // 与内容列对齐的围栏 → 列表项内代码块
        if (/^\s*```/.test(line) && ind >= contentCol) {
          const { line: ph, next } = collectFenceBlock(lines, i, contentCol);
          html += ph + '\n';
          lastWasBlock = true;
          i = next;
          continue;
        }

        // 相对内容列再缩进 4 格 → 列表项内缩进代码块
        if (ind >= contentCol + 4) {
          const content = [];
          let j = i;
          while (j < lines.length && leadingSpaces(lines[j]) >= contentCol + 4 && !/^\s*```/.test(lines[j])) {
            content.push(lines[j].slice(contentCol + 4));
            j++;
          }
          const index = codeBlocks.length;
          codeBlocks.push(`<pre><code>${escapeCodeText(content.join('\n').trim())}</code></pre>`);
          html += `[[CODE_BLOCK_${index}]]\n`;
          lastWasBlock = true;
          i = j;
          continue;
        }

        // 普通续行 / 惰性续行（惰性仅对段落文本成立；代码块/嵌套列表后的顶格行结束列表）
        if (lastWasBlock) break;
        html += '<br>' + line.trim();
        lastWasBlock = false;
        i++;
      }
      closeLi();
      html += type === 'ul' ? '</ul>' : '</ol>';
      return { html, next: i };
    };

    // 顶层扫描 + 块级渲染：列表 / 缩进代码 / 围栏 / 引用块（递归，可嵌列表与代码）/ 分割线 / 标题。
    // inQuote=true 时用于引用内容递归：连续文本行合并为一段（<br> 分隔）并包裹 <p>。
    // 标题编号（headingCounters）在正文与引用内容间共享，保证锚点 id 唯一。
    const isIndented = (line) => /^ {4}/.test(line);
    let headingCounters = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const renderBlocks = (lines, inQuote) => {
      const out = [];
      let textBuf = [];
      const flushText = () => {
        if (textBuf.length) {
          const merged = textBuf.join('<br>');
          out.push(inQuote ? `<p>${merged}</p>` : merged);
          textBuf = [];
        }
      };
      let si = 0;
      while (si < lines.length) {
        const line = lines[si];
        if (line.trim() === '') { flushText(); out.push(''); si++; continue; }
        const m = parseMarker(line);
        if (m && leadingSpaces(line) <= 3) {
          flushText();
          const sub = parseListBlock(lines, si);
          out.push(sub.html);
          si = sub.next;
          continue;
        }
        if (/^ {0,3}```/.test(line)) {
          flushText();
          const { line: ph, next } = collectFenceBlock(lines, si, 0);
          out.push(ph);
          si = next;
          continue;
        }
        if (isIndented(line)) {
          flushText();
          // 顶层缩进代码块（空行后仍有缩进行则空行属于块内）
          const content = [];
          let j = si;
          while (j < lines.length) {
            const l = lines[j];
            if (isIndented(l)) { content.push(l.replace(/^ {4}/, '')); j++; }
            else if (l.trim() === '') {
              let k = j + 1;
              while (k < lines.length && lines[k].trim() === '') k++;
              if (k < lines.length && isIndented(lines[k])) { content.push(''); j = k; }
              else break;
            } else break;
          }
          const index = codeBlocks.length;
          codeBlocks.push(`<pre><code>${escapeCodeText(content.join('\n').trim())}</code></pre>`);
          out.push(`[[CODE_BLOCK_${index}]]`);
          si = j;
          continue;
        }
        // 引用块：收集连续引用行，剥掉一层引用标记后递归渲染（支持引用内嵌列表/代码/标题/嵌套引用）
        if (/^ {0,3}>/.test(line)) {
          flushText();
          const qLines = [];
          let j = si;
          while (j < lines.length && /^ {0,3}>/.test(lines[j])) {
            qLines.push(lines[j].replace(/^ {0,3}> ?/, ''));
            j++;
          }
          out.push('<blockquote>' + renderBlocks(qLines, true).join('\n') + '</blockquote>');
          si = j;
          continue;
        }
        // 分割线
        if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
          flushText();
          out.push('<div class="hr-line"></div>');
          si++;
          continue;
        }
        // 标题（生成 sub1.1.2 格式的锚点 id）
        const hMatch = line.match(/^ {0,3}(#{1,6})\s*(.*)$/);
        if (hMatch) {
          flushText();
          const level = hMatch[1].length;
          const title = hMatch[2];
          if (level === 1) {
            out.push(`<h1>${title}</h1>`);
          } else {
            headingCounters[level]++;
            for (let lv = level + 1; lv <= 6; lv++) headingCounters[lv] = 0;
            const idParts = [];
            for (let lv = 2; lv <= level; lv++) {
              if (headingCounters[lv] > 0) idParts.push(headingCounters[lv]);
            }
            out.push(`<h${level} id="sub${idParts.join('.')}" class="heading-with-anchor">${title}</h${level}>`);
          }
          si++;
          continue;
        }
        // 普通文本行（引用内容内合并为一段；正文保持逐行段落模型）
        if (inQuote) {
          textBuf.push(line.trim());
        } else {
          flushText();
          out.push(line.trim());
        }
        si++;
      }
      flushText();
      return out;
    };
    markdown = renderBlocks(rawLines, false).join('\n');

    // 反斜杠转义：覆盖全部 ASCII 标点（GFM 规则），被转义字符不再参与语法解析
    markdown = markdown.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, (match, char) => {
      return `[[ESCAPED_${char.charCodeAt(0)}]]`;
    });

    let inlineCode = [];
    // 行内代码限定单行内配对：跨行配对会吞掉跨行内容（含代码块占位符），且会被 <p> 包裹破坏
    markdown = markdown.replace(/``([^`\n]*(?:`[^`\n]*)*)``/g, (match, code) => {
      const index = inlineCode.length;
      inlineCode.push(escapeCodeText(code));
      return `[[INLINE_CODE_${index}]]`;
    });
    markdown = markdown.replace(/`([^`\n]*)`/g, (match, code) => {
      const index = inlineCode.length;
      inlineCode.push(escapeCodeText(code));
      return `[[INLINE_CODE_${index}]]`;
    });

    // 裸 & 与孤立 < 转义（在行内代码提取之后，避免对其内容二次转义）
    // < 的豁免条件：/ ! ? 开头，或"字母 + 本行内出现的 >"（完整标签/自动链接），其余按字面转义
    markdown = markdown.replace(/&(?![a-zA-Z][a-zA-Z0-9]*;|#[0-9]+;|#[xX][0-9a-fA-F]+;)/g, '&amp;');
    markdown = markdown.replace(/<(?!(?:\/|\?|!|[a-zA-Z][^>\n]*>))/g, '&lt;');

    // 引用式链接定义 [ref]: URL "可选标题"（收集后从原文移除；label 首字符不能为 ^ 以避开脚注定义，
    // URL 首字符需为字母/数字/#/?//./~ 以避开普通文本行）
    const refLinkDefs = {};
    markdown = markdown.replace(/^ {0,3}\[([^\^ \]][^\]]*)\]:[ \t]+(?:<([^>\s]*)>|(?=[#?/.~\w])([^\s]+))(?:[ \t]+["'(](.+?)["')])?[ \t]*$/gm, (match, label, angleUrl, bareUrl, title) => {
      refLinkDefs[label.trim().toLowerCase()] = { href: angleUrl || bareUrl, title: title || '' };
      return '';
    });

    // 提取脚注定义 [^key]: content
    let footnoteDefinitions = {};

    const lines = markdown.split(/\r?\n/);
    let processedLines = [];
    let i = 0;

    while (i < lines.length) {
      let line = lines[i];
      const footnoteDefMatch = line.match(/^\s*\[\^([^\]]+)\]:\s*(.*)$/);

      if (footnoteDefMatch) {
        const key = footnoteDefMatch[1];
        let content = footnoteDefMatch[2];
        i++;

        while (i < lines.length) {
          const nextLine = lines[i];
          if (nextLine.match(/^\s*\[\^[^\]]+\]:/) || nextLine.trim() === '') {
            break;
          } else {
            content += '\n' + nextLine.trim();
            i++;
          }
        }

        footnoteDefinitions[key] = {
          content: content.trim().replace(/\n/g, '<br>')
        };
      } else {
        processedLines.push(line);
        i++;
      }
    }

    markdown = processedLines.join('\n');

    let footnotes = {};
    let footnoteIndex = 0;
    let footnoteOrder = [];

    // 与脚注定义的 key 规则（[^\]]+）保持一致，含连字符等非 \w 字符的 key 也能引用
    markdown.replace(/\[\^([^\]]+)\]/g, (match, key, offset, string) => {
      if (offset > 0 && string[offset - 1] === ':') {
        return match;
      }
      if (!footnotes[key]) {
        footnotes[key] = {
          id: ++footnoteIndex,
          content: footnoteDefinitions[key]?.content || ''
        };
        footnoteOrder.push(key);
      }
      return match;
    });

    markdown = markdown.replace(/\n{3,}/g, '\n\n');
    // 处理图片 ![alt](src "title")
    markdown = markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?(?:\s+\.([^)\s]+))?\)/g, (match, alt, src, title, cls) => {
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
      const classAttr = cls ? ` class="${cls}"` : '';
      return `<img src="${src}" alt="${escapeAttr(alt)}"${titleAttr}${classAttr}>`;
    });

    markdown = markdown.replace(/==(.*?)==/g, '<mark>$1</mark>');

    markdown = markdown.replace(/!!(.*?)!!/g, '<span style="color: red;">$1</span>');

    markdown = markdown.replace(/~~(.*?)~~/g, '<del>$1</del>');

    markdown = markdown.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    markdown = markdown.replace(/__(.*?)__/g, '<u>$1</u>');

    markdown = markdown.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // 处理链接 [text](href "title") 与引用式链接 [text][ref]，内链添加 data-internal-link 属性。
    // 链接文本允许内联代码/转义占位符（如 [`code`](#code)）
    const LINK_TEXT = '((?:[^\\[\\]]|\\[\\[(?:INLINE_CODE|ESCAPED)_\\d+\\]\\])+)';
    const buildInternalAttr = (href) => {
      if (!href.startsWith('?page=')) return '';
      const linkPart = href.replace('?page=', '');
      const [pageId, anchor] = linkPart.split('#');
      return ` data-internal-link="${pageId}"${anchor ? ` data-internal-anchor="${anchor}"` : ''}`;
    };

    // 引用式链接用法：[文字][ref]，ref 缺省时以文字作为标签
    markdown = markdown.replace(new RegExp('\\[' + LINK_TEXT + '\\]\\[\\s*([^\\]]*)\\]', 'g'), (match, text, ref) => {
      const def = refLinkDefs[(ref || text).trim().toLowerCase()];
      if (!def) return match;
      const titleAttr = def.title ? ` title="${escapeAttr(def.title)}"` : '';
      return `<a href="${def.href}"${titleAttr}${buildInternalAttr(def.href)}>${text}</a>`;
    });

    markdown = markdown.replace(new RegExp('\\[' + LINK_TEXT + '\\]\\(([^)]+?)(?:\\s+"([^"]*)")?\\)', 'g'), (match, text, href, title) => {
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
      return `<a href="${href}"${titleAttr}${buildInternalAttr(href)}>${text}</a>`;
    });

    markdown = markdown.replace(/<([a-zA-Z][a-zA-Z0-9+.-]*:[^>]+)>/g, (match, href) => {
      return `<a href="${href}"${buildInternalAttr(href)}>${href}</a>`;
    });

    markdown = markdown.replace(/\[\^([^\]]+)\]/g, (match, key, offset, string) => {
      if (offset > 0 && string[offset - 1] === ':') {
        return match;
      }
      if (footnotes[key]) {
        const { id, content } = footnotes[key];
        // 换行先转为 [[FN_NL]] 占位（提示框 pre-wrap 渲染时再还原为换行），
        // 避免字面换行把行内元素拆到 <p> 包裹的两行里
        const plainTextContent = content.replace(/<br\s*\/?>/gi, '[[FN_NL]]').replace(/<[^>]*>/g, '');
        return `<sup id="fnref:${key}" class="footnote-container"><a href="#fn:${key}" class="footnote-ref">${id}</a><span class="footnote-tooltip">${plainTextContent}</span></sup>`;
      }
      return match;
    });

    // 处理标准 Markdown 管道表格：表头行 + 分隔行 + 数据行，支持 :--- / :---: / ---: 对齐
    // 转义符与行内代码在此前已替换为占位符，按 | 切分单元格是安全的
    const splitTableRow = (line) => {
      const trimmed = line.trim();
      if (!trimmed.includes('|')) return null;
      let cells = trimmed;
      if (cells.startsWith('|')) cells = cells.slice(1);
      if (cells.endsWith('|')) cells = cells.slice(0, -1);
      return cells.split('|').map(c => c.trim());
    };

    const tableLines = markdown.split('\n');
    const tableProcessed = [];
    for (let i = 0; i < tableLines.length; i++) {
      const head = splitTableRow(tableLines[i]);
      const sep = i + 1 < tableLines.length ? splitTableRow(tableLines[i + 1]) : null;
      const isSep = sep && sep.length > 0 && sep.every(c => /^:?-+:?$/.test(c));

      if (head && isSep && sep.length === head.length) {
        const aligns = sep.map(c => /^:-+:$/.test(c) ? 'center' : /^:-/.test(c) ? 'left' : /-+:$/.test(c) ? 'right' : '');
        const cellAttr = (idx) => aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
        let html = '<table class="youtable"><thead><tr>';
        head.forEach((c, idx) => { html += `<th${cellAttr(idx)}>${c}</th>`; });
        html += '</tr></thead><tbody>';

        let j = i + 2;
        while (j < tableLines.length) {
          const trimmed = tableLines[j].trim();
          if (trimmed === '' || /^[{<[]/.test(trimmed)) break;
          const row = splitTableRow(tableLines[j]);
          if (!row) break;
          // 下一行是分隔行 → 当前行是新表格的表头，结束当前表格
          const nextSep = j + 1 < tableLines.length ? splitTableRow(tableLines[j + 1]) : null;
          if (nextSep && nextSep.length > 0 && nextSep.every(c => /^:?-+:?$/.test(c))) break;
          html += '<tr>';
          for (let k = 0; k < head.length; k++) {
            html += `<td${cellAttr(k)}>${row[k] || ''}</td>`;
          }
          html += '</tr>';
          j++;
        }
        html += '</tbody></table>';
        tableProcessed.push(html);
        i = j - 1;
      } else {
        tableProcessed.push(tableLines[i]);
      }
    }
    markdown = tableProcessed.join('\n');

    // 为普通文本行添加 <p> 标签（跳过已处理的块级元素）
    const inlineTags = ['a', 'span', 'strong', 'em', 'u', 'i', 'del', 'sub', 'sup', 'mark', 'code', 'kbd'];

    let inTable = false;
    markdown = markdown.replace(/^.*$/gm, (line) => {
      const trimmed = line.trim();

      if (trimmed === '') {
        return '';
      }

      if (trimmed.match(/^\[\[CODE_BLOCK_\d+\]\]$/)) {
        return line;
      }

      if (trimmed.startsWith('{table')) {
        inTable = true;
        return line;
      }

      if (trimmed.startsWith('{/table}')) {
        inTable = false;
        return line;
      }

      if (inTable) {
        return line;
      }

      if (trimmed.startsWith('<')) {
        const tagMatch = trimmed.match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
        if (tagMatch) {
          const tagName = tagMatch[1].toLowerCase();
          if (inlineTags.includes(tagName)) {
            return `<p>${trimmed}</p>`;
          } else {
            return line;
          }
        } else {
          return line;
        }
      }

      return `<p>${trimmed}</p>`;
    });

    markdown = markdown.replace(/\[\[CODE_BLOCK_\d+\]\]/g, (match) => {
      const index = match.match(/\[\[CODE_BLOCK_(\d+)\]\]/)[1];
      const codeBlock = codeBlocks[index];
      return codeBlock || match;
    });

    markdown = markdown.replace(/\[\[INLINE_CODE_(\d+)\]\]/g, (match, index) => `<code>${inlineCode[index]}</code>`);

    if (Object.keys(footnotes).length > 0) {
      let footnoteHtml = '<div class="footnotes">\n<ol>\n';
      footnoteOrder.forEach(key => {
        const { id, content } = footnotes[key];
        let processedContent = content;
        processedContent = processedContent.replace(/\[\[CODE_BLOCK_(\d+)\]\]/g, (match, index) => codeBlocks[index] || match);
        processedContent = processedContent.replace(/\[\[INLINE_CODE_(\d+)\]\]/g, (match, index) => `<code>${inlineCode[index]}</code>`);
        footnoteHtml += `<li id="fn:${key}">${processedContent} <a href="#fnref:${key}" class="footnote-back"><i class="fa-solid fa-arrow-turn-up"></i></a></li>\n`;
      });
      footnoteHtml += '</ol>\n</div>';
      markdown += '\n' + footnoteHtml;
    }

    // 转义占位符 [[ESCAPED_*]] 不在此还原，由 RichText.process 在处理完自定义语法后统一还原，
    // 否则 \{fa|check\} 这类转义会先变回字面 {} 再被富文本语法二次渲染

    // 中英文之间自动加空格，先暂存代码块与行内代码避免污染
    const cjkCodeBlocks = [];
    markdown = markdown.replace(/<pre><code[^>]*>[\s\S]*?<\/code><\/pre>/g, (match) => {
      const idx = cjkCodeBlocks.length;
      cjkCodeBlocks.push(match);
      return `[[CJK_CODE_${idx}]]`;
    });
    markdown = markdown.replace(/<code>[^<]*<\/code>/g, (match) => {
      const idx = cjkCodeBlocks.length;
      cjkCodeBlocks.push(match);
      return `[[CJK_CODE_${idx}]]`;
    });

    markdown = markdown.replace(/([\u4e00-\u9fa5])([a-zA-Z0-9])/g, '$1 $2');
    markdown = markdown.replace(/([a-zA-Z0-9])([\u4e00-\u9fa5])/g, '$1 $2');

    markdown = markdown.replace(/\[\[CJK_CODE_(\d+)\]\]/g, (match, idx) => cjkCodeBlocks[idx] || match);

    markdown = markdown.replace(/\[\[FN_NL\]\]/g, '\n');

    return markdown;
  }
};

window.MarkdownParser = MarkdownParser;