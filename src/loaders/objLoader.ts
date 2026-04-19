export interface ParsedObjGroup {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface ParsedObj {
  groups: ParsedObjGroup[];
}

interface GroupBuilder {
  name: string;
  keyToIndex: Map<string, number>;
  positions: number[];
  normals: number[];
  indices: number[];
  rawNormalsPresent: boolean;
}

function makeGroup(name: string): GroupBuilder {
  return {
    name,
    keyToIndex: new Map(),
    positions: [],
    normals: [],
    indices: [],
    rawNormalsPresent: false,
  };
}

export function parseObj(text: string, defaultName = 'mesh'): ParsedObj {
  const positions: number[] = [];
  const normals: number[] = [];

  let currentGroup: GroupBuilder | null = null;
  const groups: GroupBuilder[] = [];

  const ensureGroup = (name: string): GroupBuilder => {
    if (currentGroup && currentGroup.name === name) return currentGroup;
    currentGroup = makeGroup(name);
    groups.push(currentGroup);
    return currentGroup;
  };

  ensureGroup(defaultName);

  const len = text.length;
  let i = 0;
  while (i < len) {
    const lineEnd = findLineEnd(text, i);
    const line = text.slice(i, lineEnd);
    i = lineEnd < len ? lineEnd + 1 : lineEnd;
    parseLine(line, positions, normals, groups, ensureGroup);
  }

  const finalGroups: ParsedObjGroup[] = [];
  for (const g of groups) {
    if (g.indices.length === 0) continue;
    finalGroups.push({
      name: g.name,
      positions: new Float32Array(g.positions),
      normals: g.rawNormalsPresent
        ? new Float32Array(g.normals)
        : computeSmoothNormals(g.positions, g.indices),
      indices: new Uint32Array(g.indices),
    });
  }

  if (finalGroups.length === 0) {
    finalGroups.push({
      name: defaultName,
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint32Array(0),
    });
  }

  return { groups: finalGroups };
}

function findLineEnd(text: string, start: number): number {
  const nl = text.indexOf('\n', start);
  return nl === -1 ? text.length : nl;
}

function parseLine(
  rawLine: string,
  positions: number[],
  normals: number[],
  groups: GroupBuilder[],
  ensureGroup: (name: string) => GroupBuilder,
): void {
  let line = rawLine;
  if (line.length > 0 && line.charCodeAt(line.length - 1) === 13) {
    line = line.slice(0, -1);
  }
  if (line.length === 0) return;
  let c = 0;
  while (c < line.length && (line[c] === ' ' || line[c] === '\t')) c++;
  if (c >= line.length) return;
  if (line[c] === '#') return;

  const tokens = line.slice(c).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return;
  const head = tokens[0];

  if (head === 'v') {
    positions.push(parseFloat(tokens[1]), parseFloat(tokens[2]), parseFloat(tokens[3]));
  } else if (head === 'vn') {
    normals.push(parseFloat(tokens[1]), parseFloat(tokens[2]), parseFloat(tokens[3]));
  } else if (head === 'f') {
    const group = groups[groups.length - 1];
    const faceIdx: number[] = [];
    for (let k = 1; k < tokens.length; k++) {
      const idx = addFaceVertex(tokens[k], positions, normals, group);
      faceIdx.push(idx);
    }
    for (let k = 1; k + 1 < faceIdx.length; k++) {
      group.indices.push(faceIdx[0], faceIdx[k], faceIdx[k + 1]);
    }
  } else if (head === 'o' || head === 'g') {
    const name = tokens.slice(1).join(' ') || `group_${groups.length}`;
    ensureGroup(name);
  }
}

function addFaceVertex(
  token: string,
  positions: number[],
  normals: number[],
  group: GroupBuilder,
): number {
  const parts = token.split('/');
  const vRaw = parseInt(parts[0], 10);
  const vnRaw = parts.length > 2 ? parseInt(parts[2], 10) : NaN;

  const vCount = positions.length / 3;
  const vIdx = vRaw > 0 ? vRaw - 1 : vCount + vRaw;

  let vnIdx = -1;
  if (!Number.isNaN(vnRaw)) {
    const vnCount = normals.length / 3;
    vnIdx = vnRaw > 0 ? vnRaw - 1 : vnCount + vnRaw;
  }

  const key = vnIdx >= 0 ? `${vIdx}|${vnIdx}` : `${vIdx}`;
  const existing = group.keyToIndex.get(key);
  if (existing !== undefined) return existing;

  const newIndex = group.positions.length / 3;
  group.positions.push(
    positions[vIdx * 3] ?? 0,
    positions[vIdx * 3 + 1] ?? 0,
    positions[vIdx * 3 + 2] ?? 0,
  );
  if (vnIdx >= 0 && vnIdx * 3 + 2 < normals.length) {
    group.normals.push(normals[vnIdx * 3], normals[vnIdx * 3 + 1], normals[vnIdx * 3 + 2]);
    group.rawNormalsPresent = true;
  } else {
    group.normals.push(0, 0, 0);
  }
  group.keyToIndex.set(key, newIndex);
  return newIndex;
}

export function computeSmoothNormals(positions: number[], indices: number[]): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];
    const ax = positions[ia * 3];
    const ay = positions[ia * 3 + 1];
    const az = positions[ia * 3 + 2];
    const bx = positions[ib * 3];
    const by = positions[ib * 3 + 1];
    const bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3];
    const cy = positions[ic * 3 + 1];
    const cz = positions[ic * 3 + 2];
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    out[ia * 3] += nx;
    out[ia * 3 + 1] += ny;
    out[ia * 3 + 2] += nz;
    out[ib * 3] += nx;
    out[ib * 3 + 1] += ny;
    out[ib * 3 + 2] += nz;
    out[ic * 3] += nx;
    out[ic * 3 + 1] += ny;
    out[ic * 3 + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const nx = out[i];
    const ny = out[i + 1];
    const nz = out[i + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      out[i] = nx / len;
      out[i + 1] = ny / len;
      out[i + 2] = nz / len;
    } else {
      out[i] = 0;
      out[i + 1] = 1;
      out[i + 2] = 0;
    }
  }
  return out;
}
