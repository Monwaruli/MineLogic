/**
 * Per-Difficulty Video_Source configuration for the Video_Panel (task 7.2).
 *
 * Each Difficulty has a narrated walkthrough video that sits beside its tutorial
 * (Requirement 12). The video is recorded outside MineLogic (the user records it
 * with the Windows Snipping Tool — see the Scope note in requirements.md), so
 * MineLogic only embeds it. Until the user fills in a URL here, the Video_Panel
 * shows a "coming soon" placeholder (Requirement 12.5).
 *
 * A Video_Source is either:
 *   - a direct video file URL (kind 'file'), played in an HTML <video> element
 *     with native play/pause/scrub controls, or
 *   - a YouTube embed URL (kind 'youtube'), shown in an <iframe> whose player
 *     provides the same controls (Requirement 12.1, 12.4).
 *
 * Captions are optional: when a `captionsUrl` is set for a 'file' source, the
 * Video_Panel offers it as a <track> (Requirement 12.7).
 *
 * This is plain configuration data — no React or DOM imports — so it is easy to
 * edit and is read by both the Video_Panel and any future tooling. Leave a
 * Difficulty's entry `null` (or omit it) to show the placeholder.
 */

import type { Tier } from './lessons';

/** A configured video for one Difficulty. */
export type VideoSource =
  | {
      /** A direct video file URL, played in a native <video> element. */
      kind: 'file';
      url: string;
      /** Optional captions (WebVTT) URL (Requirement 12.7). */
      captionsUrl?: string;
      /** Optional human-readable label for the language of the captions. */
      captionsLabel?: string;
    }
  | {
      /** A YouTube embed URL (https://www.youtube.com/embed/...). */
      kind: 'youtube';
      url: string;
    };

/**
 * The Video_Source per Difficulty. `null` (the default for every tier) means no
 * video is configured yet, so the Video_Panel shows the "coming soon"
 * placeholder (Requirement 12.5).
 *
 * To add a video, replace a tier's `null` with a VideoSource, for example:
 *
 *   Intermediate: {
 *     kind: 'youtube',
 *     url: 'https://www.youtube.com/embed/XXXXXXXXXXX',
 *   },
 *
 * or a direct file with captions:
 *
 *   Beginner: {
 *     kind: 'file',
 *     url: '/videos/beginner.mp4',
 *     captionsUrl: '/videos/beginner.vtt',
 *     captionsLabel: 'English',
 *   },
 */
export const VIDEO_SOURCES: Record<Tier, VideoSource | null> = {
  // Walkthrough clips recorded by tools/demo/record-clips.mjs into
  // public/videos/, served by Vite at /videos/<tier>.webm (Requirement 12.1).
  Beginner: { kind: 'file', url: import.meta.env.BASE_URL + 'videos/beginner.webm' },
  Intermediate: { kind: 'file', url: import.meta.env.BASE_URL + 'videos/intermediate.webm' },
  Expert: { kind: 'file', url: import.meta.env.BASE_URL + 'videos/expert.webm' },
};

/**
 * The configured Video_Source for a Difficulty, or null when none is set. A
 * blank-URL entry is treated as unset so an accidentally empty string still
 * shows the placeholder.
 */
export function videoSourceFor(tier: Tier): VideoSource | null {
  const src = VIDEO_SOURCES[tier];
  if (!src) return null;
  if (typeof src.url !== 'string' || src.url.trim() === '') return null;
  return src;
}
