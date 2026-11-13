#!/usr/bin/env node
/* A receipt printer that is not there.

   Listens on a TCP port and behaves as an ESC/POS printer does: takes raster
   images, answers real-time status questions, counts drawer pulses and cuts.
   What it "prints" it keeps, and can write out as a PNG, so a test — or a
   person — can look at what a real printer would have put on paper.

   It exists because the tests must not need a printer, and because "the job
   was accepted" is not evidence of anything. This is the nearest thing to
   paper that runs on a laptop; it is still not paper.

     node scripts/fake-printer.mjs --port 9100 --out ./prints
         [--mode ok|silent|paperout|coveropen]   what it says about itself

   As a module: `const p = await fakePrinter({ mode })` → `p.port`, `p.jobs`,
   `p.set({ mode })`, `p.close()`. */

import net from "node:net";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/* What was printed, as a PNG: one bit a dot, black where the head fired. */
export function toPng(job) {
  const bytesPerRow = job.bytesPerRow || 1;
  const height = job.rows.length;
  const head = Buffer.alloc(13);
  head.writeUInt32BE(bytesPerRow * 8, 0);
  head.writeUInt32BE(Math.max(1, height), 4);
  head[8] = 1; head[9] = 0;
  const raw = Buffer.alloc(Math.max(1, height) * (bytesPerRow + 1), 0xff);
  job.rows.forEach((row, y) => {
    raw[y * (bytesPerRow + 1)] = 0;
    for (let x = 0; x < bytesPerRow; x += 1) raw[y * (bytesPerRow + 1) + 1 + x] = ~row[x] & 0xff;
  });
  if (!height) raw[0] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* How many dots are black: a blank page and a receipt are told apart by it. */
export const inkOf = (job) => job.rows.reduce((n, row) => {
  let c = n;
  for (const b of row) { let v = b; while (v) { c += v & 1; v >>= 1; } }
  return c;
}, 0);

export async function fakePrinter({ port = 0, host = "127.0.0.1", mode = "ok", dropAfter = 0, endAfter = 0, resetOnClose = false, runsOutAfter = 0, onJob = null } = {}) {
  const state = { mode, dropAfter, endAfter, resetOnClose, runsOutAfter };
  const jobs = [];
  const sockets = new Set();

  /* Half-open, so that what this printer does when it is hung up on is its
     own choice: say goodbye back, or (`resetOnClose`) slam the line, as a
     good many real ones do once they have everything. */
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.on("end", () => { if (state.resetOnClose) socket.resetAndDestroy(); else socket.end(); });
    sockets.add(socket);
    const job = { bytes: 0, bytesPerRow: 0, rows: [], drawer: 0, cut: 0, init: 0, text: "", statusAsked: 0, complete: false };
    jobs.push(job);
    let buf = Buffer.alloc(0);
    let out = state.mode === "paperout";

    const answer = (n) => {
      job.statusAsked += 1;
      if (state.mode === "silent") return;
      const cover = state.mode === "coveropen";
      const b = n === 1 ? 0x12 | (cover || out ? 0x08 : 0)
        : n === 2 ? 0x12 | (cover ? 0x04 : 0) | (out ? 0x20 : 0)
        : n === 4 ? 0x12 | (out ? 0x60 : 0)
        : 0x12;
      socket.write(Buffer.from([b]));
    };

    /* One command at a time; false means "wait for more bytes". Image data is
       skipped by its declared length, so a status question is only ever one
       the sender asked. */
    const step = () => {
      if (!buf.length) return false;
      const b = buf[0];
      const need = (n) => buf.length >= n;
      if (b === 0x10) {
        if (!need(2)) return false;
        if (buf[1] === 0x04) { if (!need(3)) return false; answer(buf[2]); buf = buf.subarray(3); return true; }
        if (buf[1] === 0x14) { if (!need(5)) return false; job.drawer += 1; buf = buf.subarray(5); return true; }
        buf = buf.subarray(1); return true;
      }
      if (b === 0x1b) {
        if (!need(2)) return false;
        const c = buf[1];
        if (c === 0x40) { job.init += 1; buf = buf.subarray(2); return true; }
        if (c === 0x70) { if (!need(5)) return false; job.drawer += 1; buf = buf.subarray(5); return true; }
        if (c === 0x42) { if (!need(4)) return false; buf = buf.subarray(4); return true; }
        if ([0x64, 0x61, 0x45, 0x4a, 0x21, 0x2d, 0x4d].includes(c)) { if (!need(3)) return false; buf = buf.subarray(3); return true; }
        buf = buf.subarray(2); return true;
      }
      if (b === 0x1d) {
        if (!need(2)) return false;
        const c = buf[1];
        if (c === 0x76) {
          if (!need(8)) return false;
          const w = buf[4] | (buf[5] << 8);
          const h = buf[6] | (buf[7] << 8);
          if (!need(8 + w * h)) return false;
          job.bytesPerRow = w;
          for (let y = 0; y < h; y += 1) job.rows.push(Buffer.from(buf.subarray(8 + y * w, 8 + (y + 1) * w)));
          if (state.runsOutAfter && job.rows.length >= state.runsOutAfter) out = true;
          buf = buf.subarray(8 + w * h); return true;
        }
        if (c === 0x56) {
          if (!need(3)) return false;
          const long = buf[2] === 65 || buf[2] === 66;
          if (long && !need(4)) return false;
          job.cut += 1; buf = buf.subarray(long ? 4 : 3); return true;
        }
        if (c === 0x49) {
          if (!need(3)) return false;
          if (state.mode !== "silent") socket.write(Buffer.from("_FAKE-80\0", "latin1"));
          buf = buf.subarray(3); return true;
        }
        buf = buf.subarray(2); return true;
      }
      job.text += String.fromCharCode(b);
      buf = buf.subarray(1);
      return true;
    };

    socket.on("data", (data) => {
      job.bytes += data.length;
      if (state.dropAfter && job.bytes >= state.dropAfter) { socket.destroy(); return; }
      /* Hangs up politely part-way: its side is closed, with no error for the
         sender to trip over, which is how a printer that resets itself in the
         middle of a job looks from the other end. */
      if (state.endAfter && job.bytes >= state.endAfter && !job.hungUp) { job.hungUp = true; socket.end(); }
      buf = Buffer.concat([buf, data]);
      while (step()) { /* until it needs more */ }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
      job.complete = buf.length === 0 && job.cut > 0;
      if (onJob) onJob(job, jobs.length);
    });
  });

  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  return {
    port: server.address().port,
    host,
    jobs,
    /* The jobs that put something on paper, leaving out bare connection tests. */
    printed: () => jobs.filter((j) => j.rows.length > 0 || j.text.trim()),
    set: (patch) => Object.assign(state, patch),
    close: () => new Promise((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
  const out = arg("out", "");
  if (out) fs.mkdirSync(out, { recursive: true });
  const printer = await fakePrinter({
    port: Number(arg("port", 9100)), host: arg("host", "127.0.0.1"), mode: arg("mode", "ok"),
    onJob: (job, n) => {
      if (!job.rows.length && !job.text.trim()) { console.log(`#${n}: a connection, ${job.statusAsked} status question(s), nothing printed`); return; }
      const file = out ? path.join(out, `job-${String(n).padStart(3, "0")}.png`) : "";
      if (file && job.rows.length) fs.writeFileSync(file, toPng(job));
      console.log(`#${n}: ${job.bytes} bytes, ${job.bytesPerRow * 8}×${job.rows.length} dots, ${inkOf(job)} black, drawer ${job.drawer}, cut ${job.cut}${job.complete ? "" : " — INCOMPLETE"}${file ? ` → ${file}` : ""}`);
    },
  });
  console.log(`Fake printer listening on ${printer.host}:${printer.port} (mode ${arg("mode", "ok")}).`);
}
