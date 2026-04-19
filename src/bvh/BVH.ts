/**
 * SAH BVH builder producing a GPU-friendly flat layout.
 *
 * Node layout (32 bytes / 8 floats / 2 texels):
 *   offset 0: min.x, min.y, min.z, leftOrFirst (u32 bits reinterpreted as f32)
 *   offset 4: max.x, max.y, max.z, primCount   (u32 bits reinterpreted as f32)
 *
 *   primCount == 0  -> internal node. leftChild = leftOrFirst, rightChild = leftChild + 1
 *                      (sibling pairs are always stored consecutively by the flattener)
 *   primCount >  0  -> leaf. primStart = leftOrFirst
 *
 * Triangle layout (96 bytes / 24 floats / 6 texels per triangle):
 *   v0.xyz _, v1.xyz _, v2.xyz _, n0.xyz _, n1.xyz _, n2.xyz _
 */

export const BVH_FLOATS_PER_NODE = 8;
export const TRI_FLOATS_PER_TRI = 24;
export const TRI_TEXELS_PER_TRI = 6;
export const BVH_TEXELS_PER_NODE = 2;
const MAX_TRIS_PER_LEAF = 4;
const SAH_BINS = 12;
const TRAVERSE_COST = 1.0;
const INTERSECT_COST = 1.2;

export interface BuildInput {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface FlatBVH {
  nodeCount: number;
  triCount: number;
  nodes: Float32Array;
  triangles: Float32Array;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

interface TriRef {
  bminX: number;
  bminY: number;
  bminZ: number;
  bmaxX: number;
  bmaxY: number;
  bmaxZ: number;
  cx: number;
  cy: number;
  cz: number;
  srcIndex: number;
}

interface BuildNode {
  bmin: [number, number, number];
  bmax: [number, number, number];
  left: BuildNode | null;
  right: BuildNode | null;
  start: number;
  count: number;
}

const bitsF32 = new Float32Array(1);
const bitsU32 = new Uint32Array(bitsF32.buffer);

function u32ToF32(u: number): number {
  bitsU32[0] = u >>> 0;
  return bitsF32[0];
}

export function buildBVH(inputs: BuildInput[]): FlatBVH {
  const refs: TriRef[] = [];
  const triVerts: number[][] = [];
  const triNormals: number[][] = [];

  for (const input of inputs) {
    const { positions, normals, indices } = input;
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i];
      const i1 = indices[i + 1];
      const i2 = indices[i + 2];
      const p0x = positions[i0 * 3];
      const p0y = positions[i0 * 3 + 1];
      const p0z = positions[i0 * 3 + 2];
      const p1x = positions[i1 * 3];
      const p1y = positions[i1 * 3 + 1];
      const p1z = positions[i1 * 3 + 2];
      const p2x = positions[i2 * 3];
      const p2y = positions[i2 * 3 + 1];
      const p2z = positions[i2 * 3 + 2];

      const bminX = Math.min(p0x, p1x, p2x);
      const bminY = Math.min(p0y, p1y, p2y);
      const bminZ = Math.min(p0z, p1z, p2z);
      const bmaxX = Math.max(p0x, p1x, p2x);
      const bmaxY = Math.max(p0y, p1y, p2y);
      const bmaxZ = Math.max(p0z, p1z, p2z);

      const n0x = normals[i0 * 3] ?? 0;
      const n0y = normals[i0 * 3 + 1] ?? 1;
      const n0z = normals[i0 * 3 + 2] ?? 0;
      const n1x = normals[i1 * 3] ?? 0;
      const n1y = normals[i1 * 3 + 1] ?? 1;
      const n1z = normals[i1 * 3 + 2] ?? 0;
      const n2x = normals[i2 * 3] ?? 0;
      const n2y = normals[i2 * 3 + 1] ?? 1;
      const n2z = normals[i2 * 3 + 2] ?? 0;

      const srcIndex = triVerts.length;
      triVerts.push([p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z]);
      triNormals.push([n0x, n0y, n0z, n1x, n1y, n1z, n2x, n2y, n2z]);
      refs.push({
        bminX,
        bminY,
        bminZ,
        bmaxX,
        bmaxY,
        bmaxZ,
        cx: (bminX + bmaxX) * 0.5,
        cy: (bminY + bmaxY) * 0.5,
        cz: (bminZ + bmaxZ) * 0.5,
        srcIndex,
      });
    }
  }

  if (refs.length === 0) {
    const nodes = new Float32Array(BVH_FLOATS_PER_NODE);
    nodes[0] = 0;
    nodes[1] = 0;
    nodes[2] = 0;
    nodes[3] = u32ToF32(0);
    nodes[4] = 0;
    nodes[5] = 0;
    nodes[6] = 0;
    nodes[7] = u32ToF32(0);
    return {
      nodeCount: 1,
      triCount: 0,
      nodes,
      triangles: new Float32Array(0),
      boundsMin: [0, 0, 0],
      boundsMax: [0, 0, 0],
    };
  }

