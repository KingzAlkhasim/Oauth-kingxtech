export const BINARY_PREFIX = '__KX_BINARY_BASE64__:';
export const MAX_BINARY_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_PROJECT_BINARY_BYTES = 25 * 1024 * 1024;
export const SUPPORTED_BINARY_EXTENSIONS = new Set(['png','jpg','jpeg','gif','webp','avif','ico','woff','woff2','ttf','otf','pdf']);
export const SUPPORTED_ASSET_EXTENSIONS = new Set([...SUPPORTED_BINARY_EXTENSIONS,'svg']);
export function extensionOf(path: string): string { return path.split('/').pop()?.split('.').pop()?.toLowerCase() ?? ''; }
export function decodeBinaryContent(content: string): Buffer | null {
 if (!content.startsWith(BINARY_PREFIX)) return null;
 const encoded=content.slice(BINARY_PREFIX.length);
 if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Binary file data is not valid base64.');
 const bytes=Buffer.from(encoded,'base64');
 if (bytes.toString('base64')!==encoded) throw new Error('Binary file data is not valid base64.');
 return bytes;
}
export function validateSvgText(path: string, content: string): void {
 if(extensionOf(path)!=='svg') return;
 if(Buffer.byteLength(content, 'utf8') > MAX_BINARY_FILE_BYTES) throw new Error('This file is larger than 5 MB. Choose a smaller file.');
 if(!/<svg(?:\\s|>)/i.test(content)) throw new Error('This .svg file does not contain a valid SVG image.');
 if(/<script\\b/i.test(content)||/\\bon[a-z][a-z0-9_-]*\\s*=/i.test(content)||/javascript\\s*:/i.test(content)) throw new Error('This SVG contains script or unsafe event code. Remove scripts, on* handlers, and javascript: URLs before uploading.');
}
export function validateBinaryBytes(path: string, bytes: Buffer): void {
 const ext=extensionOf(path);
 if(!SUPPORTED_BINARY_EXTENSIONS.has(ext)) throw new Error('Unsupported binary file type. Allowed: PNG, JPG/JPEG, GIF, WebP, AVIF, ICO, WOFF/WOFF2, TTF, OTF, and PDF.');
 if(bytes.length>MAX_BINARY_FILE_BYTES) throw new Error('This file is larger than 5 MB. Choose a smaller file.');
 const starts=(...values:number[])=>values.every((value,index)=>bytes[index]===value);
 let valid=false;
 switch(ext){
 case 'png':valid=starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a);break;
 case 'jpg':case 'jpeg':valid=starts(0xff,0xd8,0xff);break;
 case 'gif':valid=['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'));break;
 case 'webp':valid=bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP';break;
 case 'avif':valid=bytes.length>=16&&bytes.subarray(4,8).toString('ascii')==='ftyp'&&/avif|avis/.test(bytes.subarray(8,16).toString('ascii'));break;
 case 'ico':valid=starts(0x00,0x00,0x01,0x00);break;
 case 'woff':valid=bytes.subarray(0,4).toString('ascii')==='wOFF';break;
 case 'woff2':valid=bytes.subarray(0,4).toString('ascii')==='wOF2';break;
 case 'ttf':valid=starts(0x00,0x01,0x00,0x00)||bytes.subarray(0,4).toString('ascii')==='true';break;
 case 'otf':valid=bytes.subarray(0,4).toString('ascii')==='OTTO';break;
 case 'pdf':valid=bytes.subarray(0,5).toString('ascii')==='%PDF-';break;
 }
 if(!valid)throw new Error(`The file content does not match its .${ext} extension. Choose a genuine ${ext.toUpperCase()} file.`);
}