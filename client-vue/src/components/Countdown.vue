<template>
    <span class="countdown" :title="targetDate.toString()">
        {{ timeLeft }}
    </span>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps<{
    date: string | Date;
}>();

const targetDate = computed(() => new Date(props.date));
const now = ref(new Date());
let timer: ReturnType<typeof setInterval>;

const timeLeft = computed(() => {
    const diff = targetDate.value.getTime() - now.value.getTime();
    if (diff <= 0) return "00:00";

    const hours = Math.floor(diff / 1000 / 60 / 60);
    const minutes = Math.floor((diff / 1000 / 60) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    const pad = (n: number) => n.toString().padStart(2, "0");

    if (hours > 0) {
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
});

function update() {
    now.value = new Date();
}

// Watch for prop changes to force immediate update
watch(() => props.date, () => {
    update();
}, { immediate: false });

onMounted(() => {
    update();
    timer = setInterval(update, 1000);
});

onUnmounted(() => {
    clearInterval(timer);
});
</script>
