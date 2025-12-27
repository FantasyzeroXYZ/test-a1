
import { SegmentationMode } from '../types';

declare const TinySegmenter: any;

/**
 * 判断是否为非空格分隔语言（中文、日文）
 */
export const isNonSpacedLang = (lang: string): boolean => {
  return ['zh', 'ja'].includes(lang.toLowerCase());
};

/**
 * 针对不同语言进行优化的分词逻辑
 */
export const segmentText = (text: string, lang: string = 'en', mode: SegmentationMode = 'browser'): string[] => {
  if (!text) return [];

  if (mode === 'none') {
    return [text]; // 不分词，整个文本作为一个段落
  }

  // 如果是非空格语言（中、日），使用 Segmenter 或 TinySegmenter
  if (isNonSpacedLang(lang)) {
    if (mode === 'mecab' && lang === 'ja' && typeof TinySegmenter !== 'undefined') {
      const segmenter = new TinySegmenter();
      return segmenter.segment(text);
    }

    // 优先使用 Intl.Segmenter
    if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
      const locale = lang === 'zh' ? 'zh-CN' : lang; // 适配中文 locale
      const segmenter = new (Intl as any).Segmenter(locale, { granularity: 'word' });
      // 过滤掉纯空白段，并确保将连续的空白合并为一个 ' '
      const segments = Array.from(segmenter.segment(text)).map((s: any) => s.segment);
      const cleanedSegments: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        if (segments[i].trim() === '' && (cleanedSegments.length === 0 || cleanedSegments[cleanedSegments.length - 1] !== ' ')) {
          // 如果是纯空白，且不是第一个，也不是前一个已经是空格，则添加一个空格
          cleanedSegments.push(' ');
        } else if (segments[i].trim() !== '') {
          cleanedSegments.push(segments[i].trim());
        }
      }
      return cleanedSegments;
    }
  }

  // 如果是空格分隔语言（英文、法文等），或者不支持 Intl.Segmenter/Mecab，
  // 则使用正则按空格和标点分割，保留分隔符作为独立段落，以便重建原句
  // 这样做允许点击标点，但通常 isWord 会过滤掉它们
  // 调整：只按空格分割单词，标点作为单词的一部分或者独立处理，避免在单词中间随意插入空格
  // 对于空格分词语言，直接按空格分割，并保留标点紧随单词。
  // 更精确的做法是：split by spaces, but keep punctuation attached to words, or as separate tokens.
  // This regex splits on spaces, but also captures punctuation as separate tokens if they are not part of a word.
  // This ensures "Hello!" becomes ["Hello", "!"] instead of ["Hello!"]
  const tokens = text.split(/(\s+)/).filter(s => s.length > 0);
  const finalTokens: string[] = [];
  tokens.forEach(token => {
      if (token.match(/\s+/)) {
          finalTokens.push(token); // Preserve actual whitespace segments
      } else {
          // Split words and attached punctuation, e.g., "world." -> ["world", "."]
          const punctuationSplit = token.split(/([.,!?;:"'\[\]{}()]+)/).filter(s => s.length > 0);
          finalTokens.push(...punctuationSplit);
      }
  });
  return finalTokens;
};

/**
 * 确定片段是否为有效单词（非纯标点或空白）
 */
export const isWord = (segment: string): boolean => {
  // Use Unicode property escapes for more comprehensive word character matching
  return /[\p{L}\p{N}]/u.test(segment.trim());
};
