<template>
    <aside>
        <button title="Save" @click="emit('save')">
            <Icon icon="material-symbols:save" />
        </button>
        <button title="Add Image" @click="input.click()">
            <Icon icon="mdi:plus-circle" />
        </button>
        <hr>
        <button title="Result" :class="{ selected: selectedResult == ResultType.Full }"
            @click="selectedResult = selectedResult == ResultType.Full ? ResultType.None : ResultType.Full">
            <Icon icon="mdi:check-bold" />
        </button>
        <button title="Split Screen Result" :class="{ selected: selectedResult == ResultType.Split }"
            @click="selectedResult = selectedResult == ResultType.Split ? ResultType.None : ResultType.Split">
            <Icon icon="fluent:layout-column-two-24-regular" />
        </button>
        <button title="Color Source Segments" :class="{ selected: showParts }" @click="showParts = !showParts" :disabled="selectedResult == ResultType.None"
            style="text-wrap: nowrap;">
            <Icon icon="mdi:identifier" />
            <Icon icon="mdi:invert-colors" />
        </button>
        <select v-model="selectedSegmentation"
            :title="`Selected segmentation algorithm: ${SegmentationType[selectedSegmentation]}`">
            <option v-for="option in [SegmentationType.Watershed]" :title="SegmentationType[option]" :value="option">
                {{ SegmentationType[option] }}
            </option>
        </select>
        <hr>

        <div :style="{
            visibility: selectedImage != 0 ? 'visible' : 'hidden'
        }">

            <button title="Foreground Brush" :class="{ selected: brushForeground }"
                @click="brushForeground = true; eraser = false" :disabled="selectedImage == 0">
                <Icon icon="mdi:brush" />
            </button>
            <button title="Background Brush" :class="{ selected: !brushForeground }"
                @click="brushForeground = false; eraser = false" :disabled="selectedImage == 0">
                <Icon icon="mdi:brush-variant" />
            </button>
            <button title="Eraser" :class="{ selected: eraser }" @click="eraser = !eraser"
                @dblclick="brushForeground ? emit('clearForeground') : emit('clearBackground'); eraser = false"
                :disabled="selectedImage == 0">
                <Icon icon="mdi:eraser" />
            </button>
            <input type="range" min=".1" max="1" step=".1" v-model.number="paintOpacity" title="Paint Opacity"
                :style="{ filter: `grayscale(${1 - paintOpacity})`, color: colors[selectedImage] }">
            <Icon icon="mdi:opacity" :color="colors[selectedImage]"
                :style="{ filter: `grayscale(${1 - paintOpacity})` }" />
            <input type="number" class="no-arrows no-border menu-input" min="0" v-model.number="paintOpacity"
                title="Paint Opacity">

            <input type="range" title="Brush Radius" v-model.number="brushSize"
                :max="images.length ? (images[0].naturalWidth / 10) : 2" min="1">
            <Icon icon="mdi:radius" />
            <input type="number" title="Brush Radius" class="no-arrows no-border menu-input" v-model.number="brushSize"
                min="1">
        </div>
        <hr>

        <ImageButton :title="index == 0 ? `Baseline: ${basename(image.name)}` : `${basename(image.name)}`"
            v-for="(image, index) in images" :image="image"
            @select="selectedImage = index; selectedResult = selectedResult == ResultType.Full ? ResultType.None : selectedResult"
            @remove="state.removeImage(index); selectedImage = selectedImage == index ? 0 : index"
            :color="index > 0 ? colors[index] : 'transparent'" :class="{ selected: selectedImage == index }" />
        <hr>
        <div style="flex-grow: 1;">
            <div v-if="isDebug">
                <input type="checkbox" v-model="showDebug" id="showDebug"><label for="showDebug">DBG</label>

                <button @click="emit('redraw')" title="Render">
                    <Icon icon="mdi:reload" />
                </button>
            </div>

            <input type="checkbox" v-model="enableAlignment" id="alignment"><label for="alignment">ALIGN</label>
            <template v-if="enableAlignment">
                <select v-model="selectedDetector"
                    :title="`Detector Type ${images.length == 0 ? '' : '(Not available when images added)'}`"
                    :disabled="images.length != 0">
                    <option :value="value" v-for="value in [DetectorType.AKAZE, DetectorType.ORB]"
                        :title="DetectorType[value]">
                        {{ DetectorType[value] }}
                    </option>
                </select>
                <template v-if="selectedDetector != DetectorType.AKAZE">
                    <Icon icon="mdi:scatter-plot-outline" />
                    <input type="number" class="no-arrows no-border menu-input"
                        v-model.number="detectorOptions.maxFeatures" title="Max number of features to detect" />
                    <Icon icon="mdi:razor-single-edge" />
                    <input type="number" class="no-arrows no-border menu-input"
                        v-model.number="detectorOptions.edgeThreshold" title="Max number of features to detect" />
                </template>
                <Icon icon="mdi:arrow-left-right" />
                <input type="number" class="no-arrows no-border menu-input" v-model.number="detectorOptions.widthLimit"
                    title="Image width limit for detector" :disabled="images.length != 0" />
                <Icon icon="mdi:arrow-all" />
                <input type="number" class="no-arrows no-border menu-input" v-model.number="detectorOptions.knnDistance"
                    title="Maximum distance of a good match" />
                <button :class="{ selected: drawKeypoints }" @click="drawKeypoints = !drawKeypoints"
                    title="Draw Keypoints">
                    <Icon icon="mdi:scatter-plot" />
                </button>

                <template v-if="drawKeypoints">
                    <input type="range" min=".1" step=".1" max="16" v-model.number="pointSizeLin"
                        title="Drawn Keypoint Scale">
                    <Icon icon="mdi:circle-outline" />
                    <input type="number" class="no-border menu-input" min="1" v-model.number="pointSizeLin"
                        title="Drawn Keypoint Scale" />
                    <input type="range" min="1" step="1" max="16" v-model.number="pointSizeExp"
                        title="Scale Exponential Base">
                    <Icon icon="mdi:exponent" />
                    <input type="number" class="no-border menu-input" min="1" v-model.number="pointSizeExp"
                        title="Scale Exponential Base" />
                </template>
            </template>
        </div>
    </aside>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { storeToRefs } from 'pinia'
import ImageButton from './ImageButton.vue'
import { useState, ResultType } from '../state.ts';
import { basename } from 'path-browserify'
import { DetectorType, SegmentationType } from '../render';

const emit = defineEmits<{
    redraw: [],
    save: [],
    clearForeground: [],
    clearBackground: [],
}>()

const state = useState()
const { brushForeground, brushSize, eraser, enableAlignment, images, paintOpacity, pointSizeLin, pointSizeExp,
    selectedImage, selectedResult, selectedDetector, selectedSegmentation,
    colors, detectorOptions, drawKeypoints, showDebug, showParts
} = storeToRefs(state)
const isDebug = import.meta.env.DEV

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
        selectedImage.value = state.images.length - 1;
    };
    reader.readAsDataURL(file);
}

</script>

<style lang="scss">
aside {
    display: inline-flex;
    flex-direction: column;
    width: 4.5rem;
    border-right: 1px solid rgba(128, 128, 128, 0.099);

    button,
    select {
        width: 100%;
        display: inline-block;
    }

    hr {
        margin: .1rem 0
    }

    label {
        font-size: .8rem
    }
}

.selected:not(:disabled) {
    background-color: #93939357;
}

.menu-input {
    max-width: calc(100% - 1rem);
}

input[type="range"] {
    width: 100%;
    margin: 0;

    &::-moz-range-progress {
        background-color: currentColor;
    }
}
</style>