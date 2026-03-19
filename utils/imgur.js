import sharp from "sharp";

/**
 * Compress an image buffer and return a base64 data URI.
 * Images are stored directly in MongoDB — private to the app,
 * visible to all users, no external hosting needed.
 *
 * Keeps the function name for compatibility with existing route imports.
 */
export async function uploadToImgur(buffer) {
  const compressed = await sharp(buffer)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer();

  const base64 = compressed.toString("base64");
  return `data:image/jpeg;base64,${base64}`;
}
