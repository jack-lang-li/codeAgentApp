<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string> = {
  code: 'm8 5-7 7 7 7m8-14 7 7-7 7M14 3l-4 18',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  send: 'm22 2-7 20-4-9L2 9 22 2ZM22 2 11 13',
  stop: 'M6 6h12v12H6z',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  copy: 'M9 9h12v12H9zM5 15H3V3h12v2',
  check: 'm5 12 4 4L19 6',
  pulse: 'M2 12h5l3-8 4 16 3-8h5',
  chevron: 'm9 5 7 7-7 7',
  terminal: 'm4 5 6 7-6 7m9 0h7',
  message: 'M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z',
  spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  info: 'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  workflow: 'M3 3h6v6H3zM15 15h6v6h-6zM15 3h6v6h-6zM9 6h6M6 9v9h9',
  order: 'M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm4 5h6m-6 4h6',
  down: 'M12 4v16m-6-6 6 6 6-6',
  logout: 'M9 3H3v18h6m6-16 7 7-7 7M8 12h14',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4m-4 5v2',
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name] || paths.code" />
  </svg>
</template>
