import { AVATAR_MAX_LENGTH, AVATAR_SIZE } from '@/domain/account-profile';

/** Pictures larger than this are refused before decoding. */
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

export class AvatarError extends Error {
  constructor(readonly reason: 'not_image' | 'too_large') {
    super(
      reason === 'too_large'
        ? 'That picture is too large. Choose one under 15 MB.'
        : 'Choose a JPEG, PNG, WebP or GIF picture.',
    );
    this.name = 'AvatarError';
  }
}

/**
 * Turns a chosen picture into a 128-pixel square (centre-cropped) data: URL,
 * on this device (ADR-0022). Re-encoding drops the original file's metadata,
 * such as where a photo was taken.
 */
export async function resizeAvatar(file: Blob): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new AvatarError('not_image');
  if (file.size > MAX_INPUT_BYTES) throw new AvatarError('too_large');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AvatarError('not_image');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AvatarError('not_image');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5]) {
    let url = canvas.toDataURL('image/webp', quality);
    // Browsers without WebP encoding fall back to PNG; JPEG is smaller.
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= AVATAR_MAX_LENGTH) return url;
  }
  throw new AvatarError('too_large');
}
