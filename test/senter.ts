import * as fs from "fs";
import { kjorJobb } from "../src/motor";
(async () => {
  const r = await kjorJobb({
    jobb: "Senter", linjer: [{ navn: "Klinikk",
      pdf: new Uint8Array(fs.readFileSync("/home/claude/kunde/Klinikk_S_tran.pdf")),
      breddeMm: 600, antall: 12,
      folie: { kode: "751-070", hex: "#1A1A1A", breddeMm: 1520, skjaerebreddeMm: 1480 } }],
  });
  fs.writeFileSync("senter.pdf", r.filer[0].bytes);
})();
