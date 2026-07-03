<template>
  <MediaBrowser :path="path" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import MediaBrowser from "@/components/MediaBrowser.vue";

const route = useRoute("//browse/[...path]");
const path = computed(() => route.params.path);
</script>
