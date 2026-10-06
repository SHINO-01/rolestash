/**
 * Encodes the homepage feature clips (site/index.html #features) from the
 * frames tests/clips records. Silent by design: no audio track, so browsers
 * show no sound or pause controls, like the hero film.
 *
 * Usage: npm run site:clips   (records, then runs this)
 *        npx tsx scripts/encode-site-clips.ts   (re-encode existing frames)
 *
 * Writes site/assets/feature-<name>-<VERSION>.{webm,mp4} and -poster.webp.
 * Bump VERSION when the clips change: site assets are cached for a day.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const FRAMES = join(ROOT, '.output/clips');
const OUT = join(ROOT, 'site/assets');
const VERSION = 2;

/**
 * Output width per clip (desktop clips are 16:10, the phone clip 390:844),
 * and the poster: the moment that sums the clip up (seconds into it), or the
 * last frame. It shows before the clip plays and to anyone who prefers
 * reduced motion.
 */
const CLIPS: { name: string; width: number; poster?: number }[] = [
  { name: 'save', width: 1440 },
  { name: 'autofill', width: 1440 },
  { name: 'board', width: 1440, poster: 4.0 },
  { name: 'email', width: 1440, poster: 3.5 },
  { name: 'phone', width: 560, poster: 0.5 },
];

const ffmpeg = (args: string[]) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
  });

const kb = (file: string) => `${String(Math.round(statSync(file).size / 1024))} KB`;

// Old versions go, so only the clips the page uses are deployed.
for (const file of readdirSync(OUT)) {
  if (
    /^feature-[a-z]+-\d+(-poster)?\.(webm|mp4|webp)$/.test(file) &&
    !file.includes(`-${String(VERSION)}`)
  )
    unlinkSync(join(OUT, file));
}

for (const { name, width, poster } of CLIPS) {
  const list = join(FRAMES, name, 'frames.txt');
  if (!existsSync(list)) throw new Error(`No frames for ${name}: run npm run site:clips`);
  const base = join(OUT, `feature-${name}-${String(VERSION)}`);
  const input = ['-f', 'concat', '-safe', '0', '-i', list];
  const scale = `fps=30,scale=${String(width)}:-2:flags=lanczos,format=yuv420p`;
  ffmpeg([
    ...input,
    '-vf',
    scale,
    '-an',
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '36',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    '-deadline',
    'good',
    '-cpu-used',
    '2',
    `${base}.webm`,
  ]);
  ffmpeg([
    ...input,
    '-vf',
    scale,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryslow',
    '-crf',
    '27',
    '-movflags',
    '+faststart',
    `${base}.mp4`,
  ]);
  const frames = readdirSync(join(FRAMES, name))
    .filter((f) => f.endsWith('.jpg'))
    .sort();
  ffmpeg([
    ...(poster === undefined
      ? ['-i', join(FRAMES, name, frames.at(-1)!)]
      : ['-ss', String(poster), '-i', `${base}.mp4`]),
    '-frames:v',
    '1',
    '-vf',
    `scale=${String(width)}:-2:flags=lanczos`,
    '-c:v',
    'libwebp',
    '-quality',
    '80',
    `${base}-poster.webp`,
  ]);
  console.log(
    `${name}: webm ${kb(`${base}.webm`)}, mp4 ${kb(`${base}.mp4`)}, poster ${kb(`${base}-poster.webp`)}`,
  );
}
