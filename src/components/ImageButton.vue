<template>
    <div class="relative">
        <div class="overlay" :style="{ background: props.color }"></div>
        <button :title="props.title" @dblclick="emits('remove')" @click="emits('select')" ref="button" class="img">
        </button>
        <Icon icon="mdi:image-refresh" v-if="!loaded" />
    </div>
</template>

<script lang="ts" setup>
import { Icon } from '@iconify/vue/dist/iconify.js';
import { onMounted, ref, watch } from 'vue';
const button = ref<HTMLButtonElement | null>(null);
const loaded = ref(false)

const props = defineProps<{
    image: HTMLImageElement,
    color: string,
    title: string,
}>()

const emits = defineEmits<{
    select: [],
    remove: [],
}>()

onMounted(() => {
    button.value?.appendChild(props.image)
    if (props.image.complete)
        loaded.value = true
    else {
        function setLoaded() {
            loaded.value = true
            props.image.removeEventListener('load', setLoaded)
        }
        props.image.addEventListener('load', setLoaded)
    }
})

watch(props, (newProps) => {
    button.value?.replaceChildren(newProps.image)
})
</script>

<style lang="scss">
button.img {
    padding: 0;
    padding-inline: 0;
    overflow: hidden;

    &>img {
        width: 100%;
    }
}

.relative {
    position: relative;
}
</style>