import { DDSLoader } from 'three/examples/jsm/loaders/DDSLoader.js'
import { KTXLoader } from 'three/examples/jsm/loaders/KTXLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

/**
 * 为 LoadingManager 注册 .dds / .ktx / .ktx2（需 public/basis 下 Basis 转码器）。
 * @param {import('three').LoadingManager} manager
 * @param {import('three').WebGLRenderer | null} renderer
 */
export function attachCompressedTextureHandlers(manager, renderer) {
  const dds = new DDSLoader(manager)
  manager.addHandler(/\.dds$/i, dds)

  const ktx1 = new KTXLoader(manager)
  manager.addHandler(/\.ktx$/i, ktx1)

  const ktx2 = new KTX2Loader(manager)
  ktx2.setTranscoderPath('/basis/')
  if (renderer) {
    try {
      ktx2.detectSupport(renderer)
    } catch {
      /* ignore */
    }
  }
  manager.addHandler(/\.ktx2$/i, ktx2)
}
