import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import stc from 'string-to-color'
import { DetectorType } from './render'

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
    const computing = ref(false)
    const maxDetectorWidth = ref(800)
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
        images,
        initialized,
        maxDetectorWidth,
        selectedDetector,
        selectedImage,
        selectedResult,
        addImage,
        removeImage
    }
})