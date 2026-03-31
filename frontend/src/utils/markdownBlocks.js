export const ORDERED_LIST_RE = /^\d+\.\s+/;
export const BULLET_LIST_RE = /^[-*+]\s+/;
export const EVIDENCE_LINE_RE = /^(依据)\s*[：:]\s*(.+)$/;

export function isOrderedListLine(line = '') {
  return ORDERED_LIST_RE.test(line.trim());
}

export function isBulletListLine(line = '') {
  return BULLET_LIST_RE.test(line.trim());
}

export function parseEvidenceLine(line = '') {
  const trimmed = line.trim();
  const match = trimmed.match(EVIDENCE_LINE_RE);
  if (!match) {
    return null;
  }

  const [, label, rawCodes] = match;
  const codes = rawCodes
    .split(/[、,，;；]+/)
    .map((code) => code.trim())
    .filter(Boolean);

  if (codes.length === 0) {
    return null;
  }

  return {
    label,
    codes,
  };
}

function stripOrderedListPrefix(line = '') {
  return line.trim().replace(ORDERED_LIST_RE, '').trim();
}

function stripBulletListPrefix(line = '') {
  return line.trim().replace(BULLET_LIST_RE, '').trim();
}

export function consumeOrderedList(lines, startIndex) {
  const items = [];
  let index = startIndex;
  let currentItem = null;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (isOrderedListLine(line)) {
      currentItem = {
        content: stripOrderedListPrefix(line),
        bullets: [],
      };
      items.push(currentItem);
      index += 1;
      continue;
    }

    if (!currentItem) {
      break;
    }

    if (!trimmed) {
      let lookahead = index;
      while (lookahead < lines.length && !(lines[lookahead] ?? '').trim()) {
        lookahead += 1;
      }
      const nextLine = lines[lookahead] ?? '';
      if (isOrderedListLine(nextLine) || isBulletListLine(nextLine)) {
        index = lookahead;
        continue;
      }
      break;
    }

    if (isBulletListLine(line)) {
      currentItem.bullets.push(stripBulletListPrefix(line));
      index += 1;
      continue;
    }

    if (currentItem.bullets.length > 0) {
      break;
    }

    currentItem.content = `${currentItem.content} ${trimmed}`.trim();
    index += 1;
  }

  return {
    items,
    nextIndex: index,
  };
}
