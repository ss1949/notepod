import { Schema, Node as ProsemirrorNode, DOMParser } from 'prosemirror-model';
import { marked } from 'marked';

// 匹配 Logseq 风格任务行
// 支持格式：
//   - TODO xxx
//   - * TODO xxx
//   - + TODO xxx
//   TODO xxx (无前缀)
// 注意：^ 配合 m 标志匹配每行开头
const TASK_LINE_RE = /^(\s*[-*+]\s+)?(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELLED)\s+(.*)$/gm;

interface ParsedTask {
  marker: string;
  content: string;
  startedAt?: string;
  finishedAt?: string;
  elapsed?: string;
  deadline?: string;
  scheduled?: string;
}

function parseTaskAttributes(content: string): ParsedTask {
  const startedMatch = content.match(/started::\s*(.+?)(?=\s+(?:finished::|elapsed::|deadline::|scheduled::)|$)/);
  const finishedMatch = content.match(/finished::\s*(.+?)(?=\s+(?:elapsed::|deadline::|scheduled::)|$)/);
  const elapsedMatch = content.match(/elapsed::\s*(.+?)(?=\s+(?:deadline::|scheduled::)|$)/);
  const deadlineMatch = content.match(/deadline::\s*(.+?)(?=\s+scheduled::|$)/);
  const scheduledMatch = content.match(/scheduled::\s*(.+)$/);

  let cleanContent = content;
  if (startedMatch) cleanContent = cleanContent.replace(startedMatch[0], '');
  if (finishedMatch) cleanContent = cleanContent.replace(finishedMatch[0], '');
  if (elapsedMatch) cleanContent = cleanContent.replace(elapsedMatch[0], '');
  if (deadlineMatch) cleanContent = cleanContent.replace(deadlineMatch[0], '');
  if (scheduledMatch) cleanContent = cleanContent.replace(scheduledMatch[0], '');

  // 移除 block ID（^xxx 格式）
  cleanContent = cleanContent.replace(/\s*\^[a-zA-Z0-9_-]+$/, '');

  return {
    marker: '', // Will be set separately
    content: cleanContent.trim(),
    startedAt: startedMatch?.[1]?.trim(),
    finishedAt: finishedMatch?.[1]?.trim(),
    elapsed: elapsedMatch?.[1]?.trim(),
    deadline: deadlineMatch?.[1]?.trim(),
    scheduled: scheduledMatch?.[1]?.trim(),
  };
}

