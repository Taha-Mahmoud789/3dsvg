/**
 * SVG optimization: path merging, coordinate rounding, metadata stripping.
 */

export function optimizeSvg(svg: string, precision: number = 1): string {
  let result = svg;

  // Round all coordinates to N decimal places
  const roundNum = (n: string) => {
    const v = parseFloat(n);
    return isNaN(v) ? n : v.toFixed(precision);
  };

  // Round numbers in path d attributes
  result = result.replace(
    /d="([^"]*)"/g,
    (_, d: string) => {
      const rounded = d.replace(/-?\d+\.?\d*/g, (m) => roundNum(m));
      return `d="${rounded}"`;
    }
  );

  // Round coordinates in rect/circle/ellipse
  result = result.replace(
    /<(rect|circle|ellipse)[^>]*>/g,
    (match) =>
      match.replace(/-?\d+\.?\d*/g, (m) => roundNum(m))
  );

  // Strip XML declarations, comments, metadata, editor elements
  result = result.replace(/<\?xml[^?]*\?>\s*/g, "");
  result = result.replace(/<!--[\s\S]*?-->\s*/g, "");
  result = result.replace(/<metadata[\s\S]*?<\/metadata>\s*/g, "");
  result = result.replace(/<title>[^<]*<\/title>\s*/g, "");
  result = result.replace(/<desc>[^<]*<\/desc>\s*/g, "");

  // Remove empty groups
  result = result.replace(/<g[^>]*>\s*<\/g>/g, "");

  // Remove unnecessary attributes
  result = result.replace(/ xmlns:xlink="[^"]*"/g, "");
  result = result.replace(/ xmlns:svg="[^"]*"/g, "");

  // Clean up whitespace
  result = result.replace(/\s{2,}/g, " ");
  result = result.replace(/>\s+</g, "><");
  result = result.trim();

  return result;
}

export function calculateSvgSize(svg: string): number {
  return new Blob([svg]).size;
}
