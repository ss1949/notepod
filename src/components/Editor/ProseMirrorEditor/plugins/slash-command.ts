import { Plugin, PluginKey, EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { NodeRange } from 'prosemirror-model';

export const SlashCommandPluginKey = new PluginKey('slashCommand');

interface SlashCommandState {
  open: boolean;
  pos: number;
  query: string;
  selectedIndex: number;
}

interface SlashCommand {
  type: string;
  label: string;
  description: string;
  icon: string;
  level?: number;
  group: string;
}

// 合并编辑模式工具栏 + 编辑模式斜杠命令的全部功能
const COMMANDS: SlashCommand[] = [
  // ── 日期属性（来自编辑模式 / 菜单） ─
  { type: 'date', label: 'deadline', description: '设置截止日期', icon: '📅', group: '日期' },
  { type: 'date', label: 'scheduled', description: '设置计划日期', icon: '🗓️', group: '日期' },
  { type: 'date', label: 'started', description: '设置开始时间', icon: '▶️', group: '日期' },
  { type: 'date', label: 'finished', description: '设置完成时间', icon: '⏹️', group: '日期' },

  // ── 任务状态（来自编辑模式 / 菜单） ─
  { type: 'task', label: 'TODO', description: '待办事项', icon: '⬜', group: '任务' },
  { type: 'task', label: 'DOING', description: '进行中', icon: '🔵', group: '任务' },
  { type: 'task', label: 'DONE', description: '已完成', icon: '✅', group: '任务' },
  { type: 'task', label: 'NOW', description: '今天必须做', icon: '', group: '任务' },
  { type: 'task', label: 'LATER', description: '稍后处理', icon: '🟠', group: '任务' },
  { type: 'task', label: 'WAITING', description: '等待中', icon: '🟡', group: '任务' },

  // ── 标题（来自工具栏） ──
  { type: 'heading', level: 1, icon: 'H1', label: '标题 1', description: '大标题', group: '块' },
  { type: 'heading', level: 2, icon: 'H2', label: '标题 2', description: '中标题', group: '块' },
  { type: 'heading', level: 3, icon: 'H3', label: '标题 3', description: '小标题', group: '块' },

  // ── 块类型（来自工具栏 + 斜杠菜单） ─
  { type: 'task-block', icon: '☐', label: '任务', description: '待办事项', group: '块' },
  { type: 'list', icon: '•', label: '列表', description: '无序列表', group: '块' },
  { type: 'blockquote', icon: '"', label: '引用', description: '引用块', group: '块' },
  { type: 'code', icon: '<>', label: '代码块', description: '插入代码', group: '块' },
  { type: 'divider', icon: '—', label: '分隔线', description: '水平分隔线', group: '块' },

  // ── 公式（来自工具栏） ──
  { type: 'math', icon: '', label: '公式', description: '数学公式', group: '块' },

  // ── 查询宏（来自编辑模式 / 菜单） ──
  { type: 'query', icon: '?', label: '查询', description: 'Query 宏', group: '块' },

  // ── 行内格式（来自工具栏） ──
  { type: 'bold', icon: 'B', label: '加粗', description: 'Ctrl+B', group: '行内' },
  { type: 'italic', icon: 'I', label: '斜体', description: 'Ctrl+I', group: '行内' },
  { type: 'strikethrough', icon: 'S', label: '删除线', description: '删除线文本', group: '行内' },
  { type: 'inline-code', icon: '</>', label: '行内代码', description: 'code', group: '行内' },
  { type: 'link', icon: '🔗', label: '链接', description: '插入链接', group: '行内' },
  { type: 'inline-math', icon: 'fx', label: '行内公式', description: '$E=mc^2$', group: '行内' },
  { type: 'wiki-link', icon: '[[]]', label: '双链', description: '[[笔记标题]]', group: '行内' },
];

function getFilteredCommands(query: string): SlashCommand[] {
  if (!query) return COMMANDS;
  const q = query.toLowerCase();
  return COMMANDS.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q),
  );
}

