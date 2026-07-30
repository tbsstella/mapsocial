/** Crop/resize an image file to a 256px square webp data URL on the client
 *  (center crop, also strips EXIF). The server sniffs bytes and runs the
 *  moderation hook on upload. */
export async function cropToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    256,
    256
  );
  return canvas.toDataURL("image/webp", 0.85);
}
