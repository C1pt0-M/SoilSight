import React from 'react';
import { consumeOrderedList, isOrderedListLine, parseEvidenceLine } from '../../utils/markdownBlocks.js';

interface MarkdownMessageProps {
  content: string;
  className?: string;
}

interface OrderedListItem {
  content: string;
  bullets: string[];
}

interface EvidenceLine {
  label: string;
  codes: string[];
}

const BLOCK_START_RE = /^(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s?|```|依据\s*[：:])/;

const parseInline = (text: string, keyPrefix: string): React.ReactNode[] => {
  const tokenRe =
    /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(\*[^*\n]+?\*|_[^_\n]+?_)|(\[[^\]]+?\]\((https?:\/\/[^\s)]+)\))/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(tokenRe)) {
    const matched = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    const key = `${keyPrefix}-${tokenIndex}`;
    if (match[1]) {
      nodes.push(<code key={key}>{matched.slice(1, -1)}</code>);
    } else if (match[2]) {
      nodes.push(<strong key={key}>{parseInline(matched.slice(2, -2), `${key}-strong`)}</strong>);
    } else if (match[3]) {
      nodes.push(<em key={key}>{parseInline(matched.slice(1, -1), `${key}-em`)}</em>);
    } else if (match[4]) {
      const linkTextMatch = matched.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkTextMatch) {
        nodes.push(
          <a key={key} href={linkTextMatch[2]} target="_blank" rel="noreferrer">
            {linkTextMatch[1]}
          </a>
        );
      } else {
        nodes.push(matched);
      }
    }

    lastIndex = index + matched.length;
    tokenIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
};

const renderParagraph = (lines: string[], key: string) => (
  <p key={key}>
    {lines.map((line, index) => (
      <React.Fragment key={`${key}-${index}`}>
        {index > 0 ? <br /> : null}
        {parseInline(line, `${key}-${index}`)}
      </React.Fragment>
    ))}
  </p>
);

const renderOrderedListItem = (item: OrderedListItem, listKey: string, itemIndex: number) => {
  const itemKey = `${listKey}-${itemIndex}`;
  return (
    <li key={itemKey}>
      {parseInline(item.content, `${itemKey}-content`)}
      {item.bullets.length > 0 ? (
        <ul>
          {item.bullets.map((bullet, bulletIndex) => (
            <li key={`${itemKey}-bullet-${bulletIndex}`}>{parseInline(bullet, `${itemKey}-bullet-${bulletIndex}`)}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
};

const renderEvidenceBlock = (evidence: EvidenceLine, key: string) => (
  <aside key={key} className="markdown-evidence">
    <span className="markdown-evidence-label">{evidence.label}</span>
    <div className="markdown-evidence-codes">
      {evidence.codes.map((code, index) => (
        <code key={`${key}-${index}`}>{code}</code>
      ))}
    </div>
  </aside>
);

const renderMarkdownBlocks = (content: string): React.ReactNode[] => {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre key={`code-${blocks.length}`}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length);
      const title = headingMatch[2].trim();
      const Tag = `h${level}` as React.ElementType;
      blocks.push(<Tag key={`heading-${blocks.length}`}>{parseInline(title, `heading-${blocks.length}`)}</Tag>);
      index += 1;
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*+]\s+/, '').trim());
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {items.map((item, itemIndex) => (
            <li key={`ul-${blocks.length}-${itemIndex}`}>{parseInline(item, `ul-${blocks.length}-${itemIndex}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (isOrderedListLine(line)) {
      const { items, nextIndex } = consumeOrderedList(lines, index);
      index = nextIndex;
      blocks.push(
        <ol key={`ol-${blocks.length}`}>
          {items.map((item, itemIndex) => renderOrderedListItem(item, `ol-${blocks.length}`, itemIndex))}
        </ol>
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{renderParagraph(quoteLines, `quote-${blocks.length}`)}</blockquote>);
      continue;
    }

    const evidence = parseEvidenceLine(line);
    if (evidence) {
      blocks.push(renderEvidenceBlock(evidence, `evidence-${blocks.length}`));
      index += 1;
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !BLOCK_START_RE.test(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(renderParagraph(paragraphLines, `paragraph-${blocks.length}`));
  }

  return blocks;
};

const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, className }) => {
  return <div className={className}>{renderMarkdownBlocks(content)}</div>;
};

export default MarkdownMessage;
