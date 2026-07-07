import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Mark } from 'prosemirror-model';

export const WikiLinkPluginKey = new PluginKey('wikiLink');

export function WikiLinkPlugin(
  onWikiLinkClick?: (title: string) => void,
  onBlockRefClick?: (id: string) => void,
): Plugin {
  return new Plugin({
    key: WikiLinkPluginKey,
    props: {
      // === 左键点击 wikilink → 跳转；中键/右键放过（留给 contextmenu） ===
      handleClick(view, _pos, event) {
        // 只处理左键（button === 0）
        if (event.button !== 0) return false;

        const target = event.target as HTMLElement;

        const wikiEl = target.classList.contains('wiki-link')
          ? target
          : (target.closest('.wiki-link') as HTMLElement | null);

        if (wikiEl) {
          const title = wikiEl.getAttribute('data-title');
          if (!title) return false;

          event.preventDefault();
          event.stopPropagation();
          onWikiLinkClick?.(title);
          return true;
        }

        const refEl = target.classList.contains('block-ref')
          ? target
          : (target.closest('.block-ref') as HTMLElement | null);

        if (refEl) {
          const id = refEl.getAttribute('data-id');
          if (!id) return false;

          event.preventDefault();
          event.stopPropagation();
          onBlockRefClick?.(id);
          return true;
        }

        return false;
      },

      handleDOMEvents: {
        // 右键 wikilink → 进入编辑（光标定位到 [[ 之后）
        contextmenu(view, event) {
          const target = event.target as HTMLElement;
          const wikiEl = target.classList.contains('wiki-link')
            ? target
            : (target.closest('.wiki-link') as HTMLElement | null);

          if (!wikiEl) return false;

          event.preventDefault();
          event.stopPropagation();

          const title = wikiEl.getAttribute('data-title');
          let targetPos: number | null = null;

          view.state.doc.descendants((node, pos) => {
            if (!node.isText || targetPos !== null) return;
            (node as any).marks.forEach((mark: Mark) => {
              if (mark.type.name !== 'wikiLink' || targetPos !== null) return;
              if (mark.attrs.title === title) {
                targetPos = pos + 2; // 跳过 [[，停在标题第一个字
              }
            });
          });

          if (targetPos !== null) {
            view.focus();
            view.dispatch(
              view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPos)),
            );
          }
          return true;
        },
      },
    },
  });
}
