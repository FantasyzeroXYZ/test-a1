
import { DictionaryResult, LearningLanguage, DictionaryEntry, Sense } from '../types';

/**
 * 映射学习语言代码到 Free Dictionary API 支持的 ISO 代码
 */
const mapLangCode = (code: string): string => {
  const map: Record<string, string> = {
    'en': 'en',
    'zh': 'zh',
    'ja': 'ja',
    'es': 'es',
    'fr': 'fr',
    'ru': 'ru'
  };
  return map[code] || 'en';
};

export const lookupWord = async (word: string, lang: LearningLanguage): Promise<DictionaryResult | null> => {
  const targetLang = mapLangCode(lang);
  // 使用提供的 OpenAPI 端点: https://freedictionaryapi.com/api/v1/entries/{language}/{word}
  const apiUrl = `https://freedictionaryapi.com/api/v1/entries/${targetLang}/${encodeURIComponent(word)}`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) return null;

    const data = await response.json();
    
    // 根据提供的 OpenAPI 结构进行解析
    if (!data.word || !Array.isArray(data.entries)) return null;

    const mappedEntries: DictionaryEntry[] = data.entries.map((entry: any) => ({
      partOfSpeech: entry.partOfSpeech || 'n/a',
      pronunciations: Array.isArray(entry.pronunciations) ? entry.pronunciations.map((p: any) => ({
        text: p.text,
        type: p.type,
        tags: p.tags
      })) : [],
      senses: Array.isArray(entry.senses) ? mapSenses(entry.senses) : []
    }));

    return {
      word: data.word,
      entries: mappedEntries
    };
  } catch (error) {
    console.error("Dictionary lookup failed:", error);
    return null;
  }
};

const mapSenses = (senses: any[]): Sense[] => {
  return senses.map(s => ({
    definition: s.definition,
    examples: Array.isArray(s.examples) ? s.examples : [],
    synonyms: s.synonyms || [],
    antonyms: s.antonyms || [],
    subsenses: Array.isArray(s.subsenses) ? mapSenses(s.subsenses) : []
  }));
};
