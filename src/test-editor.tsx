import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ProseMirrorEditor } from './components/Editor/ProseMirrorEditor/ProseMirrorEditor';

const SAMPLE = `- TODO 测试任务
- DOING 进行中的任务
- DONE 已完成的任务

> 这是一段引用块

普通段落内容。

[[Wiki链接]] 和 ((block-id)) 引用

行内公式 $E=mc^2$`;

function TestApp() {
  const [content, setContent] = useState(SAMPLE);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="test-toolbar">
        提示：在空行输入 / 可调出斜杠命令菜单；输入 - TODO 、 - DOING 、 &gt; 可触发输入规则。
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ProseMirrorEditor
          content={content}
          onChange={setContent}
          placeholder="开始输入…"
          noteId="test-note"
          onWikiLinkClick={(title) => console.log('wiki:', title)}
          onBlockRefClick={(id) => console.log('block ref:', id)}
        />
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(<TestApp />);
}
