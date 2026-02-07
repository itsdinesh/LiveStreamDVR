<template>
    <teleport to="body">
        <transition name="modal-transition">
            <div v-if="show" class="modal-box" @click.self="overlayClick">
                <div class="modal-box__container" :style="{ maxWidth: maxWidth }">
                    <div class="modal-box__header">
                        <div class="modal-box__title">
                            {{ title }}
                        </div>
                        <div class="modal-box__close" @click="$emit('close')">
                            <font-awesome-icon icon="times" />
                        </div>
                    </div>
                    <div class="modal-box__body">
                        <slot />
                    </div>
                </div>
            </div>
        </transition>
    </teleport>
</template>

<script lang="ts" setup>
import { library } from "@fortawesome/fontawesome-svg-core";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
library.add(faTimes);

const props = defineProps({
    title: {
        type: String,
        default: "Modal",
    },
    maxWidth: {
        type: String,
        default: "800px",
    },
    show: {
        type: Boolean,
        default: false,
    },
    cancelOnOverlayClick: {
        type: Boolean,
        default: true,
    },
});

const emit = defineEmits(["close"]);

function close() {
    emit("close");
}

function overlayClick() {
    if (props.cancelOnOverlayClick) {
        emit("close");
    }
}
</script>
