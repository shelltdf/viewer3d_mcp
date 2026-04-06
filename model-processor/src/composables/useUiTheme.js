import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const STORAGE_KEY = 'mp-ui-theme-mode'

/** @typedef {'system' | 'light' | 'dark'} ThemeMode */

function readSystemDark() {
  if (typeof window === 'undefined') return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function useUiTheme() {
  /** @type {import('vue').Ref<ThemeMode>} */
  const themeMode = ref('system')

  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s === 'system' || s === 'light' || s === 'dark') themeMode.value = s
  } catch {
    /* ignore */
  }

  const systemIsDark = ref(readSystemDark())
  /** @type {import('vue').Ref<MediaQueryList | null>} */
  const mediaQueryRef = ref(null)

  function onPrefChange() {
    systemIsDark.value = readSystemDark()
  }

  onMounted(() => {
    systemIsDark.value = readSystemDark()
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQueryRef.value = mql
    mql.addEventListener('change', onPrefChange)
  })

  onUnmounted(() => {
    mediaQueryRef.value?.removeEventListener('change', onPrefChange)
    mediaQueryRef.value = null
  })

  const resolvedTheme = computed(() => {
    if (themeMode.value === 'light') return 'light'
    if (themeMode.value === 'dark') return 'dark'
    return systemIsDark.value ? 'dark' : 'light'
  })

  watch(themeMode, (v) => {
    try {
      localStorage.setItem(STORAGE_KEY, v)
    } catch {
      /* ignore */
    }
  })

  /** @param {ThemeMode} v */
  function setThemeMode(v) {
    if (v === 'system' || v === 'light' || v === 'dark') themeMode.value = v
  }

  return { themeMode, resolvedTheme, setThemeMode, systemIsDark }
}
