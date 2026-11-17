/**
 * Glyfene i en innebygd font, som baner.
 *
 * Leser de to formatene Illustrator bygger inn i en PDF: CFF (FontFile3,
 * Type1C og CIDFontType0C, ogsaa CFF pakket i OpenType) og TrueType
 * (FontFile2). Ingen fontbibliotek: opentype.js krever tabellene name,
 * hhea og hmtx, som delmengdene i en PDF ofte mangler, og ville lagt rundt
 * 170 kB til bundlen. Her trengs bare omrisset av hver glyf.
 *
 * Alt som ikke lar seg lese, kaster en Feil med en norsk tekst. Kallstedet
 * fanger den og lar teksten staa som levende tekst, saa den meldes.
 */
import { CFF_STD, STANDARD_ENC } from "./fontdata.ts";

export type P = [number, number];
export type GSeg = { t: "m"; p: P } | { t: "l"; p: P } | { t: "c"; a: P; b: P; c: P } | { t: "h" };

export interface GlyfFont {
  /** glyfrom til tekstrom: [a b c d e f], vanligvis 1/1000 eller 1/unitsPerEm */
  matrise: [number, number, number, number, number, number];
  antall: number;
  omriss(gid: number): GSeg[];
  /** CFF: glyfnavn til gid (charset). TrueType: fra post-tabellen hvis den finnes */
  navnTilGid(navn: string): number | undefined;
  /** CFF: fontens egen koding, kode til gid. TrueType: tom */
  egenKoding(kode: number): number | undefined;
  /** TrueType: unicode/kode til gid via cmap. platform 3 enc 1, 3 enc 0 og 1 enc 0 */
  cmap?: { p: number; e: number; slaa(c: number): number }[];
  /** CID-keyed CFF: cid til gid */
  cidTilGid?(cid: number): number | undefined;
  /** fontens egen fremdrift for gid, i glyfrom (TrueType hmtx) */
  fremdrift?(gid: number): number | undefined;
}

const feil = (t: string) => new Error(t);

/* ---------- CFF ---------- */

interface Index { antall: number; hent(i: number): Uint8Array; slutt: number }

function lesIndex(d: Uint8Array, pos: number): Index {
  const antall = (d[pos] << 8) | d[pos + 1];
  if (antall === 0) return { antall: 0, hent: () => new Uint8Array(0), slutt: pos + 2 };
  const os = d[pos + 2];
  if (os < 1 || os > 4) throw feil("CFF: ugyldig INDEX");
  const off = (i: number) => {
    let v = 0; const s = pos + 3 + i * os;
    for (let k = 0; k < os; k++) v = v * 256 + d[s + k];
    return v;
  };
  const data = pos + 3 + (antall + 1) * os - 1;
  const slutt = data + off(antall);
  if (slutt > d.length) throw feil("CFF: INDEX gaar forbi slutten av fila");
  return { antall, slutt, hent: (i) => d.subarray(data + off(i), data + off(i + 1)) };
}

/** DICT: operator (12 x blir 1200 + x) til operander */
function lesDict(d: Uint8Array): Map<number, number[]> {
  const m = new Map<number, number[]>();
  let ops: number[] = [];
  let i = 0;
  while (i < d.length) {
    const b = d[i];
    if (b <= 21) {
      let op = b; i++;
      if (b === 12) { op = 1200 + d[i]; i++; }
      m.set(op, ops); ops = [];
    } else if (b === 28) { ops.push(((d[i + 1] << 24) | (d[i + 2] << 16)) >> 16); i += 3; }
    else if (b === 29) { ops.push((d[i + 1] << 24) | (d[i + 2] << 16) | (d[i + 3] << 8) | d[i + 4]); i += 5; }
    else if (b === 30) {
      let s = ""; i++;
      const tegn = "0123456789.EE?-";
      ute: while (i < d.length) {
        const v = d[i++];
        for (const n of [v >> 4, v & 15]) {
          if (n === 15) break ute;
          s += n === 12 ? "E-" : tegn[n];
        }
      }
      ops.push(Number(s));
    }
    else if (b >= 32 && b <= 246) { ops.push(b - 139); i++; }
    else if (b >= 247 && b <= 250) { ops.push((b - 247) * 256 + d[i + 1] + 108); i += 2; }
    else if (b >= 251 && b <= 254) { ops.push(-(b - 251) * 256 - d[i + 1] - 108); i += 2; }
    else i++;
  }
  return m;
}

