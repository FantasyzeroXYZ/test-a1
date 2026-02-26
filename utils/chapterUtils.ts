
import { Chapter } from '../types';

class AtomCursor {
    data: Uint8Array;
    pos: number;

    constructor(data: Uint8Array, pos: number = 0) {
        this.data = data;
        this.pos = pos;
    }

    readUInt32(): number {
        if (this.pos + 4 > this.data.length) return 0;
        const val = (this.data[this.pos] << 24) | (this.data[this.pos + 1] << 16) | (this.data[this.pos + 2] << 8) | this.data[this.pos + 3];
        this.pos += 4;
        return val >>> 0;
    }

    readUInt64(): bigint {
        if (this.pos + 8 > this.data.length) return 0n;
        let val = 0n;
        for (let i = 0; i < 8; i++) {
            val = (val << 8n) | BigInt(this.data[this.pos++]);
        }
        return val;
    }

    readString(n: number): string {
        if (this.pos + n > this.data.length) return "";
        const bytes = this.data.subarray(this.pos, this.pos + n);
        this.pos += n;
        return new TextDecoder().decode(bytes);
    }

    readByte(): number {
        if (this.pos >= this.data.length) return 0;
        return this.data[this.pos++];
    }

    skip(n: number) {
        this.pos += n;
    }
}

/**
 * 递归扫描特定类型的原子。
 * 使用偏移量而非切片以提高性能并减少内存占用。
 */
const findAtom = (data: Uint8Array, target: string, start: number, end: number): { size: number, contentStart: number } | null => {
    const containers = ['moov', 'udta', 'meta', 'ilst', 'trak', 'mdia', 'minf', 'stbl'];
    let pos = start;
    
    while (pos < end - 8) {
        const atomStart = pos;
        const size = ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]) >>> 0;
        const type = String.fromCharCode(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]);
        
        if (size === 0) break;

        let headerSize = 8;
        let actualSize = size;

        if (size === 1) {
            let largeSize = 0n;
            for (let i = 0; i < 8; i++) {
                largeSize = (largeSize << 8n) | BigInt(data[pos + 8 + i]);
            }
            actualSize = Number(largeSize);
            headerSize = 16;
        }

        const contentStart = atomStart + headerSize;
        const contentEnd = atomStart + actualSize;

        if (type === target) {
            return { size: actualSize - headerSize, contentStart };
        }

        if (containers.includes(type)) {
            let diveOffset = 0;
            if (type === 'meta') {
                // The 'meta' atom can be a Full Atom (skip 4 bytes) or a regular atom.
                // Heuristic: check if the first 4 bytes of content look like a valid atom size.
                if (contentStart + 4 <= contentEnd) {
                    const firstInt = ((data[contentStart] << 24) | (data[contentStart + 1] << 16) | (data[contentStart + 2] << 8) | data[contentStart + 3]) >>> 0;
                    if (firstInt > contentEnd - contentStart || firstInt < 8) {
                        diveOffset = 4;
                    }
                }
            }
            const result = findAtom(data, target, contentStart + diveOffset, contentEnd);
            if (result) return result;
        }

        pos = contentEnd;
    }
    return null;
};

const parseChaptersFromBuffer = (data: Uint8Array): Chapter[] => {
    const chapters: Chapter[] = [];
    const result = findAtom(data, 'chpl', 0, data.length);

    if (!result) return chapters;
    
    const cursor = new AtomCursor(data, result.contentStart);
    const version = cursor.readByte();
    cursor.skip(3); // Flags
    
    let count = 0;
    if (version === 1) {
        cursor.skip(1); // Reserved
        count = cursor.readUInt32();
    } else {
        count = cursor.readByte();
    }
    
    for (let i = 0; i < count; i++) {
        if (cursor.pos + 9 > data.length) break;
        const timestamp = cursor.readUInt64(); 
        const titleLen = cursor.readByte();
        if (cursor.pos + titleLen > data.length) break;
        const title = cursor.readString(titleLen);
        // Nero chapters use 100ns units
        const startTime = Number(timestamp) / 10000000; 
        chapters.push({
            startTime,
            title: title.trim() || `Chapter ${i + 1}`
        });
    }
    
    return chapters;
};

const parseCoverFromBuffer = (data: Uint8Array): Blob | undefined => {
    const result = findAtom(data, 'covr', 0, data.length);
    if (!result) return undefined;

    // 寻找内部的 'data' 原子
    const dataRes = findAtom(data, 'data', result.contentStart, result.contentStart + result.size);
    if (!dataRes) return undefined;

    // data atom 头部: 4 bytes type, 4 bytes locale
    const imgDataStart = dataRes.contentStart + 8;
    const imgDataSize = dataRes.size - 8;
    if (imgDataSize <= 0) return undefined;
    
    const imgBytes = data.subarray(imgDataStart, imgDataStart + imgDataSize);
    let mimeType = 'image/jpeg';
    if (imgBytes[0] === 0x89 && imgBytes[1] === 0x50) mimeType = 'image/png';
    
    try {
        return new Blob([imgBytes], { type: mimeType });
    } catch (err) {
        return undefined;
    }
};