export function SlashCommandPlugin(): Plugin {
  return new Plugin<SlashCommandState>({
    key: SlashCommandPluginKey,

    state: {
      init(): SlashCommandState {
        return { open: false, pos: 0, query: '', selectedIndex: 0 };
      },
      apply(tr, value): SlashCommandState {
        const meta = tr.getMeta(SlashCommandPluginKey);
        if (meta) {
          return { ...value, ...meta } as SlashCommandState;
        }
        return value;
      },
    },

    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        const state = view.state;
        const pluginState = SlashCommandPluginKey.getState(state) as SlashCommandState | undefined;
        if (!pluginState) return false;

        const { open, pos, query } = pluginState;
        if (!open) return false;

        const commands = getFilteredCommands(query);
        const maxIndex = Math.max(commands.length - 1, 0);

        if (event.key === 'Escape') {
          closeSlashMenu(view, pos);
          return true;
        }

        if (event.key === 'ArrowDown') {
          const nextIndex = pluginState.selectedIndex >= maxIndex ? 0 : pluginState.selectedIndex + 1;
          view.dispatch(state.tr.setMeta(SlashCommandPluginKey, { selectedIndex: nextIndex }));
          return true;
        }

        if (event.key === 'ArrowUp') {
          const prevIndex = pluginState.selectedIndex <= 0 ? maxIndex : pluginState.selectedIndex - 1;
          view.dispatch(state.tr.setMeta(SlashCommandPluginKey, { selectedIndex: prevIndex }));
          return true;
        }

        if (event.key === 'Enter') {
          const selected = commands[pluginState.selectedIndex];
          if (selected) {
            executeCommand(view, pos, selected);
          }
          hideSlashMenu();
          return true;
        }

        if (event.key === 'Backspace') {
          if (query.length === 0) {
            closeSlashMenu(view, pos);
            return true;
          }
          view.dispatch(
            state.tr.setMeta(SlashCommandPluginKey, {
              query: query.slice(0, -1),
              selectedIndex: 0,
            }),
          );
          return false;
        }

        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          view.dispatch(
            state.tr.setMeta(SlashCommandPluginKey, {
              query: query + event.key,
              selectedIndex: 0,
            }),
          );
          return false;
        }

        return false;
      },

      handleTextInput(view: EditorView, from: number, _to: number, text: string) {
        if (text === '/') {
          const $pos = view.state.doc.resolve(from);
          if ($pos.parent.type.name === 'paragraph' && $pos.parent.textContent === '') {
            view.dispatch(
              view.state.tr.setMeta(SlashCommandPluginKey, {
                open: true,
                pos: from,
                query: '',
                selectedIndex: 0,
              }),
            );
          }
        }
        return false;
      },

      handleDOMEvents: {
        mousedown(view: EditorView, event: MouseEvent) {
          const pluginState = SlashCommandPluginKey.getState(view.state) as SlashCommandState | undefined;
          if (!pluginState?.open) return false;
          const target = event.target as HTMLElement;
          if (slashMenuElement && slashMenuElement.contains(target)) return false;
          view.dispatch(view.state.tr.setMeta(SlashCommandPluginKey, { open: false, query: '', selectedIndex: 0 }));
          return false;
        },
      },
    },

    view(editorView: EditorView) {
      return {
        update(view: EditorView, prevState: EditorState) {
          const state = view.state;
          const pluginState = SlashCommandPluginKey.getState(state) as SlashCommandState | undefined;
          const prevPluginState = SlashCommandPluginKey.getState(prevState) as SlashCommandState | undefined;
          if (!pluginState || !prevPluginState) return;

          const { open, pos, query, selectedIndex } = pluginState;
          const prevOpen = prevPluginState.open;

          if (open) {
            if (!prevOpen || query !== prevPluginState.query || selectedIndex !== prevPluginState.selectedIndex) {
              renderSlashMenu(view, pos, query, selectedIndex);
            }
          } else if (prevOpen) {
            hideSlashMenu();
          }
        },
        destroy() {
          hideSlashMenu();
        },
      };
    },
  });
}