const bias = (n: number) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

function lesCff(d: Uint8Array): GlyfFont {
  if (d.length < 4 || d[0] !== 1) throw feil("CFF: ukjent versjon");
  const navnIdx = lesIndex(d, d[2]);
  const topIdx = lesIndex(d, navnIdx.slutt);
  const strIdx = lesIndex(d, topIdx.slutt);
  const gsubIdx = lesIndex(d, strIdx.slutt);
  if (!topIdx.antall) throw feil("CFF: mangler Top DICT");
  const top = lesDict(topIdx.hent(0));
  const csOff = top.get(17)?.[0];
  if (!csOff) throw feil("CFF: mangler CharStrings");
  const cs = lesIndex(d, csOff);
  const n = cs.antall;
  const strenger: string[] = [];
  for (let i = 0; i < strIdx.antall; i++) strenger.push(new TextDecoder("latin1").decode(strIdx.hent(i)));
  const sidNavn = (sid: number) => (sid < CFF_STD.length ? CFF_STD[sid] : strenger[sid - CFF_STD.length] ?? "");
  const gsubs: Uint8Array[] = [];
  for (let i = 0; i < gsubIdx.antall; i++) gsubs.push(gsubIdx.hent(i));

  const lokale = (priv: number[] | undefined): Uint8Array[] => {
    if (!priv || priv.length < 2) return [];
    const [str, off] = priv;
    const pd = lesDict(d.subarray(off, off + str));
    const s = pd.get(19)?.[0];
    if (!s) return [];
    const idx = lesIndex(d, off + s);
    const ut: Uint8Array[] = [];
    for (let i = 0; i < idx.antall; i++) ut.push(idx.hent(i));
    return ut;
  };

  const cid = top.has(1230);
  // charset: gid til SID (navn) eller, i en CID-font, gid til CID
  const sids = new Array<number>(n).fill(0);
  const csetOff = top.get(15)?.[0] ?? 0;
  if (csetOff > 2) {
    const f = d[csetOff];
    let p = csetOff + 1, g = 1;
    if (f === 0) { for (; g < n; g++, p += 2) sids[g] = (d[p] << 8) | d[p + 1]; }
    else if (f === 1 || f === 2) {
      while (g < n) {
        const first = (d[p] << 8) | d[p + 1];
        const left = f === 1 ? d[p + 2] : (d[p + 2] << 8) | d[p + 3];
        p += f === 1 ? 3 : 4;
        for (let k = 0; k <= left && g < n; k++) sids[g++] = first + k;
      }
    } else throw feil("CFF: ukjent charset-format");
  } else for (let g = 0; g < n; g++) sids[g] = g; // ISOAdobe
  const navnGid = new Map<string, number>();
  const cidGid = new Map<number, number>();
  for (let g = 0; g < n; g++) {
    if (cid) cidGid.set(sids[g], g);
    else { const nm = sidNavn(sids[g]); if (!navnGid.has(nm)) navnGid.set(nm, g); }
  }

  // lokale subrutiner: én Private, eller per FD i en CID-font
  let fdAv: (g: number) => number = () => 0;
  const subrsPerFd: Uint8Array[][] = [];
  if (cid && top.has(1236)) {
    const fda = lesIndex(d, top.get(1236)![0]);
    for (let i = 0; i < fda.antall; i++) subrsPerFd.push(lokale(lesDict(fda.hent(i)).get(18)));
    const fs = top.get(1237)?.[0];
    if (fs) {
      const f = d[fs];
      if (f === 0) fdAv = (g) => d[fs + 1 + g];
      else if (f === 3) {
        const nr = (d[fs + 1] << 8) | d[fs + 2];
        const r: [number, number][] = [];
        for (let i = 0; i < nr; i++) { const p = fs + 3 + i * 3; r.push([(d[p] << 8) | d[p + 1], d[p + 2]]); }
        fdAv = (g) => { let fd = 0; for (const [first, v] of r) { if (first > g) break; fd = v; } return fd; };
      } else throw feil("CFF: ukjent FDSelect-format");
    }
  } else subrsPerFd.push(lokale(top.get(18)));

  // fontens egen koding (bare navnebaserte fonter)
  const koding = new Map<number, number>();
  if (!cid) {
    const encOff = top.get(16)?.[0] ?? 0;
    if (encOff > 1) {
      const f = d[encOff];
      let p = encOff + 1;
      if ((f & 0x7f) === 0) { const nc = d[p++]; for (let i = 0; i < nc; i++) koding.set(d[p++], i + 1); }
      else if ((f & 0x7f) === 1) {
        const nr = d[p++]; let g = 1;
        for (let i = 0; i < nr; i++) { const first = d[p++], left = d[p++]; for (let k = 0; k <= left; k++) koding.set(first + k, g++); }
      }
      if (f & 0x80) {
        const ns = d[p++];
        for (let i = 0; i < ns; i++) { const c = d[p++]; const sid = (d[p] << 8) | d[p + 1]; p += 2;
          const g = navnGid.get(sidNavn(sid)); if (g !== undefined) koding.set(c, g); }
      }
    } else if (encOff === 0) {
      for (let c = 0; c < 256; c++) { const g = navnGid.get(STANDARD_ENC[c]); if (STANDARD_ENC[c] && g !== undefined) koding.set(c, g); }
    }
  }

  const fm = top.get(1207);
  const matrise = (fm && fm.length === 6 ? fm : [0.001, 0, 0, 0.001, 0, 0]) as GlyfFont["matrise"];
  const cache = new Map<number, GSeg[]>();
  const font: GlyfFont = {
    matrise, antall: n,
    navnTilGid: (nm) => navnGid.get(nm),
    egenKoding: (c) => koding.get(c),
    cidTilGid: cid ? (c) => cidGid.get(c) : undefined,
    omriss(gid) {
      if (gid < 0 || gid >= n) return [];
      const c = cache.get(gid);
      if (c) return c;
      const ut = tegnType2(cs.hent(gid), gsubs, subrsPerFd[fdAv(gid)] ?? [], (code) => {
        const g = navnGid.get(STANDARD_ENC[code] ?? "");
        return g === undefined ? [] : font.omriss(g);
      });
      cache.set(gid, ut);
      return ut;
    },
  };
  return font;
}

