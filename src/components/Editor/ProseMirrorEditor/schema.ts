import { Schema } from 'prosemirror-model';

export const logseqSchema = new Schema({
  nodes: {
    doc: {
      content: 'block+',
    },
    
    paragraph: {
      content: 'inline*',
      group: 'block',
      parseDOM: [{ tag: 'p' }],
      toDOM() {
        return ['p', 0];
      },
    },
    
    heading: {
      attrs: { level: { default: 1 } },
      content: 'inline*',
      group: 'block',
      defining: true,
      parseDOM: [
        { tag: 'h1', attrs: { level: 1 } },
        { tag: 'h2', attrs: { level: 2 } },
        { tag: 'h3', attrs: { level: 3 } },
        { tag: 'h4', attrs: { level: 4 } },
        { tag: 'h5', attrs: { level: 5 } },
        { tag: 'h6', attrs: { level: 6 } },
      ],
      toDOM(node) {
        return ['h' + node.attrs.level, 0];
      },
    },
    
    task: {
      attrs: {
        marker: { default: 'TODO' },
        startedAt: { default: null },
        finishedAt: { default: null },
        elapsed: { default: null },
        deadline: { default: null },
        scheduled: { default: null },
      },
      content: 'inline*',
      group: 'block',
      defining: true,
      parseDOM: [{
        tag: 'div[data-task]',
        getAttrs(dom) {
          return {
            marker: dom.getAttribute('data-marker') || 'TODO',
            startedAt: dom.getAttribute('data-started'),
            finishedAt: dom.getAttribute('data-finished'),
            elapsed: dom.getAttribute('data-elapsed'),
            deadline: dom.getAttribute('data-deadline'),
            scheduled: dom.getAttribute('data-scheduled'),
          };
        },
      }],
      toDOM(node) {
        return [
          'div',
          {
            'data-task': 'true',
            'data-marker': node.attrs.marker,
            'data-started': node.attrs.startedAt,
            'data-finished': node.attrs.finishedAt,
            'data-elapsed': node.attrs.elapsed,
            'data-deadline': node.attrs.deadline,
            'data-scheduled': node.attrs.scheduled,
            class: 'task-block',
          },
          0,
        ];
      },
    },
    
    listItem: {
      content: 'inline*',
      group: 'block',
      parseDOM: [{ tag: 'li' }],
      toDOM() {
        return ['li', 0];
      },
    },
    
    orderedList: {
      content: 'listItem+',
      group: 'block',
      attrs: { order: { default: 1 } },
      parseDOM: [{
        tag: 'ol',
        getAttrs(dom) {
          return { order: dom.hasAttribute('start') ? +(dom.getAttribute('start') || 1) : 1 };
        },
      }],
      toDOM(node) {
        return node.attrs.order === 1 ? ['ol', 0] : ['ol', { start: node.attrs.order }, 0];
      },
    },
    
    bulletList: {
      content: 'listItem+',
      group: 'block',
      parseDOM: [{ tag: 'ul' }],
      toDOM() {
        return ['ul', 0];
      },
    },
    
    blockquote: {
      content: 'paragraph+',
      group: 'block',
      parseDOM: [{ tag: 'blockquote' }],
      toDOM() {
        return ['blockquote', 0];
      },
    },
    
    codeBlock: {
      attrs: { language: { default: '' } },
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      parseDOM: [{
        tag: 'pre',
        preserveWhitespace: 'full',
        getAttrs(dom) {
          const code = dom.querySelector('code');
          return {
            language: code?.getAttribute('data-language') || '',
          };
        },
      }],
      toDOM(node) {
        return ['pre', { class: 'code-block' }, ['code', { 'data-language': node.attrs.language }, 0]];
      },
    },
    
    mathBlock: {
      attrs: { formula: { default: '' } },
      group: 'block',
      atom: true,
      parseDOM: [{
        tag: 'div[data-math-block]',
        getAttrs(dom) {
          return { formula: dom.getAttribute('data-formula') || '' };
        },
      }],
      toDOM(node) {
        return ['div', { 'data-math-block': 'true', 'data-formula': node.attrs.formula, class: 'math-block' }];
      },
    },
    
    table: {
      content: 'tableRow+',
      group: 'block',
      tableRole: 'table',
      isolating: true,
      parseDOM: [{ tag: 'table' }],
      toDOM() {
        return ['table', ['tbody', 0]];
      },
    },
    
    tableRow: {
      content: '(tableCell | tableHeader)*',
      tableRole: 'row',
      parseDOM: [{ tag: 'tr' }],
      toDOM() {
        return ['tr', 0];
      },
    },
    
    tableCell: {
      content: 'inline*',
      tableRole: 'cell',
      parseDOM: [{ tag: 'td' }],
      toDOM() {
        return ['td', 0];
      },
    },
    
    tableHeader: {
      content: 'inline*',
      tableRole: 'header_cell',
      parseDOM: [{ tag: 'th' }],
      toDOM() {
        return ['th', 0];
      },
    },
    
    horizontalRule: {
      group: 'block',
      parseDOM: [{ tag: 'hr' }],
      toDOM() {
        return ['hr'];
      },
    },
    
    queryBlock: {
      attrs: { query: { default: '' } },
      group: 'block',
      atom: true,
      parseDOM: [{
        tag: 'div[data-query]',
        getAttrs(dom) {
          return { query: dom.getAttribute('data-query-content') || '' };
        },
      }],
      toDOM(node) {
        return ['div', { 'data-query': 'true', 'data-query-content': node.attrs.query, class: 'query-block' }];
      },
    },
    
    text: {
      group: 'inline',
    },

    blockId: {
      attrs: { id: { default: '' } },
      inline: true,
      group: 'inline',
      atom: true,
      selectable: false,
      draggable: false,
      parseDOM: [{
        tag: 'span.block-id',
        getAttrs(dom) {
          const text = dom.textContent || '';
          const match = text.match(/^\^([a-zA-Z0-9_-]+)$/);
          return { id: match ? match[1] : text.replace(/^\^/, '') };
        },
      }],
      toDOM(node) {
        const span = document.createElement('span');
        span.className = 'block-id';
        span.style.display = 'none';
        span.textContent = `^${node.attrs.id}`;
        return span;
      },
    },
  },
  
  marks: {
    bold: {
      parseDOM: [
        { tag: 'strong' },
        { tag: 'b', getAttrs: (node) => node.style.fontWeight !== 'normal' && null },
        {
          style: 'font-weight',
          getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null,
        },
      ],
      toDOM() {
        return ['strong', 0];
      },
    },
    
    italic: {
      parseDOM: [
        { tag: 'i' },
        { tag: 'em' },
        {
          style: 'font-style=italic',
        },
      ],
      toDOM() {
        return ['em', 0];
      },
    },
    
    strikethrough: {
      parseDOM: [
        { tag: 's' },
        { tag: 'del' },
        {
          style: 'text-decoration=line-through',
        },
      ],
      toDOM() {
        return ['s', 0];
      },
    },
    
    code: {
      parseDOM: [{ tag: 'code' }],
      toDOM() {
        return ['code', 0];
      },
    },
    
    link: {
      attrs: {
        href: {},
        title: { default: null },
      },
      inclusive: false,
      parseDOM: [{
        tag: 'a[href]',
        getAttrs(dom) {
          return {
            href: dom.getAttribute('href'),
            title: dom.getAttribute('title'),
          };
        },
      }],
      toDOM(node) {
        return ['a', { href: node.attrs.href, title: node.attrs.title }, 0];
      },
    },
    
    wikiLink: {
      attrs: {
        title: {},
      },
      parseDOM: [{
        tag: 'span.wiki-link',
        getAttrs(dom) {
          return { title: dom.getAttribute('data-title') };
        },
      }],
      toDOM(node) {
        return ['span', { class: 'wiki-link', 'data-title': node.attrs.title }, `[[${node.attrs.title}]]`];
      },
    },
    
    blockRef: {
      attrs: {
        id: {},
      },
      parseDOM: [{
        tag: 'span.block-ref',
        getAttrs(dom) {
          return { id: dom.getAttribute('data-id') };
        },
      }],
      toDOM(node) {
        return ['span', { class: 'block-ref', 'data-id': node.attrs.id }, `((${node.attrs.id}))`];
      },
    },
    
    inlineMath: {
      attrs: {
        formula: {},
      },
      parseDOM: [{
        tag: 'span.inline-math',
        getAttrs(dom) {
          return { formula: dom.getAttribute('data-formula') };
        },
      }],
      toDOM(node) {
        return ['span', { class: 'inline-math', 'data-formula': node.attrs.formula }, `$${node.attrs.formula}$`];
      },
    },
  },
});