  const indexArr = new Uint32Array(refs.length);
  for (let i = 0; i < refs.length; i++) indexArr[i] = i;

  const root = buildRecursive(refs, indexArr, 0, refs.length);

  const { nodes, nodeCount } = flatten(root);

  const triangles = new Float32Array(refs.length * TRI_FLOATS_PER_TRI);
  for (let outTri = 0; outTri < refs.length; outTri++) {
    const ref = refs[indexArr[outTri]];
    const v = triVerts[ref.srcIndex];
    const n = triNormals[ref.srcIndex];
    const base = outTri * TRI_FLOATS_PER_TRI;
    triangles[base + 0] = v[0];
    triangles[base + 1] = v[1];
    triangles[base + 2] = v[2];
    triangles[base + 3] = 0;
    triangles[base + 4] = v[3];
    triangles[base + 5] = v[4];
    triangles[base + 6] = v[5];
    triangles[base + 7] = 0;
    triangles[base + 8] = v[6];
    triangles[base + 9] = v[7];
    triangles[base + 10] = v[8];
    triangles[base + 11] = 0;
    triangles[base + 12] = n[0];
    triangles[base + 13] = n[1];
    triangles[base + 14] = n[2];
    triangles[base + 15] = 0;
    triangles[base + 16] = n[3];
    triangles[base + 17] = n[4];
    triangles[base + 18] = n[5];
    triangles[base + 19] = 0;
    triangles[base + 20] = n[6];
    triangles[base + 21] = n[7];
    triangles[base + 22] = n[8];
    triangles[base + 23] = 0;
  }

  return {
    nodeCount,
    triCount: refs.length,
    nodes,
    triangles,
    boundsMin: root.bmin,
    boundsMax: root.bmax,
  };
}

function buildRecursive(
  refs: TriRef[],
  indices: Uint32Array,
  start: number,
  end: number,
): BuildNode {
  const count = end - start;
  const bmin: [number, number, number] = [Infinity, Infinity, Infinity];
  const bmax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const cmin: [number, number, number] = [Infinity, Infinity, Infinity];
  const cmax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = start; i < end; i++) {
    const r = refs[indices[i]];
    if (r.bminX < bmin[0]) bmin[0] = r.bminX;
    if (r.bminY < bmin[1]) bmin[1] = r.bminY;
    if (r.bminZ < bmin[2]) bmin[2] = r.bminZ;
    if (r.bmaxX > bmax[0]) bmax[0] = r.bmaxX;
    if (r.bmaxY > bmax[1]) bmax[1] = r.bmaxY;
    if (r.bmaxZ > bmax[2]) bmax[2] = r.bmaxZ;
    if (r.cx < cmin[0]) cmin[0] = r.cx;
    if (r.cy < cmin[1]) cmin[1] = r.cy;
    if (r.cz < cmin[2]) cmin[2] = r.cz;
    if (r.cx > cmax[0]) cmax[0] = r.cx;
    if (r.cy > cmax[1]) cmax[1] = r.cy;
    if (r.cz > cmax[2]) cmax[2] = r.cz;
  }

  const node: BuildNode = {
    bmin,
    bmax,
    left: null,
    right: null,
    start,
    count,
  };

  if (count <= MAX_TRIS_PER_LEAF) {
    return node;
  }

  const parentArea = surfaceArea(bmin, bmax);
  const leafCost = count * INTERSECT_COST;

  let bestAxis = -1;
  let bestBin = -1;
  let bestCost = Infinity;
  let bestExtent = 0;
  let bestMinC = 0;

  for (let axis = 0; axis < 3; axis++) {
    const minC = cmin[axis];
    const maxC = cmax[axis];
    const extent = maxC - minC;
    if (extent < 1e-12) continue;

    const binCounts = new Int32Array(SAH_BINS);
    const binMins: [number, number, number][] = [];
    const binMaxs: [number, number, number][] = [];
    for (let b = 0; b < SAH_BINS; b++) {
      binMins.push([Infinity, Infinity, Infinity]);
      binMaxs.push([-Infinity, -Infinity, -Infinity]);
    }

    const invExt = SAH_BINS / extent;
    for (let i = start; i < end; i++) {
      const r = refs[indices[i]];
      const c = axis === 0 ? r.cx : axis === 1 ? r.cy : r.cz;
      let b = Math.floor((c - minC) * invExt);
      if (b < 0) b = 0;
      if (b >= SAH_BINS) b = SAH_BINS - 1;
      binCounts[b]++;
      const bmn = binMins[b];
      const bmx = binMaxs[b];
      if (r.bminX < bmn[0]) bmn[0] = r.bminX;
      if (r.bminY < bmn[1]) bmn[1] = r.bminY;
      if (r.bminZ < bmn[2]) bmn[2] = r.bminZ;
      if (r.bmaxX > bmx[0]) bmx[0] = r.bmaxX;
      if (r.bmaxY > bmx[1]) bmx[1] = r.bmaxY;
      if (r.bmaxZ > bmx[2]) bmx[2] = r.bmaxZ;
    }

    const leftCounts = new Int32Array(SAH_BINS - 1);
    const rightCounts = new Int32Array(SAH_BINS - 1);
    const leftAreas = new Float32Array(SAH_BINS - 1);
    const rightAreas = new Float32Array(SAH_BINS - 1);

    const lmin: [number, number, number] = [Infinity, Infinity, Infinity];
    const lmax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let lcount = 0;
    for (let b = 0; b < SAH_BINS - 1; b++) {
      lcount += binCounts[b];
      merge(lmin, lmax, binMins[b], binMaxs[b]);
      leftCounts[b] = lcount;
      leftAreas[b] = surfaceArea(lmin, lmax);
    }

    const rmin: [number, number, number] = [Infinity, Infinity, Infinity];
    const rmax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let rcount = 0;
    for (let b = SAH_BINS - 1; b > 0; b--) {
      rcount += binCounts[b];
      merge(rmin, rmax, binMins[b], binMaxs[b]);
      rightCounts[b - 1] = rcount;
      rightAreas[b - 1] = surfaceArea(rmin, rmax);
    }

    for (let b = 0; b < SAH_BINS - 1; b++) {
      if (leftCounts[b] === 0 || rightCounts[b] === 0) continue;
      const cost =
        TRAVERSE_COST +
        ((leftAreas[b] * leftCounts[b] + rightAreas[b] * rightCounts[b]) * INTERSECT_COST) /
          Math.max(parentArea, 1e-12);
      if (cost < bestCost) {
        bestCost = cost;
        bestAxis = axis;
        bestBin = b;
        bestExtent = extent;
        bestMinC = minC;
      }
    }
  }

  if (bestAxis === -1 || bestCost >= leafCost) {
    return node;
  }

  const invExt = SAH_BINS / bestExtent;
  const splitVal = bestMinC + (bestBin + 1) / invExt;

  let mid = start;
  for (let i = start; i < end; i++) {
    const r = refs[indices[i]];
    const c = bestAxis === 0 ? r.cx : bestAxis === 1 ? r.cy : r.cz;
    if (c < splitVal) {
      const tmp = indices[i];
      indices[i] = indices[mid];
      indices[mid] = tmp;
      mid++;
    }
  }
  if (mid === start || mid === end) {
    mid = start + (count >> 1);
  }

  node.left = buildRecursive(refs, indices, start, mid);
  node.right = buildRecursive(refs, indices, mid, end);
  return node;
}

