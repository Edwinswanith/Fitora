// Where things Pex flies between sit on screen (window coordinates), so the
// daily entrance can start at the profile picture and land in the Today card.

import type { View } from "react-native";

export type PexRect = { x: number; y: number; width: number; height: number };

const anchors = new Map<string, PexRect>();

export type PexAnchor = "avatar" | "slot";

export function measurePexAnchor(node: View | null, key: PexAnchor): void {
  node?.measureInWindow((x, y, width, height) => {
    if (width > 0 && height > 0) anchors.set(key, { x, y, width, height });
  });
}

export function getPexAnchor(key: PexAnchor): PexRect | null {
  return anchors.get(key) ?? null;
}