export function markdownToProsemirror(markdown: string, schema: Schema): ProsemirrorNode {
  if (!markdown.trim()) {
    return schema.node('doc', null, [schema.node('paragraph')]);
  }

  // 预先把 Logseq 任务行替换为 HTML 注释占位符，避免 marked 解析
  const taskLines: ParsedTask[] = [];
  let processed = markdown.replace(TASK_LINE_RE, (_fullMatch, prefix, marker, rest) => {
    const parsed = parseTaskAttributes(rest.trim());
    parsed.marker = marker;
    taskLines.push(parsed);
    // 保留前缀和内容，确保 marked 正确解析为列表项
    // 使用 HTML 注释作为占位符替代标记词，marked 会保留注释
    return `${prefix || ''}<!--task-placeholder-${taskLines.length - 1}--> ${parsed.content}`;
  });

  // 预先把 {{query (...)}} 宏替换为占位符，避免 marked 转义花括号
  const queryLines: string[] = [];
  processed = processed.replace(/^\{\{query\s+\((.+?)\)\}\}\s*$/gm, (_match, query) => {
    queryLines.push(query.trim());
    return `<!--query-placeholder-${queryLines.length - 1}-->`;
  });

  // 使用 marked 解析 markdown
  const html = marked.parse(processed) as string;

  // 创建临时 DOM 元素
  const temp = document.createElement('div');
  temp.innerHTML = html;

  // 还原任务占位符为 task 块
  // 遍历所有注释节点
  const walker = document.createTreeWalker(temp, NodeFilter.SHOW_COMMENT, null);
  const commentNodes: Comment[] = [];
  let commentNode: Node | null;
  while ((commentNode = walker.nextNode())) {
    commentNodes.push(commentNode as Comment);
  }

  commentNodes.forEach((comment) => {
    const taskMatch = comment.textContent?.match(/^task-placeholder-(\d+)$/);
    const queryMatch = comment.textContent?.match(/^query-placeholder-(\d+)$/);
    
    if (taskMatch) {
      const index = parseInt(taskMatch[1], 10);
      const task = taskLines[index];
      if (!task) return;

      // 创建 task div
      const div = document.createElement('div');
      div.setAttribute('data-task', 'true');
      div.setAttribute('data-marker', task.marker);
      div.setAttribute('class', 'task-block');
      // 设置任务属性（deadline, started 等）
      if (task.startedAt) div.setAttribute('data-started', task.startedAt);
      if (task.finishedAt) div.setAttribute('data-finished', task.finishedAt);
      if (task.elapsed) div.setAttribute('data-elapsed', task.elapsed);
      if (task.deadline) div.setAttribute('data-deadline', task.deadline);
      if (task.scheduled) div.setAttribute('data-scheduled', task.scheduled);
      // 直接放文本，不包 <p>，因为 task schema 是 inline*
      div.textContent = task.content;

      // 替换注释节点
      const parent = comment.parentNode;
      if (!parent) return;

      // 如果注释被 <p> 包裹（marked 常见行为），需要把 task div 提升到 <p> 的父级
      if (parent.nodeName === 'P') {
        const pElement = parent as HTMLElement;
        // 检查 <p> 内是否只有这个注释（没有其他有意义的内容）
        const pText = pElement.textContent?.trim() || '';
        if (pText === '' || pText === comment.textContent) {
          // <p> 只包含占位符注释，直接用 task div 替换整个 <p>
          pElement.parentNode?.replaceChild(div, pElement);
        } else {
          // <p> 包含其他内容，把 task div 插入到 <p> 之前
          pElement.parentNode?.insertBefore(div, pElement);
          // 从 <p> 中移除注释
          pElement.removeChild(comment);
        }
      } else if (parent.nodeName === 'LI') {
        // 注释在 <li> 内：task 是独立 block，不能留在 <ul> 里，
        // 否则 DOMParser 会为了合法结构补出空 listItem。
        const liElement = parent as HTMLElement;
        const ulElement = liElement.parentNode as HTMLElement | null;
        if (ulElement?.nodeName === 'UL' || ulElement?.nodeName === 'OL') {
          ulElement.parentNode?.insertBefore(div, ulElement);
          ulElement.removeChild(liElement);
          if (!ulElement.hasChildNodes()) {
            ulElement.parentNode?.removeChild(ulElement);
          }
        } else {
          liElement.parentNode?.replaceChild(div, liElement);
        }
      } else {
        parent.replaceChild(div, comment);
      }
    } else if (queryMatch) {
      const index = parseInt(queryMatch[1], 10);
      const query = queryLines[index];
      if (!query) return;

      // 创建 queryBlock div
      const div = document.createElement('div');
      div.setAttribute('data-query', 'true');
      div.setAttribute('data-query-content', query);
      div.className = 'query-block';

      // 替换注释节点
      const parent = comment.parentNode;
      if (!parent) return;

      if (parent.nodeName === 'P') {
        const pElement = parent as HTMLElement;
        const pText = pElement.textContent?.trim() || '';
        if (pText === '' || pText === comment.textContent) {
          pElement.parentNode?.replaceChild(div, pElement);
        } else {
          pElement.parentNode?.insertBefore(div, pElement);
          pElement.removeChild(comment);
        }
      } else if (parent.nodeName === 'LI') {
        // queryBlock 也是独立 block，不要留在 <ul>/<ol> 内
        const liElement = parent as HTMLElement;
        const ulElement = liElement.parentNode as HTMLElement | null;
        if (ulElement?.nodeName === 'UL' || ulElement?.nodeName === 'OL') {
          ulElement.parentNode?.insertBefore(div, ulElement);
          ulElement.removeChild(liElement);
          if (!ulElement.hasChildNodes()) {
            ulElement.parentNode?.removeChild(ulElement);
          }
        } else {
          liElement.parentNode?.replaceChild(div, liElement);
        }
      } else {
        parent.replaceChild(div, comment);
      }
    }
  });

  // 处理自定义语法
  processCustomSyntax(temp);

  // 清理空的列表项（marked 有时会在列表开头生成空 <li>）
  temp.querySelectorAll('li').forEach((li) => {
    const text = (li.textContent || '').trim();
    if (text === '' || text.match(/\^[a-zA-Z0-9_-]+$/)) {
      li.parentNode?.removeChild(li);
    }
  });

  // 使用 DOMParser 转换为 ProseMirror 文档
  const parser = DOMParser.fromSchema(schema);
  return parser.parse(temp);
}

