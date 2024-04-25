import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import stc from 'string-to-color'
import { DetectorOptions, DetectorType } from './render'

export enum ResultType {
    Split, Full, None
}

export const useState = defineStore('state', () => {
    const images = ref<HTMLImageElement[]>([])
    const brushSize = ref(2)
    const selectedImage = ref(0)
    const selectedResult = ref(ResultType.None)
    const selectedDetector = ref(DetectorType.AKAZE)
    const colors = computed(() => images.value.map((img, i) => stc(img.src.substring(0, 50) + i.toString())))
    // foreground/background selector
    const brushForeground = ref(true)
    const eraser = ref(false)
    const computing = ref(false)
    const detectorOptions = ref<DetectorOptions>({
        knnDistance: 0.7,
        widthLimit: 800,
        maxFeatures: 200,
    })
    // OpenCV initialized
    const initialized = ref(false)

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
        detectorOptions,
        eraser,
        images,
        initialized,
        selectedDetector,
        selectedImage,
        selectedResult,
        addImage,
        removeImage
    }
})