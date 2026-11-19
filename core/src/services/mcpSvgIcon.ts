import sharp from 'sharp';

// Turns AI-written SVG into a 512x512 PNG for the Install-as-App icon. The SVG is untrusted text, so it is
// checked hard before the renderer sees it: no scripts, no external or embedded resources, no entity tricks.

export const MAX_ICON_SVG_CHARS = 60_000;

export class SvgIconError extends Error {}

export function checkIconSvg(svg: string): string {
  const s = svg.trim();
  if (s.length === 0) throw new SvgIconError('"svg" is required.');
  if (s.length > MAX_ICON_SVG_CHARS) throw new SvgIconError(`SVG is larger than ${MAX_ICON_SVG_CHARS.toLocaleString('en-US')} characters. Simplify the design.`);
  if (!/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(s)) throw new SvgIconError('The SVG must start with an <svg> element.');
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[(?!\s*[^<]*\]\]>)/i.test(s)) throw new SvgIconError('DOCTYPE and ENTITY declarations are not allowed.');
  if (/<\s*(script|foreignObject|image|iframe|object|embed|style|use|a|animate|set|feImage|filter)\b/i.test(s)) {
    throw new SvgIconError('Use only simple shapes, paths, text, gradients and groups. <image>, <use>, <style>, <filter>, <script>, <a>, <foreignObject> and animation are not allowed.');
  }
  if (/\bon[a-z]+\s*=/i.test(s) || /javascript\s*:/i.test(s) || /data\s*:/i.test(s)) throw new SvgIconError('Event handlers, javascript: and data: URLs are not allowed.');
  // Only the SVG namespace may look like a URL. Anything else (href, url(http...), @import) could make the renderer fetch something.
  const withoutNs = s.replace(/xmlns(:\w+)?\s*=\s*["']http:\/\/www\.w3\.org\/[^"']*["']/gi, '');
  if (/https?:\/\/|\/\/\w|\bhref\s*=|xlink:/i.test(withoutNs) || /url\(\s*["']?(?!#)/i.test(withoutNs)) throw new SvgIconError('External links are not allowed. Use only inline shapes and url(#id) gradients.');
  if (!/viewBox\s*=/i.test(s) && !/\bwidth\s*=/i.test(s)) throw new SvgIconError('Add a viewBox, for example viewBox="0 0 512 512".');
  return s;
}

/** Renders the checked SVG to a square 512 PNG. Throws SvgIconError when it cannot be drawn. */
export async function renderIconPng(svg: string): Promise<Buffer> {
  const clean = checkIconSvg(svg);
  try {
    return await sharp(Buffer.from(clean, 'utf8'), { limitInputPixels: 4096 * 4096, density: 144 })
      .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
  } catch {
    throw new SvgIconError('That SVG could not be drawn. Check that it is valid SVG.');
  }
}
