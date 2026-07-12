/**
 * Post-process a GLB ArrayBuffer through @gltf-transform to shrink file size.
 * Applies: dedup → prune → quantize (lossless or near-lossless).
 */
import { WebIO } from "@gltf-transform/core";
import { dedup, prune, quantize } from "@gltf-transform/functions";

const io = new WebIO();

export async function optimizeGlb(glb: ArrayBuffer): Promise<ArrayBuffer> {
  const doc = await io.readBinary(new Uint8Array(glb));
  await doc.transform(dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));
  const out = await io.writeBinary(doc);
  return out.buffer as ArrayBuffer;
}
