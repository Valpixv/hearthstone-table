// Inventory icons: every item shows a painted kit icon (src/ui/kit.js, group "item"). Known items use their own icon,
// anything else the closest match by name (src/rules/itemIcon.js), and a plain sack when nothing fits. Nothing is generated.
import { kitHas, kitIcon } from '../ui/kit.js';
import { resolveItem, GENERIC_ICON } from '../rules/itemIcon.js';

/** Kit key for an inventory row (rows saved by older versions carry icon keys the kit does not have; those re-resolve by name). */
export function itemKitKey(item = {}) {
  const k = item.icon?.key;
  if (k && kitHas(`item/${k}`)) return `item/${k}`;
  if (item.ref && kitHas(`item/${item.ref}`)) return `item/${item.ref}`;
  const r = resolveItem(item.name || '').icon.key;
  return kitHas(`item/${r}`) ? `item/${r}` : `item/${GENERIC_ICON}`;
}

/** HTML for an inventory row icon. */
export function itemIconMarkup(item) { return kitIcon(itemKitKey(item), { cls: 'item-icon' }); }
