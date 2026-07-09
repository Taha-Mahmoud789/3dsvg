// @vitest-environment jsdom
/**
 * Test: SVG color resolution via DOMParser
 * Verifies that resolveSVGColors correctly resolves fill/stroke colors for:
 * 1. Single-color icon
 * 2. Two-color icon
 * 3. 5+ color complex illustration
 * 4. SVG with inherited fill from parent <g>
 *
 * Also tests: inline style, <style> blocks, CSS classes, currentColor,
 * fill="none", named colors, and missing fill (default black).
 *
 * We test the resolveSVGColors function in isolation (DOMParser-based)
 * since SVGLoader has compatibility issues in test environments.
 */
import { describe, it, expect } from "vitest";

const SVG_DEFAULT_FILL = "#000000";

function resolveSVGColors(svgString: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) return svgString;

  const styleBlocks = doc.querySelectorAll("style");
  const styleRules: { selector: string; props: Record<string, string> }[] = [];
  for (const styleEl of styleBlocks) {
    const css = styleEl.textContent || "";
    const ruleRe = /([^{]+)\{([^}]+)\}/g;
    let rm: RegExpExecArray | null;
    while ((rm = ruleRe.exec(css)) !== null) {
      const selector = rm[1].trim();
      const decls = rm[2];
      const props: Record<string, string> = {};
      const declRe = /([a-z-]+)\s*:\s*([^;]+)/g;
      let dm: RegExpExecArray | null;
      while ((dm = declRe.exec(decls)) !== null) {
        props[dm[1].trim()] = dm[2].trim();
      }
      styleRules.push({ selector, props });
    }
  }

  function matchesSelector(el: Element, selector: string): boolean {
    const sel = selector.trim().toLowerCase();
    if (sel.includes(" ")) {
      const parts = sel.split(/\s+/);
      const lastPart = parts[parts.length - 1];
      if (!matchesSimple(el, lastPart)) return false;
      const parentSel = parts.slice(0, -1).join(" ");
      let parent = el.parentElement;
      while (parent) {
        if (matchesSelector(parent, parentSel)) return true;
        parent = parent.parentElement;
      }
      return false;
    }
    return matchesSimple(el, sel);
  }

  function matchesSimple(el: Element, sel: string): boolean {
    const tag = el.tagName.toLowerCase();
    const id = el.id;
    const classes = el.getAttribute("class")?.split(/\s+/) || [];
    if (sel.startsWith(".")) return classes.includes(sel.slice(1));
    if (sel.startsWith("#")) return id === sel.slice(1);
    if (sel.includes(".")) {
      const [t, c] = sel.split(".", 2);
      return tag === t && classes.includes(c);
    }
    if (sel.includes("#")) {
      const [t, i] = sel.split("#", 2);
      return tag === t && id === i;
    }
    return tag === sel;
  }

  function resolveFill(el: Element): string {
    let current: Element | null = el;
    while (current && current !== svgEl) {
      const inlineStyle = current.getAttribute("style");
      if (inlineStyle) {
        const fillMatch = inlineStyle.match(/(?:^|;\s*)fill\s*:\s*([^;]+)/i);
        if (fillMatch) {
          const val = fillMatch[1].trim();
          if (val !== "inherit" && val !== "unset" && val !== "initial") {
            return normalizeColor(val);
          }
        }
      }
      const fillAttr = current.getAttribute("fill");
      if (fillAttr && fillAttr !== "inherit" && fillAttr !== "unset" && fillAttr !== "initial") {
        return normalizeColor(fillAttr);
      }
      current = current.parentElement;
    }
    for (const rule of styleRules) {
      if (matchesSelector(el, rule.selector)) {
        if ("fill" in rule.props) return normalizeColor(rule.props.fill);
      }
    }
    return SVG_DEFAULT_FILL;
  }

  function resolveStroke(el: Element): string | null {
    let current: Element | null = el;
    while (current && current !== svgEl) {
      const inlineStyle = current.getAttribute("style");
      if (inlineStyle) {
        const strokeMatch = inlineStyle.match(/(?:^|;\s*)stroke\s*:\s*([^;]+)/i);
        if (strokeMatch) {
          const val = strokeMatch[1].trim();
          if (val !== "inherit" && val !== "unset" && val !== "initial" && val !== "none") {
            return normalizeColor(val);
          }
          if (val === "none") return null;
        }
      }
      const strokeAttr = current.getAttribute("stroke");
      if (strokeAttr) {
        if (strokeAttr === "none") return null;
        if (strokeAttr !== "inherit" && strokeAttr !== "unset" && strokeAttr !== "initial") {
          return normalizeColor(strokeAttr);
        }
      }
      current = current.parentElement;
    }
    for (const rule of styleRules) {
      if (matchesSelector(el, rule.selector)) {
        if ("stroke" in rule.props) {
          const val = rule.props.stroke;
          if (val === "none") return null;
          return normalizeColor(val);
        }
      }
    }
    return null;
  }

  function normalizeColor(val: string): string {
    const v = val.trim().toLowerCase();
    if (v === "none" || v === "transparent") return "none";
    if (v === "currentColor" || v === "currentcolor") return SVG_DEFAULT_FILL;
    if (v.startsWith("var(")) return SVG_DEFAULT_FILL;
    if (v.startsWith("#")) return v;
    if (v.startsWith("rgb")) return v;
    if (v.startsWith("hsl")) return v;
    if (/^[a-z]+$/.test(v)) return val.trim();
    return val.trim();
  }

  // Two-pass: compute all fills/strokes first, then apply (prevents DOM mutation
  // during resolution from poisoning parent-walk inheritance)
  const shapeTags = ["path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "text", "g"];
  const allElements = [...svgEl.querySelectorAll("*")];
  const resolved: { el: Element; fill: string; stroke: string | null }[] = [];
  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    if (!shapeTags.includes(tag)) continue;
    resolved.push({ el, fill: resolveFill(el), stroke: resolveStroke(el) });
  }

  for (const { el, fill, stroke } of resolved) {
    if (fill && fill !== "none") {
      el.setAttribute("fill", fill);
    } else if (fill === "none") {
      el.setAttribute("fill", "none");
    }
    if (stroke) el.setAttribute("stroke", stroke);

    const inlineStyle = el.getAttribute("style");
    if (inlineStyle) {
      const keptProps: string[] = [];
      const parts = inlineStyle.split(";");
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const prop = trimmed.split(":")[0]?.trim().toLowerCase();
        if (prop && prop !== "fill" && prop !== "stroke" && prop !== "fill-opacity" && prop !== "stroke-opacity") {
          keptProps.push(trimmed);
        }
      }
      if (keptProps.length > 0) {
        el.setAttribute("style", keptProps.join("; "));
      } else {
        el.removeAttribute("style");
      }
    }
  }

  for (const styleEl of styleBlocks) styleEl.remove();

  const serializer = new XMLSerializer();
  return serializer.serializeToString(svgEl);
}

