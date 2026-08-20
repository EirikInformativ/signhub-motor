/**
 * Kundeskisse for kjoretoy.
 *
 * Biltegningen er allerede lest som baner, sa den tegnes rett paa lerret.
 * Ingen PDF-render trengs. Dekoren tegnes i sine egne farger oppa, med
 * plasseringsmaal, og hele arket brennes til jpeg slik at det ikke finnes
 * kurver a hente ut. Vannmerke og disclaimer legges paa til slutt.
 */
import type { Bane } from "./uttrekk.ts";

const MM = 72 / 25.4;

export interface BilSkisseValg {
  jobb: string;
  malestokk: number;
  /**
   * Visningene pa arket. Bare det som ligger inne i en visning tegnes.
   * Kildearket har sin egen bunntekst med logo og strek, og den skal ikke
   * bli med, for skissen har sin egen disclaimer nederst.
   */
  visninger: { x0: number; y0: number; x1: number; y1: number }[];
  omraader: { x0: number; y0: number; x1: number; y1: number; navn: string; vis: string }[];
  bilder: { disclaimer: any; vannmerke: any };
  lerret: (b: number, h: number) => any;
  /** hoyde delt paa bredde. Settes til A4 nar skissen skal paa et A4-ark. */
  sideforhold?: number;
  bredde?: number;        // piksler
  kvalitet?: number;
  styrke?: number;        // gjennomsiktighet pa vannmerket
  kolonner?: number;      // hvor mange logobredder det er plass til pa bredden
  vinkel?: number;
}

const andel = (b: Bane, o: any) => {
  const ox = Math.max(0, Math.min(b.boks.x1, o.x1) - Math.max(b.boks.x0, o.x0));
  const oy = Math.max(0, Math.min(b.boks.y1, o.y1) - Math.max(b.boks.y0, o.y0));
  return (ox * oy) / Math.max((b.boks.x1 - b.boks.x0) * (b.boks.y1 - b.boks.y0), 1e-9);
};

const cmykTilCss = (c: number[]) => {
  const r = Math.round(255 * (1 - Math.min(1, c[0] + c[3])));
  const g = Math.round(255 * (1 - Math.min(1, c[1] + c[3])));
  const b = Math.round(255 * (1 - Math.min(1, c[2] + c[3])));
  return `rgb(${r},${g},${b})`;
};

