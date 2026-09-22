/**
 * Publishing to the Facebook Page and its linked Instagram account, through
 * Meta's Graph API (v25.0, as in Meta's own examples).
 *
 * Configured by three variables on the server:
 *   META_PAGE_ID      the Facebook Page
 *   META_PAGE_TOKEN   a Page access token (pages_manage_posts, and for
 *                     Instagram instagram_basic + instagram_content_publish)
 *   META_IG_USER_ID   the Instagram professional account linked to the Page
 * Missing values switch the matching side off; nothing here throws.
 */

const GRAPH = 'https://graph.facebook.com/v25.0';

export interface PublishResult {
  id?: string;
  /** Short, for the bot's report. Never contains the token. */
  error?: string;
  /** Not configured, or not applicable (Instagram with no image). */
  skipped?: 'not_configured' | 'no_image';
}

export function facebookEnabled(): boolean {
  return Boolean(process.env['META_PAGE_ID'] && process.env['META_PAGE_TOKEN']);
}

export function instagramEnabled(): boolean {
  return Boolean(process.env['META_IG_USER_ID'] && process.env['META_PAGE_TOKEN']);
}

async function graph(
  path: string,
  params: Record<string, string>,
  method: 'GET' | 'POST' = 'POST',
): Promise<Record<string, unknown>> {
  const token = process.env['META_PAGE_TOKEN'] ?? '';
  const body = new URLSearchParams({ ...params, access_token: token });
  const url = method === 'GET' ? `${GRAPH}${path}?${body}` : `${GRAPH}${path}`;
  const res = await fetch(url, {
    method,
    ...(method === 'POST' ? { body } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json['error']) {
    const e = json['error'] as { message?: string; code?: number } | undefined;
    throw new Error(e?.message ? `${e.message}${e.code ? ` (${e.code})` : ''}` : `HTTP ${res.status}`);
  }
  return json;
}

/** Text only → a feed post; with an image → a photo post captioned with the text. */
export async function publishFacebook(text: string, imageUrl: string | null): Promise<PublishResult> {
  if (!facebookEnabled()) return { skipped: 'not_configured' };
  const page = process.env['META_PAGE_ID']!;
  try {
    const json = imageUrl
      ? await graph(`/${page}/photos`, { url: imageUrl, caption: text })
      : await graph(`/${page}/feed`, { message: text });
    return { id: String(json['post_id'] ?? json['id'] ?? '') };
  } catch (err) {
    return { error: (err as Error).message.slice(0, 300) };
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A Reel on the Page: three phases — start (which hands back an upload id),
 * transfer (Meta pulls the file from our own URL), finish (publish).
 * Spec: 9:16, 3–90 s, H.264; 30 published reels per 24 hours.
 */
export async function publishFacebookReel(videoUrl: string, description: string): Promise<PublishResult> {
  if (!facebookEnabled()) return { skipped: 'not_configured' };
  const page = process.env['META_PAGE_ID']!;
  const token = process.env['META_PAGE_TOKEN'] ?? '';
  try {
    const start = await graph(`/${page}/video_reels`, { upload_phase: 'start' });
    const videoId = String(start['video_id']);
    // The transfer is on rupload.facebook.com, not the graph host, and takes
    // the source address in a header rather than the body.
    const up = await fetch(`https://rupload.facebook.com/video-upload/v25.0/${videoId}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${token}`, file_url: videoUrl },
      signal: AbortSignal.timeout(180_000),
    });
    const upJson = (await up.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
    if (!up.ok || upJson.error) throw new Error(upJson.error?.message ?? `upload HTTP ${up.status}`);

    /*
     * Wait for the TRANSFER only.
     *
     * Processing does not start until `finish` is called — measured on
     * 2026-09-22, where `processing_phase` sat at `not_started` for five
     * minutes while the upload had long been `complete`, and the first attempt
     * timed out waiting for something that could not happen yet.
     */
    for (let i = 0; i < 24; i++) {
      const status = (await graph(`/${videoId}`, { fields: 'status' }, 'GET'))['status'] as
        | { video_status?: string; uploading_phase?: { status?: string } }
        | undefined;
      if (status?.uploading_phase?.status === 'complete' || status?.video_status === 'upload_complete') break;
      if (status?.uploading_phase?.status === 'error') throw new Error('video upload failed');
      await sleep(5_000);
      if (i === 23) throw new Error('video still uploading after 2 minutes');
    }
    const done = await graph(`/${page}/video_reels`, {
      video_id: videoId,
      upload_phase: 'finish',
      video_state: 'PUBLISHED',
      description,
    });
    return { id: String(done['post_id'] ?? videoId) };
  } catch (err) {
    return { error: (err as Error).message.slice(0, 300) };
  }
}

/** A Reel on Instagram: the container dance with media_type=REELS. */
export async function publishInstagramReel(
  videoUrl: string,
  caption: string,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<PublishResult> {
  if (!instagramEnabled()) return { skipped: 'not_configured' };
  const ig = process.env['META_IG_USER_ID']!;
  try {
    const container = await graph(`/${ig}/media`, {
      video_url: videoUrl,
      media_type: 'REELS',
      caption,
      share_to_feed: 'true',
    });
    const creationId = String(container['id']);
    // Video containers take longer than images; Meta's own guidance is to poll.
    for (let i = 0; i < 40; i++) {
      const status = await graph(`/${creationId}`, { fields: 'status_code' }, 'GET');
      const code = String(status['status_code'] ?? '');
      if (code === 'FINISHED') break;
      if (code === 'ERROR' || code === 'EXPIRED') return { error: `reel container ${code}` };
      await wait(5_000);
      if (i === 39) return { error: 'reel container not ready after 3 minutes' };
    }
    const published = await graph(`/${ig}/media_publish`, { creation_id: creationId });
    return { id: String(published['id'] ?? '') };
  } catch (err) {
    return { error: (err as Error).message.slice(0, 300) };
  }
}

/**
 * A story on the Page: the photo is uploaded unpublished, then turned into a
 * story. Meta refuses a photo that a published post already used, which is why
 * the story has its own image.
 *
 * No link sticker: neither platform lets an app attach one to a story.
 */
export async function publishFacebookStory(imageUrl: string): Promise<PublishResult> {
  if (!facebookEnabled()) return { skipped: 'not_configured' };
  const page = process.env['META_PAGE_ID']!;
  try {
    const photo = await graph(`/${page}/photos`, { url: imageUrl, published: 'false' });
    const story = await graph(`/${page}/photo_stories`, { photo_id: String(photo['id']) });
    return { id: String(story['post_id'] ?? story['id'] ?? photo['id']) };
  } catch (err) {
    return { error: (err as Error).message.slice(0, 300) };
  }
}

/** A story on Instagram: the same container dance with media_type=STORIES. */
export async function publishInstagramStory(
  imageUrl: string,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<PublishResult> {
  if (!instagramEnabled()) return { skipped: 'not_configured' };
  const ig = process.env['META_IG_USER_ID']!;
  try {
    const container = await graph(`/${ig}/media`, { image_url: imageUrl, media_type: 'STORIES' });
    const creationId = String(container['id']);
    for (let i = 0; i < 24; i++) {
      const status = await graph(`/${creationId}`, { fields: 'status_code' }, 'GET');
      const code = String(status['status_code'] ?? '');
      if (code === 'FINISHED') break;
      if (code === 'ERROR' || code === 'EXPIRED') return { error: `story container ${code}` };
      await wait(5_000);
      if (i === 23) return { error: 'story container not ready after 2 minutes' };
    }
    const published = await graph(`/${ig}/media_publish`, { creation_id: creationId });
    return { id: String(published['id'] ?? '') };
  } catch (err) {
    return { error: (err as Error).message.slice(0, 300) };
  }
}

/**
 * Container, wait until it is FINISHED, publish. Instagram cannot publish
 * text alone, so a post without an image is skipped, not failed.
 */
export async function publishInstagram(
  caption: string,
  imageUrl: string | null,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<PublishResult> {
  if (!instagramEnabled()) return { skipped: 'not_configured' };
  if (!imageUrl) return { skipped: 'no_image' };
  const ig = process.env['META_IG_USER_ID']!;
  try {
    const container = await graph(`/${ig}/media`, { image_url: imageUrl, caption });
    const creationId = String(container['id']);
    // Meta's guidance is to poll, not to publish blind; an image usually
    // finishes in seconds. Two minutes, then give up and say so.
    for (let i = 0; i < 24; i++) {
      const status = await graph(`/${creationId}`, { fields: 'status_code' }, 'GET');
      const code = String(status['status_code'] ?? '');
      if (code === 'FINISHED') break;
      if (code === 'ERROR' || code === 'EXPIRED') return { error: `container ${code}` };
      await wait(5_000);
      if (i === 23) return { error: 'container not ready after 2 minutes' };
    }
    const published = await graph(`/${ig}/media_publish`, { creation_id: creationId });
    return { id: String(published['id'] ?? '') };
  } catch (err) {
    return { error: (err as Error).message.slice(0, 300) };
  }
}
