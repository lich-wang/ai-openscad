export const VIEW_KEYS = [
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
  "isoFrontRightTop",
  "isoFrontLeftTop",
  "isoBackRightTop",
  "isoBackLeftTop",
  "isoFrontRightBottom",
  "isoFrontLeftBottom",
  "isoBackRightBottom",
  "isoBackLeftBottom"
] as const;

export type ViewKey = (typeof VIEW_KEYS)[number];
export type ViewSet = Record<ViewKey, string>;

export const VIEW_FILE_STEMS: Record<ViewKey, string> = {
  front: "front",
  back: "back",
  left: "left",
  right: "right",
  top: "top",
  bottom: "bottom",
  isoFrontRightTop: "iso-front-right-top",
  isoFrontLeftTop: "iso-front-left-top",
  isoBackRightTop: "iso-back-right-top",
  isoBackLeftTop: "iso-back-left-top",
  isoFrontRightBottom: "iso-front-right-bottom",
  isoFrontLeftBottom: "iso-front-left-bottom",
  isoBackRightBottom: "iso-back-right-bottom",
  isoBackLeftBottom: "iso-back-left-bottom"
};

type LegacyViewSet = Partial<Record<ViewKey | "isometric", string>>;

export function createEmptyViewSet(): ViewSet {
  return Object.fromEntries(VIEW_KEYS.map((key) => [key, ""])) as ViewSet;
}

export function normalizeViewSet(views?: LegacyViewSet | null): ViewSet {
  const normalized = createEmptyViewSet();
  if (!views) {
    return normalized;
  }
  for (const key of VIEW_KEYS) {
    normalized[key] = views[key] ?? "";
  }
  if (!normalized.isoFrontRightTop && views.isometric) {
    normalized.isoFrontRightTop = views.isometric;
  }
  return normalized;
}

export function countRenderedViews(views: Partial<ViewSet>): number {
  return VIEW_KEYS.filter((key) => Boolean(views[key])).length;
}

export function hasCompleteViewSet(views: Partial<ViewSet>): boolean {
  return countRenderedViews(views) === VIEW_KEYS.length;
}

export function viewImagesInOrder(views: ViewSet): string[] {
  return VIEW_KEYS.map((key) => views[key]);
}
