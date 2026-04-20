declare module 'upng-js' {
  interface UPNGStatic {
    encodeLL(
      bufs: ArrayBuffer[],
      w: number,
      h: number,
      channels: number,
      _unused?: number,
      depth?: number,
    ): ArrayBuffer;
  }

  const UPNG: UPNGStatic;
  export default UPNG;
}
