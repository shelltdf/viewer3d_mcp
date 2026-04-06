export function buildOutlineItems(root) {
  const items = []
  const walk = (obj, depth, parentUuid = '') => {
    const label = obj.name ? `${obj.name} (${obj.type})` : obj.type
    items.push({
      uuid: obj.uuid,
      parentUuid,
      depth,
      label,
      hasChildren: !!obj.children?.length,
      visible: obj.visible !== false,
    })
    for (const c of obj.children) {
      walk(c, depth + 1, obj.uuid)
    }
  }
  if (root) walk(root, 0)
  return items
}