/** Type 2-charstring til baner. Hint ignoreres, bortsett fra antall stammer (hintmask). */
function tegnType2(prog: Uint8Array, gsubs: Uint8Array[], lsubs: Uint8Array[], seac: (code: number) => GSeg[]): GSeg[] {
  const ut: GSeg[] = [];
  let x = 0, y = 0, stammer = 0, bredde = false, aapen = false, dybde = 0;
  let st: number[] = [];
  const lukk = () => { if (aapen) { ut.push({ t: "h" }); aapen = false; } };
  const flytt = (dx: number, dy: number) => { lukk(); x += dx; y += dy; ut.push({ t: "m", p: [x, y] }); aapen = true; };
  const linje = (dx: number, dy: number) => { x += dx; y += dy; ut.push({ t: "l", p: [x, y] }); };
  const kurve = (a: number, b: number, c: number, dd: number, e: number, f: number) => {
    const p1: P = [x + a, y + b], p2: P = [p1[0] + c, p1[1] + dd];
    x = p2[0] + e; y = p2[1] + f;
    ut.push({ t: "c", a: p1, b: p2, c: [x, y] });
  };
  const fjernBredde = (forventet: (n: number) => boolean) => {
    if (!bredde) { bredde = true; if (forventet(st.length)) st.shift(); }
  };
  let ferdig = false;
  const kjor = (p: Uint8Array) => {
    if (++dybde > 12) throw feil("CFF: for dype subrutiner");
    let i = 0;
    while (i < p.length && !ferdig) {
      const b = p[i];
      if (b >= 32) {
        if (b <= 246) { st.push(b - 139); i++; }
        else if (b <= 250) { st.push((b - 247) * 256 + p[i + 1] + 108); i += 2; }
        else if (b <= 254) { st.push(-(b - 251) * 256 - p[i + 1] - 108); i += 2; }
        else { st.push(((p[i + 1] << 24) | (p[i + 2] << 16) | (p[i + 3] << 8) | p[i + 4]) / 65536); i += 5; }
        continue;
      }
      if (b === 28) { st.push(((p[i + 1] << 24) | (p[i + 2] << 16)) >> 16); i += 3; continue; }
      i++;
      switch (b) {
        case 1: case 3: case 18: case 23:
          fjernBredde((n) => n % 2 === 1); stammer += st.length >> 1; st = []; break;
        case 19: case 20:
          fjernBredde((n) => n % 2 === 1); stammer += st.length >> 1; st = [];
          i += (stammer + 7) >> 3; break;
        case 21: fjernBredde((n) => n > 2); flytt(st[0], st[1]); st = []; break;
        case 22: fjernBredde((n) => n > 1); flytt(st[0], 0); st = []; break;
        case 4: fjernBredde((n) => n > 1); flytt(0, st[0]); st = []; break;
        case 5: for (let k = 0; k + 1 < st.length; k += 2) linje(st[k], st[k + 1]); st = []; break;
        case 6: case 7: {
          let h = b === 6;
          for (let k = 0; k < st.length; k++) { h ? linje(st[k], 0) : linje(0, st[k]); h = !h; }
          st = []; break;
        }
        case 8: for (let k = 0; k + 5 < st.length; k += 6) kurve(st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]); st = []; break;
        case 24: {
          let k = 0;
          for (; k + 7 < st.length; k += 6) kurve(st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]);
          if (k + 1 < st.length) linje(st[k], st[k + 1]);
          st = []; break;
        }
        case 25: {
          let k = 0;
          for (; k + 7 < st.length; k += 2) linje(st[k], st[k + 1]);
          if (k + 5 < st.length) kurve(st[k], st[k + 1], st[k + 2], st[k + 3], st[k + 4], st[k + 5]);
          st = []; break;
        }
        case 26: {
          let k = 0, dx1 = 0;
          if (st.length % 2) { dx1 = st[0]; k = 1; }
          for (; k + 3 < st.length; k += 4) { kurve(dx1, st[k], st[k + 1], st[k + 2], 0, st[k + 3]); dx1 = 0; }
          st = []; break;
        }
        case 27: {
          let k = 0, dy1 = 0;
          if (st.length % 2) { dy1 = st[0]; k = 1; }
          for (; k + 3 < st.length; k += 4) { kurve(st[k], dy1, st[k + 1], st[k + 2], st[k + 3], 0); dy1 = 0; }
          st = []; break;
        }
        case 30: case 31: {
          let v = b === 30;
          for (let k = 0; k + 3 < st.length; k += 4) {
            const siste = k + 5 === st.length ? st[k + 4] : 0;
            if (v) kurve(0, st[k], st[k + 1], st[k + 2], st[k + 3], siste);
            else kurve(st[k], 0, st[k + 1], st[k + 2], siste, st[k + 3]);
            v = !v;
          }
          st = []; break;
        }
        case 10: case 29: {
          const subs = b === 10 ? lsubs : gsubs;
          const nr = (st.pop() ?? 0) + bias(subs.length);
          const s = subs[nr];
          if (!s) throw feil("CFF: mangler subrutine");
          kjor(s);
          break;
        }
        case 11: dybde--; return;
        case 14: {
          fjernBredde((n) => n === 1 || n === 5);
          if (st.length >= 4) {
            // seac: aksent oppaa grunnbokstav (aa, oe i eldre fonter)
            const [adx, ady, bc, ac] = st.slice(-4);
            lukk();
            for (const s of seac(bc)) ut.push(s);
            for (const s of seac(ac)) ut.push(flyttSeg(s, adx, ady));
          }
          lukk(); st = []; ferdig = true; break;
        }
        case 12: {
          const e = p[i++];
          if (e === 35) { kurve(st[0], st[1], st[2], st[3], st[4], st[5]); kurve(st[6], st[7], st[8], st[9], st[10], st[11]); }
          else if (e === 34) { const y0 = y; kurve(st[0], 0, st[1], st[2], st[3], 0); kurve(st[4], 0, st[5], y0 - y, st[6], 0); }
          else if (e === 36) { const y0 = y; kurve(st[0], st[1], st[2], st[3], st[4], 0); kurve(st[5], 0, st[6], st[7], st[8], y0 - y); }
          else if (e === 37) {
            const x0 = x, y0 = y;
            let dx = 0, dy = 0;
            for (let k = 0; k < 10; k += 2) { dx += st[k]; dy += st[k + 1]; }
            kurve(st[0], st[1], st[2], st[3], st[4], st[5]);
            if (Math.abs(dx) > Math.abs(dy)) kurve(st[6], st[7], st[8], st[9], st[10], y0 - y);
            else kurve(st[6], st[7], st[8], st[9], x0 - x, st[10]);
            void x0;
          }
          else if (e === 9) { st.push(Math.abs(st.pop() ?? 0)); break; }
          else if (e === 10) { const b2 = st.pop() ?? 0, a2 = st.pop() ?? 0; st.push(a2 + b2); break; }
          else if (e === 11) { const b2 = st.pop() ?? 0, a2 = st.pop() ?? 0; st.push(a2 - b2); break; }
          else if (e === 12) { const b2 = st.pop() ?? 1, a2 = st.pop() ?? 0; st.push(b2 ? a2 / b2 : 0); break; }
          else if (e === 14) { st.push(-(st.pop() ?? 0)); break; }
          else if (e === 18) { st.pop(); break; }
          else if (e === 24) { const b2 = st.pop() ?? 0, a2 = st.pop() ?? 0; st.push(a2 * b2); break; }
          else if (e === 27) { const a2 = st[st.length - 1] ?? 0; st.push(a2); break; }
          else if (e === 28) { const b2 = st.pop() ?? 0, a2 = st.pop() ?? 0; st.push(b2, a2); break; }
          st = []; break;
        }
        default: st = [];
      }
    }
    dybde--;
  };
  kjor(prog);
  lukk();
  return ut;
}

