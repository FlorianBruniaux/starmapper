// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Florian Bruniaux <florian@bruniaux.com>

export type TourId = "landing" | "map" | "explore" | "feeds" | "profile" | "contributors";

const KEY = (id: TourId) => `starmapper:tour:${id}:done`;

export const isTourCompleted = (id: TourId): boolean => {
  try {
    return !!localStorage.getItem(KEY(id));
  } catch {
    return true;
  }
};

export const markTourCompleted = (id: TourId): void => {
  try {
    localStorage.setItem(KEY(id), "1");
  } catch {}
};

export const resetTour = (id: TourId): void => {
  try {
    localStorage.removeItem(KEY(id));
  } catch {}
};
