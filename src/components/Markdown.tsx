// A deliberately small Markdown renderer for the Assistant's answers: headings, bullet and
// numbered lists, pipe tables, fenced code, **bold**, `code` and links. No HTML is ever
// injected: everything is built as React elements, so model output cannot run script.
//
// `headings`: the level an answer's top heading takes on the page it sits in (Ask's answers sit
// under each question's h3, so their headings start at h4), drawn as real headings a screen reader
// can move between. The answer's shallowest heading is its top, whatever number of #s the model
// wrote (it often starts at ###); deeper ones follow, never past h6. Without it, headings are
// drawn as styled lines, as before, for the pages that have not placed them.
import type { ReactNode } from 'react';

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={`${key}-${i}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={`${key}-${i}`}>{tok.slice(1, -1)}</code>);
    else {
      const label = tok.slice(1, tok.indexOf(']'));
      const href = tok.slice(tok.indexOf('(') + 1, -1);
      out.push(<a key={`${key}-${i}`} href={href} target="_blank" rel="noreferrer">{label}</a>);
    }
    last = m.index + tok.length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

// A heading's classes by its depth (# to ####), written out whole so a search for one finds it.
const HEADING_CLASS = ['md-h', 'md-h md-h1', 'md-h md-h2', 'md-h md-h3', 'md-h md-h4'];

export default function Markdown({ text, headings }: { text: string; headings?: 2 | 3 | 4 | 5 }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  const top = Math.min(4, ...lines.map((l) => /^(#{1,4})\s/.exec(l)?.[1].length ?? 4));
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${i}`;
    if (line.startsWith('```')) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i += 1;
      blocks.push(<pre key={key} className="md-code"><code>{body.join('\n')}</code></pre>);
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key} className="table-wrap md-table">
          <table>
            <thead><tr>{head.map((h, j) => <th key={j}>{inline(h, `${key}h${j}`)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${key}r${ri}c${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const depth = heading[1].length;
      const cls = HEADING_CLASS[depth];
      if (headings) {
        const Tag = `h${Math.min(6, headings + depth - top)}` as 'h4';
        blocks.push(<Tag key={key} className={cls}>{inline(heading[2], key)}</Tag>);
      } else {
        blocks.push(<div key={key} className={cls}>{inline(heading[2], key)}</div>);
      }
      i += 1;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i += 1;
      }
      const children = items.map((it, j) => <li key={j}>{inline(it, `${key}l${j}`)}</li>);
      blocks.push(ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>);
      continue;
    }
    if (line.trim()) blocks.push(<p key={key}>{inline(line, key)}</p>);
    i += 1;
  }
  return <div className="md">{blocks}</div>;
}
