/**
 * Phase 2: Generate diverse PNG test images and run through PNG-to-SVG pipeline.
 * No internet needed - creates PNGs with pure Node.js + zlib.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- Pure PNG encoder (RGBA, no deps) ---
function crc32(buf) {
  let c = 0xFFFFFFFF;
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let v = i;
    for (let j = 0; j < 8; j++) v = v & 1 ? 0xEDB88320 ^ (v >>> 1) : v >>> 1;
    t[i] = v;
  }
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const tb = Buffer.from(type);
  const lb = Buffer.alloc(4);
  lb.writeUInt32BE(data.length);
  const cb = Buffer.concat([tb, data]);
  const crb = Buffer.alloc(4);
  crb.writeUInt32BE(crc32(cb));
  return Buffer.concat([lb, cb, crb]);
}

function encodePng(w, h, pixels) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = y * (1 + w * 4) + 1 + x * 4;
      raw[di] = pixels[si]; raw[di+1] = pixels[si+1];
      raw[di+2] = pixels[si+2]; raw[di+3] = pixels[si+3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makePixels(w, h, fn) {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a = 255] = fn(x, y, w, h);
      px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = a;
    }
  return px;
}

// --- Test image generators ---
const TESTS = [
  // 1-5: Solid colors
  { name: 'solid-red', fn: (x,y,w,h) => [220,50,50] },
  { name: 'solid-blue', fn: (x,y,w,h) => [30,100,220] },
  { name: 'solid-green', fn: (x,y,w,h) => [50,180,50] },
  { name: 'solid-white-on-black', fn: (x,y,w,h) => {
    const cx=w/2, cy=h/2, r=Math.min(w,h)*0.4;
    return Math.hypot(x-cx,y-cy)<r ? [255,255,255] : [0,0,0];
  }},
  { name: 'solid-black-on-white', fn: (x,y,w,h) => {
    const cx=w/2, cy=h/2, r=Math.min(w,h)*0.4;
    return Math.hypot(x-cx,y-cy)<r ? [0,0,0] : [255,255,255];
  }},

  // 6-10: Gradients
  { name: 'h-gradient', fn: (x,y,w,h) => [Math.round(255*x/w),50,200] },
  { name: 'v-gradient', fn: (x,y,w,h) => [50,Math.round(255*y/h),100] },
  { name: 'diagonal-gradient', fn: (x,y,w,h) => {
    const v = (x/w + y/h) / 2;
    return [Math.round(255*v), Math.round(100*(1-v)), 150];
  }},
  { name: 'radial-gradient', fn: (x,y,w,h) => {
    const d = Math.hypot(x-w/2, y-h/2) / (Math.min(w,h)/2);
    const v = Math.min(1, d);
    return [Math.round(255*v), 50, Math.round(255*(1-v))];
  }},
  { name: 'multi-band', fn: (x,y,w,h) => {
    const v = Math.floor((x/w)*6) % 3;
    return v===0 ? [220,50,50] : v===1 ? [50,180,50] : [50,100,220];
  }},

  // 11-15: Shapes
  { name: 'circle', fn: (x,y,w,h) => {
    const d = Math.hypot(x-w/2, y-h/2);
    const r = Math.min(w,h)*0.35;
    return d < r ? [50,120,200] : [255,255,255];
  }},
  { name: 'square', fn: (x,y,w,h) => {
    const pad = Math.min(w,h)*0.2;
    return (x>pad && x<w-pad && y>pad && y<h-pad) ? [200,80,40] : [255,255,255];
  }},
  { name: 'rounded-rect', fn: (x,y,w,h) => {
    const pad=Math.min(w,h)*0.2, r=Math.min(w,h)*0.1;
    const ix=Math.max(0,Math.min(1,(x-pad)/r,1-(x-(w-pad-r))/r));
    const iy=Math.max(0,Math.min(1,(y-pad)/r,1-(y-(h-pad-r))/r));
    return (ix>0 && iy>0) ? [80,160,80] : [255,255,255];
  }},
  { name: 'triangle', fn: (x,y,w,h) => {
    const cx=w/2, top=h*0.15, bot=h*0.85;
    const t = (y-top)/(bot-top);
    const halfW = t * w * 0.45;
    return (y>=top && y<=bot && Math.abs(x-cx)<halfW) ? [180,60,60] : [255,255,255];
  }},
  { name: 'ring', fn: (x,y,w,h) => {
    const d = Math.hypot(x-w/2, y-h/2);
    const r1=Math.min(w,h)*0.3, r2=Math.min(w,h)*0.4;
    return (d>=r1 && d<=r2) ? [60,60,180] : [255,255,255];
  }},

  // 16-20: Multiple objects
  { name: 'two-circles', fn: (x,y,w,h) => {
    const d1=Math.hypot(x-w*0.3,y-h/2), d2=Math.hypot(x-w*0.7,y-h/2);
    const r=Math.min(w,h)*0.2;
    if(d1<r) return [220,50,50];
    if(d2<r) return [50,50,220];
    return [255,255,255];
  }},
  { name: 'grid-circles', fn: (x,y,w,h) => {
    const cols=4, rows=4, r=Math.min(w,h)/(cols*3);
    for(let gy=0;gy<rows;gy++) for(let gx=0;gx<cols;gx++) {
      const cx=(gx+0.5)*w/cols, cy=(gy+0.5)*h/rows;
      if(Math.hypot(x-cx,y-cy)<r) return [50+gx*40,100+gy*30,150];
    }
    return [255,255,255];
  }},
  { name: 'checkerboard', fn: (x,y,w,h) => {
    const sz=Math.max(8,Math.round(Math.min(w,h)/8));
    return ((Math.floor(x/sz)+Math.floor(y/sz))%2===0) ? [40,40,40] : [220,220,220];
  }},
  { name: 'concentric-squares', fn: (x,y,w,h) => {
    const cx=w/2, cy=h/2, md=Math.max(Math.abs(x-cx),Math.abs(y-cy));
    const rings=5, sz=Math.min(w,h)/2;
    const ring=Math.floor((md/sz)*rings);
    return ring%2===0 ? [50+ring*30,80,150] : [255,255,255];
  }},
  { name: 'cross', fn: (x,y,w,h) => {
    const cx=w/2, cy=h/2, t=Math.min(w,h)*0.08;
    if((Math.abs(x-cx)<t)||(Math.abs(y-cy)<t)) return [30,30,30];
    return [255,255,255];
  }},

  // 21-25: Thin lines / detailed
  { name: 'thin-lines', fn: (x,y,w,h) => {
    const spacing=Math.max(4,Math.round(h/20));
    return (x%spacing<1 || y%spacing<1) ? [100,100,100] : [255,255,255];
  }},
  { name: 'star', fn: (x,y,w,h) => {
    const cx=w/2, cy=h/2, a=Math.atan2(y-cy,x-cx), d=Math.hypot(x-cx,y-cy);
    const r=Math.min(w,h)*0.4, starR=r*(0.4+0.6*Math.abs(Math.cos(a*2.5)));
    return d<starR ? [220,180,40] : [255,255,255];
  }},
  { name: 'text-like', fn: (x,y,w,h) => {
    // Simulate text characters with blocks
    const charW=w/12, charH=h/6;
    const gx=Math.floor(x/charW), gy=Math.floor(y/charH);
    const seed=(gx*7+gy*13)%5;
    const lx=(x%charW)/charW, ly=(y%charH)/charH;
    if(seed<2 && lx>0.2 && lx<0.8 && ly>0.3 && ly<0.7) return [20,20,20];
    if(seed===3 && ((lx>0.1&&lx<0.9&&ly>0.1&&ly<0.3)||(lx>0.1&&lx<0.9&&ly>0.7&&ly<0.9)||(lx>0.1&&lx<0.3&&ly>0.1&&ly<0.9))) return [40,40,40];
    return [255,255,255];
  }},
  { name: 'fine-detail', fn: (x,y,w,h) => {
    const cx=w/2, cy=h/2, d=Math.hypot(x-cx,y-cy);
    const r=Math.min(w,h)*0.4;
    if(d>r) return [255,255,255];
    const a=Math.atan2(y-cy,x-cx);
    if(Math.abs(Math.sin(a*12))>0.7) return [50,50,180];
    if(d>r*0.5) return [200,200,200];
    return [80,80,80];
  }},
  { name: 'dashed-ring', fn: (x,y,w,h) => {
    const d=Math.hypot(x-w/2,y-h/2);
    const r1=Math.min(w,h)*0.35, r2=Math.min(w,h)*0.4;
    if(d<r1||d>r2) return [255,255,255];
    const a=Math.atan2(y-h/2,x-w/2);
    return Math.sin(a*8)>0 ? [60,60,60] : [255,255,255];
  }},

  // 26-30: Gradient-like patterns (multi-tone)
  { name: 'sunset', fn: (x,y,w,h) => {
    const t=y/h;
    return [Math.round(200+55*t), Math.round(100*(1-t)), Math.round(80+100*t)];
  }},
  { name: 'ocean', fn: (x,y,w,h) => {
    const t=y/h;
    return [Math.round(30+40*t), Math.round(100+80*t), Math.round(150+105*t)];
  }},
  { name: 'fire', fn: (x,y,w,h) => {
    const t=1-y/h;
    return [Math.round(200+55*t), Math.round(50+150*t*t), Math.round(20)];
  }},
  { name: 'rainbow-bars', fn: (x,y,w,h) => {
    const bands=[[220,50,50],[220,150,30],[220,220,50],[50,180,50],[50,100,220],[100,50,200]];
    const i=Math.floor((x/w)*bands.length)%bands.length;
    return bands[i];
  }},
  { name: 'mesh-gradient', fn: (x,y,w,h) => {
    const t1=Math.hypot(x,y)/Math.hypot(w,h);
    const t2=Math.hypot(x-w,y-h)/Math.hypot(w,h);
    return [Math.round(100+155*t1), Math.round(80+100*(1-t2)), Math.round(150+100*t2)];
  }},

  // 31-35: Transparent / alpha
  { name: 'circle-alpha', fn: (x,y,w,h) => {
    const d=Math.hypot(x-w/2,y-h/2), r=Math.min(w,h)*0.4;
    return d<r ? [50,120,200,200] : [0,0,0,0];
  }},
  { name: 'gradient-alpha', fn: (x,y,w,h) => {
    const a=Math.round(255*x/w);
    return [200,80,80,a];
  }},
  { name: 'checkerboard-alpha', fn: (x,y,w,h) => {
    const sz=Math.max(8,Math.round(Math.min(w,h)/8));
    const light=((Math.floor(x/sz)+Math.floor(y/sz))%2===0);
    return light ? [255,255,255,255] : [200,200,200,128];
  }},
  { name: 'fade-circle', fn: (x,y,w,h) => {
    const d=Math.hypot(x-w/2,y-h/2), r=Math.min(w,h)*0.4;
    if(d>r) return [0,0,0,0];
    const a=Math.round(255*(1-d/r));
    return [80,130,220,a];
  }},
  { name: 'transparency-overlap', fn: (x,y,w,h) => {
    const d1=Math.hypot(x-w*0.4,y-h/2), d2=Math.hypot(x-w*0.6,y-h/2);
    const r=Math.min(w,h)*0.25;
    if(d1<r && d2<r) return [100,200,100,200];
    if(d1<r) return [220,80,80,180];
    if(d2<r) return [80,80,220,180];
    return [255,255,255,255];
  }},

  // 36-40: Complex / logo-like
  { name: 'logo-a', fn: (x,y,w,h) => {
    // Letter A shape
    const cx=w/2, t=Math.min(w,h)*0.08;
    const top=h*0.15, bot=h*0.85, mid=h*0.5;
    const halfWTop=t*0.1, halfWBot=(bot-top)*0.35;
    const frac=(y-top)/(bot-top);
    const hw=frac*halfWBot;
    const leftA=cx-hw, rightA=cx+hw;
    const barTop=mid-t*2, barBot=mid+t*2;
    if(y>=top && y<=bot && Math.abs(x-cx)<t*0.5) return [30,30,30];
    if(y>=barTop && y<=barBot && x>leftA && x<rightA) return [30,30,30];
    return [255,255,255];
  }},
  { name: 'logo-shield', fn: (x,y,w,h) => {
    const cx=w/2, top=h*0.1, mid=h*0.5, bot=h*0.9;
    const wTop=w*0.4, wMid=w*0.45;
    let inside=false;
    if(y>=top && y<=mid) {
      const frac=(y-top)/(mid-top);
      const hw=wTop+(wMid-wTop)*frac;
      inside=Math.abs(x-cx)<hw;
    } else if(y>mid && y<=bot) {
      const frac=(y-mid)/(bot-mid);
      const hw=wMid*(1-frac);
      inside=Math.abs(x-cx)<hw && frac<0.95;
    }
    return inside ? [40,80,160] : [255,255,255];
  }},
  { name: 'logo-bird', fn: (x,y,w,h) => {
    const cx=w*0.45, cy=h*0.5, d=Math.hypot((x-cx)*0.8,y-cy);
    const r=Math.min(w,h)*0.3;
    const wingX=x-w*0.55, wingY=y-h*0.3;
    const wingD=Math.hypot(wingX*1.5,wingY);
    const wingR=Math.min(w,h)*0.25;
    if(d<r || wingD<wingR) return [30,160,230];
    return [255,255,255];
  }},
  { name: 'logo-hex', fn: (x,y,w,h) => {
    const cx=w/2, cy=h/2, r=Math.min(w,h)*0.4;
    const a=Math.atan2(y-cy,x-cx)-Math.PI/2;
    const d=Math.hypot(x-cx,y-cy);
    const angle=((a%(Math.PI/3))+Math.PI/3)%(Math.PI/3);
    const edgeR=r*Math.cos(Math.PI/6)/Math.cos(angle-Math.PI/6);
    return d<edgeR ? [100,50,150] : [255,255,255];
  }},
  { name: 'logo-pie', fn: (x,y,w,h) => {
    const cx=w/2, cy=h/2, d=Math.hypot(x-cx,y-cy);
    const r=Math.min(w,h)*0.4;
    if(d>r) return [255,255,255];
    const a=((Math.atan2(y-cy,x-cx)+Math.PI*2)%(Math.PI*2))/(Math.PI*2);
    if(a<0.25) return [220,50,50];
    if(a<0.5) return [50,180,50];
    if(a<0.75) return [50,100,220];
    return [220,180,40];
  }},
];

const SIZES = [128, 512, 2000];

async function main() {
  const outDir = path.join(__dirname, 'qa-screenshots', 'simple-icons');
  fs.mkdirSync(outDir, { recursive: true });

  // Generate all PNGs
  console.log('Generating test PNGs...');
  for (const size of SIZES) {
    const sizeDir = path.join(outDir, `${size}px`);
    fs.mkdirSync(sizeDir, { recursive: true });
    for (const t of TESTS) {
      const px = makePixels(size, size, t.fn);
      const png = encodePng(size, size, px);
      fs.writeFileSync(path.join(sizeDir, `${t.name}.png`), png);
    }
  }
  console.log(`Generated ${TESTS.length} images × ${SIZES.length} sizes = ${TESTS.length * SIZES.length} PNGs\n`);

  // Launch browser and test
  const cp = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1229', 'chrome-win64', 'chrome.exe');
  const browser = await chromium.launch({ executablePath: cp, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message + '\n' + e.stack));

  await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(3000);

  const tabButtons = await page.$$('.flex.flex-col.gap-1 button');
  if (tabButtons.length >= 4) await tabButtons[3].click();
  await page.waitForTimeout(500);

  const results = [];

  for (const size of SIZES) {
    const sizeDir = path.join(outDir, `${size}px`);
    console.log(`\n===== Testing ${size}px images =====`);

    for (const t of TESTS) {
      const pngPath = path.join(sizeDir, `${t.name}.png`);
      pageErrors.length = 0;

      try {
        const fileInput = await page.$('input[type="file"]');
        await fileInput.setInputFiles(pngPath);
      } catch (e) {
        results.push({ size, name: t.name, status: 'ERROR', reason: 'Upload failed: ' + e.message });
        console.log(`  ${t.name}: ERROR (upload)`);
        continue;
      }

      let converted = false, svgSize = '0 B', error = null;
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(2000);
        const state = await page.evaluate(() => {
          const text = document.body.innerText;
          const svgMatch = text.match(/Optimized SVG[:\s]*([^\n]+)/);
          const errEl = document.querySelector('[class*="text-red"]');
          return { svgSize: svgMatch?.[1]?.trim() || 'not found', error: errEl?.textContent || null };
        });
        svgSize = state.svgSize;
        error = state.error;
        if (error) break;
        if (svgSize && svgSize !== '0 B' && svgSize !== 'not found') { converted = true; break; }
      }

      if (error) {
        results.push({ size, name: t.name, status: 'ERROR', reason: error, pageErrors: pageErrors.slice(0, 3) });
        console.log(`  ${t.name}: ERROR - ${error}`);
      } else if (converted) {
        results.push({ size, name: t.name, status: 'OK', svgSize });
        console.log(`  ${t.name}: OK (${svgSize})`);
      } else {
        results.push({ size, name: t.name, status: 'TIMEOUT', svgSize });
        console.log(`  ${t.name}: TIMEOUT (SVG: ${svgSize})`);
      }

      // Reset
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Cancel');
        if (btn) btn.click();
      });
      await page.waitForTimeout(300);
    }
  }

  // Summary
  const ok = results.filter(r => r.status === 'OK');
  const errors = results.filter(r => r.status === 'ERROR');
  const timeouts = results.filter(r => r.status === 'TIMEOUT');

  console.log('\n========== FINAL SUMMARY ==========');
  console.log(`Total: ${results.length} (${TESTS.length} images × ${SIZES.length} sizes)`);
  console.log(`OK: ${ok.length}`);
  console.log(`ERROR: ${errors.length}`);
  console.log(`TIMEOUT: ${timeouts.length}`);

  if (errors.length) {
    console.log('\nFailed:');
    errors.forEach(r => console.log(`  [${r.size}px] ${r.name}: ${r.reason}`));
    if (errors.some(r => r.pageErrors?.length)) {
      console.log('\nPage errors from failures:');
      errors.filter(r => r.pageErrors?.length).forEach(r => {
        console.log(`  [${r.size}px] ${r.name}: ${r.pageErrors[0]?.substring(0, 300)}`);
      });
    }
  }
  if (timeouts.length) {
    console.log('\nTimed out:');
    timeouts.forEach(r => console.log(`  [${r.size}px] ${r.name}: SVG=${r.svgSize}`));
  }

  // Save results JSON
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log('\nResults saved to qa-screenshots/simple-icons/results.json');

  await browser.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
