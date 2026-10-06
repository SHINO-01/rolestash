import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';

/** Raw frames land here; scripts/encode-site-clips.ts turns them into site/assets videos. */
export const FRAMES_ROOT = resolve(import.meta.dirname, '../../.output/clips');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Records a page with Chrome's screencast (every composited frame, with its
 * timestamp, so pauses keep their real length), and draws a cursor, since
 * headless Chrome has none. The cursor lives in the top layer (a popover), so
 * it stays above the Rolestash button and panel.
 */
export class Recorder {
  private frames: { file: string; at: number }[] = [];
  private x = 0;
  private y = 0;
  private stopped = false;
  private paused = false;
  /** Seconds left out by skip(), taken off every later frame's timestamp. */
  private gap = 0;

  private constructor(
    private readonly page: Page,
    private readonly dir: string,
    private readonly touch: boolean,
  ) {}

  /** `touch` draws a fingertip instead of an arrow (phone clips). */
  static async start(
    page: Page,
    name: string,
    at: { x: number; y: number },
    { touch = false } = {},
  ): Promise<Recorder> {
    const dir = join(FRAMES_ROOT, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const rec = new Recorder(page, dir, touch);
    await rec.showCursor(at.x, at.y);
    const cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', (frame) => {
      if (rec.stopped || rec.paused) {
        void cdp
          .send('Page.screencastFrameAck', { sessionId: frame.sessionId })
          .catch(() => undefined);
        return;
      }
      const file = `${String(rec.frames.length).padStart(5, '0')}.jpg`;
      writeFileSync(join(dir, file), Buffer.from(frame.data, 'base64'));
      rec.frames.push({ file, at: (frame.metadata.timestamp ?? Date.now() / 1000) - rec.gap });
      void cdp
        .send('Page.screencastFrameAck', { sessionId: frame.sessionId })
        .catch(() => undefined);
    });
    // Ask for device pixels (the default is CSS pixels).
    const [width, height, scale] = await page.evaluate(() => [
      innerWidth,
      innerHeight,
      devicePixelRatio,
    ]);
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      everyNthFrame: 1,
      maxWidth: Math.round(width * scale),
      maxHeight: Math.round(height * scale),
    });
    rec.stopRecording = async () => {
      await cdp.send('Page.stopScreencast').catch(() => undefined);
    };
    return rec;
  }

  private stopRecording: () => Promise<unknown> = () => Promise.resolve();

  /** (Re)draws the cursor after a navigation. */
  async showCursor(x = this.x, y = this.y): Promise<void> {
    this.x = x;
    this.y = y;
    await this.page.evaluate(
      ({ x, y, touch }) => {
        document.getElementById('__clip-cursor')?.remove();
        const el = document.createElement('div');
        el.id = '__clip-cursor';
        el.setAttribute('popover', 'manual');
        el.innerHTML = touch
          ? '<div style="width:38px;height:38px;border-radius:50%;background:rgb(16 35 31 / 24%);box-shadow:0 0 0 2px rgb(255 255 255 / 85%)"></div>'
          : '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2l15 10.5-6.6 1.3 3.9 7.4-2.7 1.4-3.9-7.5L4 19.6z" fill="#10231f" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
        Object.assign(el.style, {
          position: 'fixed',
          inset: 'auto',
          left: '0',
          top: '0',
          margin: '0',
          padding: '0',
          border: '0',
          background: 'transparent',
          overflow: 'visible',
          pointerEvents: 'none',
          transform: `translate(${x - 4}px, ${y - 2}px)`,
          filter: 'drop-shadow(0 2px 3px rgb(0 0 0 / 30%))',
          transition: 'scale 90ms ease-out',
          transformOrigin: touch ? '0 0' : '4px 2px',
        });
        if (touch) {
          // A fingertip shows only while it presses, like a tap on a phone.
          Object.assign(el.style, {
            filter: 'none',
            width: '38px',
            height: '38px',
            opacity: '0',
            transition: 'opacity 160ms ease-out, scale 160ms ease-out',
            transform: `translate(${x - 19}px, ${y - 19}px)`,
          });
        }
        document.documentElement.append(el);
        el.showPopover();
      },
      { x, y, touch: this.touch },
    );
  }

  private async place(x: number, y: number): Promise<void> {
    this.x = x;
    this.y = y;
    await this.page.evaluate(
      ({ x, y, touch }) => {
        const el = document.getElementById('__clip-cursor');
        if (el)
          el.style.transform = touch
            ? `translate(${x}px, ${y}px)`
            : `translate(${x - 4}px, ${y - 2}px)`;
      },
      { x, y, touch: this.touch },
    );
  }

  /** Glides the cursor (and the real mouse) to a point, easing in and out. */
  async moveTo(x: number, y: number, ms = 700): Promise<void> {
    const fromX = this.x;
    const fromY = this.y;
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      const nx = fromX + (x - fromX) * t;
      const ny = fromY + (y - fromY) * t;
      await this.page.mouse.move(nx, ny);
      await this.place(nx, ny);
      await sleep(ms / steps / 2);
    }
  }

  async centre(target: Locator): Promise<{ x: number; y: number }> {
    const box = await target.boundingBox();
    if (!box) throw new Error('target not visible');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  async moveToTarget(target: Locator, ms = 700): Promise<void> {
    const { x, y } = await this.centre(target);
    await this.moveTo(x, y, ms);
  }

  /** Moves to a target and clicks it, with a small press on the cursor. */
  async click(target: Locator, ms = 700): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    await this.moveToTarget(target, ms);
    await sleep(120);
    await this.press(true);
    await this.page.mouse.down();
    await sleep(this.touch ? 180 : 90);
    await this.page.mouse.up();
    await this.press(false);
  }

  async press(down: boolean): Promise<void> {
    await this.page.evaluate(
      ({ down, touch }) => {
        const el = document.getElementById('__clip-cursor');
        if (!el) return;
        if (touch) {
          el.style.opacity = down ? '1' : '0';
          el.style.scale = down ? '1' : '1.5';
        } else el.style.scale = down ? '0.82' : '1';
      },
      { down, touch: this.touch },
    );
  }

  async hold(ms: number): Promise<void> {
    await sleep(ms);
  }

  /** Leaves a wait out of the clip (a cut), e.g. while a toast clears. */
  async skip(wait: () => Promise<unknown>): Promise<void> {
    const from = Date.now();
    this.paused = true;
    try {
      await wait();
    } finally {
      this.gap += (Date.now() - from) / 1000;
      this.paused = false;
    }
  }

  /**
   * Stops and writes an ffmpeg concat list with each frame's real duration;
   * the last frame is held for `tail` seconds so the loop doesn't jump.
   */
  async stop(tail = 0.6): Promise<void> {
    await this.stopRecording();
    this.stopped = true;
    if (this.frames.length < 2) throw new Error(`only ${String(this.frames.length)} frames`);
    const lines: string[] = [];
    this.frames.forEach((f, i) => {
      const next = this.frames[i + 1];
      const duration = next ? Math.max(0.001, next.at - f.at) : tail;
      lines.push(`file '${f.file}'`, `duration ${duration.toFixed(4)}`);
    });
    // The concat demuxer ignores the last duration unless the file is repeated.
    lines.push(`file '${this.frames.at(-1)!.file}'`);
    writeFileSync(join(this.dir, 'frames.txt'), `${lines.join('\n')}\n`);
  }
}
