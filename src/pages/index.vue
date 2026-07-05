<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated>
      <q-toolbar>
        <q-toolbar-title class="cursor-pointer" @click="$router.push('/')">
          <q-icon name="movie" class="q-mr-sm" />
          Mobile Media
        </q-toolbar-title>

        <q-btn
          flat
          round
          dense
          icon="download"
          to="/downloads"
          aria-label="Download queue"
        >
          <q-badge v-if="downloads.activeCount" color="green" floating>
            {{ downloads.activeCount }}
          </q-badge>
          <q-tooltip>Download queue</q-tooltip>
        </q-btn>

        <q-btn
          flat
          round
          dense
          icon="video_settings"
          to="/encodes"
          aria-label="Encode queue"
        >
          <q-badge v-if="encodes.activeCount" color="orange" floating>
            {{ encodes.activeCount }}
          </q-badge>
          <q-tooltip>Encode queue</q-tooltip>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <router-view />
    </q-page-container>

    <q-footer elevated class="bg-grey-10 text-white">
      <div class="row items-center no-wrap">
        <EncodeStatusBar class="col" />
        <StorageIndicator class="q-px-md" />
      </div>
    </q-footer>
  </q-layout>
</template>

<script setup lang="ts">
import EncodeStatusBar from "@/components/EncodeStatusBar.vue";
import StorageIndicator from "@/components/StorageIndicator.vue";
import { useDownloadsStore } from "@/stores/downloads";
import { useEncodesStore } from "@/stores/encodes";

const encodes = useEncodesStore();
const downloads = useDownloadsStore();
encodes.init();
downloads.init();
</script>
