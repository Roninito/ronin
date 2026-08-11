/**
 * QR code rendering for tunnel URLs — terminal ASCII (printed right after
 * `tunnel temp` succeeds) and SVG (served by the /connect dashboard page).
 * Generated locally via qrcode-generator (pure JS, zero dependencies,
 * no native bindings) — never sent to a third-party QR-rendering API,
 * consistent with Ronin's local-first stance.
 */

import qrcode from "qrcode-generator";

function buildQr(text: string) {
  const qr = qrcode(0, "M"); // 0 = auto type number, M = medium error correction
  qr.addData(text);
  qr.make();
  return qr;
}

export function renderQrAscii(text: string): string {
  return buildQr(text).createASCII(2);
}

export function renderQrSvg(text: string): string {
  return buildQr(text).createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
