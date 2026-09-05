/**
 * Ambient shims for third-party packages with no published type declarations
 * (checked: no @types/* package exists on npm for these). Untyped on purpose —
 * this just stops `tsc` from erroring on the import; call sites still get
 * real types wherever they narrow the result themselves.
 */
declare module "webtorrent" {
  namespace WebTorrent {
    type Instance = any;
    type Torrent = any;
  }
  const WebTorrent: any;
  export default WebTorrent;
}
