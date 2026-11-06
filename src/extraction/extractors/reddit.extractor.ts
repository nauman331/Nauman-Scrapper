import type { CheerioAPI } from 'cheerio';
import type { ExtractedRedditPost } from '../schemas/extraction.schema.js';
import { normalizeUrl } from '../../core/domain/url-normalizer.js';

export function isRedditUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'reddit.com' || hostname.endsWith('.reddit.com');
  } catch {
    return false;
  }
}

export function extractRedditPosts($: CheerioAPI, pageUrl: string): ExtractedRedditPost[] {
  const posts: ExtractedRedditPost[] = [];
  const seen = new Set<string>();

  $('shreddit-post').each((_, element) => {
    const post = $(element);
    const title = post.attr('post-title')?.trim() || post.find('[slot="title"]').first().text().trim();
    const permalink = post.attr('permalink') || post.attr('content-href') || null;
    const id = post.attr('id') || post.attr('post-id') || permalink || title;

    if (!title || !id || seen.has(id)) return;
    seen.add(id);

    let url: string | null = null;
    if (permalink) {
      try {
        url = normalizeUrl(permalink, pageUrl);
      } catch {
        url = null;
      }
    }

    posts.push({
      id: post.attr('post-id') || post.attr('id') || null,
      title,
      url,
      author: post.attr('author') || null,
      subreddit: post.attr('subreddit-prefixed-name') || post.attr('subreddit-name') || null,
      score: toNumber(post.attr('score')),
      commentCount: toNumber(post.attr('comment-count')),
      createdAt: post.attr('created-timestamp') || null,
    });
  });

  return posts;
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
