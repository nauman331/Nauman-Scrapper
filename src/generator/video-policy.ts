import * as cheerio from 'cheerio';
import { z } from 'zod';

/** Source-browser observations, not guesses based on autoplay/muted attributes. */
export const VideoReviewSchema = z.object({
  version: z.literal(1),
  role: z.enum(['foreground', 'background']),
  controls: z.boolean(),
  autoplay: z.boolean(),
  playing: z.boolean(),
  muted: z.boolean(),
  loop: z.boolean(),
  playsInline: z.boolean(),
  visible: z.boolean(),
  objectFit: z.string().max(32),
});

/** Shared by every exporter; source scripts must not be reintroduced to play videos. */
export function applyVideoPolicy(html: string, warnings: string[] = []): string {
  // Avoid an unnecessary DOM parse for the common video-free case.
  if (!/<video\b/i.test(html)) return html;
  const $ = cheerio.load(html);
  $('video').each((index, element) => {
    const video = $(element);
    let review: z.infer<typeof VideoReviewSchema> | undefined;
    try {
      const parsed = VideoReviewSchema.safeParse(JSON.parse(video.attr('data-captured-video-review') || 'null'));
      if (parsed.success) review = parsed.data;
    } catch { /* Malformed or old observations use the safe foreground default. */ }
    const background = review?.role === 'background';
    const role = background ? 'background' : 'foreground';
    video.attr('data-clone-video-role', role);
    // The HTML boolean attribute is true even when its value is "false".
    if (background && review) {
      // A background can be paused during loading, scrolling or headless capture.
      // Preserve source autoplay intent independently of this transient state.
      if (review.autoplay || review.playing) video.attr('autoplay', ''); else video.removeAttr('autoplay');
      video.attr('muted', '').attr('playsinline', '');
      if (review.loop) video.attr('loop', ''); else video.removeAttr('loop');
      if (review.controls) video.attr('controls', ''); else video.removeAttr('controls');
      warnings.push(`Video ${index + 1}: reviewed source background (${review.playing ? 'playing' : 'paused at capture'}, ${review.loop ? 'looping' : 'not looping'}); preserved source controls and autoplay intent, exported muted and inline.`);
    } else {
      // Custom source player handlers are stripped; native controls remain usable.
      video.removeAttr('autoplay').attr('controls', '').attr('playsinline', '');
      if (!review) warnings.push(`Video ${index + 1}: no valid source-browser review; defaulted to visible native controls and no autoplay. Re-scrape with Playwright to evaluate background behavior.`);
      else if (!review.controls || review.autoplay || review.playing) warnings.push(`Video ${index + 1}: source foreground ${review.controls ? 'had' : 'lacked'} native controls and ${review.playing || review.autoplay ? 'played automatically or was playing at capture' : 'was paused'}; enforced native controls and click-to-play.`);
    }
    // Only interactive players need usable pointer events. Never introduce a
    // player bar to a decorative background or unhide hidden/modal videos.
    if (video.attr('controls') !== undefined) {
      const style = video.attr('style') || '';
      if (!/pointer-events\s*:\s*auto\s*!important/i.test(style)) video.attr('style', `${style}${style && !style.trimEnd().endsWith(';') ? ';' : ''}pointer-events:auto!important;`);
    }
  });
  return $.html();
}
