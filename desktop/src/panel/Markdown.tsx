import { Fragment, useState, type ReactNode } from 'react';
import { useApp } from '../context';
import { IconCopy } from '../ui/icons';

/** Small, safe markdown subset rendered as React elements (never innerHTML). */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const parts = text.split(/```([\w+-]*)\n?([\s\S]*?)(?:```|$)/g);
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i];
    if (prose.trim()) blocks.push(<Prose key={`p${i}`} text={prose} />);
    if (i + 2 < parts.length) blocks.push(<CodeBlock key={`c${i}`} lang={parts[i + 1]} code={parts[i + 2].replace(/\n$/, '')} />);
  }
  return <div className="md">{blocks}</div>;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang || 'code'}</span>
        <button onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); }}>
          <IconCopy size={13} />{copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function Prose({ text }: { text: string }) {
  const lines = text.replace(/^\n+|\n+$/g, '').split('\n');
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    out.push(<Tag key={`l${out.length}`}>{list.items.map((item, i) => <li key={i}><Inline text={item} /></li>)}</Tag>);
    list = null;
  };
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(<p key={`p${out.length}`}>{paragraph.map((l, i) => <Fragment key={i}>{i > 0 && <br />}<Inline text={l} /></Fragment>)}</p>);
    paragraph = [];
  };
  for (const raw of lines) {
    const bullet = raw.match(/^\s*[-*•]\s+(.*)$/);
    const ordered = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = raw.match(/^#{1,4}\s+(.*)$/);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = !!ordered;
      if (list && list.ordered !== isOrdered) flush();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push((bullet ?? ordered)![1]);
      continue;
    }
    flush();
    if (heading) { flushParagraph(); out.push(<h4 key={`h${out.length}`}><Inline text={heading[1]} /></h4>); continue; }
    if (!raw.trim()) { flushParagraph(); continue; }
    paragraph.push(raw);
  }
  flush();
  flushParagraph();
  return <>{out}</>;
}

function Inline({ text }: { text: string }) {
  const { host } = useApp();
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s)）]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const [token] = match;
    const key = nodes.length;
    if (match[1]) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (match[2]) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else {
      const label = match[3] ? token.slice(1, token.indexOf('](')) : token;
      const url = match[4] ?? match[5];
      nodes.push(<a key={key} href={url} onClick={e => { e.preventDefault(); host.openExternal(url); }}>{label}</a>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}