export function tegnBilSkisse(baner: Bane[], v: BilSkisseValg): { jpeg: Uint8Array; bredde: number; hoyde: number } {
  const W = v.bredde ?? 1400;
  const LUFT = 0.04;                       // andel av bredden rundt motivet
  const vv = v.visninger;
  const felt = {
    x0: Math.min(...vv.map((o) => o.x0)), y0: Math.min(...vv.map((o) => o.y0)),
    x1: Math.max(...vv.map((o) => o.x1)), y1: Math.max(...vv.map((o) => o.y1)),
  };
  const marg = (felt.x1 - felt.x0) * LUFT;
  const side = { x0: felt.x0 - marg, y0: felt.y0 - marg, x1: felt.x1 + marg, y1: felt.y1 + marg };
  const sideB = side.x1 - side.x0, sideH = side.y1 - side.y0;
  const topp = Math.round(W * 0.055), bunn = Math.round(W * 0.075);
  let s = W / sideB;
  let H = Math.round(sideH * s) + topp + bunn;
  /**
   * Skal skissen paa et A4-ark, skal arket vaere lerretet. Ellers blir det
   * hvite renner paa sidene og disclaimeren rekker ikke ut til kanten.
   */
  let venstre = 0;
  if (v.sideforhold) {
    const onsket = Math.round(H / v.sideforhold);
    if (onsket > W) { venstre = Math.round((onsket - W) / 2); }
    else { H = Math.round(W * v.sideforhold); }
  }
  const arkB = W + 2 * venstre;
  const c = v.lerret(arkB, H);
  const g = c.getContext("2d");
  const X = (x: number) => venstre + (x - side.x0) * s;
  const Y = (y: number) => topp + (side.y1 - y) * s;
  const iVisning = (b: Bane) => vv.some((o) =>
    b.boks.x0 >= o.x0 - 1 && b.boks.x1 <= o.x1 + 1 && b.boks.y0 >= o.y0 - 1 && b.boks.y1 <= o.y1 + 1);

  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, arkB, H);

  const tegn = (b: Bane, farge: string, strekFarge: string) => {
    g.beginPath();
    for (const seg of b.segs) {
      if (seg.t === "m") g.moveTo(X(seg.p[0]), Y(seg.p[1]));
      else if (seg.t === "l") g.lineTo(X(seg.p[0]), Y(seg.p[1]));
      else if (seg.t === "c") g.bezierCurveTo(X(seg.a[0]), Y(seg.a[1]), X(seg.b[0]), Y(seg.b[1]), X(seg.c[0]), Y(seg.c[1]));
      else g.closePath();
    }
    if (b.fyll) { g.fillStyle = farge; g.fill(); }
    if (b.strek) { g.strokeStyle = strekFarge; g.lineWidth = Math.max(0.35, b.bredde * s); g.stroke(); }
  };

  // 1. bilen, dempet, sa dekoren er det oyet gaar til
  for (const b of baner) {
    if (!iVisning(b)) continue;
    if (v.omraader.some((o) => andel(b, o) >= 0.9)) continue;
    tegn(b, cmykTilCss(b.farge), cmykTilCss(b.strekFarge ?? b.farge));
  }
  // 2. dekoren, i egne farger
  for (const b of baner) {
    if (!v.omraader.some((o) => andel(b, o) >= 0.9)) continue;
    tegn(b, cmykTilCss(b.farge), cmykTilCss(b.strekFarge ?? b.farge));
  }

  // 3. plasseringsmaal rundt hver dekor
  g.font = `${Math.round(W * 0.0085)}px sans-serif`;
  g.textBaseline = "middle";
  for (const o of v.omraader) {
    // maalene skal gjelde dekoren, ikke omraadet noen pekte ut rundt den
    const egne = baner.filter((b2) => andel(b2, o) >= 0.9);
    if (!egne.length) continue;
    const t0 = {
      x0: Math.min(...egne.map((b2) => b2.boks.x0)), y0: Math.min(...egne.map((b2) => b2.boks.y0)),
      x1: Math.max(...egne.map((b2) => b2.boks.x1)), y1: Math.max(...egne.map((b2) => b2.boks.y1)),
    };
    const x0 = X(t0.x0), x1 = X(t0.x1), y0 = Y(t0.y1), y1 = Y(t0.y0);
    g.strokeStyle = "#e2007a";
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.strokeRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6);
    g.setLineDash([]);
    const bM = ((t0.x1 - t0.x0) / MM) * v.malestokk;
    const hM = ((t0.y1 - t0.y0) / MM) * v.malestokk;
    const t = `${bM.toFixed(0)} x ${hM.toFixed(0)} mm`;
    g.fillStyle = "#e2007a";
    g.fillText(t, x0 - 3, y0 - Math.round(W * 0.012));
  }

  // 4. tittel
  g.fillStyle = "#111111";
  g.font = `bold ${Math.round(W * 0.016)}px sans-serif`;
  g.fillText(v.jobb, Math.round(arkB * 0.02), Math.round(topp * 0.35));
  g.fillStyle = "#555555";
  g.font = `${Math.round(W * 0.0095)}px sans-serif`;
  g.fillText(`Skissen er tegnet i 1:${v.malestokk.toFixed(1)}. Maalene gjelder ekte kjoretoy.`,
    Math.round(arkB * 0.02), Math.round(topp * 0.72));

  // 5. vannmerket. Samme styrke og tetthet som i logoskissen, ellers
  //    tar det oppmerksomheten vekk fra bilen.
  const vm = v.bilder.vannmerke;
  if (vm?.width) {
    const styrke = v.styrke ?? 0.065;
    const kolonner = v.kolonner ?? 2.4;
    const vinkel = v.vinkel ?? 30;
    const lb = Math.max(1, Math.round(arkB / kolonner));
    const lh = Math.max(1, Math.round((lb * vm.height) / vm.width));
    const stegX = Math.max(1, Math.round(lb * 1.3));
    const stegY = Math.max(1, Math.round(lh * 3.4));
    const D = Math.round(Math.hypot(arkB, H)) + 2 * lb;
    g.save();
    g.globalAlpha = styrke;
    g.translate(arkB / 2, H / 2);
    g.rotate((-vinkel * Math.PI) / 180);
    g.translate(-D / 2, -D / 2);
    let rad = 0;
    for (let y = 0; y < D; y += stegY) {
      for (let x = -lb + ((rad % 2) * stegX) / 2; x < D; x += stegX) g.drawImage(vm, x, y, lb, lh);
      rad++;
    }
    g.restore();
  }

  // 6. disclaimeren nederst, ren og uten vannmerke
  const dc = v.bilder.disclaimer;
  if (dc?.width) {
    const h = (arkB * dc.height) / dc.width;
    const luft = Math.round(arkB * 0.005);
    g.fillStyle = "#ffffff";
    g.fillRect(0, H - h - luft, arkB, h + luft);
    g.drawImage(dc, 0, H - h - luft, arkB, h);
  }

  /**
   * toDataURL finnes bade i nettleseren og i @napi-rs/canvas, sa den er
   * felles grunn. Base64 dekodes med atob, som ogsa finnes begge steder.
   * Buffer gjor ikke det, og ville brutt nettleserbygget.
   */
  const url: string = c.toDataURL("image/jpeg", v.kvalitet ?? 0.9);
  const b64 = url.slice(url.indexOf(",") + 1);
  const raa = atob(b64);
  const jpeg = new Uint8Array(raa.length);
  for (let i = 0; i < raa.length; i++) jpeg[i] = raa.charCodeAt(i);
  return { jpeg, bredde: arkB, hoyde: H };
}
