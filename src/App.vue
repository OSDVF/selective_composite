<script setup lang="ts">
import { getCurrentInstance, ref } from 'vue'
import { useState } from './state';

import ImageArea from './components/ImageArea.vue'
import Menu from './components/Menu.vue'

const state = useState()

const errors = ref<string[]>([])
getCurrentInstance()!.appContext.app.config.errorHandler = (err) => {
  errors.value.push(typeof err === "string" ? err : typeof err === "object" ? err !== null && 'message' in err ? err.message : JSON.stringify(err) : "" as any)
  console.error(err)
}

const imageArea = ref<InstanceType<typeof ImageArea> | null>(null)

</script>

<template>
  <div id="root">
    <Menu @redraw="imageArea?.render" @clear-foreground="imageArea?.clearForeground"
      @clear-background="imageArea?.clearBackground" style="overflow-y: auto; max-height: 100vh"
      @save="imageArea?.save" />
    <ImageArea ref="imageArea" />
    <div v-if="errors && errors.length" class="bottom" style="color: red;">
      <div v-for="err in errors">
        {{ err }}
      </div>
    </div>
    <div class="bottom" v-show="state.computing" style="color:blue">
      Computing...
    </div>
  </div>
</template>

<style lang="css">
#root {
  display: flex;
}

.bottom {
  background: var(--back);
  position: fixed;
  bottom: 0;
  right: 0;
  left: 0;
  max-height: 100px;
  overflow-y: auto;
}
</style>
