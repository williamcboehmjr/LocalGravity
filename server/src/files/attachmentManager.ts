import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export interface RawAttachmentInput {
  id?: string;
  name?: string;
  type?: string;
  size?: number;
  dataUrl?: string;
  base64Data?: string;
  url?: string;
  savedPath?: string;
}

export interface SavedAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  sizeHuman: string;
  savedPath: string; // Absolute path on workstation disk
  url: string; // HTTP serving URL
  isImage: boolean;
  sha256: string;
  metadata: {
    width?: number;
    height?: number;
    format?: string;
    exif?: {
      make?: string;
      model?: string;
      software?: string;
      dateTimeOriginal?: string;
      modifyDate?: string;
      orientation?: number;
      exposureTime?: string;
      fNumber?: string;
      iso?: number;
      focalLength?: string;
      lensModel?: string;
      gps?: {
        latitude?: number;
        longitude?: number;
        altitudeMeters?: number;
      };
      [k: string]: any;
    };
    lineCount?: number;
    characterCount?: number;
    previewSnippet?: string;
    magicHeader?: string;
    [k: string]: any;
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function sanitizeFilename(rawName?: string, defaultExt = '.bin'): string {
  let name = (rawName || '').trim();
  if (!name) name = `file_${Date.now()}${defaultExt}`;
  // Strip path traversal characters
  name = name.replace(/[/\\?%*:|"<>]/g, '_').replace(/^\.+/, '');
  if (!name) name = `file_${Date.now()}${defaultExt}`;
  return name;
}

export function extractJpegsFromPdf(buffer: Buffer): Buffer[] {
  const images: Buffer[] = [];
  let pos = 0;
  const startMarker = Buffer.from([0xff, 0xd8, 0xff]);
  const endMarker = Buffer.from([0xff, 0xd9]);

  while (pos < buffer.length) {
    const sIdx = buffer.indexOf(startMarker, pos);
    if (sIdx === -1) break;
    const eIdx = buffer.indexOf(endMarker, sIdx + 3);
    if (eIdx === -1) {
      pos = sIdx + 3;
      continue;
    }
    const len = eIdx + 2 - sIdx;
    if (len > 3000) {
      // Genuine image (> 3KB)
      images.push(buffer.subarray(sIdx, eIdx + 2));
    }
    pos = eIdx + 2;
  }
  return images;
}

export class AttachmentManager {
  private uploadsRoot: string;

  constructor(repoRoot: string) {
    this.uploadsRoot = path.join(repoRoot, '.runtime', 'uploads');
    if (!fs.existsSync(this.uploadsRoot)) {
      try {
        fs.mkdirSync(this.uploadsRoot, { recursive: true });
      } catch {}
    }
  }

  public getUploadsRoot(): string {
    return this.uploadsRoot;
  }

  public async saveAttachment(threadId: string, input: RawAttachmentInput): Promise<SavedAttachment> {
    const threadDir = path.join(this.uploadsRoot, threadId.replace(/[^a-zA-Z0-9_-]/g, '_'));
    if (!fs.existsSync(threadDir)) {
      fs.mkdirSync(threadDir, { recursive: true });
    }

    const id = input.id || crypto.randomUUID();
    let rawDataUrl = input.dataUrl || input.url || input.base64Data || '';
    let buffer: Buffer;
    let mimeType = input.type || 'application/octet-stream';

    if (rawDataUrl.startsWith('data:')) {
      const match = rawDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1] || mimeType;
        buffer = Buffer.from(match[2], 'base64');
      } else {
        buffer = Buffer.from(rawDataUrl);
      }
    } else if (input.base64Data) {
      buffer = Buffer.from(input.base64Data, 'base64');
    } else if (input.savedPath && fs.existsSync(input.savedPath)) {
      buffer = fs.readFileSync(input.savedPath);
    } else {
      buffer = Buffer.from(rawDataUrl, 'utf-8');
    }

    // Determine extension
    let inferredExt = path.extname(input.name || '').toLowerCase();
    if (!inferredExt) {
      if (mimeType.includes('jpeg') || mimeType.includes('jpg')) inferredExt = '.jpg';
      else if (mimeType.includes('png')) inferredExt = '.png';
      else if (mimeType.includes('webp')) inferredExt = '.webp';
      else if (mimeType.includes('gif')) inferredExt = '.gif';
      else if (mimeType.includes('pdf')) inferredExt = '.pdf';
      else if (mimeType.includes('json')) inferredExt = '.json';
      else if (mimeType.includes('csv')) inferredExt = '.csv';
      else if (mimeType.includes('text')) inferredExt = '.txt';
      else inferredExt = '.bin';
    }

    const cleanBase = sanitizeFilename(input.name || `file_${Date.now()}${inferredExt}`, inferredExt);
    let targetPath = path.join(threadDir, cleanBase);

    // If file already exists with same name, add deduplicating timestamp
    if (fs.existsSync(targetPath)) {
      const parsed = path.parse(cleanBase);
      targetPath = path.join(threadDir, `${parsed.name}_${Date.now()}${parsed.ext}`);
    }

    fs.writeFileSync(targetPath, buffer);

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const size = buffer.length;
    const isImage = mimeType.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(inferredExt);

    const metadata: Record<string, any> = {};

    if (isImage) {
      const imgMeta = parseImageMetadata(buffer);
      Object.assign(metadata, imgMeta);
    }

    // PDF document analysis & embedded image extraction (for scanned drink menus, receipts, documents)
    const isPdf = inferredExt === '.pdf' || mimeType.includes('pdf');
    if (isPdf) {
      const extractedImages: Array<{ name: string; savedPath: string; url: string; size: number; sizeHuman: string }> = [];
      try {
        const jpegs = extractJpegsFromPdf(buffer);
        jpegs.slice(0, 6).forEach((imgBuf, imgIdx) => {
          const parsedBase = path.parse(cleanBase);
          const imgName = `${parsedBase.name}_embedded_img${imgIdx + 1}.jpg`;
          const imgPath = path.join(threadDir, imgName);
          fs.writeFileSync(imgPath, imgBuf);
          extractedImages.push({
            name: imgName,
            savedPath: imgPath.replace(/\\/g, '/'),
            url: `/api/uploads/${threadId}/${encodeURIComponent(imgName)}`,
            size: imgBuf.length,
            sizeHuman: formatBytes(imgBuf.length),
          });
        });
      } catch (pdfImgErr) {
        console.warn('[AttachmentManager] Failed extracting embedded images from PDF:', pdfImgErr);
      }
      if (extractedImages.length > 0) {
        metadata.extractedImages = extractedImages;
      }

      try {
        const pdfParse = require('pdf-parse');
        if (typeof pdfParse === 'function' || (pdfParse && typeof pdfParse.default === 'function')) {
          const parseFn = typeof pdfParse === 'function' ? pdfParse : pdfParse.default;
          const parsed = await parseFn(buffer);
          metadata.pdfPageCount = parsed.numpages;
          metadata.pdfInfo = parsed.info;
          if (parsed.text && parsed.text.trim()) {
            const cleanText = parsed.text.trim();
            metadata.extractedText = cleanText.slice(0, 20000);
            metadata.characterCount = cleanText.length;
            metadata.previewSnippet = cleanText.slice(0, 1000);
          } else {
            metadata.isScannedImageOnly = true;
          }
        }
      } catch (pdfParseErr) {
        console.warn('[AttachmentManager] Failed parsing PDF text with pdf-parse:', pdfParseErr);
      }
    }

    // Text & code analysis
    const isText =
      mimeType.startsWith('text/') ||
      ['.txt', '.md', '.json', '.csv', '.py', '.ts', '.tsx', '.js', '.jsx', '.cs', '.yaml', '.yml', '.html', '.css', '.sh', '.bat', '.ps1'].includes(inferredExt);

    if (isText && buffer.length < 5_000_000) {
      const text = buffer.toString('utf-8');
      const lines = text.split('\n');
      metadata.lineCount = lines.length;
      metadata.characterCount = text.length;
      metadata.previewSnippet = lines.slice(0, 8).join('\n');
    }

    const finalName = path.basename(targetPath);
    const serveUrl = `/api/uploads/${threadId}/${encodeURIComponent(finalName)}`;

    return {
      id,
      name: finalName,
      type: mimeType,
      size,
      sizeHuman: formatBytes(size),
      savedPath: targetPath.replace(/\\/g, '/'),
      url: serveUrl,
      isImage,
      sha256,
      metadata,
    };
  }

  public extractFileMetadata(filePath: string): Record<string, any> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const size = stat.size;
    const sizeHuman = formatBytes(size);

    // Read up to 2MB for header analysis
    const readLen = Math.min(size, 2 * 1024 * 1024);
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(readLen);
    fs.readSync(fd, headerBuf, 0, readLen, 0);
    fs.closeSync(fd);

    const sha256 = crypto.createHash('sha256').update(headerBuf).digest('hex');

    const result: Record<string, any> = {
      path: filePath.replace(/\\/g, '/'),
      name: path.basename(filePath),
      size,
      sizeHuman,
      extension: ext,
      createdAt: stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      sha256Partial: sha256,
      isDirectory: stat.isDirectory(),
    };

    // Image detection and EXIF extraction
    const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'].includes(ext);
    if (isImage) {
      // For images, read full buffer if under 30MB
      let imgBuf = headerBuf;
      if (size <= 30 * 1024 * 1024) {
        imgBuf = fs.readFileSync(filePath);
      }
      const imgMeta = parseImageMetadata(imgBuf);
      result.isImage = true;
      result.image = imgMeta;
    }

    // Text file preview
    const isText = ['.txt', '.md', '.json', '.csv', '.py', '.ts', '.tsx', '.js', '.jsx', '.cs', '.yaml', '.yml', '.html', '.css', '.sh', '.bat', '.ps1', '.sql'].includes(ext);
    if (isText && size < 10 * 1024 * 1024) {
      const text = fs.readFileSync(filePath, 'utf-8');
      const lines = text.split('\n');
      result.isText = true;
      result.lineCount = lines.length;
      result.characterCount = text.length;
      result.preview = lines.slice(0, 15).join('\n');
    }

    return result;
  }
}

