import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import stc from 'string-to-color'
import { DetectorOptions, DetectorType, SegmentationType } from './render'
import { usePersistentRef } from './persistence'

export enum ResultType {
    Split, Full, None
}

export const useState = defineStore('state', () => {
    const images = ref<HTMLImageElement[]>([])
    const brushSize = ref(5)
    const paintOpacity = ref(0.9)
    const pointSizeExp = usePersistentRef("pointSizeExp", 10)
    const pointSizeLin = usePersistentRef("pointSize", 1)
    const enableAlignment = usePersistentRef("align", true)
    const selectedImage = ref(0)
    const selectedResult = ref(ResultType.None)
    const selectedDetector = usePersistentRef("detector", DetectorType.AKAZE)
    const selectedSegmentation = usePersistentRef("segmentation", SegmentationType.Watershed)
    const showDebug = usePersistentRef("debug", false)
    const colors = computed(() => images.value.map((img, i) => stc(img.src.substring(0, 50) + i.toString())))
    // foreground/background selector
    const brushForeground = ref(true)
    const eraser = ref(false)
    const computing = ref(false)
    const detectorOptions = ref<DetectorOptions>({
        knnDistance: 0.7,
        widthLimit: 800,
        maxFeatures: 200,
        edgeThreshold: 31,
    })
    const drawKeypoints = ref(false)
    // OpenCV initialized
    const initialized = ref(false)

    watch(selectedSegmentation, (value) => {
        if (value === SegmentationType.Watershed) {
            brushForeground.value = true//watershed only needs foreground
        }
    })

    function addImage(dataURL: string, name: string) {
        const img = new Image()
        img.src = dataURL
        img.name = name
        images.value = [...images.value, img]
    }

    function removeImage(index: number) {
        images.value[index].remove()
        images.value = images.value.filter((_, i) => i !== index)
    }

    return {
        brushForeground,
        brushSize,
        colors,
        computing,
        drawKeypoints,
        detectorOptions,
        enableAlignment,
        eraser,
        images,
        initialized,
        paintOpacity,
        pointSizeLin,
        pointSizeExp,
        selectedDetector,
        selectedImage,
        selectedResult,
        selectedSegmentation,
        showDebug,
        addImage,
        removeImage
    }
})