function flyttSeg(s: GSeg, dx: number, dy: number): GSeg {
  const f = (p: P): P => [p[0] + dx, p[1] + dy];
  if (s.t === "h") return s;
  if (s.t === "c") return { t: "c", a: f(s.a), b: f(s.b), c: f(s.c) };
  return { t: s.t, p: f(s.p) };
}

/* ---------- sfnt (TrueType og OpenType) ---------- */

function tabeller(d: Uint8Array): Map<string, [number, number]> {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const n = dv.getUint16(4);
  const m = new Map<string, [number, number]>();
  for (let i = 0; i < n; i++) {
    const p = 12 + i * 16;
    if (p + 16 > d.length) break;
    const tag = String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]);
    m.set(tag, [dv.getUint32(p + 8), dv.getUint32(p + 12)]);
  }
  return m;
}

/** cmap-tabellen: format 0, 4, 6 og 12 */
function lesCmap(d: Uint8Array, t: Map<string, [number, number]>): NonNullable<GlyfFont["cmap"]> {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const cmap: NonNullable<GlyfFont["cmap"]> = [];
  const cm = t.get("cmap");
  if (cm) {
    const nt = dv.getUint16(cm[0] + 2);
    for (let i = 0; i < nt; i++) {
      const p = cm[0] + 4 + i * 8;
      const pl = dv.getUint16(p), en = dv.getUint16(p + 2), so = cm[0] + dv.getUint32(p + 4);
      const f = dv.getUint16(so);
      let slaa: ((c: number) => number) | null = null;
      if (f === 0) slaa = (c) => (c < 256 ? d[so + 6 + c] : 0);
      else if (f === 4) {
        const segX2 = dv.getUint16(so + 6);
        const ends = so + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
        slaa = (c) => {
          for (let s = 0; s < segX2; s += 2) {
            const e = dv.getUint16(ends + s);
            if (c > e) continue;
            const st = dv.getUint16(starts + s);
            if (c < st) return 0;
            const delta = dv.getInt16(deltas + s), ro = dv.getUint16(ranges + s);
            if (!ro) return (c + delta) & 0xffff;
            const gp = ranges + s + ro + (c - st) * 2;
            const g = gp + 1 < d.length ? dv.getUint16(gp) : 0;
            return g ? (g + delta) & 0xffff : 0;
          }
          return 0;
        };
      } else if (f === 6) {
        const first = dv.getUint16(so + 6), cnt = dv.getUint16(so + 8);
        slaa = (c) => (c >= first && c < first + cnt ? dv.getUint16(so + 10 + (c - first) * 2) : 0);
      } else if (f === 12) {
        const ng = dv.getUint32(so + 12);
        slaa = (c) => {
          for (let k = 0; k < ng; k++) {
            const p2 = so + 16 + k * 12;
            const s0 = dv.getUint32(p2), s1 = dv.getUint32(p2 + 4);
            if (c >= s0 && c <= s1) return dv.getUint32(p2 + 8) + (c - s0);
          }
          return 0;
        };
      }
      if (slaa) cmap.push({ p: pl, e: en, slaa });
    }
  }

  return cmap;
}