let slashMenuElement: HTMLElement | null = null;

function closeSlashMenu(view: EditorView, pos: number) {
  const tr = view.state.tr;
  if (pos >= 0 && pos < view.state.doc.content.size) {
    const $pos = view.state.doc.resolve(pos);
    if ($pos.parent.type.name === 'paragraph' && $pos.parent.textContent.startsWith('/')) {
      tr.delete(pos, pos + 1);
    }
  }
  tr.setMeta(SlashCommandPluginKey, { open: false, query: '', selectedIndex: 0 });
  tr.setMeta('internal', true);
  view.dispatch(tr);
}

function renderSlashMenu(view: EditorView, pos: number, query: string, selectedIndex: number) {
  // 每次更新时重新计算位置，确保菜单跟随光标
  const coords = view.coordsAtPos(pos);
  const menuWidth = 240;
  const menuHeight = 400;
  let left = coords.left;
  let top = coords.bottom + 5;
  
  // 检查是否超出右边界
  if (left + menuWidth > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuWidth - 8);
  }
  
  // 检查是否超出下边界
  if (top + menuHeight > window.innerHeight - 8) {
    top = Math.max(8, coords.top - menuHeight - 5);
  }
  
  if (!slashMenuElement) {
    const menu = document.createElement('div');
    menu.className = 'slash-command-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.zIndex = '1000';
    document.body.appendChild(menu);
    slashMenuElement = menu;
  } else {
    // 更新已存在菜单的位置
    slashMenuElement.style.left = `${left}px`;
    slashMenuElement.style.top = `${top}px`;
  }

  const commands = getFilteredCommands(query);
  slashMenuElement.innerHTML = '';

  let lastGroup = '';
  commands.forEach((cmd, index) => {
    // 分组标题
    if (cmd.group !== lastGroup) {
      lastGroup = cmd.group;
      const groupHeader = document.createElement('div');
      groupHeader.className = 'slash-command-group-header';
      groupHeader.textContent = cmd.group;
      slashMenuElement!.appendChild(groupHeader);
    }

    const item = document.createElement('div');
    item.className = 'slash-command-item' + (index === selectedIndex ? ' selected' : '');
    item.innerHTML = `
      <span class="command-icon">${cmd.icon}</span>
      <span class="command-label">${cmd.label}</span>
      <span class="command-desc">${cmd.description}</span>
    `;
    item.onmouseenter = () => {
      view.dispatch(view.state.tr.setMeta(SlashCommandPluginKey, { selectedIndex: index }));
    };
    item.onclick = () => {
      executeCommand(view, pos, cmd);
      hideSlashMenu();
    };
    slashMenuElement!.appendChild(item);
  });

  const selected = slashMenuElement.querySelector('.slash-command-item.selected') as HTMLElement | null;
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

function hideSlashMenu() {
  if (slashMenuElement) {
    slashMenuElement.remove();
    slashMenuElement = null;
  }
}

