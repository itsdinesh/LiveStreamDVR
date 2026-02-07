<template>
    <div class="schedule-config-modal">
        <form @submit.prevent="save">
            <div class="field">
                <label class="label">Schedule Status</label>
                <div class="control">
                    <label class="checkbox is-size-5">
                        <input v-model="formData.schedule_enabled" type="checkbox" />
                        <span class="icon-text ml-2">
                            <span class="icon" :class="formData.schedule_enabled ? 'has-text-success' : 'has-text-grey'">
                                <font-awesome-icon :icon="formData.schedule_enabled ? 'check-circle' : 'times-circle'" />
                            </span>
                            <span>{{ formData.schedule_enabled ? 'Enabled' : 'Disabled' }}</span>
                        </span>
                    </label>
                </div>
                <p class="help">When enabled, the system will automatically check for the stream online status according to the interval below.</p>
            </div>

            <hr />

            <div v-if="formData.schedule_enabled" class="schedule-settings">
                <div class="columns">
                    <div class="column">
                        <div class="field">
                            <label class="label">Check Interval</label>
                            <div class="field has-addons">
                                <div class="control is-expanded">
                                    <input v-model.number="formData.check_interval" class="input" type="number" min="1" required />
                                </div>
                                <div class="control">
                                    <div class="select">
                                        <select v-model="formData.check_interval_unit">
                                            <option value="seconds">seconds</option>
                                            <option value="minutes">minutes</option>
                                            <option value="hours">hours</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <p class="help">How often to check if the stream is live.</p>
                        </div>
                    </div>
                    <div class="column">
                        <div class="field">
                            <label class="label">Max Duration</label>
                            <div class="field has-addons">
                                <div class="control is-expanded">
                                    <input v-model.number="formData.max_check_duration" class="input" type="number" min="-1" required />
                                </div>
                                <div class="control">
                                    <div class="select">
                                        <select v-model="formData.max_check_duration_unit">
                                            <option value="seconds">seconds</option>
                                            <option value="minutes">minutes</option>
                                            <option value="hours">hours</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <p class="help">Stop checking after this time (-1 for infinite).</p>
                        </div>
                    </div>
                </div>
            </div>

            <div class="field is-grouped is-justify-content-space-between mt-5">
                <div class="control">
                    <button class="button is-danger is-light" type="button" @click="$emit('close')">Cancel</button>
                </div>
                <div class="control">
                    <button class="button is-primary" type="submit" :class="{ 'is-loading': loading }">
                        <span class="icon"><font-awesome-icon icon="save" /></span>
                        <span>Save Settings</span>
                    </button>
                </div>
            </div>
            <p v-if="error" class="help is-danger mt-3">{{ error }}</p>
        </form>
    </div>
</template>

<script lang="ts" setup>
import { ref, onMounted } from "vue";
import { useStore } from "@/store";
import axios from "axios";
import type { ChannelTypes } from "@/twitchautomator";
import type { ApiResponse } from "@common/Api/Api";

const props = defineProps<{
    streamer: ChannelTypes;
}>();

const emit = defineEmits<{
    (e: "close"): void;
    (e: "save"): void;
}>();

const store = useStore();
const loading = ref(false);
const error = ref("");

const formData = ref({
    schedule_enabled: false,
    check_interval: 60,
    check_interval_unit: "seconds",
    max_check_duration: -1,
    max_check_duration_unit: "minutes",
});

onMounted(() => {
    // Initialize form with current values
    formData.value.schedule_enabled = props.streamer.schedule_enabled || false;
    formData.value.check_interval = props.streamer.check_interval || 60;
    formData.value.check_interval_unit = props.streamer.check_interval_unit || "seconds";
    formData.value.max_check_duration = props.streamer.max_check_duration || -1;
    formData.value.max_check_duration_unit = props.streamer.max_check_duration_unit || "minutes";
});

async function save() {
    loading.value = true;
    error.value = "";

    try {
        const s = props.streamer as any;
        let payload: Record<string, any>;

        // Build provider-specific payload
        if (s.provider === "streamlink" || s.provider === "rtsp") {
            // Streamlink/RTSP only needs schedule fields and basic config
            payload = {
                url: s.url || s.config?.url || "",
                icon_url: s.icon_url || s.config?.icon_url || "",
                schedule_enabled: formData.value.schedule_enabled,
                check_interval: formData.value.check_interval,
                check_interval_unit: formData.value.check_interval_unit,
                max_check_duration: formData.value.max_check_duration,
                max_check_duration_unit: formData.value.max_check_duration_unit,
            };
        } else {
            // Twitch/YouTube channels need all the standard fields
            payload = {
                quality: s.quality ? s.quality.join(" ") : "best",
                match: s.match ? s.match.join(",") : "",
                download_chat: s.download_chat ?? false,
                live_chat: s.live_chat ?? false,
                burn_chat: s.burn_chat ?? false,
                no_capture: s.no_capture ?? false,
                no_cleanup: s.no_cleanup ?? false,
                max_storage: s.max_storage ?? 0,
                max_vods: s.max_vods ?? 0,
                download_vod_at_end: s.download_vod_at_end ?? false,
                download_vod_at_end_quality: s.download_vod_at_end_quality || "",
                schedule_enabled: formData.value.schedule_enabled,
                check_interval: formData.value.check_interval,
                check_interval_unit: formData.value.check_interval_unit,
                max_check_duration: formData.value.max_check_duration,
                max_check_duration_unit: formData.value.max_check_duration_unit,
            };
        }

        await axios.put(`/api/v0/channels/${props.streamer.uuid}`, payload);
        
        store.fetchAndUpdateStreamerList();
        emit("save");
        emit("close");
    } catch (e: any) {
        if (axios.isAxiosError(e) && e.response?.data?.message) {
            error.value = e.response.data.message;
            if (e.response.data.zodErrors) {
                console.error("Zod Errors:", e.response.data.zodErrors);
            }
        } else {
            error.value = e.message;
        }
    } finally {
        loading.value = false;
    }
}
import { library } from "@fortawesome/fontawesome-svg-core";
import { faCheckCircle, faTimesCircle, faSave } from "@fortawesome/free-solid-svg-icons";
library.add(faCheckCircle, faTimesCircle, faSave);
</script>

<style scoped>
.schedule-settings {
    background-color: var(--box-bg-color-lighter, #f5f5f5);
    padding: 1rem;
    border-radius: 4px;
    margin-top: 1rem;
}
</style>