function lesTrueType(d: Uint8Array): GlyfFont {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const t = tabeller(d);
  const head = t.get("head"), loca = t.get("loca"), glyf = t.get("glyf"), maxp = t.get("maxp");
  if (!head || !loca || !glyf) throw feil("TrueType: mangler head, loca eller glyf");
  const upem = dv.getUint16(head[0] + 18) || 1000;
  const lang = dv.getInt16(head[0] + 50) === 1;
  const antall = maxp ? dv.getUint16(maxp[0] + 4) : Math.floor(loca[1] / (lang ? 4 : 2)) - 1;
  const off = (g: number) => (lang ? dv.getUint32(loca[0] + g * 4) : dv.getUint16(loca[0] + g * 2) * 2);

  const cmap = lesCmap(d, t);

  // hmtx for fremdrift naar PDF-en ikke har bredder
  const hhea = t.get("hhea"), hmtx = t.get("hmtx");
  const nh = hhea ? dv.getUint16(hhea[0] + 34) : 0;
  const fremdrift = (g: number) => {
    if (!hmtx || !nh) return undefined;
    const k = Math.min(g, nh - 1);
    return dv.getUint16(hmtx[0] + k * 4);
  };

  const cache = new Map<number, GSeg[]>();
  const omriss = (g: number, dybde = 0): GSeg[] => {
    if (g < 0 || g >= antall || dybde > 8) return [];
    const c = cache.get(g);
    if (c) return c;
    const o0 = off(g), o1 = off(g + 1);
    if (o1 <= o0) { cache.set(g, []); return []; }
    const p0 = glyf[0] + o0;
    const nk = dv.getInt16(p0);
    const ut: GSeg[] = [];
    if (nk >= 0) {
      const ender: number[] = [];
      for (let i = 0; i < nk; i++) ender.push(dv.getUint16(p0 + 10 + i * 2));
      const np = nk ? ender[nk - 1] + 1 : 0;
      let p = p0 + 10 + nk * 2;
      p += 2 + dv.getUint16(p);
      const flagg: number[] = [];
      while (flagg.length < np) {
        const f = d[p++]; flagg.push(f);
        if (f & 8) { const r = d[p++]; for (let k = 0; k < r; k++) flagg.push(f); }
      }
      const xs: number[] = [], ys: number[] = [];
      let v = 0;
      for (const f of flagg) {
        if (f & 2) { const dx = d[p++]; v += f & 16 ? dx : -dx; }
        else if (!(f & 16)) { v += dv.getInt16(p); p += 2; }
        xs.push(v);
      }
      v = 0;
      for (const f of flagg) {
        if (f & 4) { const dy = d[p++]; v += f & 32 ? dy : -dy; }
        else if (!(f & 32)) { v += dv.getInt16(p); p += 2; }
        ys.push(v);
      }
      let s = 0;
      for (const e of ender) {
        kontur(xs.slice(s, e + 1), ys.slice(s, e + 1), flagg.slice(s, e + 1).map((f) => (f & 1) === 1), ut);
        s = e + 1;
      }
    } else {
      // sammensatt glyf
      let p = p0 + 10, mer = true;
      while (mer) {
        const fl = dv.getUint16(p), kg = dv.getUint16(p + 2); p += 4;
        let a1: number, a2: number;
        if (fl & 1) { a1 = dv.getInt16(p); a2 = dv.getInt16(p + 2); p += 4; }
        else { a1 = dv.getInt8(p); a2 = dv.getInt8(p + 1); p += 2; }
        let a = 1, b = 0, c2 = 0, dd = 1;
        const f2 = (q: number) => dv.getInt16(q) / 16384;
        if (fl & 8) { a = dd = f2(p); p += 2; }
        else if (fl & 0x40) { a = f2(p); dd = f2(p + 2); p += 4; }
        else if (fl & 0x80) { a = f2(p); b = f2(p + 2); c2 = f2(p + 4); dd = f2(p + 6); p += 8; }
        if (!(fl & 2)) throw feil("TrueType: sammensatt glyf med punktmatching stoettes ikke");
        const tr = (q: P): P => [a * q[0] + c2 * q[1] + a1, b * q[0] + dd * q[1] + a2];
        for (const s of omriss(kg, dybde + 1)) {
          if (s.t === "h") ut.push(s);
          else if (s.t === "c") ut.push({ t: "c", a: tr(s.a), b: tr(s.b), c: tr(s.c) });
          else ut.push({ t: s.t, p: tr(s.p) });
        }
        mer = (fl & 0x20) !== 0;
      }
    }
    cache.set(g, ut);
    return ut;
  };

  // post-tabellen kan gi glyfnavn (format 2)
  const navnGid = new Map<string, number>();
  const post = t.get("post");
  if (post && dv.getUint32(post[0]) === 0x20000) {
    try {
      const ng = dv.getUint16(post[0] + 32);
      const idx: number[] = [];
      for (let i = 0; i < ng; i++) idx.push(dv.getUint16(post[0] + 34 + i * 2));
      let p = post[0] + 34 + ng * 2;
      const egne: string[] = [];
      while (p < post[0] + post[1]) { const l = d[p++]; egne.push(new TextDecoder("latin1").decode(d.subarray(p, p + l))); p += l; }
      idx.forEach((k, g) => {
        const nm = k < 258 ? MAC_NAVN(k) : egne[k - 258];
        if (nm && !navnGid.has(nm)) navnGid.set(nm, g);
      });
    } catch { /* uten navn */ }
  }

  return {
    matrise: [1 / upem, 0, 0, 1 / upem, 0, 0], antall,
    omriss: (g) => omriss(g), navnTilGid: (nm) => navnGid.get(nm), egenKoding: () => undefined,
    cmap, fremdrift,
  };
}