function processCustomSyntax(container: HTMLElement) {
  // 先把独占一行的块级公式 $$...$$ 从 <p> 提升为 math block
  container.querySelectorAll('p').forEach((p) => {
    const text = (p.textContent || '').trim();
    const blockMatch = text.match(/^\$\$([\s\S]+?)\$\$$/);
    if (blockMatch) {
      const formula = blockMatch[1].trim();
      const div = document.createElement('div');
      div.setAttribute('data-math-block', 'true');
      div.setAttribute('data-formula', formula);
      div.className = 'math-block';
      p.parentNode?.replaceChild(div, p);
    }
  });

  // 处理 Query 宏 {{query ...}} - 提升为 queryBlock 节点
  // 注意：marked 可能将 {{ }} 转义为 HTML 实体，textContent 会自动解码
  container.querySelectorAll('p').forEach((p) => {
    const text = (p.textContent || '').trim();
    // 匹配 {{query (...)}} 格式，兼容 HTML 实体转义
    const queryMatch = text.match(/^\{\{query\s+\((.+?)\)\}\}$/) ||
                       text.match(/^query\s+\((.+?)\)$/);
    if (queryMatch) {
      const query = queryMatch[1].trim();
      const div = document.createElement('div');
      div.setAttribute('data-query', 'true');
      div.setAttribute('data-query-content', query);
      div.className = 'query-block';
      p.parentNode?.replaceChild(div, p);
    }
  });

  // 处理 WikiLink [[xxx]]、block ref ((xxx))、行内公式 $xxx$、block ID ^xxx
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  textNodes.forEach((textNode) => {
    const text = textNode.textContent || '';
    const parts = text.split(/(\[\[.*?\]\]|\(\(.*?\)\)|\$[^\$\n]+?\$|\^[a-zA-Z0-9_-]+$)/g);

    if (parts.length > 1) {
      const fragment = document.createDocumentFragment();
      parts.forEach((part) => {
        if (part.startsWith('[[') && part.endsWith(']]')) {
          const title = part.slice(2, -2);
          const span = document.createElement('span');
          span.className = 'wiki-link';
          span.setAttribute('data-title', title);
          span.textContent = part;
          fragment.appendChild(span);
        } else if (part.startsWith('((') && part.endsWith('))')) {
          const id = part.slice(2, -2);
          const span = document.createElement('span');
          span.className = 'block-ref';
          span.setAttribute('data-id', id);
          span.textContent = part;
          fragment.appendChild(span);
        } else if (part.startsWith('$') && part.endsWith('$')) {
          const formula = part.slice(1, -1);
          const span = document.createElement('span');
          span.className = 'inline-math';
          span.setAttribute('data-formula', formula);
          span.textContent = part;
          fragment.appendChild(span);
        } else if (part.match(/^\^[a-zA-Z0-9_-]+$/)) {
          // Block ID - 创建隐藏元素（和预览模式一致）
          const span = document.createElement('span');
          span.className = 'block-id';
          span.style.display = 'none';
          span.textContent = part;
          fragment.appendChild(span);
        } else {
          fragment.appendChild(document.createTextNode(part));
        }
      });
      textNode.parentNode?.replaceChild(fragment, textNode);
    }
  });
}

