/*
 * Utilities for Japanese text processing
 * Based on Yomitan logic
 */

type CodepointRange = [number, number];

export const HIRAGANA_RANGE: CodepointRange = [0x3040, 0x309f];
export const KATAKANA_RANGE: CodepointRange = [0x30a0, 0x30ff];
export const HIRAGANA_CONVERSION_RANGE: CodepointRange = [0x3041, 0x3096];
export const KATAKANA_CONVERSION_RANGE: CodepointRange = [0x30a1, 0x30f6];

export const CJK_IDEOGRAPH_RANGES: CodepointRange[] = [
    [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff],
    [0x20000, 0x2a6df], [0x2a700, 0x2b73f], [0x2a700, 0x2b81f]
];

const JAPANESE_RANGES: CodepointRange[] = [
    HIRAGANA_RANGE, KATAKANA_RANGE, ...CJK_IDEOGRAPH_RANGES,
    [0xff66, 0xff9f], // Halfwidth katakana
    [0x30fb, 0x30fc], // Katakana punctuation
    [0xff61, 0xff65], // Kana punctuation
    [0x3000, 0x303f], // CJK Punctuation
    [0xff01, 0xff60], // Fullwidth alphanumeric
];

// Map vowels to their kana/katakana column characters for chouonpu conversion
const VOWEL_TO_KANA_MAPPING: [string, string][] = [
    ['a', 'ぁあかがさざただなはばぱまゃやらゎわヵァアカガサザタダナハバパマャヤラヮワヵヷ'],
    ['i', 'ぃいきぎしじちぢにひびぴみりゐィイキギシジチヂニヒビピミリヰヸ'],
    ['u', 'ぅうくぐすずっつづぬふぶぷむゅゆるゥ外クグスズッツヅヌフブプムュユルヴ'],
    ['e', 'ぇえけげせぜてでねへべぺめれゑヶェエケゲセゼテデネヘベペメレヱヶヹ'],
    ['o', 'ぉおこごそぞとどのほぼぽもょよろをォオコゴソゾトドノホボポモョヨロヲヺ'],
];

export function isStringPartiallyJapanese(str: string): boolean {
    if (str.length === 0) return false;
    for (const c of str) {
        const code = c.codePointAt(0);
        if (code) {
            for (const range of JAPANESE_RANGES) {
                if (code >= range[0] && code <= range[1]) return true;
            }
        }
    }
    return false;
}

/**
 * Converts half-width katakana to full-width katakana.
 */
export function convertHalfWidthKanaToFullWidth(str: string): string {
    const halfWidthChars = '｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ';
    const fullWidthChars = '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜';
    const map = new Map<string, string>();
    for (let i = 0; i < halfWidthChars.length; i++) {
        map.set(halfWidthChars[i], fullWidthChars[i]);
    }
    
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const nextChar = (i + 1 < str.length) ? str[i + 1] : '';
        
        const fullChar = map.get(char);

        if (fullChar && (nextChar === 'ﾞ' || nextChar === 'ﾟ')) {
            const fullNext = map.get(nextChar);
            if (fullNext) {
                result += (fullChar + fullNext).normalize('NFC');
                i++; // Skip next character
            } else {
                result += fullChar;
            }
        } else if (fullChar) {
            result += fullChar;
        } else {
            result += char;
        }
    }
    return result;
}

/**
 * 将片假名转换为平假名。
 * 日语词典通常以平假名存储动词原形，因此这是词形还原的关键。
 */
export function convertKatakanaToHiragana(text: string, keepProlongedSoundMarks: boolean = false): string {
    let result = '';
    const offset = (HIRAGANA_CONVERSION_RANGE[0] - KATAKANA_CONVERSION_RANGE[0]);
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const codePoint = char.codePointAt(0);
        if (!codePoint) { result += char; continue; }
        
        // Handle Chouonpu (ー) conversion to Hiragana vowel
        if (codePoint === 0x30fc && !keepProlongedSoundMarks && result.length > 0) {
            // Check previous character (which is now in result, likely converted to Hiragana already)
            const prev = result[result.length - 1];
            let vowel: string | null = null;
            
            for (const [v, chars] of VOWEL_TO_KANA_MAPPING) {
                // Check against both hiragana and katakana ranges in the mapping string
                if (chars.includes(prev)) { 
                    vowel = v; 
                    break; 
                }
            }
            
            let hira = '';
            if (vowel === 'a') hira = 'あ';
            else if (vowel === 'i') hira = 'い';
            else if (vowel === 'u') hira = 'う';
            else if (vowel === 'e') hira = 'え';
            else if (vowel === 'o') hira = 'う'; // Standard rule: o + u
            
            if (hira) { 
                result += hira; 
                continue; 
            }
        }

        if (codePoint >= KATAKANA_CONVERSION_RANGE[0] && codePoint <= KATAKANA_CONVERSION_RANGE[1]) {
            result += String.fromCodePoint(codePoint + offset);
        } else {
            result += char;
        }
    }
    return result;
}

export function normalizeCombiningCharacters(text: string): string {
    return text.normalize('NFC');
}