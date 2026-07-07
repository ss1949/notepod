import { Plugin } from 'prosemirror-state';
import { Slice, Fragment, DOMParser } from 'prosemirror-model';
import { logseqSchema } from '../schema';

/**
 * 剪贴板处理插件
 * 在粘贴时将文本中的自定义语法（[[wiki-link]]、((block-ref))、$math$）转换为对应元素
 */
export function ClipboardPlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event, slice) {
        // 获取剪贴板文本内容
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;

        // 检查是否包含自定义语法
        const hasCustomSyntax = /\[\[.*?\]\]|\(\(.*?\)\)|\$[^\$\n]+?\$/.test(text);
        if (!hasCustomSyntax) return false;

        // 创建临时容器
        const temp = document.createElement('div');
        temp.innerHTML = text;

        // 处理自定义语法
        processCustomSyntaxInText(temp);

        // 使用 DOMParser 解析处理后的 HTML
        const parser = DOMParser.fromSchema(logseqSchema);
        const doc = parser.parse(temp);
        
        // 提取文档内容作为 slice
        const newSlice = new Slice(doc.content, 0, 0);

        // 插入处理后的内容
        const tr = view.state.tr.replaceSelection(newSlice);
        view.dispatch(tr);

        return true;
      },
    },
  });
}

/**
 * 处理文本中的自定义语法
 */
function processCustomSyntaxInText(container: HTMLElement) {
  // 处理 WikiLink [[xxx]]、block ref ((xxx))、行内公式 $xxx$
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  textNodes.forEach((textNode) => {
    const text = textNode.textContent || '';
    const parts = text.split(/(\[\[.*?\]\]|\(\(.*?\)\)|\$[^\$\n]+?\$)/g);

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
        } else {
          fragment.appendChild(document.createTextNode(part));
        }
      });
      textNode.parentNode?.replaceChild(fragment, textNode);
    }
  });
}