export function prosemirrorToMarkdown(doc: ProsemirrorNode): string {
  const blocks: string[] = [];

  doc.forEach((node) => {
    switch (node.type.name) {
      case 'paragraph':
        blocks.push(serializeInlineContent(node));
        break;

      case 'heading': {
        const level = node.attrs.level || 1;
        const hashes = '#'.repeat(level);
        blocks.push(`${hashes} ${serializeInlineContent(node)}`);
        break;
      }

      case 'task': {
        const marker = node.attrs.marker || 'TODO';
        let taskLine = `- ${marker} ${serializeInlineContent(node)}`;
        if (node.attrs.startedAt) taskLine += ` started:: ${node.attrs.startedAt}`;
        if (node.attrs.finishedAt) taskLine += ` finished:: ${node.attrs.finishedAt}`;
        if (node.attrs.elapsed) taskLine += ` elapsed:: ${node.attrs.elapsed}`;
        if (node.attrs.deadline) taskLine += ` deadline:: ${node.attrs.deadline}`;
        if (node.attrs.scheduled) taskLine += ` scheduled:: ${node.attrs.scheduled}`;
        blocks.push(taskLine);
        break;
      }

      case 'listItem': {
        const listItemContent = serializeInlineContent(node).trim();
        if (listItemContent) {
          blocks.push(`- ${listItemContent}`);
        }
        break;
      }

      case 'bulletList': {
        const items: string[] = [];
        node.forEach((child) => {
          if (child.type.name === 'listItem') {
            items.push(`- ${serializeInlineContent(child)}`);
          }
        });
        blocks.push(items.join('\n'));
        break;
      }

      case 'orderedList': {
        const items: string[] = [];
        node.forEach((child, index) => {
          if (child.type.name === 'listItem') {
            items.push(`${index + 1}. ${serializeInlineContent(child)}`);
          }
        });
        blocks.push(items.join('\n'));
        break;
      }

      case 'blockquote': {
        const lines: string[] = [];
        node.forEach((child) => {
          if (child.type.name === 'paragraph') {
            const content = serializeInlineContent(child);
            if (content) {
              lines.push(`> ${content}`);
            } else {
              lines.push('>');
            }
          }
        });
        blocks.push(lines.join('\n'));
        break;
      }

      case 'codeBlock': {
        const lang = node.attrs.language || '';
        const body = node.textContent.replace(/\n+$/, '');
        blocks.push(`\`\`\`${lang}\n${body}\n\`\`\``);
        break;
      }

      case 'mathBlock': {
        const formula = node.attrs.formula || '';
        blocks.push(`$$\n${formula}\n$$`);
        break;
      }

      case 'horizontalRule':
        blocks.push('---');
        break;

      case 'queryBlock':
        blocks.push(`{{query (${node.attrs.query})}}`);
        break;

      case 'table':
        blocks.push(serializeTable(node));
        break;
    }
  });

  // 根据相邻 block 类型决定连接符：
  // 只有段落与段落之间需要空行，其他 block 之间及段落与其他 block 之间用 \n
  return blocks.reduce((result, block, index) => {
    if (index === 0) return block;
    const prevNode = doc.child(index - 1);
    const currNode = doc.child(index);
    const prevIsPara = prevNode.type.name === 'paragraph';
    const currIsPara = currNode.type.name === 'paragraph';
    const loose = prevIsPara && currIsPara;
    return result + (loose ? '\n\n' : '\n') + block;
  }, '');
}

function serializeTable(tableNode: ProsemirrorNode): string {
  const rows: string[] = [];
  
  tableNode.forEach((row, rowIndex) => {
    const cells: string[] = [];
    
    row.forEach((cell) => {
      const cellContent = serializeInlineContent(cell);
      cells.push(cellContent);
    });
    
    rows.push(`| ${cells.join(' | ')} |`);
    
    // 在第一行后添加分隔符
    if (rowIndex === 0) {
      const separator = cells.map(() => '---').join(' | ');
      rows.push(`| ${separator} |`);
    }
  });
  
  return rows.join('\n');
}

function serializeInlineContent(node: ProsemirrorNode): string {
  let text = '';
  
  node.forEach((child) => {
    if (child.isText) {
      let content = child.text || '';
      
      // 处理 marks
      const marks = child.marks;
      if (marks.length > 0) {
        marks.forEach((mark) => {
          switch (mark.type.name) {
            case 'bold':
              content = `**${content}**`;
              break;
            case 'italic':
              content = `*${content}*`;
              break;
            case 'strikethrough':
              content = `~~${content}~~`;
              break;
            case 'code':
              content = `\`${content}\``;
              break;
            case 'link':
              content = `[${content}](${mark.attrs.href})`;
              break;
            case 'wikiLink':
              content = `[[${mark.attrs.title}]]`;
              break;
            case 'blockRef':
              content = `((${mark.attrs.id}))`;
              break;
            case 'inlineMath':
              content = `$${mark.attrs.formula}$`;
              break;
          }
        });
      }
      
      text += content;
    } else if (child.type.name === 'wikiLink') {
      text += `[[${child.attrs.title}]]`;
    } else if (child.type.name === 'blockRef') {
      text += `((${child.attrs.id}))`;
    } else if (child.type.name === 'inlineMath') {
      text += `$${child.attrs.formula}$`;
    } else if (child.type.name === 'blockId') {
      text += ` ^${child.attrs.id}`;
    }
  });
  
  return text;
}