const readSynchsafeInteger = (data: Uint8Array, offset: number): number => {
    return ((data[offset] & 0x7f) << 21) |
           ((data[offset + 1] & 0x7f) << 14) |
           ((data[offset + 2] & 0x7f) << 7) |
           (data[offset + 3] & 0x7f);
};

const parseID3v2Cover = (data: Uint8Array): Blob | undefined => {
    if (data.length < 10 || String.fromCharCode(data[0], data[1], data[2]) !== 'ID3') return undefined;

    const version = data[3];
    const flags = data[5];
    const size = readSynchsafeInteger(data, 6);
    const headerSize = 10;
    
    let pos = headerSize;
    const end = headerSize + size;

    // Extended header check
    if (flags & 0x40) {
        const extHeaderSize = readSynchsafeInteger(data, pos);
        pos += extHeaderSize;
    }

    while (pos < end) {
        let frameId = '';
        let frameSize = 0;
        let frameHeaderSize = 0;

        if (version === 2) {
            frameId = String.fromCharCode(data[pos], data[pos+1], data[pos+2]);
            frameSize = (data[pos+3] << 16) | (data[pos+4] << 8) | data[pos+5];
            frameHeaderSize = 6;
        } else if (version === 3) {
            frameId = String.fromCharCode(data[pos], data[pos+1], data[pos+2], data[pos+3]);
            frameSize = (data[pos+4] << 24) | (data[pos+5] << 16) | (data[pos+6] << 8) | data[pos+7];
            frameHeaderSize = 10;
        } else if (version === 4) {
            frameId = String.fromCharCode(data[pos], data[pos+1], data[pos+2], data[pos+3]);
            frameSize = readSynchsafeInteger(data, pos + 4);
            frameHeaderSize = 10;
        }

        if (frameId === '' || frameSize === 0) break;

        if (frameId === 'APIC' || frameId === 'PIC') {
            const frameDataStart = pos + frameHeaderSize;
            let mimeType = 'image/jpeg';
            let picDataOffset = 0;

            if (version === 2) {
                const encoding = data[frameDataStart];
                const format = String.fromCharCode(data[frameDataStart+1], data[frameDataStart+2], data[frameDataStart+3]);
                mimeType = format === 'JPG' ? 'image/jpeg' : 'image/png';
                picDataOffset = 5; // encoding(1) + format(3) + type(1)
                // Description is skipped for simplicity (assuming empty or short)
            } else {
                const encoding = data[frameDataStart];
                let mimeEnd = frameDataStart + 1;
                while (data[mimeEnd] !== 0 && mimeEnd < frameDataStart + frameSize) mimeEnd++;
                mimeType = new TextDecoder().decode(data.subarray(frameDataStart + 1, mimeEnd));
                
                const type = data[mimeEnd + 1];
                let descEnd = mimeEnd + 2;
                
                // Skip description
                if (encoding === 0 || encoding === 3) { // ISO-8859-1 or UTF-8 (terminated by 00)
                     while (data[descEnd] !== 0 && descEnd < frameDataStart + frameSize) descEnd++;
                     descEnd++; // skip null
                } else { // UTF-16 (terminated by 00 00)
                     while (!(data[descEnd] === 0 && data[descEnd+1] === 0) && descEnd < frameDataStart + frameSize) descEnd += 2;
                     descEnd += 2; // skip nulls
                }
                picDataOffset = descEnd - frameDataStart;
            }

            const imgData = data.subarray(frameDataStart + picDataOffset, frameDataStart + frameSize);
            return new Blob([imgData], { type: mimeType });
        }

        pos += frameHeaderSize + frameSize;
    }
    return undefined;
};

export const parseChapters = async (file: File): Promise<{ chapters: Chapter[], coverBlob?: Blob }> => {
    try {
        // Increase limit to 500MB as we are now more memory efficient
        if (file.size > 500 * 1024 * 1024) {
             console.warn("File too large for chapter parsing, skipping.");
             return { 
                chapters: [{ startTime: 0, title: file.name.replace(/\.[^/.]+$/, '') }] 
            };
        }

        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);
        
        // Check for ID3v2 (MP3)
        if (file.name.toLowerCase().endsWith('.mp3')) {
             const coverBlob = parseID3v2Cover(data);
             return { 
                chapters: [{ startTime: 0, title: file.name.replace(/\.[^/.]+$/, '') }],
                coverBlob 
             };
        }

        const chapters = parseChaptersFromBuffer(data);
        const coverBlob = parseCoverFromBuffer(data);
        
        const finalChapters = chapters.length > 0 ? chapters : [{
            startTime: 0,
            title: file.name.replace(/\.[^/.]+$/, '')
        }];
        
        return { chapters: finalChapters, coverBlob };
    } catch (err) {
        console.error("Error parsing metadata:", err);
        return { 
            chapters: [{ startTime: 0, title: file.name.replace(/\.[^/.]+$/, '') }] 
        };
    }
};
