import React, { useEffect, useRef, useState } from 'react';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { DOMParser, DOMSerializer, Fragment } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, splitBlock, chainCommands, exitCode, createParagraphNear, newlineInCode } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { inputRules, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules';
import { logseqSchema } from './schema';
import { markdownToProsemirror, prosemirrorToMarkdown } from './markdown-serializer';
import { TaskMarkerPlugin } from './plugins/task-marker';
import { WikiLinkPlugin } from './plugins/wiki-link';
import { MathPlugin } from './plugins/math';
import { SlashCommandPlugin } from './plugins/slash-command';
import { ClipboardPlugin } from './plugins/clipboard';
import { executeLogseqQuery } from '../../../lib/query';
import './ProseMirrorEditor.css';

interface ProseMirrorEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  noteId?: string;
  onWikiLinkClick?: (title: string) => void;
  onBlockRefClick?: (id: string) => void;
  notes?: any[]; // 用于 query 渲染
}

export function ProseMirrorEditor({
  content,
  onChange,
  placeholder,
  noteId,
  onWikiLinkClick,
  onBlockRefClick,
  notes,
}: ProseMirrorEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const lastContentRef = useRef(content);
  const lastNoteIdRef = useRef(noteId);
  const lastEmittedRef = useRef(content); // 编辑器最近一次序列化并发送给父组件的 markdown
  const onChangeRef = useRef(onChange);
  const onWikiLinkClickRef = useRef(onWikiLinkClick);
  const onBlockRefClickRef = useRef(onBlockRefClick);
  const notesRef = useRef(notes);
  const contentRef = useRef(content);
  const noteIdRef = useRef(noteId);
  const queryBlockRerenderRef = useRef<Set<() => void>>(new Set());

  // 保持回调始终最新，避免 init 时的闭包捕获旧引用
  onChangeRef.current = onChange;
  onWikiLinkClickRef.current = onWikiLinkClick;
  onBlockRefClickRef.current = onBlockRefClick;
  notesRef.current = notes;
  contentRef.current = content;
  noteIdRef.current = noteId;

  // 笔记切换时重置状态
  useEffect(() => {
    if (noteId !== lastNoteIdRef.current) {
      lastNoteIdRef.current = noteId;
      lastContentRef.current = content;
      lastEmittedRef.current = content;
    }
  }, [noteId, content]);

  // 初始化编辑器
  useEffect(() => {
    if (!editorRef.current) return;

    // 创建输入规则
    const rules = inputRules({
      rules: [
        // 标题规则
        textblockTypeInputRule(/^# $/, logseqSchema.nodes.heading, () => ({ level: 1 })),
        textblockTypeInputRule(/^## $/, logseqSchema.nodes.heading, () => ({ level: 2 })),
        textblockTypeInputRule(/^### $/, logseqSchema.nodes.heading, () => ({ level: 3 })),
        textblockTypeInputRule(/^#### $/, logseqSchema.nodes.heading, () => ({ level: 4 })),
        textblockTypeInputRule(/^##### $/, logseqSchema.nodes.heading, () => ({ level: 5 })),
        textblockTypeInputRule(/^###### $/, logseqSchema.nodes.heading, () => ({ level: 6 })),

        // 任务规则：支持 "TODO " / "- TODO " / "* TODO " 等
        textblockTypeInputRule(
          /^(?:[-*+]\s+)?(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELLED)\s$/,
          logseqSchema.nodes.task,
          (match) => ({ marker: match[1] }),
        ),

        // 引用块规则
        wrappingInputRule(/^> $/, logseqSchema.nodes.blockquote),

        // 代码块规则
        textblockTypeInputRule(/^```$/, logseqSchema.nodes.codeBlock),
      ],
    });

    // 创建初始文档
    const doc = markdownToProsemirror(content, logseqSchema);

    // 创建编辑器状态
    const state = EditorState.create({
      doc,
      plugins: [
        rules,
        history(),
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Mod-Shift-z': redo,
          'Mod-b': toggleMark(logseqSchema.marks.bold),
          'Mod-i': toggleMark(logseqSchema.marks.italic),
          'Mod-`': toggleMark(logseqSchema.marks.code),
          // 修复 Enter 键行为
          'Enter': chainCommands(
            newlineInCode,
            (state, dispatch) => {
              const { $from } = state.selection;
              const node = $from.node();
              // 在 task 节点中按 Enter 时创建普通段落，避免产生空任务行
              if (node.type.name === 'task') {
                if (!dispatch) return true;
                const start = $from.start();
                const end = $from.end();
                const isAtEnd = $from.pos === end;
                const isAtStart = $from.pos === start;
                const isEmpty = node.content.size === 0;
                const tr = state.tr;

                if (isEmpty) {
                  // 空 task：删除当前 task，并在原位置插入空段落
                  const pos = $from.before();
                  tr.deleteRange(pos, $from.after())
                    .insert(pos, logseqSchema.nodes.paragraph.create());
                  tr.setSelection(TextSelection.create(tr.doc, pos + 1));
                } else if (isAtEnd) {
                  // 光标在 task 末尾：在 task 后面插入空段落
                  const pos = $from.after();
                  tr.insert(pos, logseqSchema.nodes.paragraph.create());
                  tr.setSelection(TextSelection.create(tr.doc, pos + 1));
                } else if (isAtStart) {
                  // 光标在 task 开头：在 task 前面插入空段落
                  const pos = $from.before();
                  tr.insert(pos, logseqSchema.nodes.paragraph.create());
                  tr.setSelection(TextSelection.create(tr.doc, pos + 1));
                } else {
                  // 光标在 task 中间：把光标后的内容拆到新段落
                  const content = node.content.cut($from.pos - start);
                  tr.delete($from.pos, end)
                    .insert($from.after(), logseqSchema.nodes.paragraph.create(null, content));
                  tr.setSelection(TextSelection.create(tr.doc, $from.after() + 1));
                }
                dispatch(tr);
                return true;
              }
              return false;
            },
            splitBlock,
            createParagraphNear
          ),
          'Shift-Enter': chainCommands(exitCode, (state, dispatch) => {
            if (dispatch) {
              dispatch(state.tr.insertText('\n'));
            }
            return true;
          }),
        }),
        keymap(baseKeymap),
        TaskMarkerPlugin(),
        WikiLinkPlugin(
          (title) => onWikiLinkClickRef.current?.(title),
          (id) => onBlockRefClickRef.current?.(id)
        ),
        MathPlugin(),
        SlashCommandPlugin(),
        ClipboardPlugin(),
      ],
    });

    // 创建编辑器视图
    const view = new EditorView(editorRef.current, {
      state,
      dispatchTransaction: (tr) => {
        const newState = view.state.apply(tr);
        view.updateState(newState);

        // 内容变化时触发 onChange（跳过内部更新的 transaction）
        if (tr.docChanged && !tr.getMeta('internal')) {
          const markdown = prosemirrorToMarkdown(newState.doc);
          if (markdown !== lastContentRef.current) {
            lastContentRef.current = markdown;
            lastEmittedRef.current = markdown; // 记录编辑器发出的内容
            onChangeRef.current(markdown);
          }
        }
      },
      nodeViews: {
        task: (initialNode, view, getPos) => {
          let node = initialNode;
          const dom = document.createElement('div');
          dom.className = 'task-block';
          dom.setAttribute('data-marker', node.attrs.marker);

          const marker = document.createElement('span');
          marker.className = `task-marker task-marker-${node.attrs.marker.toLowerCase()}`;
          marker.textContent = node.attrs.marker;
          const isDone = node.attrs.marker === 'DONE' || node.attrs.marker === 'CANCELLED';
          marker.style.cursor = isDone ? 'default' : 'pointer';
          marker.style.pointerEvents = isDone ? 'none' : 'auto';
          marker.setAttribute('contenteditable', 'false');
          // 点击处理由 TaskMarkerPlugin 统一接管（含时间属性更新）
          
          dom.appendChild(marker);

          const contentWrapper = document.createElement('div');
          contentWrapper.className = 'task-content-wrapper';
          dom.appendChild(contentWrapper);

          // ProseMirror 会管理这个 DOM 元素的内容
          const contentDiv = document.createElement('div');
          contentDiv.className = 'task-content';
          // 隐藏 block ID（和预览模式一致）
          contentDiv.setAttribute('data-hide-block-id', 'true');
          contentWrapper.appendChild(contentDiv);

          // 渲染属性（和预览模式完全一致：使用 task-prop 类名）
          const renderAttrs = (attrs: any) => {
            const parts: string[] = [];
            if (attrs.startedAt) {
              parts.push(`<span class="task-prop task-prop-doing"><span class="task-prop-label">开始</span>${attrs.startedAt}</span>`);
            }
            if (attrs.finishedAt) {
              parts.push(`<span class="task-prop task-prop-done"><span class="task-prop-label">结束</span>${attrs.finishedAt}</span>`);
            }
            if (attrs.elapsed) {
              parts.push(`<span class="task-prop task-prop-done"><span class="task-prop-label">耗时</span>${attrs.elapsed}</span>`);
            }
            if (attrs.deadline) {
              parts.push(`<span class="task-prop"><span class="task-prop-label">截止</span>${attrs.deadline}</span>`);
            }
            if (attrs.scheduled) {
              parts.push(`<span class="task-prop"><span class="task-prop-label">计划</span>${attrs.scheduled}</span>`);
            }
            return parts.join('');
          };

          const attrDiv = document.createElement('div');
          attrDiv.className = 'task-attrs';
          attrDiv.innerHTML = renderAttrs(node.attrs);
          contentWrapper.appendChild(attrDiv);

          return {
            dom,
            contentDOM: contentDiv,
            update(updatedNode) {
              if (updatedNode.type.name !== 'task') return false;
              // 先比较再更新，确保 marker 变化时能正确更新 DOM
              const markerChanged = updatedNode.attrs.marker !== node.attrs.marker;
              node = updatedNode;
              if (markerChanged) {
                dom.setAttribute('data-marker', updatedNode.attrs.marker);
                marker.className = `task-marker task-marker-${updatedNode.attrs.marker.toLowerCase()}`;
                marker.textContent = updatedNode.attrs.marker;
                const isDoneNow = updatedNode.attrs.marker === 'DONE' || updatedNode.attrs.marker === 'CANCELLED';
                marker.style.cursor = isDoneNow ? 'default' : 'pointer';
                marker.style.pointerEvents = isDoneNow ? 'none' : 'auto';
              }
              attrDiv.innerHTML = renderAttrs(updatedNode.attrs);
              return true;
            },
          };
        },
        mathBlock: (node, view, getPos) => {
          const dom = document.createElement('div');
          dom.className = 'math-block';
          dom.setAttribute('data-formula', node.attrs.formula);
          
          // 渲染 KaTeX
          const mathContainer = document.createElement('div');
          mathContainer.className = 'math-content';
          try {
            if ((window as any).katex) {
              (window as any).katex.render(node.attrs.formula, mathContainer, {
                displayMode: true,
                throwOnError: false,
              });
            } else {
              mathContainer.textContent = `$$${node.attrs.formula}$$`;
            }
          } catch (e) {
            mathContainer.textContent = `$$${node.attrs.formula}$$`;
          }
          
          // 双击编辑
          dom.ondblclick = () => {
            const newFormula = prompt('编辑公式:', node.attrs.formula);
            if (newFormula !== null) {
              const pos = (getPos as () => number)();
              const tr = view.state.tr.setNodeMarkup(pos, null, { formula: newFormula });
              view.dispatch(tr);
            }
          };
          
          dom.appendChild(mathContainer);
          return { dom };
        },
        queryBlock: (node) => {
          const dom = document.createElement('div');
          dom.className = 'query-block';
          dom.setAttribute('data-query', 'true');
          dom.setAttribute('data-query-content', node.attrs.query);

          // 添加查询标题显示
          const header = document.createElement('div');
          header.className = 'query-header';
          header.textContent = `查询: ${node.attrs.query}`;
          dom.appendChild(header);

          const renderResults = () => {
            // 清除旧内容（保留 header）
            while (dom.childNodes.length > 1) dom.removeChild(dom.lastChild!);

            // 合并笔记列表，确保当前编辑的笔记包含最新内容
            const allNotes = notesRef.current || [];
            const currentContent = contentRef.current;
            const currentNoteId = noteIdRef.current;

            console.log('[QueryBlock] Rendering with:', {
              query: node.attrs.query,
              allNotesCount: allNotes.length,
              currentNoteId,
              currentContentLength: currentContent?.length || 0
            });

            // 创建一个包含当前笔记最新内容的查询源数组
            let querySources = allNotes.map(note => {
              if (note.id === currentNoteId) {
                // 当前编辑的笔记，使用最新的 content
                return { ...note, content: currentContent };
              }
              return note;
            });

            // 如果当前笔记不在列表中，手动添加
            const currentNoteInList = allNotes.find(n => n.id === currentNoteId);
            if (!currentNoteInList && currentNoteId && currentContent) {
              console.log('[QueryBlock] Adding current note to sources');
              querySources = [{
                id: currentNoteId,
                title: '当前笔记',
                content: currentContent,
                deleted_at: null
              }, ...querySources];
            }

            console.log('[QueryBlock] Query sources:', querySources.length);

            const items = executeLogseqQuery(node.attrs.query, querySources as any[]);
            console.log('[QueryBlock] Results:', items.length, items);

            if (items.length === 0) {
              const empty = document.createElement('div');
              empty.className = 'query-empty';
              empty.textContent = '没有匹配的任务';
              dom.appendChild(empty);
            } else {
              const resultsDiv = document.createElement('div');
              resultsDiv.className = 'query-results';
              items.forEach((item) => {
                const row = document.createElement('div');
                row.className = 'query-item';
                row.setAttribute('data-note-id', item.noteId);

                const markerSpan = document.createElement('span');
                markerSpan.className = `task-marker task-marker-${item.marker.toLowerCase()}`;
                markerSpan.textContent = item.marker;
                row.appendChild(markerSpan);

                const textSpan = document.createElement('span');
                textSpan.className = 'task-content';
                textSpan.textContent = item.text;
                row.appendChild(textSpan);

                const titleSpan = document.createElement('span');
                titleSpan.className = 'query-note-title';
                titleSpan.textContent = item.noteTitle;
                titleSpan.title = item.noteTitle;
                row.appendChild(titleSpan);

                resultsDiv.appendChild(row);
              });
              dom.appendChild(resultsDiv);
            }
          };

          // 注册重新渲染函数
          queryBlockRerenderRef.current.add(renderResults);

          renderResults();

          return {
            dom,
            update: (updatedNode) => {
              if (updatedNode.attrs.query !== node.attrs.query) {
                node = updatedNode;
                dom.setAttribute('data-query-content', node.attrs.query);
                header.textContent = `查询: ${node.attrs.query}`;
                renderResults();
                return true;
              }
              // notes 可能变了，重新渲染
              renderResults();
              return true;
            },
            destroy: () => {
              // 取消注册
              queryBlockRerenderRef.current.delete(renderResults);
            },
          };
        },
      },
    });

    viewRef.current = view;
    setIsInitialized(true);

    return () => {
      view.destroy();
    };
  }, []);

  // 处理外部内容变化或笔记切换
  useEffect(() => {
    if (!isInitialized || !viewRef.current) return;

    const isNoteChanged = lastNoteIdRef.current !== noteId;

    // 笔记切换：必须重新加载
    if (isNoteChanged) {
      const doc = markdownToProsemirror(content, logseqSchema);
      const tr = viewRef.current.state.tr.replaceWith(0, viewRef.current.state.doc.content.size, doc.content);
      tr.setMeta('internal', true);
      viewRef.current.dispatch(tr);
      lastContentRef.current = content;
      lastEmittedRef.current = content;
      lastNoteIdRef.current = noteId;
      return;
    }

    // 内容变化：只有当外部内容与编辑器发出的内容不同时，才重新加载
    // 这避免了编辑器自己的修改被回传时覆盖用户输入
    const isExternalContentChanged = content !== lastEmittedRef.current && content !== lastContentRef.current;
    if (isExternalContentChanged) {
      const doc = markdownToProsemirror(content, logseqSchema);
      const tr = viewRef.current.state.tr.replaceWith(0, viewRef.current.state.doc.content.size, doc.content);
      tr.setMeta('internal', true);
      viewRef.current.dispatch(tr);
      lastContentRef.current = content;
      lastEmittedRef.current = content;
    }
  }, [noteId, content, isInitialized]);

  // 当 notes 或 content 变化时，触发所有 queryBlock 的重新渲染
  useEffect(() => {
    if (!isInitialized) return;
    
    // 触发所有注册的 queryBlock 重新渲染
    queryBlockRerenderRef.current.forEach(render => render());
  }, [notes, content, isInitialized]);

  return (
    <div className="prosemirror-editor-wrapper">
      <div ref={editorRef} className="prosemirror-editor" />
      {placeholder && !content && (
        <div className="prosemirror-placeholder">{placeholder}</div>
      )}
    </div>
  );
}