/** Helper: resolve colors and return the fill attribute of each shape element */
function getResolvedFills(svgString: string): { tag: string; fill: string | null }[] {
  const resolved = resolveSVGColors(svgString);
  const parser = new DOMParser();
  const doc = parser.parseFromString(resolved, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) return [];

  const results: { tag: string; fill: string | null }[] = [];
  const shapeTags = ["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"];
  for (const tag of shapeTags) {
    for (const el of svgEl.querySelectorAll(tag)) {
      results.push({ tag, fill: el.getAttribute("fill") });
    }
  }
  return results;
}

// ---- TEST SVGs ----

const SVG_SINGLE_COLOR = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="black"/>
</svg>`;

const SVG_TWO_COLOR = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <rect x="10" y="10" width="80" height="80" fill="#ff0000"/>
  <circle cx="50" cy="50" r="20" fill="#00ff00"/>
</svg>`;

const SVG_FIVE_COLORS = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <rect x="0" y="0" width="100" height="100" fill="#ff0000"/>
  <circle cx="25" cy="25" r="15" fill="#00ff00"/>
  <circle cx="75" cy="25" r="15" fill="#0000ff"/>
  <circle cx="25" cy="75" r="15" fill="#ffff00"/>
  <circle cx="75" cy="75" r="15" fill="#ff00ff"/>
  <path d="M50 10 L90 90 L10 90 Z" fill="#00ffff"/>
