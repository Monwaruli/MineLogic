/**
 * The Video_Panel (task 7.2): the narrated walkthrough video that sits beside a
 * Difficulty's tutorial (Requirement 12).
 *
 * It reads the per-Difficulty Video_Source from the config file
 * (`src/content/videos.ts`) and:
 *  - shows a native <video> player with play/pause/rewind/scrub controls for a
 *    direct file URL, offering captions when configured (12.1, 12.4, 12.7);
 *  - shows a YouTube <iframe> embed (whose player provides the same controls)
 *    for a YouTube embed URL (12.1, 12.4);
 *  - shows a "coming soon" placeholder when no Video_Source is configured
 *    (12.5);
 *  - shows an error message in place of the video when a file source fails to
 *    load (12.6).
 *
 * Layout (12.2, 12.3): the panel is a plain block. The parent tutorial layout
 * places it beside the Tutorial_Player on wide viewports and below it on narrow
 * ones with Tailwind responsive classes; this component only fills whatever
 * space it is given. The video is never required to complete a Lesson (12.8) —
 * that is enforced by the Tutorial_Player, which does not gate on playback.
 */

import { useState } from 'react';
import type { Tier } from '../content/lessons';
import { videoSourceFor, type VideoSource } from '../content/videos';

export interface VideoPanelProps {
  /** The Difficulty whose walkthrough video to show. */
  tier: Tier;
  /**
   * Optional explicit Video_Source, overriding the config lookup. Tests pass
   * one to exercise each branch without editing the shared config file.
   */
  source?: VideoSource | null;
}

/** The "coming soon" placeholder shown when no Video_Source is set (12.5). */
function Placeholder({ tier }: { tier: Tier }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg bg-slate-800 border border-dashed border-slate-600 p-8 text-center min-h-[12rem]"
      role="note"
      data-testid="video-placeholder"
    >
      <span className="text-3xl" aria-hidden="true">
        🎬
      </span>
      <p className="text-slate-300 font-semibold">{tier} walkthrough video</p>
      <p className="text-sm text-slate-500">Coming soon.</p>
    </div>
  );
}

export default function VideoPanel({ tier, source }: VideoPanelProps) {
  // An explicit `source` prop wins (including an explicit null to force the
  // placeholder); otherwise read the per-Difficulty config.
  const resolved = source !== undefined ? source : videoSourceFor(tier);
  const [failed, setFailed] = useState(false);

  return (
    <aside
      aria-label={`${tier} walkthrough video`}
      className="w-full max-w-[480px]"
      data-testid="video-panel"
    >
      {resolved === null ? (
        <Placeholder tier={tier} />
      ) : failed ? (
        <div
          className="flex items-center justify-center rounded-lg bg-slate-800 border border-red-700 p-8 text-center min-h-[12rem]"
          role="alert"
          data-testid="video-error"
        >
          <p className="text-red-400">
            The {tier} walkthrough video could not be loaded.
          </p>
        </div>
      ) : resolved.kind === 'youtube' ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
          <iframe
            src={resolved.url}
            title={`${tier} walkthrough video`}
            className="h-full w-full"
            // The YouTube player exposes play, pause, and scrub controls (12.4).
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            data-testid="video-youtube"
          />
        </div>
      ) : (
        <video
          // Native controls give play, pause, rewind, and scrub (12.4).
          controls
          preload="metadata"
          className="w-full rounded-lg bg-black"
          onError={() => setFailed(true)}
          data-testid="video-file"
        >
          <source src={resolved.url} />
          {resolved.captionsUrl && (
            <track
              kind="captions"
              src={resolved.captionsUrl}
              label={resolved.captionsLabel ?? 'Captions'}
              default
            />
          )}
          Your browser cannot play this video.
        </video>
      )}
    </aside>
  );
}
