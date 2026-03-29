import { describe, it, expect } from 'vitest'
import * as THREE from 'three'

describe('smoke', () => {
  it('three revision is defined', () => {
    expect(THREE.REVISION).toBeDefined()
  })
})
