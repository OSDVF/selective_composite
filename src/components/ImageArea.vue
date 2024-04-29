<template>
    <main ref="main">
        <canvas ref="canvas" class="absolute" @mousemove="paint" @touchmove="(e) => paint(e.touches[0])"
            @mousedown="(e) => (isDown = true, prevPos = startPos = [e.clientX, e.clientY])" @mouseup="(e) => paintEnd(e)"
            @touchstart="(e) => (isDown = true, prevPos = startPos = [e.touches[0].clientX, e.touches[0].clientY])"
            @touchend="(e) => paintEnd(e.touches[0])" @touchcancel="(e) => paintEnd(e.touches[0])"></canvas>
        <canvas v-if="showDebug" ref="debug" class="absolute" style="top:50%"></canvas>
        <img :src="resultImage" :width="selectedResult == ResultType.Split ? '50%' : 0" style="left:50%"
            class="absolute">
        <div class="overlay" v-show="computing" style="background: gray"></div>
        <Icon class="absolute" icon="mdi:magic-staff" style="top:50%;left:50%;transform:translate(-50%,-50%);"
            v-show="computing" size="64" />
    </main>
</template>

<script setup lang="ts">
import { onMounted, watch, ref, onBeforeUnmount, shallowRef, computed } from 'vue';
import { useState, ResultType } from '../state';
import { storeToRefs } from 'pinia';
import { Renderer } from '../render';
import cvLib from '@techstark/opencv-js'
import { Icon } from '@iconify/vue/dist/iconify.js';
import debounce from 'debounce';

const state = useState();
const { eraser, images, paintOpacity, enableAlignment,
    selectedDetector, selectedImage, selectedResult, selectedSegmentation, computing, detectorOptions,
    initialized, brushSize, drawKeypoints, showDebug, showParts, pointSizeLin, pointSizeExp
} = storeToRefs(state);
const cv = new Promise<void>((resolve) => {
    cvLib.onRuntimeInitialized = () => {
        console.log('OpenCV.js is ready');
        resolve();
        initialized.value = true
    }
    cvLib.redirectError = (e) => {
        console.error(cvLib.exceptionFromPtr(e))
    }
}
);
// painting state
const isDown = ref(false);
let prevPos = [0, 0]
let startPos = [0, 0]

const canvas = ref<HTMLCanvasElement | null>(null);
const debug = ref<HTMLCanvasElement | null>(null);
const resultImage = ref<string | undefined>();
const main = ref<HTMLDivElement | null>(null);

let renderer = shallowRef<Renderer | null>(null)
let observer = shallowRef<ResizeObserver | null>(null)

defineExpose({
    clearForeground,
    clearBackground,
    render,
    save,
})

function save() {
    if (!renderer.value || !canvas.value || !images.value[0]) {
        return
    }
    canvas.value.width = images.value[0].naturalWidth
    canvas.value.height = images.value[0].naturalHeight

    computing.value = true
    setTimeout(() => {
        let error
        const prev = renderer.value!.visualizeSegments
        renderer.value!.visualizeSegments = 0.
        try {
            renderResult(true)
            const link = document.createElement("a")
            link.href = resultImage.value!
            link.target = '_blank'
            link.click()
            link.remove()
        } catch (e) {
            error = e
        }
        computing.value = false
        // Render the previous view
        renderer.value!.visualizeSegments = prev
        updateCanvasSize(images.value[0])
        if (selectedResult.value == ResultType.None) {
            renderer.value!.render()
        } else {
            renderResult()
        }
        if (error) throw error
    }, 1)

}

function render() {
    requestAnimationFrame(() =>
        renderer.value?.render())
}

function clearForeground() {
    renderer.value?.clearPaint(false)
}

function clearBackground() {
    renderer.value?.clearPaint(true)
}

const selectedColor = computed<[number, number, number]>(() => {
    const hexStr = state.colors[selectedImage.value] || "#000000";
    return [parseInt(hexStr.slice(1, 3), 16), parseInt(hexStr.slice(3, 5), 16), parseInt(hexStr.slice(5, 7), 16)]
})

