import { Plugin, PluginKey } from 'prosemirror-state';
import { ResolvedPos, MarkType, Mark } from 'prosemirror-model';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const MathPluginKey = new PluginKey('math');

function findMarkRange($pos: ResolvedPos, markType: MarkType) {
  const mark = $pos.marks().find((m: Mark) => m.type === markType);
  if (!mark) return null;

  let start = $pos.pos;
  let end = $pos.pos;

  // 向左扩展
  while (start > $pos.start()) {
    const resolved = $pos.doc.resolve(start - 1);
    if (!mark.isInSet(resolved.marks())) break;
    start = resolved.pos;
  }

  // 向右扩展
  while (end < $pos.end()) {
    const resolved = $pos.doc.resolve(end + 1);
    if (!mark.isInSet(resolved.marks())) break;
    end = resolved.pos;
  }

  return { from: start, to: end, mark };
}

export function MathPlugin(): Plugin {
  return new Plugin({
    key: MathPluginKey,
    props: {
      handleDoubleClick(view, pos, event) {
        const target = event.target as HTMLElement;

        // 检查是否双击了行内公式
        if (target.classList.contains('inline-math')) {
          const formula = target.getAttribute('data-formula');
          if (formula) {
            const newFormula = prompt('编辑公式:', formula);
            if (newFormula !== null) {
              const $pos = view.state.doc.resolve(pos);
              const range = findMarkRange($pos, view.state.schema.marks.inlineMath);

              if (range) {
                const tr = view.state.tr;
                // 移除旧的 mark 并添加新的 mark
                tr.removeMark(range.from, range.to, range.mark);
                const newMark = view.state.schema.marks.inlineMath.create({ formula: newFormula });
                tr.addMark(range.from, range.to, newMark);
                view.dispatch(tr);
              }
            }
            return true;
          }
        }

        return false;
      },
      
      decorations(state) {
        const decorations: Decoration[] = [];
        
        state.doc.descendants((node, pos) => {
          // 渲染行内公式
          if (node.marks) {
            node.marks.forEach(mark => {
              if (mark.type.name === 'inlineMath') {
                const formula = mark.attrs.formula;
                const decoration = Decoration.inline(pos, pos + node.nodeSize, {
                  class: 'inline-math',
                  'data-formula': formula,
                });
                decorations.push(decoration);
              }
            });
          }
        });
        
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
