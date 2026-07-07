import { Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

export const BubbleMenuPluginKey = new PluginKey('bubbleMenu');

export function BubbleMenuPlugin(): Plugin {
  let menuElement: HTMLElement | null = null;

  function createMenu() {
    if (menuElement) return;
    const menu = document.createElement('div');
    menu.className = 'bubble-menu';
    menu.innerHTML = `
      <button data-command="bold" title="加粗 (Ctrl+B)"><b>B</b></button>
      <button data-command="italic" title="斜体 (Ctrl+I)"><i>I</i></button>
      <button data-command="strikethrough" title="删除线"><s>S</s></button>
      <button data-command="code" title="行内代码">&lt;/&gt;</button>
      <button data-command="link" title="链接">🔗</button>
    `;
    document.body.appendChild(menu);
    menuElement = menu;

    menu.addEventListener('mousedown', (e) => {
      e.preventDefault(); // 防止失焦
      const btn = (e.target as HTMLElement).closest('[data-command]') as HTMLElement;
      if (!btn) return;
      const command = btn.dataset.command;
      if (command) {
        (menu as any).__executeCommand?.(command);
      }
    });
  }

  function updateMenu(view: EditorView) {
    const { state } = view;
    const { from, to, empty } = state.selection;

    if (empty || !menuElement) {
      hideMenu();
      return;
    }

    createMenu();
    const coords = view.coordsAtPos(from);
    const endCoords = view.coordsAtPos(to);
    const menu = menuElement!;

    // 计算菜单位置（居中于选区上方）
    const left = (coords.left + endCoords.right) / 2;
    const top = coords.top - 10;

    menu.style.display = 'flex';
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.transform = 'translate(-50%, -100%)';
  }

  function hideMenu() {
    if (menuElement) {
      menuElement.style.display = 'none';
    }
  }

  return new Plugin({
    key: BubbleMenuPluginKey,
    view(editorView) {
      return {
        update(view) {
          updateMenu(view);
        },
        destroy() {
          hideMenu();
          if (menuElement) {
            menuElement.remove();
            menuElement = null;
          }
        },
      };
    },
    props: {
      handleDOMEvents: {
        mousedown() {
          // 点击菜单按钮时不隐藏
          return false;
        },
      },
    },
  });
}
