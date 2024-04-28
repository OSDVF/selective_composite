import { LocalKey, LocalStorage } from 'ts-localstorage'
import type { UnwrapRef, Ref } from 'vue'
import { ref, onMounted, watch, isRef, triggerRef } from 'vue'

export function usePersistentRef<T>(name: string, defaultValue: T) {
    const key = new LocalKey<T, true>(name, defaultValue, {
        hasDefaultValue: true
    })
    let internalRef: Ref<UnwrapRef<T>>
    if (typeof localStorage !== 'undefined') {
        internalRef = ref(LocalStorage.getItem(key)!)
    } else {
        internalRef = ref(defaultValue)
    }
    function hydrate() {
        if (typeof localStorage !== 'undefined') {
            const storedVal = ref(LocalStorage.getItem(key)!).value
            if (storedVal !== internalRef.value) {
                internalRef.value = storedVal
            }
        }
        watch(internalRef, (newValue) => {
            LocalStorage.setItem(key, isRef(newValue) ? newValue.value as T : newValue as T)
        }, {
            deep: true
        })
        triggerRef(internalRef)
    }
    onMounted(hydrate)
    return internalRef
}
