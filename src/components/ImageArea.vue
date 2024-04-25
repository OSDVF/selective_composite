<template>
    <main ref="main">
        <canvas ref="canvas" class="absolute-canvas" @mousemove="paint" @touchmove="(e) => paint(e.touches[0])"
            @mousedown="isDown = true" @mouseup="isDown = false" @touchstart="isDown = true" @touchend="isDown = false"
            @touchcancel="isDown = false"></canvas>
        <!--<canvas ref="debug" class="absolute-canvas"></canvas>-->
        <img :src="result" :width="selectedResult == ResultType.Split ? '50%' : 0" />
    </main>
</template>

<script setup lang="ts">
import { onMounted, watch, ref, onBeforeUnmount, shallowRef, computed } from 'vue';
import { useState, ResultType } from '../state';
import { storeToRefs } from 'pinia';
import { Renderer } from '../render';
import cvLib from '@techstark/opencv-js'

const state = useState();
const { images, selectedDetector, selectedImage, selectedResult, computing, maxDetectorWidth, initialized, brushSize } = storeToRefs(state);
const cv = new Promise<void>((resolve) => {
    cvLib.onRuntimeInitialized = () => {
        console.log('OpenCV.js is ready');
        resolve();
        initialized.value = true
    }
    cvLib.redirectError = console.error
}
);
const isDown = ref(false);

const canvas = ref<HTMLCanvasElement | null>(null);
const debug = ref<HTMLCanvasElement | null>(null);
const result = ref<string>("");
const main = ref<HTMLDivElement | null>(null);

let renderer = shallowRef<Renderer | null>(null)
let observer = shallowRef<ResizeObserver | null>(null)

defineExpose({
    reRender
})

function reRender() {
    renderer.value?.render()
    console.log("Re-rendered")
}

const selectedColor = computed<[number, number, number]>(() => {
    const hexStr = state.colors[selectedImage.value] || "#000000";
    return [parseInt(hexStr.slice(1, 3), 16), parseInt(hexStr.slice(3, 5), 16), parseInt(hexStr.slice(5, 7), 16)]
})

watch(selectedColor, (newColor) => {
    if (!renderer.value) {
        return;
    }
    renderer.value.selectedColor = newColor
})
watch(brushSize, (newSize) => {
    if (!renderer.value) {
        return;
    }
    renderer.value.brushSize = newSize
})

function paint(event: MouseEvent | Touch) {
    if (!renderer.value || !isDown.value) {
        return;
    }

    const rect = canvas.value!.getBoundingClientRect();
    renderer.value.paint(event.clientX - rect.left, event.clientY - rect.top);
}

function passStateToRenderer() {
    renderer.value!.debugCanvas = debug.value
    renderer.value!.images = images.value;
    renderer.value!.selected = selectedImage.value;
    renderer.value!.detectorType = selectedDetector.value;
    renderer.value!.detectorWidthLimit = maxDetectorWidth.value;
    renderer.value!.brushSize = brushSize.value;
    renderer.value!.selectedColor = selectedColor.value;

    console.log("State passed to renderer", images.value, selectedImage.value, selectedDetector.value)
}

onMounted(() => {// also called when hot reloading
    const ctx = canvas.value?.getContext('webgl');
    if (!ctx) {
        return;
    }

    if (images.value.length > 0)
        updateCanvasSize(images.value[0])

    if (renderer.value) {
        passStateToRenderer()
        renderer.value.updateImages()
    } else {
        renderer.value = new Renderer(ctx);
        passStateToRenderer()
    }
    if (images.value.length > 0) {
        renderer.value!.updateImages();
        renderer.value!.render();
    }

    if (main.value) {
        observer.value = new ResizeObserver(async () => {
            if (!canvas.value || !images.value.length) {
                return;
            }
            if (!initialized.value) await cv
            updateCanvasSize(images.value[0]);
            renderer.value?.render();
        });

        observer.value.observe(main.value);
    }
})

onBeforeUnmount(() => {
    observer.value?.disconnect();
})

function updateCanvasSize(image: HTMLImageElement) {
    if (!main.value || !canvas.value) {
        return;
    }
    const aspect = image.naturalWidth / image.naturalHeight;
    let width = main.value.clientWidth;
    if (selectedResult.value == ResultType.Split) {
        width /= 2;
    }
    let height = width / aspect;// fit to aspect ratio
    if (height > window.innerHeight) {
        height = window.innerHeight;
        width = height * aspect;
    }

    canvas.value!.width = width;
    canvas.value!.height = height;
    console.log("Canvas size updated to", width, height)
}

watch(images, async (newImages, oldImages) => {
    if (!renderer.value || !main.value) {
        return;
    }
    if (!initialized.value) await cv

    renderer.value.images = newImages;
    if (newImages.length > 0) {
        computing.value = true
        const loadedPromises = newImages.map((img) => {
            return new Promise<void>((resolve) => {
                if (img.complete) {
                    resolve()
                    return
                }
                function setResolved() {
                    resolve()
                    img.removeEventListener('load', setResolved)
                }
                img.addEventListener('load', setResolved)
            })
        })
        await Promise.all(loadedPromises)
        // Initial image import - set the viewport
        if (oldImages.length == 0 && newImages.length == 1) {
            updateCanvasSize(newImages[0])
        }
        setTimeout(() => {
            renderer.value!.selected = selectedImage.value;
            renderer.value!.updateImages();
            renderer.value!.render()
            computing.value = false
        }, 1)
    } else {
        renderer.value!.clear()
    }
})

watch([selectedResult, selectedImage], async ([newResult, newSelected], [oldResult]) => {
    if (!renderer.value) {
        return;
    }
    if (!initialized.value) await cv
    renderer.value.selected = newSelected
    if (oldResult != newResult && images.value) {
        updateCanvasSize(images.value[0])
    }
    renderer.value.render();
})

watch(selectedDetector, () => {
    if (renderer.value)
        renderer.value.detectorType = selectedDetector.value
})

watch(maxDetectorWidth, () => {
    if (renderer.value)
        renderer.value.detectorWidthLimit = maxDetectorWidth.value
})

</script>

<style lang="css">
main {
    display: inline-block;
    width: calc(100% - 4rem);
    flex-grow: 1;

    min-height: 100vh;
    position: relative;
}

.absolute-canvas {
    position: absolute;
    top: 0;
    left: 0;

    &:nth-of-type(2) {
        top: 50%
    }
}
</style>