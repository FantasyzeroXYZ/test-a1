
import { Chapter } from '../types';

class AtomCursor {
    data: Uint8Array;
    pos: number;

    constructor(buffer: ArrayBuffer) {
        this.data = new Uint8Array(buffer);
        this.pos = 0;
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
        const bytes = this.data.slice(this.pos, this.pos + n);
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

    hasMore(end: number = this.data.length): boolean {
        return this.pos < end;
    }
}

/**
 * 递归扫描特定类型的原子。
 * 限制在元数据相关容器内搜索，避免误入庞大的 'mdat'。
 */
const recursiveFindAtom = (cursor: AtomCursor, target: string, end: number): {size: number, startPos: number} => {
    const containers = ['moov', 'udta', 'meta', 'ilst', 'trak', 'mdia', 'minf', 'stbl'];
    while (cursor.pos < end - 8) {
        const start = cursor.pos;
        let size = cursor.readUInt32();
        const type = cursor.readString(4);
        
        let headerSize = 8;
        if (size === 1) {
            const largeSize = cursor.readUInt64();
            size = Number(largeSize);
            headerSize = 16;
        }

        const actualSize = size === 0 ? end - start : size;
        const contentSize = actualSize - headerSize;

        if (type === target) {
            return { size: contentSize, startPos: cursor.pos };
        }

        if (containers.includes(type)) {
            // meta 原子特殊处理：通常有一个 4 字节的 full atom 头部
            const diveOffset = type === 'meta' ? 4 : 0;
            const diveCursor = new AtomCursor(cursor.data.buffer.slice(cursor.pos + diveOffset, start + actualSize));
            const result = recursiveFindAtom(diveCursor, target, diveCursor.data.length);
            if (result.size > 0) {
                return { size: result.size, startPos: cursor.pos + diveOffset + result.startPos };
            }
        }

        if (actualSize <= 0) break;
        cursor.pos = start + actualSize;
    }
    return { size: 0, startPos: 0 };
};

const parseChaptersFromBuffer = (cursor: AtomCursor): Chapter[] => {
    const chapters: Chapter[] = [];
    const result = recursiveFindAtom(cursor, 'chpl', cursor.data.length);

    if (!result.size) return chapters;
    
    cursor.pos = result.startPos;
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
        if (cursor.pos + 9 > cursor.data.length) break;
        const timestamp = cursor.readUInt64(); 
        const titleLen = cursor.readByte();
        if (cursor.pos + titleLen > cursor.data.length) break;
        const title = cursor.readString(titleLen);
        const startTime = Number(timestamp) / 10000000; 
        chapters.push({
            startTime,
            title: title.trim() || `Chapter ${i + 1}`
        });
    }
    
    return chapters;
};

const parseCoverFromBuffer = (cursor: AtomCursor): Blob | undefined => {
    const result = recursiveFindAtom(cursor, 'covr', cursor.data.length);
    if (!result.size) return undefined;

    cursor.pos = result.startPos;
    // 寻找内部的 'data' 原子
    const dataRes = recursiveFindAtom(cursor, 'data', result.startPos + result.size);
    if (!dataRes.size) return undefined;

    cursor.pos = dataRes.startPos + 8; // 跳过 data atom 头部
    const imgDataSize = dataRes.size - 8;
    if (imgDataSize <= 0) return undefined;
    
    const imgBytes = cursor.data.slice(cursor.pos, cursor.pos + imgDataSize);
    let mimeType = 'image/jpeg';
    if (imgBytes[0] === 0x89 && imgBytes[1] === 0x50) mimeType = 'image/png';
    
    try {
        return new Blob([imgBytes], { type: mimeType });
    } catch (err) {
        return undefined;
    }
};

export const parseChapters = async (file: File): Promise<{ chapters: Chapter[], coverBlob?: Blob }> => {
    try {
        const buffer = await file.arrayBuffer();
        const chapters = parseChaptersFromBuffer(new AtomCursor(buffer));
        const coverBlob = parseCoverFromBuffer(new AtomCursor(buffer));
        
        const finalChapters = chapters.length > 0 ? chapters : [{
            startTime: 0,
            title: file.name.replace(/\.[^/.]+$/, '')
        }];
        
        return { chapters: finalChapters, coverBlob };
    } catch (err) {
        return { 
            chapters: [{ startTime: 0, title: file.name.replace(/\.[^/.]+$/, '') }] 
        };
    }
};