watch(selectedColor, (newColor) => {
    if (!renderer.value) {
        return;
    }
    renderer.value.paintColor = newColor.map(a => a / 255)
    renderer.value.backPaintColor = renderer.value.paintColor.map(a => (1 - a) * 0.4)
})
watch(brushSize, (newSize) => {
    if (!renderer.value) {
        return;
    }
    renderer.value.setPaintRadius(newSize)
})
watch(eraser, (e) => {
    if (!renderer.value) return
    renderer.value.erase = e
})
watch(drawKeypoints, (e) => {
    if (!renderer.value) return
    renderer.value.drawKeypoints = e
    render()
})
watch(paintOpacity, (opacity) => {
    if (!renderer.value) return
    renderer.value.setPaintOpacity(opacity)
    render()
    if (selectedResult.value != ResultType.None) {
        renderResult()
    }
})
watch([pointSizeLin, pointSizeExp], ([lin, exp]) => {
    if (!renderer.value) return
    renderer.value.setPointScale(exp, lin)
    render()
})
watch(selectedSegmentation, (seg) => {
    if (!renderer.value) return
    renderer.value.segmentationType = seg
})
watch(enableAlignment, (a) => {
    if (!renderer.value) return
    renderer.value.align = a
})
watch(debug, (d) => {
    if (!renderer.value) return
    renderer.value.debugCanvas = d
    render()
})
watch(showParts, (p) => {
    if (!renderer.value) return
    renderer.value.visualizeSegments = p ? 0.5 : 0
    if (selectedResult.value != ResultType.None) {
        renderResult()
    }
})
const renderCooldown = debounce(() => renderResult(), 1000)

function paint(event: MouseEvent | Touch) {
    if (!renderer.value || !isDown.value) {
        return;
    }

    const rect = canvas.value!.getBoundingClientRect();
    const from = [prevPos[0] - rect.left, prevPos[1] - rect.top]
    const to = [event.clientX - rect.left, event.clientY - rect.top]
    renderer.value.paint(from[0], from[1], to[0], to[1], !state.brushForeground);
    prevPos = [event.clientX, event.clientY];
}

function paintEnd(event: MouseEvent | Touch) {
    isDown.value = false
    if (startPos[0] == event.clientX && startPos[1] == event.clientY) {
        // single click
        const rect = canvas.value!.getBoundingClientRect();
        renderer.value?.paint(startPos[0] - rect.left, startPos[1] - rect.top, startPos[0] - rect.left, startPos[1] - rect.top, !state.brushForeground)
    }
    if (selectedResult.value == ResultType.Split) {
        renderCooldown()
    }
}

function passStateToRenderer() {
    renderer.value!.align = enableAlignment.value
    renderer.value!.debugCanvas = debug.value
    renderer.value!.images = images.value;
    renderer.value!.selected = selectedImage.value;
    renderer.value!.detectorType = selectedDetector.value;
    renderer.value!.detectorOptions = detectorOptions.value;
    renderer.value!.drawKeypoints = drawKeypoints.value
    renderer.value!.paintColor = selectedColor.value.map(a => a / 255);
    renderer.value!.visualizeSegments = showParts.value ? 0.5 : 0;
    renderer.value!.backPaintColor = renderer.value!.paintColor.map(a => (1 - a) * 0.4)
    renderer.value!.erase = eraser.value
    renderer.value!.segmentationType = selectedSegmentation.value
    renderer.value!.setPaintOpacity(paintOpacity.value)
    renderer.value!.setPaintRadius(brushSize.value)
    renderer.value!.setPointScale(pointSizeExp.value, pointSizeLin.value)
}

onMounted(() => {// also called when hot reloading
    const ctx = canvas.value?.getContext('webgl');
    if (!ctx) {
        return;
    }

    if (images.value.length > 0)
        updateCanvasSize(images.value[0])

    if (!renderer.value) {
        renderer.value = new Renderer(ctx);
    }
    passStateToRenderer()
    if (images.value.length > 0) {
        renderer.value!.updateImages();
        render()
    }

    if (main.value) {
        observer.value = new ResizeObserver(async () => {
            if (!canvas.value || !images.value.length) {
                return;
            }
            if (!initialized.value) await cv
            updateCanvasSize(images.value[0]);
            render()
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
            let error
            try {
                render()
            } catch (e) {
                error = e
            }
            computing.value = false
            if (error) throw error
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
    if (oldResult != newResult) {
        if (images.value) {
            updateCanvasSize(images.value[0])
        }
        if (newResult != ResultType.None) {
            computing.value = true
            setTimeout(() => {
                let error
                try {
                    renderResult()
                } catch (e) {
                    error = e
                }
                computing.value = false
                if (error) throw error
            }, 1)// also renders the currently selected image if view is split
        } else {
            render()
        }
    } else {
        render()
    }
})

function renderResult(save: boolean = false) {
    if (!renderer.value) {
        return;
    }
    renderer.value.selected = -1
    renderer.value.render()
    if (selectedResult.value == ResultType.Split || save) {
        // save and show the snapshot
        renderer.value.c.finish()
        resultImage.value = canvas.value?.toDataURL()

        // render again the previous image
        renderer.value.selected = selectedImage.value
        render()
    }
}

watch(selectedDetector, () => {
    if (renderer.value)
        renderer.value.detectorType = selectedDetector.value
})

watch(detectorOptions, () => {
    if (renderer.value)
        renderer.value.detectorOptions = detectorOptions.value
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

.absolute {
    position: absolute;
    top: 0;
    left: 0;
}
</style>