/** TrueType-kontur: kvadratiske kurver gjoeres om til kubiske */
function kontur(xs: number[], ys: number[], paa: boolean[], ut: GSeg[]) {
  const n = xs.length;
  if (!n) return;
  const pt = (i: number): P => [xs[i % n], ys[i % n]];
  const midt = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const s = paa.indexOf(true);
  // startpunkt: et punkt paa kurven, eller midt mellom de to foerste kontrollpunktene
  const start: P = s >= 0 ? pt(s) : midt(pt(0), pt(1));
  const rekke: number[] = [];
  if (s >= 0) for (let k = 1; k < n; k++) rekke.push((s + k) % n);
  else { for (let k = 1; k < n; k++) rekke.push(k); rekke.push(0); }
  ut.push({ t: "m", p: start });
  let cur = start;
  let kontroll: P | null = null;
  const q2c = (q: P, e: P) => {
    ut.push({ t: "c", a: [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])],
      b: [e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1])], c: e });
    cur = e;
  };
  for (const i of rekke) {
    const p = pt(i);
    if (paa[i]) {
      if (kontroll) { q2c(kontroll, p); kontroll = null; }
      else { ut.push({ t: "l", p }); cur = p; }
    } else {
      if (kontroll) q2c(kontroll, midt(kontroll, p));
      kontroll = p;
    }
  }
  if (kontroll) q2c(kontroll, start);
  ut.push({ t: "h" });
}

