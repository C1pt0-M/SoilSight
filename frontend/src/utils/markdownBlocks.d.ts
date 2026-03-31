export interface OrderedListItem {
  content: string;
  bullets: string[];
}

export interface EvidenceLine {
  label: string;
  codes: string[];
}

export declare const ORDERED_LIST_RE: RegExp;
export declare const BULLET_LIST_RE: RegExp;
export declare const EVIDENCE_LINE_RE: RegExp;
export declare function isOrderedListLine(line?: string): boolean;
export declare function isBulletListLine(line?: string): boolean;
export declare function parseEvidenceLine(line?: string): EvidenceLine | null;
export declare function consumeOrderedList(
  lines: string[],
  startIndex: number
): {
  items: OrderedListItem[];
  nextIndex: number;
};