function executeCommand(view: EditorView, pos: number, command: SlashCommand) {
  const { schema } = view.state;
  const end = view.state.selection.from;
  const tr = view.state.tr;

  // 删除斜杠和查询文本
  tr.delete(pos, end);
  tr.setMeta('internal', true);

  const $slash = tr.doc.resolve(pos);
  const blockStart = $slash.start();
  const blockEnd = $slash.end();

  // ── 行内格式命令：在当前段落内插入 mark ──
  switch (command.type) {
    case 'bold': {
      const markType = schema.marks.bold;
      if (markType) {
        tr.insertText('粗体文本', pos);
        tr.addMark(pos, pos + 4, markType.create());
        tr.setSelection(TextSelection.create(tr.doc, pos + 4));
        view.dispatch(tr);
        return;
      }
      break;
    }
    case 'italic': {
      const markType = schema.marks.italic;
      if (markType) {
        tr.insertText('斜体文本', pos);
        tr.addMark(pos, pos + 4, markType.create());
        tr.setSelection(TextSelection.create(tr.doc, pos + 4));
        view.dispatch(tr);
        return;
      }
      break;
    }
    case 'strikethrough': {
      const markType = schema.marks.strikethrough;
      if (markType) {
        tr.insertText('删除线文本', pos);
        tr.addMark(pos, pos + 5, markType.create());
        tr.setSelection(TextSelection.create(tr.doc, pos + 5));
        view.dispatch(tr);
        return;
      }
      break;
    }
    case 'inline-code': {
      const markType = schema.marks.code;
      if (markType) {
        tr.insertText('code', pos);
        tr.addMark(pos, pos + 4, markType.create());
        tr.setSelection(TextSelection.create(tr.doc, pos + 4));
        view.dispatch(tr);
        return;
      }
      break;
    }
    case 'link': {
      const markType = schema.marks.link;
      if (markType) {
        tr.insertText('链接文字', pos);
        tr.addMark(pos, pos + 4, markType.create({ href: 'https://' }));
        tr.setSelection(TextSelection.create(tr.doc, pos + 4));
        view.dispatch(tr);
        return;
      }
      break;
    }
    case 'inline-math': {
      const markType = schema.marks.inlineMath;
      if (markType) {
        tr.insertText('E=mc^2', pos);
        tr.addMark(pos, pos + 7, markType.create({ formula: 'E=mc^2' }));
        tr.setSelection(TextSelection.create(tr.doc, pos + 7));
        view.dispatch(tr);
        return;
      }
      break;
    }
    case 'wiki-link': {
      const markType = schema.marks.wikiLink;
      if (markType) {
        tr.insertText('笔记标题', pos);
        tr.addMark(pos, pos + 4, markType.create({ title: '笔记标题' }));
        tr.setSelection(TextSelection.create(tr.doc, pos + 4));
        view.dispatch(tr);
        return;
      }
      break;
    }

    // ── 日期属性：在段落末尾插入属性文本 ──
    case 'date': {
      const label = command.label;
      const insertText = `${label}:: `;
      tr.insertText(insertText, pos);
      tr.setSelection(TextSelection.create(tr.doc, pos + insertText.length));
      view.dispatch(tr);
      return;
    }

    // ── 块类型命令 ──
    case 'heading':
      tr.setBlockType(blockStart, blockEnd, schema.nodes.heading, { level: command.level });
      break;
    case 'task':
    case 'task-block':
      tr.setBlockType(blockStart, blockEnd, schema.nodes.task, { marker: command.label || 'TODO' });
      break;
    case 'list': {
      const listNode = schema.nodes.bulletList.create(null, [
        schema.nodes.listItem.create(null, schema.nodes.paragraph.create()),
      ]);
      tr.replaceWith(blockStart - 1, blockEnd, listNode);
      break;
    }
    case 'blockquote': {
      const $from = tr.doc.resolve(blockStart - 1);
      const $to = tr.doc.resolve(blockEnd);
      const range = new NodeRange($from, $to, 0);
      tr.wrap(range, [{ type: schema.nodes.blockquote }]);
      break;
    }
    case 'code':
      tr.setBlockType(blockStart, blockEnd, schema.nodes.codeBlock);
      break;
    case 'math': {
      const mathNode = schema.nodes.mathBlock.create({ formula: 'E = mc^2' });
      tr.replaceWith(blockStart - 1, blockEnd, mathNode);
      break;
    }
    case 'divider': {
      const hrNode = schema.nodes.horizontalRule.create();
      tr.replaceWith(blockStart - 1, blockEnd, hrNode);
      break;
    }
    case 'query': {
      const queryNode = schema.nodes.queryBlock.create({ query: 'todo' });
      tr.replaceWith(blockStart - 1, blockEnd, queryNode);
      break;
    }
  }

  view.dispatch(tr);
}
