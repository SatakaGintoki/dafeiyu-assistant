import { Children, isValidElement, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useApp } from '../context';
import { IconCopy } from '../ui/icons';

/** CommonMark + GFM, rendered as React elements. Raw HTML and remote images are disabled. */
export function Markdown({ text }: { text: string }) {
  const { host } = useApp();
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({href,children}) => href && /^https?:\/\//i.test(href)
      ? <a href={href} onClick={event=>{event.preventDefault();void host.openExternal(href);}}>{children}</a>
      : <span>{children}</span>,
    img: ({alt}) => <span>{alt || '图片'}</span>,
    table: ({children}) => <div className="md-table-scroll" role="region" aria-label="表格" tabIndex={0}><table>{children}</table></div>,
    pre: ({children}) => {
      const child=Children.toArray(children)[0];
      if(!isValidElement<{children?:ReactNode;className?:string}>(child))return <pre>{children}</pre>;
      const code=String(child.props.children ?? '').replace(/\n$/,'');
      const lang=child.props.className?.match(/language-([^ ]+)/)?.[1] || '';
      return <CodeBlock lang={lang} code={code}/>;
    },
  }}>{text}</ReactMarkdown></div>;
}

function CodeBlock({lang,code}:{lang:string;code:string}) {
  const [copied,setCopied]=useState(false);
  return <div className="md-code"><div className="md-code-bar"><span>{lang||'code'}</span>
    <button aria-label="复制代码" onClick={()=>{void navigator.clipboard?.writeText(code).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1400);}).catch(()=>{});}}>
      <IconCopy size={13}/>{copied?'已复制':'复制'}
    </button></div><pre><code>{code}</code></pre></div>;
}