/** De 258 standardnavnene i post-tabellen (Macintosh-rekkefoelgen). Bare de vanlige trengs. */
function MAC_NAVN(k: number): string | undefined {
  const tab = ".notdef .null nonmarkingreturn space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute agrave acircumflex adieresis atilde aring ccedilla eacute egrave ecircumflex edieresis iacute igrave icircumflex idieresis ntilde oacute ograve ocircumflex odieresis otilde uacute ugrave ucircumflex udieresis dagger degree cent sterling section bullet paragraph germandbls registered copyright trademark acute dieresis notequal AE Oslash infinity plusminus lessequal greaterequal yen mu partialdiff summation product pi integral ordfeminine ordmasculine Omega ae oslash".split(" ");
  return tab[k];
}

/** Leser en innebygd fontfil. type: "cff" (FontFile3 Type1C/CIDFontType0C), "otf" (FontFile3 OpenType) eller "ttf" (FontFile2). */
export function lesFontfil(d: Uint8Array, type: "cff" | "otf" | "ttf"): GlyfFont {
  if (type === "cff") return lesCff(d);
  const t = tabeller(d);
  const cff = t.get("CFF ");
  if (cff) {
    const f = lesCff(d.subarray(cff[0], cff[0] + cff[1]));
    // OpenType med CFF: cmap kan ogsaa brukes
    let cmap: NonNullable<GlyfFont["cmap"]> = [];
    try { cmap = lesCmap(d, t); } catch { /* uten cmap */ }
    return { ...f, cmap };
  }
  return lesTrueType(d);
}
