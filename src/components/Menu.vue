<template>
    <aside>
        <button title="Save">
            <Icon icon="material-symbols:save" />
        </button>
        <button title="Add Image" @click="input.click()">
            <Icon icon="mdi:import" />
        </button>
        <button title="Result" :class="{ selected: selectedResult == ResultType.Full }"
            @click="selectedResult = selectedResult == ResultType.Full ? ResultType.None : ResultType.Full">
            <Icon icon="mdi:star-four-points-box-outline" />
        </button>
        <button title="Split Screen Result" :class="{ selected: selectedResult == ResultType.Split }"
            @click="selectedResult = selectedResult == ResultType.Split ? ResultType.None : ResultType.Split">
            <Icon icon="fluent:layout-column-two-24-regular" />
        </button>
        <button title="Foreground Brush" :class="{ selected: brushForeground }" @click="brushForeground = true"
            :disabled="selectedImage == 0">
            <Icon icon="mdi:brush" />
        </button>
        <button title="Background Brush" :class="{ selected: !brushForeground }" @click="brushForeground = false"
            :disabled="selectedImage == 0">
            <Icon icon="mdi:eraser" />
        </button>

        <div :style="{
            visibility: selectedImage != 0 ? 'visible' : 'hidden'
        }">
            <input type="range" v-model="brushSize" :max="images.length ? (images[0].naturalWidth / 10) : 2" min="1"
                style="width: 100%;margin:0">
            <Icon icon="mdi:arrow-left-right" />
            <input type="number" class="no-arrows no-border menu-input" v-model="brushSize" min="1">
        </div>

        <ImageButton :title="index == 0 ? `Baseline: ${basename(image.name)}` : `${basename(image.name)}`"
            v-for="(image, index) in images" :image="image" @select="selectedImage = index"
            @remove="state.removeImage(index)" :color="index > 0 ? colors[index] : 'transparent'"
            :class="{ selected: selectedImage == index }" />

        <div style="flex-grow: 1;">
            <button v-if="isDebug" @click="emits('redraw')">
                <Icon icon="mdi:draw" />
            </button>
            <select v-model="selectedDetector" title="Detector Type">
                <option :value="value" v-for="value in [DetectorType.AKAZE, DetectorType.ORB]">{{ DetectorType[value] }}
                </option>
            </select>
            <div>
                <Icon icon="mdi:scatter-plot-outline" />
                <input type="text" class="no-border menu-input" v-model="maxDetectorWidth" title="Max Width For Detector Image" />
            </div>
        </div>
    </aside>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { storeToRefs } from 'pinia'
import ImageButton from './ImageButton.vue'
import { useState, ResultType } from '../state.ts';
import { basename } from 'path-browserify'
import { DetectorType } from '../render';

const emits = defineEmits<{
    redraw: []
}>()

const state = useState()
const { brushForeground, brushSize, images, selectedImage, selectedResult, selectedDetector, colors, maxDetectorWidth } = storeToRefs(state)
const isDebug = import.meta.env.NODE_ENV != 'production'

const input = document.createElement('input');
input.type = 'file';
input.accept = 'image/png, image/jpeg, image/gif, image/webp, image/*';
input.onchange = readFile;

function readFile(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) {
        return;
    }
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
        const dataURL = e.target?.result;
        state.addImage(dataURL as string, file.name);
        if (state.images.length == 1) {
            selectedImage.value = 0;
        }
    };
    reader.readAsDataURL(file);
}

</script>

<style lang="scss">
aside {
    display: inline-flex;
    flex-direction: column;
    width: 4rem;
    border-right: 1px solid rgba(128, 128, 128, 0.099);

    button,
    select {
        width: 100%;
        display: inline-block;
    }
}

.selected:not(:disabled) {
    background-color: #93939357;
}

.menu-input {
    max-width: calc(100% - 1rem);
}
</style>