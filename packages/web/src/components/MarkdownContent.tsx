import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';
import { useState, useCallback } from 'react';

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  const codeString = String(children ?? '').replace(/\n$/, '');
  const lines = codeString.split('\n');

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeString);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may fail in some environments; ignore for now
    }
  }, [codeString]);

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-aether-border bg-aether-surface-2">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2 top-2 z-10 rounded p-1.5 text-aether-muted opacity-70 transition-all hover:bg-aether-surface hover:text-aether-text hover:opacity-100"
        title="Copy to clipboard"
        aria-label="Copy code to clipboard"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <div className="overflow-x-auto bg-aether-surface p-3 pr-10 font-mono text-sm leading-relaxed">
        {lines.map((line, index) => (
          <div key={index} className="flex">
            <span
              className="mr-3 w-8 flex-shrink-0 select-none border-r border-aether-border pr-3 text-right text-aether-muted/60 tabular-nums"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span className="flex-1 whitespace-pre-wrap break-words text-aether-text">
              {line || '\u00A0'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const markdownComponents: Components = {
  table: ({ node: _node, ...props }) => (
    <div className="prose-table-wrap">
      <table {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => <th {...props} />,
  td: ({ node: _node, ...props }) => <td {...props} />,
  tr: ({ node: _node, ...props }) => <tr {...props} />,
  pre({ children }: any) {
    // ReactMarkdown renders fenced code as <pre><code class="language-xxx">...</code></pre>
    const codeEl = children?.props ? children : null;
    const codeChildren = codeEl?.props?.children ?? children;
    return <CodeBlock>{codeChildren}</CodeBlock>;
  },
  code({ className, children, ...props }: any) {
    // Inline code (no language class and not inside a pre we overrode)
    const isBlock = className && /language-/.test(className);
    if (isBlock) {
      return <CodeBlock>{children}</CodeBlock>;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

interface Props {
  content: string;
  isStreaming?: boolean;
}

export function MarkdownContent({ content, isStreaming }: Props) {
  if (isStreaming) {
    return (
      <div className="prose-aether whitespace-pre-wrap break-words">
        {content}
        <span className="inline-block h-4 w-0.5 bg-aether-text animate-pulse ml-0.5 align-middle" />
      </div>
    );
  }

  return (
    <div className="prose-aether">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