export function parseImageMetadata(buffer: Buffer): {
  format?: string;
  width?: number;
  height?: number;
  exif?: Record<string, any>;
} {
  if (!buffer || buffer.length < 8) return {};

  // 1. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    if (buffer.length >= 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { format: 'png', width, height };
    }
    return { format: 'png' };
  }

  // 2. GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    if (buffer.length >= 10) {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      return { format: 'gif', width, height };
    }
    return { format: 'gif' };
  }

  // 3. BMP
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
    if (buffer.length >= 26) {
      const width = buffer.readInt32LE(18);
      const height = Math.abs(buffer.readInt32LE(22));
      return { format: 'bmp', width, height };
    }
    return { format: 'bmp' };
  }

  // 4. WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer.length >= 30 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    const chunkType = buffer.subarray(12, 16).toString('ascii');
    if (chunkType === 'VP8 ') {
      const width = (buffer.readUInt16LE(26) & 0x3FFF);
      const height = (buffer.readUInt16LE(28) & 0x3FFF);
      return { format: 'webp', width, height };
    } else if (chunkType === 'VP8L') {
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      const width = 1 + (((b1 & 0x3F) << 8) | b0);
      const height = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6));
      return { format: 'webp', width, height };
    } else if (chunkType === 'VP8X') {
      const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
      const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
      return { format: 'webp', width, height };
    }
    return { format: 'webp' };
  }

  // 5. JPEG: FF D8
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    let offset = 2;
    let width: number | undefined;
    let height: number | undefined;
    let exif: Record<string, any> | undefined;

    while (offset < buffer.length - 1) {
      if (buffer[offset] !== 0xFF) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      offset += 2;

      if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
        continue;
      }

      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);

      // SOF markers
      if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
        if (offset + 7 <= buffer.length) {
          height = buffer.readUInt16BE(offset + 3);
          width = buffer.readUInt16BE(offset + 5);
        }
      }

      // APP1 marker (EXIF)
      if (marker === 0xE1 && length >= 14) {
        const exifHeader = buffer.subarray(offset + 2, offset + 8).toString('ascii');
        if (exifHeader.startsWith('Exif\0\0')) {
          try {
            exif = parseTiffExif(buffer.subarray(offset + 8, offset + length));
          } catch {}
        }
      }

      offset += length;
    }

    return { format: 'jpeg', width, height, exif };
  }

  return {};
}