</svg>`;

const SVG_INHERITED_FILL = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <g fill="#ff0000">
    <path d="M10 10 L40 10 L40 40 L10 40 Z"/>
    <path d="M50 10 L80 10 L80 40 L50 40 Z"/>
  </g>
  <g fill="#0000ff">
    <path d="M10 50 L40 50 L40 80 L10 80 Z"/>
    <path d="M50 50 L80 50 L80 80 L50 80 Z"/>
  </g>
</svg>`;

const SVG_INHERITED_WITH_OVERRIDE = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <g fill="#ff0000">
    <path d="M10 10 L40 10 L40 40 L10 40 Z"/>
    <path d="M50 10 L80 10 L80 40 L50 40 Z" fill="#00ff00"/>
  </g>
</svg>`;

const SVG_STYLE_BLOCK = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <defs><style>.red{fill:#ff0000}.blue{fill:#0000ff}</style></defs>
  <path class="red" d="M10 10 L40 10 L40 40 L10 40 Z"/>
  <path class="blue" d="M50 50 L80 50 L80 80 L50 80 Z"/>
</svg>`;

const SVG_INLINE_STYLE = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <path style="fill:#ff0000" d="M10 10 L40 10 L40 40 L10 40 Z"/>
  <path style="fill:#00ff00" d="M50 50 L80 50 L80 80 L50 80 Z"/>
</svg>`;

const SVG_STROKE_ONLY = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <path fill="none" stroke="#ff0000" stroke-width="3" d="M10 10 L90 10 L90 90 L10 90 Z"/>
</svg>`;

const SVG_NO_FILL = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <path d="M10 10 L40 10 L40 40 L10 40 Z"/>
</svg>`;

const SVG_CURRENTCOLOR = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <path fill="currentColor" d="M10 10 L40 10 L40 40 L10 40 Z"/>
</svg>`;

const SVG_CSS_VAR = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <path fill="var(--my-color)" d="M10 10 L40 10 L40 40 L10 40 Z"/>
</svg>`;

const SVG_NAMED_COLOR = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <path fill="tomato" d="M10 10 L40 10 L40 40 L10 40 Z"/>
  <path fill="dodgerblue" d="M50 50 L80 50 L80 80 L50 80 Z"/>
</svg>`;