function merge(
  dstMin: [number, number, number],
  dstMax: [number, number, number],
  srcMin: [number, number, number],
  srcMax: [number, number, number],
): void {
  if (srcMin[0] < dstMin[0]) dstMin[0] = srcMin[0];
  if (srcMin[1] < dstMin[1]) dstMin[1] = srcMin[1];
  if (srcMin[2] < dstMin[2]) dstMin[2] = srcMin[2];
  if (srcMax[0] > dstMax[0]) dstMax[0] = srcMax[0];
  if (srcMax[1] > dstMax[1]) dstMax[1] = srcMax[1];
  if (srcMax[2] > dstMax[2]) dstMax[2] = srcMax[2];
}

function surfaceArea(bmin: [number, number, number], bmax: [number, number, number]): number {
  const dx = Math.max(0, bmax[0] - bmin[0]);
  const dy = Math.max(0, bmax[1] - bmin[1]);
  const dz = Math.max(0, bmax[2] - bmin[2]);
  return 2 * (dx * dy + dy * dz + dz * dx);
}

function flatten(root: BuildNode): { nodes: Float32Array; nodeCount: number } {
  const totalNodes = countNodes(root);
  const nodes = new Float32Array(totalNodes * BVH_FLOATS_PER_NODE);

  function write(
    index: number,
    bmin: [number, number, number],
    bmax: [number, number, number],
    leftOrFirst: number,
    primCount: number,
  ): void {
    const base = index * BVH_FLOATS_PER_NODE;
    nodes[base + 0] = bmin[0];
    nodes[base + 1] = bmin[1];
    nodes[base + 2] = bmin[2];
    nodes[base + 3] = u32ToF32(leftOrFirst);
    nodes[base + 4] = bmax[0];
    nodes[base + 5] = bmax[1];
    nodes[base + 6] = bmax[2];
    nodes[base + 7] = u32ToF32(primCount);
  }

  let cursor = 0;
  function visit(node: BuildNode, at: number): void {
    if (!node.left || !node.right) {
      write(at, node.bmin, node.bmax, node.start, node.count);
      return;
    }
    const leftIdx = cursor;
    cursor += 2;
    write(at, node.bmin, node.bmax, leftIdx, 0);
    visit(node.left, leftIdx);
    visit(node.right, leftIdx + 1);
  }

  cursor = 1;
  visit(root, 0);
  return { nodes, nodeCount: totalNodes };
}

function countNodes(node: BuildNode): number {
  if (!node.left || !node.right) return 1;
  return 1 + countNodes(node.left) + countNodes(node.right);
}