function parseTiffExif(tiffBuf: Buffer): Record<string, any> {
  if (tiffBuf.length < 8) return {};
  const isLE = tiffBuf[0] === 0x49 && tiffBuf[1] === 0x49;
  const isBE = tiffBuf[0] === 0x4D && tiffBuf[1] === 0x4D;
  if (!isLE && !isBE) return {};

  const readU16 = (off: number) => isLE ? tiffBuf.readUInt16LE(off) : tiffBuf.readUInt16BE(off);
  const readU32 = (off: number) => isLE ? tiffBuf.readUInt32LE(off) : tiffBuf.readUInt32BE(off);

  const magic = readU16(2);
  if (magic !== 0x002A) return {};

  const firstIFDOffset = readU32(4);

  const readTagValue = (type: number, count: number, valOrOff: number): any => {
    switch (type) {
      case 1:
      case 7:
        if (count === 1) return valOrOff & 0xFF;
        if (count <= 4) return valOrOff;
        if (valOrOff + count <= tiffBuf.length) {
          return tiffBuf.subarray(valOrOff, valOrOff + count).toString('utf-8').replace(/\0.*$/, '');
        }
        return undefined;
      case 2:
        if (count <= 4) {
          const buf = Buffer.alloc(4);
          if (isLE) buf.writeUInt32LE(valOrOff); else buf.writeUInt32BE(valOrOff);
          return buf.subarray(0, count).toString('ascii').replace(/\0.*$/, '').trim();
        }
        if (valOrOff + count <= tiffBuf.length) {
          return tiffBuf.subarray(valOrOff, valOrOff + count).toString('ascii').replace(/\0.*$/, '').trim();
        }
        return undefined;
      case 3:
        return isLE ? (valOrOff & 0xFFFF) : (valOrOff >> 16);
      case 4:
        return valOrOff;
      case 5:
      case 10:
        if (valOrOff + 8 <= tiffBuf.length) {
          const num = readU32(valOrOff);
          const den = readU32(valOrOff + 4);
          if (den !== 0) return num / den;
          return num;
        }
        return undefined;
      default:
        return valOrOff;
    }
  };

  const parseIFD = (ifdOffset: number): Record<string, any> => {
    const ifdData: Record<string, any> = {};
    if (ifdOffset + 2 > tiffBuf.length) return ifdData;
    const numEntries = readU16(ifdOffset);
    let cur = ifdOffset + 2;

    for (let i = 0; i < numEntries && cur + 12 <= tiffBuf.length; i++, cur += 12) {
      const tag = readU16(cur);
      const type = readU16(cur + 2);
      const count = readU32(cur + 4);
      const valOrOff = readU32(cur + 8);
      const val = readTagValue(type, count, valOrOff);

      switch (tag) {
        case 0x010F: ifdData.make = val; break;
        case 0x0110: ifdData.model = val; break;
        case 0x0112: ifdData.orientation = val; break;
        case 0x0131: ifdData.software = val; break;
        case 0x0132: ifdData.modifyDate = val; break;
        case 0x829A: ifdData.exposureTime = val < 1 && val > 0 ? `1/${Math.round(1 / val)}s` : `${val}s`; break;
        case 0x829D: ifdData.fNumber = `f/${val}`; break;
        case 0x8827: ifdData.iso = val; break;
        case 0x9003: ifdData.dateTimeOriginal = val; break;
        case 0x9004: ifdData.dateTimeDigitized = val; break;
        case 0x920A: ifdData.focalLength = `${val}mm`; break;
        case 0xA434: ifdData.lensModel = val; break;
        case 0xA002: ifdData.pixelXDimension = val; break;
        case 0xA003: ifdData.pixelYDimension = val; break;
        case 0x8769:
          if (typeof valOrOff === 'number' && valOrOff > 0) {
            Object.assign(ifdData, parseIFD(valOrOff));
          }
          break;
        case 0x8825:
          if (typeof valOrOff === 'number' && valOrOff > 0) {
            ifdData.gps = parseGPS(valOrOff);
          }
          break;
      }
    }
    return ifdData;
  };

  const parseGPS = (gpsOffset: number): Record<string, any> => {
    const gpsData: Record<string, any> = {};
    if (gpsOffset + 2 > tiffBuf.length) return gpsData;
    const numEntries = readU16(gpsOffset);
    let cur = gpsOffset + 2;

    let latRef = 'N', lonRef = 'E';
    const latParts: number[] = [], lonParts: number[] = [];

    for (let i = 0; i < numEntries && cur + 12 <= tiffBuf.length; i++, cur += 12) {
      const tag = readU16(cur);
      const valOrOff = readU32(cur + 8);

      if (tag === 0x0001) {
        latRef = String.fromCharCode((valOrOff >> (isLE ? 0 : 24)) & 0xFF);
      } else if (tag === 0x0002 && valOrOff + 24 <= tiffBuf.length) {
        for (let j = 0; j < 3; j++) {
          const num = readU32(valOrOff + j * 8);
          const den = readU32(valOrOff + j * 8 + 4);
          latParts.push(den ? num / den : num);
        }
      } else if (tag === 0x0003) {
        lonRef = String.fromCharCode((valOrOff >> (isLE ? 0 : 24)) & 0xFF);
      } else if (tag === 0x0004 && valOrOff + 24 <= tiffBuf.length) {
        for (let j = 0; j < 3; j++) {
          const num = readU32(valOrOff + j * 8);
          const den = readU32(valOrOff + j * 8 + 4);
          lonParts.push(den ? num / den : num);
        }
      } else if (tag === 0x0006 && valOrOff + 8 <= tiffBuf.length) {
        const num = readU32(valOrOff);
        const den = readU32(valOrOff + 4);
        gpsData.altitudeMeters = den ? Math.round(num / den) : num;
      }
    }

    if (latParts.length === 3) {
      let dec = latParts[0] + latParts[1] / 60 + latParts[2] / 3600;
      if (latRef === 'S') dec = -dec;
      gpsData.latitude = Number(dec.toFixed(6));
    }
    if (lonParts.length === 3) {
      let dec = lonParts[0] + lonParts[1] / 60 + lonParts[2] / 3600;
      if (lonRef === 'W') dec = -dec;
      gpsData.longitude = Number(dec.toFixed(6));
    }

    return gpsData;
  };

  return parseIFD(firstIFDOffset);
}