const SVG_STYLE_ELEMENT_SELECTOR = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <defs><style>path{fill:#ff0000}circle{fill:#00ff00}</style></defs>
  <path d="M10 10 L40 10 L40 40 L10 40 Z"/>
  <circle cx="65" cy="65" r="15"/>
</svg>`;

const SVG_DEEP_INHERITANCE = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <g fill="#ff0000">
    <g>
      <g>
        <path d="M10 10 L40 10 L40 40 L10 40 Z"/>
      </g>
    </g>
  </g>
</svg>`;

const SVG_CLASS_FILLS_IN_G = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    .s0 { fill: #5e17eb }
    .s1 { fill: #ffbd59 }
  </style>
  <g id="group">
    <path id="purple" class="s0" d="M10 10 L40 10 L40 40 L10 40 Z"/>
    <path id="orange" class="s1" d="M50 50 L80 50 L80 80 L50 80 Z"/>
  </g>
</svg>`;

// ---- TESTS ----

describe("resolveSVGColors", () => {
  it("1. Single-color icon: fill preserved as-is", () => {
    const fills = getResolvedFills(SVG_SINGLE_COLOR);
    expect(fills.length).toBe(1);
    expect(fills[0].fill).toBe("black");
  });

  it("2. Two-color icon: 2 distinct fills", () => {
    const fills = getResolvedFills(SVG_TWO_COLOR);
    expect(fills.length).toBe(2);
    const colors = fills.map((f) => f.fill).filter(Boolean);
    expect([...new Set(colors)]).toEqual(expect.arrayContaining(["#ff0000", "#00ff00"]));
  });

  it("3. 5+ color illustration: all 6 fills preserved", () => {
    const fills = getResolvedFills(SVG_FIVE_COLORS);
    expect(fills.length).toBe(6);
    const colors = fills.map((f) => f.fill).filter(Boolean);
    const distinct = [...new Set(colors)];
    expect(distinct.length).toBe(6);
  });

  it("4. Inherited fill from <g>: children get parent's fill", () => {
    const fills = getResolvedFills(SVG_INHERITED_FILL);
    expect(fills.length).toBe(4);
    const colors = fills.map((f) => f.fill);
    // All 4 paths should have inherited fill from their parent <g>
    expect(colors.slice(0, 2).every((c) => c === "#ff0000")).toBe(true);
    expect(colors.slice(2, 4).every((c) => c === "#0000ff")).toBe(true);
  });

  it("4b. Inline style override beats inherited fill", () => {
    const fills = getResolvedFills(SVG_INHERITED_WITH_OVERRIDE);
    expect(fills.length).toBe(2);
    expect(fills[0].fill).toBe("#ff0000"); // inherited from <g>
    expect(fills[1].fill).toBe("#00ff00"); // inline style overrides <g>
  });

  it("5. <style> block class selectors", () => {
    const fills = getResolvedFills(SVG_STYLE_BLOCK);
    expect(fills.length).toBe(2);
    expect(fills[0].fill).toBe("#ff0000");
    expect(fills[1].fill).toBe("#0000ff");
  });

  it("6. Inline style attribute", () => {
    const fills = getResolvedFills(SVG_INLINE_STYLE);
    expect(fills.length).toBe(2);
    expect(fills[0].fill).toBe("#ff0000");
    expect(fills[1].fill).toBe("#00ff00");
  });

  it("7. fill='none' with stroke-only shapes", () => {
    const fills = getResolvedFills(SVG_STROKE_ONLY);
    expect(fills.length).toBe(1);
    expect(fills[0].fill).toBe("none");
  });

  it("8. No fill specified defaults to black", () => {
    const fills = getResolvedFills(SVG_NO_FILL);
    expect(fills.length).toBe(1);
    expect(fills[0].fill).toBe("#000000");
  });

  it("9. currentColor falls back to black", () => {
    const fills = getResolvedFills(SVG_CURRENTCOLOR);
    expect(fills.length).toBe(1);
    expect(fills[0].fill).toBe("#000000");
  });

  it("10. CSS variable falls back to black", () => {
    const fills = getResolvedFills(SVG_CSS_VAR);
    expect(fills.length).toBe(1);
    expect(fills[0].fill).toBe("#000000");
  });

  it("11. Named colors are preserved", () => {
    const fills = getResolvedFills(SVG_NAMED_COLOR);
    expect(fills.length).toBe(2);
    expect(fills[0].fill).toBe("tomato");
    expect(fills[1].fill).toBe("dodgerblue");
  });

  it("12. <style> element selectors (path, circle)", () => {
    const fills = getResolvedFills(SVG_STYLE_ELEMENT_SELECTOR);
    expect(fills.length).toBe(2);
    expect(fills[0].fill).toBe("#ff0000"); // path matched by element selector
    expect(fills[1].fill).toBe("#00ff00"); // circle matched by element selector
  });

  it("13. Deeply nested inheritance (3 levels of <g>)", () => {
    const fills = getResolvedFills(SVG_DEEP_INHERITANCE);
    expect(fills.length).toBe(1);
    expect(fills[0].fill).toBe("#ff0000");
  });

  it("14. Class-based fills inside <g> wrapper (GeekCode regression)", () => {
    const fills = getResolvedFills(SVG_CLASS_FILLS_IN_G);
    expect(fills.length).toBe(2);
    expect(fills[0].fill).toBe("#5e17eb"); // .s0 = purple
    expect(fills[1].fill).toBe("#ffbd59"); // .s1 = orange
  });
});
