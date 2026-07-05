<template>
  <q-layout view="lHh Lpr lFf">
    <q-header elevated>
      <q-toolbar>
        <q-toolbar-title>
          <q-icon name="movie" class="q-mr-sm" />
          Mobile Media
        </q-toolbar-title>

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
      <EncodeStatusBar />
    </q-footer>
  </q-layout>
</template>

<script setup lang="ts">
import EncodeStatusBar from "@/components/EncodeStatusBar.vue";
import { useDownloadsStore } from "@/stores/downloads";
import { useEncodesStore } from "@/stores/encodes";

const encodes = useEncodesStore();
const downloads = useDownloadsStore();
encodes.init();
downloads.init();
</script>
