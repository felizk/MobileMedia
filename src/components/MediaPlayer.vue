<template>
  <video
    ref="videoEl"
    controls
    crossorigin="anonymous"
    :src="src"
    class="full-width"
    @loadedmetadata="onLoadedMetadata"
    @play="onPlay"
    @pause="onPause"
    @seeked="onSeeked"
    @ended="onEnded"
    autoplay
  />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import {
  clearPlaybackPosition,
  getPlaybackPosition,
  savePlaybackPosition
} from "@/services/playback-position";

const props = defineProps<{
  /** Stream URL to play. */
  src: string;
  /** Stable identifier used to persist/restore the resume position. */
  positionKey: string;
}>();

const videoEl = ref<HTMLVideoElement | null>(null);
let saveTimer: ReturnType<typeof setInterval> | undefined;
// Only persist a position once the user has actually watched 5 consecutive
// seconds since the last seek. Scrubbing around without settling anywhere
// shouldn't move the resume point. The interval sets this when it first fires.
let watchedEnough = false;

function savePosition() {
  const video = videoEl.value;
  if (!video || !watchedEnough) return;
  savePlaybackPosition(props.positionKey, video.currentTime, video.duration);
}

function onLoadedMetadata() {
  const video = videoEl.value;
  if (!video) return;
  const saved = getPlaybackPosition(props.positionKey);
  if (saved != null && saved < video.duration) {
    video.currentTime = saved;
  }
}

function startSaveTimer() {
  clearInterval(saveTimer);
  saveTimer = setInterval(() => {
    watchedEnough = true;
    savePosition();
  }, 5000);
}

function onPlay() {
  startSaveTimer();
}

function onPause() {
  clearInterval(saveTimer);
  savePosition();
}

function onSeeked() {
  // A seek breaks the "consecutive seconds" streak: don't save the new spot
  // until it too has been watched for 5 seconds. Restart the interval so the
  // next save is a full 5s after the seek rather than mid-cycle.
  watchedEnough = false;
  if (videoEl.value && !videoEl.value.paused) startSaveTimer();
}

function onEnded() {
  clearInterval(saveTimer);
  clearPlaybackPosition(props.positionKey);
}

// --- Auto fullscreen on landscape ---------------------------------------
// On touch devices, rotating into landscape enters fullscreen and rotating
// back to portrait exits it. Fullscreen requests can be blocked when they
// aren't tied to a user gesture, so every attempt is best-effort.
const isTouch =
  typeof window !== "undefined" &&
  window.matchMedia("(pointer: coarse)").matches;
const landscapeQuery =
  typeof window !== "undefined"
    ? window.matchMedia("(orientation: landscape)")
    : null;

type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};

async function syncFullscreen(landscape: boolean) {
  const video = videoEl.value as FullscreenVideo | null;
  if (!video) return;
  try {
    if (landscape) {
      if (document.fullscreenElement) return;
      if (video.requestFullscreen) await video.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    } else if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch {
    // Blocked (e.g. no user gesture) or unsupported — ignore, it's best-effort.
  }
}

function onOrientationChange(e: MediaQueryListEvent) {
  void syncFullscreen(e.matches);
}

onMounted(() => {
  if (!isTouch || !landscapeQuery) return;
  landscapeQuery.addEventListener("change", onOrientationChange);
  if (landscapeQuery.matches) void syncFullscreen(true);
});

onUnmounted(() => {
  clearInterval(saveTimer);
  savePosition();
  landscapeQuery?.removeEventListener("change", onOrientationChange);
});
</script>
